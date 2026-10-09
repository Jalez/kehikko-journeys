import { AskFailed, ask, type Asked } from 'kehikot-module-protocol/client'

/**
 * Our own server.
 *
 * Relative paths, because this IS our origin: the document came from this
 * program, so a relative fetch reaches it whether or not anything framed us.
 * This is the line that makes the app an app; the bridge is enrichment, and
 * nothing on this path depends on it.
 *
 * Both `get` and `post` go through the protocol's `ask`, which puts the ticket
 * the server minted for this process and printed into this page in
 * `x-module-ticket` on every write, and notices when this page is older than
 * its server (the page then reloads itself; see `reloadWhenStale` in
 * `main.tsx`). See the essay on `TICKET` in `doors.ts` for what the ticket
 * separates — and the one in `vite.config.ts` for why this module declares
 * storage rather than answering CORS permissively, which is the only thing
 * that keeps the ticket worth anything.
 *
 * ## What the callers get back, which is what they always got
 *
 * `ask` resolves to one typed result; the store in `journeys.ts` was written
 * around the door's own JSON (`ok`, `error`, and whatever else — `nowhere`,
 * `trouble`, `journey`). So an answer is the door's body, and a refusal is the
 * door's body with `ok: false` and the sentence.
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

/** What a caller in `journeys.ts` is handed for one asking; see the essay at the top. */
function refusal<T>(asked: Extract<Asked<T>, { ok: false }>): T {
  const body = asked.body && typeof asked.body === 'object' ? (asked.body as Record<string, unknown>) : {}
  return { ...body, ok: false, error: asked.error } as T
}

/**
 * A read. A server that did not answer THROWS, as `fetch` used to, because the readers in
 * `journeys.ts` say different things in their `catch` than they do about a refusal.
 */
export async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const asked = await ask<T>(path, { query: { project, ...query } })
  if (asked.ok) return asked.body
  if (asked.kind === 'down') throw new AskFailed(asked)
  return refusal(asked)
}

/**
 * A write.
 *
 * The project rides in the BODY, beside the ticket that was issued for it,
 * because the server checks the two against each other — and a pair that can be
 * split across two places in one request is a pair somebody will eventually
 * split. The PROCESS ticket rides in the header, put there by `ask`: it answers
 * a different question (is this page this server's own), and `/api/ticket` is
 * the one call that carries only that — it is how the project-bound one is
 * obtained, so it cannot itself carry one.
 *
 * It never throws. A write nothing answered comes back as `ok: false` with the
 * sentence saying so, like any refusal — most of the writers in `journeys.ts`
 * have no `catch`, and a thrown `fetch` there used to be an unhandled rejection
 * with nothing on screen.
 */
export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const asked = await ask<T>(path, { body: { ...body, project, ...(path === '/api/ticket' ? {} : { ticket: write ?? '' }) } })
  return asked.ok ? asked.body : refusal(asked)
}

/** Ask this app's own server whether it is there, for the cover's Try again. The answer is the standing `ask` records. */
export async function knock(): Promise<void> {
  await ask('/healthz')
}
