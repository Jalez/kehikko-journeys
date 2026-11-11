import { WORK_STATUS, workJobsIn, type WorkJob } from 'kehikot-module-protocol'
import { fetchService, findService } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * What stage the work on a step's issue is at: finer than the board's column.
 *
 * Whichever module provides `work.status` (protocol 2.83.0) runs work per issue and answers, at the
 * route its descriptor names (`jobs`), `GET <jobs>?ref=<issue>&projectPath=<abs>` with the jobs for
 * that issue. This server finds it through the host (`services.find`, under `services:read`) and asks
 * it through the protocol (`fetchService`), by the module id the host answered — never one spelled
 * here. The page asks this server, at `/api/work`, because the provider is on another origin, and is
 * handed the provider's name with the jobs, so what it says names whatever runs the work.
 *
 * Nothing here is kept: each answer is read when asked. Nothing providing it, not running, or an
 * answer in a shape this does not read — all are "no work", and the page shows nothing for it. What a
 * person reads names the provider by its descriptor's `name`.
 */

/** One job, as much of it as a step shows. */
export type Job = Pick<WorkJob, 'id' | 'stage' | 'title' | 'column' | 'updatedAt'> & { ref: string }

/** The provider found: its id (as the host answered), what it is called, and its jobs route. */
export interface WorkProvider {
  module: string
  name: string
  jobs: string
}

/** The jobs in one answer that are about this issue. */
export function jobsIn(body: unknown, ref: string): Job[] {
  return workJobsIn(body)
    .filter((job) => job.ref === null || job.ref === ref)
    .slice(0, 20)
    .map((job) => ({
      id: job.id,
      ref,
      stage: job.stage,
      ...(job.title ? { title: job.title } : {}),
      ...(job.column ? { column: job.column } : {}),
      ...(job.updatedAt ? { updatedAt: job.updatedAt } : {}),
    }))
}

/** The newest job for an issue, or null. */
export function newest(jobs: readonly Job[]): Job | null {
  return [...jobs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
}

export interface WorkAsk {
  find: (project: string) => Promise<WorkProvider | null>
  fetch: (module: string, path: string) => Promise<unknown>
}

/** How this server asks; a test stands another in. */
export const WORK: WorkAsk = {
  async find(project) {
    const found = await findService(WORK_STATUS, { module: ID, project })
    return found.ok ? { module: found.provider.module, name: found.provider.descriptor.name, jobs: found.provider.descriptor.jobs } : null
  },
  async fetch(module, path) {
    const got = await fetchService(module, path, { headers: { accept: 'application/json' } }, { from: ID, callTimeoutMs: 2_000 })
    if (!got.ok || !got.response.ok) return null
    return got.response.json()
  },
}

/**
 * For each ref, the newest job for it; refs with none are left out. `work` is what the provider is
 * called, null when nothing provides `work.status` (then there are no jobs).
 */
export async function workStages(
  project: string,
  refs: readonly string[],
  ask: WorkAsk = WORK,
): Promise<{ work: string | null; jobs: Record<string, Job> }> {
  let provider: WorkProvider | null = null
  try {
    provider = await ask.find(project)
  } catch {
    provider = null
  }
  if (!provider) return { work: null, jobs: {} }
  const { module, jobs: route } = provider
  const jobs: Record<string, Job> = {}
  await Promise.all(
    refs.slice(0, 100).map(async (ref) => {
      try {
        const job = newest(jobsIn(await ask.fetch(module, `${route}?ref=${encodeURIComponent(ref)}&projectPath=${encodeURIComponent(project)}`), ref))
        if (job) jobs[ref] = job
      } catch {
        /* Not running, or not answering: no job. */
      }
    }),
  )
  return { work: provider.name, jobs }
}
