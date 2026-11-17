# Loot Rarity: the orchestrator prompt

Paste the block below into a new session on Opus 5.5. It implements `docs/plans/loot-rarity.md` Stage by Stage (issues #153 to #156, under #152). The orchestrator hands each task to a Sonnet 5.5 coding subagent, reviews the work and closes the issue, and never stops to ask the user anything.

```
You are the ORCHESTRATOR for docs/plans/loot-rarity.md (tracking issue #152; Stage issues
#153, #154, #155, #156, in that order). Implement all four Stages, one after another, using
Sonnet 5.5 coding subagents for the code. You design, brief, review, verify and commit. You do
not ask the user any questions: the scope is agreed. When something is unclear, decide it
yourself, prefer the plan's wording, then the codebase's existing patterns, then the simplest
choice, and write the decision down (see RECORD below).

READ FIRST (yourself, whole, before any subagent starts)
- CLAUDE.md, CONTEXT.md (the glossary: use its words, and add or adjust terms you introduce),
  docs/agents/issue-tracker.md.
- docs/plans/loot-rarity.md: the spec. The "Decisions" section is the user's and is final.
  "How it works" is the design. "Stages" says what is done when.
- The issues #152 to #156 (GitHub MCP issue_read; the gh CLI's GraphQL is blocked here, but
  REST calls through `gh api repos/...` work).
- The code each Stage touches, at least: src/sim/inventory.ts, src/sim/mods.ts,
  src/tuning/relics.ts, src/tuning/dungeon.ts, src/tuning/index.ts (runWeapons),
  src/tuning/weapons*, src/sim/pickups.ts, src/sim/delverLoot.ts, src/sim/delverRun.ts,
  src/sim/hash.ts, src/net/messages.ts (PROTOCOL_VERSION), src/sim/delver/version.ts
  (DELVER_VERSION), src/play/inventoryView.ts, src/play/inventoryScreen.ts, src/play/loot.ts,
  src/play/styles.ts, src/render/pickupView.ts, src/render/pickupMarks.ts, and the renderer
  that draws a Fighter's Weapon. Use grep to find every user of `Dropped`, `Inventory.weapons`,
  `Inventory.relics`, `runWeapons` and `leftOutWeapons` before Stage 1 is briefed.

PER STAGE, IN ORDER (#153, then #154, then #155, then #156; never two at once)
1. DESIGN. Under the Stage's heading in docs/plans/loot-rarity.md, write "#### Design".
   Give the exact types and signatures, the Tuning keys with their defaults, the files each task
   may touch, every existing test expected to change and why, and the new tests. Settle the
   hard parts yourself and give the reasons:
   - Stage 1: the shape of `Item` everywhere a name was (inventory, pickups, events, the
     state hash, net messages, the dev `relics` option, the results Build), and how
     `scaleEffects` knows each effect's good direction.
   - Stage 2: the fold order, and that `troopMods` (enemies) never sees Weapon effects.
   - Stage 3: the SALT key for the Rarity draw, after the highest used, so no existing pick
     moves except as the plan says.
   - Stage 4: the colour tokens, and where the Weapon tint hooks in so every peer draws it
     from the simulated inventory (render only, never in the Simulation).
   Split the Stage into 1 to 4 tasks with disjoint file scopes.
2. BRIEF. For each task, launch a coding subagent with the Agent tool, subagent_type
   "general-purpose" and model "sonnet", run in the foreground (run_in_background: false), one
   at a time. The brief must stand alone; the subagent has none of your context. Include:
   - the goal;
   - the Design section's text pasted in;
   - the exact files it may touch;
   - the tests to add, and what "done" means;
   - the rules: keep the Simulation deterministic (no Math.random, no Date, no unordered
     iteration in sim code; seeded picks only through runPick); follow the glossary words and
     the file's own style; no new dependencies; run `npm run typecheck` and `npm test` and
     report their output; do not commit, push, or edit files outside its scope; do not ask
     questions, decide and report the decision.
   - Ask it to end with a report: the files changed, the decisions made, the test output, and
     anything left undone.
3. REVIEW. Read the full diff yourself (`git diff`). Check it against the Decisions, the Design
   and the Stage's "Done" list:
   - Downsides never scale.
   - Consumables are always Common.
   - Enemies are unchanged.
   - Counts are whole.
   - Every peer gets the same bits.
   - The version bumps are there.
   - There is no dead code.
   - Test assertions are real.
   If anything is wrong or missing, send the same subagent a fix-up through SendMessage with
   its agent ID, or launch a fresh Sonnet subagent with a precise fix brief. Repeat until it
   is right. Small, obvious fixes you may make yourself.
4. VERIFY. Run `npm run typecheck`, `npm test` and `npm run build` yourself. For Stages 1 to 3
   also run the Delver slow suites that cover loot and Runs (e.g. `npx vitest run --project slow
   src/controllers/delverRun.slow.test.ts src/net/delverCoop.slow.test.ts`). Every test must be
   green.
   - Never skip, delete, loosen or quarantine a test to get green. A test that pins old
     behaviour the plan deliberately changes (such as golden loot picks, or the 4-Weapon pool)
     is updated, and you say so in the Result.
   - For Stage 4, run the game (the `run` skill, with Playwright's pre-installed Chromium)
     and take screenshots:
     - a Rare and a Legendary Weapon in hand and on the Floor;
     - the inventory screen with the scaled numbers;
     - a two-peer online check that both see the same tint, if the harness allows (if not,
       say so).
     Save the screenshots under docs/plans/loot-rarity/ and link them in the Result.
5. RECORD AND CLOSE.
   - Write "### Result" under the Stage in the plan: what was built, any decisions taken that
     the plan did not settle, the test counts, and the tests changed and why.
   - Tick the Stage's box in the plan and in #152's body (issue_write update).
   - Update the plan's Status line, and CONTEXT.md where a term changed: Rarity, Item,
     Weapon, Relic, Consumable, Inventory, Weapon roster (leftOutWeapons is gone).
   - Commit with a message saying what the Stage did, push to this session's branch, and
     comment on the Stage issue with a short summary and the commit hash, ending with the
     Claude Code footer. Then close the issue as completed.
6. Then go straight on to the next Stage. Do not stop or ask between Stages.

FINISH
- When #156 is closed:
  - set the plan's Status to done;
  - tick the last box in #152 and close it;
  - push.
- Do not open a pull request.
- Report back with:
  - what was built, Stage by Stage, with the commit hashes;
  - the decisions you took on your own;
  - anything you could not verify (for example the online two-peer check);
  - suggested balance changes to try after a playtest.

IF BLOCKED
- If a subagent fails twice on the same task, take the task over yourself.
- If a Stage cannot be finished (a fact in the codebase contradicts the plan), do the nearest
  thing that keeps the user's Decisions intact. Record why in the Result and go on. Stop only if
  the build or test suite cannot be made green without breaking a Decision, and then report
  exactly what is blocked.
```
