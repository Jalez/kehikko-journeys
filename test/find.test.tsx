import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { FIND_MARK_ATTRIBUTE, pageFind } from 'kehikot-module-protocol/client'

import type { JourneyView, Live } from '../src/kinds.ts'
import { Card } from '../src/view/card.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'
import { reading, row } from './reading.ts'

/**
 * Find (protocol 2.69.0). This page's text is plain DOM, so the host's find bar is answered by the
 * protocol client's own search with no code here: it walks the visible text, marks the matches,
 * moves between them and clears them. This holds that it does so on what this page renders.
 * Marked here with `<mark>` (the test document has no `CSS.highlights`), which also proves the
 * marks come back out of React's DOM without a trace.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const JOURNEY = {
  slug: 'probe',
  title: 'A journey',
  lede: '',
  callout: '',
  steps: [],
  plan: 'stored',
  blockedBy: { 'gh#1': ['gh#2', 'A data question about the data store, which blocks the data import.'] },
} satisfies JourneyView

const LIVE: Live = reading([row('gh#1', { state: 'open', title: 'Import the data', assignees: ['ada'] })])

function drawn() {
  return render(
    <ReadingProvider value={{ live: LIVE, journey: JOURNEY }}>
      <Card refName="gh#1" />
    </ReadingProvider>,
  ).container
}

const options = { caseSensitive: false, wholeWord: true }
const marks = (root: Element) => [...root.querySelectorAll(`mark[${FIND_MARK_ATTRIBUTE}]`)]

describe('find on a journey', () => {
  test('marks and counts what the page shows, and moves between the matches', () => {
    const root = drawn()
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    const { total: expected, current } = search.run('data', options, 'first')
    /* The blocker's sentence says it three times, and the reference's title once more. */
    expect(expected).toBeGreaterThanOrEqual(4)
    expect(current).toBe(1)
    expect(marks(root)).toHaveLength(expected)
    expect(marks(root).every((mark) => mark.textContent?.toLowerCase() === 'data')).toBe(true)
    expect(search.run('data', options, 'next')).toEqual({ total: expected, current: 2 })
    expect(search.run('data', options, 'prev')).toEqual({ total: expected, current: 1 })
    expect(search.run('data', options, 'prev')).toEqual({ total: expected, current: expected })
    expect(root.querySelectorAll('[data-current]')).toHaveLength(1)
    search.close()
  })

  test('close clears every mark and leaves the page as React drew it', () => {
    const root = drawn()
    const before = root.innerHTML
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    search.run('data', options, 'first')
    search.close()
    expect(marks(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(before)
  })
})
