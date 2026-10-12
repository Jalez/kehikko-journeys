import { held, journeyIn, writeJourney } from '../store.ts'

/**
 * Say what storing each journey of a project as one step to a part would do
 * — and, with `--apply`, do it.
 *
 *     bun dev/parts.ts /absolute/path/to/project            # says, writes nothing
 *     bun dev/parts.ts /absolute/path/to/project --apply    # stores them
 *
 * It is the store's own reading (`simplified`, through `held`) and the
 * store's own write, so what this prints is what the page shows and what the
 * first save through either door would do. Nothing here decides anything.
 * The record of each journey as it was is kept beside the file by that write;
 * see `BEFORE` in `store.ts`.
 */
export function report(project: string, apply: boolean): { said: string[]; ok: boolean } {
  const said: string[] = []
  const store = held(project)
  if (store.nowhere || store.trouble) return { said: [store.trouble ?? 'no project was named.'], ok: false }
  const slugs = Object.keys(store.journeys).sort()
  for (const slug of slugs) {
    const decided = store.unsettled[slug]
    const journey = journeyIn(store, slug)
    if (!journey) continue
    if (!decided) {
      said.push(`${slug}\talready one step to a part (${journey.steps.length} steps)`)
      continue
    }
    said.push(`${slug}\t${journey.steps.length} steps, each a part${decided.gone.length ? `; ${decided.gone.length} headings set aside` : ''}`)
    for (const fate of decided.fates) {
      said.push(
        `  ${fate.was}\t“${fate.heading}”\tsteps ${fate.steps.join(',') || '—'}\tfiles ${fate.files.join(',') || '—'}`
          + `\t→ ${fate.now === null ? 'not a part (kept under headings)' : `step ${fate.at} · id ${fate.now} · ${fate.how} · ${fate.file ?? 'no file'}`}`,
      )
    }
    for (const finding of decided.findings) said.push(`  ! ${finding.said}`)
    if (apply) {
      const written = writeJourney(project, journey)
      said.push(written.ok ? `  stored. As it was: ${written.settled?.before ?? '(nothing to keep)'}` : `  NOT stored: ${written.error}`)
      if (!written.ok) return { said, ok: false }
    }
  }
  if (!apply && Object.keys(store.unsettled).length) said.push('Nothing written: pass --apply.')
  return { said, ok: true }
}

if (import.meta.main) {
  const [project, flag] = process.argv.slice(2)
  if (!project) {
    console.error('usage: bun dev/parts.ts /absolute/path/to/project [--apply]')
    process.exit(2)
  }
  const out = report(project, flag === '--apply')
  console.log(out.said.join('\n'))
  process.exit(out.ok ? 0 : 1)
}
