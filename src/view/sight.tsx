import type { JourneyView, Live } from '../kinds.ts'

/**
 * What this app can see from here, said out loud.
 *
 * A box at the top, never a tooltip, and only when a host is framing this
 * page. Five states, five sentences, because they
 * send a reader to five different places — an app that quietly showed a blank
 * state chip beside a reference it has never had a reading of would be lying in
 * the ordinary case, and a tooltip is a sentence nobody reads on a touchscreen
 * or with a keyboard.
 *
 * This is prose and is styled as prose: a rule down the left, muted ink, and
 * the lead in the foreground colour so the eye can take the first three words
 * and move on. It is deliberately not an alert, a callout component or a
 * coloured banner. Four of the five things it says are ordinary and one of
 * them is a refusal; a box that shouted would be shouting four times out of
 * five.
 *
 * ## The fifth state was the fourth, wearing an "or"
 *
 * Two of these used to be one sentence. Framed with nothing to draw said "No
 * epic is open, or the host named one this app does not hold" — one sentence
 * over two unrelated situations, and in the common one it led with the false
 * half. An epic WAS open and WAS named; the canvas was showing it a few inches
 * away; and this page opened by suggesting it might not be. What a reader does
 * next differs completely between the two: nothing open means put something on
 * the canvas, and no journey for this epic means write one, or accept that
 * this is an epic this app does not cover. A sentence spanning both helps with
 * neither, and it sent people to check the host's context for a fault that was
 * never there.
 *
 * That is the shape the host had in `server/quiet.ts`, where one message stood
 * for four different faults and the only response it left available could not
 * fix any of them. The rule that came out of it holds here: a message that
 * needs an "or" is two messages.
 *
 * ## And they are one line each
 *
 * The old paragraph ran to forty words. This app is drawn in a 220-pixel rail
 * as often as not, where forty words is a wall about one word wide, and the
 * standing complaint across this workspace is prose in that column. The two
 * sentences below are short enough to be read in the narrow case, which is the
 * case they are for: they are what somebody sees when there is nothing else on
 * the page. Neither offers to let the reader pick — the picker is drawn only
 * when this container is standing alone, so "pick one below" pointed at
 * nothing whenever a host was framing us, which is exactly when this branch
 * runs. `Nothing` in `app.tsx` says where the journeys are, underneath.
 */
export function Sight({
  framed,
  refused,
  epic,
  journey,
  live,
  busy = false,
}: {
  framed: boolean
  refused: string | null
  /** What the host named, which is not the same question as what was found. */
  epic: string | null
  journey: JourneyView | null
  live: Live | null
  /** Whether the trackers are being read again right now. */
  busy?: boolean
}) {
  /* Standing on its own, it says nothing. A paragraph used to open the page
     here about what the store holds and what a tracker would have added, and
     it read as a disclaimer in front of a page that works. What is missing is
     said where it is missing: beside each reference, by its own badge. */
  if (!framed) return null
  const { lead, rest } = read(refused, epic, journey, live, busy)
  return (
    <p className="my-3 rounded-md border border-l-2 border-l-marker bg-card px-3 py-2 text-[0.85rem] leading-6 text-muted-foreground">
      <b className="text-foreground">{lead}</b> {rest}
    </p>
  )
}

function read(
  refused: string | null,
  epic: string | null,
  journey: JourneyView | null,
  live: Live | null,
  busy = false,
): { lead: string; rest: string } {
  if (refused) return { lead: 'Framed, and refused.', rest: refused }
  if (!journey) {
    /* The branch that used to be blind. `epic` is what the context named and
       `journey` is what was found; asking only the second question cannot tell
       these two apart, which is how the false clause came to be printed first. */
    if (!epic) return { lead: 'Framed, nothing open.', rest: 'The host has no epic on the canvas.' }
    return { lead: 'Framed, no journey here.', rest: `This project holds none called ${epic}.` }
  }
  /* Busy first: it is the one thing here that is about to change by itself,
     and a reader looking at the states below should know they are the
     reading before the one that is coming. */
  if (busy) {
    return {
      lead: `Framed, reading ${journey.slug} — the trackers are being read again.`,
      rest: live
        ? 'The states below are the reading before this one, and are replaced when it lands.'
        : 'The states beside the references arrive when it lands.',
    }
  }
  return {
    lead: `Framed, reading ${journey.slug}.`,
    rest: live
      ? 'The journey and its steps are this app’s. What each reference is doing comes from the tracker reading ' +
        'the host keeps for every module, read with the person’s own sign-in: this app holds no credential and ' +
        'calls no tracker. The host’s refresh control reads it again. An agent’s own report of where work ' +
        'stands is not in that, and the rail does not pretend to it.'
      : 'The host has not handed over a tracker reading — either tracker.get was refused, or nothing has been ' +
        'read yet. The journey below is complete; the states beside the references are not there.',
  }
}
