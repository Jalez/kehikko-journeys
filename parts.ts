import { LIMITS, PART_ID, partFile, slugFrom, stepPart } from 'kehikot-module-protocol'

/**
 * A part of an epic and the one step this app holds for it.
 *
 * ## The model
 *
 * An epic is divided into PARTS: an id, a name, an order. A part is the
 * epic's, not this app's. What this app holds for a part is **one step**, and
 * the step says which part it is the step of in its own `part` field. So a
 * journey has exactly as many steps as its epic has parts, in the same order,
 * and nothing here files, assigns or arranges: writing a step makes its part
 * and removing the step takes the part with it.
 *
 * ## Who keeps the list, and so who this file is for
 *
 * The list of parts is the epic's, and a host from protocol 1.2.0 keeps it in
 * the epic's own file. A host from before that reads it out of this app's
 * record instead: its `groups` — `{ id, heading, refs, files }` — counting a
 * step into a part when the step's `part` names the group's id. `keeper.ts`
 * says which of the two is true of an epic.
 *
 * Everything below the first two functions is for the second case and for
 * nothing else: the record keeps `groups`, one for each step, in the steps'
 * order, held to that by `mirrored` on every write, and each new part's id is
 * made here (`idFor`). A group carries what is the part's and not the step's:
 * its name (`heading`) and, where an earlier version wrote one, the document
 * the part covered (`files`). That document is carried and never set here any
 * more: what a part's document is belongs to whichever module keeps it.
 *
 * Where the host keeps the list none of it runs. A step's `part` is an id the
 * host made, `groups` is left exactly as it is in the record — unread and
 * unwritten — and the only arithmetic is on the steps (`doors.ts`).
 *
 * ## Everything here is arithmetic
 *
 * A record goes in and a record comes out, or a sentence for why not. No file
 * is read and nothing is written, so the store, both doors and the page load
 * the same functions.
 */

/** As much of a step as this file reads. Anything else on it is carried. */
export interface PartStep {
  title?: string
  body?: string
  refs?: string[]
  notes?: string[]
  part?: string
}

/** As much of a group as this file reads. Anything else on it is carried. */
export interface PartGroup {
  heading?: string
  refs?: string[]
  id?: string
  files?: string[]
}

/** As much of a record as this file reads. */
export interface Divided<S extends PartStep = PartStep, G extends PartGroup = PartGroup> {
  steps: S[]
  groups: G[]
  /** Present when the steps are kept somewhere else; see `stepsFrom` in `store.ts`. */
  stepsFrom?: unknown
  /** Headings that were never parts, set aside by `simplified`. Carried. */
  headings?: unknown
}

export type Refused = { ok: false; error: string }

function shortened(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const trimmedRefs = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const one of raw) {
    if (typeof one !== 'string') continue
    const ref = one.trim()
    if (ref && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** A group's documents in the protocol's form, once each. */
function filesOf(group: PartGroup | undefined): string[] {
  const out: string[] = []
  for (const one of Array.isArray(group?.files) ? group.files : []) {
    const file = partFile(one)
    if (file !== null && !out.includes(file)) out.push(file)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Reading a record that is already simple
 * ------------------------------------------------------------------ */

/** The part a step is the step of: its group, or undefined in a record that is not simple. */
export function partOf<G extends PartGroup>(record: { groups: G[] }, step: PartStep): G | undefined {
  const id = stepPart(step)
  return id === null ? undefined : record.groups.find((group) => group.id === id)
}

/** What a step's part is called: the name somebody gave it, else the step's title. */
export function nameOf(record: { groups: PartGroup[] }, step: PartStep): string {
  return (partOf(record, step)?.heading ?? '').trim() || (step.title ?? '').trim()
}

/** The one document a step's part covers, or null. */
export function fileOf(record: { groups: PartGroup[] }, step: PartStep): string | null {
  return filesOf(partOf(record, step))[0] ?? null
}

/**
 * Whether a part's name was given by a person, as opposed to being the step's
 * title standing in for one. A name that IS the title follows the title when
 * the title is reworded; a given one stays.
 */
export function named(record: { groups: PartGroup[] }, step: PartStep): boolean {
  const heading = (partOf(record, step)?.heading ?? '').trim()
  return heading !== '' && heading !== headingFrom(step.title ?? '')
}

/** A step's title as a part's name: one line, no longer than a host will carry. */
function headingFrom(title: string): string {
  return title.trim().slice(0, LIMITS.TITLE)
}

/**
 * An id for a new part, from what it is called.
 *
 * A slug of the name, cut at a word and kept short: an id is what a host
 * stores for a pick and what an agent types, and a ninety-character title is
 * neither. `taken` is every id it must not be — the ids in the record and, in
 * a migration, every id the record ever answered to.
 */
export function idFor(said: string, taken: ReadonlySet<string> | readonly string[], at = 1): string {
  const has = taken instanceof Set ? taken : new Set(taken as readonly string[])
  let base = slugFrom(said)
  if (base.length > ID_LENGTH) {
    const cut = base.slice(0, ID_LENGTH)
    const dash = cut.lastIndexOf('-')
    base = (dash >= ID_LENGTH / 2 ? cut.slice(0, dash) : cut).replace(/-+$/, '')
  }
  if (!base || !PART_ID.test(base)) base = `step-${at}`
  let id = base
  for (let n = 2; has.has(id); n += 1) id = `${base}-${n}`
  return id
}

/** How long a made id may be. Shorter than the protocol allows (80), so `-2` always fits. */
const ID_LENGTH = 40

/**
 * Whether a record is already one part to a step.
 *
 * Every step names a part; every part is named by exactly one step; the parts
 * are in the steps' order; a part lists no references of its own and covers at
 * most one document, which no other part covers. A record that is all of that
 * is left exactly as it is by `simplified`.
 */
export function isSimple(record: Divided): boolean {
  const { steps, groups } = record
  if (steps.length !== groups.length) return false
  const ids = new Set<string>()
  const files = new Set<string>()
  for (let i = 0; i < steps.length; i += 1) {
    const group = groups[i] as PartGroup
    const id = group.id
    if (typeof id !== 'string' || !PART_ID.test(id) || ids.has(id)) return false
    if (stepPart(steps[i]) !== id) return false
    ids.add(id)
    if (typeof group.heading !== 'string' || !group.heading.trim()) return false
    if ((group.refs ?? []).length) return false
    const raw = Array.isArray(group.files) ? group.files : []
    if (raw.length > 1) return false
    if (raw.length === 1) {
      const file = partFile(raw[0])
      if (file === null || file !== raw[0] || files.has(file)) return false
      files.add(file)
    }
    if (Object.hasOwn(group, 'files') && raw.length === 0) return false
  }
  return true
}

/* ------------------------------------------------------------------ *
 * The older shape, read as the simple one
 * ------------------------------------------------------------------ */

/**
 * One thing `simplified` decided that a person should be told. `code` is for
 * a test and a caller; `said` is the sentence.
 */
export interface Finding {
  code:
    | 'made' /* a step was made from a part that had none */
    | 'split' /* a part had several steps; each is now a part */
    | 'shared' /* two parts covered one document; the first keeps it */
    | 'extra' /* a part covered several documents; it keeps the first */
    | 'aside' /* a heading that was never a part is kept, but is not one */
    | 'unfiled' /* steps were in no part; each is now a part */
    | 'refs' /* references listed under a heading moved onto its step */
    | 'order' /* the parts are now in the steps' order, which differs */
    | 'beyond' /* more parts than a host lists */
    | 'elsewhere' /* parts of a journey whose steps are kept elsewhere */
  said: string
}

/** One part of the older shape and what became of it: the migration's table, a row to a part. */
export interface Fate {
  /** The id the part answered to. */
  was: string
  heading: string
  /** One-based positions, in the OLD record, of the steps that were in it. */
  steps: number[]
  files: string[]
  /** The id it answers to now, or null: it is no longer a part. */
  now: string | null
  /** One-based position, in the NEW record, of its step. */
  at: number | null
  /** The document it covers now. */
  file: string | null
  /** `kept` a step it had; `made` a step for it; `aside` it was never a part. */
  how: 'kept' | 'made' | 'aside'
}

export interface Simplified<R> {
  record: R
  /** False when the record was already simple: `record` is then the one handed in. */
  changed: boolean
  findings: Finding[]
  /** What became of each part the older shape had, in its order. */
  fates: Fate[]
  /** Ids the record answered to that it answers to no longer. */
  gone: string[]
}

export interface SimplifyOptions {
  /**
   * What becomes of a heading that was never made as a part: no step is in
   * it, it covers no document, and no id was ever written on it — which every
   * part made through this app's page or door has had since parts existed.
   * They are the headings a journey's references were once listed under.
   *
   * `aside` (the default) keeps each in the record under `headings`, exactly
   * as it was, and makes no step of it: a thirty-eight-step journey with
   * eight such headings stays thirty-eight steps. `steps` treats it like any
   * other part with no step and makes an empty step for it.
   */
  headings?: 'aside' | 'steps'
}

/** The id each group of the older shape answered to: the protocol's rule, without its limit of thirty-two. */
function idsOf(groups: readonly PartGroup[]): string[] {
  const taken = new Set<string>()
  return groups.map((group, index) => {
    const heading = typeof group.heading === 'string' ? group.heading.trim().slice(0, LIMITS.TITLE) : ''
    const wanted = typeof group.id === 'string' && PART_ID.test(group.id) ? group.id : slugFrom(heading) || `part-${index + 1}`
    let id = wanted
    for (let n = 2; taken.has(id); n += 1) id = `${wanted.slice(0, 76)}-${n}`
    taken.add(id)
    return id
  })
}

const quoted = (list: readonly string[]): string => list.map((one) => `“${shortened(one)}”`).join(', ')

/**
 * A record of the older shape as one part to a step — the migration, whole.
 *
 * The older shape let a part hold many steps or none, a step be in no part,
 * two parts cover one document and a part cover several. This reads any of
 * that as the simple model and says, part by part, what it did. Pure: the
 * store shows the page the answer on every read without writing it, and
 * writes it on the first deliberate write.
 *
 * **Nothing a person wrote is dropped.** Every step is kept, with every field
 * it had. Every heading is kept — as its part's name, or under `headings`.
 * Every reference is kept, on a step or under `headings`. A document a part
 * no longer covers is named in the findings, and the record as it was is kept
 * beside the file by the store.
 *
 * The rules, in the order they apply:
 *
 *  - **A part with one step**: the step is the part's step. The part keeps
 *    its id, its name and its document.
 *  - **A part with several steps**: each step is a part. The first keeps the
 *    part's id, name and document; the others get an id from their title, are
 *    called by their title, and cover nothing.
 *  - **A part with no step**: a step is made for it — titled with the part's
 *    name, empty — so the part survives with its id and its document. It goes
 *    where the part was in the order. (Unless it was never a part; see
 *    `SimplifyOptions.headings`.)
 *  - **A step in no part** (or naming one the journey does not have): it is a
 *    part of its own, with an id from its title, covering nothing.
 *  - **Two parts covering one document**: the first in order keeps it.
 *  - **A part covering several documents**: it keeps the first no earlier
 *    part took.
 *  - **References listed under a part's heading** that its step does not
 *    name: added to that step.
 *  - **A journey whose steps are kept elsewhere** (`stepsFrom`, no stored
 *    step): no step is made here — that would turn "the steps are in the
 *    paper" into "the steps are these empty ones". Its headings are set aside.
 */
export function simplified<R extends Divided>(record: R, options: SimplifyOptions = {}): Simplified<R> {
  if (isSimple(record)) return { record, changed: false, findings: [], fates: [], gone: [] }

  const groups = record.groups as PartGroup[]
  const steps = record.steps as PartStep[]
  const findings: Finding[] = []
  const was = idsOf(groups)
  const elsewhere = steps.length === 0 && record.stepsFrom !== undefined && record.stepsFrom !== null

  /* Which steps were in which part, by the old record's own word. */
  const inGroup = new Map<number, number[]>()
  const groupOfStep: (number | null)[] = steps.map((step, s) => {
    const said = stepPart(step)
    const g = said === null ? -1 : was.indexOf(said)
    if (g < 0) return null
    inGroup.set(g, [...(inGroup.get(g) ?? []), s])
    return g
  })

  /* Which parts are never to be parts: see `SimplifyOptions.headings`. */
  const aside = groups.map((group, g) => {
    if ((inGroup.get(g) ?? []).length) return false
    if (elsewhere) return true
    if (options.headings === 'steps') return false
    const written = typeof group.id === 'string' && PART_ID.test(group.id)
    return !written && filesOf(group).length === 0
  })

  /* The one document each surviving part covers: the first no earlier part took. */
  const taken = new Map<string, number>()
  const fileOfGroup: (string | null)[] = groups.map((group, g) => {
    if (aside[g]) return null
    const files = filesOf(group)
    const mine = files.find((file) => !taken.has(file)) ?? null
    if (mine !== null) taken.set(mine, g)
    const name = (group.heading ?? '').trim() || (was[g] as string)
    const shared = files.filter((file) => file !== mine && taken.has(file) && taken.get(file) !== g)
    for (const file of shared) {
      const by = taken.get(file) as number
      findings.push({
        code: 'shared',
        said:
          `${file} was covered by two parts, “${shortened((groups[by]?.heading ?? '').trim() || (was[by] as string))}” and `
          + `“${shortened(name)}”. A document belongs to one part: the first keeps it, and “${shortened(name)}” `
          + `${mine === null ? 'now covers none' : `covers ${mine}`}.`,
      })
    }
    const extra = files.filter((file) => file !== mine && !shared.includes(file))
    if (extra.length) {
      findings.push({
        code: 'extra',
        said:
          `“${shortened(name)}” covered ${files.length} documents and a part covers one: it keeps ${mine}, and `
          + `${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} no longer a part’s.`,
      })
    }
    return mine
  })

  /* Every id the record answered to is spoken for, so no made id can be mistaken for one. */
  const ids = new Set(was)

  interface Slot {
    step: PartStep
    group: PartGroup
    /** The old part this came from, or -1. */
    from: number
    how: 'kept' | 'made' | 'split' | 'unfiled'
    /** Zero-based position in the old record, or -1 for a made step. */
    old: number
  }

  const carried = (group: PartGroup | undefined, id: string, heading: string, file: string | null): PartGroup => {
    const { files: _files, refs: _refs, heading: _heading, id: _id, ...rest } = group ?? {}
    return { ...rest, heading, refs: [], id, ...(file === null ? {} : { files: [file] }) }
  }

  const slots: Slot[] = steps.map((step, s) => {
    const g = groupOfStep[s] as number | null
    const title = headingFrom(step.title ?? '')
    if (g !== null && (inGroup.get(g) as number[])[0] === s) {
      const group = groups[g] as PartGroup
      const refs = trimmedRefs(step.refs)
      const under = trimmedRefs(group.refs).filter((ref) => !refs.includes(ref))
      if (under.length) {
        findings.push({
          code: 'refs',
          said:
            `${under.join(', ')} ${under.length === 1 ? 'was' : 'were'} listed under “${shortened((group.heading ?? '').trim() || (was[g] as string))}” `
            + `and not on its step: ${under.length === 1 ? 'it is' : 'they are'} on the step now.`,
        })
      }
      return {
        step: { ...step, ...(under.length ? { refs: [...(step.refs ?? []), ...under] } : {}), part: was[g] as string },
        group: carried(group, was[g] as string, (group.heading ?? '').trim().slice(0, LIMITS.TITLE) || title, fileOfGroup[g] ?? null),
        from: g,
        how: 'kept',
        old: s,
      }
    }
    const id = idFor(step.title ?? '', ids, s + 1)
    ids.add(id)
    return {
      step: { ...step, part: id },
      group: carried(undefined, id, title, null),
      from: g ?? -1,
      how: g === null ? 'unfiled' : 'split',
      old: s,
    }
  })

  /* A step for each part that had none, put where the part was in the order:
     after the last step of the nearest part before it, else before the first
     step of the nearest part after it, else at the end. */
  groups.forEach((group, g) => {
    if (aside[g] || (inGroup.get(g) ?? []).length) return
    const heading = (group.heading ?? '').trim().slice(0, LIMITS.TITLE) || (was[g] as string)
    const slot: Slot = {
      step: { title: heading, body: '', refs: trimmedRefs(group.refs), notes: [], part: was[g] as string },
      group: carried(group, was[g] as string, heading, fileOfGroup[g] ?? null),
      from: g,
      how: 'made',
      old: -1,
    }
    let at = -1
    for (let before = g - 1; before >= 0 && at < 0; before -= 1) {
      for (let i = slots.length - 1; i >= 0; i -= 1) {
        if ((slots[i] as Slot).from === before) {
          at = i + 1
          break
        }
      }
    }
    if (at < 0) {
      const after = slots.findIndex((one) => one.from > g)
      at = after < 0 ? slots.length : after
    }
    slots.splice(at, 0, slot)
    findings.push({
      code: 'made',
      said:
        `“${shortened(heading)}” had no step. One was made for it — titled “${shortened(heading)}”, with nothing written in `
        + `it — so the part is still there, with its id (${was[g]})${fileOfGroup[g] ? ` and ${fileOfGroup[g]}` : ''}.`,
    })
  })

  /* Said once each, however many steps or headings it is about. */
  groups.forEach((group, g) => {
    const mine = inGroup.get(g) ?? []
    if (mine.length < 2) return
    const others = slots.filter((slot) => slot.from === g && slot.how === 'split')
    findings.push({
      code: 'split',
      said:
        `“${shortened((group.heading ?? '').trim() || (was[g] as string))}” held ${mine.length} steps, and a part has one. Step `
        + `${slots.findIndex((slot) => slot.from === g && slot.how === 'kept') + 1} keeps its id (${was[g]}), its name`
        + `${fileOfGroup[g] ? ` and ${fileOfGroup[g]}` : ''}; ${others.length === 1 ? 'the other is a part of its own' : `the other ${others.length} are parts of their own`}, `
        + `called by ${others.length === 1 ? 'its title' : 'their titles'} and covering no document: ${others.map((slot) => slot.group.id).join(', ')}.`,
    })
  })
  const unfiled = slots.filter((slot) => slot.how === 'unfiled')
  if (unfiled.length) {
    findings.push({
      code: 'unfiled',
      said:
        `${unfiled.length === 1 ? '1 step was' : `${unfiled.length} steps were`} in no part. `
        + `${unfiled.length === 1 ? 'It is a part of its own now' : 'Each is a part of its own now'}, called by its title.`,
    })
  }
  const setAside = groups.filter((_, g) => aside[g])
  if (setAside.length) {
    const headings = setAside.map((group, i) => (group.heading ?? '').trim() || `heading ${i + 1}`)
    findings.push({
      code: elsewhere ? 'elsewhere' : 'aside',
      said: elsewhere
        ? `This journey’s steps are kept elsewhere, so no step is made here for ${quoted(headings)}: `
          + `${setAside.length === 1 ? 'it is' : 'they are'} kept in the record under \`headings\`, and ${setAside.length === 1 ? 'is' : 'are'} not ${setAside.length === 1 ? 'a part' : 'parts'}.`
        : `${quoted(headings)} ${setAside.length === 1 ? 'was a heading' : 'were headings'} with references listed under `
          + `${setAside.length === 1 ? 'it' : 'them'} and no step, never made as ${setAside.length === 1 ? 'a part' : 'parts'}. `
          + `${setAside.length === 1 ? 'It is' : 'They are'} kept in the record under \`headings\`, references and all, and ${setAside.length === 1 ? 'is' : 'are'} no longer ${setAside.length === 1 ? 'a part' : 'parts'}.`,
    })
  }

  const now = slots.map((slot) => slot.group.id as string)
  const keptBefore = was.filter((id, g) => !aside[g])
  const keptNow = now.filter((id) => keptBefore.includes(id))
  if (keptBefore.join('\n') !== keptNow.join('\n')) {
    findings.push({
      code: 'order',
      said: `The parts are in the steps’ order now, which is not the order they were listed in: ${keptNow.join(', ')}.`,
    })
  }
  if (slots.length > LIMITS.PARTS) {
    findings.push({
      code: 'beyond',
      said:
        `This journey has ${slots.length} steps, so ${slots.length} parts, and a host lists the first ${LIMITS.PARTS} of an epic’s parts: `
        + `steps ${LIMITS.PARTS + 1} to ${slots.length} cannot be picked there.`,
    })
  }

  const fates: Fate[] = groups.map((group, g) => {
    const at = slots.findIndex((slot) => slot.from === g && (slot.how === 'kept' || slot.how === 'made'))
    return {
      was: was[g] as string,
      heading: (group.heading ?? '').trim(),
      steps: (inGroup.get(g) ?? []).map((s) => s + 1),
      files: filesOf(group),
      now: aside[g] ? null : (was[g] as string),
      at: at < 0 ? null : at + 1,
      file: fileOfGroup[g] ?? null,
      how: aside[g] ? 'aside' : (slots[at] as Slot).how === 'made' ? 'made' : 'kept',
    }
  })

  const headings = [...(Array.isArray(record.headings) ? record.headings : []), ...setAside]
  const { headings: _had, ...rest } = record
  const out = {
    ...rest,
    steps: slots.map((slot) => slot.step),
    groups: slots.map((slot) => slot.group),
    ...(headings.length ? { headings } : {}),
  } as unknown as R
  return { record: out, changed: true, findings, fates, gone: was.filter((_, g) => aside[g]) }
}

/** Every finding as one paragraph, for an answer line and a door. Empty when there is none. */
export function findingsSaid(findings: readonly Finding[]): string {
  return findings.map((one) => one.said).join(' ')
}

/* ------------------------------------------------------------------ *
 * Changing a record that is simple
 * ------------------------------------------------------------------ */

/**
 * The record with its parts held to its steps: one group to a step, in the
 * steps' order, each called what it was called.
 *
 * Every write ends in this. A step that names a part keeps that part — its
 * name and its document; a step that names none (it is new) is given one,
 * called by its title; a group no step names is gone, because its step is.
 * It is NOT the migration: handed a record of the older shape it would drop
 * the parts that had no step, which is why the store only ever hands it one
 * `simplified` has been over.
 */
export function mirrored<R extends Divided>(record: R): R {
  const byId = new Map<string, PartGroup>()
  for (const group of record.groups) if (typeof group.id === 'string' && !byId.has(group.id)) byId.set(group.id, group)
  const ids = new Set<string>()
  for (const step of record.steps) {
    const id = stepPart(step)
    if (id !== null && byId.has(id)) ids.add(id)
  }
  const used = new Set<string>()
  const steps: PartStep[] = []
  const groups: PartGroup[] = []
  record.steps.forEach((step, index) => {
    const said = stepPart(step)
    const had = said !== null && !used.has(said) ? byId.get(said) : undefined
    /* A step that names a part nobody has listed keeps the name it said. */
    const id = said !== null && !used.has(said) ? said : idFor(step.title ?? '', new Set([...ids, ...used]), index + 1)
    used.add(id)
    const heading = (had?.heading ?? '').trim() || headingFrom(step.title ?? '')
    const { files: _files, refs: _refs, heading: _heading, id: _id, ...rest } = had ?? {}
    const file = filesOf(had)[0]
    steps.push(said === id ? step : { ...step, part: id })
    groups.push({ ...rest, heading, refs: [], id, ...(file === undefined ? {} : { files: [file] }) })
  })
  return { ...record, steps, groups } as R
}

/** The zero-based position of the step that is the step of part `id`, or -1. */
export function stepOfPart(record: Divided, id: string): number {
  return record.steps.findIndex((step) => stepPart(step) === id)
}

/** Why `id` names no step of this journey, listing the ones there are. */
export function notAStep(record: Divided, id: string): string {
  if (!record.steps.length) return `"${shortened(id)}" names no step of this journey, which has no steps yet.`
  return (
    `"${shortened(id)}" names no step of this journey. Its steps are: `
    + `${record.steps.map((step, i) => `${i + 1} ${stepPart(step) ?? '?'}`).join(', ')}. Pass one of those ids as \`step\`, or a 1-based \`position\`.`
  )
}

export type Parted<R> = { ok: true; record: R; id: string } | Refused

/**
 * Say what the part of the step at `at` (zero-based) is called. `name` is
 * three-valued: `undefined` leaves it, `''`/`null` clears it (the name falls
 * back to the step's title), a value sets it. The document a part may carry
 * from an earlier version stays as it is.
 */
export function withPart<R extends Divided>(record: R, at: number, given: { name?: string | null }): Parted<R> {
  const base = mirrored(record)
  const group = base.groups[at]
  const step = base.steps[at]
  if (!group || !step) return { ok: false, error: `this journey has ${base.steps.length} steps, and ${at + 1} is not one of them.` }
  let next: PartGroup = group
  if (given.name !== undefined) {
    const said = (given.name ?? '').trim().slice(0, LIMITS.TITLE)
    next = { ...next, heading: said || headingFrom(step.title ?? '') }
  }
  const groups = base.groups.map((one, i) => (i === at ? next : one))
  return { ok: true, record: { ...base, groups } as R, id: group.id as string }
}

/**
 * The record with the step at `at` (zero-based) written: replaced, or — one
 * past the end — added.
 *
 * A step that is replaced keeps its part. Its part's name follows its title
 * when the name was only ever the title; a name somebody gave stays.
 */
export function withStep<R extends Divided>(record: R, at: number, step: PartStep): R {
  const base = mirrored(record)
  const before = base.steps[at]
  if (!before) return mirrored({ ...base, steps: [...base.steps, step] } as R)
  const follows = !named(base, before)
  const part = stepPart(before) as string
  const steps = base.steps.map((one, i) => (i === at ? { ...step, part } : one))
  const groups = base.groups.map((group, i) =>
    i === at && follows ? { ...group, heading: headingFrom(step.title ?? '') || group.heading } : group,
  )
  return { ...base, steps, groups } as R
}

/**
 * The record with the step at `from` (zero-based) moved to `to`. Its part
 * moves with it: the parts are in the steps' order.
 */
export function withStepMoved<R extends Divided>(record: R, from: number, to: number): R {
  const base = mirrored(record)
  const moved = <T,>(list: readonly T[]): T[] => {
    const out = [...list]
    const [one] = out.splice(from, 1)
    out.splice(to, 0, one as T)
    return out
  }
  return { ...base, steps: moved(base.steps), groups: moved(base.groups) } as R
}

/** The record without the step at `at` (zero-based). Its part goes with it. */
export function withoutStep<R extends Divided>(record: R, at: number): R {
  const base = mirrored(record)
  return {
    ...base,
    steps: base.steps.filter((_, i) => i !== at),
    groups: base.groups.filter((_, i) => i !== at),
  } as R
}
