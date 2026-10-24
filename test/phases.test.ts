import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { answerAt as answer } from '../doors.ts'
import { ID } from '../manifest.ts'
import { phaseOfEach } from '../src/phases.ts'

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'journeys-phases-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { road: { slug: 'road', title: 'Road', steps: [] } } }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'road', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const journey = () => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: { road: Record<string, unknown> & { steps: Record<string, unknown>[] } } }).journeys.road
  const raw = () => readFileSync(file, 'utf8')
  return { call, journey, raw }
}

const FIVE = [{ title: 'Concepting' }, { title: 'Creating framework' }, { title: 'Creating UI elements' }, { title: 'Creating data' }, { title: 'Finishing up' }]

describe('phases on a journey', () => {
  test('set_journey makes ids from titles, in order, and [] clears them', () => {
    const at = project()
    expect(at.call('set_journey', { phases: FIVE })).toContain('`phases`')
    expect(at.journey().phases).toEqual([
      { id: 'concepting', title: 'Concepting' },
      { id: 'creating-framework', title: 'Creating framework' },
      { id: 'creating-ui-elements', title: 'Creating UI elements' },
      { id: 'creating-data', title: 'Creating data' },
      { id: 'finishing-up', title: 'Finishing up' },
    ])
    at.call('set_journey', { phases: [] })
    expect(Object.hasOwn(at.journey(), 'phases')).toBe(false)
  })

  test('ids stay stable: a title kept keeps its id, a given id renames, a reorder moves nothing else', () => {
    const at = project()
    at.call('set_journey', { phases: [{ title: 'Concepting' }, { title: 'Finishing up' }] })
    at.call('set_journey', { phases: [{ title: 'Finishing up' }, { title: 'Concepting' }, { title: 'Concepting' }] })
    expect(at.journey().phases).toEqual([
      { id: 'finishing-up', title: 'Finishing up' },
      { id: 'concepting', title: 'Concepting' },
      { id: 'concepting-2', title: 'Concepting' },
    ])
    at.call('set_journey', { phases: [{ id: 'concepting', title: 'Thinking it through' }, { id: 'finishing-up', title: 'Done' }] })
    expect(at.journey().phases).toEqual([
      { id: 'concepting', title: 'Thinking it through' },
      { id: 'finishing-up', title: 'Done' },
    ])
  })

  test('a list that is not one, a phase with no title, a bad or doubled id are refused with nothing written', () => {
    const at = project()
    at.call('set_journey', { phases: FIVE })
    const before = at.raw()
    expect(at.call('set_journey', { phases: 'Concepting' })).toContain('is a list of { title, id? }')
    expect(at.call('set_journey', { phases: [{ id: 'x' }] })).toContain('says what it is called')
    expect(at.call('set_journey', { phases: [{ id: 'Not An Id', title: 'A' }] })).toContain('is not a phase id')
    expect(at.call('set_journey', { phases: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] })).toContain('more than once')
    expect(at.raw()).toBe(before)
  })
})

describe('a step in a phase', () => {
  test('set_step writes `phase`, keeps it on a rewrite, and "" clears it', () => {
    const at = project()
    at.call('set_journey', { phases: FIVE })
    at.call('set_step', { title: 'The shape is agreed', name: 'shape', phase: 'concepting' })
    expect(at.journey().steps[0]).toMatchObject({ part: 'shape', phase: 'concepting' })
    at.call('set_step', { step: 'shape', title: 'The shape is agreed, again' })
    expect(at.journey().steps[0]!.phase).toBe('concepting')
    at.call('set_step', { step: 'shape', title: 'The shape is agreed', phase: '' })
    expect(Object.hasOwn(at.journey().steps[0]!, 'phase')).toBe(false)
  })

  test('an unknown phase id is refused, naming the journey’s phases', () => {
    const at = project()
    expect(at.call('set_step', { title: 'A', name: 'a', phase: 'concepting' })).toContain('which has none')
    at.call('set_journey', { phases: [{ title: 'Concepting' }, { title: 'Finishing up' }] })
    const said = at.call('set_step', { title: 'A', name: 'a', phase: 'Concepting' })
    expect(said).toContain('“Concepting” is not a phase of this journey')
    expect(said).toContain('concepting “Concepting”, finishing-up “Finishing up”')
    expect(said).toContain('The step was not written.')
    expect(at.journey().steps).toEqual([])
  })

  test('removing a phase a step is in is refused, naming the step; once it is moved, it goes', () => {
    const at = project()
    at.call('set_journey', { phases: [{ title: 'Concepting' }, { title: 'Finishing up' }] })
    at.call('set_step', { title: 'Ship', name: 'ship', phase: 'finishing-up' })
    const before = at.raw()
    const said = at.call('set_journey', { phases: [{ title: 'Concepting' }] })
    expect(said).toContain('would remove finishing-up “Finishing up”, which step 1 (ship) is in')
    expect(said).toContain('Nothing was written.')
    expect(at.raw()).toBe(before)
    expect(at.call('set_journey', { phases: [] })).toContain('Nothing was written.')
    at.call('set_step', { step: 'ship', title: 'Ship', phase: 'concepting' })
    at.call('set_journey', { phases: [{ title: 'Concepting' }] })
    expect(at.journey().phases).toEqual([{ id: 'concepting', title: 'Concepting' }])
  })

  test('get_journey prints each phase with its steps; a leaf with none of its own reads its objective’s, and the JSON keeps it as written', () => {
    const at = project()
    at.call('set_journey', { phases: [{ title: 'Concepting' }, { title: 'Creating UI elements' }, { title: 'Finishing up' }] })
    at.call('set_step', { title: 'The UI is built', name: 'ui', phase: 'creating-ui-elements' })
    at.call('set_step', { title: 'A button', name: 'button', under: 'ui' })
    at.call('set_step', { title: 'A sketch', name: 'sketch', under: 'ui', phase: 'concepting' })
    at.call('set_step', { title: 'Loose end', name: 'loose' })
    const said = at.call('get_journey')
    expect(said).toContain('PHASES:')
    expect(said).toContain('a step is put in one with `phase` on `set_step`')
    expect(said).toContain('in the phase of the nearest step above it')
    expect(said).toContain('1\tconcepting\t“Concepting”: 3 sketch')
    expect(said).toContain('2\tcreating-ui-elements\t“Creating UI elements”: 1 ui, 2 button (its objective’s)')
    expect(said).toContain('3\tfinishing-up\t“Finishing up”: no step yet')
    expect(said).toContain('—\tin no phase: 4 loose')
    const json = JSON.parse(said.slice(said.indexOf('{'))) as { steps: Record<string, unknown>[] }
    expect(Object.hasOwn(json.steps[1]!, 'phase')).toBe(false)
  })

  test('a journey with no phases prints no PHASES block', () => {
    const at = project()
    at.call('set_step', { title: 'A', name: 'a' })
    expect(at.call('get_journey')).not.toContain('PHASES:')
  })
})

describe('reading a step’s phase', () => {
  test('its own, else the nearest objective above it that has one, else none', () => {
    const steps = [
      { title: 'top', part: 'top', phase: 'p1' },
      { title: 'mid', part: 'mid', under: 'top' },
      { title: 'leaf', part: 'leaf', under: 'mid' },
      { title: 'own', part: 'own', under: 'mid', phase: 'p2' },
      { title: 'alone', part: 'alone' },
    ]
    expect(phaseOfEach(steps)).toEqual([
      { phase: 'p1', inherited: false },
      { phase: 'p1', inherited: true },
      { phase: 'p1', inherited: true },
      { phase: 'p2', inherited: false },
      { phase: null, inherited: false },
    ])
  })
})
