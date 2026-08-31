import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { KEHIKOT_DIR } from 'roadmap-module-protocol'

import { type Journey, journeySchema, makeDir, dataFile, held, isSlug } from '../store.ts'

/**
 * Move the journeys out of this app's own `data/` and into the project they are
 * about.
 *
 * ## Why this is a script and not a migration on read
 *
 * Checklist's store migrates on read, and its reasoning is good: a migration
 * that has to be RUN is a migration the person who needed it never runs,
 * because they did not know it existed. It does not apply here, and the reason
 * is the whole difference between the two moves.
 *
 * That migration knew where the material was going. It re-keyed `papers.json`
 * into `checklists.json` in the same directory, and the answer to "whose is
 * this" was already in the file.
 *
 * These journeys carry no project. Fourteen files in `data/`, and not one of
 * them says which repository on this machine it belongs to — `project` is a
 * DISPLAY name when it is set at all ("Roadmap"), not a path, and a program
 * that resolved a display name to a folder would be guessing about somebody's
 * work with a plausible-looking string. There is exactly one honest way to
 * answer the question, and it is to ask. So: a person names the project, on a
 * command line, and nothing happens until they do.
 *
 *     bun dev/migrate.ts /absolute/path/to/project           # says what it would do
 *     bun dev/migrate.ts /absolute/path/to/project --apply   # does it
 *
 * ## The order, which is the part that must not be rearranged
 *
 * Write, read back, verify every field, and only then rename `data/`. Never
 * delete, and never rename first. A migration that half-happens across two
 * locations is worse than one that has not started: with `data/` still where it
 * was, a failed run costs nothing and can be looked at; with `data/` gone and
 * the destination wrong, fourteen hand-written narratives are somewhere nobody
 * can name.
 *
 * `data/` is RENAMED to `data.migrated/` rather than removed. Deleting
 * somebody's directory as the last step of a program that has just claimed
 * success is how a bug in the verification becomes permanent.
 */

/** Where this app's own journeys used to live. Read only, and only by this file. */
export function oldDataDir(): string {
  return new URL('../data/', import.meta.url).pathname
}

export interface Folded {
  journeys: Journey[]
  /** Files in `data/` that are not journeys, named rather than swallowed. */
  skipped: { file: string; why: string }[]
}

/**
 * Read every `<slug>.json` in a directory into one list.
 *
 * A file that will not parse is REPORTED rather than skipped silently. This is
 * the one moment somebody's hand-written narrative can go missing without
 * anything noticing, so the count printed at the end has to be a count of what
 * was actually read, and anything that was not read has to appear by name.
 */
export function fold(from: string): Folded {
  const journeys: Journey[] = []
  const skipped: { file: string; why: string }[] = []
  if (!existsSync(from)) return { journeys, skipped }

  for (const file of readdirSync(from).sort()) {
    if (!file.endsWith('.json')) continue
    const slug = file.replace(/\.json$/, '')
    if (!isSlug(slug)) {
      skipped.push({ file, why: 'the file name is not a journey slug' })
      continue
    }
    try {
      const parsed = journeySchema.parse(JSON.parse(readFileSync(join(from, file), 'utf8')))
      if (parsed.slug !== slug) {
        /* Kept, under the slug INSIDE the document rather than the filename.
           They agree in every file here; if they ever did not, the document is
           the thing a person wrote and the filename is the thing a program
           chose. Reported either way, because a silent rename is the kind of
           thing somebody should get to disagree with. */
        skipped.push({ file, why: `filed under "${parsed.slug}", which is the slug inside the document` })
      }
      journeys.push(parsed)
    } catch (e) {
      skipped.push({ file, why: e instanceof Error ? (e.message.split('\n')[0] ?? 'unreadable') : String(e) })
    }
  }
  return { journeys, skipped }
}

/**
 * Is what landed the same as what was sent?
 *
 * Deep equality on the parsed documents, which covers every field including the
 * four this app carries and never draws — `quizzes`, `vocabulary`, `owners`,
 * `groups`. Those are the ones worth naming: they belong to other apps, this
 * program has no opinion about their contents, and a migration that dropped
 * them would be destroying material to move material. A field-by-field
 * comparison would have to enumerate the schema and would be wrong the first
 * time somebody added to it; comparing the whole document cannot be.
 *
 * Returns the sentences, so a failure says WHICH journey and what about it.
 */
export function verify(sent: Journey[], landed: Record<string, Journey>): string[] {
  const wrong: string[] = []
  for (const journey of sent) {
    const back = landed[journey.slug]
    if (!back) {
      wrong.push(`${journey.slug} is not in the destination at all`)
      continue
    }
    const a = JSON.stringify(journeySchema.parse(journey))
    const b = JSON.stringify(journeySchema.parse(back))
    if (a !== b) wrong.push(`${journey.slug} came back different from what was written`)
  }
  const extra = Object.keys(landed).filter((slug) => !sent.some((j) => j.slug === slug))
  for (const slug of extra) wrong.push(`${slug} is in the destination and was not sent — refusing to claim it moved`)
  return wrong
}

export interface Outcome {
  ok: boolean
  said: string[]
  moved: number
}

/**
 * The migration itself.
 *
 * `apply: false` touches nothing at all — not the destination, not the
 * `.gitignore`, not `data/`. It exists so that the first thing anybody runs is
 * the thing that cannot go wrong.
 *
 * `moveAside` is what separates a MIGRATION from a COPY, and it is a parameter
 * rather than two functions because everything before it — the fold, the
 * refusal on a non-empty destination, the write, the read-back, the verify —
 * has to be the same code or it will be two verifications and one of them will
 * be the one nobody runs. `data/` is material leaving; `seed/` is tracked
 * material this repository ships and stays exactly where it is.
 */
export function migrate(from: string, project: string, apply: boolean, moveAside = true): Outcome {
  const said: string[] = []
  const { journeys, skipped } = fold(from)

  for (const row of skipped) said.push(`skipped ${row.file}: ${row.why}`)
  if (!journeys.length) {
    said.push(`nothing to move: ${from} holds no journeys.`)
    return { ok: false, said, moved: 0 }
  }

  for (const journey of journeys) {
    said.push(`${journey.slug}\t${journey.steps.length} steps\t${journey.title}`)
  }

  const destination = held(project)
  if (destination.trouble) {
    said.push(`refused: ${destination.trouble}`)
    return { ok: false, said, moved: 0 }
  }
  if (destination.nowhere) {
    said.push('refused: no project was named. Pass the absolute path of the project folder.')
    return { ok: false, said, moved: 0 }
  }

  /* Refused rather than merged. A destination that already holds journeys is
     either a migration that has already run — in which case running it again
     would overwrite whatever has been edited since — or a project that has its
     own journeys, in which case this would bury them. Neither is a thing to
     decide on somebody's behalf inside a script. */
  const already = Object.keys(destination.journeys)
  if (already.length) {
    said.push(
      `refused: ${destination.from} already holds ${already.length} journeys (${already.slice(0, 4).join(', ')}`
        + `${already.length > 4 ? ', …' : ''}). Nothing has been written. Move or merge that file by hand if this `
        + 'migration really is meant to run again.',
    )
    return { ok: false, said, moved: 0 }
  }

  if (!apply) {
    said.push(`would write ${journeys.length} journeys to ${destination.from}. Nothing written: pass --apply.`)
    return { ok: true, said, moved: 0 }
  }

  const made = makeDir(project)
  if (made.trouble || made.dir === null) {
    said.push(`refused: ${made.trouble ?? 'there is nowhere to write.'}`)
    return { ok: false, said, moved: 0 }
  }

  const { path, trouble } = dataFile(project)
  if (trouble || path === null) {
    said.push(`refused: ${trouble ?? 'there is nowhere to write.'}`)
    return { ok: false, said, moved: 0 }
  }

  const document = {
    version: 1,
    journeys: Object.fromEntries(journeys.map((j) => [j.slug, j])),
  }
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
  said.push(`wrote ${journeys.length} journeys to ${path}`)

  /* Read back through the ordinary reader rather than the object just written,
     which is the only version of this check worth running: it proves the file
     on disk parses under the schema the app itself uses, not that a variable
     still holds what was put in it. */
  const landed = held(project)
  if (landed.trouble) {
    said.push(`the destination will not read back: ${landed.trouble}`)
    said.push(`${from} is untouched. Nothing has been lost.`)
    return { ok: false, said, moved: 0 }
  }

  const wrong = verify(journeys, landed.journeys)
  if (wrong.length) {
    for (const line of wrong) said.push(line)
    said.push(`${from} is untouched. Nothing has been lost.`)
    return { ok: false, said, moved: 0 }
  }
  said.push(`read back ${Object.keys(landed.journeys).length} journeys and every field matched`)

  if (!moveAside) {
    said.push(`${from} is left where it is; it is this repository's own material, not the project's.`)
    return { ok: true, said, moved: journeys.length }
  }

  /* Only now. Renamed, never deleted: a bug in the verification above must not
     be able to make itself permanent. */
  const aside = `${from.replace(/\/+$/, '')}.migrated`
  if (existsSync(aside)) {
    said.push(`${aside} already exists, so ${from} has been left where it is. Move it aside by hand.`)
    return { ok: true, said, moved: journeys.length }
  }
  renameSync(from.replace(/\/+$/, ''), aside)
  said.push(`moved ${from} aside to ${aside} — renamed, not deleted.`)

  return { ok: true, said, moved: journeys.length }
}

/* ------------------------------------------------------------------ *
 * The command line
 * ------------------------------------------------------------------ */

/** True when this file is being RUN rather than imported by a test. */
const run = import.meta.main

if (run) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const project = args.find((a) => !a.startsWith('--'))

  if (!project) {
    console.error(
      'Usage: bun dev/migrate.ts <absolute-project-path> [--apply]\n\n'
        + 'Moves this app’s own data/ into <project>/.kehikot/journeys/journeys.json.\n'
        + 'The project is not optional and has no default: these journeys carry no\n'
        + 'project of their own, so a program that picked one would be guessing about\n'
        + `somebody's work. Without --apply nothing is written.`,
    )
    process.exit(2)
  }

  const outcome = migrate(oldDataDir(), project, apply)
  for (const line of outcome.said) console.log(line)
  console.log(
    outcome.ok
      ? apply
        ? `\nMoved ${outcome.moved} journeys into ${join(project, KEHIKOT_DIR)}.`
        : '\nNothing was written.'
      : '\nRefused. Nothing was written.',
  )
  process.exit(outcome.ok ? 0 : 1)
}
