import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'

import { mirrored, withPart, withStep, withStepMoved, withoutStep, type Divided } from '../parts.ts'

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
  /** Every request, in order, as `METHOD /path?query`. Not `/api/factory`: see `factoryAsked`. */
  asked: [] as string[],
  /** Every `/api/factory` read, and what it answers: the Factory's job per issue. */
  factoryAsked: [] as string[],
  factory: {} as Record<string, { id: string; ref: string; stage: string }>,
  /** What `/api/pointing` answers: where an agent has pointed the page, or null. */
  pointing: null as { step: number; title: string; say: string; at: string } | null,
  /** Every `/api/pointing` read. */
  pointingAsked: [] as string[],
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
  /**
   * The epic's list of parts as the HOST keeps it, or null: this app keeps
   * the list, in the record's `groups`. With a list the store stands in for
   * the real doors where the host is the keeper: no id is made, `groups` is
   * neither written nor handed over, and a step is filed under `part`.
   */
  parts: null as { id: string; name: string }[] | null,
  /** What the next write is refused with, once; null to let it through. */
  fail: null as string | null,
  /** The body of every `POST /api/journey`, in order. */
  begun: [] as Record<string, unknown>[],
  /** Every write of a step or of the steps, as the page sent it. */
  arranged: [] as { path: string; body: Record<string, unknown> }[],
  reset: () => {
    store.journey = JOURNEY
    store.listed = true
    store.parts = null
    store.fail = null
    store.begun = []
    store.arranged = []
    store.factoryAsked = []
    store.factory = {}
    store.pointing = null
    store.pointingAsked = []
    held = null
  },
}

let held: Promise<void> | null = null

/** The journey as the real door hands it to the page: with who keeps the list of its parts. */
function viewed(): Record<string, unknown> {
  if (store.parts === null) return { ...store.journey, listed: null }
  const { groups: _groups, ...rest } = store.journey as typeof JOURNEY & { groups?: unknown }
  return { ...rest, listed: store.parts }
}

/** The doors, answered the way the server answers them. */
function stubStore() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    /* The Factory's stages are read beside the journey on their own clock (`readFactory`); they are
       counted apart, so a case about what the journey asks is not about them. */
    if (url.includes('/api/factory?')) {
      store.factoryAsked.push(url)
      return new Response(JSON.stringify({ ok: true, factory: Object.keys(store.factory).length > 0, jobs: store.factory }), { headers: { 'content-type': 'application/json' } })
    }
    /* Where an agent has pointed the page is asked on its own clock too, and answered from `store.pointing`. */
    if (url.includes('/api/pointing?')) {
      store.pointingAsked.push(url)
      return new Response(JSON.stringify({ ok: true, pointing: store.pointing }), { headers: { 'content-type': 'application/json' } })
    }
    store.asked.push(`${init?.method ?? 'GET'} ${url}`)
    let refusal: string | null = null
    let said = 'Began probe from what the host holds for that epic: 2 steps.'
    const record = () => ({ ...store.journey, groups: (store.journey as { groups?: unknown[] }).groups ?? [] }) as unknown as Divided
    const failing = init?.method === 'POST' && !url.includes('/api/ticket') && store.fail !== null
    if (failing) {
      store.arranged.push({ path: new URL(url, 'http://x').pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      refusal = store.fail
      store.fail = null
    } else if (url.includes('/api/step/remove')) {
      const body = JSON.parse(String(init?.body)) as { position?: number; step?: string }
      store.arranged.push({ path: '/api/step/remove', body })
      if (store.parts !== null) {
        const steps = store.journey.steps as { part?: string }[]
        const at = body.step ? steps.findIndex((step) => step.part === body.step) : (body.position ?? 0) - 1
        store.journey = { ...store.journey, steps: steps.filter((_, i) => i !== at) } as typeof JOURNEY
        said = 'Removed the step. Its part is the epic’s and is still listed.'
      } else {
        const base = mirrored(record())
        const at = body.step ? base.steps.findIndex((step) => step.part === body.step) : (body.position ?? 0) - 1
        store.journey = withoutStep(base, at) as unknown as typeof JOURNEY
        said = 'Removed the step, and its part with it.'
      }
    } else if (url.includes('/api/step/move')) {
      const body = JSON.parse(String(init?.body)) as { position?: number; step?: string; to: number }
      store.arranged.push({ path: '/api/step/move', body })
      if (store.parts !== null) {
        const steps = [...(store.journey.steps as { part?: string }[])]
        const from = body.step ? steps.findIndex((step) => step.part === body.step) : (body.position ?? 0) - 1
        const [one] = steps.splice(from, 1)
        steps.splice(body.to - 1, 0, one as { part?: string })
        store.journey = { ...store.journey, steps } as typeof JOURNEY
      } else {
        const base = mirrored(record())
        const from = body.step ? base.steps.findIndex((step) => step.part === body.step) : (body.position ?? 0) - 1
        store.journey = { ...withStepMoved(base, from, body.to - 1), plan: 'stored' } as unknown as typeof JOURNEY
      }
      said = 'Moved the step.'
    } else if (url.includes('/api/settle')) {
      store.arranged.push({ path: '/api/settle', body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      store.journey = { ...(mirrored(record()) as unknown as typeof JOURNEY), unsettled: false } as typeof JOURNEY
      said = 'This journey was stored in an older shape. It is now one step to a part.'
    } else if (url.includes('/api/step')) {
      /* The page saving one step. The record is changed here with the same
         arithmetic `setStep` does behind the real door: by position, or by
         the id of the step's part. While this app keeps the list (`parts`
         null) a new step is given a part and `name` is the part's; where the
         host keeps it, no id is made and the step is filed under `part`. */
      const sent = JSON.parse(String(init?.body)) as { position?: number; step?: string; name?: string; part?: string } & (typeof JOURNEY)['steps'][number]
      store.arranged.push({ path: '/api/step', body: sent as unknown as Record<string, unknown> })
      if (store.parts !== null) {
        const steps = store.journey.steps as ({ part?: string } & (typeof JOURNEY)['steps'][number])[]
        const found = sent.step ? steps.findIndex((step) => step.part === sent.step) : (sent.position ?? steps.length + 1) - 1
        const at = found < 0 || found > steps.length ? steps.length : found
        if (sent.part !== undefined && !store.parts.some((part) => part.id === sent.part)) {
          refusal = `"${sent.part}" is not a part of this epic. The step was not written.`
        } else {
          const next = { ...steps[at], title: sent.title, body: sent.body, refs: sent.refs, notes: sent.notes, ...(sent.part ? { part: sent.part } : {}) }
          store.journey = { ...store.journey, plan: 'stored', steps: at < steps.length ? steps.map((one, i) => (i === at ? next : one)) : [...steps, next] } as unknown as typeof JOURNEY
          said = ''
        }
      } else {
        const base = mirrored(record())
        const found = sent.step ? base.steps.findIndex((step) => step.part === sent.step) : (sent.position ?? base.steps.length + 1) - 1
        const at = found < 0 || found > base.steps.length ? base.steps.length : found
        let next = withStep(base, at, { ...base.steps[at], title: sent.title, body: sent.body, refs: sent.refs, notes: sent.notes })
        const out = withPart(next, at, sent.name === undefined ? {} : { name: sent.name })
        if (out.ok) {
          next = out.record
          store.journey = { ...next, plan: 'stored' } as unknown as typeof JOURNEY
          said = ''
        } else refusal = out.error
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
      : refusal !== null
        ? { ok: false, error: refusal }
        : url.includes('/api/journey') || url.includes('/api/step') || url.includes('/api/settle')
          ? { ok: true, journey: viewed(), said }
        : url.includes('/api/ticket')
          ? { ok: true, ticket: 't' }
          : { ok: false, error: `nothing answers ${url}` }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

type Request = { type: string; id: string; method: string; params: Record<string, unknown> }

/** Something to be greeted by, and to read what the page says back to it. */
/**
 * `parts` is what this host does with `parts.set`. `'older'` (the default) is
 * a host from before protocol 1.2.0: it answers at once that it does not know
 * the method, as a released host does, so every case written before the
 * method existed runs against the host it was written for. `'asked'` leaves
 * the question for the case to answer (`answer`, `refuse`), as a host that
 * keeps the epic's list of parts would.
 */
export function stubHost(how: { parts?: 'older' | 'asked' } = {}) {
  const said: Record<string, unknown>[] = []
  const source = {
    postMessage: (message: Record<string, unknown>) => {
      said.push(message)
      if (message.type === MESSAGE.REQUEST && message.method === 'parts.set' && (how.parts ?? 'older') === 'older') {
        queueMicrotask(() => post({ type: MESSAGE.RESPONSE, id: message.id, ok: false, reason: 'unknown-method', error: 'No such method.' }))
      }
    },
  }
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
    refuse: (error: string, method = 'selection.set', reason: 'failed' | 'unknown-method' = 'failed') => {
      post({ type: MESSAGE.RESPONSE, id: newest(method).id, ok: false, reason, error })
    },
  }
}

export const settle = () => new Promise((done) => setTimeout(done, 20))

/* The page scrolls to a reference it walks to. happy-dom has no layout, so
   the scroll is counted rather than observed — and counting it is the point:
   a context that is the echo of this page's own pick must not scroll, and one
   that is somebody else's must. */
let scrolled = 0
let scrolledTo: { element: Element; block: string | undefined } | null = null
Element.prototype.scrollIntoView = function (this: Element, how?: boolean | ScrollIntoViewOptions) {
  scrolled += 1
  scrolledTo = { element: this, block: typeof how === 'object' ? how.block : undefined }
}
export const scrolls = {
  count: () => scrolled,
  /** The element last scrolled to, and which edge of the page it was brought to. */
  last: () => scrolledTo,
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
