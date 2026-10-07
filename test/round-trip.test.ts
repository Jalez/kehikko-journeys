import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, journeyIn as recordIn, moduleFolder, partInFocus, stepPart } from 'kehikot-module-protocol'
import { readJourneys } from 'kehikot-module-protocol/serve'

import { answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import { held, journeyIn, journeySchema, writeJourney } from '../store.ts'

/**
 * A save changes the journey that was saved, and nothing else in the file.
 *
 * This app's schemas used to be plain `z.object`, which strips whatever it
 * does not name, and `writeJourney` rebuilt the whole document from the
 * parse. Together those meant the first save of anything, by anybody, deleted
 * `part` from every step and `id` from every group in the project — in
 * journeys nobody had opened — along with every field a newer writer had
 * added. A host reads this file now and those fields are how a step is in a
 * part at all.
 *
 * So: every journey in a file is read and written straight back, one at a
 * time, and the file afterwards is the file it was — byte for byte, where the
 * file was written two-space with a trailing newline, which is how this app
 * and the host both write. Not "the same values": the same text, with the
 * keys where the person left them, because these are hand-written documents
 * in somebody's repository and a save that reordered one would put a
 * hundred-line diff in front of whoever changed a word.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const MINE = moduleFolder(ID)

function project(document: unknown): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'journeys-round-trip-'))
  made.push(root)
  mkdirSync(join(root, KEHIKOT_DIR, MINE), { recursive: true })
  const file = join(root, KEHIKOT_DIR, MINE, 'journeys.json')
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
  return { root, file }
}

const onDisk = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

/**
 * A record as a newer writer leaves one: every field this version writes,
 * `part` on steps and `id` on groups, and at every level something this
 * version has never heard of.
 */
const divided = {
  slug: 'the-posting-seam',
  title: 'The posting seam',
  lede: 'One place a comment is posted from.',
  project: 'Kehikot',
  umbrella: 'gh#1',
  written: '2026-10-01',
  callout: '',
  steps: [
    {
      title: 'Post through one function',
      body: 'So there is one place to look.',
      refs: ['gh#2', 'gh#3'],
      notes: [],
      part: 'the-agent-seam',
      estimate: { days: 2, by: 'somebody' },
    },
    { title: 'Retire the second path', body: '', refs: ['gh#4'], notes: ['already half done'] },
    { title: 'Say so on the page', body: '', refs: ['gh#5'], notes: [], part: 'what-the-page-shows', colour: 'teal' },
  ],
  stepsFrom: { projector: 'paper', where: 'chapters/seam.tex', why: 'It is also a paper.', revision: 7 },
  groups: [
    { id: 'the-agent-seam', heading: 'The agent seam', refs: ['gh#6'], collapsed: true },
    { heading: 'What the page shows', refs: ['gh#7'] },
  ],
  exists: ['The tracker reading'],
  missing: '',
  order: [{ when: 'first', what: 'the seam', why: '', owner: 'ada' }],
  open: ['Who retries?'],
  quizzes: [{ question: 'Which?', options: ['a', 'b'], answer: 0, why: '', difficulty: 3 }],
  vocabulary: [{ term: 'seam', means: 'where two things meet', seeAlso: ['join'] }],
  blockedBy: { 'gh#3': ['gh#2'] },
  settledBy: {},
  containers: [],
  people: ['ada'],
  owners: { 'gh#2': { maker: 'ada', since: '2026-09-30' } },
  watch: ['gh#8'],
  branches: { development: 'development', prod: 'prod', staging: 'staging' },
  board: { org: 'Jalez', number: 3, view: 'table' },
  /* Top of the record, too. */
  reviewedBy: { who: 'grace', on: '2026-10-02' },
}

/** A record from before parts: nothing on it but what the first version wrote. */
const older = {
  slug: 'an-older-journey',
  title: 'An older journey',
  steps: [{ title: 'Only step', refs: ['gh#20'] }],
}

const document = {
  version: 1,
  journeys: { 'the-posting-seam': divided, 'an-older-journey': older },
  /* Beside `version` and `journeys`: somebody's, and not this app's to drop. */
  migratedFrom: { tool: 'dev/migrate.ts', at: '2026-09-01T10:00:00.000Z' },
}

describe('reading a record a newer writer wrote', () => {
  test('nothing it carries is dropped by the parse, at any level', () => {
    const parsed = journeySchema.parse(divided)
    expect(parsed).toEqual(divided as never)
    expect(stepPart(parsed.steps[0])).toBe('the-agent-seam')
    expect(parsed.groups[0]?.id).toBe('the-agent-seam')
  })

  test('and the protocol reads the same file a host would, to the same steps', () => {
    const { root } = project(document)
    const record = recordIn(readJourneys(root), 'the-posting-seam')
    expect(record?.steps).toEqual(journeyIn(held(root), 'the-posting-seam')?.steps as never)
  })
})

describe('saving a journey', () => {
  test('a journey read and written straight back leaves the file as it was, byte for byte', () => {
    const { root, file } = project(document)
    const before = readFileSync(file, 'utf8')
    const journey = journeyIn(held(root), 'the-posting-seam')!
    expect(writeJourney(root, journey).ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('with its keys in the order the file had them, not the order a schema lists them in', () => {
    /* `groups` last and `title` after `steps`: nobody's schema, somebody's file. */
    const { slug, title, steps, groups, ...rest } = divided
    const { root, file } = project({ version: 1, journeys: { [slug]: { slug, steps, ...rest, title, groups } } })
    const before = readFileSync(file, 'utf8')
    writeJourney(root, journeyIn(held(root), slug)!)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('a file with no `version` is not given one by a save, and a new file is', () => {
    const { root, file } = project({ journeys: document.journeys })
    writeJourney(root, journeyIn(held(root), 'the-posting-seam')!)
    expect(Object.keys(onDisk(file))).toEqual(['journeys'])

    const fresh = mkdtempSync(join(tmpdir(), 'journeys-round-trip-'))
    made.push(fresh)
    expect(writeJourney(fresh, journeySchema.parse(divided)).ok).toBe(true)
    expect(Object.keys(onDisk(join(fresh, KEHIKOT_DIR, MINE, 'journeys.json')))).toEqual(['version', 'journeys'])
  })

  test('`part`, a group’s `id` and the fields nobody here knows are all still in the file', () => {
    const { root, file } = project(document)
    writeJourney(root, journeyIn(held(root), 'the-posting-seam')!)
    const text = readFileSync(file, 'utf8')
    for (const kept of [
      '"part": "the-agent-seam"',
      '"part": "what-the-page-shows"',
      '"id": "the-agent-seam"',
      '"estimate"',
      '"colour": "teal"',
      '"collapsed": true',
      '"revision": 7',
      '"owner": "ada"',
      '"difficulty": 3',
      '"seeAlso"',
      '"since": "2026-09-30"',
      '"staging": "staging"',
      '"view": "table"',
      '"reviewedBy"',
      '"migratedFrom"',
    ]) {
      expect(text).toContain(kept)
    }
  })

  test('the journeys that were not saved are not rewritten at all — not even with their defaults', () => {
    const { root, file } = project(document)
    writeJourney(root, journeyIn(held(root), 'the-posting-seam')!)
    const after = onDisk(file).journeys as Record<string, unknown>
    /* Exactly three keys, as it was written. A parse would have added a body,
       notes, a lede, a callout and a dozen empty lists. */
    expect(after['an-older-journey']).toEqual(older)
    expect(Object.keys(after['an-older-journey'] as object)).toEqual(['slug', 'title', 'steps'])
    expect(Object.keys((after['an-older-journey'] as typeof older).steps[0]!)).toEqual(['title', 'refs'])
  })

  test('the one that was saved gains this version’s defaults, and loses nothing', () => {
    const { root, file } = project(document)
    writeJourney(root, journeyIn(held(root), 'an-older-journey')!)
    const after = (onDisk(file).journeys as Record<string, Record<string, unknown>>)['an-older-journey']!
    expect(after).toMatchObject(older)
    expect(after.steps).toEqual([{ title: 'Only step', body: '', refs: ['gh#20'], notes: [] }])
    expect(after.groups).toEqual([])
    /* What it had stays in front, in its own order; what it gained follows. */
    expect(Object.keys(after).slice(0, 3)).toEqual(['slug', 'title', 'steps'])
    expect(Object.keys((after.steps as object[])[0]!)).toEqual(['title', 'refs', 'body', 'notes'])
    /* And its neighbour is as it was. */
    expect((onDisk(file).journeys as Record<string, unknown>)['the-posting-seam']).toEqual(divided)
  })

  test('a key that is not a slug is not shown, and is not deleted either', () => {
    const { root, file } = project({ version: 1, journeys: { ...document.journeys, 'Not A Slug': older } })
    expect(Object.keys(held(root).journeys).sort()).toEqual(['an-older-journey', 'the-posting-seam'])
    writeJourney(root, journeyIn(held(root), 'the-posting-seam')!)
    expect(Object.keys(onDisk(file).journeys as object)).toContain('Not A Slug')
  })

  test('the journeys this app ships go through every save without a byte moving', () => {
    /* Real material rather than a fixture written to pass: every journey in
       `seed/`, exactly as it is on disk, in one document, each saved in turn. */
    const seeds = Object.fromEntries(
      readdirSync(new URL('../seed/', import.meta.url).pathname)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const journey = JSON.parse(readFileSync(new URL(`../seed/${name}`, import.meta.url), 'utf8')) as { slug: string }
          return [journey.slug, journey]
        }),
    )
    expect(Object.keys(seeds).length).toBeGreaterThan(10)
    const { root, file } = project({ version: 1, journeys: seeds })
    const before = readFileSync(file, 'utf8')
    for (const slug of Object.keys(seeds)) {
      expect(writeJourney(root, journeyIn(held(root), slug)!).ok).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(before)
    }
  })
})

describe('writing a step through the door', () => {
  const post = (root: string, body: Record<string, unknown>) =>
    answer('POST', '/api/step', new URLSearchParams(), { ...body, project: root }, writeTicketFor(root))

  test('replacing a step keeps the part it was assigned to, and what this door cannot say', () => {
    const { root, file } = project(document)
    const reply = post(root, {
      slug: 'the-posting-seam',
      position: 1,
      title: 'Post through ONE function',
      body: 'Reworded.',
      refs: ['gh#2'],
      notes: ['a note'],
    })
    expect(reply?.status).toBe(200)
    const step = (onDisk(file).journeys as { 'the-posting-seam': typeof divided })['the-posting-seam'].steps[0]!
    /* The four things the door takes are replaced whole… */
    expect(step.title).toBe('Post through ONE function')
    expect(step.body).toBe('Reworded.')
    expect(step.refs).toEqual(['gh#2'])
    expect(step.notes).toEqual(['a note'])
    /* …and the two it has no argument for are still there. */
    expect(step.part).toBe('the-agent-seam')
    expect(step.estimate).toEqual({ days: 2, by: 'somebody' })
    /* A host pointed at that part still finds the step in it. */
    const parts = [{ id: 'the-agent-seam', heading: 'The agent seam', refs: [], picked: true }]
    expect(partInFocus(parts, stepPart(step))).toBe(true)
  })

  test('a step appended is in no part, and every other step is as it was', () => {
    const { root, file } = project(document)
    post(root, { slug: 'the-posting-seam', title: 'A fourth', body: '', refs: [], notes: [] })
    const steps = (onDisk(file).journeys as { 'the-posting-seam': typeof divided })['the-posting-seam'].steps
    expect(steps).toHaveLength(4)
    expect(steps.slice(0, 3)).toEqual(divided.steps)
    expect(stepPart(steps[3])).toBeNull()
  })

  test('and the file a save leaves is one the protocol’s reader takes whole', () => {
    const { root } = project(document)
    post(root, { slug: 'the-posting-seam', position: 2, title: 'Retire it', body: '', refs: [], notes: [] })
    const read = readJourneys(root)
    expect(recordIn(read, 'the-posting-seam')?.steps.map(stepPart)).toEqual(['the-agent-seam', null, 'what-the-page-shows'])
    expect(recordIn(read, 'an-older-journey')?.steps).toHaveLength(1)
  })
})
