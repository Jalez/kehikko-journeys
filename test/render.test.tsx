import { describe, expect, test } from 'bun:test'
import { render } from '@testing-library/react'

import type { Disposition } from 'roadmap-module-protocol'
import type { Facet } from 'roadmap-module-protocol/facets'

import type { JourneyView, Live } from '../src/kinds.ts'
import { Card } from '../src/view/card.tsx'
import { ReadingProvider } from '../src/view/reading.tsx'
import { Sight } from '../src/view/sight.tsx'
import { StepBlock, bundlesOf, foldSummary } from '../src/view/step.tsx'
import { closedBy, reading, row } from './reading.ts'

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
    expect(draw(reading([]), 'gh#9').container.textContent).toContain('not in the reading')
  })

  test('says which absence it is when the host says why there is no row', () => {
    const pending = draw(reading([], [{ ref: 'gh#9', reason: 'pending' }]), 'gh#9').container.textContent
    expect(pending).toContain('being read')
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
  const LIVE: Live = reading([row('gh#1', { state: 'open', title: 'Something', assignees: ['ada'] })])

  test('wears the tracker’s own word, an icon, and a colour — never only a colour', () => {
    const badge = draw(LIVE, 'gh#1').container.querySelector('[data-slot=badge]')
    expect(badge?.textContent).toContain('open')
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
    const box = draw(reading([row('gh#1', { state: 'open' })]), 'gh#1').container
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

/**
 * The sentence at the top of the page, which is the only thing on it when
 * there is nothing else to draw.
 *
 * `Sight` had four branches and five things to say, so two of them shared one
 * sentence with an "or" in the middle: "No epic is open, or the host named one
 * this app does not hold." With an epic open on the canvas — the common case,
 * and the one that gets reported — that leads with the false clause and sends
 * the reader off to check the host's context for a fault that is not there.
 *
 * These tests hold the two apart by their words, because the words ARE the
 * fix. A component that renders without throwing is no evidence at all that it
 * said the right thing, and the wrong thing here rendered perfectly for months.
 */
describe('what the page says when it is framed and has no journey to draw', () => {
  const say = (epic: string | null) =>
    render(<Sight framed refused={null} epic={epic} journey={null} live={null} />).container.textContent ?? ''

  test('no epic named: says nothing is open, and claims nothing about this app’s store', () => {
    const text = say(null)
    expect(text).toContain('nothing open')
    expect(text).toContain('no epic on the canvas')
    expect(text).not.toContain('holds none')
  })

  test('an epic named with no journey for it: names the epic, and never says none is open', () => {
    const text = say('modes-are-modules')
    expect(text).toContain('modes-are-modules')
    expect(text).toContain('no journey here')
    /* The reported bug, written as the thing that must not come back: an epic
       IS open, so no wording here may suggest that none is. */
    expect(text).not.toContain('nothing open')
    expect(text).not.toContain('No epic is open')
  })

  test('neither offers a picker, because none is drawn while a host is framing us', () => {
    for (const epic of [null, 'modes-are-modules']) expect(say(epic)).not.toContain('below')
  })

  test('both fit a 220-pixel rail, where the paragraph they replaced was a wall one word wide', () => {
    for (const epic of [null, 'modes-are-modules']) {
      expect(say(epic).trim().split(/\s+/).length).toBeLessThan(13)
    }
  })
})

/**
 * A picked step looks picked the way a picked container does.
 *
 * The host draws a picked-out container with a ring in the primary colour and
 * a checkbox that is only how the ring is set; a step here wears the same two
 * things, so that a person who has ticked a container recognises the idea
 * without being told. And the control is drawn only when there is a canvas
 * for it to reach — standalone, a checkbox that ticks nothing is a broken
 * checkbox.
 */
describe('a step that can be picked out on the canvas', () => {
  const STEP = { title: 'Files stay reachable', body: '', refs: ['gh#1', 'gh#2'], notes: [] }
  const EMPTY = { title: 'Somebody says yes', body: '', refs: [], notes: [] }
  const block = (selection: string[], framed = true, step = STEP) =>
    render(
      <ReadingProvider value={{ live: null, journey: JOURNEY }}>
        <StepBlock step={step} index={0} editing={false} selection={selection} framed={framed} />
      </ReadingProvider>,
    ).container

  test('framed, it offers a tick naming what the step carries', () => {
    const box = block([]).querySelector('input[type=checkbox]') as HTMLInputElement
    expect(box).not.toBeNull()
    expect(box.getAttribute('aria-label')).toContain('2 references')
    expect(box.checked).toBe(false)
    expect(box.indeterminate).toBe(false)
  })

  test('standalone, there is no tick, because there is no canvas to reach', () => {
    expect(block([], false).querySelector('input[type=checkbox]')).toBeNull()
  })

  test('wholly picked: ticked, and wearing the host’s ring', () => {
    const box = block(['gh#2', 'gh#1'])
    expect((box.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true)
    const section = box.querySelector('section')!
    expect(section.getAttribute('data-picked')).toBe('all')
    expect(section.className).toContain('ring-2')
    expect(section.className).toContain('ring-inset')
  })

  test('partly picked: indeterminate, and a lighter ring', () => {
    const box = block(['gh#2'])
    const tick = box.querySelector('input[type=checkbox]') as HTMLInputElement
    expect(tick.checked).toBe(false)
    expect(tick.indeterminate).toBe(true)
    expect(box.querySelector('section')?.getAttribute('data-picked')).toBe('some')
  })

  test('a step naming no reference says so on the control rather than ticking nothing', () => {
    const tick = block(['gh#1'], true, EMPTY).querySelector('input[type=checkbox]') as HTMLInputElement
    expect(tick.disabled).toBe(true)
    expect(tick.getAttribute('aria-label')).toContain('names no reference')
    expect(block(['gh#1'], true, EMPTY).querySelector('section')?.getAttribute('data-picked')).toBeNull()
  })
})

/**
 * The badge and the rail say why there is no reading the way the banner does.
 *
 * Inside the host with `tracker.get` refused, the banner read "Framed, and
 * refused" and every card underneath it read "Nothing is framing this page".
 */
describe('a card on a framed page the host gave no reading for', () => {
  const REASON = 'Nothing has been read from the trackers for that epic'
  const drawRefused = () =>
    render(
      <ReadingProvider value={{ live: null, journey: JOURNEY, framed: true, withheld: REASON }}>
        <Card refName="gh#9" />
      </ReadingProvider>,
    ).container

  test('says the host had no reading, and gives its reason', () => {
    const refused = drawRefused()
    const text = refused.textContent ?? ''
    expect(text).toContain('no reading from the host')
    expect(text).toContain(REASON)
    expect(refused.querySelector('[data-slot=badge]')?.getAttribute('title')).toContain(REASON)
  })

  test('never says nothing is framing it', () => {
    const refused = drawRefused()
    expect(refused.textContent).not.toContain('Nothing is framing')
    expect(refused.textContent).not.toContain('state not visible from here')
  })
})

/**
 * An issue folds its changes away, and the fold still counts them.
 */
describe('the changes under an issue', () => {
  const LIVE: Live = reading([
    row('#13', { state: 'open', links: closedBy('!20', '!23', '!24') }),
    row('#14', { state: 'open', links: closedBy('!25') }),
    row('!20', { state: 'open' }),
    row('!23', { state: 'merged' }),
    row('!24', { state: 'closed' }),
    row('!25', { state: 'merged' }),
  ])
  const STEP = { title: 'It appears on the board', body: '', refs: ['#13', '#14'], notes: [] }
  const block = (extra: { unfolded?: string[]; hidden?: Facet[] } = {}) =>
    render(
      <ReadingProvider value={{ live: LIVE, journey: JOURNEY, framed: true, ...extra }}>
        <StepBlock step={STEP} index={0} editing={false} selection={[]} framed />
      </ReadingProvider>,
    ).container

  test('folded by default, with a one-line summary standing in for the changes', () => {
    const box = block()
    expect(box.querySelector('[data-card="!20"]')).toBeNull()
    expect(box.querySelector('[data-card="#13"]')).not.toBeNull()
    const fold = box.querySelector('[data-fold="#13"]')
    expect(fold?.textContent).toContain('3 changes · 1 open · 1 merged · 1 closed')
    expect(fold?.getAttribute('aria-expanded')).toBe('false')
    expect(box.textContent).toContain('expand all')
  })

  test('unfolded, the changes are cards again and the step offers to fold all', () => {
    const box = block({ unfolded: ['#13', '#14'] })
    expect(box.querySelector('[data-card="!20"]')).not.toBeNull()
    expect(box.querySelector('[data-fold="#13"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(box.textContent).toContain('fold all')
  })

  test('a filter hides changes from the summary too, and the step counts what it hid', () => {
    const box = block({ hidden: ['change:closed'] })
    expect(box.querySelector('[data-fold="#13"]')?.textContent).toContain('2 changes · 1 open · 1 merged')
    expect(box.textContent).toContain('1 hidden by the filter')
  })

  test('a step whose every card is filtered out says how many, rather than looking empty', () => {
    const box = block({ hidden: ['issue:open', 'change:open', 'change:merged', 'change:closed'] })
    expect(box.querySelector('[data-card]')).toBeNull()
    expect(box.textContent).toContain('6 hidden by the filter')
  })
})

describe('bundling a step’s cards for folding', () => {
  test('a change kept under an issue the filter hid is drawn loose, not under the wrong issue', () => {
    const drawn = [
      { ref: '#1', under: false },
      { ref: '!2', under: true },
      { ref: '#3', under: false },
      { ref: '!4', under: true },
    ]
    const kept = drawn.filter((card) => card.ref !== '#3')
    expect(bundlesOf(drawn, kept)).toEqual([
      { ref: '#1', under: ['!2'] },
      { ref: '!4', under: [] },
    ])
  })

  test('the summary is singular for one change and lists only states that occur', () => {
    expect(foldSummary(reading([row('!1', { state: 'merged' })]), ['!1'])).toBe('1 change · 1 merged')
    expect(foldSummary(null, ['!1', '!2'])).toBe('2 changes · 2 not seen')
  })
})

/**
 * Why a closed reference closed, and whose word that is.
 */
describe('a closed reference’s disposition', () => {
  const LIVE: Live = reading([
    row('gh#1', { state: 'closed', stateReason: 'NOT_PLANNED' }),
    row('gh#3', { state: 'closed' }),
  ])
  const card = (ref: string, extra: { framed?: boolean; marks?: Disposition[] } = {}) =>
    render(
      <ReadingProvider value={{ live: LIVE, journey: JOURNEY, ...extra }}>
        <Card refName={ref} />
      </ReadingProvider>,
    ).container

  test('the tracker’s reason says it is the tracker’s', () => {
    const text = card('gh#1').textContent ?? ''
    expect(text).toContain('won’t do')
    expect(text).toContain('from the tracker')
  })

  test('a person’s mark says whose it is', () => {
    const marks: Disposition[] = [
      { ref: 'gh#1', value: 'duplicate', target: 'gh#2', note: '', by: 'ada', at: null },
    ]
    const text = card('gh#1', { marks }).textContent ?? ''
    expect(text).toContain('duplicate of gh#2')
    expect(text).toContain('marked by ada')
  })

  test('closed for no known reason asks a person to decide', () => {
    expect(card('gh#3').textContent).toContain('a person should decide')
  })

  test('the control to mark it is offered only while a host is framing the page', () => {
    expect(card('gh#3', { framed: true }).textContent).toContain('mark why')
    expect(card('gh#3').textContent).not.toContain('mark why')
  })
})

/**
 * While the trackers are being read again, the page says so: the states on
 * screen are the reading before, and a reader comparing them with the tracker
 * should know a newer one is on its way.
 */
describe('the page while the trackers are being read again', () => {
  const say = (busy: boolean, live: Live | null) =>
    render(<Sight framed refused={null} epic="probe" journey={JOURNEY} live={live} busy={busy} />).container
      .textContent ?? ''

  test('busy says the trackers are being read, and that what is shown is the reading before', () => {
    const text = say(true, reading([]))
    expect(text).toContain('being read again')
    expect(text).toContain('reading before')
  })

  test('not busy says nothing of the kind', () => {
    expect(say(false, reading([]))).not.toContain('being read again')
  })
})
