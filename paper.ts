import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PAPER_MODULE, moduleDir, partFile, within, type JourneyPart } from 'kehikot-module-protocol'

import { MAIN, chaptersOf, type Chapters, type ReadFile } from './chapters.ts'
import { isSlug, projectOf } from './store.ts'

/**
 * The one place this app opens a file that is not its own: the `.tex` files of
 * an epic's paper.
 *
 * ## Why this app reads another module's folder at all
 *
 * `parts.ts` used to say this app "cannot read the paper", and held to it: a
 * part's files were typed, and whether a typed name was a file was the Paper
 * module's to say, later, on its own page. That was a principle paid for by
 * the person, who typed seven paths the disk already knew.
 *
 * What is read here is not the Paper module's STATE. Its build, its page map,
 * its suggestions, whatever it keeps beside the paper — none of that is
 * opened, and nothing here knows what any of it is called. What is read is
 * the person's document: `main.tex` and the `.tex` files it pulls in, which
 * are theirs, are in their repository, and are read by their TeX engine
 * without asking anybody. Where they are is not this app's guess either: the
 * protocol names the folder (`PAPER_MODULE`, beside `paperFileOf`), because a
 * part's file is already defined as a path relative to it.
 *
 * READ, and never written. There is no function in this file that could
 * write, and the only door that reaches it is a GET.
 *
 * ## The fence
 *
 * A name comes out of a `.tex` file, which is text anybody can write:
 * `\input{../../../.ssh/config}` is one line. Three checks, each of which
 * alone has been wrong somewhere in this workspace before:
 *
 *  - the NAME is the protocol's `partFile` form, which has no `..`, no empty
 *    segment and is not absolute — so the string cannot say "outside";
 *  - the paper's folder is resolved (`realpathSync`) and must be inside the
 *    project, so a `.kehikot/paper/<epic>` that is a link to somewhere else is
 *    not followed. The Paper module does follow one, for a thesis kept
 *    outside the project, and this is deliberately narrower: an epic with
 *    such a paper is offered no chapters here and its files are typed, as
 *    they were;
 *  - each FILE is resolved too and must be inside the resolved folder, so a
 *    link inside the paper pointing out of it reads as not there.
 *
 * A refusal is always null — "not there", with no difference between outside,
 * missing, too large and unreadable — for the reason the Paper module's
 * `confine` gives: three refusals are a way to probe for files.
 */

/** A `.tex` file larger than this is not read. The Paper module's bound, for the same paper. */
const MAX_TEX_BYTES = 4_000_000

/**
 * The folder an epic's paper is in, resolved — or null when there is none
 * this app will read: no project, no such folder, or one that leaves the
 * project.
 */
export function paperFolder(projectPath: string | null | undefined, slug: string): string | null {
  if (!isSlug(slug)) return null
  const root = projectOf(projectPath)
  if (root === null) return null
  const papers = moduleDir(root, PAPER_MODULE)
  if (papers === null) return null
  try {
    const real = realpathSync(join(papers, slug))
    if (!statSync(real).isDirectory()) return null
    return within(root, real) ? real : null
  } catch {
    return null
  }
}

/** Reads one file of the paper by its name from the paper's folder, behind the fence above. */
export function paperReader(projectPath: string | null | undefined, slug: string): ReadFile | null {
  const folder = paperFolder(projectPath, slug)
  if (folder === null) return null
  return (file) => {
    if (partFile(file) !== file) return null
    try {
      const real = realpathSync(join(folder, file))
      if (real === folder || !within(folder, real)) return null
      const found = statSync(real)
      if (!found.isFile() || found.size > MAX_TEX_BYTES) return null
      return readFileSync(real, 'utf8')
    } catch {
      return null
    }
  }
}

/**
 * What the epic's paper says about parts, given the parts the journey already
 * has — or null when this epic has no paper here (no folder, or no
 * `main.tex` in it).
 */
export function chaptersIn(
  projectPath: string | null | undefined,
  slug: string,
  existing: readonly JourneyPart[] = [],
): Chapters | null {
  const read = paperReader(projectPath, slug)
  return read === null ? null : chaptersOf(read, existing)
}

export { MAIN }
