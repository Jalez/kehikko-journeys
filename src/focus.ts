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
 * it is not drawn, and it is counted. So is a step naming a part the epic no
 * longer has. The other rule — show the unassigned ones anyway, since nobody
 * said they were elsewhere — was considered and refused: a journey where no
 * step has been assigned yet would then look the same narrowed and not, and
 * the person who picked a part would be shown everything and told they were
 * looking at one part of it.
 *
 * The cost is real and is said on screen rather than softened: in a journey
 * whose steps have not been assigned, picking a part shows none of them. The
 * sentence `Narrowed` draws says how many are outside and how many of those
 * are in no part at all, which is the number that explains an empty page.
 *
 * What it owes for that is a way out, and it has one now: the sentence says
 * where steps are filed under parts (`view/parts.tsx`), because an unfiled
 * step is the usual reason a focused page is empty and the person looking at
 * it is the one who can say where each step belongs.
 *
 * ## Nothing here overrides the focus
 *
 * There is no "show the rest" on this page and there must not be one. The
 * focus is the person's, held by the host for the whole canvas; a module that
 * widened it locally would be one pane disagreeing with every pane beside it
 * about what is in front of the person, with nothing on the canvas to say so.
 * What this page owes instead is the count, and where the picking is done.
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
 * half-written step out of somebody's hands. It is still counted outside.
 */
export function shownSteps(parts: readonly EpicPart[], steps: readonly Step[], editing = -1): Shown[] {
  const each = steps.map((step, index) => ({ step, index }))
  return narrowToFocus(parts, each, ({ step }) => anchorOf(step), { keep: ({ index }) => index === editing }).shown
}

export interface Narrowing {
  /** The headings of the picked parts, in the epic's order. */
  picked: string[]
  shown: number
  /** Steps that are not in a picked part: in another part, or in none. */
  outside: number
  /** How many of `outside` say no part at all, or name one the epic does not have. */
  unassigned: number
  /** Whether the step being edited is one of `outside`, and drawn anyway. */
  held: boolean
}

/**
 * What the page says about the focus, as data; null when nothing is picked,
 * which is the cue to say nothing at all.
 *
 * The count is the protocol's (`narrowToFocus`), so that no two modules count
 * two ways. `unassigned` is this app's own addition to the sentence, because it is
 * the half of `outside` a person can do something about.
 */
export function narrowing(parts: readonly EpicPart[], steps: readonly Step[], editing = -1): Narrowing | null {
  const picked = pickedParts(parts)
  if (picked.length === 0) return null
  const { shown, outside, kept } = narrowToFocus(parts, steps, anchorOf, { keep: (step) => steps[editing] === step })
  const has = new Set(parts.map((part) => part.id))
  const unassigned = steps.filter((step) => {
    const part = stepPart(step)
    return part === null || !has.has(part)
  }).length
  return { picked: picked.map((part) => part.heading || part.id), shown: shown.length - kept, outside, unassigned, held: kept > 0 }
}

/** `narrowing`, in the words the page prints. */
export function narrowedSaid(said: Narrowing): { lead: string; rest: string; file: string | null } {
  const names = said.picked.join(', ')
  const lead = `Narrowed to ${said.picked.length === 1 ? names : `${said.picked.length} parts: ${names}`}.`
  const total = said.shown + said.outside
  const count =
    said.outside === 0
      ? `All ${total} ${total === 1 ? 'step is' : 'steps are'} in ${said.picked.length === 1 ? 'it' : 'them'}.`
      : `${said.shown} of ${total} ${total === 1 ? 'step' : 'steps'} shown · ${said.outside} outside the picked ` +
        `${said.picked.length === 1 ? 'part' : 'parts'}` +
        (said.unassigned > 0
          ? `, ${said.unassigned === said.outside ? (said.outside === 1 ? 'which is' : 'all of them') : `${said.unassigned} of them`} in no part at all`
          : '') +
        ', and not shown.'
  return {
    lead,
    rest:
      `${count} The parts are picked in the host’s bar, beside the epic; clear them there to see every step.`
      + (said.held ? ' The step you are editing is outside, and stays until you close it.' : ''),
    /* Said only when there is something a person can do about it here. A step
       in ANOTHER part is where somebody put it; a step in none is waiting to
       be put somewhere, and is hidden under every focus until it is. */
    file:
      said.unassigned > 0
        ? `${said.unassigned === 1 ? 'The step in no part is' : `The ${said.unassigned} steps in no part are`} hidden `
          + 'under any focus until filed under a part.'
        : null,
  }
}
