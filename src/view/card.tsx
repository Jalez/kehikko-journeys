import { Badge } from '@/components/ui/badge.tsx'
import { cn } from '@/lib/utils.ts'

import { isChange, stateOf } from '../live/lookup.ts'
import { isTracked } from '../refs.ts'
import { Ref } from './prose.tsx'
import { Rail } from './rail.tsx'
import { useReading } from './reading.tsx'
import { StateBadge } from './state-badge.tsx'

/**
 * One tracked thing, as its own card.
 *
 * ## Why this is a plain box and not shadcn's `Card`
 *
 * shadcn's `Card` is a header, a title, a description, a content region and a
 * footer, with padding sized for one of six on a dashboard. There are
 * twenty-one of these on a real epic, stacked in a column 220 pixels wide,
 * underneath a paragraph somebody wrote — and the paragraph is the point of the
 * page. A component whose smallest form is a 24-pixel-padded panel turns an
 * argument into a dashboard, which is the one thing this port was not allowed
 * to do. So the box is a `div` with a border and the shadcn tokens, and the
 * shadcn components are used where there are genuinely controls and verdicts:
 * the badges, the buttons, the fields.
 *
 * ## `data-card`, and why the whole box carries it
 *
 * A walk prefers the card over a bare mention of the same reference in a
 * sentence, and it finds the card by asking the anchor for its nearest
 * `[data-card]` ancestor. That attribute is therefore part of the contract with
 * `goTo`, not a styling hook: dropping it would leave every walk landing on
 * whichever paragraph happened to say the ref first. See the essay on `goTo` in
 * `journeys.ts`.
 *
 * ## The nested one is indented, not boxed again
 *
 * A change the tracker attaches to an issue is drawn under it, and it is drawn
 * WITHOUT a fill so that the two do not read as siblings. At the narrow end the
 * indent shrinks rather than disappearing: it is the only thing saying which
 * issue the change belongs to, and there is no room for a line and a label.
 */
export function Card({ refName, under }: { refName: string; under?: boolean }) {
  const { live, journey } = useReading()
  const seen = stateOf(live, refName)
  const gates = journey?.blockedBy?.[refName] ?? []

  return (
    <div
      data-card={refName}
      className={cn(
        'rounded-md border px-2.5 py-2',
        under ? 'ml-2 bg-transparent @min-[26rem]/pane:ml-5' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Ref refName={refName} />
        {/*
          Twelve rems is what the title WANTS, not what it demands. It was a
          `min-width` once, which in a flex row is a floor the pane cannot argue
          with: at 220px the row simply stuck out, and every card in the
          document did it at once. As a basis with the floor released it still
          claims twelve rems wherever there are twelve rems to claim, and wraps
          down to whatever the pane has where there are not.

          The whole title again as a tooltip. Nothing on this page truncates and
          this is not a fallback for clipping — it is for the 220px pane, where
          a tracker's own sentence wraps across five very short lines and
          reading it as one is genuinely easier.
        */}
        {/* `overflow-wrap: anywhere` and not `break-word`. Only `anywhere`
            lowers the min-content contribution, and lowering it is the entire
            fix — a tracker's title is somebody else's string and one unbroken
            URL in one of them used to widen the whole document. */}
        <span
          className="min-w-0 flex-[1_1_12rem] text-sm [overflow-wrap:anywhere]"
          title={seen?.title || undefined}
        >
          {seen?.title ?? ''}
        </span>
        <StateBadge refName={refName} seen={seen} />
      </div>

      {/* The tracker's own labels, in the tracker's own colours where the
          refresh recorded a palette. A scoped label dims its scope, because the
          half after the colons is what distinguishes one row from the next. */}
      {(seen?.labels ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(seen?.labels ?? []).map((name) => {
            const at = name.lastIndexOf('::')
            const colour = live?.palette?.[name]
            return (
              <Badge
                key={name}
                variant="outline"
                style={colour ? { background: colour.bg, color: colour.fg, borderColor: colour.bg } : undefined}
              >
                {at > 0 ? (
                  <>
                    <span className="opacity-55">{name.slice(0, at + 2)}</span>
                    {name.slice(at + 2)}
                  </>
                ) : (
                  name
                )}
              </Badge>
            )
          })}
        </div>
      )}

      {/* Who the tracker has on it. Nothing is set here, so an issue reading
          'unassigned' is telling you the truth about the tracker rather than
          waiting for somebody to fill this page in. A finished issue with
          nobody on it says nothing, and is left silent. */}
      {seen && <Who refName={refName} />}

      {/*
        What it waits on, as this journey records it — decided material, ours,
        and as checkable as the rest of the card.

        Two kinds, drawn as two different things on purpose. A tracked blocker
        is a reference and becomes a link, which turns "can this start?" into a
        glance. Anything else is a SENTENCE somebody wrote — measured across the
        journeys this app ships, blockers run to 407 characters, and one of them
        is a paragraph about a production data question. Those are prose and are
        drawn as prose: a chip that long is not a chip, and as an unbreakable
        one it took the whole document 1187 pixels wide inside a 220-pixel pane.
      */}
      {gates.length > 0 && (
        <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
          <span className="mr-1.5 uppercase tracking-wide opacity-70">waits on</span>
          {gates.map((gate, i) => (
            <span key={gate} className="[overflow-wrap:anywhere]">
              {i > 0 && <span aria-hidden="true"> · </span>}
              {isTracked(gate) ? <Ref refName={gate} /> : gate}
            </span>
          ))}
        </div>
      )}

      <Rail refName={refName} />
    </div>
  )
}

function Who({ refName }: { refName: string }) {
  const { live } = useReading()
  const seen = stateOf(live, refName)
  if (!seen) return null

  if (isChange(live, refName)) {
    const author = seen.author ?? ''
    const reviewers = seen.reviewers ?? []
    if (!author && !reviewers.length) return null
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {author || 'unknown'} is making it
        {reviewers.length ? ` · ${reviewers.join(', ')} asked to look` : ''}
      </p>
    )
  }

  const assignees = seen.assignees ?? []
  if (assignees.length) return <p className="mt-1 text-xs text-muted-foreground">{assignees.join(', ')}</p>
  if (seen.state === 'opened') {
    return (
      <p className="mt-1 text-xs text-muted-foreground italic" title="Nobody is assigned in the tracker.">
        unassigned
      </p>
    )
  }
  return null
}
