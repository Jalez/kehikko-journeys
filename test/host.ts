import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'

import { assign, withPart, withoutPart, type Arrangeable } from '../parts.ts'

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
 * answers the doors this page knocks on, because `start()` reads the
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

const NO_PAPER: Record<string, unknown> = { ok: true, slug: 'probe', paper: false }

/** A paper of two chapters and a preamble file, as `/api/chapters` answers it for a journey with no parts. */
export const PAPER = {
  ok: true,
  slug: 'probe',
  paper: true,
  parts: [
    { heading: 'Introduction', titled: true, file: 'chapters/1_introduction.tex', files: ['chapters/1_introduction.tex'] },
    { heading: 'Results', titled: false, file: 'chapters/2_results.tex', files: ['chapters/2_results.tex', 'generated/table.tex'] },
  ],
  owned: [],
  preamble: ['macros.tex'],
  missing: [],
  beyond: [],
  files: ['macros.tex', 'chapters/1_introduction.tex', 'chapters/2_results.tex', 'generated/table.tex'],
  nothing: null,
  leftOut: ['macros.tex is pulled in before \\begin{document} — macros and settings, not a chapter — and is not made a part.'],
}

/**
 * What the stand-in store holds and what it has been asked, for the cases that
 * are about WHEN this page reads — a re-read after somebody else's write is a
 * request, and the only way to say "one, and only one" is to count them.
 *
 * `journey` is what `/api/journey` answers next, so a case can change the
 * material under an open page the way an agent on the MCP door does. `hold`
 * keeps `/api/journey` from answering until the function it returns is called,
 * which is how a read is kept in flight while more changes arrive.
 */
export const store = {
  journey: JOURNEY as typeof JOURNEY,
  /** Every request, in order, as `METHOD /path?query`. */
  asked: [] as string[],
  /** How many times one journey has been read. */
  reads: () => store.asked.filter((line) => line.startsWith('GET /api/journey?')).length,
  hold: (): (() => void) => {
    let release = () => {}
    held = new Promise<void>((done) => {
      release = () => {
        held = null
        done()
      }
    })
    return release
  },
  /**
   * Whether the index lists the journey. False is a project that holds no
   * journey for the epic the canvas is on — until `POST /api/journey` makes
   * one, as the real door does.
   */
  listed: true,
  /** The body of every `POST /api/journey`, in order. */
  begun: [] as Record<string, unknown>[],
  /** Every write that arranged the journey into parts, as the page sent it. */
  arranged: [] as { path: string; body: Record<string, unknown> }[],
  /**
   * What `/api/chapters` answers: what the epic's paper says about parts.
   * No paper, unless a case gives it one.
   */
  chapters: NO_PAPER as Record<string, unknown>,
  reset: () => {
    store.journey = JOURNEY
    store.listed = true
    store.begun = []
    store.arranged = []
    store.chapters = NO_PAPER
    held = null
  },
}

let held: Promise<void> | null = null

/** The doors, answered the way the server answers them. */
function stubStore() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    store.asked.push(`${init?.method ?? 'GET'} ${url}`)
    let refusal: string | null = null
    let said = 'Began probe from what the host holds for that epic: 2 steps.'
    if (url.includes('/api/parts/chapters')) {
      /* What the real door does: the proposal's own heading and files for
         each row named, made by `withPart`, all in one answer. */
      const body = JSON.parse(String(init?.body)) as { files: string[] }
      store.arranged.push({ path: '/api/parts/chapters', body })
      let record = { ...store.journey, groups: (store.journey as { groups?: unknown[] }).groups ?? [] } as Arrangeable
      const proposed = (store.chapters.parts ?? []) as { heading: string; file: string; files: string[] }[]
      for (const part of proposed.filter((one) => body.files.includes(one.file))) {
        const out = withPart(record, { heading: part.heading, files: part.files })
        if (out.ok) record = out.record
        else refusal = out.error
      }
      if (refusal === null) {
        store.journey = record as unknown as typeof JOURNEY
        said = `Made ${body.files.length} parts from the paper’s chapter files.`
      }
    } else if (/\/api\/(assign|part)/.test(url)) {
      /* The store's own arithmetic, so that what the page draws after a press
         is what the real door would have answered — `parts.ts` is the half of
         the store a browser can load, and so can a test. */
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      store.arranged.push({ path: new URL(url, 'http://x').pathname, body })
      const record = { ...store.journey, groups: (store.journey as { groups?: unknown[] }).groups ?? [] } as Arrangeable
      const out = url.includes('/api/assign')
        ? assign(record, body.positions as number[], (body.part as string) || null)
        : url.includes('/api/part/remove')
          ? withoutPart(record, String(body.id))
          : withPart(record, {
              id: (body.id as string | undefined) ?? null,
              ...(body.heading === undefined ? {} : { heading: String(body.heading) }),
              ...(body.files === undefined ? {} : { files: body.files }),
            })
      if (out.ok) {
        store.journey = out.record as unknown as typeof JOURNEY
        said = 'arranged'
      } else refusal = out.error
    } else if (url.includes('/api/step')) {
      /* The whole step, kept, and the whole journey handed back — what
         `setStep` does behind the real door. */
      const sent = JSON.parse(String(init?.body)) as { position: number } & (typeof JOURNEY)['steps'][number]
      const kept = { title: sent.title, body: sent.body, refs: sent.refs, notes: sent.notes }
      store.journey = {
        ...store.journey,
        plan: 'stored',
        steps:
          sent.position > store.journey.steps.length
            ? [...store.journey.steps, kept]
            : store.journey.steps.map((step, i) => (i === sent.position ? kept : step)),
      }
    } else if (url.includes('/api/journey?') && held) {
      await held
    } else if (init?.method === 'POST' && url.endsWith('/api/journey')) {
      store.begun.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      store.listed = true
    }
    const body = url.includes('/api/journeys')
      ? {
          ok: true,
          journeys: store.listed ? [{ slug: 'probe', title: 'A journey', tab: null, plan: 'stored', steps: 2 }] : [],
        }
      : url.includes('/api/chapters')
        ? store.chapters
      : refusal !== null
        ? { ok: false, error: refusal }
        : url.includes('/api/journey') || url.includes('/api/step') || /\/api\/(assign|part)/.test(url)
          ? { ok: true, journey: store.journey, said }
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
