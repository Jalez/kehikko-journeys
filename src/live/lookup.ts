import type { Live, Sighting } from '../kinds.ts'

/**
 * Everything this page knows about a reference, and it is all read rather than
 * inferred.
 *
 * ## Why these are functions of `live` and not of a module-level variable
 *
 * They used to close over the page's own `live`, which meant the only way to
 * ask "what does this app conclude about a merged change with reviewers on it?"
 * was to open a browser and look at a dot. The rail is the one thing on this
 * page that makes a CLAIM — every other pixel restates something a person wrote
 * or a tracker said — so it is the one thing that most needs to be checkable
 * without a browser. Passing the reading in costs one argument at each call
 * site and buys a suite that can enumerate every branch.
 *
 * Nothing here guesses. A GitHub number is an issue or a pull request according
 * to WHICH BAG the host's last refresh filed it in, and if it is in neither bag
 * then the honest answer is that we have not seen it — never that it is open,
 * and never that it is closed.
 */

export function isChange(live: Live | null, ref: string): boolean {
  if (/^![0-9]+$/.test(ref)) return true
  return Boolean(live?.ghPrs && ref in live.ghPrs)
}

/**
 * The host's own filing, read the way it files: a GitLab number is keyed by the
 * number, a GitHub one by the ref as written, and which bag it is in is the
 * only thing that says whether a GitHub number is an issue or a pull request.
 */
export function stateOf(live: Live | null, ref: string): Sighting | null {
  if (!live) return null
  const change = /^!([0-9]+)$/.exec(ref)
  if (change) return live.mrs?.[change[1] as string] ?? null
  const issue = /^#([0-9]+)$/.exec(ref)
  if (issue) return live.issues?.[issue[1] as string] ?? null
  if (ref.startsWith('gh')) return live.ghPrs?.[ref] ?? live.ghIssues?.[ref] ?? null
  return null
}

/**
 * Which changes the tracker itself attaches to an issue. GitLab files the
 * attachment under the issue's number; GitHub files it under the ref as
 * written. Read, never guessed: this app has no tracker.
 */
export function carriedBy(live: Live | null, ref: string): string[] {
  if (!live) return []
  const issue = /^#([0-9]+)$/.exec(ref)
  if (issue) return (live.links?.[issue[1] as string] ?? []).map((n) => `!${n}`)
  if (ref.startsWith('gh')) return (live.ghLinks?.[ref] ?? []).map((n) => `gh#${n}`)
  return []
}

/**
 * Which of the badge's five faces a sighting wears, as one word.
 *
 * `unseen` is not a state and is returned for the absence of a sighting, which
 * is why this takes a `Sighting | null` rather than a `Sighting`: the caller
 * cannot forget the case, because the case is in the type.
 */
export type Tone = 'open' | 'merged' | 'closed' | 'draft' | 'unseen'

export function toneOf(seen: Sighting | null): Tone {
  if (!seen) return 'unseen'
  if (seen.state === 'merged') return 'merged'
  if (seen.state === 'closed') return 'closed'
  if (seen.draft) return 'draft'
  return 'open'
}

/**
 * The rail.
 *
 * Seven words, in the roadmap's own order, and a position derived from ONE
 * thing: what the last refresh read. That is the whole of what this app can
 * see, and the rail says so rather than implying more.
 *
 * What it deliberately cannot show, each with its reason:
 *
 *  - **An agent's own report.** 'working', 'in-review' and 'blocked' are things
 *    nothing else can see, which is exactly why an agent reports them — and
 *    they are reported to the host, over `stage.report`, which this app does
 *    not declare and does not call. A rail that quietly filled 'In progress'
 *    off an open draft while an agent's own report said 'blocked' would be
 *    showing the weaker fact as if it were the stronger.
 *  - **In prod.** Reading whether a commit is on the deploy branch means
 *    reading the repository. This app has no repository and no credential. The
 *    last dot is therefore drawn hollow and dashed on every row, always, and
 *    says why when you hover it. A filled dot would be a claim; an absent dot
 *    would hide the question.
 */
export const STAGES = ['Todo', 'Taken', 'In progress', 'In review', 'PR open', 'In dev', 'In prod'] as const
export const IN_PROD = 6

export interface Rail {
  now: number
  word: string
  why: string
  unseen?: boolean
}

export function railOf(live: Live | null, ref: string): Rail {
  const seen = stateOf(live, ref)
  if (!seen) {
    return {
      now: -1,
      word: live ? 'not in the last refresh' : 'not seen from here',
      unseen: true,
      why: live
        ? 'The host handed over what its last refresh read, and there was nothing about this reference in it.'
        : 'Nothing is framing this page, so no tracker reading has reached this app. This is the absence of a reading, not a state.',
    }
  }
  if (isChange(live, ref)) {
    if (seen.state === 'merged') return { now: 5, word: 'In dev', why: 'It merged. Landing is not releasing.' }
    if (seen.state === 'closed') {
      return {
        now: -1,
        word: 'Closed without merging',
        why: 'The change is closed and it did not land. That is not a stage.',
      }
    }
    if (seen.draft) return { now: 2, word: 'In progress', why: 'The change is open and marked a draft.' }
    if ((seen.reviewers ?? []).length) return { now: 3, word: 'In review', why: 'The tracker names reviewers on it.' }
    return { now: 4, word: 'PR open', why: 'The change is open and nobody is named on it yet.' }
  }
  if (seen.state === 'closed') return { now: 5, word: 'In dev', why: 'The issue is closed. Landing is not releasing.' }
  const under = carriedBy(live, ref)
  if (under.length) return { now: 4, word: 'PR open', why: `A change is open against it: ${under.join(', ')}.` }
  if ((seen.assignees ?? []).length) return { now: 1, word: 'Taken', why: 'The tracker has it assigned.' }
  return { now: 0, word: 'Todo', why: 'Nobody is on it in the tracker and no change exists.' }
}

/**
 * Whether every reference a step names has finished.
 *
 * Empty is never done. A step with no references has nothing that could have
 * settled it, and `every` over an empty list is vacuously true — which would
 * put a "done" on every step of a journey nobody has attached any work to yet.
 */
export function isSettled(live: Live | null, refs: readonly string[]): boolean {
  if (!refs.length) return false
  return refs.every((ref) => {
    const seen = stateOf(live, ref)
    return Boolean(seen) && (seen?.state === 'merged' || seen?.state === 'closed')
  })
}
