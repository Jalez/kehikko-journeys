import { useEffect, useSyncExternalStore } from 'react'
import type { EpicPart, JourneyPart } from 'kehikot-module-protocol'
import { Cover, coverFor, useFocus, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { Button } from '@/components/ui/button.tsx'

import { narrowedSaid, narrowing, shownSteps, type Shown } from './focus.ts'
import { partOfStep, partsIn } from '../parts.ts'
import {
  begin,
  beginAndArrange,
  clearPick,
  getSnapshot,
  grow,
  discardHeld,
  heldStrays,
  pick,
  reopenHeld,
  retry,
  setAdding,
  setArranging,
  setDividing,
  subscribe,
  type PaperChapters,
} from './journeys.ts'
import type { JourneyView, Live } from './kinds.ts'
import { cardsUnder } from './live/lookup.ts'
import { pickedState } from './refs.ts'
import { ChapterOffer } from './view/chapters.tsx'
import { Editor } from './view/editor.tsx'
import { NO_PROJECT_SAID, NoJourneys, Trouble, UNHOSTED_SAID } from './view/nowhere.tsx'
import { Parts, arrangeable } from './view/parts.tsx'
import { Picker } from './view/picker.tsx'
import { Prose } from './view/prose.tsx'
import { ReadingProvider } from './view/reading.tsx'
import { Sight } from './view/sight.tsx'
import { StepBlock } from './view/step.tsx'

/**
 * The page.
 *
 * ## It is a reading column, not a dashboard
 *
 * The whole of this module is one argument: a journey is a hand-written account
 * of what has to become true for a user, and the state of the work is drawn
 * BESIDE that account rather than in place of it. The layout is the only thing
 * that can keep saying so. So this is a single column with a measure — prose
 * width, not container width — the steps are sections with an ordinal and a
 * sentence, and the tracker's material sits underneath each one in boxes that
 * are deliberately quieter than the prose above them.
 *
 * A grid of cards was the obvious thing to reach for while porting, and it is
 * the thing this page must not become. At 1200px a two-column card wall would
 * fit beautifully and would have turned the argument into a status board with
 * some text at the top.
 *
 * ## The measure is capped, and the cap is not a breakpoint
 *
 * `max-w-[44rem]` on the column, always. A container 1200 pixels wide given the
 * whole of itself sets prose at about 150 characters to the line, which is
 * roughly twice what anybody reads comfortably; the container being wide is not a
 * reason to make the sentences longer. Below the cap nothing applies, so the
 * narrow case — which is the common one — is untouched by it.
 */
export function App() {
  const state = useSyncExternalStore(subscribe, getSnapshot)

  /*
   * How tall we would like to be, said after every commit.
   *
   * No dependency array on purpose. The height is a function of the whole
   * rendered document — an editor opening, a card arriving with the host's
   * reading on it, a step's body wrapping differently — and enumerating the
   * things that change it is a list that would be wrong the first time somebody
   * added a badge. Reading `scrollHeight` after a commit is cheap and always
   * right; a host is free to ignore what it hears.
   */
  useEffect(grow)

  /*
   * Every not-ready moment is the protocol's one cover.
   *
   * `coverFor` reads the host's standing — waiting, then unhosted, or hosted with no project
   * folder, or with no epic — and `listening` comes first, which is what stops this page drawing
   * "nothing is framing this page" for the first moments of every framed load. A project that was
   * named and will not read is NOT one of these: that is `Trouble`, with the server's own sentence,
   * and it outranks "no epic".
   *
   * `down` and `stale` are about this app's own server, and can arrive with a step's editor open.
   * So everything below stays MOUNTED under a cover and is only hidden; Try again asks the server
   * and re-reads what is missing without touching a journey that is already on screen (`retry`).
   *
   * "No epic" covers nothing: it stands where the status line stood, and what the project holds
   * (or that it holds no journeys yet) is still said underneath.
   *
   * The cover is given no height. This page reports its content's height to the host (`grow`), and
   * a full-frame cover would be this page asking for the height it was given.
   */
  const server = useServerStanding()
  const cover = coverOf(state, server)

  /* A journey has landed: reopen whatever was open with words in it when this page last went away
     (a stale page reloads itself). See "What is being typed" in `journeys.ts`. */
  const landed = state.journey ? `${state.projectPath ?? ''}|${state.journey.slug}` : null
  useEffect(() => {
    /* After this commit, not inside it: the store tells its listeners with `flushSync`. */
    if (landed) queueMicrotask(reopenHeld)
  }, [landed])
  const strays = heldStrays()
  const whole = cover !== null && cover !== 'no-epic'

  return (
    <ReadingProvider
      value={{
        live: state.live,
        journey: state.journey,
        framed: state.framed,
        withheld: state.withheld,
        marks: state.marks,
        hidden: state.hidden,
        unfolded: state.unfolded,
      }}
    >
      <div className="mx-auto w-full max-w-[44rem] px-3 pt-3 pb-12 @min-[26rem]/container:px-4 @min-[26rem]/container:pt-4">
        {cover && (
          <Cover
            state={cover}
            name="Journeys"
            onRetry={() => void retry()}
            detail={cover === 'unhosted' ? UNHOSTED_SAID : cover === 'no-project' ? NO_PROJECT_SAID : null}
          />
        )}
        <div hidden={whole} className={whole ? undefined : 'contents'}>
        <Head journey={state.journey} />
        {cover === 'no-epic' ? null : <Sight
          framed={state.framed}
          refused={state.refused}
          epic={state.epic}
          journey={state.journey}
          live={state.live}
          busy={state.busy}
        />}
        {!state.framed && <Picker index={state.index} journey={state.journey} />}
        {/*
         * Where the journeys are, before anything about which one is open.
         *
         * The order matters and is the point of `Nothing` having three answers.
         * "No project is open", "that project's file will not read" and "this
         * project has none yet" are three different things to do next, and the
         * page they replace — an empty column with a picker over it — said the
         * same nothing about all three. A container that quietly drew empty while a
         * file it could not parse sat on disk would be reporting somebody's
         * work as absent.
         */}
        <Nothing state={state} />
        {/* Only for an epic the store is KNOWN not to hold, and never while
            the file will not read: `unwritten` is set after the index was
            read again, and a file that would not parse has no honest answer
            to "is there a journey for this". */}
        {state.framed && !state.journey && !state.trouble && !state.nowhere && state.unwritten === state.epic && state.epic && (
          <Begin
            epic={state.epic}
            busy={state.beginning}
            dividing={state.dividing}
            chapters={state.chapters}
            making={state.making}
          />
        )}
        {state.journey && (
          <Journey
            journey={state.journey}
            live={state.live}
            editing={state.editing}
            adding={state.adding}
            arranging={state.arranging}
            selection={state.selection}
            parts={state.parts}
            framed={state.framed}
            chapters={state.chapters}
            making={state.making}
          />
        )}
        {/* The one line this app uses to answer the reader. Polite rather than
            assertive: it is an answer to something they just did, not an
            interruption of what they are reading. */}
        {strays.length > 0 && (
          <section data-kept-words className="mt-4 grid gap-1.5 rounded border border-dashed px-2 py-1.5 text-[0.82rem] leading-6">
            <p className="text-muted-foreground">
              Typed here and not saved. What {strays.length === 1 ? 'it was' : 'they were'} written into is no longer in this journey, so{' '}
              {strays.length === 1 ? 'it is' : 'they are'} kept here rather than put somewhere else:
            </p>
            {strays.map(({ target, draft }) => (
              <div key={target} data-kept={target} className="grid gap-1 border-t pt-1.5">
                <p className="text-muted-foreground">{draft.aim}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{wordsOf(draft.text)}</p>
                <div>
                  <Button type="button" variant="ghost" size="container" onClick={() => discardHeld(target)}>
                    discard
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}
        <p aria-live="polite" className="mt-4 min-h-[1.4em] text-[0.82rem] text-muted-foreground">
          {state.said}
        </p>
        </div>
      </div>
    </ReadingProvider>
  )
}

/** A held draft's words for reading: a step's four fields on their own lines, anything else as it is. */
function wordsOf(text: string): string {
  try {
    const one = JSON.parse(text) as Record<string, unknown> | null
    if (one && typeof one === 'object') return Object.values(one).filter((value) => typeof value === 'string' && value.trim()).join('\n')
  } catch {
    /* Not a step's fields: a heading or a file name, held as plain words. */
  }
  return text
}

/** Which cover the page is under, if any. Pure, so every standing can be asserted without a host. */
export function coverOf(
  state: Pick<ReturnType<typeof getSnapshot>, 'where' | 'projectPath' | 'epic' | 'trouble'>,
  server: ReturnType<typeof useServerStanding>,
): CoverState | null {
  if (server === 'stale') return 'stale'
  const asked = coverFor({ where: state.where, projectPath: state.projectPath, epic: state.epic }, { project: true, epic: true })
  const notReady = asked === 'no-epic' && state.trouble ? null : asked
  return notReady ?? (server === 'down' ? 'down' : null)
}

/**
 * Whether this page is inside a frame, decided once and synchronously.
 *
 * `window.parent !== window` rather than the `framed` flag in state, on
 * purpose: the flag is only true once a host has greeted us, which is a message
 * and a tick of the event loop after first paint, and a heading that appears
 * and then vanishes is worse than one that stays. Being inside a frame is
 * knowable before anything renders, and a frame that is not a Kehikot host
 * still has a header of its own to blame.
 */
const INSIDE_A_FRAME = typeof window !== 'undefined' && window.parent !== window

/**
 * The app's own name comes off the page the moment it is clear this page is not
 * standing alone.
 *
 * The host draws the module's name in the container header and hangs the manifest's
 * summary off it as a tooltip, so printing "Journeys" here as well says the
 * name twice and costs a heading's worth of a container that is often 340 pixels
 * tall — the most expensive line on the page, spent on the one thing the reader
 * already knows. Only the IDENTITY goes: the project the open journey belongs
 * to is a statement about what is open rather than about what this program is
 * called, and it stays either way.
 */
function Head({ journey }: { journey: JourneyView | null }) {
  const where = journey?.project ?? journey?.repo ?? ''
  if (INSIDE_A_FRAME && !where) return null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {!INSIDE_A_FRAME && <h1 className="text-lg leading-tight font-semibold tracking-tight">Journeys</h1>}
      {where && <span className="text-[0.85rem] text-muted-foreground">{where}</span>}
    </div>
  )
}

/**
 * Why there is no journey on screen, when there is not one.
 *
 * Draws nothing at all in the ordinary case — a journey is open, or this container
 * is standing alone with a picker and one selected. It only speaks when the
 * absence needs explaining, which is exactly the three states `state.nowhere`,
 * `state.trouble` and an empty index describe and an empty column does not.
 */
function Nothing({ state }: { state: ReturnType<typeof getSnapshot> }) {
  if (state.trouble) return <Trouble trouble={state.trouble} />
  /* No project at all is the shared cover's to say; see `App`. */
  if (state.nowhere) return null
  if (!state.index.length) return <NoJourneys from={state.from} />
  return null
}

/**
 * The press that begins a journey for the epic the canvas is standing on.
 *
 * ## Why the words are about the host's steps and not about an empty page
 *
 * The obvious button says "new journey" and makes an empty one. It would be
 * the most destructive control in this app. A host answers an epic's steps out
 * of this app's record and out of its own file only where there is none, so a
 * record made empty takes every step the host held off every module on the
 * canvas — and the file that still holds them is read by nothing afterwards.
 *
 * So the press says what it does: it brings across what the host holds. The
 * work is `begin` in `src/journeys.ts`, which asks the host `epic.get` and
 * hands the answer to the store. The line under the page then says how many
 * steps came across, or the store's own sentence for why nothing was made.
 *
 * Disabled while it runs, because a second press would be answered "already
 * holds a journey" — true, and a strange thing to be told about a button
 * pressed once. Whether it is running is in the page's state with everything
 * else, for the reason at the top of `src/journeys.ts`: the components here
 * hold none.
 *
 * ## Dividing the epic into parts starts here too
 *
 * A host's bar says an epic has no parts and sends the person here to make
 * them. For an epic with no journey record that used to be a dead end one
 * press long: this section said "begin the journey", the parts box is drawn
 * inside a journey, and nothing connected the two. So the second press in
 * this section is the one they came for. It opens the same offer the parts
 * box makes — the paper's chapter files, listed, nothing made — and its
 * confirming press begins the journey AND makes the parts, in that order,
 * with `begin` doing exactly what the button above it does. For an epic with
 * no paper there are no chapters to list, and the press says so and offers to
 * begin the journey and open the box where parts are made by hand.
 *
 * `data-divide` is what a host's walk lands on; see `settleParts`.
 */
function Begin({
  epic,
  busy,
  dividing,
  chapters,
  making,
}: {
  epic: string
  busy: boolean
  dividing: boolean
  chapters: PaperChapters | null
  making: boolean
}) {
  const mine = chapters && chapters.slug === epic ? chapters : null
  return (
    <section className="mt-3 flex min-w-0 flex-col items-start gap-1.5">
      <p className="text-[0.82rem] leading-6 text-muted-foreground">
        The host holds <span className="font-mono text-[0.9em] [overflow-wrap:anywhere]">{epic}</span>, and this app
        keeps no journey for it yet. Beginning one copies what the host holds for it — its steps, its groups and its
        prose — into this project’s journeys, and from then on the steps are edited here and the host reads them from
        here. The host’s own file is left as it is.
      </p>
      <Button
        type="button"
        variant="outline"
        size="container"
        disabled={busy}
        onClick={() => void begin()}
      >
        {busy ? 'beginning…' : `begin the journey for ${epic}`}
      </Button>

      <div data-divide={dividing ? 'open' : 'closed'} className="mt-2 grid w-full min-w-0 gap-1.5 border-t pt-2.5 text-[0.85rem] leading-6">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Button
            type="button"
            variant={dividing ? 'ghost' : 'outline'}
            size="container"
            aria-expanded={dividing}
            disabled={busy || making}
            onClick={() => setDividing(!dividing)}
          >
            divide {epic} into parts…
          </Button>
          {!dividing && (
            <span className="text-[0.82rem] text-muted-foreground">
              Parts are headings a host lets a person narrow every container to. They are made here.
            </span>
          )}
        </div>
        {dividing &&
          (mine === null ? (
            <p className="text-muted-foreground">Reading this epic’s paper for its chapter files…</p>
          ) : mine.paper && !mine.nothing ? (
            <ChapterOffer chapters={mine} beginning busy={making || busy} onLeave={() => setDividing(false)} />
          ) : (
            <div className="grid gap-1.5 rounded border border-dashed px-2 py-1.5">
              <p className="text-muted-foreground">
                {mine.paper
                  ? mine.nothing
                  : `This epic has no paper in this project (no main.tex in .kehikot/paper/${epic}/), so there are no chapter files to make parts from.`}{' '}
                Parts can be made by hand, with a heading each. They are kept in the journey, so it is begun first —
                copying what the host holds for the epic, as the press above does.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="container" disabled={busy} onClick={() => void beginAndArrange()}>
                  {busy ? 'beginning…' : 'begin the journey and make parts by hand'}
                </Button>
                <Button type="button" variant="ghost" size="container" disabled={busy} onClick={() => setDividing(false)}>
                  leave it
                </Button>
              </div>
            </div>
          ))}
      </div>
    </section>
  )
}

/**
 * What the canvas is narrowed to, said where the steps are about to be fewer.
 *
 * Drawn only when the host says some of the epic's parts are picked out. A
 * list that is shorter than it was for a reason nobody can see is the failure
 * parts are arranged against, so this is not a tooltip and not a badge: it is
 * a sentence, above the steps, with both numbers in it — how many are shown
 * and how many are outside — and how many of those are in no part at all,
 * which is the number that explains a page showing none.
 *
 * It offers nothing that changes the focus. The focus is the person's and the
 * host holds it for every module on the canvas; a "show the rest" here would
 * be one pane quietly disagreeing with the panes beside it. It says where the
 * picking is done instead.
 *
 * ## The one press it does offer is about the steps, not the focus
 *
 * A step in no part is outside every focus, so a journey whose steps nobody
 * has filed shows none of them the moment a part is picked. For two stages
 * that was a sentence with a number in it and nothing to do: which part a
 * step is in was a field in a file. It can be said on this page now, so the
 * sentence ends in the press that opens where it is said. That is not this
 * pane disagreeing with its neighbours — filing a step changes the journey,
 * for every pane, and the steps appear here because they are now in the part
 * the person picked.
 */
function Narrowed({
  parts,
  journey,
  editing,
  canFile,
}: {
  parts: readonly EpicPart[]
  journey: JourneyView
  editing: number
  /**
   * Whether this journey's own record has parts to file a step under. The
   * parts in the sentence are the host's; they are this record's groups
   * unless the host is answering from somewhere else, and a press that opened
   * a box with no part in it would be an offer this page cannot keep.
   */
  canFile: boolean
}) {
  const said = narrowing(parts, journey.steps, editing)
  if (!said) return null
  const { lead, rest, file } = narrowedSaid(said)
  return (
    <p
      data-narrowed={said.shown}
      className="mb-3 rounded-md border border-l-2 border-l-primary bg-card px-3 py-2 text-[0.85rem] leading-6 text-muted-foreground"
    >
      <b className="text-foreground">{lead}</b> {rest}
      {file && canFile && (
        <>
          {' '}
          <span className="text-foreground">{file}</span>{' '}
          <Button
            type="button"
            variant="outline"
            size="container"
            data-file="open"
            className="align-baseline text-foreground"
            onClick={() => {
              setArranging(true)
              document.querySelector('[data-parts]')?.scrollIntoView({ block: 'nearest' })
            }}
          >
            file them under parts
          </Button>
        </>
      )}
    </p>
  )
}

/** A section heading, in the muted register the page uses for its own furniture. */
function Rubric({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-[0.8rem] font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>
  )
}

function Journey({
  journey,
  live,
  editing,
  adding,
  arranging,
  selection,
  parts,
  framed,
  chapters,
  making,
}: {
  journey: JourneyView
  live: Live | null
  editing: number
  adding: boolean
  arranging: boolean
  selection: readonly string[]
  parts: readonly EpicPart[]
  framed: boolean
  chapters: PaperChapters | null
  making: boolean
}) {
  /* Worked out once, here, and handed to both things that act on "the steps":
     the pair of presses above them and the list itself. Two filters would be
     a "pick every step" that picked steps nobody can see. */
  const focus = useFocus({ parts })
  const shown = journey.plan === 'stored' ? shownSteps(focus.parts, journey.steps, editing) : []
  /* The journey's own parts, read off the record this app's store answered
     with — not `parts` above, which is the host's later reading of the same
     record and is there only when a host is. What a step is FILED under is
     this app's material; what is PICKED is the host's. */
  const own = partsIn(arrangeable(journey))
  const narrowed = focus.focused
  const meta = [
    journey.umbrella ? `umbrella ${journey.umbrella}` : '',
    journey.written ? `written ${journey.written}` : '',
  ].filter(Boolean)

  return (
    <article>
      <h2 className="text-[1.15rem] leading-snug font-semibold tracking-tight">{journey.title}</h2>
      {journey.lede && (
        <p className="mt-1.5 text-[1.02rem] leading-7">
          <Prose text={journey.lede} />
        </p>
      )}
      {meta.length > 0 && <p className="mt-2 text-[0.82rem] text-muted-foreground">{meta.join(' · ')}</p>}
      {journey.callout && (
        <div className="mt-3 rounded-md border border-l-2 border-l-muted-foreground bg-card px-3 py-2 text-[0.95rem] leading-7">
          <Prose text={journey.callout} />
        </div>
      )}

      <Rubric>The journey</Rubric>
      {journey.plan === 'stored' && <Narrowed parts={focus.parts} journey={journey} editing={editing} canFile={own.length > 0} />}
      <Parts
        journey={journey}
        open={arranging}
        live={live}
        selection={selection}
        framed={framed}
        chapters={chapters}
        making={making}
      />
      {framed && journey.plan === 'stored' && shown.length > 0 && (
        <Picking shown={shown} live={live} selection={selection} />
      )}
      <Plan
        journey={journey}
        shown={shown}
        editing={editing}
        adding={adding}
        narrowed={narrowed}
        selection={selection}
        framed={framed}
        parts={own}
      />
    </article>
  )
}

/**
 * The two presses that act on every step at once: pick them all, and clear.
 *
 * ## Why "clear" clears everything, and says so
 *
 * The canvas selection is one list, and this page cannot take its own picks
 * off it without taking off whatever a neighbouring container picked — there
 * is no record on the wire of who picked what, on purpose. So the press is
 * labelled with what it does to the CANVAS rather than to this page, and it is
 * drawn only while there is something on the canvas to clear. A "clear" that
 * appears with nothing picked is a control that is useless in the state it is
 * most often seen in, which is the argument References makes for having no
 * such button at all; here the whole-journey pick earns the pair, because
 * picking eight steps one tick at a time and unticking them one at a time is
 * sixteen presses for one idea.
 *
 * ## Drawn only with a canvas to reach
 *
 * Standalone there is nothing to pick on, and the page already says so in the
 * box at the top. Framed with a plan kept elsewhere there are no steps of this
 * app's to pick; `Plan` explains that at length and this stays out of its way.
 */
function Picking({
  shown,
  live,
  selection,
}: {
  /** The steps on the page: every step, or the ones in the picked parts. */
  shown: readonly Shown[]
  live: Live | null
  selection: readonly string[]
}) {
  /* The union of what every step carries, in journey order, computed by the
     same function each step's own tick uses. Not the union of `step.refs`: the
     changes a tracker attaches to an issue are cards, are picked by the step's
     tick, and are in no `refs` array — a press here that sent less than the
     ticks would leave every such step drawn as partly picked. */
  const named = [...new Set(shown.flatMap(({ step }) => cardsUnder(live, step.refs ?? []).map((c) => c.ref)))]
  const all = pickedState(selection, named) === 'all'
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-muted-foreground">
      <Button
        type="button"
        variant="outline"
        size="container"
        disabled={!named.length}
        aria-pressed={all}
        title={
          named.length
            ? all
              ? 'Take every reference this journey’s steps carry off the canvas selection.'
              : 'Put every reference this journey’s steps carry onto the canvas selection.'
            : 'No step of this journey names a reference, so there is nothing of it a canvas could hold.'
        }
        onClick={() => pick(named)}
      >
        {all ? 'unpick every step' : 'pick every step'}
      </Button>
      {selection.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="container"
          title="Clear the canvas selection — everything picked here and in any other container."
          onClick={clearPick}
        >
          clear the {selection.length === 1 ? 'pick' : `${selection.length} picked`}
        </Button>
      )}
    </div>
  )
}

/**
 * THE distinction. Three answers, and the middle one is why this app exists in
 * the shape it is.
 *
 * A journey whose steps are projected out of a paper is NOT a journey with no
 * steps. Nothing here is empty; something here is out of sight, and showing one
 * as the other sends a reader to the wrong place — which is exactly the bug
 * that made this app say so on screen. The dashed edge is the visual half of
 * the same claim, and it is the same dashed edge the `unseen` badge wears, for
 * the same reason: this is an absence, not a state.
 */
function Plan({
  journey,
  shown,
  editing,
  adding,
  narrowed,
  selection,
  framed,
  parts,
}: {
  journey: JourneyView
  /** The steps to draw, each with its own position in the journey. See `focus.ts`. */
  shown: readonly Shown[]
  editing: number
  /** The editor for a step that is not written yet is open. */
  adding: boolean
  /** The host says some parts are picked, so not every step is drawn. */
  narrowed: boolean
  selection: readonly string[]
  framed: boolean
  /** The journey's own parts, for each step's chooser. Empty for a journey with none. */
  parts: readonly JourneyPart[]
}) {
  if (journey.plan === 'elsewhere' && journey.stepsFrom) {
    const from = journey.stepsFrom
    return (
      <div className="rounded-md border border-dashed border-draft/70 bg-card px-3 py-3 text-[0.95rem] leading-7">
        <b className="mb-1 block">This journey has steps. They are not here, and this app cannot read them.</b>
        <p>
          They are kept in <span className="font-mono text-[0.85em]">{from.where}</span> and projected out of it by{' '}
          {from.projector}.
        </p>
        {from.why && <p className="mt-2">{from.why}</p>}
        <p className="mt-2">
          This is not a journey with no steps. Nothing here is empty; something here is out of sight, and those are
          different enough that showing one as the other would send a reader to the wrong place — which is exactly the
          bug that made this app say so on screen.
        </p>
      </div>
    )
  }

  if (journey.plan === 'none') {
    return (
      <>
        <p className="text-[0.95rem] leading-7 text-muted-foreground italic">
          No steps have been written for this journey yet. Nothing is hidden and nothing is elsewhere — there simply
          are none.
        </p>
        <Adding at={1} open={adding} first />
      </>
    )
  }

  return (
    <>
      {journey.stepsFrom && (
        <div className="mb-3 rounded-md border border-dashed border-draft/70 bg-card px-3 py-3 text-[0.95rem] leading-7">
          <b className="mb-1 block">A paper sits beside these steps, and this app cannot read it.</b>
          <p>{journey.stepsFrom.why}</p>
          <p className="mt-2">
            The steps below are the ones this app holds. Where a host projects the paper instead, a reader there may be
            seeing a different set, and this app cannot tell you where the two disagree — only that they might.
          </p>
        </div>
      )}
      {/* By the step's own position, shown or not: narrowing must not
          renumber a step, re-key its editor or move what `kehikot.goto` calls
          step seven. */}
      {shown.map(({ step, index }) => (
        <StepBlock
          key={index}
          step={step}
          index={index}
          editing={editing === index}
          selection={selection}
          framed={framed}
          parts={parts}
          inPart={parts.length ? partOfStep(arrangeable(journey), step) : null}
        />
      ))}
      {/* Not under a focus. A step written here is in no part, and under a
          focus that is a step that vanishes the moment it is saved — kept, and
          counted in the line above, but a strange answer to "add a step". */}
      {!narrowed && <Adding at={journey.steps.length + 1} open={adding} />}
    </>
  )
}

/**
 * The step that is not written yet: a press, and then the same editor every
 * step has.
 *
 * A journey with no steps used to say so and stop. Its first step could be
 * written through the MCP door and from nowhere on this page, because the
 * editor hung off a step's own "edit" and there was no step to hang it off.
 * The store has always taken a position one past the end as "append"; this is
 * the editor pointed there, over an empty step.
 */
function Adding({ at, open, first = false }: { at: number; open: boolean; first?: boolean }) {
  return (
    <section data-adding={at} className={first ? 'mt-2' : 'mt-1 border-t pt-2.5'}>
      <Button
        type="button"
        variant={first ? 'outline' : 'ghost'}
        size="container"
        className={first ? undefined : 'text-muted-foreground'}
        aria-expanded={open}
        onClick={() => setAdding(!open)}
      >
        {open ? 'close' : first ? 'write the first step' : 'add a step'}
      </Button>
      {open && <Editor step={{ title: '', body: '', refs: [], notes: [] }} position={at} target="add" />}
    </section>
  )
}
