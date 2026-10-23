import type { TrackerColumn } from 'kehikot-module-protocol'

import { gatesOf } from '../gates.ts'
import type { FactoryJob, JourneyView, Live } from '../kinds.ts'
import { nextStep, treeOf, type Next, type TreeNode } from '../tree.ts'
import { isSettled, stateOf, toneOf, type Around } from './lookup.ts'

/**
 * Where one step stands, in words: its issue's column on the project's board when the host's
 * reading has one (protocol 2.6.0, `column` on a tracker row), else open or closed as the tracker
 * says; and, when the Factory module has a job for that issue, the job's finer stage. Pure; the page
 * draws it as text beside a marker that is a shape, never a colour alone.
 */
export interface StepStatus {
  issue: string | null
  /** The board column, or null when the row names none. */
  column: TrackerColumn | null
  /** Open, closed, merged, draft, or "not seen": what the tracker said without a board. */
  state: string
  /** The Factory's stage for the issue, or null with no job. */
  stage: string | null
  /** Whether the step counts as done for what comes next. */
  done: boolean
}

const WORD = { open: 'open', closed: 'closed', merged: 'merged', draft: 'draft', unseen: 'not seen' } as const

/** Whether an issue is done for the order of work: closed or merged, or settled by a mark or a decision. */
export function issueDone(live: Live | null, issue: string, around: Around = {}): boolean {
  const tone = toneOf(stateOf(live, issue))
  return tone === 'closed' || tone === 'merged' || isSettled(live, [issue], around)
}

export function statusOf(
  live: Live | null,
  node: Pick<TreeNode, 'issue'>,
  factory: Readonly<Record<string, FactoryJob>> = {},
  around: Around = {},
): StepStatus {
  const issue = node.issue
  if (!issue) return { issue: null, column: null, state: 'no issue', stage: null, done: false }
  const row = stateOf(live, issue)
  const job = Object.hasOwn(factory, issue) ? factory[issue] : undefined
  return {
    issue,
    column: row?.column ?? null,
    state: WORD[toneOf(row)],
    stage: job?.stage ?? null,
    done: issueDone(live, issue, around),
  }
}

/** The next step of the open journey, by this reading: never one an open gate holds. */
export function nextOf(journey: JourneyView | null, live: Live | null, around: Around = {}): Next | null {
  if (!journey || journey.plan !== 'stored') return null
  return nextStep(journey.steps, (issue) => issueDone(live, issue, around), gatesOf(journey), journey.blockedBy)
}

/** One line for a status, as a screen reader and a tooltip say it. */
export function statusSaid(status: StepStatus): string {
  const where = status.column ? `${status.column.name} on ${status.column.board}` : status.state
  return status.issue ? `${status.issue}: ${where}${status.stage ? `; Factory: ${status.stage}` : ''}` : 'No issue yet'
}

export { treeOf }
