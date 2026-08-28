import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

/**
 * A store of its own for this file, set BEFORE `doors.ts` is imported.
 *
 * `dataDir()` resolves the variable at call time rather than at import, so this
 * would work either way — but a test that seeded the developer's real store and
 * then wrote a step into it would be a test that edits somebody's decided
 * material to prove a point about routing.
 */
const data = mkdtempSync(join(tmpdir(), 'journeys-test-'))
process.env.JOURNEYS_DATA = data

const { TICKET, answer, openStore } = await import('../doors.ts')

afterAll(() => rmSync(data, { recursive: true, force: true }))

const query = (s = '') => new URLSearchParams(s)
const get = (path: string, q = '') => answer('GET', path, query(q), null, null)
const post = (path: string, body: Record<string, unknown>, ticket: string | null) =>
  answer('POST', path, query(), body, ticket)

describe('the store this app ships with', () => {
  /**
   * An app whose first screen is empty has to be believed about the emptiness,
   * and nobody starting a journeys app for the first time believes it. The seed
   * is what makes the first screen a journey rather than a claim.
   */
  test('seeds an empty store, and says how many', () => {
    expect(openStore()).toBeGreaterThan(0)
  })

  test('seeds once, never twice', () => {
    expect(openStore()).toBe(0)
  })

  test('lists what it holds', () => {
    const reply = get('/api/journeys')
    const body = reply?.body as { ok: boolean; journeys: { slug: string }[] }
    expect(reply?.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.journeys.length).toBeGreaterThan(0)
  })

  test('hands over one journey with the one derived fact the page cannot reach', () => {
    const listed = (get('/api/journeys')?.body as { journeys: { slug: string }[] }).journeys
    const slug = listed[0]?.slug as string
    const reply = get('/api/journey', `slug=${slug}`)
    const body = reply?.body as { ok: boolean; journey: { slug: string; plan: string } }
    expect(body.journey.slug).toBe(slug)
    expect(['stored', 'elsewhere', 'none']).toContain(body.journey.plan)
  })

  /**
   * Refused the same way whether or not the journey exists would be the ideal;
   * what is actually required is that a MALFORMED name never reaches the
   * filesystem, and that is what this holds. The protocol package makes the
   * same argument about `epic` at the host's own door.
   */
  test('refuses a name that is not a name before it reaches a directory', () => {
    const reply = get('/api/journey', 'slug=../../etc/passwd')
    expect(reply?.status).toBe(400)
  })

  test('says plainly that it does not hold a journey it does not hold', () => {
    const reply = get('/api/journey', 'slug=no-such-journey-here')
    expect(reply?.status).toBe(404)
  })
})

describe('writing, and the ticket', () => {
  const slug = () => (get('/api/journeys')?.body as { journeys: { slug: string; plan: string }[] }).journeys

  test('a write with no ticket is refused', () => {
    const reply = post('/api/step', { slug: 'anything', title: 'x' }, null)
    expect(reply?.status).toBe(403)
  })

  test('a write with the wrong ticket is refused the same way', () => {
    const reply = post('/api/step', { slug: 'anything', title: 'x' }, 'not-the-ticket')
    expect(reply?.status).toBe(403)
  })

  test('a step written through the page door comes back in the journey', () => {
    const target = slug().find((row) => row.plan !== 'elsewhere')?.slug as string
    const reply = post('/api/step', { slug: target, title: 'a step this test wrote' }, TICKET)
    const body = reply?.body as { ok: boolean; journey: { steps: { title: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.journey.steps.map((s) => s.title)).toContain('a step this test wrote')
  })

  /**
   * The refusal that has to say where to write instead. A tool that says only
   * "no" leaves somebody with a decision they cannot record anywhere, and the
   * next thing they do is write it in a second place.
   */
  test('a step on a journey whose steps are projected is refused, with somewhere to go', () => {
    const projected = slug().find((row) => row.plan === 'elsewhere')?.slug
    if (!projected) return
    const reply = post('/api/step', { slug: projected, title: 'x' }, TICKET)
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('projected')
  })
})

describe('the MCP door', () => {
  const rpc = (message: Record<string, unknown>) => answer('POST', '/mcp', query(), message, null)

  test('introduces itself with tools', () => {
    const body = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })?.body as { result: { serverInfo: unknown } }
    expect(body.result.serverInfo).toBeTruthy()
  })

  test('lists the tools it has', () => {
    const body = rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })?.body as {
      result: { tools: { name: string }[] }
    }
    expect(body.result.tools.map((t) => t.name)).toContain('list_journeys')
  })

  /**
   * The prototype hazard the protocol package's `ids.ts` writes an essay about,
   * one door over: a bare `TOOLS[name]` finds `constructor` on the prototype of
   * any plain object, and `.run(args)` on that is a TypeError thrown out of a
   * request handler rather than an answer saying there is no such tool.
   */
  test('answers "no such tool" for a name that lives on Object.prototype', () => {
    const body = rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'constructor' } })?.body as {
      result: { isError: boolean }
    }
    expect(body.result.isError).toBe(true)
  })

  test('a notification is answered with nothing', () => {
    const reply = rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBeNull()
  })
})

describe('what is not this app’s to answer', () => {
  /**
   * `null` means "not ours", and the middleware passes it to Vite. That is how
   * the page, the client module and Vite's own hot-reload socket keep working
   * without being enumerated in `doors.ts`.
   */
  test('a path this app does not own is handed on rather than refused', () => {
    expect(get('/page/main.ts')).toBeNull()
    expect(get('/@vite/client')).toBeNull()
  })

  /** But an unknown path under `/api/` is ours to refuse, not Vite's to guess at. */
  test('an unknown api path is refused here', () => {
    expect(get('/api/nothing-here')?.status).toBe(404)
  })

  test('the health check says which module is up', () => {
    const body = get('/healthz')?.body as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('roadmap.journeys')
  })
})
