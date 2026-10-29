import { attach, publish, watching } from 'kehikot-module-protocol/serve'

import { EVENT, type Pointing } from './wire/pointing.ts'

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
 *
 * The streams on one epic are a topic of the protocol's (`attach`, `publish`,
 * `watching`, 2.32.0): the fan-out is the protocol's, the wire is this file's
 * — the pointer as it stands goes first, as a `pointing` event like every
 * change after, so the page hears one kind of event.
 */

export { EVENT, SAY_MAX, type Pointing } from './wire/pointing.ts'

type Emit = (event: { pointing: Pointing | null }, name?: string) => void

const held = new Map<string, Pointing>()
let last = 0

/** The one key a pointer, and the streams on it, are kept under. */
export const pointerKey = (project: string, slug: string): string => `${project}\u0000${slug}`

/** The protocol topic the streams on one epic follow. */
const topicOf = (key: string): string => `pointing:${key}`

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
  publish(topicOf(key), { pointing: next }, EVENT)
  return next
}

/**
 * A page listening: it is told the pointer as it stands at once, and each change after. Returns what
 * to call when the stream closes, which is the page no longer being open. Past the protocol's
 * `MAX_EVENT_STREAMS` the page is told the pointer once and hears no change.
 */
export function listen(key: string, emit: Emit): () => void {
  emit({ pointing: held.get(key) ?? null }, EVENT)
  const on = attach(topicOf(key), emit as (data: unknown, name?: string) => void)
  return () => on?.close()
}

/** How many streams are connected for one epic. */
export const listening = (key: string): number => watching(topicOf(key))

/** Whether a stream is connected, which is whether somebody can be seeing the pointer. */
export const watched = (key: string): boolean => listening(key) > 0
