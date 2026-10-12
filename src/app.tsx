import { useEffect, useSyncExternalStore } from 'react'
import type { EpicPart } from 'kehikot-module-protocol'
import { Cover, coverFor, useFocus, useServerStanding, type CoverState } from 'kehikot-module-protocol/client/react'

import { Button } from '@/components/ui/button.tsx'

import { NOUN, anchorOf, indexed, type Shown } from './focus.ts'
import {
  addTarget,
  begin,
  clearPick,
  getSnapshot,
  grow,
  discardHeld,
  heldStrays,
  pick,
  reopenHeld,
  retry,
  setAdding,
  stepless,
  subscribe,
} from './journeys.ts'
import type { JourneyView, Live } from './kinds.ts'
import { cardsUnder } from './live/lookup.ts'
import { pickedState } from './refs.ts'
import { Editor } from './view/editor.tsx'
import { NO_PROJECT_SAID, NoJourneys, Trouble, UNHOSTED_SAID } from './view/nowhere.tsx'
import { Picker } from './view/picker.tsx'
import { Prose } from './view/prose.tsx'
import { ReadingProvider } from './view/reading.tsx'
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
   * "No epic" covers nothing: what the project holds (or that it holds no journeys yet) is still
   * said underneath.
   *
   * ## Nothing stands above the journey
   *
   * A bordered paragraph used to open every framed page here: "Framed, reading thesis." and four
   * lines on whose the steps are and where the states beside the references come from. It was the
   * same paragraph on every load, about 170 pixels of a container that is often 340 tall. It is
   * gone, and each thing it said is said where it applies or not at all:
   *
   *  - that the host handed over no tracker reading, and why: beside each reference, by its own
   *    badge (`withheld`), which already said it;
   *  - that the trackers are being read again: in the line under the page, which is always there,
   *    while it is true;
   *  - that no epic is open: the cover's;
   *  - that this project holds no journey for the open epic: the press that begins one, which
   *    names the epic;
   *  - what the page is and where a reading comes from: nowhere. It was an explanation.
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
            addingFor={state.addingFor}
            selection={state.selection}
            parts={state.parts}
            projectPath={state.projectPath}
            framed={state.framed}
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
          {state.said || (state.busy && state.journey ? BUSY_SAID : '')}
        </p>
        </div>
      </div>
    </ReadingProvider>
  )
}

/**
 * What the line under the page says while the trackers are being read again and nothing else is
 * being answered: the states on screen are the reading before, and a reader comparing them with
 * the tracker should know a newer one is on its way.
 */
export const BUSY_SAID = 'The trackers are being read again; the states shown are the reading before.'

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
 * ## The press, and nothing else
 *
 * This used to be a paragraph on what beginning a journey copies, and under
 * it a second section for dividing the epic into parts. The paragraph is the
 * press's tooltip, and that this project holds no journey for the epic is
 * what the press itself says. What is left costs one line of a container
 * that has few.
 *
 * There was a second press here, "begin it with a step for each of the
 * paper's chapters". It read another module's folder to count them, and is
 * gone with that read: a part's chapter is kept by the module that keeps the
 * paper.
 *
 * `data-begin` is what a host's walk to the parts lands on; see `settleParts`.
 */
function Begin({ epic, busy }: { epic: string; busy: boolean }) {
  return (
    <section data-begin className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1.5 text-[0.85rem] leading-6">
      <Button
        type="button"
        variant="outline"
        size="container"
        disabled={busy}
        title="Copies what the host holds for this epic — its steps and its prose — into this project’s journeys. From then on the steps are edited here and the host reads them from here; the host’s own file is left as it is."
        onClick={() => void begin()}
      >
        {busy ? 'beginning…' : `begin the journey for ${epic}`}
      </Button>
    </section>
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
  addingFor,
  selection,
  parts,
  projectPath,
  framed,
}: {
  journey: JourneyView
  live: Live | null
  editing: number
  adding: boolean
  addingFor: string | null
  selection: readonly string[]
  parts: readonly EpicPart[]
  projectPath: string | null
  framed: boolean
}) {
  /* The one rule, applied by the protocol: a step is shown when the part it
     is the step of is picked, or when nothing is. Worked out once, here, and
     handed to both things that act on "the steps": the pair of presses above
     them and the list itself. Two filters would be a "pick every step" that
     picked steps nobody can see. The step whose editor is open is kept. */
  const focus = useFocus({ parts, epic: journey.slug, projectPath })
  const narrowedTo = focus.narrow(journey.plan === 'stored' ? indexed(journey.steps) : [], anchorOf, {
    noun: NOUN,
    keep: ({ index }) => index === editing,
  })
  const shown = narrowedTo.shown
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
      {framed && journey.plan === 'stored' && shown.length > 0 && (
        <Picking shown={shown} live={live} selection={selection} />
      )}
      <Plan
        journey={journey}
        shown={shown}
        editing={editing}
        adding={adding}
        addingFor={addingFor}
        narrowed={narrowed}
        none={narrowedTo.empty || null}
        selection={selection}
        framed={framed}
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
  addingFor,
  narrowed,
  none,
  selection,
  framed,
}: {
  journey: JourneyView
  /** The steps to draw, each with its own position in the journey. See `focus.ts`. */
  shown: readonly Shown[]
  editing: number
  /** The editor for a step that is not written yet is open. */
  adding: boolean
  /** The part that step is for, when it is for one the host lists and that has none. */
  addingFor: string | null
  /** The host says some parts are picked, so not every step is drawn. */
  narrowed: boolean
  /** The protocol's one sentence for a journey the picked parts left no step of, or null. Nothing else is said about a focus. */
  none: string | null
  selection: readonly string[]
  framed: boolean
}) {
  /* The parts the host lists that have no step: offered where a step is added. */
  const free = stepless(journey)
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
        <Adding at={1} open={adding} forPart={addingFor} free={free} first />
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
        />
      ))}
      {/* Where the steps would be, and only when the picked parts left none:
          an empty journey with no reason reads as broken. */}
      {none && (
        <p data-narrowed="0" className="text-[0.85rem] leading-6 text-muted-foreground">
          {none}
        </p>
      )}
      {/* Not under a focus. A step written here is a part of its own, which
          is not one of the picked ones: it would vanish the moment it is
          saved — kept, but a strange answer to "add a step". */}
      {!narrowed && <Adding at={journey.steps.length + 1} open={adding} forPart={addingFor} free={free} />}
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
function Adding({
  at,
  open,
  forPart,
  free,
  first = false,
}: {
  at: number
  open: boolean
  /** The part the open editor's step is for, or null: a step for a part that does not exist yet. */
  forPart: string | null
  /** The parts the host lists that have no step, in the list's order. */
  free: readonly { id: string; name: string }[]
  first?: boolean
}) {
  const part = free.find((one) => one.id === forPart) ?? null
  return (
    <section data-adding={at} className={first ? 'mt-2' : 'mt-1 border-t pt-2.5'}>
      <span className="flex flex-wrap items-baseline gap-2">
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
        {/*
          A part somebody added in the host's picker has no step until one is
          written for it. One quiet control, here where a step is added and
          nowhere else: a press for one such part, a list for several. It
          opens the same editor, and Save files the step under that part
          instead of asking the host for a new one.
        */}
        {!open && free.length === 1 && (
          <Button
            type="button"
            variant="ghost"
            size="container"
            data-step-for={free[0]!.id}
            className="text-muted-foreground"
            title={`“${free[0]!.name}” is a part of this epic with no step. Writes its step.`}
            onClick={() => setAdding(true, free[0]!.id)}
          >
            a step for “{free[0]!.name}”
          </Button>
        )}
        {!open && free.length > 1 && (
          <select
            data-step-for=""
            aria-label="Write the step of a part that has none"
            className="h-7 max-w-full rounded-md border bg-transparent px-1.5 text-[0.8rem] text-muted-foreground"
            value=""
            onChange={(event) => {
              if (event.target.value) setAdding(true, event.target.value)
            }}
          >
            <option value="">a step for a part that has none…</option>
            {free.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        )}
        {open && part && <span className="text-[0.8rem] text-muted-foreground">the step of “{part.name}”</span>}
      </span>
      {open && (
        <Editor
          key={addTarget(part?.id ?? null)}
          step={{ title: part?.name ?? '', body: '', refs: [], notes: [] }}
          position={at}
          target={addTarget(part?.id ?? null)}
          forPart={part?.id ?? null}
        />
      )}
    </section>
  )
}
