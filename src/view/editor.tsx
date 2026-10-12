import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'

import { BODY_WORDS } from '../../limits.ts'
import { held, hold, moveStep, removeStep, saveStep } from '../journeys.ts'
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
 *
 * ## The part's name is edited here, and nothing else about the part
 *
 * A step is the step of one part of the epic, so what the part is called
 * where it is picked is one more field of this form, on one row under the
 * notes. Saved, a changed name is the host's to take (`parts.set`); for a
 * host from before that it goes into this app's record, as it always did,
 * and an empty box is a part called by its step's title.
 *
 * That row is also where the two things a step can be in relation to a part
 * are offered, each as one quiet control and neither with a sentence:
 *
 *  - a step in NO part (its part was removed in the host's picker) has "make
 *    it a part" beside the name — Save, and ask the host for a part called
 *    that;
 *  - a step that is there can be moved one place up or down, at the end of
 *    the row with Save.
 *
 * What a part's chapter is, is not a field here: it is kept by the module
 * that keeps the paper.
 */
type Fields = { title: string; body: string; refs: string; notes: string; name: string }

/** A step's part, as the editor needs it. */
export interface PartOfStep {
  id: string | null
  /** What the part is called, or empty for a part called by its step's title. */
  name: string
  /**
   * False for a step in no part where the host keeps the epic's list: the
   * step's `part` is absent, or names a part the list no longer has. Always
   * true while this app keeps the list.
   */
  listed: boolean
}

const fieldsOf = (step: Step, part?: PartOfStep): Fields => ({
  title: step.title ?? '',
  body: step.body ?? '',
  refs: (step.refs ?? []).join(' '),
  notes: (step.notes ?? []).join(', '),
  name: part?.name ?? '',
})

function read(text: string | undefined): Fields | null {
  try {
    const one = JSON.parse(text ?? '') as Partial<Fields> | null
    if (!one || typeof one !== 'object') return null
    const str = (value: unknown) => (typeof value === 'string' ? value : '')
    return { title: str(one.title), body: str(one.body), refs: str(one.refs), notes: str(one.notes), name: str(one.name) }
  } catch {
    return null
  }
}

/**
 * `target` is where the fields are held while they are typed, so a reload of the page finds
 * them (see "What is being typed" in `journeys.ts`): `step@<id>` for a step that exists,
 * `add` for one that does not yet. `part` is the step's part; `forPart` is the id of a part that
 * has no step, for which a new step is being written. They come back in this form, open; what the step said when the
 * typing started is kept beside them, and when that is no longer what it says the form says so
 * rather than saving over somebody else's words in silence.
 */
export function Editor({
  step,
  position,
  target,
  part,
  existing = false,
  forPart = null,
  of,
}: {
  step: Step
  position: number
  target?: string
  part?: PartOfStep
  /** The step is already in the journey, so it can be removed. */
  existing?: boolean
  /** A new step for a part the host lists and that has none: saved, it is filed under this id. */
  forPart?: string | null
  /** How many steps the journey has, for the two presses that move this one. */
  of?: number
}) {
  const now = fieldsOf(step, part)
  const was = useRef(target ? held(target) : null).current
  const kept = read(was?.text)
  const base = useRef(was?.base ?? JSON.stringify(now)).current
  const started = read(base)
  const [title, setTitle] = useState(kept?.title ?? now.title)
  const [body, setBody] = useState(kept?.body ?? now.body)
  const [refs, setRefs] = useState(kept?.refs ?? now.refs)
  const [notes, setNotes] = useState(kept?.notes ?? now.notes)
  const [name, setName] = useState(kept?.name ?? now.name)
  const [removing, setRemoving] = useState(false)
  /* A step in no part, where the host keeps the list: it can be made one. */
  const loose = existing && part !== undefined && !part.listed
  /* Written as it changes: there is no moment before a reload to write it in. */
  const typing = (next: Partial<Fields>) => {
    if (!target) return
    const all = { title, body, refs, notes, name, ...next }
    hold(target, { base, text: JSON.stringify(all), aim: `${target.startsWith('add') ? 'a new step' : `step ${position}`}${all.title.trim() ? ` — “${all.title.trim().slice(0, 80)}”` : ''}` })
  }
  /* Compared as fields, not as the string that was held: a draft held by a page from before this
     form lost a field must not read as "the step was changed". */
  const moved = kept !== null && started !== null && JSON.stringify(now) !== JSON.stringify(started)

  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  /* The whole step, as the store takes it. */
  const fields = () => ({
    title,
    body,
    refs: refs.split(/\s+/).filter(Boolean),
    notes: notes
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
    name,
  })

  return (
    <form
      className="mt-2 grid gap-2 @min-[26rem]/container:ml-[2.1rem]"
      onSubmit={(event) => {
        event.preventDefault()
        void saveStep(position, fields(), { part: forPart ?? null })
      }}
    >
      {moved && (
        <p data-held-stale className="rounded border border-dashed px-2 py-1 text-[0.82rem] leading-6 text-muted-foreground">
          This step was changed after these words were typed. It now reads “{now.title || 'untitled'}” — saving replaces what is there now.
        </p>
      )}
      <Input
        aria-label="Step title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          typing({ title: e.target.value })
        }}
      />
      <Textarea
        aria-label="Step body"
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          typing({ body: e.target.value })
        }}
      />
      <Input
        aria-label="References, separated by spaces"
        placeholder="#2274 !1800 gh#41"
        value={refs}
        onChange={(e) => {
          setRefs(e.target.value)
          typing({ refs: e.target.value })
        }}
      />
      <Input
        aria-label="Notes, separated by commas"
        placeholder="notes, separated by commas"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
          typing({ notes: e.target.value })
        }}
      />
      {/* Not drawn for the step of a part that is already there and has its name: the name is the part's. */}
      {!forPart && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="What this part is called where parts are picked"
            placeholder="short name — the title, if empty"
            className="min-w-[9rem] flex-1"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              typing({ name: e.target.value })
            }}
          />
          {loose && (
            <Button
              type="button"
              variant="outline"
              size="container"
              data-make="part"
              title="This step is in no part of the epic. Saves it, and asks the host to add a part for it, called what the box beside this says — or by the step’s title."
              onClick={() => void saveStep(position, fields(), { make: true })}
            >
              make it a part
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="container">
          Save
        </Button>
        <span className={words > BODY_WORDS ? 'text-xs text-draft' : 'text-xs text-muted-foreground'}>
          {words} / {BODY_WORDS} words
        </span>
        {existing && of !== undefined && of > 1 && (
          <span className="ml-auto flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="container"
              data-move="up"
              aria-label={`Move step ${position} up`}
              title="Move this step one place up"
              className="text-muted-foreground"
              disabled={position <= 1}
              onClick={() => void moveStep(position - 1, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="container"
              data-move="down"
              aria-label={`Move step ${position} down`}
              title="Move this step one place down"
              className="text-muted-foreground"
              disabled={position >= of}
              onClick={() => void moveStep(position - 1, 1)}
            >
              ↓
            </Button>
          </span>
        )}
        {existing && (
          <Button
            type="button"
            variant="ghost"
            size="container"
            data-remove={removing ? 'sure' : 'ask'}
            className={of !== undefined && of > 1 ? 'text-muted-foreground' : 'ml-auto text-muted-foreground'}
            onBlur={() => setRemoving(false)}
            onClick={() => (removing ? void removeStep(position - 1) : setRemoving(true))}
          >
            {removing ? (part && !part.listed ? 'remove this step' : 'remove this step and its part') : 'remove'}
          </Button>
        )}
      </div>
    </form>
  )
}
