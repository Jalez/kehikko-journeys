import { describe, expect, test } from 'bun:test'

import { firstShown, isTracked, samePick } from '../src/refs.ts'

/**
 * Which reference a broadcast selection lands on, tested without a browser.
 *
 * The scroll itself needs a page and is measured in one. This is the decision
 * taken before the scroll: given what the canvas says was picked and what this
 * page is showing, which reference — if any — is this container's to walk to.
 * Getting it wrong has no visible failure to report it. A miss looks exactly
 * like a selection about another journey, which is the case this deliberately
 * treats as ordinary, so nothing on screen would ever say the choosing was
 * broken. It broke once already, in exactly that silent way — see the note on
 * `firstShown` about the cards a tracker carries in.
 */

/* What a real epic's page holds: the refs its steps name, plus the changes the
   host's reading attached to those issues, which are on screen as cards and are
   in no journey document anywhere. */
const shown = new Set(['gh#1802', 'gh#1914', 'gh#1786', 'gh#1785', '#2274', '!1800', 'gh:other/repo#7'])

describe('picking one reference out of a selection', () => {
  test('answers the ref this page is showing', () => {
    expect(firstShown(shown, ['gh#1802'])).toBe('gh#1802')
  })

  test('answers a card the tracker carried in, not only what the journey wrote', () => {
    /* `gh#1914` is a change the host's last refresh attached to an issue. It is
       a card on screen with a link in it, so it is walkable — and the version
       of this that read the journey document said it was not. */
    expect(firstShown(shown, ['gh#1914'])).toBe('gh#1914')
  })

  test('walks the selection’s order, not the page’s', () => {
    /* `gh#1802` comes first on the page and second in the pick. The sender's
       order is the only hint of intent there is, so it wins. */
    expect(firstShown(shown, ['gh#1785', 'gh#1802'])).toBe('gh#1785')
  })

  test('skips refs this page does not hold rather than giving up at the first', () => {
    expect(firstShown(shown, ['gh#31337', 'gh#1786'])).toBe('gh#1786')
  })

  test('a selection about another journey answers null, quietly', () => {
    expect(firstShown(shown, ['gh#31337'])).toBe(null)
  })

  test('an empty or absent selection is a state, not a mistake', () => {
    expect(firstShown(shown, [])).toBe(null)
    expect(firstShown(shown, undefined)).toBe(null)
  })

  test('a page showing nothing matches nothing', () => {
    expect(firstShown(new Set(), ['gh#1802'])).toBe(null)
    expect(firstShown(null, ['gh#1802'])).toBe(null)
  })

  test('takes any iterable, because the caller hands over what it read off the DOM', () => {
    expect(firstShown(['#7', '#9'], ['#9'])).toBe('#9')
  })

  test('does not confuse a GitHub number with a GitLab one', () => {
    /* `gh#1802` is on the page and `#1802` is not. Normalising the two towards
       each other would outline the wrong card and claim it was the right one. */
    expect(firstShown(shown, ['#1802'])).toBe(null)
  })

  test('every shape of reference this app draws can be selected', () => {
    expect(firstShown(shown, ['!1800'])).toBe('!1800')
    expect(firstShown(shown, ['#2274'])).toBe('#2274')
    expect(firstShown(shown, ['gh:other/repo#7'])).toBe('gh:other/repo#7')
  })
})

describe('telling one selection from the one before it', () => {
  test('the same refs in the same order are the same pick', () => {
    expect(samePick(['#1', '#2'], ['#1', '#2'])).toBe(true)
    expect(samePick([], [])).toBe(true)
  })

  test('a different order is a different pick, because the first one is acted on', () => {
    expect(samePick(['#1', '#2'], ['#2', '#1'])).toBe(false)
  })

  test('adding to or clearing a pick is a change', () => {
    expect(samePick(['#1'], ['#1', '#2'])).toBe(false)
    expect(samePick(['#1'], [])).toBe(false)
  })
})

describe('the grammar, which decides what is a reference at all', () => {
  test('the four shapes the roadmap parses', () => {
    expect(isTracked('#2274')).toBe(true)
    expect(isTracked('!1800')).toBe(true)
    expect(isTracked('gh#41')).toBe(true)
    expect(isTracked('gh:org/repo#41')).toBe(true)
  })

  test('a gate outside every tracker is prose, and never becomes a link', () => {
    expect(isTracked('somebody has to say yes')).toBe(false)
    expect(isTracked('')).toBe(false)
  })
})
