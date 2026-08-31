import { flushSync } from 'react-dom'
import type { Goto, ModuleContext } from 'roadmap-module-protocol'
import { connect, type Connection } from 'roadmap-module-protocol/client'

import { ID } from '../manifest.ts'
import { GET_LIVE } from '../wire/methods.ts'
import type { Brief, JourneyView, Live, Target } from './kinds.ts'
import { firstShown, samePick } from './refs.ts'
import { get, post, standIn } from './store/api.ts'
import { apply as applyTheme } from './theme.ts'

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
 * place — where a `roadmap.context` or a `roadmap.goto` arrives — and nowhere
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
 * `live.get` is answered, the cards gain a state, the tracker's own labels, who
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
  /** What the host's last refresh saw, or null. */
  live: Live | null
  framed: boolean
  /** The host said no to something we asked. */
  refused: string | null
  /** Which step has its editor open, or -1. */
  editing: number
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
}

let state: State = {
  index: [],
  journey: null,
  epic: null,
  live: null,
  framed: false,
  refused: null,
  editing: -1,
  said: '',
  /* True until a host says otherwise, and true forever if none ever does. A
     page opened directly has no canvas to tell it which project it is standing
     in, and inventing one would be this app writing into a repository nobody
     pointed it at. */
  nowhere: true,
  trouble: null,
  from: null,
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
}

export function say(what: string): void {
  set({ said: what })
}

export function setEditing(which: number): void {
  set({ editing: state.editing === which ? -1 : which })
}

/* ------------------------------------------------------------------ *
 * Opening a journey
 * ------------------------------------------------------------------ */

export async function open(slug: string | null): Promise<void> {
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
    if (!listed(slug)) {
      set({ journey: null, editing: -1, said: '' })
      return
    }
  }
  const out = await get<{ ok: boolean; error?: string; journey?: JourneyView }>(
    '/api/journey',
    `slug=${encodeURIComponent(slug)}`,
  )
  set({
    journey: out.ok && out.journey ? out.journey : null,
    editing: -1,
    /* Nothing is said when there is nowhere to read. The screen for that is
       already on the page and says the whole thing; repeating the server's
       sentence in the answer line underneath would be the same news twice, and
       the answer line is for answering something the reader just did. */
    said: out.ok || state.nowhere ? '' : (out.error ?? 'no such journey here'),
  })
  await fill()
}

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

/**
 * Save one step, whole.
 *
 * The WHOLE step, which is why the editor fills every field in from what is
 * stored rather than leaving it blank: a form that saved an empty body because
 * the box started empty would delete somebody's writing to record a change to
 * the title.
 */
export async function saveStep(
  position: number,
  fields: { title: string; body: string; refs: string[]; notes: string[] },
): Promise<void> {
  const being = state.journey
  if (!being) return
  const out = await post<{ ok: boolean; error?: string; journey?: JourneyView }>('/api/step', {
    slug: being.slug,
    position,
    ...fields,
  })
  if (!out.ok || !out.journey) {
    say(out.error ?? 'that was not kept')
    return
  }
  /* Dropped if the canvas moved while this was in flight. The server has
     already refused a write whose ticket belonged to the previous project —
     that is what the ticket binding is for — but a write that landed just
     BEFORE the switch can still have its reply arrive just after, and setting
     the previous project's journey into state here would put it on screen
     under the new project's index. Same rule as `fill` below: an answer to a
     question nobody is waiting on is noise with a timestamp. */
  if (state.journey !== being) return
  set({ editing: -1, journey: out.journey, said: 'kept' })
}

/**
 * What the host's last refresh saw, if there is a host and it answers.
 *
 * Asked for once per journey, after the journey is already on screen:
 * enrichment arrives late and changes nothing about whether the page works.
 */
async function fill(): Promise<void> {
  const being = state.journey
  if (!host?.greeted() || !being) return
  try {
    const answer = await host.request(GET_LIVE, { epic: being.slug })
    /*
     * An answer to a question asked about a journey nobody is reading any more
     * is dropped.
     *
     * Two `roadmap.context` messages in quick succession — which is what
     * switching epics twice looks like — leave two of these in flight, and the
     * slower one is not necessarily the older one. Without this check the page
     * draws the second epic's steps under the first epic's tracker state, which
     * is the one failure mode this app's whole shape is against: two answers on
     * one screen with nothing saying which is which. Atlas met the same thing
     * through `StrictMode`'s double mount and wrote it up in `use-atlas.ts`;
     * the mechanism here is a switch rather than a remount, and the rule is the
     * same one — an answer belonging to a question nobody is waiting on is not
     * data, it is noise with a timestamp.
     */
    if (state.journey !== being) return
    set({ live: (answer ?? null) as Live | null, refused: null })
  } catch (e) {
    if (state.journey !== being) return
    set({
      live: null,
      refused:
        `The host refused ${GET_LIVE} (${(e as Error).message}). Everything below still works; the states beside ` +
        'the references are what is missing, and they are marked as missing rather than guessed.',
    })
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
 * carries a correlation id and the host WAITS. `roadmap.went` is the first and
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
    const why = what.ref ? `Nothing in this journey names ${what.ref}.` : `This journey has no step ${what.step}.`
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

let host: Connection | null = null

/**
 * Say how tall we would like to be.
 *
 * Called from an effect after every commit rather than at the end of a draw,
 * which is the one place the port genuinely changed the shape: React decides
 * when the DOM is finished and `scrollHeight` read before it is finished is a
 * number for the previous page. Fire and forget either way — a host is entitled
 * to ignore it, and this page is readable in whatever height it is given.
 */
export function grow(): void {
  host?.resize(document.body.scrollHeight + 32)
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
 * `use-roadmap.ts` carries the long version; the failure looks like a bug in
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
function context(next: ModuleContext): void {
  applyTheme(next.theme)

  const named = next.epic ?? ''
  const slug = /^[a-z0-9-]{1,80}$/.test(named) ? named : null

  /* `epic` goes into state beside `framed`, in the same patch, because the two
     are one fact about this context and a page rendered between them would be
     framed by a host that had not yet said what it was looking at. It is kept
     here as well as in `standingOn` below because the page has to be able to
     say WHICH epic it holds no journey for, and `standingOn` is private to
     this module. A slug that failed the shape test above is recorded as
     nothing named: it is not a name this app could hold a journey under, and
     quoting somebody else's malformed field back at a reader who can do
     nothing with it is not information. */
  set({ framed: true, refused: null, epic: slug })

  const project = typeof next.projectPath === 'string' && next.projectPath.trim() ? next.projectPath : null
  const relocated = standingIn !== project
  standingIn = project

  const moved = relocated || standingOn !== slug
  standingOn = slug

  const chosen = next.selection ?? []
  const repicked = !samePick(chosen, picked)
  picked = [...chosen]

  if (relocated) {
    /* Everything read out of the old store goes, before anything is fetched
       from the new one. A journey left on screen while its replacement is in
       flight is the previous project's material under the current project's
       name, which is a worse half-second than an empty container. */
    set({ index: [], journey: null, live: null, said: '' })
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
        if (slug) {
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
    if (moved) set({ journey: null, live: null })
    return
  }

  if (moved) {
    set({ live: null })
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

  if (repicked) showSelection()
}

/**
 * Somebody picked a reference somewhere on this canvas. Show it, if it is here.
 *
 * ## Why this is three lines and not a feature
 *
 * Everything hard about "show me this reference" was already solved for
 * `roadmap.goto`: finding the anchor, preferring the card over a bare link,
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
 * live.get" — and filling it with "nothing in this journey names gh#131" every
 * time somebody clicks a row in another container would turn the one place this app
 * talks to a person into a running commentary on other containers' clicks. Worse, it
 * would be blaming this journey for a click that was never aimed at it. That is
 * why `goTo` is asked for a quiet walk here and a loud one for `roadmap.goto`:
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

  const ref = firstShown(shown, picked)
  if (!ref) return
  /* No `slug`: a selection says what was picked and never which epic it was
     picked in, on purpose — see the protocol's essay on `selection`. Walking to
     a bare ref searches the journey that is open, which is the only journey
     this container could honestly be talking about. */
  void goTo({ ref }, { quiet: true })
}

/* ------------------------------------------------------------------ *
 * Start
 *
 * The store first, always. If a host greets us in the meantime it will say
 * which epic is open and that wins; if none ever does, the page is already
 * whole.
 *
 * `connect` is called BEFORE the first fetch, and that ordering is the whole
 * point of the client's `mailbox`: the greeting arrives on the frame's `load`
 * event and is replayed to whoever subscribes, so the only way to lose it is to
 * subscribe from inside something that resolves later than a network call. It
 * is also why this is called from `main.tsx` before `createRoot`, rather than
 * from an effect — an effect runs after the first commit, which is after the
 * greeting has already been posted and thrown away.
 * ------------------------------------------------------------------ */

export function start(): void {
  const live = connect(
    ID,
    {
      /**
       * The greeting, and the second thing it carries.
       *
       * `state` is whatever the host is keeping for this module. The copy of
       * the wire that used to stand in this repository declared `onHello` with
       * one parameter, so the value was parsed off the greeting and then had
       * nowhere to go — this page could not read what the host was holding for
       * it even if it wanted to. The parameter is back, named and ignored:
       * this app keeps its journeys in its own store and declares no
       * `state:keep`, and the point is that the plumbing is here rather than
       * waiting to be rediscovered.
       */
      onHello: (heard, _kept) => {
        context(heard)
        grow()
      },
      onContext: (heard) => context(heard),
      onGoto: (goto: Goto, answer) => {
        void goTo({ ref: goto.ref, step: goto.step, slug: goto.epic }).then((out) => answer(out.found, out.why))
      },
    },
    /* 900ms, this module's own number rather than the client's 500, because
       `goTo` above is async: it may have to load a journey before it can
       honestly say whether the reference is in it. The client takes the option
       so that adoption keeps each module's timing instead of unifying it by
       accident. */
    { gotoBackstop: 900 },
  )
  /* Stored BEFORE it is told to listen. The mailbox replays synchronously
     inside `listen()`, and `onHello` calls `grow()`, which reaches for this
     module's own state — so the assignment has to have happened. See `listen`
     in the client. */
  host = live
  live.listen()

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
