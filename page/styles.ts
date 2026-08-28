/**
 * The stylesheet, as one string.
 *
 * It is a file of its own because it is a single enormous backtick literal: a
 * stray backtick anywhere inside it closes the string, and what that looks like
 * from the outside is a page that serves half a stylesheet followed by a syntax
 * error in the middle of the markup. One literal per file means a mistake here
 * cannot take the document shell in `document.ts` down with it.
 *
 * It is still a string rather than a `.css` file Vite would serve, because the
 * document is generated — see `document.ts` on the ticket — and a generated
 * document inlining its own stylesheet is one round trip rather than two, on a
 * page that is drawn inside somebody else's frame.
 *
 * Two things this page has to get right visually, and both are about honesty
 * rather than taste:
 *
 * - **A reference whose state cannot be seen must not look like a reference
 *   that is open, and must not look closed either.** So `.tone-unseen` is a
 *   dashed outline in the muted colour and carries no fill at all. Every other
 *   tone is filled. The eye reads "there is nothing here to read" before the
 *   words are read, which is the correct first impression.
 * - **The rail's last dot is never filled.** Whether something is in
 *   production is read from a repository, and this app has no repository. A
 *   filled dot there would be a claim; the hollow one is the truth.
 *
 * `color-scheme: light dark` and the system palette, because the frame around
 * this page has a theme of its own and a module that painted a white page into
 * a dark roadmap would be the first thing anybody noticed about the protocol.
 *
 * The system palette is not enough on its own, and that is why `[data-theme]`
 * appears below. `prefers-color-scheme` follows the READER'S OPERATING SYSTEM
 * and knows nothing about the host: a dark roadmap on a machine set to light
 * would frame this page and get a white rectangle, which is exactly the failure
 * the paragraph above says must not happen. So the host's own answer — it
 * arrives on every `roadmap.context` as `theme` — is written onto the root
 * element and wins where it is set. Where nothing has set it, which is what
 * standing alone looks like, the media query decides, because then the reader's
 * system is the only opinion available.
 *
 * ## Why the page paints its own background instead of borrowing one
 *
 * The palette above was already switching correctly and the page was still a
 * white rectangle in a dark roadmap, which is worth writing down because the
 * mechanism is invisible from inside this file. `--bg` used to be
 * `transparent`, on the reasonable-sounding theory that a module which paints
 * nothing borrows whatever the host has painted behind it. Measured in the real
 * frame, the host's own `<iframe>` element computes to
 * `background-color: rgb(255, 255, 255)` — a white sheet between this document
 * and the host's near-black page. So "transparent" did not mean "the roadmap's
 * background"; it meant white, in both themes, forever, with #ece8e3 text on
 * top of it in the dark one. That is not a subtle mis-shade; it is unreadable.
 *
 * So the decision, deliberately: this module paints its own opaque surface, and
 * matches the numbers its neighbours use rather than inventing warm ones —
 * `#ffffff` light and `#0a0a0a` dark are what the References and Atlas panes
 * compute to in the same roadmap. Sharing a surface with the panes either side
 * is worth more than a background that agrees with this page's own warm ink.
 *
 * It is set on `html` as well as `body`, rather than leaning on the propagation
 * of a body background up to the canvas. Body-to-canvas propagation is real and
 * would work, but it is conditional on the root having no background of its own
 * and it interacts with containment — and `html` is a container now, for the
 * reason the next section gives. A background that depends on two other rules
 * staying absent is the same class of bug as the one above.
 *
 * ## Why the small-pane rules are container queries
 *
 * This module is framed in panes that are routinely 220 to 400 pixels wide
 * inside a window that is a couple of thousand. A viewport breakpoint asked the
 * wrong question here every single time: the window is never narrow, and the
 * pane usually is. So `html` carries `container-type: inline-size` and the
 * narrow rules below query `pane`, which is the box this page is actually
 * given.
 *
 * The measured failure was not the obvious one. Nothing was styled too wide;
 * the layout had a MIN-CONTENT FLOOR of 492px at every pane size, which is a
 * different bug with the same symptom. Two things built it: `.card .title` held
 * a hard `min-width: 12rem` while being a flex item, and long unbreakable
 * strings in the prose — file paths, `docs/data-inventory.md`, tracker titles
 * written by somebody else — could not break at all, so each one set a floor
 * under its own paragraph. Hence `overflow-wrap: anywhere` inherited from the
 * body and `min-width: 0` on every flex item that holds text. `anywhere`
 * rather than `break-word` on purpose: only `anywhere` lowers the min-content
 * contribution, and lowering it is the entire fix.
 *
 * Nothing here truncates. There is no `text-overflow` and no `overflow: hidden`
 * on anything holding words, because a clipped tracker title in a 220px pane is
 * a reader who cannot tell which issue they are looking at, and this app's whole
 * argument is against a screen that quietly says less than it knows.
 */
export const STYLES = `
:root {
  color-scheme: light dark;
  --ink: #1c1917;
  --muted: #6b6560;
  --line: #e0dcd7;
  --bg: #ffffff;
  --card: rgba(0,0,0,.02);
  --open: #1f6feb;
  --merged: #6f42c1;
  --closed: #57606a;
  --draft: #9a6700;
  --block: #b3261e;
  --accent: #0b7285;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink: #ece8e3;
    --muted: #a29a92;
    --line: #35302b;
    --bg: #0a0a0a;
    --card: rgba(255,255,255,.03);
    --open: #6ea8ff;
    --merged: #b98cff;
    --closed: #9aa0a6;
    --draft: #d9a441;
    --block: #ff8a80;
    --accent: #6cc6d6;
  }
}
:root[data-theme="dark"] {
  --ink: #ece8e3;
  --muted: #a29a92;
  --line: #35302b;
  --bg: #0a0a0a;
  --card: rgba(255,255,255,.03);
  --open: #6ea8ff;
  --merged: #b98cff;
  --closed: #9aa0a6;
  --draft: #d9a441;
  --block: #ff8a80;
  --accent: #6cc6d6;
}

* { box-sizing: border-box; }

/* The pane, named, so the rules at the bottom can ask how wide THIS is rather
   than how wide the window is. The background lives here as well as on body:
   see the essay above on why it is not left to propagate. */
html {
  container-type: inline-size;
  container-name: pane;
  background: var(--bg);
}

body {
  font: 15px/1.6 ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif;
  margin: 0;
  padding: 1rem 1rem 4rem;
  color: var(--ink);
  background: var(--bg);
  max-width: 60rem;
  /* Inherited by everything, and the reason a 220px pane can lay this page out
     at all. Tracker titles and file paths are somebody else's strings and one
     unbreakable token in one of them used to widen the whole document. */
  overflow-wrap: anywhere;
}

.head { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; margin-bottom: .2rem; }
h1 { font-size: 1.15rem; margin: 0; letter-spacing: -.01em; }
.where { color: var(--muted); font-size: .85rem; }

/* What this app can see from here. A box, at the top, never a tooltip. */
.sight {
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: .55rem .7rem;
  margin: .8rem 0 1.2rem;
  font-size: .87rem;
  color: var(--muted);
  background: var(--card);
}
.sight b { color: var(--ink); }

.picker { display: flex; gap: .35rem; flex-wrap: wrap; margin: 0 0 1.2rem; }
.picker button {
  font: inherit; font-size: .82rem;
  border: 1px solid var(--line); border-radius: 999px;
  background: transparent; color: var(--muted);
  padding: .18rem .6rem; cursor: pointer;
}
.picker button:hover { color: var(--ink); }
.picker button[aria-current="true"] { color: var(--ink); border-color: var(--accent); background: var(--card); }

.lede { font-size: 1.02rem; margin: .2rem 0 .5rem; }
.meta { color: var(--muted); font-size: .82rem; margin: 0 0 1rem; }
.callout {
  border: 1px solid var(--line); border-left: 3px solid var(--muted);
  border-radius: 6px; padding: .6rem .8rem; margin: 0 0 1.4rem;
  background: var(--card);
}
h2 { font-size: .95rem; margin: 1.6rem 0 .6rem; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }

/* The one screen that has to be unmistakable: steps that are somewhere else. */
.elsewhere {
  border: 1px dashed var(--draft);
  border-radius: 6px;
  padding: .8rem .9rem;
  margin: .4rem 0 1rem;
  background: var(--card);
}
.elsewhere b { display: block; margin-bottom: .3rem; color: var(--ink); }
.elsewhere .where-file { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; color: var(--ink); }
.nothing { color: var(--muted); font-style: italic; margin: .4rem 0 1rem; }

.step { border-top: 1px solid var(--line); padding: .9rem 0 .3rem; }
.step-head { display: flex; gap: .5rem; align-items: baseline; }
.n {
  font-variant-numeric: tabular-nums; color: var(--muted); font-size: .8rem;
  min-width: 1.6rem; padding-top: .12rem;
}
.step h3 { font-size: 1rem; margin: 0; font-weight: 600; flex: 1; min-width: 0; }
.step .body { margin: .35rem 0 .5rem 2.1rem; }
.step .notes { margin: 0 0 .5rem 2.1rem; display: flex; gap: .3rem; flex-wrap: wrap; }
.note {
  font-size: .76rem; border: 1px solid var(--line); border-radius: 999px;
  padding: .05rem .5rem; color: var(--muted);
}
.settled { color: var(--merged); font-size: .78rem; }
.edit {
  font: inherit; font-size: .76rem; background: transparent; color: var(--muted);
  border: 1px solid var(--line); border-radius: 4px; padding: .05rem .45rem; cursor: pointer;
}
.edit:hover { color: var(--ink); }
.editor { margin: .4rem 0 .6rem 2.1rem; display: grid; gap: .4rem; }
.editor input, .editor textarea {
  font: inherit; width: 100%; padding: .4rem .5rem; border-radius: 5px;
  border: 1px solid var(--line); background: transparent; color: inherit;
}
.editor textarea { min-height: 7rem; }
.editor .row { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
.editor .count { color: var(--muted); font-size: .78rem; }
.editor button[type="submit"] { font: inherit; font-size: .8rem; padding: .2rem .7rem; cursor: pointer; }

/* One tracked thing, as its own container. */
.cards { margin: .3rem 0 .2rem 2.1rem; display: grid; gap: .4rem; }
.card {
  border: 1px solid var(--line); border-radius: 6px; padding: .45rem .6rem;
  background: var(--card);
}
.card.under { margin-left: 1.2rem; background: transparent; }
.card-top { display: flex; gap: .45rem; align-items: baseline; flex-wrap: wrap; }
a.ref {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .84rem;
  color: var(--open); text-decoration: none; border-bottom: 1px solid transparent;
}
a.ref:hover { border-bottom-color: currentColor; }
/* Twelve rems is what this wants, not what it demands. It was a min-width,
   which in a flex row is a floor the pane cannot argue with: at 220px the row
   simply stuck out, and every card in the document did it at once. As a
   flex-basis with the floor released, the title still claims 12rem wherever
   there is 12rem to claim and wraps down to whatever the pane has where there
   is not. */
.card .title { flex: 1 1 12rem; min-width: 0; }
.state {
  font-size: .74rem; border-radius: 999px; padding: .05rem .45rem;
  border: 1px solid currentColor;
}
.tone-open { color: var(--open); }
.tone-merged { color: var(--merged); }
.tone-closed { color: var(--closed); }
.tone-draft { color: var(--draft); }
.tone-block { color: var(--block); }
/* Never filled, never coloured as a state: this is the absence of a reading. */
.tone-unseen { color: var(--muted); border-style: dashed; font-style: italic; }

.labels { display: flex; gap: .25rem; flex-wrap: wrap; margin-top: .3rem; }
.label {
  font-size: .72rem; border-radius: 999px; padding: .02rem .45rem;
  border: 1px solid var(--line); color: var(--muted);
}
.label .scope { opacity: .55; }
.who { color: var(--muted); font-size: .78rem; margin-top: .25rem; }
.who .free { font-style: italic; }
.waits { display: flex; gap: .3rem; flex-wrap: wrap; align-items: baseline; margin-top: .3rem; font-size: .78rem; color: var(--muted); }

/* The rail. Seven dots, and the last one is hollow on purpose. */
.rail { display: flex; align-items: center; gap: .3rem; margin-top: .35rem; flex-wrap: wrap; }
.rail .word { font-size: .74rem; color: var(--muted); margin-right: .2rem; }
.dot {
  width: .5rem; height: .5rem; border-radius: 50%;
  border: 1px solid var(--muted); background: transparent;
}
.dot.done { background: var(--muted); }
.dot.now { border-color: var(--accent); background: var(--accent); width: .6rem; height: .6rem; }
.dot.unreadable { border-style: dashed; background: transparent; }
.rail-note { font-size: .74rem; color: var(--muted); margin-left: .3rem; }

.said { color: var(--muted); font-size: .82rem; min-height: 1.4em; }
.found { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }

/* ------------------------------------------------------------------ *
 * The pane, when it is narrow
 *
 * Everything above already FITS a 220px pane — the rules here are about what
 * is left once it fits, which is mostly the indentation. A step's body, its
 * notes, its cards and its editor all hang off a 2.1rem gutter that lines them
 * up under the step's title. In a 900px pane that gutter is the thing that
 * makes the page readable; in a 220px one it is fifteen per cent of every line
 * of prose spent on an alignment nobody can see, because the number it aligns
 * to has long since wrapped. So below 26rem the gutter goes and the page
 * padding comes in, and both come back the moment there is room for them.
 *
 * @container pane rather than @media: the window is a laptop and the pane
 * is a column in it, and only one of those two has ever been the reason this
 * page was cramped.
 * ------------------------------------------------------------------ */
@container pane (max-width: 26rem) {
  body { padding: .7rem .7rem 3rem; }
  /* A step's head is its number, its title, sometimes a "done", and the edit
     button. Releasing the title's min-width made the row fit, and fitting was
     the wrong thing for it to do: the flex algorithm happily squeezed the
     title to about fifty pixels and set it one word to a line, with the button
     sitting comfortably beside six lines of vertical text. So the head is
     allowed to wrap here, and the title asks for enough of the row that the
     controls cannot share it — they drop underneath, the title gets the line,
     and the number still sits beside its first word. */
  .step-head { flex-wrap: wrap; }
  .step h3 { flex-basis: 60%; }
  .step .body,
  .step .notes,
  .cards,
  .editor { margin-left: 0; }
  .card.under { margin-left: .6rem; }
  .sight { margin: .6rem 0 .9rem; }
  .picker { margin-bottom: .9rem; }
  h2 { margin-top: 1.1rem; }
}
`
