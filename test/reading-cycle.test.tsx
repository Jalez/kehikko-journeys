import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { mailbox } from 'kehikot-module-protocol/client'

import { App, BUSY_SAID, failedSaid } from '../src/app.tsx'
import { heldOver, readingOf } from '../src/live/lookup.ts'
import { Boundary, PAGE_FAILED } from '../src/view/boundary.tsx'
import { settle, started, store, stubHost, type Wire } from './host.ts'
import { AT, answerOf, row } from './reading.ts'

/**
 * Jalez/kehikko-journeys#39: "Journey goes black when tracker reading takes place."
 *
 * The page is driven through a whole read the way a host drives it — `context.tracker` says a read
 * started, `tracker.get` answers at once with `pending` for what is not read yet, a read fails, a
 * read lands — and at every point the journey is on screen, the same nodes as before, with the
 * states it last knew. And when something does throw while drawing, the page says so in words with
 * a Reload, instead of React unmounting the root and leaving the dark background on its own.
 */
let wire: Wire
let projects = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  store.reset()
})

const LATER = '2026-10-05T11:00:00.000Z'
const LATEST = '2026-10-05T12:00:00.000Z'

/** The stand-in journey names gh#1 and gh#2 in step one and gh#3 in step two. */
const READ = answerOf([
  row('gh#1', { state: 'open', title: 'First' }),
  row('gh#2', { state: 'closed', stateReason: 'COMPLETED', title: 'Second' }),
  row('gh#3', { state: 'open', title: 'Third' }),
])

async function framed() {
  const host = stubHost()
  projects += 1
  const projectPath = `/Users/somebody/Projects/reading-${projects}`
  host.greet([], { projectPath, tracker: { at: AT, refreshing: false } })
  await settle()
  render(<App />)
  await settle()
  host.answer('tracker.get', READ)
  await settle()
  const context = (more: { tracker: { at: string | null; refreshing: boolean } }) => host.context([], 'probe', { projectPath, ...more })
  return { host, context }
}

const card = (ref: string) => document.querySelector(`[data-card="${ref}"]`)?.textContent ?? ''
const line = () => document.querySelector('[aria-live=polite]')?.textContent ?? ''
const step = (n: number) => document.querySelector(`[data-step="${n}"]`)

describe('while the host reads the trackers again', () => {
  test('the journey stays on screen, the same nodes, with a quiet "Reading the tracker…" note', async () => {
    const { context } = await framed()
    const first = step(1)
    expect(first).not.toBeNull()
    expect(card('gh#2')).toContain('closed')

    context({ tracker: { at: AT, refreshing: true } })
    await settle()
    expect(line()).toBe(BUSY_SAID)
    expect(BUSY_SAID).toStartWith('Reading the tracker…')
    expect(document.querySelector('[data-reading]')).not.toBeNull()
    expect(document.querySelector('[data-reading-note]')?.textContent).toContain('reading the tracker…')
    /* Not redrawn from nothing: the very same element, with what it said before. */
    expect(step(1)).toBe(first)
    expect(card('gh#2')).toContain('closed')
    expect(document.body.textContent).toContain('A journey')

    /* The read lands: the note goes, and the journey is still the same nodes. */
    context({ tracker: { at: LATER, refreshing: false } })
    await settle()
    expect(document.querySelector('[data-reading-note]')).toBeNull()
    expect(line()).toBe('')
    expect(step(1)).toBe(first)
  })

  test('a partial reading keeps the last state of what is not read yet, and says "not read yet" only for what was never read', async () => {
    const { host, context } = await framed()
    const first = step(1)
    context({ tracker: { at: LATER, refreshing: true } })
    await settle()
    /* The host answers at once: gh#1 read again, gh#2 and gh#3 not got to yet. */
    host.answer(
      'tracker.get',
      answerOf([row('gh#1', { state: 'closed', stateReason: 'COMPLETED', title: 'First' })], [
        { ref: 'gh#2', reason: 'pending' },
        { ref: 'gh#3', reason: 'pending' },
      ], { at: LATER, refreshing: true }),
    )
    await settle()
    expect(card('gh#1')).toContain('closed')
    expect(card('gh#2')).toContain('closed')
    expect(card('gh#3')).toContain('open')
    expect(card('gh#2')).not.toContain('not read yet')
    expect(step(1)).toBe(first)
    expect(wire.getSnapshot().live?.at).toBe(LATER)
  })

  test('a ref no reading has ever had a row for says "not read yet" while it is pending', () => {
    const before = readingOf([answerOf([row('gh#1', { state: 'open' })])])
    const next = readingOf([answerOf([], [{ ref: 'gh#1', reason: 'pending' }, { ref: 'gh#9', reason: 'pending' }, { ref: 'gh#4', reason: 'not-found' }])])
    const held = heldOver(before, next)
    expect(held.rows.get('gh#1')?.state).toBe('open')
    expect(held.missing.has('gh#1')).toBe(false)
    expect(held.missing.get('gh#9')).toBe('pending')
    /* An answer that it is gone is an answer, and is not papered over. */
    expect(held.missing.get('gh#4')).toBe('not-found')
    expect(heldOver(null, next)).toBe(next)
  })

  test('a failed read leaves the last reading drawn and says the states are the reading before', async () => {
    const { host, context } = await framed()
    const first = step(1)
    context({ tracker: { at: LATER, refreshing: true } })
    await settle()
    host.refuse('the tracker read failed: gh exited 1', 'tracker.get')
    await settle()
    expect(wire.getSnapshot().live).not.toBeNull()
    expect(card('gh#2')).toContain('closed')
    expect(card('gh#2')).not.toContain('no reading from the host')
    expect(step(1)).toBe(first)

    /* The read is over: the line says what is on screen and why. */
    context({ tracker: { at: LATER, refreshing: false } })
    await settle()
    expect(line()).toBe(failedSaid('the tracker read failed: gh exited 1'))

    /* The next read that lands clears it. */
    context({ tracker: { at: LATEST, refreshing: false } })
    await settle()
    host.answer('tracker.get', answerOf([row('gh#2', { state: 'open', title: 'Second' })], [], { at: LATEST }))
    await settle()
    expect(line()).toBe('')
    expect(card('gh#2')).toContain('open')
  })

  test('the first reading failing is still said beside each reference, as before', async () => {
    const host = stubHost()
    projects += 1
    host.greet([], { projectPath: `/Users/somebody/Projects/reading-${projects}` })
    await settle()
    render(<App />)
    await settle()
    host.refuse('trackers:read is not granted', 'tracker.get')
    await settle()
    expect(wire.getSnapshot().live).toBeNull()
    expect(card('gh#1')).toContain('no reading from the host')
    expect(document.body.textContent).toContain('A journey')
  })
})

function Thrower({ what }: { what: string }): never {
  throw new Error(what)
}

describe('a throw while drawing', () => {
  test('is the error in words and a Reload, never an empty page', () => {
    const was = console.error
    console.error = () => {}
    try {
      render(
        <Boundary>
          <Thrower what="Cannot read properties of undefined (reading 'name')" />
        </Boundary>,
      )
    } finally {
      console.error = was
    }
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(PAGE_FAILED)
    expect(alert.textContent).toContain("Cannot read properties of undefined (reading 'name')")
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  test('inside one step it costs that step, and is drawn again when what it was given changes', () => {
    const was = console.error
    console.error = () => {}
    let bad = true
    function Maybe() {
      if (bad) throw new Error('a bad row')
      return <p>drawn</p>
    }
    try {
      const { rerender } = render(
        <div>
          <p>the rest of the journey</p>
          <Boundary size="part" name="step 2" reset={1}>
            <Maybe />
          </Boundary>
        </div>,
      )
      expect(document.body.textContent).toContain('the rest of the journey')
      expect(screen.getByRole('alert').textContent).toContain('Step 2 could not be drawn: a bad row')
      bad = false
      rerender(
        <div>
          <p>the rest of the journey</p>
          <Boundary size="part" name="step 2" reset={2}>
            <Maybe />
          </Boundary>
        </div>,
      )
      expect(screen.queryByRole('alert')).toBeNull()
      expect(document.body.textContent).toContain('drawn')
      bad = true
      rerender(
        <div>
          <Boundary size="part" name="step 2" reset={3}>
            <Maybe />
          </Boundary>
        </div>,
      )
      bad = false
      fireEvent.click(screen.getByRole('button', { name: 'draw it again' }))
      expect(document.body.textContent).toContain('drawn')
    } finally {
      console.error = was
    }
  })
})
