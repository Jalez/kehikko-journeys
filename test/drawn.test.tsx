import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'
import { ReportErrors } from 'kehikot-module-protocol/client/react'

import { App, drawnOf } from '../src/app.tsx'
import { PAGE_FAILED, pageFallback } from '../src/view/boundary.tsx'

import { settle, started, store, stubHost } from './host.ts'

/**
 * Protocol 2.70.0: the host keeps its cover up until the page says it is drawn (`ready()`), and the
 * page is mounted through `mountPage`, inside the protocol's `ReportErrors`.
 */

const base = {
  where: 'hosted' as const,
  journey: null,
  epic: 'probe',
  unwritten: null,
  trouble: null,
  nowhere: false,
  scope: 'epic' as const,
  everything: null,
  index: [],
}
const JOURNEY = { slug: 'probe', title: 'A journey', lede: '', callout: '', steps: [], plan: 'stored' as const, blockedBy: {} }

describe('when the page is drawn', () => {
  test('not while listening, nor while the open epic is still being read', () => {
    expect(drawnOf({ ...base, where: 'listening' }, 'waiting')).toBe(false)
    expect(drawnOf(base, null)).toBe(false)
    expect(drawnOf({ ...base, scope: 'project' }, null)).toBe(false)
  })

  test('the journey, the press that begins one, every journey, trouble, or a sentence of the cover', () => {
    expect(drawnOf({ ...base, journey: JOURNEY }, null)).toBe(true)
    expect(drawnOf({ ...base, unwritten: 'probe' }, null)).toBe(true)
    expect(drawnOf({ ...base, scope: 'project', everything: [] }, null)).toBe(true)
    expect(drawnOf({ ...base, trouble: 'will not read' }, null)).toBe(true)
    expect(drawnOf({ ...base, nowhere: true }, null)).toBe(true)
    expect(drawnOf({ ...base, epic: null }, 'no-epic')).toBe(true)
    expect(drawnOf(base, 'down')).toBe(true)
  })
})

describe('ready() on the page', () => {
  beforeAll(async () => {
    await started()
  })
  afterEach(() => {
    cleanup()
    mailbox.forget?.()
    document.body.innerHTML = ''
    store.reset()
  })

  test('said once the journey is drawn, even while the host keeps the page hidden', async () => {
    const host = stubHost()
    host.post({
      type: MESSAGE.HELLO,
      protocol: PROTOCOL,
      session: 's',
      context: { epic: 'probe', project: 'probe', projectPath: '/Users/somebody/Projects/drawn', theme: 'light', selection: [], filters: {} },
      state: null,
    })
    /* Covered: the host hides the page until it is drawn. Nothing waits on this. */
    host.post({ type: MESSAGE.VISIBLE, visible: false })
    await settle()
    const ready = host.said.find((m) => m.type === MESSAGE.READY) as { hold?: boolean } | undefined
    expect(ready).toBeDefined()
    render(<App />)
    await settle()
    expect(document.body.textContent).toContain('One')
    const drawn = host.said.filter((m) => m.type === MESSAGE.DRAWN)
    /* A greeting holds until the page has said `ready()` once in its life; later ones do not hold. */
    expect(drawn).toHaveLength(ready?.hold ? 1 : 0)
    render(<App />)
    await settle()
    expect(host.said.filter((m) => m.type === MESSAGE.DRAWN)).toHaveLength(drawn.length)
  })
})

describe('mounting the page', () => {
  test('the entry mounts through mountPage, after the client', async () => {
    const entry = await Bun.file(new URL('../src/main.tsx', import.meta.url)).text()
    const client = entry.indexOf("import 'kehikot-module-protocol/client'")
    expect(client).toBeGreaterThan(-1)
    expect(entry.indexOf("from 'kehikot-module-protocol/client/mount'")).toBeGreaterThan(client)
    expect(entry).toContain("mountPage('root', <App />, { fallback: pageFallback })")
    expect(entry).not.toContain('createRoot')
  })

  test("a render that throws draws this page's own words, inside the protocol's ReportErrors", () => {
    const Throws = () => {
      throw new Error('no such step')
    }
    const quiet = console.error
    console.error = () => {}
    try {
      render(
        <ReportErrors fallback={pageFallback}>
          <Throws />
        </ReportErrors>,
      )
    } finally {
      console.error = quiet
    }
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(PAGE_FAILED)
    expect(alert?.textContent).toContain('no such step')
    cleanup()
  })
})
