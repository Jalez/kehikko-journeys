import { anchorInFocus, narrowToFocus, pickedParts, stepPart, type Anchor, type EpicPart } from 'kehikot-module-protocol'

import type { Step } from './kinds.ts'

/**
 * Which of a journey's steps are in front of the person, when the host has
 * been pointed at some of the epic's parts.
 *
 * ## What the host says, and what this page does about it
 *
 * `context.parts` is every part of the open epic, each with `picked`. None
 * picked is the whole epic, and that is the resting state: this file then
 * answers with every step and says nothing, and the page is exactly the page
 * it was before it read the field.
 *
 * With some picked, a step is shown when the part it SAYS it is in is one of
 * them — its anchor is `{ part: stepPart(step) }`, and the protocol's one rule
 * (`anchorInFocus`, `narrowToFocus`) decides, not a rule of this app's own. A step is in a part because it carries
 * `part: <id>` and for no other reason. It is never filed by the references it
 * names: a step often names a reference it merely depends on, and a rule that
 * filed it under that reference's heading would move steps between parts
 * whenever somebody edited a sentence.
 *
 * ## A step with no part is outside every focus. That is decided.
 *
 * It belongs to the epic as a whole, so it is in no PICKED part: under a focus
 * it is not drawn. Nor is a step naming a part the epic no
 * longer has. The other rule — show the unassigned ones anyway, since nobody
 * said they were elsewhere — was considered and refused: a journey where no
 * step has been assigned yet would then look the same narrowed and not, and
 * the person who picked a part would be shown everything and told they were
 * looking at one part of it.
 *
 * The cost is real: in a journey whose steps have not been assigned, picking
 * a part shows none of them. What explains that lives where it can be acted
 * on — the fold of the parts box (`view/parts.tsx`) says how many steps are
 * in no part, whatever is picked, and opens onto where they are filed.
 *
 * ## Nothing here overrides the focus, and nothing announces it
 *
 * There is no "show the rest" on this page and there must not be one. The
 * focus is the person's, held by the host for the whole canvas; a module that
 * widened it locally would be one pane disagreeing with every pane beside it
 * about what is in front of the person, with nothing on the canvas to say so.
 *
 * The page used to draw a bordered paragraph above the steps whenever a part
 * was picked — `Narrowed to Methods. 3 of 38 steps shown · 35 outside the
 * picked part…`, where the picking is done, and that an edited step was being
 * held. It took several rows of a container that has few, the host's bar
 * already shows the pick, and the steps drawn are the message. So nothing is
 * said while there is a step to draw. A page the pick left with NO step says
 * one sentence where the steps would be (`saidOfNone`), because an empty
 * journey with no reason reads as broken.
 *
 * ## The index is the step's own, not its place among the shown
 *
 * A step is numbered, edited, saved and walked to by its position in the
 * journey. Narrowing must not renumber: "step 7" in a host's `kehikot.goto`,
 * in the editor's save and in somebody's sentence is the seventh step of the
 * journey whichever parts are picked. So what comes back carries the index.
 */
export interface Shown {
  step: Step
  /** Zero-based position in the journey, not among the steps shown. */
  index: number
}

/** What ties a step to a part: the part it says it is in, and nothing else. */
const anchorOf = (step: Step): Anchor => ({ part: stepPart(step) })

/** Whether one step is in front of the person. True for every step when nothing is picked. */
export function stepInFocus(parts: readonly EpicPart[], step: Step): boolean {
  return anchorInFocus(parts, anchorOf(step))
}

/**
 * The steps to draw, in the journey's order, each with its own position.
 *
 * `editing` is the position of the step whose editor is open, or -1. That one
 * is drawn though it is outside: a tick in another control does not take a
 * half-written step out of somebody's hands.
 */
export function shownSteps(parts: readonly EpicPart[], steps: readonly Step[], editing = -1): Shown[] {
  const each = steps.map((step, index) => ({ step, index }))
  return narrowToFocus(parts, each, ({ step }) => anchorOf(step), { keep: ({ index }) => index === editing }).shown
}

/** The one sentence for a journey the picked parts left no step of, drawn where the steps would have been. */
export function saidOfNone(parts: readonly EpicPart[]): string {
  return `No step is in the picked ${pickedParts(parts).length === 1 ? 'part' : 'parts'}.`
}
