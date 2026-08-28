import { describe, expect, test } from 'bun:test'

import type { Live } from '../src/kinds.ts'
import { carriedBy, isChange, isSettled, railOf, stateOf, toneOf } from '../src/live/lookup.ts'

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

const LIVE: Live = {
  issues: {
    '10': { state: 'opened' },
    '11': { state: 'opened', assignees: ['ada'] },
    '12': { state: 'closed' },
    '13': { state: 'opened' },
  },
  mrs: {
    '20': { state: 'opened' },
    '21': { state: 'opened', draft: true },
    '22': { state: 'opened', reviewers: ['lin'] },
    '23': { state: 'merged' },
    '24': { state: 'closed' },
  },
  ghIssues: { 'gh#30': { state: 'opened' }, 'gh:org/repo#31': { state: 'closed' } },
  ghPrs: { 'gh#40': { state: 'opened', draft: true } },
  links: { '13': [20] },
  ghLinks: { 'gh#30': [40] },
}

describe('which bag a reference is filed in', () => {
  test('a bang is always a change, whatever anybody read', () => {
    expect(isChange(null, '!20')).toBe(true)
    expect(isChange(LIVE, '!20')).toBe(true)
  })

  test('a GitHub number is a change only because the refresh filed it as one', () => {
    expect(isChange(LIVE, 'gh#40')).toBe(true)
    expect(isChange(LIVE, 'gh#30')).toBe(false)
    /* With no reading there is nothing to file it by, so it is not claimed as
       a change — the honest answer, not a guess from the spelling. */
    expect(isChange(null, 'gh#40')).toBe(false)
  })

  test('a reading is looked up the way the host files it', () => {
    expect(stateOf(LIVE, '#10')?.state).toBe('opened')
    expect(stateOf(LIVE, '!23')?.state).toBe('merged')
    expect(stateOf(LIVE, 'gh#40')?.state).toBe('opened')
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
})

describe('the tone a badge wears', () => {
  test('no sighting is unseen, and unseen is not a state', () => {
    expect(toneOf(null)).toBe('unseen')
  })

  test('the four real ones', () => {
    expect(toneOf({ state: 'merged' })).toBe('merged')
    expect(toneOf({ state: 'closed' })).toBe('closed')
    expect(toneOf({ state: 'opened', draft: true })).toBe('draft')
    expect(toneOf({ state: 'opened' })).toBe('open')
  })

  test('merged wins over draft, because it already landed', () => {
    expect(toneOf({ state: 'merged', draft: true })).toBe('merged')
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
    expect(missed.word).toBe('not in the last refresh')
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
    expect(railOf(LIVE, '#12')).toMatchObject({ now: 5, word: 'In dev' })
  })

  test('nothing ever reaches In prod, because that is read from a repository', () => {
    for (const ref of ['#10', '#11', '#12', '#13', '!20', '!21', '!22', '!23', '!24', 'gh#30', 'gh#40']) {
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
    expect(isSettled(LIVE, ['#12', '!23'])).toBe(true)
    expect(isSettled(LIVE, ['#12', '#10'])).toBe(false)
    expect(isSettled(LIVE, ['#12', '#999'])).toBe(false)
    expect(isSettled(null, ['#12'])).toBe(false)
  })
})
