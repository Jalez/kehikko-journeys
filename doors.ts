import { createHash } from 'node:crypto'

import { establishBuild, mintTicket, refuseTicket, sameTicket, type Reply } from 'kehikot-module-protocol/serve'

import { tooLong } from './limits.ts'
import { stepPart } from 'kehikot-module-protocol'

import { ID, MANIFEST, VERSION } from './manifest.ts'
import { MAIN, chaptersIn } from './paper.ts'
import { FILE_EXAMPLE, fileOf, findingsSaid, idFor, nameOf, notAStep, stepOfPart, withPart, withStep, withoutStep } from './parts.ts'
import {
  type Held,
  type Journey,
  type Written,
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
function view(journey: Journey, unsettled = false) {
  /* `unsettled` is whether the record ON DISK is still in the older shape of
     parts: what is handed over is already the simple reading of it, and the
     page needs the one bit to know that a host reading the file sees the older
     one until something is written. See `Unsettled` in `store.ts`. */
  return { ...journey, plan: planOf(journey).kind, unsettled }
}

/**
 * What to say when a write was the one that stored a journey of the older
 * shape as one step to a part; empty otherwise. Said by every door that
 * writes, so that nothing is decided about somebody's parts in silence.
 */
function settledSaid(written: Extract<Written, { ok: true }>): string {
  if (!written.settled) return ''
  const decided = findingsSaid(written.settled.findings)
  return (
    ` This journey was stored in an older shape, where a part could hold several steps or none. It is now one step to `
    + `a part, and the record as it was is kept in ${written.settled.before}.${decided ? ` ${decided}` : ''}`
  )
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
 * ## The part is not one of the four
 *
 * A step is the step of one part of the epic, and writing the step again does
 * not say anything about the part: its id stays, and so do its name and the
 * document it covers. `name` and `file` are each three-valued — left out, the
 * part keeps what it has; empty, the name goes back to being the step's title
 * and the part covers no document; given, it is set. A name that was only
 * ever the title follows the title when it is reworded. See `parts.ts`.
 *
 * A step is found by its 1-based `position` or by `id` — the id of its part,
 * which does not move when a step before it is removed.
 */
function setStep(
  project: string | null,
  slug: string,
  where: { position?: number; id?: string },
  step: { title: string; body: string; refs: string[]; notes: string[] },
  given: { name?: string | null; file?: unknown } = {},
): { ok: false; error: string } | { ok: true; journey: Journey; where: number; id: string; said: string } {
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

  let at: number
  if (where.id) {
    at = stepOfPart(journey, where.id)
    if (at < 0) return { ok: false, error: `${notAStep(journey, where.id)} The step was not written.` }
  } else {
    at = where.position && where.position <= journey.steps.length ? where.position - 1 : journey.steps.length
  }

  const parsed = stepSchema.parse({ ...journey.steps[at], ...step })
  /* A new step that is given a name takes its id from the name — `methods`,
     and not the slug of a sentence about what a reader can repeat. */
  if (at === journey.steps.length && typeof given.name === 'string' && given.name) {
    parsed.part = idFor(given.name, journey.groups.map((group) => group.id ?? ''), at + 1)
  }
  let record = withStep(journey, at, parsed)
  if (given.name !== undefined || given.file !== undefined) {
    const out = withPart(record, at, given)
    if (!out.ok) return { ok: false, error: `${out.error} The step was not written.` }
    record = out.record
  }

  const written = writeJourney(project, record)
  if (!written.ok) return { ok: false, error: written.error }
  const kept = written.journey.steps[at]
  return {
    ok: true,
    journey: written.journey,
    where: at + 1,
    id: (kept && stepPart(kept)) || '',
    said: settledSaid(written),
  }
}

/**
 * Take a step out, by its 1-based position or the id of its part. Its part
 * goes with it — a part is its step — and the steps after it move up.
 */
function removeStep(
  project: string | null,
  slug: string,
  where: { position?: number; id?: string },
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `no journey "${slug}" in ${project}`, status: 404 }
  let at: number
  if (where.id) {
    at = stepOfPart(journey, where.id)
    if (at < 0) return { ok: false, error: notAStep(journey, where.id) }
  } else {
    if (!where.position || where.position > journey.steps.length) {
      return { ok: false, error: `${slug} has ${journey.steps.length} stored steps` }
    }
    at = where.position - 1
  }
  const gone = journey.steps[at]
  const id = gone ? stepPart(gone) : null
  const file = gone ? fileOf(journey, gone) : null
  const written = writeJourney(project, withoutStep(journey, at))
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    said:
      `Removed step ${at + 1} (“${gone?.title ?? ''}”) from ${slug}, and its part (${id ?? 'unnamed'}) with it`
      + `${file ? `, which covered ${file}` : ''}. Anything kept elsewhere against that id now names nothing.`
      + settledSaid(written),
  }
}

/**
 * Store a journey as it is read, changing nothing in it — which, for one
 * still in the older shape of parts on disk, is the write that makes it one
 * step to a part there too. For one that already is, nothing is written.
 */
function settle(
  project: string | null,
  slug: string,
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `this project does not hold a journey called "${slug}"`, status: 404 }
  if (!Object.hasOwn(store.unsettled, slug)) {
    return { ok: true, journey, said: `Every step of ${slug} is already one part of the epic; there is nothing to divide.` }
  }
  const written = writeJourney(project, journey)
  if (!written.ok) return { ok: false, error: written.error }
  return { ok: true, journey: written.journey, said: settledSaid(written).trim() }
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
 * What a caller said about a part's name or document, out of a bag of
 * arguments: nothing, "none", or a value.
 *
 * Three answers, and the first is the one `str()` cannot give — it turns a
 * missing argument and an empty one into the same `''`, which here are
 * opposites: a missing one leaves the part as it is, and an empty one clears
 * it. `null` counts as empty, because that is what a page's JSON sends.
 */
function given(bag: Record<string, unknown>): { name?: string | null; file?: unknown } {
  const out: { name?: string | null; file?: unknown } = {}
  if (Object.hasOwn(bag, 'name') && bag.name !== undefined) out.name = str(bag.name, MAX_TITLE) || null
  /* The document is handed on as it arrived: one that is not a name has to be
     REFUSED by name (`fileGiven`), and `str` would only shorten it. */
  if (Object.hasOwn(bag, 'file') && bag.file !== undefined) out.file = bag.file === null ? null : bag.file
  return out
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The documents the epic's paper is made of, for a project and an epic —
 * whether or not the journey has been begun — each with the part that covers
 * it. `null` is "this epic has no paper here", an answer and not a refusal.
 *
 * This and `stepsFromChapters` are the two places this app looks at a folder
 * that is another module's; see `paper.ts` for what is read and why. Both go
 * when a host can be asked which documents an epic has.
 */
function chapters(
  project: string | null,
  slug: string,
): { ok: false; error: string; status?: number } | { ok: true; chapters: { file: string; heading: string; part: string | null }[] | null } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  const found = chaptersIn(project, slug)
  if (!found) return { ok: true, chapters: null }
  const owner = new Map<string, string>()
  for (const step of journey?.steps ?? []) {
    const file = journey ? fileOf(journey, step) : null
    const id = stepPart(step)
    if (file && id) owner.set(file, id)
  }
  return { ok: true, chapters: found.parts.map((one) => ({ file: one.file, heading: one.heading, part: owner.get(one.file) ?? null })) }
}

/**
 * A step for each document the epic's paper pulls in that no part covers
 * yet, in the paper's order, in one write: titled with the document's own
 * first heading, with nothing written in it, and covering that document.
 *
 * It is what a paper with seven chapters and a journey with no steps needs:
 * seven parts, each with its step and its chapter, from one press. Worked out
 * from the disk at the moment of the press; nothing is taken from the caller.
 */
function stepsFromChapters(
  project: string | null,
  slug: string,
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `this project does not hold a journey called "${slug}"`, status: 404 }
  const elsewhere = refusedBecauseElsewhere(journey)
  if (elsewhere) return { ok: false, error: elsewhere }
  const found = chaptersIn(project, slug)
  if (!found) {
    return { ok: false, error: `this epic has no paper in this project (no ${MAIN} in .kehikot/paper/${slug}/), so there is no chapter to make a step for.` }
  }
  const covered = new Set(journey.steps.map((step) => fileOf(journey, step)).filter(Boolean))
  const free = found.parts.filter((one) => !covered.has(one.file))
  if (!free.length) return { ok: false, error: 'Every chapter the paper pulls in already has its step. Nothing was made.' }
  let record = journey
  for (const one of free) {
    const at = record.steps.length
    record = withStep(record, at, stepSchema.parse({ title: one.heading, body: '', refs: [], notes: [] }))
    const out = withPart(record, at, { file: one.file })
    if (!out.ok) return out
    record = out.record
  }
  const written = writeJourney(project, record)
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    said: `Made ${count(free.length, 'step')}, one for each chapter the paper pulls in: ${free.map((one) => `“${one.heading}”`).join(', ')}.${settledSaid(written)}`,
  }
}

/**
 * A journey's steps as parts, in lines an agent can read: position, the id
 * of the step's part, what the part is called and the document it covers.
 *
 * Printed above the document by `get_journey`. The ids are what `step` takes
 * on `set_step` and `remove_step`, and what a host stores for a picked part.
 */
function stepsSaid(journey: Journey, unsettled: boolean): string {
  if (!journey.steps.length) return ''
  const lines = journey.steps.map((step, i) => {
    const file = fileOf(journey, step)
    return `  ${i + 1}\t${stepPart(step) ?? '?'}\t“${nameOf(journey, step)}”${file ? `\t${file}` : ''}`
  })
  return (
    'STEPS: each step is one part of the epic, and a part is one step. Position, the id of the step’s part (what '
    + '`step` takes, and what a host keeps for a picked part), what the part is called, and the document it covers '
    + 'if it covers one:\n'
    + `${lines.join('\n')}\n`
    + (unsettled
      ? 'NOT YET STORED LIKE THIS: on disk this journey is still in an older shape, where a part could hold several '
        + 'steps or none. What is below is how it reads now; nothing has been written, and the first write to this '
        + 'journey stores it so and says what was decided.\n'
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
 * the file forever.
 *
 * There is no tool for parts, and there used to be four. A step is one part
 * of the epic and a part is one step, so making a part is `set_step`, naming
 * it and giving it its document are two arguments of `set_step`, and removing
 * it is `remove_step`. `assign_steps`, `set_part`, `remove_part` and
 * `propose_chapter_parts` are gone rather than kept answering "call something
 * else": nothing calls them but an agent reading the list, and the list no
 * longer has them.
 *
 * Every tool says whether it only reads and whether it can destroy
 * (`annotations`), which is what a client shows before it asks a person.
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
interface Annotations {
  title: string
  readOnlyHint: boolean
  /** Whether it can overwrite or remove what was there. Meaningless on a read. */
  destructiveHint?: boolean
  idempotentHint?: boolean
  /** Whether it reaches beyond this machine. Nothing here does. */
  openWorldHint: false
}

const TOOLS: Record<string, { description: string; schema: object; annotations: Annotations; run: ToolCall }> = {
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
    annotations: { title: 'List journeys', readOnlyHint: true, openWorldHint: false },
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
      'says where the steps actually come from. Each step is one part of the epic: the lines above the JSON ' +
      'list every step with its position, the id of its part (what `step` takes on `set_step` and ' +
      '`remove_step`), what the part is called and the document it covers. In the JSON a step’s `part` is that ' +
      'id, and `groups` is the same list as a host reads it.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'e.g. modes-are-modules' },
      },
      required: ['project', 'slug'],
    },
    annotations: { title: 'Read a journey', readOnlyHint: true, openWorldHint: false },
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
      return preamble + stepsSaid(journey, Object.hasOwn(store.unsettled, slug)) + JSON.stringify(journey, null, 2)
    },
  },

  create_journey: {
    description:
      'Begin the journey for an epic that has none yet: the first record, from which this app owns that epic’s ' +
      'steps and the prose around them. It is NOT made empty. The record starts as ' +
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
    annotations: { title: 'Begin a journey', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      'deliver it. A step is one PART of the epic — the thing a person picks in the host’s bar to narrow every ' +
      'module — so adding a step adds a part and there is nothing else to make or file. Omit `position` and ' +
      '`step` to append; pass `position` (1-based) or `step` (the id of the step’s part, which does not move ' +
      'when other steps are removed) to overwrite that step. Read the step first: this writes the whole step, ' +
      'so of title, body, refs and notes anything you leave out is gone and anything stale you keep is a claim ' +
      'you are making afresh. Refused on a journey whose steps are kept elsewhere, with a sentence saying where ' +
      'to write instead. `name` and `file` are about the step’s part and are NOT cleared by leaving them out: ' +
      '`name` is what the part is called where it is picked (short — "Methods"; without one it is the step’s ' +
      'title), and `file` is the one document the part covers, named from the folder the epic’s documents are in ' +
      `with forward slashes and its extension ("${FILE_EXAMPLE}"). Pass "" to clear either. A document belongs ` +
      'to one part: one another step has is refused, naming the step. The answer says the step’s position and id.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        title: { type: 'string', description: "What becomes true, phrased from the user's side" },
        body: { type: 'string', description: 'Why it matters and where it stands. 150 words at most.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'e.g. ["#2274", "!1801", "gh#41"]' },
        notes: { type: 'array', items: { type: 'string' }, description: 'Chips for work with no ticket' },
        position: { type: 'number', description: '1-based position of the step to overwrite. Omit, with `step`, to append.' },
        step: { type: 'string', description: 'The id of the step to overwrite, from `get_journey`. Instead of `position`.' },
        name: { type: 'string', description: 'What the step’s part is called where parts are picked. Omit to leave it; "" for the title.' },
        file: { type: 'string', description: `The one document the step’s part covers, e.g. "${FILE_EXAMPLE}". Omit to leave it; "" for none.` },
      },
      required: ['project', 'slug', 'title'],
    },
    annotations: { title: 'Write a step', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = setStep(
        named.project,
        str(args.slug, MAX_SLUG),
        { position: position(args.position), id: str(args.step, MAX_PART) || undefined },
        {
          title: str(args.title, MAX_TITLE),
          body: str(args.body, MAX_BODY),
          refs: list(args.refs, MAX_REF),
          notes: list(args.notes, MAX_NOTE),
        },
        given(args),
      )
      if (!out.ok) return out.error
      /* The path is asked for rather than spelled here. The folder's name lives
         in one constant in the protocol package, and a sentence that wrote it
         out by hand would be the one place that keeps saying `.kehikot` on the
         day it is called something else. */
      const step = out.journey.steps[out.where - 1]
      const file = step ? fileOf(out.journey, step) : null
      return (
        `Set step ${out.where} of ${out.journey.slug} (id ${out.id}, called “${step ? nameOf(out.journey, step) : ''}”`
        + `${file ? `, covering ${file}` : ''}), in ${dataFile(named.project).path} and nowhere else.`
        /* An argument this door took until a part stopped being something a
           step is filed under. Said, because ignoring it in silence would
           leave an agent believing it had moved a step. */
        + (Object.hasOwn(args, 'part') ? ' `part` is no longer taken: a step is its own part, and its id is the one above.' : '')
        + out.said
      )
    },
  },

  remove_step: {
    description:
      'Drop one step, by its 1-based `position` or by `step` (the id of its part); the steps after it renumber. ' +
      'Its part goes with it — a part is its step — so the name and the document it covered are gone too, and ' +
      'whatever another module keeps against that id names nothing afterwards. Allowed on a journey whose steps ' +
      'are projected elsewhere, because there the stored steps are leftovers nothing reads — removing them is ' +
      "the cleanup set_step's refusal creates the need for.",
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        position: { type: 'number', description: '1-based position of the step' },
        step: { type: 'string', description: 'The id of the step, from `get_journey`. Instead of `position`.' },
      },
      required: ['project', 'slug'],
    },
    annotations: { title: 'Remove a step', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = removeStep(named.project, str(args.slug, MAX_SLUG), {
        position: position(args.position),
        id: str(args.step, MAX_PART) || undefined,
      })
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
    annotations: { title: 'Set what blocks a reference', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
      return (gates.length ? `${ref} now waits on ${gates.join(', ')}.` : `${ref} has no blockers.`) + settledSaid(written)
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
  const held = steps
  const decided = findingsSaid(out.findings)
  const kept =
    `It is in ${where ?? 'this project'}, and its steps are edited here from now on.`
    + (decided ? ` What the host held was in an older shape of parts, and is one step to a part here: ${decided}` : '')
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
        'those means "not here", never "none". Each step is one part of the epic — what a person picks in a ' +
        'host’s bar to narrow every module — and a part is one step: `set_step` makes one and says what its part ' +
        'is called and which document it covers, `remove_step` removes both, and `get_journey` lists the ids.',
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
        annotations: TOOLS[name]!.annotations,
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
    return ok({ ok: true, journey: view(journey, Object.hasOwn(store.unsettled, slug)) })
  }

  /**
   * The documents the epic's paper is made of, each with the part that covers
   * it. A read, like the two above it, and answered whether or not the
   * journey exists — see `chapters`.
   */
  if (path === '/api/chapters' && method === 'GET') {
    const slug = str(query.get('slug'), MAX_SLUG)
    const out = chapters(str(query.get('project'), MAX_PROJECT), slug)
    if (!out.ok) return bad(out.error, out.status)
    if (!out.chapters) return ok({ ok: true, slug, paper: false })
    return ok({ ok: true, slug, paper: true, chapters: out.chapters })
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
        { position: position(body.position), id: str(body.step, MAX_PART) || undefined },
        {
          title: str(body.title, MAX_TITLE),
          body: str(body.body, MAX_BODY),
          refs: list(body.refs, MAX_REF),
          notes: list(body.notes, MAX_NOTE),
        },
        given(body),
      )
      if (!out.ok) return bad(out.error)
      return ok({ ok: true, journey: view(out.journey), said: out.said.trim() })
    }

    if (path === '/api/step/remove') {
      const out = removeStep(project, slug, { position: position(body.position), id: str(body.step, MAX_PART) || undefined })
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said })
    }

    /* A step for each chapter of the epic's paper that has none. */
    if (path === '/api/steps/chapters') {
      const out = stepsFromChapters(project, slug)
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey), said: out.said })
    }

    /* Store a journey that is still in the older shape of parts on disk as
       it is read. The one write here that changes nothing a person wrote. */
    if (path === '/api/settle') {
      const out = settle(project, slug)
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
      return ok({ ok: true, journey: view(written.journey), said: settledSaid(written).trim() })
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }
