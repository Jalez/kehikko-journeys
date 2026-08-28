import { Fragment } from 'react'

import { stateOf } from '../live/lookup.ts'
import { REF_IN_PROSE } from '../refs.ts'
import { useReading } from './reading.tsx'

/**
 * One reference, as a link where there is somewhere to link to.
 *
 * The href comes from what the last refresh READ — the tracker's own URL for
 * the thing. It is never built from the ref: constructing 'https://github.com/'
 * plus a guess at the repository would produce a link that looks right, goes
 * somewhere, and is somewhere else. With no live state there is no href, and
 * the reference is drawn as the reference it is.
 *
 * `data-ref` is not decoration and must not be dropped. It is the single index
 * both `goTo` and `showSelection` read the page through — see the essays on
 * both in `journeys.ts` — and it is on every anchor whether the reference came
 * from a step's list, from a sentence, from a blocker or from a change the
 * tracker attached to an issue.
 *
 * Monospace and a size below the prose, because a ref inside a sentence is a
 * name rather than a word: it is scanned for, not read, and it has to stay
 * findable at 220px where the sentence around it is wrapping every four words.
 */
export function Ref({ refName }: { refName: string }) {
  const { live } = useReading()
  const seen = stateOf(live, refName)
  const shared =
    'font-mono text-[0.84em] text-seen underline decoration-seen/30 underline-offset-2 hover:decoration-seen'

  if (seen?.url) {
    return (
      <a data-ref={refName} href={seen.url} target="_blank" rel="noreferrer" className={shared}>
        {refName}
      </a>
    )
  }
  return (
    <a
      data-ref={refName}
      className={`${shared} cursor-default decoration-dotted text-muted-foreground decoration-muted-foreground/50 hover:decoration-muted-foreground`}
      title={
        live
          ? `The last refresh this host did had nothing about ${refName}, so there is no address to open.`
          : `Nothing is framing this page, so this app cannot see where ${refName} lives.`
      }
    >
      {refName}
    </a>
  )
}

/**
 * Somebody's writing, with the references in it made into links.
 *
 * Split, never interpolated into markup. The body of a step is somebody's prose
 * and the title of an issue is a tracker's; neither becomes HTML on this page.
 * Every piece is a text node except the refs, which are anchors. React's own
 * escaping is what enforces that now — there is no `dangerouslySetInnerHTML`
 * anywhere in this app and there must not be one.
 */
export function Prose({ text }: { text: string }) {
  const parts = String(text ?? '').split(REF_IN_PROSE)
  return (
    <>
      {parts.map((piece, i) =>
        !piece ? null : i % 2 === 1 ? (
          <Ref key={i} refName={piece} />
        ) : (
          <Fragment key={i}>{piece}</Fragment>
        ),
      )}
    </>
  )
}
