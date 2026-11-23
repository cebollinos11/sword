# Delver Stage 7d: the orchestrator prompt

Paste the block below into a new session on Opus 5.5. It runs the standing prompt (`docs/plans/delver-prompt.md`) for Stage 7d (lava), which was parked on 2026-11-16 and is now unparked. Unlike 7c, the user's questions for 7d have not been asked yet, so the orchestrator asks them first, records the answers in the plan and only then writes the Design. Every coding task goes to a Sonnet 5.5 subagent.

```
You are the orchestrator for Stage 7d (lava) of docs/plans/delver.md. Follow the prompt in
docs/plans/delver-prompt.md exactly: read it first, whole. It is your standing brief (read-first
list, rules, briefing, review, close). This message only adds what is specific to 7d, and where
the two differ, this message wins.

WHAT HAS CHANGED SINCE 7d WAS WRITTEN (read these before anything else)
- 7d and 7e were parked on 2026-11-16. Since then these have landed: Stage 9 (the Hall graph and
  Doors retired, src/sim/hall.ts is gone, so skip it in the read-first list), Stage 8a (traitors:
  humans on Team 1 driving Warband Soldiers, src/controllers/traitorPilot.ts), Stage 10
  (Consumables, including the Resurrection Stone), Delver Troops (docs/plans/delver-troops.md),
  Loot Rarity (docs/plans/loot-rarity.md, drops and Treasure pedestals), the Whirlwind
  (docs/plans/whirlwind.md, ADR 0029: a whirlwind passes through walls) and the floor length per
  tier (`delver.tierRooms`). Read the Results and the code of each where it meets lava: deaths,
  revives, drops, the AI's footing, the Knockdown's Slide (`knockdownSlide`, src/tuning/index.ts).
- The current versions are DELVER_VERSION 13 (src/sim/delver/version.ts) and PROTOCOL_VERSION 37
  (src/net/messages.ts). Check them again at Step 0. Do not trust these numbers.
- Stage 10 is built (commit 1703cf8), but the plan has no Progress box or Result for it. That is
  not your Stage. Do not start it, and do not pick "the first unticked box": your Stage is 7d.
  Leave 7e parked.
- The code already has lava as a Hazard Brush (src/mapEditor/source.ts, `HazardKind`), as a Walk
  Surface (`deadly`, src/sim/arena.ts), in the AI (`safeMove`, `hazardBehind`, `deadlyGround`,
  src/controllers/ai.ts) and in a Battle map's tests (src/sim/lava.test.ts, cavern.test.ts). The
  Delver generator (src/sim/delver/, data/delver.json) places none. 7d is about the generator,
  the judge and the walk around lava, not about lava itself. Confirm all of this in the code first.

STEP 0b: MEASURE THE BASELINE
Before any change, on the base commit, run the generator slow test
(src/sim/delver/delverGen.slow.test.ts) alone and the Warband soak
(src/controllers/warbandSoak.slow.test.ts) alone, and write down the build and navmesh means and
the soak's Tick mean and p99. 7c's numbers in the plan are several Stages old. The Result compares
against what you measure here, on this container.

STEP 1b: ASK THE USER, THEN RECORD THE ANSWERS
The "### Stage 7d" section is a proposal from 2026-11-14. Read it, then the code, then ask the
user (AskUserQuestion, at most 4 questions a call, at most two calls) only what you cannot settle
yourself from the code and the plan. Give a recommended option first for each. Likely questions:
1. Amount: about 1 Hall in 6 on tier 1 rising to 1 in 3 on tier 3, as proposed? Is lava allowed in
   a Boss Hall, a Treasure Hall or a great hall? Can a Hall have lava and a 7c feature (a pit with
   a lava floor, a trough under a Deck, a lava ring round a dais) or a 7b shape or pillars, or is
   it one feature a Hall, as 7c's rule is?
2. Shapes: the three proposed (a central pit ringed by floor, a river with one or two railless
   bridges, troughs along a wall or under a Deck's open front or a dais edge). Keep all three?
   The narrowest bridge?
3. Who can die in it, and how: a traitor's Soldier (a human can walk in, Allies and the AI never
   do by choice), a Whirlwind (ADR 0029) or a Knockdown's Slide pushing someone in. Does a body
   fall into it with the Death by Lava, and does a fire, a new Floor and the Resurrection Stone
   still bring back a Player who died in it (the plan says a fire does)?
4. Proof: screenshots of each lava shape (the plan asks for them; 7c's user said none), and the
   generator budget (7c raised it to 800 ms build mean, 500 ms navmesh mean). May 7d raise them?
Write the answers into the plan as "## Answered questions (<today>, before Stage 7d)", next to the
others at the end, and fold them into the "### Stage 7d" section, as 7c's were. Commit that
("Delver Stage 7d: the user's answers") before the Design.

STEP 2 FOR 7d: THE DESIGN
Write "#### Design" under "### Stage 7d" before any subagent starts, in the style of 7a's, 7b's
and 7c's Designs (numbered sections, the words, the Tuning keys with defaults, the plan's new
fields and SALT keys, the source's Brushes and ids, the judge's rules, what each existing test
does, the tests to add, the soak's must-show list, the tasks with file scopes). Settle these
yourself in the Design, with the reasons. They are the hard parts:
1. The geometry. Each shape as Hazard Brushes over the Hall's floor (what height, what rect, what
   the Brush order is so the Hazard replaces the floor it lies on), and how each fits a Hall's
   doorways, its centre's markers (7b's 3 m and 1 m clearances), a 7c tier edge or Deck front, and
   7b's L, T, cross and ring shapes if the user allows them together. Say how a river runs between
   two walls without cutting the walk from any doorway to any other: which walls it may cross, and
   where the bridges go relative to the doors. A bridge is floor between Hazards, with no Rail.
2. The navmesh and the walk. Check src/sim/nav.ts, levels.ts (`walkCheck`, `floorNear`),
   destinations.ts and crowd.ts: are lava cells kept out of the navmesh and the destination fields
   today, and does a Formation's file fit a bridge of the width you pick? Does a jump Link ever
   land on lava, or cross a river as a shortcut (decide whether that is allowed, and prove it with
   a test either way)? A Soldier following its lead field must never step in. Say which code makes
   that true: the geometry, the fields, or a new rule, and which test proves it.
3. The judge (src/sim/delver/judge.ts). The plan's rules, made precise: no post, spawn, fire,
   pedestal, drop spot or the Stairs on lava or within one `knockdownSlide` of it (measured how);
   a Warband's home and patrol off it; the walk between any two doorways never needs a bridge
   narrower than a Formation files through; none in the Entrance and none on the walk from a
   doorway to a Rest Hall's fire. Say what happens when a rule fails: a reroll of the Floor, or
   the lava pick dropped for that Hall (cheaper, and it keeps the Floor). Count rerolls.
4. Deaths and drops. A Soldier's drop, a Player's dropped items and a Pickup of a death in lava
   land on `floorNear` off the lava (src/sim/delverLoot.ts `dropSpots`). Check that this already
   holds or say the change. A revive by a fire, a new Floor or the Resurrection Stone never puts
   anyone on or next to lava (the Stone's `REVIVE_MARGIN` rule, Stage 10).
5. The AI. Allies (allyAi.ts), the Delver pilot (delverPilot.ts) and Soldiers never step in by
   choice; enemies and allies kick toward a hazard more readily (`hazardBehind`). Check what the
   code already does and change only what the soak shows is wrong. The traitor pilot
   (traitorPilot.ts) and human Players may walk in.
6. The render. Lava drawn glowing, with the kit's look: find how the Battle maps' lava (cavern) is
   drawn (src/render/) and reuse it. The render side never changes an outcome.
7. Byte-identity. With every 7d knob off, no 7d pick is made, and plan, source and map hash to the
   current pins exactly (a new knobs-off pin table in src/sim/delver/golden.test.ts, as 7c's
   FLAT_HALLS_PINS). `flatHalls` (or a new `noLava` helper that `flatHalls`, `plainHalls`,
   `flatRooms` and `flatFloors` all apply) turns the 7d knobs off. The 7d picks take new SALT keys
   after the highest one used so far in src/sim/delver/plan.ts, so no existing pick moves.
8. The pick order and the rate. Where in plan.ts the lava pick runs (after the kinds and the 7c
   features, before or after 7b's shapes and pillars), and the percents per tier so that the
   500 pairs land on the agreed share. The generator slow test prints the measured share by tier
   and by shape.
9. Versions. DELVER_VERSION + 1. PROTOCOL_VERSION stays the same unless something new is hashed:
   all of 7d should live in the plan and the Map Source, rebuilt from the Run seed and Floor, as
   7a to 7c. If the Design finds something that must be hashed, or that data/delver.json's Tuning
   hash reaches the protocol, stop and ask me.

THE TASKS
Split 7d into 4 to 7 tasks, in this order unless the Design shows otherwise (say why if so):
1. The plan's lava pick and its Tuning keys (plan.ts, src/tuning/delver.ts, data/delver.json), the
   knobs-off helper and the new pin table.
2. The source: lava shapes as Hazard Brushes (src/sim/delver/source.ts), and any compile or navmesh
   change the Design names.
3. The judge's lava rules and the reroll or drop (judge.ts, and arenaGen if needed).
4. Deaths, drops and revives off lava (delverLoot.ts, delverRun.ts, the Stone's revive).
5. The AI, only where the soak shows a fault (ai.ts, allyAi.ts, delverPilot.ts, crowd.ts).
6. The render of lava on Delver Floors (src/render/), and the minimap and Floor Map if they need
   to show it.
7. The tests the plan's Done asks for: the scenario tests of a kick into lava and of a
   Knockdown's Slide into it, the soak's must-show list, the generator's per-tier and per-shape
   counts.
Tasks 1 to 4 run one after another. Task 6 (render only) may run beside Task 3 or 4 if their file
scopes are disjoint. Review and commit them one at a time.

SUBAGENTS
- Sonnet 5.5 for every task: Agent tool, model "sonnet", run_in_background false (unless you run
  two disjoint tasks at once), each with a brief as Step 3 of the standing prompt. Copy the
  Design's contract for that task into the brief. Do not tell it to "read the Design and decide".
- Each brief's done line: `npm run typecheck` and `npm test` clean, plus the slow tests the task
  added or changed, run alone. The generator's budget is load-sensitive: run its slow test alone
  when you check the budget, never beside `npm test`.
- Write code yourself only to fix a few lines in review, as the standing prompt says.

THE SOAK MUST SHOW (so it fails loudly if it never reached lava)
- Floors with lava on every tier, each shape at least once, and the party walking past it.
- Soldiers and promoted Fighters dying in lava (by a kick, a Slide or a whirlwind), with a count.
- No Soldier, ally or pilot walking into lava by choice: 0, over a stated number of Soldier-Ticks
  in lava Halls.
- No drop, revive or Pickup on lava: 0.

CLOSING 7d
- Step 5 of the standing prompt. Play a Run in `npm run dev` with
  ?dev=1&autopilot=1&immortal=1&speed=4 in a solo Gauntlet through Floors 1 to 3, and again with
  &delverStart=F (src/devMode.ts) on a Floor of each tier and on a Boss Floor, and read the
  console for errors. Take screenshots of each lava shape if the user said
  yes in Step 1b.
- The Result says, besides the standing list: the share of Halls with lava by tier and by shape,
  bridges by width, rerolls or dropped lava picks, the build and navmesh means against the budget
  and against your Step 0b baseline, the jump Links near lava, the soak's deaths in lava by cause,
  and the Tick on the soak against the baseline.
- Tick 7d under Progress (drop "(parked)"), and update the Status line. Do not touch Stage 10's
  missing box, or 7e.
- Stop after 7d. Do not start 7e.
```

## Notes
- **Why the questions come first.** 7c's prompt was written after the user had answered its questions. 7d's proposal predates traitors, Consumables, the Whirlwind and Stage 9, so some of its rules (who dies, what revives, what pushes someone in) may need the user's view before the Design fixes them.
- **Why a baseline.** 7c's Tick and budget numbers came from an older container and an older game. Comparing 7d with them would mix 7d's cost with every Stage since.
