import type { TrackerMissing, TrackerRow, TrackerSource } from 'kehikot-module-protocol'

import type { Gate, RefRole } from './gates.ts'
import type { Also } from './shared.ts'

/**
 * The shapes this app's own server answers with.
 *
 * Written down here rather than imported from `store.ts`, which reads
 * directories and cannot be loaded into a browser. They are deliberately loose
 * about everything the page does not draw: `quizzes`, `vocabulary` and `owners`
 * are other apps' material, carried through the store untouched,
 * and a type here that enumerated them would be this file claiming an opinion
 * about documents it never renders.
 */

export interface Step {
  title: string
  body: string
  refs: string[]
  notes: string[]
  /**
   * The id of the part of the epic this step is the step of. Every step has
   * one once the store has read it; read with the protocol's `stepPart`.
   */
  part?: string
  /** The objective (another step's id) this step is a prerequisite of. See `tree.ts`. */
  under?: string
  /** Ids of steps that must be done before this one. */
  after?: string[]
  /** The issue that delivers this step. */
  issue?: string
  /** Ids of the journey's gates that hold this step. See `gates.ts`. */
  blockedBy?: string[]
  /** What a ref is to this step, where it does not deliver it: prior art, or related. */
  roles?: Record<string, Exclude<RefRole, 'delivers'>>
}

/**
 * One part of the epic, as a host reads it out of the record: `id` is what
 * its step's `part` names, `heading` what the part is called, `files` the one
 * document it covers. One to a step, in the steps' order.
 */
export interface Group {
  heading: string
  refs: string[]
  id?: string
  /** The files of the epic's paper this part owns, relative to the paper's folder. Absent means none. */
  files?: string[]
}

export interface StepsFrom {
  projector: string
  where: string
  why: string
}

/** One journey, as `/api/journey` hands it over: the document plus `plan`. */
export interface JourneyView {
  slug: string
  title: string
  lede: string
  umbrella?: string
  written?: string
  project?: string
  repo?: string
  callout: string
  steps: Step[]
  /** The epic's parts, one to a step. Absent from a server older than parts. */
  groups?: Group[]
  /** The record on disk is still in the older shape of parts; what is here is how it reads. */
  unsettled?: boolean
  /**
   * The epic's list of parts where the HOST keeps it — ids and names, in the
   * epic's order, as the epic's own file has them — or null/absent where this
   * app keeps the list in `groups`. See `keeper.ts`. With a list, `groups` is
   * not sent.
   */
  listed?: { id: string; name: string }[] | null
  stepsFrom?: StepsFrom
  blockedBy: Record<string, string[]>
  /** What stands in the way that is not a step: see `gates.ts`. Absent on a journey with none. */
  gates?: Gate[]
  /** Refs this journey shares with the project's other journeys, by ref: read-only, and absent when none is shared. See `shared.ts`. */
  alsoIn?: Record<string, Also[]>
  /** Decision issues no commit will close, answered by these changes instead. Read as `done` once they merge. */
  settledBy?: Record<string, string[]>
  plan: 'stored' | 'elsewhere' | 'none'
}

/** One row of `/api/journeys`: enough for a picker and nothing more. */
export interface Brief {
  slug: string
  title: string
  tab: string | null
  plan: 'stored' | 'elsewhere' | 'none'
  steps: number
}

/**
 * The host's shared tracker reading, as this page holds it.
 *
 * What `tracker.get` answered for the refs this journey names, kept by the
 * spelling each ref was asked for — a row answers for its own `ref`, so a
 * card looks its own string up and finds its own string. One reading for
 * GitHub and GitLab alike, read once by the host for every module, with its
 * own freshness: `at` is when the reading last changed, and each row carries
 * the `readAt` of its own read.
 *
 * A row is the protocol's `TrackerRow`, untranslated. It is assignable to the
 * facets' `Sighting` on purpose, so the filter, the disposition and the rail
 * read the same fields every other module reads.
 *
 * `missing` is why a ref asked for has no row — `pending` while the host reads
 * it, `not-found`, `no-tracker`, `failed` — and is what lets a card say which
 * absence it is looking at instead of one word for four.
 */
export interface Live {
  at: string | null
  rows: ReadonlyMap<string, TrackerRow>
  missing: ReadonlyMap<string, TrackerMissing['reason']>
  sources: readonly TrackerSource[]
}

/** Somewhere to go: a reference, a step, or a journey to switch to first. */
export interface Target {
  ref?: string
  step?: number
  slug?: string
}

/** The Factory's newest job for one issue, as `/api/factory` hands it over (see `factory.ts`). */
export interface FactoryJob {
  id: string
  ref: string
  stage: string
  title?: string
  column?: string
  updatedAt?: string
}
