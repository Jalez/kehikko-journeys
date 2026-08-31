import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'

import { KEHIKOT_DIR, moduleDir, moduleFile, withKehikotIgnored, within } from 'roadmap-module-protocol'

import { ID } from './manifest.ts'

/**
 * The journeys, on disk, inside the project they are about.
 *
 * ## The departure this file is
 *
 * The roadmap's own `docs/modules.md` — in the repository this app was
 * extracted from, and quoted here because that document does not travel with
 * this one — says the middle holds three things: what was **decided** (the
 * journeys and the steps), what is **true** (what the last refresh read), and
 * the register of which modules exist. It says a module brings the surface and
 * the store behind it, and the host brings the trackers, the agreement and the
 * room — and it names the decided half as the host's.
 *
 * This file takes the decided half. That is a deliberate departure under the
 * owner's direction and not a quiet reinterpretation of the sentence above, so
 * it is written down here rather than smoothed over: **the journeys, their
 * slugs, titles, ledes, callouts, steps, ordering, what blocks what and what
 * settles what are this app's, and the frame keeps discovery, the grants, the
 * credentialed tracker reading, and the reference list.** Somebody has to
 * decide which of the two documents is right; nothing here decides it, and
 * nothing here pretends the question was not asked.
 *
 * The reason it is arguable at all is the reason gh#131 exists. A journeys
 * panel that read its own steps over a bridge would not have left; it would be
 * a viewer of a store it does not own, mounted through a tab. The test of "the
 * roadmap is a host" is whether the panel it is NAMED after can hold its own
 * material and still be an ordinary module, and it cannot be that while the
 * material stays behind. This repository existing at all is that test being
 * taken: the code is here, the store is here, and the host is reached only for
 * `live.get`.
 *
 * ## The schema
 *
 * Copied from the roadmap's own epic schema rather than imported, and the copy
 * is the point rather than a shortcut: this app is a separate repository with a
 * separate release, and an app that reached into a host's internals would stop
 * building the day that host reorganised a file. The copy is faithful — a
 * journey written by the roadmap parses here, and one written here parses there
 * — with exactly one addition, `stepsFrom`, which has a section of its own
 * below. The one thing that must not drift is the SLUG: the host's `epic` and
 * this file's `slug` are the same name for the same thing, and a journey whose
 * slug matches no epic simply never gets pointed at.
 *
 * ## What is carried but not drawn
 *
 * `quizzes` and `vocabulary` are the Learning app's material, and `owners` and
 * `groups` are the ownership table's. They are kept in the schema and written
 * back untouched, because a store that silently dropped a field on the first
 * edit would destroy somebody's work to make a point about boundaries. This app
 * simply does not render them.
 */

/* ------------------------------------------------------------------ *
 * Where it lives
 * ------------------------------------------------------------------ */

/**
 * Where this app keeps what is its own — which is inside the project, now, and
 * not beside this program.
 *
 * ## What moved, and why the user asked for it
 *
 * There used to be a `data/` directory next to this app holding one JSON file
 * per journey, for every project at once. The user's sentence retired it:
 *
 * > "Each of the modules should hold their data inside the project itself,
 * > mostly as text files inside a kehikko-folder (or json) … That way
 * > everything is transparent etc and easily usable by others in the project."
 *
 * So: `<projectPath>/.kehikot/journeys/journeys.json`. The folder name and both
 * joins are `roadmap-module-protocol`'s, deliberately, because four modules
 * answering "where does my data live" separately is four answers and the
 * disagreement has no symptom — every module starts, every module saves, and a
 * person finds half their work in one folder and half in another.
 *
 * The middle level is this module's own, derived from its id, and it is what
 * makes `rm -r .kehikot/journeys` a sentence somebody can say. This app is the
 * only writer inside it and confines itself to it: the fence below is drawn
 * around THAT directory rather than around `.kehikot`, so a bug here cannot
 * reach the notes or the checklists sitting beside it.
 *
 * ## The path is the partition
 *
 * The store this opens is already one project's. Nothing in the document below
 * is keyed by project, and nothing needs to be: two projects are two files in
 * two folders, and switching project is opening a different file rather than
 * filtering a bigger one. A store that has never heard of a project has no way
 * to show one project's journeys under another's name.
 *
 * ## Null is a place a person can be, and never a guess
 *
 * `projectPath` is nullable on the wire — no project open, or a host older than
 * protocol 0.8. This answers `null` for it and every caller has to say so on
 * screen. It does not fall back to `process.cwd()`, to this app's own folder,
 * or to anything else, and `JOURNEYS_DATA` is gone rather than kept as an
 * escape hatch: a variable naming a directory would be a second answer to a
 * question that now has one, and the module that honoured it would be the one
 * whose journeys nobody could find.
 *
 * The old `data/` had one more failure recorded on it worth carrying forward.
 * It was `join(import.meta.dir, 'data')`, and `import.meta.dir` is Bun's and
 * only Bun's: once the store became middleware inside a Vite config it ran
 * under Node, the expression evaluated to `undefined`, and `join(undefined,
 * 'data')` threw from inside a request handler. Throwing was the lucky half.
 * Had it merely been the wrong string, this app would have started cleanly,
 * found no journeys, and written new ones into a directory Vite deletes. A
 * silently wrong location is worse than a loud absent one, and that is why the
 * answer for "no project" here is a `null` a caller cannot ignore rather than a
 * path that happens to exist.
 *
 * ## The fence, which matters more here than it did before
 *
 * This app is about to write files into a path it was handed OVER THE WIRE. So
 * the path is resolved with `realpathSync` and the folder it lands in is
 * checked to be under the project it claims to be under — after resolution,
 * because a `.kehikot/journeys` that is a symlink to somewhere else is exactly
 * the case a string comparison misses. `within()` is the comparison and not the
 * check; see its note in the protocol package.
 *
 * The file NAME is a constant below and never a string from a request, and so
 * is the folder — it is derived from this module's own id, which is a constant
 * in `manifest.ts`. There is no door in this app that takes a filename — see
 * the note on `documentSchema` for why a slug can no longer become one either —
 * and `moduleFile` throws rather than returns null if anything ever tries.
 */

/** This app's own file, inside its own folder. A constant, never an argument. */
export const FILE = 'journeys'

/**
 * The one file, or a sentence about why there is not one.
 *
 * Three answers, and they are three because they mean three different things:
 *
 * - `{ path, trouble: null }` — here it is.
 * - `{ path: null, trouble: null }` — there is no project open. An ordinary
 *   state and not a fault; the page says so and nothing is written.
 * - `{ path: null, trouble }` — a project was named and this app will not write
 *   under it. The sentence is for a person, and it says what was refused.
 *
 * Reading does not create anything. `makeDir()` is what creates, and it is
 * called on the write path only, so opening a container against a project never
 * leaves a folder in somebody's repository they did not ask for.
 */
export function dataFile(projectPath: string | null | undefined): { path: string | null; trouble: string | null } {
  const root = projectRoot(projectPath)
  if (root === null) return { path: null, trouble: null }
  if ('trouble' in root) return { path: null, trouble: root.trouble }

  /* Both levels, because either can be the symlink. `.kehikot` pointing out of
     the project takes every module's data with it; `.kehikot/journeys` pointing
     out takes this one's. Only what exists can be resolved, and only what exists
     can escape — a folder that is not there yet cannot be a symlink to somewhere
     else, which is why `makeDir` asks again after creating them. */
  for (const dir of [join(root.path, KEHIKOT_DIR), moduleDir(root.path, ID)]) {
    if (dir !== null && existsSync(dir)) {
      const escaped = escapes(root.path, dir)
      if (escaped) return { path: null, trouble: escaped }
    }
  }
  const path = moduleFile(root.path, ID, FILE)
  if (path !== null && existsSync(path)) {
    const escaped = escapes(root.path, path)
    if (escaped) return { path: null, trouble: escaped }
  }
  return { path, trouble: null }
}

/**
 * Make the folder, and tell the project's `.gitignore` about it — once.
 *
 * Called before a write and not before a read, so that looking at a project
 * never changes it.
 */
export function makeDir(projectPath: string | null | undefined): { dir: string | null; trouble: string | null } {
  const root = projectRoot(projectPath)
  if (root === null) return { dir: null, trouble: null }
  if ('trouble' in root) return { dir: null, trouble: root.trouble }

  const dir = moduleDir(root.path, ID)
  if (dir === null) return { dir: null, trouble: null }

  /* Whether the `.kehikot` folder is new decides whether the `.gitignore` is
     written, and this app's own folder inside it is not the same question: a
     project where Notes ran first already has `.kehikot` and already has the
     ignore line, and adding a second copy of it because THIS module's folder is
     new would be the duplicate the whole idempotence argument is about. */
  const fresh = !existsSync(join(root.path, KEHIKOT_DIR))
  mkdirSync(dir, { recursive: true })
  /* After the mkdir as well as before it. `existsSync` said nothing was there
     and `mkdirSync` is happy to have followed a symlink somebody put there in
     between; the only honest moment to ask where a directory actually is, is
     once it is there. Both levels again, for the reason `dataFile` gives. */
  for (const made of [join(root.path, KEHIKOT_DIR), dir]) {
    const escaped = escapes(root.path, made)
    if (escaped) return { dir: null, trouble: escaped }
  }

  /* Only on the run that created it. A project that has removed the ignore rule
     has said something, and a program that re-added it on every save would be
     overruling them every few seconds. */
  if (fresh) ignore(root.path)
  return { dir, trouble: null }
}

/**
 * Append the ignore rule to the project's `.gitignore`, if it has one.
 *
 * A project that is not a git repository gets nothing — not a file, and
 * certainly not a repository. Creating a `.gitignore` in a folder that is not
 * version-controlled would be this program deciding how somebody keeps their
 * work. A repository that has simply never needed one is a different case, and
 * it gets a file holding only this, which is answering a question rather than
 * editing an answer.
 *
 * The text and the idempotence are `withKehikotIgnored`'s — append-only, never
 * a rewrite, never a reorder, because this file is in the user's own repository
 * and shows up in their next diff under their name. It ignores the whole
 * `.kehikot/` folder rather than this module's part of it, so the four modules
 * write one identical line between them instead of four.
 *
 * Every failure here is swallowed on purpose. Not being able to write somebody's
 * `.gitignore` is not a reason to refuse to save their journeys.
 */
function ignore(root: string): void {
  try {
    if (!inARepository(root)) return
    /* Written at the PROJECT root, not at the repository root, even when the
       repository is somewhere above. Git honours a `.gitignore` in any
       directory, so a rule placed here covers the folder that was just created
       and touches nothing else in a repository that may hold a dozen unrelated
       projects. Writing at the repository root would be this program editing a
       file about directories it knows nothing about. */
    const path = join(root, '.gitignore')
    const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const after = withKehikotIgnored(before)
    if (after !== before) writeFileSync(path, after)
  } catch {
    /* Deliberately silent. See above. */
  }
}

/**
 * Is this project inside a git repository — its own, or one above it?
 *
 * ## Why it walks up rather than looking for `<project>/.git`
 *
 * Because the case that breaks the simple check is a real project on this
 * machine, not a hypothetical. The thesis lives at
 * `…/CS-DEGREE/05_drafts/thesis_latex`, which has no `.git` of its own and sits
 * several directories inside the CS-DEGREE repository. Under a check that only
 * looked at the project root, its `.kehikot/` would be written, nothing would
 * ignore it, and the next `git status` in that repository would offer somebody
 * else's working material for commit — quietly, in a list of files a person
 * scrolls past.
 *
 * A project that is genuinely not in a repository still gets nothing: no file,
 * and certainly no repository. Creating an ignore file where there is nothing
 * to ignore for would be this program deciding how somebody keeps their folder.
 *
 * `.git` is tested with `existsSync` rather than as a directory, because a
 * worktree and a submodule both have a `.git` FILE that points elsewhere, and
 * both are repositories for every purpose this cares about.
 *
 * It stops at the filesystem root, and it stops at the first `.git` it finds:
 * the nearest repository is the one whose `git status` would show the folder.
 */
function inARepository(root: string): boolean {
  let at = root
  for (;;) {
    if (existsSync(join(at, '.git'))) return true
    const up = dirname(at)
    if (up === at) return false
    at = up
  }
}

/** The project, resolved — or null for "no project", or a sentence for a refusal. */
function projectRoot(projectPath: string | null | undefined): { path: string } | { trouble: string } | null {
  if (typeof projectPath !== 'string') return null
  const raw = projectPath.trim()
  if (!raw) return null
  if (raw.length > 4096) return { trouble: 'that project path is longer than any path on this machine can be.' }
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return { trouble: 'that project path has a control character in it, and no real path does.' }
    }
  }
  if (!isAbsolute(raw)) {
    return {
      trouble:
        `"${raw}" is not an absolute path. A project is somewhere on this machine, and a relative path would be `
        + 'resolved against whatever directory this app happens to have been started in.',
    }
  }
  let resolved: string
  try {
    resolved = realpathSync(raw)
    if (!statSync(resolved).isDirectory()) {
      return { trouble: `"${raw}" is not a folder, so there is nowhere under it to keep anything.` }
    }
  } catch {
    return { trouble: `there is no folder at "${raw}" on this machine, so nothing can be read or written under it.` }
  }
  return { path: resolved }
}

/**
 * The project as this app names it to itself: absolute, real, no trailing
 * slash — or `null` when there is no project, or when the path is refused.
 *
 * Exported because the write ticket is derived from it; see `doors.ts`. Two
 * spellings of one project — `/p`, `/p/`, a symlink that lands on `/p` — have
 * to produce one ticket, or a page that named its project slightly differently
 * from the last time would find its writes refused for a reason nobody could
 * see from either side.
 */
export function projectOf(projectPath: string | null | undefined): string | null {
  const root = projectRoot(projectPath)
  return root !== null && 'path' in root ? root.path : null
}

/** The fence: a sentence if `child` is not really under `root`, null if it is. */
function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so this app will not write through it.`
  }
  if (within(root, real)) return null
  return (
    `${child} resolves to ${real}, which is outside the project it claims to be inside. Nothing has been read or `
    + 'written: a folder that points somewhere else is how one project’s data ends up in another’s, and it is refused '
    + 'rather than followed.'
  )
}

/* ------------------------------------------------------------------ *
 * A slug is a name, not a path — and now it cannot become one
 * ------------------------------------------------------------------ */

const SLUG = /^[a-z0-9-]{1,80}$/

/**
 * The one check every read and write in this file runs first.
 *
 * ## The reason changed; the check did not
 *
 * It used to be a fence around the filesystem. A slug became a FILENAME —
 * `data/<slug>.json` — so `../../etc/passwd` was a traversal waiting for
 * somebody to forget the check at one new call site, and the class of
 * characters was chosen for having no way out of a directory.
 *
 * A slug is now a KEY in one document. There is no join, no filename, and
 * nothing a slug can be that would leave the folder — the traversal is not
 * refused, it is unsayable. That is a strictly stronger position than the one
 * the old check defended, and it is the main reason one file beat fourteen.
 *
 * The check stays, for the three reasons that survive:
 *
 *  - A key is a string a caller chose, and a store keyed by strings a caller
 *    chose is one missing `Object.hasOwn` away from answering with
 *    `constructor`. The protocol package's essay on `MODULE_ID` is about this
 *    exact hazard; this pattern refuses those names, and `journeyIn` asks the
 *    object rather than its prototype anyway.
 *  - It bounds what goes on screen and into a JSON key before either has to
 *    carry it.
 *  - The host's `epic` obeys the same pattern, and a slug this app accepted
 *    that a host would refuse is a journey nothing can ever point at.
 *
 * The callers are still a browser, an agent over MCP, and whatever else on this
 * machine found the port — loopback is a fence around the machine, not around
 * the programs on it.
 */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value)
}

/* ------------------------------------------------------------------ *
 * The schema
 * ------------------------------------------------------------------ */

const ref = z.string().min(1)

/*
 * The word limit on a step body is not here. It is in `limits.ts`, which this
 * file does not import and does not need to: the schema below does not enforce
 * it, because the limit bites on the write path only and `doors.ts` is the
 * write path. It lives in a file of its own because the EDITOR needs the same
 * number — it counts words into a box beside the textarea — and the editor runs
 * in a browser, which cannot import a module that reads directories. A second
 * copy of the number over there is a counter that eventually says "148 / 150"
 * over prose the store is about to refuse.
 */

export const stepSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  /** Issues and changes that deliver this step. */
  refs: z.array(ref).default([]),
  /** Free-text chips for work with no ticket ("ingest already built"). */
  notes: z.array(z.string()).default([]),
})

/**
 * Where a journey's steps come from, when they do not come from here.
 *
 * **This is the most important field in this app**, and it exists because of a
 * bug the roadmap's own bridge had on the morning this was written: it reported
 * a journey as having no steps while the page beside it drew twenty.
 *
 * Three journeys in the shipped set — `an-action-is-one-thing`,
 * `page-is-components` and `modes-are-modules` — carry `"steps": []` and are
 * not journeys with no steps. Their steps are the sections of their PAPER, and
 * something else projects them out of LaTeX at read time. This app cannot parse
 * a paper and should not learn how: a journeys app that grew a LaTeX parser
 * would have taken on somebody else's material to avoid admitting it could not
 * see it.
 *
 * So the distinction is stored rather than guessed. An empty `steps` array
 * means one of two completely different things, and no reader can tell which
 * from the array:
 *
 *   - `stepsFrom` absent  — nobody has written any steps yet. **Nothing to
 *     show.** The page invites somebody to write the first one.
 *   - `stepsFrom` present — the steps exist and are projected somewhere this
 *     app cannot read. **Cannot see from here.** The page says exactly that,
 *     names the file, and offers no editing, because an editor over a
 *     projection would write a second copy of a decision and nobody would be
 *     told which half is current.
 *
 * It is also set on journeys that DO have stored steps and also have a paper.
 * There, the stored steps are real and are drawn — with a standing note that a
 * paper beside them projects a different set, which another reader may be the
 * one seeing. Two answers on one screen is bad; two answers on two screens with
 * neither saying so is worse.
 */
export const stepsFromSchema = z.object({
  /** What does the projecting. `paper` is the only one that exists today. */
  projector: z.string().min(1),
  /** Where the source is, as a person would go and look at it. */
  where: z.string().min(1),
  /** Said on screen, in this journey's own words. */
  why: z.string().default(''),
})

export const quizSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string()).min(2),
    answer: z.number().int().min(0),
    why: z.string().default(''),
    ref: z.string().optional(),
    passage: z
      .object({
        path: z.string().min(1),
        srcStart: z.number().int().min(0),
        srcEnd: z.number().int().min(0),
        quote: z.string().min(1),
      })
      .optional(),
  })
  /* Carried, not rendered: quizzes are the Learning app's. Held loosely on
     purpose — the refinement the roadmap puts on `passage` is a rule about
     material this app never draws, and enforcing somebody else's invariant on
     the read path is how a store refuses to open a file it has no opinion
     about. */
  .passthrough()

export const journeySchema = z.object({
  slug: z.string().regex(SLUG, 'lowercase, digits and dashes only'),
  title: z.string().min(1),
  /** The one-line answer to "what is this page about". */
  lede: z.string().default(''),
  /** The tracking issue that stands for the journey, e.g. "#2151". */
  umbrella: z.string().optional(),
  /** Shown under the title; the date the narrative was last thought through. */
  written: z.string().optional(),
  /** Short label for the tab. Falls back to the title. */
  tab: z.string().optional(),
  /** The product this journey belongs to, as a person would name it. */
  project: z.string().optional(),
  /** Leading callout, rendered above the journey. */
  callout: z.string().default(''),
  steps: z.array(stepSchema).default([]),
  /** See `stepsFromSchema`. Absent means the steps here are the steps. */
  stepsFrom: stepsFromSchema.optional(),
  /** Bulleted "what already exists, so we don't rebuild it". */
  exists: z.array(z.string()).default([]),
  /** The red callout: what is assumed but not built. */
  missing: z.string().default(''),
  order: z
    .array(z.object({ when: z.string().min(1), what: z.string().min(1), why: z.string().default('') }))
    .default([]),
  /** Bulleted "still open" questions. */
  open: z.array(z.string()).default([]),
  quizzes: z.array(quizSchema).default([]),
  vocabulary: z.array(z.object({ term: z.string().min(1), means: z.string().min(1) })).default([]),
  /** ref -> what must land first. Values may be gates outside every tracker. */
  blockedBy: z.record(z.string(), z.array(ref)).default({}),
  /** Decision issues no commit will close, answered by these changes instead. */
  settledBy: z.record(z.string(), z.array(ref)).default({}),
  /** Refs that hold other work rather than being work: umbrellas, parents. */
  containers: z.array(ref).default([]),
  people: z.array(z.string()).default([]),
  owners: z
    .record(z.string(), z.object({ maker: z.string().optional(), reviewer: z.string().optional() }))
    .default({}),
  groups: z.array(z.object({ heading: z.string(), refs: z.array(ref) })).default([]),
  /** Extra refs to track that the narrative never mentions. */
  watch: z.array(ref).default([]),
  /** The GitHub repo a bare `gh#41` belongs to. */
  repo: z.string().optional(),
  branches: z
    .object({
      development: z.string().min(1).default('development'),
      prod: z.string().min(1).default('prod'),
    })
    .nullable()
    .optional(),
  board: z.object({ org: z.string(), number: z.number().int() }).optional(),
})

export type Journey = z.infer<typeof journeySchema>
export type Step = z.infer<typeof stepSchema>
export type StepsFrom = z.infer<typeof stepsFromSchema>

/**
 * The whole file: every journey in one project, keyed by slug.
 *
 * ## Why one file replaced fourteen
 *
 * The convention this app now follows names ONE file per module per project —
 * `<projectPath>/.kehikot/journeys/journeys.json` — and it is a convention rather than a
 * preference because four modules each inventing their own layout is four
 * layouts in a folder a person is meant to be able to open and read. A
 * directory of fourteen files under `.kehikot/` would also be a directory this
 * app has to own the contents of: every `readdir` there is a question about
 * what somebody else's file is doing in it, and the answer "ignore anything
 * that does not parse" is how a journey with a typo in it silently stops
 * existing.
 *
 * The sharper reason is the one in `isSlug`: with a document, a slug is a KEY.
 * It never becomes a path, so it cannot leave a directory, so the traversal the
 * old code refused is not refused but unsayable. Moving a check into the shape
 * is worth more than the check, because a shape cannot be forgotten at a new
 * call site.
 *
 * The cost is honest and worth naming: a write rewrites the whole document
 * rather than one journey's file, so two writers in the same millisecond would
 * have the last one win whole rather than each keeping their own file. This is
 * a loopback app with one process; `writeJourney` re-reads immediately before
 * it writes to narrow the window, and if this ever stops being one process the
 * answer is a lock, not fourteen files.
 *
 * `version` is here so the NEXT change to this shape has something to branch
 * on. It is read loosely on purpose — a document from a future version is
 * opened rather than refused, because refusing would leave somebody unable to
 * read their own journeys with the older program they happen to have running,
 * and every field this version knows about is still where it was.
 */
const documentSchema = z.object({
  version: z.number().int().min(1).default(1),
  journeys: z.record(z.string(), journeySchema).default({}),
})

export type Document = z.infer<typeof documentSchema>

/* ------------------------------------------------------------------ *
 * Nothing seeds itself any more
 *
 * There used to be a `seedIfEmpty()` here, called before the first request. It
 * copied every journey in `seed/` into the store whenever the store was empty,
 * and the argument for it was decent: an app whose first screen is empty has to
 * be BELIEVED about the emptiness, and nobody starting a journeys app for the
 * first time believes it.
 *
 * That argument dies with the move, and it is worth spelling out why rather
 * than just deleting the function.
 *
 * The store used to be this app's own directory — one store, on this machine,
 * belonging to whoever installed the program. Filling it with the journeys the
 * program ships with was a program furnishing its own house. The store is now a
 * folder inside SOMEBODY ELSE'S REPOSITORY, and "empty" is a fact about their
 * project rather than about this installation. An automatic seed would mean:
 * open the container on any project on the machine, and thirteen of the roadmap's
 * own journeys — `the-roadmap-tracks-itself`, `modes-are-modules`, fifty
 * kilobytes of somebody's narrative about a different codebase — appear inside
 * it, get written to `.kehikot/journeys/journeys.json` there, and are then the answer
 * this app gives about that project forever. Nothing would have gone wrong on
 * screen. The container would look full and correct, and every journey in it would
 * be about another repository.
 *
 * So: a project with no journeys has no journeys, and the page says exactly
 * that. It is the honest first screen, and unlike the old empty screen it is
 * TRUE of the thing the reader is looking at rather than true of an
 * installation.
 *
 * `seed/` stays in the repository — it is tracked, hand-written material and
 * deleting it would lose it. What it no longer is, is reachable by reading.
 * `dev/seed.ts` puts it into a project a person names on a command line, which
 * is the same journeys arriving by somebody's decision instead of by a page
 * being opened.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * What this app holds for one project, and why it holds nothing when it does.
 *
 * ## Four states, and each of them says something different
 *
 * - `nowhere` — no project is open. Not a fault, not an error, and not an empty
 *   store either: an empty store is a thing you may write into, and this is not
 *   one. Every write path refuses on it.
 * - `trouble` — a project was named and this app will not read or write under
 *   it: the folder is not there, the path is relative, the `.kehikot` resolves
 *   somewhere else, or the file will not parse.
 * - neither, and `journeys` empty — a real project with no journeys yet. This
 *   IS writable, and it is the honest first screen for a project nobody has
 *   written a journey in.
 * - neither, and `journeys` full — the ordinary case.
 *
 * ## A file that will not parse is not an empty store
 *
 * The most important line in this file. Every journey is authored — a person
 * wrote every step and every sentence around it — so "there is nothing here"
 * and "this could not be read" must never look the same on screen, and a
 * program that returned empty for a broken file would WRITE over it on the
 * first save and destroy the recoverable original.
 *
 * The old code threw instead, which was the right instinct with the wrong blast
 * radius: it threw out of a request handler, so one unparseable journey took
 * the container down rather than explaining itself. A sentence saying the file is
 * recoverable is what stops somebody deleting the directory.
 */
export interface Held {
  /** Every journey in this project, by slug. Empty when there is nowhere to read. */
  journeys: Record<string, Journey>
  /** The file they came from, or null when there is none. */
  from: string | null
  /** No project is open. Not a fault; see above. */
  nowhere: boolean
  /** A project was named and this app will not read or write under it. */
  trouble: string | null
}

export function held(projectPath: string | null | undefined): Held {
  const { path, trouble } = dataFile(projectPath)
  if (trouble) return { journeys: {}, from: null, nowhere: false, trouble }
  if (path === null) return { journeys: {}, from: null, nowhere: true, trouble: null }
  if (!existsSync(path)) return { journeys: {}, from: path, nowhere: false, trouble: null }

  try {
    const parsed = documentSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    /* A key that is not a slug is dropped rather than refused, and this is the
       one place in the read that shrugs. A hand-edited file with a stray key is
       not a corrupt store, and taking a whole project's journeys away over one
       is a worse answer than ignoring it — the journey it named could never be
       opened anyway, because every door asks `isSlug` before it asks for it. */
    const journeys: Record<string, Journey> = {}
    for (const [slug, journey] of Object.entries(parsed.journeys)) {
      if (isSlug(slug)) journeys[slug] = journey
    }
    return { journeys, from: path, nowhere: false, trouble: null }
  } catch (e) {
    return {
      journeys: {},
      from: path,
      nowhere: false,
      trouble:
        `${path} could not be read (${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}), so no `
        + 'journey is being shown and nothing will be written over it. Every step and every sentence in that file is '
        + 'recoverable: fix or move it.',
    }
  }
}

/** Every slug this project holds, sorted, so a list is the same list twice running. */
export function slugs(store: Held): string[] {
  return Object.keys(store.journeys).sort()
}

/**
 * One journey out of what was read, or null.
 *
 * Takes the `Held` rather than the path on purpose. A version of this that took
 * a path would answer `null` for "no such journey", for "no project is open"
 * and for "the file will not parse" alike — three situations that send a reader
 * to three different places — and every caller would have to go and ask a
 * second time to find out which of them it was in.
 */
export function journeyIn(store: Held, slug: string): Journey | null {
  if (!isSlug(slug)) return null
  return Object.hasOwn(store.journeys, slug) ? (store.journeys[slug] ?? null) : null
}

/** Every journey in this project, by title, for a list somebody reads. */
export function listJourneys(store: Held): Journey[] {
  return slugs(store)
    .map((slug) => store.journeys[slug])
    .filter((j): j is Journey => Boolean(j))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * The sentence for "there is no project open", written once.
 *
 * One string, because it is said by every write door and drawn on the page, and
 * a refusal worded three ways reads as three different problems.
 */
export const NOWHERE =
  'no project is open, so there is nowhere to keep this. A journey lives in the project it is about, at '
  + '.kehikot/journeys/journeys.json inside it, and this app will not guess which project was meant — a guess writes '
  + 'somebody’s journey into a folder they will never look in, and says it saved. Open a project on this canvas, or '
  + 'name one.'

export type Written = { ok: true; journey: Journey } | { ok: false; error: string }

/**
 * Put one journey into this project's document, whole.
 *
 * Re-reads immediately before it writes, deliberately. The caller is holding a
 * `Held` from a moment ago and the document has thirteen other journeys in it;
 * writing from the caller's copy would mean any change made in between — by the
 * other door, by an agent — is silently reverted by whoever saved second.
 *
 * Refuses on `nowhere` and on `trouble` rather than writing. Writing into
 * nowhere is the failure this whole file was rearranged to prevent; writing
 * over a file that would not parse is the one that destroys something.
 */
export function writeJourney(projectPath: string | null | undefined, journey: Journey): Written {
  const parsed = journeySchema.parse(journey)

  const store = held(projectPath)
  if (store.nowhere) return { ok: false, error: NOWHERE }
  if (store.trouble) return { ok: false, error: `nothing was written. ${store.trouble}` }

  const made = makeDir(projectPath)
  if (made.trouble) return { ok: false, error: `nothing was written. ${made.trouble}` }
  if (made.dir === null) return { ok: false, error: NOWHERE }

  /* `dataFile` again rather than `store.from`, because `makeDir` has just
     created the directory and the fence has to be asked about the thing that
     now exists — not about the absence that was there when the read happened. */
  const { path, trouble } = dataFile(projectPath)
  if (trouble) return { ok: false, error: `nothing was written. ${trouble}` }
  if (path === null) return { ok: false, error: NOWHERE }

  const document: Document = { version: 1, journeys: { ...store.journeys, [parsed.slug]: parsed } }
  writeFileSync(path, `${JSON.stringify(documentSchema.parse(document), null, 2)}\n`)
  return { ok: true, journey: parsed }
}

/* ------------------------------------------------------------------ *
 * The one question this app answers differently from everybody else
 * ------------------------------------------------------------------ */

export type Plan =
  /** The steps are here, and they are the steps. */
  | { kind: 'stored'; steps: Step[]; alsoProjected: StepsFrom | null }
  /** There are steps, somewhere this app cannot read. Never "none". */
  | { kind: 'elsewhere'; from: StepsFrom }
  /** Nobody has written any. Genuinely none, and that is a fact worth saying. */
  | { kind: 'none' }

/**
 * What this app can honestly say about a journey's steps.
 *
 * Three answers, not two, and the middle one is the whole reason this function
 * is not a property access. "Nothing to show" and "cannot see from here" look
 * identical in an empty array and send a reader to opposite places: one to
 * write a step, one to go and read a paper. Collapsing them is exactly the bug
 * this app exists to not have.
 */
export function planOf(journey: Journey): Plan {
  if (journey.steps.length) {
    return { kind: 'stored', steps: journey.steps, alsoProjected: journey.stepsFrom ?? null }
  }
  if (journey.stepsFrom) return { kind: 'elsewhere', from: journey.stepsFrom }
  return { kind: 'none' }
}

/**
 * Why a step may not be written here, or null.
 *
 * A sentence rather than a boolean, because the refusal has to say where to
 * write instead — a tool that says only "no" leaves somebody with a decision
 * they cannot record anywhere, and the next thing they do is write it twice.
 *
 * Refused only where the steps are projected AND nothing is stored. A journey
 * with both keeps its stored steps editable: they are real, somebody wrote
 * them, and refusing to let them be corrected because a paper exists beside
 * them would strand material this app is the owner of.
 */
export function refusedBecauseElsewhere(journey: Journey): string | null {
  const plan = planOf(journey)
  if (plan.kind !== 'elsewhere') return null
  return (
    `${journey.slug} keeps its steps in ${plan.from.where}, projected from there by ${plan.from.projector}. ` +
    'Writing one here would be a second copy of the same decision, and nobody would be told which half is ' +
    `current. Edit ${plan.from.where}; the step follows.`
  )
}

/** Every ref a journey names, deduplicated, in the order they are met. */
export function refsOf(journey: Journey): string[] {
  const out: string[] = []
  const add = (r?: string) => {
    const t = (r ?? '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  add(journey.umbrella)
  for (const s of journey.steps) s.refs.forEach(add)
  for (const g of journey.groups) g.refs.forEach(add)
  for (const list of Object.values(journey.blockedBy)) list.forEach(add)
  for (const list of Object.values(journey.settledBy)) list.forEach(add)
  journey.containers.forEach(add)
  journey.watch.forEach(add)
  return out
}
