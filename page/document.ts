import { STYLES } from './styles.ts'

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
 * ## What is in the markup, and what is drawn
 *
 * Almost nothing is written here. The heading, the sight box's container, the
 * picker's container and the reading column are all that the document carries;
 * every journey, step and card is built by the client from what this program's
 * own store answers, because all of it depends on what is in that store.
 *
 * The heading is in the markup but does not always survive: `journeys.ts`
 * removes `#who` when this page is inside a frame. The host now prints the
 * module's name in the pane header and hangs the manifest's `summary` off it as
 * a tooltip, so a page that also printed "Journeys" at the top of itself would
 * be saying the name twice and spending a fixed strip of a 340px-tall pane on
 * the repetition. Unframed there is no pane header and nothing else would ever
 * say what this app is, so the heading stays — the test is `window.parent !==
 * window`, which is answerable before first paint and therefore does not blink.
 * What goes is the app's IDENTITY only. `#where` beside it names the project
 * the open journey belongs to and `#sight` says what this page can currently
 * see, and both are statements about what is open rather than about what this
 * program is called.
 *
 * The one exception is the sentence under the heading, and it is the exception
 * for a reason: it is the only statement on this page that is true before any
 * fetch has returned, true if the store is empty, and true if nothing ever
 * frames this page. A sentence about what this program HOLDS should not itself
 * depend on a request succeeding.
 *
 * ## The one script, and why its type matters
 *
 * `<script type="module">`, which is what Vite serves and what a browser needs
 * in order to `import`. It is also the exact thing an opaque origin cannot
 * fetch without a permissive CORS header — see the essay on `server.cors` in
 * `vite.config.ts`. If this page ever loads in a frame and does nothing at all,
 * that header is the first thing to check and the browser console is the only
 * place it is visible.
 */
const PAGE_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Journeys</title>
<style>__STYLES__</style>
</head>
<body>
<div class="head">
  <h1 id="who">Journeys</h1>
  <span class="where" id="where"></span>
</div>

<p class="sight" id="sight">
  <b>The journeys are this program&rsquo;s own.</b>
  The slugs, the titles, the ledes, the callouts, the steps, their order, what blocks what and what settles
  what are all held here, on this machine, in this app&rsquo;s own store &mdash; readable and editable with
  nothing else running. What a tracker says about any reference is not: that is read by a host, which holds
  the credentials, and handed over if there is one and it said yes. Where it has not, a reference is drawn as a
  reference and marked as unseen, never as unknown and never as closed.
</p>

<div class="picker" id="picker"></div>
<div id="journey"></div>
<p class="said" id="said" aria-live="polite"></p>

<script id="ticket" type="application/json">__TICKET__</script>
<script type="module" src="/page/main.ts"></script>
</body>
</html>
`

/**
 * The page, with the two substitutions made.
 *
 * By replacement rather than by interpolation, so this file holds exactly one
 * template literal — the rule `styles.ts` explains at length, and the reason
 * the stylesheet is not simply inlined here.
 *
 * The replacements are given as FUNCTIONS. `String.replace` reads `$&`, `$1`
 * and friends out of a replacement string, and a ticket is random text that
 * will eventually contain a dollar sign — at which point the page would be
 * served with a mangled ticket and every write would be refused, intermittently,
 * for a reason nobody would find. A function replacement is taken literally.
 *
 * The ticket rides in a `type="application/json"` script rather than in a
 * generated JavaScript literal, because a JSON island is inert: the browser
 * neither parses nor executes it, and the page reads it with `JSON.parse` off
 * `textContent`. A value written into executable source is the one place
 * `textContent` cannot help.
 */
export function page(ticket: string): string {
  return PAGE_SHELL.replace('__STYLES__', () => STYLES).replace('__TICKET__', () => JSON.stringify(ticket))
}
