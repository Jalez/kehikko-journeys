/**
 * The theme, and the one place that decides it.
 *
 * ## Why this is JavaScript and not a media query
 *
 * `index.css` has no `@media (prefers-color-scheme: dark)` in it, on purpose.
 * That query follows the READER'S OPERATING SYSTEM and knows nothing about the
 * roadmap this page is sitting inside, so a dark canvas on a machine set to
 * light framed this module and got a white rectangle — the first thing anybody
 * notices about a protocol.
 *
 * `roadmap.context.theme` is the answer, it arrives on the greeting and on
 * every switch, and `apply` is the only thing that writes the class. The class
 * is what Tailwind's `dark:` variant keys on AND what the token block keys on,
 * so the two cannot drift: there is no state in which a `dark:` utility is off
 * while the palette is dark.
 *
 * The machine's preference is consulted exactly once, as the seed for a page
 * nothing has framed. That is not the media query coming back in through a
 * window — it is a default for the only case where there is no better opinion
 * available, and it is overwritten the instant a host speaks.
 *
 * `colorScheme` is set alongside, because it is what colours the scrollbar, the
 * form controls the editor uses and the caret in them. A dark page with a white
 * scrollbar down the side of it is the same bug one element narrower.
 */
export type Theme = 'light' | 'dark'

export function apply(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
}

/**
 * The seed, run at import time so that it is decided before first paint.
 *
 * Before first paint and not in an effect: a page that renders light and then
 * turns dark one tick later is a flash somebody sees every single time they
 * open the pane, and the fix for it is to not be light first.
 */
export function seed(): void {
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  apply(dark ? 'dark' : 'light')
}
