import {
  readTrackerRef,
  type Disposition,
  type DispositionValue,
  type TrackerReading,
  type TrackerRow,
} from 'kehikot-module-protocol'
import { dispositionOf, facetsOf, type DispositionSource, type Facet } from 'kehikot-module-protocol/facets'

import type { JourneyView, Live } from '../kinds.ts'
import { REF_IN_PROSE } from '../refs.ts'

/**
 * Everything this page knows about a reference, and it is all read rather than
 * inferred.
 *
 * ## Why these are functions of `live` and not of a module-level variable
 *
 * They used to close over the page's own `live`, which meant the only way to
 * ask "what does this app conclude about a merged change with a review on it?"
 * was to open a browser and look at a dot. The rail is the one thing on this
 * page that makes a CLAIM — every other pixel restates something a person wrote
 * or a tracker said — so it is the one thing that most needs to be checkable
 * without a browser. Passing the reading in costs one argument at each call
 * site and buys a suite that can enumerate every branch.
 *
 * ## One reading, by the spelling it was asked for
 *
 * `live` is what `tracker.get` answered: the host's shared reading, a row per
 * ref, each row saying itself whether it is an issue or a change. There used
 * to be four bags here — GitLab issues by number, merge requests by number,
 * GitHub issues and pull requests by ref — and whether `gh#41` was an issue
 * depended on which bag the host had filed it in. A row says `kind`, and that
 * is the end of it.
 *
 * Nothing here guesses. A ref with no row has not been seen — never open, and
 * never closed — and `missing` says why.
 */

/** Whether a ref names a change: by its spelling where it says (`!7`), by its row where it does not (`gh#41`). */
export function isChange(live: Live | null, ref: string): boolean {
  if (readTrackerRef(ref)?.kind === 'change') return true
  return live?.rows.get(ref)?.kind === 'change'
}

/** The host's row for a ref, or null where the reading has none. */
export function stateOf(live: Live | null, ref: string): TrackerRow | null {
  return live?.rows.get(ref) ?? null
}

/**
 * Which changes say they deliver an issue — the issue's own `closed-by` links,
 * which the host fills only from a change's own claim. Read, never guessed:
 * this app has no tracker.
 */
export function carriedBy(live: Live | null, ref: string): string[] {
  const row = stateOf(live, ref)
  if (!row || row.kind !== 'issue') return []
  return row.links.filter((link) => link.relation === 'closed-by').map((link) => link.ref)
}

/**
 * Every ref this journey would show a state for, in the order it names them,
 * and only the ones a tracker could answer.
 *
 * The host does not read `journeys.json` — the journeys are this app's — so
 * `tracker.get({ epic })` would answer about Kehikot's epic and not about
 * this page. The refs go over by name instead: what the steps carry, what
 * `settledBy` and `blockedBy` name, and every ref written into the prose, so
 * that a ref mentioned in a sentence gets the tracker's own link like a card
 * does. A `local#…` gate, or anything else `readTrackerRef` cannot read, is
 * left out: no tracker answers it, and asking would only earn `no-tracker`.
 */
export function refsOf(journey: JourneyView | null): string[] {
  if (!journey) return []
  const named: string[] = []
  const prose = (text: string | undefined) => named.push(...(String(text ?? '').match(REF_IN_PROSE) ?? []))
  prose(journey.lede)
  prose(journey.callout)
  if (journey.plan !== 'elsewhere') {
    for (const step of journey.steps ?? []) {
      named.push(...(step.refs ?? []))
      prose(step.title)
      prose(step.body)
    }
  }
  for (const [ref, answers] of Object.entries(journey.settledBy ?? {})) named.push(ref, ...answers)
  for (const [ref, gates] of Object.entries(journey.blockedBy ?? {})) named.push(ref, ...gates)
  return [...new Set(named)].filter((ref) => readTrackerRef(ref) !== null)
}

/**
 * The changes the reading links to that it holds no row for yet.
 *
 * A step names an issue; the host reads the issue and says which changes
 * claim to close it. Those changes are cards on this page and are in no
 * `refs` array, so their own rows are a second question — asked once, for
 * exactly these.
 */
export function unreadLinks(live: Live): string[] {
  const out = new Set<string>()
  for (const row of live.rows.values()) {
    for (const ref of carriedBy(live, row.ref)) {
      if (!live.rows.has(ref) && !live.missing.has(ref) && readTrackerRef(ref)) out.add(ref)
    }
  }
  return [...out]
}

/**
 * Put one or more `tracker.get` answers together into what the page holds.
 *
 * More than one because a journey can name more refs than one question may
 * carry, and because the carried-in changes are asked for after their issues.
 * A row answered later wins over a `missing` from earlier: it is the newer
 * news about the same ref. `at` is the newest the host gave.
 */
export function readingOf(answers: readonly TrackerReading[]): Live {
  const rows = new Map<string, TrackerRow>()
  const missing = new Map<string, TrackerReading['missing'][number]['reason']>()
  const sources = new Map<string, TrackerReading['sources'][number]>()
  let at: string | null = null
  for (const answer of answers) {
    if (answer.at && (!at || Date.parse(answer.at) > Date.parse(at))) at = answer.at
    for (const source of answer.sources) sources.set(`${source.tracker} ${source.host} ${source.repo}`, source)
    for (const row of answer.rows) {
      rows.set(row.ref, row)
      missing.delete(row.ref)
    }
    for (const gap of answer.missing) if (!rows.has(gap.ref)) missing.set(gap.ref, gap.reason)
  }
  return { at, rows, missing, sources: [...sources.values()] }
}

/**
 * The cards a step draws, in the order it draws them.
 *
 * An issue first, then the changes the tracker itself attaches to it, then any
 * change the step named that no issue carried in. A change drawn twice is a
 * reader counting the same work twice.
 *
 * Exported because two things have to agree on it exactly: the cards this
 * block draws, and the references a pick of this step puts on the canvas.
 * `Picking` in `app.tsx` picks every step at once and must send the same list
 * each step's own tick would, or the whole-journey press would leave half the
 * steps drawn as partly picked — the union of `step.refs` is not it, because
 * the tracker's carried-in changes are cards and are in no `refs` array.
 */
export function cardsUnder(live: Live | null, refs: readonly string[]): { ref: string; under: boolean }[] {
  const issues = refs.filter((ref) => !isChange(live, ref))
  const loose = refs.filter((ref) => isChange(live, ref))
  const claimed = new Set<string>()
  const drawn: { ref: string; under: boolean }[] = []
  for (const issue of issues) {
    drawn.push({ ref: issue, under: false })
    for (const change of carriedBy(live, issue)) {
      claimed.add(change)
      drawn.push({ ref: change, under: true })
    }
  }
  for (const change of loose) if (!claimed.has(change)) drawn.push({ ref: change, under: false })
  return drawn
}

/**
 * Which of the badge's five faces a sighting wears, as one word.
 *
 * `unseen` is not a state and is returned for the absence of a sighting, which
 * is why this takes a `TrackerRow | null` rather than a `TrackerRow`: the caller
 * cannot forget the case, because the case is in the type.
 */
export type Tone = 'open' | 'merged' | 'closed' | 'draft' | 'unseen'

export function toneOf(seen: TrackerRow | null): Tone {
  if (!seen) return 'unseen'
  if (seen.state === 'merged') return 'merged'
  if (seen.state === 'closed') return 'closed'
  if (seen.draft) return 'draft'
  return 'open'
}

/**
 * The rail.
 *
 * Seven words, in Kehikot's own order, and a position derived from ONE
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

/**
 * What else the page knows that a reading does not carry, for the answers that
 * depend on it. Every field is optional and its absence is the standalone
 * answer: not framed, nothing withheld, nobody has marked anything.
 */
export interface Around {
  /** Whether a host is framing this page at all. */
  framed?: boolean
  /** What the host said when it would not hand over a reading, word for word. */
  withheld?: string | null
  /** People's marks on why things closed: `context.dispositions`, whole. */
  marks?: readonly Disposition[]
  /** The journey's own `settledBy`: decisions answered by changes rather than closed by them. */
  settledBy?: Readonly<Record<string, readonly string[]>>
}

/**
 * Why there is no reading, in the ways there can be none.
 *
 * Shared by the badge and the rail so that the two cannot disagree with each
 * other, and written to agree with `Sight` at the top of the page. They used to
 * look only at `live`, and `live` is null both when nothing frames this page
 * and when a host frames it and refused `tracker.get` — so a page framed inside
 * the host said "Framed, and refused" in its banner and "Nothing is framing
 * this page" on every card underneath it.
 *
 * With a reading in hand, the host has said WHY a ref has no row, and the four
 * reasons send a reader to four different places: wait, check the spelling,
 * check the project's trackers, or read the source's own error. Without a
 * `ref`, or for a ref the reading never mentions, it is the old sentence.
 */
export function absenceOf(live: Live | null, around: Around = {}, ref?: string): { word: string; why: string } {
  if (live) {
    const reason = ref === undefined ? undefined : live.missing.get(ref)
    switch (reason) {
      case 'pending':
        return {
          word: 'being read',
          why: 'The host has not read this reference yet and has started to. It is drawn here when the read lands.',
        }
      case 'not-found':
        return { word: 'not found', why: 'The tracker answered, and it has no such issue or change.' }
      case 'no-tracker':
        return {
          word: 'no tracker for it',
          why: 'This project reads no tracker that this spelling names, so nothing can say what it is doing.',
        }
      case 'failed': {
        const errors = live.sources.map((source) => source.error).filter(Boolean)
        return {
          word: 'read failed',
          why: errors.length
            ? `The host's last read of its tracker failed: ${errors.join(' · ')}`
            : "The host's last read of its tracker failed.",
        }
      }
    }
    return {
      word: 'not in the reading',
      why: 'The host handed over its tracker reading, and there was nothing about this reference in it.',
    }
  }
  if (around.framed) {
    return {
      word: 'no reading from the host',
      why: around.withheld
        ? `A host is framing this page and had no tracker reading to hand over: ${around.withheld}`
        : 'A host is framing this page and has not handed over a tracker reading for this journey. This is the ' +
          'absence of a reading, not a state.',
    }
  }
  return {
    word: 'not seen from here',
    why:
      'Nothing is framing this page, so no tracker reading has reached this app. This is the absence of a ' +
      'reading, not a state.',
  }
}

export function railOf(live: Live | null, ref: string, around: Around = {}): Rail {
  const seen = stateOf(live, ref)
  if (!seen) return { now: -1, unseen: true, ...absenceOf(live, around, ref) }
  /* A person's word, or the journey's own record that a decision was answered,
     outranks the tracker's state — that is what each of them is FOR. */
  const verdict = verdictOf(live, ref, around)
  if (verdict.source === 'person' || verdict.source === 'journey') return railOfVerdict(verdict)
  if (isChange(live, ref)) {
    if (seen.state === 'merged') return { now: 5, word: 'In dev', why: 'It merged. Landing is not releasing.' }
    if (seen.state === 'closed') {
      return {
        now: -1,
        word: 'Closed without merging',
        why:
          verdict.value === 'unknown'
            ? 'The change is closed and it did not land. That is not a stage, and nobody has said why it closed.'
            : 'The change is closed and it did not land. That is not a stage.',
      }
    }
    if (seen.draft) return { now: 2, word: 'In progress', why: 'The change is open and marked a draft.' }
    /* `required` is not a review — it is the tracker saying one is still owed,
       which every GitLab merge request under an approval rule says from the
       moment it opens. Only a verdict somebody gave moves the rail. */
    if (seen.review === 'approved') return { now: 3, word: 'In review', why: 'The tracker says it is approved.' }
    if (seen.review === 'changes-requested') {
      return { now: 3, word: 'In review', why: 'A reviewer has asked for changes.' }
    }
    return { now: 4, word: 'PR open', why: 'The change is open and nobody has reviewed it yet.' }
  }
  if (seen.state === 'closed') return railOfVerdict(verdict)
  const under = carriedBy(live, ref)
  if (under.length) return { now: 4, word: 'PR open', why: `A change is open against it: ${under.join(', ')}.` }
  if ((seen.assignees ?? []).length) return { now: 1, word: 'Taken', why: 'The tracker has it assigned.' }
  return { now: 0, word: 'Todo', why: 'Nobody is on it in the tracker and no change exists.' }
}

/** Whose word a verdict is, as a clause. */
function whose(verdict: Verdict): string {
  if (verdict.source === 'person') return verdict.mark?.by ? `${verdict.mark.by} marked it so` : 'A person marked it so'
  if (verdict.source === 'journey') return 'This journey records it as a decision answered by changes that merged'
  return 'The tracker says so'
}

/**
 * Where a closed reference stands, once it is known why it closed.
 *
 * Only `done` is on the line. The other three are work that will not be
 * delivered — not abandoned-in-progress, not finished — and a dot anywhere on a
 * line of stages would claim one or the other.
 */
function railOfVerdict(verdict: Verdict): Rail {
  const target = verdict.mark?.target ?? ''
  switch (verdict.value) {
    case 'done':
      return { now: 5, word: 'In dev', why: `${whose(verdict)}: done. Landing is not releasing.` }
    case 'wont-do':
      return { now: -1, word: 'Won’t do', why: `${whose(verdict)}. It neither settles its step nor holds it up.` }
    case 'duplicate':
      return {
        now: -1,
        word: target ? `Duplicate of ${target}` : 'Duplicate',
        why: `${whose(verdict)}. It neither settles its step nor holds it up.`,
      }
    case 'superseded':
      return {
        now: -1,
        word: target ? `Superseded by ${target}` : 'Superseded',
        why: `${whose(verdict)}. It neither settles its step nor holds it up.`,
      }
    default:
      return {
        now: -1,
        word: 'Closed, reason unknown',
        why:
          'The tracker closed it without saying why, and nobody has marked it. Whether it was done is for a person ' +
          'to decide, so it is not counted either way until somebody does.',
      }
  }
}

/* ------------------------------------------------------------------ *
 * Why a reference closed
 * ------------------------------------------------------------------ */

/**
 * Why a reference closed, and whose word that is.
 *
 * `dispositionOf` from the shared facets, handed the host's row as it is —
 * a row IS a `Sighting`, `closedByMerge` and all — with one thing this app adds: a
 * journey's `settledBy`. A decision issue no commit will close, whose answering
 * changes have all merged, is `done` by the journey's own record — that field
 * has always meant exactly this, and folding it in here keeps one answer to
 * "is this finished" rather than two. A person's mark still wins over it, as
 * it wins over the tracker.
 */
export interface Verdict {
  value: DispositionValue | 'unknown' | null
  source: DispositionSource | 'journey' | null
  mark: Disposition | null
}

export function verdictOf(live: Live | null, ref: string, around: Around = {}): Verdict {
  const shown = dispositionOf(ref, stateOf(live, ref), around.marks ?? [])
  if (shown.source === 'person') return shown
  const answers = around.settledBy?.[ref] ?? []
  if (answers.length && answers.every((change) => stateOf(live, change)?.state === 'merged')) {
    return { value: 'done', source: 'journey', mark: null }
  }
  return shown
}

/**
 * Every facet one reference has, for the filter. None at all without a
 * reading — `sift` never hides what it cannot see.
 */
export function facetsOfRef(live: Live | null, ref: string, around: Around = {}): Facet[] {
  const row = stateOf(live, ref)
  return row ? facetsOf(row, verdictOf(live, ref, around)) : []
}

/**
 * Where a step's references stand, sorted by what they mean for the step.
 *
 * - `done` settles.
 * - `aside` — won't do, duplicate, superseded — neither settles nor blocks.
 *   Counting them as settled is how a step whose issue closed as "won't do"
 *   used to read as delivered; counting them as blocking would hold the step
 *   open forever on work nobody is going to do.
 * - `undecided` — closed, reason unknown — is a question for a person, and
 *   until somebody answers it the step is not called done. It is listed so the
 *   step can say who has to decide what.
 * - `pending` is everything else: open, or never read.
 */
export interface Standing {
  done: string[]
  aside: { ref: string; value: Exclude<DispositionValue, 'done'> }[]
  undecided: string[]
  pending: string[]
  settled: boolean
}

export function standing(live: Live | null, refs: readonly string[], around: Around = {}): Standing {
  const out: Standing = { done: [], aside: [], undecided: [], pending: [], settled: false }
  for (const ref of refs) {
    const verdict = verdictOf(live, ref, around)
    if (verdict.value === 'done') out.done.push(ref)
    else if (verdict.value === 'unknown') out.undecided.push(ref)
    else if (verdict.value) out.aside.push({ ref, value: verdict.value })
    else out.pending.push(ref)
  }
  /* Empty is never done. A step with no references has nothing that could
     have settled it, and one whose every reference was set aside delivered
     nothing either. */
  out.settled = out.done.length > 0 && !out.pending.length && !out.undecided.length
  return out
}

/**
 * Whether every reference a step names has finished — `done`, by a person's
 * mark, the tracker's reason or the journey's `settledBy`, with set-aside work
 * ignored. See `standing`.
 */
export function isSettled(live: Live | null, refs: readonly string[], around: Around = {}): boolean {
  return standing(live, refs, around).settled
}
