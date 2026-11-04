import { LIMITS, type FooterItemInput, type HeaderItemInput } from 'kehikot-module-protocol'

/**
 * This page's two rows, as the host draws them: the header (`kehikot.header`) and the footer
 * (`kehikot.footer`, protocol 2.38.0).
 *
 * The rule the rows follow: the header is how the module is set up, the footer is what is going on
 * now. So "pick every step", which acts on the whole journey at once, is the header's one toggle.
 * Everything a person glances at to know where the journey stands is the footer: how many of its
 * steps are done, how many an open gate holds, which step is next, the step an agent pointed the
 * page at, what is picked on the canvas (with Clear beside it, since that is all Clear acts on),
 * and the one line this app answers the reader with, which was the line under the page.
 *
 * Which journey is shown is not a choice made here when a host frames the page: it is the epic the
 * host is on, picked in the host's own bar. So nothing in the header picks it.
 *
 * Folded to two rows, a container shows its header and this footer, so the progress is what a
 * person reads there.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its presses and its line exactly as before, and declares no header either, so
 * nothing is in two places. The page owns every bit of state: the host draws the latest list. Pure,
 * so what is declared is what is tested.
 */

/**
 * What the line under the page says while the trackers are being read again and nothing else is
 * being answered: the states on screen are the reading before, and a reader comparing them with
 * the tracker should know a newer one is on its way. The journey itself stays exactly where it is
 * through a read — nothing is taken off the screen to make room for the next reading (#39).
 */
export const BUSY_SAID = 'Reading the tracker… the states shown are from the reading before.'

/** What the same line says when the newest read failed and an older reading is still drawn. */
export function failedSaid(why: string): string {
  return `The last read of the tracker did not land (${why}); the states shown are from the reading before.`
}

export interface Progress {
  /** Steps of one piece of work (leaves) that are done, and how many there are. */
  done: number
  total: number
  /** Steps free but for a gate that is still open. */
  blocked: number
  /** The step to take next, or null, with the reason when null. */
  next: { position: number; title: string } | null
  why: string | null
}

export interface FooterState {
  /** The line under the page: what it says, and how loudly. Null when it says nothing. */
  status: { said: string; level: 'normal' | 'warn'; tooltip?: string } | null
  /** The open journey's progress by this reading, or null when no journey with stored steps is open. */
  progress: Progress | null
  /** The step an agent pointed the page at, with its line, or null. */
  pointed: { step: number; title: string; say: string } | null
  /** How many references the canvas has picked out (here and in any other container). */
  picked: number
}

const clip = (text: string, most: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`
}

/** What the progress says: done of all, then the blocked ones when there are some. */
export function progressSaid(progress: Progress): string {
  const parts = [`${progress.done}/${progress.total} done`]
  if (progress.blocked) parts.push(`${progress.blocked} blocked`)
  return parts.join(' · ')
}

/** The footer's items for a state; `[]` when there is nothing to say. */
export function footerItems(state: FooterState): FooterItemInput[] {
  const items: FooterItemInput[] = []
  if (state.status) {
    items.push({
      kind: 'text',
      id: 'status',
      text: clip(state.status.said, LIMITS.FOOTER_TEXT),
      level: state.status.level,
      tooltip: clip(state.status.tooltip ?? state.status.said, LIMITS.FOOTER_TOOLTIP),
    })
  }
  if (state.pointed) {
    const said = `Step ${state.pointed.step} · ${state.pointed.title}`
    items.push({
      kind: 'text',
      id: 'pointed',
      text: clip(said, LIMITS.FOOTER_TEXT),
      tooltip: clip(state.pointed.say ? `${said}: ${state.pointed.say}` : `An agent pointed this page at ${said}.`, LIMITS.FOOTER_TOOLTIP),
      optional: true,
    })
  }
  if (state.picked > 0) {
    items.push({ kind: 'text', id: 'picked', text: `${state.picked} picked`, align: 'center', optional: true })
    items.push({ kind: 'run', id: 'clear', label: 'Clear', icon: 'x', align: 'center', tooltip: 'Clear the canvas selection — everything picked here and in any other container.' })
  }
  const progress = state.progress
  if (progress && progress.total > 0) {
    if (progress.next) {
      const next = `Next: ${progress.next.position}. ${progress.next.title}`
      items.push({ kind: 'text', id: 'next', text: clip(next, LIMITS.FOOTER_TEXT), align: 'end', optional: true, tooltip: clip(next, LIMITS.FOOTER_TOOLTIP) })
    }
    const said = progressSaid(progress)
    items.push({
      kind: 'text',
      id: 'progress',
      text: clip(said, LIMITS.FOOTER_TEXT),
      align: 'end',
      tooltip: clip(progress.why ? `${said}. ${progress.why}` : `${said}.`, LIMITS.FOOTER_TOOLTIP),
    })
  }
  return items
}

/** What a footer press asks for, or the sentence saying why not. */
export function footerPressed(item: string, state: Pick<FooterState, 'picked'>): 'clear' | string {
  if (item !== 'clear') return 'Nothing else in this footer can be pressed.'
  if (state.picked === 0) return 'Nothing is picked on the canvas.'
  return 'clear'
}

/**
 * The header: "Pick every step", on when every reference the steps in front carry is picked.
 * Nothing when those steps carry none: a toggle that can only refuse is not worth a menu row.
 */
export function headerItems(state: { named: number; all: boolean }): HeaderItemInput[] {
  if (state.named === 0) return []
  return [{ kind: 'toggle', id: 'pick-all', label: 'Pick every step', checked: state.all, agents: true }]
}
