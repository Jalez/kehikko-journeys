import { METHOD_NAMES } from 'roadmap-module-protocol'

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
 * ## What is deliberately absent
 *
 * There is no `LIST_EPICS` and no `GET_EPIC` here, and that is the whole claim
 * of this module rather than an oversight: this app holds its own journeys and
 * reads them off its own store over `/api`. Asking a host which epics exist
 * would put a second answer to that question on the same screen. See the
 * manifest for the long version.
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
    `roadmap-module-protocol names no method for ${what}. Looked for ${candidates.join(', ')}; ` +
      `it exports ${METHOD_NAMES.join(', ')}. Journeys cannot ask a question the protocol does not name.`,
  )
}

/**
 * What the trackers last said about the refs this journey names, from the
 * reading the host keeps for every module.
 *
 * The one thing this app reads from anybody. It is enrichment: every reference
 * on the page is drawn whether or not this is answered, and where it is not
 * answered a reference is marked unseen rather than guessed at. It replaced
 * `live.get`, which answered for the roadmap's epic in four bags and could
 * only be as fresh as whatever last wrote the file behind it.
 */
export const GET_TRACKER = required('reading what the trackers last reported', ['tracker.get'])

/**
 * Ask the host to read the trackers again for this journey's refs.
 *
 * Sent from the host's own refresh control — which this page asks for with
 * `roadmap.refreshable` — and from nothing else. It spends the person's rate
 * limit, so it is never sent because a page loaded or a context arrived.
 */
export const REFRESH_TRACKER = required('reading the trackers again', ['tracker.refresh'])
