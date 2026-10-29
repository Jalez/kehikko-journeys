import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { scrolls, settle, started, store, streams, stubHost, type Wire } from './host.ts'

/**
 * The page, pointed at a step by an agent (`focus_step`): it scrolls to the
 * card, lights it and shows the agent's line as text. The person taking the
 * page back sets that aside until the agent points again. No layout here
 * (happy-dom), so the scroll is counted, and a browser is never run.
 */

let wire: Wire
let projects = 0
let pointers = 0
let lastAt = ''

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

beforeEach(() => {
  wire.takeBack()
  scrolls.reset()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  store.reset()
})

async function framed() {
  const host = stubHost()
  projects += 1
  host.greet([], { projectPath: `/Users/somebody/Projects/pointer-${projects}` })
  await settle()
  render(<App />)
  await settle()
  return host
}

/** The agent points at a step; the server says so on the stream and the page follows. */
async function point(step: number, say = '') {
  pointers += 1
  lastAt = new Date(Date.now() + pointers).toISOString()
  streams.current().say({ step, title: `Step ${step}`, say, at: lastAt })
  await settle()
}

const lit = () => [...document.querySelectorAll('[data-pointed]')].map((el) => el.getAttribute('data-step'))
const says = () => document.querySelector('[data-says]')?.textContent ?? null

describe('an agent pointing the page at a step', () => {
  test('brings the card into view, lights it and shows the line beside it', async () => {
    await framed()
    expect(lit()).toEqual([])
    await point(2, 'Here is where the depth cap lives.')
    expect(lit()).toEqual(['2'])
    expect(says()).toBe('Here is where the depth cap lives.')
    expect(scrolls.last()?.element.getAttribute('data-step')).toBe('2')
    expect(document.querySelector('[data-step="2"] [data-says]')).not.toBeNull()
    expect(document.querySelector('[data-step="1"] [data-says]')).toBeNull()
  })

  test('with no line there is none drawn, and the card is still lit', async () => {
    await framed()
    await point(1)
    expect(lit()).toEqual(['1'])
    expect(says()).toBeNull()
  })

  test('the line is only ever text: no markup, no link', async () => {
    await framed()
    await point(1, '<b>bold</b> <a href="https://evil.example">here</a> https://evil.example')
    expect(says()).toBe('<b>bold</b> <a href="https://evil.example">here</a> https://evil.example')
    const line = document.querySelector('[data-says]')!
    expect(line.children).toHaveLength(0)
    expect(line.querySelector('a, b')).toBeNull()
  })

  test('moving the pointer to another step moves the light', async () => {
    await framed()
    await point(1, 'one')
    await point(2, 'two')
    expect(lit()).toEqual(['2'])
    expect(says()).toBe('two')
  })

  test('the same pointer is followed once: it does not scroll the page back under the person', async () => {
    await framed()
    await point(2, 'x')
    const once = scrolls.count()
    /* A reconnect says the pointer again: the same one, which is not followed twice. */
    const same = { step: 2, title: 'Step 2', say: 'x', at: lastAt }
    streams.current().say(same)
    streams.current().say(same)
    expect(scrolls.count()).toBe(once)
  })

  test('naming no step takes the light off', async () => {
    await framed()
    await point(1, 'x')
    streams.current().say(null)
    await settle()
    expect(lit()).toEqual([])
    expect(says()).toBeNull()
  })

  test('a pointer left over from long before the page opened is not followed', async () => {
    await framed()
    pointers += 1
    streams.current().say({ step: 1, title: 'One', say: 'old', at: new Date(Date.now() - 3_600_000).toISOString() })
    await settle()
    expect(lit()).toEqual([])
  })

  test('a step the journey does not draw lights nothing and breaks nothing', async () => {
    await framed()
    await point(9, 'nowhere')
    expect(lit()).toEqual([])
  })
})

describe('the person taking the page back', () => {
  const setAside = async (how: () => void) => {
    await framed()
    await point(2, 'mine')
    expect(lit()).toEqual(['2'])
    how()
    await settle()
    expect(lit()).toEqual([])
    expect(says()).toBeNull()
    /* It stays theirs: the same pointer, asked again, is not followed. */
    const before = scrolls.count()
    streams.current().say({ step: 2, title: 'Step 2', say: 'mine', at: lastAt })
    await settle()
    expect(lit()).toEqual([])
    expect(scrolls.count()).toBe(before)
    /* Until the agent points anew. */
    await point(1, 'again')
    expect(lit()).toEqual(['1'])
    expect(says()).toBe('again')
  }

  test('by scrolling with the wheel', () => setAside(() => window.dispatchEvent(new Event('wheel'))))

  test('by dragging a touch', () => setAside(() => window.dispatchEvent(new Event('touchmove'))))

  test('by a key that scrolls', () => setAside(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))))

  test('but not by a key that does not', async () => {
    await framed()
    await point(2, 'mine')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await settle()
    expect(lit()).toEqual(['2'])
  })

  test('by picking a step', () => setAside(() => wire.pick(['gh#1'])))

  test('by opening a step to edit it', () => setAside(() => wire.setEditing(0)))

  test('and the scroll the page makes for the pointer is not the person scrolling', async () => {
    await framed()
    await point(2, 'mine')
    await point(1, 'next')
    expect(lit()).toEqual(['1'])
  })
})

describe('the stream, and no polling', () => {
  const hide = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => hide(false))

  test('one stream is open for the journey on the page, on the project and slug', async () => {
    await framed()
    const url = new URL(streams.current().url, 'http://x')
    expect(url.pathname).toBe('/api/pointing/events')
    expect(url.searchParams.get('slug')).toBe('probe')
    expect(url.searchParams.get('project')).toBe(`/Users/somebody/Projects/pointer-${projects}`)
  })

  test('a hidden page closes it, and showing the page opens it again', async () => {
    await framed()
    const first = streams.current()
    hide(true)
    expect(first.closed).toBe(true)
    expect(streams.open()).toHaveLength(0)
    hide(false)
    expect(streams.open()).toHaveLength(1)
    expect(streams.current()).not.toBe(first)
  })

  test('a stream that was let go cannot move the page', async () => {
    await framed()
    const first = streams.current()
    hide(true)
    first.say({ step: 1, title: 'One', say: 'late', at: new Date().toISOString() })
    await settle()
    expect(lit()).toEqual([])
  })

  test('the page never asks for the pointer: no request goes to /api/pointing', async () => {
    await framed()
    await point(1, 'x')
    await point(2, 'y')
    hide(true)
    hide(false)
    await settle()
    expect(store.asked.filter((line) => line.includes('/api/pointing'))).toEqual([])
  })
})
