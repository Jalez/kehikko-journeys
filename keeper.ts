import { LIMITS, PART_ID } from 'kehikot-module-protocol'

/**
 * Who keeps the list of an epic's parts: the host, or this app for a host
 * that does not.
 *
 * ## The one place it is decided
 *
 * A part belongs to the epic, and from protocol 1.2.0 the host keeps the list
 * in the epic's own file (`parts: [{ id, name }]`) and is its only writer. A
 * host from before that reads the list out of this app's record instead — its
 * `groups`, one to a step — so this app still has to write it there for that
 * host, and must never write it there for the other: two lists of one thing
 * are two lists that will disagree.
 *
 * `keeperFrom` is the whole decision, and everything that writes a journey
 * asks it (through `keeperOf` in `store.ts`, which reads the file):
 *
 *  - **`host`** — the epic's own file has a `parts` key. That is the host's
 *    own test (`listedIn` over there): with the key, even an empty one, the
 *    host reads ONLY that file for the list and ignores this record's
 *    `groups`. So `groups` is neither written nor read here; whatever is in
 *    the record stays as it is. A step's `part` is an id out of `list`, made
 *    by the host, or the step is in no part.
 *  - **`journeys`** — there is no such key, or no such file. Every host then
 *    reads the list from this record: a released host always, a 1.2.0 host
 *    until the first edit of the list (which is when it adopts it into the
 *    epic's file). So `groups` is written exactly as it was before 1.2.0, one
 *    to a step, with an id this app makes.
 *
 * ## Why the file, and not what a host answered
 *
 * Because it is the fact the host itself goes by, and the only one both of
 * this app's doors can see. The MCP door has no host to ask. The page does —
 * it asks `parts.set` — but an answer is a moment and the file is the state:
 * a page that remembered "this host answered" would go on believing it after
 * the same project was opened by a host that does not. What the answer
 * decides is smaller, and is decided where it is asked (`askParts` in
 * `src/journeys.ts`): whether there is a part to file the step under.
 *
 * The two cannot disagree in a way that matters. A host that answers
 * `parts.set` with a change has written the key before it answers, so the
 * write that follows finds `host`. A host that does not know the method, or
 * declines it, has written nothing, so the write that follows finds what was
 * true before the question.
 */
export interface Listed {
  id: string
  name: string
}

export type Keeper = { by: 'host'; list: Listed[] } | { by: 'journeys' }

/** This app keeps the list. One value, so two answers of it are one. */
export const JOURNEYS_KEEP: Keeper = { by: 'journeys' }

/**
 * The decision, from the epic's own file as it parsed — or anything else for
 * "there is none". Pure.
 *
 * The list is read as the host reads it, entry by entry: one that is not
 * `{ id, name }` costs that entry, an id met twice is the first, a part with
 * no name is called by its id, and the list stops at `LIMITS.PARTS`.
 */
export function keeperFrom(epicFile: unknown): Keeper {
  if (!epicFile || typeof epicFile !== 'object' || Array.isArray(epicFile) || !Object.hasOwn(epicFile, 'parts')) {
    return JOURNEYS_KEEP
  }
  const raw = (epicFile as { parts?: unknown }).parts
  const list: Listed[] = []
  for (const one of Array.isArray(raw) ? raw : []) {
    if (list.length >= LIMITS.PARTS) break
    if (!one || typeof one !== 'object') continue
    const { id, name } = one as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || !PART_ID.test(id) || list.some((part) => part.id === id)) continue
    const called = typeof name === 'string' ? name.trim().slice(0, LIMITS.TITLE) : ''
    list.push({ id, name: called || id })
  }
  return { by: 'host', list }
}

/** Whether `id` is a part the host lists. Never true while this app keeps the list. */
export function listedBy(keeper: Keeper, id: string | null | undefined): boolean {
  return keeper.by === 'host' && typeof id === 'string' && keeper.list.some((part) => part.id === id)
}
