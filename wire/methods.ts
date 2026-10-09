import { METHOD_NAMES } from 'kehikot-module-protocol'

/**
 * The questions this app asks, resolved out of the package rather than
 * written down here.
 *
 * ## Why this is not a string literal
 *
 * A method name is a spelling two programs must agree on exactly — the protocol
 * package says so itself, and it is why `METHODS` exists there at all.
 *
 * This file exists because the package's vocabulary moved under this app. It
 * named the list method `journeys.list` and its context carried a journey slug,
 * both leftovers from a codebase where epics and journeys were one idea; the
 * rename to `epics.list`, `epic.get` and a context field called `epic` is what
 * took `PROTOCOL` to 2. This module was written against 1 and declared
 * `'>=1 <2'`, which meant a host speaking 2 framed it and, correctly, called it
 * incompatible.
 *
 * So the name is RESOLVED rather than asserted: the question has the spellings
 * that would mean it, in order of preference, and the first one the installed
 * package actually exports wins. If none is there this throws at import —
 * loudly, at startup, naming what it looked for — because the alternative is an
 * app that runs, asks a method no host knows, and shows a refusal that blames
 * the host for this app's stale vocabulary.
 *
 * ## What is deliberately absent, and the one thing that no longer is
 *
 * There is no `LIST_EPICS` and no `LIST_STEPS` here, and that is the whole
 * claim of this module rather than an oversight: this app holds its own
 * journeys and reads them off its own store over `/api`. Asking a host which
 * epics exist, or what an epic's steps are, would put a second answer to that
 * question on the same screen.
 *
 * `GET_EPIC` used to be on that list. It is below now, and it is asked at
 * exactly one moment: when a person begins a journey for an epic this app has
 * no record of. See its own note, and the manifest for the long version.
 */

/**
 * Pick the first spelling the package knows.
 *
 * `METHOD_NAMES` is an array, so this is a membership test over a list rather
 * than a keyed lookup on an object — no prototype to fall through, which is the
 * hazard the package's `ids.ts` is about and which it says applies to method
 * names specifically.
 */
function resolve(candidates: readonly string[]): string | null {
  const known: readonly string[] = METHOD_NAMES
  for (const candidate of candidates) {
    if (known.includes(candidate)) return candidate
  }
  return null
}

function required(what: string, candidates: readonly string[]): string {
  const found = resolve(candidates)
  if (found) return found
  throw new Error(
    `kehikot-module-protocol names no method for ${what}. Looked for ${candidates.join(', ')}; ` +
      `it exports ${METHOD_NAMES.join(', ')}. Journeys cannot ask a question the protocol does not name.`,
  )
}

/**
 * What the host holds for one epic, asked ONCE, to begin a journey from.
 *
 * Not a read this page draws from, and never asked to show anything. A host
 * answers an epic's steps out of this app's record, and out of its own file
 * only where there is no record — so the first record has to be what the host
 * held, or making it hides every step the host had. This is the page asking
 * for that, from a press, so that the handover changes whose the steps are
 * and nothing about what they say. `createJourney` in `store.ts` has the rest.
 */
export const GET_EPIC = required('asking a host what it holds for an epic', ['epic.get'])

/**
 * What the trackers last said about the refs this journey names, from the
 * reading the host keeps for every module.
 *
 * The one thing this app reads from anybody. It is enrichment: every reference
 * on the page is drawn whether or not this is answered, and where it is not
 * answered a reference is marked unseen rather than guessed at. It replaced
 * `live.get`, which answered for Kehikot's epic in four bags and could
 * only be as fresh as whatever last wrote the file behind it.
 */
export const GET_TRACKER = required('reading what the trackers last reported', ['tracker.get'])

/**
 * Ask the host to read the trackers again for this journey's refs.
 *
 * Sent from the host's own refresh control — which this page asks for with
 * `kehikot.refreshable` — and from nothing else. It spends the person's rate
 * limit, so it is never sent because a page loaded or a context arrived.
 */
export const REFRESH_TRACKER = required('reading the trackers again', ['tracker.refresh'])

/**
 * Say that a journey this app keeps has changed, so that every container
 * showing it reads it again.
 *
 * Not a question and not a read: nothing is handed over, and the journeys stay
 * this app's own. Sent after a step saved on this page has been kept, and from
 * nothing else — never from a read, which is what answers it.
 */
export const REPORT_CHANGE = required('saying this app’s own material changed', ['content.changed'])

/**
 * The reference a host walks this app to when it means "the place where this
 * epic is divided into parts".
 *
 * ## Why a reference, and why this one
 *
 * A host draws the parts of an epic in its own bar, and for an epic with none
 * it can only say where they are made: here. It gets a person here the way it
 * gets them anywhere inside a module — `kehikot.goto`, which names a
 * reference for the module to find on its own page and is answered
 * `kehikot.went`, found or not. This is that walk with a reference no tracker
 * could have issued: a tracker's are `gh#41`, `#2274`, `!1801`, and a colon
 * is in none of them.
 *
 * It was chosen over the two other ways a host can point at this page. The
 * fragment (`/app#epic=x`) says nothing back and, set from outside the
 * frame, may reload a document somebody is typing into. A field in
 * `kehikot.context` would be state — re-sent with every context, on every
 * reload — where this is a press that happens once. A walk is answered, and
 * a host can tell a Journeys that opened its parts from one too old to know
 * the word: that one looks for a card called `journeys:parts`, finds none,
 * and says so.
 *
 * ## It belongs in the protocol
 *
 * The host spells this string too, in its own source, and two spellings of
 * one word across two repositories are how they come to differ. It is a
 * constant for `kehikot-module-protocol` beside `JOURNEYS_MODULE`. It is here
 * because the change that needed it was three repositories wide without the
 * protocol being one of them.
 */
export const PARTS_REF = 'journeys:parts'
