import {
  readTrackerRef,
  trackerReadingResult,
  trackerRowSchema,
  type TrackerMissing,
  type TrackerReading,
  type TrackerRow,
} from 'kehikot-module-protocol'

import type { Live } from '../src/kinds.ts'
import { readingOf } from '../src/live/lookup.ts'

/**
 * Tracker readings for tests, in the protocol's own shape.
 *
 * Every row goes through `trackerRowSchema` and every answer through
 * `trackerReadingResult`, which is what a host's answer is checked against on
 * arrival — so a fixture here that a real host could not send fails here,
 * rather than passing a test about a reading that cannot exist.
 */

export const AT = '2026-10-05T10:00:00.000Z'

type Fields = Partial<Omit<TrackerRow, 'ref'>> & Pick<TrackerRow, 'state'>

/** One row, with the boring fields filled in from the spelling. */
export function row(ref: string, fields: Fields): TrackerRow {
  const name = readTrackerRef(ref)
  return trackerRowSchema.parse({
    ref,
    tracker: name?.tracker ?? 'github',
    host: name?.tracker === 'gitlab' ? 'gitlab.com' : 'github.com',
    repo: name?.repo ?? 'org/repo',
    number: name?.number ?? 1,
    kind: name?.kind ?? 'issue',
    title: '',
    url: '',
    readAt: AT,
    ...fields,
  })
}

/** The `closed-by` links an issue carries: the changes that say they close it. */
export function closedBy(...refs: string[]): TrackerRow['links'] {
  return refs.map((ref) => ({ ref, relation: 'closed-by' as const }))
}

/** What `tracker.get` answers, as it would arrive. */
export function answerOf(
  rows: readonly TrackerRow[],
  missing: readonly TrackerMissing[] = [],
  more: Partial<TrackerReading> = {},
): TrackerReading {
  return trackerReadingResult.parse({ at: AT, refreshing: false, sources: [], rows, missing, ...more })
}

/** What the page holds once that answer has arrived. */
export function reading(rows: readonly TrackerRow[], missing: readonly TrackerMissing[] = []): Live {
  return readingOf([answerOf(rows, missing)])
}
