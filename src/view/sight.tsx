import type { JourneyView, Live } from '../kinds.ts'

/**
 * What this app can see from here, said out loud.
 *
 * A box at the top, never a tooltip. Four states, four sentences, because they
 * send a reader to four different places — an app that quietly showed a blank
 * state chip beside a reference it has never had a reading of would be lying in
 * the ordinary case, and a tooltip is a sentence nobody reads on a touchscreen
 * or with a keyboard.
 *
 * This is prose and is styled as prose: a rule down the left, muted ink, and
 * the lead in the foreground colour so the eye can take the first three words
 * and move on. It is deliberately not an alert, a callout component or a
 * coloured banner. Three of the four things it says are ordinary and one of
 * them is a refusal; a box that shouted would be shouting three times out of
 * four.
 */
export function Sight({
  framed,
  refused,
  journey,
  live,
}: {
  framed: boolean
  refused: string | null
  journey: JourneyView | null
  live: Live | null
}) {
  const { lead, rest } = read(framed, refused, journey, live)
  return (
    <p className="my-3 rounded-md border border-l-2 border-l-marker bg-card px-3 py-2 text-[0.85rem] leading-6 text-muted-foreground">
      <b className="text-foreground">{lead}</b> {rest}
    </p>
  )
}

function read(
  framed: boolean,
  refused: string | null,
  journey: JourneyView | null,
  live: Live | null,
): { lead: string; rest: string } {
  if (!framed) {
    return {
      lead: 'Standing on its own.',
      rest:
        'Nothing is framing this page. Everything below is this app’s own store: the journeys, their prose, their ' +
        'steps, what blocks what — all of it readable and editable with nothing else running. What is missing is ' +
        'what a tracker says: every reference is shown as a reference, and marked “state not visible from here”, ' +
        'which is not the same as unknown and is certainly not closed.',
    }
  }
  if (refused) return { lead: 'Framed, and refused.', rest: refused }
  if (!journey) {
    return {
      lead: 'Framed by a host.',
      rest:
        'No epic is open, or the host named one this app does not hold. Pick one below — these are the journeys ' +
        'this app has.',
    }
  }
  return {
    lead: `Framed, reading ${journey.slug}.`,
    rest: live
      ? 'The journey and its steps are this app’s. What each reference is doing comes from the host’s last ' +
        'refresh, handed over whole: this app holds no credential, calls no tracker, and could not spend ' +
        'anybody’s rate limit if it tried. An agent’s own report of where work stands is not in that, and the ' +
        'rail does not pretend to it.'
      : 'The host has not handed over what its last refresh read — either live.get was refused, or there has been ' +
        'no refresh. The journey below is complete; the states beside the references are not there.',
  }
}
