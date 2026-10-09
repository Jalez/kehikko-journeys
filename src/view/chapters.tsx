import { useState } from 'react'

import { Button } from '@/components/ui/button.tsx'

import { makeChapterParts, type PaperChapters } from '../journeys.ts'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * "Make a part for each chapter file": the list of what that would make, and
 * the press that makes it.
 *
 * ## It is a list first, and it has made nothing
 *
 * The same two steps as "by references…" on a part's row, for the same
 * reason: this reads somebody's document and guesses what its parts are. One
 * part for each file `main.tex` pulls in, called what the file's first
 * `\chapter` or `\section` calls it. That is right for a thesis with a file
 * to a chapter and can be wrong in ways only the author knows — an appendix
 * that is not a part of the work, a file of front matter pulled in after
 * `\begin{document}`. So every row is shown with the heading it would get
 * and the files it would own, each row can be left out, and the sentence
 * above the list says nothing has been made. The second press says the
 * count again.
 *
 * ## What was left out is said under the list
 *
 * A file some part already owns, a file the preamble pulls in, a file the
 * paper names and the disk does not have: each is a reason a person would
 * otherwise have to work out from a list that is shorter than their paper.
 * The sentences are the server's (`leftOutSaid`), which the MCP door prints
 * too.
 *
 * ## The same component, with or without a journey
 *
 * It is drawn in the parts box, and — for an epic this project keeps no
 * journey for — under the press that begins one. There `beginning` is set,
 * the confirming press says that it begins the journey as well, and
 * `makeChapterParts` does both: see the note on it in `journeys.ts`. The
 * list is identical either way, because the paper is.
 */
export function ChapterOffer({
  chapters,
  beginning = false,
  busy,
  onLeave,
}: {
  /** What the paper says. Only drawn for an epic that has one. */
  chapters: PaperChapters & { paper: true }
  /** No journey exists yet: the press begins it first. */
  beginning?: boolean
  busy: boolean
  onLeave: () => void
}) {
  /* The rows left OUT, by file. Kept as what is unticked rather than what is
     ticked, so a paper that gains a chapter while this is open gains a ticked
     row and not a silently skipped one. */
  const [left, setLeft] = useState<readonly string[]>([])
  const chosen = chapters.parts.filter((part) => !left.includes(part.file))

  return (
    <div data-chapters={chapters.parts.length} className="grid gap-1.5 rounded border border-dashed px-2 py-1.5">
      {chapters.nothing ? (
        <p className="text-muted-foreground">{chapters.nothing}</p>
      ) : (
        <>
          <p>
            <code className="font-mono text-xs">main.tex</code> of this epic’s paper pulls in{' '}
            {plural(chapters.parts.length, 'chapter file')} that no part owns. {chapters.parts.length === 1 ? 'It' : 'Each'}{' '}
            would become a part, called what the file’s first chapter or section heading calls it, and owning that
            file. <b>Nothing has been made.</b>
          </p>
          <ul className="grid gap-1">
            {chapters.parts.map((part) => (
              <li key={part.file} data-chapter={part.file}>
                <label className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={!left.includes(part.file)}
                    onChange={() =>
                      setLeft(left.includes(part.file) ? left.filter((one) => one !== part.file) : [...left, part.file])
                    }
                    aria-label={`Make the part ${part.heading}`}
                    className="size-3.5 shrink-0 translate-y-0.5 accent-primary"
                  />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-medium">{part.heading}</span>{' '}
                    <code className="font-mono text-xs text-muted-foreground">{part.file}</code>
                    {part.files.length > 1 && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        and the {plural(part.files.length - 1, 'file')} it pulls in (
                        <code className="font-mono">{part.files.slice(1).join(', ')}</code>)
                      </span>
                    )}
                    {!part.titled && (
                      <span className="text-xs text-muted-foreground italic">
                        {' '}
                        — named after the file, which has no chapter or section heading
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {chapters.leftOut.map((said) => (
        <p key={said} data-left-out className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {said}
        </p>
      ))}
      {beginning && !chapters.nothing && (
        <p className="text-xs text-muted-foreground">
          This project keeps no journey for this epic yet, and parts are kept in one. So the press below begins it
          first — copying what the host holds for the epic, as “begin the journey” does — and then makes the parts.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {!chapters.nothing && (
          <Button
            type="button"
            size="container"
            data-make="chapters"
            disabled={busy || chosen.length === 0}
            onClick={() => void makeChapterParts(chosen.map((part) => part.file))}
          >
            {busy
              ? 'making…'
              : `${beginning ? 'begin the journey and make' : 'make'} ${
                  chosen.length === 1 ? 'this 1 part' : `these ${chosen.length} parts`
                }`}
          </Button>
        )}
        <Button type="button" variant="ghost" size="container" disabled={busy} onClick={onLeave}>
          {chapters.nothing ? 'close' : 'leave it'}
        </Button>
      </div>
    </div>
  )
}
