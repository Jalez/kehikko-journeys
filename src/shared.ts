import { stepPart } from 'kehikot-module-protocol'

import { gatesOf } from './gates.ts'

/**
 * Refs shared between journeys: the same issue or change named in several epics of one project.
 *
 * Pure, and shared by the server (which reads the project's other journeys from its own folder),
 * both doors and the page. A ref is matched by its exact spelling, as everywhere on this page:
 * `gh#41` and `#41` are different issues in different trackers.
 *
 * A journey whose steps are kept somewhere this app cannot read (`plan: 'elsewhere'`) has no steps
 * here, so it names only the refs of its gates and blockers.
 */

/** Where another journey names a ref. */
export interface Also {
  /** The other epic's slug, which is the journey's. */
  epic: string
  /** The other journey's title, for a reader. */
  title: string
  /** What names it there: a step, a gate, or a blocker entry. */
  in: 'step' | 'gate' | 'blocker'
  /** For `step`: its position (1-based), id and title. */
  position?: number
  id?: string
  stepTitle?: string
  /** For `gate`: its id and title. */
  gate?: string
  gateTitle?: string
}

/** What this needs of a journey: its slug, title, steps, gates and blockers. */
export interface SharedJourney {
  slug: string
  title?: string
  plan?: string
  steps?: { title: string; refs?: readonly string[]; part?: string }[]
  gates?: unknown
  blockedBy?: Record<string, readonly string[]>
}

const trimmed = (ref: string) => ref.trim()

/** Every place `other` names `ref`, in the journey's order: its steps, then its gates, then its blocker entries. */
export function namedIn(other: SharedJourney, ref: string): Also[] {
  const out: Also[] = []
  const base = { epic: other.slug, title: other.title || other.slug }
  if (other.plan !== 'elsewhere') {
    ;(other.steps ?? []).forEach((step, i) => {
      if ((step.refs ?? []).some((one) => trimmed(one) === ref)) {
        out.push({ ...base, in: 'step', position: i + 1, id: stepPart(step) ?? `#${i + 1}`, stepTitle: step.title })
      }
    })
  }
  for (const gate of gatesOf(other)) {
    if ([gate.ref, ...(gate.waitsOn ?? [])].some((one) => one && trimmed(one) === ref)) {
      out.push({ ...base, in: 'gate', gate: gate.id, gateTitle: gate.title })
    }
  }
  if (!out.length) {
    for (const [key, values] of Object.entries(other.blockedBy ?? {})) {
      if (trimmed(key) === ref || values.some((one) => trimmed(one) === ref)) {
        out.push({ ...base, in: 'blocker' })
        break
      }
    }
  }
  return out
}

/**
 * For each ref `refs` lists, where the project's OTHER journeys name it. A ref no other journey
 * names is not a key. `journeys` may include the one being read; it is skipped by slug.
 */
export function sharedRefs(slug: string, refs: Iterable<string>, journeys: readonly SharedJourney[]): Record<string, Also[]> {
  const out: Record<string, Also[]> = {}
  const others = journeys.filter((one) => one.slug !== slug)
  for (const raw of refs) {
    const ref = trimmed(raw)
    if (!ref || Object.hasOwn(out, ref)) continue
    const found = others.flatMap((one) => namedIn(one, ref))
    if (found.length) out[ref] = found
  }
  return out
}

/** One place, said: "mcp-binaries (Host the binaries)". */
export function alsoSaid(also: Also): string {
  const where = also.in === 'step' ? also.stepTitle : also.in === 'gate' ? `gate “${also.gateTitle}”` : 'a blocker'
  return `${also.epic}${where ? ` (${where})` : ''}`
}
