import { describe, expect, test } from 'bun:test'
import { MESSAGE, PROTOCOL } from 'roadmap-module-protocol'

import { HostRefused, connect } from '../wire/host.ts'
import type { MessageSource } from '../wire/mailbox.ts'

/**
 * The wire, tested without a browser — which is why `connect` takes a
 * `MessageSource` rather than reaching for `window`.
 *
 * These are the decisions that were invisible until they went wrong in a frame:
 * whether a greeting is answered at all, whether a second window can answer our
 * correlation ids, and whether a `goto` is always acknowledged. Each of them
 * looks like silence from outside, and silence is the one symptom that says
 * nothing about its own cause.
 */

/** A window we can watch. `postMessage` is the only thing the wire uses. */
function fakeWindow() {
  const sent: unknown[] = []
  return {
    sent,
    postMessage(message: unknown) {
      sent.push(message)
    },
  }
}

/** A source we can post into, with a backlog like the real mailbox's. */
function fakeSource() {
  const listeners = new Set<(ev: MessageEvent) => void>()
  const backlog: MessageEvent[] = []
  const source: MessageSource = {
    parent: null,
    addEventListener(_type, fn) {
      for (const ev of backlog) fn(ev)
      listeners.add(fn)
    },
    removeEventListener(_type, fn) {
      listeners.delete(fn)
    },
  }
  const deliver = (data: unknown, from: unknown, origin = 'null') => {
    const ev = { data, source: from, origin } as unknown as MessageEvent
    backlog.push(ev)
    for (const fn of [...listeners]) fn(ev)
  }
  return { source, deliver }
}

const hello = (context: Record<string, unknown> = {}) => ({
  type: MESSAGE.HELLO,
  protocol: PROTOCOL,
  session: 'a-session',
  context: { epic: null, project: null, theme: 'light', ...context },
})

describe('being greeted', () => {
  test('answers the greeting with its own id and the protocol it heard', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    connect('roadmap.journeys', {}, source)
    deliver(hello(), host)
    expect(host.sent[0]).toMatchObject({ type: MESSAGE.READY, id: 'roadmap.journeys', protocol: PROTOCOL })
  })

  test('hands over the context that came with the greeting', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    let heard: string | null | undefined
    connect('roadmap.journeys', { onHello: (context) => (heard = context.epic) }, source)
    deliver(hello({ epic: 'modes-are-modules' }), host)
    expect(heard).toBe('modes-are-modules')
  })

  /**
   * The bug the mailbox exists for, from the other end: a greeting that arrived
   * before anybody subscribed is replayed on subscription. Without this the
   * host sees a module that loaded and never spoke, and the module's own screen
   * says nothing ever greeted it.
   */
  test('a greeting that arrived before we listened is still answered', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    deliver(hello(), host)
    connect('roadmap.journeys', {}, source)
    expect(host.sent).toHaveLength(1)
  })
})

describe('who is allowed to speak after the greeting', () => {
  /**
   * The identity is the window handle, not the origin. This page is framed on
   * an opaque origin, so every message it receives may carry `origin: "null"` —
   * a string every sandboxed frame in every tab shares, and therefore never a
   * name. A second sender answering our correlation ids is a page quietly
   * showing another roadmap's work under this one's.
   */
  test('a context from a window that never greeted us is ignored', () => {
    const host = fakeWindow()
    const stranger = fakeWindow()
    const { source, deliver } = fakeSource()
    let heard = 0
    connect('roadmap.journeys', { onContext: () => (heard += 1) }, source)
    deliver(hello(), host)
    deliver({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, epic: 'x', project: null, theme: 'light' }, stranger)
    expect(heard).toBe(0)
    deliver({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, epic: 'x', project: null, theme: 'light' }, host)
    expect(heard).toBe(1)
  })

  /**
   * Vite's own hot-reload socket posts at this window too, as does anything
   * else in the page. A module that trusted `data.type` alone would be one such
   * message away from an unexplained state.
   */
  test('something that is not a wire message is dropped without a word', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    connect('roadmap.journeys', {}, source)
    deliver({ type: 'vite:beforeUpdate' }, host)
    expect(host.sent).toHaveLength(0)
  })
})

describe('asking a question', () => {
  test('sends the method and settles on the answer that carries its id', async () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    const wire = connect('roadmap.journeys', {}, source)
    deliver(hello(), host)

    const asked = wire.request('live.get', { epic: 'modes-are-modules' })
    const sent = host.sent[1] as { id: string; method: string; params: unknown }
    expect(sent.method).toBe('live.get')
    expect(sent.params).toEqual({ epic: 'modes-are-modules' })

    deliver({ type: MESSAGE.RESPONSE, id: sent.id, ok: true, data: { issues: {} } }, host)
    expect(await asked).toEqual({ issues: {} })
  })

  test('a refusal rejects with the host’s own reason rather than a bare string', async () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    const wire = connect('roadmap.journeys', {}, source)
    deliver(hello(), host)

    const asked = wire.request('live.get', { epic: 'x' })
    const sent = host.sent[1] as { id: string }
    deliver({ type: MESSAGE.RESPONSE, id: sent.id, ok: false, reason: 'failed', error: 'no' }, host)

    await expect(asked).rejects.toBeInstanceOf(HostRefused)
  })

  /** With nobody greeting us there is nobody to ask, and saying so beats a timeout. */
  test('asking before a greeting is refused immediately', async () => {
    const { source } = fakeSource()
    const wire = connect('roadmap.journeys', {}, source)
    await expect(wire.request('live.get')).rejects.toBeInstanceOf(HostRefused)
  })
})

describe('being walked to a reference', () => {
  /**
   * `roadmap.went` is the first and only place the host waits on a module. It
   * times out into `found: false`, so a module that never answers cannot hang a
   * reference — but it also cannot say why, and the reader gets a wait instead
   * of a sentence. So the answer is guaranteed here, whatever the listener does.
   */
  test('a walk is answered even when nothing is listening for it', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    connect('roadmap.journeys', {}, source)
    deliver(hello(), host)
    deliver({ type: MESSAGE.GOTO, id: 'g1', ref: 'gh#41' }, host)
    expect(host.sent[1]).toMatchObject({ type: MESSAGE.WENT, id: 'g1', found: false })
  })

  test('a walk is answered even when the listener throws', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    connect(
      'roadmap.journeys',
      {
        onGoto: () => {
          throw new Error('the page fell over')
        },
      },
      source,
    )
    deliver(hello(), host)
    deliver({ type: MESSAGE.GOTO, id: 'g2', ref: 'gh#41' }, host)
    expect(host.sent[1]).toMatchObject({ type: MESSAGE.WENT, id: 'g2', found: false })
  })

  /**
   * And answered ONCE. The protocol says there is one `went` per `goto` and it
   * is the last word; a second would be an answer to a question the host has
   * already stopped waiting on, matched to an id it may have reused.
   */
  test('a walk is answered once, however many times the listener says so', () => {
    const host = fakeWindow()
    const { source, deliver } = fakeSource()
    connect(
      'roadmap.journeys',
      {
        onGoto: (_goto, answer) => {
          answer(true, 'found it')
          answer(false, 'no, lost it')
        },
      },
      source,
    )
    deliver(hello(), host)
    deliver({ type: MESSAGE.GOTO, id: 'g3', step: 2 }, host)
    expect(host.sent.filter((m) => (m as { type: string }).type === MESSAGE.WENT)).toHaveLength(1)
    expect(host.sent[1]).toMatchObject({ found: true, why: 'found it' })
  })
})
