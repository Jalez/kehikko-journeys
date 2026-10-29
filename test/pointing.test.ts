import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { answerAt as answer, stream } from '../doors.ts'
import { ASK } from '../project.ts'
import { ID } from '../manifest.ts'
import { listen, listening, point, pointerKey, watched, type Pointing } from '../pointing.ts'

/**
 * `focus_step`: the tool's validation and its answer, and what the page is
 * handed. Read-only: the journey's file is the same after as before.
 */

const project = mkdtempSync(join(tmpdir(), 'journeys-pointing-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))

const file = join(project, KEHIKOT_DIR, moduleFolder(ID), 'journeys.json')
mkdirSync(join(project, KEHIKOT_DIR, moduleFolder(ID)), { recursive: true })
const text = `${JSON.stringify({
  version: 1,
  journeys: {
    walk: {
      slug: 'walk',
      title: 'A walk',
      steps: [
        { title: 'First', body: '', refs: ['#1'], notes: [], part: 'first' },
        { title: 'Second', body: '', refs: ['#2'], notes: [], part: 'second' },
        { title: 'Third', body: '', refs: [], notes: [] },
      ],
    },
    away: { slug: 'away', title: 'Away', steps: [], stepsFrom: { projector: 'paper', where: 'chapters/wire.tex', why: '' } },
  },
})}\n`
writeFileSync(file, text)

const query = (s = '') => new URLSearchParams(s)
const call = (name: string, args: Record<string, unknown>) =>
  (
    answer('POST', '/mcp', query(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)?.body as {
      result: { content: { text: string }[] }
    }
  ).result.content[0]?.text ?? ''
const focus = (args: Record<string, unknown>) => call('focus_step', { project, slug: 'walk', ...args })
/** What a stream on the epic is told first: the pointer as it stands. */
const pointing = (slug = 'walk'): Record<string, unknown> | null => {
  let said: { pointing: Pointing | null } | null = null
  const off = listen(pointerKey(project, slug), (event) => (said ??= event))
  off()
  return (said as { pointing: Pointing | null } | null)!.pointing as Record<string, unknown> | null
}

describe('focus_step', () => {
  test('is listed, read-only, and needs a project and a journey', () => {
    const tools = (answer('POST', '/mcp', query(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)?.body as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean }; inputSchema: { required: string[] } }[] }
    }).result.tools
    const one = tools.find((tool) => tool.name === 'focus_step')!
    expect(one.annotations.readOnlyHint).toBe(true)
    expect(one.inputSchema.required).toEqual(['project', 'slug'])
  })

  test('points the page at a step by its id, and says nobody may see it while no page has asked', () => {
    const said = focus({ step: 'second', say: 'Here is where the depth cap lives.' })
    expect(said).toContain('Pointing at step 2 of walk, “Second” (second).')
    expect(said).toContain('No Journeys page is connected for this epic')
    expect(pointing()).toMatchObject({ step: 2, title: 'Second', say: 'Here is where the depth cap lives.' })
  })

  test('says a page is open while a stream is connected for the epic, and no longer once it closes', () => {
    const key = pointerKey(project, 'walk')
    expect(watched(key)).toBe(false)
    const off = listen(key, () => {})
    expect(watched(key)).toBe(true)
    expect(focus({ position: 3 })).toContain('A Journeys page is open on this epic')
    expect(pointing()).toMatchObject({ step: 3, title: 'Third' })
    off()
    expect(watched(key)).toBe(false)
    expect(focus({ position: 3 })).toContain('No Journeys page is connected')
  })

  test('the open count is per project and journey, and counts each stream', () => {
    const key = pointerKey(project, 'walk')
    const one = listen(key, () => {})
    const two = listen(key, () => {})
    const away = listen(pointerKey(project, 'away'), () => {})
    expect(listening(key)).toBe(2)
    one()
    expect(listening(key)).toBe(1)
    expect(watched(key)).toBe(true)
    two()
    expect(listening(key)).toBe(0)
    expect(listening(pointerKey(project, 'away'))).toBe(1)
    away()
    one()
    expect(listening(key)).toBe(0)
  })

  test('each call is a new pointer, even in the same millisecond', () => {
    focus({ step: 'first' })
    const one = pointing()!.at
    focus({ step: 'first' })
    expect(pointing()!.at).not.toBe(one)
  })

  test('the line is text of at most one line, and is clipped', () => {
    focus({ step: 'first', say: `a\n\n  b ${'x'.repeat(1000)}` })
    const say = pointing()!.say as string
    expect(say.startsWith('a b x')).toBe(true)
    expect(say.length).toBeLessThanOrEqual(300)
  })

  test('naming no step stops pointing', () => {
    focus({ step: 'first' })
    expect(pointing()).not.toBeNull()
    expect(focus({})).toContain('Stopped pointing')
    expect(pointing()).toBeNull()
  })

  test('an unknown step is refused by name, listing the steps, and the pointer is left as it was', () => {
    focus({ step: 'first' })
    const said = focus({ step: 'nowhere' })
    expect(said).toContain('"nowhere" names no step of this journey')
    expect(said).toContain('1 first, 2 second')
    expect(pointing()).toMatchObject({ step: 1 })
    expect(focus({ position: 9 })).toContain('has 3 steps, so there is no position 9')
    expect(focus({ position: 0 })).toContain('no position 0')
  })

  test('an unknown journey, a bad slug and a missing project are refused', () => {
    expect(call('focus_step', { project, slug: 'nope', step: 'first' })).toContain('no journey "nope"')
    expect(call('focus_step', { project, slug: 'nope' })).toContain('no journey "nope"')
    expect(call('focus_step', { project, slug: '../x', step: 'first' })).toContain('not a journey name')
    expect(call('focus_step', { slug: 'walk', step: 'first' })).toContain('which project?')
  })

  test('a journey whose steps are kept elsewhere has none to point at', () => {
    expect(call('focus_step', { project, slug: 'away', step: 'x' })).toContain('kept in chapters/wire.tex')
  })

  test('the pointers of two journeys, and two projects, are apart', () => {
    focus({ step: 'first' })
    expect(pointing('away')).toBeNull()
    const other = mkdtempSync(join(tmpdir(), 'journeys-pointing-other-'))
    try {
      const events: unknown[] = []
      const off = listen(pointerKey(other, 'walk'), (event) => void events.push(event))
      off()
      expect(events).toEqual([{ pointing: null }])
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test('changes nothing in the journey', () => {
    focus({ step: 'second', say: 'x' })
    focus({})
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
})

describe('the stream door', () => {
  const was = ASK.options
  afterEach(() => {
    ASK.options = was
  })
  const vouch = (path: string) => {
    ASK.options = {
      env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' },
      fetch: (async () => new Response(JSON.stringify({ ok: true, project: true, path, id: 'proj-1234abcd' }), { status: 200 })) as never,
    }
  }
  const open = (slug = 'walk', at = project) => {
    const events: { event: unknown; name?: string }[] = []
    const live = stream('GET', '/api/pointing/events', query(`project=${encodeURIComponent(at)}&slug=${slug}`), (event, name) => void events.push({ event, name }))
    return { live, events }
  }
  const settled = () => new Promise((done) => setTimeout(done, 10))

  test('is not a stream door for anything else', () => {
    expect(stream('GET', '/api/journeys', query(), () => {})).toBeNull()
    expect(stream('POST', '/api/pointing/events', query(), () => {})).toBeNull()
  })

  test('the first event is the pointer as it stands, then one per change', async () => {
    vouch(project)
    focus({ step: 'first' })
    const { live, events } = open()
    await settled()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'pointing', event: { pointing: { step: 1 } } })
    focus({ step: 'second', say: 'now' })
    focus({})
    expect(events.map((one) => one.name)).toEqual(['pointing', 'pointing', 'pointing'])
    expect(events[1]!.event).toMatchObject({ pointing: { step: 2, say: 'now' } })
    expect(events[2]!.event).toEqual({ pointing: null })
    ;(live as { close: () => void }).close()
  })

  test('the first event with nothing pointed is a null pointer', async () => {
    vouch(project)
    focus({})
    const { live, events } = open()
    await settled()
    expect(events[0]!.event).toEqual({ pointing: null })
    ;(live as { close: () => void }).close()
  })

  test('a connected stream is a page open, and closing it drops the count', async () => {
    vouch(project)
    const key = pointerKey(project, 'walk')
    const before = listening(key)
    const { live } = open()
    await settled()
    expect(listening(key)).toBe(before + 1)
    expect(focus({ step: 'first' })).toContain('A Journeys page is open on this epic')
    ;(live as { close: () => void }).close()
    expect(listening(key)).toBe(before)
  })

  test('closing before the host has answered listens to nothing', async () => {
    vouch(project)
    const key = pointerKey(project, 'walk')
    const before = listening(key)
    const { live, events } = open()
    ;(live as { close: () => void }).close()
    await settled()
    expect(listening(key)).toBe(before)
    expect(events).toEqual([])
  })

  test('a project the host does not vouch for gets one refused event and no stream', async () => {
    ASK.options = {
      env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' },
      fetch: (async () => new Response(JSON.stringify({ ok: true, project: false }), { status: 200 })) as never,
    }
    const { live, events } = open()
    await settled()
    expect(events).toHaveLength(1)
    expect(events[0]!.name).toBe('refused')
    expect(listening(pointerKey(project, 'walk'))).toBe(0)
    ;(live as { close: () => void }).close()
  })

  test('a bad slug or no project is refused outright', () => {
    expect(stream('GET', '/api/pointing/events', query(`project=${encodeURIComponent(project)}&slug=../x`), () => {})).toHaveProperty('reply')
    expect(stream('GET', '/api/pointing/events', query('slug=walk'), () => {})).toHaveProperty('reply')
  })

  test('the pointers of two journeys are told apart on their streams', async () => {
    vouch(project)
    const walk = open('walk')
    const away = open('away')
    await settled()
    focus({ step: 'first' })
    expect(walk.events.at(-1)!.event).toMatchObject({ pointing: { step: 1 } })
    expect(away.events).toHaveLength(1)
    ;(walk.live as { close: () => void }).close()
    ;(away.live as { close: () => void }).close()
  })
})

describe('the pointer’s streams are a protocol topic', () => {
  test('every stream on the epic is told, in the same named event as before, and leaving is counted', async () => {
    const { watching } = await import('kehikot-module-protocol/serve')
    const key = pointerKey(project, 'topic-case')
    const a: { event: unknown; name?: string }[] = []
    const b: { event: unknown; name?: string }[] = []
    const offA = listen(key, (event, name) => void a.push({ event, name }))
    const offB = listen(key, (event, name) => void b.push({ event, name }))
    expect(watching(`pointing:${key}`)).toBe(2)
    expect(listening(key)).toBe(2)
    const sent = point(key, { step: 1, title: 'First', say: '' })
    for (const heard of [a, b]) {
      expect(heard[0]).toEqual({ event: { pointing: null }, name: 'pointing' })
      expect(heard[1]).toEqual({ event: { pointing: sent }, name: 'pointing' })
    }
    offA()
    expect(listening(key)).toBe(1)
    offB()
    expect(watched(key)).toBe(false)
    point(key, null)
  })
})
