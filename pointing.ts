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
 * restart. The page listens on one server-sent-event stream per open journey
 * (`GET /api/pointing/events`): it is told the current pointer when it
 * connects and each change after, so nothing asks again and again. A stream
 * connected is a page open, which is what the tool tells an agent, instead of
 * letting it point at a screen nobody has.
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

/** The name of the one event on the stream; its data is `{ pointing }`, the pointer or null. */
export const EVENT = 'pointing'

type Emit = (event: { pointing: Pointing | null }, name?: string) => void

const held = new Map<string, Pointing>()
const streams = new Map<string, Set<Emit>>()
let last = 0

/** The one key a pointer, and the streams on it, are kept under. */
export const pointerKey = (project: string, slug: string): string => `${project}\u0000${slug}`

/** Point at a step, or with null stop pointing. Every stream on the epic is told. */
export function point(key: string, pointing: Omit<Pointing, 'at'> | null): Pointing | null {
  let next: Pointing | null = null
  if (pointing) {
    /* Strictly later than the last one, so two calls in one millisecond are still two. */
    last = Math.max(Date.now(), last + 1)
    next = { ...pointing, at: new Date(last).toISOString() }
    held.set(key, next)
  } else {
    held.delete(key)
  }
  for (const emit of streams.get(key) ?? []) emit({ pointing: next }, EVENT)
  return next
}

/**
 * A page listening: it is told the pointer as it stands at once, and each change after. Returns what
 * to call when the stream closes, which is the page no longer being open.
 */
export function listen(key: string, emit: Emit): () => void {
  const set = streams.get(key) ?? new Set<Emit>()
  streams.set(key, set)
  set.add(emit)
  emit({ pointing: held.get(key) ?? null }, EVENT)
  return () => {
    set.delete(emit)
    if (set.size === 0 && streams.get(key) === set) streams.delete(key)
  }
}

/** How many streams are connected for one epic. */
export const listening = (key: string): number => streams.get(key)?.size ?? 0

/** Whether a stream is connected, which is whether somebody can be seeing the pointer. */
export const watched = (key: string): boolean => listening(key) > 0
