import { createHash } from 'node:crypto'

import { tooLong } from './limits.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'
import {
  type Held,
  type Journey,
  NOWHERE,
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
 * The page is told which project by the host, in `roadmap.context.projectPath`.
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
/** As long as a path may be, matching the protocol's own `LIMITS.PATH`. */
const MAX_PROJECT = 4096

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
export const TICKET = crypto.randomUUID()

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
 * The whole step is written, not patched. That is the roadmap's rule and it is
 * kept here because the reason is unchanged: anything left out is gone, and
 * anything stale kept is a claim being made afresh. The editor on the page
 * therefore fills every box from what is stored before anybody types.
 */
function setStep(
  project: string | null,
  slug: string,
  at: number | undefined,
  step: { title: string; body: string; refs: string[]; notes: string[] },
): { ok: false; error: string } | { ok: true; journey: Journey; where: number } {
  if (!isSlug(slug)) return { ok: false, error: 'that is not a journey name' }

  const store = held(project)
  const nothing = nothingToReadIn(store)
  if (nothing) return { ok: false, error: nothing }

  const journey = journeyIn(store, slug)
  if (!journey) return { ok: false, error: `no journey "${slug}" here` }

  /* The refusal that has to say where to write instead. A tool that says only
     "no" leaves somebody with a decision they cannot record anywhere, and the
     next thing they do is write it in a second place. */
  const elsewhere = refusedBecauseElsewhere(journey)
  if (elsewhere) return { ok: false, error: elsewhere }

  if (!step.title) return { ok: false, error: 'a step has to say what becomes true' }
  const long = tooLong(step.body)
  if (long) return { ok: false, error: long }

  const parsed = stepSchema.parse(step)
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
        + 'a host would put in `roadmap.context.projectPath`. Nothing here guesses: a guess writes a journey into a '
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
 * These are the roadmap's own epic tools over this app's store instead of the
 * roadmap's: list, get, `set_step` and `set_dependency`, plus `remove_step`,
 * which is here because `set_step`'s refusal on a projected journey creates the
 * need for it — a stored step nothing reads and nothing can remove would sit in
 * the file forever.
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
 *    roadmap's own rule forbids everywhere. There is deliberately no tool.
 *  - `report_stage`. Saying where work has got to belongs to whoever is doing
 *    it, and it is reported to the roadmap, which is what holds the roster that
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
      'says where the steps actually come from.',
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
      return preamble + JSON.stringify(journey, null, 2)
    },
  },

  set_step: {
    description:
      'One numbered stop on the journey: what has to become true for a user, and which issues and changes ' +
      'deliver it. Omit position to append; pass it to overwrite the step at that 1-based position. Read the ' +
      'step first: this writes the whole step, so anything you leave out is gone and anything stale you keep is ' +
      'a claim you are making afresh. Refused on a journey whose steps are kept elsewhere, with a sentence ' +
      'saying where to write instead.',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path of the project folder' },
        slug: { type: 'string' },
        title: { type: 'string', description: "What becomes true, phrased from the user's side" },
        body: { type: 'string', description: 'Why it matters and where it stands. 150 words at most.' },
        refs: { type: 'array', items: { type: 'string' }, description: 'e.g. ["#2274", "!1801", "gh#41"]' },
        notes: { type: 'array', items: { type: 'string' }, description: 'Chips for work with no ticket' },
        position: { type: 'number' },
      },
      required: ['project', 'slug', 'title'],
    },
    run(args) {
      const named = projectArg(args.project)
      if ('error' in named) return named.error
      const out = setStep(named.project, str(args.slug, MAX_SLUG), position(args.position), {
        title: str(args.title, MAX_TITLE),
        body: str(args.body, MAX_BODY),
        refs: list(args.refs, MAX_REF),
        notes: list(args.notes, MAX_NOTE),
      })
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

/** A status and a document. Nothing here writes bytes; the adapter does that. */
export interface Reply {
  status: number
  /** `null` means "answer with no body", which is what a notification gets. */
  body: unknown
}

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
        'those means "not here", never "none".',
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
   * `page/document.ts` argues that `GET /api/ticket` would be "the ticket
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
    if (ticket !== TICKET) return bad('that request did not come from this app’s own page', 403)
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

  if (method === 'POST' && path.startsWith('/api/')) {
    if (!body) return bad('that was not a request')
    const project = str(body.project, MAX_PROJECT)
    /* The ticket is checked against the PROJECT THIS WRITE NAMES, so a ticket
       taken out while another project was open does not redeem here. See the
       essay on `writeTicketFor`: the failure it catches is a save composed
       against project A arriving after the host moved the page to project B. */
    const expected = writeTicketFor(project)
    if (expected === null || ticket !== expected) {
      return bad(
        'that write did not come from this app’s own page, on this project. A ticket is taken out for one project '
          + 'and does not redeem against another: if the canvas has just moved, re-open the journey before saving, '
          + 'so that what is written is written where it was composed.',
        403,
      )
    }
    const slug = str(body.slug, MAX_SLUG)

    if (path === '/api/step') {
      const out = setStep(project, slug, position(body.position), {
        title: str(body.title, MAX_TITLE),
        body: str(body.body, MAX_BODY),
        refs: list(body.refs, MAX_REF),
        notes: list(body.notes, MAX_NOTE),
      })
      if (!out.ok) return bad(out.error)
      return ok({ ok: true, journey: view(out.journey) })
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
