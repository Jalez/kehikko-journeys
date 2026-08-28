import { CircleDot, CircleSlash, EyeOff, GitMerge, PencilLine } from 'lucide-react'

import { Badge } from '@/components/ui/badge.tsx'

import { toneOf } from '../live/lookup.ts'
import type { Sighting } from '../kinds.ts'
import { isTracked } from '../refs.ts'
import { useReading } from './reading.tsx'

/**
 * What one reference is doing, as one badge.
 *
 * ## The three answers, and why the middle one is the whole app
 *
 * A reference on this page is in exactly one of three situations, and this
 * component's only job is to never confuse them:
 *
 *  1. **Not a tracker reference at all.** A gate somebody wrote into the
 *     journey that no tracker will ever tick off for us. It is drawn as what it
 *     is and nothing is implied about it.
 *  2. **A tracker reference nobody has been able to look at.** Either nothing
 *     is framing this page, or the host's last refresh had nothing about it.
 *     This is the ABSENCE of a reading — not "unknown", which reads as a state,
 *     and not blank, which reads as fine.
 *  3. **A reading.** Then the tracker's own word, and the date it was read on.
 *
 * The second is the line this whole app exists to get right. It must never be
 * drawn as open and it must never be drawn as closed, which is why it is the
 * one variant with no fill and a dashed edge.
 *
 * ## The icon is never the only mark
 *
 * Each badge is an icon, a word and a colour, and any one of the three can be
 * taken away without losing which of the five it is. `open` and `merged` are a
 * blue and a purple that a reader with deuteranopia cannot separate, and the
 * distinction they carry — still being written against already landed — is one
 * of the more consequential on the page. `aria-hidden` on the icon, because the
 * word beside it is what a screen reader should read and hearing it twice is
 * noise.
 */
const MARKS = {
  open: CircleDot,
  merged: GitMerge,
  closed: CircleSlash,
  draft: PencilLine,
  unseen: EyeOff,
} as const

export function StateBadge({ refName, seen }: { refName: string; seen: Sighting | null }) {
  const { live } = useReading()

  if (!isTracked(refName)) {
    return (
      <Badge variant="unseen" title="A gate outside every tracker. Nothing can ever tick it off for us.">
        <EyeOff aria-hidden="true" />
        not a tracker reference
      </Badge>
    )
  }

  if (!seen) {
    return (
      <Badge
        variant="unseen"
        title={
          live
            ? 'This host read the trackers, and this reference was not in what it read.'
            : 'This app holds the journey. What a tracker says about this reference is read by a host, and nothing is ' +
              'framing this page — so there is nothing to show, which is not the same as nothing being there.'
        }
      >
        <EyeOff aria-hidden="true" />
        {live ? 'not in the last refresh' : 'state not visible from here'}
      </Badge>
    )
  }

  const tone = toneOf(seen)
  const Mark = MARKS[tone]
  /* A change that is open and marked a draft says 'draft'. The tracker's own
     word for it is still 'opened', which is true and is the less useful half of
     what it knows. */
  const word = seen.state === 'opened' && seen.draft ? 'draft' : (seen.state ?? '')
  return (
    <Badge variant={tone} title={seen.at ? `as at ${seen.at}` : undefined}>
      <Mark aria-hidden="true" />
      {word}
    </Badge>
  )
}
