/**
 * The one rule about a step's prose that both halves of this app have to know.
 *
 * It lives in a file of its own because of who needs it: the store enforces it
 * on the write path, and the editor on the page counts words into a box beside
 * the textarea so nobody discovers the limit by being refused. `store.ts` reads
 * files and cannot be imported into a browser, so a shared constant is the only
 * way for the two to agree — and they have to agree, because a page that says
 * "148 / 150" over prose the server is about to refuse is worse than a page
 * with no counter at all.
 */

/**
 * How long a step body may be, and why it is enforced on the write path only.
 *
 * The cards under a step already list every issue and merge request it covers,
 * so a body that recounts them is the list again in prose. The limit bites
 * where somebody is writing; it is deliberately NOT on the read path, because a
 * limit there turns twelve overlong bodies written before it existed into a
 * journey that will not load at all.
 */
export const BODY_WORDS = 150

export function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * Why this body is too long, or null when it is not. Refused rather than
 * trimmed: cutting somebody's last sentence off mid-air is worse than saying it
 * is too long and letting them choose what goes.
 */
export function tooLong(body: string): string | null {
  const n = wordCount(body)
  if (n <= BODY_WORDS) return null
  return `A step body runs to ${BODY_WORDS} words at most; this one is ${n}. Say what the step is for and what stands in the way — the cards below already list every issue and merge request, so prose that recounts them is the list again in longhand.`
}
