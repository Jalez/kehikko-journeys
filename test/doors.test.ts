import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { TICKET, answer, writeTicketFor } from '../doors.ts'
import { ID } from '../manifest.ts'

/** This module's own folder inside `.kehikot/`, spelled the way the app spells it. */
const MINE = moduleFolder(ID)

/**
 * A project of its own for this file, and nothing outside it is touched.
 *
 * The store used to be a directory this app owned, and `JOURNEYS_DATA` pointed
 * the tests at a temporary copy of it. There is no such variable now — the
 * journeys live inside whichever project a caller names — so a test is a
 * temporary PROJECT rather than a temporary store. That is a better shape: it
 * exercises the same resolution, the same fence and the same `.gitignore`
 * behaviour a real project gets, instead of a mode only tests can be in.
 */
const project = mkdtempSync(join(tmpdir(), 'journeys-project-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))

/** A second project, for the half of this that is about telling them apart. */
const elsewhere = mkdtempSync(join(tmpdir(), 'journeys-elsewhere-'))
afterAll(() => rmSync(elsewhere, { recursive: true, force: true }))

/** Two journeys to read: one with steps, one whose steps are kept elsewhere. */
function fill(where: string): void {
  mkdirSync(join(where, KEHIKOT_DIR, MINE), { recursive: true })
  writeFileSync(
    join(where, KEHIKOT_DIR, MINE, 'journeys.json'),
    `${JSON.stringify(
      {
        version: 1,
        journeys: {
          'a-stored-journey': {
            slug: 'a-stored-journey',
            title: 'A stored journey',
            steps: [{ title: 'the first thing', body: '', refs: ['#1'], notes: [] }],
          },
          'a-projected-journey': {
            slug: 'a-projected-journey',
            title: 'A projected journey',
            steps: [],
            stepsFrom: { projector: 'paper', where: 'chapters/wire.tex', why: '' },
          },
        },
      },
      null,
      2,
    )}\n`,
  )
}
fill(project)
fill(elsewhere)

const query = (s = '') => new URLSearchParams(s)
const get = (path: string, q = '') => answer('GET', path, query(q), null, null)
const post = (path: string, body: Record<string, unknown>, ticket: string | null) =>
  answer('POST', path, query(), body, ticket)

/** The write ticket for the temp project, which is what a page would hold. */
const write = writeTicketFor(project) as string

describe('reading a project’s journeys', () => {
  test('lists what that project holds', () => {
    const reply = get('/api/journeys', `project=${encodeURIComponent(project)}`)
    const body = reply?.body as { ok: boolean; journeys: { slug: string }[]; nowhere: boolean }
    expect(reply?.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.nowhere).toBe(false)
    expect(body.journeys.map((j) => j.slug).sort()).toEqual(['a-projected-journey', 'a-stored-journey'])
  })

  test('hands over one journey with the one derived fact the page cannot reach', () => {
    const reply = get('/api/journey', `project=${encodeURIComponent(project)}&slug=a-stored-journey`)
    const body = reply?.body as { ok: boolean; journey: { slug: string; plan: string } }
    expect(body.journey.slug).toBe('a-stored-journey')
    expect(body.journey.plan).toBe('stored')
  })

  /**
   * A malformed name never reaches a store. It could not leave a directory even
   * if it did — a slug is a key in one document now, not a filename — but the
   * refusal is the same one the protocol package makes about `epic` at the
   * host's own door, and keeping it is cheaper than reasoning about the shape
   * twice at every new call site.
   */
  test('refuses a name that is not a name', () => {
    const reply = get('/api/journey', `project=${encodeURIComponent(project)}&slug=../../etc/passwd`)
    expect(reply?.status).toBe(400)
  })

  test('says plainly that it does not hold a journey it does not hold', () => {
    const reply = get('/api/journey', `project=${encodeURIComponent(project)}&slug=no-such-journey-here`)
    expect(reply?.status).toBe(404)
  })
})

/**
 * The state the whole move is about. No project is not an empty project, and it
 * is not an error either — it is somewhere a person can legitimately be, and
 * the pane has to be able to say so without claiming anything about a store.
 */
describe('when no project is open', () => {
  test('the index is empty and says it is nowhere, not that the project has none', () => {
    const body = get('/api/journeys')?.body as { ok: boolean; journeys: unknown[]; nowhere: boolean }
    expect(body.ok).toBe(true)
    expect(body.journeys).toEqual([])
    expect(body.nowhere).toBe(true)
  })

  /* 409 and not 404. A 404 would be a claim that the journey does not exist,
     which is a claim about a store this app has not opened. */
  test('asking for a journey is refused as nowhere rather than as not-found', () => {
    const reply = get('/api/journey', 'slug=a-stored-journey')
    expect(reply?.status).toBe(409)
    expect((reply?.body as { error: string }).error).toContain('no project is open')
  })

  test('a write is refused, and there is no ticket to make one with', () => {
    expect(writeTicketFor(null)).toBeNull()
    const reply = post('/api/step', { slug: 'a-stored-journey', title: 'x' }, TICKET)
    expect(reply?.status).toBe(403)
  })
})

describe('a project this app will not read under', () => {
  test('a relative path is refused, with a sentence saying why', () => {
    const body = get('/api/journeys', 'project=relative/path')?.body as { trouble: string; nowhere: boolean }
    expect(body.nowhere).toBe(false)
    expect(body.trouble).toContain('absolute')
  })

  test('a folder that is not there is refused rather than created', () => {
    const body = get('/api/journeys', `project=${encodeURIComponent(join(tmpdir(), 'no-such-project-at-all'))}`)
      ?.body as { trouble: string }
    expect(body.trouble).toContain('no folder')
  })
})

describe('writing, and the ticket that names one project', () => {
  test('a write with no ticket is refused', () => {
    const reply = post('/api/step', { project, slug: 'a-stored-journey', title: 'x' }, null)
    expect(reply?.status).toBe(403)
  })

  /**
   * The process ticket is no longer enough on its own. It is what buys a
   * PROJECT ticket, and a write has to carry the second — see the essay on
   * `writeTicketFor` in `doors.ts` for the failure that separation catches.
   */
  test('the process ticket alone no longer redeems a write', () => {
    const reply = post('/api/step', { project, slug: 'a-stored-journey', title: 'x' }, TICKET)
    expect(reply?.status).toBe(403)
  })

  /**
   * The one this exists for. A save composed while the canvas was on one
   * project, arriving after it moved to another, must not be written into the
   * new one: it is a real step, and it would be filed under the wrong project
   * with every screen reporting success.
   */
  test('a ticket taken out for one project does not redeem against another', () => {
    const reply = post('/api/step', { project: elsewhere, slug: 'a-stored-journey', title: 'x' }, write)
    expect(reply?.status).toBe(403)
    expect((reply?.body as { error: string }).error).toContain('does not redeem against another')
  })

  test('the ticket door hands one over to something holding the process ticket', () => {
    const reply = post('/api/ticket', { project }, TICKET)
    expect((reply?.body as { ok: boolean; ticket: string }).ticket).toBe(write)
  })

  test('and refuses one to anything that is not this app’s own page', () => {
    expect(post('/api/ticket', { project }, 'not-the-ticket')?.status).toBe(403)
    expect(post('/api/ticket', { project }, null)?.status).toBe(403)
  })

  /* Two spellings of one project are one project and one ticket, or a page that
     named its project a shade differently would have its writes refused with
     nothing on either side able to say why. */
  test('a trailing slash is the same project and the same ticket', () => {
    expect(writeTicketFor(`${project}/`)).toBe(write)
  })

  test('a step written through the page door comes back in the journey', () => {
    const reply = post('/api/step', { project, slug: 'a-stored-journey', title: 'a step this test wrote' }, write)
    const body = reply?.body as { ok: boolean; journey: { steps: { title: string }[] } }
    expect(body.ok).toBe(true)
    expect(body.journey.steps.map((s) => s.title)).toContain('a step this test wrote')
  })

  /** And lands in the project's own folder, which is the whole point of the move. */
  test('and is on disk inside the project, in .kehikot/journeys/journeys.json', () => {
    const raw = JSON.parse(readFileSync(join(project, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')) as {
      journeys: Record<string, { steps: { title: string }[] }>
    }
    expect(raw.journeys['a-stored-journey']?.steps.map((s) => s.title)).toContain('a step this test wrote')
  })

  /* One file for the project means every save rewrites the whole document, and
     a save that dropped its neighbours would lose material silently. */
  test('writing one journey leaves the others in the document', () => {
    const raw = JSON.parse(readFileSync(join(project, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')) as {
      journeys: Record<string, unknown>
    }
    expect(Object.keys(raw.journeys).sort()).toEqual(['a-projected-journey', 'a-stored-journey'])
  })

  /** And it did not reach into the other project on the way past. */
  test('and leaves the other project exactly as it was', () => {
    const raw = JSON.parse(readFileSync(join(elsewhere, KEHIKOT_DIR, MINE, 'journeys.json'), 'utf8')) as {
      journeys: Record<string, { steps: { title: string }[] }>
    }
    expect(raw.journeys['a-stored-journey']?.steps.map((s) => s.title)).toEqual(['the first thing'])
  })

  /**
   * The refusal that has to say where to write instead. A tool that says only
   * "no" leaves somebody with a decision they cannot record anywhere, and the
   * next thing they do is write it in a second place.
   */
  test('a step on a journey whose steps are projected is refused, with somewhere to go', () => {
    const reply = post('/api/step', { project, slug: 'a-projected-journey', title: 'x' }, write)
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('projected')
  })
})

describe('the MCP door', () => {
  const rpc = (message: Record<string, unknown>) => answer('POST', '/mcp', query(), message, null)
  const call = (name: string, args: Record<string, unknown>) =>
    (
      rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })?.body as {
        result: { content: { text: string }[] }
      }
    ).result.content[0]?.text ?? ''

  test('introduces itself with tools', () => {
    const body = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })?.body as { result: { serverInfo: unknown } }
    expect(body.result.serverInfo).toBeTruthy()
  })

  test('lists the tools it has, and every one of them requires a project', () => {
    const body = rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })?.body as {
      result: { tools: { name: string; inputSchema: { required?: string[] } }[] }
    }
    expect(body.result.tools.map((t) => t.name)).toContain('list_journeys')
    /* Without exception. A tool that could be called without a project is a
       tool that would have to invent one. */
    for (const tool of body.result.tools) expect(tool.inputSchema.required).toContain('project')
  })

  /**
   * Refused rather than defaulted, and the refusal says what to pass. Every
   * default on offer is silently wrong: `process.cwd()` is this module's own
   * directory, "the only project that has journeys" is right until there are
   * two, and no partition at all is a place journeys go to be invisible.
   */
  test('refuses to work without a project, and says what to pass', () => {
    const said = call('list_journeys', {})
    expect(said).toContain('project')
    expect(said.toLowerCase()).toContain('guess')
  })

  test('lists a named project’s journeys', () => {
    expect(call('list_journeys', { project })).toContain('a-stored-journey')
  })

  test('says a project holds none rather than that there are none anywhere', () => {
    const bare = mkdtempSync(join(tmpdir(), 'journeys-bare-'))
    expect(call('list_journeys', { project: bare })).toContain('No journeys in')
    rmSync(bare, { recursive: true, force: true })
  })

  test('writes a step into the project it was told about, and names the file', () => {
    expect(call('set_step', { project, slug: 'a-stored-journey', title: 'written over mcp' })).toContain(KEHIKOT_DIR)
    expect(call('get_journey', { project, slug: 'a-stored-journey' })).toContain('written over mcp')
  })

  /**
   * The prototype hazard the protocol package's `ids.ts` writes an essay about,
   * one door over: a bare `TOOLS[name]` finds `constructor` on the prototype of
   * any plain object, and `.run(args)` on that is a TypeError thrown out of a
   * request handler rather than an answer saying there is no such tool.
   */
  test('answers "no such tool" for a name that lives on Object.prototype', () => {
    const body = rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'constructor' } })?.body as {
      result: { isError: boolean }
    }
    expect(body.result.isError).toBe(true)
  })

  test('a notification is answered with nothing', () => {
    const reply = rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBeNull()
  })
})

describe('what is not this app’s to answer', () => {
  /**
   * `null` means "not ours", and the middleware passes it to Vite. That is how
   * the page, the client module and Vite's own hot-reload socket keep working
   * without being enumerated in `doors.ts`.
   */
  test('a path this app does not own is handed on rather than refused', () => {
    expect(get('/page/main.ts')).toBeNull()
    expect(get('/@vite/client')).toBeNull()
  })

  /** But an unknown path under `/api/` is ours to refuse, not Vite's to guess at. */
  test('an unknown api path is refused here', () => {
    expect(get('/api/nothing-here')?.status).toBe(404)
  })

  test('the health check says which module is up', () => {
    const body = get('/healthz')?.body as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('roadmap.journeys')
  })
})
