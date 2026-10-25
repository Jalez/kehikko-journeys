import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, journeyIn, moduleFolder, planOfJourney, plansUnion } from 'kehikot-module-protocol'
import { readJourneys, readPlans, readPlansFor } from 'kehikot-module-protocol/serve'

import { answerAt as answer } from '../doors.ts'
import { ID, MANIFEST } from '../manifest.ts'
import { resetBackfilled } from '../plans.ts'
import { held } from '../store.ts'

/**
 * Journeys publishes every journey's steps as the protocol's plan (2.21.0), in
 * `.kehikot/journeys/steps.json`: the file a host answers `steps.list` from
 * instead of `journeys.json`, once it exists, for every epic.
 */

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})
beforeEach(() => resetBackfilled())

/** A journey with everything a plan carries: phases, a tree, an order, gates held by id and by ref. */
const road = {
  slug: 'road',
  title: 'Road',
  lede: 'Get there',
  goal: 'A person reaches the end',
  measure: 'They say so',
  phases: [{ id: 'shape', title: 'Shaping' }, { id: 'build', title: 'Building' }],
  steps: [
    { title: 'The end', refs: ['gh#1'], part: 'end', phase: 'build' },
    { title: 'Draft it', refs: ['gh#2', 'gh#9'], roles: { 'gh#9': 'prior-art' }, part: 'draft', under: 'end', phase: 'shape', issue: 'gh#2' },
    { title: 'Wire it', refs: ['gh#3'], part: 'wire', under: 'end', after: ['draft'], blockedBy: ['legal'] },
  ],
  gates: [
    { id: 'legal', kind: 'decision', title: 'Legal signs off', owner: 'Legal', state: 'open' },
    { id: 'infra', kind: 'access', title: 'Infra grants a key', state: 'done' },
  ],
  blockedBy: { 'gh#3': ['infra'] },
  /* The list of parts as this module keeps it for a host from before 1.2.0: one to a step. */
  groups: [
    { id: 'end', heading: 'The end', refs: [] },
    { id: 'draft', heading: 'Draft it', refs: [] },
    { id: 'wire', heading: 'Wire it', refs: [] },
  ],
}
const other = { slug: 'other', title: 'Other', steps: [{ title: 'Only step', refs: ['gh#7'], part: 'only' }], groups: [{ id: 'only', heading: 'Only step', refs: [] }] }
const paper = { slug: 'paper', title: 'Paper', steps: [], stepsFrom: { projector: 'paper', where: 'paper/main.tex', why: 'sections' } }

function project(journeys: Record<string, unknown>[] = [road, other, paper]) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-plans-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'journeys.json'), `${JSON.stringify({ version: 1, journeys: Object.fromEntries(journeys.map((one) => [(one as { slug: string }).slug, one])) }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown>) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const stepsFile = join(dir, 'steps.json')
  const published = () => JSON.parse(readFileSync(stepsFile, 'utf8')) as { version: number; module: string; epics: Record<string, unknown> }
  return { root, dir, call, stepsFile, published }
}

describe('the manifest', () => {
  test('says Journeys provides steps (protocol 2.21.0)', () => {
    expect(MANIFEST.declares.provides).toEqual(['steps'])
  })
})

describe('steps.json, after a write', () => {
  test('a write publishes the journey as the plan a host would have read from journeys.json', () => {
    const at = project([road])
    const before = planOfJourney(journeyIn(readJourneys(at.root), 'road'))
    at.call('set_journey', { slug: 'road', lede: 'Get there, really' })
    const file = at.published()
    expect(file.module).toBe(ID)
    expect(file.version).toBe(1)
    /* The same steps a host showed from the fallback the moment before the file appeared. */
    expect(readPlansFor(at.root, 'road')[0]?.plan).toEqual(before!)
    const plan = readPlansFor(at.root, 'road')[0]!.plan
    expect(plan.goal).toBe('A person reaches the end')
    expect(plan.phases.map((one) => one.id)).toEqual(['shape', 'build'])
    expect(plan.steps.map((one) => [one.id, one.under ?? null, one.after, one.phase ?? null])).toEqual([
      ['end', null, [], 'build'],
      ['draft', 'end', [], 'shape'],
      ['wire', 'end', ['draft'], null],
    ])
    const draft = plan.steps[1]!
    expect(draft.refs).toEqual(['gh#2'])
    expect(draft.related).toEqual(['gh#9'])
    expect(draft.issue).toBe('gh#2')
    const wire = plan.steps[2]!
    expect(wire.gates.map((one) => [one.id, one.kind, one.done])).toEqual([['legal', 'decision', false], ['infra', 'access', true]])
    expect(wire.gates[0]!.owner).toBe('Legal')
  })

  test('the write publishes every other journey too, so no epic goes missing once the file exists', () => {
    const at = project()
    at.call('set_journey', { slug: 'other', lede: 'Changed' })
    expect(Object.keys(at.published().epics).sort()).toEqual(['other', 'road'])
    const union = plansUnion(readPlansFor(at.root, 'road').map(({ module, plan }) => ({ module: module!, plan })))
    expect(union.providers).toEqual([{ module: ID, goal: 'A person reaches the end', measure: 'They say so' }])
    expect(union.steps.every((one) => one.module === ID)).toBe(true)
  })

  test('a journey whose steps are kept elsewhere is not published: an empty plan would say it has none', () => {
    const at = project()
    at.call('set_journey', { slug: 'road', lede: 'Changed' })
    expect(Object.hasOwn(at.published().epics, 'paper')).toBe(false)
  })

  test('a step written through the door is in the plan at once', () => {
    const at = project([other])
    at.call('set_step', { slug: 'other', title: 'A second step', refs: ['gh#8'], name: 'Second' })
    const plan = readPlansFor(at.root, 'other')[0]!.plan
    expect(plan.steps.map((one) => one.title)).toEqual(['Only step', 'A second step'])
    expect(plan.steps[1]!.refs).toEqual(['gh#8'])
  })
})

describe('the backfill, on the first read', () => {
  test('the first read of a project publishes every journey that has no plan yet, and nothing else', () => {
    const at = project()
    const journeysBefore = readFileSync(join(at.dir, 'journeys.json'), 'utf8')
    held(at.root)
    expect(Object.keys(at.published().epics).sort()).toEqual(['other', 'road'])
    expect(readFileSync(join(at.dir, 'journeys.json'), 'utf8')).toBe(journeysBefore)
    expect(readPlans(at.root).map((one) => one.module)).toEqual([ID])
  })

  test('once per project in a process: a later read only reads', () => {
    const at = project()
    held(at.root)
    rmSync(at.stepsFile)
    held(at.root)
    expect(existsSync(at.stepsFile)).toBe(false)
  })

  test('an epic already in the file is left as it is', () => {
    const at = project()
    mkdirSync(at.dir, { recursive: true })
    const mine = { version: 1, module: ID, epics: { road: { phases: [], steps: [] } } }
    writeFileSync(at.stepsFile, `${JSON.stringify(mine, null, 2)}\n`)
    held(at.root)
    expect(at.published().epics.road).toEqual({ phases: [], steps: [] })
    expect(Object.hasOwn(at.published().epics, 'other')).toBe(true)
  })

  test('it publishes each record as the file has it, which is what a host read before: an older shape is not re-read first', () => {
    /* No parts on the steps: this module reads it as one step to a part, but a host's fallback did not. */
    const older = { slug: 'older', title: 'Older', steps: [{ title: 'First', refs: ['gh#1'] }, { title: 'Second', refs: ['gh#2'] }] }
    const at = project([older])
    const hostRead = planOfJourney(journeyIn(readJourneys(at.root), 'older'))
    held(at.root)
    expect(readPlansFor(at.root, 'older')[0]!.plan).toEqual(hostRead!)
    expect(readPlansFor(at.root, 'older')[0]!.plan.steps.map((one) => one.id)).toEqual(['step-1', 'step-2'])
  })

  test('a project with no journeys file gets no plan file', () => {
    const root = mkdtempSync(join(tmpdir(), 'journeys-plans-empty-'))
    made.push(root)
    held(root)
    expect(existsSync(join(root, KEHIKOT_DIR))).toBe(false)
  })
})
