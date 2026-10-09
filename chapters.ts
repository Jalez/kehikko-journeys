import { LIMITS, partFile, type JourneyPart } from 'kehikot-module-protocol'

/**
 * The parts a paper is already divided into, read off its `main.tex`.
 *
 * ## Why this exists
 *
 * A part of an epic may own files of the epic's paper, and a paper is very
 * often divided already: `main.tex` pulls in `chapters/1_introduction.tex`,
 * `chapters/2_methods.tex`, one file to a chapter. Until this file, turning
 * that into parts meant making each part by hand and typing each file's name
 * into it — seven headings and seven paths for a thesis, every one of them
 * something the disk could have said. The person who asked for parts had been
 * told "each part would automatically have its own .tex file that's used in
 * the main.tex", and what they were given was a text box.
 *
 * So this reads which files `main.tex` pulls in, in the order it pulls them
 * in, and proposes one part for each: called what the file's own first
 * `\chapter` or `\section` calls it, owning that file and whatever that file
 * pulls in itself.
 *
 * ## It proposes, and writes nothing
 *
 * Everything here answers with a LIST. Nothing is made until a person has
 * read it and said so — the same two steps as `proposed` in `parts.ts`, and
 * for its reason: this is a guess about somebody's document, and a guess that
 * is right nine times in ten is shown first.
 *
 * ## What it reads, and what it does not
 *
 * The `.tex` files in the paper's folder, which are the person's documents.
 * Not the Paper module's state: not its build, not its page map, not its
 * proposals. Where a paper's folder is (`<project>/.kehikot/paper/<epic>/`)
 * is the protocol's convention — `PAPER_MODULE`, beside `paperFileOf` — and
 * the file that opens it is `paper.ts`. This one opens nothing: it is handed
 * a function that answers a file's text, so every rule below can be asserted
 * with a few strings.
 *
 * ## The walk is the Paper module's walk, written a second time
 *
 * `walk` in that module's `store.ts` decides which files a paper is made of,
 * and this has to agree with it or a part made here names a file the paper
 * does not list. The behaviours matched, one by one:
 *
 *  - `\input`, `\include` and `\subfile`, with a braced target;
 *  - a target is resolved against the paper's ROOT, never against the file
 *    naming it, because that is what TeX does;
 *  - `.tex` is added to a target that does not end in it;
 *  - a file already reached is not read a second time, which is also what
 *    stops two files that include each other;
 *  - eight levels deep and no further;
 *  - `\IfFileExists{f}{yes}{no}` is resolved the way LaTeX resolves it: the
 *    name as written, then with `.tex`, and only the branch that applies is
 *    read;
 *  - a target that is not on disk is not a file of the paper.
 *
 * Where it is deliberately SMALLER: that walk runs on a full LaTeX parse and
 * this is a scan. It drops comments and the listing environments, and then
 * looks for the four commands. A paper that hides an `\input` behind a macro
 * of its own is read by neither.
 *
 * Two readings of "which files is this paper made of" in two repositories is
 * the disagreement this workspace keeps meeting, and the answer is one walk
 * in `kehikot-module-protocol` that both import — handed a `read`, exactly as
 * this one is. It is not done here: this change is three repositories wide
 * already and the protocol is not one of them.
 */

/** The file every paper starts from. It is never a part: it is what the parts are pulled into. */
export const MAIN = 'main.tex'

/** How deep an `\input` inside an `\input` is followed. The Paper module's number. */
export const MAX_DEPTH = 8

/** Answers a file's text by its name from the paper's folder, or null: not there, not readable, not inside. */
export type ReadFile = (file: string) => string | null

const LISTINGS = ['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment']

/**
 * A source with what TeX would not execute taken out: comments, and the
 * environments whose content is printed as written.
 *
 * `%` starts a comment unless it is escaped, and an escape is an ODD number of
 * backslashes before it: `\%` is a percent sign, `\\%` is a line break and
 * then a comment. The thesis this was written for has `\input{annotations}`
 * inside a comment explaining when to delete that line.
 */
export function executed(source: string): string {
  let out = ''
  for (const line of source.split('\n')) {
    let cut = line.length
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== '%') continue
      let slashes = 0
      while (i - slashes - 1 >= 0 && line[i - slashes - 1] === '\\') slashes += 1
      if (slashes % 2 === 0) {
        cut = i
        break
      }
    }
    out += `${line.slice(0, cut)}\n`
  }
  for (const name of LISTINGS) {
    const open = `\\begin{${name}}`
    const close = `\\end{${name}}`
    for (let at = out.indexOf(open); at >= 0; at = out.indexOf(open, at)) {
      const end = out.indexOf(close, at)
      out = end < 0 ? out.slice(0, at) : out.slice(0, at) + out.slice(end + close.length)
    }
  }
  return out
}

/** The index just past the `}` matching the `{` at `open`, or -1 when it is never closed. */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]
    if (c === '\\') {
      i += 1
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

const skipSpace = (text: string, from: number): number => {
  let i = from
  while (i < text.length && /\s/.test(text[i] as string)) i += 1
  return i
}

/** One file a source pulls in: the target as written, and whether that is in the document's body. */
export interface Pulled {
  target: string
  /** False for a target named before `\begin{document}`: macros and settings, never a chapter. */
  body: boolean
}

/**
 * The files one source pulls in, in the order it does, as they are written.
 *
 * `exists` answers `\IfFileExists`. `(?![A-Za-z@])` is what keeps
 * `\includegraphics` and `\includeonly` from being read as `\include`.
 *
 * Nothing after `\end{document}` is read, because TeX reads nothing there.
 */
export function pulledIn(source: string, exists: (target: string) => boolean): Pulled[] {
  const text = executed(source)
  const begins = text.indexOf('\\begin{document}')
  const ends = text.indexOf('\\end{document}')
  const out: Pulled[] = []
  const command = /\\(input|include|subfile|IfFileExists)(?![A-Za-z@])\s*\{/g

  const scan = (from: number, to: number): void => {
    command.lastIndex = from
    for (let hit = command.exec(text); hit && hit.index < to; hit = command.exec(text)) {
      const open = hit.index + hit[0].length - 1
      const close = closing(text, open)
      if (close < 0 || close > to) return
      const named = text.slice(open + 1, close - 1).trim()
      if (hit[1] !== 'IfFileExists') {
        if (named) out.push({ target: named, body: begins < 0 || hit.index > begins })
        command.lastIndex = close
        continue
      }
      /* Only a well-formed call with all three groups is taken, as in the
         Paper module; anything else is passed over and read as it comes. */
      const yesOpen = skipSpace(text, close)
      const yesClose = text[yesOpen] === '{' ? closing(text, yesOpen) : -1
      const noOpen = yesClose < 0 ? -1 : skipSpace(text, yesClose)
      const noClose = noOpen >= 0 && text[noOpen] === '{' ? closing(text, noOpen) : -1
      if (noClose < 0 || noClose > to) {
        command.lastIndex = close
        continue
      }
      if (exists(named)) scan(yesOpen + 1, yesClose - 1)
      else scan(noOpen + 1, noClose - 1)
      command.lastIndex = noClose
    }
  }
  scan(0, ends < 0 ? text.length : ends)
  return out
}

/**
 * The name a target has on disk, from the paper's folder — or null when it is
 * not a name a part could hold. `.tex` is added where TeX would add it, and
 * the rest is the protocol's `partFile`, which is also what refuses `..`.
 */
export function fileOf(target: string): string | null {
  const named = target.trim()
  if (!named) return null
  return partFile(named.toLowerCase().endsWith('.tex') ? named : `${named}.tex`)
}

/**
 * What a file calls itself: the title of its first `\chapter` or `\section`,
 * starred or not, as plain words — or null when it has neither.
 *
 * An optional `[short title]` is passed over; the long one is what the
 * chapter is called on its own first page. Markup inside the title is taken
 * off rather than understood: `\emph{x}` is `x`, a `\label{…}` is nothing,
 * `~` and `\\` are spaces.
 */
export function titleOf(source: string): string | null {
  const text = executed(source)
  const heading = /\\(chapter|section)\*?\s*(\[[^\]]*\]\s*)?\{/g
  for (let hit = heading.exec(text); hit; hit = heading.exec(text)) {
    const open = hit.index + hit[0].length - 1
    const close = closing(text, open)
    if (close < 0) return null
    const said = plain(text.slice(open + 1, close - 1))
    if (said) return said.slice(0, LIMITS.TITLE)
  }
  return null
}

function plain(title: string): string {
  let text = title
  for (let at = text.search(/\\(label|index|footnote)\s*\{/); at >= 0; at = text.search(/\\(label|index|footnote)\s*\{/)) {
    const open = text.indexOf('{', at)
    const close = closing(text, open)
    text = close < 0 ? text.slice(0, at) : text.slice(0, at) + text.slice(close)
  }
  return text
    .replace(/\\\\/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\[A-Za-z@]+\*?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What to call a part whose file has no heading of its own: the file's name,
 * made readable. `chapters/2_literature_review.tex` is "Literature review".
 *
 * The folder goes, the extension goes, a leading number goes — it is the
 * file's place in the order, which the list of parts already says — and what
 * separated the words becomes spaces. A name with nothing left after that is
 * given back as it was.
 */
export function namedAfter(file: string): string {
  const base = (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '')
  const words = base
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  const said = words || base
  return said.charAt(0).toUpperCase() + said.slice(1)
}

/** One part the paper would give a journey. */
export interface ChapterPart {
  /** What it would be called. */
  heading: string
  /** True when that is the file's own `\chapter` or `\section`; false when it is the file's name. */
  titled: boolean
  /** The file `main.tex` pulls in — what this part IS. */
  file: string
  /** Everything it would own: that file first, then every file it pulls in itself. */
  files: string[]
}

/** What a paper's `main.tex` says about parts. */
export interface Chapters {
  /** The parts that would be made, in the order the paper prints them. */
  parts: ChapterPart[]
  /** Files `main.tex` pulls in that a part of the journey already owns: skipped, and said. */
  owned: { file: string; by: string }[]
  /** Files pulled in before `\begin{document}`: macros and settings, and so never a part. */
  preamble: string[]
  /** Files the paper names that are not on disk. */
  missing: string[]
  /** Chapter files past what a host reads as parts (`LIMITS.PARTS`), which would be written and never shown. */
  beyond: string[]
  /** Every file of the paper but `main.tex`, in reading order: what a part's files can be picked from. */
  files: string[]
}

/**
 * The parts a paper's own files would make — or null when the folder holds no
 * `main.tex`, which is this app's whole test for "this epic has a paper".
 *
 * ## One part to a file `main.tex` pulls in, and it owns what that file pulls in
 *
 * A chapter that `\input`s three tables printed those tables on its own
 * pages. A part that owned the chapter's file and not theirs would, when
 * picked, show a chapter with holes where the tables are and call the holes
 * "outside the picked part". So the files beneath a chapter's file are that
 * part's too. A file two chapters both pull in is the first one's, since the
 * second is not read twice — by this or by TeX's `\include`.
 *
 * ## What is left out, and each is said
 *
 *  - **`main.tex`.** It is what the parts are pulled into.
 *  - **Anything before `\begin{document}`.** A preamble pulls in macros.
 *  - **A file some part already owns.** Pressing this twice must not make
 *    every chapter twice, and a person who made three parts by hand is not
 *    asked to delete them first. Compared by name, against every file every
 *    existing part holds.
 *  - **A file that is not there.** The paper names it and the disk does not
 *    have it; a part for it would narrow to nothing.
 *
 * ## Headings are never doubled
 *
 * A journey refuses two parts under one heading — they cannot be told apart
 * where they are picked — and one refusal would stop a whole list being
 * made. Two chapter files both titled "Results", or one titled like a part
 * that is already there, get the file's name after the title instead.
 */
export function chaptersOf(read: ReadFile, existing: readonly JourneyPart[] = []): Chapters | null {
  const main = read(MAIN)
  if (main === null) return null

  const exists = (target: string): boolean => {
    const named = target.trim()
    const candidates = named.toLowerCase().endsWith('.tex') ? [named] : [named, `${named}.tex`]
    return candidates.some((one) => {
      const file = partFile(one)
      return file !== null && read(file) !== null
    })
  }

  const seen = new Set<string>([MAIN])
  const missing: string[] = []
  const sources = new Map<string, string>()
  /** Every file beneath `source`, deep, in the order it is reached. */
  const beneath = (source: string, depth: number): string[] => {
    const out: string[] = []
    for (const pulled of pulledIn(source, exists)) {
      const file = fileOf(pulled.target)
      if (file === null || seen.has(file) || depth >= MAX_DEPTH) continue
      const text = read(file)
      if (text === null) {
        if (!missing.includes(file)) missing.push(file)
        continue
      }
      seen.add(file)
      sources.set(file, text)
      out.push(file, ...beneath(text, depth + 1))
    }
    return out
  }

  const owner = new Map<string, string>()
  for (const part of existing) for (const file of part.files ?? []) if (!owner.has(file)) owner.set(file, part.heading || part.id)
  const taken = new Set(existing.map((part) => part.heading.trim().toLowerCase()))
  const room = Math.max(0, LIMITS.PARTS - existing.length)

  const out: Chapters = { parts: [], owned: [], preamble: [], missing, beyond: [], files: [] }
  for (const pulled of pulledIn(main, exists)) {
    const file = fileOf(pulled.target)
    if (file === null || seen.has(file)) continue
    const text = read(file)
    if (text === null) {
      if (!missing.includes(file)) missing.push(file)
      continue
    }
    seen.add(file)
    sources.set(file, text)
    const under = beneath(text, 1)
    out.files.push(file, ...under)
    if (!pulled.body) {
      out.preamble.push(file)
      continue
    }
    const by = owner.get(file)
    if (by !== undefined) {
      out.owned.push({ file, by })
      continue
    }
    if (out.parts.length >= room) {
      out.beyond.push(file)
      continue
    }
    const title = titleOf(text)
    let heading = title ?? namedAfter(file)
    if (taken.has(heading.toLowerCase())) heading = `${heading} (${file})`.slice(0, LIMITS.TITLE)
    for (let n = 2; taken.has(heading.toLowerCase()); n += 1) heading = `${title ?? namedAfter(file)} (${file}, ${n})`.slice(0, LIMITS.TITLE)
    taken.add(heading.toLowerCase())
    out.parts.push({
      heading,
      titled: title !== null,
      file,
      /* Its own file, and beneath it only what no part holds already: a table
         somebody filed under another part by hand stays that part's. */
      files: [file, ...under.filter((one) => !owner.has(one))].slice(0, LIMITS.PART_FILES),
    })
  }
  return out
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What was left out of a proposal, one sentence to a reason; empty when
 * nothing was. The page prints these under the list and the MCP door prints
 * them after it, so a person and an agent are told the same thing.
 */
export function leftOutSaid(chapters: Chapters): string[] {
  const out: string[] = []
  if (chapters.owned.length) {
    out.push(
      `${chapters.owned.map((one) => `${one.file} (in “${one.by}”)`).join(', ')} `
        + `${chapters.owned.length === 1 ? 'is' : 'are'} already a part’s, and ${chapters.owned.length === 1 ? 'is' : 'are'} left as ${chapters.owned.length === 1 ? 'it is' : 'they are'}.`,
    )
  }
  if (chapters.preamble.length) {
    out.push(
      `${chapters.preamble.join(', ')} ${chapters.preamble.length === 1 ? 'is' : 'are'} pulled in before `
        + `\\begin{document} — macros and settings, not a chapter — and ${chapters.preamble.length === 1 ? 'is' : 'are'} not made a part.`,
    )
  }
  if (chapters.missing.length) {
    out.push(
      `${MAIN} names ${chapters.missing.join(', ')}, which ${chapters.missing.length === 1 ? 'is' : 'are'} not in the paper’s folder; no part is made for a file that is not there.`,
    )
  }
  if (chapters.beyond.length) {
    out.push(
      `A host reads at most ${LIMITS.PARTS} parts of an epic, so ${count(chapters.beyond.length, 'file')} past that `
        + `${chapters.beyond.length === 1 ? 'is' : 'are'} left out: ${chapters.beyond.join(', ')}.`,
    )
  }
  return out
}

/**
 * Why a paper that is there has nothing to propose, in a sentence — or null
 * when it has something.
 */
export function nothingSaid(chapters: Chapters): string | null {
  if (chapters.parts.length) return null
  if (chapters.owned.length && !chapters.beyond.length) {
    return `Every chapter file ${MAIN} pulls in is already a part’s, so there is nothing to make.`
  }
  if (!chapters.owned.length && !chapters.beyond.length) {
    return (
      `${MAIN} pulls in no chapter file after \\begin{document}, so the paper is one file and there is nothing to make `
      + 'a part of. Parts can still be made by hand, below.'
    )
  }
  return 'There is no room for another part.'
}
