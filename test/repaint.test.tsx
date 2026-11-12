import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { FLICKED, HOLD_MS, REPAINT_AFTER_MS, repaint, repainter, repaints, type Paintable } from '../src/repaint.ts'

import { settle, started, store, stubHost } from './host.ts'

/**
 * A page black until it is scrolled: the DOM was whole and the pixels were not. The host shows
 * this page again (its cover off, another kehikko, a fold) by flipping `visibility`, and WebKit does
 * not always repaint a frame that changed while hidden until something scrolls it. These cases
 * hold the page to drawing everything without a scroll, and to repainting itself after it is shown.
 */

const AFTER_ALL_MS = REPAINT_AFTER_MS[REPAINT_AFTER_MS.length - 1]! + 80
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

function page(box: Paintable['box']): Paintable & { run(): void } {
  const queued: (() => void)[] = []
  return {
    box,
    root: { style: { opacity: '' } },
    later: (fn, ms) => {
      expect(ms).toBe(HOLD_MS)
      queued.push(fn)
    },
    run: () => queued.splice(0).forEach((fn) => fn()),
  }
}

describe('one repaint', () => {
  test('scrolls one pixel and back, and flicks the root opacity for two frames', () => {
    const on = page({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 })
    repaint(on)
    expect(on.box!.scrollTop).toBe(1)
    expect(on.root!.style.opacity).toBe(FLICKED)
    on.run()
    expect(on.box!.scrollTop).toBe(0)
    expect(on.root!.style.opacity).toBe('')
  })

  test('at the bottom it moves up, and puts the scroll back exactly', () => {
    const on = page({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 })
    repaint(on)
    expect(on.box!.scrollTop).toBe(599)
    on.run()
    expect(on.box!.scrollTop).toBe(600)
  })

  test('a page too short to scroll is not scrolled, and is still repainted by the opacity', () => {
    const on = page({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })
    repaint(on)
    expect(on.box!.scrollTop).toBe(0)
    expect(on.root!.style.opacity).toBe(FLICKED)
    on.run()
    expect(on.root!.style.opacity).toBe('')
  })

  test("the person's own scroll in between is kept", () => {
    const on = page({ scrollTop: 100, scrollHeight: 900, clientHeight: 300 })
    repaint(on)
    on.box!.scrollTop = 340
    on.run()
    expect(on.box!.scrollTop).toBe(340)
  })

  test('a burst of reasons repaints once per moment, not once per reason', async () => {
    let done = 0
    const nothing: Paintable = { box: null, root: null, later: () => {} }
    const after = repainter(() => {
      done++
      return nothing
    })
    after.soon()
    after.soon()
    after.soon()
    await wait(AFTER_ALL_MS)
    expect(done).toBe(REPAINT_AFTER_MS.length)
  })
})

describe('the page, without a scroll', () => {
  beforeAll(async () => {
    await started()
  })
  afterEach(() => {
    cleanup()
    mailbox.forget?.()
    document.body.innerHTML = ''
    store.reset()
  })

  test('drawn while hidden at 0×0, it shows the journey and repaints after it says so, with no scroll event', async () => {
    {
      const host = stubHost()
      host.post({
        type: MESSAGE.HELLO,
        protocol: PROTOCOL,
        session: 's',
        context: { epic: 'probe', project: 'probe', projectPath: '/Users/somebody/Projects/repaint', theme: 'dark', selection: [], filters: {} },
        state: null,
      })
      /* Covered and folded: hidden, and laid out at nothing. */
      host.post({ type: MESSAGE.VISIBLE, protocol: PROTOCOL, visible: false })
      await settle()
      const before = repaints.count
      render(<App />)
      await settle()
      expect(document.body.textContent).toContain('One')
      expect(document.body.textContent).toContain('Two')
      /* Nothing on the page is held back behind the cover's wrapper once a journey is open. */
      expect(document.querySelector('[data-kehikot-page] > div[hidden]')).toBeNull()
      await wait(AFTER_ALL_MS)
      expect(repaints.count).toBeGreaterThan(before)

      /* Shown again by the host, then the frame resized (unfolded): repainted each time. */
      const shown = repaints.count
      host.post({ type: MESSAGE.VISIBLE, protocol: PROTOCOL, visible: true })
      await wait(AFTER_ALL_MS)
      expect(repaints.count).toBe(shown + REPAINT_AFTER_MS.length)

      const resized = repaints.count
      window.dispatchEvent(new Event('resize'))
      await wait(AFTER_ALL_MS)
      expect(repaints.count).toBe(resized + REPAINT_AFTER_MS.length)

      const back = repaints.count
      document.dispatchEvent(new Event('visibilitychange'))
      await wait(AFTER_ALL_MS)
      expect(repaints.count).toBe(back + REPAINT_AFTER_MS.length)
    }
  })
})
