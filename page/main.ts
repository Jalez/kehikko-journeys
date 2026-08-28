import { start } from './journeys.ts'

/**
 * The entry point, and it is three lines for a reason.
 *
 * The import on the first line is the one that matters: `journeys.ts` pulls in
 * `wire/host.ts`, which pulls in `wire/mailbox.ts`, which installs the page's
 * message listener AT IMPORT TIME. By the time this file's own body runs, the
 * page is already listening — so a greeting that arrives while `start()` is
 * still setting up is recorded and replayed rather than lost.
 *
 * `start()` is a function rather than the body of `journeys.ts` so that the
 * module can be imported by a test without a page appearing underneath it.
 */
start()
