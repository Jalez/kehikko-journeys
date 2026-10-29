import { EVENT, type Pointing } from '../pointing.ts'

/**
 * How the page hears where an agent has pointed, without calling the server.
 *
 * One `EventSource` per open journey, on `/api/pointing/events`: the server
 * sends the pointer as it stands when it connects and one event per change.
 * `EventSource` reconnects by itself when the connection drops, and the server
 * says the pointer again then, which the page takes in once (the same `at` is
 * never followed twice). Nothing here asks on a timer.
 *
 * - A page that is hidden has no stream: it is closed, and opened again on
 *   show, so a tab nobody sees costs the server nothing and is not "open".
 * - A different journey, or a different project, is a different stream.
 * - With no journey open there is no stream.
 *
 * Every outside thing is handed in, so a test can drive it with a fake source.
 */

/** The part of `EventSource` this uses. */
export interface Source {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void
  close(): void
}

export interface Following {
  /** What to listen to now: the stream's address, or null for nothing to listen to (no journey, no project). */
  want(): string | null
  hidden(): boolean
  open(address: string): Source
  /** What the page makes of the pointer the stream said, for the stream at `address`. */
  take(address: string, pointing: Pointing | null): void
}

export interface Follower {
  /** Say that something this depends on may have changed: the journey, the project, whether the page is shown. */
  check(): void
  stop(): void
}

export function follower(how: Following): Follower {
  let at: string | null = null
  let source: Source | null = null
  const close = () => {
    source?.close()
    source = null
    at = null
  }
  return {
    check() {
      const wanted = how.hidden() ? null : how.want()
      if (wanted === at) return
      close()
      if (wanted === null) return
      at = wanted
      const opened = how.open(wanted)
      source = opened
      opened.addEventListener(EVENT, (event) => {
        /* A stream that has been let go says nothing more. */
        if (source !== opened) return
        try {
          const said = JSON.parse(event.data ?? 'null') as { pointing?: Pointing | null } | null
          how.take(wanted, said?.pointing ?? null)
        } catch {
          /* Not something this server sent: ignored. */
        }
      })
    },
    stop: close,
  }
}

/** The stream's address for one journey of one project. */
export const streamFor = (project: string, slug: string): string =>
  `/api/pointing/events?${new URLSearchParams({ project, slug }).toString()}`
