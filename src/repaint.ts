/**
 * A repaint after the host shows this page again — the fix for a page that stays black until it
 * is scrolled.
 *
 * ## What was seen
 *
 * "There are situations where it glitches out and then only shows a black screen until you start
 * scrolling." Scrolling changes nothing this page draws: no part of it renders on a scroll, a
 * visible range or an observer (the only listeners on a scroll are the client's kept view, which
 * writes the position 600 ms after it settles, and the wheel taking back an agent's pointer). So
 * what the person was looking at was a page whose DOM was whole and whose PIXELS were not: the
 * black is the dark surface with nothing painted over it.
 *
 * ## Why this page, and when
 *
 * The host hides a page with `visibility: hidden` on the wrapper around its frame, never by
 * removing it (`src/canvas/Frames.tsx` in the host): on another kehikko, folded, and — the part
 * that is this page's alone — while its COVER is up. Journeys is the one module that holds the
 * host's cover until it is drawn (`ready()`, protocol 2.70.0) and asks for it again on every switch
 * of epic or project (`loading()`, 2.84.0, Journeys 1.20.0). So every load, every switch and every
 * reload after the module restarts draws the whole journey, and gives back its kept scroll, inside
 * a frame nobody can see, and the host then flips it visible in one style change. WebKit (the
 * desktop app is a WKWebView) does not always repaint a frame's content when it comes back from
 * `visibility: hidden` with content that changed while hidden: its tiles were last brought up to
 * date for what the frame looked like before, and the next thing that brings them up to date is a
 * scroll. That is the person's remedy, exactly.
 *
 * This is a WebKit painting bug, not something this page draws wrong, and nothing here can see it
 * happen (a test DOM paints nothing). What this does is the remedy, done for the person: shortly
 * after this page says it is drawn, and whenever it is shown again, it scrolls one pixel and back
 * (which is what brings the tiles up to date), and gives the root an opacity a thousandth short of
 * opaque for two frames (which repaints a page too short to scroll). Neither is visible: one pixel
 * for 50 ms, and 0.999.
 */

/** The parts of a document a repaint touches, injectable for the tests. */
export interface Paintable {
  /** The document's scroller (`document.scrollingElement`), or null. */
  box: { scrollTop: number; scrollHeight: number; clientHeight: number } | null
  /** The root element, whose inline opacity is flicked. */
  root: { style: { opacity: string } } | null
  later: (run: () => void, ms: number) => unknown
}

/** How long, in ms, the one-pixel scroll and the opacity are held: past a rendering update, so it is not coalesced away. */
export const HOLD_MS = 50

/** When, in ms after the page is drawn or shown, it is repainted: after the host's own render has flipped the frame visible. */
export const REPAINT_AFTER_MS = [100, 500] as const

/** The flicked opacity: far enough from 1 to be a change WebKit paints, too close to 1 to see. */
export const FLICKED = '0.999'

/** How many repaints have been done in this page's life (for the tests). */
export const repaints = { count: 0 }

/** One repaint: one pixel of scroll and back, and the root's opacity flicked for two frames. */
export function repaint(on: Paintable): void {
  repaints.count++
  const box = on.box
  if (box) {
    const top = box.scrollTop
    const most = box.scrollHeight - box.clientHeight
    if (most >= 1) {
      const moved = top < most ? top + 1 : top - 1
      box.scrollTop = moved
      on.later(() => {
        /* Only put back what is still ours: a person who scrolled meanwhile keeps their scroll. */
        if (box.scrollTop === moved) box.scrollTop = top
      }, HOLD_MS)
    }
  }
  const root = on.root
  if (root && root.style.opacity !== FLICKED) {
    const was = root.style.opacity
    root.style.opacity = FLICKED
    on.later(() => {
      if (root.style.opacity === FLICKED) root.style.opacity = was
    }, HOLD_MS)
  }
}

/** The page's own document, as `repaint` wants it. */
export function thisPage(): Paintable {
  return {
    box: typeof document === 'undefined' ? null : document.scrollingElement,
    root: typeof document === 'undefined' ? null : document.documentElement,
    later: (run, ms) => setTimeout(run, ms),
  }
}

/**
 * Repaint this page a moment after it was shown: after `REPAINT_AFTER_MS`, each time. Asked again
 * before those have run, it starts over, so a burst of reasons repaints once.
 */
export function repainter(page: () => Paintable = thisPage): { soon(): void } {
  let timers: ReturnType<typeof setTimeout>[] = []
  return {
    soon() {
      for (const timer of timers) clearTimeout(timer)
      timers = REPAINT_AFTER_MS.map((ms) => setTimeout(() => repaint(page()), ms))
    },
  }
}
