import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { FACTORY_EVERY_MS } from '../src/journeys.ts'
import { settle, started, store, stubHost } from './host.ts'
import { answerOf, row } from './reading.ts'

/**
 * The Factory's stages on the page. The page used to ask `/api/factory` every 30 s from load to
 * close, journey or none, shown or hidden. Now the clock runs only while a journey with issues is
 * open and the page is shown; hidden, there is no timer at all, and shown again it reads once at once.
 * (The Factory's own stream is fenced to the Factory's page, so nothing can tell this page instead.)
 */

/* The reading, handed over so no question to the host is left open after a case. */
const READ = answerOf([row('gh#1', { state: 'open' }), row('gh#2', { state: 'open' }), row('gh#3', { state: 'open' })])

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  await started()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  store.reset()
  hide(false)
})

let projects = 0

function hide(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** The Factory clocks running now: intervals of `FACTORY_EVERY_MS` made and not cleared. */
function clocks() {
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  const live = new Set<unknown>()
  globalThis.setInterval = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
    const id = realSet(handler, ms, ...rest)
    if (ms === FACTORY_EVERY_MS) live.add(id)
    return id
  }) as typeof setInterval
  globalThis.clearInterval = ((id?: Parameters<typeof clearInterval>[0]) => {
    live.delete(id)
    realClear(id)
  }) as typeof clearInterval
  return {
    running: () => live.size,
    restore: () => {
      for (const id of live) realClear(id as Parameters<typeof clearInterval>[0])
      globalThis.setInterval = realSet
      globalThis.clearInterval = realClear
    },
  }
}

describe('the Factory’s stages: asked on a clock only while shown, never while hidden', () => {
  test('hidden: no timer; shown again: one read at once and the clock again', async () => {
    const watch = clocks()
    try {
      const host = stubHost()
      projects += 1
      host.greet([], { projectPath: `/Users/somebody/Projects/factory-${projects}` })
      await settle()
      host.answer('tracker.get', READ)
      render(<App />)
      await settle()
      await settle()
      expect(watch.running()).toBe(1)

      hide(true)
      expect(watch.running()).toBe(0)
      const before = store.factoryAsked.length
      await settle()
      expect(store.factoryAsked.length).toBe(before)

      hide(false)
      await settle()
      expect(watch.running()).toBe(1)
      expect(store.factoryAsked.length).toBe(before + 1)
    } finally {
      watch.restore()
    }
  })

  test('the module-level clock from load to close is gone', async () => {
    const source = await Bun.file(new URL('../src/journeys.ts', import.meta.url)).text()
    expect(source).not.toMatch(/^if \(typeof window !== 'undefined'\) setInterval/m)
  })
})
