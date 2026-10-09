import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, journeyIn as recordIn, moduleFolder, stepPart, stepsOf } from 'kehikot-module-protocol'
import { readJourneys } from 'kehikot-module-protocol/serve'

import { TICKET, answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'
import { createJourney, held, hostEpic, journeyIn } from '../store.ts'

/**
 * Beginning a journey for an epic that has none: this app taking over an
 * epic's steps from a host.
 *
 * A host reads an epic's steps and groups out of this app's record and falls
 * back to its own file only when the project has no record under that slug.
 * So the first record is not something added beside what the host holds — it
 * replaces what the host answers with, at once, for every module. Everything
 * below is one claim seen from several sides: **the first record is what the
 * host held**, and where that cannot be made true nothing is written.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const MINE = moduleFolder(ID)

/** What a host keeps for an epic, parts and all, with something this app has never heard of. */
const hosted = {
  slug: 'the-posting-seam',
  title: 'The posting seam',
  lede: 'One place a comment is posted from.',
  umbrella: 'gh#1',
  written: '2026-10-01',
  steps: [
    { title: 'Post through one function', body: '', refs: ['gh#2', 'gh#3'], notes: [], part: 'the-agent-seam' },
    { title: 'Retire the second path', body: '', refs: ['gh#4'], notes: ['already half done'] },
    { title: 'Say so on the page', body: '', refs: ['gh#5'], notes: [], part: 'what-the-page-shows' },
  ],
  groups: [
    { id: 'the-agent-seam', heading: 'The agent seam', refs: ['gh#6'] },
    { heading: 'What the page shows', refs: ['gh#7'] },
  ],
  exists: ['The tracker reading'],
  open: ['Who retries?'],
  hostOnly: { since: '2026-09-01' },
}

/** A project, with the host's file for each epic given, in the folder a host keeps them in. */
function project(epics: Record<string, unknown> = {}, folder = 'kehikko'): string {
  const root = mkdtempSync(join(tmpdir(), 'journeys-begin-'))
  made.push(root)
  if (Object.keys(epics).length) mkdirSync(join(root, KEHIKOT_DIR, folder, 'epics'), { recursive: true })
  for (const [slug, epic] of Object.entries(epics)) {
    writeFileSync(
      join(root, KEHIKOT_DIR, folder, 'epics', `${slug}.json`),
      typeof epic === 'string' ? epic : `${JSON.stringify(epic, null, 2)}\n`,
    )
  }
  return root
}

const journeysFile = (root: string) => join(root, KEHIKOT_DIR, MINE, 'journeys.json')
const hostFile = (root: string, slug: string) => join(root, KEHIKOT_DIR, 'kehikko', 'epics', `${slug}.json`)

const rpc = (name: string, args: Record<string, unknown>): string => {
  const reply = answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
  return (reply?.body as { result: { content: { text: string }[] } }).result.content[0]!.text
}

describe('from the MCP door, which has a project path and no host to ask', () => {
  test('the record begins as everything the host’s own file holds', () => {
    const root = project({ 'the-posting-seam': hosted })
    const said = rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    expect(said).toContain('3 steps and 2 groups')
    expect(said).toContain(hostFile(root, 'the-posting-seam'))

    const record = (JSON.parse(readFileSync(journeysFile(root), 'utf8')) as { journeys: Record<string, typeof hosted> })
      .journeys['the-posting-seam']!
    /* Every field the host had, with the value it had — the steps and their
       parts, the groups and their ids, and the one nobody here knows. */
    expect(record).toMatchObject(hosted)
    expect(record.steps.map(stepPart)).toEqual(['the-agent-seam', null, 'what-the-page-shows'])
    expect(record.groups[0]?.id).toBe('the-agent-seam')
    expect(record.hostOnly).toEqual({ since: '2026-09-01' })
  })

  test('so a host reading the record finds exactly the steps it had been answering with', () => {
    const root = project({ 'the-posting-seam': hosted })
    rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    const record = recordIn(readJourneys(root), 'the-posting-seam')!
    const said = stepsOf(record)
    expect(said.kind).toBe('stored')
    expect(said.kind === 'stored' && said.steps).toEqual(hosted.steps as never)
    expect(record.groups).toEqual(hosted.groups)
  })

  test('the host’s file is read and not changed', () => {
    const root = project({ 'the-posting-seam': hosted })
    const before = readFileSync(hostFile(root, 'the-posting-seam'), 'utf8')
    rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    expect(readFileSync(hostFile(root, 'the-posting-seam'), 'utf8')).toBe(before)
  })

  test('the host’s title is the title, whatever the caller offered', () => {
    const root = project({ 'the-posting-seam': hosted })
    rpc('create_journey', { project: root, slug: 'the-posting-seam', title: 'Something an agent made up' })
    expect(journeyIn(held(root), 'the-posting-seam')?.title).toBe('The posting seam')
  })

  test('a host file from before the rename is found where a host still reads it', () => {
    const root = project({ 'the-posting-seam': hosted }, 'roadmap')
    expect(hostEpic(root, 'the-posting-seam').found).toBe('epic')
    expect(rpc('create_journey', { project: root, slug: 'the-posting-seam' })).toContain('3 steps')
  })

  test('a journey that is already there is never overwritten', () => {
    const root = project({ 'the-posting-seam': hosted })
    rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    rpc('set_step', { project: root, slug: 'the-posting-seam', title: 'A fourth, written here' })
    const before = readFileSync(journeysFile(root), 'utf8')
    expect(rpc('create_journey', { project: root, slug: 'the-posting-seam' })).toContain('already holds a journey')
    expect(readFileSync(journeysFile(root), 'utf8')).toBe(before)
    expect(journeyIn(held(root), 'the-posting-seam')?.steps).toHaveLength(4)
  })

  test('a host file that does not read as a journey is refused, and nothing is written', () => {
    /* A step with no title. Skipping it would make a record with two steps
       where the host has three, and the host would then answer two. */
    const broken = { ...hosted, steps: [...hosted.steps, { body: 'no title', refs: [] }] }
    const root = project({ 'the-posting-seam': broken })
    const said = rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    expect(said).toContain('steps.3.title')
    expect(said).toContain('nothing was created')
    expect(existsSync(journeysFile(root))).toBe(false)
  })

  test('and so is one that is not JSON at all', () => {
    const root = project({ 'the-posting-seam': '{ "slug": "the-posting-seam", "steps": [' })
    expect(rpc('create_journey', { project: root, slug: 'the-posting-seam' })).toContain('could not be read as JSON')
    expect(existsSync(journeysFile(root))).toBe(false)
  })

  test('a host file that is a link out of the project is not followed', () => {
    const elsewhere = project({ 'the-posting-seam': hosted })
    const root = project()
    mkdirSync(join(root, KEHIKOT_DIR, 'kehikko', 'epics'), { recursive: true })
    symlinkSync(hostFile(elsewhere, 'the-posting-seam'), hostFile(root, 'the-posting-seam'))
    expect(hostEpic(root, 'the-posting-seam').found).toBe('unreadable')
    expect(createJourney(root, 'the-posting-seam').ok).toBe(false)
    expect(existsSync(journeysFile(root))).toBe(false)
  })

  test('with no host epic it wants a title, and says nothing will point at the result', () => {
    const root = project()
    expect(rpc('create_journey', { project: root, slug: 'on-its-own' })).toContain('no host holds an epic called "on-its-own"')
    expect(existsSync(journeysFile(root))).toBe(false)
    const said = rpc('create_journey', { project: root, slug: 'on-its-own', title: 'On its own' })
    expect(said).toContain('a title and nothing else')
    expect(said).toContain('No canvas will point at it')
    expect(journeyIn(held(root), 'on-its-own')).toMatchObject({ slug: 'on-its-own', title: 'On its own', steps: [] })
  })

  test('the record is filed under the slug asked for, whatever the file calls itself', () => {
    const root = project({ 'the-posting-seam': { ...hosted, slug: 'something-else' } })
    rpc('create_journey', { project: root, slug: 'the-posting-seam' })
    expect(recordIn(readJourneys(root), 'the-posting-seam')?.slug).toBe('the-posting-seam')
    expect(recordIn(readJourneys(root), 'something-else')).toBeNull()
  })

  test('`set_step` on an epic with no journey says how to begin one', () => {
    const root = project({ 'the-posting-seam': hosted })
    expect(rpc('set_step', { project: root, slug: 'the-posting-seam', title: 'x' })).toContain('create_journey')
    expect(existsSync(journeysFile(root))).toBe(false)
  })

  test('it refuses without a project, like every tool here', () => {
    expect(rpc('create_journey', { slug: 'the-posting-seam' })).toContain('which project?')
    expect(rpc('create_journey', { project: 'relative/path', slug: 'the-posting-seam' })).toContain('not an absolute path')
  })
})

describe('from the page, which hands over what the host answered', () => {
  const post = (root: string, body: Record<string, unknown>, ticket: string | null = writeTicketFor(root)) =>
    answer('POST', '/api/journey', new URLSearchParams(), { ...body, project: root, ticket }, TICKET)

  test('the host’s answer becomes the record, and the reply says where it came from', () => {
    /* No file on disk at all: the host's word is the source, wherever the
       host happens to keep it. */
    const root = project()
    const reply = post(root, { slug: 'the-posting-seam', seed: hosted })
    const body = reply?.body as { ok: boolean; from: string; said: string; journey: { steps: unknown[]; plan: string } }
    expect(reply?.status).toBe(200)
    expect(body.from).toBe('host-answer')
    expect(body.said).toContain('3 steps and 2 groups')
    expect(body.journey.plan).toBe('stored')
    expect(journeyIn(held(root), 'the-posting-seam')).toMatchObject(hosted)
  })

  test('with no answer to hand over, the host’s file is read, as it is for an agent', () => {
    const root = project({ 'the-posting-seam': hosted })
    const body = post(root, { slug: 'the-posting-seam' })?.body as { from: string }
    expect(body.from).toBe('host-file')
    expect(journeyIn(held(root), 'the-posting-seam')?.steps).toHaveLength(3)
  })

  test('an epic whose steps are kept elsewhere comes across as elsewhere, never as none', () => {
    const root = project()
    const paper = { slug: 'a-paper', title: 'A paper', steps: [], stepsFrom: { projector: 'paper', where: 'main.tex', why: '' } }
    const body = post(root, { slug: 'a-paper', seed: paper })?.body as { said: string; journey: { plan: string } }
    expect(body.journey.plan).toBe('elsewhere')
    expect(body.said).toContain('steps kept in main.tex')
  })

  test('an answer that does not read as a journey is refused, and nothing is written', () => {
    const root = project()
    for (const seed of [{ ...hosted, steps: [{ refs: [] }] }, 'text', ['a', 'list'], 7]) {
      const reply = post(root, { slug: 'the-posting-seam', seed })
      expect(reply?.status).toBe(400)
      expect(existsSync(journeysFile(root))).toBe(false)
    }
  })

  test('it is bounded as one document before it is looked at', () => {
    const root = project()
    const huge = { ...hosted, lede: 'x'.repeat(400_001) }
    const reply = post(root, { slug: 'the-posting-seam', seed: huge })
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('400000')
    expect(existsSync(journeysFile(root))).toBe(false)
  })

  test('and it is a write: refused without this project’s ticket', () => {
    const root = project()
    const other = project()
    expect(post(root, { slug: 'the-posting-seam', seed: hosted }, null)?.status).toBe(403)
    expect(post(root, { slug: 'the-posting-seam', seed: hosted }, writeTicketFor(other))?.status).toBe(403)
    expect(existsSync(journeysFile(root))).toBe(false)
  })
})
