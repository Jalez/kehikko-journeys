import { createHash } from 'node:crypto'

import { establishBuild, mintTicket, refuseTicket, sameTicket, type Reply } from 'kehikot-module-protocol/serve'

import { tooLong } from './limits.ts'
import { cycleSaid, nextStep, nodeId, treeOf } from './src/tree.ts'
import { phaseOfEach, phasesOf, type Phase } from './src/phases.ts'
import { isTracked } from './src/refs.ts'
import { alsoSaid, sharedRefs, type Also } from './src/shared.ts'
import {
  GATE_ID,
  GATE_KINDS,
  KIND_SAID,
  REF_ROLES,
  gateIdFor,
  gateSaid,
  gatesOf,
  isGateKind,
  isRefRole,
  stepGates,
  type Gate,
} from './src/gates.ts'
import { factoryStages } from './factory.ts'

import { JOURNEYS_KEEP, listedBy, type Keeper } from './keeper.ts'
import { PART_ID, manifestSchema, slugFrom, type Manifest } from 'kehikot-module-protocol'
import { stepPart } from './src/part.ts'
import { ID, MANIFEST as DECLARED, VERSION } from './manifest.ts'
import { serveFrom, skillAt, skillDeclarations } from './skills.ts'
import { resolveProject } from './project.ts'
import { fileOf, findingsSaid, idFor, nameOf, notAStep, stepOfPart, withPart, withStep, withStepMoved, withoutStep } from './parts.ts'
import {
  type Held,
  type Journey,
  type Written,
  NOWHERE,
  createJourney,
  dataFile,
  held,
  hostEpic,
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

/** The manifest as served: the one in manifest.ts, with the skill this module offers (`skills.ts`). */
export const MANIFEST: Manifest = manifestSchema.parse({ ...DECLARED, declares: { ...DECLARED.declares, skills: skillDeclarations() } })

/**
 * Say the origin this process really serves on, once it is listening (vite.config.ts): the skill's
 * text is filled in for it and the version the manifest declares follows. In place, because the
 * manifest `doors()` serves is this object, read on every request.
 */
export function servingAt(origin: string): void {
  serveFrom(origin)
  const skills = MANIFEST.declares?.skills
  if (skills) skills.splice(0, skills.length, ...skillDeclarations())
}

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
function view(journey: Journey, keeper: Keeper, unsettled = false, project?: string | null) {
  /* `unsettled` is whether the record ON DISK is still in the older shape of
     parts: what is handed over is already the simple reading of it, and the
     page needs the one bit to know that a host reading the file sees the older
     one until something is written. See `Unsettled` in `store.ts`.

     `listed` is who keeps the list of the epic's parts, as the page needs it:
     the host's list, or null because this app keeps it (`keeper.ts`). Where
     the host does, `groups` is not handed over at all — it says nothing about
     the parts any more, and what is not sent cannot be read. */
  const also = alsoIn(journey, project)
  if (keeper.by === 'host') {
    const { groups: _groups, ...rest } = journey
    return { ...rest, ...also, plan: planOf(journey).kind, unsettled: false, listed: keeper.list }
  }
  return { ...journey, ...also, plan: planOf(journey).kind, unsettled, listed: null }
}

/**
 * Where the project's OTHER journeys name the refs this one does (`src/shared.ts`), read from the
 * same folder this journey is kept in. Absent when none does, so a journey nobody shares reads as
 * it always did. Read fresh each time and never stored: it is a fact about two files, and a copy of
 * it in either would be wrong the moment the other changed.
 */
function alsoIn(journey: Journey, project: string | null | undefined): { alsoIn?: Record<string, Also[]> } {
  if (project === undefined) return {}
  const others = listJourneys(held(project))
  const found = sharedRefs(journey.slug, [...refsOf(journey), ...(journey.gates ?? []).flatMap((gate) => (Array.isArray(gate.waitsOn) ? (gate.waitsOn as string[]) : []))], others)
  return Object.keys(found).length ? { alsoIn: found } : {}
}

/** The refs this journey shares with others, in lines an agent can read, above the JSON. Empty when none. */
function alsoSaidFor(journey: Journey, project: string | null): string {
  const found = alsoIn(journey, project).alsoIn
  if (!found) return ''
  const lines = Object.entries(found).map(([ref, where]) => `  ${ref}\talso in ${where.map(alsoSaid).join('; ')}`)
  return `ALSO IN: refs this journey shares with other journeys of the project (read-only; \`alsoIn\` in the JSON below has the epic, step and gate ids):\n${lines.join('\n')}\n\n`
}

/** What a write could not publish, as a sentence after the one that says what was written; empty when it did. */
const unpublishedSaid = (written: Extract<Written, { ok: true }>): string => (written.unpublished ? ` ${written.unpublished}` : '')

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
 * ## The part is not one of the four, and whose it is decides the rest
 *
 * A step is the step of one part of the epic, and writing the step again says
 * nothing about the part. What `name` and `part` do depends on who keeps the
 * epic's list of parts (`keeper.ts`), and this is the one place a step's
 * write branches on it:
 *
 *  - **This app keeps it** (a host from before protocol 1.2.0, or one that
 *    has not taken the list over yet). Exactly as it was: a new step is given
 *    a part with an id made here, `name` is what the part is called (left
 *    out, it stays; empty, it is the step's title again), and `part` is not
 *    taken.
 *  - **The host keeps it.** No id is made here and `groups` is not written.
 *    `part` is the id of a part THE HOST lists, for a step that is in none: a
 *    new one, or one whose part was removed. A part has one step, so an id
 *    another step has is refused, and an id the host does not list is refused
 *    — a step is never written pointing at a part that was not made. Without
 *    `part` a new step is in no part. `name` is not taken: the name is the
 *    epic's, and the answer says where it is changed.
 *
 * A step is found by its 1-based `position` or by `id` — the id of its part,
 * which does not move when a step before it is removed.
 */
function setStep(
  project: string | null,
  slug: string,
  where: { position?: number; id?: string },
  step: StepFields,
  given: Given = {},
): { ok: false; error: string } | { ok: true; journey: Journey; where: number; id: string; said: string; keeper: Keeper } {
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

  let at: number
  if (where.id) {
    at = stepOfPart(journey, where.id)
    if (at < 0) return { ok: false, error: `${notAStep(journey, where.id)} The step was not written.` }
  } else {
    at = where.position && where.position <= journey.steps.length ? where.position - 1 : journey.steps.length
  }

  const into = stepInto(journey, keeperIn(store, slug), at, step, given)
  if (!into.ok) return into
  const circle = cycleSaid(into.record.steps)
  if (circle) return { ok: false, error: circle }
  const written = writeJourney(project, into.record)
  if (!written.ok) return { ok: false, error: written.error }
  const kept = written.journey.steps[at]
  return {
    ok: true,
    journey: written.journey,
    where: at + 1,
    id: (kept && stepPart(kept)) || '',
    said: into.said + settledSaid(written) + unpublishedSaid(written),
    keeper: written.keeper,
  }
}

/** The four things `set_step` says of a step every time. */
interface StepFields {
  title: string
  body: string
  refs: string[]
  notes: string[]
}

/**
 * The record with the step at `at` (zero-based; one past the end appends) written, or why it cannot be:
 * every refusal `set_step` and `patch_step` share. Nothing is written here, and a loop between steps is
 * the caller's to check, on the record it is about to write.
 */
function stepInto(
  journey: Journey,
  keeper: Keeper,
  at: number,
  step: StepFields,
  given: Given,
): { ok: false; error: string } | { ok: true; record: Journey; said: string } {
  if (!step.title) return { ok: false, error: 'a step has to say what becomes true' }
  const long = tooLong(step.body)
  if (long) return { ok: false, error: long }
  const parsed = stepSchema.parse({ ...journey.steps[at], ...step })
  /* Its place in the tree. An id that names no step is refused, never kept pointing at nothing. */
  if (given.under !== undefined) {
    if (given.under === null) delete parsed.under
    else {
      const known = journey.steps.some((one, i) => i !== at && stepPart(one) === given.under)
      if (!known) return { ok: false, error: `“${given.under}” is not the id of another step of this journey, so nothing can be under it. The step was not written.` }
      parsed.under = given.under
    }
  }
  if (given.phase !== undefined) {
    if (given.phase === null) delete parsed.phase
    else {
      const phases = phasesOf(journey)
      if (!phases.some((one) => one.id === given.phase)) return { ok: false, error: `${notAPhase(phases, given.phase)} The step was not written.` }
      parsed.phase = given.phase
    }
  }
  if (given.issue !== undefined) {
    if (given.issue === null) delete parsed.issue
    else {
      parsed.issue = given.issue
      if (!parsed.refs.includes(given.issue)) parsed.refs = [given.issue, ...parsed.refs]
    }
  }
  /* The gates that hold it (`src/gates.ts`): left out, they stay; [] clears. An id no gate has is
     refused, never kept pointing at nothing. */
  if (given.blockedBy !== undefined) {
    const known = new Set(gatesOf(journey).map((gate) => gate.id))
    const unknown = given.blockedBy.filter((id) => !known.has(id))
    if (unknown.length) {
      return {
        ok: false,
        error:
          `${andSaid(unknown.map((one) => `“${one}”`))} ${unknown.length === 1 ? 'is not the id of a gate' : 'are not ids of gates'} of this journey. `
          + 'A gate is made with `set_gate`, and `get_journey` lists them. The step was not written.',
      }
    }
    if (given.blockedBy.length) parsed.blockedBy = [...new Set(given.blockedBy)]
    else delete parsed.blockedBy
  }
  /* What each ref is to the step. Left out, the roles stay for the refs that are still there. */
  if (given.roles !== undefined) {
    const roles: Record<string, string> = {}
    for (const [ref, role] of Object.entries(given.roles)) {
      if (!isRefRole(role)) {
        return { ok: false, error: `“${role}” is not a role for ${ref}: a ref ${REF_ROLES.join(', ')} the step. The step was not written.` }
      }
      if (!parsed.refs.includes(ref)) {
        return { ok: false, error: `${ref} is not one of this step’s refs, so it has no role here. Put it in \`refs\` too. The step was not written.` }
      }
      if (role !== 'delivers') roles[ref] = role
    }
    if (Object.keys(roles).length) parsed.roles = roles
    else delete parsed.roles
  } else if (parsed.roles && typeof parsed.roles === 'object') {
    const kept = Object.fromEntries(Object.entries(parsed.roles as Record<string, unknown>).filter(([ref, role]) => parsed.refs.includes(ref) && isRefRole(role) && role !== 'delivers'))
    if (Object.keys(kept).length) parsed.roles = kept
    else delete parsed.roles
  }
  let record: Journey
  let said = ''
  if (keeper.by === 'host') {
    const before = journey.steps[at]
    const had = before ? stepPart(before) : null
    if (given.part !== undefined && given.part !== had) {
      if (!listedBy(keeper, given.part)) {
        return {
          ok: false,
          error:
            `"${given.part}" is not a part of this epic${keeper.list.length ? `. Its parts are: ${keeper.list.map((one) => one.id).join(', ')}` : ', which has none'}. `
            + 'The host keeps that list: a part is added there, and its id passed here. The step was not written.',
        }
      }
      const other = journey.steps.findIndex((one, i) => i !== at && stepPart(one) === given.part)
      if (other >= 0) {
        return {
          ok: false,
          error:
            `${given.part} already has its step: step ${other + 1} (“${journey.steps[other]?.title ?? ''}”). A part has one step. `
            + 'The step was not written.',
        }
      }
      if (listedBy(keeper, had)) {
        return {
          ok: false,
          error: `This step is the step of ${had}, a part the epic still has, and a step does not move to another part. The step was not written.`,
        }
      }
      parsed.part = given.part
    }
    if (typeof given.name === 'string' && given.name) said += ` ${NAME_IS_THE_HOSTS}`
    record = { ...journey, steps: before ? journey.steps.map((one, i) => (i === at ? parsed : one)) : [...journey.steps, parsed] }
  } else {
    /* A new step that is given a name takes its id from the name — `methods`,
       and not the slug of a sentence about what a reader can repeat. */
    if (at === journey.steps.length && typeof given.name === 'string' && given.name) {
      parsed.part = idFor(given.name, journey.groups.map((group) => group.id ?? ''), at + 1)
    }
    record = withStep(journey, at, parsed)
    if (given.name !== undefined) {
      const out = withPart(record, at, { name: given.name })
      if (!out.ok) return { ok: false, error: `${out.error} The step was not written.` }
      record = out.record
    }
  }

  return { ok: true, record, said }
}

/** What a step's patch may name. A field left out stays as it was. */
const PATCHABLE = ['title', 'body', 'refs', 'notes', 'part', 'under', 'phase', 'issue', 'blockedBy', 'roles'] as const

/** One step's change on `patch_step`: the fields it names, and nothing it left out. */
interface StepPatch {
  step: string
  fields: Partial<StepFields>
  given: Given
  named: string[]
}

/**
 * A patch out of a bag of arguments, or why it is not one. A list field that is not a list is refused
 * rather than read as empty: on a patch, an empty list clears, and a value sent in the wrong shape
 * would otherwise erase what it meant to change.
 */
function patchIn(bag: Record<string, unknown>): { ok: false; error: string } | { ok: true; patch: StepPatch } {
  const step = str(bag.step, MAX_PART)
  if (!step) return { ok: false, error: 'Which step? Pass `step`, the id of its part from `get_journey`.' }
  const passed = (key: string) => Object.hasOwn(bag, key) && bag[key] !== undefined
  const named = PATCHABLE.filter(passed)
  if (!named.length) return { ok: false, error: `Nothing to change on ${step}: pass any of ${andSaid(PATCHABLE.map((key) => `\`${key}\``))}.` }
  for (const key of ['refs', 'notes', 'blockedBy']) {
    if (passed(key) && bag[key] !== null && !Array.isArray(bag[key])) {
      return { ok: false, error: `\`${key}\` is a list of strings, and ${step}’s arrived as ${typeof bag[key]}.` }
    }
  }
  if (passed('roles') && bag.roles !== null && (typeof bag.roles !== 'object' || Array.isArray(bag.roles))) {
    return { ok: false, error: `\`roles\` is an object, { "<ref>": "prior-art" | "related" | "delivers" }, and ${step}’s arrived as ${Array.isArray(bag.roles) ? 'a list' : typeof bag.roles}.` }
  }
  if (passed('part') && !str(bag.part, MAX_PART)) return { ok: false, error: '`part` is the id of a part the host lists; a step’s part is not cleared.' }
  const fields: Partial<StepFields> = {}
  if (passed('title')) fields.title = str(bag.title, MAX_TITLE)
  if (passed('body')) fields.body = str(bag.body, MAX_BODY)
  if (passed('refs')) fields.refs = list(bag.refs, MAX_REF)
  if (passed('notes')) fields.notes = list(bag.notes, MAX_NOTE)
  const { name: _name, ...rest } = given(bag)
  return { ok: true, patch: { step, fields, given: rest, named } }
}

/**
 * Change only what each patch names on existing steps, in one write: every patch is applied in order
 * to the record the one before it left, with `set_step`'s refusals, and the loop check is made on the
 * result, so a restructure may pass through a shape that would loop on the way to one that does not.
 * One refusal and nothing is written.
 */
function patchSteps(
  project: string | null,
  slug: string,
  patches: StepPatch[],
): { ok: false; error: string } | { ok: true; journey: Journey; done: { where: number; id: string; named: string[] }[]; said: string } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `no journey "${slug}" here. A patch changes steps that exist: begin a journey with \`create_journey\` and write its steps with \`set_step\`.` }
  const elsewhere = refusedBecauseElsewhere(journey)
  if (elsewhere) return { ok: false, error: elsewhere }
  if (!patches.length) return { ok: false, error: 'No steps to patch: `steps` is empty. Nothing was written.' }

  const keeper = keeperIn(store, slug)
  const many = patches.length > 1
  const refuse = (i: number, patch: StepPatch, why: string) => ({
    ok: false as const,
    error: `${many ? `Patch ${i + 1} (${patch.step}): ` : ''}${why.replace(/ The step was not written\.$/, '')} Nothing was written.`,
  })
  let record = journey
  let said = ''
  const done: { where: number; id: string; named: string[] }[] = []
  for (const [i, patch] of patches.entries()) {
    const at = stepOfPart(record, patch.step)
    if (at < 0) return refuse(i, patch, `${notAStep(record, patch.step).replace(', or a 1-based `position`', '')} A patch changes a step that exists; \`set_step\` adds one.`)
    if (keeper.by === 'journeys' && patch.given.part !== undefined) {
      return refuse(i, patch, '`part` is not taken here: this app keeps this epic’s list of parts for a host that does not, so a step is its own part.')
    }
    const before = record.steps[at]!
    const out = stepInto(record, keeper, at, { title: before.title, body: before.body, refs: before.refs, notes: before.notes, ...patch.fields }, patch.given)
    if (!out.ok) return refuse(i, patch, out.error)
    record = out.record
    said += out.said
    done.push({ where: at + 1, id: patch.step, named: patch.named })
  }
  const circle = cycleSaid(record.steps)
  if (circle) return { ok: false, error: circle }
  const written = writeJourney(project, record)
  if (!written.ok) return { ok: false, error: written.error }
  return { ok: true, journey: written.journey, done, said: said + settledSaid(written) + unpublishedSaid(written) }
}

/** What a caller who names a part is told where the name is not this app's to set. */
const NAME_IS_THE_HOSTS =
  'The part’s name was not changed here: the list of this epic’s parts is kept by the host, and a part is renamed in its '
  + 'picker, or with `set_parts` at the host’s own door.'

/** Who keeps the list of one journey's parts, as the read that found the journey found it. */
function keeperIn(store: Held, slug: string): Keeper {
  return Object.hasOwn(store.keepers, slug) ? (store.keepers[slug] ?? JOURNEYS_KEEP) : JOURNEYS_KEEP
}

/**
 * Take a step out, by its 1-based position or the id of its part; the steps
 * after it move up.
 *
 * While this app keeps the list its part goes with it — a part is its step.
 * Where the host keeps the list only the step goes: the part is the epic's,
 * and is removed where the list is kept (the page asks the host to, in the
 * same press; an agent does it at the host's door).
 */
function removeStep(
  project: string | null,
  slug: string,
  where: { position?: number; id?: string },
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string; keeper: Keeper } {
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
  const keeper = keeperIn(store, slug)
  if (keeper.by === 'host') {
    const written = writeJourney(project, { ...journey, steps: journey.steps.filter((_, i) => i !== at) })
    if (!written.ok) return { ok: false, error: written.error }
    return {
      ok: true,
      journey: written.journey,
      keeper: written.keeper,
      said:
        `Removed step ${at + 1} (“${gone?.title ?? ''}”) from ${slug}.`
        + (listedBy(keeper, id)
          ? ` Its part (${id}) is the epic’s and is still listed: the host keeps that list, and a part is removed there.`
          : '')
        + unpublishedSaid(written),
    }
  }
  const file = gone ? fileOf(journey, gone) : null
  const written = writeJourney(project, withoutStep(journey, at))
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    keeper: written.keeper,
    said:
      `Removed step ${at + 1} (“${gone?.title ?? ''}”) from ${slug}, and its part (${id ?? 'unnamed'}) with it`
      + `${file ? `, which covered ${file}` : ''}. Anything kept elsewhere against that id now names nothing.`
      + settledSaid(written)
      + unpublishedSaid(written),
  }
}

/**
 * Move a step to another 1-based position; the steps between move by one.
 *
 * While this app keeps the list the step's part moves with it, because the
 * parts are in the steps' order. Where the host keeps the list only the step
 * moves: the order of the epic's parts is the host's (the page asks it to move
 * the part, in the same press).
 */
function moveStep(
  project: string | null,
  slug: string,
  where: { position?: number; id?: string },
  to: number | undefined,
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string; keeper: Keeper } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `no journey "${slug}" in ${project}`, status: 404 }
  let from: number
  if (where.id) {
    from = stepOfPart(journey, where.id)
    if (from < 0) return { ok: false, error: notAStep(journey, where.id) }
  } else {
    if (!where.position || where.position > journey.steps.length) {
      return { ok: false, error: `${slug} has ${journey.steps.length} stored steps` }
    }
    from = where.position - 1
  }
  if (!to || to > journey.steps.length) {
    return { ok: false, error: `${slug} has ${journey.steps.length} stored steps, and \`to\` is the 1-based position one of them moves to. Nothing was moved.` }
  }
  const keeper = keeperIn(store, slug)
  const title = journey.steps[from]?.title ?? ''
  if (to - 1 === from) return { ok: true, journey, keeper, said: `Step ${to} (“${title}”) is already there.` }
  let record: Journey
  if (keeper.by === 'host') {
    const steps = [...journey.steps]
    const [one] = steps.splice(from, 1)
    if (one) steps.splice(to - 1, 0, one)
    record = { ...journey, steps }
  } else record = withStepMoved(journey, from, to - 1)
  const written = writeJourney(project, record)
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    keeper: written.keeper,
    said: `Moved step ${from + 1} (“${title}”) of ${slug} to position ${to}.${settledSaid(written)}${unpublishedSaid(written)}`,
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
): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; said: string; keeper: Keeper } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `this project does not hold a journey called "${slug}"`, status: 404 }
  if (!Object.hasOwn(store.unsettled, slug)) {
    return {
      ok: true,
      journey,
      keeper: keeperIn(store, slug),
      said: `Every step of ${slug} is already one part of the epic; there is nothing to divide.`,
    }
  }
  const written = writeJourney(project, journey)
  if (!written.ok) return { ok: false, error: written.error }
  return { ok: true, journey: written.journey, keeper: written.keeper, said: (settledSaid(written) + unpublishedSaid(written)).trim() }
}

/* ------------------------------------------------------------------ *
 * Writing the gates
 * ------------------------------------------------------------------ */

const MAX_GATE_TITLE = 1_000
const MAX_GATE_NOTE = 4_000
const MAX_OWNER = 200

/**
 * What a caller said about one gate. `undefined` is "left out, it stays"; for the optional words,
 * `null` is "cleared" (a caller sends ""). `blocks`, when given, is the whole list of steps the gate
 * holds.
 */
interface GateGiven {
  id?: string
  kind?: string
  title?: string
  owner?: string | null
  note?: string | null
  ref?: string | null
  epic?: string | null
  state?: string
  by?: string
  /** The steps (by id) and refs the gate holds; the whole list. */
  blocks?: string[]
  /** The refs the gate itself waits on; the whole list. */
  waitsOn?: string[]
}

/** A gate as a caller sent it, out of a bag of arguments: the same for the page and an agent. */
function gateGiven(bag: Record<string, unknown>): GateGiven {
  const out: GateGiven = {}
  const id = str(bag.gate ?? bag.id, MAX_PART)
  if (id) out.id = id
  const kind = str(bag.kind, 40)
  if (kind) out.kind = kind
  if (Object.hasOwn(bag, 'title') && bag.title !== undefined) out.title = str(bag.title, MAX_GATE_TITLE + 1)
  const optional = (key: 'owner' | 'note' | 'ref' | 'epic', max: number) => {
    if (Object.hasOwn(bag, key) && bag[key] !== undefined) out[key] = str(bag[key], max) || null
  }
  optional('owner', MAX_OWNER)
  optional('note', MAX_GATE_NOTE + 1)
  optional('ref', MAX_REF)
  optional('epic', MAX_SLUG)
  const state = str(bag.state, 20)
  if (state) out.state = state
  const by = str(bag.by, MAX_OWNER)
  if (by) out.by = by
  if (Object.hasOwn(bag, 'blocks') && bag.blocks !== undefined) out.blocks = list(bag.blocks, MAX_REF)
  if (Object.hasOwn(bag, 'waitsOn') && bag.waitsOn !== undefined) out.waitsOn = list(bag.waitsOn, MAX_REF)
  return out
}

type GateWritten = { ok: false; error: string; status?: number } | { ok: true; journey: Journey; gate: Gate; said: string; keeper: Keeper }

/** The journey a gate is written into, or why there is none. */
function journeyFor(project: string | null, slug: string): { ok: false; error: string; status?: number } | { ok: true; journey: Journey; store: Held } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `this project does not hold a journey called "${slug}"`, status: 404 }
  return { ok: true, journey, store }
}

/** The steps that `ids` names, with the gate added; every other step, with it taken off. */
function stepsHeldBy(journey: Journey, gate: string, ids: readonly string[]): Journey['steps'] {
  return journey.steps.map((step) => {
    const had = stepGates(step)
    const wanted = ids.includes(stepPart(step) ?? '')
    if (wanted === had.includes(gate)) return step
    const next = wanted ? [...had, gate] : had.filter((one) => one !== gate)
    const { blockedBy: _blockedBy, ...rest } = step as typeof step & { blockedBy?: unknown }
    return next.length ? { ...rest, blockedBy: next } : rest
  })
}

/**
 * Add or change one gate: what stands in the way that is not a step.
 *
 * A patch, unlike `setStep`: a field left out stays as it was, "" clears an optional one. A new
 * gate needs a `kind` and a `title`; its id is made from the title unless the caller names one. An
 * `issue` gate names its `ref`; a `ref-elsewhere` gate names its `ref` and the `epic` that owns it.
 *
 * `state: 'done'` records who (`by`, required) and when; `'open'` takes both off again. That is
 * the one way a work, decision or access gate is ever done — no tracker can say so.
 *
 * `blocks`, when given, is the whole list of steps (by id) the gate holds: it is added to each of
 * their `blockedBy` and taken off every other step's. Nothing is written on any refusal.
 */
function setGate(project: string | null, slug: string, asked: GateGiven, now: Date = new Date()): GateWritten {
  const found = journeyFor(project, slug)
  if (!found.ok) return found
  const { journey, store } = found
  const gates = gatesOf(journey)
  const raw = Array.isArray(journey.gates) ? journey.gates : []
  const at = asked.id ? raw.findIndex((one) => one.id === asked.id) : -1
  const before = at >= 0 ? gates.find((one) => one.id === asked.id) : undefined
  const refuse = (why: string): GateWritten => ({ ok: false, error: `${why} Nothing was written.` })

  if (asked.id && !before && !GATE_ID.test(asked.id)) {
    return refuse(`“${asked.id}” is not a gate of this journey, and not a name one could have: lower-case letters, digits and dashes.`)
  }
  if (asked.kind !== undefined && !isGateKind(asked.kind)) {
    return refuse(`“${asked.kind}” is not a kind of gate. A gate is one of: ${GATE_KINDS.join(', ')}.`)
  }
  if (asked.title !== undefined && asked.title.length > MAX_GATE_TITLE) return refuse(`A gate’s title is at most ${MAX_GATE_TITLE} characters.`)
  if (typeof asked.note === 'string' && asked.note.length > MAX_GATE_NOTE) return refuse(`A gate’s note is at most ${MAX_GATE_NOTE} characters.`)
  const kind = (asked.kind ?? before?.kind) as Gate['kind'] | undefined
  const title = asked.title !== undefined ? asked.title : before?.title
  if (!kind) return refuse(`A new gate needs a \`kind\`: ${GATE_KINDS.join(', ')}.`)
  if (!title) return refuse('A gate needs a `title`: what has to happen, in a few words.')
  const pick = (key: 'owner' | 'note' | 'ref' | 'epic'): string | undefined => {
    const said = asked[key]
    return said === undefined ? before?.[key] : (said ?? undefined)
  }
  const ref = pick('ref')
  const epic = pick('epic')
  if ((kind === 'issue' || kind === 'ref-elsewhere') && !ref) {
    return refuse(`A gate of kind ${kind} is a tracker ref: pass \`ref\`, e.g. "#41" or "gh#41".`)
  }
  if (kind === 'ref-elsewhere' && !epic) return refuse('A ref-elsewhere gate says which epic owns the ref: pass `epic`, that epic’s slug.')
  if (epic && !isSlug(epic)) return refuse(`“${epic}” is not an epic’s slug.`)
  if (epic && epic === journey.slug) return refuse('That epic is this one: a ref this epic owns is an `issue` gate.')

  let state: Gate['state'] = before?.state ?? 'open'
  let doneAt = before?.doneAt
  let doneBy = before?.doneBy
  if (asked.state !== undefined) {
    if (asked.state !== 'open' && asked.state !== 'done') return refuse(`“${asked.state}” is not a state: a gate is open, or done.`)
    if (asked.state === 'done' && state !== 'done') {
      if (!asked.by) return refuse('Marking a gate done says who did: pass `by`, the person or agent marking it.')
      state = 'done'
      doneAt = now.toISOString()
      doneBy = asked.by
    } else if (asked.state === 'open') {
      state = 'open'
      doneAt = undefined
      doneBy = undefined
    }
  }

  /* `blocks` names steps (by id) and tracker refs: a ref is held by writing the gate into the journey's `blockedBy` for it. */
  const blockedSteps = asked.blocks?.filter((one) => !isTracked(one))
  const blockedRefs = asked.blocks?.filter((one) => isTracked(one))
  if (blockedSteps) {
    const known = new Set(journey.steps.map((step) => stepPart(step)).filter(Boolean))
    const unknown = blockedSteps.filter((one) => !known.has(one))
    if (unknown.length) {
      return refuse(`${andSaid(unknown.map((one) => `“${one}”`))} ${unknown.length === 1 ? 'is not the id of a step or a tracker ref' : 'are not ids of steps or tracker refs'} of this journey; \`get_journey\` lists the steps, and a ref is like "#41", "!44" or "gh#41".`)
    }
  }
  const waitsOn = asked.waitsOn ?? before?.waitsOn
  const badWait = asked.waitsOn?.filter((one) => !isTracked(one))
  if (badWait?.length) return refuse(`${andSaid(badWait.map((one) => `“${one}”`))} ${badWait.length === 1 ? 'is not a tracker ref' : 'are not tracker refs'}: \`waitsOn\` takes refs like "#41", "!44" or "gh#41".`)

  const id = before?.id ?? asked.id ?? gateIdFor(title, gates.map((one) => one.id))
  const gate: Gate = {
    id,
    kind,
    title,
    ...(pick('owner') ? { owner: pick('owner') } : {}),
    ...(pick('note') ? { note: pick('note') } : {}),
    ...(ref ? { ref } : {}),
    ...(waitsOn?.length ? { waitsOn: [...new Set(waitsOn)] } : {}),
    ...(kind === 'ref-elsewhere' && epic ? { epic } : {}),
    state,
    ...(state === 'done' && doneAt ? { doneAt } : {}),
    ...(state === 'done' && doneBy ? { doneBy } : {}),
  }
  /* What else a stored gate carries — a newer writer's field — stays on it. */
  const extra = at >= 0 ? Object.fromEntries(Object.entries(raw[at]!).filter(([key]) => !GATE_KEYS.includes(key))) : {}
  const kept = stored({ ...gate, ...extra })
  const list = at >= 0 ? raw.map((one, i) => (i === at ? kept : one)) : [...raw, kept]
  const steps = blockedSteps ? stepsHeldBy(journey, id, blockedSteps) : journey.steps
  const blockedBy = blockedRefs ? refsHeldBy(journey.blockedBy, id, blockedRefs) : journey.blockedBy
  const changed = JSON.stringify(list) !== JSON.stringify(raw) || steps !== journey.steps || JSON.stringify(blockedBy) !== JSON.stringify(journey.blockedBy)
  if (!changed) return { ok: true, journey, gate, keeper: keeperIn(store, slug), said: `${gateSaid(gate)} already reads so; nothing was written.` }
  const written = writeJourney(project, { ...journey, gates: list, steps, blockedBy })
  if (!written.ok) return { ok: false, error: written.error }
  const holds = [...heldSteps(written.journey, id), ...heldRefs(written.journey, id)]
  return {
    ok: true,
    journey: written.journey,
    gate,
    keeper: written.keeper,
    said:
      `${before ? 'Set' : 'Added'} gate ${id}: ${gateSaid(gate)}. `
      + (holds.length ? `It holds ${andSaid(holds.map((one) => `“${one}”`))}.` : 'It holds no step or ref yet: pass `blocks`, or `blockedBy` on `set_step`.')
      + settledSaid(written)
      + unpublishedSaid(written),
  }
}

/** A gate as the record holds it. */
const stored = (gate: Gate | Record<string, unknown>): NonNullable<Journey['gates']>[number] => gate as NonNullable<Journey['gates']>[number]

/** The keys `setGate` writes; any other key on a stored gate is somebody else's and is carried. */
const GATE_KEYS = ['id', 'kind', 'title', 'owner', 'note', 'ref', 'waitsOn', 'epic', 'state', 'doneAt', 'doneBy']

/** The titles of the steps one gate holds. */
function heldSteps(journey: Journey, gate: string): string[] {
  return journey.steps.filter((step) => stepGates(step).includes(gate)).map((step) => step.title)
}

/** The refs one gate holds: those whose `blockedBy` entry lists it. */
function heldRefs(journey: Journey, gate: string): string[] {
  return Object.entries(journey.blockedBy)
    .filter(([, ids]) => ids.includes(gate))
    .map(([ref]) => ref)
}

/** The journey's `blockedBy` with `gate` listed under exactly `refs` and under no other ref; an entry left empty goes. */
function refsHeldBy(blockedBy: Journey['blockedBy'], gate: string, refs: readonly string[]): Journey['blockedBy'] {
  const out: Journey['blockedBy'] = {}
  for (const [ref, ids] of Object.entries(blockedBy)) {
    const next = refs.includes(ref) ? ids : ids.filter((one) => one !== gate)
    if (next.length) out[ref] = next
  }
  for (const ref of refs) {
    const had = out[ref] ?? []
    if (!had.includes(gate)) out[ref] = [...had, gate]
  }
  return out
}

/** Take one gate out of a journey, and off every step and ref it held. */
function removeGate(project: string | null, slug: string, id: string): GateWritten {
  const found = journeyFor(project, slug)
  if (!found.ok) return found
  const { journey } = found
  const gate = gatesOf(journey).find((one) => one.id === id)
  if (!gate) {
    const known = gatesOf(journey).map((one) => one.id)
    return { ok: false, error: `“${id}” is not a gate of ${slug}${known.length ? `; its gates are ${known.join(', ')}` : ', which has none'}. Nothing was removed.` }
  }
  const held = [...heldSteps(journey, id), ...heldRefs(journey, id)]
  const raw = (journey.gates ?? []).filter((one) => one.id !== id)
  const steps = stepsHeldBy(journey, id, [])
  const blockedBy = refsHeldBy(journey.blockedBy, id, [])
  const { gates: _gates, ...rest } = journey
  const written = writeJourney(project, raw.length ? { ...rest, gates: raw, steps, blockedBy } : { ...rest, steps, blockedBy })
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    gate,
    keeper: written.keeper,
    said: `Removed gate ${id} (${gateSaid(gate)})${held.length ? `, which held ${andSaid(held.map((one) => `“${one}”`))}` : ''}.${settledSaid(written)}${unpublishedSaid(written)}`,
  }
}

/**
 * A note chip on a step, made a gate: work with no issue yet, holding that step. One write: the
 * note comes off the step and the gate goes on, so the words are never in both places or neither.
 * A work gate with the same title already there is used again.
 */
function noteToGate(project: string | null, slug: string, where: { position?: number; id?: string }, note: string): GateWritten {
  const found = journeyFor(project, slug)
  if (!found.ok) return found
  const { journey } = found
  let at: number
  if (where.id) at = stepOfPart(journey, where.id)
  else at = where.position && where.position <= journey.steps.length ? where.position - 1 : -1
  const step = journey.steps[at]
  if (!step) return { ok: false, error: 'that step is not in this journey any more. Nothing was written.' }
  if (!step.notes.includes(note)) return { ok: false, error: `“${note}” is not a note on step ${at + 1} any more. Nothing was written.` }
  const gates = gatesOf(journey)
  const had = gates.find((one) => one.kind === 'work' && one.title.trim().toLowerCase() === note.trim().toLowerCase())
  const gate: Gate = had ?? { id: gateIdFor(note, gates.map((one) => one.id)), kind: 'work', title: note, state: 'open' }
  const holds = [...new Set([...stepGates(step), gate.id])]
  const steps = journey.steps.map((one, i) => (i === at ? { ...one, notes: one.notes.filter((n) => n !== note), blockedBy: holds } : one))
  const written = writeJourney(project, { ...journey, gates: had ? (journey.gates ?? []) : [...(journey.gates ?? []), stored(gate)], steps })
  if (!written.ok) return { ok: false, error: written.error }
  return {
    ok: true,
    journey: written.journey,
    gate,
    keeper: written.keeper,
    said: `“${note}” is a gate now: ${KIND_SAID.work.word} with no issue yet, holding step ${at + 1}. Mark it done when it is.${settledSaid(written)}${unpublishedSaid(written)}`,
  }
}

/**
 * A journey's gates in lines an agent can read, above the JSON: id, kind, state, title, who, and
 * the steps each holds. Empty for a journey with none.
 */
function gatesSaid(journey: Journey): string {
  const gates = gatesOf(journey)
  if (!gates.length) return ''
  const ids = new Map(journey.steps.map((step) => [step.title, stepPart(step) ?? '?']))
  const lines = gates.map((gate) => {
    const holds = [...heldSteps(journey, gate.id).map((title) => ids.get(title) ?? title), ...heldRefs(journey, gate.id)]
    return `  ${gate.id}\t${gateSaid(gate)}${holds.length ? `\tholds ${holds.join(', ')}` : '\tholds no step or ref'}`
  })
  return (
    'GATES: what stands in the way that is not a step — written with `set_gate` (and `remove_gate`), held by a step '
    + 'through its `blockedBy` on `set_step`, a ref through the journey’s `blockedBy` (`set_gate` `blocks` takes step ids and refs). A step an open gate holds, or whose delivering ref one holds, is never next. Id, kind and title, who acts, where it stands, '
    + `and the steps it holds:\n${lines.join('\n')}\n\n`
  )
}


/* ------------------------------------------------------------------ *
 * Writing the prose around the steps
 * ------------------------------------------------------------------ */

/** The sentences of a journey that are one string each. */
const PROSE = ['title', 'lede', 'callout', 'missing', 'goal', 'measure', 'appetite'] as const
/** Its lists of sentences. */
const LISTS = ['exists', 'open', 'rabbitHoles', 'noGos'] as const
/** Everything `setProse` writes, in the order it is said back. */
const PROSE_FIELDS = [...PROSE, ...LISTS, 'phases', 'headings'] as const
type ProseField = (typeof PROSE_FIELDS)[number]

/** One heading of the older shape as a caller says it: what it is called and the references listed under it. */
interface HeadingSaid {
  heading: string
  refs: string[]
}

/** What a caller said about a journey's prose: only the fields it named are here. */
interface ProseSaid {
  title?: string
  lede?: string
  callout?: string
  missing?: string
  goal?: string
  measure?: string
  appetite?: string
  exists?: string[]
  open?: string[]
  rabbitHoles?: string[]
  noGos?: string[]
  phases?: PhaseSaid[]
  headings?: HeadingSaid[]
}

/** One phase as a caller says it: its title, and its id where the caller names one. */
interface PhaseSaid {
  id?: string
  title: string
}

/** How long one sentence of `exists` or `open` may be. The longest this app ships is under a thousand characters. */
const MAX_ITEM = 4_000

/**
 * What a caller said about a journey's prose, out of a bag of arguments — or
 * the sentence that refuses it.
 *
 * Read the way `given` reads `name`: a field that is not there was not said
 * and stays as it is; one that is there and empty (`""`, `[]`, or the `null`
 * a page's JSON sends) clears it.
 *
 * Nothing here is cut to fit or guessed at, which is where it parts from
 * `str` and `list`. Those bound a step by slicing; here a callout that is too
 * long, or an `open` that is a string where a list was meant, is REFUSED and
 * nothing is written — `list()` reads anything that is not an array as `[]`,
 * and on this door `[]` means "clear it", so a mistyped argument would empty
 * somebody's list and report that it had.
 */
function proseSaid(bag: Record<string, unknown>): { ok: true; said: ProseSaid } | { ok: false; error: string } {
  const said: ProseSaid = {}
  const no = (why: string) => ({ ok: false as const, error: `${why} Nothing was written.` })
  const has = (key: string) => Object.hasOwn(bag, key) && bag[key] !== undefined

  for (const key of PROSE) {
    if (!has(key)) continue
    const value = bag[key] ?? ''
    if (typeof value !== 'string') return no(`\`${key}\` is text.`)
    const text = value.trim()
    const max = key === 'title' ? MAX_TITLE : MAX_BODY
    if (text.length > max) return no(`\`${key}\` runs to ${max} characters at most; this is ${text.length}.`)
    said[key] = text
  }

  /** A list of strings, trimmed, the empty ones dropped — or why it is not one. */
  const strings = (value: unknown, name: string, max: number): string[] | string => {
    if (value === null) return []
    if (!Array.isArray(value)) return `\`${name}\` is a list of strings; pass [] to clear it.`
    if (value.length > MAX_LIST) return `\`${name}\` holds ${MAX_LIST} entries at most; this is ${value.length}.`
    const out: string[] = []
    for (const one of value) {
      if (typeof one !== 'string') return `\`${name}\` is a list of strings, and one entry of this is not a string.`
      const text = one.trim()
      if (text.length > max) return `An entry of \`${name}\` runs to ${max} characters at most; one of these is ${text.length}.`
      if (text) out.push(text)
    }
    return out
  }

  for (const key of LISTS) {
    if (!has(key)) continue
    const out = strings(bag[key], key, MAX_ITEM)
    if (typeof out === 'string') return no(out)
    said[key] = out
  }

  if (has('headings')) {
    const value = bag.headings ?? []
    if (!Array.isArray(value)) return no('`headings` is a list of { heading, refs }; pass [] to remove them all.')
    if (value.length > MAX_LIST) return no(`\`headings\` holds ${MAX_LIST} entries at most; this is ${value.length}.`)
    const out: HeadingSaid[] = []
    for (const one of value) {
      if (!one || typeof one !== 'object' || Array.isArray(one)) return no('Each of `headings` is { heading, refs }.')
      const { heading, refs } = one as { heading?: unknown; refs?: unknown }
      if (typeof heading !== 'string' || !heading.trim()) {
        return no('Each of `headings` says what it is called, in `heading`; to remove one, leave it out of the list.')
      }
      const name = heading.trim()
      if (name.length > MAX_TITLE) return no(`A heading runs to ${MAX_TITLE} characters at most; one of these is ${name.length}.`)
      const listed = strings(refs === undefined ? [] : refs, `refs\` of “${name.slice(0, 60)}”, in \`headings`, MAX_REF)
      if (typeof listed === 'string') return no(listed)
      out.push({ heading: name, refs: listed })
    }
    said.headings = out
  }

  if (has('phases')) {
    const value = bag.phases ?? []
    if (!Array.isArray(value)) return no('`phases` is a list of { title, id? }, left to right; pass [] to remove them all.')
    if (value.length > MAX_LIST) return no(`\`phases\` holds ${MAX_LIST} entries at most; this is ${value.length}.`)
    const out: PhaseSaid[] = []
    for (const one of value) {
      if (!one || typeof one !== 'object' || Array.isArray(one)) return no('Each of `phases` is { title, id? }.')
      const { id, title } = one as { id?: unknown; title?: unknown }
      if (typeof title !== 'string' || !title.trim()) return no('Each of `phases` says what it is called, in `title`; to remove one, leave it out of the list.')
      const name = title.trim()
      if (name.length > MAX_TITLE) return no(`A phase's title runs to ${MAX_TITLE} characters at most; one of these is ${name.length}.`)
      if (id === undefined || id === null || id === '') out.push({ title: name })
      else if (typeof id !== 'string' || !PART_ID.test(id)) return no(`\`${String(id).slice(0, 60)}\` is not a phase id: lowercase letters, digits and dashes, as \`get_journey\` lists them. Leave \`id\` out to have one made from the title.`)
      else out.push({ id, title: name })
    }
    said.phases = out
  }

  if (!PROSE_FIELDS.some((key) => said[key] !== undefined)) {
    return no(`Which of ${PROSE_FIELDS.map((key) => `\`${key}\``).join(', ')}? None was passed, and a field that is not passed is left as it is.`)
  }
  if (said.title === '') return no('A journey has to be called something: `title` can be changed and cannot be cleared.')
  return { ok: true, said }
}

/**
 * Write the prose around a journey's steps: its title, lede and callout, what
 * it says exists, is open and is missing, and the headings of the older shape.
 *
 * The one writer of these fields. Before it there was none — the page draws
 * the title, the lede and the callout and has no box for any of them — so an
 * agent that finished a step and found the callout still saying the work was
 * open had the file to edit and nothing else, which is the write this app's
 * doors exist to make unnecessary. A page that grows an editor for them calls
 * this, as `/api/step` calls `setStep`.
 *
 * ## A patch, where a step is written whole — and why that is not a second rule
 *
 * `setStep` replaces the four things it takes, because a caller says all four
 * every time. Here a caller correcting a callout has said nothing about the
 * lede, and a door that cleared the lede because it was not mentioned would
 * destroy a paragraph to change another. So: a field that was passed is
 * replaced, whole; a field that was not is not touched. Within a field the
 * rule is `setStep`'s — `open` is the list as passed, not merged into what
 * was there.
 *
 * ## `headings`
 *
 * A record may carry `headings`: what `simplified` set aside from the older
 * shape of parts, a heading and the references once listed under it ("Open
 * MRs", with the changes that have since merged). No page draws them, and
 * they are still read: their references count among the journey's
 * (`refsOf`), and `get_journey` hands them to whoever reads the record. So
 * they are written here too, as the whole list — a heading left out is
 * removed, and an empty list takes the key off the record. A heading that
 * keeps its name keeps whatever else it carried (an `id`, `files`, a field
 * this version does not name); only what it is called and its references are
 * a caller's to say.
 *
 * These are never parts. `groups`, and the list a host keeps, are not written
 * here and are not reachable from here (`keeper.ts`).
 *
 * ## A write that changes nothing writes nothing
 *
 * The file is not touched, and so not stored in a newer shape either: saying
 * what a journey already says is not the deliberate write `Unsettled` waits
 * for.
 */
function setProse(
  project: string | null,
  slug: string,
  said: ProseSaid,
):
  | { ok: false; error: string; status?: number }
  | { ok: true; journey: Journey; keeper: Keeper; changed: ProseField[]; same: ProseField[]; removed: string[]; said: string } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }
  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing, status: 409 }
  const journey = journeyIn(store, slug)
  if (!journey) {
    return {
      ok: false,
      status: 404,
      error: `no journey "${slug}" here, so there is no prose to change. Begin one with \`create_journey\`. Nothing was written.`,
    }
  }

  const next: Journey = { ...journey }
  const removed: string[] = []
  for (const key of PROSE) if (said[key] !== undefined) next[key] = said[key]
  for (const key of LISTS) if (said[key] !== undefined) next[key] = said[key]
  if (said.headings !== undefined) {
    const had = [...(journey.headings ?? [])]
    const kept = said.headings.map((one) => {
      const at = had.findIndex((was) => (was.heading ?? '').trim() === one.heading)
      const [was] = at < 0 ? [] : had.splice(at, 1)
      return { ...was, heading: one.heading, refs: one.refs }
    })
    removed.push(...had.map((was) => (was.heading ?? '').trim() || 'an unnamed heading'))
    if (kept.length) next.headings = kept
    else delete next.headings
  }
  if (said.phases !== undefined) {
    const had = phasesOf(journey)
    const made = phasesMade(said.phases, had)
    if (!made.ok) return { ok: false, error: `${made.error} Nothing was written.` }
    const gone = had.filter((was) => !made.phases.some((one) => one.id === was.id))
    const stranded = gone.flatMap((was) => {
      const steps = journey.steps.flatMap((step, i) => (step.phase === was.id ? [`${i + 1} (${nodeId(step, i + 1)})`] : []))
      return steps.length ? [`${was.id} “${was.title}”, which ${steps.length === 1 ? 'step' : 'steps'} ${andSaid(steps)} ${steps.length === 1 ? 'is' : 'are'} in`] : []
    })
    if (stranded.length) {
      return {
        ok: false,
        status: 409,
        error:
          `\`phases\` would remove ${andSaid(stranded)}. A step is never left naming a phase the journey does not have: put those steps in `
          + 'another phase, or clear theirs, with `phase` on `set_step` ("" clears it), or keep the phase’s `id` in the list to rename it. Nothing was written.',
      }
    }
    if (made.phases.length) next.phases = made.phases
    else delete next.phases
  }

  const named = PROSE_FIELDS.filter((key) => said[key] !== undefined)
  const changed = named.filter((key) => JSON.stringify(next[key] ?? null) !== JSON.stringify(journey[key] ?? null))
  const same = named.filter((key) => !changed.includes(key))
  const keeper = keeperIn(store, slug)
  if (!changed.length) return { ok: true, journey, keeper, changed, same, removed: [], said: '' }

  const written = writeJourney(project, next)
  if (!written.ok) return { ok: false, error: written.error }

  /* The record's title is what this app's page and `list_journeys` show. A
     host keeps a title of its own for the epic, in its own file, which this
     app reads and never writes — so a caller is told when the two now differ. */
  let hosts = ''
  if (changed.includes('title')) {
    const host = hostEpic(project, slug)
    const theirs = host.found === 'epic' && typeof host.epic.title === 'string' ? host.epic.title.trim() : ''
    if (host.found === 'epic' && theirs && theirs !== written.journey.title) {
      hosts =
        ` The host keeps a title of its own for this epic (“${theirs}”, in ${host.path}), and that was not changed: `
        + 'this is the title this app shows, and the epic is renamed in the host.'
    }
  }
  return {
    ok: true,
    journey: written.journey,
    keeper: written.keeper,
    changed,
    same,
    removed,
    said: hosts + settledSaid(written) + unpublishedSaid(written),
  }
}

/**
 * The phases as they will be stored: an id given is kept, and a phase given without one keeps the
 * id of the phase that had its title, or is given one made from the title.
 */
function phasesMade(said: readonly PhaseSaid[], had: readonly Phase[]): { ok: true; phases: Phase[] } | { ok: false; error: string } {
  const named = said.flatMap((one) => (one.id ? [one.id] : []))
  const twice = named.filter((id, i) => named.indexOf(id) !== i)
  if (twice.length) return { ok: false, error: `\`phases\` names ${andSaid([...new Set(twice)].map((id) => `“${id}”`))} more than once; a phase id names one phase.` }
  const taken = new Set(named)
  const phases = said.map((one, i) => {
    const was = one.id ? had.find((old) => old.id === one.id) : had.find((old) => old.title.trim().toLowerCase() === one.title.toLowerCase() && !taken.has(old.id))
    const id = one.id ?? was?.id ?? idFor(slugFrom(one.title) ? one.title : `phase ${i + 1}`, taken)
    taken.add(id)
    return { ...was, id, title: one.title }
  })
  return { ok: true, phases }
}

/** Why `id` is not a phase of a journey with these phases. */
function notAPhase(phases: readonly Phase[], id: string): string {
  return phases.length
    ? `“${id}” is not a phase of this journey. Its phases, left to right: ${phases.map((one) => `${one.id} “${one.title}”`).join(', ')}.`
    : `“${id}” is not a phase of this journey, which has none: list them first with \`phases\` on \`set_journey\`.`
}

/**
 * The journey's phases in lines an agent can read, each with its steps, above the JSON. Empty when
 * the journey has none and no step names one.
 */
function phasesSaid(journey: Journey): string {
  const phases = phasesOf(journey)
  const read = phaseOfEach(journey.steps)
  if (!phases.length && !read.some((one) => one.phase)) return ''
  const stepsIn = (id: string | null) =>
    journey.steps.flatMap((step, i) => (read[i]!.phase === id ? [`${i + 1} ${nodeId(step, i + 1)}${read[i]!.inherited ? ' (its objective’s)' : ''}`] : []))
  const listed = (steps: string[]) => (steps.length ? steps.join(', ') : 'no step yet')
  const lines = phases.map((one, i) => `  ${i + 1}\t${one.id}\t“${one.title}”: ${listed(stepsIn(one.id))}`)
  const unknown = [...new Set(read.flatMap((one) => (one.phase && !phases.some((p) => p.id === one.phase) ? [one.phase] : [])))]
  for (const id of unknown) lines.push(`  ?\t${id}\tnot a phase of this journey: ${listed(stepsIn(id))}`)
  const none = stepsIn(null)
  if (none.length) lines.push(`  —\tin no phase: ${none.join(', ')}`)
  return (
    'PHASES: the journey’s sections, left to right, written whole with `phases` on `set_journey`; a step is put in one '
    + 'with `phase` on `set_step`. A step with no `phase` of its own is in the phase of the nearest step above it '
    + '(its objective, then that one’s) that has one; the JSON below keeps only what was written. Each phase with '
    + `its steps, by position and id:\n${lines.join('\n')}\n\n`
  )
}

/** `a`, `a and b`, `a, b and c`. */
const andSaid = (words: string[]): string =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

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
 * What a caller said about a step's part, out of a bag of arguments.
 *
 * `name` has three answers, and the first is the one `str()` cannot give — it
 * turns a missing argument and an empty one into the same `''`, which here
 * are opposites: a missing one leaves the part's name as it is, and an empty
 * one clears it. `null` counts as empty, because that is what a page's JSON
 * sends. `part` is an id or nothing.
 */
function given(bag: Record<string, unknown>): Given {
  const out: Given = {}
  if (Object.hasOwn(bag, 'name') && bag.name !== undefined) out.name = str(bag.name, MAX_TITLE) || null
  const part = str(bag.part, MAX_PART)
  if (part) out.part = part
  /* The tree (`src/tree.ts`): left out, it stays; "" clears it. */
  if (Object.hasOwn(bag, 'under') && bag.under !== undefined) out.under = str(bag.under, MAX_PART) || null
  if (Object.hasOwn(bag, 'phase') && bag.phase !== undefined) out.phase = str(bag.phase, MAX_PART) || null
  if (Object.hasOwn(bag, 'issue') && bag.issue !== undefined) out.issue = str(bag.issue, MAX_REF) || null
  /* Gates and roles (`src/gates.ts`): left out, they stay; [] or {} clears. */
  if (Object.hasOwn(bag, 'blockedBy') && bag.blockedBy !== undefined) out.blockedBy = list(bag.blockedBy, MAX_PART)
  if (Object.hasOwn(bag, 'roles') && bag.roles !== undefined) out.roles = rolesIn(bag.roles)
  return out
}

/** `roles` as a caller sent it: `{ ref: role }`, bounded; anything that is not an object is no roles. */
function rolesIn(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [ref, role] of Object.entries(value as Record<string, unknown>).slice(0, MAX_LIST)) {
    const key = str(ref, MAX_REF)
    if (key) out[key] = str(role, 40)
  }
  return out
}

/** What `set_step` takes beside the four things a step is: its part, and its place in the tree. */
interface Given {
  name?: string | null
  part?: string
  /** The id of the objective this step is a prerequisite of; null takes it out to the goal. */
  under?: string | null
  /** The id of the journey's phase this step is in; null takes it out of its own phase. */
  phase?: string | null
  /** The issue that delivers this step; null forgets it. Also put in `refs`. */
  issue?: string | null
  /** The ids of the gates that hold this step; [] clears. */
  blockedBy?: string[]
  /** `{ ref: role }` for this step's refs; a ref left out delivers it. */
  roles?: Record<string, string>
}

/**
 * A journey's steps as parts, in lines an agent can read: position, the id
 * of the step's part and what the part is called.
 *
 * Printed above the document by `get_journey`. The ids are what `step` takes
 * on `set_step`, `move_step` and `remove_step`, and what a host stores for a
 * picked part. It also says who keeps the list, because that decides what
 * `set_step` does with `name` and `part`.
 */
function stepsSaid(journey: Journey, keeper: Keeper, unsettled: boolean): string {
  if (keeper.by === 'host') {
    const stepless = keeper.list.filter((part) => !journey.steps.some((step) => stepPart(step) === part.id))
    const lines = journey.steps.map((step, i) => {
      const id = stepPart(step)
      const part = keeper.list.find((one) => one.id === id)
      return `  ${i + 1}\t${part ? `${part.id}\t“${part.name}”` : '—\tin no part'}`
    })
    return (
      'PARTS: the list of this epic’s parts is kept by the host, in the epic’s own file; this app keeps one step for a '
      + 'part, filed under the part’s id. `groups` in the JSON below is from before that and is not read. '
      + (lines.length
        ? `Each step by position, with the id of its part (what \`step\` takes) and what the part is called:\n${lines.join('\n')}\n`
        : 'No step is written yet.\n')
      + (stepless.length
        ? `PARTS WITH NO STEP (pass the id as \`part\` to \`set_step\` to write its step): ${stepless.map((one) => `${one.id} “${one.name}”`).join(', ')}\n`
        : '')
      + '\n'
    )
  }
  if (!journey.steps.length) return ''
  const lines = journey.steps.map((step, i) => {
    const file = fileOf(journey, step)
    return `  ${i + 1}\t${stepPart(step) ?? '?'}\t“${nameOf(journey, step)}”${file ? `\t${file}` : ''}`
  })
  return (
    'STEPS: each step is one part of the epic, and a part is one step. Position, the id of the step’s part (what '
    + '`step` takes, and what a host keeps for a picked part), what the part is called, and the document an earlier '
    + 'version recorded for it if it did:\n'
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
 * Kehikot's: list, get, `create_journey`, `set_step`, `move_step` and `set_dependency`, plus `remove_step`,
 * which is here because `set_step`'s refusal on a projected journey creates the
 * need for it — a stored step nothing reads and nothing can remove would sit in
 * the file forever.
 *
 * And `set_journey`, for the prose around the steps (`setProse`). It came
 * later than the rest and its absence had a cost: `get_journey` handed an
 * agent a callout and two lists it could read and not correct, so a step
 * marked done sat under a callout saying the work was open until somebody
 * edited the file by hand. Every tool that changes a step now says to keep
 * that prose true, and names the tool that does.
 *
 * There is no tool for parts. The list of an epic's parts is the epic's: a
 * host from protocol 1.2.0 keeps it and edits it at its own door (`set_parts`
 * there), and this door files a step under a part's id (`part` on
 * `set_step`). For a host from before that this app still writes the list,
 * one part to a step: there making a part is `set_step`, naming it is an
 * argument of `set_step`, and removing it is `remove_step`. Every tool that
 * writes says which of the two it found.
 *
 * `set_step` no longer takes `file`. A part's document — the chapter of a
 * paper it covers — is kept by the module that keeps the document, not by
 * this one. The argument is still ACCEPTED for this release and ignored with
 * a sentence saying so, rather than refused or dropped in silence: an agent
 * working from a description it read yesterday would otherwise believe it had
 * set a chapter. It comes out of the answer with the next release.
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

/** What a step's patch takes, on `patch_step` and in each of `patch_steps`. */
const PATCH_FIELDS = {
  step: { type: 'string', description: 'The id of the step to change, from `get_journey`' },
  title: { type: 'string', description: "What becomes true, phrased from the user's side" },
  body: { type: 'string', description: 'Why it matters and where it stands. 150 words at most. "" clears it.' },
  refs: { type: 'array', items: { type: 'string' }, description: 'The whole list of refs, e.g. ["#2274", "gh#41"]. [] clears it.' },
  notes: { type: 'array', items: { type: 'string' }, description: 'The whole list of chips for work with no ticket. [] clears it.' },
  part: { type: 'string', description: 'Where the host keeps the list of parts: the id of the part this step, now in none, is the step of.' },
  under: { type: 'string', description: 'The id of the objective this step is a prerequisite of. "" puts it directly under the goal.' },
  phase: { type: 'string', description: 'The id of the journey’s phase this step is in. "" clears it, and a leaf is then in its objective’s.' },
  issue: { type: 'string', description: 'The tracker issue that delivers this step, also added to `refs`. "" forgets it.' },
  blockedBy: { type: 'array', items: { type: 'string' }, description: 'The ids of the gates that hold this step; the whole list. [] clears it.' },
  roles: {
    type: 'object',
    additionalProperties: { type: 'string', enum: [...REF_ROLES] },
    description: 'What each ref is to this step where it does not deliver it: { "<ref>": "prior-art" | "related" }. {} makes every ref deliver it.',
  },
} as const

/** The fields a patch named, as the answer says them. */
const patchedSaid = (named: string[]): string => andSaid(named.map((key) => `\`${key}\``))

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
      'says where the steps actually come from. A step is the step of one part of the epic: the lines above the ' +
      'JSON list every step with its position, the id of its part (what `step` takes on `set_step`, `move_step` ' +
      'and `remove_step`) and what the part is called, and say who keeps the list of parts — the host, in the ' +
      'epic’s own file, or this app for a host that does not. In the JSON a step’s `part` is that id; `groups` ' +
      'is the list as an older host reads it, and is not read where the host keeps its own. What is written ' +
      'with what: steps with `set_step`, `patch_step`, `patch_steps`, `move_step` and `remove_step`; `blockedBy` between refs with `set_dependency`; ' +
      '`gates` — decisions, access, work with no issue, refs another epic owns — with `set_gate` and `remove_gate`, ' +
      'listed above the JSON with the steps each holds (a step’s own `blockedBy` is its gates, and `roles` says which of its ' +
      'refs are prior art or related rather than delivering it); ' +
      '`title`, `lede`, `callout`, `missing`, `exists`, `open`, `phases` and `headings` with `set_journey`. ' +
      'The journey’s `phases` (its sections, left to right) are listed above the JSON with the steps in each; a ' +
      'step’s `phase` is the id of one, and a step with none of its own is in its objective’s.',
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
      return preamble + stepsSaid(journey, keeperIn(store, slug), Object.hasOwn(store.unsettled, slug)) + phasesSaid(journey) + gatesSaid(journey) + alsoSaidFor(journey, named.project) + JSON.stringify({ ...journey, ...alsoIn(journey, named.project) }, null, 2)
    },
  },

  create_journey: {
    description:
      'Begin the journey for an epic that has none yet: the first record, from which this app owns that epic’s ' +
      'steps and the prose around them. It is NOT made empty. The record starts as ' +
      'everything the host holds for that epic — this reads the host’s own file, ' +
      '.kehikot/host/epics/<slug>.json in the project (.kehikot/kehikko/ from an older host), once and without changing it — because from the moment ' +
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

  set_journey: {
    description:
      'The prose around a journey’s steps, which nothing else here writes: `title`, `lede`, `callout` (the note ' +
      'above the steps), `missing` (what is assumed but not built), the lists `exists` and `open`, and `headings` ' +
      '— reference lists kept from an older shape, each { heading, refs }. And the design of the journey: `goal` ' +
      '(one sentence), `measure` (how we will know it is met), `appetite` (the time it is worth), and the lists ' +
      '`rabbitHoles` and `noGos`. And `phases`: the labelled sections of the roadmap, left to right ("Concepting", ' +
      '"Creating UI elements", "Finishing up"), each { title, id? }, the whole list; a step is put in one with `phase` ' +
      'on `set_step`. A phase given without an `id` keeps the id of the phase that had its title, or gets one made ' +
      'from the title, so pass the `id` to rename one. Removing a phase that a step is in is refused, naming the ' +
      'steps: move or clear them first. Use it after `set_step`, `remove_step` ' +
      'or `set_dependency` whenever what you changed makes a sentence here untrue: a step marked done under a ' +
      'callout that still says the work is open is a journey contradicting itself. Unlike `set_step` this is a ' +
      'patch: a field you leave out is not touched; a field you pass replaces what was stored, whole; "" or [] ' +
      'clears it. So for `exists`, `open` and `headings` pass the full list as it should now read — read it with ' +
      '`get_journey` first. In `headings`, a heading left out of the list is removed with its references, and [] ' +
      'removes them all; a heading that keeps its name keeps anything else stored on it. `title` can be changed ' +
      'and not cleared, and the epic’s own title in a host is the host’s: the answer says when the two differ. ' +
      'Nothing is cut to fit — text that is too long, or a list that is not one, is refused with nothing ' +
      'written. A call that changes nothing writes nothing. This does not write steps, dependencies or the ' +
      'epic’s parts, and no other journey in the file is rewritten. The answer says which fields changed.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        title: { type: 'string', description: 'What the journey is called on this app’s page. Cannot be empty.' },
        lede: { type: 'string', description: 'The sentence under the title. "" clears it.' },
        callout: { type: 'string', description: 'The note above the steps: where the whole journey stands. "" clears it.' },
        missing: { type: 'string', description: 'What is assumed but not built. "" clears it.' },
        goal: { type: 'string', description: 'The goal, in one sentence: what is true for the user when this journey is done. "" clears it.' },
        measure: { type: 'string', description: 'How we will know the goal is met. "" clears it.' },
        appetite: { type: 'string', description: 'How much time this journey is worth, e.g. "two weeks". "" clears it.' },
        rabbitHoles: { type: 'array', items: { type: 'string' }, description: 'Known traps to stay out of, one sentence each; the whole list. [] clears it.' },
        noGos: { type: 'array', items: { type: 'string' }, description: 'What this journey will not do, one sentence each; the whole list. [] clears it.' },
        exists: { type: 'array', items: { type: 'string' }, description: 'What already exists, one sentence each; the whole list. [] clears it.' },
        open: { type: 'array', items: { type: 'string' }, description: 'What is still undecided, one sentence each; the whole list. [] clears it.' },
        phases: {
          type: 'array',
          description: 'The journey’s phases, left to right; the whole list. A phase left out is removed (refused while a step is in it); [] removes all.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'What the phase is called, e.g. "Concepting"' },
              id: { type: 'string', description: 'Its id, from `get_journey`. Omit for a new phase: one is made from the title.' },
            },
            required: ['title'],
          },
        },
        headings: {
          type: 'array',
          description: 'The whole list of older reference headings. One left out is removed; [] removes all.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'What the heading is called, e.g. "Open MRs"' },
              refs: { type: 'array', items: { type: 'string' }, description: 'The references under it, e.g. ["!1801", "gh#41"]' },
            },
            required: ['heading', 'refs'],
          },
        },
      },
      required: ['project', 'slug'],
    },
    annotations: { title: 'Write a journey’s prose', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const asked = proseSaid(args)
      if (!asked.ok) return asked.error
      const out = setProse(named.project, str(args.slug, MAX_SLUG), asked.said)
      if (!out.ok) return out.error
      const quoted = (keys: string[]) => andSaid(keys.map((key) => `\`${key}\``))
      const slug = out.journey.slug
      if (!out.changed.length) {
        return `Nothing was written: ${quoted(out.same)} of ${slug} already ${out.same.length === 1 ? 'reads' : 'read'} so.`
      }
      return (
        `Set ${quoted(out.changed)} of ${slug}, in ${dataFile(named.project).path} and nowhere else.`
        + (out.removed.length ? ` Removed from \`headings\`, with the references under ${out.removed.length === 1 ? 'it' : 'them'}: ${andSaid(out.removed.map((one) => `“${one}”`))}.` : '')
        + (out.same.length ? ` ${quoted(out.same)} already read so.` : '')
        + out.said
      )
    },
  },

  set_step: {
    description:
      'One numbered stop on the journey: what has to become true for a user, and which issues and changes ' +
      'deliver it. Omit `position` and `step` to append; pass `position` (1-based) or `step` (the id of the ' +
      'step’s part, which does not move when other steps are removed) to overwrite that step. Read the step ' +
      'first: this writes the whole step, so of title, body, refs and notes anything you leave out is gone and ' +
      'anything stale you keep is a claim you are making afresh; to change only some fields of a step, use `patch_step`. Refused on a journey whose steps are kept ' +
      'elsewhere, with a sentence saying where to write instead. A step is the step of one PART of the epic — ' +
      'what a person picks in the host’s bar to narrow every module — and `get_journey` says who keeps the list ' +
      'of parts. Where the HOST keeps it (in the epic’s own file), this never makes or renames a part: add one ' +
      'at the host’s door (`set_parts`) and pass its id here as `part`, for a new step or for a step that is in ' +
      'no part; without `part` a new step is in no part, and is hidden while parts are picked. A part has one ' +
      'step, so an id another step has is refused, as is an id the host does not list. Where THIS APP keeps it ' +
      '(a host from before that), a new step is its own part: `name` is what the part is called where it is ' +
      'picked (short — "Methods"; without one it is the step’s title; "" clears it; left out, it stays), and ' +
      '`part` is not taken. What the step’s refs are is published for its part after every write, so other ' +
      'modules can narrow by them. A part’s chapter is not set here: it is kept by the module that keeps the ' +
      'paper. A journey can be a TREE: `under` files this step under an objective (another step, which is not ' +
      'done until every step under it is), and `set_dependency` with `step` says which steps must be done first; ' +
      'a write that would make a step its own prerequisite is refused. `issue` records the issue that delivers ' +
      'the step. `blockedBy` is the ids of the GATES that hold the step (`set_gate` makes one: a decision, access, work ' +
      'with no issue, a ref in another epic); a step an open gate holds is never `next_step`. `roles` says what a ref is to ' +
      'the step where it does not deliver it: { "#1850": "prior-art", "#2493": "related" } — prior art and related refs never ' +
      'make the step done. `phase` puts the step in one of the journey’s phases (`phases` on `set_journey`), by id; an objective and a leaf can each have one, and a leaf with none of its own is in its objective’s. Left out, `under`, `phase`, `issue`, `blockedBy` and `roles` stay as they were. The answer says the step’s position and the id of its part. Writing a step does not touch the ' +
      'prose around the steps: if the journey’s `callout`, `lede`, `exists`, `open`, `missing` or `headings` ' +
      'now says something this step makes untrue — work described as open that this step records as done — ' +
      'correct it with `set_journey` in the same sitting.',
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
        part: { type: 'string', description: 'Where the host keeps the list of parts: the id of the part this step is the step of, for a new step or one in no part.' },
        name: { type: 'string', description: 'Where this app keeps the list of parts: what the step’s part is called. Omit to leave it; "" for the title.' },
        under: { type: 'string', description: 'The id of the step (an intermediate objective) this step is a prerequisite of. Omit to leave it; "" puts it directly under the goal.' },
        phase: { type: 'string', description: 'The id of the journey’s phase this step is in, from `get_journey`. Omit to leave it; "" clears it, and a leaf is then in its objective’s.' },
        issue: { type: 'string', description: 'The tracker issue that delivers this step, e.g. "#41" or "gh#41"; also added to `refs`. Omit to leave it; "" forgets it.' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'The ids of the gates that hold this step, from `get_journey` or `set_gate`; the whole list. Omit to leave it; [] clears it.' },
        roles: {
          type: 'object',
          additionalProperties: { type: 'string', enum: [...REF_ROLES] },
          description: 'What each ref is to this step, for refs that do not deliver it: { "<ref>": "prior-art" | "related" | "delivers" }. Every ref must be in `refs`; a ref left out delivers the step. Omit to leave the roles; {} makes every ref deliver it.',
        },
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
      const part =
        out.keeper.by === 'host'
          ? listedBy(out.keeper, out.id)
            ? `the step of part ${out.id}, “${out.keeper.list.find((one) => one.id === out.id)?.name ?? ''}”`
            : 'in no part: the host keeps this epic’s list of parts, so add one there and pass its id as `part`'
          : `id ${out.id}, called “${step ? nameOf(out.journey, step) : ''}”`
      return (
        `Set step ${out.where} of ${out.journey.slug} (${part}), in ${dataFile(named.project).path} and nowhere else.`
        /* Arguments that are not taken are SAID not to have been, because
           ignoring one in silence leaves an agent believing it did something. */
        + (out.keeper.by === 'journeys' && Object.hasOwn(args, 'part')
          ? ' `part` is not taken here: this app keeps this epic’s list of parts for a host that does not, so a step is its own part, and its id is the one above.'
          : '')
        + (Object.hasOwn(args, 'file') ? ' `file` is no longer taken: a part’s chapter is set in the module that keeps the paper, not here.' : '')
        + out.said
      )
    },
  },

  patch_step: {
    description:
      'Change only some fields of one existing step, named by `step` (the id of its part, from `get_journey`): ' +
      'what you pass is replaced, what you leave out stays as it was. Use it to file a step `under` an objective, give ' +
      'it a `phase`, record its `issue`, its gates (`blockedBy`) or its `roles`, or correct its title, body, refs or notes ' +
      'without resending the rest. "" clears a string field (`body`, `under`, `phase`, `issue`; a step keeps a `title`), ' +
      '[] clears a list (`refs`, `notes`, `blockedBy`) and {} clears `roles`. `part` files a step that is in no part ' +
      'under a part the host lists. Refused with nothing written for everything `set_step` refuses: a phase the journey ' +
      'does not have, an `under` that names no other step or makes a step its own prerequisite, a part that is not ' +
      'listed or already has its step, a gate that does not exist. To change several steps in one write, use ' +
      '`patch_steps`. A new step is written with `set_step`. If the journey’s prose says something the change makes ' +
      'untrue, correct it with `set_journey`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        ...PATCH_FIELDS,
      },
      required: ['project', 'slug', 'step'],
    },
    annotations: { title: 'Change part of a step', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const asked = patchIn(args)
      if (!asked.ok) return `${asked.error} Nothing was written.`
      const out = patchSteps(named.project, str(args.slug, MAX_SLUG), [asked.patch])
      if (!out.ok) return out.error
      const one = out.done[0]!
      return `Patched step ${one.where} of ${out.journey.slug} (${one.id}): ${patchedSaid(one.named)}, in ${dataFile(named.project).path} and nowhere else.${out.said}`
    },
  },

  patch_steps: {
    description:
      'Several `patch_step`s in one write, all or nothing: `steps` is a list of patches, each `{ step, ...fields }` with ' +
      'the fields `patch_step` takes. They are applied in order, each to what the one before left, and if any one is ' +
      'refused nothing is written and the answer says which. A loop is checked on the result, so a restructure may ' +
      'move a step and its objective in either order. Use it to turn a flat journey into a tree: `under` and `phase` ' +
      'for every step in one call. If the journey’s prose says something the change makes untrue, correct it with ' +
      '`set_journey`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        steps: {
          type: 'array',
          items: { type: 'object', properties: PATCH_FIELDS, required: ['step'] },
          description: 'The patches, applied in order: [{ "step": "methods", "under": "evidence", "phase": "concepting" }, …]',
        },
      },
      required: ['project', 'slug', 'steps'],
    },
    annotations: { title: 'Change part of several steps', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      if (!Array.isArray(args.steps)) return `\`steps\` is a list of { step, ...fields }, and arrived as ${typeof args.steps}. Nothing was written.`
      if (args.steps.length > MAX_LIST) return `At most ${MAX_LIST} patches in one call. Nothing was written.`
      const patches: StepPatch[] = []
      for (const [i, bag] of args.steps.entries()) {
        if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return `Patch ${i + 1} is not an object { step, ...fields }. Nothing was written.`
        const asked = patchIn(bag as Record<string, unknown>)
        if (!asked.ok) return `Patch ${i + 1}: ${asked.error} Nothing was written.`
        patches.push(asked.patch)
      }
      const out = patchSteps(named.project, str(args.slug, MAX_SLUG), patches)
      if (!out.ok) return out.error
      const lines = out.done.map((one) => `  ${one.where}\t${one.id}\t${patchedSaid(one.named)}`)
      return `Patched ${out.done.length} ${out.done.length === 1 ? 'step' : 'steps'} of ${out.journey.slug} in one write, in ${dataFile(named.project).path} and nowhere else:\n${lines.join('\n')}${out.said}`
    },
  },

  move_step: {
    description:
      'Move one step to another place in the journey, by its 1-based `position` or by `step` (the id of its ' +
      'part), to the 1-based position `to`; the steps between move by one and nothing else about any step ' +
      'changes. Where this app keeps the list of the epic’s parts, the part moves with its step. Where the host ' +
      'keeps the list, only the step moves here: the order of the parts is changed at the host’s door. If the ' +
      'journey’s prose refers to steps by number, correct it with `set_journey`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        position: { type: 'number', description: '1-based position of the step' },
        step: { type: 'string', description: 'The id of the step, from `get_journey`. Instead of `position`.' },
        to: { type: 'number', description: 'The 1-based position it moves to' },
      },
      required: ['project', 'slug', 'to'],
    },
    annotations: { title: 'Move a step', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = moveStep(
        named.project,
        str(args.slug, MAX_SLUG),
        { position: position(args.position), id: str(args.step, MAX_PART) || undefined },
        position(args.to),
      )
      return out.ok ? out.said : out.error
    },
  },

  remove_step: {
    description:
      'Drop one step, by its 1-based `position` or by `step` (the id of its part); the steps after it renumber. ' +
      'Where this app keeps the list of the epic’s parts, its part goes with it — a part is its step — and ' +
      'whatever another module keeps against that id names nothing afterwards. Where the host keeps the list, ' +
      'only the step goes: the part stays listed until it is removed at the host’s door, and the answer says ' +
      'so. Allowed on a journey whose steps ' +
      'are projected elsewhere, because there the stored steps are leftovers nothing reads — removing them is ' +
      "the cleanup set_step's refusal creates the need for. The prose around the steps is not touched: if the " +
      'callout or a list still speaks of what this step said, correct it with `set_journey`.',
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
      'this is where the real order of work lives. Two forms. Between STEPS: pass `step` (a step’s id, from ' +
      '`get_journey`) and `after`, the ids of the steps that must be done before it; this is the edge of the ' +
      'journey’s tree that `next_step` follows, and one that would make a step its own prerequisite is refused ' +
      'with nothing written. Between REFS: pass `ref` and `blockedBy`; a blocker is an issue or a change. Something ' +
      'that is not a tracker ref — a decision, access somebody must grant, work with no issue yet, a ref another epic ' +
      'owns — is a GATE: make it with `set_gate`, which says which steps it holds. Pass an empty list to clear either. ' +
      'If the journey’s prose names the same gate, keep it true with `set_journey`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        step: { type: 'string', description: 'The id of the step that waits. With `after`, instead of `ref`.' },
        after: { type: 'array', items: { type: 'string' }, description: 'The ids of the steps that must be done before `step`' },
        ref: { type: 'string', description: 'The blocked thing, e.g. "#2274"' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'What must land first' },
      },
      required: ['project', 'slug'],
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
      if (Object.hasOwn(args, 'step')) return stepAfter(named.project, journey, str(args.step, MAX_PART), list(args.after, MAX_PART))
      const ref = str(args.ref, MAX_REF)
      if (!ref) return 'which reference is blocked? Pass `ref` and `blockedBy`, or `step` and `after` for an order between steps.'
      const gates = list(args.blockedBy, MAX_REF)
      if (gates.length) journey.blockedBy[ref] = gates
      else delete journey.blockedBy[ref]
      const written = writeJourney(named.project, journey)
      if (!written.ok) return written.error
      return (gates.length ? `${ref} now waits on ${gates.join(', ')}.` : `${ref} has no blockers.`) + settledSaid(written) + unpublishedSaid(written)
    },
  },

  set_gate: {
    description:
      'Add or change one GATE: something that stands in the way of a step and is not a step — so a journey written ' +
      'honestly about what the tracker holds does not read as unblocked. A gate has a `kind`: `issue` (an issue or ' +
      'change in this epic; pass `ref`), `work` (work with no issue yet), `decision` (somebody has to decide), ' +
      '`access` (somebody outside the team has to grant something), or `ref-elsewhere` (a ref another epic owns; pass ' +
      '`ref` and `epic`, that epic’s slug). And a `title`, and optionally an `owner` (a person or a role), a `note` and ' +
      'a `ref`. `blocks` is the whole list it holds: step ids and tracker refs ("issue #3620 waits on the legal decision"; a ref may be in another epic\'s journey too), or set `blockedBy` on `set_step`. `waitsOn` lists refs the gate itself waits on. A step an open gate ' +
      'holds is never `next_step`. Omit `gate` to add one (its id is made from the title); pass `gate` to change that ' +
      'one — this is a patch: what you leave out stays, "" clears `owner`, `note`, `ref` or `epic`. A work, decision or ' +
      'access gate is done only when somebody says so: `state: "done"` with `by` (who decided, granted or did it) ' +
      'records who and when; `state: "open"` reopens it. An issue gate is also done when its ref closes. Refused, ' +
      'with nothing written, for an unknown kind, a missing title or ref, or a step id that is not one. If the ' +
      'journey’s `open` or `callout` says the same thing in prose, keep it true with `set_journey`.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        gate: { type: 'string', description: 'The id of the gate to change, from `get_journey`. Omit to add one.' },
        kind: { type: 'string', enum: [...GATE_KINDS], description: 'What kind of thing stands in the way. Needed for a new gate.' },
        title: { type: 'string', description: 'What has to happen, in a few words: "Legal decides whether GPL binaries may be hosted". Needed for a new gate.' },
        owner: { type: 'string', description: 'Who has to act: a person or a role, e.g. "legal" or "the infrastructure team". "" clears it.' },
        note: { type: 'string', description: 'Anything a reader needs: the terms asked about, where it was discussed. "" clears it.' },
        ref: { type: 'string', description: 'The tracker ref: the issue itself for `issue` and `ref-elsewhere`, else where it is discussed. "" clears it.' },
        epic: { type: 'string', description: 'For `ref-elsewhere`: the slug of the epic that owns the ref.' },
        state: { type: 'string', enum: ['open', 'done'], description: '"done" marks it done (pass `by`); "open" reopens it.' },
        by: { type: 'string', description: 'Who marks it done: the person, or "agent" and on whose word.' },
        blocks: { type: 'array', items: { type: 'string' }, description: 'What this gate holds: step ids and tracker refs ("#3620", "!44", "gh#12"), mixed; the whole list. A ref it holds is not done while the gate is open, and a step one of whose delivering refs it holds is never `next_step`. [] holds none. Omit to leave it.' },
        waitsOn: { type: 'array', items: { type: 'string' }, description: 'Tracker refs this gate itself waits on ("the legal decision waits on !44"); the whole list. [] clears it. Omit to leave it.' },
      },
      required: ['project', 'slug'],
    },
    annotations: { title: 'Set a gate', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = setGate(named.project, str(args.slug, MAX_SLUG), gateGiven(args))
      return out.ok ? out.said : out.error
    },
  },

  remove_gate: {
    description:
      'Take one gate out of a journey, and off every step it held. For a gate that was never real or is recorded ' +
      'twice — a gate that was dealt with is marked done with `set_gate` instead, so the record keeps who and when.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        gate: { type: 'string', description: 'The id of the gate, from `get_journey`' },
      },
      required: ['project', 'slug', 'gate'],
    },
    annotations: { title: 'Remove a gate', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = removeGate(named.project, str(args.slug, MAX_SLUG), str(args.gate, MAX_PART))
      return out.ok ? out.said : out.error
    },
  },

  next_step: {
    description:
      'The step to take next on a journey: the first leaf of its tree (a step nothing is under), in the journey’s ' +
      'order, that is not done and whose prerequisites are — the steps it is `after`, and those of every objective ' +
      'it sits under. A step is done when its issue is: this server reads no tracker, so pass `closed`, the refs ' +
      'you know are closed or merged (read them with the host’s `read_tracker`); without it no issue counts as ' +
      'done and the answer says so. A step an open gate holds (its `blockedBy`, or its objective’s) is not next: a ' +
      'decision, access or work gate is open until it is marked done with `set_gate`; an issue gate, until its ref is ' +
      'in `closed`. The answer names the gates that held earlier steps. Refused when the prerequisites go round in a circle. Read-only.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string', description: 'The journey’s slug, which is the epic’s' },
        closed: { type: 'array', items: { type: 'string' }, description: 'Refs known to be closed or merged, e.g. ["#41", "gh#7"]' },
      },
      required: ['project', 'slug'],
    },
    annotations: { title: 'The next step', readOnlyHint: true, openWorldHint: false },
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
      const plan = planOf(journey)
      if (plan.kind === 'elsewhere') return `${slug}'s steps are kept in ${plan.from.where}, which this app cannot read, so it cannot say which comes next.`
      return nextSaid(journey, Object.hasOwn(args, 'closed') ? list(args.closed, MAX_REF) : null)
    },
  },
}

/**
 * The next step, said for an agent: which, why it is free to start, and its issue. `closed` is null
 * when the caller said nothing about the tracker, which is said rather than read as "nothing closed".
 */
export function nextSaid(journey: Journey, closed: string[] | null): string {
  const shut = new Set(closed ?? [])
  const next = nextStep(journey.steps, (issue) => shut.has(issue), gatesOf(journey), journey.blockedBy)
  const caveat = closed === null ? ' No `closed` refs were passed, so no issue was counted as done.' : ''
  const gated = next.gated.length
    ? ` Held by open gates: ${next.gated
        .map(({ node, gates }) => `step ${node.position}, “${node.title}”, waits on ${andSaid(gates.map((gate) => `${KIND_SAID[gate.kind].word} ${gate.id} (“${gate.title}”${gate.owner ? `, ${gate.owner} to act` : ''})`))}`)
        .join('; ')}.`
    : ''
  if (!next.node) return `${next.why ?? 'There is no next step.'}${gated}${caveat}`
  const nodes = new Map(treeOf(journey.steps).map((one) => [one.id, one]))
  const node = next.node
  const up = node.under ? nodes.get(node.under) : null
  return (
    `Next on ${journey.slug}: step ${node.position}, “${node.title}” (id ${node.id}).`
    + (up ? ` It is under “${up.title}”.` : '')
    + (node.issue ? ` Its issue is ${node.issue}.` : ' It has no issue yet.')
    + (next.waitedOn.length ? ` It waited on ${andSaid(next.waitedOn.map((id) => `“${nodes.get(id)?.title ?? id}”`))}, all done.` : ' Nothing has to be done before it.')
    + gated
    + caveat
  )
}

/**
 * Say which steps must be done before `step`: the tree's edges (`after` on the step). Refused with
 * nothing written for an id that is no step's, and for an edge that would close a circle.
 */
function stepAfter(project: string, journey: Journey, id: string, after: string[]): string {
  if (!id) return 'which step waits? Pass its id, from `get_journey`.'
  const at = journey.steps.findIndex((one) => stepPart(one) === id)
  if (at < 0) return `${notAStep(journey, id)} Nothing was written.`
  const known = new Set(journey.steps.map((one) => stepPart(one)).filter(Boolean))
  const unknown = after.filter((one) => !known.has(one))
  if (unknown.length) return `${andSaid(unknown.map((one) => `“${one}”`))} ${unknown.length === 1 ? 'is not the id of a step' : 'are not ids of steps'} of this journey. Nothing was written.`
  if (after.includes(id)) return 'A step cannot wait on itself. Nothing was written.'
  const steps = journey.steps.map((one, i) => {
    if (i !== at) return one
    const { after: _after, ...rest } = one as typeof one & { after?: unknown }
    return after.length ? { ...rest, after: [...new Set(after)] } : rest
  })
  const circle = cycleSaid(steps)
  if (circle) return circle
  const written = writeJourney(project, { ...journey, steps })
  if (!written.ok) return written.error
  const title = journey.steps[at]!.title
  const names = after.map((one) => `“${journey.steps.find((s) => stepPart(s) === one)?.title ?? one}”`)
  return (after.length ? `“${title}” now waits on ${andSaid(names)}.` : `“${title}” waits on no other step.`) + settledSaid(written) + unpublishedSaid(written)
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
        'prose around it. All of it is written here: steps with `set_step` (whole), `patch_step` and `patch_steps` (only the fields passed), `move_step` and `remove_step`, what ' +
        'blocks what with `set_dependency`, what stands in the way that is not a step — a decision, access, work with no issue, ' +
        'a ref another epic owns — as gates with `set_gate`, and the prose — title, lede, callout, what exists, is open and is ' +
        'missing, and the older reference headings — with `set_journey`. A journey is one document a person ' +
        'reads top to bottom, so after changing a step, read the prose again and correct whatever the change ' +
        'made untrue; never edit the file by hand. They are kept inside the project they are about, in .kehikot/journeys/journeys.json, so every ' +
        'tool here takes `project` — the absolute path of the project folder — and refuses without one rather ' +
        'than guessing which project you meant. This server reads no tracker and holds no credential, so nothing ' +
        "here can tell you whether an issue is open — that is read by a host and handed to this app's page. " +
        'A journey may say its steps are kept somewhere this app cannot read; an empty steps array on one of ' +
        'those means "not here", never "none". A step is the step of one part of the epic — what a person picks ' +
        'in a host’s bar to narrow every module. The list of parts is the epic’s: a current host keeps it and ' +
        'edits it at its own door, and `set_step` here files a step under a part’s id; for an older host this ' +
        'app still keeps the list, one part to a step. `get_journey` says which, and lists the ids. A journey ' +
        'can be a tree: `under` on `set_step` or `patch_step` files a step under an objective, `set_dependency` with `step` and ' +
        '`after` orders steps, and `next_step` names the first step free to start. Its `phases` on `set_journey` ' +
        'are its labelled sections, left to right, and `phase` on `set_step` puts a step in one. The person designs one with ' +
        'the /journey skill this module offers.',
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
/**
 * The door. Every project path in a request — `project` in the query, in the body or in a tool's
 * arguments — is put to the host first (`resolveProject`); what is worked on is the path it gives
 * back, never the one that was sent, and a folder the host does not vouch for is refused before
 * anything is read or made. A move that was followed is said in the answer. `answerAt` below is the
 * door for a path that has already been vouched for; tests of what the doors DO start there.
 */
export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Promise<Reply | null> {
  const notes: string[] = []
  let refusal: string | null = null
  const resolve = async (named: unknown): Promise<unknown> => {
    if (typeof named !== 'string' || !named.trim()) return named
    const at = await resolveProject(named.trim())
    if (!at.ok) {
      refusal = at.error
      return named
    }
    if (at.followed && !notes.includes(at.followed)) notes.push(at.followed)
    return at.path
  }
  const refused = (why: string): Reply =>
    path === '/mcp'
      ? { status: 200, body: { jsonrpc: '2.0', id: (body?.id as number | string | undefined) ?? null, result: { content: [{ type: 'text', text: why }], isError: true } } }
      : bad(why, 409)

  let asked = query
  let sent = body
  if (path.startsWith('/api/') && query.has('project')) {
    asked = new URLSearchParams(query)
    asked.set('project', (await resolve(query.get('project'))) as string)
  }
  if (path.startsWith('/api/') && sent && 'project' in sent) sent = { ...sent, project: await resolve(sent.project) }
  if (path === '/mcp' && method === 'POST' && sent?.method === 'tools/call') {
    const params = (sent.params ?? {}) as { arguments?: Record<string, unknown> }
    if (params.arguments && 'project' in params.arguments) {
      sent = { ...sent, params: { ...params, arguments: { ...params.arguments, project: await resolve(params.arguments.project) } } }
    }
  }
  if (refusal !== null) return refused(refusal)

  /* Where the Factory has each of these issues (`factory.ts`). Async, so here rather than in
     `answerAt`; a read, so ungated like the other reads. */
  if (path === '/api/factory' && method === 'GET') {
    const project = str(asked.get('project'), MAX_PROJECT)
    if (!project) return bad('which project?')
    const refs = (asked.get('refs') ?? '').split(',').map((one) => one.trim().slice(0, MAX_REF)).filter(Boolean)
    return ok({ ok: true, ...(await factoryStages(project, refs)) })
  }

  const reply = answerAt(method, path, asked, sent, ticket)
  if (!reply || notes.length === 0) return reply
  const said = reply.body as Record<string, unknown> | null
  if (path === '/mcp' && said && typeof said === 'object') {
    const result = said.result as { content?: { type: string; text: string }[] } | undefined
    if (result?.content) result.content = [...result.content, ...notes.map((text) => ({ type: 'text', text }))]
  } else if (said && typeof said === 'object' && !Array.isArray(said)) {
    said.movedFrom = notes
  }
  return reply
}

export function answerAt(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Reply | null {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  /* The skill this module offers (protocol 2.5.0): its SKILL.md, as text. Public: it is what a host
     shows a person before they install it, and holds nothing of anybody's. */
  const skill = skillAt(path)
  if (skill) {
    if (method !== 'GET') return bad('this door takes GET', 405)
    return { status: 200, body: null, raw: { bytes: skill.text, type: 'text/markdown; charset=utf-8' } }
  }

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
    return ok({ ok: true, journey: view(journey, keeperIn(store, slug), Object.hasOwn(store.unsettled, slug), str(query.get('project'), MAX_PROJECT)) })
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
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said.trim() })
    }

    if (path === '/api/step/remove') {
      const out = removeStep(project, slug, { position: position(body.position), id: str(body.step, MAX_PART) || undefined })
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
    }

    if (path === '/api/step/move') {
      const out = moveStep(project, slug, { position: position(body.position), id: str(body.step, MAX_PART) || undefined }, position(body.to))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
    }

    /* Store a journey that is still in the older shape of parts on disk as
       it is read. The one write here that changes nothing a person wrote. */
    if (path === '/api/settle') {
      const out = settle(project, slug)
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
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
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), from: out.from, said: begun(out, dataFile(project).path) })
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
      return ok({ ok: true, journey: view(written.journey, written.keeper, false, project), said: (settledSaid(written) + unpublishedSaid(written)).trim() })
    }

    /* The gates (`src/gates.ts`): the same writers the MCP door uses, so the refusals are one. */
    if (path === '/api/gate') {
      const out = setGate(project, slug, gateGiven(body))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
    }
    if (path === '/api/gate/remove') {
      const out = removeGate(project, slug, str(body.gate, MAX_PART))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
    }
    if (path === '/api/gate/from-note') {
      const out = noteToGate(project, slug, { position: position(body.position), id: str(body.step, MAX_PART) || undefined }, str(body.note, MAX_NOTE))
      if (!out.ok) return bad(out.error, out.status)
      return ok({ ok: true, journey: view(out.journey, out.keeper, false, project), said: out.said })
    }
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

