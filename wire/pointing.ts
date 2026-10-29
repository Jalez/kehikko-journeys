/**
 * The pointer's wire, shared by the server (`pointing.ts`) and the page (`src/following.ts`). Kept
 * apart from `pointing.ts` so the page's bundle takes none of the server's imports.
 */

export interface Pointing {
  /** The step's 1-based position in the journey, as the page numbers its cards. */
  step: number
  /** The step's title, so the page can say what it is pointed at without reading the journey again. */
  title: string
  /** One line of the agent's, plain text, shown beside the card; '' for none. */
  say: string
  /** When it was pointed, which is also what tells the page a pointer is new. */
  at: string
}

export const SAY_MAX = 300

/** The name of the one event on the stream; its data is `{ pointing }`, the pointer or null. */
export const EVENT = 'pointing'
