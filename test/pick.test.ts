import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { LIMITS } from 'roadmap-module-protocol'
import { mailbox } from 'roadmap-module-protocol/client'

import { scrolls, settle, started, stubHost, type Wire } from './host.ts'

/**
 * The selection leaving this page, and — more important — NOT leaving it.
 *
 * `refs.test.ts` decides what a press means. This file is about whether the
 * wire is touched at all, which is the failure the coordinator of this work
 * named as the one they cared most about: a module that overwrites a person's
 * pick because it re-rendered, or because a context arrived, or because the
 * canvas moved to another epic. None of those may send `selection.set`. Only a
 * press may, and this is the file that says so with the real client listening
 * on the real `window`.
 *
 * The stand-in host and store are in `host.ts`, shared with the filter and
 * disposition tests: `journeys.ts` is imported once and `start()` called
 * once, because the connection is module state, like the page's. Each case greets afresh, which is what a
 * host does on every frame load, and the mailbox is emptied between them so
 * that one case's greeting is not replayed into the next.
 */

let wire: Wire

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  mailbox.forget?.()
  document.body.innerHTML = ''
  scrolls.reset()
})

describe('nothing this page does on its own touches the selection', () => {
  test('a greeting carrying a pick is taken as the truth and sets nothing back', async () => {
    const host = stubHost()
    host.greet(['gh#9'])
    await settle()
    expect(wire.getSnapshot().selection).toEqual(['gh#9'])
    expect(wire.getSnapshot().journey?.slug).toBe('probe')
    expect(host.picks()).toEqual([])
  })

  test('a context that moves the canvas to another epic leaves the pick alone', async () => {
    const host = stubHost()
    host.greet(['gh#9'])
    await settle()
    host.context(['gh#9'], 'elsewhere')
    await settle()
    /* The journey went — this app holds none called `elsewhere` — and the
       selection did not: it is the person's, and a reference picked in another
       container is no less picked for this page having turned. */
    expect(wire.getSnapshot().journey).toBeNull()
    expect(wire.getSnapshot().selection).toEqual(['gh#9'])
    expect(host.picks()).toEqual([])
  })
})

describe('a press, and only a press, sets the selection', () => {
  test('ticking a step sends what the step carries, added to what the canvas already held', async () => {
    const host = stubHost()
    host.greet(['#2274'])
    await settle()
    wire.pick(['gh#1', 'gh#2'])
    expect(host.picks()).toEqual([['#2274', 'gh#1', 'gh#2']])
  })

  test('the tick is drawn from the host’s echo, never from the press', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    wire.pick(['gh#3'])
    /* Asked, not yet answered: the page must not have ticked anything. */
    expect(wire.getSnapshot().selection).toEqual([])
    host.echo()
    expect(wire.getSnapshot().selection).toEqual(['gh#3'])
  })

  test('ticking a picked step again takes its references off, and clearing takes everything off', async () => {
    const host = stubHost()
    host.greet(['gh#1', 'gh#2', '#2274'])
    await settle()
    wire.pick(['gh#1', 'gh#2'])
    expect(host.picks().at(-1)).toEqual(['#2274'])
    host.echo()
    wire.clearPick()
    expect(host.picks().at(-1)).toEqual([])
  })

  test('a pick past the wire’s bound is cut to it and the reader is told', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    wire.pick(Array.from({ length: LIMITS.REFS + 5 }, (_, i) => `gh#${i + 1}`))
    expect(host.picks().at(-1)).toHaveLength(LIMITS.REFS)
    expect(wire.getSnapshot().said).toContain(`the last 5 were left off`)
  })

  test('a host that refuses the pick is quoted, and the page claims nothing', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    wire.pick(['gh#1'])
    host.refuse('not on this canvas')
    await settle()
    expect(wire.getSnapshot().said).toContain('not on this canvas')
    expect(wire.getSnapshot().selection).toEqual([])
  })
})

describe('the echo of this page’s own pick does not move the page', () => {
  const showing = () => {
    /* A card for gh#1, so that a selection naming it is one this page would
       ordinarily scroll to. */
    document.body.innerHTML = '<div data-card="gh#1"><a data-ref="gh#1">gh#1</a></div>'
  }

  test('a pick made in another container scrolls to the first reference shown here', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    showing()
    host.context(['gh#1'])
    await settle()
    expect(scrolls.count()).toBe(1)
  })

  test('the same selection arriving as the echo of a press here does not', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    showing()
    wire.pick(['gh#1'])
    host.echo()
    await settle()
    expect(wire.getSnapshot().selection).toEqual(['gh#1'])
    expect(scrolls.count()).toBe(0)
  })

  test('a host that settled on something other than what was asked is not an echo, and is shown', async () => {
    const host = stubHost()
    host.greet([])
    await settle()
    showing()
    wire.pick(['gh#1', 'gh#2'])
    /* The host clamped the list. That is a changed pick, and the page walks to it. */
    host.context(['gh#1'])
    await settle()
    expect(scrolls.count()).toBe(1)
  })
})
