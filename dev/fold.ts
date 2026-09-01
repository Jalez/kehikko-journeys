import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dataFile, held, isSlug, journeySchema, makeDir, type Journey } from '../store.ts'

/**
 * Fold a project's one-file-per-journey folder into the one file this app reads.
 *
 * ## The failure this repairs
 *
 * Every journey on this machine was invisible. The projects held their
 * narratives as `<slug>.json`, one file each, in `.kehikot/journeys/`; this app
 * reads exactly one file, `.kehikot/journeys/journeys.json`, and that file
 * existed nowhere. So `/api/journeys` answered `journeys: []` for every project,
 * truthfully and uselessly, and the container drew its empty screen — the one
 * that says "Nothing is hidden and nothing is elsewhere — this project
 * genuinely has none yet" over a folder holding eight of them.
 *
 * That sentence is the reason this is worth a script rather than a shrug. A
 * program that says "none" when it means "none HERE, in the shape I read" has
 * told somebody the opposite of the truth, and they have no way to find out
 * from the screen.
 *
 * ## Why the folder is not simply read
 *
 * Because two readers of the same data is how the two disagree later. `held()`
 * parses one document with one schema; teaching it a second layout would mean
 * every write deciding which shape to write back into, and a project that ended
 * up with both would have a journey that changed depending on which reader saw
 * it last. One shape, one reader, and a migration to get there.
 *
 * ## The order, taken from `migrate.ts` and for its reason
 *
 * Write, read back through the app's own reader, verify every slug arrived, and
 * only THEN rename the sources. Never delete, and never rename first. A
 * migration that half-happens across two locations is worse than one that has
 * not started: with the per-slug files still in place a failed run costs
 * nothing, and with them gone a hand-written narrative is somewhere nobody can
 * name.
 *
 *     bun dev/fold.ts /absolute/path/to/project           # says what it would do
 *     bun dev/fold.ts /absolute/path/to/project --apply   # does it
 */

export interface Gathered {
  journeys: Record<string, Journey>
  /** Files that are not journeys, named rather than swallowed. */
  skipped: { file: string; why: string }[]
  /** The files that were folded, so they can be renamed once the write is verified. */
  sources: string[]
}

/**
 * Every per-slug journey in a project's own journeys folder.
 *
 * `journeys.json` itself is skipped rather than parsed: it is the destination,
 * and folding it into itself would be this script's own output arriving as
 * input on a second run.
 *
 * A file that does not parse is NAMED and skipped, never swallowed. The whole
 * point of this script is that data was invisible; a run that quietly dropped
 * one more file would be repeating the fault it exists to fix.
 */
export function gather(dir: string): Gathered {
  const out: Gathered = { journeys: {}, skipped: [], sources: [] }
  let entries: string[] = []
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return out
  }

  for (const file of entries) {
    if (!file.endsWith('.json') || file === 'journeys.json') continue
    const slug = file.slice(0, -'.json'.length)
    const at = join(dir, file)
    if (!isSlug(slug)) {
      out.skipped.push({ file, why: 'the file name is not a journey slug' })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(at, 'utf8'))
    } catch (e) {
      out.skipped.push({ file, why: `it is not JSON (${(e as Error).message.split('\n')[0]})` })
      continue
    }
    const checked = journeySchema.safeParse(parsed)
    if (!checked.success) {
      out.skipped.push({ file, why: `it is not a journey (${checked.error.issues[0]?.message ?? 'unknown'})` })
      continue
    }
    /* Keyed by the SLUG INSIDE the document and not by the file name when they
       disagree, with the disagreement reported. The document is what every
       other part of this app reads a slug from. */
    const key = checked.data.slug
    if (key !== slug) out.skipped.push({ file, why: `its slug is "${key}", so it is folded under that` })
    out.journeys[key] = checked.data
    out.sources.push(at)
  }
  return out
}

function main(): void {
  const [project, flag] = process.argv.slice(2)
  if (!project) {
    console.error('name the project: bun dev/fold.ts /absolute/path/to/project [--apply]')
    process.exit(2)
  }
  const apply = flag === '--apply'

  const { path, trouble } = dataFile(project)
  if (trouble || path === null) {
    console.error(trouble ?? 'that is not a project this app will write under')
    process.exit(1)
  }
  const dir = path.slice(0, path.lastIndexOf('/'))

  const found = gather(dir)
  const slugs = Object.keys(found.journeys).sort()
  for (const { file, why } of found.skipped) console.log(`skipped ${file}: ${why}`)
  if (slugs.length === 0) {
    console.log(`nothing to fold in ${dir}`)
    return
  }
  console.log(`${slugs.length} journey(s) to fold into ${path}:`)
  for (const slug of slugs) console.log(`  ${slug} — ${found.journeys[slug]?.title ?? '(no title)'}`)

  /* Refused rather than merged. A destination that already exists is a project
     that has been folded, or one somebody has written by hand, and merging into
     it would be this script deciding whose version of a journey wins. */
  if (existsSync(path)) {
    console.error(`\n${path} already exists. Nothing was written.`)
    process.exit(1)
  }

  if (!apply) {
    console.log('\nnothing written. Run again with --apply.')
    return
  }

  const made = makeDir(project)
  if (made.trouble) {
    console.error(made.trouble)
    process.exit(1)
  }
  writeFileSync(path, `${JSON.stringify({ journeys: found.journeys }, null, 2)}\n`, 'utf8')

  /* Read back through the app's OWN reader, not by parsing what we just wrote.
     A verification that used a different code path would prove the file is
     valid JSON and nothing about whether this app can see it, which is the
     entire failure being repaired. */
  const back = held(project)
  const missing = slugs.filter((slug) => !(slug in back.journeys))
  if (back.trouble || missing.length > 0) {
    console.error(`\nwritten, but not readable back: ${back.trouble ?? `missing ${missing.join(', ')}`}`)
    console.error('the per-slug files have NOT been renamed. Look at the file before running again.')
    process.exit(1)
  }

  for (const source of found.sources) renameSync(source, `${source}.folded`)
  console.log(`\nwrote ${path} and read back ${slugs.length}. Sources renamed to *.json.folded.`)
}

if (import.meta.main) main()
