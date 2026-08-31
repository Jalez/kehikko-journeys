import { join } from 'node:path'

import { KEHIKOT_DIR } from 'roadmap-module-protocol'

import { migrate } from './migrate.ts'

/**
 * Put the journeys this app SHIPS with into a project somebody names.
 *
 * ## Why this is a command and no longer something a read does
 *
 * `store.ts` used to seed an empty store from `seed/` on the first request. The
 * long version of why that had to go is in `store.ts`; the short version is
 * that "the store" is now a folder inside somebody else's repository, so an
 * automatic seed means opening the container on any project puts thirteen journeys
 * about the roadmap's own codebase inside it, writes them to disk there, and
 * makes them that project's answer forever — with nothing on screen looking
 * wrong.
 *
 * The material is still worth having, so it is still here; it just arrives by
 * somebody deciding rather than by a page being opened.
 *
 *     bun dev/seed.ts /absolute/path/to/project           # says what it would do
 *     bun dev/seed.ts /absolute/path/to/project --apply   # does it
 *
 * It is `migrate` with a different source directory, deliberately: the same
 * refusal on a destination that already holds journeys, the same write, the same
 * read-back-and-verify before anything is claimed. Two code paths that both put
 * journeys into a project would be two chances to get the verification wrong,
 * and one of them would be the one nobody ran.
 *
 * The one difference is the last argument: `seed/` is not moved aside
 * afterwards. It is tracked material this repository ships, it belongs to the
 * program rather than to the project it was just copied into, and
 * `seed.migrated/` would be a tracked directory renamed out from under version
 * control.
 */

/** Where the journeys this app ships with live. Tracked; never written to. */
export function seedDir(): string {
  return new URL('../seed/', import.meta.url).pathname
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const project = args.find((a) => !a.startsWith('--'))

  if (!project) {
    console.error(
      'Usage: bun dev/seed.ts <absolute-project-path> [--apply]\n\n'
        + 'Copies the journeys this app ships with in seed/ into\n'
        + '<project>/.kehikot/journeys/journeys.json. Nothing seeds itself: these are the\n'
        + "roadmap's own journeys, and putting them into a project automatically would\n"
        + 'fill somebody else’s repository with narratives about a different codebase.\n'
        + 'Without --apply nothing is written.',
    )
    process.exit(2)
  }

  const outcome = migrate(seedDir(), project, apply, false)
  for (const line of outcome.said) console.log(line)
  console.log(
    outcome.ok
      ? apply
        ? `\nSeeded ${outcome.moved} journeys into ${join(project, KEHIKOT_DIR)}. seed/ is untouched.`
        : '\nNothing was written.'
      : '\nRefused. Nothing was written.',
  )
  process.exit(outcome.ok ? 0 : 1)
}
