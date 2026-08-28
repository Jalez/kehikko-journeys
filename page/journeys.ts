import type { Goto, ModuleContext } from 'roadmap-module-protocol'

import { BODY_WORDS } from '../limits.ts'
import { ID } from '../manifest.ts'
import { connect, type Host } from '../wire/host.ts'
import { GET_LIVE } from '../wire/methods.ts'

/**
 * The browser half of the app.
 *
 * ## Why this is TypeScript now, and what did not change
 *
 * It used to be one enormous backtick literal in a file called `client.ts`,
 * inlined into a document this app's own server built per request. The argument
 * for that was real — no build step, no framework, nothing to install, and the
 * lowest bar for "somebody else can run this" is a file the browser already
 * understands.
 *
 * What ended it was not taste. A module is one origin or it is nothing, and the
 * page is now served by Vite so that there is no `dist/` to go stale; once Vite
 * is serving the page it may as well serve the script, and once it serves the
 * script the script may as well be typed and may as well `import` the protocol
 * package rather than restating its message names in a string. Every line
 * below is the same program with the quotes taken off. `createElement` and
 * `textContent` throughout, still, and still no `innerHTML`: no title, label or
 * body a tracker or a person wrote can become markup on this page.
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
 * **4. Being told where to go, which now has an answer.** Read the long comment
 * above `goTo`. In protocol 1 this was a receiving end built against a message
 * that did not exist; in protocol 2 the message exists, carries a correlation
 * id, and is ANSWERED — which changes what the walk has to do, not just what it
 * has to listen for.
 */

/* ------------------------------------------------------------------ *
 * The shapes this app's own server answers with
 *
 * Written down here rather than imported from `store.ts`, which reads
 * directories and cannot be loaded into a browser. They are deliberately
 * loose about everything the page does not draw: `quizzes`, `vocabulary`,
 * `owners` and `groups` are other apps' material, carried through the store
 * untouched, and a type here that enumerated them would be this file claiming
 * an opinion about documents it never renders.
 * ------------------------------------------------------------------ */

interface Step {
  title: string
  body: string
  refs: string[]
  notes: string[]
}

interface StepsFrom {
  projector: string
  where: string
  why: string
}

/** One journey, as `/api/journey` hands it over: the document plus `plan`. */
interface JourneyView {
  slug: string
  title: string
  lede: string
  umbrella?: string
  written?: string
  project?: string
  repo?: string
  callout: string
  steps: Step[]
  stepsFrom?: StepsFrom
  blockedBy: Record<string, string[]>
  plan: 'stored' | 'elsewhere' | 'none'
}

/** One row of `/api/journeys`: enough for a picker and nothing more. */
interface Brief {
  slug: string
  title: string
  tab: string | null
  plan: 'stored' | 'elsewhere' | 'none'
  steps: number
}

/** What the host's last refresh recorded about one reference. */
interface Sighting {
  title?: string
  state?: string
  draft?: boolean
  url?: string
  at?: string
  labels?: string[]
  assignees?: string[]
  reviewers?: string[]
  author?: string
}

/**
 * The host's whole reading for one epic, filed the way the host files it.
 *
 * Every bag is optional because every bag is somebody else's document: this is
 * whatever `live.get` returned, and a host is entitled to answer with less than
 * this app knows how to draw.
 */
interface Live {
  issues?: Record<string, Sighting>
  mrs?: Record<string, Sighting>
  ghIssues?: Record<string, Sighting>
  ghPrs?: Record<string, Sighting>
  links?: Record<string, number[]>
  ghLinks?: Record<string, number[]>
  palette?: Record<string, { bg: string; fg: string }>
}

/** Somewhere to go: a reference, a step, or a journey to switch to first. */
interface Target {
  ref?: string
  step?: number
  slug?: string
}

/* ------------------------------------------------------------------ *
 * Our own server
 *
 * Relative paths, because this IS our origin: the document came from this
 * program, so a relative fetch reaches it whether or not anything framed us.
 * This is the line that makes the app an app; the bridge further down is
 * enrichment, and nothing on this path depends on it.
 *
 * Writes carry a ticket the server minted for this process and printed into
 * this page. See the essay on `TICKET` in `doors.ts` for what it does and does
 * not separate now that the origin has to answer CORS permissively.
 * ------------------------------------------------------------------ */

const TICKET: string = (() => {
  const island = document.getElementById('ticket')
  try {
    const parsed: unknown = JSON.parse(island?.textContent ?? '""')
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    /* A document served without a ticket is a document this server did not
       build — a cached file, a proxy, somebody's `curl > page.html`. Every
       write will be refused, which is the correct outcome and is said in the
       refusal rather than guessed at here. */
    return ''
  }
})()

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  return (await response.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-journeys-ticket': TICKET },
    body: JSON.stringify(body ?? {}),
  })
  return (await response.json()) as T
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined && text !== null) node.textContent = String(text)
  return node
}

function need(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`the page is missing #${id}, which means this document is not the one this app serves`)
  return node
}

function say(what: string): void {
  need('said').textContent = what
}

/* ------------------------------------------------------------------ *
 * What we hold
 * ------------------------------------------------------------------ */

let index: Brief[] = [] /* every journey this app holds, in brief */
let journey: JourneyView | null = null /* the one being read, whole */
let live: Live | null = null /* what the host's last refresh saw, or null */
let framed = false
let refused: string | null = null /* the host said no to something we asked */
let editing = -1 /* which step has its editor open, or -1 */
let host: Host | null = null

/* ------------------------------------------------------------------ *
 * References
 *
 * The same four shapes the roadmap parses, because they are how people write
 * them out loud: '#2274' a GitLab issue, '!1800' a change, 'gh#41' a GitHub
 * issue in the journey's own repo, 'gh:org/repo#41' one anywhere else.
 * Anything matching none of them is a gate outside every tracker, which nothing
 * can ever tick off for us, and it is shown as the prose it is rather than as a
 * link to nowhere.
 * ------------------------------------------------------------------ */

const REF_IN_PROSE = /(local#[0-9a-z]+|gh(?::[\w.\-]+\/[\w.\-]+)?#\d+|#\d+|![0-9]+)/g
const IS_TRACKED = /^(local#[0-9a-z]+|gh(?::[\w.\-]+\/[\w.\-]+)?#[0-9]+|#[0-9]+|![0-9]+)$/

function isChange(ref: string): boolean {
  if (/^![0-9]+$/.test(ref)) return true
  return Boolean(live?.ghPrs && ref in live.ghPrs)
}

function isTracked(ref: string): boolean {
  return IS_TRACKED.test(ref)
}

/**
 * The host's own filing, read the way it files: a GitLab number is keyed by the
 * number, a GitHub one by the ref as written, and which bag it is in is the
 * only thing that says whether a GitHub number is an issue or a pull request.
 */
function stateOf(ref: string): Sighting | null {
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
function carriedBy(ref: string): string[] {
  if (!live) return []
  const issue = /^#([0-9]+)$/.exec(ref)
  if (issue) return (live.links?.[issue[1] as string] ?? []).map((n) => `!${n}`)
  if (ref.startsWith('gh')) return (live.ghLinks?.[ref] ?? []).map((n) => `gh#${n}`)
  return []
}

/* ------------------------------------------------------------------ *
 * Prose, with the references in it made into links
 *
 * Split, never replaced into markup. The body of a step is somebody's writing
 * and the title of an issue is a tracker's; neither becomes HTML on this page.
 * Every piece is a text node except the refs, which are anchors built by hand.
 * ------------------------------------------------------------------ */

function prose<T extends HTMLElement>(text: string, into: T): T {
  const parts = String(text ?? '').split(REF_IN_PROSE)
  parts.forEach((piece, i) => {
    if (!piece) return
    if (i % 2 === 1) into.appendChild(refLink(piece))
    else into.appendChild(document.createTextNode(piece))
  })
  return into
}

/**
 * One reference, as a link where there is somewhere to link to.
 *
 * The href comes from what the last refresh READ — the tracker's own URL for
 * the thing. It is never built from the ref: constructing 'https://github.com/'
 * plus a guess at the repository would produce a link that looks right, goes
 * somewhere, and is somewhere else. With no live state there is no href, and
 * the reference is drawn as the reference it is.
 */
function refLink(ref: string): HTMLAnchorElement {
  const seen = stateOf(ref)
  const anchor = el('a', 'ref', ref)
  anchor.setAttribute('data-ref', ref)
  if (seen?.url) {
    anchor.href = seen.url
    anchor.target = '_blank'
    anchor.rel = 'noreferrer'
  } else {
    anchor.title = live
      ? `The last refresh this host did had nothing about ${ref}, so there is no address to open.`
      : `Nothing is framing this page, so this app cannot see where ${ref} lives.`
  }
  return anchor
}

/* ------------------------------------------------------------------ *
 * The rail
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
 * ------------------------------------------------------------------ */

const STAGES = ['Todo', 'Taken', 'In progress', 'In review', 'PR open', 'In dev', 'In prod']
const IN_PROD = 6

interface Rail {
  now: number
  word: string
  why: string
  unseen?: boolean
}

function railOf(ref: string): Rail {
  const seen = stateOf(ref)
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
  if (isChange(ref)) {
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
  const under = carriedBy(ref)
  if (under.length) return { now: 4, word: 'PR open', why: `A change is open against it: ${under.join(', ')}.` }
  if ((seen.assignees ?? []).length) return { now: 1, word: 'Taken', why: 'The tracker has it assigned.' }
  return { now: 0, word: 'Todo', why: 'Nobody is on it in the tracker and no change exists.' }
}

function railInto(ref: string, into: HTMLElement): void {
  const r = railOf(ref)
  const rail = el('div', 'rail')
  const word = el('span', 'word', r.word)
  word.title = r.why
  rail.appendChild(word)
  if (!r.unseen) {
    STAGES.forEach((stage, i) => {
      const dot = el('span', 'dot')
      if (i === IN_PROD) {
        dot.className = 'dot unreadable'
        dot.title = `${stage} — read from the repository, which this app has none of. It is never filled here, whatever is true.`
      } else if (i === r.now) {
        dot.className = 'dot now'
        dot.title = `${stage} — ${r.why}`
      } else if (i < r.now) {
        dot.className = 'dot done'
        dot.title = stage
      } else {
        dot.title = stage
      }
      rail.appendChild(dot)
    })
  }
  if (r.unseen) rail.appendChild(el('span', 'rail-note', r.why))
  into.appendChild(rail)
}

/* ------------------------------------------------------------------ *
 * One tracked thing, as its own card
 * ------------------------------------------------------------------ */

function card(ref: string, under: boolean): HTMLElement {
  const seen = stateOf(ref)
  const box = el('div', under ? 'card under' : 'card')
  box.setAttribute('data-card', ref)

  const top = el('div', 'card-top')
  top.appendChild(refLink(ref))
  const title = el('span', 'title', seen?.title ?? '')
  /* The whole title again, as a tooltip. Nothing on this page truncates and
     this is not a fallback for clipping — it is for the 220px pane, where a
     tracker's own sentence wraps across five very short lines and reading it as
     one is genuinely easier. */
  if (seen?.title) title.title = seen.title
  top.appendChild(title)

  const state = el('span', 'state')
  if (!isTracked(ref)) {
    state.className = 'state tone-unseen'
    state.textContent = 'not a tracker reference'
    state.title = 'A gate outside every tracker. Nothing can ever tick it off for us.'
  } else if (!seen) {
    /* The line this whole app is here to get right. Not 'unknown', which reads
       as a state; not blank, which reads as fine. */
    state.className = 'state tone-unseen'
    state.textContent = live ? 'not in the last refresh' : 'state not visible from here'
    state.title = live
      ? 'This host read the trackers, and this reference was not in what it read.'
      : 'This app holds the journey. What a tracker says about this reference is read by a host, and nothing is ' +
        'framing this page — so there is nothing to show, which is not the same as nothing being there.'
  } else {
    const tone =
      seen.state === 'merged' ? 'merged' : seen.state === 'closed' ? 'closed' : seen.draft ? 'draft' : 'open'
    state.className = `state tone-${tone}`
    state.textContent = seen.state === 'opened' && seen.draft ? 'draft' : (seen.state ?? '')
    if (seen.at) state.title = `as at ${seen.at}`
  }
  top.appendChild(state)
  box.appendChild(top)

  /* The tracker's own labels, in the tracker's own colours where the refresh
     recorded a palette. A scoped label dims its scope, because the half after
     the colons is what distinguishes one row from the next. */
  const names = seen?.labels ?? []
  if (names.length) {
    const labels = el('div', 'labels')
    for (const name of names) {
      const chip = el('span', 'label')
      const at = name.lastIndexOf('::')
      if (at > 0) {
        chip.appendChild(el('span', 'scope', name.slice(0, at + 2)))
        chip.appendChild(document.createTextNode(name.slice(at + 2)))
      } else chip.textContent = name
      const colour = live?.palette?.[name]
      if (colour) {
        chip.style.background = colour.bg
        chip.style.color = colour.fg
        chip.style.borderColor = colour.bg
      }
      labels.appendChild(chip)
    }
    box.appendChild(labels)
  }

  /* Who the tracker has on it. Nothing is set here, so an issue reading
     'unassigned' is telling you the truth about the tracker rather than waiting
     for somebody to fill this page in. A finished issue with nobody on it says
     nothing, and is left silent. */
  if (seen) {
    let who: HTMLElement | null = null
    if (isChange(ref)) {
      const author = seen.author ?? ''
      const reviewers = seen.reviewers ?? []
      if (author || reviewers.length) {
        who = el(
          'div',
          'who',
          `${author || 'unknown'} is making it${reviewers.length ? ` · ${reviewers.join(', ')} asked to look` : ''}`,
        )
      }
    } else if ((seen.assignees ?? []).length) {
      who = el('div', 'who', (seen.assignees ?? []).join(', '))
    } else if (seen.state === 'opened') {
      who = el('div', 'who')
      who.appendChild(el('span', 'free', 'unassigned'))
      who.title = 'Nobody is assigned in the tracker.'
    }
    if (who) box.appendChild(who)
  }

  /* What it waits on, as this journey records it — decided material, ours, and
     as checkable as the rest of the card. The chip carries the blocker's own
     state where there is one, which turns 'can this start?' into a glance. */
  const gates = journey?.blockedBy?.[ref] ?? []
  if (gates.length) {
    const waits = el('div', 'waits')
    waits.appendChild(el('span', null, 'waits on'))
    for (const gate of gates) {
      if (isTracked(gate)) waits.appendChild(refLink(gate))
      else waits.appendChild(el('span', 'note', gate))
    }
    box.appendChild(waits)
  }

  railInto(ref, box)
  return box
}

/* ------------------------------------------------------------------ *
 * A step
 * ------------------------------------------------------------------ */

function stepNode(step: Step, i: number): HTMLElement {
  const node = el('section', 'step')
  node.setAttribute('data-step', String(i + 1))

  const head = el('div', 'step-head')
  head.appendChild(el('span', 'n', `${i + 1}.`))
  const heading = el('h3')
  prose(step.title, heading)
  head.appendChild(heading)

  const refs = step.refs ?? []
  const settled =
    refs.length > 0 &&
    refs.every((r) => {
      const seen = stateOf(r)
      return Boolean(seen) && (seen?.state === 'merged' || seen?.state === 'closed')
    })
  if (settled) head.appendChild(el('span', 'settled', 'done'))

  /* Editing is this app's, not the host's: the steps are here. It is offered
     whenever the plan is stored, framed or not. */
  const pen = el('button', 'edit', editing === i ? 'close' : 'edit')
  pen.type = 'button'
  pen.addEventListener('click', () => {
    editing = editing === i ? -1 : i
    draw()
  })
  head.appendChild(pen)
  node.appendChild(head)

  if (editing === i) node.appendChild(editor(step, i))
  else if (step.body) node.appendChild(prose(step.body, el('p', 'body')))

  const notes = step.notes ?? []
  if (notes.length) {
    const box = el('div', 'notes')
    for (const note of notes) box.appendChild(el('span', 'note', note))
    node.appendChild(box)
  }

  if (refs.length) {
    const cards = el('div', 'cards')
    const claimed = new Set<string>()
    const issues: string[] = []
    const loose: string[] = []
    for (const ref of refs) (isChange(ref) ? loose : issues).push(ref)
    for (const issue of issues) {
      cards.appendChild(card(issue, false))
      for (const change of carriedBy(issue)) {
        claimed.add(change)
        cards.appendChild(card(change, true))
      }
    }
    for (const change of loose) if (!claimed.has(change)) cards.appendChild(card(change, false))
    node.appendChild(cards)
  }
  return node
}

/**
 * The editor. Writes the WHOLE step, which is why every field is filled in from
 * what is stored rather than left blank: a form that saved an empty body
 * because the box started empty would delete somebody's writing to record a
 * change to the title.
 */
function editor(step: Step, i: number): HTMLElement {
  const form = el('form', 'editor')
  const title = el('input')
  title.value = step.title ?? ''
  title.setAttribute('aria-label', 'Step title')
  const body = el('textarea')
  body.value = step.body ?? ''
  body.setAttribute('aria-label', 'Step body')
  const refs = el('input')
  refs.value = (step.refs ?? []).join(' ')
  refs.setAttribute('aria-label', 'References, separated by spaces')
  const notes = el('input')
  notes.value = (step.notes ?? []).join(', ')
  notes.setAttribute('aria-label', 'Notes, separated by commas')

  const row = el('div', 'row')
  const save = el('button', null, 'Save')
  save.type = 'submit'
  const count = el('span', 'count')
  const counted = () => {
    const words = body.value.trim() ? body.value.trim().split(/\s+/).length : 0
    count.textContent = `${words} / ${BODY_WORDS} words`
  }
  body.addEventListener('input', counted)
  counted()
  row.appendChild(save)
  row.appendChild(count)

  form.appendChild(title)
  form.appendChild(body)
  form.appendChild(refs)
  form.appendChild(notes)
  form.appendChild(row)
  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const open = journey
    if (!open) return
    void post<{ ok: boolean; error?: string; journey?: JourneyView }>('/api/step', {
      slug: open.slug,
      position: i + 1,
      title: title.value,
      body: body.value,
      refs: refs.value.split(/\s+/).filter(Boolean),
      notes: notes.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }).then((out) => {
      if (!out.ok || !out.journey) {
        say(out.error ?? 'that was not kept')
        return
      }
      editing = -1
      journey = out.journey
      say('kept')
      draw()
    })
  })
  return form
}

/* ------------------------------------------------------------------ *
 * What this app can see from here, said out loud
 *
 * A box at the top, never a tooltip. Four states, four sentences, because they
 * send a reader to four different places. An app that quietly showed a blank
 * state chip beside a reference it has never had a reading of would be lying in
 * the ordinary case.
 * ------------------------------------------------------------------ */

function sight(): void {
  const box = need('sight')
  box.textContent = ''
  const lead = el('b')
  const rest = el('span')
  if (!framed) {
    lead.textContent = 'Standing on its own. '
    rest.textContent =
      'Nothing is framing this page. Everything below is this app’s own store: the journeys, their prose, their ' +
      'steps, what blocks what — all of it readable and editable with nothing else running. What is missing is ' +
      'what a tracker says: every reference is shown as a reference, and marked “state not visible from here”, ' +
      'which is not the same as unknown and is certainly not closed.'
  } else if (refused) {
    lead.textContent = 'Framed, and refused. '
    rest.textContent = refused
  } else if (!journey) {
    lead.textContent = 'Framed by a host. '
    rest.textContent =
      'No epic is open, or the host named one this app does not hold. Pick one below — these are the journeys ' +
      'this app has.'
  } else {
    lead.textContent = `Framed, reading ${journey.slug}. `
    rest.textContent = live
      ? 'The journey and its steps are this app’s. What each reference is doing comes from the host’s last ' +
        'refresh, handed over whole: this app holds no credential, calls no tracker, and could not spend ' +
        'anybody’s rate limit if it tried. An agent’s own report of where work stands is not in that, and the ' +
        'rail does not pretend to it.'
      : 'The host has not handed over what its last refresh read — either live.get was refused, or there has been ' +
        'no refresh. The journey below is complete; the states beside the references are not there.'
  }
  box.appendChild(lead)
  box.appendChild(rest)
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

function drawPicker(): void {
  const picker = need('picker')
  picker.textContent = ''
  /* Hidden when a host is driving: the frame owns which epic is open, and a
     second picker beside its tab strip would be two controls answering one
     question. */
  if (framed) return
  for (const row of index) {
    const button = el('button', null, row.tab ?? row.title)
    button.type = 'button'
    if (journey && row.slug === journey.slug) button.setAttribute('aria-current', 'true')
    button.title = `${row.slug} — ${
      row.plan === 'elsewhere'
        ? 'its steps are kept somewhere this app cannot read'
        : row.plan === 'none'
          ? 'no steps written yet'
          : `${row.steps} steps`
    }`
    button.addEventListener('click', () => void open(row.slug))
    picker.appendChild(button)
  }
}

function draw(): void {
  drawPicker()
  sight()
  const main = need('journey')
  main.textContent = ''
  if (!journey) {
    grow()
    return
  }

  need('where').textContent = journey.project ?? journey.repo ?? ''
  const heading = el('h2')
  heading.style.textTransform = 'none'
  heading.style.fontSize = '1.05rem'
  heading.style.color = 'var(--ink)'
  heading.textContent = journey.title
  main.appendChild(heading)
  if (journey.lede) main.appendChild(prose(journey.lede, el('p', 'lede')))

  const meta: string[] = []
  if (journey.umbrella) meta.push(`umbrella ${journey.umbrella}`)
  if (journey.written) meta.push(`written ${journey.written}`)
  if (meta.length) main.appendChild(el('p', 'meta', meta.join(' · ')))
  if (journey.callout) main.appendChild(prose(journey.callout, el('div', 'callout')))

  main.appendChild(el('h2', null, 'The journey'))

  /* THE distinction. Three answers, and the middle one is why this app exists
     in the shape it is. */
  if (journey.plan === 'elsewhere' && journey.stepsFrom) {
    const from = journey.stepsFrom
    const elsewhere = el('div', 'elsewhere')
    elsewhere.appendChild(el('b', null, 'This journey has steps. They are not here, and this app cannot read them.'))
    const where = el('p')
    where.appendChild(document.createTextNode('They are kept in '))
    where.appendChild(el('span', 'where-file', from.where))
    where.appendChild(document.createTextNode(` and projected out of it by ${from.projector}.`))
    elsewhere.appendChild(where)
    if (from.why) elsewhere.appendChild(el('p', null, from.why))
    elsewhere.appendChild(
      el(
        'p',
        null,
        'This is not a journey with no steps. Nothing here is empty; something here is out of sight, and those ' +
          'are different enough that showing one as the other would send a reader to the wrong place — which is ' +
          'exactly the bug that made this app say so on screen.',
      ),
    )
    main.appendChild(elsewhere)
  } else if (journey.plan === 'none') {
    main.appendChild(
      el(
        'p',
        'nothing',
        'No steps have been written for this journey yet. Nothing is hidden and nothing is elsewhere — there ' +
          'simply are none.',
      ),
    )
  } else {
    if (journey.stepsFrom) {
      const also = el('div', 'elsewhere')
      also.appendChild(el('b', null, 'A paper sits beside these steps, and this app cannot read it.'))
      also.appendChild(el('p', null, journey.stepsFrom.why))
      also.appendChild(
        el(
          'p',
          null,
          'The steps below are the ones this app holds. Where a host projects the paper instead, a reader there ' +
            'may be seeing a different set, and this app cannot tell you where the two disagree — only that they ' +
            'might.',
        ),
      )
      main.appendChild(also)
    }
    journey.steps.forEach((step, i) => main.appendChild(stepNode(step, i)))
  }
  grow()
}

/* ------------------------------------------------------------------ *
 * Opening a journey
 * ------------------------------------------------------------------ */

async function open(slug: string | null): Promise<void> {
  if (!slug) {
    journey = null
    draw()
    return
  }
  const out = await get<{ ok: boolean; error?: string; journey?: JourneyView }>(
    `/api/journey?slug=${encodeURIComponent(slug)}`,
  )
  journey = out.ok && out.journey ? out.journey : null
  editing = -1
  say(out.ok ? '' : (out.error ?? 'no such journey here'))
  draw()
  await fill()
}

/**
 * What the host's last refresh saw, if there is a host and it answers.
 *
 * Asked for once per journey, after the journey is already on screen:
 * enrichment arrives late and changes nothing about whether the page works.
 */
async function fill(): Promise<void> {
  const open = journey
  if (!host?.greeted() || !open) return
  try {
    const answer = await host.request(GET_LIVE, { epic: open.slug })
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
    if (journey !== open) return
    live = (answer ?? null) as Live | null
    refused = null
  } catch (e) {
    if (journey !== open) return
    live = null
    refused =
      `The host refused ${GET_LIVE} (${(e as Error).message}). Everything below still works; the states beside ` +
      'the references are what is missing, and they are marked as missing rather than guessed.'
  }
  sight()
  draw()
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
 * answer waits for the load, with `wire/host.ts` holding a backstop shorter
 * than the host's own timeout.
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

async function goTo(what: Target | null): Promise<{ found: boolean; why: string }> {
  if (!what) return { found: false, why: 'that walk named nothing to walk to' }

  if (what.slug && journey?.slug !== what.slug) {
    /* Load first, THEN look. This is the line the protocol's essay on `went`
       is about. */
    await open(what.slug)
    if (journey?.slug !== what.slug) {
      return { found: false, why: `This app does not hold a journey called ${what.slug}.` }
    }
  }

  if (!journey) {
    wanted = what
    return { found: false, why: 'No journey is open in this app yet.' }
  }

  let target: Element | null = null
  if (what.ref) {
    for (const anchor of document.querySelectorAll('[data-card] a.ref')) {
      if (anchor.getAttribute('data-ref') === what.ref) {
        target = anchor.closest('[data-card]') ?? anchor
        break
      }
    }
  } else if (what.step) {
    target = document.querySelector(`[data-step="${String(Number(what.step) || 0)}"]`)
  } else {
    /* An epic and nothing else. The switch above IS the walk, and it happened. */
    return { found: true, why: '' }
  }

  if (!target) {
    const why = what.ref ? `Nothing in this journey names ${what.ref}.` : `This journey has no step ${what.step}.`
    say(why)
    return { found: false, why }
  }

  target.scrollIntoView({ block: 'center' })
  target.classList.remove('found')
  void (target as HTMLElement).offsetWidth
  target.classList.add('found')
  setTimeout(() => target.classList.remove('found'), 2600)
  return { found: true, why: '' }
}

/**
 * The fragment, parsed. Bounded like everything else that arrives from outside:
 * a ref is at most 200 characters, a step is a small number, a slug is a slug.
 */
function fromHash(): Target | null {
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

function grow(): void {
  host?.resize(document.body.scrollHeight + 32)
}

/**
 * Which epic the host says is open, taken as which journey to show.
 *
 * `context.epic` is the protocol-2 spelling; it was `slug` in protocol 1, and
 * this one field is the whole of the rename as this app experiences it. It is
 * nullable rather than absent when nothing is open, which matters: "no epic" is
 * a state this app has to be able to move INTO, and a field that simply
 * disappeared would leave the last journey on screen under a heading that no
 * longer applies.
 */
function context(next: ModuleContext): void {
  framed = true
  refused = null
  applyTheme(next.theme)
  const slug = next.epic ?? ''
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    journey = null
    live = null
    draw()
    return
  }
  if (journey?.slug === slug) {
    void fill()
    return
  }
  live = null
  void open(slug)
}

/**
 * The theme the host says it is in.
 *
 * Set as an attribute on the root element, which `styles.ts` reads, because the
 * stylesheet's dark palette is otherwise behind `prefers-color-scheme` — a
 * media query that follows the reader's operating system and knows nothing
 * about the roadmap this page is sitting inside. A module one shade lighter
 * than the page around it is the first thing anybody notices about a protocol.
 */
function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

/* ------------------------------------------------------------------ *
 * Start
 *
 * The store first, always. If a host greets us in the meantime it will say
 * which epic is open and that wins; if none ever does, the page is already
 * whole.
 *
 * `connect` is called BEFORE the first fetch, and that ordering is the whole
 * point of `wire/mailbox.ts`: the greeting arrives on the frame's `load` event
 * and is replayed to whoever subscribes, so the only way to lose it is to
 * subscribe from inside something that resolves later than a network call.
 * ------------------------------------------------------------------ */

export function start(): void {
  /* The app's own name comes off the page the moment it is clear this page is
     not standing alone. The host draws the module's name in the pane header and
     puts the manifest summary behind it as a tooltip, so printing "Journeys"
     here as well says the name twice and costs a heading's worth of a pane that
     is often 340 pixels tall — the most expensive line on the page, spent on
     the one thing the reader already knows.

     `window.parent !== window` rather than the `framed` flag on purpose: the
     flag is only true once a host has greeted us, which is a message and a tick
     of the event loop after first paint, and a heading that appears and then
     vanishes is worse than one that stays. Being inside a frame is knowable
     synchronously, and a frame that is not a roadmap host still has a header of
     its own to blame. Only the identity goes: `#where` names the project of the
     open journey and `#sight` says what can be seen from here, and neither is
     this app introducing itself. */
  if (window.parent !== window) document.getElementById('who')?.remove()

  host = connect(ID, {
    onHello: (heard) => {
      context(heard)
      if (!heard.epic) {
        /* Greeted with no epic open. The page still has a store to draw, and
           `context` has already said so; this only makes sure the sight box and
           the picker reflect a host being there. */
        sight()
        drawPicker()
      }
      grow()
    },
    onContext: (heard) => context(heard),
    onGoto: (goto: Goto, answer) => {
      void goTo({ ref: goto.ref, step: goto.step, slug: goto.epic }).then((out) => answer(out.found, out.why))
    },
  })

  const where = fromHash()
  void get<{ journeys?: Brief[] }>('/api/journeys')
    .then(async (out) => {
      index = out.journeys ?? []
      const want = where?.slug ?? null
      if (!framed && !journey) {
        if (want && index.some((row) => row.slug === want)) {
          wanted = where
          await open(want)
        } else if (index.length) {
          wanted = where
          await open(index[0]?.slug ?? null)
        }
      }
      draw()
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
