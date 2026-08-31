import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'
import { KEHIKOT_DIR, moduleFolder } from 'roadmap-module-protocol'

import { ID } from '../manifest.ts'
import { dataFile, held, journeySchema, makeDir, writeJourney } from '../store.ts'

/** This module's own folder inside `.kehikot/`, spelled the way the app spells it. */
const MINE = moduleFolder(ID)

/**
 * Where a journey goes, and every way this app refuses to guess.
 *
 * Everything here is about the same failure and it is worth naming once: this
 * app writes files into a path it was handed OVER THE WIRE. A path that is
 * absent, a path that is not there, a path that is not absolute, and a folder
 * that resolves somewhere else are four ways to end up writing somebody's
 * hand-written narrative into a directory they will never open — with the page
 * reporting that it saved. None of them may produce a write.
 */

const made: string[] = []
/**
 * `realpathSync` on the way out, and it is not incidental.
 *
 * `/var` is a symlink to `/private/var` on macOS, so a temporary directory has
 * two names and this app resolves the one it is given. A test comparing against
 * the unresolved name would fail on macOS and pass on Linux, which is a test
 * about the machine rather than about the code — and the resolution is the
 * behaviour being relied on, not an inconvenience to work around.
 */
function tempProject(options: { git?: boolean } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'journeys-where-')))
  made.push(dir)
  if (options.git) mkdirSync(join(dir, '.git'), { recursive: true })
  return dir
}
afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true })
})

const journey = (slug = 'a-journey') => journeySchema.parse({ slug, title: 'A journey' })

describe('where this project’s journeys live', () => {
  test('is .kehikot/journeys/journeys.json inside the project', () => {
    const project = tempProject()
    expect(dataFile(project).path).toBe(join(project, KEHIKOT_DIR, MINE, 'journeys.json'))
  })

  /* A read must not change the thing being read. Opening a container against a
     project the reader is only looking at should not leave a folder in their
     repository they never asked for. */
  test('reading creates nothing at all', () => {
    const project = tempProject({ git: true })
    expect(held(project).journeys).toEqual({})
    expect(existsSync(join(project, KEHIKOT_DIR))).toBe(false)
    expect(existsSync(join(project, '.gitignore'))).toBe(false)
  })

  test('a real project with no journeys is readable and writable, and is not trouble', () => {
    const project = tempProject()
    const store = held(project)
    expect(store.nowhere).toBe(false)
    expect(store.trouble).toBeNull()
    expect(store.journeys).toEqual({})
    expect(writeJourney(project, journey()).ok).toBe(true)
  })

  test('a journey written comes back identical', () => {
    const project = tempProject()
    const written = journeySchema.parse({ slug: 'a-journey', title: 'A journey', lede: 'a lede', watch: ['gh#9'] })
    expect(writeJourney(project, written).ok).toBe(true)
    expect(held(project).journeys['a-journey']).toEqual(written)
  })
})

/**
 * The state this whole move turns on. No project is not an empty project: an
 * empty project is a thing you may write into and this is not one, and a module
 * that treated them the same would have a `null` path resolve to somewhere.
 */
describe('when there is no project', () => {
  test('there is no path, and that is not trouble', () => {
    for (const nothing of [null, undefined, '', '   ']) {
      expect(dataFile(nothing)).toEqual({ path: null, trouble: null })
      const store = held(nothing)
      expect(store.nowhere).toBe(true)
      expect(store.trouble).toBeNull()
      expect(store.journeys).toEqual({})
    }
  })

  test('a write is refused with a sentence, and nothing is created anywhere', () => {
    const before = readdirSync(tmpdir()).length
    const out = writeJourney(null, journey())
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.error).toContain('no project is open')
    expect(makeDir(null)).toEqual({ dir: null, trouble: null })
    expect(readdirSync(tmpdir()).length).toBe(before)
  })
})

describe('a project path this app refuses', () => {
  test('a relative one, because it would resolve against wherever this was started', () => {
    const out = dataFile('some/relative/path')
    expect(out.path).toBeNull()
    expect(out.trouble).toContain('absolute')
  })

  test('one that is not there', () => {
    expect(dataFile(join(tmpdir(), 'definitely-not-a-project')).trouble).toContain('no folder')
  })

  test('one that is a file rather than a folder', () => {
    const project = tempProject()
    const file = join(project, 'a-file')
    writeFileSync(file, 'not a folder')
    expect(dataFile(file).trouble).toContain('not a folder')
  })

  test('one with a control character in it, because no real path has one', () => {
    expect(dataFile('/tmp/a\u0001b').trouble).toContain('control character')
  })
})

/**
 * The fence, which is the reason `within()` is not enough on its own.
 *
 * `<project>/.kehikot` is a name this app joins itself, so no string a caller
 * sends can escape through it. What CAN escape is the folder: make it a symlink
 * to somewhere else and every path comparison in the world still says it is
 * inside the project. Only `realpath` sees it, and it has to be asked after the
 * folder exists rather than before.
 */
describe('a .kehikot that points somewhere else', () => {
  test('is refused rather than followed, and nothing is written through it', () => {
    const project = tempProject()
    const outside = tempProject()
    symlinkSync(outside, join(project, KEHIKOT_DIR))

    const out = dataFile(project)
    expect(out.path).toBeNull()
    expect(out.trouble).toContain('outside the project')

    const store = held(project)
    expect(store.trouble).toContain('outside the project')

    const written = writeJourney(project, journey())
    expect(written.ok).toBe(false)
    expect(written.ok === false && written.error).toContain('outside the project')
    /* And the place it pointed at is untouched, which is the thing that would
       actually have gone wrong. */
    expect(existsSync(join(outside, 'journeys.json'))).toBe(false)
  })

  /**
   * The inner level too, and it is the one worth having its own test. A
   * `.kehikot` that points away takes every module's data with it and is
   * conspicuous; a `.kehikot/journeys` that points away takes only this app's,
   * and everything beside it in the folder still looks right.
   */
  test('and so is this module\u2019s own folder, when .kehikot itself is honest', () => {
    const project = tempProject()
    const outside = tempProject()
    mkdirSync(join(project, KEHIKOT_DIR))
    symlinkSync(outside, join(project, KEHIKOT_DIR, MINE))

    expect(dataFile(project).trouble).toContain('outside the project')
    expect(held(project).trouble).toContain('outside the project')
    expect(writeJourney(project, journey()).ok).toBe(false)
    expect(existsSync(join(outside, 'journeys.json'))).toBe(false)
  })

  test('and so is the file itself, when the folder is honest and the file is not', () => {
    const project = tempProject()
    const outside = tempProject()
    mkdirSync(join(project, KEHIKOT_DIR, MINE), { recursive: true })
    writeFileSync(join(outside, 'journeys.json'), '{"version":1,"journeys":{}}\n')
    symlinkSync(join(outside, 'journeys.json'), join(project, KEHIKOT_DIR, MINE, 'journeys.json'))

    expect(dataFile(project).trouble).toContain('outside the project')
    expect(writeJourney(project, journey()).ok).toBe(false)
    /* Unchanged: a write that followed the link would have edited a file in
       another project. */
    expect(readFileSync(join(outside, 'journeys.json'), 'utf8')).toBe('{"version":1,"journeys":{}}\n')
  })
})

/**
 * A file that will not parse is not an empty store.
 *
 * The single most destructive bug available here: read a broken file as empty,
 * then write over it on the first save. Every journey in it is authored, and
 * "there is nothing here" and "this could not be read" must never look the same
 * on screen.
 */
describe('a journeys.json that will not parse', () => {
  test('is trouble rather than emptiness, and says the file is recoverable', () => {
    const project = tempProject()
    mkdirSync(join(project, KEHIKOT_DIR, MINE), { recursive: true })
    writeFileSync(join(project, KEHIKOT_DIR, MINE, 'journeys.json'), '{ not json')
    const store = held(project)
    expect(store.journeys).toEqual({})
    expect(store.nowhere).toBe(false)
    expect(store.trouble).toContain('recoverable')
  })

  test('and nothing is written over it', () => {
    const project = tempProject()
    mkdirSync(join(project, KEHIKOT_DIR, MINE), { recursive: true })
    const path = join(project, KEHIKOT_DIR, MINE, 'journeys.json')
    writeFileSync(path, '{ not json')
    expect(writeJourney(project, journey()).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('{ not json')
  })
})

/**
 * The `.gitignore`, which is an edit to somebody's own repository and is
 * treated as one: appended once, never rewritten, and never created where there
 * is no repository to ignore anything for.
 */
describe('the line a project’s .gitignore gains', () => {
  test('is added when the folder is first created, with a comment saying what it is', () => {
    const project = tempProject({ git: true })
    writeJourney(project, journey())
    const ignore = readFileSync(join(project, '.gitignore'), 'utf8')
    expect(ignore).toContain(`${KEHIKOT_DIR}/`)
    expect(ignore).toContain('Remove these lines to')
  })

  /* The one that would show up in the user's next diff as changes they did not
     make. Every save creates the folder afresh in a world where somebody
     deleted it; the rule is that the ignore is written on the run that made the
     folder and never again. */
  test('is not added twice, however many times something is written', () => {
    const project = tempProject({ git: true })
    writeJourney(project, journey('one'))
    const after = readFileSync(join(project, '.gitignore'), 'utf8')
    writeJourney(project, journey('two'))
    writeJourney(project, journey('three'))
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe(after)
    expect(after.split(`${KEHIKOT_DIR}/`).length - 1).toBe(1)
  })

  test('leaves every byte that was already in it exactly where it was', () => {
    const project = tempProject({ git: true })
    const before = '  dist  \n\n\n#   node_modules\n\tbuild'
    writeFileSync(join(project, '.gitignore'), before)
    writeJourney(project, journey())
    expect(readFileSync(join(project, '.gitignore'), 'utf8').startsWith(`${before}\n`)).toBe(true)
  })

  test('is left alone entirely when the folder is already ignored some other way', () => {
    const project = tempProject({ git: true })
    const before = `dist\n**/${KEHIKOT_DIR}/\n`
    writeFileSync(join(project, '.gitignore'), before)
    writeJourney(project, journey())
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe(before)
  })

  /* A project that is not in a repository at all has nothing to ignore for, and
     creating a `.gitignore` there would be this program deciding how somebody
     keeps their folder. The journeys are still written; only the ignore is
     skipped. `tempProject` is under the system temp directory, which is not
     inside a repository on any machine this runs on. */
  test('is not created at all in a project that is in no repository', () => {
    const project = tempProject()
    expect(writeJourney(project, journey()).ok).toBe(true)
    expect(existsSync(join(project, '.gitignore'))).toBe(false)
    expect(existsSync(join(project, '.git'))).toBe(false)
  })

  /**
   * The case that forced the walk up, and it is a real project rather than a
   * hypothetical: the thesis at `…/CS-DEGREE/05_drafts/thesis_latex` has no
   * `.git` of its own and sits several directories inside the CS-DEGREE
   * repository. A check that looked only at the project root would write
   * `.kehikot/` there with nothing ignoring it, and the next `git status` in
   * that repository would offer somebody's working material for commit.
   */
  test('is written for a project nested inside a repository above it', () => {
    const repo = tempProject({ git: true })
    const project = join(repo, 'drafts', 'thesis_latex')
    mkdirSync(project, { recursive: true })

    expect(writeJourney(project, journey()).ok).toBe(true)
    /* At the PROJECT root, not the repository root. Git honours a `.gitignore`
       in any directory, so the rule covers the folder that was just created and
       touches nothing else in a repository that may hold a dozen unrelated
       projects. */
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toContain(`${KEHIKOT_DIR}/`)
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  })

  /* A worktree and a submodule both have a `.git` FILE rather than a directory,
     and both are repositories for every purpose this cares about. */
  test('counts a .git that is a file, as a worktree and a submodule both have', () => {
    const project = tempProject()
    writeFileSync(join(project, '.git'), 'gitdir: /somewhere/else/.git/worktrees/x\n')
    expect(writeJourney(project, journey()).ok).toBe(true)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toContain(`${KEHIKOT_DIR}/`)
  })
})
