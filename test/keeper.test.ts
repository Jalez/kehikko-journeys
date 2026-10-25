import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, journeyIn as recordIn, moduleFolder, partsOf } from 'kehikot-module-protocol'
import { readHoldings, readJourneys } from 'kehikot-module-protocol/serve'

import { TICKET, answerAt as answer, writeTicketFor } from '../doors.ts'
import { JOURNEYS_KEEP, keeperFrom, listedBy } from '../keeper.ts'
import { ID } from '../manifest.ts'
import { BEFORE, holdingsOf, keeperOf } from '../store.ts'

/**
 * Who keeps the list of an epic's parts, and what each of this app's doors
 * does on either side of that.
 *
 * `keeperFrom` is the one decision (`keeper.ts`). The rest of this file is
 * the same project under the two answers: an epic whose own file has no
 * `parts` key — a released host, or a 1.2.0 host before the first edit of the
 * list — and one whose file has it, which is a host that keeps the list.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const MINE = moduleFolder(ID)

const step = (title: string, part?: string, refs: string[] = []) => ({ title, body: `About ${title}.`, refs, notes: [], ...(part ? { part } : {}) })

/** A thesis as the first version of "one step to a part" stored it: every step with its part, and its chapter on the group. */
const thesis = {
  slug: 'thesis',
  title: 'Thesis',
  steps: [
    step('A reader knows why it is worth studying', 'introduction', ['gh#1', 'gh#2']),
    step('A reader can see the gap this study fills', 'literature-review', ['gh#3']),
    step('A reader could repeat the study', 'methods'),
  ],
  groups: [
    { id: 'introduction', heading: 'Introduction', refs: [], files: ['chapters/1_introduction.tex'] },
    { id: 'literature-review', heading: 'Literature Review', refs: [], files: ['chapters/2_literature_review.tex'] },
    { id: 'methods', heading: 'Methods', refs: [], files: ['chapters/3_methods.tex'] },
  ],
}

/** The list as the host's own file keeps it once it has adopted it, with a part added in the picker. */
const LIST = [
  { id: 'introduction', name: 'Introduction' },
  { id: 'literature-review', name: 'Literature Review' },
  { id: 'methods', name: 'Methods' },
  { id: 'appendices', name: 'Appendices' },
]

/**
 * A project with the thesis in it and the host's own file for the epic.
 * `parts` undefined is a file with no such key; a list is a host that keeps it.
 */
function project(parts?: { id: string; name: string }[] | null, journey: Record<string, unknown> = thesis) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-keeper-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, MINE)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { thesis: journey } }, null, 2)}\n`)
  const epics = join(root, KEHIKOT_DIR, 'host', 'epics')
  mkdirSync(epics, { recursive: true })
  const epic = join(epics, 'thesis.json')
  if (parts !== null) writeFileSync(epic, `${JSON.stringify({ slug: 'thesis', title: 'Thesis', ...(parts ? { parts } : {}) }, null, 2)}\n`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'thesis', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const post = (path: string, body: Record<string, unknown> = {}) =>
    answer('POST', path, new URLSearchParams(), { project: root, slug: 'thesis', ticket: writeTicketFor(root), ...body }, TICKET)
  const get = () =>
    (answer('GET', '/api/journey', new URLSearchParams({ project: root, slug: 'thesis' }), null, null)?.body as { journey: Viewed }).journey
  const bytes = () => readFileSync(file, 'utf8')
  const stored = () => (JSON.parse(bytes()) as { journeys: { thesis: { steps: { title: string; part?: string; refs: string[] }[]; groups: unknown[] } } }).journeys.thesis
  const holdings = () => JSON.parse(readFileSync(join(dir, 'parts.json'), 'utf8')) as { epics: Record<string, Record<string, { documents: string[]; refs: string[] }>> }
  /** A host from before 1.2.0: the list read off this app's record, and nothing else. */
  const olderHostSees = () => partsOf(recordIn(readJourneys(root), 'thesis')).map((part) => ({ id: part.id, heading: part.heading, files: part.files ?? [] }))
  return { root, dir, file, epic, call, post, get, bytes, stored, holdings, olderHostSees }
}

interface Viewed {
  steps: { title: string; part?: string }[]
  groups?: { id: string; heading: string }[]
  listed: { id: string; name: string }[] | null
  unsettled: boolean
}

describe('who keeps the list: the one decision', () => {
  test('this app, when the epic’s own file has no `parts` key — or there is no such file, or it is not an object', () => {
    for (const none of [undefined, null, 'thesis', 7, [], [{ parts: [] }], {}, { slug: 'thesis', title: 'Thesis', groups: [{ id: 'a' }] }]) {
      expect(keeperFrom(none)).toBe(JOURNEYS_KEEP)
    }
    expect(JOURNEYS_KEEP).toEqual({ by: 'journeys' })
  })

  test('the host, when the file has the key — even an empty list, which is a host that keeps a list of none', () => {
    expect(keeperFrom({ parts: [] })).toEqual({ by: 'host', list: [] })
    expect(keeperFrom({ slug: 'thesis', parts: LIST })).toEqual({ by: 'host', list: LIST })
    /* A key that is not a list is still the key: the host reads only its file from then on. */
    expect(keeperFrom({ parts: null })).toEqual({ by: 'host', list: [] })
  })

  test('the list is read as the host reads it: one bad entry costs that entry', () => {
    const read = keeperFrom({ parts: [{ id: 'a', name: ' A ' }, 'b', { id: 'Not An Id', name: 'x' }, { id: 'a', name: 'again' }, { id: 'c' }, null] })
    expect(read).toEqual({ by: 'host', list: [{ id: 'a', name: 'A' }, { id: 'c', name: 'c' }] })
  })

  test('`listedBy` is never true while this app keeps the list', () => {
    expect(listedBy(JOURNEYS_KEEP, 'methods')).toBe(false)
    expect(listedBy(keeperFrom({ parts: LIST }), 'methods')).toBe(true)
    expect(listedBy(keeperFrom({ parts: LIST }), 'results')).toBe(false)
    expect(listedBy(keeperFrom({ parts: LIST }), null)).toBe(false)
  })

  test('off the disk: the host’s own file for the epic, and nothing else', () => {
    expect(keeperOf(project().root, 'thesis')).toBe(JOURNEYS_KEEP)
    expect(keeperOf(project(null).root, 'thesis')).toBe(JOURNEYS_KEEP)
    expect(keeperOf(project(LIST).root, 'thesis')).toEqual({ by: 'host', list: LIST })
    expect(keeperOf(project(LIST).root, 'another-epic')).toBe(JOURNEYS_KEEP)
    const broken = project()
    writeFileSync(broken.epic, '{ not json')
    expect(keeperOf(broken.root, 'thesis')).toBe(JOURNEYS_KEEP)
  })
})

describe('a host that does not keep the list: every write is the one it was', () => {
  test('reading writes nothing: not the journey, not the holdings — only the steps it had not published', () => {
    const { get, call, bytes, dir } = project()
    const was = bytes()
    expect(get().listed).toBeNull()
    expect(get().groups?.map((one) => one.id)).toEqual(['introduction', 'literature-review', 'methods'])
    call('get_journey')
    call('list_journeys')
    expect(bytes()).toBe(was)
    /* The first read publishes the plan a host now reads instead of this file (`plans.ts`), and nothing else. */
    expect(readdirSync(dir).sort()).toEqual(['journeys.json', 'steps.json'])
  })

  test('a new step is given a part with an id made here, and `groups` is written — which is where that host reads the list', () => {
    const { call, stored, olderHostSees } = project()
    const said = call('set_step', { title: 'A reader sees what happened', name: 'Results', refs: ['gh#9'] })
    expect(said).toContain('Set step 4 of thesis (id results, called “Results”)')
    expect(stored().steps[3]).toMatchObject({ part: 'results' })
    expect(olderHostSees().map((one) => one.id)).toEqual(['introduction', 'literature-review', 'methods', 'results'])
    expect(olderHostSees().slice(0, 3).map((one) => one.files[0])).toEqual([
      'chapters/1_introduction.tex',
      'chapters/2_literature_review.tex',
      'chapters/3_methods.tex',
    ])
  })

  test('what the steps hold for their parts is published after the write, and is exactly the steps’ refs', () => {
    const { call, holdings, root } = project()
    call('set_step', { title: 'A reader sees what happened', name: 'Results', refs: ['gh#9', '#12'] })
    expect(holdings().epics.thesis).toEqual({
      introduction: { documents: [], refs: ['gh#1', 'gh#2'] },
      'literature-review': { documents: [], refs: ['gh#3'] },
      results: { documents: [], refs: ['gh#9', '#12'] },
    })
    /* A step that names no reference holds nothing for its part, and a part nothing is held for is not listed. */
    expect(Object.hasOwn(holdings().epics.thesis!, 'methods')).toBe(false)
    /* And it is what a host's sweep of every module's folder finds. */
    expect(readHoldings(root).thesis).toEqual(holdings().epics.thesis as never)
  })
})

describe('a host that keeps the list: `groups` is neither read nor written', () => {
  test('reading writes nothing, hands over the host’s list and not `groups`, and shows the steps that are written', () => {
    const { get, call, bytes, dir } = project(LIST)
    const was = bytes()
    const view = get()
    expect(view.listed).toEqual(LIST)
    expect(Object.hasOwn(view, 'groups')).toBe(false)
    expect(view.unsettled).toBe(false)
    expect(view.steps.map((one) => one.part)).toEqual(['introduction', 'literature-review', 'methods'])
    const said = call('get_journey')
    expect(said).toContain('PARTS: the list of this epic’s parts is kept by the host')
    expect(said).toContain('  1\tintroduction\t“Introduction”')
    expect(said).toContain('PARTS WITH NO STEP (pass the id as `part` to `set_step` to write its step): appendices “Appendices”')
    expect(bytes()).toBe(was)
    expect(readdirSync(dir).sort()).toEqual(['journeys.json', 'steps.json'])
  })

  test('a record still in the older shape is not read as one step to a part: no step is made for a part that has none', () => {
    /* Four groups and three steps: read with `groups`, a fourth step would be made for the one that has none. */
    const older = { ...thesis, groups: [...thesis.groups, { id: 'appendices', heading: 'Appendices', refs: [], files: ['chapters/appendix.tex'] }] }
    expect(project(undefined, older).get().steps).toHaveLength(4)
    expect(project(undefined, older).get().unsettled).toBe(true)
    const kept = project(LIST, older)
    expect(kept.get().steps).toHaveLength(3)
    expect(kept.get().unsettled).toBe(false)
    /* And a write of it rewrites nothing about the parts and keeps no "before" record: nothing was migrated. */
    kept.call('set_step', { step: 'methods', title: 'Reworded' })
    expect(kept.stored().groups).toEqual(older.groups)
    expect(existsSync(join(kept.dir, `${BEFORE}.json`))).toBe(false)
  })

  test('a step written again changes the step and not one byte of `groups`', () => {
    const { call, stored } = project(LIST)
    const said = call('set_step', { step: 'methods', title: 'Reworded', body: 'New.', refs: ['gh#7'] })
    expect(said).toContain('Set step 3 of thesis (the step of part methods, “Methods”)')
    expect(stored().steps[2]).toMatchObject({ title: 'Reworded', part: 'methods', refs: ['gh#7'] })
    expect(stored().groups).toEqual(thesis.groups)
  })

  test('a new step with no `part` is in no part: no id is made here, and the answer says where one is', () => {
    const { call, stored } = project(LIST)
    const said = call('set_step', { title: 'A reader sees what happened' })
    expect(said).toContain('Set step 4 of thesis (in no part: the host keeps this epic’s list of parts, so add one there and pass its id as `part`)')
    expect(Object.hasOwn(stored().steps[3]!, 'part')).toBe(false)
    expect(stored().groups).toEqual(thesis.groups)
  })

  test('a new step with `part` is the step of that part, when the host lists it', () => {
    const { call, stored, get } = project(LIST)
    const said = call('set_step', { title: 'A reader can check the instruments', part: 'appendices' })
    expect(said).toContain('Set step 4 of thesis (the step of part appendices, “Appendices”)')
    expect(stored().steps[3]).toMatchObject({ part: 'appendices' })
    expect(get().steps[3]!.part).toBe('appendices')
    expect(call('get_journey')).not.toContain('PARTS WITH NO STEP')
  })

  test('a part the host does not list is refused, and nothing is written: a step never points at a part that was not made', () => {
    const { call, post, bytes } = project(LIST)
    const was = bytes()
    expect(call('set_step', { title: 'X', part: 'results' })).toBe(
      '"results" is not a part of this epic. Its parts are: introduction, literature-review, methods, appendices. '
        + 'The host keeps that list: a part is added there, and its id passed here. The step was not written.',
    )
    const reply = post('/api/step', { title: 'X', body: '', refs: [], notes: [], part: 'results' })
    expect(reply?.status).toBe(400)
    expect(bytes()).toBe(was)
  })

  test('a part has one step: an id another step has is refused; and a step in a part does not move to another', () => {
    const { call, bytes } = project(LIST)
    const was = bytes()
    expect(call('set_step', { title: 'X', part: 'methods' })).toContain('methods already has its step: step 3 (“A reader could repeat the study”). A part has one step.')
    expect(call('set_step', { step: 'methods', title: 'X', part: 'appendices' })).toContain('This step is the step of methods, a part the epic still has')
    expect(bytes()).toBe(was)
  })

  test('a step whose part was removed from the list is in no part, and `part` makes it one again', () => {
    const { call, stored } = project(LIST.filter((one) => one.id !== 'methods'))
    expect(call('get_journey')).toContain('  3\t—\tin no part')
    const said = call('set_step', { position: 3, title: 'A reader could repeat the study', part: 'appendices' })
    expect(said).toContain('the step of part appendices')
    expect(stored().steps[2]).toMatchObject({ part: 'appendices', title: 'A reader could repeat the study' })
  })

  test('`name` is not taken: the name is the epic’s, the epic’s file is not touched, and the answer says where it is changed', () => {
    const { call, epic, stored } = project(LIST)
    const was = readFileSync(epic, 'utf8')
    const said = call('set_step', { step: 'methods', title: 'Reworded', name: 'How it was done' })
    expect(said).toContain('The part’s name was not changed here: the list of this epic’s parts is kept by the host')
    expect(readFileSync(epic, 'utf8')).toBe(was)
    expect(stored().groups).toEqual(thesis.groups)
  })

  test('removing a step removes the step, and says its part is still the epic’s', () => {
    const { call, stored, epic } = project(LIST)
    const was = readFileSync(epic, 'utf8')
    expect(call('remove_step', { step: 'methods' })).toBe(
      'Removed step 3 (“A reader could repeat the study”) from thesis. Its part (methods) is the epic’s and is still listed: '
        + 'the host keeps that list, and a part is removed there.',
    )
    expect(stored().steps.map((one) => one.part)).toEqual(['introduction', 'literature-review'])
    expect(stored().groups).toEqual(thesis.groups)
    expect(readFileSync(epic, 'utf8')).toBe(was)
  })

  test('moving a step moves the step and nothing else', () => {
    const { call, post, stored } = project(LIST)
    expect(call('move_step', { step: 'methods', to: 1 })).toBe('Moved step 3 (“A reader could repeat the study”) of thesis to position 1.')
    expect(stored().steps.map((one) => one.part)).toEqual(['methods', 'introduction', 'literature-review'])
    expect(stored().groups).toEqual(thesis.groups)
    const reply = post('/api/step/move', { position: 1, to: 3 })?.body as { journey: Viewed }
    expect(reply.journey.steps.map((one) => one.part)).toEqual(['introduction', 'literature-review', 'methods'])
    expect(reply.journey.listed).toEqual(LIST)
  })

  test('the holdings are the refs of each step that is in a part; a step in no part holds nothing for one', () => {
    const { call, holdings, stored, root } = project(LIST)
    call('set_step', { title: 'A step in no part', refs: ['gh#40'] })
    call('set_step', { title: 'The instruments', part: 'appendices', refs: ['gh#41', '!7'] })
    const expected = {
      introduction: { documents: [], refs: ['gh#1', 'gh#2'] },
      'literature-review': { documents: [], refs: ['gh#3'] },
      appendices: { documents: [], refs: ['gh#41', '!7'] },
    }
    expect(holdings().epics.thesis).toEqual(expected)
    expect(holdingsOf(stored() as never)).toEqual(expected)
    expect(readHoldings(root).thesis).toEqual(expected as never)
    /* Rewritten by the next write, whatever it was about: a step's refs changed, so its part's did. */
    call('set_step', { step: 'methods', title: 'A reader could repeat the study', refs: ['gh#50'] })
    expect(holdings().epics.thesis!.methods).toEqual({ documents: [], refs: ['gh#50'] })
    call('remove_step', { step: 'appendices' })
    expect(Object.hasOwn(holdings().epics.thesis!, 'appendices')).toBe(false)
  })

  test('the page’s door answers with the list as it now is, and never with `groups`', () => {
    const { post } = project(LIST)
    const reply = post('/api/step', { title: 'The instruments', body: '', refs: [], notes: [], part: 'appendices' })?.body as { journey: Viewed; said: string }
    expect(reply.journey.listed).toEqual(LIST)
    expect(Object.hasOwn(reply.journey, 'groups')).toBe(false)
    expect(reply.journey.steps[3]).toMatchObject({ part: 'appendices' })
    expect(reply.said).toBe('')
  })
})

describe('beginning a journey for an epic whose list the host keeps', () => {
  test('the host’s list is not copied into the record, where it would be a second list', () => {
    const root = mkdtempSync(join(tmpdir(), 'journeys-keeper-'))
    made.push(root)
    const epics = join(root, KEHIKOT_DIR, 'host', 'epics')
    mkdirSync(epics, { recursive: true })
    writeFileSync(
      join(epics, 'thesis.json'),
      `${JSON.stringify({ slug: 'thesis', title: 'Thesis', parts: LIST, steps: [{ title: 'From the host', body: '', refs: ['gh#1'], notes: [], part: 'methods' }] }, null, 2)}\n`,
    )
    const reply = answer('POST', '/api/journey', new URLSearchParams(), { project: root, slug: 'thesis', ticket: writeTicketFor(root) }, TICKET)
    expect(reply?.status).toBe(200)
    const record = (JSON.parse(readFileSync(join(root, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')) as { journeys: { thesis: Record<string, unknown> } }).journeys.thesis
    expect(Object.hasOwn(record, 'parts')).toBe(false)
    expect(record.groups).toEqual([])
    expect((record.steps as { part?: string }[])[0]!.part).toBe('methods')
    expect((reply?.body as { journey: Viewed }).journey.listed).toEqual(LIST)
    expect(readHoldings(root).thesis).toEqual({ methods: { documents: [], refs: ['gh#1'] } } as never)
  })
})
