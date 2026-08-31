import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
/**
 * Imported for its side effect, and the order on this page is the whole point.
 *
 * `mailbox.ts` installs the one `message` listener at module scope, so it is
 * listening as part of this bundle being evaluated — which is before React has
 * rendered anything, let alone run an effect. The host greets on the frame's
 * `load` event, and effects run strictly after that, so a listener installed in
 * `useEffect` is installed after the greeting has already been posted and thrown
 * away. See the essay in `mailbox.ts`; it is a bug that costs an afternoon and
 * whose only symptom is a container reporting a module that will not speak.
 */
import '../wire/mailbox.ts'
import { App } from './app.tsx'
import { start } from './journeys.ts'
import { seed } from './theme.ts'

/**
 * The theme before the first paint, then the conversation, then React.
 *
 * `seed` first because a page that renders light and turns dark one tick later
 * is a flash somebody sees every time they open the container. `start` before
 * `createRoot` for the reason above: it subscribes to the mailbox, and a
 * greeting that has already arrived is replayed to it rather than lost — which
 * cannot be true of anything that first runs in an effect.
 */
seed()
start()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
