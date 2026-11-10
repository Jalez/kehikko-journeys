import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one.
 *
 * Registered globally rather than per-file because half the value of these
 * tests is that they run the real components — the words on screen are the
 * thing being asserted, and a fake renderer would let a component say something
 * different from what it says in a browser.
 */
GlobalRegistrator.register()

/**
 * No case waits out the client's own deadline for an answer.
 *
 * Most cases leave a question to the host unanswered (a tracker read, `content.changed`, a pick),
 * and the client refuses it as `silent` after `ANSWER_WITHIN_MS`, whereupon the page SAYS so on the
 * shared line. The whole suite is one process and one page module, so on a runner slow enough to
 * outlast that deadline (macOS CI: about 14s) a timer left by an early case fired in a later one and
 * replaced the sentence it was reading. A case that wants a silent host passes its own `within`,
 * which this leaves alone.
 */
/* `ANSWER_WITHIN_MS` of the protocol's client, spelled here because importing it would load the client before the document exists. */
const ANSWER_WITHIN_MS = 12_000
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
  realSetTimeout(handler, delay === ANSWER_WITHIN_MS ? delay * 1000 : delay, ...rest)) as typeof setTimeout
