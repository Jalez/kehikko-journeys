import { join } from 'node:path'

import { readRegistration, registryDir } from 'kehikot-module-protocol/serve'

/**
 * Where the Factory module has a step's issue: its finer stage than the board's column.
 *
 * The Factory module (`kehikot.factory`) runs a job per change, and answers
 * `GET /api/jobs?ref=<issue>` on its registered origin with the jobs for that issue —
 * `{ id, title, ref, stage, column, place, updatedAt }` each. There is no host method that relays
 * it, so this server reads the Factory's registration (the machine's module registry, the one place
 * a module's origin is written) and asks it directly. The page asks this server, at `/api/factory`,
 * because the Factory's origin is another origin than the page's.
 *
 * Nothing here is kept: each answer is read when asked. No Factory registered, not running, or an
 * answer in a shape this does not read — all are "no job", and the page shows nothing for it.
 */

export const FACTORY_ID = 'kehikot.factory'

/** One job, as much of it as a step shows. */
export interface FactoryJob {
  id: string
  ref: string
  stage: string
  title?: string
  column?: string
  updatedAt?: string
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/

/** The Factory's origin, from its registration, or null. Only a loopback origin is ever asked. */
export function factoryOrigin(where = registryDir()): string | null {
  const reg = readRegistration(join(where, `${FACTORY_ID}.json`))
  if (!reg) return null
  const origin = reg.url.replace(/\/+$/, '')
  return LOOPBACK.test(origin) ? origin : null
}

const text = (value: unknown, max = 200): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

/** The jobs in one answer: a list, `{ jobs }`, or one job. What does not read as a job is left out. */
export function jobsIn(body: unknown, ref: string): FactoryJob[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { jobs?: unknown }).jobs)
      ? (body as { jobs: unknown[] }).jobs
      : body && typeof body === 'object'
        ? [body]
        : []
  const out: FactoryJob[] = []
  for (const one of list.slice(0, 20)) {
    if (!one || typeof one !== 'object') continue
    const job = one as Record<string, unknown>
    const id = text(job.id, 80)
    const stage = text(job.stage, 80)
    const said = text(job.ref, 200)
    if (!id || !stage || (said && said !== ref)) continue
    const column = typeof job.column === 'string' ? text(job.column, 80) : text((job.column as { name?: unknown } | undefined)?.name, 80)
    out.push({ id, ref, stage, title: text(job.title), column, updatedAt: text(job.updatedAt, 40) })
  }
  return out
}

/** The newest job for an issue, or null. */
export function newest(jobs: readonly FactoryJob[]): FactoryJob | null {
  return [...jobs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
}

export interface FactoryAsk {
  origin: () => string | null
  fetch: (url: string) => Promise<unknown>
}

/** How this server asks; a test stands another in. */
export const FACTORY: FactoryAsk = {
  origin: () => factoryOrigin(),
  async fetch(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    if (!res.ok) return null
    return res.json()
  },
}

/** For each ref, the Factory's newest job for it; refs with none are left out. `factory: false` when there is no Factory. */
export async function factoryStages(
  project: string,
  refs: readonly string[],
  ask: FactoryAsk = FACTORY,
): Promise<{ factory: boolean; jobs: Record<string, FactoryJob> }> {
  const origin = ask.origin()
  if (!origin) return { factory: false, jobs: {} }
  const jobs: Record<string, FactoryJob> = {}
  await Promise.all(
    refs.slice(0, 100).map(async (ref) => {
      try {
        const url = `${origin}/api/jobs?ref=${encodeURIComponent(ref)}&projectPath=${encodeURIComponent(project)}`
        const job = newest(jobsIn(await ask.fetch(url), ref))
        if (job) jobs[ref] = job
      } catch {
        /* Not running, or not answering: no job. */
      }
    }),
  )
  return { factory: true, jobs }
}
