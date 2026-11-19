# Whirlwind: implementation prompt (an orchestrator, Sonnet subagents)

Paste this into a new session once. The session orchestrates Stages 1 to 5 of `docs/plans/whirlwind.md`: for each Stage it reads, designs, splits the Stage into tasks, hands each task to a Sonnet 5.5 subagent, reviews what comes back, and commits. It runs the Stages one after another without stopping, and stops before Stage 6 (the Flail), which needs its own design interview first.

```
You are the orchestrator for Stages 1 to 5 of docs/plans/whirlwind.md (the Whirlwind, a spinning
move that hits many enemies). You design, brief, review and commit; Sonnet subagents write the
code. Write code yourself only to fix a small thing in review (a few lines), never a whole task.
Do NOT do Stage 6 (the Flail).

READ FIRST (yourself, not a subagent)
- The whole of docs/plans/whirlwind.md: the Agreed design (fixed: do not re-litigate it), the
  Codebase map, the Tuning Data, the Stages, and the "### Stage N result" of every Stage already done
  (a Result overrides anything older in the plan).
- CONTEXT.md: Whirlwind, Action, Intent, Direction, Attack, Wind-up, Release, Recovery, Blade Sweep,
  Blade Speed, Block, Block Impact, Block Break, Kick, Shove, Throwing Dagger, Stagger, Knockdown,
  Chain Knockdown, Slide, Trade, Hit Zone, Chamber, Heavy Blow, Spin-up, Gait, Motion, Motion
  override, Pose Key, Guard, Tempo, Tick, Rollback, Reaction Time, Style, Crowd, Soldier, Bubble,
  Attack Slot.
- ADRs 0001, 0002, 0007, 0012, 0026, 0027, 0029.
- docs/plans/kick-mechanic.md: how the last new committed Action was built, the template here.
- The code the plan's Codebase map names. Always: src/sim/state.ts, src/sim/intent.ts,
  src/sim/actions/ (index.ts, kick.ts, attack.ts, types.ts), src/sim/step.ts, src/sim/combat.ts,
  src/sim/actions/block.ts. And by Stage:
  - 1: src/net/messages.ts (isIntent), src/controllers/local.ts, src/tuning/ (how a data/*.json is
    loaded and checked, e.g. kick), data/motions/ and how default Motions and overrides are found
    (weaponMotion), src/sim/hash.ts, src/sim/snapshot.ts.
  - 2: src/sim/gait.ts, src/sim/air.ts, src/sim/jumpArc.ts, src/sim/slide.ts, src/sim/pose.ts,
    src/sim/motion.ts (how crouch shapes a pose).
  - 3: src/sim/sweep.ts, src/sim/hitZones.ts, src/sim/chamber.ts, src/sim/mods.ts, wallStrike.test.ts,
    kickContact.test.ts, knockdown.test.ts, chainKnockdown.test.ts, heavyBlow.test.ts.
  - 4: src/render/ (cameraShake.ts, flailChain.ts, the swing trail, the Fighter view),
    src/audio/cues.ts, src/tuning/weapon.ts (whirlTurns), the controls help and HUD in src/play/.
  - 5: src/controllers/ai.ts (its header first), ai.test.ts, aiGolden.test.ts, data/ai.json,
    src/tuning/ (ai difficulties and Styles).

STEP 0: SET UP
In a fresh container run `npm ci` first. Record the commit you start from (`git rev-parse HEAD`).
Before each Stage, record the Stage's base the same way: it is that Stage's review range in Step 5.

STEP 1: PICK THE STAGE
The first unticked box under Progress in the plan. Only Stages 1 to 5. If Stages 1 to 5 are all
ticked, stop and report.
- If the Stage is unticked but already has a "#### Design" or "Whirlwind Stage N:" commits
  (`git log --oneline`), an earlier session left it half done. Do not design it again: read the
  Design and the commits, find the first unfinished task and resume. The base is then the commit
  before the Stage's first commit.

STEP 2: DESIGN, THEN SPLIT INTO TASKS
Before any subagent starts, write the Stage's design into the plan under the Stage, as a
"#### Design" section: the new types and their fields (WhirlwindAction's exact shape), every
function's name, file, signature and contract, the algorithm in prose where it is not obvious (how
the body turns 360° a turn while the heading is steered apart from it; the per-turn hit set; how a
Whirlwind contact is told apart in resolveContact; how the AI picks a moment and a steer), what is
hashed and snapshotted, the Tuning Data keys with their defaults, the events and their fields, and
which existing tests the Stage rewrites or re-records. Settle every open choice the plan leaves to
Stage 1 (e.g. the Direction when the last mouse movement was Overhead or Thrust) here, and say what
you chose. A subagent should never have to make a judgement call about determinism, the Action
model, the contact rules or the Simulation's shape. Make it yourself.

Then split the Stage into 2 to 5 tasks. Each task:
- has a clear file scope (the files it may create or change) that does not overlap another running
  task's files;
- ends in something testable on its own (a Simulation step and its tests, a render piece and a
  screenshot, an AI behaviour and its tests);
- is ordered by what it depends on. Run tasks one after another by default. Run two at once only
  when their file scopes are disjoint, neither needs the other's code, and neither imports a file
  the other changes: they share one working tree.
Use TaskCreate to track them.

STEP 3: BRIEF EACH SUBAGENT
Spawn each task with the Agent tool, model "sonnet" (Sonnet 5.5), `run_in_background: false`
unless you have independent review work to do meanwhile. A subagent starts with none of your
context, so each brief must stand alone and contain:
1. The goal in two or three sentences, and which Stage of docs/plans/whirlwind.md it belongs to.
2. What to read: the plan's Agreed design, its Stage and #### Design, the CONTEXT.md terms by name,
   and the exact files (with the functions in them) to model the code on (the Kick, first).
3. The file scope: the files it may create or change. Everything else is read-only.
4. The contract, copied from your Design: types, signatures, invariants, Tuning Data keys, events.
5. The rules that hold in this repo, all of them, every time:
   - Everything that decides an outcome is in src/sim, pure and deterministic (ADR 0001;
     purity.test.ts): no Math.random, no Date, no DOM or three.js, no iteration order of a Map or
     object keys that differs by insertion, every tie broken by a fixed index (Fighter index order).
   - Simulation state is plain data, hashed and snapshotted, so Rollback restores it exactly. Add
     Whirlwind fields so that a Fighter that never Whirlwinds hashes as before.
   - The Whirlwind hits through its Blade Sweep only (ADR 0002): never by radius. It meets full
     Fighters only, never Crowd Soldiers (ADR 0020).
   - Render and audio are a pure function of Simulation state and the Tick (ADR 0026): the trail,
     flash and whoosh look and sound the same when scrubbed, rolled back or replayed. They never
     change an outcome.
   - Nothing may change for a Fighter that never uses the Whirlwind: no Weapon file, Motion or
     existing expectation changes. The AI draws no new random number unless the Whirlwind is in
     its tier's repertoire. If an existing test breaks that the brief does not name as one this
     task rewrites or re-records, stop and report why; do not "fix" the test.
   - The Flail is out of scope: a Weapon without the Whirlwind Motion cannot start one.
   - Match the repo's comment style: rules explained in CONTEXT.md's domain words.
   - Do not commit or push. Do not edit docs/plans/whirlwind.md, CONTEXT.md or docs/adr/.
6. The tests to write (the plan lists each Stage's), named, with what each proves.
7. The done condition: `npm run typecheck` and `npm test` clean.
8. What to report back: the files changed, the test names and counts, anything that differed from
   the brief and why, and any open doubt. Short, no pasted code.

STEP 4: REVIEW EACH TASK BEFORE THE NEXT ONE STARTS
- Read the whole change yourself: `git status` (new files are untracked, and `git diff` does not
  show them) and `git diff HEAD`, and read every new file whole. Check it against the Agreed
  design, the #### Design, the CONTEXT.md terms and the rules, especially determinism, what ends up
  in SimState, and that nothing changed for Fighters that never Whirlwind.
- Run `npm run typecheck` and `npm test` yourself. Never take the report's word for it.
- If it is wrong, send the same subagent (SendMessage, so it keeps its context) a precise list of
  what to change. After two failed rounds on one task, re-brief a fresh subagent with the lessons,
  or narrow the task.
- If the Design itself turns out wrong, fix the Design in the plan first, then brief the change.
  If the Agreed design itself cannot work, stop and ask me.
- Once it passes, commit the task ("Whirlwind Stage N: <task>") and push to the working branch.

STEP 5: CLOSE THE STAGE
1. Run `npm run typecheck` and `npm test`, and `npm run test:slow` (the Stage touches src/sim,
   src/net or src/controllers). All must be clean. A recorded hash or the AI golden may move only
   where the #### Design said it would; re-record only that, and say so in the Result.
2. Run /code-review at high effort on the Stage's whole range with an explicit target:
   `/code-review high <base>..HEAD`, with a line naming the Stage's files and its #### Design.
   Hand the fixes to a Sonnet subagent with the findings as its brief, then review as in Step 4.
3. From Stage 2 on, use the run skill to play it in `npm run dev`: the Editor's sandbox, a Duel
   against an AI, and from Stage 3 a 4-a-side Duel and a Run Floor with a corridor. Use Playwright
   to hold G, release, steer, crouch and Jump mid-spin; take screenshots of the hold pose (Left and
   Right), the spin, a Hit, a Block and (Stage 4) the trail and armed flash, and look at them. Fix
   what looks wrong before going on.
4. Update docs/plans/whirlwind.md yourself: tick the Stage under Progress, update the Status line,
   and add the Stage's "### Stage N result" (what was built, what changed from the plan and why,
   test counts, the numbers worth tuning, what to try in a playtest). Update CONTEXT.md for terms
   the code has now made true: Stage 1 adds Whirlwind to the Action list and drops "planned" from
   its entry once it is fully built (Stage 3); Stage 5 updates Reaction Time. Stage 3 marks ADR
   0029 Accepted.
5. Commit ("Whirlwind Stage N: ...") and push to the working branch. Do not open a pull request.
6. Go on to the next Stage (Step 1). After Stage 5, stop: do not start Stage 6.

FINAL REPORT (after Stage 5, or if you stop early)
Tell me what was built Stage by Stage, the test counts, every deviation from the plan and why,
what to playtest and how (keys, modes, what to watch: the 2.5× re-hit damage, the 3 m/s drive
against the Knockdown Slide, hitting through Walls, Beginner AI as an easy target), the numbers in
data/whirlwind.json worth tuning first, and any decision you need from me.
```

## Notes
- **Why the orchestrator designs.** The Whirlwind touches the Action model, contacts and Rollback. Sonnet codes those well from a precise contract and makes mistakes when it has to choose the shape itself. The `#### Design` section is that contract, and it stays in the plan as a record.
- **Why tasks run one at a time.** Subagents share one working tree, so two running at once on overlapping files overwrite each other.
- **To stop for a playtest after each Stage,** change Step 5.6 to "Stop and tell me what to playtest."
