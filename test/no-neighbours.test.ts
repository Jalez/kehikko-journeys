import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { answer } from '../doors.ts'
import { MANIFEST } from '../manifest.ts'
import { ASK } from '../project.ts'
import { WORK } from '../work.ts'

/**
 * Modules never name each other: cooperation goes through protocol services only. This scans the
 * module's own code — not its dependencies, build, tests, notes, docs, seed text or skills — for
 * another module's id, its data folder, a route of its spelled here, or its name, and fails on a hit.
 */

const ROOT = join(import.meta.dir, '..')
const SKIP = new Set(['node_modules', 'dist', 'test', 'notes', 'docs', 'seed', 'plugin', '.git', '.github'])
const CODE = /\.(ts|tsx|js|json|html|css)$/
const LEFT_OUT = new Set(['bun.lock', 'package.json', 'CHANGELOG.md'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name) || LEFT_OUT.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return CODE.test(name) ? [path] : []
  })
}

const OTHERS = ['paper', 'review', 'checklist', 'factory', 'flows', 'slides', 'screenplay', 'source', 'diff', 'notes', 'history', 'queue', 'browser', 'explorer', 'learning', 'notifications', 'claude', 'codex', 'references', 'kanban', 'citations', 'orchestrator', 'terminal', 'atlas', 'monitor', 'worktrees', 'antigravity', 'opencode', 'vibe', 'calls']
const NEIGHBOURS: [string, RegExp][] = [
  ['another module’s id', new RegExp(`\\b(?:kehikot|roadmap)\\.(?:${OTHERS.join('|')})\\b`)],
  ['another module’s data folder', new RegExp(`\\.kehikot/(?:${OTHERS.join('|')})\\b`)],
  ['another module’s MCP tools', new RegExp(`mcp__(?:${OTHERS.join('|')})__`)],
  ['a provider’s route spelled here', /['"`]\/api\/jobs\b/],
  /* Names that are only ever a module's. "References", "Notes" and "Source" are also plain words here. */
  ['another module by name', /\b(?:Factory|Flows|Screenplay|Browser|Checklist|Learning|Atlas|Kanban|Citations|Orchestrator|Notifications|Paper|Reviews?|Diff|Explorer|Slides)\b/],
]

describe('no neighbours named', () => {
  test('the code names no other module, its folder or its routes', () => {
    const hits: string[] = []
    for (const path of files(ROOT)) {
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        for (const [what, pattern] of NEIGHBOURS) if (pattern.test(line)) hits.push(`${relative(ROOT, path)}:${i + 1} ${what}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })

  test('the docs and the seed journeys name no other module either', () => {
    const hits: string[] = []
    for (const dir of ['docs', 'seed']) {
      for (const name of readdirSync(join(ROOT, dir))) {
        readFileSync(join(ROOT, dir, name), 'utf8').split('\n').forEach((line, i) => {
          for (const [what, pattern] of NEIGHBOURS) if (pattern.test(line)) hits.push(`${dir}/${name}:${i + 1} ${what}: ${line.trim().slice(0, 120)}`)
        })
      }
    }
    expect(hits).toEqual([])
  })

  test('the module may ask the host who provides a service', () => {
    expect(MANIFEST.declares.uses).toContain('services:read')
  })
})

describe('/api/work', () => {
  const real = { ...WORK }
  const was = ASK.options
  /* A host that holds every folder as a project, standing in for the door's project check. */
  beforeEach(() => {
    ASK.options = { env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:1' }, fetch: (async () => new Response(JSON.stringify({ ok: true, project: true }))) as never }
  })
  afterEach(() => {
    Object.assign(WORK, real)
    ASK.options = was
  })
  const asked = async () => (await answer('GET', '/api/work', new URLSearchParams({ project: '/p', refs: 'gh#2' }), null, null))?.body

  test('nothing providing work.status: no name, no jobs', async () => {
    expect(await asked()).toEqual({ ok: true, work: null, jobs: {} })
  })

  test('a provider: its name is handed to the page with the jobs', async () => {
    WORK.find = async () => ({ module: 'kehikot.anything', name: 'Runner', jobs: '/api/runs' })
    WORK.fetch = async () => ({ jobs: [{ id: 'j', ref: 'gh#2', stage: 'judging' }] })
    expect(await asked()).toEqual({ ok: true, work: 'Runner', jobs: { 'gh#2': { id: 'j', ref: 'gh#2', stage: 'judging' } } })
  })
})
