import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, answer } from './doors.ts'
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
      /*
       * Nothing is opened here any more, and the absence is the change.
       *
       * This used to seed an empty store from `seed/` before the first request,
       * so that whoever started the program saw a count. There is no store to
       * open at startup now: the journeys live inside whichever project a host
       * says is open, and no host has said anything yet. A line printed here
       * would be a count of journeys in a project this process has not been
       * told about — see the note on seeding in `store.ts` for why filling one
       * automatically is the wrong thing regardless.
       */
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
 * ## No `server.cors` — this module declares storage instead
 *
 * Every other module here sets `cors: true` and has to. A host frames a module
 * WITHOUT `allow-same-origin` unless its manifest declares storage, which puts
 * the page on an opaque origin — and `<script type="module">` is ALWAYS fetched
 * in CORS mode, so with no permissive header not one script in the page runs.
 * The document loads, `load` fires, the host greets it, and nothing answers.
 * `curl` cannot see it, being unsubject to CORS; only the browser console can.
 * That has cost this codebase days.
 *
 * This module went that way first and it was wrong, for a reason the others do
 * not have: this one OWNS data and takes writes, gated on a ticket printed into
 * `/app`. A permissive `Access-Control-Allow-Origin` means any page in any tab
 * can read that document, and therefore that ticket, off loopback — and then
 * write here. Measured rather than theorised:
 *
 *     $ curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app
 *     Access-Control-Allow-Origin: *
 *     ...ticket" type="application/json">"e75d4d01-…
 *
 * So the manifest declares `storage: true` and this line is gone. With a real
 * origin, this page's scripts and its `/api` calls are ordinary same-origin
 * requests: no CORS is involved at all, nothing is offered to strangers, and
 * the ticket is unreadable from anywhere but inside. The essay in `manifest.ts`
 * says why this module asks for an origin and why the others should not.
 *
 * ## No alias for `roadmap-module-protocol`
 *
 * There used to be one, in every app here, pointing at the protocol's source in
 * the repository they all used to live in. It is gone and must not come back:
 * the package's `exports` are correct, reaching past them is what made a whole
 * class of bug possible, and a module that resolved its contract differently
 * from the host it talks to is a module testing something nobody ships.
 *
 * The `@` alias below is a different thing entirely — it points inside this
 * repository, at `src`, and is what shadcn's generated components import
 * through.
 *
 * ## Why `doors()` is first in the list, and stays first
 *
 * `entry` is `/app`, and under Vite dev an extensionless path is not free: a
 * request for `/app` next to an `app.tsx` resolves to that module and answers
 * `200 text/javascript` with compiled source. A browser loads such a document
 * happily and runs nothing in it — the frame's `load` fires, the host greets
 * it, and nothing answers. This repository now HAS a `src/app.tsx`, which is
 * exactly that collision, so the order below is load-bearing rather than
 * defensive: `/app` is claimed before Vite's resolver ever sees it. Atlas lost
 * half a day to this before it was written down.
 *
 * ## No `tailwind.config.js`, and there must not be one
 *
 * Tailwind 4 is configured in CSS. The palette, the `dark` variant and the
 * theme tokens are all in `src/index.css`, and `@tailwindcss/vite` is the whole
 * of the build wiring. A config file beside it would be a second place to look
 * that the tool no longer reads.
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
  plugins: [doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
