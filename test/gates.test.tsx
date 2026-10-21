import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { TICKET, answerAt as answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import { held, journeyIn } from '../store.ts'
import { delivering, gateDone, gateFromText, gated, gatesOf, roleOf, type Gate } from '../src/gates.ts'
import type { JourneyView, Step } from '../src/kinds.ts'
import { nextOf } from '../src/live/status.ts'
import { issueOf, nextStep } from '../src/tree.ts'
import { GatesList } from '../src/view/gates.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'
import { StepBlock } from '../src/view/step.tsx'
import { reading, row } from './reading.ts'

/**
 * Gates (Jalez/kehikko-journeys#34): what stands in a journey's way that is not a step — work with
 * no issue, a decision, access somebody outside must grant, a ref another epic owns — held as typed
 * entries a step is `blockedBy`, so an honest journey does not read as unblocked.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

/* The shapes `mcp-binaries` had: keys that are step titles, values that mix an issue, a decision
   written as a sentence that mentions an issue, work with no issue and a person-dependent gate. */
const SCANNER = 'Scanner copies binaries to the NAS (Host)'
const OLD = {
  slug: 'mcp-binaries',
  title: 'MCP binaries',
  steps: [
    { title: 'Binaries are declared', part: 'declare', body: '', refs: ['#2493'], notes: [] },
    { title: SCANNER, part: 'host', body: '', refs: ['#3620'], notes: [] },
    { title: 'Downloads work behind a proxy', part: 'download', body: '', refs: [], notes: ['proxy and certificate store'] },
  ],
  groups: [
    { id: 'declare', heading: 'Declare', refs: [] },
    { id: 'host', heading: 'Host', refs: [] },
    { id: 'download', heading: 'Download', refs: [] },
  ],
  blockedBy: {
    [SCANNER]: [
      '#3620',
      'Legal decision on hosting GPL binaries (#2961)',
      'innovium.json binaries field (Declare)',
      'NAS access for the dashboard hosts, arranged by an infrastructure person',
      'Binaries are declared',
    ],
    'Open questions': ['Which certificate store wins on Windows'],
    '#2686': ['!3251', 'a sentence somebody wrote'],
  } as Record<string, string[]>,
}

describe('an older blockedBy, read as gates', () => {
  test('values are parsed: a bare ref is an issue, "decision"/"legal" a decision, anything else work', () => {
    expect(gateFromText('#123')).toEqual({ kind: 'issue', title: '#123', ref: '#123' })
    expect(gateFromText('!45')).toEqual({ kind: 'issue', title: '!45', ref: '!45' })
    expect(gateFromText('gh#7')).toEqual({ kind: 'issue', title: 'gh#7', ref: 'gh#7' })
    expect(gateFromText('Legal decision on hosting GPL binaries (#2961)')).toEqual({
      kind: 'decision',
      title: 'Legal decision on hosting GPL binaries (#2961)',
      ref: '#2961',
    })
    expect(gateFromText('Decide the retention period')).toMatchObject({ kind: 'decision' })
    expect(gateFromText('innovium.json binaries field (Declare)')).toEqual({ kind: 'work', title: 'innovium.json binaries field (Declare)' })
  })

  test('a key that is a step title maps to that step; a value that is another step is an order', () => {
    const { record, changed } = gated(structuredClone(OLD))
    expect(changed).toBe(true)
    const gates = gatesOf(record)
    expect(gates.map((gate) => [gate.kind, gate.title])).toEqual([
      ['issue', '#3620'],
      ['decision', 'Legal decision on hosting GPL binaries (#2961)'],
      ['work', 'innovium.json binaries field (Declare)'],
      ['work', 'NAS access for the dashboard hosts, arranged by an infrastructure person'],
      ['work', 'Which certificate store wins on Windows'],
    ])
    const scanner = record.steps[1] as Step
    expect(scanner.blockedBy).toEqual(gates.slice(0, 4).map((gate) => gate.id))
    expect(scanner.after).toEqual(['declare'])
    /* A key that names no step is a heading: its gate holds nothing, and keeps the heading. */
    expect(gates[4]!.note).toBe('Listed under “Open questions”.')
    expect(record.steps.every((step) => !(step as Step).blockedBy?.includes(gates[4]!.id))).toBe(true)
    /* A ref key stays exactly as it was. */
    expect(record.blockedBy).toEqual({ '#2686': ['!3251', 'a sentence somebody wrote'] })
    /* Every gate starts open. */
    expect(gates.every((gate) => gate.state === 'open')).toBe(true)
  })

  test('never loses text: every key and value is a gate, a step order, a note or still in blockedBy', () => {
    const { record } = gated(structuredClone(OLD))
    const said = JSON.stringify(record)
    for (const [key, values] of Object.entries(OLD.blockedBy)) {
      for (const value of values) expect(said).toContain(JSON.stringify(value).slice(1, -1))
      expect(said).toContain(key)
    }
  })

  test('is idempotent, and an entry an older writer puts back reuses its gates', () => {
    const once = gated(structuredClone(OLD)).record
    const twice = gated(once)
    expect(twice.changed).toBe(false)
    expect(twice.record).toBe(once)
    const again = gated({ ...once, blockedBy: { ...once.blockedBy, [SCANNER]: ['#3620', 'innovium.json binaries field (Declare)'] } }).record
    expect(gatesOf(again)).toHaveLength(gatesOf(once).length)
    expect((again.steps[1] as Step).blockedBy).toEqual((once.steps[1] as Step).blockedBy)
  })

  test('a journey with nothing to read is handed back untouched', () => {
    const plain = { steps: [{ title: 'a', refs: ['#1'] }], blockedBy: { '#1': ['#2'] } }
    expect(gated(plain)).toEqual({ record: plain, changed: false })
  })
})

describe('what comes next, with gates', () => {
  const STEPS = [
    { title: 'Host the binaries', part: 'host', issue: '#1', blockedBy: ['legal'] },
    { title: 'Write the docs', part: 'docs', issue: '#2' },
  ]
  const LEGAL: Gate = { id: 'legal', kind: 'decision', title: 'Legal decides on GPL hosting', owner: 'legal', state: 'open' }
  const none = () => false

  test('a step an open decision gate holds is not next, and the gate is named', () => {
    const next = nextStep(STEPS, none, [LEGAL])
    expect(next.node?.id).toBe('docs')
    expect(next.gated).toHaveLength(1)
    expect(next.gated[0]!.node.id).toBe('host')
    expect(next.gated[0]!.gates.map((gate) => gate.id)).toEqual(['legal'])
  })

  test('marked done, it holds nothing', () => {
    expect(nextStep(STEPS, none, [{ ...LEGAL, state: 'done', doneBy: 'legal', doneAt: '2026-10-21T10:00:00.000Z' }]).node?.id).toBe('host')
  })

  test('an issue gate is done when its ref is; a decision that mentions an issue is not', () => {
    const issue: Gate = { id: 'i', kind: 'issue', title: '#9', ref: '#9', state: 'open' }
    expect(gateDone(issue, (ref) => ref === '#9')).toBe(true)
    expect(gateDone({ ...LEGAL, ref: '#9' }, (ref) => ref === '#9')).toBe(false)
  })

  test('a gate on an objective holds every step under it', () => {
    const steps = [
      { title: 'Ship', part: 'ship', blockedBy: ['legal'] },
      { title: 'Leaf', part: 'leaf', under: 'ship', issue: '#3' },
      { title: 'Other', part: 'other', issue: '#4' },
    ]
    expect(nextStep(steps, none, [LEGAL]).node?.id).toBe('other')
  })

  test('nothing free but for gates is said so', () => {
    const next = nextStep([STEPS[0]!], none, [LEGAL])
    expect(next.node).toBeNull()
    expect(next.why).toContain('a gate that is still open')
  })

  test('an id no gate has holds nothing', () => {
    expect(nextStep(STEPS, none, []).node?.id).toBe('host')
  })
})

describe('the roles of a step’s refs', () => {
  const step = { title: 's', refs: ['#1850', '!1443', '#3620'], roles: { '#1850': 'prior-art', '!1443': 'related' } }

  test('a ref with no role delivers the step; only delivering refs say which issue is its own', () => {
    expect(roleOf(step, '#1850')).toBe('prior-art')
    expect(roleOf(step, '#3620')).toBe('delivers')
    expect(roleOf({ roles: { '#1': 'nonsense' } }, '#1')).toBe('delivers')
    expect(delivering(step)).toEqual(['#3620'])
    expect(issueOf(step)).toBe('#3620')
  })

  test('closed prior art does not make a step done', () => {
    const view = { slug: 'r', title: 'R', lede: '', callout: '', plan: 'stored', blockedBy: {}, steps: [{ ...step, body: '', notes: [] }] } as unknown as JourneyView
    const live = reading([row('#1850', { state: 'closed' }), row('#3620', { state: 'open' })])
    const shown = render(
      <ReadingProvider value={{ live, journey: view }}>
        <StepBlock step={view.steps[0]!} index={0} editing={false} selection={[]} framed={false} />
      </ReadingProvider>,
    )
    const text = shown.container.textContent ?? ''
    expect(text).not.toMatch(/\bdone\b/)
    const other = shown.container.querySelector('[data-other-refs]')
    expect(other?.textContent).toContain('prior art')
    expect(other?.textContent).toContain('#1850')
    expect(other?.textContent).toContain('related')
    /* Prior art is not drawn as a card the step stands on. */
    expect(shown.container.querySelector('[data-card="#1850"]')).toBeNull()
    expect(shown.container.querySelector('[data-card="#3620"]')).not.toBeNull()
  })
})

/* ---------------------------------------------------------------- */

function project(journey: Record<string, unknown> = { slug: 'gated', title: 'Gated', steps: [] }) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-gates-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  const slug = journey.slug as string
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { [slug]: journey } }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug, ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const disk = () => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, Record<string, unknown>> }).journeys[slug]!
  const post = (path: string, body: Record<string, unknown>) =>
    answer('POST', path, new URLSearchParams(), { slug, ...body, project: root, ticket: writeTicketFor(root) }, TICKET)
  return { root, call, disk, post }
}

describe('gates through the MCP door', () => {
  test('set_gate adds a gate that holds a step; next_step passes it by until it is marked done', () => {
    const at = project()
    at.call('set_step', { title: 'Host the binaries', name: 'host', issue: '#1' })
    at.call('set_step', { title: 'Write the docs', name: 'docs', issue: '#2' })
    const said = at.call('set_gate', { kind: 'decision', title: 'Legal decides on hosting GPL binaries', owner: 'legal', ref: '#2961', blocks: ['host'] })
    expect(said).toContain('Added gate legal-decides-on-hosting-gpl-binaries')
    expect(said).toContain('It holds “Host the binaries”')
    const id = 'legal-decides-on-hosting-gpl-binaries'
    expect(at.disk().gates).toEqual([{ id, kind: 'decision', title: 'Legal decides on hosting GPL binaries', owner: 'legal', ref: '#2961', state: 'open' }])
    expect((at.disk().steps as Step[])[0]!.blockedBy).toEqual([id])

    const next = at.call('next_step', { closed: [] })
    expect(next).toContain('step 2, “Write the docs”')
    expect(next).toContain('“Host the binaries”, waits on decision legal-decides-on-hosting-gpl-binaries')
    expect(next).toContain('legal to act')

    expect(at.call('set_gate', { gate: id, state: 'done' })).toContain('pass `by`')
    expect(at.call('set_gate', { gate: id, state: 'done', by: 'Mia (legal)' })).toContain('done by Mia (legal)')
    const done = (at.disk().gates as Gate[])[0]!
    expect(done).toMatchObject({ state: 'done', doneBy: 'Mia (legal)' })
    expect(Number.isNaN(Date.parse(done.doneAt!))).toBe(false)
    expect(at.call('next_step', { closed: [] })).toContain('step 1, “Host the binaries”')

    /* Reopened: who and when come off. */
    at.call('set_gate', { gate: id, state: 'open' })
    expect((at.disk().gates as Record<string, unknown>[])[0]).not.toHaveProperty('doneAt')
  })

  test('get_journey lists the gates and what each holds', () => {
    const at = project()
    at.call('set_step', { title: 'Host', name: 'host' })
    at.call('set_gate', { kind: 'access', title: 'NAS access for the dashboard hosts', owner: 'infrastructure', blocks: ['host'] })
    at.call('set_gate', { kind: 'ref-elsewhere', title: 'Servers start before they ship', ref: '#2493', epic: 'servers-start-before-they-ship' })
    const got = at.call('get_journey')
    expect(got).toContain('GATES:')
    expect(got).toContain('access: “NAS access for the dashboard hosts”, infrastructure to act — open\tholds host')
    expect(got).toContain('in another epic: “Servers start before they ship”, #2493 in servers-start-before-they-ship — open\tholds no step')
    expect(got).toContain('"gates": [')
  })

  test('refusals write nothing', () => {
    const at = project()
    at.call('set_step', { title: 'Host', name: 'host' })
    const before = JSON.stringify(at.disk())
    expect(at.call('set_gate', { kind: 'vibes', title: 'x' })).toContain('is not a kind of gate')
    expect(at.call('set_gate', { title: 'no kind' })).toContain('needs a `kind`')
    expect(at.call('set_gate', { kind: 'work' })).toContain('needs a `title`')
    expect(at.call('set_gate', { kind: 'issue', title: 'an issue' })).toContain('pass `ref`')
    expect(at.call('set_gate', { kind: 'ref-elsewhere', title: 'x', ref: '#1' })).toContain('pass `epic`')
    expect(at.call('set_gate', { kind: 'work', title: 'x', blocks: ['nope'] })).toContain('not the id of a step')
    expect(at.call('set_step', { step: 'host', title: 'Host', blockedBy: ['nope'] })).toContain('is not the id of a gate')
    expect(at.call('remove_gate', { gate: 'nope' })).toContain('is not a gate of gated')
    expect(JSON.stringify(at.disk())).toBe(before)
  })

  test('set_step takes gate ids and ref roles, keeps them when left out, and remove_gate takes a gate off every step', () => {
    const at = project()
    at.call('set_step', { title: 'Host', name: 'host', refs: ['#1850', '!1443', '#3620'] })
    at.call('set_gate', { gate: 'manifest-field', kind: 'work', title: 'innovium.json binaries field' })
    at.call('set_step', { step: 'host', title: 'Host', refs: ['#1850', '!1443', '#3620'], blockedBy: ['manifest-field'], roles: { '#1850': 'prior-art', '!1443': 'related', '#3620': 'delivers' } })
    expect((at.disk().steps as Step[])[0]).toMatchObject({ blockedBy: ['manifest-field'], roles: { '#1850': 'prior-art', '!1443': 'related' } })
    /* Rewritten without them: they stay; a ref that left takes its role with it. */
    at.call('set_step', { step: 'host', title: 'Host again', refs: ['#1850', '#3620'] })
    expect((at.disk().steps as Step[])[0]).toMatchObject({ blockedBy: ['manifest-field'], roles: { '#1850': 'prior-art' } })
    expect(at.call('set_step', { step: 'host', title: 'Host', refs: ['#3620'], roles: { '#9': 'related' } })).toContain('is not one of this step’s refs')
    expect(at.call('set_step', { step: 'host', title: 'Host', refs: ['#3620'], roles: { '#3620': 'inspiration' } })).toContain('is not a role')
    expect(at.call('remove_gate', { gate: 'manifest-field' })).toContain('which held “Host again”')
    const after = at.disk()
    expect(after).not.toHaveProperty('gates')
    expect((after.steps as Step[])[0]).not.toHaveProperty('blockedBy')
  })

  test('a file with the older blockedBy is read as gates, and stored so by the next write', () => {
    const at = project(structuredClone(OLD) as unknown as Record<string, unknown>)
    const journey = journeyIn(held(at.root), 'mcp-binaries')!
    expect(gatesOf(journey)).toHaveLength(5)
    /* Reading wrote nothing. */
    expect(at.disk().gates).toBeUndefined()
    expect(at.call('get_journey')).toContain('decision: “Legal decision on hosting GPL binaries (#2961)”')
    /* The legal decision holds step 2, so step 1 is next until it is done. */
    expect(at.call('next_step', { closed: ['#2493'] })).toContain('waits on')
    const legal = gatesOf(journey).find((gate) => gate.kind === 'decision')!
    at.call('set_gate', { gate: legal.id, state: 'done', by: 'legal' })
    const stored = at.disk()
    expect(stored.blockedBy).toEqual({ '#2686': ['!3251', 'a sentence somebody wrote'] })
    expect(stored.gates as Gate[]).toHaveLength(5)
    expect((stored.steps as Step[])[1]!.blockedBy).toHaveLength(4)
  })

  test('the page makes a note chip a gate in one press: off the notes, onto the gates, holding its step', () => {
    const at = project(structuredClone(OLD) as unknown as Record<string, unknown>)
    const reply = at.post('/api/gate/from-note', { step: 'download', note: 'proxy and certificate store' })
    expect(reply?.body).toMatchObject({ ok: true })
    expect(reply?.status).toBe(200)
    const stored = at.disk()
    const step = (stored.steps as Step[])[2]!
    expect(step.notes).toEqual([])
    const gate = (stored.gates as Gate[]).find((one) => one.title === 'proxy and certificate store')!
    expect(gate).toMatchObject({ kind: 'work', state: 'open' })
    expect(step.blockedBy).toEqual([gate.id])
    /* Pressed again, the note is not there to make. */
    expect(at.post('/api/gate/from-note', { step: 'download', note: 'proxy and certificate store' })?.status).toBe(400)
  })

  test('the page marks a gate done, recording where it was pressed', () => {
    const at = project()
    at.call('set_gate', { gate: 'nas', kind: 'access', title: 'NAS access' })
    expect(at.post('/api/gate', { gate: 'nas', state: 'done', by: 'a person, on the Journeys page' })?.status).toBe(200)
    expect((at.disk().gates as Gate[])[0]).toMatchObject({ state: 'done', doneBy: 'a person, on the Journeys page' })
  })
})

/* ---------------------------------------------------------------- */

describe('gates on the page', () => {
  const GATES: Gate[] = [
    { id: 'legal', kind: 'decision', title: 'Legal decides on GPL hosting', owner: 'legal', state: 'open' },
    { id: 'nas', kind: 'access', title: 'NAS access', owner: 'infrastructure', state: 'done', doneBy: 'Sam', doneAt: '2026-10-20T09:00:00.000Z' },
    { id: 'shipped', kind: 'issue', title: '#9', ref: '#9', state: 'open' },
    { id: 'unfiled', kind: 'work', title: 'Failure messages built from observed facts', state: 'open', note: 'Listed under “Open questions”.' },
  ]
  const VIEW = {
    slug: 'mcp-binaries',
    title: 'MCP binaries',
    lede: '',
    callout: '',
    plan: 'stored',
    blockedBy: {},
    gates: GATES,
    steps: [
      { title: 'Host the binaries', part: 'host', body: '', refs: ['#1'], notes: ['proxy support'], blockedBy: ['legal', 'nas', 'shipped'] },
      { title: 'Write the docs', part: 'docs', body: '', refs: ['#2'], notes: [] },
    ],
  } satisfies JourneyView

  test('a step draws the gates that hold it: kind as a word and an icon, who acts, where it stands', () => {
    const live = reading([row('#9', { state: 'closed' }), row('#1', { state: 'open' }), row('#2', { state: 'open' })])
    const shown = render(
      <ReadingProvider value={{ live, journey: VIEW }}>
        <StepBlock step={VIEW.steps[0]!} index={0} editing={false} selection={[]} framed={false} />
      </ReadingProvider>,
    )
    const gates = shown.container.querySelector('[data-step-gates]')!
    expect(gates.textContent).toContain('waits on')
    const legal = gates.querySelector('[data-gate="legal"]')!
    expect(legal.getAttribute('data-gate-state')).toBe('open')
    expect(legal.querySelector('[data-gate-kind="decision"]')?.textContent).toBe('decision')
    expect(legal.querySelector('[data-gate-kind="decision"] svg')).not.toBeNull()
    expect(legal.textContent).toContain('legal to act')
    expect(legal.textContent).toContain('open')
    expect(legal.textContent).toContain('mark done')
    const nas = gates.querySelector('[data-gate="nas"]')!
    expect(nas.textContent).toContain('done by Sam, 2026-10-20')
    expect(nas.textContent).toContain('reopen')
    /* An issue gate the tracker closed says whose word that is, and offers no press. */
    const shipped = gates.querySelector('[data-gate="shipped"]')!
    expect(shipped.textContent).toContain('done, by the tracker')
    expect(shipped.querySelector('button')).toBeNull()
    /* The note chip offers one press. */
    expect(shown.container.querySelector('[data-note="proxy support"]')?.textContent).toContain('make this a gate')
  })

  test('the open gate keeps its step from being next', () => {
    expect(nextOf(VIEW, reading([]))?.node?.id).toBe('docs')
  })

  test('every gate is listed, a gate that holds no step included', () => {
    const shown = render(
      <ReadingProvider value={{ live: reading([]), journey: VIEW }}>
        <GatesList />
      </ReadingProvider>,
    )
    expect(shown.container.querySelectorAll('[data-gate]')).toHaveLength(4)
    const unfiled = shown.container.querySelector('[data-gate="unfiled"]')!
    expect(unfiled.textContent).toContain('holds no step')
    expect(unfiled.textContent).toContain('work')
    expect(unfiled.textContent).toContain('Listed under “Open questions”.')
    expect(shown.container.querySelector('[data-gate="legal"]')?.textContent).toContain('holds step 1')
  })
})
