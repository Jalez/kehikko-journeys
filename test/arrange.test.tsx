import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { EpicPart } from 'kehikot-module-protocol'
import { mailbox } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { JOURNEY, settle, started, store, stubHost, type Wire } from './host.ts'

/**
 * Arranging a journey into parts, from the page.
 *
 * The page under a focus used to end in a sentence: thirty-eight steps, all in
 * no part, none shown. These are the presses that sentence now leads to, and
 * the rule each is held to is that nothing is filed that a person was not
 * shown first.
 */

const GROUPS = [
  { heading: 'The agent seam', refs: ['gh#1', 'gh#2'] },
  { heading: 'What the page shows', refs: ['gh#3'] },
]
const STEPS = [
  { title: 'One', body: '', refs: ['gh#1'], notes: [] },
  { title: 'Two', body: '', refs: ['gh#3'], notes: [], part: 'what-the-page-shows' },
  { title: 'Three', body: '', refs: ['gh#2', 'gh#1'], notes: [] },
  { title: 'Four', body: '', refs: [], notes: [] },
  { title: 'Five', body: '', refs: ['gh#3', 'gh#8'], notes: [] },
]
const divided = { ...JOURNEY, steps: STEPS, groups: GROUPS } as unknown as typeof JOURNEY
const PARTS: EpicPart[] = [
  { id: 'the-agent-seam', heading: 'The agent seam', refs: ['gh#1', 'gh#2'], picked: false },
  { id: 'what-the-page-shows', heading: 'What the page shows', refs: ['gh#3'], picked: false },
]
const pick = (...ids: string[]) => PARTS.map((one) => ({ ...one, picked: ids.includes(one.id) }))

let wire: Wire
let projects = 0

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false

beforeAll(async () => {
  wire = await started()
})

afterEach(() => {
  wire.setArranging(false)
  wire.setAdding(false)
  cleanup()
  mailbox.forget?.()
  document.body.innerHTML = ''
  store.reset()
})

async function framed(more: Record<string, unknown> = {}) {
  const host = stubHost()
  projects += 1
  const projectPath = `/Users/somebody/Projects/arrange-${projects}`
  host.greet([], { projectPath, ...more })
  await settle()
  render(<App />)
  return { host, projectPath }
}

const drawn = () => [...document.querySelectorAll('[data-step]')].map((el) => el.getAttribute('data-step'))
const button = (text: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((one) => one.textContent === text) as HTMLButtonElement
const choosers = () => [...document.querySelectorAll<HTMLSelectElement>('[data-step] select')]
const box = () => document.querySelector('[data-parts="open"]') as HTMLElement
const listed = () => [...box().querySelectorAll('label')].map((one) => one.textContent)

describe('a journey that is not divided into parts', () => {
  test('shows none of it: no chooser on a step, no count, no list — only the way in', async () => {
    await framed()
    expect(drawn()).toEqual(['1', '2'])
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('in no part')
    expect(document.querySelector('[data-parts="open"]')).toBeNull()
    expect(button('divide into parts')).toBeDefined()
  })

  test('the way in makes the first part, and then the steps can be filed', async () => {
    const { host, projectPath } = await framed()
    fireEvent.click(button('divide into parts'))
    expect(box().textContent).toContain('No parts yet')
    /* With no part there is nothing to file under, so no list of steps either. */
    expect(listed()).toEqual([])
    fireEvent.change(box().querySelector('input[aria-label="Heading of a new part"]') as Element, {
      target: { value: 'Reading the trackers' },
    })
    fireEvent.click(button('add part'))
    await settle()
    expect(store.arranged).toEqual([
      { path: '/api/part', body: { slug: 'probe', heading: 'Reading the trackers', project: projectPath } },
    ])
    /* Every container on the epic is told: the host's picker reads its parts from this. */
    expect(host.asked('content.changed').map((one) => one.params)).toEqual([{ epic: 'probe' }])
    expect(box().querySelector('[data-part="reading-the-trackers"]')?.textContent).toContain('0 steps · 0 references')
    expect(listed()).toEqual(['1.One', '2.Two'])
    expect(choosers()).toHaveLength(2)
  })
})

describe('which part a step is in', () => {
  test('is said and changed on the step, from the journey’s own parts and not the host’s', async () => {
    store.journey = divided
    /* A host that sends no parts at all: the chooser does not depend on it. */
    const { host } = await framed()
    expect(choosers().map((one) => one.value)).toEqual(['', 'what-the-page-shows', '', '', ''])
    expect([...choosers()[0]!.options].map((one) => one.textContent)).toEqual([
      'in no part',
      'The agent seam',
      'What the page shows',
    ])
    fireEvent.change(choosers()[2]!, { target: { value: 'the-agent-seam' } })
    await settle()
    expect(store.arranged.at(-1)?.body).toMatchObject({ slug: 'probe', positions: [3], part: 'the-agent-seam' })
    expect(choosers()[2]!.value).toBe('the-agent-seam')
    expect(host.asked('content.changed')).toHaveLength(1)
    /* "in no part" is a choice like any other, and takes the step out. */
    fireEvent.change(choosers()[1]!, { target: { value: '' } })
    await settle()
    expect(store.arranged.at(-1)?.body).toMatchObject({ positions: [2], part: '' })
    expect(choosers()[1]!.value).toBe('')
  })

  test('the fold says how many steps are in none', async () => {
    store.journey = divided
    await framed()
    expect(document.querySelector('[data-parts="closed"]')?.parentElement?.textContent).toBe('2 parts4 of 5 steps in no part')
  })
})

describe('filing several steps at once', () => {
  test('a focus that hides unfiled steps points at where they are filed, and filing them shows them', async () => {
    store.journey = divided
    await framed({ parts: pick('the-agent-seam') })
    expect(drawn()).toEqual([])
    const narrowed = document.querySelector('[data-narrowed]') as HTMLElement
    expect(narrowed.textContent).toContain('0 of 5 steps shown · 5 outside the picked part, 4 of them in no part at all')
    expect(narrowed.textContent).toContain('The 4 steps in no part are hidden under any focus until filed under a part.')

    fireEvent.click(button('file them under parts', narrowed))
    /* The steps the page is NOT drawing are the ones listed: by number and title. */
    expect(listed()).toEqual(['1.One', '3.Three', '4.Four', '5.Five'])
    expect(drawn()).toEqual([])

    fireEvent.click(button('tick all 4'))
    fireEvent.click(box().querySelectorAll('input[type="checkbox"]')[3] as Element)
    fireEvent.change(box().querySelector('select') as Element, { target: { value: 'the-agent-seam' } })
    expect(box().textContent).toContain('file the 3 ticked under')
    fireEvent.click(box().querySelector('[data-file="ticked"]') as Element)
    await settle()
    expect(store.arranged.at(-1)).toMatchObject({ path: '/api/assign', body: { positions: [1, 3, 4], part: 'the-agent-seam' } })
    /* Shown now, under their own numbers, because they are in the picked part. */
    expect(drawn()).toEqual(['1', '3', '4'])
    expect(listed()).toEqual(['5.Five'])
    expect(document.querySelector('[data-narrowed]')?.textContent).toContain('3 of 5 steps shown')
  })

  test('nothing is filed until steps are ticked', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    expect((box().querySelector('[data-file="ticked"]') as HTMLButtonElement).disabled).toBe(true)
    expect(store.arranged).toEqual([])
  })

  test('builds on the canvas pick: the steps picked there can be ticked in one press', async () => {
    store.journey = divided
    const host = stubHost()
    projects += 1
    host.greet(['gh#1', 'gh#2'], { projectPath: `/Users/somebody/Projects/arrange-${projects}` })
    await settle()
    render(<App />)
    fireEvent.click(button('2 parts'))
    /* One names gh#1; Three names gh#2 and gh#1. Both are wholly picked. */
    fireEvent.click(button('tick the 2 picked on the canvas'))
    expect(box().textContent).toContain('file the 2 ticked under')
    const ticked = [...box().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((one) => one.checked)
    expect(ticked).toEqual([true, true, false, false])
  })
})

describe('“by references…”', () => {
  test('shows what it would file and files nothing until told to', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    const row = box().querySelector('[data-part="the-agent-seam"]') as HTMLElement
    fireEvent.click(button('by references…', row))
    const proposal = row.querySelector('[data-proposal]') as HTMLElement
    /* One and Three name only this part's references. Four names none; Five names gh#8. */
    expect(proposal.textContent).toContain('These 2 steps are in no part and name only references this part holds. Nothing has been filed.')
    expect([...proposal.querySelectorAll('li')].map((one) => one.textContent)).toEqual(['1.One', '3.Three'])
    expect(store.arranged).toEqual([])

    fireEvent.click(button('file these 2 under The agent seam', proposal))
    await settle()
    expect(store.arranged).toHaveLength(1)
    expect(store.arranged[0]).toMatchObject({ path: '/api/assign', body: { positions: [1, 3], part: 'the-agent-seam' } })
    expect(choosers().map((one) => one.value)).toEqual(['the-agent-seam', 'what-the-page-shows', 'the-agent-seam', '', ''])
  })

  test('says so when there is nothing to propose, and “leave them” leaves them', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    const row = box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('by references…', row))
    expect(row.querySelector('[data-proposal]')?.textContent).toContain('Nothing to propose')
    const other = box().querySelector('[data-part="the-agent-seam"]') as HTMLElement
    fireEvent.click(button('by references…', other))
    fireEvent.click(button('leave them', other))
    expect(other.querySelector('[data-proposal]')).toBeNull()
    expect(store.arranged).toEqual([])
  })
})

describe('the parts themselves, from the page', () => {
  test('renaming keeps the steps in the part', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    const row = box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('rename', row))
    fireEvent.change(row.querySelector('input') as Element, { target: { value: 'What a person sees' } })
    fireEvent.submit(row.querySelector('form') as Element)
    await settle()
    expect(store.arranged[0]).toMatchObject({ path: '/api/part', body: { id: 'what-the-page-shows', heading: 'What a person sees' } })
    expect(box().querySelector('[data-part="what-the-page-shows"]')?.textContent).toContain('What a person sees1 step')
    expect(choosers()[1]!.value).toBe('what-the-page-shows')
  })

  test('removing says how many steps and references it holds and what happens to them, and waits', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    const row = box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('remove', row))
    const asked = row.querySelector('[data-removal]') as HTMLElement
    expect(asked.textContent).toContain(
      'Remove What the page shows? Its 1 step stays in the journey and becomes unassigned (in no part); the 1 '
        + 'reference listed under its heading goes with it, all still named by a step. No step is deleted.',
    )
    expect(store.arranged).toEqual([])
    fireEvent.click(button('keep it', asked))
    expect(row.querySelector('[data-removal]')).toBeNull()
    expect(store.arranged).toEqual([])

    fireEvent.click(button('remove', row))
    fireEvent.click(button('remove the part', row))
    await settle()
    expect(store.arranged).toEqual([expect.objectContaining({ path: '/api/part/remove' })])
    /* Five steps before, five after, and step two says no part. */
    expect(drawn()).toEqual(['1', '2', '3', '4', '5'])
    expect(choosers().map((one) => one.value)).toEqual(['', '', '', '', ''])
    expect(box().querySelector('[data-part="what-the-page-shows"]')).toBeNull()
  })

  test('a refusal is said, and the box stays as it was', async () => {
    store.journey = divided
    await framed()
    fireEvent.click(button('2 parts'))
    fireEvent.change(box().querySelector('input[aria-label="Heading of a new part"]') as Element, {
      target: { value: 'the agent seam' },
    })
    fireEvent.click(button('add part'))
    await settle()
    expect(document.querySelector('[aria-live]')?.textContent).toContain('already has a part called “The agent seam”')
    expect(box().querySelectorAll('[data-part]')).toHaveLength(2)
  })
})

describe('the files a part owns, from the page', () => {
  const owning = {
    ...divided,
    groups: [GROUPS[0], { ...GROUPS[1], files: ['chapters/page.tex'] }],
  } as unknown as typeof JOURNEY

  test('are shown back on the row, and counted, without opening anything', async () => {
    store.journey = owning
    await framed()
    fireEvent.click(button('2 parts'))
    const row = box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    expect(row.textContent).toContain('1 step · 1 reference · 1 file')
    expect(row.querySelector('[data-files]')?.textContent).toBe('owns chapters/page.tex')
    /* A part with none says nothing about files on its row. */
    const none = box().querySelector('[data-part="the-agent-seam"]') as HTMLElement
    expect(none.textContent).toContain('0 steps · 2 references')
    expect(none.textContent).not.toContain(' file')
    expect(none.querySelector('[data-files]')).toBeNull()
  })

  test('the editor says the form with an example, and adding sends the whole list and no heading', async () => {
    store.journey = owning
    await framed()
    fireEvent.click(button('2 parts'))
    const row = () => box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('files', row()))
    const editor = () => row().querySelector('[data-files-of]') as HTMLElement
    expect(editor().textContent).toContain('named from the paper’s folder, with its extension — for example chapters/design.tex')
    expect(editor().textContent).toContain('This app cannot read the paper')
    fireEvent.change(editor().querySelector('input') as Element, { target: { value: './chapters/more.tex' } })
    fireEvent.submit(editor().querySelector('form') as Element)
    await settle()
    expect(store.arranged).toEqual([
      expect.objectContaining({ path: '/api/part', body: expect.objectContaining({ id: 'what-the-page-shows', files: ['chapters/page.tex', './chapters/more.tex'] }) }),
    ])
    expect(Object.hasOwn(store.arranged[0]!.body, 'heading')).toBe(false)
    /* What the store kept is what is shown: tidied, and the box is cleared. */
    expect([...editor().querySelectorAll('li code')].map((one) => one.textContent)).toEqual(['chapters/page.tex', 'chapters/more.tex'])
    expect((editor().querySelector('input') as HTMLInputElement).value).toBe('')
    expect(row().textContent).toContain('2 files')
  })

  test('a name that is not a file’s is refused in words, and stays in the box to be corrected', async () => {
    store.journey = owning
    await framed()
    fireEvent.click(button('2 parts'))
    const row = () => box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('files', row()))
    const editor = () => row().querySelector('[data-files-of]') as HTMLElement
    fireEvent.change(editor().querySelector('input') as Element, { target: { value: '../other/main.tex' } })
    fireEvent.submit(editor().querySelector('form') as Element)
    await settle()
    /* Beside the box, in the store's own words, and nothing was sent. */
    expect(editor().querySelector('[role="alert"]')?.textContent).toContain('"../other/main.tex" is not a name a part can hold for a file')
    expect(store.arranged).toEqual([])
    expect((editor().querySelector('input') as HTMLInputElement).value).toBe('../other/main.tex')
    expect([...editor().querySelectorAll('li code')].map((one) => one.textContent)).toEqual(['chapters/page.tex'])
    /* Correcting it takes the sentence down. */
    fireEvent.change(editor().querySelector('input') as Element, { target: { value: 'other/main.tex' } })
    expect(editor().querySelector('[role="alert"]')).toBeNull()
  })

  test('taking the last one out sends an empty list, and the row says nothing about files again', async () => {
    store.journey = owning
    await framed()
    fireEvent.click(button('2 parts'))
    const row = () => box().querySelector('[data-part="what-the-page-shows"]') as HTMLElement
    fireEvent.click(button('files', row()))
    fireEvent.click(button('take out', row()))
    await settle()
    expect(store.arranged.at(-1)?.body).toMatchObject({ id: 'what-the-page-shows', files: [] })
    expect(row().textContent).toContain('This part owns no file yet.')
    expect(row().textContent).not.toContain('1 file')
  })
})

describe('a journey with no steps', () => {
  test('can be given its first from the page', async () => {
    store.journey = { ...JOURNEY, plan: 'none', steps: [] } as unknown as typeof JOURNEY
    await framed()
    expect(document.body.textContent).toContain('No steps have been written for this journey yet.')
    /* `store.asked` is shared by every file that starts this page; count from here. */
    const before = store.asked.length
    fireEvent.click(button('write the first step'))
    const form = document.querySelector('[data-adding="1"] form') as HTMLFormElement
    fireEvent.change(form.querySelector('input[aria-label="Step title"]') as Element, { target: { value: 'The first thing' } })
    fireEvent.submit(form)
    await settle()
    const sent = store.asked.slice(before).filter((line) => line.startsWith('POST') && line.includes('/api/step'))
    expect(sent).toHaveLength(1)
    expect(drawn()).toEqual(['1'])
    expect(document.querySelector('[data-step="1"]')?.textContent).toContain('The first thing')
    /* The editor closed, and the press is now the one for a second step. */
    expect(document.querySelector('[data-adding] form')).toBeNull()
    expect(button('add a step')).toBeDefined()
  })

  test('“add a step” is not offered under a focus, where a new step would vanish on saving', async () => {
    store.journey = divided
    await framed({ parts: pick('what-the-page-shows') })
    expect(drawn()).toEqual(['2'])
    expect(document.querySelector('[data-adding]')).toBeNull()
  })
})
