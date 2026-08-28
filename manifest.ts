import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.journeys'
export const VERSION = '1.0.0'

/**
 * What this app says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads. Everything else here works with nothing on the other end — so
 * read this as a description of the ENRICHMENT, not of the app: it says which
 * tab to give the page, and which ONE question the app would like to be allowed
 * to ask if there is anybody there to ask.
 *
 * ## Why the list of capabilities is one line long, and what that line means
 *
 * Every other module extracted from this roadmap declares `epics:read` and
 * `steps:read`, because the epics are somebody else's and they need to be
 * handed them. This one declares neither, and the absence is the whole claim of
 * the extraction:
 *
 * - **`epics:read` — not declared.** This app HOLDS the journeys. Asking a host
 *   which epics exist would be asking somebody else to answer a question about
 *   our own store, and the two answers would then have to be reconciled on
 *   screen by a reader who never asked for two.
 * - **`steps:read` — not declared**, for the same reason and more sharply: the
 *   steps are the thing this app is for. A journeys app that read its steps
 *   over a bridge would be a viewer, and a viewer is precisely what the
 *   extraction says this must stop being.
 * - **`live:read` — declared, and it is the only thing declared.** What the
 *   last refresh saw of each reference: a state, a title, the tracker's own
 *   labels, who is on it. That is genuinely somebody else's — the host holds
 *   the credentials, reads GitHub and GitLab once, and hands over what it read.
 *   Four apps each polling a tracker is four times the rate limit spent on one
 *   answer and four snapshots disagreeing on one screen. Without it the page
 *   still draws every journey, every step and every reference; the cards say,
 *   in words, that their state cannot be seen from here.
 * - **`stage:report` — not declared.** Saying where work has got to belongs to
 *   whoever is doing it. This app draws a rail; it does not report onto one.
 *   See the note in `page/journeys.ts` about what the rail can and cannot know.
 * - **`view:navigate` — not declared, and this one is a judgement rather than a
 *   principle.** Protocol 2 gives a module a way to ask the host to move, and
 *   this app is the panel a reader is already standing in: what it wants is to
 *   be walked TO, which is `roadmap.goto` arriving and needs no declaration.
 *   The day the picker on this page should switch the HOST's open epic rather
 *   than only this page's own view, this is the line that changes.
 * - **Tracker access — not declared, and there is no capability for it.** This
 *   app never speaks to GitHub or GitLab, holds no credential, and has no code
 *   path that could.
 * - **No extensions.** Emitting a notification every time a step body is edited
 *   is a panel full of noise, and `consumes` is not implemented anywhere yet,
 *   so declaring it would be declaring an intention this app cannot act on.
 *
 * And per the protocol's own README: a declaration is not a request and is not
 * answered. The host refuses whatever it likes at every call whatever is
 * written here, so the page is built to be refused — `live` arriving is drawn
 * as enrichment, and its absence is drawn as absence rather than as "closed".
 *
 * ## The mode, and the word that changed under it
 *
 * One epic-scoped mode, which becomes an ordinary tab in the mode row beside
 * every other module's. There is no privileged read, no special case and no
 * back door: this is the panel the roadmap is named after, arriving through the
 * same door as everything else.
 *
 * `scope: 'epic'` where protocol 1 said `journey`. That rename is what raised
 * the protocol number, and it is not cosmetic here: an epic-scoped mode is told
 * which epic is open by `roadmap.context`, on load and on every switch, and
 * that is the only inbound channel carrying WHERE the reader is standing. The
 * word this app uses for its own stored documents is still `journey` — see the
 * note at the top of `page/journeys.ts` on why the wire's vocabulary is
 * translated at the wire rather than pushed down into the store.
 *
 * ## No storage, and therefore an opaque origin
 *
 * The page keeps its ticket and its open journey in memory and forgets both on
 * reload, so there is nothing to store, so asking for an origin back would be
 * asking for a thing it has no use for. The consequence is the one every module
 * here has been bitten by: the frame has no origin of its own, module scripts
 * inside it are fetched in CORS mode against an origin that matches nothing,
 * and the server has to say so. See `server.cors` in `vite.config.ts`.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on
   * the wire. That cuts both ways: running it HERE is the cheapest way for this
   * app to learn it has written a manifest no host will accept, and to learn it
   * when this file is imported rather than from a host's refusal in somebody
   * else's log.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Journeys',
  version: VERSION,
  summary: 'What has to become true for a user, step by step, and where every piece of it stands.',
  entry: '/app',
  modes: [{ id: 'journeys', label: 'Journeys', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'The journeys and their steps: read one, write a step, say what blocks what.',
  },
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['live:read'],
    storage: false,
  },
  health: '/healthz',
})
