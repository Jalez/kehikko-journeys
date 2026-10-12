import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, journeyIn as recordIn, moduleFolder, partsOf } from 'kehikot-module-protocol'
import { readJourneys } from 'kehikot-module-protocol/serve'

import { TICKET, answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import { BEFORE, held, journeyIn } from '../store.ts'

/**
 * A journey still in the older shape of parts on disk: read as one step to a
 * part by every reader, written by none, and stored so — with the record as
 * it was kept beside it — by the first deliberate write.
 *
 * `hostSees` is a released host's reading: the protocol's `readJourneys`,
 * `journeyIn` and `partsOf` over the file, which is all `server/holdings.ts`
 * and `src/host/parts.ts` do, on main and in the released app alike.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const MINE = moduleFolder(ID)

const step = (title: string, part?: string) => ({ title, body: `About ${title}.`, refs: [], notes: [], ...(part ? { part } : {}) })

/** The CS-DEGREE thesis, in the shape it is in on disk. */
const thesis = {
  slug: 'thesis',
  title: 'Thesis',
  steps: [
    step('A reader knows why chat-as-an-exercise is worth studying', 'introduction'),
    step('A reader can see the gap this study fills', 'literature-review'),
    step('A reader could repeat the study', 'methods'),
  ],
  groups: [
    { id: 'introduction', heading: 'Introduction', refs: [], files: ['chapters/1_introduction.tex'] },
    { id: 'literature-review', heading: 'Literature Review', refs: [], files: ['chapters/2_literature_review.tex'] },
    { id: 'methods', heading: 'Methods', refs: [], files: ['chapters/3_methods.tex'] },
    { id: 'appendices', heading: 'Appendices', refs: [], files: ['chapters/appendix_instruments.tex'] },
  ],
}

/** Two parts covering one file, beside it in the same document. */
const sharing = {
  slug: 'sharing',
  title: 'Sharing',
  steps: [step('A stale page says so', 'refresh'), step('A refresh keeps what was typed', 'keeps')],
  groups: [
    { id: 'refresh', heading: 'Refresh', refs: [], files: ['chapters/refresh.tex'] },
    { id: 'keeps', heading: 'Keeps typing', refs: [], files: ['chapters/refresh.tex'] },
  ],
}

function project(journeys: Record<string, unknown> = { thesis, sharing }) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-settle-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, MINE)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys }, null, 2)}\n`)
  const before = join(dir, `${BEFORE}.json`)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'thesis', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const post = (path: string, body: Record<string, unknown> = {}) =>
    answer('POST', path, new URLSearchParams(), { project: root, slug: 'thesis', ticket: writeTicketFor(root), ...body }, TICKET)
  const get = (slug = 'thesis') =>
    answer('GET', '/api/journey', new URLSearchParams({ project: root, slug }), null, null)?.body as {
      journey: { steps: { title: string; part?: string }[]; groups: { id: string; heading: string; files?: string[] }[]; unsettled: boolean }
    }
  const hostSees = (slug = 'thesis') =>
    partsOf(recordIn(readJourneys(root), slug)).map((part) => ({ id: part.id, heading: part.heading, files: part.files ?? [] }))
  const pageShows = (slug = 'thesis') => get(slug).journey.groups.map((group) => ({ id: group.id, heading: group.heading, files: group.files ?? [] }))
  return { root, file, before, call, post, get, hostSees, pageShows }
}

describe('reading a journey still in the older shape', () => {
  test('never writes: not the page’s read, not the list, not an agent’s', () => {
    const { root, file, before, get, call } = project()
    const bytes = readFileSync(file, 'utf8')
    get()
    get('sharing')
    answer('GET', '/api/journeys', new URLSearchParams({ project: root }), null, null)
    answer('GET', '/api/chapters', new URLSearchParams({ project: root, slug: 'thesis' }), null, null)
    call('get_journey')
    call('list_journeys')
    expect(readFileSync(file, 'utf8')).toBe(bytes)
    expect(existsSync(before)).toBe(false)
  })

  test('the page is shown one step to a part already, and told the file is not stored so', () => {
    const { get } = project()
    const { journey } = get()
    expect(journey.unsettled).toBe(true)
    expect(journey.steps.map((one) => one.part)).toEqual(['introduction', 'literature-review', 'methods', 'appendices'])
    expect(journey.steps[3]!.title).toBe('Appendices')
    expect(journey.groups).toHaveLength(4)
  })

  test('a host reading the file as it is lists the same parts the page shows — ids, names, files', () => {
    const { hostSees, pageShows } = project()
    expect(hostSees()).toEqual(pageShows())
  })

  test('…except where the older shape let two parts cover one file: the page shows the one that keeps it', () => {
    const { hostSees, pageShows } = project()
    expect(hostSees('sharing').map((part) => part.files)).toEqual([['chapters/refresh.tex'], ['chapters/refresh.tex']])
    expect(pageShows('sharing').map((part) => part.files)).toEqual([['chapters/refresh.tex'], []])
    expect(hostSees('sharing').map((part) => part.id)).toEqual(pageShows('sharing').map((part) => part.id))
  })

  test('an agent is told the ids, and that nothing has been written', () => {
    const said = project().call('get_journey')
    expect(said).toContain('STEPS: each step is one part of the epic')
    expect(said).toContain('  3\tmethods\t“Methods”\tchapters/3_methods.tex')
    expect(said).toContain('  4\tappendices\t“Appendices”\tchapters/appendix_instruments.tex')
    expect(said).toContain('NOT YET STORED LIKE THIS')
  })
})

describe('the first deliberate write', () => {
  test('stores the journey as it is read, keeps the record as it was, and says what was decided', () => {
    const { file, before, call, hostSees, pageShows, get } = project()
    const was = (JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, unknown> }).journeys
    const said = call('set_step', { step: 'methods', title: 'A reader could repeat the study', body: 'Reworded.' })
    expect(said).toContain('Set step 3 of thesis (id methods, called “Methods”)')
    expect(said).toContain('This journey was stored in an older shape')
    expect(said).toContain(before)
    expect(said).toContain('“Appendices” had no step. One was made for it')

    /* The record as it was, whole, beside the file — and what was decided about it. */
    const kept = JSON.parse(readFileSync(before, 'utf8')) as { journeys: Record<string, unknown>; decided: Record<string, { findings: string[]; parts: unknown[] }> }
    expect(kept.journeys.thesis).toEqual(was.thesis)
    expect(Object.keys(kept.journeys)).toEqual(['thesis'])
    expect(kept.decided.thesis!.findings[0]).toContain('“Appendices” had no step')
    expect(kept.decided.thesis!.parts).toHaveLength(4)

    /* The other journey in the file was not touched, and is still to be stored. */
    expect((JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, unknown> }).journeys.sharing).toEqual(was.sharing)
    expect(get().journey.unsettled).toBe(false)
    expect(get('sharing').journey.unsettled).toBe(true)

    /* And a host reads the same four parts off the new file as off the old. */
    expect(hostSees()).toEqual(pageShows())
    expect(hostSees().map((part) => part.id)).toEqual(['introduction', 'literature-review', 'methods', 'appendices'])
  })

  test('the next write says nothing about it, and the kept record is not written over', () => {
    const { before, call } = project()
    call('set_step', { step: 'methods', title: 'Once' })
    const kept = readFileSync(before, 'utf8')
    const said = call('set_step', { step: 'methods', title: 'Twice' })
    expect(said).not.toContain('older shape')
    expect(readFileSync(before, 'utf8')).toBe(kept)
  })

  test('a second journey is added to the kept records when it is stored, beside the first', () => {
    const { before, call } = project()
    call('set_step', { step: 'methods', title: 'Once' })
    const said = call('set_step', { slug: 'sharing', step: 'keeps', title: 'A refresh keeps what was typed' })
    expect(said).toContain('chapters/refresh.tex was covered by two parts, “Refresh” and “Keeps typing”')
    const kept = JSON.parse(readFileSync(before, 'utf8')) as { journeys: Record<string, { groups: unknown[] }> }
    expect(Object.keys(kept.journeys)).toEqual(['thesis', 'sharing'])
    expect(kept.journeys.sharing!.groups).toEqual(sharing.groups)
  })

  test('a kept-records file that will not read stops the write rather than losing the record', () => {
    const { file, before, call } = project()
    const bytes = readFileSync(file, 'utf8')
    writeFileSync(before, '{ not json')
    expect(call('set_step', { step: 'methods', title: 'Once' })).toContain('nothing was written.')
    expect(readFileSync(file, 'utf8')).toBe(bytes)
  })

  test('the press that stores it and changes nothing else: the page’s, for a host that asked where parts are made', () => {
    const { post, get, hostSees, before } = project()
    const reply = post('/api/settle')
    expect(reply?.status).toBe(200)
    const body = reply?.body as { said: string; journey: { unsettled: boolean; steps: unknown[] } }
    expect(body.said).toStartWith('This journey was stored in an older shape')
    expect(body.journey.unsettled).toBe(false)
    expect(existsSync(before)).toBe(true)
    expect(hostSees()).toHaveLength(4)
    /* Pressed again, there is nothing to store, and it says so without writing. */
    const again = post('/api/settle')?.body as { said: string }
    expect(again.said).toBe('Every step of thesis is already one part of the epic; there is nothing to divide.')
    expect(get().journey.steps).toHaveLength(4)
  })
})

describe('a step and its part, through the doors', () => {
  test('a new step is a new part: named, and answered with its id', () => {
    const { call, hostSees } = project()
    const said = call('set_step', { title: 'A reader sees what happened', name: 'Results' })
    expect(said).toContain('Set step 5 of thesis (id results, called “Results”)')
    expect(hostSees().at(-1)).toEqual({ id: 'results', heading: 'Results', files: [] })
  })

  test('a step written again keeps its part’s name unless it is said, and the document an earlier version recorded', () => {
    const { call, hostSees } = project()
    call('set_step', { step: 'methods', title: 'Reworded' })
    expect(hostSees()[2]).toEqual({ id: 'methods', heading: 'Methods', files: ['chapters/3_methods.tex'] })
    call('set_step', { step: 'methods', title: 'Reworded', name: '' })
    expect(hostSees()[2]).toEqual({ id: 'methods', heading: 'Reworded', files: ['chapters/3_methods.tex'] })
  })

  /**
   * `file` set a part's chapter until a part's chapter became the Paper
   * module's to keep. For one release it is still accepted, changes nothing,
   * and is SAID to have changed nothing; a document already in a record is
   * carried as it is, because a released host still reads it there.
   */
  test('`file` is accepted, sets nothing, takes nothing away, and says so', () => {
    const { call, hostSees } = project()
    const fresh = call('set_step', { title: 'A reader sees what happened', name: 'Results', file: 'chapters/4_results.tex' })
    expect(fresh).toContain('Set step 5 of thesis (id results, called “Results”)')
    expect(fresh).toContain('`file` is no longer taken: a part’s chapter is set in the module that keeps the paper, not here.')
    expect(hostSees().at(-1)).toEqual({ id: 'results', heading: 'Results', files: [] })
    const cleared = call('set_step', { step: 'methods', title: 'Reworded', file: '' })
    expect(cleared).toContain('`file` is no longer taken')
    expect(hostSees()[2]).toEqual({ id: 'methods', heading: 'Methods', files: ['chapters/3_methods.tex'] })
    /* Not said to a caller that did not pass it. */
    expect(call('set_step', { step: 'methods', title: 'Reworded' })).not.toContain('`file`')
  })

  test('an id that names no step is refused and nothing is written', () => {
    const { file, call } = project()
    call('set_step', { step: 'methods', title: 'Stored' })
    const bytes = readFileSync(file, 'utf8')
    expect(call('set_step', { step: 'nowhere', title: 'X' })).toContain('"nowhere" names no step of this journey. Its steps are: 1 introduction')
    expect(readFileSync(file, 'utf8')).toBe(bytes)
  })

  test('`part` is answered and not obeyed while this app keeps the list: a step is its own part', () => {
    const { call, hostSees } = project()
    const said = call('set_step', { step: 'methods', title: 'Reworded', part: 'introduction' })
    expect(said).toContain('`part` is not taken here: this app keeps this epic’s list of parts for a host that does not')
    expect(hostSees().map((part) => part.id)).toEqual(['introduction', 'literature-review', 'methods', 'appendices'])
  })

  test('moving a step moves its part with it, and nothing else about either', () => {
    const { call, hostSees, root } = project()
    expect(call('move_step', { step: 'methods', to: 1 })).toContain('Moved step 3 (“A reader could repeat the study”) of thesis to position 1.')
    expect(hostSees()).toEqual([
      { id: 'methods', heading: 'Methods', files: ['chapters/3_methods.tex'] },
      { id: 'introduction', heading: 'Introduction', files: ['chapters/1_introduction.tex'] },
      { id: 'literature-review', heading: 'Literature Review', files: ['chapters/2_literature_review.tex'] },
      { id: 'appendices', heading: 'Appendices', files: ['chapters/appendix_instruments.tex'] },
    ])
    expect(journeyIn(held(root), 'thesis')?.steps.map((one) => one.part)).toEqual(['methods', 'introduction', 'literature-review', 'appendices'])
    expect(call('move_step', { step: 'methods', to: 1 })).toContain('is already there')
    expect(call('move_step', { step: 'methods', to: 9 })).toContain('Nothing was moved.')
  })

  test('removing a step removes its part, by position or by id, and says what went', () => {
    const { call, hostSees, root } = project()
    expect(call('remove_step', { step: 'appendices' })).toContain(
      'Removed step 4 (“Appendices”) from thesis, and its part (appendices) with it, which covered chapters/appendix_instruments.tex.',
    )
    expect(call('remove_step', { position: 1 })).toContain('and its part (introduction) with it')
    expect(hostSees().map((part) => part.id)).toEqual(['literature-review', 'methods'])
    expect(journeyIn(held(root), 'thesis')?.steps).toHaveLength(2)
    expect(call('remove_step', { position: 9 })).toBe('thesis has 2 stored steps')
  })

  test('the page’s door takes the same: a step by its id, with its part’s name', () => {
    const { post, hostSees } = project()
    const reply = post('/api/step', { step: 'literature-review', title: 'The gap', body: '', refs: [], notes: [], name: 'Literature' })
    expect(reply?.status).toBe(200)
    expect((reply?.body as { journey: { listed: unknown } }).journey.listed).toBeNull()
    expect(hostSees()[1]).toEqual({ id: 'literature-review', heading: 'Literature', files: ['chapters/2_literature_review.tex'] })
    expect(post('/api/step/remove', { step: 'literature-review' })?.status).toBe(200)
    expect(hostSees().map((part) => part.id)).toEqual(['introduction', 'methods', 'appendices'])
  })

  test('the doors that arranged parts are gone', () => {
    const { post, call } = project()
    for (const path of ['/api/assign', '/api/part', '/api/part/remove', '/api/parts/chapters', '/api/steps/chapters']) expect(post(path)?.status).toBe(404)
    /* The read of another module's folder is gone with them. */
    expect(answer('GET', '/api/chapters', new URLSearchParams({ project: project().root, slug: 'thesis' }), null, null)?.status).toBe(404)
    for (const tool of ['set_part', 'remove_part', 'assign_steps', 'propose_chapter_parts']) expect(call(tool)).toBe(`no tool "${tool}" here`)
  })
})
