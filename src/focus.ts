import { anchorInFocus, narrowToFocus, type Anchor, type EpicPart } from 'kehikot-module-protocol'
import { stepPart } from './part.ts'

import type { Step } from './kinds.ts'

/**
 * Which of a journey's steps are in front of the person, when the host has
 * been pointed at some of the epic's parts.
 *
 * ## The one rule, and nothing of this app's own beside it
 *
 * `context.parts` is every part of the open epic, each with `picked`. None
 * picked is the whole epic and the resting state: every step is drawn and
 * nothing is said. With some picked, a step is drawn when the part it is the
 * step of is one of them. That is the protocol's rule and it is applied by
 * the protocol: the page narrows with `useFocus(context).narrow(steps,
 * anchorOf, { noun, keep })`, and this file is the three things that call
 * needs — what one item is (`Shown`), its anchor (`anchorOf`) and what it is
 * called (`NOUN`).
 *
 * A step's anchor is `{ part }`: the id in its own `part` field, and nothing
 * else — not the references it names. A step whose `part` is absent, or names
 * a part the epic no longer has (somebody removed it in the host's picker),
 * is in no part: it is drawn with nothing picked and hidden under a pick,
 * like any item of any module that belongs to the epic as a whole.
 *
 * ## What is said about the pick: one sentence, and only in an empty view
 *
 * `narrow(...).empty` — the protocol's `emptySaid(parts, 'step')`, `No step
 * is in the picked part.` — where the steps would have been, when the pick
 * left none of a journey that has some. While any step is drawn nothing about
 * the pick is drawn at all: the host's bar already says what is picked. There
 * is no "show the rest" here and there must not be one.
 *
 * ## The index is the step's own, not its place among the shown
 *
 * A step is numbered, edited, saved and walked to by its position in the
 * journey. Narrowing must not renumber: "step 7" in a host's `kehikot.goto`,
 * in the editor's save and in somebody's sentence is the seventh step of the
 * journey whichever parts are picked. So an item carries its index.
 */
export interface Shown {
  step: Step
  /** Zero-based position in the journey, not among the steps shown. */
  index: number
}

/** What one item is called in the protocol's sentence for an empty view. */
export const NOUN = 'step'

/** A journey's steps as the items that are narrowed: each with its own position. */
export const indexed = (steps: readonly Step[]): Shown[] => steps.map((step, index) => ({ step, index }))

/** What ties a step to a part: the part it says it is the step of, and nothing else. */
export const anchorOf = ({ step }: Shown): Anchor => ({ part: stepPart(step) })

/** Whether one step is in front of the person. True for every step when nothing is picked. */
export function stepInFocus(parts: readonly EpicPart[], step: Step): boolean {
  return anchorInFocus(parts, anchorOf({ step, index: 0 }))
}

/**
 * The steps in front of the person, for the half of this page that is not
 * React (`src/journeys.ts` counts the cards a filter may hide): the same
 * rule, `narrowToFocus`, with the same anchor and the same thing kept.
 *
 * `editing` is the position of the step whose editor is open, or -1. That one
 * is kept though it is outside: a tick in another control does not take a
 * half-written step out of somebody's hands.
 */
export function shownSteps(parts: readonly EpicPart[], steps: readonly Step[], editing = -1): Shown[] {
  return narrowToFocus(parts, indexed(steps), anchorOf, { keep: ({ index }) => index === editing }).shown
}
