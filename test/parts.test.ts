import { describe, expect, test } from 'bun:test'
import { LIMITS, journeyRecordSchema, partsOf, stepPart } from 'kehikot-module-protocol'

import {
  fileGiven,
  fileOf,
  idFor,
  isSimple,
  mirrored,
  nameOf,
  named,
  simplified,
  withPart,
  withStep,
  withoutStep,
  type Divided,
} from '../parts.ts'

/**
 * One step to a part: the migration that reads the older shape as that, and
 * the arithmetic that keeps a record so.
 *
 * `partsOf` below is the protocol's, which is the function a host's reader
 * IS (`src/host/parts.ts` re-exports it, in the released app and on main
 * alike). So "what a host shows" is asserted by calling it, on the record as
 * `journeyRecordSchema` — the host's parse — hands it over.
 */

/** What a host's picker lists for a record: id, name, document, and how many steps it counts in. */
const picker = (record: unknown) =>
  partsOf(journeyRecordSchema.parse({ slug: 'x', title: 'X', ...(record as object) })).map((part) => ({
    id: part.id,
    heading: part.heading,
    file: (part.files ?? [])[0] ?? null,
    files: part.files?.length ?? 0,
    steps: part.steps,
  }))

/** `simplified`, over a record typed as loosely as the files it reads are. */
const simple = (record: unknown, options?: Parameters<typeof simplified>[1]) => simplified(record as Divided, options)

const step = (title: string, part?: string, refs: string[] = []) => ({ title, body: `About ${title}.`, refs, notes: [], ...(part ? { part } : {}) })

/* ------------------------------------------------------------------ *
 * The two real journeys
 * ------------------------------------------------------------------ */

/**
 * The `thesis` epic of the CS-DEGREE project, as it is on disk: seven parts,
 * six of them with one step and one chapter, and `appendices` with a chapter
 * and no step. The titles are the real ones; the bodies are shortened.
 */
const THESIS = {
  steps: [
    step('A reader knows why chat-as-an-exercise is worth studying, and what is being asked', 'introduction'),
    step('A reader can see the gap this study fills, and the frame it will be read through', 'literature-review'),
    step('A reader could repeat the study, and knows what each research question was measured with', 'methods'),
    step('A reader sees what happened, separately from what it is taken to mean', 'results'),
    step('A reader understands what the results mean, and how far they can be carried', 'discussion'),
    step('A reader leaves with the claim, the answers, and what should be done next', 'conclusion'),
  ],
  groups: [
    { id: 'introduction', heading: 'Introduction', refs: [], files: ['chapters/1_introduction.tex'] },
    { id: 'literature-review', heading: 'Literature Review', refs: [], files: ['chapters/2_literature_review.tex'] },
    { id: 'methods', heading: 'Methods', refs: [], files: ['chapters/3_methods.tex'] },
    { id: 'results', heading: 'Results', refs: [], files: ['chapters/4_results.tex'] },
    { id: 'discussion', heading: 'Discussion', refs: [], files: ['chapters/5_discussion.tex'] },
    { id: 'conclusion', heading: 'Conclusion', refs: [], files: ['chapters/6_conclusion.tex'] },
    { id: 'appendices', heading: 'Appendices', refs: [], files: ['chapters/appendix_instruments.tex'] },
  ],
}

/**
 * The `sharing-and-collaboration` epic, built from its owner's description —
 * the project was not on this disk: eight parts; one with no step; two that
 * cover the same file, `chapters/refresh.tex`; the others one step and one
 * file each. The names are stand-ins.
 */
const SHARING = {
  steps: [
    step('Two people can open the same canvas', 'peer-share', ['gh#1']),
    step('A secret never leaves the machine it was typed on', 'secrets-never-leak', ['gh#2']),
    step('An invitation can be taken back', 'invitations'),
    step('A stale page says it is stale', 'refresh'),
    step('A refresh keeps what was being typed', 'refresh-keeps-typing'),
    step('Who changed what can be read afterwards', 'history'),
    step('A conflict is shown, not resolved in silence', 'conflicts'),
  ],
  groups: [
    { id: 'peer-share', heading: 'Peer share', refs: [], files: ['chapters/peer-share.tex'] },
    { id: 'secrets-never-leak', heading: 'Secrets never leak', refs: [], files: ['chapters/secrets.tex'] },
    { id: 'invitations', heading: 'Invitations', refs: [], files: ['chapters/invitations.tex'] },
    { id: 'refresh', heading: 'Refresh', refs: [], files: ['chapters/refresh.tex'] },
    { id: 'refresh-keeps-typing', heading: 'Refresh keeps typing', refs: [], files: ['chapters/refresh.tex'] },
    { id: 'history', heading: 'History', refs: [], files: ['chapters/history.tex'] },
    { id: 'conflicts', heading: 'Conflicts', refs: [], files: ['chapters/conflicts.tex'] },
    { id: 'offline', heading: 'Offline', refs: [] },
  ],
}

describe('the thesis, as it is on disk', () => {
  const out = simple(THESIS)

  test('a host’s picker lists the same seven parts before and after, by id, name and chapter', () => {
    const before = picker(THESIS)
    const after = picker(out.record)
    expect(after.map(({ id, heading, file }) => ({ id, heading, file }))).toEqual(before.map(({ id, heading, file }) => ({ id, heading, file })))
    expect(after.map((part) => part.id)).toEqual(['introduction', 'literature-review', 'methods', 'results', 'discussion', 'conclusion', 'appendices'])
  })

  test('six steps become seven: the part that had none has one made for it, last, where it was', () => {
    expect(out.changed).toBe(true)
    expect(out.record.steps).toHaveLength(7)
    expect(out.record.steps.slice(0, 6)).toEqual(THESIS.steps)
    expect(out.record.steps[6]).toEqual({ title: 'Appendices', body: '', refs: [], notes: [], part: 'appendices' })
    expect(picker(out.record).every((part) => part.steps === 1)).toBe(true)
  })

  test('each of the six keeps its part whole, and the short name is the part’s', () => {
    out.record.steps.slice(0, 6).forEach((one, i) => {
      expect(stepPart(one)).toBe(THESIS.groups[i]!.id)
      expect(nameOf(out.record, one)).toBe(THESIS.groups[i]!.heading)
      expect(named(out.record, one)).toBe(true)
      expect(fileOf(out.record, one)).toBe(THESIS.groups[i]!.files[0]!)
    })
  })

  test('says the one thing it decided, and loses no id', () => {
    expect(out.findings.map((one) => one.code)).toEqual(['made'])
    expect(out.findings[0]!.said).toContain('“Appendices” had no step. One was made for it')
    expect(out.findings[0]!.said).toContain('chapters/appendix_instruments.tex')
    expect(out.gone).toEqual([])
    expect(out.fates.map((fate) => [fate.was, fate.now, fate.how, fate.at, fate.file])).toEqual([
      ['introduction', 'introduction', 'kept', 1, 'chapters/1_introduction.tex'],
      ['literature-review', 'literature-review', 'kept', 2, 'chapters/2_literature_review.tex'],
      ['methods', 'methods', 'kept', 3, 'chapters/3_methods.tex'],
      ['results', 'results', 'kept', 4, 'chapters/4_results.tex'],
      ['discussion', 'discussion', 'kept', 5, 'chapters/5_discussion.tex'],
      ['conclusion', 'conclusion', 'kept', 6, 'chapters/6_conclusion.tex'],
      ['appendices', 'appendices', 'made', 7, 'chapters/appendix_instruments.tex'],
    ])
  })

  test('is simple afterwards, and reading it again changes nothing', () => {
    expect(isSimple(out.record)).toBe(true)
    const again = simple(out.record)
    expect(again.changed).toBe(false)
    expect(again.record).toBe(out.record)
    expect(mirrored(out.record)).toEqual(out.record)
  })
})

describe('sharing-and-collaboration, as its owner described it', () => {
  const out = simple(SHARING)

  test('all eight parts are still parts, under the ids they had', () => {
    expect(picker(out.record).map((part) => part.id)).toEqual(SHARING.groups.map((group) => group.id))
    expect(out.gone).toEqual([])
    expect(out.record.steps).toHaveLength(8)
  })

  test('the file two parts covered is the first one’s, and that is said, not chosen in silence', () => {
    const parts = picker(out.record)
    expect(parts.find((part) => part.id === 'refresh')?.file).toBe('chapters/refresh.tex')
    expect(parts.find((part) => part.id === 'refresh-keeps-typing')?.file).toBeNull()
    const shared = out.findings.filter((one) => one.code === 'shared')
    expect(shared).toHaveLength(1)
    expect(shared[0]!.said).toBe(
      'chapters/refresh.tex was covered by two parts, “Refresh” and “Refresh keeps typing”. A document belongs to one part: '
        + 'the first keeps it, and “Refresh keeps typing” now covers none.',
    )
  })

  test('the part with no step has one made for it, and every other step is as it was', () => {
    expect(out.record.steps.slice(0, 7)).toEqual(SHARING.steps)
    expect(out.record.steps[7]).toEqual({ title: 'Offline', body: '', refs: [], notes: [], part: 'offline' })
    expect(out.findings.map((one) => one.code).sort()).toEqual(['made', 'shared'])
  })

  test('every other part keeps its one file', () => {
    const before = picker(SHARING)
    const after = picker(out.record)
    for (const part of before) {
      if (part.id === 'refresh-keeps-typing') continue
      expect(after.find((one) => one.id === part.id)?.file ?? null).toBe(part.file)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Every rule, alone
 * ------------------------------------------------------------------ */

describe('the rules, one at a time', () => {
  test('a part with one step: the step is the part’s, with its id, its name and its file', () => {
    const out = simple({ steps: [step('A long sentence about one thing', 'one')], groups: [{ id: 'one', heading: 'One', refs: [], files: ['a.tex'] }] })
    /* Already one step to a part: nothing to do, and the record is the one handed in. */
    expect(out.changed).toBe(false)
  })

  test('a part whose id was never written keeps the id it answered to', () => {
    const record = { steps: [step('First', 'the-agent-seam')], groups: [{ heading: 'The agent seam', refs: [] }] }
    const out = simple(record)
    expect(picker(out.record)).toEqual(picker(record))
    expect(out.record.groups[0]).toEqual({ heading: 'The agent seam', refs: [], id: 'the-agent-seam' })
    expect(out.findings).toEqual([])
  })

  test('a part with several steps: each is a part; the first keeps the id, the name and the file', () => {
    const out = simple({
      steps: [step('Alpha', 'methods'), step('Beta', 'methods'), step('Gamma', 'methods')],
      groups: [{ id: 'methods', heading: 'Methods', refs: [], files: ['chapters/3_methods.tex'] }],
    })
    expect(picker(out.record)).toEqual([
      { id: 'methods', heading: 'Methods', file: 'chapters/3_methods.tex', files: 1, steps: 1 },
      { id: 'beta', heading: 'Beta', file: null, files: 0, steps: 1 },
      { id: 'gamma', heading: 'Gamma', file: null, files: 0, steps: 1 },
    ])
    expect(out.findings.map((one) => one.code)).toEqual(['split'])
    expect(out.findings[0]!.said).toBe(
      '“Methods” held 3 steps, and a part has one. Step 1 keeps its id (methods), its name and chapters/3_methods.tex; '
        + 'the other 2 are parts of their own, called by their titles and covering no document: beta, gamma.',
    )
  })

  test('a part with no step: a step is made from it — its name, its file, its references — where it was in the order', () => {
    const out = simple({
      steps: [step('First', 'a'), step('Last', 'c')],
      groups: [
        { id: 'a', heading: 'A', refs: [] },
        { id: 'b', heading: 'B', refs: ['gh#9'], files: ['b.tex'] },
        { id: 'c', heading: 'C', refs: [] },
      ],
    })
    expect(out.record.steps.map((one) => one.title)).toEqual(['First', 'B', 'Last'])
    expect(out.record.steps[1]).toEqual({ title: 'B', body: '', refs: ['gh#9'], notes: [], part: 'b' })
    expect(picker(out.record).map((part) => [part.id, part.file])).toEqual([['a', null], ['b', 'b.tex'], ['c', null]])
  })

  test('…before the first step when it was the first part, and at the end when no part has a step', () => {
    const first = simple({ steps: [step('Only', 'b')], groups: [{ id: 'a', heading: 'A', refs: [] }, { id: 'b', heading: 'B', refs: [] }] })
    expect(first.record.steps.map((one) => one.part)).toEqual(['a', 'b'])
    const none = simple({ steps: [step('Loose')], groups: [{ id: 'a', heading: 'A', refs: [] }, { id: 'b', heading: 'B', refs: [] }] })
    expect(none.record.steps.map((one) => one.part)).toEqual(['loose', 'a', 'b'])
  })

  test('a step in no part is a part of its own, with no file, called by its title', () => {
    const out = simple({ steps: [step('Filed', 'a'), step('Never filed anywhere')], groups: [{ id: 'a', heading: 'A', refs: [] }] })
    expect(picker(out.record)[1]).toEqual({ id: 'never-filed-anywhere', heading: 'Never filed anywhere', file: null, files: 0, steps: 1 })
    expect(named(out.record, out.record.steps[1]!)).toBe(false)
    expect(out.findings.map((one) => one.code)).toEqual(['unfiled'])
  })

  test('…and so is a step naming a part the journey does not have', () => {
    const out = simple({ steps: [step('Stranded', 'gone')], groups: [] as { id: string }[] })
    expect(out.record.steps[0]!.part).toBe('stranded')
    expect(out.record.groups).toEqual([{ heading: 'Stranded', refs: [], id: 'stranded' }] as never)
  })

  test('a made id is never one the journey already answered to', () => {
    const out = simple({
      steps: [step('Results', 'a'), step('Results')],
      groups: [{ id: 'a', heading: 'A', refs: [] }, { id: 'results', heading: 'Results', refs: [], files: ['r.tex'] }],
    })
    /* `results` is the part with no step; the unfiled step called Results is not mistaken for it. */
    expect(out.record.steps.map((one) => one.part)).toEqual(['a', 'results', 'results-2'])
    expect(fileOf(out.record, out.record.steps[1]!)).toBe('r.tex')
    expect(out.record.steps[2]!.body).toBe('About Results.')
  })

  test('a part covering several files keeps the first, and the rest are named', () => {
    const out = simple({
      steps: [step('Results', 'results')],
      groups: [{ id: 'results', heading: 'Results', refs: [], files: ['chapters/4_results.tex', 'generated/tab.tex', 'generated/quotes.tex'] }],
    })
    expect(out.record.groups[0]!.files).toEqual(['chapters/4_results.tex'])
    expect(out.findings).toEqual([
      {
        code: 'extra',
        said:
          '“Results” covered 3 documents and a part covers one: it keeps chapters/4_results.tex, and generated/tab.tex, '
          + 'generated/quotes.tex are no longer a part’s.',
      },
    ])
  })

  test('a part whose first file an earlier part took keeps the next one it has', () => {
    const out = simple({
      steps: [step('A', 'a'), step('B', 'b')],
      groups: [{ id: 'a', heading: 'A', refs: [], files: ['shared.tex'] }, { id: 'b', heading: 'B', refs: [], files: ['shared.tex', 'own.tex'] }],
    })
    expect(picker(out.record).map((part) => part.file)).toEqual(['shared.tex', 'own.tex'])
    expect(out.findings.map((one) => one.code)).toEqual(['shared'])
    expect(out.findings[0]!.said).toContain('“B” covers own.tex')
  })

  test('references listed under a part’s heading and not on its step are put on the step', () => {
    const out = simple({ steps: [step('One', 'a', ['gh#1'])], groups: [{ id: 'a', heading: 'A', refs: ['gh#1', 'gh#2', 'gh#3'] }] })
    expect(out.record.steps[0]!.refs).toEqual(['gh#1', 'gh#2', 'gh#3'])
    expect(out.record.groups[0]!.refs).toEqual([])
    /* What a host lists under the part is what it listed before. */
    expect(partsOf(out.record)[0]!.refs).toEqual(['gh#1', 'gh#2', 'gh#3'])
    expect(out.findings.map((one) => one.code)).toEqual(['refs'])
  })

  test('the parts come out in the steps’ order, and it is said when that is not the order they were listed in', () => {
    const out = simple({
      steps: [step('First', 'b'), step('Second', 'a')],
      groups: [{ id: 'a', heading: 'A', refs: [] }, { id: 'b', heading: 'B', refs: [] }],
    })
    expect(out.record.groups.map((group) => group.id)).toEqual(['b', 'a'])
    expect(out.findings).toEqual([{ code: 'order', said: 'The parts are in the steps’ order now, which is not the order they were listed in: b, a.' }])
  })

  test('what a part or a step carried that nobody here knows is still on it', () => {
    const out = simple({
      steps: [{ ...step('One', 'a'), estimate: { days: 2 } }, { ...step('Two'), colour: 'teal' }],
      groups: [{ id: 'a', heading: 'A', refs: [], collapsed: true }],
    })
    expect(out.record.steps[0]).toMatchObject({ estimate: { days: 2 } })
    expect(out.record.steps[1]).toMatchObject({ colour: 'teal' })
    expect(out.record.groups[0]).toMatchObject({ collapsed: true })
  })

  test('more steps than a host lists parts: every one is kept, and it is said', () => {
    const steps = Array.from({ length: LIMITS.PARTS + 6 }, (_, i) => step(`Step number ${i + 1}`))
    const out = simple({ steps, groups: [] as { id: string }[] })
    expect(out.record.steps).toHaveLength(LIMITS.PARTS + 6)
    expect(picker(out.record)).toHaveLength(LIMITS.PARTS)
    expect(out.findings.find((one) => one.code === 'beyond')?.said).toContain(`steps ${LIMITS.PARTS + 1} to ${LIMITS.PARTS + 6} cannot be picked there`)
  })
})

/* ------------------------------------------------------------------ *
 * Headings that were never parts
 * ------------------------------------------------------------------ */

describe('a heading with references under it, from before parts', () => {
  /* The shape of every journey this app ships, and of the ones in the
     projects it was first used on: headings nobody wrote an id on, covering
     no file, with no step filed under them. */
  const legacy = {
    steps: [step('The one path that writes in public has a gate on it', undefined, ['gh#1']), step('The claim ledger is safe to be wrong about', undefined, ['gh#3'])],
    groups: [{ heading: 'The posting seam', refs: ['gh#1', 'gh#3', 'gh#2'] }, { heading: 'The agent seam', refs: ['gh#4'] }],
    stepsFrom: undefined,
  }

  test('is not made a step: the journey keeps the steps it has, each one a part', () => {
    const out = simple(legacy)
    expect(out.record.steps.map((one) => one.title)).toEqual(legacy.steps.map((one) => one.title))
    expect(picker(out.record).map((part) => part.heading)).toEqual(legacy.steps.map((one) => one.title))
  })

  test('is kept in the record, references and all, under `headings`', () => {
    const out = simple(legacy)
    expect(out.record.headings).toEqual(legacy.groups)
    expect(out.gone).toEqual(['the-posting-seam', 'the-agent-seam'])
    expect(out.findings.map((one) => one.code)).toEqual(['unfiled', 'aside'])
    expect(out.findings[1]!.said).toContain('“The posting seam”, “The agent seam” were headings')
    expect(out.fates.map((fate) => [fate.was, fate.now, fate.how])).toEqual([
      ['the-posting-seam', null, 'aside'],
      ['the-agent-seam', null, 'aside'],
    ])
  })

  test('and is added to the ones already set aside, never over them', () => {
    const once = simple(legacy).record
    const again = simple({ ...once, groups: [...once.groups, { heading: 'A third', refs: ['gh#7'] }] })
    expect((again.record.headings as { heading: string }[]).map((one) => one.heading)).toEqual(['The posting seam', 'The agent seam', 'A third'])
  })

  test('with the other choice, it is made a step like any part with none', () => {
    const out = simple(legacy, { headings: 'steps' })
    expect(out.record.steps).toHaveLength(4)
    expect(out.record.headings).toBeUndefined()
    expect(out.gone).toEqual([])
  })

  test('a heading somebody MADE a part — an id written on it, or a file — is a part, step or no step', () => {
    const out = simple({ steps: [step('One')], groups: [{ id: 'future-work', heading: 'Future work', refs: [] }, { heading: 'Appendix', refs: [], files: ['x.tex'] }] })
    expect(out.record.steps.map((one) => one.part)).toEqual(['one', 'future-work', 'appendix'])
    expect(out.record.headings).toBeUndefined()
  })

  test('a journey whose steps are kept elsewhere is given no step: its headings are set aside', () => {
    const out = simple({ steps: [], stepsFrom: { projector: 'paper', where: 'paper/x.tex' }, groups: [{ id: 'a', heading: 'A', refs: ['gh#1'], files: ['a.tex'] }] })
    expect(out.record.steps).toEqual([])
    expect(out.record.groups).toEqual([])
    expect(out.record.headings).toEqual([{ id: 'a', heading: 'A', refs: ['gh#1'], files: ['a.tex'] }])
    expect(out.findings.map((one) => one.code)).toEqual(['elsewhere'])
  })

  test('a journey with no steps and no parts is simple as it is', () => {
    expect(simple({ steps: [], groups: [] }).changed).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Keeping a record simple
 * ------------------------------------------------------------------ */

const EMPTY: Divided = { steps: [], groups: [] }

describe('writing a record that is one step to a part', () => {
  const base = simple(THESIS).record

  test('a step added is given its part: an id from its title, called by its title, covering nothing', () => {
    const out = withStep(base, base.steps.length, step('A reader can check the instruments'))
    expect(out.steps).toHaveLength(8)
    expect(out.groups[7]).toEqual({ heading: 'A reader can check the instruments', refs: [], id: 'a-reader-can-check-the-instruments' })
    expect(isSimple(out)).toBe(true)
  })

  test('a long title makes a short id, cut at a word', () => {
    const id = idFor('A reader could repeat the study, and knows what each research question was measured with', [])
    expect(id).toBe('a-reader-could-repeat-the-study-and')
    expect(id.length).toBeLessThanOrEqual(40)
    expect(idFor('…', [], 4)).toBe('step-4')
    expect(idFor('Methods', ['methods', 'methods-2'])).toBe('methods-3')
  })

  test('a step replaced keeps its part — the id, the name somebody gave, the file', () => {
    const out = withStep(base, 2, { ...step('Reworded entirely') })
    expect(out.steps[2]!.part).toBe('methods')
    expect(out.groups[2]).toEqual(base.groups[2])
  })

  test('a name that was only ever the title follows the title', () => {
    const one = withStep(EMPTY, 0, step('First wording'))
    expect(one.groups[0]!.heading).toBe('First wording')
    const two = withStep(one, 0, step('Second wording'))
    expect(two.groups[0]).toEqual({ heading: 'Second wording', refs: [], id: 'first-wording' })
  })

  test('a step removed takes its part with it, and the others keep theirs', () => {
    const out = withoutStep(base, 2)
    expect(out.groups.map((group) => group.id)).toEqual(['introduction', 'literature-review', 'results', 'discussion', 'conclusion', 'appendices'])
    expect(isSimple(out)).toBe(true)
  })

  test('naming a part, and clearing the name back to the title', () => {
    const titled = withStep(EMPTY, 0, step('A long title for a step'))
    const namedOne = withPart(titled, 0, { name: '  Short  ' })
    expect(namedOne.ok && namedOne.record.groups[0]!.heading).toBe('Short')
    const cleared = namedOne.ok ? withPart(namedOne.record, 0, { name: '' }) : namedOne
    expect(cleared.ok && cleared.record.groups[0]!.heading).toBe('A long title for a step')
  })

  test('giving a part its file, taking it away, and leaving it alone', () => {
    const given = withPart(base, 6, { file: './chapters/b_appendix.tex' })
    expect(given.ok && given.record.groups[6]!.files).toEqual(['chapters/b_appendix.tex'])
    const none = withPart(base, 6, { file: '' })
    expect(none.ok && Object.hasOwn(none.record.groups[6]!, 'files')).toBe(false)
    const left = withPart(base, 6, { name: 'Appendix' })
    expect(left.ok && left.record.groups[6]!.files).toEqual(['chapters/appendix_instruments.tex'])
  })

  test('a file another step has is refused, naming the step — a file belongs to one part', () => {
    const out = withPart(base, 6, { file: 'chapters/3_methods.tex' })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('chapters/3_methods.tex is the document of step 3')
  })

  test('a name that is not a file’s is refused, by name', () => {
    for (const bad of ['../outside.tex', '/abs/path.tex', 'a//b.tex']) {
      const out = fileGiven(bad)
      expect(out.ok).toBe(false)
      expect(!out.ok && out.error).toContain(`"${bad}" is not a name a part can hold for a document`)
    }
    expect(fileGiven(null)).toEqual({ ok: true, file: null })
  })

  test('`mirrored` is not the migration: it keeps one group to a step and nothing else', () => {
    const out = mirrored({ steps: [step('One', 'a')], groups: [{ id: 'a', heading: 'A', refs: [] }, { id: 'b', heading: 'B', refs: [] }] })
    expect(out.groups.map((group) => group.id)).toEqual(['a'])
  })
})
