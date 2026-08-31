import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { fold, migrate, verify } from '../dev/migrate.ts'
import { ID } from '../manifest.ts'
import { held, journeySchema } from '../store.ts'

/**
 * The migration, tested, because a migration nobody tested is a migration
 * nobody can rerun.
 *
 * What is actually at stake: fourteen hand-written narratives, roughly a
 * quarter of a megabyte of prose somebody wrote about work they were doing.
 * There is no version of "it mostly worked" that is acceptable, and the two
 * ways to lose them are both tested below — a fold that quietly drops a file,
 * and a rename that happens before the destination has been proved.
 */

const MINE = moduleFolder(ID)
const made: string[] = []

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}
afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true })
})

/**
 * A `data/` directory in the shape the old store actually had: one file per
 * slug.
 *
 * Takes loose objects rather than `Partial<Journey>` on purpose. The point of
 * these fixtures is to be the documents that were ON DISK, which is what
 * `journeySchema` fills the defaults of — a typed partial would require every
 * field the schema supplies, which is exactly the work the migration is being
 * tested for doing.
 */
function oldStore(journeys: Record<string, unknown>[]): string {
  const dir = join(temp('journeys-old-'), 'data')
  mkdirSync(dir, { recursive: true })
  for (const partial of journeys) {
    const journey = journeySchema.parse({ title: 'A journey', ...partial })
    writeFileSync(join(dir, `${journey.slug}.json`), `${JSON.stringify(journey, null, 2)}\n`)
  }
  return dir
}

const project = () => temp('journeys-into-')

describe('folding one file per slug into one document', () => {
  test('reads every journey in the directory', () => {
    const from = oldStore([{ slug: 'one' }, { slug: 'two' }, { slug: 'three' }])
    const { journeys, skipped } = fold(from)
    expect(journeys.map((j) => j.slug).sort()).toEqual(['one', 'three', 'two'])
    expect(skipped).toEqual([])
  })

  /* Named rather than swallowed. This is the one moment somebody's narrative can
     go missing without anything noticing, so the count at the end has to be a
     count of what was read and anything unread has to appear by name. */
  test('names what it could not read instead of quietly leaving it out', () => {
    const from = oldStore([{ slug: 'one' }])
    writeFileSync(join(from, 'broken.json'), '{ not json')
    const { journeys, skipped } = fold(from)
    expect(journeys.map((j) => j.slug)).toEqual(['one'])
    expect(skipped.map((s) => s.file)).toEqual(['broken.json'])
  })

  test('ignores anything that is not a journey file at all', () => {
    const from = oldStore([{ slug: 'one' }])
    writeFileSync(join(from, 'README.md'), '# not a journey')
    expect(fold(from).skipped).toEqual([])
  })
})

describe('verifying what landed', () => {
  test('is silent when everything came back identical', () => {
    const journey = journeySchema.parse({ slug: 'one', title: 'One' })
    expect(verify([journey], { one: journey })).toEqual([])
  })

  test('says which journey is missing', () => {
    const journey = journeySchema.parse({ slug: 'one', title: 'One' })
    expect(verify([journey], {})[0]).toContain('one')
  })

  test('says which journey came back different', () => {
    const sent = journeySchema.parse({ slug: 'one', title: 'One', steps: [{ title: 'a step' }] })
    const back = journeySchema.parse({ slug: 'one', title: 'One' })
    expect(verify([sent], { one: back })[0]).toContain('different')
  })
})

describe('the migration itself', () => {
  test('says what it would do, and writes nothing, without --apply', () => {
    const from = oldStore([{ slug: 'one', steps: [{ title: 'a step' }] }])
    const into = project()
    const out = migrate(from, into, false)
    expect(out.ok).toBe(true)
    expect(out.moved).toBe(0)
    expect(out.said.join('\n')).toContain('one\t1 steps')
    expect(existsSync(join(into, KEHIKOT_DIR))).toBe(false)
    expect(existsSync(from)).toBe(true)
  })

  test('writes every journey into the project, keyed by slug', () => {
    const from = oldStore([{ slug: 'one' }, { slug: 'two' }])
    const into = project()
    expect(migrate(from, into, true).moved).toBe(2)
    const raw = JSON.parse(readFileSync(join(into, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')) as {
      version: number
      journeys: Record<string, unknown>
    }
    expect(raw.version).toBe(1)
    expect(Object.keys(raw.journeys).sort()).toEqual(['one', 'two'])
  })

  /**
   * The fields this app carries and never draws. `quizzes` and `vocabulary` are
   * the Learning app's, `owners` and `groups` are the ownership table's, and a
   * migration that dropped them would be destroying material in the course of
   * moving material.
   */
  test('carries the fields this app never renders, whole', () => {
    const from = oldStore([
      {
        slug: 'one',
        quizzes: [{ question: 'q?', options: ['a', 'b'], answer: 1, why: 'because' }],
        vocabulary: [{ term: 'kehikko', means: 'a canvas' }],
        owners: { '#1': { maker: 'someone', reviewer: 'another' } },
        groups: [{ heading: 'a group', refs: ['#1', '!2'] }],
        blockedBy: { '#1': ['!2'] },
        settledBy: { '#3': ['gh#4'] },
        steps: [{ title: 'a step', refs: ['#1'], notes: ['no ticket'] }],
      },
    ])
    const into = project()
    expect(migrate(from, into, true).moved).toBe(1)
    const landed = held(into).journeys['one']
    expect(landed?.quizzes).toHaveLength(1)
    expect(landed?.vocabulary).toEqual([{ term: 'kehikko', means: 'a canvas' }])
    expect(landed?.owners).toEqual({ '#1': { maker: 'someone', reviewer: 'another' } })
    expect(landed?.groups).toEqual([{ heading: 'a group', refs: ['#1', '!2'] }])
    expect(landed?.blockedBy).toEqual({ '#1': ['!2'] })
    expect(landed?.settledBy).toEqual({ '#3': ['gh#4'] })
    expect(landed?.steps[0]?.notes).toEqual(['no ticket'])
  })

  /* Renamed, never deleted, and only after the read-back. A bug in the
     verification must not be able to make itself permanent. */
  test('moves the old directory aside rather than deleting it, and only after verifying', () => {
    const from = oldStore([{ slug: 'one' }])
    const into = project()
    expect(migrate(from, into, true).ok).toBe(true)
    expect(existsSync(from)).toBe(false)
    expect(existsSync(`${from}.migrated`)).toBe(true)
    expect(existsSync(join(`${from}.migrated`, 'one.json'))).toBe(true)
  })

  /**
   * The order, stated as a test rather than as a comment. A destination this
   * app will not write under must leave `data/` exactly where it was: a
   * migration that half-happens across two locations is worse than one that has
   * not started.
   */
  test('leaves the old directory alone when the destination is refused', () => {
    const from = oldStore([{ slug: 'one' }])
    const out = migrate(from, join(tmpdir(), 'no-such-project-anywhere'), true)
    expect(out.ok).toBe(false)
    expect(out.moved).toBe(0)
    expect(existsSync(from)).toBe(true)
    expect(existsSync(`${from}.migrated`)).toBe(false)
  })

  /**
   * Refused rather than merged. A destination that already holds journeys is
   * either a migration that has already run — where running it again overwrites
   * whatever has been edited since — or a project with its own journeys, where
   * this would bury them.
   */
  test('refuses a destination that already holds journeys, and writes nothing', () => {
    const from = oldStore([{ slug: 'one' }])
    const into = project()
    mkdirSync(join(into, KEHIKOT_DIR, MINE), { recursive: true })
    const existing = '{"version":1,"journeys":{"already-here":{"slug":"already-here","title":"Already here"}}}\n'
    writeFileSync(join(into, KEHIKOT_DIR, MINE, 'journeys.json'), existing)

    const out = migrate(from, into, true)
    expect(out.ok).toBe(false)
    expect(out.said.join('\n')).toContain('already holds')
    expect(readFileSync(join(into, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')).toBe(existing)
    expect(existsSync(from)).toBe(true)
  })

  /* Which is what makes it safe to run twice: the second run is the refusal
     above rather than a second copy or an overwrite. */
  test('a second run refuses rather than doing it again', () => {
    const from = oldStore([{ slug: 'one' }, { slug: 'two' }])
    const into = project()
    expect(migrate(from, into, true).moved).toBe(2)
    const after = readFileSync(join(into, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')

    /* `data/` is aside now, so the second run finds nothing to move. Put it
       back to test the case that actually bites: somebody restores their backup
       and runs it again. */
    const again = oldStore([{ slug: 'one', title: 'EDITED SINCE' }])
    const out = migrate(again, into, true)
    expect(out.ok).toBe(false)
    expect(readFileSync(join(into, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')).toBe(after)
  })

  test('refuses when there is no project named at all', () => {
    const from = oldStore([{ slug: 'one' }])
    const out = migrate(from, '', true)
    expect(out.ok).toBe(false)
    expect(existsSync(from)).toBe(true)
  })

  /* The seed path, which is the same code with the last step off: material this
     repository ships stays exactly where it is. */
  test('leaves the source where it is when it is not being moved out', () => {
    const from = oldStore([{ slug: 'one' }])
    const into = project()
    const out = migrate(from, into, true, false)
    expect(out.ok).toBe(true)
    expect(out.moved).toBe(1)
    expect(existsSync(from)).toBe(true)
    expect(existsSync(`${from}.migrated`)).toBe(false)
  })
})
