import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'

import { BODY_WORDS } from '../../limits.ts'
import { held, hold, removeStep, saveStep, type PaperChapters } from '../journeys.ts'
import type { Step } from '../kinds.ts'
import { useReading } from './reading.tsx'

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
 * ## The part is edited here, because a step is one
 *
 * A step is one part of the epic, so what the part is called where it is
 * picked and which chapter of the paper it covers are two more fields of this
 * form — on one row, under the notes — and not a box of their own above the
 * journey. The name box is empty for a part that is called by its step's
 * title, which is what it is called until somebody says otherwise. The
 * chapter is one of the paper's own files that no other step has, or none;
 * it is not drawn for an epic with no paper.
 */
type Fields = { title: string; body: string; refs: string; notes: string; name: string; file: string }

/** What the step's part is called (when somebody named it) and the document it covers. */
export interface PartOfStep {
  id: string | null
  name: string
  file: string | null
}

const fieldsOf = (step: Step, part?: PartOfStep): Fields => ({
  title: step.title ?? '',
  body: step.body ?? '',
  refs: (step.refs ?? []).join(' '),
  notes: (step.notes ?? []).join(', '),
  name: part?.name ?? '',
  file: part?.file ?? '',
})

function read(text: string | undefined): Fields | null {
  try {
    const one = JSON.parse(text ?? '') as Partial<Fields> | null
    if (!one || typeof one !== 'object') return null
    const str = (value: unknown) => (typeof value === 'string' ? value : '')
    return { title: str(one.title), body: str(one.body), refs: str(one.refs), notes: str(one.notes), name: str(one.name), file: str(one.file) }
  } catch {
    return null
  }
}

/**
 * `target` is where the fields are held while they are typed, so a reload of the page finds
 * them (see "What is being typed" in `journeys.ts`): `step:<position>` for a step that exists,
 * `add` for one that does not yet. `part` and `chapters` are what the step's part is called, the
 * document it covers, and the documents the epic's paper offers. They come back in this form, open; what the step said when the
 * typing started is kept beside them, and when that is no longer what it says the form says so
 * rather than saving over somebody else's words in silence.
 */
export function Editor({
  step,
  position,
  target,
  part,
  existing = false,
}: {
  step: Step
  position: number
  target?: string
  part?: PartOfStep
  /** The step is already in the journey, so it can be removed. */
  existing?: boolean
}) {
  const chapters: PaperChapters | null = useReading().chapters ?? null
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
  const [file, setFile] = useState(kept?.file ?? now.file)
  const [removing, setRemoving] = useState(false)
  /* The paper's files this step may have: the ones no other step has. One it
     already has is listed even when the paper no longer pulls it in. */
  const offered = chapters?.paper ? chapters.chapters.filter((one) => one.part === null || one.part === (part?.id ?? null)) : []
  const options = file && !offered.some((one) => one.file === file) ? [{ file, heading: '', part: null }, ...offered] : offered
  /* Written as it changes: there is no moment before a reload to write it in. */
  const typing = (next: Partial<Fields>) => {
    if (!target) return
    const all = { title, body, refs, notes, name, file, ...next }
    hold(target, { base, text: JSON.stringify(all), aim: `${target === 'add' ? 'a new step' : `step ${position}`}${all.title.trim() ? ` — “${all.title.trim().slice(0, 80)}”` : ''}` })
  }
  const moved = kept !== null && started !== null && JSON.stringify(now) !== base

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
          name,
          file,
        })
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
      <div className="flex flex-wrap gap-2">
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
        {options.length > 0 && (
          <select
            aria-label="The chapter of the paper this part covers"
            data-chapter={file}
            className="h-8 min-w-[9rem] flex-1 rounded-md border bg-transparent px-2 text-[0.85rem]"
            value={file}
            onChange={(e) => {
              setFile(e.target.value)
              typing({ file: e.target.value })
            }}
          >
            <option value="">no chapter</option>
            {options.map((one) => (
              <option key={one.file} value={one.file}>
                {one.heading ? `${one.heading} — ${one.file}` : one.file}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="container">
          Save
        </Button>
        <span className={words > BODY_WORDS ? 'text-xs text-draft' : 'text-xs text-muted-foreground'}>
          {words} / {BODY_WORDS} words
        </span>
        {existing && (
          <Button
            type="button"
            variant="ghost"
            size="container"
            data-remove={removing ? 'sure' : 'ask'}
            className="ml-auto text-muted-foreground"
            onBlur={() => setRemoving(false)}
            onClick={() => (removing ? void removeStep(position - 1) : setRemoving(true))}
          >
            {removing ? 'remove this step and its part' : 'remove'}
          </Button>
        )}
      </div>
    </form>
  )
}
