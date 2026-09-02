import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { LIMITS, MESSAGE, PROTOCOL } from 'roadmap-module-protocol'
import { mailbox } from 'roadmap-module-protocol/client'

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
 * The stand-in host is the same one References uses: an object with a
 * `postMessage`, which is all a host is from inside a frame. The store is a
 * `fetch` that answers the three doors this page knocks on, because `start()`
 * reads the index before anything else and a page with no journey has no
 * steps to press.
 *
 * `journeys.ts` is imported once and `start()` called once: the connection is
 * module state, like the page's. Each case greets afresh, which is what a
 * host does on every frame load, and the mailbox is emptied between them so
 * that one case's greeting is not replayed into the next.
 */

const JOURNEY = {
  slug: 'probe',
  title: 'A journey',
  lede: '',
  callout: '',
  plan: 'stored',
  blockedBy: {},
  steps: [
    { title: 'One', body: '', refs: ['gh#1', 'gh#2'], notes: [] },
    { title: 'Two', body: '', refs: ['gh#3'], notes: [] },
  ],
}

const PROJECT = '/Users/somebody/Projects/probe'

/** The three doors, answered the way the server answers them. */
function stubStore() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = url.includes('/api/journeys')
      ? { ok: true, journeys: [{ slug: 'probe', title: 'A journey', tab: null, plan: 'stored', steps: 2 }] }
      : url.includes('/api/journey')
        ? { ok: true, journey: JOURNEY }
        : url.includes('/api/ticket')
          ? { ok: true, ticket: 't' }
          : { ok: false, error: `nothing answers ${url}` }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

/** Something to be greeted by, and to read what the page says back to it. */
function stubHost() {
  const said: Record<string, unknown>[] = []
  const source = { postMessage: (message: Record<string, unknown>) => said.push(message) }
  const post = (data: unknown) => {
    const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
    Object.defineProperty(event, 'source', { value: source })
    window.dispatchEvent(event)
  }
  const context = (selection: string[], epic = 'probe') => ({
    epic,
    project: 'probe',
    projectPath: PROJECT,
    theme: 'light',
    selection,
    filters: {},
  })
  return {
    said,
    /** Every `selection.set` this page asked for, in order, as the refs it sent. */
    picks: () =>
      said
        .filter((m) => m.type === MESSAGE.REQUEST && m.method === 'selection.set')
        .map((m) => (m.params as { refs: string[] }).refs),
    greet: (selection: string[] = []) =>
      post({ type: MESSAGE.HELLO, protocol: PROTOCOL, session: 's', context: context(selection), state: null }),
    context: (selection: string[], epic = 'probe') =>
      post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(selection, epic) }),
    /** Answer the newest `selection.set` the way a host does: with a context carrying what it settled on. */
    echo: () => {
      const last = newest()
      post({ type: MESSAGE.RESPONSE, id: last.id, ok: true, data: null })
      post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(last.params.refs) })
    },
    /** Refuse the newest `selection.set`, in the host's own words, and send no context. */
    refuse: (error: string) => {
      post({ type: MESSAGE.RESPONSE, id: newest().id, ok: false, reason: 'failed', error })
    },
  }

  function newest(): { id: string; params: { refs: string[] } } {
    const last = said.findLast((m) => m.type === MESSAGE.REQUEST && m.method === 'selection.set') as
      | { id: string; params: { refs: string[] } }
      | undefined
    if (!last) throw new Error('nothing asked selection.set')
    return last
  }
}

const settle = () => new Promise((done) => setTimeout(done, 20))

/* The page scrolls to a picked reference it is showing. happy-dom has no
   layout, so the scroll is counted rather than observed — and counting it is
   the point: a context that is the echo of this page's own pick must not
   scroll, and one that is somebody else's must. */
let scrolled = 0
Element.prototype.scrollIntoView = () => {
  scrolled += 1
}

type Wire = typeof import('../src/journeys.ts')
let wire: Wire

beforeAll(async () => {
  stubStore()
  wire = await import('../src/journeys.ts')
  wire.start()
})

afterEach(() => {
  mailbox.forget?.()
  document.body.innerHTML = ''
  scrolled = 0
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
    expect(scrolled).toBe(1)
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
    expect(scrolled).toBe(0)
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
    expect(scrolled).toBe(1)
  })
})
