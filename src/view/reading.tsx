import { createContext, useContext } from 'react'

import type { JourneyView, Live } from '../kinds.ts'

/**
 * What everything below the heading needs to know, handed down rather than
 * threaded through.
 *
 * Two things and only two: the host's last reading, and the journey being read.
 * They are here rather than in props because the deepest consumer of both is
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
}

const ReadingContext = createContext<Reading>({ live: null, journey: null })

export const ReadingProvider = ReadingContext.Provider

export function useReading(): Reading {
  return useContext(ReadingContext)
}
