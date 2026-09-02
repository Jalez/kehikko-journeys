/**
 * The reference grammar, and the one question a broadcast selection asks of
 * this page: which of these references, if any, is mine to show?
 *
 * ## Why this is a file and not four lines in `journeys.ts`
 *
 * The grammar was four lines in `journeys.ts`, and it could have stayed there
 * until the canvas started broadcasting a selection. What changed is that
 * "which of these refs is this page showing" became a decision made on somebody
 * else's behalf — the reader clicked in another container, and if this one chooses
 * wrong the symptom is a container that sits still and says nothing. That is the
 * kind of decision that has to be checkable without a browser, and
 * `journeys.ts` cannot be imported outside one: it pulls in
 * `roadmap-module-protocol/client`, whose mailbox reaches for `window` at
 * import time on purpose.
 *
 * So the grammar and the choosing moved here, and `journeys.ts` imports them
 * back rather than keeping a second copy. Two regexes that both claim to know
 * what a reference looks like would eventually disagree about one, and the ref
 * they disagreed about would be the one somebody clicked.
 */

/**
 * The same four shapes the roadmap parses, because they are how people write
 * them out loud: '#2274' a GitLab issue, '!1800' a change, 'gh#41' a GitHub
 * issue in the journey's own repo, 'gh:org/repo#41' one anywhere else.
 * Anything matching none of them is a gate outside every tracker, which nothing
 * can ever tick off for us, and it is shown as the prose it is rather than as a
 * link to nowhere.
 */
export const REF_IN_PROSE = /(local#[0-9a-z]+|gh(?::[\w.\-]+\/[\w.\-]+)?#\d+|#\d+|![0-9]+)/g
export const IS_TRACKED = /^(local#[0-9a-z]+|gh(?::[\w.\-]+\/[\w.\-]+)?#[0-9]+|#[0-9]+|![0-9]+)$/

export function isTracked(ref: string): boolean {
  return IS_TRACKED.test(ref)
}

/**
 * The first reference in a selection that this page is showing, or `null`.
 *
 * ## Why the page's own references, and not the journey document's
 *
 * The first version of this read the journey: the refs listed against each
 * step, the ones written into its prose, the blockers. It was wrong in the
 * field, and the way it was wrong is worth keeping written down. A card on
 * screen is not only a reference somebody wrote into the journey — for every
 * issue a step names, the page also draws a card for each CHANGE the tracker
 * attaches to that issue, which the host read and this app never stored. Click
 * one of those in another container and the document-reading version answered "this
 * journey does not name that", about a card the reader was looking at. Measured
 * in a real canvas: of twenty-one cards drawn for `files-stay-reachable`, ten
 * were carried in by the tracker's own links and none of them are in the
 * journey on disk.
 *
 * So the caller passes what is actually on the page, and there is exactly one
 * authority for that: the anchors `refLink` built. It cannot drift from what
 * `goTo` will find, because it is the same set of elements.
 *
 * ## Why the first and not all of them
 *
 * A selection can name several references, and this app has exactly one scroll
 * position. Scrolling to each in turn would end on the last one, which is the
 * least likely to be what the reader meant; refusing to move because there are
 * two is a container that goes still for a person who did something perfectly
 * ordinary. So the first one this page holds wins, and the others are not
 * marked in any way — no second outline, no list, no "3 more". The container the
 * reader clicked in already shows the whole selection; this one shows where the
 * selection touches the journey, and picking a place to stand is the whole job.
 *
 * The order walked is the SELECTION's, not the page's, because the sender put
 * its own order in the array and that is the only thing here carrying any hint
 * of intent. The host promises nothing about that order, so this is a
 * preference rather than a rule — but preferring the page's own order would be
 * inventing one out of nothing.
 *
 * ## Why exact strings
 *
 * `gh#41` and `#41` are two different references — one a GitHub issue in the
 * journey's repository, the other a GitLab issue — and normalising them towards
 * each other would send a reader to the wrong card with an outline around it
 * saying "here". Both sides are written by the grammar above, so an exact match
 * is the honest comparison. A ref spelled differently from the page's is a miss,
 * and a miss is quiet.
 */
export function firstShown(
  shown: Iterable<string> | null | undefined,
  selection: readonly string[] | null | undefined,
): string | null {
  if (!shown || !selection?.length) return null
  const here = shown instanceof Set ? shown : new Set(shown)
  for (const ref of selection) {
    if (typeof ref === 'string' && here.has(ref)) return ref
  }
  return null
}

/**
 * Whether two selections are the same pick.
 *
 * Order-sensitive, and that is deliberate: `['#1', '#2']` and `['#2', '#1']`
 * disagree about which reference comes first, and `firstShown` reads that order
 * — so treating them as equal would mean a real change in what the reader
 * picked producing no movement at all.
 */
export function samePick(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref === b[i])
}

/* ------------------------------------------------------------------ *
 * Picking, from this side
 *
 * Everything above is about a selection ARRIVING. What follows is about one
 * LEAVING: a person presses a step on this page and the step's references go
 * onto the canvas, where every other framed module is told about them. It is
 * the same act References performs when a row is picked, and it is pure for
 * the same reason `firstShown` is — what a press means has to be checkable
 * without a browser, because the failure has no symptom. A toggle that added
 * when it should have removed would look like a checkbox that will not untick,
 * and the module to blame would be the host.
 *
 * ## A step is not a ref, and nothing here pretends it is
 *
 * The canvas selection carries references — `gh#105`, `!44` — and only those.
 * A step is a sentence somebody wrote with an ordinal in front of it; there is
 * no spelling of "step 3 of files-stay-reachable" that the protocol would carry
 * or that any other module could act on. So a picked step contributes the refs
 * it CARRIES: the work it names and the changes the tracker attached to that
 * work, which is what the page draws as cards under it. A step that carries
 * nothing contributes nothing, and the page says so on the control rather than
 * inventing a token to send. The day the wire has a spelling for a step, this
 * is the paragraph that changes; until then a made-up one would be a rumour
 * with the protocol's name on it.
 * ------------------------------------------------------------------ */

/** How much of one step's references the canvas selection already holds. */
export type Picked = 'all' | 'some' | 'none'

/**
 * Whether a step's references are on the canvas: all of them, some, or none.
 *
 * `none` for a step that carries no references at all, deliberately. "All of
 * nothing" is vacuously true and would draw such a step as picked the moment
 * anything was — a checkbox ticking itself on a step that can never reach the
 * wire.
 */
export function pickedState(selection: readonly string[], refs: readonly string[]): Picked {
  if (!refs.length) return 'none'
  const here = new Set(selection)
  const held = refs.filter((ref) => here.has(ref)).length
  if (held === refs.length) return 'all'
  return held ? 'some' : 'none'
}

/**
 * The selection after one press on a step: its references added, or removed.
 *
 * ## Removed only when every one of them was there
 *
 * A step whose references are partly on the canvas — one of its three picked
 * in another container — is drawn as partly picked, and a press on it completes
 * the pick rather than undoing somebody else's. Pressing again then removes
 * all three. That is the ordinary tri-state a person expects from a checkbox
 * over a group, and the alternative — remove on any overlap — would have the
 * first press on a step delete a reference the reader had just picked in
 * References, with nothing on this page saying it had.
 *
 * ## Order is kept, and additions go on the end
 *
 * The array is the order things were picked in, which is the only order any
 * module has information about, and `firstShown` reads it. Sorting it, or
 * putting this step's references first, would change which card a
 * neighbouring module scrolls to for reasons the reader did not cause. The
 * same rule References keeps in its `toggle`.
 *
 * Every ref that leaves this function is one this page drew; nothing is
 * normalised, because `gh#41` and `#41` are two different references.
 */
export function togglePick(selection: readonly string[], refs: readonly string[]): string[] {
  if (!refs.length) return [...selection]
  const mine = new Set(refs)
  if (pickedState(selection, refs) === 'all') return selection.filter((ref) => !mine.has(ref))
  const here = new Set(selection)
  const added = refs.filter((ref) => !here.has(ref))
  return [...selection, ...added]
}

/**
 * A list cut to the most references one `selection.set` may carry.
 *
 * ## Why this is clipped here rather than left to the host
 *
 * Every step on a journey picked at once can name more than the wire holds —
 * measured on a real epic, twenty-one cards, and the bound is thirty-two, so
 * two such journeys would pass it. A host answers an over-long list with a
 * refusal of the WHOLE call, and the symptom would be a press that changed
 * nothing and a sentence blaming the host for a list this page could have
 * counted. So the list is cut to the bound, from the end, and the caller is
 * told how many were left off so that the page can say so in words. What is
 * kept is the FRONT, because the front is what was picked first and what
 * `firstShown` on the other side will land on.
 */
export function bounded(refs: readonly string[], limit: number): { refs: string[]; dropped: number } {
  if (refs.length <= limit) return { refs: [...refs], dropped: 0 }
  return { refs: refs.slice(0, limit), dropped: refs.length - limit }
}
