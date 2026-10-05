import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { MESSAGE, PROTOCOL, methodParams, refreshableSchema, type Refreshable } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { settle, started, stubHost, type Wire } from './host.ts'
import { AT, answerOf, closedBy, row } from './reading.ts'

/**
 * The shared tracker reading, over the real client on the real `window`.
 *
 * The host half — `tracker.get`, `tracker.refresh`, `context.tracker` and the
 * refresh control — is Jalez/kehikko#25 and cannot be framed against from
 * here, so the protocol's own schemas stand in for it: every question this
 * page asks is parsed with `methodParams`, every `kehikot.refreshable` it
 * sends with `refreshableSchema`, and every answer the stand-in gives is built
 * with `trackerReadingResult`, which is what each side runs on arrival.
 *
 * Each case stands in a project of its own, because a context naming the
 * project this page is already in does not reload the journey.
 */

let wire: Wire
let projects = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  mailbox.forget?.()
})

const LATER = '2026-10-05T11:00:00.000Z'

/** The stand-in journey names gh#1, gh#2 and gh#3; gh#1 carries a change the first answer has no row for. */
const FIRST = answerOf(
  [
    row('gh#1', { state: 'open', links: closedBy('gh#7') }),
    row('gh#2', { state: 'closed', stateReason: 'COMPLETED' }),
  ],
  [{ ref: 'gh#3', reason: 'pending' }],
)

/** A host, greeted in a fresh project, with the first reading answered. */
async function framed(tracker: { at: string | null; refreshing: boolean } = { at: AT, refreshing: false }) {
  const host = stubHost()
  projects += 1
  const projectPath = `/Users/somebody/Projects/tracker-${projects}`
  host.greet([], { projectPath, tracker })
  await settle()
  host.answer('tracker.get', FIRST)
  await settle()
  const context = (more: Record<string, unknown>) => host.context([], 'probe', { projectPath, ...more })
  return { host, context }
}

const offers = (host: ReturnType<typeof stubHost>): Refreshable[] =>
  host.said.filter((m) => m.type === MESSAGE.REFRESHABLE).map((m) => refreshableSchema.parse(m))

describe('reading the trackers', () => {
  test('asks tracker.get for the journey’s own refs, in the shape the protocol takes', async () => {
    const { host } = await framed()
    const [first] = host.asked('tracker.get')
    expect(first?.params).toEqual({ refs: ['gh#1', 'gh#2', 'gh#3'] })
    expect(() => methodParams['tracker.get'].parse(first?.params)).not.toThrow()
    /* `live.get` is gone: one reading for GitHub and GitLab alike. */
    expect(host.asked('live.get')).toHaveLength(0)
  })

  test('asks a second time for exactly the changes the first answer linked and did not read', async () => {
    const { host } = await framed()
    const second = host.asked('tracker.get')[1]
    expect(second?.params).toEqual({ refs: ['gh#7'] })
    host.answer('tracker.get', answerOf([row('gh#7', { kind: 'change', state: 'merged' })]))
    await settle()
    const live = wire.getSnapshot().live
    expect(live?.rows.get('gh#7')?.state).toBe('merged')
    expect(live?.rows.get('gh#2')?.state).toBe('closed')
    expect(live?.missing.get('gh#3')).toBe('pending')
  })

  test('a refusal is said, and no reading is drawn as if it were one', async () => {
    const host = stubHost()
    projects += 1
    host.greet([], { projectPath: `/Users/somebody/Projects/tracker-${projects}` })
    await settle()
    host.refuse('trackers:read is not granted', 'tracker.get')
    await settle()
    expect(wire.getSnapshot().live).toBeNull()
    expect(wire.getSnapshot().refused).toContain('tracker.get')
    expect(wire.getSnapshot().withheld).toContain('trackers:read is not granted')
  })
})

describe('when the shared reading moves', () => {
  test('a context whose tracker.at moved re-asks tracker.get, without a reload', async () => {
    const { host, context } = await framed()
    host.answer('tracker.get', answerOf([row('gh#7', { kind: 'change', state: 'open' })]))
    await settle()
    const before = host.asked('tracker.get').length
    context({ tracker: { at: LATER, refreshing: false } })
    await settle()
    expect(host.asked('tracker.get').length).toBe(before + 1)
    expect(host.asked('tracker.get').at(-1)?.params).toEqual({ refs: ['gh#1', 'gh#2', 'gh#3'] })
    host.answer('tracker.get', answerOf([row('gh#3', { state: 'open' })], [], { at: LATER }))
    await settle()
    expect(wire.getSnapshot().live?.rows.get('gh#3')?.state).toBe('open')
  })

  test('a context that did not move it asks nothing', async () => {
    const { host, context } = await framed()
    const before = host.asked('tracker.get').length
    context({ tracker: { at: AT, refreshing: false }, selection: ['gh#1'] })
    await settle()
    expect(host.asked('tracker.get').length).toBe(before)
  })

  test('while somebody is reading, the page is busy and says so to the host', async () => {
    const { host, context } = await framed()
    context({ tracker: { at: AT, refreshing: true } })
    await settle()
    expect(wire.getSnapshot().busy).toBe(true)
    expect(offers(host).at(-1)?.busy).toBe(true)
    context({ tracker: { at: LATER, refreshing: false } })
    await settle()
    expect(wire.getSnapshot().busy).toBe(false)
    expect(offers(host).at(-1)?.busy).toBe(false)
  })
})

describe('the refresh this page offers', () => {
  test('is offered once there are refs to read, dated by the reading’s own at', async () => {
    const { host } = await framed()
    const last = offers(host).at(-1)
    expect(last).toMatchObject({ can: true, at: AT, busy: false })
  })

  test('a press asks tracker.refresh for this journey, busy while it runs, then reads again', async () => {
    const { host } = await framed()
    host.answer('tracker.get', answerOf([row('gh#7', { kind: 'change', state: 'open' })]))
    await settle()
    host.post({ type: MESSAGE.REFRESH, protocol: PROTOCOL })
    await settle()
    const asked = host.asked('tracker.refresh').at(-1)
    /* Every card's ref, the carried-in change included. */
    expect(asked?.params).toEqual({ refs: ['gh#1', 'gh#2', 'gh#3', 'gh#7'] })
    expect(() => methodParams['tracker.refresh'].parse(asked?.params)).not.toThrow()
    expect(wire.getSnapshot().busy).toBe(true)
    expect(offers(host).at(-1)?.busy).toBe(true)

    /* A second press while the first runs is the same read, not another. */
    host.post({ type: MESSAGE.REFRESH, protocol: PROTOCOL })
    await settle()
    expect(host.asked('tracker.refresh')).toHaveLength(1)

    const before = host.asked('tracker.get').length
    host.answer('tracker.refresh', { outcome: 'read', at: LATER, why: '' })
    await settle()
    expect(wire.getSnapshot().busy).toBe(false)
    expect(host.asked('tracker.get').length).toBe(before + 1)
    host.answer('tracker.get', answerOf([row('gh#1', { state: 'closed' })], [], { at: LATER }))
    await settle()
    expect(offers(host).at(-1)).toMatchObject({ can: true, at: LATER, busy: false })
  })

  test('a refresh the host declined is said, in its words', async () => {
    const { host } = await framed()
    host.post({ type: MESSAGE.REFRESH, protocol: PROTOCOL })
    await settle()
    host.answer('tracker.refresh', { outcome: 'declined', at: AT, why: 'this host does not read trackers for frames' })
    await settle()
    expect(wire.getSnapshot().said).toContain('this host does not read trackers for frames')
    expect(wire.getSnapshot().busy).toBe(false)
  })

  test('standing alone in no project, nothing is offered as refreshable', async () => {
    const host = stubHost()
    host.greet([], { projectPath: `/Users/somebody/Projects/tracker-${++projects}`, epic: null })
    await settle()
    expect(offers(host).at(-1)?.can ?? false).toBe(false)
  })
})
