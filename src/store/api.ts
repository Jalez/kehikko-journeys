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
 * and the one in `vite.config.ts` for why this module declares storage rather
 * than answering CORS permissively, which is the only thing that keeps the
 * ticket worth anything.
 *
 * ## Every call names a project, and this file is where that is not forgotten
 *
 * The journeys live inside the project they are about, so a request that did
 * not say which project is a request the server cannot answer. Rather than
 * every call site remembering to add it — a rule that holds right up until
 * somebody adds the twelfth call site — the project is held here and both `get`
 * and `post` attach it.
 *
 * `null` is a real state: no project is open. Calls still go out and the server
 * answers honestly that there is nowhere to read, and the page draws that. What
 * is NOT done is guessing, here or on the other side.
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

/**
 * Which project this page is standing in, and the write ticket for it.
 *
 * Two values that must move together, which is why they are set together and
 * never separately. The ticket is bound to the project — one taken out for A
 * does not redeem against B, see `writeTicketFor` in `doors.ts` — so a page
 * holding B's project with A's ticket has its writes refused, and holding A's
 * project with B's ticket has them refused the other way. Neither is a state
 * this file can be put into: `standIn` replaces both or leaves both alone.
 */
let project: string | null = null
let write: string | null = null

/** What this page believes it is standing in. */
export function standingIn(): string | null {
  return project
}

/**
 * Move to a project, and take out the write ticket for it before anything is
 * saved.
 *
 * The ticket is fetched rather than derived, because deriving it needs a secret
 * this page does not have and must not: it is a hash of the process ticket and
 * the RESOLVED project path, and only the server can do the `realpath`.
 * `POST /api/ticket` is refused without the process ticket printed into this
 * document, so what comes back is available only to something that could
 * already write; what it adds is that the ticket names one project.
 *
 * Awaited by whoever switches project, so a save composed after the switch
 * cannot go out with the ticket from before it. A failure leaves `write` null
 * and every write is then refused by the server with its own sentence, which is
 * the right outcome — better a refusal than a step filed under the wrong
 * project.
 */
export async function standIn(next: string | null): Promise<{ ok: boolean; error?: string }> {
  project = next
  write = null
  if (next === null) return { ok: true }
  try {
    const out = await post<{ ok: boolean; error?: string; ticket?: string }>('/api/ticket', {})
    if (!out.ok || !out.ticket) return { ok: false, error: out.error ?? 'this app would not issue a write ticket' }
    write = out.ticket
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** The project as a query fragment, for the two doors that read. */
function asking(): string {
  return project === null ? '' : `project=${encodeURIComponent(project)}`
}

export async function get<T>(path: string, query = ''): Promise<T> {
  const parts = [asking(), query].filter(Boolean).join('&')
  const response = await fetch(parts ? `${path}?${parts}` : path)
  return (await response.json()) as T
}

/**
 * A write.
 *
 * The project rides in the BODY, beside the ticket that was issued for it,
 * because the server checks the two against each other — and a pair that can be
 * split across two places in one request is a pair somebody will eventually
 * split.
 *
 * `/api/ticket` is the one call that goes out with the process ticket: it is
 * how the project-bound one is obtained, so it cannot itself carry one.
 */
export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const ticket = path === '/api/ticket' ? TICKET : (write ?? '')
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-journeys-ticket': ticket },
    body: JSON.stringify({ ...body, project }),
  })
  return (await response.json()) as T
}
