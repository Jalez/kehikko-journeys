import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, LIMITS, PAPER_MODULE, moduleFolder, partsOf, type JourneyPart } from 'kehikot-module-protocol'

import { chaptersOf, executed, fileOf, leftOutSaid, namedAfter, nothingSaid, pulledIn, titleOf, type ReadFile } from '../chapters.ts'
import { TICKET, answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import { chaptersIn, paperFolder, paperReader } from '../paper.ts'

/**
 * The parts a paper is already divided into.
 *
 * Two halves. The reading is pure — a function that answers a file's text is
 * all it is given — and is held here to each behaviour of the Paper module's
 * own walk that it has to agree with. The opening of files is a fence, and is
 * held to what it must not open. Then the two doors: the list a page and an
 * agent are shown, and the one write that makes what was listed.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/** A paper as a table of files, and the reader the pure half is handed. */
const reading = (files: Record<string, string>): ReadFile => (file) => (Object.hasOwn(files, file) ? (files[file] as string) : null)

/** The thesis this was written for, cut down to its skeleton: a preamble include, six chapters, an appendix. */
const THESIS: Record<string, string> = {
  'main.tex': [
    '\\documentclass{report}',
    '% drop the \\input{deleted} line as well',
    '\\input{annotations}',
    '\\begin{document}',
    '\\chapter*{Abstract}',
    '\\include{chapters/1_introduction}',
    '\\include{chapters/2_literature_review}',
    '\\include{chapters/4_results}',
    '\\printbibliography',
    '\\appendix',
    '\\include{chapters/appendix_instruments}',
    '\\end{document}',
    '\\include{chapters/after_the_end}',
  ].join('\n'),
  'annotations.tex': '\\newcommand{\\missing}[1]{#1}',
  'chapters/1_introduction.tex': '% why\n\\chapter{Introduction}\n\\label{ch:intro}\nText.',
  'chapters/2_literature_review.tex': '\\chapter[Literature]{Literature \\emph{Review}\\label{ch:lit}}\n\\section{Scope}',
  'chapters/4_results.tex': '\\chapter{Results}\n\\input{generated/tab_categories}\n\\input{generated/quotes}\n',
  'generated/tab_categories.tex': '\\begin{table}\\end{table}',
  'generated/quotes.tex': 'A quote.',
  'chapters/appendix_instruments.tex':
    '\\chapter{Instruments}\n\\input{generated/protocol}\n'
    + '\\IfFileExists{generated/recode_agreement.tex}{\\section{Stability}\\input{generated/recode_agreement}}{\\input{generated/fallback}}\n',
  'generated/protocol.tex': 'The protocol.',
  'generated/fallback.tex': 'Not yet recoded.',
  'chapters/after_the_end.tex': '\\chapter{Never printed}',
}

describe('what a source pulls in', () => {
  const none = () => false

  test('the three commands, in order, as written — and not \\includegraphics or \\includeonly', () => {
    const source = '\\input{a}\n\\includegraphics[width=1cm]{figures/x.pdf}\n\\include {b/c}\n\\includeonly{b/c}\n\\subfile{d.tex}'
    expect(pulledIn(source, none).map((one) => one.target)).toEqual(['a', 'b/c', 'd.tex'])
  })

  test('a comment is not executed, and an escaped percent sign is not a comment', () => {
    expect(pulledIn('% \\input{gone}\n100\\% \\input{kept}\n\\\\% \\input{also-gone}', none).map((one) => one.target)).toEqual(['kept'])
    expect(executed('a % b\nc')).toBe('a \nc\n')
  })

  test('a listing prints its content and pulls nothing in', () => {
    const source = '\\begin{verbatim}\n\\input{shown}\n\\end{verbatim}\n\\begin{lstlisting}\n\\include{shown-too}\n\\end{lstlisting}\n\\input{real}'
    expect(pulledIn(source, none).map((one) => one.target)).toEqual(['real'])
  })

  test('what comes before \\begin{document} is the preamble, and nothing after \\end{document} is read', () => {
    expect(pulledIn(THESIS['main.tex'] as string, none)).toEqual([
      { target: 'annotations', body: false },
      { target: 'chapters/1_introduction', body: true },
      { target: 'chapters/2_literature_review', body: true },
      { target: 'chapters/4_results', body: true },
      { target: 'chapters/appendix_instruments', body: true },
    ])
    /* A file with no \begin{document} is all body: a chapter pulling in a table. */
    expect(pulledIn('\\input{t}', none)).toEqual([{ target: 't', body: true }])
  })

  test('\\IfFileExists reads only the branch that applies', () => {
    const source = '\\IfFileExists{g/r.tex}{\\section{S}\\input{g/r}}{\\input{g/fallback}}\n\\input{after}'
    expect(pulledIn(source, (target) => target === 'g/r.tex').map((one) => one.target)).toEqual(['g/r', 'after'])
    expect(pulledIn(source, none).map((one) => one.target)).toEqual(['g/fallback', 'after'])
    /* The thesis's own spelling: an empty false branch. */
    expect(pulledIn('\\IfFileExists{g/r.tex}{\\input{g/r}}{}', none)).toEqual([])
    /* Not the three groups it needs: passed over, and the rest is read as it comes. */
    expect(pulledIn('\\IfFileExists{g/r.tex} \\input{x}', none).map((one) => one.target)).toEqual(['x'])
  })

  test('a brace that never closes stops the scan and invents nothing', () => {
    expect(pulledIn('\\input{a}\n\\input{b', none).map((one) => one.target)).toEqual(['a'])
  })
})

describe('what a file is called', () => {
  test('.tex is added where TeX adds it, and a name that leaves the paper is not a name', () => {
    expect(fileOf('chapters/1_introduction')).toBe('chapters/1_introduction.tex')
    expect(fileOf(' ./chapters/a.tex ')).toBe('chapters/a.tex')
    expect(fileOf('../../etc/passwd')).toBeNull()
    expect(fileOf('/etc/passwd')).toBeNull()
    expect(fileOf('')).toBeNull()
  })

  test('its first \\chapter or \\section, in plain words', () => {
    expect(titleOf(THESIS['chapters/1_introduction.tex'] as string)).toBe('Introduction')
    expect(titleOf(THESIS['chapters/2_literature_review.tex'] as string)).toBe('Literature Review')
    expect(titleOf('\\section*{Scope \\& limits~here}')).toBe('Scope & limits here')
    expect(titleOf('% \\chapter{Commented out}\n\\section{The real one}')).toBe('The real one')
    expect(titleOf('Just prose, and \\subsection{not this}.')).toBeNull()
  })

  test('or, with neither, its file name made readable', () => {
    expect(namedAfter('chapters/2_literature_review.tex')).toBe('Literature review')
    expect(namedAfter('appendix-codebook.tex')).toBe('Appendix codebook')
    expect(namedAfter('chapters/03.tex')).toBe('03')
  })
})

describe('the parts a paper would make', () => {
  test('no main.tex is no paper', () => {
    expect(chaptersOf(reading({ 'chapters/a.tex': '\\chapter{A}' }))).toBeNull()
  })

  test('one part to a file main.tex pulls in, in document order, each owning its file and what that file pulls in', () => {
    const out = chaptersOf(reading(THESIS))!
    expect(out.parts).toEqual([
      { heading: 'Introduction', titled: true, file: 'chapters/1_introduction.tex', files: ['chapters/1_introduction.tex'] },
      { heading: 'Literature Review', titled: true, file: 'chapters/2_literature_review.tex', files: ['chapters/2_literature_review.tex'] },
      {
        heading: 'Results',
        titled: true,
        file: 'chapters/4_results.tex',
        files: ['chapters/4_results.tex', 'generated/tab_categories.tex', 'generated/quotes.tex'],
      },
      {
        heading: 'Instruments',
        titled: true,
        file: 'chapters/appendix_instruments.tex',
        /* The false branch of \IfFileExists: the file it tests for is not there. */
        files: ['chapters/appendix_instruments.tex', 'generated/protocol.tex', 'generated/fallback.tex'],
      },
    ])
    /* main.tex is never a part, the preamble's file is not one, and nothing after \end{document} was read. */
    expect(out.parts.some((part) => part.files.includes('main.tex'))).toBe(false)
    expect(out.preamble).toEqual(['annotations.tex'])
    expect(out.owned).toEqual([])
    expect(out.missing).toEqual([])
    /* Every file a part could own, in reading order, main.tex left out. */
    expect(out.files).toEqual([
      'annotations.tex',
      'chapters/1_introduction.tex',
      'chapters/2_literature_review.tex',
      'chapters/4_results.tex',
      'generated/tab_categories.tex',
      'generated/quotes.tex',
      'chapters/appendix_instruments.tex',
      'generated/protocol.tex',
      'generated/fallback.tex',
    ])
    expect(leftOutSaid(out)).toEqual([
      'annotations.tex is pulled in before \\begin{document} — macros and settings, not a chapter — and is not made a part.',
    ])
    expect(nothingSaid(out)).toBeNull()
  })

  test('a file with no heading is named after its file, and says so', () => {
    const out = chaptersOf(reading({ 'main.tex': '\\begin{document}\\input{chapters/2_related_work}\\end{document}', 'chapters/2_related_work.tex': 'Prose.' }))!
    expect(out.parts).toEqual([
      { heading: 'Related work', titled: false, file: 'chapters/2_related_work.tex', files: ['chapters/2_related_work.tex'] },
    ])
  })

  test('a file some part already owns is skipped and said — by name, whichever part holds it', () => {
    const existing: JourneyPart[] = [
      { id: 'opening', heading: 'The opening', refs: [], steps: 0, files: ['chapters/1_introduction.tex'] },
      { id: 'tables', heading: 'Tables', refs: [], steps: 0, files: ['generated/quotes.tex'] },
    ]
    const out = chaptersOf(reading(THESIS), existing)!
    expect(out.owned).toEqual([{ file: 'chapters/1_introduction.tex', by: 'The opening' }])
    expect(out.parts.map((part) => part.file)).toEqual([
      'chapters/2_literature_review.tex',
      'chapters/4_results.tex',
      'chapters/appendix_instruments.tex',
    ])
    /* A table somebody filed under another part stays that part's. */
    expect(out.parts[1]!.files).toEqual(['chapters/4_results.tex', 'generated/tab_categories.tex'])
    expect(leftOutSaid(out)[0]).toBe('chapters/1_introduction.tex (in “The opening”) is already a part’s, and is left as it is.')
  })

  test('pressing it twice makes nothing twice', () => {
    const first = chaptersOf(reading(THESIS))!
    const existing: JourneyPart[] = first.parts.map((part, i) => ({ id: `p${i}`, heading: part.heading, refs: [], steps: 0, files: part.files }))
    const again = chaptersOf(reading(THESIS), existing)!
    expect(again.parts).toEqual([])
    expect(again.owned.map((one) => one.file)).toEqual(first.parts.map((part) => part.file))
    expect(nothingSaid(again)).toBe('Every chapter file main.tex pulls in is already a part’s, so there is nothing to make.')
  })

  test('a file the paper names and the disk does not have is no part, and is said', () => {
    const out = chaptersOf(reading({ 'main.tex': '\\begin{document}\\include{chapters/unwritten}\\input{chapters/a}\\end{document}', 'chapters/a.tex': '\\chapter{A}' }))!
    expect(out.parts.map((part) => part.file)).toEqual(['chapters/a.tex'])
    expect(out.missing).toEqual(['chapters/unwritten.tex'])
    expect(leftOutSaid(out)[0]).toContain('main.tex names chapters/unwritten.tex, which is not in the paper’s folder')
  })

  test('two files that include each other are each read once', () => {
    const out = chaptersOf(
      reading({
        'main.tex': '\\begin{document}\\input{a}\\input{b}\\input{main}\\end{document}',
        'a.tex': '\\section{A}\\input{b}\\input{a}',
        'b.tex': '\\section{B}\\input{a}\\input{main}',
      }),
    )!
    /* `b` was reached under `a` first, so it is `a`'s, and is not a second part. */
    expect(out.parts).toEqual([{ heading: 'A', titled: true, file: 'a.tex', files: ['a.tex', 'b.tex'] }])
    expect(out.files).toEqual(['a.tex', 'b.tex'])
  })

  test('a chain is followed eight levels and no further', () => {
    const files: Record<string, string> = { 'main.tex': '\\begin{document}\\input{l1}\\end{document}' }
    for (let n = 1; n <= 12; n += 1) files[`l${n}.tex`] = `\\input{l${n + 1}}`
    const out = chaptersOf(reading(files))!
    expect(out.parts[0]!.files).toEqual(['l1.tex', 'l2.tex', 'l3.tex', 'l4.tex', 'l5.tex', 'l6.tex', 'l7.tex', 'l8.tex'])
  })

  test('two chapters under one heading are told apart by their files, and so is one called like an existing part', () => {
    const out = chaptersOf(
      reading({
        'main.tex': '\\begin{document}\\input{a}\\input{b}\\input{c}\\end{document}',
        'a.tex': '\\chapter{Results}',
        'b.tex': '\\chapter{results}',
        'c.tex': '\\chapter{Methods}',
      }),
      [{ id: 'methods', heading: 'Methods', refs: [], steps: 0 }],
    )!
    expect(out.parts.map((part) => part.heading)).toEqual(['Results', 'results (b.tex)', 'Methods (c.tex)'])
  })

  test('a paper that is one file has nothing to make, and says why', () => {
    const out = chaptersOf(reading({ 'main.tex': '\\input{macros}\\begin{document}Everything.\\end{document}', 'macros.tex': '' }))!
    expect(out.parts).toEqual([])
    expect(nothingSaid(out)).toContain('main.tex pulls in no chapter file after \\begin{document}')
  })

  test('no more parts are proposed than a host reads', () => {
    const files: Record<string, string> = { 'main.tex': `\\begin{document}${Array.from({ length: LIMITS.PARTS + 3 }, (_, i) => `\\input{c${i}}`).join('')}\\end{document}` }
    for (let i = 0; i < LIMITS.PARTS + 3; i += 1) files[`c${i}.tex`] = `\\chapter{Chapter ${i}}`
    const out = chaptersOf(reading(files), [{ id: 'kept', heading: 'Kept', refs: [], steps: 0 }])!
    expect(out.parts).toHaveLength(LIMITS.PARTS - 1)
    expect(out.beyond).toHaveLength(4)
    expect(leftOutSaid(out).at(-1)).toContain(`A host reads at most ${LIMITS.PARTS} parts of an epic`)
  })
})

/* ------------------------------------------------------------------ *
 * The disk
 * ------------------------------------------------------------------ */

const MINE = moduleFolder(ID)
const PAPERS = moduleFolder(PAPER_MODULE)

/** A project holding a paper for `thesis`, and optionally a journey record for it. */
function project(files: Record<string, string> = THESIS, journey?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-chapters-'))
  made.push(root)
  const paper = join(root, KEHIKOT_DIR, PAPERS, 'thesis')
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(paper, name)), { recursive: true })
    writeFileSync(join(paper, name), text)
  }
  const file = join(root, KEHIKOT_DIR, MINE, 'journeys.json')
  if (journey) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ version: 1, journeys: { thesis: { slug: 'thesis', title: 'Thesis', steps: [], ...journey } } }, null, 2)}\n`)
  }
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'thesis', ...args } } }, null)
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const get = (slug = 'thesis') => answer('GET', '/api/chapters', new URLSearchParams({ project: root, slug }), null, null)
  const post = (path: string, body: Record<string, unknown>) =>
    answer('POST', path, new URLSearchParams(), { project: root, slug: 'thesis', ticket: writeTicketFor(root), ...body }, TICKET)
  const on = () => (JSON.parse(readFileSync(file, 'utf8')) as { journeys: Record<string, { groups: Record<string, unknown>[]; steps: unknown[] }> }).journeys.thesis!
  return { root, paper, file, call, get, post, on }
}

describe('opening the paper’s files', () => {
  test('reads a file of the paper by its name, and nothing by any other', () => {
    const { root } = project()
    const read = paperReader(root, 'thesis')!
    expect(read('chapters/1_introduction.tex')).toContain('\\chapter{Introduction}')
    expect(read('chapters/nope.tex')).toBeNull()
    /* Not in `partFile`'s form: refused before the disk is asked. */
    expect(read('../../../etc/hosts')).toBeNull()
    expect(read('/etc/hosts')).toBeNull()
    expect(read('./chapters/1_introduction.tex')).toBeNull()
    expect(read('chapters')).toBeNull()
  })

  test('a link inside the paper pointing out of it reads as not there', () => {
    const { root, paper } = project()
    const outside = mkdtempSync(join(tmpdir(), 'journeys-outside-'))
    made.push(outside)
    writeFileSync(join(outside, 'secret.tex'), '\\chapter{Somebody else’s}')
    symlinkSync(join(outside, 'secret.tex'), join(paper, 'chapters', 'linked.tex'))
    symlinkSync(outside, join(paper, 'out'))
    const read = paperReader(root, 'thesis')!
    expect(read('chapters/linked.tex')).toBeNull()
    expect(read('out/secret.tex')).toBeNull()
    /* And so a paper that pulls them in gets no part for either. */
    writeFileSync(join(paper, 'main.tex'), '\\begin{document}\\input{chapters/linked}\\input{out/secret}\\input{chapters/1_introduction}\\end{document}')
    const found = chaptersIn(root, 'thesis')!
    expect(found.parts.map((part) => part.file)).toEqual(['chapters/1_introduction.tex'])
    expect(found.missing).toEqual(['chapters/linked.tex', 'out/secret.tex'])
  })

  test('a paper folder that is a link out of the project is not followed', () => {
    const { root } = project({})
    const outside = mkdtempSync(join(tmpdir(), 'journeys-outside-'))
    made.push(outside)
    writeFileSync(join(outside, 'main.tex'), '\\begin{document}\\end{document}')
    mkdirSync(join(root, KEHIKOT_DIR, PAPERS), { recursive: true })
    symlinkSync(outside, join(root, KEHIKOT_DIR, PAPERS, 'elsewhere'))
    expect(paperFolder(root, 'elsewhere')).toBeNull()
    expect(chaptersIn(root, 'elsewhere')).toBeNull()
  })

  test('no folder, no project and no slug are each no paper', () => {
    const { root } = project()
    expect(chaptersIn(root, 'another-epic')).toBeNull()
    expect(chaptersIn(null, 'thesis')).toBeNull()
    expect(chaptersIn(root, '../thesis')).toBeNull()
    expect(chaptersIn(root, 'thesis')).not.toBeNull()
  })
})

describe('the list, from both doors', () => {
  test('the page is answered before the journey exists, with every chapter proposed', () => {
    const { get } = project()
    const body = get()?.body as { ok: boolean; paper: boolean; parts: { heading: string }[]; leftOut: string[]; nothing: string | null }
    expect(body).toMatchObject({ ok: true, paper: true, nothing: null })
    expect(body.parts.map((part) => part.heading)).toEqual(['Introduction', 'Literature Review', 'Results', 'Instruments'])
    expect(body.leftOut).toHaveLength(1)
  })

  test('an epic with no paper is an answer, not a refusal', () => {
    const { get } = project()
    expect(get('another-epic')).toEqual({ status: 200, body: { ok: true, slug: 'another-epic', paper: false } })
    expect(get('not a slug')?.status).toBe(400)
  })

  test('an agent is shown the same list, with the call that makes each, and nothing is written', () => {
    const { call, file } = project(THESIS, {})
    const before = readFileSync(file, 'utf8')
    const said = call('propose_chapter_parts')
    expect(said).toContain('PROPOSAL — nothing has been made. main.tex of this epic’s paper pulls in 4 chapter files that no part owns.')
    expect(said).toContain('  1. “Introduction”\tchapters/1_introduction.tex')
    expect(said).toContain('set_part { slug: "thesis", heading: "Results", files: ["chapters/4_results.tex","generated/tab_categories.tex","generated/quotes.tex"] }')
    expect(said).toContain('LEFT OUT: annotations.tex is pulled in before \\begin{document}')
    expect(said).toContain('Make the ones you want with `set_part`')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('and told to begin the journey first when there is none, or that there is no paper', () => {
    const { call } = project()
    expect(call('propose_chapter_parts')).toContain('holds no journey for thesis yet, and `set_part` needs one: call `create_journey` first')
    expect(call('propose_chapter_parts', { slug: 'another-epic' })).toContain('No paper for another-epic')
  })

  test('what an agent is told to call makes exactly what was listed', () => {
    const { call, on } = project(THESIS, {})
    call('set_part', { heading: 'Results', files: ['chapters/4_results.tex', 'generated/tab_categories.tex', 'generated/quotes.tex'] })
    expect(partsOf(on())).toEqual([
      { id: 'results', heading: 'Results', refs: [], steps: 0, files: ['chapters/4_results.tex', 'generated/tab_categories.tex', 'generated/quotes.tex'] },
    ])
    /* And the next list no longer proposes it. */
    expect(call('propose_chapter_parts')).not.toContain('“Results”\t')
    expect(call('propose_chapter_parts')).toContain('chapters/4_results.tex (in “Results”) is already a part’s')
  })

  test('the tool is listed as one that reads', () => {
    const tools = (
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)?.body as {
        result: { tools: { name: string; description: string }[] }
      }
    ).result.tools
    const tool = tools.find((one) => one.name === 'propose_chapter_parts')
    expect(tool?.description).toContain('READ-ONLY: nothing is written')
  })
})

describe('making what was listed, in one write', () => {
  test('makes a part for each file named, in the paper’s order, each owning its files', () => {
    const { post, on } = project(THESIS, { steps: [{ title: 'One', body: '', refs: [], notes: [] }] })
    const reply = post('/api/parts/chapters', { files: ['chapters/4_results.tex', 'chapters/1_introduction.tex'] })
    expect(reply?.status).toBe(200)
    expect((reply?.body as { said: string }).said).toBe(
      'Made 2 parts from the paper’s chapter files, each owning its file: “Introduction” (chapters/1_introduction.tex); '
        + '“Results” (chapters/4_results.tex, generated/tab_categories.tex, generated/quotes.tex). No step is filed under them yet. '
        + 'Tick them in the host’s bar to see one chapter at a time.',
    )
    expect(partsOf(on())).toEqual([
      { id: 'introduction', heading: 'Introduction', refs: [], steps: 0, files: ['chapters/1_introduction.tex'] },
      { id: 'results', heading: 'Results', refs: [], steps: 0, files: ['chapters/4_results.tex', 'generated/tab_categories.tex', 'generated/quotes.tex'] },
    ])
    /* The id is written from the start, so a later rewording does not move it; the steps are untouched. */
    expect(on().groups.map((group) => group.id)).toEqual(['introduction', 'results'])
    expect(on().steps).toHaveLength(1)
  })

  test('a second press makes the rest and not the first again', () => {
    const { post, on } = project(THESIS, {})
    post('/api/parts/chapters', { files: ['chapters/1_introduction.tex'] })
    const again = post('/api/parts/chapters', { files: ['chapters/1_introduction.tex'] })
    expect(again?.status).toBe(400)
    expect((again?.body as { error: string }).error).toContain('chapters/1_introduction.tex is not among the chapter files main.tex would make a part of now')
    expect(partsOf(on())).toHaveLength(1)
    expect(post('/api/parts/chapters', { files: ['chapters/2_literature_review.tex'] })?.status).toBe(200)
    expect(partsOf(on()).map((part) => part.heading)).toEqual(['Introduction', 'Literature Review'])
  })

  test('refuses, and writes nothing: no files, no paper, no journey, no ticket', () => {
    const { root, post, file } = project(THESIS, {})
    const before = readFileSync(file, 'utf8')
    expect((post('/api/parts/chapters', { files: [] })?.body as { error: string }).error).toContain('which chapter files?')
    expect((post('/api/parts/chapters', { files: ['annotations.tex'] })?.body as { error: string }).error).toContain('annotations.tex is not among')
    expect((post('/api/parts/chapters', { files: ['main.tex'] })?.body as { error: string }).error).toContain('main.tex is not among')
    expect(post('/api/parts/chapters', { slug: 'another-epic', files: ['a.tex'] })?.status).toBe(404)
    expect(answer('POST', '/api/parts/chapters', new URLSearchParams(), { project: root, slug: 'thesis', files: ['chapters/4_results.tex'] }, 'guessed')?.status).toBe(403)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
