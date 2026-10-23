import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { KEHIKOT_DIR, methodParams, moduleFolder } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { answerAt as answer } from '../doors.ts'
import { ID } from '../manifest.ts'
import { MANIFEST } from '../manifest.ts'
import { App } from '../src/app.tsx'
import { gateDone, gatesOf, isGateId, refGates, stepRefGates, type Gate } from '../src/gates.ts'
import type { JourneyView } from '../src/kinds.ts'
import { nextOf } from '../src/live/status.ts'
import { alsoSaid, sharedRefs } from '../src/shared.ts'
import { nextStep } from '../src/tree.ts'
import { AlsoIn, GatesList, RefGates, StepGates } from '../src/view/gates.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'
import { JOURNEY, settle, started, store, stubHost } from './host.ts'
import { reading, row } from './reading.ts'

/**
 * Gates on refs, and refs shared between journeys (Jalez/kehikko-journeys#38).
 */

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
})

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

const LEGAL: Gate = { id: 'legal', kind: 'decision', title: 'Legal decides on GPL hosting', owner: 'legal', state: 'open' }
const STEPS = [
  { title: 'Host the binaries', part: 'host', refs: ['#3620'] },
  { title: 'Write the docs', part: 'docs', refs: ['#2'] },
]
const none = () => false

describe('a gate that holds a ref', () => {
  test('is found through the journey’s blockedBy, and an id no gate has is dropped', () => {
    const blockedBy = { '#3620': ['legal', 'ghost'] }
    expect(refGates(blockedBy, [LEGAL], '#3620').map((g) => g.id)).toEqual(['legal'])
    expect(refGates(blockedBy, [LEGAL], '#2')).toEqual([])
    expect(isGateId('legal')).toBe(true)
    expect(isGateId('#3620')).toBe(false)
  })

  test('only a ref that delivers the step holds it', () => {
    const blockedBy = { '#3620': ['legal'], '#9': ['legal'] }
    expect(stepRefGates({ refs: ['#3620'] }, blockedBy)).toEqual(['legal'])
    expect(stepRefGates({ refs: ['#9'], roles: { '#9': 'related' } }, blockedBy)).toEqual([])
  })

  test('the step it delivers is not next while the gate is open, and is once it is done', () => {
    const blockedBy = { '#3620': ['legal'] }
    const steps = STEPS.map((step, i) => ({ ...step, issue: i === 0 ? '#3620' : '#2' }))
    const next = nextStep(steps, none, [LEGAL], blockedBy)
    expect(next.node?.id).toBe('docs')
    expect(next.gated.map((one) => [one.node.id, one.gates.map((g) => g.id)])).toEqual([['host', ['legal']]])
    expect(nextStep(steps, none, [{ ...LEGAL, state: 'done' }], blockedBy).node?.id).toBe('host')
    /* Without the blocker entry nothing holds it: a journey without the field reads as it did. */
    expect(nextStep(steps, none, [LEGAL], {}).node?.id).toBe('host')
    expect(nextStep(steps, none, [LEGAL]).node?.id).toBe('host')
  })

  test('a gate on a ref of an objective holds the steps under it', () => {
    const steps = [
      { title: 'Ship', part: 'ship', refs: ['#7'] },
      { title: 'Leaf', part: 'leaf', under: 'ship', issue: '#3' },
      { title: 'Other', part: 'other', issue: '#4' },
    ]
    expect(nextStep(steps, none, [LEGAL], { '#7': ['legal'] }).node?.id).toBe('other')
  })

  test('the page: nextOf passes a held step by, and the step names the gate and the ref', () => {
    const view = {
      slug: 'r', title: 'R', lede: '', callout: '', plan: 'stored',
      blockedBy: { '#3620': ['legal'] },
      gates: [LEGAL],
      steps: STEPS.map((s) => ({ ...s, body: '', notes: [] })),
    } as unknown as JourneyView
    expect(nextOf(view, null)?.node?.id).toBe('docs')
    expect(nextOf({ ...view, blockedBy: {} }, null)?.node?.id).toBe('host')
    const shown = render(
      <ReadingProvider value={{ live: reading([row('#3620', { state: 'open' })]), journey: view }}>
        <StepGates step={view.steps[0]!} />
        <RefGates refName="#3620" />
        <GatesList />
      </ReadingProvider>,
    )
    expect(shown.container.querySelector('[data-step-gates]')?.textContent).toContain('Legal decides on GPL hosting')
    expect(shown.container.querySelector('[data-step-gates] [data-gate-via]')?.textContent).toContain('#3620')
    expect(shown.container.querySelector('[data-ref-gates]')?.textContent).toContain('Legal decides')
    expect(shown.container.querySelector('[data-gates]')?.textContent).toContain('holds #3620')
  })
})

describe('refs shared between journeys', () => {
  const MINE = { slug: 'mcp-binaries', title: 'MCP binaries' }
  const OTHER = {
    slug: 'servers-start',
    title: 'Servers start before they ship',
    steps: [
      { title: 'Servers boot', part: 'boot', refs: ['#2493', '#8'] },
      { title: 'Ship them', part: 'ship', refs: ['#2493'] },
    ],
    gates: [{ id: 'g', kind: 'work', title: 'Wait for !44', state: 'open', waitsOn: ['!44'] }],
  }
  const THIRD = { slug: 'kept-elsewhere', title: 'Elsewhere', plan: 'elsewhere', steps: [], blockedBy: { '#9': ['#2493'] } }

  test('are found by exact spelling across the other journeys, never the journey itself', () => {
    const found = sharedRefs('mcp-binaries', ['#2493', 'gh#2493', '!44', '#1'], [MINE, OTHER, THIRD])
    expect(Object.keys(found).sort()).toEqual(['!44', '#2493'])
    expect(found['#2493']!.map((one) => [one.epic, one.in, one.stepTitle ?? ''])).toEqual([
      ['servers-start', 'step', 'Servers boot'],
      ['servers-start', 'step', 'Ship them'],
      ['kept-elsewhere', 'blocker', ''],
    ])
    expect(found['!44']![0]).toMatchObject({ epic: 'servers-start', in: 'gate', gate: 'g' })
    expect(sharedRefs('servers-start', ['#2493'], [MINE, OTHER, THIRD])).toEqual({ '#2493': [expect.objectContaining({ epic: 'kept-elsewhere', in: 'blocker' })] })
    expect(alsoSaid(found['#2493']![0]!)).toBe('servers-start (Servers boot)')
  })

  test('the card says "also in", read-only, and the link opens that journey', async () => {
    const view = { ...JOURNEY, alsoIn: { 'gh#1': [{ epic: 'servers-start', title: 'S', in: 'step', position: 1, id: 'boot', stepTitle: 'Servers boot' }] } }
    const shown = render(
      <ReadingProvider value={{ live: null, journey: view as unknown as JourneyView }}>
        <AlsoIn refName="gh#1" />
        <AlsoIn refName="gh#2" />
      </ReadingProvider>,
    )
    expect(shown.container.querySelectorAll('[data-also-in]')).toHaveLength(1)
    expect(shown.container.querySelector('[data-also-in]')?.textContent).toBe('also inservers-start (Servers boot)')
  })
})

describe('the link, framed', () => {
  let projects = 0
  beforeAll(async () => {
    await started()
  })

  test('asks the host to go to that epic with view.goto, in the protocol’s shape', async () => {
    store.journey = {
      ...JOURNEY,
      alsoIn: { 'gh#1': [{ epic: 'servers-start', title: 'S', in: 'step', position: 1, id: 'boot', stepTitle: 'Servers boot' }] },
    } as typeof JOURNEY
    const host = stubHost()
    projects += 1
    host.greet([], { projectPath: `/Users/somebody/Projects/goto-${projects}` })
    await settle()
    const shown = render(<App />)
    await settle()
    const link = shown.container.querySelector('[data-also-in="gh#1"] button') as HTMLButtonElement
    expect(link.textContent).toBe('servers-start (Servers boot)')
    fireEvent.click(link)
    await settle()
    const sent = host.asked('view.goto').at(-1)?.params
    expect(sent).toEqual({ epic: 'servers-start' })
    expect(() => methodParams['view.goto'].parse(sent)).not.toThrow()
    store.journey = JOURNEY
  })

  test('the manifest declares view:navigate', () => {
    expect(MANIFEST.declares.uses).toContain('view:navigate')
  })
})

describe('ref-elsewhere', () => {
  const ELSEWHERE: Gate = { id: 'e', kind: 'ref-elsewhere', title: 'Other epic ships it', ref: '!44', epic: 'servers-start', state: 'open' }

  test('is done when its ref is closed in the other epic, and holds a ref until then', () => {
    expect(gateDone(ELSEWHERE, () => false)).toBe(false)
    expect(gateDone(ELSEWHERE, (ref) => ref === '!44')).toBe(true)
    const steps = [{ title: 'Twelve', part: 'twelve', refs: ['#12'], issue: '#12' }, { title: 'Other', part: 'other', refs: ['#13'], issue: '#13' }]
    const blockedBy = { '#12': ['e'] }
    expect(nextStep(steps, none, [ELSEWHERE], blockedBy).node?.id).toBe('other')
    expect(nextStep(steps, (ref) => ref === '!44', [ELSEWHERE], blockedBy).node?.id).toBe('twelve')
  })
})

/* ---------------------------------------------------------------- */

function project(journeys: Record<string, Record<string, unknown>>) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-refgates-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const disk = (slug: string) => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, Record<string, unknown>> }).journeys[slug]!
  const api = (slug: string) => answer('GET', '/api/journey', new URLSearchParams({ slug, project: root }), null, null)?.body as { journey: JourneyView & { alsoIn?: Record<string, unknown[]> } }
  return { root, call, disk, api }
}

const base = (slug: string, more: Record<string, unknown> = {}) => ({ slug, title: slug, lede: '', callout: '', steps: [], ...more })

describe('through the MCP door', () => {
  test('set_gate blocks a mix of steps and refs; get_journey and next_step read it', () => {
    const at = project({ gated: base('gated') })
    at.call('set_step', { slug: 'gated', title: 'Host', name: 'host', issue: '#3620' })
    at.call('set_step', { slug: 'gated', title: 'Docs', name: 'docs', issue: '#2' })
    const said = at.call('set_gate', { slug: 'gated', kind: 'decision', title: 'Legal decides', owner: 'legal', blocks: ['docs', '#3620', '#12'], waitsOn: ['!44'] })
    expect(said).toContain('Added gate legal-decides')
    expect(said).toContain('“Docs”')
    expect(said).toContain('#3620')
    const disk = at.disk('gated')
    expect(disk.blockedBy).toEqual({ '#3620': ['legal-decides'], '#12': ['legal-decides'] })
    expect((disk.gates as Gate[])[0]!.waitsOn).toEqual(['!44'])
    const got = at.call('get_journey', { slug: 'gated' })
    expect(got).toContain('holds docs, #3620, #12')
    expect(got).toContain('waits on !44')

    /* Host is held through its delivering ref, Docs through its own gate: nothing is free. */
    const next = at.call('next_step', { slug: 'gated', closed: [] })
    expect(next).toContain('Held by open gates')
    expect(next).toContain('“Host”')
    expect(next).toContain('waits on decision legal-decides')

    expect(at.call('set_gate', { slug: 'gated', gate: 'legal-decides', state: 'done', by: 'Mia' })).toContain('done by Mia')
    expect(at.call('next_step', { slug: 'gated', closed: [] })).toContain('step 1, “Host”')

    /* The whole list: leaving a ref out takes the gate off it. */
    at.call('set_gate', { slug: 'gated', gate: 'legal-decides', blocks: ['#12'] })
    expect(at.disk('gated').blockedBy).toEqual({ '#12': ['legal-decides'] })
    expect(((at.disk('gated').steps as Record<string, unknown>[])[1] as { blockedBy?: string[] }).blockedBy).toBeUndefined()
    at.call('set_gate', { slug: 'gated', gate: 'legal-decides', blocks: [] })
    expect(at.disk('gated').blockedBy).toEqual({})
  })

  test('refusals write nothing, and removing a gate takes it off its refs', () => {
    const at = project({ gated: base('gated') })
    expect(at.call('set_gate', { slug: 'gated', kind: 'work', title: 'x', blocks: ['nope'] })).toContain('not the id of a step or a tracker ref')
    expect(at.call('set_gate', { slug: 'gated', kind: 'work', title: 'x', waitsOn: ['not a ref'] })).toContain('not a tracker ref')
    expect(at.disk('gated').gates).toBeUndefined()
    at.call('set_gate', { slug: 'gated', kind: 'work', title: 'Write it', blocks: ['#5'] })
    expect(at.disk('gated').blockedBy).toEqual({ '#5': ['write-it'] })
    expect(at.call('remove_gate', { slug: 'gated', gate: 'write-it' })).toContain('#5')
    expect(at.disk('gated').blockedBy).toEqual({})
    expect(at.disk('gated').gates).toBeUndefined()
  })

  test('shared refs are computed across the project’s journeys, and read-only on get_journey and /api/journey', () => {
    const at = project({
      mine: base('mine', { steps: [{ title: 'Twelve', body: '', refs: ['#12', '#2493'], notes: [], part: 'twelve' }] }),
      theirs: base('theirs', { title: 'Theirs', steps: [{ title: 'Boot', body: '', refs: ['#2493'], notes: [], part: 'boot' }] }),
    })
    const got = at.call('get_journey', { slug: 'mine' })
    expect(got).toContain('ALSO IN')
    expect(got).toContain('#2493\talso in theirs (Boot)')
    expect(got).not.toContain('#12\talso in')
    const alsoIn = at.api('mine').journey.alsoIn!
    expect(Object.keys(alsoIn)).toEqual(['#2493'])
    expect(alsoIn['#2493']).toEqual([expect.objectContaining({ epic: 'theirs', stepTitle: 'Boot', in: 'step' })])
    /* Never stored. */
    expect(at.disk('mine')).not.toHaveProperty('alsoIn')
    /* A journey nobody shares reads as before. */
    const alone = project({ solo: base('solo', { steps: [{ title: 'A', body: '', refs: ['#1'], notes: [], part: 'a' }] }) })
    expect(alone.api('solo').journey).not.toHaveProperty('alsoIn')
    expect(alone.call('get_journey', { slug: 'solo' })).not.toContain('ALSO IN')
  })

  test('an existing journey with no gates on refs is unchanged', () => {
    const old = base('old', { blockedBy: { '#1': ['#2'] }, steps: [{ title: 'A', body: '', refs: ['#1'], notes: [], part: 'a' }] })
    const at = project({ old })
    expect(gatesOf(at.disk('old'))).toEqual([])
    expect(at.call('next_step', { slug: 'old', closed: [] })).toContain('step 1')
    expect(at.disk('old').blockedBy).toEqual({ '#1': ['#2'] })
  })
})
