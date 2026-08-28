import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * This file's own directory, spelled the way every runtime spells it.
 *
 * It used to be `import.meta.dir`, which is Bun's and only Bun's. That was
 * true while this store was loaded by a `Bun.serve` process and stopped being
 * true the moment the store became middleware in front of Vite: `bunx vite`
 * launches the `vite` binary, which runs under NODE, where `import.meta.dir` is
 * undefined. `join(undefined, 'data')` throws, so the failure at least
 * announces itself — but it announces itself as a TypeError inside a request
 * handler, which is a long way from "this app is holding the wrong end of the
 * runtime".
 */
const HERE = fileURLToPath(new URL('.', import.meta.url))

/**
 * The journeys, on disk, in this app's own directory.
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
 * The app's own store, beside the program.
 *
 * `JOURNEYS_DATA` moves it, and it is deliberately not `ROADMAP_DATA` or
 * `ROADMAP_JOURNEY_DATA`. Those variables belong to a different program:
 * honouring either would make this app's store follow a roadmap that may not be
 * running, may not exist, and certainly never agreed to hold anything of ours.
 * One store, one owner, one name.
 *
 * Resolved at call time rather than at import, so that a test — or a deployment
 * setting the variable in a wrapper — does not depend on which module happened
 * to be loaded first.
 */
export function dataDir(): string {
  const dir = process.env.JOURNEYS_DATA ?? join(HERE, 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Where the journeys this app SHIPS with live. Tracked; never written to. */
function seedDir(): string {
  return join(HERE, 'seed')
}

/**
 * Fill an empty store from the shipped one, once.
 *
 * An app whose first screen is empty has to be believed about the emptiness,
 * and nobody starting a journeys app for the first time believes it. So the
 * store is seeded on first use with the journeys this app ships with, and
 * seeding is conditional on the store being EMPTY rather than on a marker file:
 * a marker is a second fact to keep in step with the first, and the first is
 * already sitting in the directory in plain sight.
 *
 * It never overwrites. A journey edited here and then re-seeded would be an
 * edit silently undone, which is the one thing a store must not do.
 */
export function seedIfEmpty(): number {
  const dir = dataDir()
  if (readdirSync(dir).some((f) => f.endsWith('.json'))) return 0
  const from = seedDir()
  if (!existsSync(from)) return 0
  let n = 0
  for (const file of readdirSync(from)) {
    if (!file.endsWith('.json')) continue
    copyFileSync(join(from, file), join(dir, file))
    n++
  }
  return n
}

/* ------------------------------------------------------------------ *
 * A slug is a name, not a path
 * ------------------------------------------------------------------ */

const SLUG = /^[a-z0-9-]{1,80}$/

/**
 * The one check every path in this file runs first.
 *
 * A slug names a journey and becomes a filename; it is not a path. The protocol
 * package makes the same check on `epic` at the host's own door and gives the
 * reason: a refusal that distinguished "no such journey" from "not a journey
 * name" would be a way to enumerate what is here, and there is no character in
 * this class that can leave a directory. The same holds inside the app, where
 * the callers are
 * a browser, an agent over MCP, and whatever else on this machine found the
 * port — loopback is a fence around the machine, not around the programs on it.
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

/* ------------------------------------------------------------------ *
 * Reading and writing
 * ------------------------------------------------------------------ */

function pathOf(slug: string): string {
  return join(dataDir(), `${slug}.json`)
}

export function slugs(): string[] {
  seedIfEmpty()
  return readdirSync(dataDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter(isSlug)
    .sort()
}

export function exists(slug: string): boolean {
  return isSlug(slug) && existsSync(pathOf(slug))
}

/**
 * One journey, or null.
 *
 * Null rather than a throw, and the callers all say something about it. A
 * journey that is not here is an ordinary answer to an ordinary question — the
 * page asks for whichever journey a roadmap says is open, and a roadmap that
 * holds a journey this app has never heard of is a situation with a sentence
 * rather than an exception.
 *
 * A file that will not parse throws, and is meant to: that is a file somebody
 * has to go and look at, and returning null for it would present a broken
 * journey as an absent one.
 */
export function readJourney(slug: string): Journey | null {
  if (!exists(slug)) return null
  return journeySchema.parse(JSON.parse(readFileSync(pathOf(slug), 'utf8')))
}

export function listJourneys(): Journey[] {
  return slugs()
    .map((s) => readJourney(s))
    .filter((j): j is Journey => Boolean(j))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function writeJourney(journey: Journey): Journey {
  const parsed = journeySchema.parse(journey)
  writeFileSync(pathOf(parsed.slug), `${JSON.stringify(parsed, null, 2)}\n`)
  return parsed
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
