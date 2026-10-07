import { useState } from 'react'
import type { JourneyPart } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'

import { cn } from '@/lib/utils.ts'

import { partOfStep, partsIn, proposed, removalOf, removalSaid, unassigned, type Arrangeable } from '../../parts.ts'
import { assignSteps, removePart, savePart, setArranging } from '../journeys.ts'
import type { JourneyView, Live } from '../kinds.ts'
import { cardsUnder } from '../live/lookup.ts'
import { pickedState } from '../refs.ts'

/**
 * The journey's two lists as `parts.ts` reads them. `groups` is absent from a
 * server that predates parts, and that is a journey with none.
 */
export function arrangeable(journey: JourneyView): Arrangeable {
  return { steps: journey.steps, groups: journey.groups ?? [] }
}

/**
 * Which part one step is in: a native `<select>`, and deliberately nothing
 * cleverer.
 *
 * It sits in a step's head in a container that is often 280 pixels wide, and
 * the list it opens is the operating system's — which is the one menu on this
 * page that cannot be clipped by the frame it is drawn in, and that a keyboard
 * and a screen reader already know. `color-scheme` on the root (see
 * `index.css`) is what makes that list dark in the dark theme.
 *
 * "in no part" is a value and the first one, so taking a step out of a part
 * is the same gesture as putting it in one. A step that names a part the
 * journey no longer has reads as in no part, which is what a focus makes of
 * it; choosing a part replaces the stale name.
 */
export function PartChooser({
  parts,
  value,
  label,
  onChoose,
  className,
}: {
  parts: readonly JourneyPart[]
  /** The id of the part chosen now, or null for none. */
  value: string | null
  label: string
  onChoose: (part: string | null) => void
  className?: string
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value ?? ''}
      onChange={(event) => onChoose(event.target.value || null)}
      className={cn(
        'h-6 max-w-[11rem] min-w-0 shrink rounded border bg-background px-1 text-xs',
        value === null ? 'text-muted-foreground italic' : 'text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <option value="">in no part</option>
      {parts.map((part) => (
        <option key={part.id} value={part.id}>
          {part.heading}
        </option>
      ))}
    </select>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What is open under one part's row. One at a time: they are three answers to one press. */
type Open = { kind: 'rename' | 'remove' | 'propose'; id: string } | null

/**
 * Where a journey is arranged into parts: the parts themselves, and which
 * step is in which.
 *
 * ## Why this box exists at all
 *
 * A host lets a person focus the canvas on some of an epic's parts, and a
 * step that names no part is outside every focus — decided, and argued in
 * `focus.ts`. Until this box, nothing in the workspace could say which part a
 * step is in, or make a part: it was a field in a JSON file. So the first
 * thing picking a part did, on every real journey, was empty the page, with a
 * sentence explaining that all thirty-eight steps were in no part and no way
 * to do anything about it.
 *
 * ## It is folded, and the fold says the number that matters
 *
 * Closed, this is one line: how many parts, and how many steps are in none.
 * A journey is read far more often than it is arranged, and a list of every
 * step above the steps would be the page saying everything twice. The second
 * number is the reason to open it, so it is on the fold rather than inside.
 *
 * ## It lists steps the page is not showing, and that is the point
 *
 * Under a focus the steps in no part are exactly the ones that are not drawn
 * below. An assignment control that lived only on a step's own head could
 * therefore never reach the steps that need it most. So this box lists steps
 * by their own position and title whatever is picked in the host's bar. It
 * does not widen the focus — nothing here draws a hidden step's body or its
 * cards — it names what is there to be filed.
 *
 * ## A journey with no parts shows one quiet press and nothing else
 *
 * No chooser on a step, no list, no counts: a journey nobody has divided is
 * the ordinary journey, and the page it had before parts existed is the right
 * page for it. What it does get is the way IN, because without one the first
 * part can only be made by hand-editing the file.
 *
 * ## The ticks here are not the canvas selection
 *
 * A step's tick in the journey below puts its REFERENCES on the canvas, for
 * every container to see. The ticks in this box are this box's own and go
 * nowhere: they say which steps the next "file" press is about. They are
 * kept apart because they are different facts — a step with no reference
 * cannot be picked on a canvas at all and can certainly be filed. The bridge
 * between the two is one explicit press, "tick the ones picked on the
 * canvas", so that picking every step and then filing them is two presses.
 */
export function Parts({
  journey,
  open,
  live,
  selection,
  framed,
}: {
  journey: JourneyView
  open: boolean
  live: Live | null
  selection: readonly string[]
  framed: boolean
}) {
  const record = arrangeable(journey)
  const parts = partsIn(record)
  const steps = journey.plan === 'stored' ? journey.steps : []
  const loose = journey.plan === 'stored' ? unassigned(record) : []

  /* Zero-based positions, like every index on this page. */
  const [ticked, setTicked] = useState<readonly number[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [under, setUnder] = useState<Open>(null)
  const [every, setEvery] = useState(false)
  const [heading, setHeading] = useState('')

  if (!open) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-muted-foreground">
        <Button
          type="button"
          variant={parts.length ? 'outline' : 'ghost'}
          size="container"
          aria-expanded={false}
          data-parts="closed"
          className={parts.length ? undefined : 'text-muted-foreground'}
          title={
            parts.length
              ? 'Make, reword and remove this journey’s parts, and file steps under them.'
              : 'Divide this journey into parts: headings that steps are filed under, which a host lets a person narrow the canvas to.'
          }
          onClick={() => setArranging(true)}
        >
          {parts.length ? plural(parts.length, 'part') : 'divide into parts'}
        </Button>
        {parts.length > 0 && steps.length > 0 && (
          <span>
            {loose.length === 0
              ? `every step is in one`
              : `${loose.length} of ${plural(steps.length, 'step')} in no part`}
          </span>
        )}
      </div>
    )
  }

  /* A tick on a step that is no longer there is dropped where it is read, so a
     journey that changed under this box never files a position it did not show. */
  const ticks = ticked.filter((index) => index < steps.length)
  const chosen = target !== null && parts.some((part) => part.id === target) ? target : null
  const listed = every ? steps.map((_, index) => index) : loose
  const onCanvas = framed
    ? steps.flatMap((step, index) => {
        const carries = [...new Set(cardsUnder(live, step.refs ?? []).map((card) => card.ref))]
        return pickedState(selection, carries) === 'all' ? [index] : []
      })
    : []

  const toggle = (index: number) =>
    setTicked(ticks.includes(index) ? ticks.filter((one) => one !== index) : [...ticks, index])

  const file = async () => {
    if (!ticks.length) return
    const done = await assignSteps(
      ticks.map((index) => index + 1),
      chosen,
    )
    if (done) setTicked([])
  }

  return (
    <section
      data-parts="open"
      aria-label="This journey’s parts"
      className="mb-4 grid min-w-0 gap-3 rounded-md border bg-card px-3 py-2.5 text-[0.85rem] leading-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <b>{parts.length ? plural(parts.length, 'part') : 'No parts yet'}</b>
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="text-muted-foreground"
          aria-expanded
          onClick={() => setArranging(false)}
        >
          close
        </Button>
      </div>
      <p className="text-muted-foreground">
        A part is a heading that steps are filed under. A host shows the parts beside the epic so a person can narrow
        every container to some of them — and a step filed under none is then not shown.
      </p>

      {parts.length > 0 && (
        <ul className="grid gap-1.5">
          {parts.map((part) => (
            <PartRow
              key={part.id}
              part={part}
              record={record}
              storesSteps={journey.plan === 'stored'}
              under={under?.id === part.id ? under.kind : null}
              setUnder={(kind) => setUnder(kind ? { kind, id: part.id } : null)}
            />
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!heading.trim()) return
          void savePart(null, heading).then((done) => {
            if (done) setHeading('')
          })
        }}
      >
        <Input
          aria-label="Heading of a new part"
          placeholder="a new part’s heading"
          value={heading}
          onChange={(event) => setHeading(event.target.value)}
          className="h-7 min-w-[9rem] flex-1 text-[0.85rem]"
        />
        <Button type="submit" variant="outline" size="container" disabled={!heading.trim()}>
          add part
        </Button>
      </form>

      {parts.length > 0 && steps.length > 0 && (
        <div className="grid gap-1.5 border-t pt-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <b>
              {loose.length === 0
                ? 'Every step is in a part'
                : `${loose.length} of ${plural(steps.length, 'step')} in no part`}
            </b>
            {steps.length > loose.length && (
              <Button
                type="button"
                variant="ghost"
                size="container"
                className="text-muted-foreground"
                aria-pressed={every}
                onClick={() => setEvery(!every)}
              >
                {every ? 'list only those in no part' : `list all ${steps.length}`}
              </Button>
            )}
          </div>

          {listed.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="container"
                  className="text-muted-foreground"
                  onClick={() => setTicked(listed.every((index) => ticks.includes(index)) ? [] : [...listed])}
                >
                  {listed.every((index) => ticks.includes(index)) ? 'untick all' : `tick all ${listed.length}`}
                </Button>
                {onCanvas.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="container"
                    className="text-muted-foreground"
                    title="Tick the steps whose references are all picked on the canvas — by ‘pick every step’ below, by a step’s own tick, or in another container."
                    onClick={() => {
                      /* The list is widened first when it has to be, so that
                         nothing is ever ticked out of sight. */
                      if (!onCanvas.every((index) => listed.includes(index))) setEvery(true)
                      setTicked([...new Set([...ticks, ...onCanvas])])
                    }}
                  >
                    tick the {onCanvas.length} picked on the canvas
                  </Button>
                )}
              </div>
              <ul className="grid gap-0.5">
                {listed.map((index) => {
                  const step = steps[index]
                  if (!step) return null
                  const inPart = partOfStep(record, step)
                  const said = parts.find((part) => part.id === inPart)?.heading ?? null
                  return (
                    <li key={index}>
                      <label className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={ticks.includes(index)}
                          onChange={() => toggle(index)}
                          className="size-3.5 shrink-0 translate-y-0.5 accent-primary"
                        />
                        <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          {step.title}
                          {every && (
                            <span className={cn('ml-1.5 text-xs text-muted-foreground', !said && 'italic')}>
                              — {said ?? 'in no part'}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">
                  {ticks.length ? `file the ${ticks.length} ticked under` : 'tick steps, then file them under'}
                </span>
                <PartChooser parts={parts} value={chosen} label="The part to file the ticked steps under" onChoose={setTarget} />
                <Button
                  type="button"
                  size="container"
                  disabled={!ticks.length}
                  data-file="ticked"
                  onClick={() => void file()}
                >
                  {chosen === null ? 'take out of every part' : 'file'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One part: what it is called, what is in it, and the three things that can be
 * done to it.
 *
 * ## "by references" shows before it does
 *
 * The one convenience on this page that reads a step's references to decide
 * something, and it is fenced accordingly; see `proposed` in `parts.ts` for
 * the argument. The press never files anything. It opens the list of steps it
 * WOULD file — by number and title, so each can be checked against what the
 * person knows — and a second press, which says the count again, does it.
 * A proposal of nothing says why instead of doing nothing.
 *
 * ## Removing says what it takes, in the store's own words
 *
 * `removalSaid` is the sentence MCP's `remove_part` answers with, counted by
 * the function the store removes by, so what a person agrees to here is what
 * happens. Steps are never among what goes.
 */
function PartRow({
  part,
  record,
  storesSteps,
  under,
  setUnder,
}: {
  part: JourneyPart
  record: Arrangeable
  /** False for a journey whose steps are kept elsewhere: there is nothing here to file. */
  storesSteps: boolean
  under: 'rename' | 'remove' | 'propose' | null
  setUnder: (kind: 'rename' | 'remove' | 'propose' | null) => void
}) {
  const [name, setName] = useState(part.heading)
  const press = (kind: 'rename' | 'remove' | 'propose') => {
    if (kind === 'rename') setName(part.heading)
    setUnder(under === kind ? null : kind)
  }
  const would = under === 'propose' ? proposed(record, part.id) : []
  const gone = under === 'remove' ? removalOf(record, part.id) : null

  return (
    <li data-part={part.id} className="min-w-0 border-t pt-1.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0 flex-[1_1_9rem] font-medium [overflow-wrap:anywhere]">{part.heading}</span>
        <span className="text-xs text-muted-foreground">
          {plural(part.steps, 'step')} · {plural(part.refs.length, 'reference')}
        </span>
        <span className="flex flex-wrap gap-x-0.5">
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="text-muted-foreground"
            aria-expanded={under === 'rename'}
            onClick={() => press('rename')}
          >
            rename
          </Button>
          {storesSteps && (
            <Button
              type="button"
              variant="ghost"
              size="container"
              className="text-muted-foreground"
              aria-expanded={under === 'propose'}
              title="List the steps in no part whose references are all among this part’s. Nothing is filed until you say so."
              onClick={() => press('propose')}
            >
              by references…
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="text-muted-foreground"
            aria-expanded={under === 'remove'}
            onClick={() => press('remove')}
          >
            remove
          </Button>
        </span>
      </div>

      {under === 'rename' && (
        <form
          className="mt-1 flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            void savePart(part.id, name).then((done) => {
              if (done) setUnder(null)
            })
          }}
        >
          <Input
            aria-label={`New heading for ${part.heading}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-7 min-w-[9rem] flex-1 text-[0.85rem]"
          />
          <Button type="submit" size="container" disabled={!name.trim() || name.trim() === part.heading}>
            rename
          </Button>
        </form>
      )}

      {under === 'propose' && (
        <div data-proposal={part.id} className="mt-1 grid gap-1 rounded border border-dashed px-2 py-1.5">
          {would.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing to propose: no step in no part has all of its references among this part’s{' '}
              {plural(part.refs.length, 'reference')}.
            </p>
          ) : (
            <>
              <p>
                {would.length === 1 ? 'This step is' : `These ${would.length} steps are`} in no part and name only
                references this part holds. Nothing has been filed.
              </p>
              <ul className="grid gap-0.5 text-muted-foreground">
                {would.map((index) => (
                  <li key={index} className="flex min-w-0 gap-2">
                    <span className="w-6 shrink-0 text-xs tabular-nums">{index + 1}.</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{record.steps[index]?.title}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="container"
                  data-file="proposed"
                  onClick={() =>
                    void assignSteps(
                      would.map((index) => index + 1),
                      part.id,
                    ).then((done) => {
                      if (done) setUnder(null)
                    })
                  }
                >
                  file {would.length === 1 ? 'this step' : `these ${would.length}`} under {part.heading}
                </Button>
                <Button type="button" variant="ghost" size="container" onClick={() => setUnder(null)}>
                  leave them
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {under === 'remove' && gone && (
        <div data-removal={part.id} className="mt-1 grid gap-1 rounded border border-dashed border-block/60 px-2 py-1.5">
          <p>
            Remove <b>{part.heading}</b>? {removalSaid(gone)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="container"
              className="border-block/60 text-block"
              onClick={() =>
                void removePart(part.id).then((done) => {
                  if (done) setUnder(null)
                })
              }
            >
              remove the part
            </Button>
            <Button type="button" variant="ghost" size="container" onClick={() => setUnder(null)}>
              keep it
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
