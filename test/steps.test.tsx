import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MESSAGE, type EpicPart } from 'kehikot-module-protocol'

import { App, BUSY_SAID } from '../src/app.tsx'
import { PARTS_REF } from '../wire/methods.ts'
import { mailbox } from 'kehikot-module-protocol/client'

import { JOURNEY, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * A step and its part, on the page, against both kinds of host.
 *
 * The list of an epic's parts is the epic's. A host from protocol 1.2.0 keeps
 * it and is asked to edit it (`parts.set`); a host from before that does not
 * know the method, and this app then keeps the list in its own record exactly
 * as it did. Both are here: `stubHost()` is the older host, answering
 * `unknown-method` as a released one does, and `stubHost({ parts: 'asked' })`
 * leaves the question for the case to answer. `store.parts` is the other
 * half of the same fact — the list in the epic's own file, which is what this
 * app's server goes by (`keeper.ts`).
 */

let wire: Wire
let projects = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  wire.setAdding(false)
  if (wire.getSnapshot().editing >= 0) wire.setEditing(-1)
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  sessionStorage.clear()
  store.reset()
})

const SIMPLE = {
  ...JOURNEY,
  steps: [
    { ...JOURNEY.steps[0], title: 'A reader could repeat the study', part: 'methods' },
    { ...JOURNEY.steps[1], title: 'A reader sees what happened', part: 'a-reader-sees-what-happened' },
  ],
  groups: [
    { id: 'methods', heading: 'Methods', refs: [], files: ['chapters/3_methods.tex'] },
    { id: 'a-reader-sees-what-happened', heading: 'A reader sees what happened', refs: [] },
  ],
} as unknown as typeof JOURNEY

/** The same journey where the HOST keeps the list: three parts, the third with no step. */
const LISTED = [
  { id: 'methods', name: 'Methods' },
  { id: 'a-reader-sees-what-happened', name: 'Results' },
  { id: 'appendices', name: 'Appendices' },
]
const part = (id: string, heading: string, picked = false): EpicPart => ({ id, heading, refs: [], picked })
const onWire = (list: { id: string; name: string }[], picked: string[] = []) => list.map((one) => part(one.id, one.name, picked.includes(one.id)))

async function framed(how: { parts?: 'older' | 'asked' } = {}, more: Record<string, unknown> = {}) {
  const host = stubHost(how)
  projects += 1
  const projectPath = `/Users/somebody/Projects/steps-${projects}`
  host.greet([], { projectPath, ...more })
  await settle()
  render(<App />)
  await settle()
  const went = (id: string) => host.said.find((m) => m.type === MESSAGE.WENT && m.id === id) as { found: boolean; why: string } | undefined
  const walk = async (id: string) => {
    host.post({ type: MESSAGE.GOTO, id, ref: PARTS_REF, epic: 'probe' })
    await settle()
    return went(id)
  }
  const context = (extra: Record<string, unknown>) => host.context([], 'probe', { projectPath, ...extra })
  /** Every `parts.set` this host was asked, as its params. */
  const edits = () => host.asked('parts.set').map((one) => one.params)
  return { host, walk, context, edits }
}

const sent = (path: string) => store.arranged.filter((one) => one.path === path).map((one) => one.body)
const name = () => screen.getByLabelText('What this part is called where parts are picked') as HTMLInputElement
const title = () => screen.getByLabelText('Step title') as HTMLInputElement
const drawn = () => [...document.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'))
const said = () => wire.getSnapshot().said
const steps = () => (wire.getSnapshot().journey?.steps ?? []) as { title: string; part?: string }[]
const changed = (id: string | null, parts: { id: string; name: string }[]) => ({ outcome: 'changed', parts, id, why: '' })

describe('the page has no box about parts, and nothing standing above the journey', () => {
  test('no parts box, no paragraph, no "add part", no count of unfiled steps, no chapter', async () => {
    store.journey = SIMPLE
    await framed()
    expect(document.querySelector('[data-parts]')).toBeNull()
    const text = document.body.textContent ?? ''
    for (const gone of ['add part', 'Every step is in a part', 'list all', 'make a part for each chapter', 'by references', 'owns ', 'chapter']) {
      expect(text).not.toContain(gone)
    }
    /* A step closed draws no control about its part at all. */
    expect(document.querySelector('select')).toBeNull()
  })

  test('the first thing in the page is the journey’s own title: the "Framed, reading …" paragraph is gone', async () => {
    store.journey = SIMPLE
    await framed()
    const text = document.body.textContent ?? ''
    for (const gone of ['Framed,', 'The journey and its steps are this app’s', 'The host’s refresh control reads it again']) expect(text).not.toContain(gone)
    /* No paragraph of this page's own before the journey: what comes before it is at most the page's head. */
    const article = document.querySelector('article') as HTMLElement
    expect(article.parentElement?.querySelectorAll(':scope > p')).toHaveLength(1)
    expect(article.parentElement?.querySelector(':scope > p')?.getAttribute('aria-live')).toBe('polite')
    expect(article.firstElementChild?.textContent).toBe('A journey')
  })

  test('that the trackers are being read again is said in the line under the page, which is always there', async () => {
    store.journey = SIMPLE
    const { context } = await framed()
    const line = () => document.querySelector('[aria-live=polite]')?.textContent
    expect(line()).toBe('')
    context({ tracker: { at: null, refreshing: true } })
    await settle()
    expect(line()).toBe(BUSY_SAID)
    expect(BUSY_SAID).toContain('Reading the tracker…')
    context({ tracker: { at: '2026-10-12T10:00:00.000Z', refreshing: false } })
    await settle()
    expect(line()).toBe('')
  })
})

/* ------------------------------------------------------------------ *
 * A host from before `parts.set`: everything as it was
 * ------------------------------------------------------------------ */

describe('an older host, which does not know parts.set: this app keeps the list, as it did', () => {
  test('the name somebody gave is in its box; a part called by its title has an empty one; no chapter is offered', async () => {
    store.journey = SIMPLE
    await framed()
    wire.setEditing(0)
    await settle()
    expect(name().value).toBe('Methods')
    expect(document.querySelector('form select')).toBeNull()
    expect(document.querySelector('[data-make="part"]')).toBeNull()
    wire.setEditing(1)
    await settle()
    expect(name().value).toBe('')
    expect(name().placeholder).toContain('the title, if empty')
  })

  test('a new step is asked of the host once, which does not know the method — and is written exactly as before: the id is made here, `groups` gains its part', async () => {
    store.journey = SIMPLE
    const { edits } = await framed()
    wire.setAdding(true)
    await settle()
    fireEvent.change(title(), { target: { value: 'A reader can check the instruments' } })
    fireEvent.change(name(), { target: { value: 'Appendices' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', add: { name: 'Appendices', after: 'a-reader-sees-what-happened' } }])
    const body = sent('/api/step').at(-1)!
    expect(body).toMatchObject({ slug: 'probe', position: 3, title: 'A reader can check the instruments', name: 'Appendices' })
    expect(Object.hasOwn(body, 'part')).toBe(false)
    expect(Object.hasOwn(body, 'file')).toBe(false)
    const journey = wire.getSnapshot().journey as unknown as { listed: unknown; groups: { id: string; heading: string }[] }
    expect(journey.listed).toBeNull()
    expect(journey.groups).toHaveLength(3)
    expect(journey.groups[2]).toMatchObject({ heading: 'Appendices' })
    expect(steps()[2]!.part).toBe(journey.groups[2]!.id)
    expect(said()).toBe('kept')
  })

  test('a part’s name goes into this app’s record, and the document an earlier version recorded stays', async () => {
    store.journey = SIMPLE
    const { edits } = await framed()
    wire.setEditing(0)
    await settle()
    fireEvent.change(name(), { target: { value: 'How it was done' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', rename: { id: 'methods', name: 'How it was done' } }])
    expect(sent('/api/step').at(-1)).toMatchObject({ step: 'methods', name: 'How it was done' })
    const groups = (wire.getSnapshot().journey as unknown as { groups: { id: string; heading: string; files?: string[] }[] }).groups
    expect(groups[0] as unknown).toEqual({ id: 'methods', heading: 'How it was done', refs: [], files: ['chapters/3_methods.tex'] })
  })

  test('a step saved with its name untouched asks the host nothing', async () => {
    store.journey = SIMPLE
    const { edits } = await framed()
    wire.setEditing(0)
    await settle()
    fireEvent.change(title(), { target: { value: 'Reworded' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    expect(edits()).toEqual([])
    expect(sent('/api/step').at(-1)).toMatchObject({ step: 'methods', title: 'Reworded', name: 'Methods' })
  })

  test('removing a step asks once more, then removes it and its part — in this app’s record, with no word to the host', async () => {
    store.journey = SIMPLE
    const { edits } = await framed()
    wire.setEditing(0)
    await settle()
    const remove = () => document.querySelector('[data-remove]') as HTMLButtonElement
    fireEvent.click(remove())
    expect(sent('/api/step/remove')).toHaveLength(0)
    expect(remove().textContent).toBe('remove this step and its part')
    fireEvent.click(remove())
    await settle()
    expect(sent('/api/step/remove')).toHaveLength(1)
    expect(sent('/api/step/remove')[0]).toMatchObject({ slug: 'probe', step: 'methods' })
    expect(wire.getSnapshot().journey?.steps).toHaveLength(1)
    expect(edits()).toEqual([])
    expect(said()).toBe('Removed the step, and its part with it.')
  })

  test('moving a step moves it in this app’s record, and its part with it', async () => {
    store.journey = SIMPLE
    await framed()
    wire.setEditing(1)
    await settle()
    expect((document.querySelector('[data-move="down"]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(document.querySelector('[data-move="up"]') as HTMLButtonElement)
    await settle()
    await settle()
    expect(sent('/api/step/move')).toEqual([expect.objectContaining({ slug: 'probe', step: 'a-reader-sees-what-happened', to: 1 })])
    expect(steps().map((one) => one.part)).toEqual(['a-reader-sees-what-happened', 'methods'])
    const groups = (wire.getSnapshot().journey as unknown as { groups: { id: string }[] }).groups
    expect(groups.map((one) => one.id)).toEqual(['a-reader-sees-what-happened', 'methods'])
    /* The editor went with its step. */
    expect(wire.getSnapshot().editing).toBe(0)
  })

  test('a step not written yet has the name box, and neither a remove nor a move', async () => {
    store.journey = SIMPLE
    await framed()
    wire.setAdding(true)
    await settle()
    expect(name().value).toBe('')
    expect(document.querySelector('[data-remove]')).toBeNull()
    expect(document.querySelector('[data-move]')).toBeNull()
    expect(document.querySelector('[data-step-for]')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * A host that keeps the list
 * ------------------------------------------------------------------ */

describe('a host that keeps the list: a new step asks it for a part, and is filed under the id it made', () => {
  const two = LISTED.slice(0, 2)
  const open = async () => {
    store.journey = SIMPLE
    store.parts = two
    const hosted = await framed({ parts: 'asked' }, { parts: onWire(two) })
    wire.setAdding(true)
    await settle()
    fireEvent.change(title(), { target: { value: 'A reader can check the instruments' } })
    return hosted
  }
  const save = async () => {
    fireEvent.click(screen.getByText('Save'))
    await settle()
  }

  test('changed: the host is asked FIRST, by the step’s name and after the step before it; the step is written with the host’s id, and no name and no `groups`', async () => {
    const { host, edits } = await open()
    fireEvent.change(name(), { target: { value: 'Appendices' } })
    await save()
    expect(edits()).toEqual([{ epic: 'probe', add: { name: 'Appendices', after: 'a-reader-sees-what-happened' } }])
    /* Nothing is written until the host has answered. */
    expect(sent('/api/step')).toEqual([])
    store.parts = [...two, { id: 'appendices', name: 'Appendices' }]
    host.answer('parts.set', changed('appendices', store.parts))
    await settle()
    await settle()
    const body = sent('/api/step').at(-1)!
    expect(body).toMatchObject({ slug: 'probe', position: 3, part: 'appendices', title: 'A reader can check the instruments' })
    expect(Object.hasOwn(body, 'name')).toBe(false)
    expect(steps()[2]).toMatchObject({ part: 'appendices' })
    const journey = wire.getSnapshot().journey as unknown as { listed: unknown; groups?: unknown }
    expect(journey.listed).toEqual(store.parts)
    expect(journey.groups).toBeUndefined()
    expect(said()).toBe('kept')
    expect(wire.getSnapshot().adding).toBe(false)
  })

  test('a step with no name typed is a part called by its title', async () => {
    const { host, edits } = await open()
    await save()
    expect(edits()[0]).toEqual({ epic: 'probe', add: { name: 'A reader can check the instruments', after: 'a-reader-sees-what-happened' } })
    host.answer('parts.set', { outcome: 'declined', parts: two, id: null, why: 'Not now.' })
    await settle()
    await settle()
  })

  test('declined: the step is kept — nothing typed is lost — in NO part, and the host’s reason is said', async () => {
    const { host } = await open()
    await save()
    host.answer('parts.set', { outcome: 'declined', parts: two, id: null, why: 'An epic has at most 128 parts, and this one has that many.' })
    await settle()
    await settle()
    const body = sent('/api/step').at(-1)!
    expect(Object.hasOwn(body, 'part')).toBe(false)
    expect(Object.hasOwn(body, 'name')).toBe(false)
    expect(steps()).toHaveLength(3)
    expect(steps()[2]!.part).toBeUndefined()
    expect(said()).toBe('Kept, in no part: the host did not add one. An epic has at most 128 parts, and this one has that many.')
  })

  test('the host fails to answer it: the same — kept, in no part, with what the host said', async () => {
    const { host } = await open()
    await save()
    host.refuse('The epic’s file could not be written.', 'parts.set')
    await settle()
    await settle()
    expect(steps()[2]!.part).toBeUndefined()
    expect(said()).toBe('Kept, in no part: the host did not add one. The epic’s file could not be written.')
  })

  test('an answer that is not one is not taken for a part', async () => {
    const { host } = await open()
    await save()
    host.answer('parts.set', { ok: true })
    await settle()
    await settle()
    expect(steps()[2]!.part).toBeUndefined()
    expect(said()).toContain('Kept, in no part')
  })

  test('no-such-part: the step it was to come after has left the list, so it is asked for again, last', async () => {
    const { host, edits } = await open()
    await save()
    host.answer('parts.set', { outcome: 'no-such-part', parts: two, id: null, why: '' })
    await settle()
    expect(edits()).toHaveLength(2)
    expect(edits()[1]).toEqual({ epic: 'probe', add: { name: 'A reader can check the instruments' } })
    store.parts = [...two, { id: 'a-reader-can-check', name: 'A reader can check the instruments' }]
    host.answer('parts.set', changed('a-reader-can-check', store.parts))
    await settle()
    await settle()
    expect(steps()[2]!.part).toBe('a-reader-can-check')
  })

  test('the part was made and then this app’s own store fails: nothing is written pointing anywhere, the words stay, and Save again uses the SAME part', async () => {
    const { host, edits } = await open()
    await save()
    store.parts = [...two, { id: 'appendices', name: 'Appendices' }]
    store.fail = 'nothing was written. The file could not be read.'
    host.answer('parts.set', changed('appendices', store.parts))
    await settle()
    await settle()
    /* What is left: a part with no step, and the step still in the box. */
    expect(said()).toBe('nothing was written. The file could not be read.')
    expect(steps()).toHaveLength(2)
    expect(wire.getSnapshot().adding).toBe(true)
    expect(title().value).toBe('A reader can check the instruments')
    expect(wire.held('add')?.text).toContain('A reader can check the instruments')

    await save()
    await settle()
    expect(edits()).toHaveLength(1)
    expect(sent('/api/step').map((one) => one.part)).toEqual(['appendices', 'appendices'])
    expect(steps()[2]).toMatchObject({ part: 'appendices' })
    expect(said()).toBe('kept')
  })

  test('this app’s store refuses an id the host does not list, so a step is never written pointing at a part that was not made', async () => {
    const { host } = await open()
    await save()
    /* The host says it made one; the list in the epic's file does not have it. */
    host.answer('parts.set', changed('ghost', [...two, { id: 'ghost', name: 'Ghost' }]))
    await settle()
    await settle()
    expect(sent('/api/step').at(-1)).toMatchObject({ part: 'ghost' })
    expect(steps()).toHaveLength(2)
    expect(said()).toContain('"ghost" is not a part of this epic')
    expect(wire.getSnapshot().adding).toBe(true)
  })
})

describe('a host that keeps the list: renaming, moving and removing a step’s part ask it', () => {
  const hosted = async () => {
    store.journey = SIMPLE
    store.parts = LISTED.slice(0, 2)
    return framed({ parts: 'asked' }, { parts: onWire(LISTED.slice(0, 2)) })
  }

  test('the name in the box is the host’s name for the part, and a changed one is the host’s to take', async () => {
    const { host, edits } = await hosted()
    wire.setEditing(1)
    await settle()
    expect(name().value).toBe('Results')
    fireEvent.change(name(), { target: { value: 'What happened' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', rename: { id: 'a-reader-sees-what-happened', name: 'What happened' } }])
    store.parts = [LISTED[0]!, { id: 'a-reader-sees-what-happened', name: 'What happened' }]
    host.answer('parts.set', changed('a-reader-sees-what-happened', store.parts))
    await settle()
    await settle()
    const body = sent('/api/step').at(-1)!
    expect(body).toMatchObject({ step: 'a-reader-sees-what-happened' })
    expect(Object.hasOwn(body, 'name')).toBe(false)
    expect(Object.hasOwn(body, 'part')).toBe(false)
    expect((wire.getSnapshot().journey as { listed?: unknown }).listed).toEqual(store.parts)
    expect(said()).toBe('kept')
  })

  test('a name the host will not take: the step is kept as it was typed, and the line says the part was not renamed', async () => {
    const { host } = await hosted()
    wire.setEditing(0)
    await settle()
    fireEvent.change(name(), { target: { value: 'How' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    host.answer('parts.set', { outcome: 'declined', parts: store.parts, id: 'methods', why: 'Not now.' })
    await settle()
    await settle()
    expect(sent('/api/step')).toHaveLength(1)
    expect(Object.hasOwn(sent('/api/step')[0]!, 'name')).toBe(false)
    expect(said()).toBe('Kept. The part was not renamed: Not now.')
  })

  test('a step saved with the part’s name untouched, or emptied, asks the host nothing', async () => {
    const { edits } = await hosted()
    wire.setEditing(0)
    await settle()
    fireEvent.change(name(), { target: { value: '' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    await settle()
    expect(edits()).toEqual([])
    expect(sent('/api/step')).toHaveLength(1)
    expect(said()).toBe('kept')
  })

  test('removing: the step first, then the host is asked to remove its part', async () => {
    const { host, edits } = await hosted()
    wire.setEditing(0)
    await settle()
    const remove = () => document.querySelector('[data-remove]') as HTMLButtonElement
    fireEvent.click(remove())
    expect(remove().textContent).toBe('remove this step and its part')
    /* The host is not asked before this app's own write has landed. */
    const order: string[] = []
    const was = host.said.length
    fireEvent.click(remove())
    await settle()
    order.push(...store.arranged.map((one) => one.path))
    expect(order).toEqual(['/api/step/remove'])
    expect(host.said.slice(was).some((one) => one.method === 'parts.set')).toBe(true)
    expect(edits()).toEqual([{ epic: 'probe', remove: { id: 'methods' } }])
    host.answer('parts.set', changed('methods', [LISTED[1]!]))
    await settle()
    expect(steps().map((one) => one.part)).toEqual(['a-reader-sees-what-happened'])
    expect((wire.getSnapshot().journey as { listed?: unknown }).listed).toEqual([LISTED[1]!])
    expect(said()).toBe('Removed step 1 (“A reader could repeat the study”), and its part with it.')
    expect(document.querySelector('[data-step-for]')).toBeNull()
  })

  test('the host will not remove the part: the step is gone, the part is one with no step, and the line says why', async () => {
    const { host } = await hosted()
    wire.setEditing(0)
    await settle()
    const remove = () => document.querySelector('[data-remove]') as HTMLButtonElement
    fireEvent.click(remove())
    fireEvent.click(remove())
    await settle()
    host.answer('parts.set', { outcome: 'declined', parts: store.parts, id: null, why: 'Not now.' })
    await settle()
    expect(steps()).toHaveLength(1)
    expect(said()).toBe('Removed the step. Its part is the epic’s and is still listed. The host did not remove it. Not now.')
    expect(document.querySelector('[data-step-for="methods"]')?.textContent).toBe('a step for “Methods”')
  })

  test('moving: the host is asked to move the part to where the step is going, then the step is moved here', async () => {
    const { host, edits } = await hosted()
    wire.setEditing(1)
    await settle()
    fireEvent.click(document.querySelector('[data-move="up"]') as HTMLButtonElement)
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', move: { id: 'a-reader-sees-what-happened', after: null } }])
    expect(sent('/api/step/move')).toEqual([])
    store.parts = [LISTED[1]!, LISTED[0]!]
    host.answer('parts.set', changed('a-reader-sees-what-happened', store.parts))
    await settle()
    await settle()
    expect(sent('/api/step/move')).toEqual([expect.objectContaining({ step: 'a-reader-sees-what-happened', to: 1 })])
    expect(steps().map((one) => one.part)).toEqual(['a-reader-sees-what-happened', 'methods'])
    expect(said()).toBe('Moved the step.')
  })

  test('moving down goes after the part of the step it passes', async () => {
    const { host, edits } = await hosted()
    wire.setEditing(0)
    await settle()
    fireEvent.click(document.querySelector('[data-move="down"]') as HTMLButtonElement)
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', move: { id: 'methods', after: 'a-reader-sees-what-happened' } }])
    host.answer('parts.set', { outcome: 'declined', parts: store.parts, id: 'methods', why: 'Not now.' })
    await settle()
    await settle()
    /* The step moved here whatever the host said, and the line says the part did not. */
    expect(steps().map((one) => one.part)).toEqual(['a-reader-sees-what-happened', 'methods'])
    expect(said()).toBe('Moved the step. Its part was not moved in the epic’s list: Not now.')
  })
})

/* ------------------------------------------------------------------ *
 * The two edges of a list somebody else edits
 * ------------------------------------------------------------------ */

describe('a part removed in the host’s picker: its step stays, in no part', () => {
  /* The host's list no longer has `methods`; step one still says it is its step. */
  const gone = [LISTED[1]!]
  const hosted = async (picked: string[] = []) => {
    store.journey = SIMPLE
    store.parts = gone
    return framed({ parts: 'asked' }, { parts: onWire(gone, picked) })
  }

  test('with nothing picked it is drawn like any step, and nothing on the page remarks on it', async () => {
    await hosted()
    expect(drawn()).toEqual(['1', '2'])
    expect(document.body.textContent).not.toContain('no part')
    expect(document.querySelector('[data-make="part"]')).toBeNull()
  })

  test('under a pick it is hidden, like any item that is in no part', async () => {
    await hosted(['a-reader-sees-what-happened'])
    expect(drawn()).toEqual(['2'])
    expect(document.querySelector('[data-narrowed]')).toBeNull()
  })

  test('its editor offers to make it a part again: one press, which saves the step and asks the host for a part FIRST in the list', async () => {
    const { host, edits } = await hosted()
    wire.setEditing(0)
    await settle()
    const press = document.querySelector('[data-make="part"]') as HTMLButtonElement
    expect(press.textContent).toBe('make it a part')
    /* The removal it offers is of the step alone: there is no part to go with it. */
    fireEvent.click(document.querySelector('[data-remove]') as HTMLButtonElement)
    expect(document.querySelector('[data-remove]')?.textContent).toBe('remove this step')
    fireEvent.change(name(), { target: { value: 'Methods' } })
    fireEvent.click(press)
    await settle()
    expect(edits()).toEqual([{ epic: 'probe', add: { name: 'Methods', after: null } }])
    store.parts = [{ id: 'methods-2', name: 'Methods' }, ...gone]
    host.answer('parts.set', changed('methods-2', store.parts))
    await settle()
    await settle()
    expect(sent('/api/step').at(-1)).toMatchObject({ step: 'methods', part: 'methods-2', title: 'A reader could repeat the study' })
    expect(steps()[0]).toMatchObject({ part: 'methods-2' })
    expect(said()).toBe('kept')
  })

  test('a step that is in a part is offered no such press', async () => {
    await hosted()
    wire.setEditing(1)
    await settle()
    expect(document.querySelector('[data-make="part"]')).toBeNull()
    expect(name().value).toBe('Results')
  })
})

describe('a part added in the host’s picker: nothing is drawn for it until its step is written', () => {
  const hosted = async (list = LISTED) => {
    store.journey = SIMPLE
    store.parts = list
    return framed({ parts: 'asked' }, { parts: onWire(list) })
  }

  test('no step, no row and no sentence: one quiet press where a step is added', async () => {
    await hosted()
    expect(drawn()).toEqual(['1', '2'])
    const offers = document.querySelectorAll('[data-step-for]')
    expect(offers).toHaveLength(1)
    expect(offers[0]!.textContent).toBe('a step for “Appendices”')
    expect(offers[0]!.closest('[data-adding]')).not.toBeNull()
    /* On the row "add a step" is already on, not a row of its own. */
    expect(offers[0]!.parentElement).toBe([...document.querySelectorAll('button')].find((one) => one.textContent === 'add a step')!.parentElement)
  })

  test('the press opens the editor for that part’s step; Save files it under the part and asks the host for nothing', async () => {
    const { edits } = await hosted()
    fireEvent.click(document.querySelector('[data-step-for="appendices"]') as HTMLButtonElement)
    await settle()
    expect(wire.getSnapshot().addingFor).toBe('appendices')
    expect(title().value).toBe('Appendices')
    /* The name is the part's, which is already there. */
    expect(screen.queryByLabelText('What this part is called where parts are picked')).toBeNull()
    fireEvent.change(title(), { target: { value: 'A reader can check the instruments' } })
    expect(wire.held('add@appendices')?.text).toContain('check the instruments')
    fireEvent.click(screen.getByText('Save'))
    await settle()
    await settle()
    expect(edits()).toEqual([])
    expect(sent('/api/step').at(-1)).toMatchObject({ position: 3, part: 'appendices', title: 'A reader can check the instruments' })
    expect(steps()[2]).toMatchObject({ part: 'appendices' })
    expect(document.querySelector('[data-step-for]')).toBeNull()
    expect(wire.held('add@appendices')).toBeNull()
  })

  test('several such parts are one list, not a row of presses', async () => {
    await hosted([...LISTED, { id: 'glossary', name: 'Glossary' }])
    const list = document.querySelector('select[data-step-for]') as HTMLSelectElement
    expect([...list.options].map((one) => one.textContent)).toEqual(['a step for a part that has none…', 'Appendices', 'Glossary'])
    expect(document.querySelectorAll('[data-step-for]')).toHaveLength(1)
    fireEvent.change(list, { target: { value: 'glossary' } })
    await settle()
    expect(wire.getSnapshot().addingFor).toBe('glossary')
    expect(title().value).toBe('Glossary')
  })

  test('the list changing under the page — a part added, renamed or removed in the picker — is read again; a pick alone is not', async () => {
    const { context } = await hosted()
    const before = store.reads()
    context({ parts: onWire(LISTED, ['methods']) })
    await settle()
    expect(store.reads()).toBe(before)
    store.parts = [...LISTED, { id: 'glossary', name: 'Glossary' }]
    context({ parts: onWire(store.parts) })
    await settle()
    await settle()
    expect(store.reads()).toBe(before + 1)
    expect(document.querySelector('select[data-step-for]')).not.toBeNull()
  })

  /**
   * The host tells every module about an edit, this one included — and for an
   * edit THIS page asked for, that news arrives between the host's answer and
   * this app's own write. Reading then would race the write; the read is owed
   * and made once, after it.
   */
  test('the list changing because of this page’s own press is not read beside the write it belongs to, and is read once after it', async () => {
    const { host, context } = await hosted()
    wire.setEditing(1)
    await settle()
    fireEvent.change(name(), { target: { value: 'What happened' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    const before = store.reads()
    const renamed = [LISTED[0]!, { id: 'a-reader-sees-what-happened', name: 'What happened' }, LISTED[2]!]
    store.parts = renamed
    /* The host's news of the edit lands before this page has heard the answer to its own question. */
    context({ parts: onWire(renamed) })
    await settle()
    expect(store.reads()).toBe(before)
    host.answer('parts.set', changed('a-reader-sees-what-happened', renamed))
    await settle()
    await settle()
    expect(sent('/api/step')).toHaveLength(1)
    expect(wire.getSnapshot().editing).toBe(-1)
    expect(said()).toBe('kept')
    expect(store.reads()).toBe(before + 1)
    expect((wire.getSnapshot().journey as { listed?: unknown }).listed).toEqual(renamed)
  })

  test('while this app keeps the list there is no such offer: a part is its step', async () => {
    store.journey = SIMPLE
    await framed({}, { parts: onWire(LISTED) })
    expect(document.querySelector('[data-step-for]')).toBeNull()
  })
})

describe('a host asking where this epic is divided into parts', () => {
  test('a journey with steps, stored so: nowhere — every step is a part, and the walk is told that', async () => {
    store.journey = SIMPLE
    const { walk } = await framed()
    expect(await walk('w1')).toMatchObject({ found: false, why: 'Every step of this journey is a part of the epic already; there is nothing to divide.' })
    expect(store.arranged).toEqual([])
  })

  test('a journey still in the older shape on disk: the walk is the press that stores it', async () => {
    store.journey = { ...SIMPLE, unsettled: true } as unknown as typeof JOURNEY
    const { walk, host } = await framed()
    expect(await walk('w2')).toMatchObject({ found: true })
    expect(sent('/api/settle')).toHaveLength(1)
    expect(sent('/api/settle')[0]).toMatchObject({ slug: 'probe' })
    expect(wire.getSnapshot().said).toContain('It is now one step to a part')
    /* And the host is told the material changed, which is what makes it read the parts again. */
    expect(host.asked('content.changed').length).toBeGreaterThan(0)
  })

  test('a journey with no step yet: the box the first step is written in', async () => {
    store.journey = { ...JOURNEY, steps: [], plan: 'none' } as unknown as typeof JOURNEY
    const { walk } = await framed()
    expect(await walk('w3')).toMatchObject({ found: true })
    expect(wire.getSnapshot().adding).toBe(true)
    expect(screen.getByLabelText('Step title')).not.toBeNull()
  })

  test('no journey at all: the offer to begin one', async () => {
    store.listed = false
    const { walk } = await framed()
    expect(await walk('w4')).toMatchObject({ found: true })
    expect(document.querySelector('[data-begin]')).not.toBeNull()
  })
})
