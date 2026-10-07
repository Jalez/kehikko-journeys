import { useState } from 'react'
import type { JourneyPart } from 'kehikot-module-protocol'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'

import { cn } from '@/lib/utils.ts'

import { FILE_EXAMPLE, filesGiven, partOfStep, partsIn, proposed, removalOf, removalSaid, unassigned, type Arrangeable } from '../../parts.ts'
import { assignSteps, removePart, savePart, savePartFiles, setArranging, type PaperChapters } from '../journeys.ts'
import type { JourneyView, Live } from '../kinds.ts'
import { ChapterOffer } from './chapters.tsx'
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

/** What is open under one part's row. One at a time: they are four answers to one press. */
type Open = { kind: Under; id: string } | null

/** The four things a part's row can have open beneath it. */
type Under = 'rename' | 'files' | 'remove' | 'propose'

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
 * ## When the epic has a paper, the box offers its chapters
 *
 * A paper is usually divided already, a file to a chapter, and the box says
 * so before it asks anybody to type a heading: "make a part for each chapter
 * file…" lists what `main.tex` pulls in and makes nothing until the list has
 * been read. See `view/chapters.tsx` for the list and `chapters.ts` for the
 * reading. With no part yet it is the first thing in the box and the filled
 * button; once there are parts it is one quiet press among the others, and
 * it is still there, because a chapter written next month is a part to make
 * then.
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
  chapters = null,
  making = false,
}: {
  journey: JourneyView
  open: boolean
  live: Live | null
  selection: readonly string[]
  framed: boolean
  /** What the epic's paper says about parts, once asked; null before, and for a page that never asked. */
  chapters?: PaperChapters | null
  /** Parts are being made from the paper's chapter files. */
  making?: boolean
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
  const [offering, setOffering] = useState(false)
  /* The paper's answer for THIS journey, and only when it has a paper. One
     that arrived for the epic the canvas just left is not this one's. */
  const paper = chapters && chapters.paper && chapters.slug === journey.slug ? chapters : null

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

      {paper && (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Button
              type="button"
              variant={parts.length ? 'ghost' : 'default'}
              size="container"
              className={parts.length ? 'text-muted-foreground' : undefined}
              aria-expanded={offering}
              data-offer="chapters"
              title="List the files main.tex of this epic’s paper pulls in, each as the part it would become. Nothing is made until you say so."
              onClick={() => setOffering(!offering)}
            >
              make a part for each chapter file…
            </Button>
            {!offering && !parts.length && (
              <span className="text-muted-foreground">
                This epic has a paper. Its chapter files can each become a part — the list is shown first.
              </span>
            )}
          </div>
          {offering && <ChapterOffer chapters={paper} busy={making} onLeave={() => setOffering(false)} />}
        </div>
      )}

      {parts.length > 0 && (
        <ul className="grid gap-1.5">
          {parts.map((part) => (
            <PartRow
              key={part.id}
              part={part}
              record={record}
              parts={parts}
              paperFiles={paper ? paper.files : null}
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
 * One part: what it is called, what is in it, and the four things that can be
 * done to it.
 *
 * ## Its files are ticked from the paper's own, and may still be typed
 *
 * A part may own files of the epic's paper (protocol 0.32.0), and a module
 * that shows the paper narrows to them. They are edited here because the
 * parts are this app's. They used to be TYPED, every one, because this app
 * read nothing of the paper: a person spelled `chapters/3_methods.tex` into
 * a box and found out on another module's page whether they had spelled it.
 *
 * Where the epic has a paper the files are listed now — every file
 * `main.tex` reaches, in reading order — and each is a box: ticked is this
 * part's, and a file another part holds says whose. That is `paper.ts`
 * reading the person's `.tex` files and nothing else of the Paper module's.
 *
 * Typing stays, under the list, for the two cases a list cannot serve: an
 * epic whose paper this app does not read (there is none here yet, or its
 * folder is a link out of the project), and a file that is not written yet.
 * A typed name is handed to the store, which shows back exactly what it kept
 * (`./chapters/a.tex` comes back as `chapters/a.tex`) or its sentence for
 * why it kept nothing. A name a part holds that the paper does NOT have is
 * listed apart and marked, since picking that part narrows to nothing for
 * it.
 *
 * Each press is one write of the whole list, like every other press in this
 * box; there is no "apply".
 *
 * A name another part of the journey already holds is allowed. See
 * `filesSaid` in `parts.ts`: the store says so in the line it answers with.
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
  parts,
  paperFiles,
  storesSteps,
  under,
  setUnder,
}: {
  part: JourneyPart
  /** Every part of the journey, to say whose a file already is. */
  parts: readonly JourneyPart[]
  /** Every file of the epic's paper but `main.tex`, in reading order — or null when this app reads no paper for it. */
  paperFiles: readonly string[] | null
  record: Arrangeable
  /** False for a journey whose steps are kept elsewhere: there is nothing here to file. */
  storesSteps: boolean
  under: Under | null
  setUnder: (kind: Under | null) => void
}) {
  const [name, setName] = useState(part.heading)
  const [file, setFile] = useState('')
  /* Why the name in the box was not kept, said beside the box. The page's one
     line for what the store answered is at the foot of the journey, which is
     a screen away from a part's row in a narrow container. */
  const [refused, setRefused] = useState('')
  const files = part.files ?? []
  /* What the part holds that the paper does not have: a name typed for a
     file not written yet, or one that was misspelled. With no paper read
     every name is one of these, and the list is the plain list it was. */
  const strays = paperFiles ? files.filter((one) => !paperFiles.includes(one)) : files
  const elsewhere = (file: string) =>
    parts.filter((other) => other.id !== part.id && (other.files ?? []).includes(file)).map((other) => other.heading)
  const press = (kind: Under) => {
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
          {files.length > 0 && ` · ${plural(files.length, 'file')}`}
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
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="text-muted-foreground"
            aria-expanded={under === 'files'}
            title="Say which files of this epic’s paper are this part’s. A module that shows the paper then shows only those while the part is picked."
            onClick={() => press('files')}
          >
            files
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

      {/* What is stored, shown back, whether or not the editor is open: a
          part that owns files narrows a paper to them, and a row that kept
          that behind a press would be a focus nobody could read off the page. */}
      {files.length > 0 && under !== 'files' && (
        <p data-files={part.id} className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          owns{' '}
          {files.map((one, index) => (
            <span key={one}>
              {index > 0 && ', '}
              <code className="font-mono">{one}</code>
            </span>
          ))}
        </p>
      )}

      {under === 'files' && (
        <div data-files-of={part.id} className="mt-1 grid gap-1.5 rounded border border-dashed px-2 py-1.5">
          <p className="text-muted-foreground">
            The files of this epic’s paper that are this part’s. While the part is picked, a module showing the
            paper shows only these.{' '}
            {paperFiles
              ? paperFiles.length
                ? 'Tick them below: these are the files main.tex pulls in, in the paper’s order.'
                : 'The paper is main.tex alone so far: it pulls in no other file to tick.'
              : 'This epic has no paper in this project that this app can read, so each is typed as it is named from the paper’s folder.'}
          </p>
          {paperFiles && paperFiles.length > 0 && (
            <ul data-paper-files className="grid gap-0.5">
              {paperFiles.map((one) => {
                const held = elsewhere(one)
                return (
                  <li key={one}>
                    <label className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={files.includes(one)}
                        onChange={() =>
                          void savePartFiles(part.id, files.includes(one) ? files.filter((kept) => kept !== one) : [...files, one])
                        }
                        aria-label={`${one} is ${part.heading}’s`}
                        className="size-3.5 shrink-0 translate-y-0.5 accent-primary"
                      />
                      <code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{one}</code>
                      {held.length > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground italic">in {held.join(', ')}</span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {files.length === 0 && !(paperFiles && paperFiles.length) ? (
            <p className="italic text-muted-foreground">This part owns no file yet.</p>
          ) : strays.length === 0 ? null : (
            <ul className="grid gap-0.5">
              {paperFiles && (
                <li className="text-xs text-muted-foreground">
                  {strays.length === 1 ? 'A name' : 'Names'} this part holds that the paper does not have — not written
                  yet, or not spelled as the file is:
                </li>
              )}
              {strays.map((one) => (
                <li key={one} data-stray={paperFiles ? one : undefined} className="flex min-w-0 items-baseline gap-2">
                  <code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{one}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="container"
                    className="shrink-0 text-muted-foreground"
                    aria-label={`Take ${one} out of ${part.heading}`}
                    onClick={() => void savePartFiles(part.id, files.filter((kept) => kept !== one))}
                  >
                    take out
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {paperFiles && (
            <p className="text-xs text-muted-foreground">
              Or type a name, for a file that is not in the paper yet — as it will be named from the paper’s folder,
              with its extension, like <code className="font-mono">{FILE_EXAMPLE}</code>:
            </p>
          )}
          {!paperFiles && (
            <p className="text-xs text-muted-foreground">
              With its extension — for example <code className="font-mono">{FILE_EXAMPLE}</code>. A name is kept as
              typed; the paper’s own module says when a picked part names a file the paper does not have.
            </p>
          )}
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              if (!file.trim()) return
              /* Asked here first, of the function the store itself asks
                 (`filesGiven`), so a name that is not a file's is refused
                 beside the box it was typed in and nothing is sent. Then the
                 whole list goes, with the new name last, and the store
                 answers with the form it kept. Either way a refused name
                 stays in the box to be corrected. */
              const read = filesGiven([...files, file])
              if (!read.ok) {
                setRefused(read.error)
                return
              }
              setRefused('')
              void savePartFiles(part.id, [...files, file]).then((done) => {
                if (done) setFile('')
              })
            }}
          >
            <Input
              aria-label={`A file of the paper for ${part.heading}`}
              placeholder={FILE_EXAMPLE}
              value={file}
              onChange={(event) => {
                setFile(event.target.value)
                setRefused('')
              }}
              aria-invalid={refused ? true : undefined}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-7 min-w-[9rem] flex-1 font-mono text-xs"
            />
            <Button type="submit" variant="outline" size="container" disabled={!file.trim()}>
              add file
            </Button>
          </form>
          {refused && (
            <p role="alert" data-refused className="text-block">
              {refused}
            </p>
          )}
        </div>
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
