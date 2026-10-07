import { useEffect, useSyncExternalStore } from 'react'
import type { EpicPart, JourneyPart } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button.tsx'

import { narrowedSaid, narrowing, shownSteps, type Shown } from './focus.ts'
import { partOfStep, partsIn } from '../parts.ts'
import { begin, clearPick, getSnapshot, grow, pick, setAdding, setArranging, subscribe } from './journeys.ts'
import type { JourneyView, Live } from './kinds.ts'
import { cardsUnder } from './live/lookup.ts'
import { pickedState } from './refs.ts'
import { Editor } from './view/editor.tsx'
import { NoJourneys, NoProject, Trouble } from './view/nowhere.tsx'
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
        <Head journey={state.journey} />
        <Sight
          framed={state.framed}
          refused={state.refused}
          epic={state.epic}
          journey={state.journey}
          live={state.live}
          busy={state.busy}
        />
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
          <Begin epic={state.epic} busy={state.beginning} />
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
          />
        )}
        {/* The one line this app uses to answer the reader. Polite rather than
            assertive: it is an answer to something they just did, not an
            interruption of what they are reading. */}
        <p aria-live="polite" className="mt-4 min-h-[1.4em] text-[0.82rem] text-muted-foreground">
          {state.said}
        </p>
      </div>
    </ReadingProvider>
  )
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
  if (state.nowhere) return <NoProject unhosted={!state.framed} />
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
 */
function Begin({ epic, busy }: { epic: string; busy: boolean }) {
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
  canFile,
}: {
  parts: readonly EpicPart[]
  journey: JourneyView
  /**
   * Whether this journey's own record has parts to file a step under. The
   * parts in the sentence are the host's; they are this record's groups
   * unless the host is answering from somewhere else, and a press that opened
   * a box with no part in it would be an offer this page cannot keep.
   */
  canFile: boolean
}) {
  const said = narrowing(parts, journey.steps)
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
}: {
  journey: JourneyView
  live: Live | null
  editing: number
  adding: boolean
  arranging: boolean
  selection: readonly string[]
  parts: readonly EpicPart[]
  framed: boolean
}) {
  /* Worked out once, here, and handed to both things that act on "the steps":
     the pair of presses above them and the list itself. Two filters would be
     a "pick every step" that picked steps nobody can see. */
  const shown = journey.plan === 'stored' ? shownSteps(parts, journey.steps) : []
  /* The journey's own parts, read off the record this app's store answered
     with — not `parts` above, which is the host's later reading of the same
     record and is there only when a host is. What a step is FILED under is
     this app's material; what is PICKED is the host's. */
  const own = partsIn(arrangeable(journey))
  const narrowed = parts.some((part) => part.picked)
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
      {journey.plan === 'stored' && <Narrowed parts={parts} journey={journey} canFile={own.length > 0} />}
      <Parts journey={journey} open={arranging} live={live} selection={selection} framed={framed} />
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
      {open && <Editor step={{ title: '', body: '', refs: [], notes: [] }} position={at} />}
    </section>
  )
}
