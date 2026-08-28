import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's badge, used here for the one thing this page has to get right: what
 * a reference is doing, and whether anybody has been able to look.
 *
 * ## Never hue alone
 *
 * Every badge on this page is a colour, a WORD and — where it is a state — an
 * icon. Any one of the three can be taken away and the badge still says which
 * of the five it is. That is not a courtesy: `merged` and `open` are a purple
 * and a blue that a reader with deuteranopia has no way to separate, and the
 * distinction they carry is "this landed" against "somebody is still writing
 * it". The words are never dropped and the icons are never the only mark.
 *
 * ## `unseen` is dashed, unfilled, and italic, on purpose
 *
 * It is not a sixth state. It is the ABSENCE of a reading — nothing framed this
 * page, or the host's last refresh had nothing about this reference — and the
 * whole argument of this module is that absence must not be drawn as a state.
 * Every other variant is filled and solid; this one is an outline in the muted
 * colour with nothing behind it, so the eye reads "there is nothing here" before
 * the words are read. It must never be made to look open, and it must never be
 * made to look closed.
 *
 * ## Only the verdicts refuse to wrap, and that distinction cost a measurement
 *
 * `whitespace-nowrap` is right for the five verdicts: each is one short word
 * from a closed set, and a badge that wraps "not in the last refresh" over two
 * lines reads as two badges at 220px.
 *
 * It is wrong for everything else, and putting it in the base was a real bug
 * rather than a near miss. A step's note and a tracker's label are written by
 * people: measured across the thirteen journeys this app ships, notes run to
 * 110 characters. In a nowrap badge that is a 700-pixel token that nothing can
 * break, and one of them sets a min-content floor under the entire document —
 * which is exactly how the page ended up 1187 pixels wide inside a 220-pixel
 * pane. So the base wraps, breaks anywhere, and may shrink; the verdicts opt
 * out of all three because they are short enough to be able to afford it.
 */
const badgeVariants = cva(
  'inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-px text-[0.7rem] font-medium leading-4 [overflow-wrap:anywhere] [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        open: 'shrink-0 whitespace-nowrap border-seen/40 bg-seen/12 text-seen',
        merged: 'shrink-0 whitespace-nowrap border-merged/40 bg-merged/12 text-merged',
        closed: 'shrink-0 whitespace-nowrap border-closed/40 bg-closed/12 text-closed',
        draft: 'shrink-0 whitespace-nowrap border-draft/45 bg-draft/12 text-draft',
        /* Dashed and unfilled. See the essay above; this one is load-bearing. */
        unseen:
          'shrink-0 whitespace-nowrap border-dashed border-muted-foreground/60 bg-transparent text-muted-foreground italic',
        /* The tracker's own labels and a step's own notes: neither is a verdict,
           and neither is guaranteed to be short. */
        outline: 'border-border bg-transparent font-normal text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
