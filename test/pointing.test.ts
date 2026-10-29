import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { answerAt as answer } from '../doors.ts'
import { ID } from '../manifest.ts'
import { WATCHING_MS, pointerKey, pointingFor, watched } from '../pointing.ts'

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
const pointing = (slug = 'walk') => (answer('GET', '/api/pointing', query(`project=${encodeURIComponent(project)}&slug=${slug}`), null, null)?.body as { pointing: Record<string, unknown> | null }).pointing

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
    expect(said).toContain('No Journeys page has asked about this epic')
    expect(pointing()).toMatchObject({ step: 2, title: 'Second', say: 'Here is where the depth cap lives.' })
  })

  test('says a page is open once one has asked', () => {
    expect(watched(pointerKey(project, 'walk'))).toBe(true)
    expect(focus({ position: 3 })).toContain('A Journeys page is open on this epic')
    expect(pointing()).toMatchObject({ step: 3, title: 'Third' })
  })

  test('a page that has stopped asking is no longer open', () => {
    const key = pointerKey(project, 'away')
    expect(watched(key)).toBe(false)
    pointingFor(key)
    expect(watched(key)).toBe(true)
    const real = Date.now
    Date.now = () => real() + WATCHING_MS + 1
    try {
      expect(watched(key)).toBe(false)
    } finally {
      Date.now = real
    }
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
      expect((answer('GET', '/api/pointing', query(`project=${encodeURIComponent(other)}&slug=walk`), null, null)?.body as { pointing: unknown }).pointing).toBeNull()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test('changes nothing in the journey', () => {
    focus({ step: 'second', say: 'x' })
    focus({})
    expect(readFileSync(file, 'utf8')).toBe(text)
  })

  test('/api/pointing refuses what is not a journey name', () => {
    const reply = answer('GET', '/api/pointing', query(`project=${encodeURIComponent(project)}&slug=../x`), null, null)
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
  })
})
