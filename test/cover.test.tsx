import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App, coverOf } from '../src/app.tsx'
import { NO_PROJECT_SAID, UNHOSTED_SAID } from '../src/view/nowhere.tsx'
import { PROJECT, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * The moments before there is a journey to draw, each as the protocol's one shared cover — and
 * this app's own server behind the protocol's `ask()`: what a write carries, and what the page
 * draws when nothing answers.
 */
let wire: Wire

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  document.getElementById('ticket')?.remove()
  store.reset()
  resetServerStanding()
})

const cover = () => document.querySelector('[data-cover]')
const standing = (over: Partial<Parameters<typeof coverOf>[0]> = {}) => ({ where: 'hosted' as const, projectPath: PROJECT, epic: 'probe', trouble: null, ...over })

describe('which cover, for every standing', () => {
  test('a page nothing has greeted yet is waiting — never "no project", never "nothing is framing this"', () => {
    expect(coverOf(standing({ where: 'listening', projectPath: null, epic: null }), 'up')).toBe('waiting')
    /* Even when its own server is already not answering: the greeting is still the first question. */
    expect(coverOf(standing({ where: 'listening', projectPath: null, epic: null }), 'down')).toBe('waiting')
  })

  test('after the grace it is unhosted; hosted without a folder is no project; without an epic, no epic', () => {
    expect(coverOf(standing({ where: 'unhosted', projectPath: null, epic: null }), 'up')).toBe('unhosted')
    expect(coverOf(standing({ projectPath: null }), 'up')).toBe('no-project')
    expect(coverOf(standing({ epic: null }), 'up')).toBe('no-epic')
    expect(coverOf(standing(), 'up')).toBeNull()
  })

  test('a project that will not read is Trouble, not "no epic"', () => {
    expect(coverOf(standing({ epic: null, trouble: 'that path is relative' }), 'up')).toBeNull()
  })

  test('its own server: down when nothing answers, stale over everything', () => {
    expect(coverOf(standing(), 'down')).toBe('down')
    expect(coverOf(standing({ projectPath: null }), 'down')).toBe('no-project')
    expect(coverOf(standing(), 'stale')).toBe('stale')
    expect(coverOf(standing({ where: 'listening' }), 'stale')).toBe('stale')
  })
})

describe('the page, under a host', () => {
  test('hosted with no project folder: the shared cover, this module’s second line, and nothing to press', async () => {
    const host = stubHost()
    host.greet([], { projectPath: null })
    await settle()
    render(<App />)
    await settle()
    expect(cover()?.getAttribute('data-cover')).toBe('no-project')
    expect(cover()?.textContent).toContain('No project is open — open one in Kehikot.')
    expect(cover()?.textContent).toContain(NO_PROJECT_SAID)
    expect(NO_PROJECT_SAID).toContain('.kehikot/journeys/journeys.json')
    expect(UNHOSTED_SAID).toContain('only a host can answer')
    expect(within(cover() as HTMLElement).queryAllByRole('button')).toHaveLength(0)
    expect(wire.getSnapshot().where).toBe('hosted')
  })

  test('hosted with a project and no epic: the no-epic cover stands where the status line stood', async () => {
    const host = stubHost()
    host.greet([], { projectPath: `${PROJECT}-no-epic`, epic: null })
    await settle()
    render(<App />)
    await settle()
    expect(cover()?.getAttribute('data-cover')).toBe('no-epic')
    expect(cover()?.textContent).toContain('No epic is open — open one in Kehikot.')
    expect(document.body.textContent).not.toContain('Framed, nothing open.')

    host.context([], 'probe', { projectPath: `${PROJECT}-no-epic` })
    await settle()
    await settle()
    expect(cover()).toBeNull()
    expect(document.body.textContent).toContain('Framed, reading probe')
    /* The host's theme is on the document, put there by the protocol's `applyTheme`. */
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  test('a write carries the process ticket in x-module-ticket and the project ticket in its body', async () => {
    const island = document.createElement('script')
    island.id = 'ticket'
    island.type = 'application/json'
    island.textContent = JSON.stringify('the-process-ticket')
    document.body.append(island)
    const projectPath = `${PROJECT}-write`
    const host = stubHost()
    host.greet([], { projectPath })
    await settle()
    await settle()

    const answering = globalThis.fetch
    const sent: { url: string; init: RequestInit | undefined }[] = []
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      sent.push({ url: String(input), init })
      return answering(input, init)
    }) as unknown as typeof fetch
    try {
      wire.setEditing(0)
      await wire.saveStep(0, { title: 'One, kept', body: '', refs: ['gh#1'], notes: [] })
    } finally {
      globalThis.fetch = answering
    }
    const write = sent.find((one) => one.init?.method === 'POST')
    expect(write?.url).toBe('/api/step')
    const headers = write?.init?.headers as Record<string, string>
    expect(headers['x-module-ticket']).toBe('the-process-ticket')
    expect(headers['x-journeys-ticket']).toBeUndefined()
    /* 't' is what the stubbed `/api/ticket` hands over for this project. */
    expect(JSON.parse(String(write?.init?.body))).toMatchObject({ project: projectPath, ticket: 't', slug: 'probe', title: 'One, kept' })
    expect(wire.getSnapshot().said).toBe('kept')
  })

  test('its own server not answering: the down cover over the open editor, and Try again brings the page back', async () => {
    const host = stubHost()
    host.greet([], { projectPath: `${PROJECT}-down` })
    await settle()
    await settle()
    render(<App />)
    wire.setEditing(0)
    await settle()
    const title = screen.getByLabelText('Step title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'half a thought' } })

    const answering = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('Load failed')
    }) as unknown as typeof fetch
    try {
      await wire.saveStep(0, { title: 'half a thought', body: '', refs: [], notes: [] })
      expect(wire.getSnapshot().said).toBe('This app’s own server is not answering.')
      await settle()
      expect(cover()?.getAttribute('data-cover')).toBe('down')
      expect(cover()?.textContent).toContain('Journeys’ own server is not answering.')
      /* Hidden, not gone: the editor and what was typed in it are still there. */
      expect(title.isConnected).toBe(true)
      expect(title.value).toBe('half a thought')
      expect(title.closest('[hidden]')).not.toBeNull()

      fireEvent.click(within(cover() as HTMLElement).getByRole('button', { name: 'Try again' }))
      await settle()
      expect(cover()?.getAttribute('data-cover')).toBe('down')
    } finally {
      globalThis.fetch = answering
    }
    fireEvent.click(within(cover() as HTMLElement).getByRole('button', { name: 'Try again' }))
    await settle()
    await settle()
    expect(cover()).toBeNull()
    expect(title.isConnected).toBe(true)
    expect(title.value).toBe('half a thought')
  })
})
