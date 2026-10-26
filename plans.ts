import { PLAN_FILE, moduleFile, planOfJourney, plansIn } from 'kehikot-module-protocol'
import { writePlan } from 'kehikot-module-protocol/serve'
import { existsSync, readFileSync } from 'node:fs'

import { ID } from './manifest.ts'

/**
 * Publishing a journey's steps as the protocol's PLAN (2.21.0).
 *
 * A host no longer reads `journeys.json` for an epic's steps once this module
 * has a `steps.json` beside it: it takes the union of every module's
 * `steps.json` (`readPlans`) and answers `steps.list` from that, so Flows,
 * Factory and the rest read whichever module keeps steps, not this one's file.
 * `journeys.json` stays this module's own store; `steps.json` is what it
 * publishes from it, after every write, the way `parts.json` is.
 *
 * The record becomes a plan through the protocol's `planOfJourney`, which is
 * also what a host reads this file with while there is no `steps.json`. One
 * function on both sides, and it is handed the record AS IT IS ON DISK — the
 * one just written, or, for the backfill, the file's own entry, not this
 * module's reading of an older shape — so the steps another module sees are
 * the same steps the day this file appears as the day before.
 *
 * ## All of them, once there is one
 *
 * The moment `steps.json` exists the host stops reading `journeys.json` for
 * EVERY epic, not just the one written. So a write publishes the journey it
 * wrote and then every other journey the file has no entry for yet
 * (`backfill`), and the first read of a project after this module starts does
 * the same. A journey whose steps are kept elsewhere (`stepsFrom`) has no plan
 * and is not published: an empty one would say it has none.
 */

/** The epics this module's `steps.json` already says something about, or an empty set. Never throws. */
export function publishedEpics(projectPath: string | null | undefined): Set<string> {
  try {
    const file = moduleFile(projectPath, ID, PLAN_FILE)
    if (file === null || !existsSync(file)) return new Set()
    return new Set(Object.keys(plansIn(JSON.parse(readFileSync(file, 'utf8')))))
  } catch {
    return new Set()
  }
}

/**
 * Publish one journey's plan. Null when it was published (or there was nothing
 * to publish), else the sentence for the caller to say. A journey whose steps
 * are elsewhere takes its epic out of the file, so a plan from before it was
 * projected is not left saying something it no longer does.
 */
export function publishPlan(projectPath: string | null | undefined, slug: string, record: unknown): string | null {
  try {
    writePlan(projectPath, ID, slug, planOfJourney(record))
    return null
  } catch (error) {
    return `Its steps could not be published for other modules (${error instanceof Error ? error.message : String(error)}).`
  }
}

/**
 * Publish every journey `steps.json` has no entry for yet. What a write and
 * the first read of a project do, so the file, once it exists, speaks for
 * every journey. Returns the slugs it published; a failure costs that journey
 * and is tried again next time.
 */
export function backfill(projectPath: string | null | undefined, records: Readonly<Record<string, unknown>>): string[] {
  const had = publishedEpics(projectPath)
  const done: string[] = []
  for (const [slug, record] of Object.entries(records)) {
    if (had.has(slug) || planOfJourney(record) === null) continue
    if (publishPlan(projectPath, slug, record) === null) done.push(slug)
  }
  return done
}

/** The projects this process has backfilled, so a read does it once per project and then only reads. */
const backfilled = new Set<string>()

/** `backfill` on the first read of a project in this process; nothing after that. */
export function backfillOnce(projectPath: string | null | undefined, records: () => Readonly<Record<string, unknown>>): void {
  if (typeof projectPath !== 'string' || !projectPath || backfilled.has(projectPath)) return
  backfilled.add(projectPath)
  backfill(projectPath, records())
}

/** For the tests: forget which projects were backfilled. */
export function resetBackfilled(): void {
  backfilled.clear()
}
