import { MESSAGE, PROTOCOL } from 'roadmap-module-protocol'

/**
 * A stand-in host and store, shared by every file that drives `journeys.ts`
 * through the real client on the real `window`.
 *
 * Shared because the page is module state and `bun test` runs every file in
 * one module registry: `journeys.ts` is imported once, and `start()` may be
 * called once — a second call would put a second listener on `window`, and
 * every message after it would be answered twice. `started()` is the one
 * place that calls it.
 *
 * The host is the same one References uses: an object with a `postMessage`,
 * which is all a host is from inside a frame. The store is a `fetch` that
 * answers the three doors this page knocks on, because `start()` reads the
 * index before anything else and a page with no journey has no steps to press.
 */

export const JOURNEY = {
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

export const PROJECT = '/Users/somebody/Projects/probe'

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

type Request = { type: string; id: string; method: string; params: Record<string, unknown> }

/** Something to be greeted by, and to read what the page says back to it. */
export function stubHost() {
  const said: Record<string, unknown>[] = []
  const source = { postMessage: (message: Record<string, unknown>) => said.push(message) }
  const post = (data: unknown) => {
    const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
    Object.defineProperty(event, 'source', { value: source })
    window.dispatchEvent(event)
  }
  const context = (selection: string[], epic = 'probe', more: Record<string, unknown> = {}) => ({
    epic,
    project: 'probe',
    projectPath: PROJECT,
    theme: 'light',
    selection,
    filters: {},
    ...more,
  })
  const asked = (method: string) =>
    said.filter((m) => m.type === MESSAGE.REQUEST && m.method === method) as unknown as Request[]
  const newest = (method: string): Request => {
    const last = asked(method).at(-1)
    if (!last) throw new Error(`nothing asked ${method}`)
    return last
  }
  return {
    said,
    post,
    /** Every request for one method, in order. */
    asked,
    /** Every `selection.set` this page asked for, in order, as the refs it sent. */
    picks: () => asked('selection.set').map((m) => (m.params as { refs: string[] }).refs),
    /** Every filter offer this page sent, in order. */
    offers: () => said.filter((m) => m.type === MESSAGE.FILTERS).map((m) => m.groups as unknown[]),
    greet: (selection: string[] = [], more: Record<string, unknown> = {}) =>
      post({
        type: MESSAGE.HELLO,
        protocol: PROTOCOL,
        session: 's',
        context: context(selection, 'probe', more),
        state: null,
      }),
    context: (selection: string[], epic = 'probe', more: Record<string, unknown> = {}) =>
      post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(selection, epic, more) }),
    /** Answer the newest request for a method, with data. */
    answer: (method: string, data: unknown) => post({ type: MESSAGE.RESPONSE, id: newest(method).id, ok: true, data }),
    /** Answer the newest `selection.set` the way a host does: with a context carrying what it settled on. */
    echo: () => {
      const last = newest('selection.set')
      post({ type: MESSAGE.RESPONSE, id: last.id, ok: true, data: null })
      post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context(last.params.refs as string[]) })
    },
    /** Refuse the newest request for a method, in the host's own words. */
    refuse: (error: string, method = 'selection.set') => {
      post({ type: MESSAGE.RESPONSE, id: newest(method).id, ok: false, reason: 'failed', error })
    },
  }
}

export const settle = () => new Promise((done) => setTimeout(done, 20))

/* The page scrolls to a reference it walks to. happy-dom has no layout, so
   the scroll is counted rather than observed — and counting it is the point:
   a context that is the echo of this page's own pick must not scroll, and one
   that is somebody else's must. */
let scrolled = 0
Element.prototype.scrollIntoView = () => {
  scrolled += 1
}
export const scrolls = {
  count: () => scrolled,
  reset: () => {
    scrolled = 0
  },
}

export type Wire = typeof import('../src/journeys.ts')
let wire: Promise<Wire> | null = null

/** `journeys.ts`, started once for every file that asks. */
export function started(): Promise<Wire> {
  wire ??= (async () => {
    stubStore()
    const loaded = await import('../src/journeys.ts')
    loaded.start()
    return loaded
  })()
  return wire
}
