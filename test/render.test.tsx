import { describe, expect, test } from 'bun:test'
import { render } from '@testing-library/react'

import type { JourneyView, Live } from '../src/kinds.ts'
import { Card } from '../src/view/card.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'

/**
 * The two claims this app makes with pixels, asserted in words.
 *
 * Both were prose in a stylesheet comment before the port and could only be
 * checked by looking:
 *
 *  1. A reference nobody has been able to read is drawn as an ABSENCE, and not
 *     as a state. Not "unknown", which reads as a state; not blank, which reads
 *     as fine; and above all not as open or closed.
 *  2. Nothing on this page refuses to wrap except the five short verdicts. A
 *     step's note and a blocker are sentences people write — measured to 110
 *     and 407 characters across the journeys this app ships — and one of them
 *     in a `whitespace-nowrap` box put a 1187-pixel min-content floor under the
 *     whole document inside a 220-pixel container. That is the bug this file exists
 *     to keep from coming back.
 */

const JOURNEY = {
  slug: 'probe',
  title: 'A journey',
  lede: '',
  callout: '',
  steps: [],
  plan: 'stored',
  blockedBy: {
    'gh#1': [
      'gh#2',
      'A production DATA question no agent can answer, written out at the length people actually write these, which is a paragraph rather than a chip and must therefore be allowed to wrap like the prose it is.',
    ],
  },
} satisfies JourneyView

const draw = (live: Live | null, ref: string) =>
  render(
    <ReadingProvider value={{ live, journey: JOURNEY }}>
      <Card refName={ref} />
    </ReadingProvider>,
  )

describe('a reference nobody has read', () => {
  test('says so in words, differently for "nobody looked" and "it was not there"', () => {
    expect(draw(null, 'gh#9').container.textContent).toContain('state not visible from here')
    expect(draw({}, 'gh#9').container.textContent).toContain('not in the last refresh')
  })

  test('never reads as open and never as closed', () => {
    const text = draw(null, 'gh#9').container.textContent ?? ''
    expect(text).not.toContain('opened')
    expect(text).not.toContain('closed')
    expect(text).not.toContain('unknown')
  })

  test('is dashed and unfilled, which is what makes it not look like a state', () => {
    const badge = draw(null, 'gh#9').container.querySelector('[data-slot=badge]')
    expect(badge?.className).toContain('border-dashed')
    expect(badge?.className).not.toContain('bg-seen')
  })

  test('gets no rail dots, because there is no position to show', () => {
    const box = draw(null, 'gh#9').container
    expect(box.querySelector('[role=presentation]')).toBeNull()
    expect(box.textContent).toContain('not seen from here')
  })
})

describe('a reference that was read', () => {
  const LIVE: Live = { ghIssues: { 'gh#1': { state: 'opened', title: 'Something', assignees: ['ada'] } } }

  test('wears the tracker’s own word, an icon, and a colour — never only a colour', () => {
    const badge = draw(LIVE, 'gh#1').container.querySelector('[data-slot=badge]')
    expect(badge?.textContent).toContain('opened')
    expect(badge?.querySelector('svg')).not.toBeNull()
  })

  test('draws all seven rail dots, with the last one dashed forever', () => {
    const dots = draw(LIVE, 'gh#1').container.querySelectorAll('[role=presentation] > span')
    expect(dots.length).toBe(7)
    expect(dots[6]?.className).toContain('border-dashed')
    expect(dots[6]?.className).not.toContain('bg-marker')
  })
})

describe('nothing but a verdict refuses to wrap', () => {
  test('a blocker written as a paragraph is drawn as prose, not as a chip', () => {
    const box = draw(null, 'gh#1').container
    const long = JOURNEY.blockedBy['gh#1'][1] as string
    expect(box.textContent).toContain(long)
    /* If this ever becomes a badge again, it will be a nowrap one, and one
       sentence will widen the whole container. */
    for (const badge of box.querySelectorAll('[data-slot=badge]')) {
      expect(badge.textContent ?? '').not.toContain(long)
    }
  })

  test('every nowrap thing on the card is one short word', () => {
    const box = draw({ ghIssues: { 'gh#1': { state: 'opened' } } }, 'gh#1').container
    for (const node of box.querySelectorAll('*')) {
      if (String(node.className).includes('whitespace-nowrap')) {
        expect((node.textContent ?? '').length).toBeLessThan(32)
      }
    }
  })

  test('the walk can still find this card, and the anchor inside it', () => {
    /* `data-card` and `data-ref` are the contract `goTo` and `showSelection`
       read the page through. They are not styling hooks and dropping either
       would leave every walk landing in the wrong place, silently. */
    const box = draw(null, 'gh#1').container
    expect(box.querySelector('[data-card="gh#1"]')).not.toBeNull()
    expect(box.querySelector('a[data-ref="gh#1"]')).not.toBeNull()
  })
})
