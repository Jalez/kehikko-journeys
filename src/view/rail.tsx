import { cn } from '@/lib/utils.ts'

import { IN_PROD, STAGES, railOf } from '../live/lookup.ts'
import { useReading } from './reading.tsx'

/**
 * The rail: seven words in the roadmap's own order, drawn as seven dots, and a
 * position derived from ONE thing — what the last refresh read.
 *
 * The reasoning about what it can and cannot know lives with `railOf` in
 * `live/lookup.ts`, where it can be tested. What is decided here is only how it
 * looks, and two of those decisions are load-bearing:
 *
 *  - **The last dot is never filled.** Whether something is in production is
 *    read from a repository, and this app has no repository. A filled dot there
 *    would be a claim; an absent dot would hide the question. So it is dashed,
 *    on every row, always, and says why when you hover it.
 *  - **A reference with no reading gets no dots at all.** Not seven empty ones,
 *    which is a rail sitting at Todo. It gets the sentence instead, because a
 *    row of hollow dots is a position and there is no position to show.
 *
 * The word is never dropped in favour of the dots. At 220px the dots are five
 * pixels across and the word is the only part of this anybody can read.
 */
export function Rail({ refName }: { refName: string }) {
  const { live } = useReading()
  const rail = railOf(live, refName)

  if (rail.unseen) {
    return (
      <p className="mt-1.5 text-[0.72rem] leading-snug text-muted-foreground italic">
        <span className="not-italic">{rail.word}</span> — {rail.why}
      </p>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="text-[0.72rem] text-muted-foreground" title={rail.why}>
        {rail.word}
      </span>
      <span className="flex items-center gap-1" role="presentation">
        {STAGES.map((stage, i) => (
          <span
            key={stage}
            title={
              i === IN_PROD
                ? `${stage} — read from the repository, which this app has none of. It is never filled here, whatever is true.`
                : i === rail.now
                  ? `${stage} — ${rail.why}`
                  : stage
            }
            className={cn(
              'size-2 rounded-full border border-muted-foreground/70',
              i === IN_PROD && 'border-dashed bg-transparent',
              i !== IN_PROD && i < rail.now && 'bg-muted-foreground/70',
              i !== IN_PROD && i === rail.now && 'size-2.5 border-marker bg-marker',
            )}
          />
        ))}
      </span>
    </div>
  )
}
