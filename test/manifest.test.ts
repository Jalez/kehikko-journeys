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
    expect(MANIFEST.declares.storage).toBe(false)
  })

  test('is the id the registration file is named after', () => {
    expect(MANIFEST.id).toBe(ID)
    expect(ID).toBe('roadmap.journeys')
  })
})
