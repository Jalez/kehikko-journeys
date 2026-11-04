import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { footerItemsSchema, headerItemsSchema, LIMITS, MESSAGE, PROTOCOL, type FooterItem } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { footerItems, footerPressed, headerItems, progressSaid, type FooterState } from '../src/footer.ts'

import { settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * The rows the host draws: the header is how the module is set up ("pick every step"), the
 * footer is what is going on now (the line, the pointed step, the picks with Clear, the progress).
 */

const base: FooterState = {
  status: null,
  progress: { done: 2, total: 5, blocked: 1, next: { position: 3, title: 'A reader sees what happened' }, why: null },
  pointed: null,
  picked: 0,
}
const parsed = (state: Partial<FooterState>): FooterItem[] => footerItemsSchema.parse(footerItems({ ...base, ...state }))
const byId = (items: FooterItem[], id: string) => items.find((one) => one.id === id)

describe('the footer declared', () => {
  test('the progress at the end, with the next step beside it', () => {
    const items = parsed({})
    expect(items.map((one) => one.id)).toEqual(['next', 'progress'])
    expect(byId(items, 'progress')).toMatchObject({ kind: 'text', text: '2/5 done · 1 blocked', align: 'end' })
    expect(byId(items, 'next')).toMatchObject({ text: 'Next: 3. A reader sees what happened', optional: true })
    expect(progressSaid({ done: 5, total: 5, blocked: 0, next: null, why: 'Every step of this journey is done.' })).toBe('5/5 done')
  })

  test('with no next step the reason rides in the progress tooltip', () => {
    const items = parsed({ progress: { done: 5, total: 5, blocked: 0, next: null, why: 'Every step of this journey is done.' } })
    expect(byId(items, 'next')).toBeUndefined()
    expect((byId(items, 'progress') as { tooltip: string }).tooltip).toBe('5/5 done. Every step of this journey is done.')
  })

  test('the line comes first, and a failed read is a warning', () => {
    expect(parsed({ status: { said: 'Moved the step.', level: 'normal' } })[0]).toMatchObject({ id: 'status', text: 'Moved the step.', level: 'normal' })
    expect(parsed({ status: { said: 'The last read did not land', level: 'warn' } })[0]).toMatchObject({ level: 'warn' })
  })

  test('the picks, with Clear beside them, only when something is picked', () => {
    expect(byId(parsed({}), 'clear')).toBeUndefined()
    const items = parsed({ picked: 3 })
    expect(byId(items, 'picked')).toMatchObject({ text: '3 picked', align: 'center' })
    expect(byId(items, 'clear')).toMatchObject({ kind: 'run', label: 'Clear', align: 'center' })
  })

  test('the step an agent pointed at, with its line in the tooltip', () => {
    expect(byId(parsed({ pointed: { step: 2, title: 'Two', say: 'this one' } }), 'pointed')).toMatchObject({
      text: 'Step 2 · Two',
      tooltip: 'Step 2 · Two: this one',
      optional: true,
    })
  })

  test('nothing to say, no footer; long words are cut to the limits', () => {
    expect(parsed({ progress: null })).toEqual([])
    const long = 'x'.repeat(400)
    for (const one of parsed({ status: { said: long, level: 'normal' }, pointed: { step: 1, title: long, say: long } })) {
      if (one.kind === 'text') expect(one.text.length).toBeLessThanOrEqual(LIMITS.FOOTER_TEXT)
      if (one.tooltip) expect(one.tooltip.length).toBeLessThanOrEqual(LIMITS.FOOTER_TOOLTIP)
    }
  })

  test('a press: Clear when something is picked, a sentence otherwise', () => {
    expect(footerPressed('clear', { picked: 2 })).toBe('clear')
    expect(footerPressed('clear', { picked: 0 })).not.toBe('clear')
    expect(footerPressed('progress', { picked: 2 })).not.toBe('clear')
  })
})

describe('the header declared', () => {
  test('pick every step, on when all are picked, and nothing when no step names a reference', () => {
    expect(headerItemsSchema.parse(headerItems({ named: 3, all: false }))).toMatchObject([{ kind: 'toggle', id: 'pick-all', label: 'Pick every step', checked: false }])
    expect(headerItems({ named: 3, all: true })[0]).toMatchObject({ checked: true })
    expect(headerItems({ named: 0, all: false })).toEqual([])
  })
})

describe('on the page', () => {
  let wire: Wire
  let projects = 0
  beforeAll(async () => {
    wire = await started()
  })
  afterEach(() => {
    cleanup()
    mailbox.forget?.()
    document.body.innerHTML = ''
    store.reset()
  })

  const framed = async (footer: boolean) => {
    const host = stubHost()
    projects += 1
    const projectPath = `/Users/somebody/Projects/footer-${projects}`
    host.post({
      type: MESSAGE.HELLO,
      protocol: PROTOCOL,
      session: 's',
      ...(footer ? { footer: true } : {}),
      context: { epic: 'probe', project: 'probe', projectPath, theme: 'light', selection: [], filters: {} },
      state: null,
    })
    await settle()
    render(<App />)
    await settle()
    return host
  }
  const last = (host: ReturnType<typeof stubHost>, type: string) =>
    host.said.filter((m) => m.type === type).at(-1) as { items: { id: string; text?: string }[] } | undefined

  test('a host that draws a footer gets the progress there and pick every step in the header, and the page drops its presses', async () => {
    const host = await framed(true)
    expect(wire.getSnapshot().footed).toBe(true)
    expect(last(host, MESSAGE.FOOTER)?.items.map((one) => one.id)).toContain('progress')
    expect(last(host, MESSAGE.FOOTER)?.items.find((one) => one.id === 'progress')?.text).toBe('0/2 done')
    expect(last(host, MESSAGE.HEADER)?.items.map((one) => one.id)).toEqual(['pick-all'])
    expect(document.body.textContent).not.toContain('pick every step')
    expect(document.querySelector('[aria-live="polite"]')?.hasAttribute('hidden')).toBe(true)
  })

  test('any other host declares nothing new, and the page draws its presses as before', async () => {
    const host = await framed(false)
    expect(wire.getSnapshot().footed).toBe(false)
    expect((last(host, MESSAGE.FOOTER)?.items ?? []).length).toBe(0)
    expect(document.body.textContent).toContain('pick every step')
    expect(document.querySelector('[aria-live="polite"]')?.hasAttribute('hidden')).toBe(false)
  })
})
