import { createHash } from 'node:crypto'

import { establishBuild, mintTicket, refuseTicket, sameTicket, type Reply } from 'kehikot-module-protocol/serve'

import { tooLong } from './limits.ts'
import { leftOutSaid, nothingSaid, type Chapters } from './chapters.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'
import { MAIN, chaptersIn } from './paper.ts'
import { FILE_EXAMPLE, assign, filesSaid, notAPart, partsIn, pinned, removalSaid, unassigned, withPart, withoutPart } from './parts.ts'
import {
  type Held,
  type Journey,
  NOWHERE,
  createJourney,
  dataFile,
  held,
  isSlug,
  journeyIn,
  listJourneys,
  planOf,
  projectOf,
  refsOf,
  refusedBecauseElsewhere,
  stepSchema,
  writeJourney,
} from './store.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * ## Why this is a file of functions rather than a server
 *
 * It used to be one: `Bun.serve` with a `fetch` handler, started by `run.sh`,
 * serving the page off a string and the store off `/api`. That program was
 * correct and is gone, for a reason that has nothing to do with Bun.
 *
 * A module is ONE ORIGIN or it is nothing. The protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else. The page is now served
 * by Vite, because a `dist/` served off disk has cost this codebase three
 * separate afternoons of a stale page answering 200 with every symptom of a
 * working app and none of the changes. So the page is Vite's, and therefore the
 * manifest, the health check, the MCP door and the store's own API have to be
 * Vite's too — they cannot be a second process on a second port however much
 * tidier that would look.
 *
 * Hence: no listener here. `answer()` takes a method, a path, a query and a
 * body and returns a status and a document, and `vite.config.ts` adapts a
 * node request to it in a dozen lines. Everything that used to be decided
 * inside `fetch` is decided here, where it can be called without a socket.
 *
 * ## The store is still this app's own, and that is the whole point
 *
 * Unlike Atlas and References, which draw everything the host hands them, this
 * app HOLDS the journeys. `/api/journeys` and `/api/journey` read them; `/api/step`
 * and `/api/dependency` write them. None of it involves a host, and the page is
 * fully drawn before a single bridge message is read. The extraction is only a
 * real extraction if that stays true.
 *
 * ## Every door here now names a project, and none of them defaults one
 *
 * The journeys live in the project they are about — `<project>/.kehikot/journeys/journeys.json`
 * — so "which journeys" is not answerable without "whose". Every read takes a
 * `project` and every write takes one, and NOTHING here supplies a default. The
 * defaults that were available are each wrong in a way that is silent:
 *
 *  - `process.cwd()` is THIS MODULE's directory. Every journey would land in
 *    `…/kehikko-journeys` and no page would ever show one again.
 *  - "The only project that has journeys, if there is exactly one" is right up
 *    to the day there are two, at which point writes start landing in whichever
 *    was written first and nothing says so.
 *  - Nothing at all — an unpartitioned bucket — is a place journeys go to be
 *    invisible.
 *
 * The page is told which project by the host, in `kehikot.context.projectPath`.
 * An agent over MCP is not told anything and must say, and is refused with a
 * sentence when it does not. This is the argument `quiz/projects.ts` makes in
 * the Learning module, made again here because the conclusion is the same one
 * and a second module quietly reaching a different one is how a convention
 * stops being a convention.
 */

/* ------------------------------------------------------------------ *
 * Everything that arrives, bounded before it is looked at
 *
 * Nothing here trusts its caller. The page is one caller, an agent over MCP is
 * another, and a third is whatever else is running on this machine and found
 * the port — this listens on loopback, which is a fence around the machine and
 * not around the programs on it. A string has a length before it has a meaning.
 * ------------------------------------------------------------------ */

const MAX_SLUG = 80
const MAX_TITLE = 400
const MAX_BODY = 20_000
const MAX_REF = 200
const MAX_NOTE = 200
const MAX_LIST = 200
/** A part's id: the protocol's `PART_ID` is eighty characters of slug. */
const MAX_PART = 80
/** A file's name from the paper's folder, as long as the protocol's `LIMITS.PART_FILE` lets one be. */
const MAX_FILE = 256
/** As many steps as one call may file at once. No journey here is a tenth of it. */
const MAX_STEPS = 2000
/** As long as a path may be, matching the protocol's own `LIMITS.PATH`. */
const MAX_PROJECT = 4096
/**
 * How much of an epic a page may hand over as the first record of a journey.
 *
 * Every other bound here is on one string. This one is on a whole document —
 * what a host answered `epic.get` with, passed on by the page to become the
 * record — and it has to be a document, because the record must be everything
 * the host held or it hides the difference. So it is bounded as one: by its
 * length as JSON. The longest journey this app ships is under sixty thousand
 * characters; this is several of those, and well inside what the adapter in
 * `vite.config.ts` will read at all.
 */
const MAX_SEED = 400_000

function str(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/**
 * A list of short strings, bounded in both directions.
 *
 * Both bounds are load bearing and for different reasons. The per-item bound
 * stops one enormous string; the list bound stops ten thousand small ones,
 * which is the same attack with the arithmetic moved. Empty strings are dropped
 * rather than kept, because a ref of "" is not a ref and would render as a card
 * for nothing.
 */
function list(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_LIST)
    .map((v) => str(v, max))
    .filter(Boolean)
}

function position(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.min(Math.floor(n), 10_000)
}

/**
 * The ticket a write has to carry.
 *
 * Minted once per process and printed into the page this server serves. It is
 * not a secret worth much and does not pretend to be one: anything that can
 * read the page can read it. What it separates is "this app's own page saved a
 * step" from "something else on this machine guessed the port and posted", and
 * on a loopback server that separation is not otherwise available. Reads are
 * not gated on it — a journey is not a secret, and gating reads would only mean
 * an agent's curl needs a ticket to look at a page it can already open.
 *
 * ## It separates less than it used to, and the reason is CORS
 *
 * The host frames this page without `allow-same-origin`, so every module script
 * in it is fetched cross-origin against an opaque origin, so this server has to
 * answer with a permissive `Access-Control-Allow-Origin` or nothing in the page
 * runs at all (see `vite.config.ts`). A permissive header on `/app` means any
 * page in any tab can now READ this document, and therefore this ticket, and
 * therefore post with it. So what the ticket still buys is the honest, smaller
 * thing: a program that guessed the port and posted blind is refused, and a
 * write always came from somewhere that had fetched this app's own page. It is
 * not, and was never, an authorization check. Saying so here is cheaper than
 * somebody later reading it as one.
 */
export const TICKET = mintTicket()

/** What this process is built from and when it started; `doors()` says it wherever a build is said. */
export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

/**
 * What a request without the process ticket is told. Said through the protocol's `refuseTicket`,
 * whose mark (`refused: 'ticket'`) is how this app's page tells "I am older than my server" — and
 * reloads itself — from every other refusal, the project one below included.
 */
const NOT_THIS_PAGE =
  'that request did not come from this app’s own page — or the page is from a previous run of this server, in '
  + 'which case reloading the pane gives it the ticket this run minted.'

/**
 * The ticket a write has to carry NOW, which is bound to the project it writes
 * into.
 *
 * ## The failure this exists for is a stale ticket, not an attacker
 *
 * Say plainly what this does not buy, because the essay above is emphatic that
 * the ticket is not an authorization check and this does not change that.
 * Anything holding the process ticket can ask for a write ticket for any
 * project it likes; the derivation is a fence around confusion, not around
 * malice.
 *
 * What it fences is real and has one shape. This page is loaded ONCE and lives
 * across many contexts: the host switches project, and every open editor, every
 * in-flight save and every retry the page had queued is now aimed at a store
 * that is not the one it was composed against. A save that left project A with
 * A's slug and arrives while the page believes it is on B would write A's step
 * into B's file — a real journey, a real step, filed under the wrong project,
 * with every screen reporting success. Binding the ticket to the project makes
 * that arrive as a refusal instead: a ticket taken out for A does not redeem
 * against B, and the page is told to re-open before it saves.
 *
 * ## Why it is derived rather than stored
 *
 * A map from project to ticket would be state this file has to expire, and a
 * ticket for a project nobody is on any more is a row that lives forever. A
 * hash of the process ticket and the RESOLVED project is the same answer every
 * time, needs no memory, and dies with the process — which is exactly the
 * lifetime the process ticket already has.
 *
 * Resolved is load-bearing. `projectOf` returns the realpath, so `/p`, `/p/`
 * and a symlink that lands on `/p` are one project and one ticket. Without that
 * a page that spelled its project a shade differently from the last request
 * would have its writes refused with nothing on either side able to say why.
 *
 * A project this app refuses outright — relative, missing, not a folder — has
 * no ticket at all rather than a ticket that will not work: `null` here means
 * the refusal is about the PROJECT and gets the project's own sentence, which
 * is the one a person can act on.
 */
export function writeTicketFor(projectPath: string | null | undefined): string | null {
  const project = projectOf(projectPath)
  if (project === null) return null
  return createHash('sha256').update(`${TICKET}\u0000${project}`).digest('hex').slice(0, 32)
}

/* ------------------------------------------------------------------ *
 * What the page reads
 * ------------------------------------------------------------------ */

/**
 * A journey as the page wants it: the stored document, plus the ONE derived
 * fact the page cannot work out for itself.
 *
 * `plan` is `'stored' | 'elsewhere' | 'none'`, and it is computed here rather
 * than in the browser for the reason every opinion in these apps is computed on
 * this side: an opinion held in two places is two opinions that will eventually
 * disagree, and this particular one disagreeing is the exact bug this app was
 * built in response to. The browser draws the answer; it does not reach one.
 */
function view(journey: Journey) {
  return { ...journey, plan: planOf(journey).kind }
}

function brief(journey: Journey) {
  const plan = planOf(journey)
  return {
    slug: journey.slug,
    title: journey.title,
    tab: journey.tab ?? null,
    project: journey.project ?? null,
    lede: journey.lede,
    plan: plan.kind,
    steps: plan.kind === 'stored' ? plan.steps.length : 0,
    refs: refsOf(journey).length,
  }
}

/* ------------------------------------------------------------------ *
 * Writing a step
 * ------------------------------------------------------------------ */

/**
 * Add or replace one step, whole.
 *
 * Shared by the page and by MCP, so that the refusals are identical from both
 * doors. An agent told "that is too long" and a person shown nothing would be
 * two programs; there is one.
 *
 * The whole step is written, not patched. That is Kehikot's rule and it is
 * kept here because the reason is unchanged: anything left out is gone, and
 * anything stale kept is a claim being made afresh. The editor on the page
 * therefore fills every box from what is stored before anybody types.
 *
 * ## "Whole" means the four things this door has always taken
 *
 * A title, a body, refs and notes: those are what a caller says here every
 * time, so those are what a caller is taken to have said, and each replaces
 * what was stored. A step may carry more than that — whatever a newer writer
 * added — and this door has no argument for it. What a caller could not have
 * said, a caller has not unsaid: those fields stay on the step.
 *
 * ## `part` is the exception to "whole", on purpose
 *
 * A caller CAN say `part` now, and it is still not one of the four. Left out,
 * it is left alone: the step stays in whatever part it was in. That is the
 * opposite of the rule two paragraphs up, and it is the opposite because the
 * failure runs the other way. An agent correcting a typo in a step's body
 * reads the step, sends the title, body, refs and notes back, and has no
 * reason to think about parts at all — and under "anything you leave out is
 * gone" that correction would quietly take the step out of its part, and off
 * the page of everybody focused on it. So `part` has three values and not two:
 * absent, which says nothing; empty, which takes the step out of every part;
 * and an id, which has to be one this journey has — `notAPart` lists them in
 * the refusal, because an id is the slug of a heading the caller may only
 * ever have seen in prose.
 *
 * Filing a step under a part also writes that part's id onto its group, in
 * the same save; see `pinned` in `parts.ts` for why that is what makes the
 * assignment outlive a rewording of the heading.
 */
function setStep(
  project: string | null,
  slug: string,
  at: number | undefined,
  step: { title: string; body: string; refs: string[]; notes: string[] },
  /** `undefined` leaves the step's part as it is; `null` takes it out of every part. */
  part?: string | null,
): { ok: false; error: string } | { ok: true; journey: Journey; where: number } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }

  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing }

  const journey = journeyIn(store, slug)
  if (!journey) {
    /* It used to stop at the first clause, and there was then nothing a
       caller could do next: no door made a journey. There is one now, and a
       refusal that does not name it sends an agent to edit the file by hand. */
    return {
      ok: false,
      error:
        `no journey "${slug}" here. A step is written into a journey, and this project has none under that name `
        + 'yet: begin one with `create_journey`, which starts it from what the host holds for that epic.',
    }
  }

  /* The refusal that has to say where to write instead. A tool that says only
     "no" leaves somebody with a decision they cannot record anywhere, and the
     next thing they do is write it in a second place. */
  const elsewhere = refusedBecauseElsewhere(journey)
  if (elsewhere) return { ok: false, error: elsewhere }

  if (!step.title) return { ok: false, error: 'a step has to say what becomes true' }
  const long = tooLong(step.body)
  if (long) return { ok: false, error: long }

  if (typeof part === 'string') {
    const unknown = notAPart(journey, part)
    if (unknown) return { ok: false, error: `${unknown} The step was not written.` }
  }

  const before = at && at <= journey.steps.length ? journey.steps[at - 1] : undefined
  const parsed = stepSchema.parse({ ...before, ...step })
  if (part === null) delete parsed.part
  else if (typeof part === 'string') {
    parsed.part = part
    journey.groups = pinned(journey.groups, part)
  }
  if (at && at <= journey.steps.length) journey.steps[at - 1] = parsed
  else journey.steps.push(parsed)
  const where = at && at <= journey.steps.length ? at : journey.steps.length

  const written = writeJourney(project, journey)
  if (!written.ok) return { ok: false, error: written.error }
  return { ok: true, journey: written.journey, where }
}

/**
 * Why there is nothing to read in this project, or null because there is.
 *
 * Two refusals with one shape, kept together because every door needs both and
 * because the DIFFERENCE between them is the thing a caller has to be told.
 * "No project is open" is somewhere a person can legitimately be and is fixed
 * by opening one; "this file will not parse" is a file somebody has to go and
 * look at, and answering the second as if it were the first would present
 * material that still exists as material that never did.
 *
 * An empty project is neither and returns null: it has nowhere to read FROM and
 * somewhere to write TO, which is the ordinary state of a project nobody has
 * written a journey in yet.
 */
function nothingToReadIn(store: Held): string | null {
  if (store.nowhere) return NOWHERE
  if (store.trouble) return store.trouble
  return null
}

/**
 * What a caller said about `part`, out of a bag of arguments: nothing, "none",
 * or an id.
 *
 * Three answers, and the first is the one `str()` cannot give — it turns a
 * missing argument and an empty one into the same `''`, which here are
 * opposites: a missing `part` leaves a step where it is, and an empty one
 * takes it out of every part. `null` counts as empty, because that is what a
 * page's JSON sends for "none".
 */
function partArg(bag: Record<string, unknown>): string | null | undefined {
  if (!Object.hasOwn(bag, 'part') || bag.part === undefined) return undefined
  return str(bag.part, MAX_PART) || null
}

/** One-based step positions out of a caller's list, bounded like every list here. */
function positions(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_STEPS)
    .map((one) => (typeof one === 'string' ? Number(one.trim()) : typeof one === 'number' ? one : NaN))
    .map((one) => (Number.isFinite(one) ? Math.floor(one) : 0))
}

type Arranged = { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string }

/**
 * Read one journey, change how it is arranged into parts, and write it.
 *
 * The three doors that arrange — filing steps, making or renaming a part,
 * removing one — are this function with a different middle, from the page and
 * from MCP alike, so that a refusal is the same sentence whoever hears it.
 * The middle is one of the pure functions in `parts.ts` and decides
 * everything; this only finds the journey and keeps the answer.
 *
 * Not refused on a journey whose steps are kept elsewhere, as `set_step` is.
 * Its groups are here and a host reads them as that epic's parts whatever the
 * steps are projected from; the door that needs steps to file (`assign`)
 * finds none and says so in its own words.
 */
function arrange(
  project: string | null,
  slug: string,
  change: (journey: Journey) => { ok: false; error: string } | { ok: true; record: Journey; said: string },
): Arranged {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `this project does not hold a journey called "${slug}"`, status: 404 }
  const changed = change(journey)
  if (!changed.ok) return changed
  const written = writeJourney(project, changed.record)
  if (!written.ok) return { ok: false, error: written.error }
  return { ok: true, journey: written.journey, said: changed.said }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** File steps under a part, or — `part` null — take them out of every part. */
function assignSteps(project: string | null, slug: string, at: number[], part: string | null): Arranged {
  return arrange(project, slug, (journey) => {
    const out = assign(journey, at, part)
    if (!out.ok) return out
    const left = unassigned(out.record).length
    const rest = left ? `${count(left, 'step')} of ${journey.steps.length} still in no part.` : 'Every step is in a part.'
    const same = out.already.length ? ` ${count(out.already.length, 'step')} already said so.` : ''
    const said =
      out.heading === null
        ? `Took ${count(out.moved.length, 'step')} out of every part.${same} ${rest}`
        : `Put ${count(out.moved.length, 'step')} in “${out.heading}” (${part}).${same} ${rest}`
    return { ok: true, record: out.record, said }
  })
}

/** Make a part, or reword one. */
function setPart(
  project: string | null,
  slug: string,
  given: { id: string | null; heading: string; refs?: string[]; files?: unknown },
): Arranged & { id?: string } {
  let id: string | undefined
  const out = arrange(project, slug, (journey) => {
    const made = withPart(journey, given)
    if (!made.ok) return made
    id = made.id
    const about = made.created
      ? `Made the part “${made.heading}”, with the id ${made.id}. No step is in it yet: file steps under that id.`
      : made.was !== null && made.was !== made.heading
        ? `“${made.was}” is now called “${made.heading}”. Its id is still ${made.id}, so every step in it stays in `
          + 'it and a focus on it still holds.'
        : `Kept “${made.heading}” (${made.id}).`
    /* Said only when the call was about files: a rename that mentioned none
       answers in the words it always did. */
    const said = made.files === null ? about : `${about} ${filesSaid(made.record, made.id)}`
    return { ok: true, record: made.record, said }
  })
  return out.ok ? { ...out, id } : out
}

/** Take a part out; its steps stay and become unassigned. */
function removePart(project: string | null, slug: string, id: string): Arranged {
  return arrange(project, slug, (journey) => {
    const out = withoutPart(journey, id)
    if (!out.ok) return out
    return { ok: true, record: out.record, said: `Removed the part “${out.gone.heading}” (${id}). ${removalSaid(out.gone)}` }
  })
}

/**
 * What the epic's paper says about parts, for a project and an epic — whether
 * or not the journey has been begun.
 *
 * Asked without a journey on purpose. The person this was written for had a
 * thesis, two epics and no journey record, and the first thing they need to
 * see is what beginning one and dividing it would MAKE; a list that could
 * only be read after the record existed would put the decision before the
 * information. With no record there are no parts to skip, so every chapter
 * file is proposed.
 *
 * `paper: false` is "this epic has no paper here" — no folder, or no
 * `main.tex` — and is an answer, not a refusal: most epics have none, and the
 * page then offers what it always did.
 */
function chapters(project: string | null, slug: string): { ok: false; error: string; status?: number } | { ok: true; chapters: Chapters | null; begun: boolean } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  return { ok: true, chapters: chaptersIn(project, slug, journey ? partsIn(journey) : []), begun: journey !== null }
}

/**
 * Make a part for each of the chapter files named, in one write.
 *
 * `files` is what the person left ticked in the list they were shown: the
 * files `main.tex` pulls in, by name. The proposal is worked out AGAIN here,
 * from the disk, and a name that is not in it now refuses the whole call —
 * the paper changed between the list and the press, or the file became some
 * part's in another window, and what would be made is no longer what was
 * read. Nothing is taken from the caller but which rows: the heading and the
 * files each part gets are this side's reading, so a page cannot be made to
 * write a part the paper does not have.
 *
 * Each part is made by `withPart`, the function `set_part` makes one by, so
 * the ids, the limit and every refusal are that function's. All of them or
 * none: `arrange` writes once, after the last.
 */
function makeChapterParts(project: string | null, slug: string, files: string[]): Arranged {
  return arrange(project, slug, (journey) => {
    const found = chaptersIn(project, slug, partsIn(journey))
    if (!found) {
      return {
        ok: false,
        error: `this epic has no paper in this project (no ${MAIN} in .kehikot/paper/${slug}/), so there are no chapter files to make parts of.`,
      }
    }
    if (!files.length) return { ok: false, error: 'which chapter files? None was named, so nothing was made.' }
    const stale = files.filter((file) => !found.parts.some((part) => part.file === file))
    if (stale.length) {
      return {
        ok: false,
        error:
          `${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} not among the chapter files ${MAIN} would make a part of now — `
          + 'the paper changed, or a part took the file, since the list was shown. Nothing was made; list them again.',
      }
    }
    let record = journey
    const made: string[] = []
    for (const part of found.parts) {
      if (!files.includes(part.file)) continue
      const out = withPart(record, { heading: part.heading, files: part.files })
      if (!out.ok) return out
      record = out.record
      made.push(`“${out.heading}” (${part.files.join(', ')})`)
    }
    return {
      ok: true,
      record,
      said:
        `Made ${count(made.length, 'part')} from the paper’s chapter files, each owning its file: ${made.join('; ')}. `
        + 'No step is filed under them yet. Tick them in the host’s bar to see one chapter at a time.',
    }
  })
}

/**
 * A proposal as an agent reads it: what would be made, with the call that
 * makes each, and what is left out and why.
 */
function chaptersSaid(slug: string, found: Chapters, begun: boolean): string {
  const nothing = nothingSaid(found)
  const left = leftOutSaid(found)
  const lines = found.parts.map(
    (part, i) =>
      `  ${i + 1}. “${part.heading}”${part.titled ? '' : ' (named after the file: it has no \\chapter or \\section)'}\t${part.files.join(', ')}\n`
      + `     set_part { slug: "${slug}", heading: ${JSON.stringify(part.heading)}, files: ${JSON.stringify(part.files)} }`,
  )
  return (
    (nothing
      ? `${nothing}\n`
      : `PROPOSAL — nothing has been made. ${MAIN} of this epic’s paper pulls in ${count(found.parts.length, 'chapter file')} `
        + 'that no part owns. One part each, in the paper’s order, called what the file’s first \\chapter or \\section '
        + 'calls it and owning that file and the files it pulls in itself:\n'
        + `${lines.join('\n')}\n`
        + (begun
          ? 'Make the ones you want with `set_part`, as written above; leave out any that is not a part of the work.\n'
          : `This project holds no journey for ${slug} yet, and \`set_part\` needs one: call \`create_journey\` first, then `
            + '`set_part` as written above.\n'))
    + (left.length ? `LEFT OUT: ${left.join(' ')}\n` : '')
  )
}

/**
 * A journey's parts and which step is in which, in lines an agent can read.
 *
 * Printed above the document by `get_journey`. The document alone does not
 * say it: a group's id is DERIVED unless somebody wrote one, so an agent
 * reading `"groups": [{ "heading": "The agent seam" }]` has to know the
 * protocol's slug rule to know what to pass as `part` — and has no way at all
 * to know about the `-2` on the second group with that heading. So the ids are
 * said, by the function the store itself asks, beside what is in each.
 */
function partsSaid(journey: Journey): string {
  const parts = partsIn(journey)
  if (!parts.length) return ''
  const lines = parts.map((part) => {
    const at = journey.steps.flatMap((step, i) => (step.part === part.id ? [i + 1] : []))
    /* The files come last and only when there are some, so the four columns
       an agent already reads are the four they were. */
    const files = part.files?.length ? `\tfiles ${part.files.join(', ')}` : ''
    return `  ${part.id}\t“${part.heading}”\t${count(part.refs.length, 'ref')}\t${at.length ? `steps ${at.join(', ')}` : 'no steps'}${files}`
  })
  const owning = parts.some((part) => part.files?.length)
  const loose = unassigned(journey).map((i) => i + 1)
  return (
    'PARTS: this journey is divided into the parts below. A step is in a part because its `part` names that '
    + 'part’s id, and a step in none is hidden from anybody whose canvas is focused on a part. File steps with '
    + '`assign_steps` (or `part` on `set_step`); make, reword and remove parts with `set_part` and `remove_part`. '
    + (owning
      ? `A part’s files are the files of this epic’s paper it owns, each named from the paper’s folder `
        + `(.kehikot/paper/${journey.slug}/); set them with \`files\` on \`set_part\`.\n`
      : `No part names a file of the paper yet; \`files\` on \`set_part\` gives it some (e.g. ${FILE_EXAMPLE}), and `
        + '`propose_chapter_parts` lists the paper’s chapter files.\n')
    + `${lines.join('\n')}\n`
    + (loose.length
      ? `  IN NO PART: ${count(loose.length, 'step')} of ${journey.steps.length} — ${loose.join(', ')}\n`
      : journey.steps.length
        ? '  Every step is in a part.\n'
        : '')
    + '\n'
  )
}

/**
 * The project an MCP caller named, or a refusal saying to name one.
 *
 * Refused rather than defaulted. See the head of this file for why each
 * available default is wrong, and `quiz/projects.ts` in the Learning module for
 * the same argument made first.
 */
function projectArg(value: unknown): { project: string } | { error: string } {
  const named = str(value, MAX_PROJECT)
  if (!named) {
    return {
      error:
        'which project? A journey lives in the project it is about, at .kehikot/journeys/journeys.json inside it, so this '
        + 'tool cannot answer without one. Pass `project` as the absolute path of the project folder — the same path '
        + 'a host would put in `kehikot.context.projectPath`. Nothing here guesses: a guess writes a journey into a '
        + 'folder nobody will look in and reports that it saved.',
    }
  }
  return { project: named }
}

/* ------------------------------------------------------------------ *
 * The MCP door
 * ------------------------------------------------------------------ */

interface ToolCall {
  (args: Record<string, unknown>): string
}

/**
 * What an agent can do to this store.
 *
 * These are Kehikot's own epic tools over this app's store instead of the
 * Kehikot's: list, get, `create_journey`, `set_step` and `set_dependency`, plus `remove_step`,
 * which is here because `set_step`'s refusal on a projected journey creates the
 * need for it — a stored step nothing reads and nothing can remove would sit in
 * the file forever. And three for the parts a journey is divided into:
 * `assign_steps`, `set_part` and `remove_part`. A host reads a journey's groups
 * as the epic's parts and lets a person focus the canvas on some of them, and
 * until these existed the only way to say which step is in which part — or to
 * make a part at all — was to edit the JSON by hand.
 *
 * The names are this app's own and are deliberately not renamed to follow
 * protocol 2's `epics.list` / `epic.get`. Those two are WIRE method names, in
 * the vocabulary a host and a module agree on; these are MCP tools over a store
 * whose documents say `journey` in every file on disk. Renaming them would
 * leave an agent reading `list_epics` and writing files full of journeys, which
 * is the same word used for two things one layer apart — the confusion the
 * protocol rename existed to remove, reintroduced from the other side.
 *
 * What is NOT here, and would be a mistake to add:
 *
 *  - Anything that reads a tracker. This app holds no credential.
 *  - Anything that writes what is TRUE. Issue state, assignees and board
 *    columns are read on a refresh and hand-editing them is the one thing the
 *    Kehikot's own rule forbids everywhere. There is deliberately no tool.
 *  - `report_stage`. Saying where work has got to belongs to whoever is doing
 *    it, and it is reported to Kehikot, which is what holds the roster that
 *    turns a standing report into a stalled one. This app would be a second
 *    place to say it and a worse one.
 */
const TOOLS: Record<string, { description: string; schema: object; run: ToolCall }> = {
  list_journeys: {
    description:
      'Every journey this project holds, with how many steps each has and how many references it names. Start ' +
      'here. Journeys are kept inside the project they are about, in .kehikot/journeys/journeys.json, so this needs the ' +
      'project’s absolute path and will not guess one. A journey may report that its steps are kept somewhere ' +
      'this app cannot read — that is not the same as having none, and the two are said differently on purpose.',
    schema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Absolute path of the project folder' } },
      required: ['project'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const store = held(named.project)
      const nothing = nothingToReadIn(store)
      if (nothing) return nothing

      const all = listJourneys(store)
      if (!all.length) return `No journeys in ${named.project} yet.`
      return all
        .map((j) => {
          const plan = planOf(j)
          const steps =
            plan.kind === 'stored'
              ? `${plan.steps.length} steps${plan.alsoProjected ? ' (a paper sits beside them)' : ''}`
              : plan.kind === 'elsewhere'
                ? `steps kept in ${plan.from.where}, which this app cannot read`
                : 'no steps written yet'
          return `${j.slug}\t${steps}\t${refsOf(j).length} refs\t${j.title}`
        })
        .join('\n')
    },
  },

  get_journey: {
    description:
      'The full stored document for one journey as JSON: narrative, steps, dependency graph, owners. Read this ' +
      'before editing so you change one field rather than overwrite the rest. `stepsFrom`, when it is there, ' +
      'says where the steps actually come from. When the journey is divided into parts, the lines above the ' +
      'JSON list every part with its id, how many references it holds and which steps are in it, and which ' +
      'steps are in no part — those ids are what `part` takes on `set_step` and `assign_steps`, and each ' +
      'step’s own `part` is in the JSON.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'e.g. modes-are-modules' },
      },
      required: ['project', 'slug'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const slug = str(args.slug, MAX_SLUG)
      if (!isSlug(slug)) return 'that is not a journey name'
      const store = held(named.project)
      const nothing = nothingToReadIn(store)
      if (nothing) return nothing
      const journey = journeyIn(store, slug)
      if (!journey) {
        const known = listJourneys(store).map((j) => j.slug)
        return known.length
          ? `no journey "${slug}" in ${named.project}. Known: ${known.join(', ')}`
          : `no journey "${slug}" in ${named.project}, which holds no journeys at all yet.`
      }
      const plan = planOf(journey)
      const preamble =
        plan.kind === 'elsewhere'
          ? `NOTE: this journey's steps are NOT in the document below. They are kept in ${plan.from.where} and ` +
            `projected from there by ${plan.from.projector}. The empty "steps" array below means "not here", ` +
            'not "none".\n\n'
          : ''
      return preamble + partsSaid(journey) + JSON.stringify(journey, null, 2)
    },
  },

  create_journey: {
    description:
      'Begin the journey for an epic that has none yet: the first record, from which this app owns that epic’s ' +
      'steps, its groups (the epic’s parts) and the prose around them. It is NOT made empty. The record starts as ' +
      'everything the host holds for that epic — this reads the host’s own file, ' +
      '.kehikot/kehikko/epics/<slug>.json in the project, once and without changing it — because from the moment ' +
      'a record exists a host answers from the record and not from its file, and an empty one would hide every ' +
      'step already written. Refused, with nothing written, if the journey already exists or if that file does ' +
      'not read as a journey. If no host holds that epic here, pass `title` to make a journey that stands on its ' +
      'own; no canvas will point at it until an epic with that slug exists.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The epic’s slug, e.g. modes-are-modules' },
        title: {
          type: 'string',
          description: 'Used only when no host holds this epic. The host’s title wins when there is one.',
        },
      },
      required: ['project', 'slug'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = createJourney(named.project, str(args.slug, MAX_SLUG), { title: str(args.title, MAX_TITLE) })
      if (!out.ok) return out.error
      return begun(out, dataFile(named.project).path)
    },
  },

  set_step: {
    description:
      'One numbered stop on the journey: what has to become true for a user, and which issues and changes ' +
      'deliver it. Omit position to append; pass it to overwrite the step at that 1-based position. Read the ' +
      'step first: this writes the whole step, so anything you leave out is gone and anything stale you keep is ' +
      'a claim you are making afresh. Refused on a journey whose steps are kept elsewhere, with a sentence ' +
      'saying where to write instead. `part` is the one field that is NOT cleared by leaving it out: omit it ' +
      'and the step stays in whatever part it was in; pass a part’s id to file the step under it; pass "" to ' +
      'take it out of every part. The valid ids are listed above the document `get_journey` returns, and an ' +
      'unknown one is refused with the list. To file many steps without rewriting them, use `assign_steps`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        title: { type: 'string', description: "What becomes true, phrased from the user's side" },
        body: { type: 'string', description: 'Why it matters and where it stands. 150 words at most.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'e.g. ["#2274", "!1801", "gh#41"]' },
        notes: { type: 'array', items: { type: 'string' }, description: 'Chips for work with no ticket' },
        part: {
          type: 'string',
          description:
            'The id of the part this step is in, from `get_journey`. Omit to leave it as it is; "" for no part.',
        },
        position: { type: 'number' },
      },
      required: ['project', 'slug', 'title'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = setStep(
        named.project,
        str(args.slug, MAX_SLUG),
        position(args.position),
        {
          title: str(args.title, MAX_TITLE),
          body: str(args.body, MAX_BODY),
          refs: list(args.refs, MAX_REF),
          notes: list(args.notes, MAX_NOTE),
        },
        partArg(args),
      )
      if (!out.ok) return out.error
      /* The path is asked for rather than spelled here. The folder's name lives
         in one constant in the protocol package, and a sentence that wrote it
         out by hand would be the one place that keeps saying `.kehikot` on the
         day it is called something else. */
      return `Set step ${out.where} of ${out.journey.slug}, in ${dataFile(named.project).path} and nowhere else.`
    },
  },

  remove_step: {
    description:
      'Drop the step at a 1-based position; the steps after it renumber. Allowed on a journey whose steps are ' +
      'projected elsewhere, because there the stored steps are leftovers nothing reads — removing them is the ' +
      "cleanup set_step's refusal creates the need for.",
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        position: { type: 'number' },
      },
      required: ['project', 'slug', 'position'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const slug = str(args.slug, MAX_SLUG)
      if (!isSlug(slug)) return 'that is not a journey name'
      const store = held(named.project)
      const nothing = nothingToReadIn(store)
      if (nothing) return nothing
      const journey = journeyIn(store, slug)
      if (!journey) return `no journey "${slug}" in ${named.project}`
      const at = position(args.position)
      if (!at || at > journey.steps.length) return `${slug} has ${journey.steps.length} stored steps`
      const [gone] = journey.steps.splice(at - 1, 1)
      const written = writeJourney(named.project, journey)
      if (!written.ok) return written.error
      return `Removed step ${at} ("${gone?.title ?? ''}") from ${slug}.`
    },
  },

  assign_steps: {
    description:
      'File steps under one of the journey’s parts, several at once, changing nothing else about them. A person ' +
      'can focus a canvas on some of an epic’s parts, and a step that names no part is then hidden from every ' +
      'module — so a journey that has parts and unfiled steps shows nothing under a focus until this is done. ' +
      '`part` is a part’s id, listed above the document `get_journey` returns; an unknown one is refused with ' +
      'the list. Pass "" to take the steps out of every part. `positions` are 1-based, and one that is not a ' +
      'step refuses the whole call. A step is filed where it BELONGS, not where its references point: a step ' +
      'often names a reference it only depends on.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        part: { type: 'string', description: 'A part’s id from `get_journey`, or "" for no part' },
        positions: { type: 'array', items: { type: 'number' }, description: '1-based positions of the steps, e.g. [3, 4, 9]' },
      },
      required: ['project', 'slug', 'part', 'positions'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = assignSteps(named.project, str(args.slug, MAX_SLUG), positions(args.positions), partArg(args) ?? null)
      return out.ok ? out.said : out.error
    },
  },

  set_part: {
    description:
      'Make a part of the journey, or reword one. A part is a heading (stored as one of the journey’s `groups`) ' +
      'that steps are filed under; a host shows the parts beside the epic so a person can narrow every module ' +
      'to some of them. Omit `id` to make a new part with this heading — the answer says the id it was given. ' +
      'Pass `id` to reword an existing part: its id does not change, so the steps in it stay in it. `refs`, ' +
      'when given, replaces the references listed under the heading; omitted, they are left alone. `files`, ' +
      'when given, replaces the files of the epic’s paper this part owns — the module that shows the paper then ' +
      'shows only those files and their pages while the part is picked. Each is a path relative to the paper’s ' +
      `folder (<project>/.kehikot/paper/<slug>/), with forward slashes and its extension: "${FILE_EXAMPLE}", not ` +
      '"chapters/design" and not an absolute path. Omitted, the files are left alone; an empty list takes them ' +
      'all away. A name that is not in that form refuses the whole call and nothing is written. Whether the file ' +
      'exists is not checked here, so a part may be given a file before it is written; `propose_chapter_parts` ' +
      'lists the files the paper actually has. With `id`, `heading` may be left out to keep the heading as it is. ' +
      'Refused if another part already has that heading.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        heading: { type: 'string', description: 'What the part is called, e.g. "The agent seam"' },
        id: { type: 'string', description: 'The id of the part to reword, from `get_journey`. Omit to make a new part.' },
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'References listed under the heading. Omit to leave them as they are.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            `Files of the paper this part owns, relative to the paper’s folder, e.g. ["${FILE_EXAMPLE}"]. Omit to ` +
            'leave them as they are; [] removes them.',
        },
      },
      required: ['project', 'slug'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = setPart(named.project, str(args.slug, MAX_SLUG), {
        id: str(args.id, MAX_PART) || null,
        heading: str(args.heading, MAX_TITLE),
        ...(Array.isArray(args.refs) ? { refs: list(args.refs, MAX_REF) } : {}),
        /* Handed on as it arrived, and not through `list`: that helper drops
           what it cannot read, and a file that is not one has to be REFUSED
           by name (`filesGiven`). Null is "not given", as JSON says it. */
        ...(args.files === undefined || args.files === null ? {} : { files: args.files }),
      })
      return out.ok ? out.said : out.error
    },
  },

  propose_chapter_parts: {
    description:
      'List the parts this epic’s PAPER is already divided into, without making any. It reads main.tex in the ' +
      'paper’s folder (<project>/.kehikot/paper/<slug>/) and answers one proposed part for each file main.tex ' +
      'pulls in with \\input, \\include or \\subfile after \\begin{document}, in document order: its heading (the ' +
      'file’s first \\chapter or \\section title, or the file’s name when it has neither) and the files it would ' +
      'own (that file and every file it pulls in itself). Files a part already owns are skipped and said, as are ' +
      'files pulled in by the preamble and files that are not on disk; main.tex is never a part. READ-ONLY: ' +
      'nothing is written. Each proposal is printed with the `set_part` call that makes it, so make the ones ' +
      'you want with `set_part`. Works before the journey exists, and then says to call `create_journey` first. ' +
      'Answers "no paper" for an epic with no main.tex there.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The epic’s slug, e.g. thesis' },
      },
      required: ['project', 'slug'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const slug = str(args.slug, MAX_SLUG)
      const out = chapters(named.project, slug)
      if (!out.ok) return out.error
      if (!out.chapters) {
        return `No paper for ${slug} in ${named.project}: there is no ${MAIN} in .kehikot/paper/${slug}/, so there are no chapter files to propose parts from.`
      }
      return chaptersSaid(slug, out.chapters, out.begun)
    },
  },

  remove_part: {
    description:
      'Take a part out of the journey. No step is deleted: the steps that were in it stay where they are and ' +
      'become unassigned (in no part), which hides them from anybody focused on a part until they are filed ' +
      'again. The references listed under the part’s heading go with it; the answer says how many steps and ' +
      'references that was, and how many of the references no step names. The other parts keep their ids.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        id: { type: 'string', description: 'The id of the part to remove, from `get_journey`' },
      },
      required: ['project', 'slug', 'id'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = removePart(named.project, str(args.slug, MAX_SLUG), str(args.id, MAX_PART))
      return out.ok ? out.said : out.error
    },
  },

  set_dependency: {
    description:
      'Record that something cannot start until other things land. Trackers almost never hold these links, so ' +
      'this is where the real order of work lives. A blocker may be an issue, a change, or free text for a gate ' +
      'outside every tracker. Pass an empty list to clear.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        ref: { type: 'string', description: 'The blocked thing, e.g. "#2274"' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'What must land first' },
      },
      required: ['project', 'slug', 'ref', 'blockedBy'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const slug = str(args.slug, MAX_SLUG)
      if (!isSlug(slug)) return 'that is not a journey name'
      const store = held(named.project)
      const nothing = nothingToReadIn(store)
      if (nothing) return nothing
      const journey = journeyIn(store, slug)
      if (!journey) return `no journey "${slug}" in ${named.project}`
      const ref = str(args.ref, MAX_REF)
      if (!ref) return 'which reference is blocked?'
      const gates = list(args.blockedBy, MAX_REF)
      if (gates.length) journey.blockedBy[ref] = gates
      else delete journey.blockedBy[ref]
      const written = writeJourney(named.project, journey)
      if (!written.ok) return written.error
      return gates.length ? `${ref} now waits on ${gates.join(', ')}.` : `${ref} has no blockers.`
    },
  },
}

/**
 * What was made, in words, for whoever asked for it.
 *
 * Said the same from both doors, and it says where the record CAME FROM,
 * because that is the thing a caller cannot see and most needs to: a journey
 * begun from nine steps and a journey begun from none look identical in "ok".
 */
function begun(out: Extract<ReturnType<typeof createJourney>, { ok: true }>, where: string | null): string {
  const plan = planOf(out.journey)
  const steps =
    plan.kind === 'stored'
      ? `${plan.steps.length} ${plan.steps.length === 1 ? 'step' : 'steps'}`
      : plan.kind === 'elsewhere'
        ? `steps kept in ${plan.from.where}`
        : 'no steps'
  const parts = out.journey.groups.length
  const held = `${steps}${parts ? ` and ${parts} ${parts === 1 ? 'group' : 'groups'}` : ''}`
  const kept = `It is in ${where ?? 'this project'}, and its steps are edited here from now on.`
  if (out.from === 'host-file') {
    return (
      `Began ${out.journey.slug} from the host’s own file, ${out.file}: ${held}, and everything else that file `
      + `held. ${kept} That file was read and not changed; a host now answers from this record instead of it.`
    )
  }
  if (out.from === 'host-answer') {
    return `Began ${out.journey.slug} from what the host holds for that epic: ${held}. ${kept}`
  }
  return (
    `Began ${out.journey.slug} with a title and nothing else: no host holds an epic by that name in this project. `
    + `${kept} No canvas will point at it until an epic with that slug exists.`
  )
}

/** A status and a document. Nothing here writes bytes; the protocol's `doors()` does that. */
export type { Reply }

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions:
        'The journeys themselves: what has to become true for a user, step by step, what blocks what, and the ' +
        'prose around it. They are kept inside the project they are about, in .kehikot/journeys/journeys.json, so every ' +
        'tool here takes `project` — the absolute path of the project folder — and refuses without one rather ' +
        'than guessing which project you meant. This server reads no tracker and holds no credential, so nothing ' +
        "here can tell you whether an issue is open — that is read by a host and handed to this app's page. " +
        'A journey may say its steps are kept somewhere this app cannot read; an empty steps array on one of ' +
        'those means "not here", never "none". A journey may be divided into parts (its groups), and a step is ' +
        'in a part only because its `part` names that part’s id: `get_journey` lists the ids and which steps ' +
        'are in none, `assign_steps` files steps, and `set_part` / `remove_part` make, reword and remove parts. ' +
        'Where the epic has a paper, `propose_chapter_parts` lists — and does not make — one part for each chapter ' +
        'file its main.tex pulls in.',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }

  if (rpc.method === 'tools/list') {
    return reply({
      tools: Object.keys(TOOLS).map((name) => ({
        name,
        description: TOOLS[name]!.description,
        inputSchema: TOOLS[name]!.schema,
      })),
    })
  }

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    /* `hasOwn`, because `name` is a string the caller chose and a bare lookup
       finds `constructor` on the prototype of any plain object — after which
       `.run(args)` is a TypeError thrown out of a request handler rather than
       an answer saying there is no such tool. The protocol package's essay on
       `MODULE_ID` is about this exact hazard, one door over. */
    if (!Object.hasOwn(TOOLS, name)) {
      const shown = name.length > 60 ? `${name.slice(0, 60)}…` : name
      return reply({ content: [{ type: 'text', text: `no tool "${shown}" here` }], isError: true })
    }
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
    try {
      return reply({ content: [{ type: 'text', text: TOOLS[name]!.run(args) }] })
    } catch (e) {
      return reply({
        content: [{ type: 'text', text: `that could not be written down: ${(e as Error).message}` }],
        isError: true,
      })
    }
  }

  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/**
 * Every door but the page, as one function.
 *
 * `null` means "this path is not ours", and the caller passes it on to Vite —
 * which is how the page, the client module and Vite's own hot-reload socket
 * keep working without being enumerated here.
 */
export function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Reply | null {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  /**
   * The write ticket for one project, handed only to something that already
   * holds the process ticket.
   *
   * `vite.config.ts` argues that `GET /api/ticket` would be "the ticket
   * abolished with extra steps", and it is right about a GET: an ungated route
   * that hands over the write credential is the same as not having one. This is
   * not that route. It is a POST, it is refused without the process ticket
   * printed into `/app`, and what it returns is not the credential but a
   * DERIVATION of it bound to one project. Something that can call this could
   * already write; what it gets back is a ticket that only works for the project
   * it asked about, which is the whole point — see `writeTicketFor`.
   *
   * Answered before the read doors so that a page which has just been told it
   * moved project can take out its ticket in the same breath as it re-reads.
   */
  if (path === '/api/ticket' && method === 'POST') {
    const stale = refuseTicket(ticket, TICKET, NOT_THIS_PAGE)
    if (stale) return stale
    const project = str(body?.project, MAX_PROJECT)
    const write = writeTicketFor(project)
    if (write === null) {
      /* No ticket rather than an unusable one, and the sentence is the
         project's own: the caller's problem is the path, and telling them their
         ticket is wrong would send them to look at the wrong thing. */
      const store = held(project)
      return bad(nothingToReadIn(store) ?? NOWHERE, 409)
    }
    return ok({ ok: true, ticket: write })
  }

  if (path === '/api/journeys' && method === 'GET') {
    const store = held(str(query.get('project'), MAX_PROJECT))
    return ok({
      ok: true,
      journeys: listJourneys(store).map(brief),
      /* Said out loud rather than inferred from an empty list. A container that saw
         `journeys: []` and drew "no journeys yet" over a project whose file
         will not parse would be reporting somebody's work as absent. */
      nowhere: store.nowhere,
      trouble: store.trouble,
      from: store.from,
    })
  }

  if (path === '/api/journey' && method === 'GET') {
    const slug = str(query.get('slug'), MAX_SLUG)
    /* Refused the same way whether or not the journey exists. A refusal that
       distinguished "no such journey" from "not a journey name" would be a way
       to enumerate what is here, and the protocol package makes exactly this
       argument about `epic` at the host's own door. */
    if (!isSlug(slug)) return bad('that is not a journey name')
    const store = held(str(query.get('project'), MAX_PROJECT))
    const nothing = nothingToReadIn(store)
    /* 409 rather than 404: there is no answer to "is this journey here" until
       there is a here. A 404 would say the journey does not exist, which is a
       claim about a store this app has not opened. */
    if (nothing) return bad(nothing, 409)
    const journey = journeyIn(store, slug)
    if (!journey) return bad(`this project does not hold a journey called "${slug}"`, 404)
    return ok({ ok: true, journey: view(journey) })
  }

  /**
   * What the epic's paper says about parts. A read, like the two above it,
   * and answered whether or not the journey exists — see `chapters`.
   */
  if (path === '/api/chapters' && method === 'GET') {
    const slug = str(query.get('slug'), MAX_SLUG)
    const out = chapters(str(query.get('project'), MAX_PROJECT), slug)
    if (!out.ok) return bad(out.error, out.status)
    if (!out.chapters) return ok({ ok: true, slug, paper: false })
    return ok({
      ok: true,
      slug,
      paper: true,
      ...out.chapters,
      /* The two sentences the page prints, worked out where the MCP door's
         are, so a person and an agent are told the same thing. */
      nothing: nothingSaid(out.chapters),
      leftOut: leftOutSaid(out.chapters),
    })
  }

  if (method === 'POST' && path.startsWith('/api/')) {
    if (!body) return bad('that was not a request')
    /*
     * Two questions, so two credentials, and they travel apart.
     *
     * The HEADER (`x-module-ticket`, the one every module uses) carries the process ticket printed
     * into the page: is this this app's own page, served by THIS process? A no there is the
     * protocol's marked refusal, which a page reads as "I am older than my server" and reloads on.
     *
     * The BODY carries the project ticket, beside the project it was taken out for: was this write
     * composed against the project it names? A no there is this module's own refusal, and no
     * reload would fix it.
     */
    const stale = refuseTicket(ticket, TICKET, NOT_THIS_PAGE)
    if (stale) return stale
    const project = str(body.project, MAX_PROJECT)
    /* The ticket is checked against the PROJECT THIS WRITE NAMES, so a ticket
       taken out while another project was open does not redeem here. See the
       essay on `writeTicketFor`: the failure it catches is a save composed
       against project A arriving after the host moved the page to project B. */
    const expected = writeTicketFor(project)
    if (expected === null || !sameTicket(typeof body.ticket === 'string' ? body.ticket : null, expected)) {
      return bad(
        'that write did not come from this app’s own page, on this project. A ticket is taken out for one project '
          + 'and does not redeem against another: if the canvas has just moved, re-open the journey before saving, '
          + 'so that what is written is written where it was composed.',
        403,
      )
    }
    const slug = str(body.slug, MAX_SLUG)

    if (path === '/api/step') {
      const out = setStep(
        project,
        slug,
        position(body.position),
        {
          title: str(body.title, MAX_TITLE),
          body: str(body.body, MAX_BODY),
          refs: list(body.refs, MAX_REF),
          notes: list(body.notes, MAX_NOTE),
        },
        partArg(body),
      )
      if (!out.ok) return bad(out.error)
      return ok({ ok: true, journey: view(out.journey) })
    }

    /* The three doors that arrange a journey into parts. Each is one of the
       functions MCP calls, so the page and an agent are refused in the same
       words; each answers with the journey and the sentence to print. */
    if (path === '/api/assign') {
      const out = assignSteps(project, slug, positions(body.positions), partArg(body) ?? null)
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said })
    }

    if (path === '/api/part') {
      const out = setPart(project, slug, {
        id: str(body.id, MAX_PART) || null,
        heading: str(body.heading, MAX_TITLE),
        ...(Array.isArray(body.refs) ? { refs: list(body.refs, MAX_REF) } : {}),
        /* Handed on as it arrived, and not through `list`: that helper drops
           what it cannot read, and a file that is not one has to be REFUSED
           by name (`filesGiven`). Null is "not given", as JSON says it. */
        ...(body.files === undefined || body.files === null ? {} : { files: body.files }),
      })
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said, id: out.id })
    }

    if (path === '/api/parts/chapters') {
      const out = makeChapterParts(project, slug, list(body.files, MAX_FILE))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said })
    }

    if (path === '/api/part/remove') {
      const out = removePart(project, slug, str(body.id, MAX_PART))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said })
    }

    /**
     * Begin a journey for the epic the canvas is standing on.
     *
     * `seed` is what the host answered `epic.get` with, when the page was
     * framed and was answered; absent, the host's own file is read instead.
     * See `createJourney` for why the record is never begun empty. It arrives
     * from a page, so it is bounded before it is looked at — as one document,
     * by its length — and then held to the journey schema like anything else
     * that is about to be written.
     */
    if (path === '/api/journey') {
      const seed = body.seed
      if (seed !== undefined && seed !== null) {
        let size = MAX_SEED + 1
        try {
          size = JSON.stringify(seed).length
        } catch {
          /* Not JSON at all; refused as too large, which it effectively is. */
        }
        if (size > MAX_SEED) {
          return bad(
            `what the host holds for that epic is ${size > MAX_SEED + 1 ? `${size} characters` : 'not something'} this `
              + `app will take in one piece (the bound is ${MAX_SEED}). Nothing was created: a record made from part `
              + 'of it would hide the rest.',
          )
        }
      }
      const out = createJourney(project, slug, { seed, title: str(body.title, MAX_TITLE) })
      if (!out.ok) return bad(out.error)
      return ok({ ok: true, journey: view(out.journey), from: out.from, said: begun(out, dataFile(project).path) })
    }

    if (path === '/api/dependency') {
      if (!isSlug(slug)) return bad('that is not a journey name')
      const store = held(project)
      const nothing = nothingToReadIn(store)
      if (nothing) return bad(nothing, 409)
      const journey = journeyIn(store, slug)
      if (!journey) return bad(`this project does not hold a journey called "${slug}"`, 404)
      const ref = str(body.ref, MAX_REF)
      if (!ref) return bad('which reference is blocked?')
      const gates = list(body.blockedBy, MAX_REF)
      if (gates.length) journey.blockedBy[ref] = gates
      else delete journey.blockedBy[ref]
      const written = writeJourney(project, journey)
      if (!written.ok) return bad(written.error)
      return ok({ ok: true, journey: view(written.journey) })
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }
