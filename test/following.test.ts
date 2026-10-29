import { describe, expect, test } from 'bun:test'

import type { Pointing } from '../pointing.ts'
import { follower, streamFor, type Following, type Source } from '../src/following.ts'

/** The page's listening to the server's stream: when it opens, moves and closes one, and what it takes in. */

class Fake implements Source {
  closed = false
  private listener: ((event: { data?: string }) => void) | null = null
  constructor(readonly address: string) {}
  addEventListener(_type: string, listener: (event: { data?: string }) => void) {
    this.listener = listener
  }
  close() {
    this.closed = true
  }
  send(data: string) {
    this.listener?.({ data })
  }
}

function setup(over: Partial<Following> = {}) {
  const sources: Fake[] = []
  const taken: [string, Pointing | null][] = []
  const state = { want: streamFor('/p', 'walk') as string | null, hidden: false }
  const how: Following = {
    want: () => state.want,
    hidden: () => state.hidden,
    open: (address) => {
      const one = new Fake(address)
      sources.push(one)
      return one
    },
    take: (address, pointing) => void taken.push([address, pointing]),
    ...over,
  }
  const one = follower(how)
  return { one, sources, taken, state }
}

const pointer = (at: string): Pointing => ({ step: 2, title: 'Two', say: 'x', at })

describe('following the stream', () => {
  test('the address names the project and the journey, escaped', () => {
    const url = new URL(streamFor('/a b/c&d', 'walk'), 'http://x')
    expect(url.pathname).toBe('/api/pointing/events')
    expect(url.searchParams.get('project')).toBe('/a b/c&d')
    expect(url.searchParams.get('slug')).toBe('walk')
  })

  test('opens one stream, and checking again with nothing changed opens no other', () => {
    const { one, sources } = setup()
    one.check()
    one.check()
    one.check()
    expect(sources).toHaveLength(1)
  })

  test('what the stream says is taken in, for the stream it came from', () => {
    const { one, sources, taken } = setup()
    one.check()
    sources[0]!.send(JSON.stringify({ pointing: pointer('a') }))
    sources[0]!.send(JSON.stringify({ pointing: null }))
    expect(taken.map(([address, pointing]) => [address, pointing?.at ?? null])).toEqual([
      [sources[0]!.address, 'a'],
      [sources[0]!.address, null],
    ])
  })

  test('a hidden page closes the stream, and a shown one opens it again', () => {
    const { one, sources, state } = setup()
    one.check()
    state.hidden = true
    one.check()
    expect(sources[0]!.closed).toBe(true)
    one.check()
    expect(sources).toHaveLength(1)
    state.hidden = false
    one.check()
    expect(sources).toHaveLength(2)
    expect(sources[1]!.closed).toBe(false)
  })

  test('a stream that was closed says nothing more', () => {
    const { one, sources, taken, state } = setup()
    one.check()
    state.hidden = true
    one.check()
    sources[0]!.send(JSON.stringify({ pointing: pointer('late') }))
    expect(taken).toEqual([])
  })

  test('another journey is another stream, and the first is closed', () => {
    const { one, sources, state } = setup()
    one.check()
    state.want = streamFor('/p', 'other')
    one.check()
    expect(sources.map((source) => source.closed)).toEqual([true, false])
    expect(sources[1]!.address).toContain('slug=other')
  })

  test('with no journey there is no stream', () => {
    const { one, sources, state } = setup()
    state.want = null
    one.check()
    expect(sources).toEqual([])
  })

  test('what is not the server’s event is ignored, and nothing is thrown', () => {
    const { one, sources, taken } = setup()
    one.check()
    sources[0]!.send('not json')
    expect(taken).toEqual([])
  })

  test('there is no timer: a fake minute of nothing opens one stream and makes no other call', () => {
    const calls: string[] = []
    const { one, sources } = setup({ open: (address) => (calls.push(address), new Fake(address)) })
    one.check()
    /* Nothing in this module can fire without a check: no clock is read, no request is made. */
    expect(calls).toHaveLength(1)
    expect(sources).toHaveLength(0)
  })

  test('stop closes it', () => {
    const { one, sources } = setup()
    one.check()
    one.stop()
    expect(sources[0]!.closed).toBe(true)
  })
})
