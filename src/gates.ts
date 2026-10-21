import { stepPart } from 'kehikot-module-protocol'

import { REF_IN_PROSE, isTracked } from './refs.ts'

/**
 * Gates: what stands in a journey's way that a tracker does not hold, and the issues that do.
 *
 * Pure, and shared by the store, both doors and the page, so the rules for "what is a gate", "is
 * it done" and "how an older `blockedBy` reads" are said once.
 *
 * ## The shape
 *
 * A journey keeps `gates`: a list, each with an `id`, a `kind`, a `title`, optionally an `owner`
 * (a person or a role), a `note` and a `ref`, and a `state` — `open`, or `done` with `doneAt` and
 * `doneBy`. A step says which gates hold it in `blockedBy` (gate ids), beside `after` (step ids).
 *
 * The kinds:
 *
 *  - `issue` — an issue or change in this epic's tracker; `ref` names it, and it is done when the
 *    tracker says so, or when somebody marks it done.
 *  - `work` — work nobody has filed an issue for yet.
 *  - `decision` — somebody has to decide; `owner` says who.
 *  - `access` — somebody outside the team has to grant something.
 *  - `ref-elsewhere` — a ref another epic owns; `epic` is that epic's slug. Done like `issue`.
 *
 * A `work`, `decision` or `access` gate is done only when a person or an agent says so, and the
 * record keeps who and when.
 *
 * ## A step's refs have a role
 *
 * `roles` on a step maps a ref to `prior-art` or `related`. A ref not in it DELIVERS the step,
 * which is what every ref meant before roles existed — so an older record reads the same. Only a
 * delivering ref says whether a step is done or which issue is its own.
 */

export const GATE_KINDS = ['issue', 'work', 'decision', 'access', 'ref-elsewhere'] as const
export type GateKind = (typeof GATE_KINDS)[number]

export const GATE_STATES = ['open', 'done'] as const
export type GateState = (typeof GATE_STATES)[number]

export const REF_ROLES = ['delivers', 'prior-art', 'related'] as const
export type RefRole = (typeof REF_ROLES)[number]

/** A gate's id: a slug, like a part's. */
export const GATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface Gate {
  id: string
  kind: GateKind
  title: string
  /** Who has to act: a person or a role. */
  owner?: string
  note?: string
  /** The tracker ref: the issue itself for `issue` and `ref-elsewhere`, context for the rest. */
  ref?: string
  /** For `ref-elsewhere`: the slug of the epic that owns the ref. */
  epic?: string
  state: GateState
  /** When it was marked done, as an ISO time. */
  doneAt?: string
  /** Who marked it done. */
  doneBy?: string
}

/** How each kind is said: a word, a mark that is a shape and not a colour, and a sentence. */
export const KIND_SAID: Record<GateKind, { word: string; mark: string; about: string }> = {
  issue: { word: 'issue', mark: '●', about: 'An issue or change in this epic’s tracker.' },
  work: { word: 'work', mark: '⚒', about: 'Work nobody has filed an issue for yet.' },
  decision: { word: 'decision', mark: '⚖', about: 'Somebody has to decide.' },
  access: { word: 'access', mark: '⚿', about: 'Somebody outside the team has to grant something.' },
  'ref-elsewhere': { word: 'in another epic', mark: '↗', about: 'A ref another epic owns.' },
}

export const isGateKind = (value: unknown): value is GateKind => typeof value === 'string' && (GATE_KINDS as readonly string[]).includes(value)
export const isRefRole = (value: unknown): value is RefRole => typeof value === 'string' && (REF_ROLES as readonly string[]).includes(value)

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** A journey's gates, read loosely: one with no id or no title is not a gate, and an unknown kind reads as work. */
export function gatesOf(journey: object | null | undefined): Gate[] {
  const raw = (journey as { gates?: unknown } | null | undefined)?.gates
  if (!Array.isArray(raw)) return []
  const out: Gate[] = []
  for (const one of raw) {
    if (!one || typeof one !== 'object') continue
    const g = one as Record<string, unknown>
    const id = text(g.id)
    const title = text(g.title)
    if (!id || !title || out.some((had) => had.id === id)) continue
    const gate: Gate = { id, kind: isGateKind(g.kind) ? g.kind : 'work', title, state: g.state === 'done' ? 'done' : 'open' }
    for (const key of ['owner', 'note', 'ref', 'epic', 'doneAt', 'doneBy'] as const) {
      const value = text(g[key])
      if (value) gate[key] = value
    }
    out.push(gate)
  }
  return out
}

/** The gate ids a step names in `blockedBy`, as written. */
export function stepGates(step: object): string[] {
  const raw = (step as { blockedBy?: unknown }).blockedBy
  return Array.isArray(raw) ? [...new Set(raw.filter((one): one is string => typeof one === 'string' && one.length > 0))] : []
}

/**
 * Whether a gate is done: marked so, or — for one that IS a tracked ref — its ref is done by the
 * caller's reading. A decision or work gate that mentions an issue is not settled by that issue.
 */
export function gateDone(gate: Gate, refDone: (ref: string) => boolean = () => false): boolean {
  if (gate.state === 'done') return true
  return (gate.kind === 'issue' || gate.kind === 'ref-elsewhere') && Boolean(gate.ref) && refDone(gate.ref!)
}

/** What a ref is to a step: its `roles` entry, or `delivers`. */
export function roleOf(step: object, ref: string): RefRole {
  const roles = (step as { roles?: unknown }).roles
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return 'delivers'
  const role = Object.hasOwn(roles, ref) ? (roles as Record<string, unknown>)[ref] : undefined
  return isRefRole(role) ? role : 'delivers'
}

/** The refs that deliver a step: every ref not marked prior art or related. */
export function delivering(step: { refs?: readonly string[]; roles?: unknown }): string[] {
  return (step.refs ?? []).filter((ref) => roleOf(step, ref) === 'delivers')
}

/** One gate in a line: the kind as a word, the title, who, and where it stands. */
export function gateSaid(gate: Gate): string {
  const kind = KIND_SAID[gate.kind]
  return (
    `${kind.mark} ${kind.word}: “${gate.title}”`
    + (gate.owner ? `, ${gate.owner} to act` : '')
    + (gate.ref ? `, ${gate.ref}${gate.epic ? ` in ${gate.epic}` : ''}` : gate.epic ? `, in ${gate.epic}` : '')
    + (gate.state === 'done' ? ` — done${gate.doneBy ? ` by ${gate.doneBy}` : ''}${gate.doneAt ? ` at ${gate.doneAt}` : ''}` : ' — open')
  )
}

/** A new gate id from a title, not one of `taken`. */
export function gateIdFor(title: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'gate'
  let id = base
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`
  return id
}

/* ------------------------------------------------------------------ *
 * Reading an older `blockedBy`
 * ------------------------------------------------------------------ */

/**
 * What one older `blockedBy` value was, as a gate: a bare ref is an issue; a sentence that says
 * "decision", "decide" or "legal" is a decision; anything else is work. The text is the title, whole, and a
 * ref inside it is kept as the gate's ref.
 */
export function gateFromText(value: string): Pick<Gate, 'kind' | 'title' | 'ref'> {
  const said = value.trim()
  if (isTracked(said)) return { kind: 'issue', title: said, ref: said }
  const ref = said.match(REF_IN_PROSE)?.[0]
  const kind: GateKind = /decision|decide|legal/i.test(said) ? 'decision' : 'work'
  return ref ? { kind, title: said, ref } : { kind, title: said }
}

interface Gatable {
  steps: { title: string; refs?: string[]; part?: string; after?: unknown; blockedBy?: unknown }[]
  blockedBy: Record<string, string[]>
  gates?: unknown
  watch?: string[]
  containers?: string[]
  umbrella?: string
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * A record whose `blockedBy` names steps or sentences, read as gates.
 *
 * `blockedBy` was a map from a ref to what it waits on, and people keyed it by STEP TITLES and
 * filled it with sentences, which nothing drew. This reads each such entry once:
 *
 *  - a key that is a step's title (or its id) is that step; a value that is another step's title
 *    is an order (`after`), and any other value is a gate the step is `blockedBy`;
 *  - a key that is no step, no tracked ref and no ref the journey names is a heading somebody
 *    wrote: its values become gates that block nothing yet, each with the heading in its note;
 *  - a key that is a ref stays exactly where it was — it is what "this ref waits on" means.
 *
 * A gate already there with the same kind and title is used again rather than made twice, so a
 * record read twice, or an entry an older writer puts back, never doubles a gate. Nothing is
 * dropped: every key and every value is in a step's order, a gate's title or a gate's note.
 * `changed` is false, and the record is returned as it was, when there was nothing to read.
 */
export function gated<J extends Gatable>(journey: J): { record: J; changed: boolean } {
  const steps = journey.steps
  const blockedBy = journey.blockedBy ?? {}
  const named = new Set<string>()
  for (const step of steps) for (const ref of step.refs ?? []) named.add(ref.trim())
  for (const ref of [...(journey.watch ?? []), ...(journey.containers ?? []), journey.umbrella ?? '']) if (ref) named.add(ref.trim())

  const stepAt = (key: string): number => steps.findIndex((step) => same(step.title, key) || stepPart(step) === key.trim())
  const moving = Object.keys(blockedBy).filter((key) => !isTracked(key.trim()) && !named.has(key.trim()))
  if (!moving.length) return { record: journey, changed: false }

  const gates = [...gatesOf(journey)]
  const raw = Array.isArray(journey.gates) ? (journey.gates as unknown[]) : []
  /* Gates as they were stored are carried as they were; only new ones are added. */
  const added: Gate[] = []
  const gateFor = (value: string, note?: string): string => {
    const wanted = gateFromText(value)
    const had = gates.find((one) => one.kind === wanted.kind && same(one.title, wanted.title))
    if (had) return had.id
    const gate: Gate = { id: gateIdFor(wanted.title, gates.map((one) => one.id)), ...wanted, state: 'open', ...(note ? { note } : {}) }
    gates.push(gate)
    added.push(gate)
    return gate.id
  }

  const out = steps.map((step) => ({ ...step }))
  const rest: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(blockedBy)) {
    if (!moving.includes(key)) {
      rest[key] = values
      continue
    }
    const at = stepAt(key)
    if (at < 0) {
      for (const value of values) if (value.trim()) gateFor(value, `Listed under “${key.trim()}”.`)
      continue
    }
    const step = out[at]!
    const after = Array.isArray(step.after) ? [...(step.after as unknown[])] : []
    const held = stepGates(step)
    for (const value of values) {
      if (!value.trim()) continue
      const other = stepAt(value)
      const id = other >= 0 && other !== at ? stepPart(out[other]!) : null
      if (id) {
        if (!after.includes(id)) after.push(id)
        continue
      }
      const gate = gateFor(value)
      if (!held.includes(gate)) held.push(gate)
    }
    if (after.length) step.after = after
    if (held.length) step.blockedBy = held
  }

  return {
    record: { ...journey, steps: out, blockedBy: rest, gates: [...raw, ...added] },
    changed: true,
  }
}
