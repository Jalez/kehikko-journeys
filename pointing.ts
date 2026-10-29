/**
 * Which step an agent is on, for the Journeys page to show.
 *
 * An agent talking a person through a journey has words and no hands.
 * `focus_step` gives it a pointer: the page brings that step's card into view
 * and lights it, with the agent's one line beside it, so the words and the page
 * are on the same step.
 *
 * Held in memory, per project and epic: a pointer is about a conversation
 * happening now, is never written to the project and does not survive a
 * restart. The page asks every second or so (`GET /api/pointing`), and when it
 * last asked is kept, so the tool can tell an agent that no Journeys page is
 * open instead of letting it point at a screen nobody has. Same shape as the
 * Flows module's pointer.
 */

export interface Pointing {
  /** The step's 1-based position in the journey, as the page numbers its cards. */
  step: number
  /** The step's title, so the page can say what it is pointed at without reading the journey again. */
  title: string
  /** One line of the agent's, plain text, shown beside the card; '' for none. */
  say: string
  /** When it was pointed, which is also what tells the page a pointer is new. */
  at: string
}

export const SAY_MAX = 300

/** How recently a page must have asked for it to count as open. */
export const WATCHING_MS = 6_000

const held = new Map<string, Pointing>()
const asked = new Map<string, number>()
let last = 0

/** The one key a pointer, and a page's asking, are kept under. */
export const pointerKey = (project: string, slug: string): string => `${project}\u0000${slug}`

/** Point at a step, or with null stop pointing. */
export function point(key: string, pointing: Omit<Pointing, 'at'> | null): Pointing | null {
  if (!pointing) {
    held.delete(key)
    return null
  }
  /* Strictly later than the last one, so two calls in one millisecond are still two. */
  last = Math.max(Date.now(), last + 1)
  const next = { ...pointing, at: new Date(last).toISOString() }
  held.set(key, next)
  return next
}

/** The pointer for one epic, as the page asks for it. Asking is what marks a page as open. */
export function pointingFor(key: string): Pointing | null {
  asked.set(key, Date.now())
  return held.get(key) ?? null
}

/** Whether a page has asked lately, which is whether somebody can be seeing the pointer. */
export function watched(key: string): boolean {
  const at = asked.get(key)
  return at !== undefined && Date.now() - at <= WATCHING_MS
}
