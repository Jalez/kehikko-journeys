import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { EpicPart } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { narrowedSaid, narrowing, shownSteps } from '../src/focus.ts'
import type { Step } from '../src/kinds.ts'
import { JOURNEY, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * The parts a person picked in the host's bar, honoured on this page — and
 * the press that begins a journey for an epic that has none.
 *
 * Two things the page does because a host now reads this app's steps. Both are
 * about not hiding anything silently: a focus narrows the steps and SAYS how
 * many it left out; beginning a journey brings the host's steps across rather
 * than putting an empty record in front of them.
 */

const part = (id: string, heading: string, picked = false): EpicPart => ({ id, heading, refs: [], picked })
const PARTS = [part('the-agent-seam', 'The agent seam'), part('what-the-page-shows', 'What the page shows')]
const pick = (...ids: string[]) => PARTS.map((one) => ({ ...one, picked: ids.includes(one.id) }))

const step = (title: string, more: Partial<Step> = {}): Step => ({ title, body: '', refs: [], notes: [], ...more })
const STEPS = [
  step('One', { refs: ['gh#1'], part: 'the-agent-seam' }),
  step('Two', { refs: ['gh#2'] }),
  step('Three', { refs: ['gh#3'], part: 'what-the-page-shows' }),
  step('Four', { refs: ['gh#4'], part: 'a-part-that-was-deleted' }),
  step('Five', { refs: ['gh#5'], part: 'the-agent-seam' }),
]

describe('which steps are in front of the person', () => {
  test('nothing picked is every step, and nothing is said', () => {
    expect(shownSteps(PARTS, STEPS).map((one) => one.index)).toEqual([0, 1, 2, 3, 4])
    expect(shownSteps([], STEPS)).toHaveLength(5)
    expect(narrowing(PARTS, STEPS)).toBeNull()
    expect(narrowing([], STEPS)).toBeNull()
  })

  test('a step is shown when the part it SAYS it is in is picked, at its own position', () => {
    expect(shownSteps(pick('the-agent-seam'), STEPS).map((one) => [one.index, one.step.title])).toEqual([
      [0, 'One'],
      [4, 'Five'],
    ])
    expect(shownSteps(pick('the-agent-seam', 'what-the-page-shows'), STEPS).map((one) => one.index)).toEqual([0, 2, 4])
  })

  test('a step with no part is outside every focus, and so is one naming a part that is gone', () => {
    const both = pick('the-agent-seam', 'what-the-page-shows')
    expect(shownSteps(both, STEPS).some((one) => one.step.title === 'Two')).toBe(false)
    expect(shownSteps(both, STEPS).some((one) => one.step.title === 'Four')).toBe(false)
    expect(narrowing(both, STEPS)).toEqual({
      picked: ['The agent seam', 'What the page shows'],
      shown: 3,
      outside: 2,
      unassigned: 2,
    })
  })

  test('a step is never filed by the references it names', () => {
    /* The part lists gh#2 and step Two names gh#2. It is still in no part. */
    const lists = [{ ...part('the-agent-seam', 'The agent seam', true), refs: ['gh#2'] }]
    expect(shownSteps(lists, STEPS).map((one) => one.step.title)).toEqual(['One', 'Five'])
  })

  test('the sentence has both numbers, says where the picking is done, and offers nothing to press', () => {
    const one = narrowedSaid(narrowing(pick('the-agent-seam'), STEPS)!)
    expect(one.lead).toBe('Narrowed to The agent seam.')
    expect(one.rest).toContain('2 of 5 steps shown · 3 outside the picked part, 2 of them in no part at all')
    expect(one.rest).toContain('host’s bar')

    const two = narrowedSaid(narrowing(pick('the-agent-seam', 'what-the-page-shows'), STEPS)!)
    expect(two.lead).toBe('Narrowed to 2 parts: The agent seam, What the page shows.')
    expect(two.rest).toContain('3 of 5 steps shown · 2 outside the picked parts, all of them in no part at all')

    /* A journey nobody has assigned yet: the count is what explains the empty page. */
    const none = narrowedSaid(narrowing(pick('the-agent-seam'), [step('a'), step('b')])!)
    expect(none.rest).toContain('0 of 2 steps shown · 2 outside the picked part, all of them in no part at all')

    const all = narrowedSaid(narrowing(pick('the-agent-seam'), [step('a', { part: 'the-agent-seam' })])!)
    expect(all.rest).toContain('All 1 step is in it.')
  })
})

let wire: Wire
let projects = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  store.reset()
})

/** A host, greeted in a fresh project, with the page drawn. */
async function framed(more: Record<string, unknown> = {}) {
  const host = stubHost()
  projects += 1
  const projectPath = `/Users/somebody/Projects/focus-${projects}`
  host.greet([], { projectPath, ...more })
  await settle()
  render(<App />)
  const context = (extra: Record<string, unknown>) => host.context([], 'probe', { projectPath, ...extra })
  return { host, context, projectPath }
}

const drawn = () => [...document.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'))

describe('the page under a focus', () => {
  const divided = { ...JOURNEY, steps: STEPS } as unknown as typeof JOURNEY

  test('with nothing picked it is the page it always was', async () => {
    store.journey = divided
    await framed({ parts: PARTS })
    expect(drawn()).toEqual(['1', '2', '3', '4', '5'])
    expect(document.querySelector('[data-narrowed]')).toBeNull()
    expect(document.body.textContent).not.toContain('Narrowed')
  })

  test('and so it is for a host that has never heard of parts', async () => {
    store.journey = divided
    await framed()
    expect(drawn()).toEqual(['1', '2', '3', '4', '5'])
    expect(document.querySelector('[data-narrowed]')).toBeNull()
  })

  test('picking a part draws its steps, under their own numbers, and says what was left out', async () => {
    store.journey = divided
    const { context } = await framed({ parts: PARTS })
    const before = store.asked.length
    context({ parts: pick('the-agent-seam') })
    await settle()
    /* Step five is still step five. */
    expect(drawn()).toEqual(['1', '5'])
    const said = document.querySelector('[data-narrowed]')?.textContent ?? ''
    expect(said).toContain('Narrowed to The agent seam.')
    expect(said).toContain('2 of 5 steps shown · 3 outside the picked part')
    expect(said).toContain('host’s bar')
    /* Nothing is fetched for it: the steps were already here. */
    expect(store.asked.slice(before)).toEqual([])
    /* And there is no way on this page to widen it again. */
    expect(document.querySelector('[data-narrowed] button')).toBeNull()

    context({ parts: PARTS })
    await settle()
    expect(drawn()).toEqual(['1', '2', '3', '4', '5'])
    expect(document.querySelector('[data-narrowed]')).toBeNull()
  })

  test('a journey nobody has assigned shows none of its steps under a focus, and says why', async () => {
    await framed({ parts: pick('the-agent-seam') })
    expect(drawn()).toEqual([])
    expect(document.querySelector('[data-narrowed]')?.textContent).toContain(
      '0 of 2 steps shown · 2 outside the picked part, all of them in no part at all',
    )
    /* Not the sentence for a journey with no steps: there are two. */
    expect(document.body.textContent).not.toContain('No steps have been written')
  })

  test('"pick every step" picks the steps on the page and no others', async () => {
    store.journey = divided
    const { host } = await framed({ parts: pick('the-agent-seam') })
    const button = [...document.querySelectorAll('button')].find((one) => one.textContent === 'pick every step')!
    fireEvent.click(button)
    expect(host.picks().at(-1)).toEqual(['gh#1', 'gh#5'])
  })

  test('a walk to a step outside the focus says that, not that the step does not exist', async () => {
    store.journey = divided
    await framed({ parts: pick('the-agent-seam') })
    const hidden = await wire.goTo({ step: 2 }, { quiet: true })
    expect(hidden.found).toBe(false)
    expect(hidden.why).toContain('Step 2 is outside the parts picked')
    const byRef = await wire.goTo({ ref: 'gh#3' }, { quiet: true })
    expect(byRef.why).toContain('gh#3 is named by a step outside the parts picked')
    expect((await wire.goTo({ step: 9 }, { quiet: true })).why).toBe('This journey has no step 9.')
    expect((await wire.goTo({ step: 5 }, { quiet: true })).found).toBe(true)
  })
})

describe('an epic this project has no journey for', () => {
  const hosted = { slug: 'probe', title: 'A journey', steps: [{ title: 'From the host', refs: ['gh#9'] }], groups: [] }

  test('offers to begin one, in words about the host’s steps', async () => {
    store.listed = false
    await framed()
    const text = document.body.textContent ?? ''
    expect(text).toContain('This project holds none called probe.')
    expect(text).toContain('copies what the host holds for it')
    expect([...document.querySelectorAll('button')].some((one) => one.textContent === 'begin the journey for probe')).toBe(true)
  })

  test('is not offered while a journey that exists is still on its way', async () => {
    const release = store.hold()
    await framed()
    expect(wire.getSnapshot().journey).toBeNull()
    expect(document.body.textContent).not.toContain('begin the journey')
    release()
    await settle()
    expect(drawn()).toEqual(['1', '2'])
  })

  test('the press asks the host what it holds and hands exactly that to the store', async () => {
    store.listed = false
    const { host, projectPath } = await framed()
    fireEvent.click([...document.querySelectorAll('button')].find((one) => one.textContent === 'begin the journey for probe')!)
    await settle()
    expect(host.asked('epic.get').map((one) => one.params)).toEqual([{ epic: 'probe' }])
    /* Nothing is written until the host has answered. */
    expect(store.begun).toEqual([])
    host.answer('epic.get', hosted)
    await settle()
    expect(store.begun).toEqual([{ slug: 'probe', seed: hosted, project: projectPath }])
    /* Every container on the epic is told, and this one opens what was made. */
    expect(host.asked('content.changed').map((one) => one.params)).toEqual([{ epic: 'probe' }])
    expect(drawn()).toEqual(['1', '2'])
    expect(document.body.textContent).toContain('Began probe from what the host holds')
    expect(document.body.textContent).not.toContain('begin the journey for probe')
  })

  test('a host that refuses is not a reason to make an empty record: the store is asked with no seed', async () => {
    store.listed = false
    const { host, projectPath } = await framed()
    fireEvent.click([...document.querySelectorAll('button')].find((one) => one.textContent === 'begin the journey for probe')!)
    await settle()
    host.refuse('kehikot.journeys may not read epics.', 'epic.get')
    await settle()
    /* No `seed` key at all, which is what makes the store read the host's file. */
    expect(store.begun).toEqual([{ slug: 'probe', project: projectPath }])
  })

  test('opening an epic with no journey writes nothing by itself', async () => {
    store.listed = false
    const before = store.asked.length
    const { host } = await framed()
    await settle()
    expect(store.begun).toEqual([])
    expect(host.asked('epic.get')).toEqual([])
    expect(store.asked.slice(before).some((line) => line.startsWith('POST /api/journey'))).toBe(false)
  })
})
