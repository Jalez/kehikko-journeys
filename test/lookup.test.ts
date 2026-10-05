import { describe, expect, test } from 'bun:test'

import type { Disposition } from 'roadmap-module-protocol'

import type { JourneyView, Live } from '../src/kinds.ts'
import {
  absenceOf,
  carriedBy,
  facetsOfRef,
  isChange,
  isSettled,
  railOf,
  readingOf,
  refsOf,
  standing,
  stateOf,
  toneOf,
  unreadLinks,
  verdictOf,
} from '../src/live/lookup.ts'
import { answerOf, closedBy, reading, row } from './reading.ts'

/**
 * The rail is the one thing on this page that makes a CLAIM.
 *
 * Every other pixel restates something a person wrote or a tracker said. This
 * derives a position on a seven-word line out of a reading, which means it is
 * the one thing that can be WRONG rather than merely ugly — and until the port
 * it could only be checked by opening a browser and looking at a dot. These
 * tests exist because `railOf` became a function of its reading rather than of
 * a module-level variable, which is most of the reason that change was worth
 * making.
 */

const LIVE: Live = reading([
  row('#10', { state: 'open' }),
  row('#11', { state: 'open', assignees: ['ada'] }),
  row('#12', { state: 'closed' }),
  row('#13', { state: 'open', links: closedBy('!20') }),
  /* Closed with a merged change under it: the host says so in `closedByMerge`. */
  row('#14', { state: 'closed', closedByMerge: true, links: closedBy('!23') }),
  row('!20', { state: 'open' }),
  row('!21', { state: 'open', draft: true }),
  row('!22', { state: 'open', review: 'approved' }),
  row('!23', { state: 'merged' }),
  row('!24', { state: 'closed' }),
  row('!25', { state: 'open', review: 'required' }),
  row('gh#30', { state: 'open', links: closedBy('gh#40') }),
  row('gh:org/repo#31', { state: 'closed' }),
  row('gh#40', { kind: 'change', state: 'open', draft: true }),
])

describe('what a reference is, by its row', () => {
  test('a bang is always a change, whatever anybody read', () => {
    expect(isChange(null, '!20')).toBe(true)
    expect(isChange(LIVE, '!20')).toBe(true)
  })

  test('a GitHub number is a change only because its row says so', () => {
    expect(isChange(LIVE, 'gh#40')).toBe(true)
    expect(isChange(LIVE, 'gh#30')).toBe(false)
    /* With no reading there is nothing to file it by, so it is not claimed as
       a change — the honest answer, not a guess from the spelling. */
    expect(isChange(null, 'gh#40')).toBe(false)
  })

  test('a reading is looked up by the spelling it was asked for', () => {
    expect(stateOf(LIVE, '#10')?.state).toBe('open')
    expect(stateOf(LIVE, '!23')?.state).toBe('merged')
    expect(stateOf(LIVE, 'gh#40')?.state).toBe('open')
    expect(stateOf(LIVE, 'gh:org/repo#31')?.state).toBe('closed')
    expect(stateOf(LIVE, '#999')).toBeNull()
    expect(stateOf(LIVE, 'not-a-ref')).toBeNull()
  })

  test('with no reading at all, nothing is known about anything', () => {
    expect(stateOf(null, '#10')).toBeNull()
    expect(carriedBy(null, '#13')).toEqual([])
  })

  test('changes attached to an issue are read, never guessed', () => {
    expect(carriedBy(LIVE, '#13')).toEqual(['!20'])
    expect(carriedBy(LIVE, 'gh#30')).toEqual(['gh#40'])
    expect(carriedBy(LIVE, '#10')).toEqual([])
  })

  test('only a change’s own claim attaches it: a `closes` link on an issue attaches nothing', () => {
    const odd = reading([row('#1', { state: 'open', links: [{ ref: '!2', relation: 'closes' }] })])
    expect(carriedBy(odd, '#1')).toEqual([])
  })
})

describe('the tone a badge wears', () => {
  test('no sighting is unseen, and unseen is not a state', () => {
    expect(toneOf(null)).toBe('unseen')
  })

  test('the four real ones', () => {
    expect(toneOf(row('!1', { state: 'merged' }))).toBe('merged')
    expect(toneOf(row('!1', { state: 'closed' }))).toBe('closed')
    expect(toneOf(row('!1', { state: 'open', draft: true }))).toBe('draft')
    expect(toneOf(row('!1', { state: 'open' }))).toBe('open')
  })

  test('merged wins over draft, because it already landed', () => {
    expect(toneOf(row('!1', { state: 'merged', draft: true }))).toBe('merged')
  })
})

describe('the rail', () => {
  test('an unread reference gets no position at all', () => {
    const unhosted = railOf(null, '#10')
    expect(unhosted.unseen).toBe(true)
    expect(unhosted.now).toBe(-1)
    expect(unhosted.word).toBe('not seen from here')

    const missed = railOf(LIVE, '#999')
    expect(missed.unseen).toBe(true)
    expect(missed.now).toBe(-1)
    expect(missed.word).toBe('not in the reading')
    /* Two different absences, two different sentences: one is "nobody looked",
       the other is "somebody looked and it was not there". */
    expect(missed.why).not.toBe(unhosted.why)
  })

  test('a change walks the line by what the tracker says about it', () => {
    expect(railOf(LIVE, '!21')).toMatchObject({ now: 2, word: 'In progress' })
    expect(railOf(LIVE, '!22')).toMatchObject({ now: 3, word: 'In review' })
    expect(railOf(LIVE, '!20')).toMatchObject({ now: 4, word: 'PR open' })
    expect(railOf(LIVE, '!23')).toMatchObject({ now: 5, word: 'In dev' })
  })

  test('a review still owed is not a review', () => {
    expect(railOf(LIVE, '!25')).toMatchObject({ now: 4, word: 'PR open' })
  })

  test('a change that closed without merging is not on the line', () => {
    const closed = railOf(LIVE, '!24')
    expect(closed.now).toBe(-1)
    expect(closed.word).toBe('Closed without merging')
    /* Not `unseen`: it WAS read. It simply has no position, which is a third
       thing and has to stay a third thing. */
    expect(closed.unseen).toBeUndefined()
  })

  test('an issue is Todo, Taken, PR open or In dev, and never further', () => {
    expect(railOf(LIVE, '#10')).toMatchObject({ now: 0, word: 'Todo' })
    expect(railOf(LIVE, '#11')).toMatchObject({ now: 1, word: 'Taken' })
    expect(railOf(LIVE, '#13')).toMatchObject({ now: 4, word: 'PR open' })
    /* Closed with a merged change under it: GitLab's sign that it was done. */
    expect(railOf(LIVE, '#14')).toMatchObject({ now: 5, word: 'In dev' })
  })

  test('an issue closed with no reason anybody can read is not In dev, and says a person should decide', () => {
    const rail = railOf(LIVE, '#12')
    expect(rail).toMatchObject({ now: -1, word: 'Closed, reason unknown' })
    expect(rail.why).toContain('person')
  })

  test('nothing ever reaches In prod, because that is read from a repository', () => {
    for (const ref of ['#10', '#11', '#12', '#13', '!20', '!21', '!22', '!23', '!24', '!25', 'gh#30', 'gh#40']) {
      expect(railOf(LIVE, ref).now).toBeLessThan(6)
    }
  })
})

describe('whether a step is settled', () => {
  test('a step naming nothing is never done', () => {
    /* `every` over an empty list is vacuously true, which would put "done" on
       every step of a journey nobody has attached any work to yet. */
    expect(isSettled(LIVE, [])).toBe(false)
  })

  test('every reference has to have finished, and to have been READ', () => {
    expect(isSettled(LIVE, ['#14', '!23'])).toBe(true)
    expect(isSettled(LIVE, ['#14', '#10'])).toBe(false)
    expect(isSettled(LIVE, ['#14', '#999'])).toBe(false)
    expect(isSettled(null, ['#14'])).toBe(false)
  })
})

/**
 * Three absences, worded the way the banner words them.
 *
 * The bug this guards: inside the host, framed, with `tracker.get` refused, the
 * banner said "Framed, and refused" and every card underneath it said
 * "Nothing is framing this page". `live` is null in both cases, so a rail
 * that asked only `live` could not tell them apart.
 */
describe('a reference with no reading, by why there is none', () => {
  test('unframed, framed-and-refused, and framed with a reading are three sentences', () => {
    const alone = railOf(null, '#10')
    const refused = railOf(null, '#10', { framed: true, withheld: 'Nothing has been read from the trackers for that epic' })
    const missed = railOf(LIVE, '#999', { framed: true })
    expect(alone.why).toContain('Nothing is framing this page')
    expect(refused.word).toBe('no reading from the host')
    expect(refused.why).toContain('Nothing has been read from the trackers for that epic')
    expect(refused.why).not.toContain('Nothing is framing')
    expect(missed.word).toBe('not in the reading')
  })

  test('with a reading, the host’s own reason for a missing row is what the card says', () => {
    const live = reading(
      [],
      [
        { ref: 'gh#1', reason: 'pending' },
        { ref: 'gh#2', reason: 'not-found' },
        { ref: 'gh#3', reason: 'no-tracker' },
        { ref: 'gh#4', reason: 'failed' },
      ],
    )
    expect(railOf(live, 'gh#1')).toMatchObject({ unseen: true, word: 'being read' })
    expect(railOf(live, 'gh#2').word).toBe('not found')
    expect(railOf(live, 'gh#3').word).toBe('no tracker for it')
    expect(railOf(live, 'gh#4').word).toBe('read failed')
    /* Four reasons, four sentences: each sends a reader somewhere else. */
    expect(new Set(['gh#1', 'gh#2', 'gh#3', 'gh#4'].map((ref) => absenceOf(live, {}, ref).why)).size).toBe(4)
  })

  test('a failed read quotes the source’s own error', () => {
    const live = readingOf([
      answerOf([], [{ ref: 'gh#1', reason: 'failed' }], {
        sources: [
          {
            tracker: 'github',
            host: 'github.com',
            repo: 'org/repo',
            default: true,
            listed: false,
            at: null,
            error: 'gh is not logged in',
            refreshing: false,
          },
        ],
      }),
    ])
    expect(absenceOf(live, {}, 'gh#1').why).toContain('gh is not logged in')
  })

  test('framed with nothing handed over and no reason given still does not claim to be unframed', () => {
    const quiet = railOf(null, '#10', { framed: true })
    expect(quiet.unseen).toBe(true)
    expect(quiet.why).not.toContain('Nothing is framing')
  })
})

describe('why a reference closed', () => {
  const READ: Live = reading([
    row('gh#1', { state: 'closed', stateReason: 'NOT_PLANNED' }),
    row('gh#2', { state: 'closed', stateReason: 'COMPLETED' }),
    row('gh#3', { state: 'closed' }),
    row('gh#4', { state: 'open' }),
    row('gh#5', { state: 'closed', stateReason: 'DUPLICATE' }),
    row('gh#9', { kind: 'change', state: 'merged' }),
    row('gh#8', { kind: 'change', state: 'closed' }),
  ])
  const mark = (ref: string, value: Disposition['value'], target: string | null = null): Disposition => ({
    ref,
    value,
    target,
    note: '',
    by: 'ada',
    at: '2026-10-05T10:00:00Z',
  })

  test('the tracker’s reason is a default, and says it is the tracker’s', () => {
    expect(verdictOf(READ, 'gh#1')).toMatchObject({ value: 'wont-do', source: 'tracker' })
    expect(verdictOf(READ, 'gh#2')).toMatchObject({ value: 'done', source: 'tracker' })
    expect(verdictOf(READ, 'gh#9')).toMatchObject({ value: 'done', source: 'tracker' })
    expect(verdictOf(READ, 'gh#3')).toMatchObject({ value: 'unknown', source: null })
    expect(verdictOf(READ, 'gh#4')).toMatchObject({ value: null })
  })

  test('a person’s mark wins over the tracker', () => {
    const marks = [mark('gh#2', 'superseded', 'gh#7')]
    expect(verdictOf(READ, 'gh#2', { marks })).toMatchObject({ value: 'superseded', source: 'person' })
    expect(railOf(READ, 'gh#2', { marks })).toMatchObject({ now: -1, word: 'Superseded by gh#7' })
    expect(railOf(READ, 'gh#2', { marks }).why).toContain('ada')
  })

  test('settledBy is done once its answering changes merged, and only then', () => {
    expect(verdictOf(READ, 'gh#4', { settledBy: { 'gh#4': ['gh#9'] } })).toMatchObject({
      value: 'done',
      source: 'journey',
    })
    expect(verdictOf(READ, 'gh#4', { settledBy: { 'gh#4': ['gh#9', 'gh#8'] } }).value).toBeNull()
    expect(railOf(READ, 'gh#4', { settledBy: { 'gh#4': ['gh#9'] } })).toMatchObject({ now: 5, word: 'In dev' })
    /* And a person can still overrule the journey. */
    expect(
      verdictOf(READ, 'gh#4', { settledBy: { 'gh#4': ['gh#9'] }, marks: [mark('gh#4', 'wont-do')] }).value,
    ).toBe('wont-do')
  })

  test('the facets a filter reads, from the shared vocabulary', () => {
    expect(facetsOfRef(READ, 'gh#1')).toEqual(['issue:closed', 'closed:wont-do'])
    expect(facetsOfRef(READ, 'gh#9')).toEqual(['change:merged', 'closed:done'])
    expect(facetsOfRef(READ, 'gh#8')).toEqual(['change:closed', 'closed:unknown'])
    expect(facetsOfRef(READ, 'gh#4')).toEqual(['issue:open'])
    /* Unread has no facets, so no filter can hide it. */
    expect(facetsOfRef(null, 'gh#1')).toEqual([])
  })

  test('done settles; won’t do, duplicate and superseded neither settle nor block', () => {
    expect(standing(READ, ['gh#2', 'gh#1'])).toMatchObject({ settled: true, done: ['gh#2'] })
    expect(standing(READ, ['gh#2', 'gh#5']).aside).toEqual([{ ref: 'gh#5', value: 'duplicate' }])
    expect(isSettled(READ, ['gh#2', 'gh#5'])).toBe(true)
    /* Nothing delivered is not done, however tidily it was set aside. */
    expect(isSettled(READ, ['gh#1', 'gh#5'])).toBe(false)
    expect(isSettled(READ, ['gh#2', 'gh#4'])).toBe(false)
  })

  test('closed for no known reason holds "done" back and is listed for a person to decide', () => {
    const where = standing(READ, ['gh#2', 'gh#3'])
    expect(where.settled).toBe(false)
    expect(where.undecided).toEqual(['gh#3'])
    expect(isSettled(READ, ['gh#2', 'gh#3'], { marks: [mark('gh#3', 'done')] })).toBe(true)
  })
})

describe('what this page asks the host about', () => {
  const JOURNEY: JourneyView = {
    slug: 'probe',
    title: 'Probe',
    lede: 'Starts from #7 and local#a.',
    callout: 'See gh:org/other#8.',
    plan: 'stored',
    blockedBy: { 'gh#1': ['gh#9', 'a sentence somebody wrote'] },
    settledBy: { 'gh#2': ['gh#10'] },
    steps: [
      { title: 'One', body: 'Mentions !11.', refs: ['gh#1', 'gh#2', 'local#b'], notes: [] },
      { title: 'Two', body: '', refs: ['gh#1', 'gh#3'], notes: [] },
    ],
  }

  test('every ref the journey names that a tracker could answer, once each', () => {
    /* No `local#…`: no tracker answers one. No sentence from `blockedBy`. */
    expect(refsOf(JOURNEY)).toEqual(['#7', 'gh:org/other#8', 'gh#1', 'gh#2', '!11', 'gh#3', 'gh#10', 'gh#9'])
  })

  test('nothing for no journey, and nothing from steps kept elsewhere', () => {
    expect(refsOf(null)).toEqual([])
    expect(refsOf({ ...JOURNEY, plan: 'elsewhere', lede: '', callout: '', blockedBy: {}, settledBy: {} })).toEqual([])
  })

  test('the changes the reading links to and holds no row for are the second question', () => {
    const live = reading([
      row('gh#1', { state: 'open', links: closedBy('gh#20', 'gh#21') }),
      row('gh#21', { kind: 'change', state: 'open' }),
    ])
    expect(unreadLinks(live)).toEqual(['gh#20'])
  })

  test('answers put together: a later row beats an earlier pending, and the newest `at` wins', () => {
    const live = readingOf([
      answerOf([], [{ ref: 'gh#1', reason: 'pending' }], { at: '2026-10-05T09:00:00.000Z' }),
      answerOf([row('gh#1', { state: 'open' })], [], { at: '2026-10-05T11:00:00.000Z' }),
    ])
    expect(live.missing.has('gh#1')).toBe(false)
    expect(stateOf(live, 'gh#1')?.state).toBe('open')
    expect(live.at).toBe('2026-10-05T11:00:00.000Z')
  })
})
