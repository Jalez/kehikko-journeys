import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { answerAt as answer } from '../doors.ts'
import { ID } from '../manifest.ts'

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

const step = (title: string, part: string, ref: string, more: Record<string, unknown> = {}) => ({
  title,
  body: `About ${title}.`,
  refs: [ref],
  notes: [`a note on ${title}`],
  part,
  ...more,
})

const flat = {
  slug: 'road',
  title: 'Road',
  phases: [
    { id: 'concepting', title: 'Concepting' },
    { id: 'finishing-up', title: 'Finishing up' },
  ],
  gates: [{ id: 'legal', kind: 'decision', title: 'Legal decides' }],
  steps: [
    step('People can sign in', 'sign-in', '#1', { roles: { '#1': 'prior-art' } }),
    step('People can see their rows', 'rows', '#2'),
    step('People can export rows', 'export', '#3'),
    step('Somebody can audit it', 'gone', '#4'),
  ],
}

const LISTED = ['sign-in', 'rows', 'export', 'access', 'audit'].map((id) => ({ id, name: id }))

/** A project with the flat journey, and the host's own file for the epic listing `parts` unless it is null. */
function project(parts: { id: string; name: string }[] | null = LISTED) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-patch-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, moduleFolder(ID))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { road: flat } }, null, 2)}\n`)
  if (parts) {
    const epics = join(root, KEHIKOT_DIR, 'host', 'epics')
    mkdirSync(epics, { recursive: true })
    writeFileSync(join(epics, 'road.json'), `${JSON.stringify({ slug: 'road', title: 'Road', parts }, null, 2)}\n`)
  }
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'road', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const raw = () => readFileSync(file, 'utf8')
  const steps = () => (JSON.parse(raw()) as { journeys: { road: { steps: Record<string, unknown>[] } } }).journeys.road.steps
  return { call, raw, steps }
}

describe('patch_step changes only what it is given', () => {
  test('`under` and `phase` on a step keep its title, body, refs, notes, roles and part', () => {
    const at = project()
    const said = at.call('patch_step', { step: 'rows', under: 'sign-in', phase: 'concepting' })
    expect(said).toContain('Patched step 2 of road (rows): `under` and `phase`')
    expect(at.steps()[1]).toEqual({ ...flat.steps[1]!, under: 'sign-in', phase: 'concepting' })
    expect(at.steps()[0]).toEqual(flat.steps[0]!)
  })

  test('title, notes, issue, gates and roles each change alone', () => {
    const at = project()
    at.call('patch_step', { step: 'sign-in', title: 'Anyone can sign in' })
    at.call('patch_step', { step: 'sign-in', notes: ['only this'] })
    at.call('patch_step', { step: 'sign-in', issue: 'gh#41' })
    at.call('patch_step', { step: 'sign-in', blockedBy: ['legal'] })
    expect(at.steps()[0]).toEqual({
      ...flat.steps[0]!,
      title: 'Anyone can sign in',
      notes: ['only this'],
      issue: 'gh#41',
      refs: ['gh#41', '#1'],
      blockedBy: ['legal'],
    })
    at.call('patch_step', { step: 'sign-in', roles: { 'gh#41': 'related' } })
    expect(at.steps()[0]!.roles).toEqual({ 'gh#41': 'related' })
  })

  test('"" clears a string field, [] a list and {} the roles; a step keeps its title', () => {
    const at = project()
    at.call('patch_step', { step: 'rows', under: 'sign-in', phase: 'concepting', issue: '#9', blockedBy: ['legal'] })
    at.call('patch_step', { step: 'rows', body: '', under: '', phase: '', issue: '', refs: [], notes: [], blockedBy: [] })
    expect(at.steps()[1]).toEqual({ title: 'People can see their rows', body: '', refs: [], notes: [], part: 'rows' })
    at.call('patch_step', { step: 'sign-in', roles: {} })
    expect(Object.hasOwn(at.steps()[0]!, 'roles')).toBe(false)
    const before = at.raw()
    expect(at.call('patch_step', { step: 'rows', title: '' })).toContain('a step has to say what becomes true')
    expect(at.raw()).toBe(before)
  })

  test('`part` files a step whose part the host no longer lists under one it does', () => {
    const at = project()
    expect(at.call('patch_step', { step: 'gone', part: 'audit' })).toContain('Patched step 4')
    expect(at.steps()[3]).toEqual({ ...flat.steps[3]!, part: 'audit' })
    const before = at.raw()
    expect(at.call('patch_step', { step: 'audit', part: 'nowhere' })).toContain('is not a part of this epic')
    expect(at.call('patch_step', { step: 'audit', part: 'export' })).toContain('already has its step')
    expect(at.call('patch_step', { step: 'rows', part: 'access' })).toContain('does not move to another part')
    expect(at.call('patch_step', { step: 'rows', part: '' })).toContain('is not cleared')
    expect(at.raw()).toBe(before)
  })
})

describe('patch_step refuses what set_step refuses, and writes nothing', () => {
  test('an unknown phase, an `under` that is no step or loops, an unknown gate or step, a list that is not one', () => {
    const at = project()
    at.call('patch_step', { step: 'rows', under: 'sign-in' })
    const before = at.raw()
    const refused = [
      [{ step: 'rows', phase: 'nowhere' }, 'is not a phase of this journey'],
      [{ step: 'rows', under: 'nowhere' }, 'is not the id of another step'],
      [{ step: 'rows', under: 'rows' }, 'is not the id of another step'],
      [{ step: 'sign-in', under: 'rows' }, 'its own prerequisite'],
      [{ step: 'rows', blockedBy: ['nowhere'] }, 'is not the id of a gate'],
      [{ step: 'nowhere', phase: 'concepting' }, 'names no step of this journey'],
      [{ step: 'rows' }, 'Nothing to change on rows'],
      [{ phase: 'concepting' }, 'Which step?'],
      [{ step: 'rows', refs: '#1, #2' }, '`refs` is a list of strings'],
      [{ step: 'rows', roles: ['#1'] }, '`roles` is an object'],
    ] as const
    for (const [args, why] of refused) {
      const said = at.call('patch_step', args)
      expect(said).toContain(why)
      expect(said).not.toContain('Patched')
    }
    expect(at.raw()).toBe(before)
  })

  test('where this app keeps the parts, `part` is refused rather than ignored', () => {
    const at = project(null)
    const id = /2\t(\S+)/.exec(at.call('get_journey'))?.[1] ?? ''
    const before = at.raw()
    expect(at.call('patch_step', { step: id, part: 'export', phase: 'concepting' })).toContain('`part` is not taken here')
    expect(at.raw()).toBe(before)
    expect(at.call('patch_step', { step: id, phase: 'concepting' })).toContain('Patched step 2')
  })
})

describe('patch_steps: one write, all or nothing', () => {
  test('a flat journey becomes a tree in one call, each patch on what the one before left', () => {
    const at = project()
    const said = at.call('patch_steps', {
      steps: [
        { step: 'sign-in', phase: 'concepting' },
        { step: 'rows', under: 'sign-in' },
        { step: 'export', under: 'rows', phase: 'finishing-up' },
        { step: 'export', body: 'Rows leave as CSV.' },
      ],
    })
    expect(said).toContain('Patched 4 steps of road in one write')
    expect(said).toContain('3\texport\t`under` and `phase`')
    const steps = at.steps()
    expect(steps.map((one) => [one.under, one.phase])).toEqual([[undefined, 'concepting'], ['sign-in', undefined], ['rows', 'finishing-up'], [undefined, undefined]])
    expect(steps[2]).toEqual({ ...flat.steps[2]!, body: 'Rows leave as CSV.', under: 'rows', phase: 'finishing-up' })
  })

  test('one refused patch and nothing is written; the answer names it', () => {
    const at = project()
    const before = at.raw()
    const said = at.call('patch_steps', { steps: [{ step: 'rows', under: 'sign-in' }, { step: 'export', phase: 'nowhere' }] })
    expect(said).toContain('Patch 2 (export):')
    expect(said).toContain('Nothing was written.')
    expect(at.raw()).toBe(before)
    expect(at.call('patch_steps', { steps: [{ step: 'rows', under: 'sign-in' }, { phase: 'concepting' }] })).toContain('Patch 2: Which step?')
    expect(at.call('patch_steps', { steps: '[{"step":"rows"}]' })).toContain('`steps` is a list')
    expect(at.call('patch_steps', { steps: [] })).toContain('No steps to patch')
    expect(at.raw()).toBe(before)
  })

  test('the loop check is on the result: an objective and its step can swap places in one call', () => {
    const at = project()
    at.call('patch_step', { step: 'rows', under: 'sign-in' })
    const before = at.raw()
    expect(at.call('patch_steps', { steps: [{ step: 'sign-in', under: 'rows' }] })).toContain('its own prerequisite')
    expect(at.raw()).toBe(before)
    expect(at.call('patch_steps', { steps: [{ step: 'sign-in', under: 'rows' }, { step: 'rows', under: '' }] })).toContain('Patched 2 steps')
    expect(at.steps().slice(0, 2).map((one) => one.under)).toEqual(['rows', undefined])
  })
})
