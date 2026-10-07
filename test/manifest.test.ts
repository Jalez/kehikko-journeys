import { describe, expect, test } from 'bun:test'
import { PROTOCOL, manifestSchema, speaks } from 'kehikot-module-protocol'

import { ID, MANIFEST } from '../manifest.ts'

/**
 * The manifest is the only half of this program a host reads before deciding
 * whether to frame it, and the failure it can have is silent: a host that finds
 * the document, parses it, and reports the module as incompatible says so on
 * its own panel and nowhere near this repository.
 *
 * That is not hypothetical here. This module shipped `protocol: 1` and
 * `'>=1 <2'` against a host speaking 2, and framed as incompatible for exactly
 * that reason — a one-character fault, invisible from inside the app, which
 * nothing in the app could have noticed. These tests are the noticing.
 */
describe('the manifest a host reads', () => {
  test('parses under the protocol package that is installed', () => {
    expect(() => manifestSchema.parse(MANIFEST)).not.toThrow()
  })

  test('claims the protocol this package speaks, rather than the one it was written against', () => {
    expect(MANIFEST.protocol).toBe(PROTOCOL)
  })

  /**
   * The check the host actually performs. `speaks` is the host's own arithmetic
   * over the range string, so a range that is well-formed and wrong — `>=1 <2`
   * against a host on 2 — fails here in the same way it failed there.
   */
  test('declares a range that admits the installed protocol', () => {
    expect(speaks(MANIFEST.declares.protocol, PROTOCOL)).toBe(true)
  })

  test('is scoped to an epic, which is what protocol 2 calls a journey', () => {
    expect(MANIFEST.modes.map((mode) => mode.scope)).toEqual(['epic'])
  })

  /**
   * The entry has to be a path on this app's own origin, and it has to be the
   * path `vite.config.ts` claims before Vite's resolver sees it. A manifest
   * naming a path nothing answers on is a container that loads a 404 and reports a
   * module that would not speak.
   */
  test('names the page door this app actually serves', () => {
    expect(MANIFEST.entry).toBe('/app')
    expect(MANIFEST.health).toBe('/healthz')
    expect(MANIFEST.mcp?.url).toBe('/mcp')
  })

  /**
   * This app holds its own journeys and asks a host only for what a host alone
   * can see. The three writes are each a person's press carried to the host,
   * and `content:report` is this app saying its own material moved — it hands
   * nothing over. If `steps:read` ever appears here, something has started
   * reading its own material over a bridge.
   *
   * `epics:read` used to be pinned out beside it and is now pinned IN, for one
   * question: what the host holds for an epic, asked once, when a person
   * begins a journey for it. The owner decided this app owns an epic's steps
   * and a host reads them from here; the first record therefore has to be
   * what the host held. The second test is what keeps that from widening.
   */
  test('asks for nothing it holds itself', () => {
    expect(MANIFEST.declares.uses).toEqual([
      'trackers:read',
      'trackers:refresh',
      'selection:set',
      'filters:set',
      'disposition:set',
      'content:report',
      'epics:read',
    ])
    expect(MANIFEST.declares.uses).not.toContain('live:read')
    expect(MANIFEST.declares.uses).not.toContain('steps:read')
  })

  test('and the one question it asks about an epic is asked in one place: beginning a journey', async () => {
    const page = await Bun.file(new URL('../src/journeys.ts', import.meta.url)).text()
    /* Imported once and used once. A second use is this page drawing from a
       host what it keeps itself, which is what the capability was kept out for. */
    expect(page.match(/\bGET_EPIC\b/g)).toHaveLength(2)
    expect(page).toContain('host.request(GET_EPIC, { epic: slug })')
    for (const method of ['epics.list', 'steps.list']) expect(page).not.toContain(`'${method}'`)
  })

  /**
   * Both ends of the selection, and each is a claim about what the program
   * does rather than a wish.
   *
   * `selection:set` is sent: `pick` in `journeys.ts` calls `selection.set`
   * when a step is ticked, and the host refuses the call at the wire without
   * this word — declared or not, the refusal is the same, so the word is here
   * for the person reading the registry. `reacts: ['selection']` is received:
   * `showSelection` scrolls to the first picked reference on the page, which
   * is exactly the "program actually moves" the protocol's essay on `reacts`
   * asks an author to be able to say before ticking it. Together they are the
   * pair the host's `relations.ts` draws as "Consumes / Provides to" against
   * any module declaring the other half.
   */
  test('says it both sets the selection and moves when it changes', () => {
    expect(MANIFEST.declares.uses).toContain('selection:set')
    expect(MANIFEST.reacts).toContain('selection')
  })

  /**
   * Both ends of a disposition, for the same reason: the card's control calls
   * `disposition.set`, and a mark arriving in a context recomputes the card,
   * the rail and the step's "done".
   */
  test('says it marks why things closed and moves when a mark changes', () => {
    expect(MANIFEST.declares.uses).toContain('disposition:set')
    expect(MANIFEST.reacts).toEqual(['selection', 'dispositions', 'tracker', 'content', 'parts'])
  })

  /**
   * Both ends of a change to the journeys themselves, which are this app's
   * own. `content:report` is sent: `saveStep` in `journeys.ts` calls
   * `content.changed` once a step has been kept, so every other container on
   * the epic reads it. `reacts: ['content']` is received: a context whose
   * entries for this module and the open epic have moved re-reads the open
   * journey in place — which is how a step written through this app's MCP
   * door, from a process with no channel to the page, reaches the page.
   */
  test('says it reports its own writes and reads again when its material has changed', () => {
    expect(MANIFEST.declares.uses).toContain('content:report')
    expect(MANIFEST.reacts).toContain('content')
  })

  /**
   * Both ends of the refresh: the host's control asks `tracker.refresh`, and a
   * reading that moved — from a press anywhere — re-asks `tracker.get`.
   */
  test('says it reads the trackers again and moves when they have been read', () => {
    expect(MANIFEST.declares.uses).toContain('trackers:refresh')
    expect(MANIFEST.reacts).toContain('tracker')
  })

  /**
   * Storage, which the other modules must not ask for and this one must.
   *
   * It is the only module here that owns data and takes writes. Opaque, its own
   * `/api` calls are cross-origin — an origin of `null` matches nothing — so
   * the server would have to answer every origin permissively, and a permissive
   * `Access-Control-Allow-Origin` lets any page in any tab read `/app` off
   * loopback, take the write ticket printed into it, and post here. Declaring
   * storage gives this page its real origin back, which makes those calls
   * ordinary same-origin requests and removes CORS from the picture entirely.
   *
   * If this ever flips to `false`, `server.cors` has to come back in
   * `vite.config.ts` and the ticket is readable by strangers again. The two
   * belong together, and this test is where that is said out loud.
   */
  test('asks for an origin, because it owns what it serves', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('is the id the registration file is named after', () => {
    expect(MANIFEST.id).toBe(ID)
    expect(ID).toBe('kehikot.journeys')
  })
})
