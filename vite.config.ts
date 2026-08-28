import type { IncomingMessage } from 'node:http'

import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, answer, openStore } from './doors.ts'
import { page } from './page/document.ts'

/**
 * Every door this app answers on, served by the one process that serves the
 * page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else.
 *
 * That argument is usually made about the manifest and the health check. Here
 * it reaches further, because this module is not like Atlas or References:
 * **it holds its own material.** The page fetches `/api/journeys` and
 * `/api/journey` as relative paths, which is how the app works with nothing
 * else running at all. A store on a second port would make every one of those
 * fetches cross-origin from a page on an opaque origin — which is to say,
 * refused — and would mean this app could not read its own journeys inside the
 * frame it was extracted to live in. So the store is middleware here, in front
 * of the same server that serves the page, and `doors.ts` holds the deciding
 * without holding a socket.
 *
 * ## Why the page is generated rather than a file
 *
 * `/app` is answered here with a document this process builds, and then run
 * through Vite's own `transformIndexHtml` so that the client and the module
 * graph are injected exactly as they would be for an `index.html` on disk. The
 * reason is the write ticket: it is minted once per process and has to reach
 * the page without being fetchable on a door of its own. See `TICKET` in
 * `doors.ts`.
 *
 * It also sidesteps the collision Atlas lost half a day to. `entry` is `/app`,
 * and under Vite dev an extensionless path is not free — a request for `/app`
 * next to an `app.tsx` resolves to that module and answers `200
 * text/javascript` with compiled source. A browser loads such a document
 * happily and runs nothing in it: the frame's `load` fires, the host greets it,
 * and nothing answers. Here `/app` is claimed before Vite's resolver ever sees
 * it, so no file that happens to sit next to this one can take it.
 */
function doors(): Plugin {
  return {
    name: 'journeys-doors',
    configureServer(server) {
      const seeded = openStore()
      if (seeded) {
        server.config.logger.info(`journeys: seeded ${seeded} journeys into this app's own store from seed/.`)
      }

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          if (body === null) {
            response.statusCode = status
            response.end()
            return
          }
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this app and every host
           cannot disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /*
               * Framed by a host and by nothing else — and by nothing at all is
               * fine too, which is what opening this page directly is.
               *
               * `frame-ancestors` is the module's own half of the arrangement:
               * a host says which origins IT will frame, and this says who may
               * frame this. It is deliberately not a list of one: whoever is
               * running this decides, through `ROADMAP_ORIGIN`, and the default
               * is the address the host in this workspace actually serves on.
               */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path === '/mcp' || path.startsWith('/api/')
        if (!ours) return next()

        /* Only the paths above read a body, and only those wait for one. Vite's
           own middleware stack has to keep seeing an unconsumed request for
           everything else. */
        void body(request)
          .then((parsed) => {
            const reply = answer(
              method,
              path,
              url.searchParams,
              parsed,
              readTicket(request.headers['x-journeys-ticket']),
            )
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

/** One header, which node hands over as a string, an array, or nothing. */
function readTicket(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

/**
 * The request body, as JSON, or null.
 *
 * Bounded at a megabyte, because the caller is whatever on this machine found
 * the port — loopback is a fence around the machine and not around the programs
 * on it — and a handler that reads until the socket closes is a handler that
 * can be asked to read forever. A step body is capped at 150 words; nothing
 * this app accepts is anywhere near this size, and the bound is a bound rather
 * than a budget.
 *
 * Unparseable is null rather than a throw, and `doors.ts` says "that was not a
 * request" about it. A malformed body is an ordinary answer to give.
 */
const MAX_BODY_BYTES = 1_000_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The dev server, and the one line in it that decides whether this app can be
 * framed at all.
 *
 * ## `server.cors`, which is not optional for a module
 *
 * A host frames a module WITHOUT `allow-same-origin` unless its manifest
 * declares storage, and this one does not. That puts the page on an opaque
 * origin: it has no origin of its own, and every request it makes carries
 * `Origin: null`. Fine for the document, which the browser navigates to — and
 * fatal for the scripts inside it, because `<script type="module">` is ALWAYS
 * fetched in CORS mode. There is no same-origin shortcut for a module script,
 * and an opaque origin matches nothing, so without a permissive header the
 * browser refuses every one of them.
 *
 * What that looks like from outside is worth knowing, because it has cost this
 * codebase days: the document loads, its `load` event fires, the host greets
 * it, and nothing answers — because no script in it ever ran. The host reports
 * a page that "loaded its page and did not answer the host's greeting", which
 * is true and explains nothing. `curl` cannot see it either, since curl is not
 * subject to CORS, so every door answers 200 with exactly the right bytes while
 * the app is dead in the frame. The browser console is the only place it shows.
 *
 * It is not free here, and that is worth saying plainly rather than repeating
 * the sentence the other modules use. Atlas and References serve a public page
 * and hold no write path; this app has one, gated on a ticket printed into the
 * document, and a permissive `Access-Control-Allow-Origin` means any page in
 * any tab can now read that document and therefore that ticket. The ticket
 * still does its stated job — a program that guessed the port and posted blind
 * is refused — and it is not, and never was, an authorization check. The essay
 * on `TICKET` in `doors.ts` says the same thing from the other end.
 *
 * ## No alias for `roadmap-module-protocol`
 *
 * There used to be one, in every app here, pointing at the protocol's source in
 * the repository they all used to live in. It is gone and must not come back:
 * the package's `exports` are correct, reaching past them is what made a whole
 * class of bug possible, and a module that resolved its contract differently
 * from the host it talks to is a module testing something nobody ships.
 */
export default defineConfig({
  /**
   * `base: './'`, because this page is served at `/app` here and framed by a
   * host at whatever address that host wrote down. Absolute asset paths are
   * correct in the first case and a guess in the second; relative ones are a
   * fact in both, because the browser resolves them against the document it
   * just fetched.
   */
  base: './',
  plugins: [doors()],
  server: { cors: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
