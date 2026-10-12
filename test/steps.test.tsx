import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MESSAGE } from 'kehikot-module-protocol'

import { App } from '../src/app.tsx'
import { PARTS_REF } from '../wire/methods.ts'
import { mailbox } from 'kehikot-module-protocol/client'

import { JOURNEY, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * The page with no parts box: what a step's part is called and the chapter it
 * covers are two fields of the step's own editor, and a host's walk to "where
 * this epic is divided into parts" lands on one of four things.
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

const PAPER = {
  ok: true,
  slug: 'probe',
  paper: true,
  chapters: [
    { file: 'chapters/3_methods.tex', heading: 'Methods', part: 'methods' },
    { file: 'chapters/4_results.tex', heading: 'Results', part: null },
    { file: 'chapters/5_discussion.tex', heading: 'Discussion', part: null },
  ],
}

async function framed() {
  const host = stubHost()
  projects += 1
  host.greet([], { projectPath: `/Users/somebody/Projects/steps-${projects}` })
  await settle()
  render(<App />)
  await settle()
  const went = (id: string) => host.said.find((m) => m.type === MESSAGE.WENT && m.id === id) as { found: boolean; why: string } | undefined
  const walk = async (id: string) => {
    host.post({ type: MESSAGE.GOTO, id, ref: PARTS_REF, epic: 'probe' })
    await settle()
    return went(id)
  }
  return { host, walk }
}

const sent = (path: string) => store.arranged.filter((one) => one.path === path).map((one) => one.body)
const name = () => screen.getByLabelText('What this part is called where parts are picked') as HTMLInputElement
const chapter = () => screen.queryByLabelText('The chapter of the paper this part covers') as HTMLSelectElement | null

describe('the page has no box about parts', () => {
  test('nothing stands above the steps: no parts box, no paragraph, no "add part", no count of unfiled steps', async () => {
    store.journey = SIMPLE
    await framed()
    expect(document.querySelector('[data-parts]')).toBeNull()
    const text = document.body.textContent ?? ''
    for (const gone of ['add part', 'Every step is in a part', 'list all', 'make a part for each chapter', 'by references', 'owns ']) {
      expect(text).not.toContain(gone)
    }
    /* A step closed draws no control about its part at all. */
    expect(document.querySelector('select')).toBeNull()
  })
})

describe('a step’s part, in the step’s own editor', () => {
  test('the name somebody gave is in its box; a part called by its title has an empty one', async () => {
    store.journey = SIMPLE
    store.chapters = PAPER
    await framed()
    wire.setEditing(0)
    await settle()
    expect(name().value).toBe('Methods')
    wire.setEditing(1)
    await settle()
    expect(name().value).toBe('')
    expect(name().placeholder).toContain('the title, if empty')
  })

  test('the chapter is one of the paper’s files no other step has, or none', async () => {
    store.journey = SIMPLE
    store.chapters = PAPER
    await framed()
    wire.setEditing(1)
    await settle()
    /* Methods is step one's, so step two is not offered it. */
    expect([...chapter()!.options].map((one) => one.value)).toEqual(['', 'chapters/4_results.tex', 'chapters/5_discussion.tex'])
    expect(chapter()!.value).toBe('')
    wire.setEditing(0)
    await settle()
    expect([...chapter()!.options].map((one) => one.value)).toEqual(['', 'chapters/3_methods.tex', 'chapters/4_results.tex', 'chapters/5_discussion.tex'])
    expect(chapter()!.value).toBe('chapters/3_methods.tex')
  })

  test('an epic with no paper is offered no chapter', async () => {
    store.journey = SIMPLE
    await framed()
    wire.setEditing(1)
    await settle()
    expect(chapter()).toBeNull()
    expect(name()).not.toBeNull()
  })

  test('saving sends the step by the id of its part, with the name and the chapter', async () => {
    store.journey = SIMPLE
    store.chapters = PAPER
    await framed()
    wire.setEditing(1)
    await settle()
    fireEvent.change(name(), { target: { value: 'Results' } })
    fireEvent.change(chapter()!, { target: { value: 'chapters/4_results.tex' } })
    fireEvent.click(screen.getByText('Save'))
    await settle()
    expect(sent('/api/step').at(-1)).toMatchObject({ step: 'a-reader-sees-what-happened', name: 'Results', file: 'chapters/4_results.tex' })
    const groups = (wire.getSnapshot().journey as unknown as { groups: { id: string; heading: string; files?: string[] }[] }).groups
    expect(groups[1]).toMatchObject({ id: 'a-reader-sees-what-happened', heading: 'Results', files: ['chapters/4_results.tex'] })
  })

  test('removing a step asks once more, then removes it and its part', async () => {
    store.journey = SIMPLE
    await framed()
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
  })

  test('a step not written yet has the same two fields, and no remove', async () => {
    store.journey = SIMPLE
    store.chapters = PAPER
    await framed()
    wire.setAdding(true)
    await settle()
    expect(name().value).toBe('')
    expect([...chapter()!.options].map((one) => one.value)).toEqual(['', 'chapters/4_results.tex', 'chapters/5_discussion.tex'])
    expect(document.querySelector('[data-remove]')).toBeNull()
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

describe('an epic with a paper and no steps', () => {
  test('no journey: one press begins it with a step for each chapter the paper pulls in', async () => {
    store.listed = false
    store.chapters = { ...PAPER, chapters: PAPER.chapters.map((one) => ({ ...one, part: null })) }
    store.journey = { ...JOURNEY, steps: [], plan: 'none' } as unknown as typeof JOURNEY
    const { host } = await framed()
    const press = document.querySelector('[data-make="chapters"]') as HTMLButtonElement
    expect(press.textContent).toBe('begin it with a step for each of the paper’s 3 chapters')
    fireEvent.click(press)
    await settle()
    host.refuse('not granted', 'epic.get')
    await settle()
    await settle()
    expect(store.begun).toHaveLength(1)
    expect(sent('/api/steps/chapters')).toHaveLength(1)
    const journey = wire.getSnapshot().journey as unknown as { steps: { title: string; part: string }[]; groups: { files?: string[] }[] }
    expect(journey.steps.map((one) => one.title)).toEqual(['Methods', 'Results', 'Discussion'])
    expect(journey.groups.map((one) => one.files?.[0])).toEqual(['chapters/3_methods.tex', 'chapters/4_results.tex', 'chapters/5_discussion.tex'])
  })

  test('a journey with no step offers the same press beside "write the first step"', async () => {
    store.journey = { ...JOURNEY, steps: [], plan: 'none' } as unknown as typeof JOURNEY
    store.chapters = { ...PAPER, chapters: PAPER.chapters.map((one) => ({ ...one, part: null })) }
    await framed()
    const press = document.querySelector('[data-make="chapters"]') as HTMLButtonElement
    expect(press.textContent).toBe('a step for each of the paper’s 3 chapters')
    fireEvent.click(press)
    await settle()
    expect(wire.getSnapshot().journey?.steps).toHaveLength(3)
  })

  test('an epic with no paper is offered only the one press', async () => {
    store.listed = false
    await framed()
    expect(document.querySelector('[data-make="chapters"]')).toBeNull()
    expect(document.querySelectorAll('[data-begin] button')).toHaveLength(1)
  })
})
