import { CircleDot, ExternalLink, Hammer, KeyRound, Scale, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

import { KIND_SAID, gateDone, gatesOf, refGates, delivering, roleOf, stepGates, stepRefGates, type Gate, type GateKind } from '../gates.ts'
import { goToJourney, setGateState } from '../journeys.ts'
import { alsoSaid, type Also } from '../shared.ts'
import type { Step } from '../kinds.ts'
import { issueDone } from '../live/status.ts'
import { Ref } from './prose.tsx'
import { aroundOf, useReading } from './reading.tsx'

/**
 * Gates on the page: what stands in a step's way that is not a step (`src/gates.ts`).
 *
 * Each gate says its kind as a WORD and an icon, its title, who has to act, and where it stands —
 * "open", or "done" and by whom — so nothing is told by colour alone. A gate a person can settle
 * has one press beside it: "mark done", or "reopen". An issue gate is done when the tracker says its
 * ref is, and says so.
 */

const ICON: Record<GateKind, LucideIcon> = {
  issue: CircleDot,
  work: Hammer,
  decision: Scale,
  access: KeyRound,
  'ref-elsewhere': ExternalLink,
}

/** The kind, as an icon and a word, never one without the other. */
export function GateKind({ kind }: { kind: GateKind }) {
  const Icon = ICON[kind]
  return (
    <span data-gate-kind={kind} className="inline-flex items-baseline gap-1 text-[0.72rem] font-medium tracking-wide uppercase" title={KIND_SAID[kind].about}>
      <Icon aria-hidden="true" className="size-3 shrink-0 translate-y-0.5" />
      {KIND_SAID[kind].word}
    </span>
  )
}

/** One gate in one line: kind, title, who, its ref, where it stands, and the press that settles it. */
export function GateLine({ gate, holds, via }: { gate: Gate; holds?: readonly string[]; via?: readonly string[] }) {
  const reading = useReading()
  const tracked = (ref: string) => issueDone(reading.live, ref, aroundOf(reading))
  const done = gateDone(gate, tracked)
  const byTracker = done && gate.state !== 'done'
  return (
    <li data-gate={gate.id} data-gate-state={done ? 'done' : 'open'} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-5">
      <GateKind kind={gate.kind} />
      <span className={cn('min-w-0 text-[0.85rem] [overflow-wrap:anywhere]', done && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{gate.title}</span>
      {gate.owner && <span className="text-muted-foreground">{gate.owner} to act</span>}
      {gate.ref && (
        <span className="text-muted-foreground">
          <Ref refName={gate.ref} />
          {gate.epic ? ` in ${gate.epic}` : ''}
        </span>
      )}
      <span data-gate-said className={cn(done ? 'text-muted-foreground' : 'font-semibold text-foreground')}>
        <span aria-hidden="true">{done ? '✓ ' : '○ '}</span>
        {done
          ? byTracker
            ? 'done, by the tracker'
            : `done${gate.doneBy ? ` by ${gate.doneBy}` : ''}${gate.doneAt ? `, ${gate.doneAt.slice(0, 10)}` : ''}`
          : 'open'}
      </span>
      {gate.waitsOn?.length ? (
        <span data-gate-waits className="text-muted-foreground">
          waits on{' '}
          {gate.waitsOn.map((ref, i) => (
            <span key={ref}>
              {i > 0 && ' '}
              <Ref refName={ref} />
            </span>
          ))}
        </span>
      ) : null}
      {via?.length ? (
        <span data-gate-via className="text-muted-foreground">
          holds{' '}
          {via.map((ref, i) => (
            <span key={ref}>
              {i > 0 && ' '}
              <Ref refName={ref} />
            </span>
          ))}
        </span>
      ) : null}
      {holds && <span className="text-muted-foreground">{holds.length ? `holds ${holds.join(', ')}` : 'holds no step or ref'}</span>}
      {(gate.state === 'done' || !done) && (
        <Button
          type="button"
          variant="ghost"
          size="container"
          className="h-5 px-1.5 text-muted-foreground"
          onClick={() => void setGateState(gate.id, gate.state === 'done' ? 'open' : 'done')}
        >
          {gate.state === 'done' ? 'reopen' : 'mark done'}
        </Button>
      )}
      {gate.note && <span className="basis-full text-muted-foreground [overflow-wrap:anywhere]">{gate.note}</span>}
    </li>
  )
}

/** The gates that hold one step, under its place line. Nothing when none does. */
export function StepGates({ step }: { step: Step }) {
  const { journey } = useReading()
  const own = stepGates(step)
  const viaRef = stepRefGates(step, journey?.blockedBy)
  const gates = gatesOf(journey).filter((gate) => own.includes(gate.id) || viaRef.includes(gate.id))
  if (!gates.length) return null
  /* A gate that holds a ref which delivers this step says which ref. */
  const through = (id: string) => delivering(step).filter((ref) => (journey?.blockedBy?.[ref] ?? []).includes(id))
  return (
    <div data-step-gates className="mt-1.5 @min-[26rem]/container:ml-[2.1rem]">
      <span className="mr-1.5 text-xs tracking-wide text-muted-foreground uppercase opacity-70">waits on</span>
      <ul className="mt-0.5 grid gap-0.5">
        {gates.map((gate) => (
          <GateLine key={gate.id} gate={gate} via={through(gate.id)} />
        ))}
      </ul>
    </div>
  )
}

/** Refs on a step that do not deliver it, said by what they are: prior art, related. Nothing when every ref delivers. */
export function OtherRefs({ step }: { step: Step }) {
  const refs = step.refs ?? []
  const groups = (['prior-art', 'related'] as const)
    .map((role) => ({ role, refs: refs.filter((ref) => roleOf(step, ref) === role) }))
    .filter((group) => group.refs.length)
  if (!groups.length) return null
  return (
    <p data-other-refs className="mt-1.5 text-xs leading-5 text-muted-foreground @min-[26rem]/container:ml-[2.1rem]">
      {groups.map((group, i) => (
        <span key={group.role} data-role={group.role}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span className="mr-1 tracking-wide uppercase opacity-70">{group.role === 'prior-art' ? 'prior art' : 'related'}</span>
          {group.refs.map((ref, j) => (
            <span key={ref}>
              {j > 0 && ' '}
              <Ref refName={ref} />
            </span>
          ))}
        </span>
      ))}
    </p>
  )
}

/**
 * Every gate of the journey, with the steps each holds — including a gate that holds no step yet,
 * so that every recorded blocker is somewhere on the page.
 */
export function GatesList() {
  const { journey } = useReading()
  const gates = gatesOf(journey)
  if (!journey || !gates.length) return null
  const holds = (id: string) => [
    ...journey.steps.flatMap((step, i) => (stepGates(step).includes(id) ? [`step ${i + 1}`] : [])),
    ...Object.entries(journey.blockedBy ?? {}).flatMap(([ref, ids]) => (ids.includes(id) ? [ref] : [])),
  ]
  return (
    <ul data-gates className="grid gap-1">
      {gates.map((gate) => (
        <GateLine key={gate.id} gate={gate} holds={holds(gate.id)} />
      ))}
    </ul>
  )
}

/** The gates that hold one ref, as the journey's `blockedBy` lists them. Nothing when none does. */
export function RefGates({ refName }: { refName: string }) {
  const { journey } = useReading()
  const gates = refGates(journey?.blockedBy, gatesOf(journey), refName)
  if (!gates.length) return null
  return (
    <div data-ref-gates className="mt-1.5">
      <span className="mr-1.5 text-xs tracking-wide text-muted-foreground uppercase opacity-70">waits on</span>
      <ul className="mt-0.5 grid gap-0.5">
        {gates.map((gate) => (
          <GateLine key={gate.id} gate={gate} />
        ))}
      </ul>
    </div>
  )
}

/**
 * A ref that is also in other journeys of the project: "also in: <epic> (<step>)", read-only, each
 * with a link that opens that journey. Nothing when no other journey names it.
 */
export function AlsoIn({ refName }: { refName: string }) {
  const { journey } = useReading()
  const found: Also[] = journey?.alsoIn?.[refName] ?? []
  if (!found.length) return null
  return (
    <p data-also-in={refName} className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-muted-foreground">
      <span className="tracking-wide uppercase opacity-70">also in</span>
      {found.map((also, i) => (
        <span key={`${also.epic}-${also.id ?? also.gate ?? i}`} data-also-epic={also.epic}>
          <Button
            type="button"
            variant="ghost"
            size="container"
            className="h-5 px-1.5 text-muted-foreground underline"
            title={`Open the journey of ${also.epic}`}
            onClick={() => void goToJourney(also.epic)}
          >
            {alsoSaid(also)}
          </Button>
        </span>
      ))}
    </p>
  )
}
