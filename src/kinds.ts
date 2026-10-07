import type { TrackerMissing, TrackerRow, TrackerSource } from 'kehikot-module-protocol'

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
   * The id of the part this step was assigned to, when it says one. Read with
   * the protocol's `stepPart`, never compared raw: anything that is not an id
   * is no assignment. Set from this page through `/api/assign`, never by
   * the step editor, which leaves it as it is.
   */
  part?: string
}

/**
 * A heading and the references under it, which a host reads as a PART of the
 * epic. `id` is there when somebody has written one; the id a group answers
 * to is otherwise derived, and is asked of the protocol's `partsOf` rather
 * than read off this.
 */
export interface Group {
  heading: string
  refs: string[]
  id?: string
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
  /** The journey's parts, as stored. Absent from a server older than parts. */
  groups?: Group[]
  stepsFrom?: StepsFrom
  blockedBy: Record<string, string[]>
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
