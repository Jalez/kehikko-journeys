import { LIMITS, partIdsOf, partsOf, stepPart, type JourneyPart } from 'kehikot-module-protocol'

/**
 * Arranging a journey into parts: which step is in which, and the parts
 * themselves.
 *
 * ## Why this is a file of its own, with nothing in it but arithmetic
 *
 * Everything here takes a record and answers with a record, or with a sentence
 * for why not. No file is read and nothing is written, so both halves of this
 * app can load it: `doors.ts` to decide what a write may say, and the page to
 * show what a press WOULD do before it is pressed. Those have to be one
 * function. A page that counted "this would unassign four steps" with its own
 * rule and a store that then unassigned five is a confirmation that lied, and
 * the person agreed to something else.
 *
 * It is beside `limits.ts` rather than inside `store.ts` for the reason that
 * file gives: the store reads directories and a browser cannot import it.
 *
 * ## What a part is, and who says which group gets which id
 *
 * A part is a group — a heading and the references under it — and a step is in
 * a part because it carries `part: <id>` and for no other reason. Which group
 * has which id is the protocol's to say (`partIdsOf`): a written `id`, else the
 * heading as a slug, else `part-<n>`. Nothing here restates that rule. This
 * file asks it, and it asks it again after every change it makes, because the
 * second and third of those answers MOVE when somebody rewords a heading or
 * takes a group out of the middle — and an id that moves leaves every step
 * that named it in no part at all, and every stored focus that named it
 * pointing at nothing.
 *
 * So there is one discipline, `holding`, and every function below ends in it:
 * **no group that is still there may come out of a change called anything
 * other than what it was called going in.** Where the derivation would have
 * renamed one, the name it had is written onto it as `id`. A written id is the
 * one answer `partIdsOf` does not derive, so from then on that group keeps its
 * name through any rewording.
 */

/** As much of a step as this file reads. Anything else on it is carried. */
export interface PartStep {
  title?: string
  refs?: string[]
  part?: string
}

/** As much of a group as this file reads. Anything else on it is carried. */
export interface PartGroup {
  heading?: string
  refs?: string[]
  id?: string
}

/** A record's two lists, which is all of it that arranging touches. */
export interface Arrangeable<S extends PartStep = PartStep, G extends PartGroup = PartGroup> {
  steps: S[]
  groups: G[]
}

export type Refused = { ok: false; error: string }

/** The parts of a record, with their ids: the protocol's, and not a second reading. */
export function partsIn(record: unknown): JourneyPart[] {
  return partsOf(record)
}

/**
 * The part a step is in, or null: it says none, or it names one this journey
 * does not have. Both are "in no part" to a focus, and both are offered for
 * assigning; see `focus.ts` for why a step with no part is outside every focus.
 */
export function partOfStep(record: Arrangeable, step: PartStep): string | null {
  const said = stepPart(step)
  return said !== null && partsOf(record).some((part) => part.id === said) ? said : null
}

/** Zero-based positions of the steps that are in no part of this journey. */
export function unassigned(record: Arrangeable): number[] {
  const has = new Set(partsOf(record).map((part) => part.id))
  const out: number[] = []
  record.steps.forEach((step, index) => {
    const said = stepPart(step)
    if (said === null || !has.has(said)) out.push(index)
  })
  return out
}

/**
 * Why `id` is not a part of this journey, as a sentence that lists the ones
 * that are; null when it is one.
 *
 * The list is the point. "No such part" leaves an agent guessing at a slug of
 * a heading it has only seen in prose, and the id of a group whose heading
 * was reworded after a step was assigned to it is not guessable at all.
 */
export function notAPart(record: Arrangeable, id: string): string | null {
  const parts = partsOf(record)
  if (parts.some((part) => part.id === id)) return null
  if (!parts.length) {
    return (
      `"${shortened(id)}" is not a part of this journey, which is not divided into parts at all: it has no groups. `
      + 'Make one first (`set_part` with a heading), then assign steps to the id it answers with.'
    )
  }
  return (
    `"${shortened(id)}" is not a part of this journey. Its parts are: `
    + `${parts.map((part) => `${part.id} (“${part.heading}”)`).join(', ')}. Pass one of those ids, or an empty `
    + '`part` to take the step out of every part.'
  )
}

function shortened(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/**
 * The groups, with every one of them called what `named` says it was called.
 *
 * `named[i]` is the id group `i` had before whatever has just been done to the
 * list. Walked in order and asked again at each step, because an id depends on
 * the groups before it and on nothing after: once group `i` answers to its old
 * name, nothing done to a later group can take that away. A group whose name
 * did not move is not touched — writing `id` onto every group of a journey
 * because one step was filed would be this app editing lines of somebody's
 * document nobody asked it to.
 */
export function holding<G extends PartGroup>(groups: G[], named: readonly (string | null)[]): G[] {
  let out = groups
  for (let i = 0; i < out.length; i += 1) {
    const was = named[i]
    if (was === null || was === undefined) continue
    if (partIdsOf(out)[i] === was) continue
    out = out.map((group, at) => (at === i ? { ...group, id: was } : group))
  }
  return out
}

/**
 * The groups, with `id` written onto the one that answers to it.
 *
 * This is what makes an assignment survive a rewording. A step filed under
 * `the-agent-seam` names a group that is only CALLED that because its heading
 * says "The agent seam"; reword the heading and the group answers to another
 * name, the step names nothing, and it drops out of the part it was put in
 * with no write to the step at all. So the moment a step is filed under a
 * group, the name is written down on the group.
 *
 * It changes nothing a reader sees: the id written is exactly the one the
 * group already answered to, so `partsOf` says the same before and after —
 * same ids, same headings, same references. `test/parts.test.ts` holds it to
 * that, including for a journey with two groups under one heading.
 */
export function pinned<G extends PartGroup>(groups: G[], id: string): G[] {
  const named = partIdsOf(groups)
  const at = named.indexOf(id)
  if (at < 0) return groups
  const group = groups[at] as G
  if (group.id === id) return groups
  return holding(
    groups.map((one, i) => (i === at ? { ...one, id } : one)),
    named,
  )
}

export type Assigned<R> =
  | {
      ok: true
      record: R
      /** One-based positions whose part this changed. */
      moved: number[]
      /** One-based positions that already said exactly this. */
      already: number[]
      /** The part's heading, or null when the steps were taken out of every part. */
      heading: string | null
    }
  | Refused

/**
 * Put steps in a part, or — `part` null — take them out of every part.
 *
 * `positions` are one-based, as every door of this app counts steps. One that
 * is not a step refuses the whole call and nothing is changed: half an
 * assignment, reported as an error, leaves somebody working out which half.
 *
 * Nothing but `part` is touched on a step, which is the reason this is not
 * `set_step` called in a loop: that door writes a step whole, so an agent
 * filing thirty-eight steps through it would have to say every title, body
 * and reference again, and would be taken to have unsaid whatever it left out.
 */
export function assign<R extends Arrangeable>(record: R, positions: readonly number[], part: string | null): Assigned<R> {
  if (part !== null) {
    const refusal = notAPart(record, part)
    if (refusal) return { ok: false, error: refusal }
  }
  const wanted = [...new Set(positions)]
  if (!wanted.length) return { ok: false, error: 'which steps? Pass the 1-based positions of the steps to file.' }
  const missing = wanted.filter((at) => !Number.isInteger(at) || at < 1 || at > record.steps.length)
  if (missing.length) {
    return {
      ok: false,
      error:
        `this journey has ${record.steps.length} stored ${record.steps.length === 1 ? 'step' : 'steps'}, and `
        + `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not among them. Nothing was changed.`,
    }
  }

  const moved: number[] = []
  const already: number[] = []
  const steps = record.steps.map((step, index) => {
    if (!wanted.includes(index + 1)) return step
    const said = typeof step.part === 'string' ? step.part : null
    if (said === part) {
      already.push(index + 1)
      return step
    }
    moved.push(index + 1)
    if (part === null) {
      const { part: _gone, ...rest } = step
      return rest as typeof step
    }
    return { ...step, part }
  })
  const heading = part === null ? null : (partsOf(record).find((one) => one.id === part)?.heading ?? part)
  /* Pinned even when every step already said this part: the steps were filed
     by hand, the group was never told, and this is the first chance to. */
  const groups = part === null ? record.groups : pinned(record.groups, part)
  return { ok: true, record: { ...record, steps, groups }, moved, already, heading }
}

/**
 * The unassigned steps whose references are ALL among a part's, as zero-based
 * positions — a proposal, and never an assignment.
 *
 * ## Why this is offered, and why it never runs by itself
 *
 * `focus.ts` refuses to file a step by the references it names, and that
 * refusal stands: a step often names a reference it merely depends on, and a
 * rule that filed it under that reference's heading would move steps between
 * parts whenever somebody edited a sentence. But a journey somebody has just
 * divided into parts has every step in none, and for most of them the answer
 * a person would give IS the one the references give. So the references are
 * allowed to SUGGEST, once, to somebody who is shown the list and presses
 * again — after which each step says its part in its own words and the
 * references are never consulted about it again.
 *
 * ## What counts
 *
 * A step that is in no part, that names at least one reference, every one of
 * which the part holds. "Holds" is the protocol's answer (`partsOf`): the
 * group's own references and those of the steps already in it. A step with no
 * references is never proposed — "all of none" is true of every part at once,
 * and a suggestion that fits everywhere is not one. A step already in a part
 * is never proposed either: somebody put it there.
 */
export function proposed(record: Arrangeable, part: string): number[] {
  const one = partsOf(record).find((candidate) => candidate.id === part)
  if (!one) return []
  const held = new Set(one.refs)
  return unassigned(record).filter((index) => {
    const refs = (record.steps[index]?.refs ?? []).map((ref) => ref.trim()).filter(Boolean)
    return refs.length > 0 && refs.every((ref) => held.has(ref))
  })
}

export type Parted<R> =
  | { ok: true; record: R; id: string; heading: string; created: boolean; was: string | null }
  | Refused

/**
 * Make a part, or change one: its heading, and its references when they are
 * given.
 *
 * With no `id`, a group is added at the end with this heading, and the id it
 * answers to is WRITTEN on it from the start, so that the first rewording does
 * not rename it. With an `id`, that group's heading is replaced — and the id
 * it answered to is written on it first, for the same reason and one more: a
 * host keeps the parts a person picked BY ID, so a rename that moved the id
 * would silently drop the part out of somebody's focus.
 *
 * `refs` absent leaves a group's references as they are. They are the
 * references listed under the heading, and nothing about renaming a part says
 * anything about them.
 *
 * Refused: no heading; a heading another part of this journey already has
 * (two parts a person cannot tell apart in a picker are one part with a bug);
 * more parts than a host will read (`LIMITS.PARTS` — the group would be
 * written and never shown); an id that is not a part.
 */
export function withPart<R extends Arrangeable>(
  record: R,
  given: { id?: string | null; heading: string; refs?: string[] },
): Parted<R> {
  const heading = given.heading.trim().slice(0, LIMITS.TITLE)
  if (!heading) return { ok: false, error: 'a part has to be called something: give it a heading.' }
  const parts = partsOf(record)
  const named = partIdsOf(record.groups)
  const id = given.id ?? null

  if (id !== null) {
    const refusal = notAPart(record, id)
    if (refusal) return { ok: false, error: refusal }
  } else if (named.filter((one) => one !== null).length >= LIMITS.PARTS || record.groups.length >= LIMITS.PARTS) {
    return {
      ok: false,
      error:
        `this journey already has ${record.groups.length} groups, and a host reads at most ${LIMITS.PARTS} of them as `
        + 'parts. One more would be written and never shown. Remove a part first.',
    }
  }

  const same = parts.find((part) => part.id !== id && part.heading.trim().toLowerCase() === heading.toLowerCase())
  if (same) {
    return {
      ok: false,
      error:
        `this journey already has a part called “${same.heading}” (${same.id}). Two parts under one heading cannot `
        + 'be told apart where they are picked, so nothing was changed.',
    }
  }

  if (id === null) {
    const added = [...record.groups, { heading, refs: given.refs ?? [] } as R['groups'][number]]
    const made = partIdsOf(added)[added.length - 1]
    if (made === null || made === undefined) return { ok: false, error: 'that part could not be given a name.' }
    const groups = holding(pinned(added, made), [...named, made])
    return { ok: true, record: { ...record, groups }, id: made, heading, created: true, was: null }
  }

  const at = named.indexOf(id)
  const was = parts.find((part) => part.id === id)?.heading ?? null
  const groups = holding(
    record.groups.map((group, i) =>
      i === at ? { ...group, id, heading, ...(given.refs ? { refs: given.refs } : {}) } : group,
    ),
    named,
  )
  return { ok: true, record: { ...record, groups }, id, heading, created: false, was }
}

/** What taking a part out would do, counted before it is done. */
export interface Removal {
  heading: string
  /** One-based positions of the steps in it, which stay and become unassigned. */
  steps: number[]
  /** The references listed under its heading. */
  refs: string[]
  /** Those of `refs` no step of the journey names: listed nowhere once the part is gone. */
  loose: string[]
}

/**
 * What removing a part takes with it — for the sentence a person agrees to,
 * and for the one an agent is told afterwards. Null when it is not a part.
 *
 * The steps are not among what goes. The references listed under the heading
 * are: they are the group's own list, and they leave with the group. Most of
 * them are named by a step as well and stay on the page there; `loose` is the
 * rest, which nothing in the journey will name any more — said separately
 * because those are the ones a host stops reading the trackers for.
 */
export function removalOf(record: Arrangeable, id: string): Removal | null {
  const at = partIdsOf(record.groups).indexOf(id)
  if (at < 0) return null
  const group = record.groups[at] as PartGroup
  const steps: number[] = []
  const stepRefs = new Set<string>()
  record.steps.forEach((step, index) => {
    if (stepPart(step) === id) steps.push(index + 1)
    for (const ref of step.refs ?? []) stepRefs.add(ref.trim())
  })
  const refs = [...new Set((group.refs ?? []).map((ref) => ref.trim()).filter(Boolean))]
  const heading = partsOf(record).find((part) => part.id === id)?.heading ?? id
  return { heading, steps, refs, loose: refs.filter((ref) => !stepRefs.has(ref)) }
}

/** `removalOf`, in the words both doors and the page print. */
export function removalSaid(gone: Removal): string {
  const steps =
    gone.steps.length === 0
      ? 'No step is in it'
      : `${gone.steps.length === 1 ? 'Its 1 step stays' : `Its ${gone.steps.length} steps stay`} in the journey and `
        + `${gone.steps.length === 1 ? 'becomes' : 'become'} unassigned (in no part)`
  const refs =
    gone.refs.length === 0
      ? 'it lists no references'
      : `the ${gone.refs.length === 1 ? '1 reference' : `${gone.refs.length} references`} listed under its heading `
        + `${gone.refs.length === 1 ? 'goes' : 'go'} with it`
        + (gone.loose.length === 0
          ? ', all still named by a step'
          : `; ${gone.loose.length === gone.refs.length ? (gone.loose.length === 1 ? 'it is' : 'all of them are') : `${gone.loose.length} of them ${gone.loose.length === 1 ? 'is' : 'are'}`} `
            + 'named by no step, and will be named nowhere in this journey')
  return `${steps}; ${refs}. No step is deleted.`
}

export type Removed<R> = { ok: true; record: R; gone: Removal } | Refused

/**
 * Take a part out. Its steps stay, in the journey and in their places, and say
 * no part; no step is deleted by this under any circumstances.
 *
 * Every group that is left keeps the name it had. Taking one out of the middle
 * is exactly the change that renumbers the ones after it — `part-3` becomes
 * `part-2`, the second "Later" stops being `later-2` — and each of those would
 * be steps silently changing part. `holding` writes the old name down wherever
 * that would have happened, and nowhere else.
 */
export function withoutPart<R extends Arrangeable>(record: R, id: string): Removed<R> {
  const refusal = notAPart(record, id)
  if (refusal) return { ok: false, error: refusal }
  const gone = removalOf(record, id)
  const named = partIdsOf(record.groups)
  const at = named.indexOf(id)
  if (!gone || at < 0) return { ok: false, error: `"${shortened(id)}" is not a part of this journey.` }
  const groups = holding(
    record.groups.filter((_, i) => i !== at),
    named.filter((_, i) => i !== at),
  )
  const steps = record.steps.map((step) => {
    if (stepPart(step) !== id) return step
    const { part: _gone, ...rest } = step
    return rest as typeof step
  })
  return { ok: true, record: { ...record, steps, groups }, gone }
}
