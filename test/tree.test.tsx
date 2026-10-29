import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { KEHIKOT_DIR, moduleFolder, skillPath, skillTextIssue } from 'kehikot-module-protocol'

import { MANIFEST, answerAt as answer, servingAt } from '../doors.ts'
import { factoryStages, jobsIn, newest } from '../factory.ts'
import { ID } from '../manifest.ts'
import { skillDeclarations, skillTemplate, skillText } from '../skills.ts'
import type { JourneyView, Step } from '../src/kinds.ts'
import { nextOf, statusOf } from '../src/live/status.ts'
import { cycleIn, doneOf, nextStep, treeOf } from '../src/tree.ts'
import { ReadingProvider } from '../src/view/reading.tsx'
import { StepPlace } from '../src/view/step.tsx'
import { reading, row } from './reading.ts'

/**
 * A journey as a tree: what `/journey` designs, what Journeys keeps of it (`under`, `after`,
 * `issue` on a step), what comes next, and where each step stands — its board column and the
 * Factory's stage. And the skill itself, as a host is served it.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

/* goal ← ship (objective) ← [schema, api ← ui]; docs after ship */
const STEPS: Step[] = [
  { title: 'People can share a board', part: 'ship', refs: [] },
  { title: 'The schema holds shares', part: 'schema', under: 'ship', issue: 'gh#1', refs: ['gh#1'] },
  { title: 'The API answers shares', part: 'api', under: 'ship', after: ['schema'], issue: 'gh#2', refs: ['gh#2'] },
  { title: 'A share button', part: 'ui', under: 'ship', after: ['api'], issue: 'gh#3', refs: ['gh#3'] },
  { title: 'The docs say how', part: 'docs', after: ['ship'], refs: ['gh#4'] },
].map((one) => ({ body: '', notes: [], ...one }))

const closed = (...refs: string[]) => (issue: string) => refs.includes(issue)

describe('the tree', () => {
  test('objectives, leaves, prerequisites and issues are read off the steps', () => {
    const nodes = treeOf(STEPS)
    expect(nodes.map((one) => one.id)).toEqual(['ship', 'schema', 'api', 'ui', 'docs'])
    expect(nodes[0]).toMatchObject({ leaf: false, children: ['schema', 'api', 'ui'], under: null, issue: null })
    expect(nodes[2]).toMatchObject({ leaf: true, under: 'ship', after: ['schema'], issue: 'gh#2' })
    /* No `issue`: the first tracked ref stands for it. */
    expect(nodes[4]!.issue).toBe('gh#4')
  })

  test('an id that names no step is dropped, not kept pointing at nothing', () => {
    const nodes = treeOf([{ title: 'a', part: 'a', under: 'gone', after: ['also-gone', 'a'] }])
    expect(nodes[0]).toMatchObject({ under: null, after: [] })
  })

  test('a plain list is a list: every step a leaf under the goal', () => {
    const nodes = treeOf([{ title: 'a', part: 'a' }, { title: 'b', part: 'b' }])
    expect(nodes.every((one) => one.leaf && one.under === null && !one.after.length)).toBe(true)
  })

  test('an objective is done when every step under it is', () => {
    expect(doneOf(STEPS, closed('gh#1', 'gh#2')).get('ship')).toBe(false)
    expect(doneOf(STEPS, closed('gh#1', 'gh#2', 'gh#3')).get('ship')).toBe(true)
  })
})

describe('what comes next', () => {
  test('the first leaf not done whose prerequisites are all done', () => {
    expect(nextStep(STEPS, closed()).node?.id).toBe('schema')
    expect(nextStep(STEPS, closed('gh#1')).node?.id).toBe('api')
    expect(nextStep(STEPS, closed('gh#1', 'gh#2')).node?.id).toBe('ui')
  })

  test('a step after an objective waits for every step under it', () => {
    /* docs is after ship; gh#4 is open, ui is not done: ui comes first. */
    expect(nextStep(STEPS, closed('gh#1', 'gh#2')).node?.id).toBe('ui')
    expect(nextStep(STEPS, closed('gh#1', 'gh#2', 'gh#3')).node?.id).toBe('docs')
  })

  test('an `after` on an objective holds the steps under it', () => {
    const steps = [
      { title: 'first', part: 'first', issue: 'gh#9' },
      { title: 'later', part: 'later', after: ['first'] },
      { title: 'under later', part: 'leaf', under: 'later', issue: 'gh#10' },
    ]
    expect(nextStep(steps, closed()).node?.id).toBe('first')
    expect(nextStep(steps, closed('gh#9')).node?.id).toBe('leaf')
  })

  test('everything done, and nothing to do, are said', () => {
    expect(nextStep(STEPS, closed('gh#1', 'gh#2', 'gh#3', 'gh#4')).why).toBe('Every step of this journey is done.')
    expect(nextStep([], closed()).why).toBe('This journey has no steps yet.')
  })

  test('a cycle is refused, not chosen from', () => {
    const steps = [
      { title: 'a', part: 'a', after: ['b'] },
      { title: 'b', part: 'b', after: ['a'] },
    ]
    expect(cycleIn(steps)).toEqual(['a', 'b', 'a'])
    const next = nextStep(steps, closed())
    expect(next.node).toBeNull()
    expect(next.why).toContain('its own prerequisite')
  })

  test('a step after its own objective is a cycle', () => {
    expect(cycleIn([{ title: 'o', part: 'o' }, { title: 'l', part: 'l', under: 'o', after: ['o'] }])).not.toBeNull()
  })
})

/* ---------------------------------------------------------------- */

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'journeys-tree-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { tree: { slug: 'tree', title: 'Tree', steps: [] } } }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'tree', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const steps = () =>
    (JSON.parse(readFileSync(file, 'utf8')) as { journeys: { tree: { steps: Record<string, unknown>[] } } }).journeys.tree.steps
  const journey = () => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: { tree: Record<string, unknown> } }).journeys.tree
  return { call, steps, journey }
}

describe('a tree written through the MCP door', () => {
  test('set_step files steps under an objective and records their issue; set_dependency orders them', () => {
    const at = project()
    at.call('set_step', { title: 'Ship it', name: 'ship' })
    at.call('set_step', { title: 'Schema', name: 'schema', under: 'ship', issue: 'gh#1' })
    at.call('set_step', { title: 'API', name: 'api', under: 'ship', issue: 'gh#2' })
    expect(at.call('set_dependency', { step: 'api', after: ['schema'] })).toBe('“API” now waits on “Schema”.')
    const steps = at.steps()
    expect(steps[1]).toMatchObject({ part: 'schema', under: 'ship', issue: 'gh#1', refs: ['gh#1'] })
    expect(steps[2]).toMatchObject({ part: 'api', under: 'ship', after: ['schema'] })
    /* Rewritten without `under` or `issue`: they stay. "" clears. */
    at.call('set_step', { step: 'api', title: 'The API', refs: ['gh#2'] })
    expect(at.steps()[2]).toMatchObject({ under: 'ship', issue: 'gh#2', after: ['schema'] })
    at.call('set_step', { step: 'api', title: 'The API', refs: ['gh#2'], under: '' })
    expect(at.steps()[2]!.under).toBeUndefined()
  })

  test('an edge that closes a circle is refused, with nothing written', () => {
    const at = project()
    at.call('set_step', { title: 'A', name: 'a' })
    at.call('set_step', { title: 'B', name: 'b' })
    at.call('set_dependency', { step: 'b', after: ['a'] })
    const before = JSON.stringify(at.steps())
    expect(at.call('set_dependency', { step: 'a', after: ['b'] })).toContain('its own prerequisite')
    expect(at.call('set_step', { step: 'b', title: 'B', under: 'b' })).toContain('not the id of another step')
    expect(at.call('set_dependency', { step: 'a', after: ['nope'] })).toContain('not the id of a step')
    expect(JSON.stringify(at.steps())).toBe(before)
  })

  test('next_step names the first free leaf, by the refs the caller says are closed', () => {
    const at = project()
    at.call('set_step', { title: 'Schema', name: 'schema', issue: 'gh#1' })
    at.call('set_step', { title: 'API', name: 'api', issue: 'gh#2' })
    at.call('set_dependency', { step: 'api', after: ['schema'] })
    expect(at.call('next_step')).toContain('“Schema”')
    expect(at.call('next_step')).toContain('No `closed` refs were passed')
    const said = at.call('next_step', { closed: ['gh#1'] })
    expect(said).toContain('step 2, “API” (id api)')
    expect(said).toContain('Its issue is gh#2')
    expect(said).toContain('It waited on “Schema”, all done.')
  })

  test('set_journey keeps the design: goal, measure, appetite, rabbit holes and no-gos', () => {
    const at = project()
    const said = at.call('set_journey', { goal: 'People share a board', measure: 'Two people edit one board', appetite: 'two weeks', rabbitHoles: ['realtime sync'], noGos: ['public links'] })
    expect(said).toContain('`goal`')
    expect(at.journey()).toMatchObject({ goal: 'People share a board', appetite: 'two weeks', noGos: ['public links'] })
  })
})

/* ---------------------------------------------------------------- */

const VIEW = { slug: 'tree', title: 'Tree', lede: '', callout: '', steps: STEPS, plan: 'stored', blockedBy: {} } satisfies JourneyView

describe('where a step stands', () => {
  test('its board column, when the host’s reading has one', () => {
    const live = reading([row('gh#1', { state: 'open', column: { name: 'In review', board: 'Roadmap' } })])
    const status = statusOf(live, treeOf(STEPS)[1]!)
    expect(status).toMatchObject({ issue: 'gh#1', column: { name: 'In review', board: 'Roadmap' }, done: false })
  })

  test('open or closed, as today, when it is on no board', () => {
    const live = reading([row('gh#1', { state: 'closed' })])
    expect(statusOf(live, treeOf(STEPS)[1]!)).toMatchObject({ column: null, state: 'closed', done: true })
  })

  test('the Factory’s stage, when it has a job for the issue, and nothing when it has none', () => {
    const job = { id: 'j1', ref: 'gh#2', stage: 'reviewing' }
    expect(statusOf(null, treeOf(STEPS)[2]!, { 'gh#2': job }).stage).toBe('reviewing')
    expect(statusOf(null, treeOf(STEPS)[1]!, { 'gh#2': job }).stage).toBeNull()
  })

  test('drawn as text with a shape: Next, the column, the stage', () => {
    const live = reading([
      row('gh#1', { state: 'closed', column: { name: 'Done', board: 'Roadmap' } }),
      row('gh#2', { state: 'open', column: { name: 'In progress', board: 'Roadmap' } }),
    ])
    const factory = { 'gh#2': { id: 'j', ref: 'gh#2', stage: 'building' } }
    expect(nextOf(VIEW, live)?.node?.id).toBe('api')
    const shown = render(
      <ReadingProvider value={{ live, journey: VIEW, factory }}>
        <StepPlace index={2} />
      </ReadingProvider>,
    )
    const text = shown.container.textContent ?? ''
    expect(text).toContain('Next')
    expect(text).toContain('gh#2 · In progress')
    expect(text).toContain('Factory: building')
    expect(text).toContain('after “The schema holds shares”')
    expect(shown.container.querySelector('[data-next]')).not.toBeNull()
  })

  test('no Factory: no stage drawn', () => {
    const shown = render(
      <ReadingProvider value={{ live: reading([]), journey: VIEW }}>
        <StepPlace index={1} />
      </ReadingProvider>,
    )
    expect(shown.container.textContent).not.toContain('Factory')
  })
})

describe('the Factory, read from its registered origin', () => {
  test('its jobs, in any of the shapes it may answer with', () => {
    const job = { id: 'a', title: 't', ref: 'gh#2', stage: 'building', column: 'In progress', place: {}, updatedAt: '2026-10-20T10:00:00Z' }
    expect(jobsIn([job], 'gh#2')).toHaveLength(1)
    expect(jobsIn({ jobs: [job] }, 'gh#2')[0]).toMatchObject({ stage: 'building', column: 'In progress' })
    expect(jobsIn(job, 'gh#2')).toHaveLength(1)
    expect(jobsIn({ jobs: [{ ...job, ref: 'gh#9' }] }, 'gh#2')).toHaveLength(0)
    expect(newest([{ ...job, id: 'old', updatedAt: '2026-01-01' }, job].map((one) => jobsIn(one, 'gh#2')[0]!))?.id).toBe('a')
  })

  test('no Factory registered is no Factory, and one that fails is no job', async () => {
    expect(await factoryStages('/p', ['gh#2'], { origin: () => null, fetch: async () => null })).toEqual({ factory: false, jobs: {} })
    const asked: string[] = []
    const out = await factoryStages('/p', ['gh#2', 'gh#3'], {
      origin: () => 'http://127.0.0.1:8040',
      fetch: async (url) => {
        asked.push(url)
        if (url.includes('gh%233')) throw new Error('down')
        return { jobs: [{ id: 'j', ref: 'gh#2', stage: 'judging' }] }
      },
    })
    expect(out).toEqual({ factory: true, jobs: { 'gh#2': { id: 'j', ref: 'gh#2', stage: 'judging', title: undefined, column: undefined, updatedAt: undefined } } })
    expect(asked[0]).toBe('http://127.0.0.1:8040/api/jobs?ref=gh%232&projectPath=%2Fp')
  })
})

/* ---------------------------------------------------------------- */

describe('the /journey skill', () => {
  test('is declared in the manifest and served at its path, filled in for the origin', () => {
    servingAt('http://127.0.0.1:7841')
    const declared = MANIFEST.declares?.skills ?? []
    expect(declared.map((one) => one.name)).toEqual(['journey'])
    const reply = answer('GET', skillPath('journey'), new URLSearchParams(), null, null) as { status: number; raw: { bytes: string; type: string } }
    expect(reply.status).toBe(200)
    expect(reply.raw.type).toContain('text/markdown')
    expect(reply.raw.bytes).toContain('http://127.0.0.1:7841/mcp')
    expect(reply.raw.bytes).not.toContain('{{')
    expect(reply.raw.bytes).toContain(`[skill ${declared[0]!.version}]`)
    expect(declared[0]!.version).toBe(skillDeclarations('http://127.0.0.1:7841')[0]!.version)
  })

  test('passes the protocol’s reading of a skill’s text', () => {
    expect(skillTextIssue(skillText('journey', 'http://127.0.0.1:7840'), 'journey')).toBeNull()
  })

  test('it tells the agent to keep the page on the step being discussed, with focus_step', () => {
    const text = skillTemplate('journey')!
    expect(text).toContain('`focus_step`')
    expect(text).toContain('with no `step` to stop pointing')
  })

  test('only a person runs it, and it is pre-approved for reads only', () => {
    const text = skillTemplate('journey')!
    const front = text.split('\n---\n')[0]!
    expect(front).toContain('disable-model-invocation: true')
    const allowed = /allowed-tools: (.*)/.exec(front)![1]!.split(',').map((one) => one.trim())
    expect(allowed.every((one) => /(my_place|read_canvas|read_tracker|list_journeys|get_journey|next_step|focus_step)$/.test(one))).toBe(true)
  })

  test('asks one clear question at a time, with why and a recommended answer', () => {
    const text = skillTemplate('journey')!
    expect(text).toContain('One question per message')
    expect(text).toContain('**Why it matters:**')
    expect(text).toContain('**Recommended:**')
    expect(text).toContain('Never ask what the code or tracker can answer')
  })

  test('a moved port changes the version', () => {
    expect(skillDeclarations('http://127.0.0.1:7840')[0]!.version).not.toBe(skillDeclarations('http://127.0.0.1:7841')[0]!.version)
  })
})
