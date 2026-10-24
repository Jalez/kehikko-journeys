import { treeOf, type TreeStep } from './tree.ts'

/**
 * A journey's phases: labelled sections of its roadmap, left to right ("Concepting", "Creating UI
 * elements", "Finishing up"). The journey lists them in `phases`; a step names one by id in `phase`.
 *
 * A step with no `phase` of its own is in the phase of the nearest step above it (its objective,
 * then that one's) that has one. The record keeps only what was written, so every reader applies
 * that rule itself.
 */

export interface Phase {
  id: string
  title: string
  [key: string]: unknown
}

export interface PhasedStep extends TreeStep {
  phase?: unknown
}

export function phasesOf(journey: { phases?: unknown }): Phase[] {
  if (!Array.isArray(journey.phases)) return []
  return journey.phases.filter(
    (one): one is Phase => !!one && typeof one === 'object' && typeof one.id === 'string' && !!one.id && typeof one.title === 'string',
  )
}

const own = (step: PhasedStep): string | null => (typeof step.phase === 'string' && step.phase ? step.phase : null)

/** Each step's phase as it is read: its own, or inherited from above. `inherited` is true for the second. */
export function phaseOfEach(steps: readonly PhasedStep[]): { phase: string | null; inherited: boolean }[] {
  const nodes = treeOf(steps)
  const byId = new Map(nodes.map((node, i) => [node.id, { node, step: steps[i]! }]))
  return nodes.map((node, i) => {
    const mine = own(steps[i]!)
    if (mine) return { phase: mine, inherited: false }
    const seen = new Set([node.id])
    for (let up = node.under; up && !seen.has(up); up = byId.get(up)?.node.under ?? null) {
      seen.add(up)
      const found = byId.get(up)
      const theirs = found ? own(found.step) : null
      if (theirs) return { phase: theirs, inherited: true }
    }
    return { phase: null, inherited: false }
  })
}
