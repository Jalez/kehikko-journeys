/**
 * The shapes this app's own server answers with.
 *
 * Written down here rather than imported from `store.ts`, which reads
 * directories and cannot be loaded into a browser. They are deliberately loose
 * about everything the page does not draw: `quizzes`, `vocabulary`, `owners`
 * and `groups` are other apps' material, carried through the store untouched,
 * and a type here that enumerated them would be this file claiming an opinion
 * about documents it never renders.
 */

export interface Step {
  title: string
  body: string
  refs: string[]
  notes: string[]
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
  stepsFrom?: StepsFrom
  blockedBy: Record<string, string[]>
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

/** What the host's last refresh recorded about one reference. */
export interface Sighting {
  title?: string
  state?: string
  draft?: boolean
  url?: string
  at?: string
  labels?: string[]
  assignees?: string[]
  reviewers?: string[]
  author?: string
}

/**
 * The host's whole reading for one epic, filed the way the host files it.
 *
 * Every bag is optional because every bag is somebody else's document: this is
 * whatever `live.get` returned, and a host is entitled to answer with less than
 * this app knows how to draw.
 */
export interface Live {
  issues?: Record<string, Sighting>
  mrs?: Record<string, Sighting>
  ghIssues?: Record<string, Sighting>
  ghPrs?: Record<string, Sighting>
  links?: Record<string, number[]>
  ghLinks?: Record<string, number[]>
  palette?: Record<string, { bg: string; fg: string }>
}

/** Somewhere to go: a reference, a step, or a journey to switch to first. */
export interface Target {
  ref?: string
  step?: number
  slug?: string
}
