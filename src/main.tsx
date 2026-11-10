import './index.css'
/**
 * Imported for its side effect, and the order on this page is the whole point.
 *
 * The client installs the one `message` listener at module scope, so it is
 * listening as part of this bundle being evaluated — which is before React has
 * rendered anything, let alone run an effect. The host greets on the frame's
 * `load` event, and effects run strictly after that, so a listener installed in
 * `useEffect` is installed after the greeting has already been posted and thrown
 * away. See the essay in the client's `mailbox.ts`; it is a bug that costs an
 * afternoon and whose only symptom is a container reporting a module that will
 * not speak.
 *
 * It is imported HERE, from the entry, rather than from `journeys.ts` — a
 * module scope that only a lazily-loaded chunk imports is a module scope that
 * has not run yet, which is the same bug wearing a bundler's clothes.
 */
import 'kehikot-module-protocol/client'
import { mountPage } from 'kehikot-module-protocol/client/mount'

import { App } from './app.tsx'
import { start } from './journeys.ts'
import { pageFallback } from './view/boundary.tsx'

/**
 * The conversation, then React.
 *
 * `start` before `mountPage` for the reason above: it subscribes to the mailbox, and a greeting
 * that has already arrived is replayed to it rather than lost — which cannot be true of anything
 * that first runs in an effect.
 *
 * There is no theme seeded here any more. The document `doors()` serves decides `dark` or `light`
 * in a blocking script in its head, before the first paint and before this bundle has loaded —
 * from what the host said last time, or the machine's preference for a page nothing frames.
 */
start()

/*
 * `mountPage` (protocol 2.70.0): StrictMode, and the protocol's `ReportErrors` around the page, so a
 * render that throws is told to the host and nothing leaves an empty dark frame behind (#39). Its
 * fallback is this page's own words and Reload (`PageFailed`).
 */
mountPage('root', <App />, { fallback: pageFallback })
