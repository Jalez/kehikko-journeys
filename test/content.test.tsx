import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { CONTENT_HOST, methodParams } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { ID } from '../manifest.ts'
import { App } from '../src/app.tsx'
import { JOURNEY, scrolls, settle, started, store, stubHost, type Wire } from './host.ts'
import { answerOf, closedBy, row } from './reading.ts'

/**
 * The material moving under an open page, over the real client on the real
 * `window`.
 *
 * A journey used to be read once, when its epic opened, and a step written
 * through this app's own MCP door — by an agent, from the server process, with
 * no channel to this page — stayed invisible until the window was reloaded.
 * The host now says so in `context.content`, and this file is about the two
 * halves of answering it: reading again when, and only when, the entries for
 * what this page shows have moved, and saying so after a write made here.
 *
 * What it is most about is what must NOT happen. A context arrives after every
 * click in every container, and the rule `context` in `journeys.ts` keeps —
 * nothing is fetched because a context arrived — is the reason a reader's
 * scroll survives somebody else's click. So every case counts the requests,
 * and the cases that expect none are as much the point as the one that
 * expects one.
 *
 * The host half is Jalez/kehikko#40 and cannot be framed against from here,
 * so the stand-in sends the context a host would and the protocol's own
 * `methodParams` reads what this page asks.
 */

const READ = answerOf([
  row('gh#1', { state: 'open', links: closedBy('gh#7') }),
  row('gh#7', { kind: 'change', state: 'open' }),
  row('gh#2', { state: 'closed' }),
  row('gh#3', { state: 'open' }),
])

const T1 = '2026-10-06T09:00:00.000Z'
const T2 = '2026-10-06T09:00:01.000Z'
const T3 = '2026-10-06T09:00:02.000Z'

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
  scrolls.reset()
  store.reset()
})

/** One entry of `context.content`, as a host writes it. */
const changed = (at: string, epic: string | null = 'probe', source: string = ID) => ({ source, epic, at })

/** The stand-in journey with its first step rewritten, as another writer would leave it. */
const rewritten = (title: string, refs = JOURNEY.steps[0]!.refs) => ({
  ...JOURNEY,
  steps: [{ ...JOURNEY.steps[0]!, title, refs }, JOURNEY.steps[1]!],
})

/**
 * A host, greeted in a fresh project with the journey open, the reading handed
 * over and the page drawn. `context` sends the next context for the same
 * project, which is the only kind that does not reload the journey anyway.
 */
async function framed(selection: string[] = []) {
  const host = stubHost()
  projects += 1
  const projectPath = `/Users/somebody/Projects/content-${projects}`
  host.greet(selection, { projectPath, content: [] })
  await settle()
  host.answer('tracker.get', READ)
  await settle()
  render(<App />)
  const context = (content: unknown[], epic = 'probe') => host.context(selection, epic, { projectPath, content })
  return { host, context }
}

describe('when the journey on screen is changed by somebody else', () => {
  test('it is read again, once, and only it', async () => {
    const { context } = await framed()
    store.journey = rewritten('One, rewritten')
    const before = store.asked.length
    context([changed(T1)])
    await settle()
    const since = store.asked.slice(before)
    expect(since).toHaveLength(1)
    expect(since[0]).toStartWith('GET /api/journey?')
    expect(since[0]).toContain('slug=probe')
    expect(wire.getSnapshot().journey?.steps[0]?.title).toBe('One, rewritten')
    expect(document.querySelector('[data-step="1"]')?.textContent).toContain('One, rewritten')
  })

  /**
   * The material moved; the reader did not. The step's element is the SAME
   * element afterwards, which is what "swapped in place" means and what keeps
   * the scroll: a tree taken down for a loading state and put back is new
   * nodes at the top of a container that has forgotten where it was.
   */
  test('the reader keeps their place: the same nodes, the folds, the editor, the pick and the reading', async () => {
    const { host, context } = await framed(['gh#3'])
    wire.toggleFold('gh#1')
    wire.setEditing(1)
    const step = document.querySelector('[data-step="1"]')
    const live = wire.getSnapshot().live
    expect(step).not.toBeNull()
    expect(document.querySelector('[data-card="gh#7"]')).not.toBeNull()
    scrolls.reset()

    store.journey = rewritten('One, rewritten')
    context([changed(T1)])
    await settle()

    expect(document.querySelector('[data-step="1"]')).toBe(step)
    expect(step?.textContent).toContain('One, rewritten')
    expect(wire.getSnapshot().unfolded).toEqual(['gh#1'])
    expect(document.querySelector('[data-card="gh#7"]')).not.toBeNull()
    expect(wire.getSnapshot().editing).toBe(1)
    expect(wire.getSnapshot().selection).toEqual(['gh#3'])
    /* The tracker's reading is not taken off the screen while it is asked
       again: the states beside the references stay drawn. */
    expect(wire.getSnapshot().live).toBe(live)
    expect(scrolls.count()).toBe(0)
    expect(host.picks()).toEqual([])
  })

  test('a change the host could not pin to an epic counts for the one that is open', async () => {
    const { context } = await framed()
    store.journey = rewritten('One, from the file')
    const before = store.reads()
    /* What an edit to `.kehikot/journeys/journeys.json` looks like, and a
       write from this app's own MCP door: the host sees a folder move. */
    context([changed(T1, null)])
    await settle()
    expect(store.reads()).toBe(before + 1)
    expect(wire.getSnapshot().journey?.steps[0]?.title).toBe('One, from the file')
  })

  test('new references are asked of the trackers, since the reading was for the old ones', async () => {
    const { host, context } = await framed()
    const before = host.asked('tracker.get').length
    store.journey = rewritten('One', ['gh#1', 'gh#2', 'gh#44'])
    context([changed(T1)])
    await settle()
    expect(host.asked('tracker.get').length).toBe(before + 1)
    expect(host.asked('tracker.get').at(-1)?.params).toEqual({ refs: ['gh#1', 'gh#2', 'gh#44', 'gh#3'] })
  })

  test('a step that is gone takes its open editor with it, and no other', async () => {
    const { context } = await framed()
    wire.setEditing(1)
    store.journey = { ...JOURNEY, steps: [JOURNEY.steps[0]!] }
    context([changed(T1)])
    await settle()
    expect(wire.getSnapshot().journey?.steps).toHaveLength(1)
    expect(wire.getSnapshot().editing).toBe(-1)
  })
})

describe('when there is no journey on screen to read again', () => {
  /**
   * An epic this project has no journey for may have just been given one —
   * that is what an agent's first `set_step` is. So the change is answered by
   * asking the index, which is the door that knows, and the journey door is
   * still not knocked on for a journey the index does not list.
   */
  test('the index is asked whether there is one now, and nothing is asked for that is not there', async () => {
    const { context } = await framed()
    context([], 'elsewhere')
    await settle()
    expect(wire.getSnapshot().journey).toBeNull()
    const before = store.asked.length
    context([changed(T1, null)], 'elsewhere')
    await settle()
    const since = store.asked.slice(before)
    expect(since).toHaveLength(1)
    expect(since[0]).toStartWith('GET /api/journeys?')
    expect(wire.getSnapshot().journey).toBeNull()
  })
})

describe('what is not a reason to read again', () => {
  test('another epic’s journey changing', async () => {
    const { context } = await framed()
    const before = store.asked.length
    context([changed(T1, 'elsewhere')])
    await settle()
    expect(store.asked.length).toBe(before)
  })

  /**
   * Not the host's epics either. This page asks nobody which epics exist and
   * reads no step over the bridge — the manifest's essay on `epics:read` is
   * the long version — so `host` moving is true and not about anything drawn
   * here.
   */
  test('another module’s material, or the host’s own epics', async () => {
    const { context } = await framed()
    const before = store.asked.length
    context([changed(T1, 'probe', 'kehikot.references'), changed(T1, 'probe', CONTENT_HOST)])
    await settle()
    expect(store.asked.length).toBe(before)
  })

  /** The rule this page already kept, and still does: a context is not "the reader moved". */
  test('the same epic sent again, with the same changes, however often', async () => {
    const { context } = await framed()
    context([changed(T1)])
    await settle()
    const before = store.asked.length
    context([changed(T1)])
    context([changed(T1), changed(T2, 'elsewhere')])
    await settle()
    expect(store.asked.length).toBe(before)
  })

  test('the first context of a conversation, whatever it already carries', async () => {
    const host = stubHost()
    const projectPath = `/Users/somebody/Projects/content-${++projects}`
    const before = store.reads()
    host.greet([], { projectPath, content: [changed(T1)] })
    await settle()
    /* Opened, which is one read — not opened and then read again. */
    expect(store.reads()).toBe(before + 1)
  })
})

describe('a burst of changes', () => {
  test('lands as one more read after the one in flight, not one per change', async () => {
    const { context } = await framed()
    const before = store.reads()
    const release = store.hold()
    context([changed(T1)])
    await settle()
    expect(store.reads()).toBe(before + 1)
    context([changed(T2)])
    context([changed(T3)])
    await settle()
    /* Still the one, in flight. */
    expect(store.reads()).toBe(before + 1)
    store.journey = rewritten('One, at the end of it')
    release()
    await settle()
    expect(store.reads()).toBe(before + 2)
    expect(wire.getSnapshot().journey?.steps[0]?.title).toBe('One, at the end of it')
  })

  test('an answer that arrives after the canvas has moved to another epic is dropped', async () => {
    const { context } = await framed()
    const release = store.hold()
    store.journey = rewritten('One, for nobody')
    context([changed(T1)])
    await settle()
    context([changed(T1)], 'elsewhere')
    await settle()
    release()
    await settle()
    /* This app holds no journey called `elsewhere`, and the answer about
       `probe` must not be drawn under it. */
    expect(wire.getSnapshot().epic).toBe('elsewhere')
    expect(wire.getSnapshot().journey).toBeNull()
  })
})

describe('a write made on this page', () => {
  const fields = { title: 'One, edited here', body: 'A body.', refs: ['gh#1', 'gh#2'], notes: [] }

  test('is reported to the host for its epic, after it has been kept', async () => {
    const { host } = await framed()
    wire.setEditing(0)
    const before = store.asked.length
    const saving = wire.saveStep(0, fields)
    /* Asked of the store, not yet answered: nothing has landed, so nothing is
       reported. A container told too early re-reads the old material. */
    expect(host.asked('content.changed')).toHaveLength(0)
    await saving
    expect(store.asked.slice(before)).toEqual(['POST /api/step'])
    const reports = host.asked('content.changed')
    expect(reports).toHaveLength(1)
    expect(reports[0]?.params).toEqual({ epic: 'probe' })
    expect(() => methodParams['content.changed'].parse(reports[0]?.params)).not.toThrow()
    expect(wire.getSnapshot().said).toBe('kept')
  })

  test('a write the store refused is not reported', async () => {
    const { host } = await framed()
    const answering = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'a step needs a title' }))) as unknown as typeof fetch
    try {
      await wire.saveStep(0, { ...fields, title: '' })
    } finally {
      globalThis.fetch = answering
    }
    expect(wire.getSnapshot().said).toBe('a step needs a title')
    expect(host.asked('content.changed')).toHaveLength(0)
  })

  /**
   * The host tells the page that reported, too. What comes back is a read of
   * what this page already drew, so it changes nothing — not the journey in
   * state, not the line that says "kept" — and above all it is not reported
   * again, which would be two programs telling each other the news for ever.
   */
  test('comes back as a change like any other, and is read without redrawing or reporting again', async () => {
    const { host, context } = await framed()
    await wire.saveStep(0, fields)
    const kept = wire.getSnapshot().journey
    const before = store.reads()
    context([changed(T1)])
    await settle()
    expect(store.reads()).toBe(before + 1)
    expect(wire.getSnapshot().journey).toBe(kept)
    expect(wire.getSnapshot().said).toBe('kept')
    expect(host.asked('content.changed')).toHaveLength(1)
  })

  test('a host that will not hear it does not turn a kept save into a failed one', async () => {
    /* The step is on disk either way, and the host sees the folder move. */
    const { host } = await framed()
    await wire.saveStep(0, fields)
    host.refuse('content:report is not granted', 'content.changed')
    await settle()
    expect(wire.getSnapshot().said).toBe('kept')
  })
})
