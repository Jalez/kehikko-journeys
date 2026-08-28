/**
 * The document, assembled per request.
 *
 * ## Why this is still a string and not an `index.html`
 *
 * Every other module here ships a static `index.html` and lets Vite serve it.
 * This one cannot, for one reason: the ticket. It is minted once per process
 * and has to reach the page WITHOUT being fetchable on a door of its own — a
 * `GET /api/ticket` would be a route that hands the write credential to
 * anything that asks, which is the ticket abolished with extra steps. So the
 * document is generated, the ticket goes into it, and `vite.config.ts` runs the
 * result through `transformIndexHtml` so that Vite's own client and module
 * graph are injected exactly as they would be for a file on disk.
 *
 * ## Almost nothing is drawn here
 *
 * There is a root element, one sentence inside it, and an inert JSON island.
 * Every journey, step and card is built by React from what this program's own
 * store answers, because all of it depends on what is in that store — and
 * because the page has to be able to redraw after an edit without this file and
 * the client holding two versions of the same sentence.
 *
 * The stylesheet used to be inlined here as a string, and is not any more. It
 * is `src/index.css`, which Vite serves and Tailwind builds; the round trip
 * that inlining saved is not worth a stylesheet that no tool in the repository
 * can read.
 *
 * ## The one sentence that is written here, and why it is the exception
 *
 * It is the only statement on this page that is true before any fetch has
 * returned, true if the store is empty, and true if nothing ever frames this
 * page. A sentence about what this program HOLDS should not itself depend on a
 * request succeeding, or on a bundle having been evaluated. It sits inside
 * `#root`, so React replaces it with the live page on mount — which means it is
 * on screen for exactly the window in which nothing better can be, and gone
 * without a flicker of duplication the moment there is.
 *
 * The heading that used to sit above it is gone from the markup and is decided
 * in `app.tsx` instead, off `window.parent !== window`. That test is answerable
 * before first paint too, so nothing blinks; what changed is only that the
 * decision now lives beside the thing it removes.
 *
 * ## The ticket rides in a JSON island
 *
 * `type="application/json"` rather than a generated JavaScript literal, because
 * a JSON island is inert: the browser neither parses nor executes it, and the
 * page reads it with `JSON.parse` off `textContent`. A value written into
 * executable source is the one place `textContent` cannot help.
 *
 * ## The one script, and why its type matters
 *
 * `<script type="module">`, which is what Vite serves and what a browser needs
 * in order to `import`. It is also the exact thing an opaque origin cannot
 * fetch without a permissive CORS header — see the essay on `server.cors` in
 * `vite.config.ts`. If this page ever loads in a frame and does nothing at all,
 * that header, or the `storage: true` that makes it unnecessary, is the first
 * thing to check, and the browser console is the only place it is visible.
 */
const PAGE_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Journeys</title>
</head>
<body>
<div id="root">
  <p style="font:15px/1.6 ui-sans-serif,system-ui,sans-serif;margin:1rem;max-width:44rem">
    <b>The journeys are this program&rsquo;s own.</b>
    The slugs, the titles, the ledes, the callouts, the steps, their order, what blocks what and what settles
    what are all held here, on this machine, in this app&rsquo;s own store &mdash; readable and editable with
    nothing else running. What a tracker says about any reference is not: that is read by a host, which holds
    the credentials, and handed over if there is one and it said yes. Where it has not, a reference is drawn as a
    reference and marked as unseen, never as unknown and never as closed.
  </p>
</div>
<script id="ticket" type="application/json">__TICKET__</script>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
`

/**
 * The page, with the substitution made.
 *
 * The replacement is given as a FUNCTION. `String.replace` reads `$&`, `$1` and
 * friends out of a replacement string, and a ticket is random text that will
 * eventually contain a dollar sign — at which point the page would be served
 * with a mangled ticket and every write would be refused, intermittently, for a
 * reason nobody would find. A function replacement is taken literally.
 */
export function page(ticket: string): string {
  return PAGE_SHELL.replace('__TICKET__', () => JSON.stringify(ticket))
}
