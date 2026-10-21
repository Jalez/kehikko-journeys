import { nameOfPart } from '../journeys.ts'
import type { JourneyView } from '../kinds.ts'

/** What the page says above every journey while the host is on "All epics". */
export const EVERYTHING_SAID =
  'All epics: every journey in this project, grouped by epic. Read-only here. To edit a journey’s steps or see the tracker states beside them, pick its epic.'

/**
 * Every journey of the project, by epic, while the host is on "All epics" (`context.scope:
 * 'project'`, protocol 2.9.0).
 *
 * ## Read-only, every step of it
 *
 * Editing a step is an edit of ONE epic: a new step asks the host to make a part of that epic
 * (`parts.set`), a step is filed under a part id the epic's list holds, and the states drawn
 * beside a step are the tracker reading asked for one journey's refs. None of that has an epic to
 * be about here, so nothing here edits, and the sentence above the list says how to: pick the
 * epic. There is no "current" epic whose steps could be the exception — with "All epics" every
 * journey is one of the others.
 *
 * ## Each epic is labelled, and so is each step's part
 *
 * A journey is the journey of one epic (its slug is the epic's), so the epic is the journey's
 * heading, with its slug beside it: the label a reader matches against the host's epic picker.
 * A journey whose steps are kept somewhere this app cannot read says so rather than reading as
 * a journey with none.
 *
 * References are drawn as plain names, not links: links come from a tracker reading, and none is
 * asked for the whole project at once.
 */
export function Everything({ journeys }: { journeys: readonly JourneyView[] | null }) {
  return (
    <section data-everything className="mt-2 grid gap-4">
      <p className="text-[0.82rem] leading-6 text-muted-foreground">{EVERYTHING_SAID}</p>
      {journeys === null ? (
        <p className="text-[0.82rem] text-muted-foreground">Reading every journey…</p>
      ) : (
        journeys.map((journey) => (
          <article key={journey.slug} data-epic={journey.slug} aria-labelledby={`epic-${journey.slug}`} className="grid gap-1.5">
            <h2 id={`epic-${journey.slug}`} className="flex flex-wrap items-baseline gap-x-2 text-base leading-tight font-semibold tracking-tight">
              <span>{journey.title || journey.slug}</span>
              <span className="font-mono text-[0.72rem] font-normal text-muted-foreground">epic {journey.slug}</span>
            </h2>
            {journey.plan === 'elsewhere' ? (
              <p className="text-[0.82rem] text-muted-foreground">Its steps are kept somewhere this app cannot read; pick the epic to see where.</p>
            ) : journey.steps.length === 0 ? (
              <p className="text-[0.82rem] text-muted-foreground">No steps yet.</p>
            ) : (
              <ol className="grid gap-1 pl-0">
                {journey.steps.map((step, i) => {
                  const part = nameOfPart(journey, step)
                  return (
                    <li key={`${journey.slug}-${i}`} data-step className="grid grid-cols-[1.6rem_1fr] gap-x-1 text-[0.88rem] leading-6">
                      <span className="text-right font-mono text-[0.75rem] text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {step.title || '(untitled)'}
                        {part && part !== step.title ? <span className="text-muted-foreground"> — {part}</span> : null}
                        {step.refs.length ? ' ' : null}
                        {step.refs.length ? (
                          <span className="font-mono text-[0.75rem] text-muted-foreground">{step.refs.join(' ')}</span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </article>
        ))
      )}
    </section>
  )
}
