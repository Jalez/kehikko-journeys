import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mailbox } from 'kehikot-module-protocol/client'

import { JOURNEY, settle, started, stubHost, type Wire } from './host.ts'

/**
 * Two epic switches in a row, with the first one's answer arriving last.
 *
 * `load` in `journeys.ts` awaits the index and then the journey, and used to
 * write whatever it got without asking whether the canvas was still on that
 * epic. The stand-in store here answers per slug and can be told to keep the
 * index read waiting, which is how the slower, older load is made to finish
 * after the newer one — the order a real server produces when an agent has just
 * written a journey the index does not list yet.
 */

let wire: Wire
let projects = 0
let listing: string[] = []
let afterWrite: string[] = ['a', 'b', 'c']
let gate: Promise<void> | null = null
let heldJourney: string | null = null
let release = () => {}

const original = globalThis.fetch

const view = (slug: string) => ({ ...JOURNEY, slug, title: `Journey ${slug}` })

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  globalThis.fetch = original
  mailbox.forget?.()
  release()
})

function stubPerSlug() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/journeys')) {
      if (gate) {
        const waiting = gate
        gate = null
        await waiting
        /* What the index holds by the time the kept-waiting read is answered. */
        listing = afterWrite
      }
      return answer({ ok: true, journeys: listing.map((slug) => ({ slug, title: slug, tab: null, plan: 'stored', steps: 2 })) })
    }
    if (url.includes('/api/journey?')) {
      const slug = new URL(url, 'http://x').searchParams.get('slug') ?? ''
      if (slug === heldJourney) await new Promise<void>((done) => (release = done))
      return answer({ ok: true, journey: view(slug) })
    }
    if (url.includes('/api/ticket')) return answer({ ok: true, ticket: 't' })
    return answer({ ok: false, error: `nothing answers ${url}` })
  }) as typeof fetch
}

async function standing(epic: string) {
  stubPerSlug()
  listing = ['b', 'c']
  afterWrite = ['a', 'b', 'c']
  gate = null
  heldJourney = null
  projects += 1
  const projectPath = `/Users/somebody/Projects/stale-${projects}`
  const host = stubHost()
  host.greet([], { projectPath, epic })
  await settle()
  return { host, projectPath, move: (to: string) => host.context([], to, { projectPath }) }
}

describe('a load that finishes after the canvas has moved on', () => {
  test('does not draw the journey of the epic just left', async () => {
    const { move } = await standing('b')
    expect(wire.getSnapshot().journey?.slug).toBe('b')

    /* `a` is not in the index, so its load reads the index first, and that read
       is kept waiting while the canvas goes on to `b`. */
    gate = new Promise<void>((done) => (release = done))
    move('a')
    await settle()
    move('b')
    await settle()
    expect(wire.getSnapshot().journey?.slug).toBe('b')

    release()
    await settle()
    expect(wire.getSnapshot().journey?.slug).toBe('b')
  })

  test('does not wipe the journey on screen with "no journey" for the epic just left', async () => {
    const { move } = await standing('b')
    /* The index still does not list `a` after the re-read, so the stale load
       would clear the journey instead of replacing it. */
    afterWrite = ['b', 'c']
    gate = new Promise<void>((done) => (release = done))
    move('a')
    await settle()
    move('b')
    await settle()
    expect(wire.getSnapshot().journey?.slug).toBe('b')

    release()
    await settle()
    expect(wire.getSnapshot().journey?.slug).toBe('b')
  })
})

describe('moving to another epic', () => {
  test('takes the previous journey off the screen until the new one arrives', async () => {
    const { move } = await standing('b')
    expect(wire.getSnapshot().journey?.slug).toBe('b')

    heldJourney = 'c'
    move('c')
    await settle()
    expect(wire.getSnapshot().journey).toBeNull()

    release()
    await settle()
    expect(wire.getSnapshot().journey?.slug).toBe('c')
  })
})
