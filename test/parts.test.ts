import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, LIMITS, moduleFolder, partIdsOf, partsOf, stepPart } from 'kehikot-module-protocol'

import { answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import {
  assign,
  filesGiven,
  filesSaid,
  holding,
  notAPart,
  pinned,
  proposed,
  removalOf,
  removalSaid,
  unassigned,
  withPart,
  withoutPart,
  type Arrangeable,
} from '../parts.ts'

/**
 * Arranging a journey into parts: the arithmetic, and then the two doors.
 *
 * The property everything here is held to is one sentence: **a group that is
 * still there is still called what it was called.** An id that moves takes
 * every step filed under it out of its part and every stored focus off it,
 * with no write to either — so each change below is checked by asking the
 * protocol's own `partsOf` before and after, and never by reading `id` off a
 * group.
 */

const step = (title: string, refs: string[] = [], part?: string) => ({
  title,
  body: '',
  refs,
  notes: [],
  ...(part ? { part } : {}),
})

/** Six groups that between them use every way `partIdsOf` names one. */
const awkward = (): Arrangeable => ({
  groups: [
    { heading: 'The agent seam', refs: ['gh#1', 'gh#2'] },
    { heading: 'Later', refs: ['gh#3'] },
    { heading: '', refs: ['gh#4'] },
    { heading: 'Later', refs: [] },
    { heading: 'Written down', refs: ['gh#5'], id: 'kept-by-hand' },
    { heading: '…', refs: [] },
  ],
  steps: [
    step('One', ['gh#1']),
    step('Two', ['gh#1', 'gh#2']),
    step('Three', ['gh#3', 'gh#9']),
    step('Four', []),
    step('Five', ['gh#4'], 'part-3'),
    step('Six', ['gh#5'], 'a-part-that-is-gone'),
    step('Seven', ['gh#3'], 'later-2'),
  ],
})

/** What a reader of the record is told about its parts, minus the step counts. */
const seen = (record: Arrangeable) => partsOf(record).map(({ id, heading, refs }) => ({ id, heading, refs }))

describe('the ids a group answers to', () => {
  test('are the protocol’s, including the awkward ones', () => {
    expect(partIdsOf(awkward().groups)).toEqual(['the-agent-seam', 'later', 'part-3', 'later-2', 'kept-by-hand', 'part-6'])
  })

  test('writing a group’s id onto it changes nothing a reader sees — for every group, one at a time', () => {
    const before = awkward()
    for (const id of partIdsOf(before.groups) as string[]) {
      const groups = pinned(before.groups, id)
      expect(partIdsOf(groups)).toEqual(partIdsOf(before.groups))
      expect(partsOf({ ...before, groups })).toEqual(partsOf(before))
      /* And only that group was touched. */
      expect(groups.filter((group, i) => group !== before.groups[i])).toHaveLength(id === 'kept-by-hand' ? 0 : 1)
    }
  })

  test('and all of them at once, in either order', () => {
    const before = awkward()
    const ids = partIdsOf(before.groups) as string[]
    for (const order of [ids, [...ids].reverse()]) {
      const groups = order.reduce((held, id) => pinned(held, id), before.groups)
      expect(partsOf({ ...before, groups })).toEqual(partsOf(before))
      expect(groups.map((group) => group.id)).toEqual(ids)
    }
  })

  test('a group that has its id written keeps it when the heading is reworded', () => {
    const before = awkward()
    const groups = pinned(before.groups, 'later-2').map((group) =>
      group.id === 'later-2' ? { ...group, heading: 'Much later' } : group,
    )
    expect(partIdsOf(groups)[3]).toBe('later-2')
    /* Without the written id, the same rewording renames it. */
    const unwritten = before.groups.map((group, i) => (i === 3 ? { ...group, heading: 'Much later' } : group))
    expect(partIdsOf(unwritten)[3]).toBe('much-later')
  })

  test('`holding` writes a name down only where it would otherwise have moved', () => {
    const before = awkward()
    const named = partIdsOf(before.groups)
    const without = before.groups.filter((_, i) => i !== 1)
    const kept = holding(
      without,
      named.filter((_, i) => i !== 1),
    )
    expect(partIdsOf(kept)).toEqual(['the-agent-seam', 'part-3', 'later-2', 'kept-by-hand', 'part-6'])
    /* The first group's name never moved, so nothing was written on it. */
    expect(kept[0]).toBe(without[0]!)
    expect(kept[0]!.id).toBeUndefined()
  })
})

describe('filing steps', () => {
  test('puts steps in a part, writes the part’s id onto its group, and touches nothing else', () => {
    const before = awkward()
    const out = assign(before, [1, 2], 'the-agent-seam')
    if (!out.ok) throw new Error(out.error)
    expect(out.moved).toEqual([1, 2])
    expect(out.heading).toBe('The agent seam')
    expect(out.record.steps.map(stepPart)).toEqual([
      'the-agent-seam',
      'the-agent-seam',
      null,
      null,
      'part-3',
      'a-part-that-is-gone',
      'later-2',
    ])
    expect(out.record.groups[0]!.id).toBe('the-agent-seam')
    /* Same parts, same ids, same headings, same references. */
    expect(seen(out.record)).toEqual(seen(before))
    /* The steps it did not name are the very objects they were. */
    expect(out.record.steps.slice(2)).toEqual(before.steps.slice(2))
    /* And the record it was handed is as it was. */
    expect(before).toEqual(awkward())
  })

  test('so rewording the heading afterwards does not orphan the assignment', () => {
    const out = assign(awkward(), [1], 'later')
    if (!out.ok) throw new Error(out.error)
    const reworded = withPart(out.record, { id: 'later', heading: 'Sooner than that' })
    if (!reworded.ok) throw new Error(reworded.error)
    expect(partsOf(reworded.record).find((part) => part.id === 'later')).toMatchObject({
      heading: 'Sooner than that',
      steps: 1,
    })
    /* The other group called "Later" is still `later-2`, and its step is still in it. */
    expect(partsOf(reworded.record).find((part) => part.id === 'later-2')?.steps).toBe(1)
  })

  test('refuses an id that is not a part, listing the ones that are', () => {
    const out = assign(awkward(), [1], 'the-agent-seem')
    expect(out.ok).toBe(false)
    const said = (out as { error: string }).error
    expect(said).toContain('"the-agent-seem" is not a part of this journey')
    for (const id of ['the-agent-seam', 'later', 'part-3', 'later-2', 'kept-by-hand', 'part-6']) expect(said).toContain(id)
    expect(notAPart({ steps: [], groups: [] }, 'anything')).toContain('not divided into parts at all')
  })

  test('refuses the whole call over one position that is not a step', () => {
    const out = assign(awkward(), [1, 8, 0], 'later')
    expect(out).toEqual({
      ok: false,
      error: 'this journey has 7 stored steps, and 8, 0 are not among them. Nothing was changed.',
    })
  })

  test('null takes steps out of every part, and removes the field rather than emptying it', () => {
    const out = assign(awkward(), [5, 1], null)
    if (!out.ok) throw new Error(out.error)
    expect(out.moved).toEqual([5])
    expect(out.already).toEqual([1])
    expect(Object.hasOwn(out.record.steps[4]!, 'part')).toBe(false)
  })

  test('a step naming a part that is gone is in no part', () => {
    expect(unassigned(awkward())).toEqual([0, 1, 2, 3, 5])
  })
})

describe('the proposal by references', () => {
  test('is the unassigned steps whose references are ALL among the part’s', () => {
    /* One and Two name only gh#1 and gh#2. Three names gh#3 — and gh#9, which no part holds. */
    expect(proposed(awkward(), 'the-agent-seam')).toEqual([0, 1])
    expect(proposed(awkward(), 'later')).toEqual([])
  })

  test('never a step with no references, which would fit every part at once', () => {
    for (const id of partIdsOf(awkward().groups) as string[]) expect(proposed(awkward(), id)).not.toContain(3)
  })

  test('never a step somebody already filed, and never anything for a part that is not one', () => {
    /* Seven names gh#3, which “Later” holds, and is in `later-2`. */
    expect(proposed(awkward(), 'later')).not.toContain(6)
    expect(proposed(awkward(), 'nowhere')).toEqual([])
  })

  test('counts what a part holds the way a host does: its own list, and its steps’', () => {
    /* Six names gh#5 and a part that is gone, so it is unassigned; gh#5 is `kept-by-hand`’s. */
    expect(proposed(awkward(), 'kept-by-hand')).toEqual([5])
    /* Filing Three under “Later” makes gh#9 one of that part’s references. */
    const filed = assign(awkward(), [3], 'later')
    if (!filed.ok) throw new Error(filed.error)
    const more = { ...filed.record, steps: [...filed.record.steps, step('Eight', ['gh#9'])] }
    expect(proposed(more, 'later')).toEqual([7])
  })

  test('proposes; it changes nothing', () => {
    const before = awkward()
    proposed(before, 'the-agent-seam')
    expect(before).toEqual(awkward())
  })
})

describe('the parts themselves', () => {
  test('a new part goes at the end, with its id written from the start', () => {
    const out = withPart(awkward(), { heading: '  What the page shows ' })
    if (!out.ok) throw new Error(out.error)
    expect(out).toMatchObject({ id: 'what-the-page-shows', heading: 'What the page shows', created: true })
    expect(out.record.groups.at(-1)).toEqual({ heading: 'What the page shows', refs: [], id: 'what-the-page-shows' })
    expect(seen(out.record).slice(0, 6)).toEqual(seen(awkward()))
  })

  test('rewording keeps the id, the references and every step', () => {
    const out = withPart(awkward(), { id: 'part-3', heading: 'Named at last' })
    if (!out.ok) throw new Error(out.error)
    expect(out).toMatchObject({ id: 'part-3', created: false })
    expect(partsOf(out.record)[2]).toEqual({ id: 'part-3', heading: 'Named at last', refs: ['gh#4'], steps: 1 })
    expect(partIdsOf(out.record.groups)).toEqual(partIdsOf(awkward().groups))
  })

  test('refuses no heading, a heading another part has, and an id that is not a part', () => {
    expect(withPart(awkward(), { heading: '   ' }).ok).toBe(false)
    const twice = withPart(awkward(), { heading: 'the agent SEAM' })
    expect((twice as { error: string }).error).toContain('already has a part called “The agent seam”')
    expect(withPart(awkward(), { id: 'nope', heading: 'Anything' }).ok).toBe(false)
    /* Rewording a part to the heading it has is not a clash with itself. */
    expect(withPart(awkward(), { id: 'the-agent-seam', heading: 'The agent seam' }).ok).toBe(true)
  })

  test('refuses one more part than a host will read', () => {
    const full = { steps: [], groups: Array.from({ length: 32 }, (_, i) => ({ heading: `Part ${i}`, refs: [] })) }
    expect((withPart(full, { heading: 'One too many' }) as { error: string }).error).toContain('at most 32')
  })

  test('removing says what goes with it, before and in the same words', () => {
    const gone = removalOf(awkward(), 'later')
    expect(gone).toEqual({ heading: 'Later', steps: [], refs: ['gh#3'], loose: [] })
    expect(removalSaid(removalOf(awkward(), 'part-3')!)).toBe(
      'Its 1 step stays in the journey and becomes unassigned (in no part); the 1 reference listed under its '
        + 'heading goes with it, all still named by a step. No step is deleted.',
    )
    const loose = removalOf({ steps: [step('A', ['gh#1'], 'x'), step('B', [], 'x')], groups: [{ heading: 'X', refs: ['gh#1', 'gh#7', 'gh#8'] }] }, 'x')!
    expect(loose).toEqual({ heading: 'X', steps: [1, 2], refs: ['gh#1', 'gh#7', 'gh#8'], loose: ['gh#7', 'gh#8'] })
    expect(removalSaid(loose)).toContain('Its 2 steps stay in the journey and become unassigned')
    expect(removalSaid(loose)).toContain('2 of them are named by no step')
    expect(removalOf(awkward(), 'nope')).toBeNull()
  })

  test('removing a part deletes no step, unassigns its own, and renames no other part', () => {
    const before = awkward()
    /* Out of the middle: the group whose removal would turn `part-3` into `part-2`
       and `later-2` into `later`. */
    const out = withoutPart(before, 'later')
    if (!out.ok) throw new Error(out.error)
    expect(out.record.steps).toHaveLength(before.steps.length)
    expect(out.record.steps.map((one) => one.title)).toEqual(before.steps.map((one) => one.title))
    expect(seen(out.record)).toEqual(seen(before).filter((part) => part.id !== 'later'))
    /* Five is still in `part-3` and Seven still in `later-2`. */
    expect(partsOf(out.record).map((part) => [part.id, part.steps])).toEqual([
      ['the-agent-seam', 0],
      ['part-3', 1],
      ['later-2', 1],
      ['kept-by-hand', 0],
      ['part-6', 0],
    ])

    const emptied = withoutPart(before, 'part-3')
    if (!emptied.ok) throw new Error(emptied.error)
    expect(Object.hasOwn(emptied.record.steps[4]!, 'part')).toBe(false)
    expect(emptied.record.steps[4]!.title).toBe('Five')
    expect(emptied.gone.steps).toEqual([5])
  })
})

describe('the files a part owns', () => {
  test('are kept in the protocol’s form, once each, and only what cannot change the file is tidied', () => {
    expect(filesGiven([' chapters/design.tex ', './chapters/protocol.tex', 'chapters/design.tex', 'main.tex'])).toEqual({
      ok: true,
      files: ['chapters/design.tex', 'chapters/protocol.tex', 'main.tex'],
    })
    expect(filesGiven([])).toEqual({ ok: true, files: [] })
  })

  test('one name that is not a file’s refuses the whole list, and is named', () => {
    for (const bad of ['../other/main.tex', '/Users/somebody/paper/main.tex', 'chapters\\design.tex', 'a//b.tex', 'C:paper.tex', '   ']) {
      const out = filesGiven(['chapters/design.tex', bad])
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toContain(`"${bad}" is not a name a part can hold for a file`)
        expect(out.error).toContain('chapters/design.tex')
        expect(out.error).toContain('Nothing was changed.')
      }
    }
    const notText = filesGiven(['chapters/design.tex', 42])
    expect(!notText.ok && notText.error).toContain('42 is not a name')
    const notAList = filesGiven('chapters/design.tex')
    expect(!notAList.ok && notAList.error).toContain('are a list of names')
  })

  test('more than a host will send is refused, not cut', () => {
    const many = Array.from({ length: LIMITS.PART_FILES + 1 }, (_, i) => `chapters/${i}.tex`)
    const out = filesGiven(many)
    expect(!out.ok && out.error).toContain(`at most ${LIMITS.PART_FILES} files, and that was ${LIMITS.PART_FILES + 1}`)
    expect(filesGiven(many.slice(1)).ok).toBe(true)
    /* The same name thirty-three times is one file. */
    expect(filesGiven(many.map(() => 'main.tex'))).toEqual({ ok: true, files: ['main.tex'] })
  })

  test('a list replaces, an empty list takes the key away, and absent leaves them alone', () => {
    const before = awkward()
    const given = withPart(before, { id: 'later', files: ['./chapters/later.tex'] })
    if (!given.ok) throw new Error(given.error)
    expect(given.record.groups[1]).toEqual({ heading: 'Later', refs: ['gh#3'], id: 'later', files: ['chapters/later.tex'] })
    expect(given.files).toEqual(['chapters/later.tex'])
    expect(partsOf(given.record)[1]?.files).toEqual(['chapters/later.tex'])
    /* Nothing else a reader sees moved, and no other group was given the key. */
    expect(seen(given.record)).toEqual(seen(before))
    expect(given.record.groups.filter((group) => 'files' in group)).toHaveLength(1)

    /* Absent: a rewording says nothing about files. */
    const reworded = withPart(given.record, { id: 'later', heading: 'Afterwards' })
    if (!reworded.ok) throw new Error(reworded.error)
    expect(reworded.record.groups[1]).toMatchObject({ heading: 'Afterwards', files: ['chapters/later.tex'] })
    expect(reworded.files).toBeNull()

    const replaced = withPart(reworded.record, { id: 'later', files: ['main.tex', 'chapters/b.tex'] })
    if (!replaced.ok) throw new Error(replaced.error)
    expect(replaced.record.groups[1]?.files).toEqual(['main.tex', 'chapters/b.tex'])
    /* And the heading it had is the heading it has: files are not a rewording. */
    expect(replaced.record.groups[1]?.heading).toBe('Afterwards')

    const emptied = withPart(replaced.record, { id: 'later', files: [] })
    if (!emptied.ok) throw new Error(emptied.error)
    expect(Object.hasOwn(emptied.record.groups[1]!, 'files')).toBe(false)
    expect('files' in partsOf(emptied.record)[1]!).toBe(false)
  })

  test('a refused file changes nothing, and a new part can be made with its files', () => {
    const before = awkward()
    const refused = withPart(before, { id: 'later', heading: 'Reworded as well', files: ['ok.tex', '../no.tex'] })
    expect(refused.ok).toBe(false)
    const made = withPart(before, { heading: 'The design', files: ['chapters/design.tex'] })
    if (!made.ok) throw new Error(made.error)
    expect(made.record.groups.at(-1)).toEqual({ heading: 'The design', refs: [], files: ['chapters/design.tex'], id: 'the-design' })
    /* A heading left out is only allowed for a part that already has one. */
    expect(withPart(before, { files: ['a.tex'] }).ok).toBe(false)
  })

  test('a group with no heading of its own keeps none when only its files are set', () => {
    const out = withPart(awkward(), { id: 'part-3', files: ['a.tex'] })
    if (!out.ok) throw new Error(out.error)
    expect(out.record.groups[2]).toEqual({ heading: '', refs: ['gh#4'], id: 'part-3', files: ['a.tex'] })
    expect(partIdsOf(out.record.groups)).toEqual(partIdsOf(awkward().groups))
  })

  test('what is said afterwards names the files, a file two parts own, and a name with no extension', () => {
    const record = {
      steps: [],
      groups: [
        { heading: 'The design', refs: [], files: ['chapters/design.tex', 'chapters/shared.tex'] },
        { heading: 'The protocol', refs: [], files: ['chapters/shared.tex', 'chapters/protocol'] },
        { heading: 'Empty', refs: [] },
      ],
    }
    expect(filesSaid(record, 'the-design')).toBe(
      'It owns 2 files of the paper, named from the paper’s folder: chapters/design.tex, chapters/shared.tex. '
        + 'chapters/shared.tex is also owned by “The protocol”: a file may be in more than one part, and is shown when '
        + 'any of them is picked.',
    )
    expect(filesSaid(record, 'the-protocol')).toContain('chapters/protocol has no extension.')
    expect(filesSaid(record, 'empty')).toBe('It owns no file of the paper.')
  })
})

/* ------------------------------------------------------------------ *
 * The doors
 * ------------------------------------------------------------------ */

const MINE = moduleFolder(ID)
const made: string[] = []
afterAll(() => made.forEach((root) => rmSync(root, { recursive: true, force: true })))

const divided = {
  slug: 'divided',
  title: 'A divided journey',
  groups: [
    { heading: 'The agent seam', refs: ['gh#1', 'gh#2'] },
    { heading: 'What the page shows', refs: ['gh#3'], colour: 'teal' },
  ],
  steps: [
    { title: 'One', body: 'first', refs: ['gh#1'], notes: [] },
    { title: 'Two', body: '', refs: ['gh#3'], notes: [], part: 'what-the-page-shows' },
    { title: 'Three', body: '', refs: [], notes: [] },
  ],
}

/** A journey as the file holds it, loosely: these tests read fields this app does not name. */
interface OnDisk {
  steps: { title: string; body?: string; refs?: string[]; part?: string }[]
  groups: Record<string, unknown>[]
}

function project(journeys: Record<string, unknown> = { divided, plain: { slug: 'plain', title: 'Not divided', steps: [] } }) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-parts-'))
  made.push(root)
  mkdirSync(join(root, KEHIKOT_DIR, MINE), { recursive: true })
  const file = join(root, KEHIKOT_DIR, MINE, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys }, null, 2)}\n`)
  const on = (slug = 'divided') => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, OnDisk> }).journeys[slug]!
  const call = (name: string, args: Record<string, unknown>) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const post = (path: string, body: Record<string, unknown>) =>
    answer('POST', path, new URLSearchParams(), { ...body, project: root }, writeTicketFor(root))
  return { root, file, on, call, post }
}

describe('`part` on set_step', () => {
  const whole = { slug: 'divided', position: 1, title: 'One', body: 'first, reworded', refs: ['gh#1'], notes: [] }

  test('files the step, and writes the derived id onto the group in the same save', () => {
    const { on, call } = project()
    const before = partsOf(on())
    expect(call('set_step', { ...whole, part: 'the-agent-seam' })).toContain('Set step 1 of divided')
    expect(on().steps[0]!.part).toBe('the-agent-seam')
    expect(on().groups[0]).toEqual({ heading: 'The agent seam', refs: ['gh#1', 'gh#2'], id: 'the-agent-seam' })
    /* The group nobody filed under was not written on, and kept what this app does not name. */
    expect(on().groups[1]).toEqual({ heading: 'What the page shows', refs: ['gh#3'], colour: 'teal' })
    /* Nothing a reader sees moved: same ids, headings and references. */
    expect(partsOf(on()).map(({ steps: _n, ...rest }) => rest)).toEqual(before.map(({ steps: _n, ...rest }) => rest))
  })

  test('left out, it leaves the step in the part it was in — an agent editing a body does not unassign it', () => {
    const { on, call } = project()
    call('set_step', { slug: 'divided', position: 2, title: 'Two', body: 'corrected', refs: ['gh#3'], notes: [] })
    expect(on().steps[1]).toMatchObject({ body: 'corrected', part: 'what-the-page-shows' })
  })

  test('an explicit empty value takes the step out of every part', () => {
    const { on, call } = project()
    call('set_step', { slug: 'divided', position: 2, title: 'Two', refs: ['gh#3'], part: '' })
    expect(Object.hasOwn(on().steps[1]!, 'part')).toBe(false)
  })

  test('an unknown id is refused with the valid ones, and nothing is written', () => {
    const { file, call } = project()
    const before = readFileSync(file, 'utf8')
    const said = call('set_step', { ...whole, part: 'the-agent-seem' })
    expect(said).toContain('"the-agent-seem" is not a part of this journey. Its parts are: the-agent-seam (“The agent seam”), what-the-page-shows (“What the page shows”).')
    expect(said).toContain('The step was not written.')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('the tool says the field exists and where its ids come from', () => {
    const tools = (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)?.body as {
        result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[] }
      }
    ).result.tools
    const names = tools.map((tool) => tool.name)
    for (const name of ['assign_steps', 'set_part', 'remove_part']) expect(names).toContain(name)
    const setStep = tools.find((tool) => tool.name === 'set_step')!
    expect(Object.keys(setStep.inputSchema.properties)).toContain('part')
    expect(setStep.description).toContain('get_journey')
    expect(setStep.description).toContain('NOT cleared by leaving it out')
  })

  test('the page’s door takes the same three values', () => {
    const { on, post } = project()
    expect(post('/api/step', { ...whole, part: 'the-agent-seam' })?.status).toBe(200)
    expect(on().steps[0]!.part).toBe('the-agent-seam')
    /* Absent: kept. */
    post('/api/step', whole)
    expect(on().steps[0]!.part).toBe('the-agent-seam')
    /* Null, which is what JSON sends for "none": cleared. */
    post('/api/step', { ...whole, part: null })
    expect(Object.hasOwn(on().steps[0]!, 'part')).toBe(false)
    const refused = post('/api/step', { ...whole, part: 'nope' })
    expect(refused?.status).toBe(400)
    expect((refused?.body as { error: string }).error).toContain('Its parts are: the-agent-seam')
  })
})

describe('get_journey says the parts', () => {
  test('each part’s id, what is in it, and which steps are in none', () => {
    const { call } = project()
    const said = call('get_journey', { slug: 'divided' })
    expect(said).toContain('the-agent-seam\t“The agent seam”\t2 refs\tno steps')
    expect(said).toContain('what-the-page-shows\t“What the page shows”\t1 ref\tsteps 2')
    expect(said).toContain('IN NO PART: 2 steps of 3 — 1, 3')
    /* The document is still there, whole, after the lines. */
    expect(JSON.parse(said.slice(said.indexOf('{'))).steps[1].part).toBe('what-the-page-shows')
  })

  test('and nothing at all about parts for a journey that has none', () => {
    const { call } = project()
    expect(call('get_journey', { slug: 'plain' }).startsWith('{')).toBe(true)
  })
})

describe('assign_steps', () => {
  test('files several steps at once and rewrites none of them', () => {
    const { on, call } = project()
    expect(call('assign_steps', { slug: 'divided', part: 'the-agent-seam', positions: [1, 3] })).toBe(
      'Put 2 steps in “The agent seam” (the-agent-seam). Every step is in a part.',
    )
    expect(on().steps.map((one) => one.part)).toEqual(['the-agent-seam', 'what-the-page-shows', 'the-agent-seam'])
    expect(on().steps[0]).toMatchObject({ title: 'One', body: 'first', refs: ['gh#1'] })
    expect(on().groups[0]!).toMatchObject({ id: 'the-agent-seam' })
  })

  test('an empty part takes them out, and says how many are left in none', () => {
    const { on, call } = project()
    expect(call('assign_steps', { slug: 'divided', part: '', positions: [2] })).toBe(
      'Took 1 step out of every part. 3 steps of 3 still in no part.',
    )
    expect(on().steps.some((one) => 'part' in one)).toBe(false)
  })

  test('refuses an unknown part, a position that is not a step, and a journey with no parts', () => {
    const { file, call } = project()
    const before = readFileSync(file, 'utf8')
    expect(call('assign_steps', { slug: 'divided', part: 'nope', positions: [1] })).toContain('Its parts are')
    expect(call('assign_steps', { slug: 'divided', part: 'the-agent-seam', positions: [1, 9] })).toContain('9 is not among them')
    expect(call('assign_steps', { slug: 'plain', part: 'anything', positions: [1] })).toContain('not divided into parts at all')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('the page’s door is the same function, behind the ticket', () => {
    const { root, on, post } = project()
    const reply = post('/api/assign', { slug: 'divided', positions: [1], part: 'the-agent-seam' })
    expect(reply?.status).toBe(200)
    expect((reply?.body as { said: string }).said).toContain('Put 1 step in “The agent seam”')
    expect(on().steps[0]!.part).toBe('the-agent-seam')
    const blind = answer('POST', '/api/assign', new URLSearchParams(), { project: root, slug: 'divided', positions: [3], part: 'the-agent-seam' }, 'guessed')
    expect(blind?.status).toBe(403)
    expect(on().steps[2]!.part).toBeUndefined()
  })
})

describe('set_part and remove_part', () => {
  test('makes a part in a journey that had none, and answers with its id', () => {
    const { on, call } = project()
    expect(call('set_part', { slug: 'plain', heading: 'Reading the trackers' })).toBe(
      'Made the part “Reading the trackers”, with the id reading-the-trackers. No step is in it yet: file steps under that id.',
    )
    expect(on('plain').groups).toEqual([{ heading: 'Reading the trackers', refs: [], id: 'reading-the-trackers' }])
  })

  test('rewords a part without moving its id, so the steps in it stay in it', () => {
    const { on, call } = project()
    expect(call('set_part', { slug: 'divided', id: 'what-the-page-shows', heading: 'What a person sees' })).toContain(
      '“What the page shows” is now called “What a person sees”. Its id is still what-the-page-shows',
    )
    expect(on().groups[1]).toEqual({ heading: 'What a person sees', refs: ['gh#3'], colour: 'teal', id: 'what-the-page-shows' })
    expect(partsOf(on())[1]).toMatchObject({ id: 'what-the-page-shows', heading: 'What a person sees', steps: 1 })
  })

  test('removes a part, keeps every step, and says what went', () => {
    const { on, call } = project()
    const said = call('remove_part', { slug: 'divided', id: 'what-the-page-shows' })
    expect(said).toBe(
      'Removed the part “What the page shows” (what-the-page-shows). Its 1 step stays in the journey and becomes '
        + 'unassigned (in no part); the 1 reference listed under its heading goes with it, all still named by a step. '
        + 'No step is deleted.',
    )
    expect(on().steps.map((one) => one.title)).toEqual(['One', 'Two', 'Three'])
    expect(on().steps.some((one) => 'part' in one)).toBe(false)
    expect(partsOf(on()).map((part) => part.id)).toEqual(['the-agent-seam'])
  })

  test('each refuses what it cannot do, in words, and writes nothing', () => {
    const { file, call, post } = project()
    const before = readFileSync(file, 'utf8')
    expect(call('set_part', { slug: 'divided', heading: 'The agent seam' })).toContain('already has a part called')
    expect(call('set_part', { slug: 'divided', id: 'nope', heading: 'Anything' })).toContain('Its parts are')
    expect(call('remove_part', { slug: 'divided', id: 'nope' })).toContain('Its parts are')
    expect(call('set_part', { slug: 'no-such-journey', heading: 'Anything' })).toContain('does not hold a journey')
    expect(post('/api/part', { slug: 'divided', heading: '' })?.status).toBe(400)
    expect(post('/api/part/remove', { slug: 'no-such-journey', id: 'x' })?.status).toBe(404)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('the page’s doors answer with the journey and the sentence', () => {
    const { post } = project()
    const made = post('/api/part', { slug: 'divided', heading: 'Later' })?.body as { id: string; said: string; journey: { groups: unknown[] } }
    expect(made.id).toBe('later')
    expect(made.journey.groups).toHaveLength(3)
    const gone = post('/api/part/remove', { slug: 'divided', id: 'later' })?.body as { said: string; journey: { groups: unknown[] } }
    expect(gone.said).toContain('No step is in it; it lists no references. No step is deleted.')
    expect(gone.journey.groups).toHaveLength(2)
  })
})

describe('a part’s files, through both doors', () => {
  test('set_part writes the tidied names onto the group and says them back', () => {
    const { on, call } = project()
    expect(call('set_part', { slug: 'divided', id: 'the-agent-seam', files: ['./chapters/seam.tex', ' chapters/agents.tex '] })).toBe(
      'Kept “The agent seam” (the-agent-seam). It owns 2 files of the paper, named from the paper’s folder: '
        + 'chapters/seam.tex, chapters/agents.tex.',
    )
    expect(on().groups[0]).toEqual({ heading: 'The agent seam', refs: ['gh#1', 'gh#2'], id: 'the-agent-seam', files: ['chapters/seam.tex', 'chapters/agents.tex'] })
    /* The other group, and what it carries that this app does not name, untouched. */
    expect(on().groups[1]).toEqual({ heading: 'What the page shows', refs: ['gh#3'], colour: 'teal' })
  })

  test('absent leaves them, a rename leaves them, and an empty list removes the key', () => {
    const { on, call } = project()
    call('set_part', { slug: 'divided', id: 'the-agent-seam', files: ['chapters/seam.tex'] })
    call('set_part', { slug: 'divided', id: 'the-agent-seam', heading: 'The seam', refs: ['gh#1'] })
    expect(on().groups[0]).toMatchObject({ heading: 'The seam', refs: ['gh#1'], files: ['chapters/seam.tex'] })
    expect(call('set_part', { slug: 'divided', id: 'the-agent-seam', files: [] })).toBe('Kept “The seam” (the-agent-seam). It owns no file of the paper.')
    expect(Object.hasOwn(on().groups[0]!, 'files')).toBe(false)
  })

  test('a name that is not a file’s is refused by name, and the file is as it was', () => {
    const { file, call, post } = project()
    const before = readFileSync(file, 'utf8')
    const said = call('set_part', { slug: 'divided', id: 'the-agent-seam', files: ['chapters/seam.tex', '../../etc/passwd'] })
    expect(said).toContain('"../../etc/passwd" is not a name a part can hold for a file')
    expect(call('set_part', { slug: 'divided', id: 'the-agent-seam', files: 'chapters/seam.tex' })).toContain('are a list of names')
    const refused = post('/api/part', { slug: 'divided', id: 'the-agent-seam', files: ['/abs/olute.tex'] })
    expect(refused?.status).toBe(400)
    expect((refused?.body as { error: string }).error).toContain('"/abs/olute.tex" is not a name')
    const many = Array.from({ length: LIMITS.PART_FILES + 1 }, (_, i) => `c/${i}.tex`)
    expect(call('set_part', { slug: 'divided', id: 'the-agent-seam', files: many })).toContain(`at most ${LIMITS.PART_FILES} files`)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('the page’s door takes the list without a heading and answers with what was kept', () => {
    const { on, post } = project()
    const reply = post('/api/part', { slug: 'divided', id: 'what-the-page-shows', files: ['./chapters/page.tex'] })
    expect(reply?.status).toBe(200)
    const body = reply?.body as { said: string; journey: { groups: { files?: string[]; heading: string }[] } }
    expect(body.journey.groups[1]).toMatchObject({ heading: 'What the page shows', files: ['chapters/page.tex'] })
    expect(body.said).toContain('chapters/page.tex')
    expect(on().groups[1]).toEqual({ heading: 'What the page shows', refs: ['gh#3'], colour: 'teal', id: 'what-the-page-shows', files: ['chapters/page.tex'] })
    /* `null` is JSON's "not given", and leaves them. */
    post('/api/part', { slug: 'divided', id: 'what-the-page-shows', heading: 'Seen', files: null })
    expect(on().groups[1]).toMatchObject({ heading: 'Seen', files: ['chapters/page.tex'] })
  })

  test('a file two parts own is allowed, and said', () => {
    const { on, call } = project()
    call('set_part', { slug: 'divided', id: 'the-agent-seam', files: ['chapters/shared.tex'] })
    const said = call('set_part', { slug: 'divided', id: 'what-the-page-shows', files: ['chapters/shared.tex'] })
    expect(said).toContain('chapters/shared.tex is also owned by “The agent seam”')
    expect(on().groups.map((group) => group.files)).toEqual([['chapters/shared.tex'], ['chapters/shared.tex']])
  })

  test('get_journey prints each part’s files, and says where the names are counted from', () => {
    const { call } = project()
    expect(call('get_journey', { slug: 'divided' })).toContain('No part names a file of the paper yet')
    call('set_part', { slug: 'divided', id: 'what-the-page-shows', files: ['chapters/page.tex', 'figures/page.tex'] })
    const said = call('get_journey', { slug: 'divided' })
    expect(said).toContain('what-the-page-shows\t“What the page shows”\t1 ref\tsteps 2\tfiles chapters/page.tex, figures/page.tex')
    /* A part with none prints the four columns it always printed. */
    expect(said).toContain('the-agent-seam\t“The agent seam”\t2 refs\tno steps\n')
    expect(said).toContain('(.kehikot/paper/divided/)')
  })

  test('the tool says the field, its form and an example', () => {
    const tools = (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)?.body as {
        result: { tools: { name: string; description: string; inputSchema: { required: string[]; properties: Record<string, unknown> } }[] }
      }
    ).result.tools
    const setPart = tools.find((tool) => tool.name === 'set_part')!
    expect(Object.keys(setPart.inputSchema.properties)).toContain('files')
    expect(setPart.description).toContain('chapters/design.tex')
    expect(setPart.description).toContain('relative to the paper’s folder')
    expect(setPart.inputSchema.required).toEqual(['project', 'slug'])
  })
})

describe('the first step of a journey that has none', () => {
  test('is a write to position one, which the page can now make', () => {
    const { on, post } = project()
    expect(post('/api/step', { slug: 'plain', position: 1, title: 'The first thing', body: '', refs: [], notes: [] })?.status).toBe(200)
    expect(on('plain').steps.map((one) => one.title)).toEqual(['The first thing'])
  })
})
