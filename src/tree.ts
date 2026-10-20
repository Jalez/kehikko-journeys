import { stepPart } from 'kehikot-module-protocol'

import { isTracked } from './refs.ts'

/**
 * A journey as a tree of steps: the shape `/journey` designs and the order work is taken in.
 *
 * Pure, and shared by the page and the server, so the rule for "what comes next" is said once.
 *
 * Three fields on a step say it, each one optional, and a journey with none of them is the list it
 * always was (every step a leaf under the goal, nothing before anything):
 *
 *  - `under` — the id of the step this one is a prerequisite OF: an intermediate objective that is
 *    not true until every step under it is. Absent: directly under the journey's goal.
 *  - `after` — the ids of steps that have to be done before this one can start ("can't do X before
 *    Y"). An `after` on an objective holds every step under it too.
 *  - `issue` — the tracker issue that delivers this step, also in its `refs`. Absent: the first
 *    tracked ref, if any.
 *
 * A step's id is the id of its part (`stepPart`). Prerequisites must form a DAG: a step cannot be,
 * directly or through others, a prerequisite of itself. `cycleIn` finds one; the writers refuse it.
 */

export interface TreeStep {
  title: string
  refs?: readonly string[]
  part?: string
  under?: unknown
  after?: unknown
  issue?: unknown
}

export interface TreeNode {
  /** The step's id (its part's), or `#<position>` for a step in no part. */
  id: string
  /** 1-based position in the journey. */
  position: number
  title: string
  /** The objective this is a prerequisite of, or null for the goal. Only an id some step has. */
  under: string | null
  /** Steps that must be done first, as written (ids some step has). */
  after: string[]
  /** Steps under this one. */
  children: string[]
  /** A step nothing is under: one piece of work. */
  leaf: boolean
  /** The tracker issue that delivers it, or null. */
  issue: string | null
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one.length > 0) : []

/** The step's id: its part's, or `#<position>` where it has none. */
export function nodeId(step: TreeStep, position: number): string {
  return stepPart(step) ?? `#${position}`
}

/** The issue a step is delivered by: `issue`, or its first tracked ref. */
export function issueOf(step: TreeStep): string | null {
  if (typeof step.issue === 'string' && step.issue) return step.issue
  return (step.refs ?? []).find((ref) => isTracked(ref)) ?? null
}

/** Every step as a node of the tree, in the journey's order. Unknown ids in `under`/`after` are dropped. */
export function treeOf(steps: readonly TreeStep[]): TreeNode[] {
  const nodes = steps.map((step, i) => ({ step, id: nodeId(step, i + 1), position: i + 1 }))
  const known = new Set(nodes.map((one) => one.id))
  const out: TreeNode[] = nodes.map(({ step, id, position }) => {
    const under = typeof step.under === 'string' && step.under !== id && known.has(step.under) ? step.under : null
    return {
      id,
      position,
      title: step.title,
      under,
      after: [...new Set(ids(step.after).filter((one) => one !== id && known.has(one)))],
      children: [],
      leaf: true,
      issue: issueOf(step),
    }
  })
  const byId = new Map(out.map((one) => [one.id, one]))
  for (const node of out) {
    if (node.under) {
      const parent = byId.get(node.under)!
      parent.children.push(node.id)
      parent.leaf = false
    }
  }
  return out
}

/** What has to be done before a node is: the steps under it and the steps it is after. */
function prerequisites(node: TreeNode): string[] {
  return [...node.children, ...node.after]
}

/**
 * A cycle among the prerequisites, as the titles around it, or null. Found over `under` and `after`
 * together: an objective is not done before its steps, so a step after its own objective is one.
 */
export function cycleIn(steps: readonly TreeStep[]): string[] | null {
  const nodes = treeOf(steps)
  const byId = new Map(nodes.map((one) => [one.id, one]))
  const state = new Map<string, 'open' | 'done'>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null
    if (state.get(id) === 'open') {
      const from = path.indexOf(id)
      return [...path.slice(from), id].map((one) => byId.get(one)?.title ?? one)
    }
    state.set(id, 'open')
    path.push(id)
    for (const next of prerequisites(byId.get(id)!)) {
      const found = visit(next)
      if (found) return found
    }
    path.pop()
    state.set(id, 'done')
    return null
  }
  for (const node of nodes) {
    const found = visit(node.id)
    if (found) return found
  }
  return null
}

/** `cycleIn` as the sentence a writer refuses with, or null. */
export function cycleSaid(steps: readonly TreeStep[]): string | null {
  const cycle = cycleIn(steps)
  if (!cycle) return null
  return (
    `That would make a step its own prerequisite: ${cycle.map((one) => `“${one}”`).join(' → ')}. `
    + 'Prerequisites go one way, so nothing was written.'
  )
}

/**
 * Whether each node is done, given whether a step's own issue is done. A leaf is done when its issue
 * is. An objective is done when every step under it is (and its own issue, if it has one).
 */
export function doneOf(steps: readonly TreeStep[], issueDone: (issue: string) => boolean): Map<string, boolean> {
  const nodes = treeOf(steps)
  const byId = new Map(nodes.map((one) => [one.id, one]))
  const done = new Map<string, boolean>()
  const seen = new Set<string>()
  const of = (id: string): boolean => {
    if (done.has(id)) return done.get(id)!
    if (seen.has(id)) return false
    seen.add(id)
    const node = byId.get(id)!
    const own = node.issue ? issueDone(node.issue) : null
    const value = node.leaf ? own === true : node.children.every(of) && own !== false
    done.set(id, value)
    return value
  }
  for (const node of nodes) of(node.id)
  return done
}

export interface Next {
  /** The step to take next, or null. */
  node: TreeNode | null
  /** Why there is none, when there is none. */
  why: string | null
  /** For the step chosen: the steps it waited on, all done. */
  waitedOn: string[]
}

/**
 * The next step: the first leaf, in the journey's order, that is not done and whose prerequisites
 * are — its own `after`, and the `after` of every objective it sits under. Refuses a journey whose
 * prerequisites go round in a circle rather than choosing from it.
 */
export function nextStep(steps: readonly TreeStep[], issueDone: (issue: string) => boolean): Next {
  if (!steps.length) return { node: null, why: 'This journey has no steps yet.', waitedOn: [] }
  const cycle = cycleSaid(steps)
  if (cycle) return { node: null, why: cycle, waitedOn: [] }
  const nodes = treeOf(steps)
  const byId = new Map(nodes.map((one) => [one.id, one]))
  const done = doneOf(steps, issueDone)
  const held = (node: TreeNode): string[] => {
    const out = [...node.after]
    for (let up = node.under; up; up = byId.get(up)?.under ?? null) out.push(...(byId.get(up)?.after ?? []))
    return out
  }
  const open = nodes.filter((node) => node.leaf && !done.get(node.id))
  if (!open.length) return { node: null, why: 'Every step of this journey is done.', waitedOn: [] }
  for (const node of open) {
    const waits = held(node)
    if (waits.every((id) => done.get(id))) return { node, why: null, waitedOn: waits }
  }
  return { node: null, why: 'Every step not yet done waits on another that is not done either.', waitedOn: [] }
}
