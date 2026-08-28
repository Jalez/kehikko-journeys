/**
 * Our own server.
 *
 * Relative paths, because this IS our origin: the document came from this
 * program, so a relative fetch reaches it whether or not anything framed us.
 * This is the line that makes the app an app; the bridge is enrichment, and
 * nothing on this path depends on it.
 *
 * Writes carry a ticket the server minted for this process and printed into
 * this page. See the essay on `TICKET` in `doors.ts` for what it separates —
 * and the one in `vite.config.ts` for why this origin must never answer CORS
 * permissively, which is the only thing that keeps the ticket worth anything.
 */

export const TICKET: string = (() => {
  const island = document.getElementById('ticket')
  try {
    const parsed: unknown = JSON.parse(island?.textContent ?? '""')
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    /* A document served without a ticket is a document this server did not
       build — a cached file, a proxy, somebody's `curl > page.html`. Every
       write will be refused, which is the correct outcome and is said in the
       refusal rather than guessed at here. */
    return ''
  }
})()

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  return (await response.json()) as T
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-journeys-ticket': TICKET },
    body: JSON.stringify(body ?? {}),
  })
  return (await response.json()) as T
}
