import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig } from 'vite'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Every door this app answers on is the protocol's `doors()`, served by the one process that
 * serves the page: the manifest at both well-known paths, `/app` (generated, with the process
 * ticket and the build printed into it, `no-store`, `frame-ancestors`), and `/healthz`, `/mcp` and
 * `/api/*` through `answer` in `doors.ts`. See the protocol's docs/module-plumbing.md.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing — and here that reaches further than the manifest,
 * because **this module holds its own material.** The page fetches `/api/journeys` and
 * `/api/journey` as relative paths, which is how the app works with nothing else running at all.
 * A store on a second port would make every one of those fetches cross-origin, and this app could
 * not read its own journeys inside the frame it lives in. So the store is middleware in front of
 * the same server that serves the page, and `doors.ts` holds the deciding without holding a socket.
 *
 * ## Why the page is generated rather than a file
 *
 * The write ticket is minted once per process and has to reach the page without being fetchable
 * on a door of its own: a `GET /api/ticket` would be the ticket abolished with extra steps. So
 * `/app` is a document `doors()` builds (`pageDocument`) and runs through Vite's
 * `transformIndexHtml`, with the ticket in an inert JSON island. See `TICKET` in `doors.ts`.
 */

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
 * ## No alias for `kehikot-module-protocol`
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
 *
 * ## And no `server.port`, because `serves()` decides it
 *
 * 7840 was written on the `bunx vite` line in `run.sh` and again in
 * `register.ts`, and true in neither the moment something else had the port:
 * `--strictPort` meant this app printed `Error: Port 7840 is already in use` and
 * exited 1, so a program with no interest in journeys could stop the journeys
 * from opening. It is `PREFERRED_PORT` in `manifest.ts` now, said once beside
 * the id and read from there by this file and `register.ts` both.
 *
 * `serves()` is FIRST in the plugin list, and for the same kind of reason
 * `doors()` comes before `react()`: it has to claim a port before anything else
 * in this config asks for one. A free 7840 is taken in silence; this module
 * already answering there ends the start cleanly rather than putting a second
 * writer on one `journeys.json`; anything else is a loud move to the next free
 * port with the registration rewritten to the port the server ACTUALLY bound,
 * read off `httpServer.address()` after `listening` rather than off what was
 * asked for.
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
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    doors({ manifest: MANIFEST, answer, build: BUILD, page: { title: 'Journeys', ticket: TICKET } }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
