import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer, writeTicketFor } from '../doors.ts'
import { ASK } from '../project.ts'

/** The door resolves every project path with the host before the store is touched. */

const home = mkdtempSync(join(tmpdir(), 'kehikko-journeys-moved-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
const was = ASK.options
afterEach(() => {
  ASK.options = was
})

const ID = 'proj-1234abcd'
const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }
const none = new URLSearchParams()

function host(table: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const path = new URL(url).searchParams.get('path') ?? ''
    return new Response(JSON.stringify(table[path] ?? { ok: true, project: false }), { status: 200 })
  }) as never
}
const call = (name: string, args: Record<string, unknown>) =>
  answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
const file = (project: string) => join(project, '.kehikot', 'journeys', 'journeys.json')

describe('a project that moved', () => {
  test('a former path is followed: the write lands in the new folder and the answer says so', async () => {
    const now = join(home, 'new')
    const old = join(home, 'old')
    mkdirSync(now)
    ASK.options = { env, fetch: host({ [old]: { ok: true, project: false, movedTo: now, id: ID }, [now]: { ok: true, project: true, id: ID } }) }
    const reply = await call('create_journey', { project: old, slug: 'first', title: 'First' })
    const text = JSON.stringify(reply?.body)
    expect(text).not.toContain('isError')
    expect(text).toContain(`has moved to ${now}`)
    expect(existsSync(file(now))).toBe(true)
    expect(existsSync(old)).toBe(false)
  })

  test('the page’s ticket and its write agree on the path the host gave back', async () => {
    const now = join(home, 'new')
    const old = join(home, 'old-page')
    ASK.options = { env, fetch: host({ [old]: { ok: true, project: false, movedTo: now, id: ID }, [now]: { ok: true, project: true, id: ID } }) }
    const got = await answer('POST', '/api/ticket', none, { project: old }, TICKET)
    expect((got?.body as { ticket: string }).ticket).toBe(writeTicketFor(now)!)
    expect(JSON.stringify(got?.body)).toContain(`has moved to ${now}`)
  })

  test('an unrelated folder at the old path is refused and nothing is written', async () => {
    const stranger = join(home, 'stranger')
    mkdirSync(stranger)
    ASK.options = { env, fetch: host({}) }
    const tool = await call('create_journey', { project: stranger, slug: 'first', title: 'First' })
    expect(JSON.stringify(tool?.body)).toContain('is not a project open in Kehikot')
    expect(JSON.stringify(tool?.body)).toContain('isError')
    const page = await answer('GET', '/api/journeys', new URLSearchParams({ project: stranger }), null, null)
    expect(page?.status).toBe(409)
    expect(existsSync(join(stranger, '.kehikot'))).toBe(false)
  })

  test('with no host answering, it is a refusal and nothing is written', async () => {
    const dir = join(home, 'nohost')
    mkdirSync(dir)
    ASK.options = {
      env,
      fetch: (async () => {
        throw new Error('ECONNREFUSED')
      }) as never,
    }
    const tool = await call('create_journey', { project: dir, slug: 'first', title: 'First' })
    expect(JSON.stringify(tool?.body)).toContain('is not a project open in Kehikot')
    expect(existsSync(join(dir, '.kehikot'))).toBe(false)
  })
})
