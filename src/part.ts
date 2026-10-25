import { PART_ID } from 'kehikot-module-protocol'

/**
 * The part a step says it is in, or null: anything that is not a part id is no
 * assignment. This module's own reading of its own record. It used to be the
 * protocol's `stepPart`, which went with the rest of `journey.ts` when the
 * protocol stopped describing this module's file (2.21.0); the rule is the
 * same, so a step is in the same part as before.
 */
export function stepPart(step: unknown): string | null {
  if (!step || typeof step !== 'object') return null
  const part = (step as { part?: unknown }).part
  return typeof part === 'string' && PART_ID.test(part) ? part : null
}
