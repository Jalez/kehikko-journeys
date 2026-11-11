# Parts: one list, one rule

A proposal. This repository implements only this module's side of it (see
"What this change builds"). Everything under "Protocol", "Host" and "Other
modules" is a specification for somebody else's change, written here because
this is the change that made it necessary.

The owner's principle: *all modules work the same based on what part of an
epic is being shown; parts are module-agnostic — nothing about them is
hardcoded to know of any module.*

## The design in plain words

**A part belongs to the epic.** It is an id, a name and a place in an order.
It is not any one module's thing.

**The list of parts lives with the epic**, in the file the host already
keeps for it (`<project>/.kehikot/host/epics/<slug>.json`, `.kehikot/kehikko/` before protocol 2.2.0, as
`parts: [{ id, name }]`). The host is its only writer — it already owns the
epic's slug, title and existence, and already writes that file. A person
adds, renames, reorders and removes parts **in the host's parts picker**,
which is already in the bar and is the one module-agnostic place; no module
draws a box for it.

**Each module keeps what it has for a part in its own data, keyed by the
part's id.** This module: its one step. A document module: its one chapter.
Another module: whatever it has. No module's code or data names another module.

**What a module holds for a part is published in one place every module has**
— `<project>/.kehikot/<module>/parts.json` — as the two things anything else
can be tied to: documents and references.

```json
{ "version": 1, "epics": { "thesis": { "methods": { "documents": ["docs/thesis/chapters/3_methods.tex"], "refs": [] } } } }
```

The host reads that file from every module folder that has one (a directory
sweep; it knows no module's name) and unions them into the part it sends:
`context.parts[i] = { id, heading, picked, refs, files }`. So one module can
narrow by a file that another said belongs to a part, and a list of
references by a reference that this module said does, with neither knowing the other exists. A
new module that has one X per part writes its own `parts.json`; nothing else
changes anywhere.

**One rule**, the same in every module: with nothing picked, everything is
shown; with parts picked, an item is shown exactly when one of its anchors is
in a picked part. An anchor is `{ part }` (the part's id), `{ file }` (a
document) or `{ ref }` (a reference) — the protocol's `Anchor`, as it is.

## The contract for a module that follows parts

Expressed with what the protocol already exports (`useFocus`, `narrowToFocus`,
`anchorInFocus`). A module MUST:

1. **Give every item its anchors** — one function, `anchorOf(item)`, returning
   `{ part }`, `{ file }`, `{ ref }`, several, or none. `{ part }` when the
   item is filed by part id; `{ file }` when it is about a document; `{ ref }`
   when it is about a reference. An item about several things answers all of
   them and is in front when any one is.
2. **Narrow through `useFocus({ parts, epic }).narrow(items, anchorOf, { keep })`**
   and through nothing of its own. No hand-written comparison of files or ids.
3. **Hide an item that belongs to no part while parts are picked.** It belongs
   to the epic as a whole; it is back the moment nothing is picked. No module
   shows unanchored items under a pick and no module counts them on screen.
4. **Keep what is in hand.** The one item a person is in the middle of — an
   editor with unsaved words, the item they selected or opened — is passed as
   `keep` and stays drawn in its place. Every module does this, not some.
5. **Say one sentence when the pick leaves nothing, in the empty area, and
   nothing else anywhere**: `No <noun> is in the picked part.` / `…parts.` No
   notice row, no count line, no "outside" marks while something is shown.
6. **Leave its MCP door un-narrowed.** An agent has no canvas.
7. **Never set the pick, and never widen it locally.**

A module is `partless` only when it has no item that could carry an anchor,
or when it is not about one epic at all (its scope is the project or the
machine). "The owner chose not to" is not a reason under one rule.

## What contradicts this today

- The part record carries `files` ("files of the epic's **paper**") and lives
  in **this module's** `journeys.json`; the host's `dividing.ts` names this
  module as `MAKER` and says parts are made here.
- The protocol names two modules: a document module's id and a helper that
  puts a file in a part only if it is under that module's folder, and this
  module's id with `readJourneys` and `partsOf(record)` (a part's references
  are folded in from this module's steps by the host).
- `docs/parts.md` in the protocol REQUIRES the count sentence ("3 questions
  outside the picked part", and `0 … outside` said) which every module has
  since removed on the owner's instruction. The document and the modules
  disagree; the modules are right.
- Seven wordings of the empty sentence; `keep` passed by four modules of
  eight; unanchored items shown by one and hidden by the rest;
  three modules narrowing by a rule of their own.

## Audit: every module against the contract

Each module was read at its repository's `origin/main` when this was written.
In short, by kind rather than by name:

- **Modules filed by part id** (this one: a step's own part) conform on the
  rule; this one deviated on ownership — it wrote the parts list and read a
  document module's folder to offer chapters — which the host keeping the
  list and `parts.json` remove.
- **Modules anchored by document** (`{ file }`) mostly conform; the gaps were
  `keep` missing on some lists, standing "outside" marks or scope lines about
  the pick, and one module spelling another's id to find its folder.
- **Modules anchored by reference** (`{ ref }`) conform once they pass `keep`
  for selected rows and listen for epic content by epic, not by a module id.
- **`partless` modules** are right when they show one selected thing (always
  in hand) or are not about one epic (a shell, a log across projects, a list
  of epics); wrong where their items carry a `{ ref }` or `{ file }`, which
  then should react to parts.
- **A module keying sessions by the picked set** conforms: it follows the pick
  and has no list to narrow; a removed part's sessions stay under the gone id.

## Where a part's id is stored, and what happens when it goes

| Place | Keyed how | An id the epic no longer has |
|---|---|---|
| Host: `projects.parts` in the frame database, and `"parts"` in `<project>/.kehikot/host/kehikot.json` | per project (with the open epic) | Kept, ignored, and said: an amber "a picked part is gone" in the picker; one press forgets it. Any other pick drops it. |
| A module keying sessions by the pick, in its own folder | `epic=…;parts=a+b;kehikko=n` | The entry stays in the file; the session can no longer be reached by a pick. |
| This module: each step's `part` | per step | Cannot happen: the id IS the step's part. |
| Every other module | — | None of them stores a part id. |

## Protocol (additive; a 1.x minor)

1. **`parts.json`** — the shape above, with `readHoldings(project)` (every
   module folder's file, unioned per epic and part) and
   `writeHoldings(project, moduleId, epic, holdings)` in `/serve`. Bounded by
   the existing `PART_FILES` and `PART_REFS`.
2. **`documents` on a part, project-relative.** `EpicPart.files` stays as it
   is for 1.x (paper-relative, filled by the host from the documents under the
   paper's folder) and is deprecated; `fileInFocus` learns to compare a
   project-relative path against `documents`. `PAPER_MODULE` and `paperFileOf`
   are deprecated with it.
3. **`parts.set`** — one request a module may make of the host
   (`uses: ['parts:set']`): `{ add: { name, after? } }`, `{ rename: { id, name } }`,
   `{ move: { id, after } }`, `{ remove: { id } }`, answered with the list. It
   is how "a part for each chapter" or "a part for this new step" is offered
   from a module's page without the module writing the list.
4. **`emptySaid(parts, noun)`** → `No note is in the picked part.` /
   `…parts.` — one wording for seven. `focusSentence` (the count line) is
   deprecated, and the paragraphs of `docs/parts.md` that require it are
   replaced by the contract above.
5. **`LIMITS.PARTS` 32 → 128.** A part is a step, and journeys with more than
   thirty-two steps exist (one real one has thirty-eight): past the limit a
   step is a part no host can list.
6. `JOURNEYS_MODULE`, `readJourneys`, `journeyIn`, `partsOf(record)` and
   `stepPart` stay for 1.x and are deprecated: a host reads the epic's own
   list and the holdings, and no longer this module's record, for parts.

## Host

1. **Keep the list.** `parts: [{ id, name }]` in the epic's file, written by
   `server/holdings.ts` beside `retitleEpic`, whole-file-preserving as that
   is. `epicOf` answers `parts` from the epic's own file when it has the key.
2. **Adopt once, never guess twice.** For an epic whose file has no `parts`
   key: read them as today, from this module's record's `groups` (this is the
   released behaviour and stays the fallback). The first time a person edits
   the list in the picker, write the adopted list into the epic's file — ids
   and names exactly as read — and from then on read only that.
3. **The picker edits the list.** In the existing menu (`src/canvas/Parts.tsx`):
   a last row "+ part" (an inline name box); on a part's row, rename (inline),
   move up / move down, remove (asks once). No new surface in the bar. A new
   part's id is `slugFrom(name)`, de-duplicated, written from the start and
   never changed by a rename.
4. **Read the holdings.** `context.parts[i].refs` and `.files` are the union
   of what the modules' `parts.json` files say for that part. Until a module
   writes one, keep folding as today (group `files`, steps' refs).
5. **Answer `parts.set`**, behind the grant, with the same writer.
6. **Remove the module from the words.** `dividing.ts`: `MAKER`,
   `MAKER_NAME`, `PARTS_REF` and the sentence naming this module go; "no parts"
   opens the picker's own "+ part" row. (Until then: a journey with steps
   always has parts after this change, so the press is only ever offered for
   an epic with no steps, and this module answers it — see below.)
7. **MCP**: `set_parts` on the host's own door (add, rename, move, remove),
   and the ids already printed by `read_canvas`.
8. Show a part's full name in a `title` on its row: a name is truncated with
   an ellipsis at about 320 px and there is nowhere to read the rest.

## What this change builds (this module only)

- One step to a part. A step's `part` is the id of the part it is the step
  of. No parts box, no paragraph, no rows, no "add part", no "list all".
- The list is still written into the record's `groups` — one to a step, in
  the steps' order — **only because a released host reads it there**. Same
  wire shape; no host, protocol or module change is needed for this to work.
- Until the host keeps the list, the part's name and its one document are
  edited in the step's own editor, and this module still reads the paper's
  folder to offer its chapters. Both leave with host step 3 and the document
  module's change.
- Reading an older record never writes; it is read as one step to a part.
  The first deliberate write stores it and keeps the record as it was in
  `journeys.before-parts.json`.

## What the change after it built (this module on protocol 1.2.0)

The protocol and the host sections above have shipped (protocol 1.2.0; the
host from app 0.1.17). This is what this module does about them.

- **Who keeps the list is decided in one place**, `keeper.ts`: the host,
  exactly when the epic's own file has a `parts` key — the host's own test —
  and otherwise this app, in the record's `groups`, as before. Where the host
  keeps it, `groups` is neither written nor read, and whatever is in the
  record stays as it is; where this app does, every write is the one it was.
- **A step asks the host for its part.** A new step, a part's name, a step
  moved and a step removed each ask `parts.set` from the press. A host from
  before the method answers that it does not know it, nothing has changed
  anywhere, and the write that follows is the old one.
- **The host first for a new step, the store first for a removed one.** A step
  is never written pointing at a part that was not made: this app's store
  refuses an id the host does not list. A host that declines leaves the step
  kept, in no part; a store that fails after the host made the part leaves a
  part with no step, and Save again files the step under it.
- **The two edges of a list somebody else edits.** A step whose part was
  removed in the picker is a step in no part: drawn with nothing picked,
  hidden under a pick, and its editor offers to make it a part again. A part
  added in the picker has nothing drawn for it until its step is written,
  which one quiet control beside "add a step" offers.
- **What a step holds for its part is published** — its references, in
  its own folder's `parts.json` (`writeHoldings`) — after every write of a
  journey and never on a read.
- **Nothing here knows the document module.** `paper.ts`, `chapters.ts`, the
  chapter field, `/api/chapters`, `/api/steps/chapters` and "a step for each
  chapter" are gone. A document an earlier version recorded on a group is
  carried and never set.
- **One rule, one sentence.** Steps are narrowed with
  `useFocus(context).narrow(steps, anchorOf, { noun: 'step', keep })`, and an
  empty view says the protocol's `empty`. The standing "Framed, reading …"
  paragraph above the journey is gone.
