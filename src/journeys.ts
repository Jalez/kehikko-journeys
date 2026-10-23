import { flushSync } from 'react-dom'
import {
  LIMITS,
  TRACKER_REFRESH_WITHIN_MS,
  contentStamp,
  filterChoiceSchema,
  navigationResult,
  partsSetResult,
  readTrackerRef,
  trackerReadingResult,
  trackerRefreshResult,
  type Disposition,
  type DispositionValue,
  stepPart,
  type EpicPart,
  type FilterChoice,
  type ModuleContext,
  projectKey,
  type TrackerReading,
} from 'kehikot-module-protocol'
import { HostRefused, held as heldStore, hostStore, probeServer, type Draft, type HostStanding, type Where } from 'kehikot-module-protocol/client'
import { scopeOf } from 'kehikot-module-protocol'
import { HIDE_GROUP, countFacets, hiddenIn, offer, type Facet } from 'kehikot-module-protocol/facets'

import { ID } from '../manifest.ts'
import { GET_EPIC, GET_TRACKER, PARTS_REF, REFRESH_TRACKER, REPORT_CHANGE, SET_PARTS } from '../wire/methods.ts'
import type { Brief, JourneyView, Live, Target } from './kinds.ts'
import { cardsUnder, facetsOfRef, heldOver, readingOf, refsOf, unreadLinks, type Around } from './live/lookup.ts'
import { shownSteps, stepInFocus } from './focus.ts'
import { bounded, firstShown, samePick, togglePick } from './refs.ts'
import { get, post, standIn } from './store/api.ts'
import { treeOf } from './tree.ts'
import type { FactoryJob } from './kinds.ts'

/**
 * The browser half of the app: everything it holds, and everything it decides.
 *
 * ## Why this is not a component, and why the components hold no state
 *
 * The page draws with React now. This file did not become a hook, and the
 * distinction is worth writing down because it is the thing that kept the port
 * honest.
 *
 * What this module does is not "view state". It is a conversation with two
 * other programs — this app's own server on one side, a host on the other —
 * carried on over messages that arrive whenever they arrive, including before
 * anything has rendered and after the thing they were about has been replaced.
 * Half the essays below are about ORDERING: a greeting that lands before first
 * paint, an answer to a question about a journey nobody is reading any more, a
 * walk that must not report `found` until the document it is walking into has
 * been fetched. React's scheduler is not an ally in any of that, and a version
 * of this written as effects would have to re-derive each of those orderings
 * from the render loop.
 *
 * So the state stays plain, the components subscribe to it through
 * `useSyncExternalStore`, and `set` below commits with `flushSync` — which is
 * the one line that makes the whole arrangement work, for the reason its own
 * comment gives.
 *
 * ## The vocabulary, and where it changes
 *
 * The wire says `epic`. This app's own store says `journey`, in every file on
 * disk and in every field name in `store.ts`. Both are correct and they are the
 * same thing seen from two sides, so the translation happens at exactly one
 * place — where a `kehikot.context` or a `kehikot.goto` arrives — and nowhere
 * else. A rename pushed down into the store would have rewritten thirteen
 * shipped documents to make a wire word match; a rename left un-done at the
 * wire is what made this module frame as incompatible against a host speaking
 * protocol 2.
 *
 * ## The four things this file is actually about
 *
 * **1. It draws from its own store.** Every fetch below is a relative path,
 * which from inside the frame reaches this program's own server because the
 * page came from it. The journeys, the steps, the prose and the editing are all
 * on that path. Nothing on it depends on anything framing this page, and the
 * page is fully drawn before a single bridge message is read.
 *
 * **2. `live` is enrichment and is drawn as such.** When a host is there and
 * `tracker.get` is answered, the cards gain a state, the tracker's own labels, who
 * is on it and a rail. When it is not, the cards are still there, still name
 * their references, still link nowhere they cannot link — and say, in words,
 * that their state cannot be seen from here. A reference whose state is unknown
 * is NEVER drawn as unknown-therefore-open, and never as closed.
 *
 * **3. Nothing to show is not the same as cannot see from here.** The single
 * most important behaviour in this app, and the reason `planOf` in `store.ts`
 * has three answers rather than two. A journey whose steps are projected out of
 * a paper says so, names the file, and offers no editor. It does not appear as
 * a journey with no steps, because it is not one.
 *
 * **4. Being told where to go.** Read the long comment above `goTo`. In
 * protocol 1 this was a receiving end built against a message that did not
 * exist; in protocol 2 the message exists, carries a correlation id, and is
 * ANSWERED — which changes what the walk has to do, not just what it has to
 * listen for.
 */

/* ------------------------------------------------------------------ *
 * What we hold
 * ------------------------------------------------------------------ */

export interface State {
  /** Every journey this project holds, in brief. */
  index: Brief[]
  /** The one being read, whole. */
  journey: JourneyView | null
  /**
   * Which epic the last context named, whether or not this app holds one.
   *
   * `journey` is what was FOUND; this is what was ASKED FOR, and the two are
   * different facts the page has to be able to tell apart. The module already
   * knew this — `standingOn` below has held it since the container learned to
   * follow the canvas — but it held it privately, so nothing that draws could
   * consult it, and `journey === null` was left standing for two unrelated
   * situations: no epic on the canvas at all, and an epic named that this
   * project has no journey for. `sight.tsx` said both of them in one sentence
   * with an "or" in the middle, which sent a reader who could see the epic
   * open on the canvas off to look for a host that had stopped naming it.
   *
   * Null means the host said no epic is open, or named something that is not a
   * slug. It is not "not yet known": before any context arrives `framed` is
   * false and the page is saying something else entirely.
   */
  epic: string | null
  /** The host's shared tracker reading for this journey's refs, or null. */
  live: Live | null
  /**
   * Where the Factory module has each step's issue, by issue: its newest job. Empty with no Factory,
   * or none for these issues. Read through this app's server (`/api/factory`, `factory.ts`).
   */
  factory: Record<string, FactoryJob>
  /**
   * Whether the trackers are being read again right now: by a press on this
   * container, or by anybody in this project, as `context.tracker.refreshing`
   * says. The page draws the reading it has, and says it is being replaced.
   */
  busy: boolean
  /**
   * The host's own words for why it handed over no reading, when it refused:
   * the reason alone, for the badge and the rail beside each reference to
   * quote. It lasts as long as the missing reading it explains. Nothing above
   * the journey says it — it is said where the state would have been.
   */
  withheld: string | null
  /**
   * Why the newest read of the trackers did not land, while an older reading
   * is still on screen: the states drawn are that reading's, and the line
   * under the page says so. Null once a read lands. A failed re-read never
   * takes a reading off the screen (issue #39).
   */
  readFailed: string | null
  /** People's marks on why references closed: `context.dispositions`, whole. */
  marks: Disposition[]
  /** This container's filter choice, as the host holds it. */
  filters: FilterChoice
  /** The facets that choice hides, read once from `filters`. */
  hidden: Facet[]
  /**
   * Issues whose changes somebody has unfolded.
   *
   * Folded is the default, so this lists the exceptions. In memory and no
   * further: remembering it across reloads would need `state:keep`, which
   * this app does not declare, and a fold is cheap to redo.
   */
  unfolded: string[]
  /**
   * What the canvas has picked out, as the host last said it.
   *
   * Never what this page asked for. A press on a step below asks the host to
   * change the selection and this field is filled in from the `kehikot.context`
   * that comes back — the same discipline References keeps, and for the same
   * reason: an optimistic copy would tick a step for a pick the host refused or
   * clamped, and two containers would disagree about the one thing the round
   * trip exists to keep them agreed on. Standalone it stays empty forever,
   * which is true — there is no canvas for anything to be picked on.
   */
  selection: string[]
  /**
   * The parts of the open epic, as the host last said, each flagged `picked`.
   *
   * None picked is the whole epic and is the resting state. With some picked,
   * only their steps are drawn — a step is the step of one part; see
   * `focus.ts`. Held verbatim: which steps that is, is worked out where it is
   * drawn, by the protocol's own function.
   */
  parts: readonly EpicPart[]
  /**
   * The epic this project is KNOWN to hold no journey for: the index was read
   * again and does not list it.
   *
   * Not the same as `journey === null`, which is also true for the half second
   * a journey is being fetched. The page offers to begin a journey on this
   * and on nothing weaker, because an offer that flashed past while an
   * existing journey loaded would be an offer to overwrite it — refused by the
   * store, but drawn.
   */
  unwritten: string | null
  /** A journey is being begun: the host is being asked, or the store is writing. */
  beginning: boolean
  framed: boolean
  /**
   * Whether anything is framing this page, in the protocol's three states: `listening` until a
   * host greets or the grace runs out, then `hosted` or `unhosted`. `framed` above is the older
   * boolean and cannot say the first of them — which is why this page used to draw "Nothing is
   * framing this page" for the first moments of every framed load. The cover in `app.tsx` reads
   * this one.
   */
  where: Where
  /** Where the host says the project is on disk, or null. What the cover asks `coverFor` about. */
  projectPath: string | null
  /** The project's permanent id (a host from 2.1.0), or null. It does not change when the folder is renamed. */
  projectId: string | null
  /** Which step has its editor open, or -1. */
  editing: number
  /**
   * The editor for a step that does not exist yet is open.
   *
   * Apart from `editing`, which is a position: "one past the last step" would
   * say the same thing right up until somebody else removed a step while the
   * box was open, at which point the editor for a NEW step would be sitting
   * over the last existing one and would save over it.
   */
  adding: boolean
  /**
   * The part that new step is being written FOR, or null: a part the host
   * lists that has no step yet (somebody added it in the host's picker).
   * Saved, the step is filed under it and no part is asked for.
   */
  addingFor: string | null
  /** The one line this app uses to answer the reader. */
  said: string
  /**
   * Where the journeys on screen are being read from, and why they are not.
   *
   * Three states an empty `index` cannot tell apart, and drawing them the same
   * way is the failure these fields exist to prevent:
   *
   * - `nowhere` — no project is open, so there is nowhere to read and nowhere
   *   to write. Not a fault, and not the same as an empty project: the page
   *   says so and offers no editor, because there is no file for one to save
   *   into.
   * - `trouble` — a project was named and this app will not read under it: the
   *   folder is gone, the `.kehikot` resolves somewhere else, the file will not
   *   parse. Somebody has to go and look, and the sentence says at what.
   * - neither, with `index` empty — a real project with no journeys yet, which
   *   is a true and ordinary thing to say about a project.
   */
  nowhere: boolean
  trouble: string | null
  /** The file the journeys came from, for somebody wondering where they went. */
  from: string | null
  /**
   * Whether the host is on one epic (`epic`) or on "All epics" (`project`, protocol 2.9.0). With
   * `project`, `epic` is null and that is NOT "no epic": the page lists every journey of the
   * project, by epic, read-only (`everything`).
   */
  scope: 'epic' | 'project'
  /**
   * Every journey of the project, whole, while the host is on "All epics"; null otherwise and
   * while they are being read. Read-only: editing a step asks the host about ONE epic's parts
   * (`parts.set`) and reads ONE journey's tracker states, so a step is edited with its epic open.
   */
  everything: JourneyView[] | null
}

let state: State = {
  index: [],
  journey: null,
  epic: null,
  live: null,
  factory: {},
  busy: false,
  withheld: null,
  readFailed: null,
  marks: [],
  filters: {},
  hidden: [],
  unfolded: [],
  selection: [],
  parts: [],
  unwritten: null,
  beginning: false,
  framed: false,
  where: 'listening',
  projectPath: null,
  projectId: null,
  editing: -1,
  adding: false,
  addingFor: null,
  said: '',
  /* True until a host says otherwise, and true forever if none ever does. A
     page opened directly has no canvas to tell it which project it is standing
     in, and inventing one would be this app writing into a repository nobody
     pointed it at. */
  nowhere: true,
  trouble: null,
  from: null,
  scope: 'epic',
  everything: null,
}

const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): State {
  return state
}

/**
 * Change something, and have the page reflect it BEFORE this returns.
 *
 * `flushSync` is not an optimisation and removing it does not make the page
 * slower — it makes `goTo` wrong. Every walk in this file ends by querying the
 * document for the anchor it is walking to, and answering the host `found:
 * true` or `found: false` about what it saw. React's default scheduling means
 * a journey set into state is not in the DOM when the next line runs, so an
 * un-flushed version of this would have `goTo` search the PREVIOUS journey's
 * markup, find nothing, and honestly report a miss — for a reference that is on
 * screen a millisecond later. The host acts on that answer by not falling back
 * to an ordinary link, so the symptom is a press that lands nowhere and says
 * nothing.
 *
 * The protocol's own essay on `went` names this exact class of bug, in its
 * other form: answering `true` before looking. Both are the same mistake, which
 * is a walk that reports on a document it has not seen.
 *
 * This is safe where it is called from — event handlers, promise callbacks and
 * the message listener — and none of those is a render. It would warn if it
 * were called during one, and nothing here is.
 */
function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  flushSync(() => {
    for (const listener of listeners) listener()
  })
  offerRefresh()
}

export function say(what: string): void {
  set({ said: what })
}

export function setEditing(which: number): void {
  /* Closing an editor, or opening another step's over it, leaves the words that were in it — as it
     always has. Their held copy goes with them: that is a person throwing them away on purpose. */
  if (state.editing >= 0) hold(targetOf(state.editing), null)
  set({ editing: state.editing === which ? -1 : which })
}

/**
 * Where the words typed into the step at `index` are held: by the id of the
 * step's part, which stays the step's when a step before it is removed. A
 * position would hand one step's unsaved words to its neighbour.
 */
export function targetOf(index: number): string {
  const step = state.journey?.steps[index]
  const id = step ? stepPart(step) : null
  return id === null ? `step:${index}` : `step@${id}`
}

/** The position of the step a held target was aimed at, or -1: it is gone. */
function aimOf(target: string, journey: JourneyView): number {
  if (target.startsWith('step@')) {
    const id = target.slice('step@'.length)
    return journey.steps.findIndex((step) => stepPart(step) === id)
  }
  /* Held by a page from before steps had ids: by position. */
  if (target.startsWith('step:')) {
    const at = Number(target.slice('step:'.length))
    return Number.isInteger(at) && at >= 0 && at < journey.steps.length ? at : -1
  }
  return -1
}

/* ------------------------------------------------------------------ *
 * What is being typed, held across a reload of this page
 *
 * A page older than its server reloads itself — on the Save press that found
 * it out, or on a read — and the write is not retried. So every box on this
 * page writes its words as they change (the protocol's `held`), under the project
 * and under what they were aimed at: the journey's slug, then `step@<id>` for
 * an open step (`targetOf`), `add` for a step not written yet and `add@<id>`
 * for the step of a part that has none (`addTarget`).
 * A draft is cleared by the write that kept it, by emptying the box, and by
 * closing the editor.
 * ------------------------------------------------------------------ */

/**
 * By project, then by the journey's slug and the box. An untouched or emptied draft is never one: the protocol's reader drops it.
 *
 * The project is `projectKey(context)`, its id, so a folder renamed or moved under an open page keeps
 * what was typed. Drafts held before this under the path are read once as a fallback and carried over to
 * the id the first time they are touched.
 */
const drafts = heldStore('kehikot.journeys.drafts')

/** The scope drafts are held under now, and the one an older page held them under. */
function scopes(): { now: string | null; was: string | null } {
  const at = projectKey({ projectId: state.projectId, projectPath: state.projectPath })
  return { now: at?.key ?? null, was: state.projectPath }
}

/** Everything held for the project, the id's own and (once) what the path held, carried across to the id. */
function allHeld(): Record<string, Draft> {
  const { now, was } = scopes()
  const here = drafts.at(now)
  if (was === null || was === now) return here.all()
  const old = drafts.at(was)
  const carried = old.all()
  for (const [target, draft] of Object.entries(carried)) {
    if (!here.read(target)) here.keep(target, draft)
    old.keep(target, null)
  }
  return here.all()
}

/** The words held for one box of the journey that is open, or null. */
export function held(target: string): Draft | null {
  const slug = state.journey?.slug
  if (!slug) return null
  allHeld()
  return drafts.at(scopes().now).read(`${slug}|${target}`)
}

/** Hold the words in one box of the journey that is open; `null` forgets them. */
export function hold(target: string, draft: Draft | null): void {
  const slug = state.journey?.slug
  if (!slug) return
  allHeld()
  drafts.at(scopes().now).keep(`${slug}|${target}`, draft)
}

/** Every held draft for the journey that is open, by target. */
function heldHere(): [string, Draft][] {
  const slug = state.journey?.slug
  if (!slug) return []
  return Object.entries(allHeld())
    .filter(([target]) => target.startsWith(`${slug}|`))
    .map(([target, one]) => [target.slice(slug.length + 1), one])
}

/**
 * Reopen whatever was open with words in it when this page last went away: the editor of the
 * step, the box for a new step. Called when a journey has landed on screen. It opens;
 * the boxes themselves read their words (`held`) as they mount.
 */
export function reopenHeld(): void {
  const journey = state.journey
  if (!journey) return
  for (const [target] of heldHere()) {
    if (target === 'add') setAdding(true)
    else if (target.startsWith('add@')) {
      const id = target.slice('add@'.length)
      if (stepless(journey).some((part) => part.id === id)) setAdding(true, id)
    } else if (target.startsWith('step')) {
      const at = aimOf(target, journey)
      if (state.editing < 0 && at >= 0) set({ editing: at })
    }
  }
}

/**
 * Held words whose target is gone from the journey that is open: a step that was removed, or a
 * box this page no longer has (the parts box, whose words were a heading or a file name). They
 * are shown, with what they were about, rather than opened over something they were not aimed
 * at, or dropped.
 */
export function heldStrays(): { target: string; draft: Draft }[] {
  const journey = state.journey
  if (!journey) return []
  return heldHere()
    .filter(([target]) =>
      target.startsWith('step')
        ? aimOf(target, journey) < 0
        : target.startsWith('add@')
          ? !stepless(journey).some((part) => part.id === target.slice('add@'.length))
          : target.startsWith('part:'),
    )
    .map(([target, draft]) => ({ target, draft }))
}

/** Throw one held draft away, from the kept-words list. */
export function discardHeld(target: string): void {
  hold(target, null)
  /* Nothing in state changed; the list is read from storage, so the page is told to look again. */
  set({})
}

/**
 * Open or close the editor for a step that is not written yet. `forPart` is
 * the id of a part with no step that the step is for; without one it is a
 * step for a part that does not exist yet either.
 */
export function setAdding(on: boolean, forPart: string | null = null): void {
  if (!on) {
    hold(addTarget(state.addingFor), null)
    made.clear()
  }
  set({ adding: on, addingFor: on ? forPart : null })
}

/** Where the words typed into the box for a new step are held: `add`, or `add@<id>` for the step of a part that has none. */
export function addTarget(forPart: string | null): string {
  return forPart === null ? 'add' : `add@${forPart}`
}

/**
 * The parts the host lists that no step is the step of, in the list's order:
 * what somebody added in the host's picker and nothing here has been written
 * for. Empty while this app keeps the list — there a part IS its step.
 */
export function stepless(journey: JourneyView): { id: string; name: string }[] {
  const listed = journey.listed ?? null
  if (listed === null || journey.plan === 'elsewhere') return []
  const taken = new Set(journey.steps.map((step) => stepPart(step)))
  return listed.filter((part) => !taken.has(part.id))
}

/** Whether a step is the step of a part: always while this app keeps the list, and by the host's list where it does. */
export function inPart(journey: JourneyView, step: { part?: string } | undefined): boolean {
  const id = step ? stepPart(step) : null
  if (id === null) return false
  const listed = journey.listed ?? null
  return listed === null || listed.some((part) => part.id === id)
}

/** Open or fold the changes under one issue. */
export function toggleFold(issue: string): void {
  set({
    unfolded: state.unfolded.includes(issue)
      ? state.unfolded.filter((ref) => ref !== issue)
      : [...state.unfolded, issue],
  })
}

/** Open or fold every listed issue at once — a step's "expand all" and "fold all". */
export function setFolds(issues: readonly string[], open: boolean): void {
  const rest = state.unfolded.filter((ref) => !issues.includes(ref))
  set({ unfolded: open ? [...rest, ...issues] : rest })
}

/** What `lookup.ts` needs from this state beyond `live`. */
function around(): Around {
  return {
    framed: state.framed,
    withheld: state.withheld,
    marks: state.marks,
    settledBy: state.journey?.settledBy ?? {},
  }
}

/** Every card the open journey draws, filter or fold aside, in step order. */
function everyCard(): { ref: string; under: boolean; owner: string | null }[] {
  const journey = state.journey
  if (!journey || journey.plan === 'elsewhere') return []
  const out: { ref: string; under: boolean; owner: string | null }[] = []
  /* Only the steps in front of the person. A step outside the picked parts is
     not drawn, so its cards are not cards on this page: counting them in the
     filter's offer would be a number about things nobody can see. */
  for (const { step } of shownSteps(state.parts, journey.steps, state.editing)) {
    let owner: string | null = null
    for (const card of cardsUnder(state.live, step.refs ?? [])) {
      if (!card.under) owner = card.ref
      out.push({ ...card, owner: card.under ? owner : null })
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Opening a journey
 * ------------------------------------------------------------------ */

export async function open(slug: string | null): Promise<void> {
  /* Counted as a read in flight, so that a change announced while it runs is
     read after it and not beside it. See `readAgain`. The tracker's reading is
     asked once the count is back down: it waits on a host, which may take as
     long as it likes, and by then the journey is on screen and can be read
     again. */
  reading += 1
  try {
    await load(slug)
  } finally {
    reading -= 1
    payOwed()
  }
  await fill()
}

/** Put a journey on screen from the store, or say why there is none: `open`, without the trackers. */
async function load(slug: string | null): Promise<void> {
  /* Only the newest load may write, for the reason `fill` numbers its asks: two
     epic switches in a row leave two of these in flight, and the one that
     finishes last is not necessarily the one the canvas is standing on. The
     number is also advanced by `context` when the canvas moves, so a load for
     the epic just left is dropped even if no other load follows it. */
  const mine = ++loading
  const within = standingIn
  const current = () => mine === loading && standingIn === within
  if (!slug) {
    set({ journey: null })
    return
  }
  /*
   * The index is consulted before the journey is asked for, and a miss is not
   * a request.
   *
   * `GET /api/journey` answers 404 for a slug this project has no journey for,
   * which is the right answer for that door to give: it is a named resource
   * and it is not there. What was wrong was asking. A canvas standing on an
   * epic this project has never written a journey about produced that 404 on
   * every load, for as long as the epic stayed open — a red line in the
   * network tab, a counter in whatever is watching the port, and an error
   * class in a log, all for the ordinary and expected state of "this app does
   * not cover that epic". Somebody reading any of those goes looking for a
   * broken fetch, and there isn't one.
   *
   * `/api/journeys` is already fetched, holds every journey this project has,
   * and is the answer to the question. So it is asked instead, and the journey
   * door is only knocked on when the index says there is somebody in.
   *
   * The re-read on a miss is not belt-and-braces. This index can be stale by
   * seconds: an agent on the MCP door or a second container can write a
   * journey into the same store while this page is open, and a guard that
   * trusted a list read before that write would refuse to load a journey that
   * is on disk — turning a noisy 404 into a silent wrong answer, which is the
   * worse trade. One list request in the miss case buys the guard back.
   *
   * `nowhere` and `trouble` are not special-cased here. Both leave the index
   * empty, both make this a miss, and both are already drawn by `Nothing` with
   * their own sentence — a second fetch to be told 409 would add nothing to
   * what the page is about to say.
   */
  if (!listed(slug)) {
    await readIndex()
    if (!current()) return
    if (!listed(slug)) {
      set({ journey: null, editing: -1, adding: false, addingFor: null, said: '', unwritten: slug })
      settleParts()
      return
    }
  }
  const out = await get<{ ok: boolean; error?: string; journey?: JourneyView }>(
    '/api/journey',
    { slug },
  )
  if (!current()) return
  set({
    journey: out.ok && out.journey ? out.journey : null,
    unwritten: null,
    editing: -1,
    adding: false,
    addingFor: null,
    /* Nothing is said when there is nowhere to read. The screen for that is
       already on the page and says the whole thing; repeating the server's
       sentence in the answer line underneath would be the same news twice, and
       the answer line is for answering something the reader just did. */
    said: out.ok || state.nowhere ? '' : (out.error ?? 'no such journey here'),
  })
  settleParts()
}

/* ------------------------------------------------------------------ *
 * Being walked to the parts
 *
 * A host's bar draws the parts of the open epic, and for an epic with none it
 * offers one press that lands here: `kehikot.goto` naming `PARTS_REF`. A part
 * is a step, so "where this epic is divided" is one of four places:
 *
 *  - **no journey** — the offer to begin one, which is where the first part
 *    has to start;
 *  - **a journey with no step** — the box a first step is written in;
 *  - **a journey whose record is still in the older shape on disk** — nothing
 *    to open at all: the steps are parts already, the host is reading the
 *    file as it was, and this press is the deliberate one that stores it. See
 *    `Unsettled` in `store.ts`;
 *  - **a journey with steps, stored so** — nowhere. Every step is a part and
 *    there is nothing to divide, and the walk is answered "not found" with
 *    that sentence, so that a host can stop offering it.
 *
 * ## The walk usually arrives before the journey does
 *
 * A host that has just put this container on a canvas greets it and walks it
 * in the same breath, and the journey for the epic in that greeting is still
 * being fetched. So the walk is REMEMBERED (`partsWanted`) and settled when
 * the load lands. Asked before the journey is on screen it is answered
 * "found": one of the four is about to be true, and three of them are a
 * place. What is refused is what cannot be opened at all — no project, a
 * file that will not read, or a walk about an epic the canvas is not on.
 * ------------------------------------------------------------------ */

/** The epic whose parts a host asked to be shown, until it has been. */
let partsWanted: string | null = null

/** What a walk to the parts is told when every step is one already. */
export const NOTHING_TO_DIVIDE = 'Every step of this journey is a part of the epic already; there is nothing to divide.'

function openParts(epic: string | undefined): { found: boolean; why: string } {
  const slug = standingOn ?? state.journey?.slug ?? null
  if (!slug) return { found: false, why: 'No epic is open in this app, so there is nothing here to divide into parts.' }
  if (epic && epic !== slug) return { found: false, why: `This container is on ${slug}, not ${epic}.` }
  if (state.trouble) return { found: false, why: state.trouble }
  const on = state.journey?.slug === slug ? state.journey : null
  if (on && on.plan === 'elsewhere') {
    return { found: false, why: `The steps of ${slug} are kept in ${on.stepsFrom?.where ?? 'its paper'}, and a part is a step: it is divided there.` }
  }
  if (on && on.plan === 'stored' && !on.unsettled) return { found: false, why: NOTHING_TO_DIVIDE }
  partsWanted = slug
  settleParts()
  return { found: true, why: '' }
}

function settleParts(): void {
  const slug = partsWanted
  if (slug === null) return
  if ((standingOn ?? state.journey?.slug ?? null) !== slug) {
    /* The canvas moved on before the journey arrived. The walk was about the
       epic it left. */
    partsWanted = null
    return
  }
  const on = state.journey?.slug === slug ? state.journey : null
  if (on) {
    partsWanted = null
    if (on.unsettled) void settle()
    else if (on.plan === 'none') {
      setAdding(true)
      mark('[data-adding]')
    } else say(on.plan === 'stored' ? NOTHING_TO_DIVIDE : '')
    return
  }
  if (state.unwritten !== slug) return
  partsWanted = null
  mark('[data-begin]')
}

/**
 * Store the journey on screen as it is read, when its record on disk is still
 * in the older shape of parts. Nothing a person wrote changes; what changes
 * is that a host reading the file sees the parts this page already shows.
 */
export async function settle(): Promise<void> {
  const being = state.journey
  if (!being?.unsettled) return
  let out: { ok: boolean; error?: string; journey?: JourneyView; said?: string }
  try {
    out = await post('/api/settle', { slug: being.slug })
  } catch {
    say('This app could not reach its own store, so nothing was written.')
    return
  }
  if (!out.ok || !out.journey) {
    say(out.error ?? 'nothing was written')
    return
  }
  report(being.slug)
  if (state.journey !== being) return
  set({ journey: out.journey, said: out.said ?? 'kept' })
}

/**
 * Bring a place to the top of the page, and mark it — the mark `goTo` leaves
 * on a card, for the same reason. Called after a `set`, which flushed, so the
 * place is in the document.
 */
function mark(selector: string): void {
  const box = document.querySelector(selector)
  if (!box) return
  box.scrollIntoView({ block: 'start' })
  box.removeAttribute('data-found')
  void (box as HTMLElement).offsetWidth
  box.setAttribute('data-found', 'true')
  setTimeout(() => box.removeAttribute('data-found'), MARK_FOR_MS)
}

/** Which `load` is the newest. See the comment inside it. */
let loading = 0

/** Whether the index this page last read names that journey. */
function listed(slug: string): boolean {
  return state.index.some((row) => row.slug === slug)
}

/**
 * Read the index for whichever project this page is standing in.
 *
 * Separate from `start` because it now happens more than once: on the first
 * load, and again every time the host moves this container to a different project.
 * The second is the whole reason the reply carries `nowhere`, `trouble` and
 * `from` rather than just a list — a container that switched into a project whose
 * file will not parse must say so, and an empty array cannot.
 */
async function readIndex(): Promise<void> {
  try {
    const out = await get<{
      ok: boolean
      journeys?: Brief[]
      nowhere?: boolean
      trouble?: string | null
      from?: string | null
    }>('/api/journeys')
    set({
      index: out.journeys ?? [],
      nowhere: out.nowhere === true,
      trouble: out.trouble ?? null,
      from: out.from ?? null,
    })
  } catch {
    set({
      index: [],
      trouble:
        'This app could not read its own store. That is this program, not the host — the page is here and the '
        + 'server behind it is not answering.',
    })
  }
}

/* ------------------------------------------------------------------ *
 * Asking the host to edit the epic's list of parts
 *
 * The list of an epic's parts is the epic's, and a host from protocol 1.2.0
 * keeps it. This app keeps one step for a part, so four presses here are also
 * an edit of that list — a new step (add), a part's name (rename), a step
 * moved (move), a step removed (remove) — and each ASKS, with `parts.set`,
 * from the press and from nothing else.
 *
 * ## What the answer decides, and what it does not
 *
 * Only whether there is a part: the id the host made for a new step, or that
 * a rename, a move or a removal happened. It does NOT decide who keeps the
 * list. That is `keeper.ts`, read off the epic's own file by this app's
 * server at the write that follows — the same fact the host goes by. The two
 * agree by construction: a host that changes the list has written the file
 * before it answers.
 *
 * So every press is the same two moves, whichever host is there:
 *
 *  1. ask the host (`askParts`);
 *  2. write the step through this app's own store, saying what the host
 *     answered — the id of the part it made, when it made one.
 *
 * A host from before `parts.set` answers that it does not know the method
 * (`cannot`). Nothing was changed anywhere, the store finds that this app
 * still keeps the list, and the write is exactly the one it always was: the
 * part and its id are made here, and the name goes into the record.
 *
 * ## The order, and what a failure leaves
 *
 * A new step: the HOST FIRST, because the step is filed under an id only the
 * host can make. The store refuses an id the host does not list, so a step is
 * never written pointing at a part that was not made.
 *
 *  - The host declines, fails or does not answer in time: the step is still
 *    written — nothing typed is lost — in NO part, and the line under the
 *    page says so with the host's own reason. Its editor offers to make it a
 *    part again.
 *  - The host made the part and the store then failed: a part with no step.
 *    The editor stays open with every word, the id is remembered (`made`) so
 *    that Save again files the step under it rather than asking for a second
 *    part, and the part is offered beside "add a step" like any part with no
 *    step.
 *
 * A step removed: THE STORE FIRST. What the person asked for is that the step
 * goes; if the host then will not remove the part, it is a part with no
 * step, and the line says why. Renaming and moving ask the host first and
 * write the step whatever it answered.
 * ------------------------------------------------------------------ */

/** What came of asking the host for one edit of the epic's list of parts. */
export type Asked =
  /** It is so now: the list changed, or already was as asked. `id` is the part the edit was about. */
  | { said: 'done'; id: string | null; list: { id: string; name: string }[] }
  /** The host has no part by the id, or the `after`, that was named. Nothing changed. */
  | { said: 'gone' }
  /** The host answered that it will not, could not be understood, or did not answer. Nothing is known to have changed. */
  | { said: 'declined'; why: string }
  /** There is nobody to ask: no host, or one from before `parts.set`. Nothing changed. */
  | { said: 'cannot' }

/**
 * Ask the host for ONE edit of an epic's parts. Never throws.
 *
 * `cannot` is the honest reading of the one refusal that means "this host
 * does not have the method" (`unknown-method`), and of there being no host at
 * all. Every other failure is `declined`: a host that knows the method and
 * did not do it is not an older host, and is not treated as one.
 */
export async function askParts(epic: string, edit: Record<string, unknown>): Promise<Asked> {
  if (!greeted()) return { said: 'cannot' }
  try {
    const read = partsSetResult.safeParse(await host.request(SET_PARTS, { epic, ...edit }))
    if (!read.success) return { said: 'declined', why: `The host answered ${SET_PARTS} with something that is not an answer to it.` }
    const { outcome, id, parts, why } = read.data
    if (outcome === 'changed' || outcome === 'unchanged') return { said: 'done', id, list: parts }
    if (outcome === 'no-such-part') return { said: 'gone' }
    return { said: 'declined', why: why || 'The host declined, and did not say why.' }
  } catch (error) {
    if (error instanceof HostRefused && error.refusal.reason === 'unknown-method') return { said: 'cannot' }
    return { said: 'declined', why: error instanceof HostRefused ? error.refusal.error : (error as Error).message }
  }
}

/**
 * The part the host made for a step whose write then failed, by the box the
 * step was typed in. Save again files the step under it; closing the box
 * forgets it, and the part is then offered as any part with no step is.
 */
const made = new Map<string, string>()

/** A step's title or a typed name as a part's name: one line, no longer than a host takes. */
const asName = (said: string): string => said.replace(/\s+/g, ' ').trim().slice(0, LIMITS.TITLE)

/**
 * The part a step at zero-based `at` of `steps` comes after in the epic's
 * list: the part of the nearest step before it that is in one. `undefined`
 * when no step before it is in a part.
 */
function partBefore(journey: JourneyView, steps: readonly { part?: string }[], at: number): string | undefined {
  for (let i = at - 1; i >= 0; i -= 1) {
    if (inPart(journey, steps[i])) return stepPart(steps[i]) ?? undefined
  }
  return undefined
}

type Wrote = { ok: boolean; error?: string; journey?: JourneyView; said?: string }

/**
 * Presses of this page's own that are between asking the host and hearing
 * back from this app's store.
 *
 * A host that edits the list says so to every module at once — this one
 * included — as a context with a different list, and `context` answers a
 * different list by reading the journey again. For an edit this page asked
 * for, that read is a race with the write the press is about to make: landing
 * first, it would replace the journey on screen with one from before the
 * write, and the write's own answer — which is the newer — would then be
 * dropped as an answer nobody is waiting on, leaving the editor open over a
 * step that has been saved. So while one of these is in flight the read is
 * OWED instead (`relistOwed`), and paid once when the last of them is done:
 * by then the write's answer is on screen, with the list as the store read it
 * after the host wrote it.
 */
let writing = 0
let relistOwed = false

async function whileWriting<T>(work: () => Promise<T>): Promise<T> {
  writing += 1
  try {
    return await work()
  } finally {
    writing -= 1
    if (writing === 0 && relistOwed) {
      relistOwed = false
      readAgain()
    }
  }
}

/**
 * Save one step, whole.
 *
 * The WHOLE step, which is why the editor fills every field in from what is
 * stored rather than leaving it blank: a form that saved an empty body because
 * the box started empty would delete somebody's writing to record a change to
 * the title.
 *
 * `how.part` files a NEW step under a part the host already lists and that
 * has no step. `how.make` asks for a part for a step that EXISTS and is in
 * none. A new step without `how.part` asks for a part of its own. See the
 * essay above for the order and for what each failure leaves.
 */
export function saveStep(
  position: number,
  fields: { title: string; body: string; refs: string[]; notes: string[]; name?: string },
  how: { part?: string | null; make?: boolean } = {},
): Promise<void> {
  return whileWriting(() => savingStep(position, fields, how))
}

async function savingStep(
  position: number,
  fields: { title: string; body: string; refs: string[]; notes: string[]; name?: string },
  how: { part?: string | null; make?: boolean },
): Promise<void> {
  const being = state.journey
  if (!being) return
  const fresh = position > being.steps.length
  /* Held under the step's own name, worked out before the write moves anything. */
  const target = fresh ? addTarget(how.part ?? null) : targetOf(position - 1)
  const at = being.steps[position - 1]
  const id = at ? stepPart(at) : null
  const here = `${being.slug}|${target}`
  const { name: typed, ...step } = fields
  const name = asName(typed ?? '')

  let part: string | undefined
  let asked: Asked | null = null
  let renamed = false
  if (fresh && how.part) part = how.part
  else if (fresh || (how.make && !inPart(being, at))) {
    part = made.get(here)
    if (part === undefined) {
      const add = { name: name || asName(fields.title), after: partBefore(being, being.steps, fresh ? being.steps.length : position - 1) ?? (fresh ? undefined : null) }
      asked = await askParts(being.slug, { add })
      /* The part it was to come after has gone from the list since this page read it: last, then. */
      if (asked.said === 'gone') asked = await askParts(being.slug, { add: { name: add.name } })
      if (asked.said === 'done' && asked.id) {
        part = asked.id
        made.set(here, part)
      }
    }
  } else if (id && inPart(being, at) && name && name !== nameOfPart(being, at)) {
    asked = await askParts(being.slug, { rename: { id, name } })
    renamed = asked.said === 'done'
  }
  /* The canvas moved while the host was being asked: what was typed stays held, and nothing is written. */
  if (state.journey !== being) return

  let out: Wrote
  try {
    out = await post<Wrote>('/api/step', {
      slug: being.slug,
      /* By the id of its part where it has one: a step removed through the
         other door while this box was open has moved every position after it. */
      ...(id ? { step: id } : { position }),
      ...step,
      ...(part ? { part } : {}),
      /* The name is the record's to keep only while this app keeps the list,
         and not when the host has just taken it. */
      ...((being.listed ?? null) === null && !renamed && part === undefined ? { name: typed ?? '' } : {}),
    })
  } catch {
    out = { ok: false, error: 'This app could not reach its own store, so the step was not kept. What was typed is still here.' }
  }
  if (!out.ok || !out.journey) {
    say(out.error ?? 'that was not kept')
    return
  }
  made.delete(here)
  /* Said before the check below, not after it: the step is on disk whether or
     not the canvas has moved since, and the other containers on that epic are
     showing the journey from before it. */
  report(being.slug)
  /* Dropped if the canvas moved while this was in flight. The server has
     already refused a write whose ticket belonged to the previous project —
     that is what the ticket binding is for — but a write that landed just
     BEFORE the switch can still have its reply arrive just after, and setting
     the previous project's journey into state here would put it on screen
     under the new project's index. Same rule as `fill` below: an answer to a
     question nobody is waiting on is noise with a timestamp. */
  if (state.journey !== being) return
  /* Kept by the store: there is nothing left to hold for that box. */
  hold(target, null)
  const now = out.journey
  const saved = fresh ? now.steps[now.steps.length - 1] : now.steps[position - 1]
  const loose = (now.listed ?? null) !== null && !inPart(now, saved)
  let said = out.said || 'kept'
  if (asked?.said === 'declined' && loose) said = `Kept, in no part: the host did not add one. ${asked.why}`
  else if (asked?.said === 'cannot' && loose && (fresh || how.make)) {
    said = 'Kept, in no part: the list of this epic’s parts is kept by the host, and there is no host here to add one to it.'
  } else if (asked?.said === 'declined' && !fresh && !how.make) said = `Kept. The part was not renamed: ${asked.why}`
  set({ editing: -1, adding: false, addingFor: null, journey: now, said })
  /* The step may name references it did not name before, and the reading on
     screen was asked for the old ones. Not awaited: the save is done, and the
     states beside the references arrive when the host answers. */
  void fill()
}

/** What a step's part is called: the host's name for it where the host keeps the list, else the record's. */
export function nameOfPart(journey: JourneyView, step: { title?: string; part?: string } | undefined): string {
  const id = step ? stepPart(step) : null
  if (id === null) return ''
  const listed = journey.listed ?? null
  if (listed !== null) return listed.find((part) => part.id === id)?.name ?? ''
  return (journey.groups ?? []).find((group) => group.id === id)?.heading ?? ''
}

/**
 * Take the step at a zero-based position out of the journey — and its part
 * out of the epic's list.
 *
 * The store first; see the essay above. While this app keeps the list the
 * store's own write takes the part with the step, as it always did, and the
 * host is not asked. Where the host keeps it, the host is asked to remove the
 * part once the step is gone, and the line says what it answered.
 */
export function removeStep(index: number): Promise<void> {
  return whileWriting(() => removingStep(index))
}

async function removingStep(index: number): Promise<void> {
  const being = state.journey
  const step = being?.steps[index]
  if (!being || !step) return
  const id = stepPart(step)
  const target = targetOf(index)
  const out = await post<Wrote>('/api/step/remove', {
    slug: being.slug,
    ...(id ? { step: id } : { position: index + 1 }),
  })
  if (!out.ok || !out.journey) {
    say(out.error ?? 'that was not removed')
    return
  }
  report(being.slug)
  let now = out.journey
  let said = out.said ?? 'removed'
  if (id && (now.listed ?? []).some((part) => part.id === id)) {
    const asked = await askParts(being.slug, { remove: { id } })
    if (asked.said === 'done' || asked.said === 'gone') {
      now = { ...now, listed: (now.listed ?? []).filter((part) => part.id !== id) }
      said = `Removed step ${index + 1} (“${step.title}”), and its part with it.`
    } else if (asked.said === 'declined') said = `${said} The host did not remove it. ${asked.why}`
  }
  if (state.journey !== being) return
  hold(target, null)
  set({ editing: -1, journey: now, said })
  void fill()
}

/**
 * Move the step at a zero-based position one place up (`by` -1) or down (1).
 * The host is asked to move its part to match, first; the step moves whatever
 * the host answered, and the line says when the part did not.
 */
export function moveStep(index: number, by: -1 | 1): Promise<void> {
  return whileWriting(() => movingStep(index, by))
}

async function movingStep(index: number, by: -1 | 1): Promise<void> {
  const being = state.journey
  const step = being?.steps[index]
  const to = index + by
  if (!being || !step || to < 0 || to >= being.steps.length) return
  const id = stepPart(step)
  let asked: Asked | null = null
  if (id && inPart(being, step)) {
    const after = [...being.steps]
    after.splice(index, 1)
    after.splice(to, 0, step)
    asked = await askParts(being.slug, { move: { id, after: partBefore(being, after, to) ?? null } })
    if (state.journey !== being) return
  }
  const out = await post<Wrote>('/api/step/move', {
    slug: being.slug,
    ...(id ? { step: id } : { position: index + 1 }),
    to: to + 1,
  })
  if (!out.ok || !out.journey) {
    say(out.error ?? 'that was not moved')
    return
  }
  report(being.slug)
  if (state.journey !== being) return
  /* The editor follows its step; what is typed in it is held under the step's id, not its place. */
  set({
    editing: state.editing === index ? to : state.editing === to ? index : state.editing,
    journey: out.journey,
    said: asked?.said === 'declined' ? `${out.said ?? 'moved'} Its part was not moved in the epic’s list: ${asked.why}` : (out.said ?? 'moved'),
  })
}

/* ------------------------------------------------------------------ *
 * Gates, from the page
 *
 * A gate is marked done, or reopened, with one press; a note chip on a step is
 * made a gate with one press. Each is one write to this app's own store, through
 * the same writer the MCP door uses (`setGate`, `noteToGate` in `doors.ts`), and
 * the page takes the journey the store answers with.
 * ------------------------------------------------------------------ */

/** Who a press on this page is, in the record: there is no name for the reader here, so it says where. */
export const ON_THE_PAGE = 'a person, on the Journeys page'

/** Mark one gate done (recorded as `ON_THE_PAGE`, now) or open again. */
export function setGateState(id: string, to: 'open' | 'done'): Promise<void> {
  return whileWriting(() => writingGate('/api/gate', { gate: id, state: to, ...(to === 'done' ? { by: ON_THE_PAGE } : {}) }))
}

/** The note chip `note` on the step at a zero-based position, made a work gate that holds that step. */
export function makeGateOfNote(index: number, note: string): Promise<void> {
  const step = state.journey?.steps[index]
  if (!step) return Promise.resolve()
  const id = stepPart(step)
  return whileWriting(() => writingGate('/api/gate/from-note', { ...(id ? { step: id } : { position: index + 1 }), note }))
}

async function writingGate(path: string, body: Record<string, unknown>): Promise<void> {
  const being = state.journey
  if (!being) return
  const out = await post<Wrote>(path, { slug: being.slug, ...body })
  if (!out.ok || !out.journey) {
    say(out.error ?? 'that was not kept')
    return
  }
  report(being.slug)
  if (state.journey !== being) return
  set({ journey: out.journey, said: out.said ?? 'kept' })
  void fill()
}

/**
 * Begin a journey for the epic the canvas is standing on, which this project
 * has no record of.
 *
 * ## It asks the host first, and that is the point of the press
 *
 * A host answers an epic's steps and groups out of this app's record, and out
 * of its own file only where there is no record. So the record made here
 * REPLACES what the host has been answering with, for every module on the
 * canvas, the moment it exists — and an empty one would hide every step the
 * host held. The first record therefore has to be what the host holds, and the
 * host is right there: `epic.get`, asked once, and the answer handed to this
 * app's own store to become the record.
 *
 * A host that refuses — it was not granted, or it is older than the question —
 * is not a reason to make an empty record either. The store is then asked
 * with no seed, and reads the host's own file itself, as it must for an agent
 * on the MCP door; see `hostEpic` in `store.ts`. Either way the answer line
 * says which it was and how many steps came across, because "created" is the
 * same word for a journey begun from nine steps and one begun from none.
 *
 * From a press and from nothing else. Not when an epic with no journey is
 * opened: writing a file into somebody's repository because a tab was
 * selected is the seeding this app stopped doing, for the reason `store.ts`
 * gives at length.
 */
export async function begin(): Promise<void> {
  const slug = state.unwritten
  const project = standingIn
  if (!slug || !state.framed || standingOn !== slug || state.beginning) return
  const here = () => standingOn === slug && standingIn === project
  set({ beginning: true })
  try {
    await beginFrom(slug, here)
  } finally {
    set({ beginning: false })
  }
}

async function beginFrom(slug: string, here: () => boolean): Promise<void> {
  let seed: unknown = undefined
  if (greeted()) {
    try {
      seed = await host.request(GET_EPIC, { epic: slug })
    } catch {
      /* Refused or unanswered. The store reads the host's file instead. */
      seed = undefined
    }
  }
  /* The canvas moved while the host was being asked. Nothing has been written
     and nothing should be: the press was about the epic that was open then. */
  if (!here()) return

  const out = await post<{ ok: boolean; error?: string; journey?: JourneyView; said?: string }>('/api/journey', {
    slug,
    ...(seed && typeof seed === 'object' ? { seed } : {}),
  })
  if (!out.ok || !out.journey) {
    if (here()) say(out.error ?? 'that journey was not begun')
    return
  }
  /* Said whether or not the canvas has moved since: the record is on disk, and
     every container on that epic is showing what the host answered before it. */
  report(slug)
  if (!here()) return
  await readIndex()
  if (!here()) return
  /* `open`, taken apart, so that what was made is SAID as soon as it is on
     screen and not after the host has answered about the trackers — which it
     may take as long as it likes over, and the sentence is the only thing
     that says how many steps came across. */
  reading += 1
  try {
    await load(slug)
  } finally {
    reading -= 1
    payOwed()
  }
  if (here() && state.journey?.slug === slug) say(out.said ?? 'begun')
  void fill()
}

/**
 * Tell the host that this app's material for one journey has changed, so that
 * every container showing it reads it again.
 *
 * Called from `saveStep` and from `begin`, and from nowhere else: AFTER the store has answered
 * that the write was kept, because a container that re-reads at once must find
 * the new step, and never from a read — `readAgain` below answers these, and a
 * re-read that reported would be this page and the host telling each other the
 * same news for ever.
 *
 * Only the page's own writes are said here. A step written through the MCP
 * door is written by the server process, which has no channel to a host and is
 * not given one: the host watches `<project>/.kehikot/journeys/` and announces
 * that itself, as it does for somebody editing the file by hand.
 *
 * A refusal is not said to the reader. Nothing of theirs failed — the step is
 * kept, and the line under the page already says so — and the host that would
 * not hear this sees the folder move like any other outside write.
 */
function report(slug: string): void {
  if (!greeted()) return
  void host.request(REPORT_CHANGE, { epic: slug }).catch(() => {})
}

/* ------------------------------------------------------------------ *
 * Reading the journey again, because it changed
 *
 * `context.content` is the host saying whose material changed and for which
 * epic; `context` below turns the entries for what this page shows into one
 * string, and calls `readAgain` when that string moves. A step set through
 * this app's MCP door, a second Journeys container saving, somebody editing
 * `journeys.json` — all three arrive here the same way, and before this none
 * of them reached an open page short of reloading the window.
 *
 * ## The reader does not move
 *
 * The journey is swapped in state and nothing else is touched: not `unfolded`,
 * not `selection`, not `editing`, not `live`, not the line under the page.
 * There is no "loading" in between, so React keeps every node it can and the
 * container keeps its scroll. `open` is the wrong tool for exactly that reason
 * — it closes the editor and takes the journey off the screen on a miss — and
 * its other half, `load`, is only fallen back on when there is no journey on
 * screen to keep a place in.
 *
 * ## One read at a time, and one more if it is owed
 *
 * An agent setting six steps is six writes and, give or take the host's own
 * quiet period, several contexts. A read per context would be several answers
 * racing to be drawn. So a change that arrives while the journey is being read
 * — by `open` or by an earlier one of these — is remembered as OWED, and paid
 * with a single read when the one in flight lands, however many arrived. That
 * last read starts after the last change was announced, which is the only one
 * that has to be right.
 * ------------------------------------------------------------------ */

/**
 * Whose material this page draws out of a store, for `contentStamp`.
 *
 * This module and not the host as well, though the protocol's own example
 * names both. The host's entry is for the epics the host keeps, which is what
 * `epics.list`, `epic.get` and `steps.list` answer from, and this page asks
 * none of them: the journey, its steps and its prose come off this app's own
 * `/api`. What it does take from the host — the trackers' reading — has a
 * signal of its own in `context.tracker`.
 */
const KEPT_BY: readonly string[] = [ID]

/**
 * The entries of `context.content` for what this page shows, as the last
 * context had them, in the one string `contentStamp` makes of them;
 * `undefined` before any context.
 */
let material: string | undefined = undefined

/** The epic's list of parts as the last context had it — ids and names, in order — as one string; `undefined` before any context. */
let listedAs: string | undefined = undefined

/** Journey reads in flight: an `open`, or a `readAgain`. */
let reading = 0
/** A change was announced while one was in flight. */
let owed = false

function readAgain(): void {
  if (reading > 0) {
    owed = true
    return
  }
  reading += 1
  void reload()
    /* Nobody asked for this read, so nobody is told it failed. What is on
       screen is still the last thing that was read, and the next change — or
       the one owed — tries again. */
    .catch(() => {})
    .finally(() => {
      reading -= 1
      payOwed()
    })
}

/** The read that is owed, once nothing is in flight. */
function payOwed(): void {
  if (!owed || reading > 0) return
  owed = false
  readAgain()
}

async function reload(): Promise<void> {
  const had = state.journey
  const on = standingOn
  const within = standingIn
  /* The journey on screen, which is the canvas's epic except after a walk to
     a reference in another one; with nothing on screen, the canvas's epic,
     which may have just been given its first journey. */
  const slug = had?.slug ?? on
  if (!slug) return
  /*
   * An answer nobody is waiting on is dropped, as everywhere in this file.
   *
   * The canvas moving on is the obvious way to stop waiting. The other is the
   * journey on screen having been replaced while this was asked — by a save
   * made here, whose answer is the store's word from AFTER this question was
   * put, so drawing this one over it could take the reader's own step off the
   * screen until the next read.
   */
  const current = () => standingOn === on && standingIn === within && state.journey === had
  if (had) {
    const out = await get<{ ok: boolean; error?: string; journey?: JourneyView }>(
      '/api/journey',
      { slug },
    )
    if (!current()) return
    if (out.ok && out.journey) {
      /* The same journey, which is what this page's own save comes back as:
         the host tells the container that reported, too. Nothing is set, so
         nothing is drawn. */
      if (JSON.stringify(out.journey) === JSON.stringify(had)) return
      set({
        journey: out.journey,
        /* An editor stays open over the position it was opened on, with
           whatever has been typed into it. Only a step that is no longer
           there takes its editor with it. */
        editing: state.editing < out.journey.steps.length ? state.editing : -1,
      })
      announce()
      /* Always, and not only when the references changed: a reading still on
         its way was asked for the journey this one replaced, and `fill` drops
         the answer to that. The reading on screen stays until this one lands. */
      void fill()
      return
    }
    /* It was here and now is not: removed, or the file will no longer read.
       The index is what knows which, and `load` draws either. */
    await readIndex()
    if (!current()) return
  }
  await load(slug)
  void fill()
}

/**
 * What the trackers last said about this journey's refs, if there is a host
 * and it answers.
 *
 * Asked after the journey is already on screen — enrichment arrives late and
 * changes nothing about whether the page works — and asked AGAIN whenever the
 * host's shared reading moves: `context.tracker.at` changing is the host
 * saying somebody, somewhere in this project, read the trackers again. It used
 * to be asked once per journey and never again, and a page that loaded before
 * a refresh kept its old answer until somebody reloaded the window.
 *
 * Two questions, not one. The refs the journey names go first; the changes
 * their issues say close them are cards on this page and in no `refs` array,
 * so their rows are asked for second, for exactly those.
 */
async function fill(): Promise<void> {
  const being = state.journey
  void readFactory()
  if (!greeted() || !being) return
  /*
   * An answer to a question nobody is waiting on any more is dropped, and
   * there are two ways to stop waiting.
   *
   * The journey can change. Two `kehikot.context` messages in quick succession
   * — which is what switching epics twice looks like — leave two of these in
   * flight, and the slower one is not necessarily the older one. Without the
   * check the page draws the second epic's steps under the first epic's
   * tracker state, which is the one failure mode this app's whole shape is
   * against: two answers on one screen with nothing saying which is which.
   *
   * Or the reading can move again while this one is in flight, which it does
   * twice per refresh somewhere else on the canvas. Then a slow answer from
   * before would land on top of a quick one from after, and the page would go
   * back in time. So each ask takes a number, and only the newest is drawn.
   */
  const mine = ++asking
  const current = () => mine === asking && state.journey === being
  const refs = refsOf(being)
  if (!refs.length) {
    /* Nothing a tracker could answer, which is an answer: an empty reading,
       not a missing one. `tracker.get` takes at least one ref. */
    set({ live: readingOf([]), withheld: null, readFailed: null })
    announce()
    return
  }
  /* The reading this journey already has on screen, if any. While the host is
     reading again it answers `pending` for what it has not got to yet; those
     refs keep their last row rather than going blank (`heldOver`). */
  const before = state.live
  try {
    const first = await ask(refs)
    if (!current()) return
    const live = heldOver(before, readingOf(first))
    /* Drawn at once: the issues need not wait for the changes under them. */
    set({ live, withheld: null, readFailed: null })
    announce()
    const links = unreadLinks(live)
    if (!links.length) return
    try {
      const more = await ask(links)
      if (!current()) return
      set({ live: heldOver(before, readingOf([...first, ...more])) })
      announce()
    } catch {
      /* The issues are drawn and stay drawn; the changes under them are marked
         unread, which is what they are. One failed follow-up is not a reason
         to take a reading off the screen. */
    }
  } catch (e) {
    if (!current()) return
    const why = e instanceof HostRefused ? e.refusal.error : (e as Error).message
    /* A reading already on screen stays there: a read that failed while the
       host was reading again is not news that the issues have no state. The
       line under the page says the states are the reading before. */
    if (before) {
      set({ readFailed: why })
      return
    }
    /* No reading yet: said beside each reference, by its own badge, and nowhere above the journey. */
    set({ live: null, withheld: why })
    announce()
  }
}

/**
 * Where the Factory has this journey's step issues (`factory.ts` on the server). Read with every
 * `fill`, and every half minute while a journey is open, since a job moves on its own clock and
 * nothing tells this page. No Factory: an empty map, and the steps show nothing for it.
 */
async function readFactory(): Promise<void> {
  const being = state.journey
  if (!being) return
  const issues = [...new Set(treeOf(being.steps).map((node) => node.issue).filter((one): one is string => !!one))]
  if (!issues.length) {
    if (Object.keys(state.factory).length) set({ factory: {} })
    return
  }
  try {
    const out = await get<{ ok: boolean; jobs?: Record<string, FactoryJob> }>('/api/factory', { refs: issues.join(',') })
    if (state.journey !== being) return
    const jobs = out.ok && out.jobs ? out.jobs : {}
    if (JSON.stringify(jobs) !== JSON.stringify(state.factory)) set({ factory: jobs })
  } catch {
    /* No answer is no job. */
  }
}

if (typeof window !== 'undefined') setInterval(() => void readFactory(), 30_000)

/** Which `fill` is the newest. See the comment inside it. */
let asking = 0

/** Refs in groups a single tracker call may carry. */
function inGroups(refs: readonly string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < refs.length; i += LIMITS.TRACKER_ASK) out.push(refs.slice(i, i + LIMITS.TRACKER_ASK))
  return out
}

/**
 * `tracker.get` for these refs, a group at a time, each answer read against
 * the protocol's own shape. An answer that does not fit is a refusal in this
 * app's words, not a reading with holes in it.
 */
async function ask(refs: readonly string[]): Promise<TrackerReading[]> {
  if (!host.connection()) return []
  return Promise.all(
    inGroups(refs).map(async (group) => {
      const read = trackerReadingResult.safeParse(await host.request(GET_TRACKER, { refs: group }))
      if (!read.success) throw new Error(`the host answered ${GET_TRACKER} in a shape this app could not read`)
      return read.data
    }),
  )
}

/* ------------------------------------------------------------------ *
 * Reading the trackers again
 *
 * The host draws the control — the button, the "read at" line, the person's
 * auto-refresh interval — for a module that says `kehikot.refreshable`, and
 * relays a press as `kehikot.refresh`. A press here asks the host to read
 * THIS journey's refs again (`tracker.refresh`), says busy while it runs, and
 * re-reads when it lands. The host joins two presses into one read, and every
 * other container in the project hears about it through `context.tracker`.
 * ------------------------------------------------------------------ */

/** A press of ours is in flight. */
let pressed = false
/** The host says a read is in flight, from `context.tracker.refreshing`. */
let hostReading = false
/** When the host's shared reading last changed, as the last context said; `undefined` before any context. */
let readingAt: string | null | undefined = undefined

function busyNow(): boolean {
  return pressed || hostReading
}

/**
 * Read the trackers again for every ref this journey shows.
 *
 * Every ref the journey names, and every change the reading carried in under
 * an issue: those are cards too, and a refresh that left them stale would draw
 * an issue newer than the work under it.
 */
export async function refresh(): Promise<void> {
  const being = state.journey
  if (!greeted() || !being || pressed) return
  const refs = [...new Set([...refsOf(being), ...everyCard().map((card) => card.ref)])].filter(
    (ref) => readTrackerRef(ref) !== null,
  )
  if (!refs.length) return
  pressed = true
  set({ busy: true })
  let why = ''
  try {
    const outcomes = await Promise.all(
      inGroups(refs).map(async (group) =>
        trackerRefreshResult.safeParse(
          await host.request(REFRESH_TRACKER, { refs: group }, { within: TRACKER_REFRESH_WITHIN_MS }),
        ),
      ),
    )
    for (const outcome of outcomes) {
      if (!outcome.success) {
        why = `The host answered ${REFRESH_TRACKER} in a shape this app could not read.`
        break
      }
      if (outcome.data.outcome === 'declined') {
        why = `The host would not read the trackers again${outcome.data.why ? `: ${outcome.data.why}` : '.'}`
        break
      }
      if (outcome.data.outcome === 'failed') {
        why =
          'Not every tracker could be read again' +
          `${outcome.data.why ? `: ${outcome.data.why}` : '.'} What is shown is the last reading that worked.`
      }
    }
  } catch (error) {
    why =
      error instanceof HostRefused
        ? `The host would not read the trackers again (${error.refusal.error}). What is shown is the last reading.`
        : 'This app failed while asking the host to read the trackers again. What is shown is the last reading.'
  } finally {
    pressed = false
  }
  set({ busy: busyNow() })
  if (state.journey !== being) return
  say(why)
  await fill()
}

/** The last refresh offer sent, as JSON, so that an unchanged one is not sent again. */
let refreshOffer: string | null = null

/**
 * Say whether there is anything to read again, when it was last read, and
 * whether a read is running — whenever any of the three changes.
 *
 * Called from `set`, so that it cannot be forgotten on one path: every change
 * to the journey, the reading or `busy` goes through there. The same offer is
 * not sent twice. Standalone, or with no ref a tracker could answer, the
 * control is withdrawn: a button that cannot work teaches a person the button
 * does not work.
 *
 * `at` is the reading's own, as the host stamped it — never the time of the
 * press, which says when somebody asked and not what the page is showing.
 */
function offerRefresh(): void {
  if (!host.connection()) return
  const offer = {
    can: state.framed && refsOf(state.journey).length > 0,
    at: state.live?.at ?? null,
    busy: state.busy,
  }
  const key = JSON.stringify(offer)
  if (key === refreshOffer) return
  refreshOffer = key
  host.refreshable(offer)
}

/* ------------------------------------------------------------------ *
 * The filter, offered
 *
 * One `toggles` group called "hide", built by `offer()` from the shared
 * ref-facet vocabulary in `kehikot-module-protocol/facets` — the same group id
 * and the same option ids References offers, so "closed MRs/PRs" switched on
 * means the same thing in both containers. Nothing here keeps a copy of the
 * vocabulary; a facet the protocol learns arrives here with the next install.
 *
 * Counted, so each option says how many cards it would hide on this journey,
 * and a facet nothing here has is left out — except one that is switched on,
 * which `offer` keeps so a person can always switch off what they switched on.
 *
 * Re-offered whenever what it counts changes — a reading arriving, a journey
 * opening, a mark — and only then: the offer is the WHOLE offer every time,
 * and sending the same one on every selection tick would be a host redrawing a
 * menu for nothing. With nothing to count — no journey, or no reading, where
 * `sift` could hide nothing anyway — the offer is empty, which the protocol
 * reads as "nothing here can be narrowed now".
 * ------------------------------------------------------------------ */

/** The last offer sent, as JSON, so that an unchanged one is not sent again. */
let offered: string | null = null

function announce(): void {
  if (!host.connection()) return
  const facets = (ref: string) => facetsOfRef(state.live, ref, around())
  const counts = countFacets(
    everyCard().map((card) => card.ref),
    facets,
  )
  const groups = Object.keys(counts).length || state.hidden.length ? [offer({ counts, hidden: state.hidden })] : []
  const key = JSON.stringify(groups)
  if (key === offered) return
  offered = key
  host.filters(groups)
}

/**
 * Lift whatever part of the filter hides one reference, for a walk that was
 * aimed at it.
 *
 * The rule References keeps, for its reason: a walk that answered `found` with
 * the card filtered out would send a reader to a page where their reference is
 * not drawn, which is worse than the fallback link `found: false` gets them.
 * So the facets hiding it are ASKED off — the choice is the host's — and the
 * answer is read rather than assumed: what comes back is what the host
 * settled on, and only that goes into state.
 *
 * Answers null when the card is drawn now, or the host's reason when it is not.
 */
async function reveal(ref: string): Promise<string | null> {
  const blocking = facetsOfRef(state.live, ref, around()).filter((facet) => state.hidden.includes(facet))
  if (!blocking.length) return null
  if (!greeted()) return `${ref} is hidden by the filter, and there is no host to lift it.`
  const rest = state.hidden.filter((facet) => !blocking.includes(facet))
  const { [HIDE_GROUP]: _hide, ...others } = state.filters
  const filters: FilterChoice = rest.length ? { ...others, [HIDE_GROUP]: rest } : others
  try {
    const answer = await host.request('filters.set', { filters })
    const held = filterChoiceSchema.safeParse((answer as { filters?: unknown } | null)?.filters)
    if (!held.success) return 'The host answered that filter change in a shape this app could not read.'
    set({ filters: held.data, hidden: hiddenIn(held.data) })
    announce()
    const still = facetsOfRef(state.live, ref, around()).some((facet) => state.hidden.includes(facet))
    return still ? `The host kept ${ref} hidden by the filter.` : null
  } catch (error) {
    return error instanceof HostRefused
      ? `${ref} is hidden by the filter, and the host would not lift it (${error.refusal.error}).`
      : `${ref} is hidden by the filter, and this app failed while asking the host to lift it.`
  }
}

/* ------------------------------------------------------------------ *
 * Why a reference closed, said by a person
 *
 * The control on a closed card calls this, and nothing else does: like the
 * selection, a disposition is a person's word and is set from a press. What
 * comes back is a context carrying the new marks — the card is redrawn from
 * that, never from here, so a mark the host refused or changed is never shown
 * as if it held. `by` and `at` are the host's to fill in; the method does not
 * carry them.
 * ------------------------------------------------------------------ */

export async function markDisposition(
  ref: string,
  value: DispositionValue | null,
  target?: string,
): Promise<void> {
  if (!greeted()) {
    say('Nothing is framing this page, so there is nowhere to keep that mark.')
    return
  }
  const named = target?.trim()
  /* Only a duplicate or a superseded mark names another ref; the method
     refuses a target on anything else. */
  const names = Boolean(named) && (value === 'duplicate' || value === 'superseded')
  const params = names ? { ref, value, target: named, note: '' } : { ref, value, note: '' }
  try {
    await host.request('disposition.set', params)
    say('')
  } catch (error) {
    say(
      error instanceof HostRefused
        ? `The host would not keep that mark (${error.refusal.error}). Nothing has changed.`
        : 'This app failed while asking the host to keep that mark. Nothing has changed.',
    )
  }
}

/**
 * Open another epic's journey: the link on a ref that is also in that epic.
 *
 * Framed, the host owns which epic is open, so this asks it to move (`view.goto`, \`view:navigate\`)
 * and says in words what became of the ask. Standalone there is no host and the page owns its own
 * view, so it opens that journey itself.
 */
export async function goToJourney(epic: string): Promise<void> {
  if (!greeted()) {
    await open(epic)
    return
  }
  try {
    const answer = navigationResult.safeParse(await host.request('view.goto', { epic }))
    if (answer.success && answer.data.outcome !== 'moved') {
      say(
        answer.data.outcome === 'declined'
          ? `The host would not open ${epic} just now${answer.data.why ? ` (${answer.data.why})` : ''}.`
          : `The host has no epic ${epic}.`,
      )
    } else say('')
  } catch (error) {
    say(
      error instanceof HostRefused
        ? `The host would not open ${epic} (${error.refusal.error}).`
        : `This app failed while asking the host to open ${epic}.`,
    )
  }
}

/* ------------------------------------------------------------------ *
 * Being told where to go
 *
 * A host walks a reader to a reference by reaching into the panel's DOM: it
 * queries for the anchor, opens whatever is folded above it, scrolls it to the
 * middle and flashes it. That stops working the moment the panel is a module —
 * the frame is cross-origin and its document is unreachable.
 *
 * Protocol 1 had no answer, and this file carried a long note saying so, plus a
 * receiving end built against a message that did not exist. Protocol 2 has the
 * message, and the interesting part is not that it arrives: it is that it
 * carries a correlation id and the host WAITS. `kehikot.went` is the first and
 * only place the host depends on a module answering.
 *
 * Which changes what a walk has to do. The old code, told to go to a reference
 * in a journey it did not have loaded, started the load, remembered where it
 * was going and returned `true` — before anything had been looked for. The
 * protocol names that exact bug: answering `found: true` there is a guess, and
 * the host acts on it by NOT falling back to an ordinary link, so a wrong guess
 * is a press that lands nowhere and says nothing. So `goTo` is async and the
 * answer waits for the load, with the client holding a 900ms backstop shorter
 * than the host's own timeout.
 *
 * ## The walk still reads the DOM, and still should
 *
 * React draws the anchors now, and the temptation on porting was to answer this
 * question off the journey in state instead — no `querySelectorAll`, no
 * `data-ref`, just a search through the steps. That is the bug `refs.ts`
 * already documents at length, in its other form: a card on screen is not only
 * a reference somebody wrote into the journey, because for every issue a step
 * names the page also draws a card for each CHANGE the tracker attaches to it,
 * which the host read and this app never stored. Measured on
 * `files-stay-reachable`: of twenty-one cards drawn, ten are carried in by the
 * tracker's own links and none of them are in the journey on disk.
 *
 * So the page remains the authority on what the page is showing, `set` flushes
 * so that the page is up to date when this reads it, and there is exactly one
 * set of elements — the ones with `data-ref` on them — that both this and
 * `showSelection` consult.
 *
 * The fragment still works and is still the fallback:
 *
 *   /app#journey=modes-are-modules&ref=gh%2341
 *
 * read on load and again on every `hashchange`. It costs a navigation — the
 * document reloads and the handshake happens again — which is why it is the
 * fallback and not the answer.
 * ------------------------------------------------------------------ */

/** Somewhere to go once whatever is loading has loaded. */
let wanted: Target | null = null

/**
 * How a walk was asked for, which decides only one thing: whether a miss is
 * said out loud.
 *
 * `quiet` is for a walk nobody asked THIS container for — a selection the canvas
 * broadcast, which reaches every framed module at once. See `showSelection`.
 */
interface Walk {
  quiet?: boolean
}

/** How long the mark stays on the thing a walk landed on. */
const MARK_FOR_MS = 2600

export async function goTo(what: Target | null, how: Walk = {}): Promise<{ found: boolean; why: string }> {
  if (!what) return { found: false, why: 'that walk named nothing to walk to' }

  if (what.slug && state.journey?.slug !== what.slug) {
    /* Load first, THEN look. This is the line the protocol's essay on `went`
       is about. */
    await open(what.slug)
    if (state.journey?.slug !== what.slug) {
      return { found: false, why: `This app does not hold a journey called ${what.slug}.` }
    }
  }

  if (!state.journey) {
    wanted = what
    return { found: false, why: 'No journey is open in this app yet.' }
  }

  if (what.ref) {
    /* A card drawn inside a folded issue, or hidden by the filter, is not on
       the page to be found. The fold is this page's own and is simply opened;
       the filter is the host's and is asked — and only for a walk aimed at
       this container, never for a quiet one: a click in another container is
       not a reason to change what this one is narrowed by. */
    const owners = everyCard()
      .filter((card) => card.ref === what.ref && card.owner)
      .map((card) => card.owner as string)
    if (owners.some((owner) => !state.unfolded.includes(owner))) setFolds(owners, true)
    if (!how.quiet) {
      const kept = await reveal(what.ref)
      if (kept) {
        say(kept)
        return { found: false, why: kept }
      }
    }
  }

  let target: Element | null = null
  if (what.ref) {
    /*
     * Every anchor, not only the ones inside a card — but a card wins over a
     * sentence wherever there is one, even a sentence higher up the page.
     *
     * A reference reaches this page two ways. It is listed as a step's work, in
     * which case it becomes a card with the tracker's state, its labels and a
     * rail; or it is written into a paragraph, in which case `Prose` turns it
     * into a bare link and nothing more. This used to look only inside cards,
     * and a journey that discusses a reference in its callout without listing
     * it against a step answered "nothing here names that" — false, and false
     * in the direction that makes a host give up and open an ordinary link.
     *
     * The order is the reason this is a loop with a memory rather than one
     * `querySelector`. Document order would hand back the callout's mention of
     * `gh#1802` and scroll a reader to a sentence about the reference when the
     * card for it — the thing with the state on it, the thing they clicked in
     * the other container — is four steps further down. Measured: on
     * `files-stay-reachable` the page draws 21 cards and 37 anchors naming 23
     * distinct references, so two of them exist only in prose and several
     * appear in a sentence before the card that carries their state.
     */
    let anywhere: Element | null = null
    for (const anchor of document.querySelectorAll('a[data-ref]')) {
      if (anchor.getAttribute('data-ref') !== what.ref) continue
      const inCard = anchor.closest('[data-card]')
      if (inCard) {
        target = inCard
        break
      }
      anywhere ??= anchor
    }
    target ??= anywhere
  } else if (what.step) {
    target = document.querySelector(`[data-step="${String(Number(what.step) || 0)}"]`)
  } else {
    /* An epic and nothing else. The switch above IS the walk, and it happened. */
    return { found: true, why: '' }
  }

  if (!target) {
    /* A step that is there and not drawn is not a step this journey lacks.
       Under a focus the two are different answers, and the second sends a
       host looking for a step that is one press in its own bar away. */
    const steps = state.journey.plan === 'elsewhere' ? [] : state.journey.steps
    const outside = what.ref
      ? steps.some((step) => (step.refs ?? []).includes(what.ref as string) && !stepInFocus(state.parts, step))
      : steps.some((step, i) => i + 1 === Number(what.step) && !stepInFocus(state.parts, step))
    const why = outside
      ? `${what.ref ? `${what.ref} is named by a step` : `Step ${what.step} is`} outside the parts picked in the ` +
        'host’s bar, so it is not on this page. Clear the picked parts there to see it.'
      : what.ref
        ? `Nothing in this journey names ${what.ref}.`
        : `This journey has no step ${what.step}.`
    if (!how.quiet) say(why)
    return { found: false, why }
  }

  /*
   * The mark goes on as an attribute rather than through React state.
   *
   * It is the one thing on this page that is genuinely about a DOM node and not
   * about the journey: which of these boxes the reader was just sent to. Routing
   * it through state would mean the journey re-rendering twice per walk — once
   * to mark and once to unmark — and the second of those would land in the
   * middle of the reader's scroll, which is precisely the thing the walk exists
   * to place.
   *
   * The forced reflow between removing and adding is what restarts the
   * animation when the same element is walked to twice in a row. Without it the
   * class never leaves the element between the two frames, the animation is
   * never re-triggered, and a second press on the same reference looks like a
   * press that did nothing.
   */
  target.scrollIntoView({ block: 'center' })
  target.removeAttribute('data-found')
  void (target as HTMLElement).offsetWidth
  target.setAttribute('data-found', 'true')
  const marked = target
  setTimeout(() => marked.removeAttribute('data-found'), MARK_FOR_MS)
  return { found: true, why: '' }
}

/**
 * The fragment, parsed. Bounded like everything else that arrives from outside:
 * a ref is at most 200 characters, a step is a small number, a slug is a slug.
 */
export function fromHash(): Target | null {
  const raw = String(location.hash || '').replace(/^#/, '')
  if (!raw) return null
  const out: Target = {}
  let seen = false
  const parts = raw.split('&')
  for (const part of parts.slice(0, 8)) {
    const [rawKey = '', ...rest] = part.split('=')
    const key = decodeURIComponent(rawKey)
    const value = decodeURIComponent(rest.join('=')).slice(0, 200)
    if (key === 'ref' && value) {
      out.ref = value
      seen = true
    } else if (key === 'step' && value) {
      out.step = Math.max(1, Math.min(999, Number(value) || 0))
      seen = true
    } else if ((key === 'journey' || key === 'epic') && /^[a-z0-9-]{1,80}$/.test(value)) {
      /* Both spellings. `journey` is what every link written before protocol 2
         says, and those links are in people's notes and in this repository's
         own prose; `epic` is what the wire calls it now. Accepting one and
         breaking the other would be a rename charged to whoever wrote the
         bookmark. */
      out.slug = value
      seen = true
    }
  }
  return seen ? out : null
}

window.addEventListener('hashchange', () => {
  const where = fromHash()
  if (where) void goTo(where)
})

/* ------------------------------------------------------------------ *
 * The host, when there is one
 * ------------------------------------------------------------------ */

/*
 * The protocol's `hostStore`: the listener, the grace before saying nobody is framing this page,
 * the theme on <html>, and the reload of a page older than its server. Its standing arrives
 * flattened and steady; `context` below is what this page makes of it. Handlers are called after
 * the standing has changed, so a greeting is `context` and then `grow`, in that order.
 */
const host = hostStore(
  ID,
  {
    onHello: () => grow(),
    /* A press on the host's refresh control, or the interval somebody set for
       this container. The same either way; see `refresh`. */
    onRefresh: () => void refresh(),
    onGoto: (goto, answer) => {
      /* The one reference that is not a card: a host asking for the place
         this epic is divided into parts. See `PARTS_REF`. */
      if (goto.ref === PARTS_REF) {
        const out = openParts(goto.epic)
        answer(out.found, out.why)
        return
      }
      void goTo({ ref: goto.ref, step: goto.step, slug: goto.epic }).then((out) => answer(out.found, out.why))
    },
  },
  /* 900ms, this module's own number rather than the client's 500, because
     `goTo` above is async: it may have to load a journey before it can
     honestly say whether the reference is in it. */
  { gotoBackstop: 900 },
)
host.subscribe(() => {
  const standing = host.get()
  if (standing.context) context(standing, standing.context)
  else set({ where: standing.where })
})

/** Whether a host has greeted this page: whether there is anybody to ask. */
const greeted = (): boolean => host.connection()?.greeted() ?? false

/**
 * Say how tall we would like to be.
 *
 * Called from an effect after every commit rather than at the end of a draw,
 * which is the one place the port genuinely changed the shape: React decides
 * when the DOM is finished and `scrollHeight` read before it is finished is a
 * number for the previous page. Fire and forget either way — a host is entitled
 * to ignore it, and this page is readable in whatever height it is given.
 */
/**
 * The cover's Try again, after this app's own server did not answer.
 *
 * Asks whether it is there (which is what moves the cover), and only if it is: takes the project's
 * write ticket out again — the failed attempt left none — reads the index again, and opens the
 * journey the canvas is standing on IF nothing is open. A journey that is already on screen is
 * left exactly as it is, editor and all: this must not cost anybody what they had typed.
 */
export async function retry(): Promise<void> {
  if ((await probeServer()) !== 'up') return
  if (typeof standingIn === 'string') await standIn(standingIn)
  if (state.scope === 'project') return readEverything()
  await readIndex()
  if (!state.journey && standingOn) await open(standingOn)
}

export function grow(): void {
  host.resize(document.body.scrollHeight + 32)
}

/**
 * Which journey this container is standing on, as the last context named it.
 *
 * Three values and not two. A slug is a journey; `null` is the host saying no
 * epic is open; `undefined` is no context having been read at all. Collapsing
 * the last two would make the first context of a conversation that names no
 * epic look like a repeat of a state this page was already in, and the picker
 * belonging to that state would never be drawn.
 */
let standingOn: string | null | undefined = undefined

/**
 * What the canvas last said was picked, exactly as it arrived.
 *
 * Kept so that a context can be told apart from the context before it. See
 * `context` below for why that comparison is the whole design.
 */
let picked: string[] = []

/**
 * The selection this page last ASKED for, until the host has echoed it.
 *
 * ## Why a pick made here must not walk here
 *
 * Every `selection.set` comes back as a context, and `context` below answers a
 * changed selection by scrolling to the first reference on this page that is
 * in it. That is right when the pick was made in another container — it is the
 * whole of `showSelection` — and wrong when it was made in this one: a person
 * ticks step six, the host echoes six's references, and the page they are
 * reading yanks itself up to step six's first card. They were already there.
 * Worse, ticking step one after step six would scroll them AWAY from what they
 * had just pressed, because step one's refs are at the front of the list.
 *
 * So what was asked for is remembered, and a context carrying exactly that
 * list is taken as the echo and not walked. Only exactly that list: a host
 * that clamped or reordered it has changed the pick, and a changed pick is
 * somebody else's news and is shown. Cleared the moment it is matched, so a
 * later identical pick from another container is treated as what it is.
 */
let asked: string[] | null = null

/**
 * Which project this container is standing in, as the last context named it.
 *
 * Three values for the same reason `standingOn` has three. A path is a project;
 * `null` is the host saying it has no folder to point at; `undefined` is no
 * context having been read at all. The first context of a conversation that
 * names no project has to be told apart from a repeat of it, because the first
 * one moves this page out of the state it starts in and a repeat must not
 * re-fetch anything.
 */
let standingIn: string | null | undefined = undefined

/** Which scope the last context named; `undefined` before any. See `State.scope`. */
let scopedAs: 'epic' | 'project' | undefined = undefined

/** The newest read of every journey, so an older one that finishes last is dropped. */
let readingAll = 0

/**
 * Every journey of the project, for "All epics": the index read again, then each journey read
 * whole, in the index's order. Only while the host is still on "All epics" in the same project
 * when the answers come back.
 */
async function readEverything(): Promise<void> {
  const mine = ++readingAll
  const within = standingIn
  const current = () => mine === readingAll && standingIn === within && state.scope === 'project'
  await readIndex()
  if (!current()) return
  const read = await Promise.all(
    state.index.map((brief) =>
      get<{ ok: boolean; journey?: JourneyView }>('/api/journey', { slug: brief.slug })
        .then((out) => (out.ok && out.journey ? out.journey : null))
        .catch(() => null),
    ),
  )
  if (!current()) return
  set({ everything: read.filter((one): one is JourneyView => one !== null) })
}

/**
 * What the host says this canvas is looking at.
 *
 * ## A context is no longer a synonym for "the reader moved"
 *
 * It used to be, and this function was written on that assumption: any context
 * for the journey already open meant "you were hidden and are visible again",
 * so it re-asked `live.get` and redrew. That was defensible when the only
 * things in a context were the epic and the theme.
 *
 * It is now wrong, because the canvas broadcasts a context after every
 * `selection.set` — including ones this container did nothing to cause, a few
 * milliseconds after somebody clicked a row in another container. Re-asking on each
 * of those would throw away the reading and redraw the whole journey every time
 * a reference was clicked: the steps would vanish and come back, and the
 * reader's scroll position — the very thing the click was about to move — would
 * be reset out from under the walk. References met this first and its
 * `use-kehikot.ts` carries the long version; the failure looks like a bug in
 * whichever container was clicked, which is the wrong container to go and read.
 *
 * So each field is acted on when IT changes, and a context that changed nothing
 * this page draws is a normal, frequent, silent event.
 *
 * The cost, stated plainly: this container no longer refetches when a host re-sends
 * the same epic to mean "you are visible again". That was never a promise the
 * protocol made, and the fix if it is ever wanted is a context field saying so
 * — not a refetch on every tick of somebody else's list.
 *
 * There is such a field now for the thing that refetch was mostly standing in
 * for: `content` says when the journey itself was changed, and it is acted on
 * like every other field here — when it changes. See `readAgain`. A context
 * that re-sends the same epic with the same `content` still fetches nothing.
 *
 * `context.epic` is the protocol-2 spelling; it was `slug` in protocol 1, and
 * this one field is the whole of the rename as this app experiences it. It is
 * nullable rather than absent when nothing is open, which matters: "no epic" is
 * a state this app has to be able to move INTO, and a field that simply
 * disappeared would leave the last journey on screen under a heading that no
 * longer applies.
 *
 * ## `projectPath` is the field that changes WHICH STORE this container is reading
 *
 * Every other field in a context changes what is drawn out of one store. This
 * one changes the store: the journeys live in `<projectPath>/.kehikot/`, so a
 * new project is a different file, a different index, and a different answer to
 * every question the page has already asked.
 *
 * So it is handled first and it invalidates everything. The index is re-read,
 * the write ticket is taken out again for the new project — awaited, so that a
 * save cannot go out between the two carrying the ticket for the old one — and
 * only then is the epic acted on. Doing it in the other order would fetch a
 * journey by slug from whichever project the page had last been standing in,
 * and slugs are short, lower-case and hand-picked: `bridge` and `wire` are real
 * epic slugs, and a second project would plausibly use both. The wrong journey
 * would be drawn under the right name.
 *
 * It is also why `moved` for the epic is forced when the project changes even
 * if the epic did not. The same slug in a different project is a different
 * journey, and the comparison that says "you are already showing this" is only
 * true within one store.
 */
function context({ epic: named, projectPath: project, projectId: id, selection: chosen, chosen: filters, parts }: HostStanding, next: ModuleContext): void {
  const slug = named !== null && /^[a-z0-9-]{1,80}$/.test(named) ? named : null

  /* `epic` goes into state beside `framed`, in the same patch, because the two
     are one fact about this context and a page rendered between them would be
     framed by a host that had not yet said what it was looking at. It is kept
     here as well as in `standingOn` below because the page has to be able to
     say WHICH epic it holds no journey for, and `standingOn` is private to
     this module. A slug that failed the shape test above is recorded as
     nothing named: it is not a name this app could hold a journey under, and
     quoting somebody else's malformed field back at a reader who can do
     nothing with it is not information. */
  /* The echo of this page's own pick is still the truth about the canvas and
     goes into state like any other — it is only the WALK that is skipped. See
     `asked`. */
  const echoed = asked !== null && samePick(chosen, asked)
  if (echoed) asked = null
  const repicked = !echoed && !samePick(chosen, picked)
  picked = [...chosen]

  /* The selection rides in the same patch as `framed` and `epic`: all three are
     one fact about this context, and a page rendered between them would draw a
     step as picked under a heading the host had not yet named. */
  /* The tracker signal: re-read when the reading moved, and say busy while
     somebody is reading. Only a CHANGE of `at` is news — the first context
     sets it, and the journey that context opens is read anyway. */
  const signal = next.tracker ?? { at: null, refreshing: false }
  const reread = readingAt !== undefined && signal.at !== readingAt
  readingAt = signal.at
  hostReading = signal.refreshing
  /* The content signal, by the same rule: only a CHANGE is news, and only for
     this app's journeys and the epic this context names. Another epic makes
     another string, which is harmless — that context opens its journey below
     and never reaches the line that reads this. */
  const stamp = contentStamp(next.content, { sources: KEPT_BY, epic: slug })
  const rewritten = material !== undefined && stamp !== material
  material = stamp
  /* The epic's list of parts, by the same rule: only a CHANGE of the list —
     an id, a name, the order; not what is picked — is news. Somebody edited it
     in the host's picker, and which steps are in a part, what each part is
     called and which parts have no step are read off the store again. */
  const list = parts.map((part) => `${part.id}\u0000${part.heading}`).join('\u0001')
  const relisted = listedAs !== undefined && list !== listedAs
  listedAs = list
  /* "All epics" (protocol 2.9.0): every journey, by epic. Absent from an older host: one epic. */
  const scope = scopeOf(next)
  const rescoped = scopedAs !== scope
  scopedAs = scope
  set({
    scope,
    /* Leaving "All epics" drops its list; arriving starts it empty until it is read. */
    ...(rescoped ? { everything: null } : {}),
    framed: true,
    where: 'hosted',
    projectPath: project,
    projectId: id ?? null,
    epic: slug,
    selection: picked,
    /* The focus rides in the same patch for the reason the selection does: a
       page rendered between them would draw every step under a bar that says
       it is narrowed. Nothing is fetched for it — the steps are already here,
       and which of them are shown is decided where they are drawn. */
    parts,
    marks: next.dispositions ?? [],
    filters,
    hidden: hiddenIn(filters),
    busy: busyNow(),
  })

  const relocated = standingIn !== project
  standingIn = project

  const moved = relocated || standingOn !== slug
  standingOn = slug
  /* A read owed to the journey this container was standing on is not owed to
     the one it is about to open. */
  if (moved) {
    owed = false
    loading += 1
    /* Whatever was known to be missing was missing for the epic just left. */
    set({ unwritten: null })
  }

  if (relocated) {
    /* Everything read out of the old store goes, before anything is fetched
       from the new one. A journey left on screen while its replacement is in
       flight is the previous project's material under the current project's
       name, which is a worse half-second than an empty container. */
    set({ index: [], journey: null, live: null, withheld: null, readFailed: null, said: '' })
    announce()
    void standIn(project)
      .then(async (issued) => {
        /* A context that arrived while this was in flight has already moved us
           on. Whatever comes back belongs to a project nobody is standing in. */
        if (standingIn !== project) return
        await readIndex()
        if (standingIn !== project) return
        if (!issued.ok && !state.nowhere) {
          /* Reads still work; writes will not. Said rather than swallowed,
             because the alternative is an editor that saves into a refusal. */
          say(issued.error ?? 'this app could not take out a write ticket for this project')
        }
        if (scope === 'project') await readEverything()
        else if (slug) {
          await open(slug)
          if (repicked) showSelection()
        }
      })
      .catch(() => {
        if (standingIn === project) say('This app could not read its own store. That is this program, not the host.')
      })
    return
  }

  if (!slug) {
    /* Only when it changed. A repeated "nothing is open" is the host talking
       about something else — a theme, a selection in a canvas with no epic —
       and redrawing an empty container on each of those is work nobody sees except
       as a flicker. */
    if (moved) set({ journey: null, live: null, withheld: null, readFailed: null })
    announce()
    /* "All epics": read every journey when arriving, and again when any of them changed. */
    if (scope === 'project' && (rescoped || rewritten || state.everything === null)) void readEverything()
    return
  }

  if (moved) {
    /* The journey goes with the epic, as it does with the project: until the
       new one arrives the previous one would be drawn under the new epic's name
       with its tracker states blank. */
    set({ journey: null, live: null, withheld: null, readFailed: null })
    /* The selection is applied AFTER the journey is on screen, not beside the
       request for it. A walk into a document that has not been fetched finds
       nothing, and `goTo` would honestly report so; the reader would see the
       right journey arrive with no indication of where the thing they clicked
       is. `open` already awaits its own fetch, so chaining is the whole fix. */
    void open(slug).then(() => {
      if (repicked) showSelection()
    })
    return
  }

  /* Marks and the filter may have changed, and the offer counts both. */
  announce()
  if (repicked) showSelection()
  /* Somebody read the trackers again — a press here, in another container, or
     the project's own schedule — and what is on screen is the reading before. */
  if (reread) void fill()
  /* Somebody changed the journey itself — an agent on this app's MCP door,
     another container, an edit to the file — and what is on screen is the
     journey from before. */
  if (rewritten) readAgain()
  else if (relisted) {
    /* Not beside a write of this page's own: see `whileWriting`. */
    if (writing > 0) relistOwed = true
    else readAgain()
  }
}

/**
 * Somebody picked a reference somewhere on this canvas. Show it, if it is here.
 *
 * ## Why this is three lines and not a feature
 *
 * Everything hard about "show me this reference" was already solved for
 * `kehikot.goto`: finding the anchor, preferring the card over a bare link,
 * scrolling it to the middle, marking it, and doing all of that only once the
 * journey is loaded. A second path that meant the same thing would drift from
 * that one, and the one that drifted would be this one — because `goto` is the
 * path a host exercises and this one only fires when two containers are open at
 * once. So this decides WHICH reference and hands the walking to `goTo`.
 *
 * ## When the journey does not name any of them
 *
 * Nothing happens. Not an error, not a message, not a cleared mark — the page
 * simply stays where it is. This is the ordinary case rather than the
 * exceptional one: the canvas broadcasts to every framed module, most
 * selections are about a reference some other container is showing, and a journey
 * that does not mention it has been told a fact that is true and not about it.
 *
 * Saying so was considered and rejected. The line under the page is this app's
 * way of answering the reader — "no such journey here", "the host refused
 * tracker.get" — and filling it with "nothing in this journey names gh#131" every
 * time somebody clicks a row in another container would turn the one place this app
 * talks to a person into a running commentary on other containers' clicks. Worse, it
 * would be blaming this journey for a click that was never aimed at it. That is
 * why `goTo` is asked for a quiet walk here and a loud one for `kehikot.goto`:
 * one of the two was aimed at this container.
 *
 * A quiet miss is also what makes an empty selection free: clearing a pick
 * sends `[]`, `firstShown` answers `null`, and the page stands still rather
 * than un-marking something the reader may still be reading.
 *
 * The mark from a previous selection is deliberately not cleared either. It
 * fades on its own timer inside `goTo`, and yanking it away early would mean a
 * selection about another container visibly editing this one.
 */
function showSelection(): void {
  /* What this page is showing, read off the page. Every reference on screen is
     an anchor, whether it came from a step's own list, from a sentence `Prose`
     split, from a blocker, or from a change the tracker attaches to an issue —
     and that last kind is only knowable here, because it comes out of the
     host's reading rather than out of the journey on disk. The alternative was
     to scan the journey document, which is what this did first and which
     quietly answered "not here" about ten of the twenty-one cards on a real
     epic. */
  const shown = new Set<string>()
  for (const anchor of document.querySelectorAll('a[data-ref]')) {
    const ref = anchor.getAttribute('data-ref')
    if (ref) shown.add(ref)
  }
  /* And the changes folded under an issue, which are on the page in every
     sense but the DOM's: `goTo` opens the fold before it looks. Not the ones
     the filter hides — a quiet walk does not lift the filter. */
  for (const card of everyCard()) {
    if (card.owner && !facetsOfRef(state.live, card.ref, around()).some((f) => state.hidden.includes(f))) {
      shown.add(card.ref)
    }
  }

  const ref = firstShown(shown, picked)
  if (!ref) return
  /* No `slug`: a selection says what was picked and never which epic it was
     picked in, on purpose — see the protocol's essay on `selection`. Walking to
     a bare ref searches the journey that is open, which is the only journey
     this container could honestly be talking about. */
  void goTo({ ref }, { quiet: true })
}

/* ------------------------------------------------------------------ *
 * Picking, from this side
 *
 * The other half of `showSelection`. That one is this page being TOLD what is
 * picked; these are this page SAYING so — a person ticks a step, and the
 * references that step carries go to the host, which holds them and tells
 * every framed module, this one included. It is the act References performs
 * when a row is picked, arriving here for the reason the protocol's essay on
 * `selection` gives: a canvas with a list of references in one container and a
 * journey in another should let a person narrow the first to what the second
 * is about, and neither module may know the other exists. The host is the only
 * party that may join them, so the pick goes to the host.
 *
 * ## Only ever from a press
 *
 * Nothing in this file calls `selection.set` except the two functions below,
 * and both are reached from a click handler and from nowhere else. Not from a
 * render, not from `context`, not from `open`, not when the epic changes. That
 * restriction is the most important line in this section: the selection is the
 * PERSON'S, and a module that wrote it because it had re-rendered, or because
 * the canvas moved to another epic, would be overwriting a pick made in another
 * container with nothing on screen to say why it had gone. An epic switch
 * leaves the selection alone on purpose — a reference picked in References is
 * no less picked for this page having turned to a different journey.
 * ------------------------------------------------------------------ */

/**
 * Add a step's references to the canvas selection, or take them off it.
 *
 * `togglePick` decides which; this decides whether there is anybody to tell.
 * The list that goes out is what the host last said plus or minus this step,
 * because the host's word is the only current selection there is — a page
 * that toggled against a list it remembered from its own last press would
 * silently drop whatever a neighbouring container picked in between.
 *
 * What comes back is a context, not an answer; the tick on the step is drawn
 * from that context and never from here. A refusal is the one thing said
 * directly, because its symptom is a checkbox that will not tick and a page
 * that looks broken. The clipping to `LIMITS.REFS` is explained in `bounded`;
 * this is where the reader hears how many were left off, since a press that
 * quietly sent less than it said would be the page inventing a smaller pick.
 */
export function pick(refs: readonly string[]): void {
  send(togglePick(picked, refs))
}

/** Take everything off the canvas selection — this page's picks and everybody else's. */
export function clearPick(): void {
  send([])
}

function send(wanted: string[]): void {
  if (!greeted()) {
    /* Standalone. Not a refusal — there is nobody to refuse — but a press that
       did nothing needs a sentence, and the controls are hidden when the page
       knows it is alone, so reaching this means the host has gone quiet. */
    say('Nothing is framing this page, so there is no canvas to put a pick on.')
    return
  }
  const { refs, dropped } = bounded(wanted, LIMITS.REFS)
  asked = refs
  say(dropped ? `A canvas holds at most ${LIMITS.REFS} references at once, so the last ${dropped} were left off.` : '')
  void host.request('selection.set', { refs }).catch((error: unknown) => {
    asked = null
    say(
      error instanceof HostRefused
        ? `The host would not record that pick (${error.refusal.error}). Nothing on the canvas has changed.`
        : 'This app failed while asking the host to record that pick. Nothing on the canvas has changed.',
    )
  })
}

/* ------------------------------------------------------------------ *
 * Start
 *
 * The store first, always. If a host greets us in the meantime it will say
 * which epic is open and that wins; if none ever does, the page is already
 * whole.
 *
 * The host is listened for BEFORE the first fetch, and that ordering is the whole
 * point of the client's `mailbox`: the greeting arrives on the frame's `load`
 * event and is replayed to whoever subscribes, so the only way to lose it is to
 * subscribe from inside something that resolves later than a network call. It
 * is also why this is called from `main.tsx` before `createRoot`, rather than
 * from an effect — an effect runs after the first commit, which is after the
 * greeting has already been posted and thrown away.
 * ------------------------------------------------------------------ */

export function start(): void {
  host.start()

  const where = fromHash()
  /*
   * The first read goes out with no project, and that is not a mistake.
   *
   * A page standing alone has no canvas to tell it where it is, so the server
   * answers `nowhere: true` with an empty list and the page draws the screen
   * that says so. If a host greets us in the meantime, `context` sees a project
   * it has never been told about, and everything below is replaced by the read
   * for that project — including this index, which was honestly empty rather
   * than wrongly full.
   */
  void readIndex()
    .then(async () => {
      const index = state.index
      const want = where?.slug ?? null
      if (!state.framed && !state.journey) {
        if (want && index.some((row) => row.slug === want)) {
          wanted = where
          await open(want)
        } else if (index.length) {
          wanted = where
          await open(index[0]?.slug ?? null)
        }
      }
      /* Whatever the fragment asked for, once there is something to look in. */
      if (wanted) {
        const target = wanted
        wanted = null
        await goTo(target)
      }
    })
    .catch(() => {
      say('This app could not read its own store. That is this program, not the host.')
    })
}
