import { Fragment } from 'react'
import { sift } from 'kehikot-module-protocol/facets'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'

import { cn } from '@/lib/utils.ts'

import { cardsUnder, facetsOfRef, stateOf, standing, toneOf, type Standing, type Tone } from '../live/lookup.ts'
import { pick, setEditing, setFolds, toggleFold } from '../journeys.ts'
import type { Live, Step } from '../kinds.ts'
import { pickedState } from '../refs.ts'
import { Card } from './card.tsx'
import { Editor } from './editor.tsx'
import { Prose } from './prose.tsx'
import { aroundOf, useReading } from './reading.tsx'

/**
 * A card and the changes the tracker hangs under it, as one fold.
 *
 * Built from what `cardsUnder` draws and what the filter kept. A change kept
 * under an issue the filter hid is not orphaned under the wrong parent: it
 * becomes a bundle of its own, drawn as a loose change, because the issue it
 * would have been indented under is not on the page.
 */
export interface Bundle {
  ref: string
  under: string[]
}

export function bundlesOf(
  drawn: readonly { ref: string; under: boolean }[],
  kept: readonly { ref: string; under: boolean }[] = drawn,
): Bundle[] {
  const keep = new Set(kept)
  const out: Bundle[] = []
  let owner: Bundle | null = null
  for (const card of drawn) {
    if (!card.under) {
      owner = keep.has(card) ? { ref: card.ref, under: [] } : null
      if (owner) out.push(owner)
    } else if (keep.has(card)) {
      if (owner) owner.under.push(card.ref)
      else out.push({ ref: card.ref, under: [] })
    }
  }
  return out
}

const TALLY: { tone: Tone; word: string }[] = [
  { tone: 'open', word: 'open' },
  { tone: 'draft', word: 'draft' },
  { tone: 'merged', word: 'merged' },
  { tone: 'closed', word: 'closed' },
  { tone: 'unseen', word: 'not seen' },
]

/**
 * One line standing for the changes under a folded issue: "3 changes · 2
 * merged · 1 closed". Every change the filter kept is counted, folded or not —
 * a fold hides the cards and never the fact of them.
 */
export function foldSummary(live: Live | null, changes: readonly string[]): string {
  const tones = changes.map((ref) => toneOf(stateOf(live, ref)))
  const parts = [`${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`]
  for (const { tone, word } of TALLY) {
    const n = tones.filter((t) => t === tone).length
    if (n) parts.push(`${n} ${word}`)
  }
  return parts.join(' · ')
}

const ASIDE: Record<Standing['aside'][number]['value'], string> = {
  'wont-do': 'won’t do',
  duplicate: 'duplicate',
  superseded: 'superseded',
}

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
  const reading = useReading()
  const { live } = reading
  const around = aroundOf(reading)
  const refs = step.refs ?? []
  const notes = step.notes ?? []
  const where = standing(live, refs, around)
  const drawn = cardsUnder(live, refs)

  /*
   * What is drawn: the cards the filter kept, each issue folded over the
   * changes under it unless somebody opened it. The filter is applied to the
   * cards and never to `where` above — a step is done or not by all of its
   * work, whatever a reader has chosen to look at — and never to `carries`
   * below, so that a pick means the same thing with the filter on or off.
   */
  const unfolded = reading.unfolded ?? []
  const sifted = sift(drawn, reading.hidden ?? [], (card) => facetsOfRef(live, card.ref, around))
  const bundles = bundlesOf(drawn, sifted.kept)
  const foldable = bundles.filter((bundle) => bundle.under.length).map((bundle) => bundle.ref)
  const allOpen = foldable.length > 0 && foldable.every((ref) => unfolded.includes(ref))

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
        {where.settled && (
          <Badge
            variant="merged"
            title="Every reference this step names is done — by the tracker’s word, a person’s mark, or this journey’s record of a decision answered. Work set aside is not counted."
          >
            done
          </Badge>
        )}
        {where.undecided.length > 0 && (
          <Badge
            variant="unseen"
            title={`Closed, and nobody has said why: ${where.undecided.join(', ')}. Whether it was done is for a person to decide — mark it on its card.`}
          >
            {where.undecided.length} to decide
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

      {/* Set-aside work is said in words, because it changes what "done" above
          means: these closed without being delivered, and they neither settle
          the step nor hold it up. */}
      {where.aside.length > 0 && (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground @min-[26rem]/container:ml-[2.1rem]">
          Set aside, neither settling nor holding up this step:{' '}
          {where.aside.map(({ ref, value }, i) => (
            <span key={ref}>
              {i > 0 && ' · '}
              {ref} {ASIDE[value]}
            </span>
          ))}
        </p>
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

      {bundles.length > 0 && (
        <div className="mt-2.5 grid gap-1.5 @min-[26rem]/container:ml-[2.1rem]">
          {foldable.length > 0 && (
            <div className="-mb-0.5 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="container"
                className="text-muted-foreground"
                aria-expanded={allOpen}
                onClick={() => setFolds(foldable, !allOpen)}
              >
                {allOpen ? 'fold all' : 'expand all'}
              </Button>
            </div>
          )}
          {bundles.map((bundle, i) => {
            const open = unfolded.includes(bundle.ref)
            return (
              <Fragment key={`${bundle.ref}:${i}`}>
                <Card refName={bundle.ref} />
                {/*
                  The fold. Folded by default, because a busy step's changes
                  pushed its issues apart until the step could not be read at
                  a glance; the summary stands in for them and counts every one
                  the filter kept, so nothing is hidden without being counted.
                */}
                {bundle.under.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={open}
                    data-fold={bundle.ref}
                    onClick={() => toggleFold(bundle.ref)}
                    className="ml-2 -mt-0.5 text-left text-xs text-muted-foreground hover:text-foreground @min-[26rem]/container:ml-5"
                  >
                    <span aria-hidden="true">{open ? '▾ ' : '▸ '}</span>
                    {foldSummary(live, bundle.under)}
                  </button>
                )}
                {open && bundle.under.map((ref) => <Card key={`${ref}:under`} refName={ref} under />)}
              </Fragment>
            )
          })}
        </div>
      )}

      {/* What the filter took off this step, counted, so a step whose every
          card is filtered out says so rather than looking as if it named
          nothing. */}
      {sifted.hidden > 0 && (
        <p className="mt-2 text-xs text-muted-foreground italic @min-[26rem]/container:ml-[2.1rem]">
          {sifted.hidden} hidden by the filter
        </p>
      )}
    </section>
  )
}
