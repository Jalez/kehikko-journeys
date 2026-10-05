import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { MESSAGE, filtersSchema, methodParams, type Disposition, type FilterGroup } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'
import { FACET_IDS, HIDE_GROUP } from 'kehikot-module-protocol/facets'

import { App } from '../src/app.tsx'
import { settle, started, stubHost, type Wire } from './host.ts'
import { answerOf, closedBy, row } from './reading.ts'

/**
 * The filter and the dispositions, over the real client on the real `window`.
 *
 * The host side — drawing a toggles group, storing a mark — is being built
 * elsewhere and cannot be framed against from here, so the protocol's own
 * schemas stand in for it: every offer this page sends is parsed with
 * `filtersSchema` and every `disposition.set` with `methodParams`, which is
 * what a host runs over them on arrival.
 *
 * Each case stands in a project of its own, because a context naming the
 * project this page is already in does not reload the journey — and these
 * cases need the reading `tracker.get` hands over, which is asked on each load.
 */

/* Step one: issue gh#1 open, carrying change gh#2, which closed without
   merging. Step two: issue gh#3, closed for no reason anybody can read. */
const READ = answerOf([
  row('gh#1', { state: 'open', links: closedBy('gh#2') }),
  row('gh#2', { kind: 'change', state: 'closed' }),
  row('gh#3', { state: 'closed' }),
])

let wire: Wire
let projects = 0

/* The page commits through `flushSync` from message handlers, which is how it
   runs in a browser; React's act() warning is about test-driven updates and
   has nothing to say about these. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
})

/** A host, greeted in a fresh project, with the reading handed over and the page drawn. */
async function framed(more: Record<string, unknown> = {}) {
  const host = stubHost()
  projects += 1
  host.greet([], { projectPath: `/Users/somebody/Projects/filter-${projects}`, ...more })
  await settle()
  host.answer('tracker.get', READ)
  await settle()
  render(<App />)
  return host
}

const lastOffer = (host: ReturnType<typeof stubHost>) => host.offers().at(-1) as FilterGroup[]

describe('the filter this page offers', () => {
  test('is one toggles group called hide, built from the shared facets, that a host would accept', async () => {
    const host = await framed()
    const groups = lastOffer(host)
    expect(() => filtersSchema.parse({ type: MESSAGE.FILTERS, groups })).not.toThrow()
    expect(groups).toHaveLength(1)
    const [hide] = groups
    expect(hide?.id).toBe(HIDE_GROUP)
    expect(hide?.kind).toBe('toggles')
    for (const option of hide?.options ?? []) expect(FACET_IDS).toContain(option.id as never)
    /* Counted on this journey, and the facets nothing here has are left out. */
    expect(hide?.options.find((o) => o.id === 'change:closed')?.label).toBe('closed MRs/PRs (1)')
    expect(hide?.options.some((o) => o.id === 'change:merged')).toBe(false)
  })

  test('is applied from the context: the cards it hides go, and the step says how many', async () => {
    await framed({ filters: { [HIDE_GROUP]: ['issue:closed'] } })
    expect(wire.getSnapshot().hidden).toEqual(['issue:closed'])
    expect(document.querySelector('[data-card="gh#3"]')).toBeNull()
    expect(document.querySelector('[data-step="2"]')?.textContent).toContain('1 hidden by the filter')
  })
})

describe('a walk to a card the filter hides', () => {
  const went = (host: ReturnType<typeof stubHost>) =>
    host.said.filter((m) => m.type === MESSAGE.WENT).at(-1) as { found: boolean; why: string } | undefined

  test('asks the host to lift the facet hiding it, opens the fold it is under, and finds it', async () => {
    const host = await framed({ filters: { [HIDE_GROUP]: ['change:closed', 'issue:closed'] } })
    expect(document.querySelector('[data-card="gh#2"]')).toBeNull()
    host.post({ type: MESSAGE.GOTO, id: 'walk-1', ref: 'gh#2' })
    await settle()
    const asked = host.asked('filters.set').at(-1)
    /* Only what hid gh#2 is lifted; the rest of the choice stands. */
    expect(asked?.params).toEqual({ filters: { [HIDE_GROUP]: ['issue:closed'] } })
    host.answer('filters.set', { filters: { [HIDE_GROUP]: ['issue:closed'] } })
    await settle()
    expect(wire.getSnapshot().unfolded).toContain('gh#1')
    expect(document.querySelector('[data-card="gh#2"]')).not.toBeNull()
    expect(went(host)).toMatchObject({ found: true })
  })

  test('says so, and answers not found, when the host will not lift it', async () => {
    const host = await framed({ filters: { [HIDE_GROUP]: ['issue:closed'] } })
    host.post({ type: MESSAGE.GOTO, id: 'walk-2', ref: 'gh#3' })
    await settle()
    host.refuse('filters are pinned here', 'filters.set')
    await settle()
    expect(went(host)?.found).toBe(false)
    expect(went(host)?.why).toContain('filters are pinned here')
  })
})

describe('marking why something closed', () => {
  test('sends disposition.set in the shape the protocol takes, and nothing the host fills in', async () => {
    const host = await framed()
    void wire.markDisposition('gh#3', 'wont-do')
    const plain = host.asked('disposition.set').at(-1)?.params
    expect(plain).toEqual({ ref: 'gh#3', value: 'wont-do', note: '' })
    expect(() => methodParams['disposition.set'].parse(plain)).not.toThrow()
  })

  test('names the other ref for a duplicate, and never for done', async () => {
    const host = await framed()
    void wire.markDisposition('gh#3', 'duplicate', ' gh#9 ')
    void wire.markDisposition('gh#3', 'done', 'gh#9')
    const [duplicate, done] = host.asked('disposition.set').slice(-2).map((m) => m.params)
    expect(duplicate).toMatchObject({ value: 'duplicate', target: 'gh#9' })
    expect(done).not.toHaveProperty('target')
    for (const params of [duplicate, done]) expect(() => methodParams['disposition.set'].parse(params)).not.toThrow()
  })

  test('a refusal is quoted, and nothing is drawn as marked', async () => {
    const host = await framed()
    const marking = wire.markDisposition('gh#3', 'done')
    host.refuse('marks are read-only here', 'disposition.set')
    await marking
    expect(wire.getSnapshot().said).toContain('marks are read-only here')
    expect(wire.getSnapshot().marks).toEqual([])
  })

  test('a mark arriving in the context settles the step and says whose it is', async () => {
    const marks: Disposition[] = [{ ref: 'gh#3', value: 'done', target: null, note: '', by: 'ada', at: null }]
    await framed({ dispositions: marks })
    expect(wire.getSnapshot().marks).toEqual(marks)
    const step = document.querySelector('[data-step="2"]')
    expect(step?.textContent).toContain('marked by ada')
    expect(step?.textContent).toContain('done')
    expect(step?.textContent).not.toContain('to decide')
  })
})
