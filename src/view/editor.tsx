import { useState } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'

import { BODY_WORDS } from '../../limits.ts'
import { saveStep } from '../journeys.ts'
import type { Step } from '../kinds.ts'

/**
 * The editor for one step.
 *
 * ## Every field starts filled in, and that is a correctness rule
 *
 * The write is of the WHOLE step. A form that saved an empty body because the
 * box started empty would delete somebody's writing in order to record a change
 * to the title, and it would do it silently. So each field is seeded from what
 * is stored, and the four pieces of state below are that seed.
 *
 * ## The word count is advice and does not gate the save
 *
 * `BODY_WORDS` is the store's own limit and the store is what enforces it — a
 * refusal comes back from `/api/step` with a sentence saying so, which is where
 * a limit belongs. Disabling the button here would be a second copy of that
 * rule in a place where it can drift from the first, and the failure mode of
 * drift is a reader who cannot save something the server would have accepted.
 *
 * ## Why the fields are not labelled on screen
 *
 * They are labelled to a screen reader, through `aria-label`, and not in ink.
 * Four visible labels in a container 220 pixels wide is four lines spent saying
 * "Title", "Body", "References", "Notes" above four boxes that already contain
 * a title, a body, references and notes. The placeholder carries the grammar
 * that is not guessable — that refs are separated by spaces and notes by commas
 * — because that is the part somebody can actually get wrong.
 */
export function Editor({ step, position }: { step: Step; position: number }) {
  const [title, setTitle] = useState(step.title ?? '')
  const [body, setBody] = useState(step.body ?? '')
  const [refs, setRefs] = useState((step.refs ?? []).join(' '))
  const [notes, setNotes] = useState((step.notes ?? []).join(', '))

  const words = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <form
      className="mt-2 grid gap-2 @min-[26rem]/container:ml-[2.1rem]"
      onSubmit={(event) => {
        event.preventDefault()
        void saveStep(position, {
          title,
          body,
          refs: refs.split(/\s+/).filter(Boolean),
          notes: notes
            .split(',')
            .map((piece) => piece.trim())
            .filter(Boolean),
        })
      }}
    >
      <Input aria-label="Step title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea aria-label="Step body" value={body} onChange={(e) => setBody(e.target.value)} />
      <Input
        aria-label="References, separated by spaces"
        placeholder="#2274 !1800 gh#41"
        value={refs}
        onChange={(e) => setRefs(e.target.value)}
      />
      <Input
        aria-label="Notes, separated by commas"
        placeholder="notes, separated by commas"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="container">
          Save
        </Button>
        <span className={words > BODY_WORDS ? 'text-xs text-draft' : 'text-xs text-muted-foreground'}>
          {words} / {BODY_WORDS} words
        </span>
      </div>
    </form>
  )
}
