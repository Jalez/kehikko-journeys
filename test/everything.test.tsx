import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App, coverOf } from '../src/app.tsx'
import { EVERYTHING_SAID } from '../src/view/everything.tsx'
import { PROJECT, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * "All epics" in the host (protocol 2.9.0's `context.scope: 'project'`): no epic, and not "no
 * epic". The page lists every journey of the project by epic, read-only, and goes back to the one
 * journey when an epic is picked again.
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
  store.reset()
  resetServerStanding()
})

describe('the cover', () => {
  test('"All epics" is not "no epic"', () => {
    const standing = { where: 'hosted' as const, projectPath: PROJECT, epic: null, trouble: null }
    expect(coverOf(standing, 'up')).toBe('no-epic')
    expect(coverOf({ ...standing, scope: 'project' }, 'up')).toBeNull()
  })
})

describe('the page on all epics', () => {
  test('lists every journey by epic, read-only, and the one journey again when an epic is picked', async () => {
    const projectPath = `${PROJECT}-all`
    const host = stubHost()
    host.greet([], { projectPath, epic: null, scope: 'project' })
    await settle()
    await settle()
    render(<App />)
    await settle()
    expect(wire.getSnapshot().scope).toBe('project')
    expect(document.querySelector('[data-cover]')).toBeNull()
    expect(document.body.textContent).toContain(EVERYTHING_SAID)
    const epic = document.querySelector('[data-everything] article[data-epic="probe"]')
    expect(epic?.querySelector('h2')?.textContent).toContain('A journey')
    expect(epic?.querySelector('h2')?.textContent).toContain('epic probe')
    expect([...(epic?.querySelectorAll('[data-step]') ?? [])].map((one) => one.textContent)).toEqual(['1.One gh#1 gh#2', '2.Two gh#3'])
    /* Read-only: no editor, no step to press. */
    expect(document.querySelector('[aria-label="Step title"]')).toBeNull()
    expect(document.querySelectorAll('[data-everything] button')).toHaveLength(0)

    host.context([], 'probe', { projectPath, scope: 'epic' })
    await settle()
    await settle()
    expect(wire.getSnapshot().scope).toBe('epic')
    expect(wire.getSnapshot().everything).toBeNull()
    expect(document.querySelector('[data-everything]')).toBeNull()
    expect(document.querySelector('article h2')?.textContent).toBe('A journey')
  })

  test('from no epic to all epics reads them, though the epic did not move', async () => {
    const projectPath = `${PROJECT}-from-none`
    const host = stubHost()
    host.greet([], { projectPath, epic: null })
    await settle()
    await settle()
    expect(wire.getSnapshot().everything).toBeNull()
    host.context([], null as never, { projectPath, epic: null, scope: 'project' })
    await settle()
    await settle()
    expect(wire.getSnapshot().everything?.map((one) => one.slug)).toEqual(['probe'])
  })
})
