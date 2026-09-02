import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'

import { cn } from '@/lib/utils.ts'

import { isChange, carriedBy, isSettled } from '../live/lookup.ts'
import { pick, setEditing } from '../journeys.ts'
import type { Live, Step } from '../kinds.ts'
import { pickedState } from '../refs.ts'
import { Card } from './card.tsx'
import { Editor } from './editor.tsx'
import { Prose } from './prose.tsx'
import { useReading } from './reading.tsx'

/**
 * One step of the journey: a number, a sentence somebody wrote, and the work
 * standing under it.
 *
 * ## The gutter, and why it is a container query
 *
 * The body, the notes, the cards and the editor all hang off a 2.1rem gutter
 * that lines them up under the step's title. In a 900px container that gutter is
 * what makes the page readable. In a 220px one it is fifteen per cent of every
 * line of prose spent on an alignment nobody can see, because the number it
 * aligns to wrapped four lines ago. So the gutter is added ABOVE 26rem rather
 * than removed below it — mobile-first, in a component whose commonest case
 * genuinely is the narrow one.
 *
 * `@min-[26rem]/container` and not `md:`. This module is framed in containers 220 to 400
 * pixels wide inside a window two thousand across, so every viewport breakpoint
 * Tailwind ships is true here and every one of them is answering a question
 * nobody asked. The container is the only box that has ever been the reason this page
 * was cramped.
 *
 * ## The head is allowed to wrap, and the title takes the line
 *
 * Releasing the title's minimum made the row fit, and fitting was the wrong
 * thing for it to do: the flex algorithm happily squeezed the title to about
 * fifty pixels and set it one word to a line, with the edit button sitting
 * comfortably beside six lines of vertical text. So below 26rem the title asks
 * for enough of the row that the controls cannot share it — they drop
 * underneath, the title gets the line, and the number still sits beside its
 * first word.
 */
/**
 * The cards a step draws, in the order it draws them.
 *
 * An issue first, then the changes the tracker itself attaches to it, then any
 * change the step named that no issue carried in. A change drawn twice is a
 * reader counting the same work twice.
 *
 * Exported because two things have to agree on it exactly: the cards this
 * block draws, and the references a pick of this step puts on the canvas.
 * `Picking` in `app.tsx` picks every step at once and must send the same list
 * each step's own tick would, or the whole-journey press would leave half the
 * steps drawn as partly picked — the union of `step.refs` is not it, because
 * the tracker's carried-in changes are cards and are in no `refs` array.
 */
export function cardsUnder(live: Live | null, refs: readonly string[]): { ref: string; under: boolean }[] {
  const issues = refs.filter((ref) => !isChange(live, ref))
  const loose = refs.filter((ref) => isChange(live, ref))
  const claimed = new Set<string>()
  const drawn: { ref: string; under: boolean }[] = []
  for (const issue of issues) {
    drawn.push({ ref: issue, under: false })
    for (const change of carriedBy(live, issue)) {
      claimed.add(change)
      drawn.push({ ref: change, under: true })
    }
  }
  for (const change of loose) if (!claimed.has(change)) drawn.push({ ref: change, under: false })
  return drawn
}

export function StepBlock({
  step,
  index,
  editing,
  selection,
  framed,
}: {
  step: Step
  index: number
  editing: boolean
  /** What the canvas has picked out, as the host last said. Empty standalone. */
  selection: readonly string[]
  /** Whether there is a canvas to pick on at all. The control is not drawn without one. */
  framed: boolean
}) {
  const { live } = useReading()
  const refs = step.refs ?? []
  const notes = step.notes ?? []
  const settled = isSettled(live, refs)
  const drawn = cardsUnder(live, refs)

  /*
   * What this step puts on the canvas when it is picked: every card under it,
   * once each. The cards and not `step.refs`, because the cards include the
   * changes the tracker attached to the step's issues, which are on screen
   * and in no journey document — see `firstShown` in `refs.ts` for the
   * afternoon that taught this app the difference. A step that draws no card
   * carries nothing, and the control says so rather than sending nothing.
   */
  const carries = [...new Set(drawn.map((card) => card.ref))]
  const picked = pickedState(selection, carries)

  return (
    /*
     * A picked step wears the ring the host puts on a picked container —
     * `ring-2 ring-inset` in the primary colour — so that a person who has
     * ticked a container in a header recognises the idea here without being
     * told. Inset, for the host's reason: a ring outside the box would touch the
     * step above. Partly picked is the same ring at a lower weight, which is
     * the tri-state the checkbox beside it is also showing.
     */
    <section
      data-step={index + 1}
      data-picked={picked === 'none' ? undefined : picked}
      className={cn(
        'border-t pt-3.5 pb-1',
        picked !== 'none' && 'rounded-md border-transparent px-2 ring-inset ring-primary/60',
        picked === 'all' && 'ring-2',
        picked === 'some' && 'ring-1 ring-primary/35',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 @min-[26rem]/container:flex-nowrap">
        {/*
          The tick, which is only HOW the pick is set — the ring is the pick.
          Drawn only when a host is framing this page, because standalone there
          is no canvas for it to reach and a checkbox that ticks nothing is a
          broken checkbox. Disabled, with the reason in its tooltip, on a step
          that carries no reference: it cannot be expressed on the wire, and the
          honest control is one that says so rather than one that appears to
          work. `indeterminate` is a property and not an attribute, hence the
          ref.
        */}
        {framed && (
          <input
            type="checkbox"
            aria-label={
              carries.length
                ? `Pick step ${index + 1}’s ${carries.length === 1 ? 'reference' : `${carries.length} references`} out on the canvas`
                : `Step ${index + 1} names no reference, so there is nothing of it to pick out on the canvas`
            }
            title={
              carries.length
                ? undefined
                : 'This step names no issue or change, so there is nothing of it a canvas could hold.'
            }
            disabled={!carries.length}
            checked={picked === 'all'}
            ref={(box) => {
              if (box) box.indeterminate = picked === 'some'
            }}
            onChange={() => pick(carries)}
            className="size-3.5 shrink-0 translate-y-px accent-primary disabled:opacity-40"
          />
        )}
        <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <h3 className="min-w-0 flex-[1_1_60%] text-[1.02rem] leading-snug font-semibold @min-[26rem]/container:flex-1">
          <Prose text={step.title} />
        </h3>
        {settled && (
          <Badge variant="merged" title="Every reference this step names has merged or closed.">
            done
          </Badge>
        )}
        {/* Editing is this app's, not the host's: the steps are here. It is
            offered whenever the plan is stored, framed or not. */}
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="text-muted-foreground"
          aria-expanded={editing}
          onClick={() => setEditing(index)}
        >
          {editing ? 'close' : 'edit'}
        </Button>
      </div>

      {editing ? (
        <Editor step={step} position={index + 1} />
      ) : (
        step.body && (
          <p className="mt-1.5 text-[0.95rem] leading-7 @min-[26rem]/container:ml-[2.1rem]">
            <Prose text={step.body} />
          </p>
        )
      )}

      {notes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 @min-[26rem]/container:ml-[2.1rem]">
          {notes.map((note) => (
            <Badge key={note} variant="outline">
              {note}
            </Badge>
          ))}
        </div>
      )}

      {drawn.length > 0 && (
        <div className="mt-2.5 grid gap-1.5 @min-[26rem]/container:ml-[2.1rem]">
          {drawn.map(({ ref, under }) => (
            <Card key={`${ref}:${under ? 'under' : 'own'}`} refName={ref} under={under} />
          ))}
        </div>
      )}
    </section>
  )
}
