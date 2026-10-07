import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

import {
  KEHIKOT_DIR,
  journeyGroupSchema,
  journeyRecordSchema,
  journeyStepSchema,
  journeysDocumentSchema,
  moduleDir,
  moduleFile,
  stepsFromSchema as recordStepsFromSchema,
  stepsOf,
  within,
} from 'kehikot-module-protocol'

import { ID } from './manifest.ts'

/**
 * The journeys, on disk, inside the project they are about.
 *
 * ## The departure this file is
 *
 * Kehikot's own `docs/modules.md` — in the repository this app was
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
 * credentialed tracker reading, and the reference list.**
 *
 * For a long time that paragraph ended by saying somebody had to decide which
 * of the two documents was right, and that nothing here decided it. It was
 * true, and it had a cost that showed up exactly where it was bound to: the
 * host kept a file per epic as well, nothing kept the two in step, and in one
 * real project they came apart — nine steps in the host's copy and twelve in
 * this one — with every answer correct about the copy it happened to read.
 *
 * **It has been decided, by the owner, and this is the decision:**
 *
 * - **This app owns the steps, the groups (which a host reads as an epic's
 *   parts) and the prose around them.**
 * - **A host owns the epic's slug, its title, and whether it exists.**
 * - A host reads the steps and the groups out of THIS file, and falls back to
 *   the file it keeps itself only when a project has no record under that
 *   slug.
 *
 * Three things in this file follow from it, and none of them is optional any
 * more. The shape of a record is no longer this app's private business: a
 * host reads it, so it is written down in `kehikot-module-protocol`
 * (`journey.ts`) and the schemas below are BUILT ON that one rather than
 * restated beside it. Nothing this app does not understand may be dropped on
 * a save, because the other reader's fields are in the same file; see
 * `writeJourney`. And a record that does not exist yet has to be made from
 * what the host holds rather than from nothing, because the moment a record
 * exists the host stops reading its own — an empty one would hide every step
 * the host had; see `createJourney`.
 *
 * The reason it is arguable at all is the reason gh#131 exists. A journeys
 * panel that read its own steps over a bridge would not have left; it would be
 * a viewer of a store it does not own, mounted through a tab. The test of "the
 * Kehikot is a host" is whether the panel it is NAMED after can hold its own
 * material and still be an ordinary module, and it cannot be that while the
 * material stays behind. This repository existing at all is that test being
 * taken: the code is here, the store is here, and the host is reached only for
 * what the trackers say (`tracker.get`) and the presses only a host can carry.
 *
 * ## The schema
 *
 * It used to be copied from Kehikot's own epic schema rather than imported,
 * and the copy was defended here as the point: an app that reached into a
 * host's internals would stop building the day that host reorganised a file.
 * That argument is still right about a host's INTERNALS. It stopped covering
 * this schema the day a host began reading this file, because a format two
 * programs read and each spell for themselves is two formats with a delay.
 *
 * So the part a host reads — slug, title, lede, steps, groups, `stepsFrom`,
 * the lists it counts — is the protocol package's `journeyRecordSchema`, and
 * what is written below is that schema EXTENDED with what is this app's alone:
 * the callout, what blocks what, what settles what, the order of work. The
 * SLUG is the protocol's `EPIC_SLUG` for the same reason it always was: the
 * host's `epic` and this file's `slug` are one name for one thing, and a
 * journey whose slug matches no epic simply never gets pointed at.
 *
 * ## What is carried but not drawn, and what is carried without being known
 *
 * `quizzes` and `vocabulary` are the Learning app's material and `owners` is
 * the ownership table's. They are in the schema and written back untouched.
 * `groups` used to be on that list and no longer is: a host reads a group as a
 * PART of the epic, a step may say which part it is in (`part`), and a group
 * may carry the `id` that names it.
 *
 * And every object here is `.passthrough()`, at every level. That is not
 * politeness. These schemas were plain `z.object` once, which STRIPS what it
 * does not name, and `writeJourney` rebuilt the whole document from what it
 * had parsed — so the first save of any step, by anybody, would have deleted
 * `part` from every step and `id` from every group in the project, and every
 * field a newer version of anything had added, in journeys nobody had opened.
 * A store that silently dropped a field on the first edit would destroy
 * somebody's work to make a point about boundaries; a store that drops fields
 * it has never heard of does the same thing without even the point.
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
 * joins are `kehikot-module-protocol`'s, deliberately, because four modules
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

  /*
   * This used to append `.kehikot/` to the project's `.gitignore` on the run
   * that created the folder, and it no longer does. The host owns that decision.
   *
   * Four programs used to write that one line in somebody else's repository —
   * this module, notes, checklist, and learning's migration — none of them able
   * to take it back, none aware of the others, and the rule appearing the first
   * time a module happened to save something, which is not a moment anybody
   * witnesses. The user's word for it: modules should not decide if the kehikot
   * folder is gitignored.
   *
   * It is a checkbox in the host now, per project, written in one place. See
   * `shareKehikot` in the host's `server/projects.ts`, and
   * `withoutKehikotIgnored` in the protocol — the half that was missing, which
   * is why this could only ever be turned on.
   *
   * The walk up to find the repository was right and is not lost: the host does
   * it, for the reason stated here, about the same thesis.
   */
  void fresh
  return { dir, trouble: null }
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

/**
 * One step: the protocol's, as it is.
 *
 * `title`, `body`, `refs`, `notes`, and `part` — the id of the part the step
 * was assigned to, optional, and read with `stepPart` rather than trusted.
 * Passthrough, so a field this version has never heard of is still on the step
 * when it is written back.
 */
export const stepSchema = journeyStepSchema

/**
 * Where a journey's steps come from, when they do not come from here.
 *
 * **This is the most important field in this app**, and it exists because of a
 * bug Kehikot's own bridge had on the morning this was written: it reported
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
 *
 * The shape is the protocol's now, because a host reads this field too: it is
 * what stops a host answering `steps.list` with "none" for an epic whose steps
 * are a paper's sections.
 */
export const stepsFromSchema = recordStepsFromSchema

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
      .passthrough()
      .optional(),
  })
  /* Carried, not rendered: quizzes are the Learning app's. Held loosely on
     purpose — the refinement Kehikot puts on `passage` is a rule about
     material this app never draws, and enforcing somebody else's invariant on
     the read path is how a store refuses to open a file it has no opinion
     about. */
  .passthrough()

/**
 * One journey: the record a host reads, and what is this app's alone beside it.
 *
 * `journeyRecordSchema` brings `slug`, `title`, `lede`, `project`, `umbrella`,
 * `steps`, `stepsFrom`, `groups`, `exists` and `open`, each with the default
 * and the looseness the protocol's essay argues for. Everything below is added
 * to it. `extend` keeps the passthrough, and every object added here asks for
 * it again by name — a nested `z.object` strips on its own account whatever
 * its parent does.
 */
export const journeySchema = journeyRecordSchema.extend({
  /** Shown under the title; the date the narrative was last thought through. */
  written: z.string().optional(),
  /** Short label for the tab. Falls back to the title. */
  tab: z.string().optional(),
  /** Leading callout, rendered above the journey. */
  callout: z.string().default(''),
  /** The red callout: what is assumed but not built. */
  missing: z.string().default(''),
  order: z
    .array(z.object({ when: z.string().min(1), what: z.string().min(1), why: z.string().default('') }).passthrough())
    .default([]),
  quizzes: z.array(quizSchema).default([]),
  vocabulary: z.array(z.object({ term: z.string().min(1), means: z.string().min(1) }).passthrough()).default([]),
  /** ref -> what must land first. Values may be gates outside every tracker. */
  blockedBy: z.record(z.string(), z.array(ref)).default({}),
  /** Decision issues no commit will close, answered by these changes instead. */
  settledBy: z.record(z.string(), z.array(ref)).default({}),
  /** Refs that hold other work rather than being work: umbrellas, parents. */
  containers: z.array(ref).default([]),
  people: z.array(z.string()).default([]),
  owners: z
    .record(z.string(), z.object({ maker: z.string().optional(), reviewer: z.string().optional() }).passthrough())
    .default({}),
  /**
   * A heading and the references under it, which a host reads as a PART of the
   * epic. `id`, when it is written, is what a step's `part` names.
   */
  groups: z.array(journeyGroupSchema).default([]),
  /** Extra refs to track that the narrative never mentions. */
  watch: z.array(ref).default([]),
  /** The GitHub repo a bare `gh#41` belongs to. */
  repo: z.string().optional(),
  branches: z
    .object({
      development: z.string().min(1).default('development'),
      prod: z.string().min(1).default('prod'),
    })
    .passthrough()
    .nullable()
    .optional(),
  board: z.object({ org: z.string(), number: z.number().int() }).passthrough().optional(),
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
 *
 * The protocol's `journeysDocumentSchema`, with this app's fuller record in
 * place of the one a host reads. Passthrough like everything under it: a key
 * beside `version` and `journeys` that this version has never heard of is
 * somebody's, and `writeJourney` writes it back.
 */
const documentSchema = journeysDocumentSchema.extend({
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
 * open the container on any project on the machine, and thirteen of Kehikot's
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
  return read(projectPath).held
}

/**
 * The file read ONCE, two ways: what this app understands of it, and what is
 * actually in it.
 *
 * `held` is the first and is what every reader gets. `raw` is the second —
 * the document exactly as `JSON.parse` returned it, null when there is no file
 * yet or none that could be read — and it exists for `writeJourney` alone,
 * which writes the one record it was handed into THAT and not into a document
 * rebuilt from the parse. Both come from one `readFileSync`, because two reads
 * of one file are two different files if anything writes between them.
 */
function read(projectPath: string | null | undefined): { held: Held; raw: Record<string, unknown> | null } {
  const { path, trouble } = dataFile(projectPath)
  if (trouble) return { held: { journeys: {}, from: null, nowhere: false, trouble }, raw: null }
  if (path === null) return { held: { journeys: {}, from: null, nowhere: true, trouble: null }, raw: null }
  if (!existsSync(path)) return { held: { journeys: {}, from: path, nowhere: false, trouble: null }, raw: null }

  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const parsed = documentSchema.parse(raw)
    /* A key that is not a slug is dropped rather than refused, and this is the
       one place in the read that shrugs. A hand-edited file with a stray key is
       not a corrupt store, and taking a whole project's journeys away over one
       is a worse answer than ignoring it — the journey it named could never be
       opened anyway, because every door asks `isSlug` before it asks for it. */
    const journeys: Record<string, Journey> = {}
    for (const [slug, journey] of Object.entries(parsed.journeys)) {
      if (isSlug(slug)) journeys[slug] = journey
    }
    /* `documentSchema` has just accepted it, so it is an object. */
    return { held: { journeys, from: path, nowhere: false, trouble: null }, raw: raw as Record<string, unknown> }
  } catch (e) {
    return {
      held: {
        journeys: {},
        from: path,
        nowhere: false,
        trouble:
          `${path} could not be read (${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}), so no `
          + 'journey is being shown and nothing will be written over it. Every step and every sentence in that file is '
          + 'recoverable: fix or move it.',
      },
      raw: null,
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
 * Put one journey into this project's document, whole — and touch nothing
 * else in it.
 *
 * Re-reads immediately before it writes, deliberately. The caller is holding a
 * `Held` from a moment ago and the document has thirteen other journeys in it;
 * writing from the caller's copy would mean any change made in between — by the
 * other door, by an agent — is silently reverted by whoever saved second.
 *
 * Refuses on `nowhere` and on `trouble` rather than writing. Writing into
 * nowhere is the failure this whole file was rearranged to prevent; writing
 * over a file that would not parse is the one that destroys something.
 *
 * ## One record goes in. Everything else is the bytes that were there.
 *
 * This used to build `{ version: 1, journeys: { ...everything parsed } }` and
 * write that. It read as careful and it was the opposite: every OTHER journey
 * in the file was written back as this version's parse of it, so a save to one
 * step rewrote thirteen journeys nobody had touched — filling in defaults they
 * had never carried, and, while the schemas still stripped, deleting every
 * field this version did not name. A host reads this file now. Its fields and
 * a newer writer's fields are in it beside this app's.
 *
 * So the record being saved is placed into the document AS IT WAS READ OFF
 * THE DISK, key by key: the other journeys are not re-serialised from a parse
 * but carried as the JSON they were, a key that is not a slug is still there
 * afterwards, and so is anything beside `version` and `journeys`. The record
 * that IS being saved is written as this version parses it — its defaults
 * filled in, with whatever the schema does not name still on it, because the
 * schema passes it through — and with its keys in the order the file had them
 * rather than the schema's; see `inTheOrderOf`.
 *
 * A save of an unchanged journey therefore changes nothing in the file: not a
 * value, and for a file this app wrote, not a byte. A record that was missing
 * a default gains it, at the end. `test/round-trip.test.ts` holds it to that.
 *
 * The result is checked once more before it is written. It cannot fail — the
 * document parsed a moment ago and the record has just parsed — and a write
 * path is where "cannot" is worth one more line.
 */
export function writeJourney(projectPath: string | null | undefined, journey: Journey): Written {
  const parsed = journeySchema.parse(journey)

  const { held: store, raw } = read(projectPath)
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

  const before = raw ?? {}
  const others =
    before.journeys && typeof before.journeys === 'object' && !Array.isArray(before.journeys)
      ? (before.journeys as Record<string, unknown>)
      : {}
  /* Whatever the file holds, in the file's order: the record keeps its place
     among its neighbours, and a new one goes at the end. `version` is written
     into a document this call is CREATING and into no other. One real file
     has none — it is read as 1, loosely, like everything about that field —
     and a save that added the key would be this app editing a line of a
     document nobody asked it to touch. */
  const record = inTheOrderOf(others[parsed.slug], parsed)
  const document = { ...(raw === null ? { version: 1 } : {}), ...before, journeys: { ...others, [parsed.slug]: record } }
  documentSchema.parse(document)
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
  return { ok: true, journey: parsed }
}

/**
 * `now`, with its keys in the order `was` had them, all the way down.
 *
 * A parse hands a record back with its keys in the SCHEMA's order, and the
 * schema's order is an accident of how this file happens to be written: the
 * day the schemas were rebuilt on the protocol's, `project` and `groups`
 * moved ahead of `written` and `callout` in every parsed record. Written out
 * like that, the first save of a step would have shown up in somebody's
 * `git diff` as five fields of their journey moving past each other — a
 * hundred-line change for a one-word edit, in a hand-written document with
 * their name on the commit.
 *
 * So the file's order wins. Keys the record already had stay where they were,
 * keys it has gained go after them, and nothing about a VALUE is touched:
 * this arranges, it does not merge. Lists are walked by position, which is
 * right for the common case and harmless for the other — a step inserted in
 * the middle borrows the key order of the step that used to be there, and
 * every step in a file has the same one.
 */
function inTheOrderOf(was: unknown, now: unknown): unknown {
  if (Array.isArray(now)) {
    const before = Array.isArray(was) ? was : []
    return now.map((one, i) => inTheOrderOf(before[i], one))
  }
  if (!now || typeof now !== 'object') return now
  const before = was && typeof was === 'object' && !Array.isArray(was) ? (was as Record<string, unknown>) : {}
  const given = now as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(before)) {
    if (Object.hasOwn(given, key)) out[key] = inTheOrderOf(before[key], given[key])
  }
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(out, key)) out[key] = inTheOrderOf(undefined, given[key])
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Beginning a journey for an epic that has none
 * ------------------------------------------------------------------ */

/**
 * Where a host keeps its own file for an epic: `kehikko`, and `roadmap` from
 * before the host was renamed, which it still reads where the new folder is
 * not there.
 *
 * These two words are a host's, spelled in a module, and that is exactly the
 * thing the protocol's `journey.ts` argues against — so it is said plainly
 * rather than tucked away. They are read by `hostEpic` below and by nothing
 * else, once, at the moment a record is first made. If the protocol package
 * comes to name the host's folder, this is the line that becomes an import.
 */
const HOST_FOLDERS = ['kehikko', 'roadmap'] as const

export type HostEpic =
  /** No host has a file for that epic in this project, in either place a host keeps one. */
  | { found: 'none'; looked: string[] }
  /** There is a file and it could not be read as one JSON object. */
  | { found: 'unreadable'; path: string }
  | { found: 'epic'; path: string; epic: Record<string, unknown> }

/**
 * The host's own file for one epic, read once, for a handover.
 *
 * ## The one read this app makes of somebody else's file, and why it is allowed
 *
 * Everything else in this file confines itself to `.kehikot/journeys/`. This
 * reads `.kehikot/kehikko/epics/<slug>.json`, which is a host's, and it does
 * so for one purpose: `createJourney`, when there is no host to ASK.
 *
 * The page has one. Framed, it asks `epic.get` and hands the answer over, and
 * that is the better source — it is the host's own word about what it holds,
 * wherever the host keeps it. The MCP door has no host. An agent names a
 * project path and a slug and that is all there is. The three things that door
 * could do instead of this were each worse:
 *
 *  - **Make an empty record.** The moment a record exists the host reads IT
 *    and stops reading its own file. Nine steps somebody wrote would vanish
 *    from every module on the canvas, replaced by a journey with none, with
 *    the file that still holds them sitting untouched on disk and nothing
 *    reading it. That is the failure this whole change exists to end, caused
 *    by the tool that was meant to end it.
 *  - **Refuse, and send the agent to the page.** An agent cannot press a
 *    button, and "create a journey" is the first thing one is asked to do in a
 *    project that has epics and no journeys.
 *  - **Take the steps as arguments.** Then the agent reads the host's file
 *    itself and retypes it, which is this read done by a program that has
 *    never seen the schema.
 *
 * So the handover reads what is being handed over. It is read-only, it
 * happens once per journey, the path is fenced the way every path here is —
 * resolved, and refused if it lands outside the project — and nothing is ever
 * written there: the host's file stays exactly as it was, and stays the
 * host's fallback for any project where this record is later removed.
 */
export function hostEpic(projectPath: string | null | undefined, slug: string): HostEpic {
  const root = projectRoot(projectPath)
  if (root === null || 'trouble' in root || !isSlug(slug)) return { found: 'none', looked: [] }
  const looked: string[] = []
  for (const folder of HOST_FOLDERS) {
    const path = join(root.path, KEHIKOT_DIR, folder, 'epics', `${slug}.json`)
    looked.push(path)
    if (!existsSync(path)) continue
    /* A link out of the project is not followed, for the reason `dataFile`
       gives: followed, it is another project's epic under this one's name. */
    if (escapes(root.path, path)) return { found: 'unreadable', path }
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { found: 'unreadable', path }
      return { found: 'epic', path, epic: parsed as Record<string, unknown> }
    } catch {
      return { found: 'unreadable', path }
    }
  }
  return { found: 'none', looked }
}

export type Begun =
  | {
      ok: true
      journey: Journey
      /**
       * What the first record was made from: the host's answer to `epic.get`,
       * handed over by the page; the host's own file, read here; or nothing,
       * because no host holds that epic in this project.
       */
      from: 'host-answer' | 'host-file' | 'nothing'
      /** The host's file, when that is what was read. */
      file: string | null
    }
  | { ok: false; error: string }

/**
 * Make the first record for an epic: this app taking over its steps.
 *
 * ## Why this is not "add an empty journey"
 *
 * A host reads an epic's steps and groups from this app's record and falls
 * back to its own file only when there is no record. So making a record is
 * not adding something beside what the host holds — it REPLACES what the host
 * answers with, for every module, from that moment. The first record therefore
 * has to be what the host held: its steps, its groups, its prose, everything
 * in its file, so that the handover changes whose the steps are and nothing
 * about what they say.
 *
 * `seed` is that, when the caller has it: the page asks the host `epic.get`
 * and passes the answer. Without one the host's own file is read; see
 * `hostEpic` for why that is allowed and what else was considered. With
 * neither — no host holds this epic here at all — a record is made from a
 * title and nothing else, and the caller is told so, because a journey whose
 * slug matches no epic is one no canvas will ever point at.
 *
 * ## What it refuses, and each refusal writes nothing
 *
 *  - A slug that is not one; no project; a file that will not parse.
 *  - **A journey that is already there.** Never overwritten: that record is a
 *    document somebody has been editing, and "create" is not a way to reset it.
 *  - **A host epic that does not read as a journey** — a step with no title, a
 *    `refs` that is not a list. Refused rather than repaired or skipped,
 *    because either would make a record that hides part of what the host
 *    holds; the sentence names the field so that somebody can fix the file.
 *  - No host epic and no title.
 *
 * ## The slug is the one asked for, and the title is the host's
 *
 * The record is filed under `slug` and says `slug`, whatever the seed called
 * itself: the key is the name, and the protocol's `journeyIn` hands nobody a
 * record that disagrees with its key. The title is the seed's when it has one
 * — a host owns an epic's title — then the caller's, then the slug, which is
 * what a host itself falls back to for an epic with no title.
 */
export function createJourney(
  projectPath: string | null | undefined,
  slug: string,
  given: { seed?: unknown; title?: string } = {},
): Begun {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }

  const store = held(projectPath)
  if (store.nowhere) return { ok: false, error: NOWHERE }
  if (store.trouble) return { ok: false, error: `nothing was written. ${store.trouble}` }
  if (journeyIn(store, slug)) {
    return {
      ok: false,
      error:
        `this project already holds a journey called "${slug}", and nothing was changed. Creating one is not a way `
        + 'to reset it: read it, and change the step that is wrong.',
    }
  }

  let seed: Record<string, unknown> = {}
  let from: 'host-answer' | 'host-file' | 'nothing' = 'nothing'
  let file: string | null = null
  if (given.seed !== undefined && given.seed !== null) {
    if (typeof given.seed !== 'object' || Array.isArray(given.seed)) {
      return { ok: false, error: `what the host answered for "${slug}" is not an epic, so nothing was created.` }
    }
    seed = given.seed as Record<string, unknown>
    from = 'host-answer'
  } else {
    const host = hostEpic(projectPath, slug)
    if (host.found === 'unreadable') {
      return {
        ok: false,
        error:
          `${host.path} is the host’s file for "${slug}" and it could not be read as JSON, so nothing was created. `
          + 'A journey made without it would hide whatever steps that file holds: once this app keeps a record for '
          + 'an epic, a host reads the record and not its own file. Fix the file, then create the journey.',
      }
    }
    if (host.found === 'epic') {
      seed = host.epic
      from = 'host-file'
      file = host.path
    }
  }

  const said = typeof seed.title === 'string' && seed.title.trim() ? seed.title.trim() : ''
  const title = said || (given.title ?? '').trim()
  if (!title && from === 'nothing') {
    return {
      ok: false,
      error:
        `no host holds an epic called "${slug}" in this project, so there is nothing to begin this journey from. `
        + 'Give a `title` to make one that stands on its own — or make the epic in the host first, so that a '
        + 'canvas has something to point at it.',
    }
  }

  const parsed = journeySchema.safeParse({ ...seed, slug, title: title || slug })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? issue.path.join('.') : 'the epic'
    return {
      ok: false,
      error:
        `what the host holds for "${slug}" does not read as a journey (${where}: ${issue?.message ?? 'malformed'}), `
        + 'so nothing was created. It is refused rather than repaired: a record made from part of it would hide the '
        + `rest, because a host reads this app’s record in place of its own file. Fix ${file ?? 'the epic'} and try again.`,
    }
  }

  const written = writeJourney(projectPath, parsed.data)
  if (!written.ok) return written
  return { ok: true, journey: written.journey, from, file }
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
  /* The protocol's `stepsOf`, and not three lines of this app's own. A host
     asks the same question of the same record, and "is this journey's empty
     array none or elsewhere" answered by two functions is the bug this one was
     written to prevent, waiting for the day one of them is edited. */
  return stepsOf(journey)
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
