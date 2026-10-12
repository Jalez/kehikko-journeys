import { createContext, useContext } from 'react'

import type { Disposition } from 'kehikot-module-protocol'
import type { Facet } from 'kehikot-module-protocol/facets'

import type { JourneyView, Live } from '../kinds.ts'
import type { Around } from '../live/lookup.ts'

/**
 * What everything below the heading needs to know, handed down rather than
 * threaded through.
 *
 * The host's last reading and the journey being read, first; then what the
 * host said around the reading — whether it frames us, why it withheld one,
 * people's marks on why things closed, which facets the filter hides — and
 * which issues somebody has unfolded. They are here rather than in props because the deepest consumer of both is
 * `Ref` — one anchor, several levels down inside a sentence inside a step —
 * and a `live` passed hand to hand through `Prose` would make every component
 * between here and there take an argument it does nothing with.
 *
 * It is deliberately not a store. Nothing writes through this context; it is
 * the read side of `journeys.ts` and the app re-renders when that changes. A
 * component that wants to CHANGE something calls the function in `journeys.ts`
 * directly, so there is one place that decides and one place that draws.
 */
export interface Reading {
  live: Live | null
  journey: JourneyView | null
  /** Whether a host is framing this page. Absent is standalone. */
  framed?: boolean
  /** The host's own words for why it handed over no reading. */
  withheld?: string | null
  /** `context.dispositions`, whole. */
  marks?: readonly Disposition[]
  /** The facets the filter hides, from `context.filters`. */
  hidden?: readonly Facet[]
  /** Issues whose changes somebody has unfolded. Folded is the default. */
  unfolded?: readonly string[]
}

const ReadingContext = createContext<Reading>({ live: null, journey: null })

export const ReadingProvider = ReadingContext.Provider

export function useReading(): Reading {
  return useContext(ReadingContext)
}

/** What `lookup.ts` needs from a reading beyond `live`, put together once. */
export function aroundOf(reading: Reading): Around {
  return {
    framed: reading.framed ?? false,
    withheld: reading.withheld ?? null,
    marks: reading.marks ?? [],
    settledBy: reading.journey?.settledBy ?? {},
  }
}
