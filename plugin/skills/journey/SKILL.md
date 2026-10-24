---
name: journey
description: Design a Kehikot journey as a tree of small, ordered steps - a goal, the objectives under it, and PR-sized leaves - asking the person only the design questions whose answers change the tree, then write it into the Journeys module, the epic's parts and, on a second yes, the tracker's issues. Only a person runs it, by typing /journey.
argument-hint: "[what the journey is for, or an epic slug]"
disable-model-invocation: true
allowed-tools: mcp__kehikko__my_place, mcp__kehikko__read_canvas, mcp__kehikko__read_tracker, mcp__journeys__list_journeys, mcp__journeys__get_journey, mcp__journeys__next_step
---

The person typed `/journey $ARGUMENTS`. Your job is to design ONE journey with them: what has to become true for a user, as a tree of small steps in an order that holds. You design the journey, not the code. Kehikot's Journeys module at {{origin}} keeps journeys; this is skill {{version}}.

## Ground rules

- **The person decides; you propose.** Nothing is written until they accept the tree, and no issue is filed until they say yes a second time.
- **Look before you ask.** Read the code, the epic and the tracker first. Never ask what a file, `git log` or the tracker can tell you.
- **Stay on the journey.** Ask about what has to become true for the user, who that user is, what is in scope, what order holds, and what is ruled out. Leave implementation choices (libraries, names, file layout) to whoever takes each step.

## 1. Find where you are

1. Call `my_place` (the Kehikot host's tools, usually `mcp__kehikko__*`). It gives the project's absolute path, the epic, and the kehikko. Use that project path as `project` in every Journeys call. If no place is recorded, ask the person which project folder and epic this is for, in one question, and stop until they answer.
2. Call `get_journey` for the epic (Journeys' tools, usually `mcp__journeys__*`). If it has steps already, you are refining that journey: keep what is still right, and say what you would change. Steps with no `under` are a flat journey: design the tree around them, and write it as **Refining a flat journey** at the end of section 5 says. If there is none, you will begin one with `create_journey` once the tree is accepted.
3. Read what is already there: the epic and its parts (`read_canvas`), open issues (`read_tracker` for the epic), and the code the journey touches. Note what exists, so no step asks for it again.

If the Journeys tools are not connected in this session, use the module's MCP door at {{origin}}/mcp with curl (JSON-RPC 2.0: `initialize`, then `tools/call` with `{"name": "...", "arguments": {...}}`). If that does not answer either, tell the person: "Kehikot's Journeys module at {{origin}} is not answering; start it from Kehikot and type /journey again. [skill {{version}}]" and stop.

A Claude session keeps the tool list it started with. If a Journeys tool this skill names is missing (`patch_steps`), or a list argument (`phases`, `steps`) is refused as text, the session predates the module's update. Tell the person to restart the session, or make that call at the module's MCP door, {{origin}}/mcp, with curl as above.

## 2. Design the tree

Work through these in order. Keep the draft in the conversation; nothing is written yet.

**Goal.** One sentence of what is true for the user when this is done, and how we will know it is met: something a person can observe or measure, not "the code is merged".

**Bounds (Shape Up).** An appetite: how much time this is worth, which is a budget and not an estimate. Rabbit holes: known traps the steps should route around. No-gos: what this journey will not do. A step that does not fit the appetite is cut or moved to a no-go, not squeezed in.

**Prerequisite tree (Goldratt).** Ask, for the goal: what stops this from being true today? Each obstacle becomes an intermediate objective, phrased as what will be true once it is overcome. Ask the same question of each objective, and keep going until every leaf is one step that:
- fits in one pull request and can be reviewed in one sitting;
- is vertical: a user, or the next step, can see the difference when it lands;
- passes INVEST: independent where it can be, negotiable, valuable, estimable, small, testable.
A leaf that fails any of these is not a leaf yet: break it down again.

**Order.** For each pair where "we can't do X before Y", record Y as a prerequisite of X. The edges must form a DAG; if they loop, an objective is drawn wrong, so redraw it.

**Gates.** Some obstacles are not steps anyone on the team can take: a decision someone has to make, access someone outside the team has to grant, work nobody has filed an issue for yet, or a ref another epic owns. Each is a gate: give it a kind (`decision`, `access`, `work`, `ref-elsewhere`, or `issue` for a tracker issue in this epic), a short title, its owner (a person or role) where you know one, and the steps it holds. A gate stays open until someone marks it done, so a step it holds is never next. Record every real gate: a journey with its gates left out reads as unblocked when it is waiting.

**Phases.** Group the tree into an ordered list of phases: the labelled sections of the roadmap, left to right, in the order the work moves through them, for example "Concepting", "Creating framework", "Creating UI elements", "Creating data", "Finishing up". Name them for this journey, not from that list; three to six is usual. Assign every node one phase. A leaf in the same phase as its objective can leave it to its objective: a leaf with no phase of its own is read as its objective's. A phase that no node is in is not a phase yet: drop it.

**Mikado, for leaves that change existing code.** When you look at the code for a leaf and find it cannot be done until something else is changed first, that something becomes a new prerequisite node under it. Keep going until the leaves you are left with can each be done on their own.

Show the person the phases in order, then the tree as an indented outline: the goal at the top, objectives under it, leaves under those, each node with its phase, and each leaf with its "after" list and the gates that hold it (kind, title, owner). Mark the first leaf that could start now.

## 3. Ask, only when the answer changes the tree

Ask a question only when the answer changes the tree: its scope, its order, who the user is, or a no-go. A question that would leave the tree the same is not worth the person's time.

- **One question per message.** Wait for the answer before the next.
- **Say why it matters**, in one sentence: which part of the tree it decides.
- **Offer a recommended answer and its consequence**, so the person can just say "yes".
- **Never ask what the code or tracker can answer.** Look first, and say what you found.
- **Stop asking once the tree is decided.** Don't ask to confirm what is already settled.

Shape each question like this:

> **Question:** Is the first user of this the person who sets the project up, or a teammate who joins later?
> **Why it matters:** it decides whether "invite a teammate" is a leaf of this journey or a no-go.
> **Recommended:** the person who sets it up. Then inviting moves to the no-gos and the tree loses one objective and three leaves.

## 4. Review before you propose it for acceptance

Put the draft through a review, the way Kehikot's other modules do. Start each role as a subagent of its own with an inline prompt that holds the goal, the bounds and the outline, and have each answer in writing:

1. **Reviewer.** For every leaf: is it needed for the goal? What is missing for the goal to be true? Which leaf is too big for one pull request? Is the order right, or does a leaf wait on something it does not need, or start before something it does need? End with a numbered list of points.
2. **Counter-arguer.** Given the reviewer's points, defend the draft wherever it is right, and concede where it is not. One answer per point.
3. **Judge.** Read both and rule on each point: REQUIRED (change the tree) or DISMISSED, with one sentence why.

Apply what the judge required, and tell the person in a few lines what changed and what was dismissed. If the judge raised something only the person can decide, ask it as one question, in the shape above.

## 5. Write it, with the person's acceptance

Show the final tree and ask: "Shall I write this journey into Kehikot?" Write nothing until they say yes. Then:

1. **The journey.** If the epic has no journey yet, `create_journey` first. With `set_journey`, write `goal`, `measure`, `appetite`, `rabbitHoles` and `noGos`, a one-sentence `lede`, and `phases`: the whole ordered list, each `{ "title": "Concepting" }`. Note each phase's id from `get_journey` (they are made from the titles); on a journey that already has phases, pass each kept phase's `id` so it stays the same.
2. **The parts.** Where the host keeps the epic's parts (`get_journey` says so), add one part per node with the host's `set_parts` (`add: {name}`), in tree order: each objective, then its leaves. Use short names. Note each id from the answer.
3. **The steps.** One `set_step` per node, objectives before the steps under them. Give each one its `part` (where the host keeps parts), its `under`: the objective's step id, or leave it out for a node directly under the goal, and its `phase`: the phase's id (leave it out on a leaf that is in its objective's phase). Phrase `title` as what becomes true for the user. Keep `body` short: why it matters and how we'll know it's done.
4. **The order.** For each node with prerequisites, call `set_dependency` with `step` and `after` (the ids of the steps it waits on). Journeys refuses an edge that would close a loop; if it does, the tree is wrong, so tell the person.
5. **The gates.** One `set_gate` per gate: `kind`, `title`, `owner`, a `note` where it helps, `ref` for an `issue` or `ref-elsewhere` gate (and `epic` for the epic that owns a `ref-elsewhere` one), and `blocks` = the ids of the steps it holds. A ref that a step names as prior art or as related work, rather than work that delivers the step, gets `roles` on `set_step` (`{"#1850": "prior-art"}`) so it never reads as delivering. A note chip that names unfiled work becomes a `work` gate: take the note off with `patch_step` (`notes` = the rest).
6. Read the journey back with `get_journey`, check it against the tree and its phases (the PHASES lines list each phase with its steps), and call `next_step` to say which step comes first.

**Refining a flat journey.** The existing steps stay, with their parts, refs and notes; the tree is built around them:

1. **Objectives.** Each new objective is a new part (`set_parts`, `add: {name}`) and a new step (`set_step` with that `part`, its `title`, `body` and `phase`, and `under` where it sits under another objective).
2. **File the steps.** One `patch_steps` call: every existing step with its `under` (its objective's id) and its `phase`. A patch changes only the fields it names, so each step keeps its title, body, refs and notes as stored.
3. **The order.** `set_dependency` with `step` and `after`, as in 4 above.
4. **Gates already settled.** A gate the old journey records as decided, granted or done is `set_gate` with `state: "done"` and `by`.
5. **The prose.** Read `lede`, `callout`, `exists`, `open` and `missing` again, and correct with `set_journey` whatever still describes a list or numbers steps that moved.

Then read it back as in 6.

## 6. Issues, on a second yes

Ask separately: "Shall I file an issue for each leaf, with the 'blocked by' links?" Only on a yes:

- Find the repository from `git remote -v` in the project and the tracker sources `read_tracker` reports. Use the person's own `gh` (GitHub) or `glab` (GitLab).
- File one issue per leaf, prerequisites first: the step's title, its body, and a line naming the journey and its goal. Use `gh issue create --repo OWNER/REPO --title ... --body ...` (or `glab issue create`).
- Link the order. GitHub: `gh api -X POST repos/OWNER/REPO/issues/N/dependencies/blocked_by -F issue_id=<the blocking issue's numeric id, from gh api repos/OWNER/REPO/issues/M --jq .id>`; if that is refused, add "Blocked by #M" to the issue's body. GitLab: `glab api -X POST projects/:id/issues/N/links -f target_project_id=<id> -f target_issue_iid=M -f link_type=is_blocked_by`.
- Record each issue on its step with `patch_step` (`step` = its id, `issue` = the new ref, e.g. `gh#41` or `#41`), or all of them in one `patch_steps`. Then `set_dependency` with `ref` = the issue and `blockedBy` = its blockers' issues, so the order is visible on the issues too.
- A `work` gate you filed an issue for becomes an `issue` gate: `set_gate` with `gate` = its id, `kind: "issue"` and `ref` = the new issue.
- Say what was filed, as a list of refs with titles, and which step is next.

## When you are done

End with three lines: the goal, the next step (from `next_step`), and the open gates that only a person can settle, each with its owner. Never start the work yourself; the person takes a step when they choose, for example with /factory.
