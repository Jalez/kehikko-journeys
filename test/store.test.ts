import { describe, expect, test } from 'bun:test'

import { BODY_WORDS, tooLong } from '../limits.ts'
import { type Journey, isSlug, journeySchema, planOf, refsOf, refusedBecauseElsewhere } from '../store.ts'

const journey = (over: Partial<Journey> = {}): Journey =>
  journeySchema.parse({ slug: 'a-journey', title: 'A journey', ...over })

/**
 * The distinction this app exists to keep.
 *
 * An empty `steps` array means one of two completely different things, and no
 * reader can tell which from the array: nobody has written any, or they are
 * projected out of a paper this app cannot read. Collapsing the two sends a
 * reader to write a step where they should be reading a paper, and it is the
 * bug the whole shape of `planOf` is a response to.
 */
describe('what this app can honestly say about a journey’s steps', () => {
  test('steps written here are stored', () => {
    const plan = planOf(journey({ steps: [{ title: 'one', body: '', refs: [], notes: [] }] }))
    expect(plan.kind).toBe('stored')
  })

  test('no steps and no paper is genuinely none', () => {
    expect(planOf(journey()).kind).toBe('none')
  })

  test('no steps and a paper is elsewhere, which is never none', () => {
    const plan = planOf(journey({ stepsFrom: { projector: 'paper', where: 'chapters/wire.tex', why: '' } }))
    expect(plan.kind).toBe('elsewhere')
  })

  /**
   * Stored steps beside a paper stay editable. They are real, somebody wrote
   * them, and refusing to let them be corrected because a paper exists would
   * strand material this app is the owner of.
   */
  test('stored steps beside a paper are still stored, and still writable', () => {
    const both = journey({
      steps: [{ title: 'one', body: '', refs: [], notes: [] }],
      stepsFrom: { projector: 'paper', where: 'chapters/wire.tex', why: '' },
    })
    expect(planOf(both).kind).toBe('stored')
    expect(refusedBecauseElsewhere(both)).toBeNull()
  })

  /** A refusal that does not say where to write instead is a decision nobody can record. */
  test('a refusal names the file to edit instead', () => {
    const projected = journey({ stepsFrom: { projector: 'paper', where: 'chapters/wire.tex', why: '' } })
    expect(refusedBecauseElsewhere(projected)).toContain('chapters/wire.tex')
  })
})

describe('a slug is a name, not a path', () => {
  test('takes what a journey is called', () => {
    expect(isSlug('modes-are-modules')).toBe(true)
  })

  test('refuses everything that could leave a directory', () => {
    for (const bad of ['../etc/passwd', 'a/b', 'Modes', '', 'a'.repeat(81), 'a.b']) {
      expect(isSlug(bad)).toBe(false)
    }
  })
})

describe('every reference a journey names', () => {
  test('is collected once, in the order it is met', () => {
    const j = journey({
      umbrella: '#1',
      steps: [{ title: 'one', body: '', refs: ['#2', '#1'], notes: [] }],
      blockedBy: { '#2': ['!7'] },
      watch: ['gh#9'],
    })
    expect(refsOf(j)).toEqual(['#1', '#2', '!7', 'gh#9'])
  })
})

describe('the word limit on a step body', () => {
  test('lets an ordinary body through', () => {
    expect(tooLong('short enough')).toBeNull()
  })

  /** Refused rather than trimmed: a sentence cut off mid-air is worse than a no. */
  test('refuses a long one, and says how long it is', () => {
    const why = tooLong('word '.repeat(BODY_WORDS + 1))
    expect(why).toContain(String(BODY_WORDS + 1))
  })
})
