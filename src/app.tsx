import { useEffect, useSyncExternalStore } from 'react'

import { getSnapshot, grow, subscribe } from './journeys.ts'
import type { JourneyView } from './kinds.ts'
import { NoJourneys, NoProject, Trouble } from './view/nowhere.tsx'
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
    <ReadingProvider value={{ live: state.live, journey: state.journey }}>
      <div className="mx-auto w-full max-w-[44rem] px-3 pt-3 pb-12 @min-[26rem]/container:px-4 @min-[26rem]/container:pt-4">
        <Head journey={state.journey} />
        <Sight framed={state.framed} refused={state.refused} journey={state.journey} live={state.live} />
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
        {state.journey && <Journey journey={state.journey} editing={state.editing} />}
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
 * knowable before anything renders, and a frame that is not a roadmap host
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

/** A section heading, in the muted register the page uses for its own furniture. */
function Rubric({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-[0.8rem] font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>
  )
}

function Journey({ journey, editing }: { journey: JourneyView; editing: number }) {
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
      <Plan journey={journey} editing={editing} />
    </article>
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
function Plan({ journey, editing }: { journey: JourneyView; editing: number }) {
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
      <p className="text-[0.95rem] leading-7 text-muted-foreground italic">
        No steps have been written for this journey yet. Nothing is hidden and nothing is elsewhere — there simply are
        none.
      </p>
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
      {journey.steps.map((step, i) => (
        <StepBlock key={i} step={step} index={i} editing={editing === i} />
      ))}
    </>
  )
}
