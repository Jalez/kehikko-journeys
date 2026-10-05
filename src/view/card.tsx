import { useState } from 'react'
import { DISPOSITIONS, type DispositionValue, type TrackerRow } from 'roadmap-module-protocol'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

import { markDisposition } from '../journeys.ts'
import { isChange, stateOf, verdictOf, type Verdict } from '../live/lookup.ts'
import { isTracked } from '../refs.ts'
import { Ref } from './prose.tsx'
import { Rail } from './rail.tsx'
import { aroundOf, useReading } from './reading.tsx'
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
  const reading = useReading()
  const { live, journey } = reading
  const seen = stateOf(live, refName)
  const gates = journey?.blockedBy?.[refName] ?? []
  const verdict = verdictOf(live, refName, aroundOf(reading))
  /* Why it closed is said wherever it closed, and wherever somebody's word —
     a person's mark, the journey's `settledBy` — says more than the state.
     A merged change is left quiet: "done, from the tracker" on every one of
     them would be a line restating the badge beside it. */
  const telling = seen?.state === 'closed' || verdict.source === 'person' || verdict.source === 'journey'

  return (
    <div
      data-card={refName}
      className={cn(
        'rounded-md border px-2.5 py-2',
        under ? 'ml-2 bg-transparent @min-[26rem]/container:ml-5' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Ref refName={refName} />
        {/*
          Twelve rems is what the title WANTS, not what it demands. It was a
          `min-width` once, which in a flex row is a floor the container cannot argue
          with: at 220px the row simply stuck out, and every card in the
          document did it at once. As a basis with the floor released it still
          claims twelve rems wherever there are twelve rems to claim, and wraps
          down to whatever the container has where there are not.

          The whole title again as a tooltip. Nothing on this page truncates and
          this is not a fallback for clipping — it is for the 220px container, where
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

      {/* The tracker's own labels. A scoped label dims its scope, because the
          half after the colons is what distinguishes one row from the next.
          Uncoloured: the shared reading carries a label's name and not its
          colour, and a colour this app made up would be a claim about a
          tracker it never read. */}
      {(seen?.labels ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(seen?.labels ?? []).map((name) => {
            const at = name.lastIndexOf('::')
            return (
              <Badge key={name} variant="outline">
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
        one it took the whole document 1187 pixels wide inside a 220-pixel container.
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

      {telling && <Why refName={refName} verdict={verdict} canMark={Boolean(reading.framed)} />}

      <Rail refName={refName} />
    </div>
  )
}

const WORDS: Record<DispositionValue, string> = {
  done: 'done',
  'wont-do': 'won’t do',
  duplicate: 'duplicate of…',
  superseded: 'superseded by…',
}

/** What a verdict says, in the words a card has room for. */
export function verdictWords(verdict: Verdict): { what: string; whose: string } {
  const target = verdict.mark?.target
  const what =
    verdict.value === 'unknown' || !verdict.value
      ? 'closed, reason unknown'
      : verdict.value === 'duplicate' || verdict.value === 'superseded'
        ? target
          ? `${verdict.value === 'duplicate' ? 'duplicate of' : 'superseded by'} ${target}`
          : verdict.value
        : WORDS[verdict.value]
  const whose =
    verdict.source === 'person'
      ? `marked by ${verdict.mark?.by || 'a person'}`
      : verdict.source === 'journey'
        ? 'a decision this journey records as answered'
        : verdict.source === 'tracker'
          ? 'from the tracker'
          : 'nobody has said why — a person should decide'
  return { what, whose }
}

/**
 * Why a reference closed, whose word that is, and — framed — a way to say so.
 *
 * The source is never left out. "Won't do" because a person said so and "won't
 * do" because GitHub reads `NOT_PLANNED` are different claims, and a reader
 * deciding whether to argue with one needs to know which they are looking at.
 *
 * The control sets the mark through the host (`disposition.set`) and draws
 * nothing of its own: the card changes when the next context carries the mark
 * back. Drawn only while a host is framing the page, because standalone there
 * is nowhere for a mark to be kept, and only on a closed reference, because
 * why something closed is not a question about something open.
 */
function Why({ refName, verdict, canMark }: { refName: string; verdict: Verdict; canMark: boolean }) {
  const { live } = useReading()
  const [marking, setMarking] = useState(false)
  const [value, setValue] = useState<DispositionValue>(
    verdict.value && verdict.value !== 'unknown' ? verdict.value : 'done',
  )
  const [target, setTarget] = useState(verdict.mark?.target ?? '')
  const { what, whose } = verdictWords(verdict)
  const closed = stateOf(live, refName)?.state === 'closed'
  const needsTarget = value === 'duplicate' || value === 'superseded'

  return (
    <div className="mt-1.5 text-xs leading-5 text-muted-foreground" data-disposition={verdict.value ?? 'none'}>
      <span className={cn(verdict.value === 'unknown' && 'italic')}>
        <span className="text-foreground">{what}</span> · {whose}
        {verdict.mark?.note ? ` — ${verdict.mark.note}` : ''}
      </span>
      {canMark && closed && !marking && (
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="ml-1 h-5 px-1.5 text-muted-foreground"
          onClick={() => setMarking(true)}
        >
          {verdict.source === 'person' ? 'change' : 'mark why'}
        </Button>
      )}
      {canMark && closed && marking && (
        <form
          className="mt-1 flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            setMarking(false)
            void markDisposition(refName, value, needsTarget ? target : undefined)
          }}
        >
          <select
            aria-label={`Why ${refName} closed`}
            value={value}
            onChange={(event) => setValue(event.target.value as DispositionValue)}
            className="h-6 rounded border bg-background px-1 text-xs"
          >
            {DISPOSITIONS.map((option) => (
              <option key={option} value={option}>
                {WORDS[option]}
              </option>
            ))}
          </select>
          {needsTarget && (
            <input
              aria-label={value === 'duplicate' ? 'Duplicate of which reference' : 'Superseded by which reference'}
              placeholder="gh#123"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-6 w-24 rounded border bg-background px-1 text-xs"
            />
          )}
          <Button type="submit" variant="outline" size="container">
            keep
          </Button>
          {verdict.source === 'person' && (
            <Button
              type="button"
              variant="ghost"
              size="container"
              onClick={() => {
                setMarking(false)
                void markDisposition(refName, null)
              }}
            >
              clear the mark
            </Button>
          )}
          <Button type="button" variant="ghost" size="container" onClick={() => setMarking(false)}>
            cancel
          </Button>
        </form>
      )}
    </div>
  )
}

/** Where a change's review stands, in the tracker's terms and the card's words. */
const REVIEW: Record<NonNullable<TrackerRow['review']>, string> = {
  approved: 'approved',
  'changes-requested': 'changes requested',
  required: 'review still needed',
}

function Who({ refName }: { refName: string }) {
  const { live } = useReading()
  const seen = stateOf(live, refName)
  if (!seen) return null

  if (isChange(live, refName)) {
    const author = seen.author ?? ''
    const review = seen.review ? REVIEW[seen.review] : ''
    if (!author && !review) return null
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {author || 'unknown'} is making it
        {review ? ` · ${review}` : ''}
      </p>
    )
  }

  const assignees = seen.assignees ?? []
  if (assignees.length) return <p className="mt-1 text-xs text-muted-foreground">{assignees.join(', ')}</p>
  if (seen.state === 'open') {
    return (
      <p className="mt-1 text-xs text-muted-foreground italic" title="Nobody is assigned in the tracker.">
        unassigned
      </p>
    )
  }
  return null
}
