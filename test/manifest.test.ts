import { describe, expect, test } from 'bun:test'
import { PROTOCOL, manifestSchema, speaks } from 'roadmap-module-protocol'

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
   * naming a path nothing answers on is a pane that loads a 404 and reports a
   * module that would not speak.
   */
  test('names the page door this app actually serves', () => {
    expect(MANIFEST.entry).toBe('/app')
    expect(MANIFEST.health).toBe('/healthz')
    expect(MANIFEST.mcp?.url).toBe('/mcp')
  })

  /**
   * One capability, and it is the whole claim of the extraction: this app holds
   * its own journeys and asks a host only for what a host alone can see. If
   * `epics:read` or `steps:read` ever appears here, something has started
   * reading its own material over a bridge.
   */
  test('asks for nothing it holds itself', () => {
    expect(MANIFEST.declares.uses).toEqual(['live:read'])
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
    expect(ID).toBe('roadmap.journeys')
  })
})
