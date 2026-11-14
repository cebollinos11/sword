# Delver: implementation prompt (an Opus orchestrator, Sonnet subagents)

Paste this into a new session on Opus once per Stage of `docs/plans/delver.md`. The session orchestrates: it reads, designs, splits the Stage into tasks, hands each task to a Sonnet subagent, reviews what comes back, and commits. It does the next unfinished Stage, then stops for a playtest.

```
You are the orchestrator for the next Stage of docs/plans/delver.md. You design, brief, review and
commit; Sonnet subagents write the code. Write code yourself only to fix a small thing in review
(a few lines), never a whole task.

READ FIRST (yourself, not a subagent)
- The whole of docs/plans/delver.md, and the "### Result" of every Stage already done.
- CONTEXT.md: Run, Dungeon, Floor, Hall, Door, Encounter, Relic, Inventory, Benched, AI Takeover,
  Battle, Soldier, Crowd, Squad, Formation, Bubble, Fighter Pool, Promotion / Demotion, Troop,
  Map Source, Brush, Enclosure, Input Delay.
- ADRs 0006, 0014, 0019, 0020, 0021, 0022, 0023, 0025 (and 0028 once Stage 0 has written it).
- docs/plans/dungeon.md (the Run being replaced) and the Enclosure section of docs/plans/map-editor.md.
- The code the Stage touches. Always: src/sim/match.ts (stepMatch, the Gauntlet and Battle branches),
  src/sim/state.ts (RunState, SimState.crowd), src/sim/dungeon.ts, src/sim/hall.ts. And by Stage:
  - 0: as 1, plus the Battle code its Tick measurement runs (src/sim/crowd.ts, bubble.ts, battle.ts,
    battleSoak.slow.test.ts) and docs/plans/big-battle.md's Stage 0 (the laptop baseline).
  - 0, 1, 6: src/mapEditor/source.ts, compile.ts, checks.ts, enclosure.test.ts; src/sim/levels.ts
    (walkCheck); src/sim/destinations.ts; src/sim/nav.ts; src/sim/arenaGen/ (the judge).
  - 2, 4: src/sim/pickups.ts, inventory.ts, mods.ts; src/controllers/allyAi.ts, hallAi.ts;
    src/sim/dungeonRun.test.ts; data/dungeon.json; src/tuning/ (dungeon parsing).
  - 3, 6: src/sim/crowd.ts, squad.ts, bubble.ts, battlefield.ts, battle.ts; src/controllers/poolAi.ts.
  - 5: src/play/hud.ts and the Floor Map; src/render/ (pickups, the Rest fire, the minimap).
  - 7: src/net/, src/lobby/onlineGauntlet.test.ts, the loopback tests, PROTOCOL_VERSION.

STEP 0: SET UP
In a fresh container run `npm ci` first. Record the commit you start from (`git rev-parse HEAD`):
it is the Stage's base, the review range in Step 5.2.

STEP 1: PICK THE STAGE
Find the first unticked box under Progress in the plan. Do only that Stage.
- Before Stage 1 or later, check that Stage 0's Result says go. If it says no-go, stop and ask.
- If the Stage is unticked but already has a "#### Design" or "Delver Stage N:" commits
  (`git log --oneline`), an earlier session left it half done. Do not design it again. Read
  the Design and the commits, find the first unfinished task, and resume from there. The base is
  then the commit before the Stage's first commit.
- If it is Stage 0, its "Done" is a go or no-go: stop after it whatever the numbers say, and
  report them.

STEP 2: DESIGN, THEN SPLIT INTO TASKS
Every Stage gets a "#### Design", whatever its Model line says. The Model line says only how much
of it is hard: on an Opus Stage (geometry, brains, determinism) it is long; on a Sonnet Stage it
may be short, but it still fixes the state's shape (RunState fields, what is hashed) and every
pure pick. Before any subagent starts, write the Stage's design into the plan under the Stage, as a "#### Design" section: the new types and their
fields, every function's name, file, signature and contract, the algorithm in prose where it is
not obvious (the generator's layout, the Warband brain's transitions, the Reveal rule), what is
hashed and snapshotted, the Tuning Data keys with their defaults, and which existing tests the
Stage rewrites or removes (see rule 5 below). For a measurement or a soak, also say what it must
show it exercised (Soldiers promoted, Warbands chasing), so a run that never reached it fails
loudly instead of passing with empty numbers. A subagent should never have
to make a judgement call about geometry, determinism or the Simulation's shape. Make it yourself.

Then split the Stage into 2 to 6 tasks. Each task:
- has a clear file scope (the files it may create or change) and does not overlap another running
  task's files;
- ends in something testable on its own (a pure module and its tests, a Simulation step and its
  tests, a render piece and a screenshot);
- is ordered by what it depends on. Run tasks one after another by default. Run two at once only
  when their file scopes are disjoint, neither needs the other's code, and neither imports a file
  the other changes. They share one working tree, so each one's `npm test` sees the other's half-done
  work: review and commit them one at a time, and if one goes red because of the other, wait.

Use TaskCreate to track them.

STEP 3: BRIEF EACH SUBAGENT
Spawn each task with the Agent tool, model "sonnet", `run_in_background: false` (it defaults to
background) unless you have independent review work to do meanwhile. A subagent starts with none of your context, so each
brief must stand alone and contain:
1. The goal in two or three sentences, and which Stage of docs/plans/delver.md it belongs to.
2. What to read: the plan's Stage and its #### Design, the CONTEXT.md terms by name, and the exact
   files (with the functions in them) to model the code on.
3. The file scope: the files it may create or change. Everything else is read-only.
4. The contract, copied from your Design: types, signatures, invariants, Tuning Data keys.
5. The rules that hold in this repo, all of them, every time:
   - Anything that feeds the Simulation is pure and deterministic: no Math.random, no Date, no
     iteration order of a Map or object keys that differs by insertion, no floating-point trig on
     map coordinates in the generator, every tie broken by a fixed index. Seeds come from runPick
     and runSeed (src/sim/dungeon.ts).
   - Simulation state is plain data, hashed and snapshotted. Caches derived from state (navmesh,
     destination fields) are never stored in it.
   - The render side never changes an outcome.
   - Do not change shipped Battle maps, Weapons, Motions, or any existing test's expectations,
     except the tests the brief names as ones this task rewrites or removes (the Design lists
     them). If any other existing test breaks, stop and report why; do not "fix" the test.
   - Match the repo's comment style: rules explained in CONTEXT.md's domain words.
   - Do not commit or push. Do not edit docs/plans/delver.md or CONTEXT.md.
6. The tests to write, named, with what each proves.
7. The done condition: `npm run typecheck` and `npm test` clean (and `npm run test:slow -- <file>`
   for the slow tests it added).
8. What to report back: the files changed, the test names and counts, anything that differed from
   the brief and why, and any open doubt. It should keep the report short and not paste code.

STEP 4: REVIEW EACH TASK BEFORE THE NEXT ONE STARTS
- Read the whole change yourself: `git status` (new files are untracked, and `git diff` does not
  show them) and `git diff HEAD`, and read every new file whole. Check it against the Design, the CONTEXT.md terms and
  the rules above, especially determinism and what ends up in SimState.
- Run `npm run typecheck` and `npm test` yourself. Never take the report's word for it.
- If it is wrong, send the same subagent (SendMessage, so it keeps its context) a precise list of
  what to change. After two failed rounds on one task, re-brief a fresh subagent with the lessons,
  or narrow the task.
- If the Design itself turns out wrong, fix the Design in the plan first, then brief the change.
- Once it passes, commit the task ("Delver Stage N: <task>") and push. The next task's review
  then starts from a clean tree, and a later session can resume from the commits.

STEP 5: CLOSE THE STAGE
1. Run `npm run typecheck`, `npm test`, and `npm run test:slow` if the Stage touches Runs, Battles,
   the Crowd or the generator. All must be clean.
2. Run /code-review at high effort on the Stage's whole range with an explicit target:
   `/code-review high <base>..HEAD` with the base from Step 0, and a line naming the Stage's files
   and its #### Design. Without a target it reviews only the last commit or the working tree. Hand the fixes to a
   Sonnet subagent with the findings as its brief, then review as in Step 4.
3. From Stage 1 on, use the run skill to play the Stage in `npm run dev` (a solo Gauntlet Run; for
   Stage 1, the generated Floor in the Map Editor at #/mapeditor?dev=1). Take screenshots of what
   the Stage added, and look at them.
   Test with infinite-HP pilots: in the game, a Delver Run with
   ?dev=1&delver=1&autopilot=1&immortal=1 (add speed=N to go faster); in soaks and slow tests that
   drive a party, keep the party at max HP each Tick with withImmortalParty (src/play/driver.ts),
   so a Run reaches the deep Floors and the Boss Floors instead of ending at a wipe. The immortal
   party is a test harness only: it never touches the Simulation or the shipped Tuning, and a test
   of wipes, revives or a Defeat must not use it.
4. Update docs/plans/delver.md yourself: tick the Stage under Progress, update the Status line, and
   add the Stage's "### Result" (what was built, what changed from the plan and why, test counts,
   measured timings, and what to try in a playtest). Update CONTEXT.md only for terms the code has
   now made true (the plan's Glossary says which). Stage 0 writes ADR 0028; Stage 9 marks what it
   supersedes.
5. Commit the review fixes, the Result and any ADR ("Delver Stage N: ...") and push to the working
   branch. Do not open a PR unless I ask: an ADR the plan says is "merged" counts as accepted once
   it is pushed to the working branch.
6. Stop. Tell me what was built, what to playtest and how, what you would watch for, and any
   decision you need from me before the next Stage. Do not start the next Stage.
```

## Notes
- **Why the orchestrator designs.** The Stages marked Opus (0, 1, 3, 6, 7) are geometry, brains and determinism. Sonnet codes them well from a precise contract and makes mistakes when it has to decide the shape itself. The `#### Design` section in the plan is that contract, and it stays as a record for later Stages.
- **Why tasks run one at a time.** Subagents share one working tree. Two running at once on overlapping files overwrite each other, and a red `npm test` from one stalls the other. Run in parallel only where the file scopes are disjoint.
- **Lessons from Stage 0.**
  - A measurement that never reached its subject passed with empty numbers: the Battle autopilot stuck on a wall, and nobody was promoted. Hence the Design's "what it must show it exercised".
  - A check that the spanning tree always satisfies (every room reaches the entrance) could not see a cut Passage. Check each Passage, not only reachability.
  - The first /code-review, run without a target, reviewed only the prompt's own commit.
- **To run several Stages unattended,** change Step 5.6 to "go on to the next Stage", but keep the stop after Stage 3 (the first playable Run against Warbands). Step 1's go check stops a run that reaches Stage 1 after a no-go.
