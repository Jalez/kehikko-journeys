import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

import { open } from '../journeys.ts'
import type { Brief, JourneyView } from '../kinds.ts'

/**
 * Which journey to read, when nobody is deciding that for us.
 *
 * Drawn only when this page is standing alone. Framed, the host owns which
 * epic is open and draws a tab strip for it, and a second picker beside that
 * strip would be two controls answering one question — with the pane's own
 * answer losing every time a context arrives.
 *
 * The tooltip is the honest half of the row: how many steps this app holds for
 * that journey, or that it holds none, or that the steps are kept somewhere it
 * cannot read. That last one is the distinction this whole app is built around,
 * and a picker that showed "0 steps" for it would be making the mistake the
 * page below spends a paragraph correcting.
 */
export function Picker({ index, journey }: { index: Brief[]; journey: JourneyView | null }) {
  if (!index.length) return null
  return (
    <nav aria-label="Journeys this app holds" className="mb-4 flex flex-wrap gap-1.5">
      {index.map((row) => {
        const current = journey?.slug === row.slug
        return (
          <Button
            key={row.slug}
            type="button"
            variant="outline"
            size="pane"
            aria-current={current ? 'true' : undefined}
            className={cn(
              'rounded-full',
              current ? 'border-marker text-foreground' : 'text-muted-foreground',
            )}
            title={`${row.slug} — ${
              row.plan === 'elsewhere'
                ? 'its steps are kept somewhere this app cannot read'
                : row.plan === 'none'
                  ? 'no steps written yet'
                  : `${row.steps} steps`
            }`}
            onClick={() => void open(row.slug)}
          >
            {row.tab ?? row.title}
          </Button>
        )
      })}
    </nav>
  )
}
