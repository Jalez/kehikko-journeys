import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'kehikot-module-protocol'

import { answerAt as answer } from '../doors.ts'
import { ID } from '../manifest.ts'
import { BEFORE } from '../store.ts'

/**
 * `set_journey`: the prose around a journey's steps, written through the MCP
 * door (gh#26).
 *
 * Before it, `get_journey` handed over a title, a lede, a callout, `exists`,
 * `open`, `missing` and `headings`, and no tool wrote any of them — so an
 * agent that marked a step done could not correct the callout that then
 * contradicted it. Each case here is a temporary project, as in
 * `doors.test.ts`; nothing outside it is touched.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const MINE = moduleFolder(ID)

/** A journey that says something in every field this tool writes. */
const told = {
  slug: 'told',
  title: 'A told journey',
  lede: 'What a reader is promised.',
  steps: [
    { title: 'the fix is in', body: 'Two changes carry it.', refs: ['#1', '!10', '!11'], notes: [], part: 'the-fix-is-in' },
    { title: 'somebody can see it', body: '', refs: ['#2'], notes: [], part: 'somebody-can-see-it' },
  ],
  groups: [
    { heading: 'The fix is in', refs: [], id: 'the-fix-is-in' },
    { heading: 'Somebody can see it', refs: [], id: 'somebody-can-see-it' },
  ],
  exists: ['The parser.', 'The index.'],
  open: ['Which of two designs?'],
  callout: 'The fixes have MRs: !10 and !11 are open.',
  missing: 'Nothing checks the result.',
  headings: [
    { heading: 'Open MRs', refs: ['!10', '!11'], id: 'open-mrs', files: ['notes/mrs.md'], colour: 'amber' },
    { heading: 'Open issues', refs: ['#1', '#2'] },
  ],
  blockedBy: { '#2': ['#1'] },
  /* Every default this version fills in on a write, already there — so that a case can say "this field and nothing else". */
  order: [],
  quizzes: [],
  vocabulary: [],
  settledBy: {},
  containers: [],
  people: [],
  owners: {},
  watch: [],
}

/** A neighbour written by something newer: none of this app's defaults, and a field it has never heard of. */
const neighbour = {
  slug: 'neighbour',
  title: 'A neighbour',
  future: { kept: true },
  steps: [{ title: 'left alone', refs: ['#9'], later: 1 }],
}

function project(journeys: Record<string, unknown> = { neighbour, told }, epic?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'journeys-prose-'))
  made.push(root)
  const dir = join(root, KEHIKOT_DIR, MINE)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'journeys.json')
  writeFileSync(file, `${JSON.stringify({ version: 1, journeys, beside: 'kept' }, null, 2)}\n`)
  const epicFile = join(root, KEHIKOT_DIR, 'host', 'epics', 'told.json')
  if (epic) {
    mkdirSync(join(root, KEHIKOT_DIR, 'host', 'epics'), { recursive: true })
    writeFileSync(epicFile, `${JSON.stringify(epic, null, 2)}\n`)
  }
  const rpc = (message: Record<string, unknown>) => answer('POST', '/mcp', new URLSearchParams(), message, null)
  const call = (name: string, args: Record<string, unknown> = {}) =>
    (
      rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project: root, slug: 'told', ...args } } })
        ?.body as { result: { content: { text: string }[] } }
    ).result.content[0]!.text
  const bytes = () => readFileSync(file, 'utf8')
  const stored = (slug = 'told') => (JSON.parse(bytes()) as { journeys: Record<string, Record<string, unknown>> }).journeys[slug]!
  /** What `get_journey` hands over, as the document under its preamble. */
  const read = () => {
    const text = call('get_journey')
    return JSON.parse(text.slice(text.indexOf('\n{') + 1)) as Record<string, unknown>
  }
  return { root, dir, file, epicFile, rpc, call, bytes, stored, read }
}

/** The file with one journey put back as it was: equal to the old bytes exactly when nothing else moved. */
function withoutTheWrite(now: string, before: string, slug = 'told'): string {
  const after = JSON.parse(now) as { journeys: Record<string, unknown> }
  after.journeys[slug] = (JSON.parse(before) as { journeys: Record<string, unknown> }).journeys[slug]
  return `${JSON.stringify(after, null, 2)}\n`
}

describe('the tool, as a client is told about it', () => {
  const at = project()
  const tools = (
    at.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })?.body as {
      result: { tools: { name: string; description: string; inputSchema: { required: string[]; properties: Record<string, unknown> }; annotations: Record<string, unknown> }[] }
    }
  ).result.tools
  const tool = (name: string) => tools.find((one) => one.name === name)!

  test('it is listed, takes `project` and `slug`, and names every field `get_journey` returns that nothing else writes', () => {
    const one = tool('set_journey')
    expect(one.inputSchema.required).toEqual(['project', 'slug'])
    expect(Object.keys(one.inputSchema.properties)).toEqual(['project', 'slug', 'title', 'lede', 'callout', 'missing', 'exists', 'open', 'headings'])
  })

  test('it writes, it can remove, and saying the same thing twice is the same thing', () => {
    expect(tool('set_journey').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })
  })

  test('the reader points at the writer, and every tool that changes a step says to keep the prose true', () => {
    for (const name of ['get_journey', 'set_step', 'move_step', 'remove_step', 'set_dependency']) {
      expect(tool(name).description).toContain('`set_journey`')
    }
    const hello = at.rpc({ jsonrpc: '2.0', id: 3, method: 'initialize' })?.body as { result: { instructions: string } }
    expect(hello.result.instructions).toContain('`set_journey`')
  })
})

describe('each field: set, cleared, and left alone', () => {
  for (const [field, value] of [
    ['title', 'A journey told again'],
    ['lede', 'A different promise.'],
    ['callout', 'Both fixes merged.'],
    ['missing', 'Nothing checks the result twice.'],
  ] as const) {
    test(`\`${field}\` is set, and nothing else in the journey moves`, () => {
      const at = project()
      const before = at.stored()
      const said = at.call('set_journey', { [field]: `  ${value}  ` })
      expect(said).toContain(`Set \`${field}\` of told`)
      expect(said).toContain(at.file)
      expect(at.stored()).toEqual({ ...before, [field]: value })
      expect(at.read()[field]).toBe(value)
    })
  }

  for (const field of ['lede', 'callout', 'missing'] as const) {
    test(`\`${field}\` is cleared by "" and by null, and left alone when it is not passed`, () => {
      for (const empty of ['', null]) {
        const at = project()
        const before = at.stored()
        expect(at.call('set_journey', { [field]: empty })).toContain(`Set \`${field}\``)
        expect(at.stored()).toEqual({ ...before, [field]: '' })
      }
    })
  }

  for (const field of ['exists', 'open'] as const) {
    test(`\`${field}\` is replaced whole, cleared by [], and left alone when it is not passed`, () => {
      const at = project()
      const before = at.stored()
      expect(at.call('set_journey', { [field]: [' One thing. ', '', 'Another.'] })).toContain(`Set \`${field}\``)
      expect(at.stored()).toEqual({ ...before, [field]: ['One thing.', 'Another.'] })
      expect(at.call('set_journey', { [field]: [] })).toContain(`Set \`${field}\``)
      expect(at.stored()).toEqual({ ...before, [field]: [] })
    })
  }

  test('several at once: the ones passed are written, the ones that already read so are said to, and the rest stay', () => {
    const at = project()
    const before = at.stored()
    const said = at.call('set_journey', { callout: 'Both fixes merged.', open: [], lede: told.lede })
    expect(said).toContain('Set `callout` and `open` of told')
    expect(said).toContain('`lede` already read so.')
    expect(at.stored()).toEqual({ ...before, callout: 'Both fixes merged.', open: [] })
  })

  test('the steps, what blocks what and the parts are not this tool’s: an argument for them changes nothing', () => {
    const at = project()
    const before = at.stored()
    at.call('set_journey', { callout: 'x', steps: [], blockedBy: {}, groups: [], written: 'today' })
    expect(at.stored()).toEqual({ ...before, callout: 'x' })
  })

  test('a journey whose steps are kept elsewhere still has prose, and it is written', () => {
    const at = project({ told: { slug: 'told', title: 'T', steps: [], stepsFrom: { projector: 'paper', where: 'a.tex', why: '' } } })
    expect(at.call('set_journey', { callout: 'Read the paper.' })).toContain('Set `callout`')
    expect(at.stored().callout).toBe('Read the paper.')
    expect(at.stored().steps).toEqual([])
  })
})

describe('headings, the reference lists of the older shape', () => {
  test('one heading’s list is replaced, and what else it carried stays on it', () => {
    const at = project()
    at.call('set_journey', { headings: [{ heading: 'Open MRs', refs: ['!11'] }, { heading: 'Open issues', refs: ['#1', '#2'] }] })
    expect(at.stored().headings).toEqual([
      { heading: 'Open MRs', refs: ['!11'], id: 'open-mrs', files: ['notes/mrs.md'], colour: 'amber' },
      { heading: 'Open issues', refs: ['#1', '#2'] },
    ])
  })

  test('a heading left out is removed and named in the answer; a new one is added', () => {
    const at = project()
    const said = at.call('set_journey', { headings: [{ heading: 'Open issues', refs: ['#2'] }, { heading: 'Merged', refs: ['!10', '!11'] }] })
    expect(said).toContain('Removed from `headings`, with the references under it: “Open MRs”.')
    expect(at.stored().headings).toEqual([
      { heading: 'Open issues', refs: ['#2'] },
      { heading: 'Merged', refs: ['!10', '!11'] },
    ])
  })

  test('[] removes them all, and the key with them; the references they held stop being counted', () => {
    const at = project({ told: { ...told, headings: [{ heading: 'Watched', refs: ['#77'] }] } })
    expect(at.call('list_journeys')).toContain('5 refs')
    const said = at.call('set_journey', { headings: [] })
    expect(said).toContain('“Watched”')
    expect(Object.hasOwn(at.stored(), 'headings')).toBe(false)
    expect(Object.hasOwn(at.read(), 'headings')).toBe(false)
    expect(at.call('list_journeys')).toContain('4 refs')
  })

  test('they are not parts: `groups` and every step are as they were', () => {
    const at = project()
    const before = at.stored()
    at.call('set_journey', { headings: [] })
    expect(at.stored().groups).toEqual(before.groups)
    expect(at.stored().steps).toEqual(before.steps)
  })
})

describe('what a write leaves alone', () => {
  test('saying what the journey already says writes nothing: not a byte, and not the file’s time', () => {
    const at = project()
    const before = at.bytes()
    const then = statSync(at.file).mtimeMs
    const said = at.call('set_journey', {
      title: told.title,
      lede: told.lede,
      callout: told.callout,
      missing: told.missing,
      exists: told.exists,
      open: told.open,
      headings: told.headings.map(({ heading, refs }) => ({ heading, refs })),
    })
    expect(said).toStartWith('Nothing was written:')
    expect(at.bytes()).toBe(before)
    expect(statSync(at.file).mtimeMs).toBe(then)
    expect(existsSync(join(at.dir, 'parts.json'))).toBe(false)
  })

  test('nor does it store a record of the older shape as the newer one', () => {
    const older = { slug: 'told', title: 'T', lede: 'L', steps: [{ title: 'one', refs: ['#1'] }], groups: [{ heading: 'Open MRs', refs: ['!10'] }] }
    const at = project({ told: older })
    const before = at.bytes()
    expect(at.call('set_journey', { lede: 'L' })).toStartWith('Nothing was written:')
    expect(at.bytes()).toBe(before)
    expect(existsSync(join(at.dir, `${BEFORE}.json`))).toBe(false)
  })

  test('the other journeys in the file, and what sits beside them, are byte for byte what they were', () => {
    const at = project()
    const before = at.bytes()
    at.call('set_journey', { title: 'Renamed', lede: '', callout: 'c', missing: '', exists: [], open: ['o'], headings: [] })
    expect(at.bytes()).not.toBe(before)
    expect(withoutTheWrite(at.bytes(), before)).toBe(before)
    expect(at.stored('neighbour')).toEqual(neighbour)
  })

  test('the keys of the journey that was written stay in the order the file had them', () => {
    const at = project()
    const before = Object.keys(at.stored())
    at.call('set_journey', { callout: 'c', exists: [] })
    expect(Object.keys(at.stored()).slice(0, before.length)).toEqual(before)
  })
})

describe('what is refused, and each refusal writes nothing', () => {
  const at = project()
  const before = at.bytes()
  const refused = (args: Record<string, unknown>, saying: string) => {
    const said = at.call('set_journey', args)
    expect(said).toContain(saying)
    expect(at.bytes()).toBe(before)
  }

  test('no project, and a name that is not one', () => {
    refused({ project: '', callout: 'x' }, 'which project?')
    refused({ slug: '../etc', callout: 'x' }, 'that is not a journey name')
  })

  test('a journey this project does not hold, with the tool that begins one', () => {
    refused({ slug: 'not-here', callout: 'x' }, 'create_journey')
  })

  test('no field at all', () => {
    refused({}, 'None was passed')
  })

  test('a title cleared', () => {
    refused({ title: '   ' }, '`title` can be changed and cannot be cleared')
    refused({ title: null, callout: 'x' }, 'cannot be cleared')
  })

  test('text that is not text, and text that is too long — refused, not cut', () => {
    refused({ callout: ['a'] }, '`callout` is text.')
    refused({ lede: 7 }, '`lede` is text.')
    refused({ title: 'x'.repeat(401) }, '`title` runs to 400 characters at most; this is 401.')
    refused({ callout: 'x'.repeat(20_001) }, '`callout` runs to 20000 characters at most')
  })

  test('a list that is not a list — which `[]` would have cleared', () => {
    refused({ open: 'all of it is done' }, '`open` is a list of strings; pass [] to clear it.')
    refused({ exists: [1] }, 'one entry of this is not a string')
    refused({ exists: Array.from({ length: 201 }, () => 'x') }, '`exists` holds 200 entries at most; this is 201.')
    refused({ open: ['x'.repeat(4001)] }, 'An entry of `open` runs to 4000 characters at most')
  })

  test('headings that are not { heading, refs }', () => {
    refused({ headings: 'none' }, '`headings` is a list of { heading, refs }')
    refused({ headings: ['Open MRs'] }, 'Each of `headings` is { heading, refs }.')
    refused({ headings: [{ heading: '', refs: [] }] }, 'leave it out of the list')
    refused({ headings: [{ heading: 'Open MRs', refs: '!10' }] }, 'is a list of strings')
    refused({ headings: [{ heading: 'Open MRs', refs: ['x'.repeat(201)] }] }, '200 characters at most')
  })

  test('one bad field refuses the whole call: the good one beside it is not written', () => {
    refused({ callout: 'Both fixes merged.', open: 'none' }, 'Nothing was written.')
  })

  test('a file that will not parse is not written over', () => {
    const broken = project()
    writeFileSync(broken.file, '{ not json')
    expect(broken.call('set_journey', { callout: 'x' })).toContain('could not be read')
    expect(broken.bytes()).toBe('{ not json')
  })
})

describe('where a host keeps the epic', () => {
  const epic = { slug: 'told', title: 'The host’s title', parts: [{ id: 'the-fix-is-in', name: 'The fix' }] }

  test('the host’s file is not written, `groups` is not touched, and a title that now differs from the host’s is said', () => {
    const at = project({ neighbour, told }, epic)
    const host = readFileSync(at.epicFile, 'utf8')
    const before = at.stored()
    const said = at.call('set_journey', { title: 'Told again', callout: 'Both fixes merged.' })
    expect(said).toContain('The host keeps a title of its own for this epic (“The host’s title”')
    expect(readFileSync(at.epicFile, 'utf8')).toBe(host)
    expect(at.stored()).toEqual({ ...before, title: 'Told again', callout: 'Both fixes merged.' })
  })

  test('a title that is the host’s own needs no sentence', () => {
    const at = project({ told }, epic)
    expect(at.call('set_journey', { title: 'The host’s title' })).not.toContain('The host keeps')
  })
})

/**
 * gh#26 as it happened: a step marked done, a callout still saying its fixes
 * "have MRs", and the merged changes and closed issues still listed under
 * "Open MRs" and "Open issues" — in a record of the older shape, where those
 * two were groups that were never parts.
 */
describe('the journey that contradicted itself, corrected through the door and nothing else', () => {
  const older = {
    slug: 'told',
    title: 'The fix reaches a user',
    lede: 'Two fixes and what they unblock.',
    callout: 'Both fixes have MRs: !10 and !11 are in review.',
    open: ['Does #1 need a second fix?'],
    steps: [
      { title: 'the fix is in', body: 'In review.', refs: ['#1'], notes: ['in review'] },
      { title: 'somebody can see it', body: '', refs: ['#2'], notes: [] },
    ],
    groups: [
      { heading: 'Open MRs', refs: ['!10', '!11'] },
      { heading: 'Open issues', refs: ['#1', '#2'] },
    ],
  }
  const at = project({ neighbour, told: older })
  const before = at.bytes()

  test('reading it shows the stale lists as `headings`', () => {
    expect(at.read().headings).toEqual([
      { heading: 'Open MRs', refs: ['!10', '!11'] },
      { heading: 'Open issues', refs: ['#1', '#2'] },
    ])
  })

  test('the step is marked done with `set_step`, which leaves the callout saying the opposite', () => {
    expect(at.call('set_step', { position: 1, title: 'the fix is in', body: 'Merged.', refs: ['#1', '!10', '!11'], notes: ['done'] })).toContain('Set step 1')
    expect(at.read().callout).toBe(older.callout)
  })

  test('the callout, the open question and both lists are then corrected with `set_journey`', () => {
    const said = at.call('set_journey', {
      callout: 'Both fixes merged: !10 and !11. What is left is #2.',
      open: [],
      headings: [{ heading: 'Open issues', refs: ['#2'] }],
    })
    expect(said).toContain('Set `callout`, `open` and `headings` of told')
    expect(said).toContain('“Open MRs”')
  })

  test('and it reads true from top to bottom, with the neighbour untouched', () => {
    const now = at.read() as { callout: string; open: string[]; headings: unknown; steps: { body: string; notes: string[] }[]; lede: string }
    expect(now.callout).toBe('Both fixes merged: !10 and !11. What is left is #2.')
    expect(now.open).toEqual([])
    expect(now.headings).toEqual([{ heading: 'Open issues', refs: ['#2'] }])
    expect(now.steps[0]).toMatchObject({ body: 'Merged.', notes: ['done'] })
    expect(now.lede).toBe(older.lede)
    expect(withoutTheWrite(at.bytes(), before)).toBe(before)
  })
})
