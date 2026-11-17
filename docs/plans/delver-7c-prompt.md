# Delver Stage 7c: the orchestrator prompt

Paste the block below into a new session on Opus. It runs the standing prompt (`docs/plans/delver-prompt.md`) for Stage 7c, with the user's answers and the task split already agreed (`docs/plans/delver.md`, "Stage 7c" and "Answered questions (2026-11-14, before Stage 7c)").

```
You are the orchestrator for Stage 7c (verticality inside a Hall) of docs/plans/delver.md.
Follow the prompt in docs/plans/delver-prompt.md exactly: read it first, whole. It is your
standing brief (read-first list, rules, briefing, review, close). This message only adds what is
specific to 7c, and where the two differ, this message wins.

WHAT IS ALREADY DECIDED (do not ask again)
- The user's answers are in the plan under "Answered questions (2026-11-14, before Stage 7c)"
  and are folded into the "### Stage 7c" section: 2 m and 4 m pits (4 m more often deeper),
  1 m daises (the Boss's throne and a Treasure altar only), split tiers 2 m apart with open
  edges, galleries wrapping round corners with one Ramp, rect Halls only with one vertical
  feature a Hall, about 1 Hall in 4 with a split level, pit or dais (picked before 7b's shapes
  and pillars, which then skip those Halls), the generator budget raised to 800 ms mean (the 2 s
  cap stays, no speed work), and no screenshots.
- The plan's Stage 7c section lists seven proposed tasks. Use them. The standing prompt's
  "2 to 6 tasks" does not apply to 7c. You may move a boundary or split a task further if the
  Design shows it is needed. Say why in the Design. Do not merge tasks.

STEP 2 FOR 7c: THE DESIGN
Write "#### Design" under "### Stage 7c" before any subagent starts, in the style of 6's, 7a's
and 7b's Designs (numbered sections, the words, the Tuning keys with defaults, the plan's new
fields and SALT keys, the source's Brushes and ids, the judge's rules, what each existing test
does, the tests to add, the soak's must-show list, the tasks with file scopes). Settle these
yourself in the Design, with the reasons; they are the hard parts:
1. The height model of a Hall with a feature. What is a split Hall's, a pit Hall's and a dais
   Hall's `level` and `y`? Which tier does each wall's door attach to? How do Stage 6's steps 3b
   (galleries) and 3c (levels) and the loops (step 4) pick tiers and keep every Passage's two
   door levels at most one apart? How does a pit's rim (2 m or 4 m above its floor) fit
   `levels.max` and the abyss at −8? A doorway above an Enclosure's floor is cut by the Passage
   alone, as Stage 6's stairwell high door is.
2. Doors are centred in a Hall's wall (7a's slots on great halls). A wall that crosses two tiers
   must not get a doorway straddling a tier edge or a Ramp. Say how the tiers are laid out so
   that never happens. Say the same for a pit's Ramps and a dais against the doorways and the
   centre's markers (7b's 3 m and 1 m clearances).
3. The 1 m dais under `levels.height` (1.8): check in the code (src/sim/levels.ts, crowd.ts,
   destinations.ts, nav.ts) what Soldiers, `fieldAt`, `floorNear` and `levels.promote` do with a
   1 m ledge: stepping up, stepping off, one node or two. Fix the dais's Ramps and size so the
   answer is clean, and write the answer into the Design.
4. Jump Links. A 2 m tier edge, a 2 m pit rim and a 1 m dais edge are shortcuts the AI may
   Jump. A 4 m rim must give no jump Link, and nobody is ever stranded in a pit without a Ramp.
   Say how the navmesh is kept honest: by the geometry, by `jumpHolds`, or by a rule in
   nav.ts, and which test proves it.
5. The gallery wrap: the shape of an L or U Deck and its one Ramp, the strip's corners, the
   stairwell rule per wall, the Deck post, and the Tuning (the wrap share, and what makes
   stairwells "far more often" than 1 in 9). It must still be byte for byte Stage 6's
   galleries with the 7c knobs off.
6. Byte-identity. With every 7c knob off, no 7c pick is made, and plan, source and map hash
   to 7b's pins exactly (a new knobs-off pin table in golden.test.ts, as 7b's PLAIN_PINS).
   Name the helper (as `plainHalls` and `flatRooms`), and have `flatRooms` turn the 7c knobs
   off too. The 7c picks take new SALT keys after the highest one used so far, so that no
   existing pick moves.
7. The pick order and the rate. Galleries, split levels and pits are picked before the levels;
   daises after the kinds; shapes and pillars after them, skipping any Hall with a feature.
   Name the percents and weights so that about 1 Hall in 4 ends up with a split level, pit or
   dais on the 500 pairs, and have the generator slow test print the measured share.
8. DELVER_VERSION goes to 8; PROTOCOL_VERSION stays 30; no new hashed state (all of it is in
   the plan and the Map Source, rebuilt from the Run seed and Floor), as 7a and 7b. If the
   Design finds something that must be hashed, stop and ask me.

SUBAGENTS
- Sonnet 5.5 for every task (Agent tool, model "sonnet", run_in_background false), each with
  a brief as Step 3 of the standing prompt. Copy the Design's contract for that task into the
  brief. Do not tell it to "read the Design and decide".
- Task 1 (the compiler and the navmesh) may run beside Task 2 (galleries in the plan): their
  files are disjoint. Review and commit them one at a time. Every other task waits for the one
  before it.
- Each brief's done line: `npm run typecheck` and `npm test` clean, plus the slow tests the task
  added or changed, run alone (the generator's budget is load-sensitive: 7b's run beside
  `npm test` missed it). Run the generator slow test alone when you check its budget.

CLOSING 7c
- Step 5 of the standing prompt, but no screenshots (the user's call). Still play a Run in
  `npm run dev` with ?dev=1&delver=1&autopilot=1&immortal=1&speed=4 through Floors 1 to 3, and
  &delverStart=3 for a Boss Floor, and read the console for errors.
- The Result says, besides the standing list: the share of Halls with each feature, pits by
  depth and tier, wrapped galleries and stairwells (against Stage 6's 1 in 9), rerolls, the
  build against the new 800 ms budget, the navmesh time and its jump Links, and the Tick on the
  soak against 7b's (levelled Runs mean 0.39 ms, p99 2.77).
- Stop after 7c. Do not start 7d.
```
