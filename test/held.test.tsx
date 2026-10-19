import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { held as heldStore, mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { JOURNEY, PROJECT, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * What was being typed survives a reload of the page. A stale page reloads itself — on the Save
 * press that found it out, or on a read — so every box writes its words as they change, under the
 * project, the journey and exactly what they were aimed at, and the page reopens the box that was
 * open when its journey lands again.
 *
 * The store here is one module for the whole test run, so "the page went away and came back" is
 * the canvas leaving the project and returning to it: the journey is dropped, read again, and every
 * box is mounted afresh over the same sessionStorage — which is what a reload is to this code.
 */
let wire: Wire
let n = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  /* The store outlives this file: leave no box open in it for the next one to find. */
  wire.setAdding(false)
  if (wire.getSnapshot().editing >= 0) wire.setEditing(-1)
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  sessionStorage.clear()
  store.reset()
  resetServerStanding()
})

async function on(project: string) {
  const host = stubHost()
  host.greet([], { projectPath: project })
  await settle()
  await settle()
  return host
}
/** Away to another project and back: everything on screen is dropped and drawn again. */
async function awayAndBack(project: string) {
  await on(`${project}-elsewhere`)
  const elsewhere = { editor: screen.queryByLabelText('Step title'), words: document.body.textContent ?? '' }
  await on(project)
  await settle()
  return elsewhere
}
const fresh = () => `${PROJECT}-held-${(n += 1)}`
const title = () => screen.getByLabelText('Step title') as HTMLInputElement
/* The page's own store, by its name: the key somebody's tab already holds drafts under. */
const held = (project: string) => heldStore('kehikot.journeys.drafts').at(project).all()

describe('typed words are held across the page going away, aimed at what they were typed into', () => {
  test('a step: typed → away and back → its editor is open on the same step, with every field as it was left', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setEditing(1)
    await settle()
    fireEvent.change(title(), { target: { value: 'Two, rewritten' } })
    fireEvent.change(screen.getByLabelText('Step body'), { target: { value: 'half a paragraph' } })
    expect(Object.keys(held(project))).toEqual(['probe|step:1'])
    expect(held(project)['probe|step:1']?.aim).toBe('step 2 — “Two, rewritten”')

    const elsewhere = await awayAndBack(project)
    /* A different project does not see them. */
    expect(elsewhere.words).not.toContain('half a paragraph')
    expect(held(`${project}-elsewhere`)).toEqual({})

    expect(wire.getSnapshot().editing).toBe(1)
    expect(title().value).toBe('Two, rewritten')
    expect((screen.getByLabelText('Step body') as HTMLTextAreaElement).value).toBe('half a paragraph')
    expect(title().closest('[data-step]')?.getAttribute('data-step')).toBe('2')
    expect(document.querySelector('[data-held-stale]')).toBeNull()
  })

  test('saved → cleared, and nothing is reopened; closed → cleared', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setEditing(0)
    await settle()
    fireEvent.change(title(), { target: { value: 'One, kept' } })
    expect(Object.keys(held(project))).toEqual(['probe|step:0'])
    fireEvent.submit(title().closest('form') as HTMLFormElement)
    await settle()
    expect(wire.getSnapshot().said).toBe('kept')
    expect(held(project)).toEqual({})
    await awayAndBack(project)
    expect(screen.queryByLabelText('Step title')).toBeNull()

    wire.setEditing(0)
    await settle()
    fireEvent.change(title(), { target: { value: 'thrown away' } })
    /* By the id of its part, which the save above gave it. */
    expect(Object.keys(held(project))).toEqual(['probe|step@one'])
    wire.setEditing(0)
    expect(held(project)).toEqual({})
  })

  test('a write the store refused leaves the words in the editor and held', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setEditing(0)
    await settle()
    fireEvent.change(title(), { target: { value: 'pressed on a stale page' } })
    const answering = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'old page', refused: 'ticket' }), { status: 403 })) as unknown as typeof fetch
    try {
      fireEvent.submit(title().closest('form') as HTMLFormElement)
      await settle()
    } finally {
      globalThis.fetch = answering
    }
    expect(document.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe('stale')
    expect(title().value).toBe('pressed on a stale page')
    expect(Object.keys(held(project))).toEqual(['probe|step:0'])
  })

  test('a step that was changed meanwhile: the words come back, and the editor says what the step reads now', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setEditing(0)
    await settle()
    fireEvent.change(title(), { target: { value: 'my wording' } })
    store.journey = { ...JOURNEY, steps: [{ ...JOURNEY.steps[0]!, title: 'An agent’s wording' }, JOURNEY.steps[1]!] }
    await awayAndBack(project)
    expect(title().value).toBe('my wording')
    expect(document.querySelector('[data-held-stale]')?.textContent).toContain('An agent’s wording')
  })

  test('a step that is no longer there: the words are shown as kept, not opened over another step', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setEditing(1)
    await settle()
    fireEvent.change(title(), { target: { value: 'about the second step' } })
    store.journey = { ...JOURNEY, steps: [JOURNEY.steps[0]!] }
    await awayAndBack(project)
    expect(screen.queryByLabelText('Step title')).toBeNull()
    const kept = document.querySelector('[data-kept-words]') as HTMLElement
    expect(kept.textContent).toContain('about the second step')
    expect(kept.textContent).toContain('step 2')
    fireEvent.click(kept.querySelector('button') as HTMLButtonElement)
    expect(document.querySelector('[data-kept-words]')).toBeNull()
    expect(held(project)).toEqual({})
  })

  test('a step not written yet comes back in its own open box, with the name of its part', async () => {
    const project = fresh()
    await on(project)
    render(<App />)
    wire.setAdding(true)
    await settle()
    fireEvent.change(title(), { target: { value: 'A third thing' } })
    fireEvent.change(screen.getByLabelText('What this part is called where parts are picked'), { target: { value: 'Third' } })
    expect(Object.keys(held(project))).toEqual(['probe|add'])

    await awayAndBack(project)
    expect(wire.getSnapshot().adding).toBe(true)
    expect(title().value).toBe('A third thing')
    expect(title().closest('[data-adding]')).not.toBeNull()
    expect((screen.getByLabelText('What this part is called where parts are picked') as HTMLInputElement).value).toBe('Third')
  })

  test('a step with a part is held by the id of its part, and found again after a step before it is removed', async () => {
    const project = fresh()
    store.journey = {
      ...JOURNEY,
      steps: [{ ...JOURNEY.steps[0], part: 'one' }, { ...JOURNEY.steps[1], part: 'two' }],
      groups: [{ id: 'one', heading: 'One', refs: [] }, { id: 'two', heading: 'Two', refs: [] }],
    } as unknown as typeof JOURNEY
    await on(project)
    render(<App />)
    wire.setEditing(1)
    await settle()
    fireEvent.change(title(), { target: { value: 'Two, reworded' } })
    expect(Object.keys(held(project))).toEqual(['probe|step@two'])

    /* Somebody removes the first step through the other door while this page is away. */
    store.journey = { ...store.journey, steps: store.journey.steps.slice(1), groups: (store.journey as unknown as { groups: unknown[] }).groups.slice(1) } as unknown as typeof JOURNEY
    await awayAndBack(project)
    expect(wire.getSnapshot().editing).toBe(0)
    expect(title().value).toBe('Two, reworded')
  })

  test('words typed into the parts box this page no longer has are kept, and shown, not dropped', async () => {
    const project = fresh()
    sessionStorage.clear()
    await on(project)
    render(<App />)
    await settle()
    wire.hold('part:new', { base: '', text: 'Reading the track', aim: 'a new part' })
    wire.discardHeld('nothing')
    await settle()
    const kept = document.querySelector('[data-kept-words]') as HTMLElement
    expect(kept.textContent).toContain('Reading the track')
  })

describe('typed words are held by the project, not the folder it happens to be in', () => {
  const ID = 'proj-1234abcd'
  const onWith = async (project: string, projectId: string | null) => {
    const host = stubHost()
    host.greet([], { projectPath: project, projectId })
    await settle()
    await settle()
    return host
  }

  test('a folder renamed under the page keeps what was typed: the id is the key', async () => {
    const before = fresh()
    const after = fresh()
    await onWith(before, ID)
    render(<App />)
    wire.setEditing(1)
    await settle()
    fireEvent.change(title(), { target: { value: 'Two, rewritten' } })
    expect(Object.keys(held(ID))).toEqual(['probe|step:1'])
    expect(held(before)).toEqual({})

    await onWith(after, ID)
    await settle()
    expect(held(after)).toEqual({})
    expect(Object.keys(held(ID))).toEqual(['probe|step:1'])
    expect(wire.getSnapshot().editing).toBe(1)
    expect(title().value).toBe('Two, rewritten')
  })

  test('words held under the path by an older page are read once, under the id, and carried over', async () => {
    const project = fresh()
    await onWith(project, null)
    render(<App />)
    wire.setEditing(1)
    await settle()
    fireEvent.change(title(), { target: { value: 'typed before the host sent an id' } })
    expect(Object.keys(held(project))).toEqual(['probe|step:1'])

    await onWith(project, ID)
    await settle()
    expect(Object.keys(held(ID))).toEqual(['probe|step:1'])
    expect(held(project)).toEqual({})
    expect(title().value).toBe('typed before the host sent an id')
  })
})
})
