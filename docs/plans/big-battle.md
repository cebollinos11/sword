# Big Battle: 200 v 200 on an open field, with the duel's combat where the Players are

> Status: Stage 6 done (2026-11-03): an online Battle runs in the Rollback session. Milestone 1 complete. Next: Stage 7. Decisions below came from an interview, one question at a time. Milestone 1 (Stages 0 to 5) is offline with one Player; Milestone 2 (Stages 6 and 7) is online with up to four. Each Stage ends with a `### Result` written by whoever builds it (what was done, what changed from the plan, test counts), as in `docs/plans/dungeon.md`.

## Context
Every Match today is a Duel: at most four Fighters a Team (`MAX_TEAM_SIZE`), each a full Fighter with a Skeleton, Pose-Key IK, a Blade Sweep and an AI Controller run on every peer, all in a 60 Hz deterministic Simulation that rolls back up to 15 Ticks (ADR 0001, 0005, 0010). We want a Mount & Blade–style battle: 200 soldiers a side, up to four human Players, the rest AI. The Players get the full combat against whoever is near them, while the rest of the battle is a cheap simulation drawn as impostor sprites. A Player can fight some soldiers, break away, move and engage others, and soldiers convert between low and high detail as they come near or move away.

400 full Fighters cannot fit: a 15-Tick Rollback would be about 6,000 Fighter-Ticks of IK and AI in one frame. So the design has **two Simulation tiers** (the Crowd and full Fighters) and a deterministic rule for crossing between them.

## Decisions
- **The Crowd is simulated, not cosmetic.** Every soldier that is not a full Fighter is a **Soldier** in `SimState`: plain data (position, heading, HP, Team, target, a few timers), stepped by the Simulation, hashed, snapshotted and rolled back like everything else. Every peer sees the same battle, and its outcome counts. Only the Players' Intents cross the wire, as before (ADR 0001).
- **The Crowd steps at a low rate, staggered.** A Soldier updates every 6th Tick (10 Hz), with 1/6 of them on each Tick, so the cost per Tick is even. The renderer interpolates between a Soldier's updates. Steering uses a per-Team flow field over the open field plus separation from neighbours (spatial hash grid). No navmesh A* for the Crowd.
- **Soldiers fight Soldiers abstractly.** Two adjacent enemy Soldiers engage, and each Crowd step rolls damage from the Simulation's seeded generator, in the same HP units as a Fighter. The fights are slow and noisy, so equal armies are roughly a coin flip without Players.
- **Only full Fighters can hit full Fighters.** A Soldier never damages a Player's Fighter, and a full Fighter never fights a Soldier. Anything that fights a Player has a Skeleton, a Blade Sweep and Blocks. The duel's combat stays physical and blockable, everywhere it touches a human.
- **The Bubble: Soldiers near a Player become full Fighters.** Each human Player's Fighter has a **Bubble**, decided from Simulation positions, never from the camera, so every peer promotes alike. A Soldier inside it may be **promoted**: it takes a free slot of the **Fighter Pool**, a fixed-size array of full Fighters in `SimState`, starting at guard with the Soldier's position, heading, Team and HP. A full Fighter is **demoted** back to a Soldier (writing its position and HP back) when it leaves the Bubble. Distances have hysteresis: promote at ~10 m, demote beyond ~16 m. A Fighter is demoted only when its Action allows it (Idle or walking, never mid-Attack, Stagger, Knockdown or Fall), and not within ~1 s of its promotion.
- **The Fighter Pool is fixed-size.** The Players' Fighters hold permanent slots. The other slots are bound to Soldiers as they promote, so the snapshot's shape never changes. Size is set by profiling (Stage 0), with a starting guess of about 24.
- **Attack slots cap the pressure on a Player.** Each Bubble promotes at most ~4 enemies (the **Attack Slots**) and ~3 allies. Enemy Soldiers in the Bubble beyond the slots stay Soldiers and hold back in a ring outside sword reach, waiting. When a slot frees (a death, a demotion), the nearest waiting enemy promotes. The AI's existing teamwork (flanking, taking turns, spreading out) works within the slots.
- **Allies in the Bubble promote too**, from the budget's ally share, choosing the allies nearest the slot-holding enemies. Promoted allies fight promoted enemies with real combat and pull enemies off the Player. A full enemy whose target is a Soldier ally either waits, or that ally is promoted if the budget allows.
- **No free disengage.** A promoted enemy keeps chasing, and the Bubble moves with the Player. A Player breaks away with Kicks, Knockdowns, kills and allies who take the enemy's attention, not by walking away.
- **The waiting ring closes in front of a Player** (settled 2026-11-02). Soldiers are not solid to full Fighters in Milestone 1, so waiting enemies steer to stand in the Player's way: a waiting Soldier's ring spot is biased toward the Player's direction of travel, and Soldiers within a short distance of a full Fighter steer away from its path rather than letting it overlap them. This is steering only, never collision, so it costs nothing in the full Fighters' Simulation. Walking into a crowd of enemies pushes into a wall of them, which promote as slots free up. Real body-blocking stays Later.
- **Promoted soldiers are Beginner AI.** Elites (marked Skilled/Expert captains) were wanted but are deferred past Milestone 1.
- **All 400 on the field at once.** There is no field cap and there are no reinforcement waves.
- **A Team routs below ~20% strength** (Tuning Data), and the other Team wins. No hunt for the last stragglers. The losing side's Soldiers turn and flee toward their edge for a few seconds before the result screen.
- **A Player who dies takes over an ally Soldier.** It becomes that soldier: the generic soldier's Body and Weapon, and the Soldier's current HP. The Soldier promotes into the Player's permanent slot. The nearest living ally is chosen. A Player is out when its Team has no Soldiers left. This is the Controller model (the Local Controller now drives another Fighter) and is close to an AI Takeover in reverse.
- **No orders in Milestone 1.** The armies charge, and the Crowd picks targets. The Crowd's goal is one field per Team (later per squad), so Charge, Hold, Follow me and Form line can be added later without rework.
- **The battlefield is an open field with gentle terrain**, about 200 × 200 m. It is a deterministic heightfield (a function of the Match seed, ADR 0006), with no walls or ledges. Jump Links, falls and the Abyss stay out of this mode. Ground height is a cheap lookup for Soldiers and full Fighters alike.
- **One generic soldier per Team**, a fixed Body and Weapon with a team colour. The Players keep their chosen Body and Weapon until they die.
- **Two render tiers: the full model and an impostor.** Full Fighters are drawn as today. Soldiers are drawn as impostors: one instanced billboard draw per Team from a sprite atlas (8 directions × idle, walk, swing, hit, die). The atlas is baked in-engine from the generic soldier's own Body and Motions, so it matches what the soldier does when promoted. The swap happens at the promotion distance (~10 m), hidden by a short dithered crossfade and a dust puff.
- **The performance target is 60 fps on a mid-range laptop** (recent integrated GPU). Budgets: the Crowd step about 1 ms per Tick, the Fighter Pool as profiled, and about 2 draws per Team for the Crowd. This also leaves headroom for Rollback when online.
- **A minimap is in Milestone 1**: a top-down view of both armies and the Player, render only, so a Player can choose where to engage.
- **Players tip a fair fight.** The armies are equal, and a good Player's kills and rescues decide close battles.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Battle**: the Format of this mode, a Match of two armies of Soldiers on an open Battlefield, ending in a Rout. _Avoid_: war, siege, skirmish (the Lobby's offline mode).
- **Soldier**: a member of an army that is not a full Fighter right now: plain data in the Crowd, fighting other Soldiers by rule and drawn as an impostor. _Avoid_: unit, NPC, Fighter (for a Soldier).
- **Crowd**: all of a Battle's Soldiers and the low-rate step that moves and fights them. _Avoid_: horde, mob.
- **Bubble**: the region around a Player's Fighter where Soldiers promote to full Fighters. _Avoid_: LOD zone, radius.
- **Promotion / Demotion**: a Soldier becoming a full Fighter in a Fighter Pool slot, and back. A Simulation step, rolled back like any other. _Avoid_: spawn, despawn, LOD switch.
- **Fighter Pool**: the fixed set of full Fighter slots in a Battle's `SimState`. _Avoid_: active list.
- **Attack Slot**: one of the few places in a Bubble an enemy may fill to fight its Player. The others wait as Soldiers. _Avoid_: token, ticket.
- **Rout**: a Team breaking when its strength falls below the threshold, which ends the Battle.

## How it fits the existing code
- **`SimState` gains a Crowd**: Soldiers in flat arrays (struct-of-arrays) so a snapshot is a few typed-array copies (400 × ~12 numbers). It must stay plain, hashable data.
- **`fighters[]` becomes the Fighter Pool for a Battle.** `MAX_TEAM_SIZE` (4) and the Lineup assume a Duel's sizes, so a Battle needs its own Pool size, and every system that iterates `fighters` must tolerate unbound slots (a slot with no Soldier is out of play, not dead).
- **Promotion and Demotion are Simulation steps** at the start of a Tick. They are decided from positions, which follow from Intents, so they roll back and resync without new messages (the Dungeon's "choices by walking" rule, ADR 0019).
- **AI Controllers attach to a slot, not a Soldier.** A promoted slot gets a fresh Beginner AI memory, loaded at its Promotion Tick (as an AI Takeover is), so every peer's AI decides alike. A demoted slot drops its memory.
- **The AI must ignore Soldiers.** It sees, targets and blocks only full Fighters. Two new AI behaviours: hold back at the ring while waiting for an Attack Slot, and chase without giving up.
- **The Battlefield is a new Arena kind** beside the Generated Arenas (ADR 0014): a heightfield and no Kit, with `groundBelow` reading the heightfield. Full Fighters keep their collision against each other.
- **The renderer gains two systems**: an instanced impostor layer (atlas, team tint, crossfade with `fighterView` on Promotion), and the minimap.

## Working rules for every Stage
- **Determinism first** (ADR 0001): nothing in the Crowd, the Bubble or the Fighter Pool may read `Math.random()`, wall-clock time or render state. Every new piece of `SimState` is plain data, in `hashValue`, and survives snapshot and restore. Every Stage that adds Simulation state adds a test that a replay of the same Intents gives the same hash every Tick, and one that a Rollback across the new event re-simulates to the same state.
- **Duels do not change.** Every existing test passes at the end of every Stage, and no Duel or Dungeon number moves. The Battle's code sits behind its Format; shared code (the AI, `fighters[]` iteration, the renderer) only gains tolerance for what a Battle needs.
- **Tuning Data** for the mode lives in `data/battle.json` (parsed in `src/tuning/`), inside `tuningDataHash`. No magic numbers in code for anything this plan marks "~".
- **Vocabulary**: the Glossary above. `CONTEXT.md` changes in the same Stage as the code that makes a term true.
- **Checks before a Stage is done**: `npm run typecheck`, `npm test`, `npm run build`, and the Stage's "Check in `npm run dev`" list.
- **Stop at the end of each Stage** and write its `### Result`. The next Stage starts in a new context from this file.

## Stage 0: profile, then fix the budgets
Nothing here ships to players. It is a bench that answers how big the Fighter Pool, the Attack Slots and the Crowd rate can be on the target laptop.
- **A bench page** in the Editor (beside the sandbox, e.g. `#/editor/bench`), dev only. Its three scenes each run for a fixed time and report the mean and 99th-percentile ms per Tick or per frame:
  - **Fighters**: N full AI Fighters (8, 16, 24, 32, 40) in a melee on a flat Arena, stepping `stepMatch` with their AI Controllers. `MAX_TEAM_SIZE` is 4: the bench may build the state directly, or lift the limit for the bench only. Find out which is smaller and note it for Stage 3. Also measure the cost of a 15-Tick Rollback at each N (snapshot, restore, 15 re-simulated Ticks, AI `save()`/`load()`).
  - **Crowd**: a throwaway prototype of the Stage 1 Crowd step (struct-of-arrays, spatial hash, separation, steering toward the enemy, fake fights) for 400 Soldiers at 10 Hz staggered, plus the cost of `hashValue` and a snapshot copy of that data.
  - **Render**: 400 instanced billboards (placeholder texture) plus N skinned Body models, with the third-person camera in the middle of the crowd.
- **Run it** on whatever hardware is at hand, and write down the machine. If that isn't a mid-range laptop, note the gap and scale the budgets with a stated margin.
- **Output**: the `### Result` of this Stage has a table of the numbers and **fixes** the starting values for Stage 1 to 4: Pool size, enemy and ally slots per Bubble, the Crowd rate and stagger, and the Bubble distances if the numbers argue for a change. If 24 full Fighters don't fit in ~8 ms per Tick of Simulation with headroom for Rollback, say so: the design shrinks the Bubble's budgets, not the target.
- **Tests**: none required beyond the bench running without errors. The prototype Crowd code may be thrown away or kept as Stage 1's start.

### Result
Done 2026-11-02. The bench is `#/editor/bench` on the dev server (`src/editor/bench.ts`, left out of the build); its measurements are in `src/editor/benchCore.ts`, with no DOM, so they also run under Node, and `benchCore.test.ts` smoke-tests them at tiny sizes (4 tests). `npm run typecheck` and `npm run build` pass. `npm test`: 1607 passed, 5 skipped, and 3 failed on 20 s timeouts (the Door spot soak, the four-Player "goes silent" Rollback test, the navmesh-under-250 ms test). They are timing-bound and fail the same way without this Stage's changes: the Door spot soak takes ~25 to 30 s alone on this machine, and passes with a longer timeout.

**Machine**: MSI GF63 Thin 11SC laptop, Intel Core i5-11400H (6 cores, 12 threads, 45 W H-series), 8 GB RAM, on mains power, Windows 11, Balanced power plan. The page ran in the Claude desktop app's Chromium 152 on the **Intel UHD Graphics** iGPU (Tiger Lake-H, 16 EU; the laptop's GTX 1650 was not used), 1280 × 960 canvas at pixel ratio 1.25, 144 Hz display. Node 24 gave the same Simulation numbers within noise. **The gap to the target**: the CPU is faster than a mid-range laptop's U-series chip (assume a mid-range laptop is about 1.3× slower on the Simulation). The GPU is weaker than a recent integrated GPU (Iris Xe, Radeon 680M), so the render numbers err on the safe side. The budgets below use **1.3× the measured Simulation cost**.

**Fighters**: Beginner AI melee on the Editor's flat circle Arena, 600 Ticks for each N, all N still standing at the end (the worst case: nobody thins out). ms per Tick, mean / p99:

| N | AI intents | Tick (AI + `stepMatch`) | Online Tick (+ snapshot, AI `save()`) | 15-Tick Rollback | `hashValue(match)` |
|---|---|---|---|---|---|
| 2 (Node, reference) | 0.19 / 1.5 | 0.83 / 5.8 | 0.88 / 5.9 | 11 / 34 | 0.39 / 1.5 |
| 8 | 0.66 / 3.2 | 2.07 / 8.8 | 2.19 / 9.0 | 28 / 59 | 0.74 / 3.8 |
| 16 | 1.30 / 4.2 | 3.01 / 8.1 | 3.17 / 8.2 | 46 / 72 | 0.95 / 2.9 |
| 24 | 2.32 / 6.0 | 4.94 / 10.3 | 5.16 / 10.6 | 78 / 114 | 1.25 / 2.5 |
| 32 | 4.14 / 8.8 | 7.57 / 14.7 | 7.85 / 15.2 | 117 / 165 | 1.63 / 3.2 |
| 40 | 6.61 / 12.6 | 11.39 / 19.9 | 11.76 / 20.5 | 180 / 251 | 2.17 / 4.8 |

Every timed Rollback re-simulated to the same hash. Cost grows faster than N: the AI's share goes from a third to over half, because its team view looks at every ally against every enemy.

**Crowd prototype**: 400 Soldiers, 3600 Ticks (the armies meet and one wins). The step rebuilds the spatial hash every Tick, then updates 1/stagger of the Soldiers (separation, the nearest enemy within sight, a fake fight), and rebuilds each Team's flow field (BFS over a 50 × 50 grid) once a second. ms, mean / p99:

| stagger (rate) | step per Tick | `hashValue` (plain arrays) | FNV over the typed arrays' bytes | snapshot (typed arrays) | `snapshot()` (plain arrays) |
|---|---|---|---|---|---|
| 6 (10 Hz) | 0.21 / 1.0 | 1.31 / 4.5 | 0.12 / 0.3 | 0.10 / 1.1 | 0.14 / 0.3 |
| 3 (20 Hz) | 0.26 / 1.1 | 1.53 / 2.5 | 0.09 / 0.2 | 0.11 / 0.5 | 0.17 / 0.3 |
| 1 (60 Hz) | 0.67 / 3.2 | 1.45 / 2.5 | 0.08 / 0.2 | 0.11 / 0.3 | 0.16 / 0.3 |

**Render**: 400 instanced billboards (one InstancedMesh per Team, placeholder canvas texture, every matrix recomposed to face the camera each frame) in a ring 8 to 40 m around N `female` skinned Bodies posed from a recorded melee, through the third-person camera behind Fighter 0. ms per frame, mean / p99:

| N | CPU (pose + update + draw) | frame interval | draw calls |
|---|---|---|---|
| 0 | 3.9 / 7.6 | 7.2 / 14.0 | 4 |
| 8 | 8.5 / 17.1 | 9.7 / 20.9 | 104 |
| 16 | 10.8 / 18.6 | 11.8 / 21.0 | 196 |
| 24 | 11.7 / 18.6 | 12.5 / 21.0 | 290 |
| 32 | 13.4 / 21.5 | 14.3 / 21.0 | 395 |
| 40 | 15.8 / 24.3 | 16.6 / 27.8 | 420 |

The 400 billboards are cheap (2 draws, under 4 ms of frame with the Arena). Each Body costs about 12 draw calls, and `drawnPose` solves `fighterPose` twice per Body per frame. The Bodies dominate the frame, not the Crowd.

**What this fixes for Stages 1 to 4:**
- **24 full Fighters do not fit.** At 24, a Tick is 4.9 ms here and ~6.4 ms on the target, with a p99 of 10 to 13 ms, and the frame needs ~12 ms of rendering on top. That is over 16.7 ms on its own, with nothing left for Rollback. So the Bubble's budgets shrink, as the plan says, not the target.
- **Fighter Pool: 16 slots.** In steady state a Bubble binds 1 Player + 4 enemies + 3 allies = 8 Fighters: 2.1 ms per Tick here (~2.7 ms on the target) and ~8.5 ms of render. The other 8 slots absorb Fighters that are still waiting to demote (the 1 s minimum, the Action gate, the hysteresis band). 16 bound Fighters, the most the Pool allows, is 3.0 ms per Tick (~3.9 ms on the target) plus ~11 ms of render, which is inside a 60 fps frame. Stage 3 never binds more than 16.
- **Attack Slots: 4 enemies and 3 allies per Bubble**, unchanged.
- **Crowd: every 6th Tick (10 Hz), 1/6 of the Soldiers each Tick.** 0.21 ms per Tick (p99 1.0) is well inside the 1 ms budget. 20 Hz (stagger 3) costs about the same, which is room to spare if Stage 2's impostors look jerky.
- **Crowd state as plain number arrays, not typed arrays, in Stage 1.** `snapshot()` (a deep copy) would turn a typed array into a plain object, and `hashValue` walks it as an object with sorted keys. Plain arrays work with today's `snapshot`, `hashValue` and JSON resyncs, at 0.14 ms per snapshot (every Tick online). `hashValue` costs 1.3 ms, but it only runs for the periodic checksum. A byte-level fast path (0.1 ms) is available if checksums ever need it.
- **Bubble distances: unchanged.** Promote at 10 m, demote beyond 16 m, no Demotion within 1 s of Promotion. The numbers don't argue for a change. A smaller demote distance would only cut render cost, which the Pool cap already bounds.
- **`MAX_TEAM_SIZE`: building the state directly is smaller.** `createInitialState` and `stepMatch` take any number of Fighters; only `createMatch`'s `checkTeams` enforces 4 a side. Stage 3's Battle Format should skip that check, not lift the constant. `net/messages.ts` also caps Fighters at `2 * MAX_TEAM_SIZE`, which matters in Stage 6. One shared-code tolerance fix was needed: the AI's flank table (`FLANKS`) only covered 2 to 4 allies on one target and crashed at 5 or more. More than 4 are now spaced evenly round the target, and 4 or fewer behave exactly as before.
- **Online (Stage 6) will not fit as planned**, and this is flagged now. A full 15-Tick Rollback is 28 ms at 8 Fighters, and even a 1 v 1 Duel takes 11 ms. In practice a Rollback re-simulates about the round trip (~3 to 6 Ticks), and at 16 bound Fighters that is still 9 to 18 ms. Stage 6's shrinking rule should aim for about 8 to 10 bound Fighters in total across the four Bubbles (e.g. 2 enemies + 1 ally each when four Bubbles are apart), unless the AI's team view and `drawnPose`'s double solve are made cheaper first. Both are the obvious targets.

## Stage 1: the Battlefield and the Crowd in the Simulation
A Battle with no Players fighting: two armies meet, fight by rule and one routs. Only debug rendering.
- **`data/battle.json`**: army size (200), Battlefield size and terrain parameters, Crowd rate and stagger, Soldier walk speed, HP, damage range and engage reach, separation radius, flow-field cell size, Rout threshold and rout duration. Its parser and its place in `tuningDataHash`.
- **The Battlefield**: a new Arena kind built from its name alone (e.g. `battle:<seed>`) as a deterministic heightfield of gentle hills, about 200 × 200 m, with no Walls, no Kit, no Jump Links and no Abyss. `groundBelow` and whatever the Fighters' movement uses read the heightfield. Each Team's spawn area is on opposite edges.
- **The Crowd in `SimState`**: Soldiers as struct-of-arrays (position, heading, velocity, HP, Team, target index, engage timer, alive, rout flag), stepped inside `stepMatch` for the Battle Format: each Tick updates the Soldiers whose index matches the Tick modulo the stagger.
  - **Steering**: a per-Team flow field on a coarse grid toward the enemy army (recomputed at a low rate, e.g. once a second, itself staggered), plus separation from neighbours through a spatial hash, plus arrival at the nearest enemy Soldier within sight.
  - **Fighting**: an enemy within engage reach becomes the target; each Crowd step rolls damage from the seeded generator; at 0 HP a Soldier dies and stops counting.
  - **Rout**: when a Team's living Soldiers fall below the threshold, its Soldiers flee toward their own edge, and the Battle ends with the other Team's win after the rout duration.
- **The Battle Format**: `MatchState` knows it is a Battle, how it ends and who won. In this Stage the Players' Fighter can be absent (an AI-vs-AI war) or present and ignored by the Crowd.
- **Debug view**: the Editor (or a dev flag in Skirmish) draws Soldiers as coloured dots or boxes on the Battlefield, with a free camera, so the war can be watched.
- **ADR 0020: a Battle simulates its armies in two tiers** (the Crowd and the Fighter Pool, Soldiers never damage Fighters, Promotion decided from positions). Written in this Stage, Accepted when Stage 3 lands.
- **`CONTEXT.md`**: Battle, Soldier, Crowd, Rout.
- **Tests**:
  - Same seed and Intents give an equal `hashValue` every Tick; snapshot and restore mid-battle continue identically.
  - The heightfield is the same for the same name, and `groundBelow` agrees with it.
  - The Crowd step stays within the Stage 0 budget for 400 Soldiers (a timing test with generous slack, or a soak that logs).
  - The staggering updates every Soldier exactly once per stagger period.
  - Separation: no two living Soldiers overlap beyond a tolerance after the armies meet.
  - Rout fires below the threshold and the Battle ends with the right winner.
  - Over many seeds, equal armies win about 50/50 (within a band that Stage 5's tuning may tighten).
- **Check in `npm run dev`**: watch three seeds of a full AI-vs-AI war end in a Rout.

### Result
Done 2026-11-02. A Battle runs from `createMatch(tuning, { format: 'Battle', bestOf: 1, seed })`: two armies of 200 meet, fight by rule, one routs and the other wins, every Tick hashed and rolled back like a Duel.

- **`data/battle.json`** (`src/tuning/battle.ts`, `TuningData.battle`, in `tuningDataHash`): `armySize`; `field` (size 200 m, heightfield `cell` 5 m, `hillHeight` 2.5 m, `hillLength` 70 m); `deploy` (front rank 40 m from the centre, ranks of 20, 1.5 m apart both ways); `crowd` (`stagger` 6, `walkSpeed` 2.5, `hp` 100, `damage` [8, 20], `hitChance` 0.2, `engageReach` 1.6, `separation` 0.9, `sight` 12, `flowCell` 4); `rout` (`threshold` 0.2, `seconds` 5). The parser checks the army fits the field. The Stage 0 prototype's numbers, except `hitChance` (0.35 → 0.2: at 0.35 the melee was over in about 8 s; now about 17 s from contact to Rout, and about 35 s per war).
- **The Battlefield** (`src/sim/battlefield.ts`): `arenaOf` builds `battle:<seed>` from `battle.field` (cached, like a Generated Arena). Heights are four seeded sine waves sampled on the grid; each grid cell is two flat triangles, and those 6,400 triangles are the Arena's Walk Surfaces, so `groundBelow`, `settleGround` and a Fighter's walk need no change and stand on exactly the ground `battlefieldHeight` gives the Crowd in constant time. No Walls, Doors, Kit or deadly ground. Spawns for 4 Fighters a Team sit behind each army.
- **The Crowd** (`src/sim/crowd.ts`, `SimState.crowd`): plain number arrays `x, z, vx, vz, heading, hp, team, target, engage, alive`, plus its own `rng` and `rout`. `stepCrowd` is pure (it copies the arrays, about 4,000 numbers, and writes the copies). Steering, fighting and the Rout are as planned. `step` carries `crowd` through; `stepBattle` (`src/sim/battle.ts`) steps it after the Fighters and ends the Battle. New Match events: `Rout` and `BattleEnd`.
- **The Battle Format**: `MatchFormat` gains `'Battle'`, but `MATCH_FORMATS` (the Lobby's list and the wire's) stays Duels and Gauntlet, so online play refuses a Battle until Stage 6. `createBattle` skips `checkTeams`: `teams` are only the Players' Fighters, 0 to 4 a Team, default none; a Battle has no Rematch.
- **Debug view**: `#/editor/battle` (or `#/editor/battle/<seed>`), dev server only and left out of the build (`src/editor/battleView.ts`): the heightfield as a shaded mesh, each Soldier a box in its Team's colour (lying grey once fallen), an orbit camera, a panel with the Tick, each army's strength, the Rout and the winner, a seed box, restart and speed (paused to 8×).
- **ADR 0020** (Proposed) and **`CONTEXT.md`**: Battle, Soldier, Crowd, Rout, and the Format entry.

**What changed from the plan:**
- **The flow field is rebuilt from the current positions whenever a Soldier needs it, not once a second.** A field kept for a second would be state (2 × 2,500 numbers to hash and snapshot); rebuilt each Tick it is scratch, and a Team's BFS over 50 × 50 cells costs little. The spatial hash is scratch too.
- **The stagger goes by a Soldier's place in its own army**, not its index. By index, Team 1's k-th Soldier always stepped a fixed number of Ticks after its mirror in Team 0, and Team 0 won 71 of 100 equal Battles. The flow grid's cells are also counted outward from the centre on each side (`flowIndex`), so mirrored Soldiers on a cell edge see mirrored fields. After both: 47 / 53 over 100 seeds.
- **A Tick's blows land together after its steps**, so the order Soldiers step in never decides who strikes first.
- **Separation**: the push apart is added on top of the walk (capped at half the separation a step), and a Soldier never walks toward a neighbour it already overlaps. With the prototype's (the push inside the walk's speed cap), back ranks piled into the front to 0.1 m apart; now the closest living pair stays above 0.2 m.
- **Rout is per Team (`crowd.rout`), not a per-Soldier flag.** Every Soldier of a routed Team flees, so a flag per Soldier would only repeat it. If both Teams fall below the threshold on one Tick, the one with fewer left routs (the Crowd's generator picks on a tie).
- **One `stagger` number** stands for both the rate and the stagger (they are the same: every 6th Tick, 1/6 of the Soldiers each Tick).
- **The armies deploy 40 m from the centre**, not at the field's edges (80 m apart, about 15 s of marching). They still flee to their own edge.
- **The field has no edge Walls**, as planned: the Crowd is clamped inside the field, but a Fighter could walk off the 200 m square and fall. This matters from Stage 3, when Fighters move about the field.

**Measured** (this laptop, Node, `battle.test.ts`): the Crowd step for 400 Soldiers over a whole war is **0.38 ms mean, 1.2 ms p99** per Tick (copies included). The Stage 0 prototype measured 0.21 / 1.0 ms, and the budget is about 1 ms. A full `stepMatch` of a Battle with no Fighters is 0.4 to 0.6 ms mean.

**Check in `npm run dev`** (`#/editor/battle/<seed>` at 8×): seed 1, Team 0 routed at Tick 1786 and Team 1 won at Tick 2086 (28 v 49 left); seed 2, Team 1 routed at Tick 1789 and Team 0 won at Tick 2089 (49 v 28); seed 3, Team 0 routed at Tick 1781 and Team 1 won at Tick 2081 (23 v 52). No console errors.

**Tests** (`src/sim/battle.test.ts`, 12; `src/tuning/battle.test.ts`, 3): the Battle Format and what it refuses; a Duel has no Crowd; the same seed and Intents (with a walking Player Fighter) give the same `hashValue` every Tick for 700 Ticks; a snapshot mid-battle continues identically, and a Rollback across the Rout lands on the same final state; Rout fires on the Tick a Team falls below the threshold, once, and the Battle ends `routTicks` later with the other Team's win (also on a hand-made Crowd, whose routed Soldiers flee toward their edge); every Soldier steps exactly once per stagger period, and moves on its due Ticks only; no two living Soldiers come within a sixth of the separation after the armies meet, in a full 400-Soldier war that also times the Crowd step (logged, and asserted under 5 ms mean); 40 seeds of 40 v 40 give Team 0 between 10 and 30 wins (17 now); the heightfield is the same for the same name and differs by seed, has no Walls or deadly ground, and `groundBelow` agrees with `battlefieldHeight` to 1e-9 at 400 random points and on grid corners and edges; `data/battle.json` parses, rejects bad values and is in the Tuning Data hash. Two existing tests needed the new `battle` section in a literal (`tuning.test.ts`'s raw fixture, `hash.test.ts`'s key-order check); no existing assertion changed. `npm run typecheck` and `npm run build` pass (the debug view is not in the build). `npm test`: **1613 passed, 5 skipped, 11 failed**, all of them timing-bound (9 timeouts, and the two navmesh-under-250 ms assertions at 350 to 420 ms), in suites a Battle never runs: the Door spot soak, the four-Player Rollback tests (silent, leave, resync), the Random Map rematch, the Floor graph soak, the pickups test, the generator's 200-seed soak, `ai.duckMaxPitch`. Which tests fail changes from run to run. The machine was slower that day than at Stage 0 (3 failures then): the same full run on the tree **without** this Stage's changes (stashed) gave **1590 passed, 5 skipped, 16 failed**, every one timing-bound, a superset of the same tests. So no failure comes from this Stage, but this laptop can no longer say that the suite is green under a full parallel run.

## Stage 2: rendering the Crowd
The war looks like a war: terrain, impostors, team colours.
- **The generic soldier per Team** named in `data/battle.json` (a Body and a Weapon from the roster), with a team colour.
- **Impostor atlas, baked in-engine**: an offscreen pass renders the generic soldier's Body playing its real Motions (Idle, walking under the Gait, one swing, a Stagger, a death) from 8 directions into a sprite atlas. Bake at load or as a dev command that writes the atlas into `public/` (pick the simpler one and say why in the Result). Team tint is applied in the shader, so one atlas serves both Teams.
- **Impostor layer**: one instanced billboard draw per Team, choosing the direction cell from the camera-relative heading and the animation from the Soldier's state, interpolating positions between Crowd updates.
- **Terrain mesh** for the heightfield, and the existing sky. Blob shadows for Soldiers if cheap.
- **Spectator camera** for an AI-vs-AI Battle, and a dev-only Skirmish entry to start one.
- **Tests**: the direction-cell and animation-frame choice (pure functions); the atlas layout; the render-side interpolation. Render frame time with 400 impostors stays inside the Stage 0 budget.
- **Check in `npm run dev`**: a full war from the spectator camera at the target frame rate; impostors face the right way while walking, fighting and dying.

### Result
Done 2026-11-02. A Battle is drawn as it will be played: `#/battle/<seed>?dev=1` (or **Battle (dev)** on the title screen with `?dev=1`) shows an AI-vs-AI war on the Battlefield's terrain under the sky, every Soldier an impostor in its Team's colour, from a spectator camera. Nothing under `src/sim` changed: seeds 1, 2 and 3 still end on Ticks 2086, 2089 and 2081 with the same winners as at Stage 1, and the Crowd gained no state.

- **The generic soldier** (`data/battle.json` `soldier`, `SoldierTuning`, in `tuningDataHash`): `body` `female` (the Warrior), `weapon` `Arming Sword` (checked against the Weapon roster), `colours` `#c0392b` and `#2e86c1` (the Duel's Team red and blue).
- **Clips from the Simulation** (`src/render/soldierClips.ts`, no WebGL): the real `step` runs on scripted Intents and each frame is posed through `drawnPose`, then moved into the Fighter's own frame. The clips: Idle (one 2 s loop of its Motion); walking forward under the Gait (two strides from a left foot's Step, 2.5 m, played at the Crowd's walk speed, 1.0 s a loop); one Overhead swing back to Idle (1.1 s); the Stagger from an unblocked Overhead until Idle (0.5 s); and the fall from 1 HP, its Death Ragdoll (1.4 s). Recording takes about 0.4 s.
- **The atlas** (`src/render/impostorAtlas.ts`, layout in `src/render/impostor.ts`): those 36 frames (4 + 8 + 10 + 6 + 8) from 8 directions, 10° above level, through an orthographic camera into 288 cells of 128 px (2.9 m square, the feet 0.35 m up). They go into a 2176 × 2176 sRGB render target, with mipmaps generated once at the end. The Body's team-coloured part (`*_Skirt`) is baked white, and again as a mask into a half-size target of the same layout, so the shader tints it: one atlas for both Teams. `atlasLayout` halves the cell if the GPU's texture limit is smaller.
- **The impostor layer** (`src/render/crowdView.ts`): one `InstancedBufferGeometry` billboard draw per Team (200 instances each, a `ShaderMaterial` with fog). The vertex shader turns each billboard about the vertical to face the camera, so per frame the CPU writes only each Soldier's feet (3 floats) and atlas cell (2). Blob shadows are one more instanced draw for all 400, tilted to the ground's slope. The pure parts are in `src/render/impostor.ts`:
  - `directionCell`: the camera's bearing from the Soldier relative to its heading, to the nearest of 8.
  - `soldierFrame`: a fallen Soldier plays its fall once, then holds the last frame; one struck within a Stagger's length plays the Stagger; an engaged one loops the swing; one faster than 0.4 m/s walks; any other stands Idle. Loops run on Battle time from a per-Soldier offset, so ranks are not in step.
  - `soldierAt`: the interpolation.
- **The interpolation needs no state.** A Soldier's velocity is its last step's, so the step began at its position less its velocity over the step. `soldierAt` glides from there to where the step ended over the `stagger` Ticks after its last due Tick (`lastStepTick`, from `crowdDue`'s rule). A Soldier is drawn one step (0.1 s) behind and never jumps when a Tick arrives. The Crowd does not hold when a Soldier was struck or fell, so the view notes it itself when it sees HP drop or `alive` go to 0 (render memory, reset on a restart). A Soldier already fallen when first seen lies at rest.
- **Terrain** (`src/render/battlefieldView.ts`): a mesh of the heightfield with each cell split along the Walk Surfaces' diagonal, so it is exactly the ground the Crowd and `groundBelow` stand on. Beyond the field it carries on at the edges' height in strips out to 400 m, with vertex-coloured grass, drier on the hilltops. Above it: the existing sky dome (`sky.ts`) in a dusk look, a low warm sun, and haze from 70 to 320 m. `Stage` draws a `battle:` Arena this way and sets the camera's far plane to 600 m for it (200 m otherwise, as before).
- **The spectator camera** (`src/play/battleSpectator.ts`): orbit controls whose aim eases toward `battleFocus` (the middle of the engaged living Soldiers, else of all living ones). It circles slowly until the mouse takes it (drag, right-drag, wheel); **Follow** hands it back. It stays 2 m above the ground. A panel shows each army's strength, the Rout, the winner, the speed (paused to 4×), a seed box, restart and quit, and the frame's cost. For checking a page that is not drawing (dev only, from the console): `battleSeek(seconds)`, `battleLook(x, z, distance, yaw, height)` and `battleBench(frames)`.
- **Shared code** gained only what this needed: `FighterView.ready` (a promise that resolves once the Body model is in); `loadBodyModel` keeps each material's name, so the bake can find the team-coloured part; `blobTexture` is exported; and `Stage.build` has the Battlefield branch. No Duel or Dungeon behaviour or number changed.
- **`CONTEXT.md`**: the Soldier entry says how it is drawn.

**What changed from the plan:**
- **Baked at load, not as a dev command writing into `public/`.** This is simpler: no image encoding, and no file to commit and keep in step with the Body, the Motions and the Weapon (a change to any of them shows in the soldier at the next load). The Battle is offline for now, so loading is the Battle's start. The bake takes about 1.1 s, including the Body model's download and the clip recording, once per page. If that ever matters, the same function can write the targets to a file.
- **One generic soldier for both Teams, with two colours**, not a soldier per Team. One atlas can serve both Teams only if they share a Body and Weapon, so `battle.soldier` is one entry with `colours`.
- **The Warrior, not the Asturian.** The Asturian's team-coloured part is a thin belt, and the armies could not be told apart beyond 20 m. The Warrior's skirt shows from every side.
- **A Stagger plays whenever a Soldier's HP drops, and an engaged Soldier swings in a loop.** The Crowd rolls blows without recording who swung, and recording it would add state for drawing's sake. In a melee most front-rank Soldiers are struck about once a second, so the Stagger plays often. It reads as a melee.
- **Cylindrical billboards.** The atlas is baked 10° above level and turned only about the vertical. From a high spectator camera the fallen look flat, like a lying body seen edge-on. That is fine for a crowd, and the third render tier (Later) covers the near ones.
- **The dev entry is on the title screen**, not in the Skirmish Lobby, which offers only `MATCH_FORMATS`; Stage 5 puts the Battle in the Lobby. The route opens only with `?dev=1`, and the spectator is its own lazily loaded chunk.

**Measured** on this laptop, as at Stage 0 (Intel UHD iGPU in the Claude desktop app's Chromium):
- **`CrowdView.update`** for 400 Soldiers through a whole war, in Node (`crowdView.test.ts`): **0.74 ms mean, 1.8 ms p99** per frame.
- **In the browser**, through `battleBench`, over a whole war of seed 2 at 780 × 787. Each frame steps a Tick, updates the impostors and draws the scene, then calls `gl.finish()`. Per 300-frame window: the update alone **0.6 to 1.2 ms** mean, update plus draw **2 to 7 ms** mean, the GPU finished within 0.2 ms of that, and **5 draw calls** (sky, terrain, two Teams, shadows). That is inside the Stage 0 budget: 400 billboards under 4 ms of frame with the Arena, and 2 draws for the Crowd.
- **The p99 had spikes of 20 to 170 ms**, but the same spikes came with a frozen Crowd and no Simulation (p50 1.5 ms, p99 31 ms). The Browser pane was hidden for the whole check, so the page ran as a background page and its `requestAnimationFrame` did not run at all. No real frame rate could be read; the costs above come from frames drawn synchronously. A check by eye at 60 fps in a visible window is still to do.

**Check in `npm run dev`** (`#/battle/<seed>?dev=1`): seeds 1, 2 and 3 each played to the end (Team 1, Team 0 and Team 1 won, on Ticks 2086, 2089 and 2081), with no console errors. Stills from the spectator camera show:
- both armies marching, each seen from the right side (its back from its own side, its front coming on), both at the flow field's diagonal;
- the front ranks in the melee mid-swing, facing their enemies;
- the fallen lying along the line of contact;
- the routed Team fleeing toward its edge, seen from behind, with the winners following.

The frame rate in a visible window was not seen (see Measured).

**Tests**:
- `src/render/impostor.test.ts` (12):
  - the direction cell: 0 at the front, counting the way yaw turns; the same when Soldier and camera turn together; rounding at the halfway point; a Soldier walking away shows its back;
  - the atlas layout: a cell for every clip, frame and direction, each its own and inside the atlas; about square; halving to fit;
  - `soldierFrame`: the clip from the state; a fall played once and held; a Soldier already down lies at rest; loops on Battle time, with neighbours out of step;
  - `lastStepTick` agrees with `crowdDue`;
  - `soldierAt` glides from the step's start to its end and holds;
  - through a whole war, no Soldier's drawn position jumps when a Tick arrives (to 1e-9).
- `src/render/soldierClips.test.ts` (5): every clip's frames and length; every pose inside an atlas cell, standing at the origin facing +z; the swing over the head, the Stagger dipping, the fall ending on the ground; `localPose`; the data's soldier is a Body model.
- `src/render/crowdView.test.ts` (3): three draws; each Soldier's cell matches its heading from the camera's bearing (Team 0 from behind, Team 1 from in front), with its feet on the ground; the first Soldier to fall shows its fall's first frame, and later its last; the update for 400 Soldiers through a war (logged, asserted under 4 ms mean).
- `src/play/battleSpectator.test.ts` (2): `battleFocus`.
- `src/tuning/battle.test.ts` (+1): the soldier's Weapon, colours and Body are checked, and the soldier is in the Tuning Data hash.

One existing test needed the new `soldier` entry in a literal (`tuning.test.ts`'s raw fixture); no existing assertion changed. `npm run typecheck` and `npm run build` pass. `npm test`: **1642 passed, 5 skipped, 5 failed**, all timing-bound and on Stage 1's list: three 20 s timeouts (the Door spot soak, the four-Player "goes silent" Rollback test, the Run pickups test) and the two navmesh-under-250 ms checks. That is fewer failures than at Stage 1 (11), so no comparison against the unchanged tree was needed.

## Stage 3: the Fighter Pool and the Bubble
A Player fights in a Battle. Soldiers near them become full Fighters and go back to the Crowd when the Player moves on.
- **The Fighter Pool**: in a Battle, `fighters[]` is a fixed-size Pool (size from Stage 0). The Player's Fighter holds slot 0. Other slots are unbound or bound to a Soldier. Every system that iterates `fighters` (step, hits, AI perception, the HUD, the renderer, hashing) treats an unbound slot as out of play, not dead. Lift or bypass `MAX_TEAM_SIZE` for the Battle only.
- **Promotion** (a Simulation step at the start of a Tick): a living Soldier within the promote distance of a Player's Fighter takes a free slot, as a full Fighter at guard with the Soldier's position, heading, Team and HP, its generic Body and Weapon, and a fresh Beginner AI Controller loaded at that Tick (as an AI Takeover is). The Soldier is marked as promoted and leaves the Crowd step.
- **Demotion**: a promoted Fighter beyond the demote distance, in an Action that allows it (Idle or walking), at least ~1 s after its Promotion, writes its position, heading and HP back to its Soldier and frees the slot. A promoted Fighter that dies kills its Soldier.
- **A simple cap for now**: promote nearest first while slots are free. Attack Slots and allies come in Stage 4.
- **The AI ignores Soldiers**: AI perception, targeting and Block decisions only see bound slots. A Soldier never targets a full Fighter: Soldiers within the Bubble but not promoted hold position outside sword reach.
- **The swap**: render-side, a short dithered crossfade between the impostor and the full model plus a dust puff at Promotion and Demotion.
- **`CONTEXT.md`**: Bubble, Promotion / Demotion, Fighter Pool. ADR 0020 Accepted.
- **Tests**:
  - Promotion then Demotion round-trips a Soldier's state (position, heading, HP) exactly when nothing happened in between.
  - Hysteresis: a Fighter standing between the promote and demote distances neither promotes nor demotes repeatedly.
  - No Demotion mid-Attack, Stagger, Knockdown or Fall.
  - A Rollback across a Promotion and across a Demotion re-simulates to the same hash, AI memory included.
  - No Soldier ever changes a full Fighter's HP (a soak asserting it every Tick).
  - Unbound slots are never hit, targeted or drawn.
  - Every Duel and Dungeon test still passes.
- **Check in `npm run dev`**: walk a Player into the enemy army, fight, walk away from a quiet area and see Soldiers demote; the swap is masked by the crossfade.

### Result
Done 2026-11-02. A Player fights in a Battle: `#/battle/<seed>/play?dev=1` (or **Battle, playing (dev)** on the title screen with `?dev=1`) puts the local Player's Fighter behind Team 0's army with Skirmish controls and the third-person camera. Enemy Soldiers near the Player become full Fighters, fight, and go back to the Crowd, with a dithered crossfade and a dust puff each way. ADR 0020 is Accepted.

- **Tuning Data** (`data/battle.json` `bubble`, `BubbleTuning`, in `tuningDataHash`): `poolSize` 16, `promote` 10 m, `demote` 16 m, `minPromotedSeconds` 1, `corpseSeconds` 3, `hold` 3 m. The parser refuses a demote distance not above the promote one, and a hold not below it.
- **The Fighter Pool**: `createBattle` builds the Players' Fighters (`teams`, still 0 to MAX_TEAM_SIZE a Team) and then fills the Pool to `poolSize` with unbound slots. `checkTeams` is never called, and the constant is not lifted (Stage 0's advice). **An unbound slot is Benched** (`unboundSlot`: 0 HP, no Death, at the field's centre). That is a Run's empty enemy slot, which every system that iterates `fighters` already treats as out of play, not dead: it is not stepped, hits and is hit by nothing, blocks no bodies, is not drawn, is no AI's target, and gets no HUD bar. A bound slot carries `FighterState.soldier` (`{ index, since }`: its Soldier and its Promotion Tick), and the Soldier carries `crowd.slot` (its slot, or -1). Both are plain data in `hashValue` and the snapshot. Both are absent or all -1 outside a Pool, so a Duel's and a Run's state hash as before.
- **The Bubbles' step** (`src/sim/bubble.ts`, `stepBubbles`), at the start of each Battle Tick before the Fighters step, from Simulation positions only:
  - a promoted Fighter that fell kills its Soldier where it fell (0 HP, `alive` 0, so the Rout counts it). `corpseSeconds` later its slot frees, the Soldier lying in the Crowd;
  - **Demotion**: further than `demote` from every Player's Fighter in play, Action `Idle` and not airborne (so never mid-Attack, Block, Stagger, Knockdown or Fall), and at least `minPromotedSeconds` after its Promotion. It writes position, heading and HP back, with velocity 0 and no target;
  - **Promotion**: each living, unpromoted Soldier of a Team that has not routed, within `promote` of an *enemy* Player's Fighter in play, nearest first (ties by index), into the free slots in order. The new Fighter is `standingFighter` (the old per-Fighter part of `createInitialState`, factored out unchanged) at the Soldier's place and heading, with the generic soldier's Weapon, the Soldier's Team and HP, max HP `crowd.hp`, and `soldier: { index, since: tick }`.
- **The Crowd step** skips promoted Soldiers: they don't step, aren't in the spatial hash or the flow field, and are never struck. `stepCrowd` takes the full Fighters in play (`CrowdFighter`: place and Team). No Soldier's step ends within `hold` of an enemy one: it is put back on that circle, away from the Fighter. This is steering only, never collision. **A Battle's Duel never ends by its Fighters** (`step` skips `updateDuel` when there is a Crowd): only the Rout ends a Battle, and a Player who falls lies there (taking over an ally is Stage 5).
- **The Pool AI** (`src/controllers/poolAi.ts`, `poolControllers`): one Controller per slot. On a slot's first Tick bound to a Soldier it starts a Beginner AI (`SOLDIER_DIFFICULTY`) from fresh memory, as an AI Takeover starts one. Its `save()` is that binding plus the AI's memory, and an unbound slot gets `IDLE_INTENT`. The AI already looked only at Fighters that are `inDuel`, so it sees, targets and Blocks only bound slots and the Players.
- **Render** (`src/render/bubbleSwap.ts`, `dither.ts`): `BubbleSwap` reads the slots' bindings each frame. For `SWAP_SECONDS` (0.35 s) after a Promotion the model fades in while the impostor fades out, and after a Demotion the reverse, the model holding the pose it last showed. Each swap raises a `Swap` dust puff (`ImpactEffects.dust`). Both fades drop pixels in one 4 × 4 ordered-dither pattern, complementarily: the model's materials are patched on first fade (`setDitherFade`, `FighterView.setFade`), and the impostor shader reads a new per-instance `aFade`. So mid-swap every pixel shows one of the two. A promoted Soldier's impostor and its blob shadow are hidden, and its blows and fall while promoted are not replayed when it comes back (a Soldier that fell as a Fighter comes back lying at rest). The Renderer gained `scene`, `gl`, `setFades` and the pose hold. In a Battle every Fighter wears its Team's soldier colour. Promoted slots wear `battle.soldier.body`.
- **`CONTEXT.md`**: Bubble, Promotion / Demotion, Fighter Pool; Battle, Soldier and Benched updated. **ADR 0020** Accepted, with what Stage 3 settled.

**What changed from the plan:**
- **A Bubble promotes only its Player's enemies.** The Players spawn 2 m behind their own army, so "nearest first" over both Teams filled all 15 free slots with idle allies on the first Tick, and no enemy could ever promote. Allies come with their share of the budget in Stage 4, as the task says.
- **A promoted Fighter that falls keeps its slot for `corpseSeconds` (3 s)**, so its Death Ragdoll plays, before the slot frees. This is a new Tuning Data value the plan did not name.
- **An unbound slot is Benched**, rather than a new "unbound" state. The meaning ("out of play, not dead") was already exactly Benched, so no system needed a new check.
- **Shared-code tolerance, Battle only:**
  - **AI routing.** On a Battlefield the AI walks straight at its target and never plans a route or an escape Link (`routeTo`, `escapeLink` return at once when the state has a Crowd). Each of the field's 6,400 triangles is a Walk Surface, so the first promoted AI built a navmesh over all of them: about **12 s**, frozen on one Tick, in the browser and in Node. The open field has no Walls, ledges or Links to route around.
  - **AI sighting.** The AI no longer reads a slot coming back into the Duel (Benched, then bound) as having moved there: its first sighting has no velocity. This cannot happen in a Duel or a Run, whose slots never come back mid-Duel.
- **The "hold outside sword reach" rule applies to every Soldier near any enemy full Fighter**, not only to the Soldiers of a full Bubble. It is the same rule, cheaper to state, and Stage 4's waiting ring will steer inside it.
- **Two Stage 1 tests changed.** A Battle's Fighters are now the whole Pool, not just the Players' (the shape check). The snapshot-and-Rout test runs on a Pool with no free slot, because it drives no AI: Soldiers promoted round its walking Player would stand frozen, and the Rout never came.

**Measured** (this laptop, as at Stage 0):
- **Tick (AI + `stepMatch`)**, Node, the full 200 v 200 with a scripted Player charging into the enemy army (seed 1, 2,226 Ticks to the end): **2.05 ms mean, 10.1 ms p99** overall; **4.3 ms mean, 13.2 ms p99** on the 704 Ticks with 8 or more slots bound (at most 15). That is about Stage 0's 16-Fighter row (3.0 ms) plus the Crowd (0.4 ms) and the Bubbles. In the browser, the play page's panel showed 5.3 ms on Ticks with 15 bound.
- **Frame**, browser (`battleBench`: each frame a Tick, the draw, then `gl.finish()`; Intel UHD iGPU, 780 × 788): **12.0 to 14.1 ms mean** per frame over a charge into the army (p99 18 to 21 ms), with **up to 490 to 530 draw calls** at 15 bound Fighters (about 30 each; Stage 0 counted about 12 per Body plus the Weapon and shadow), against 19 with none. So Tick plus frame is about 17 to 19 ms with the Pool full. That is at or just over a 60 fps frame on this iGPU, which is Stage 0's warning: the Bodies dominate. Stage 4's cap (4 enemies + 3 allies) halves the bound count.
- **Frame rate by eye: still not seen**, for Stage 2 or this Stage. At the start of this Stage and again at its end, with the Browser pane shown, the page ran at 1 to 4 frames a second, reporting `document.visibilityState` `hidden` and no focus: the Claude window was not in view, so `requestAnimationFrame` was throttled. The costs above come from frames drawn one after another (`battleBench`). A 60 fps check in a visible window is still outstanding for Stages 2 and 3.

**Check in `npm run dev`** (`#/battle/1/play?dev=1`, driven through `battleBench` because the pane's `requestAnimationFrame` was throttled): walking the Player into the enemy army, Soldiers promoted within 10 m, up to 15 bound, and fought the Player as full Fighters, with the impostors around them and the blob shadows only under the impostors. Walking away from a fight, the promoted chased and kept hitting the Player, who could not get beyond 16 m. That is the plan's "no free disengage", so Soldiers did not demote while a fight was on. Demotions were seen when the Player fell (no Bubble left), each with its dust puff where the Fighter had stood. The Demotion of a Fighter left in a quiet area as the Player walks off is covered by the tests (round trip, hysteresis, the swap), not seen live. The crossfade itself (0.35 s) could not be watched frame by frame, because the page drew at 1 to 4 fps in the background. No console errors.

**Tests**:
- `src/sim/bubble.test.ts` (12):
  - Promotion: place, heading, Team, HP, Weapon, max HP; out of the Crowd step.
  - Promotion then Demotion round-trips position, heading and HP exactly.
  - Hysteresis: a Soldier at 12 m never promotes; a promoted Fighter the Player walks between 11 and 15 m of, for 1,500 Ticks, keeps its slot.
  - No Demotion mid-Attack, Stagger, Knockdown, Fall or Block, in the air, or a Tick short of the minimum.
  - A fallen Fighter kills its Soldier and frees its slot after the corpse time.
  - Nearest first, never more than the Pool, enemies only.
  - With a Player charging and every slot a Pool AI over 1,500 Ticks: promotions and Hits happen; every HP drop of a full Fighter is a Hit, KickLanded, DaggerHit or Land of its own step (no Soldier ever changes one); no event involves an unbound slot, and an unbound slot's Controller asks for nothing; every Soldier that steps stays outside half the hold of every enemy Fighter; the same seed and Intents give the same hash every Tick; a Rollback across a Promotion and across a Demotion re-simulates to the same hash and the same AI memory.
- `src/render/bubbleSwap.test.ts` (4):
  - The two dithers are complementary at every fade and pixel.
  - The crossfade at a Promotion and at a Demotion (with the puff's place), and an unbound slot draws nothing.
  - The Crowd view hides a promoted Soldier's impostor and shadow.
- `src/tuning/battle.test.ts` (+1, and the hash test covers `bubble`).
- One existing literal needed the new `bubble` section (`tuning.test.ts`'s raw fixture), and two Stage 1 Battle tests changed as above. No Duel or Dungeon assertion changed.
- `npm run typecheck` and `npm run build` pass (the play page is its own lazily loaded chunk, opened only with `?dev=1`). `npm test`: **1662 passed, 5 skipped, 3 failed**, all timing-bound and on Stage 1's list: the Door spot soak (20 s timeout), and the two navmesh-under-250 ms checks (285 and 253 ms). That is fewer than at Stage 2 (5), so no comparison against the unchanged tree was needed. The Bubble, swap and Battle tests were run again after the last fix (a promoted Fighter's height): 28 passed.

## Stage 4: Attack Slots, the waiting ring and allies
The pressure on a Player is capped and fair, and allies fight beside them.
- **Attack Slots**: each Bubble promotes at most the enemy-slot count of enemies (from Stage 0, ~4). Further enemies in the Bubble stay Soldiers. When a slot frees (death, Demotion, the enemy switching to an ally), the nearest waiting enemy promotes.
- **The waiting ring**: waiting enemy Soldiers steer to spots on a ring just outside sword reach of the Player's Fighter, spaced apart, biased toward the Player's direction of travel so the ring closes in front of them (the settled tension #1). Soldiers near a full Fighter's path step out of it rather than overlap it. Steering only.
- **Allies**: each Bubble promotes up to the ally-slot count (~3) of allied Soldiers, nearest to the slot-holding enemies first. Promoted allies fight promoted enemies with real combat. A full enemy that targets a promoted ally may let its Attack Slot go to the next waiting enemy, which is how allies relieve a Player.
- **Targets across tiers**: a full Fighter never targets a Soldier. A full enemy whose Player-side targets are all gone waits at the ring or demotes when allowed.
- **AI behaviours** (Beginner, for the Battle only, without changing any Duel difficulty): hold at a ring spot while waiting, and chase without giving up while holding a slot.
- **`CONTEXT.md`**: Attack Slot.
- **Tests**:
  - Never more than the enemy-slot count of promoted enemies per Bubble, and never more than the ally-slot count of allies.
  - A freed slot is filled by the nearest waiting enemy.
  - The ring: waiting Soldiers stay outside sword reach; a Player walking into a crowd of waiting enemies finds one in their way within a set time (a scripted test).
  - An ally engaging a slot-holding enemy lets the next one in.
  - Rollback across a slot change re-simulates identically.
- **Check in `npm run dev`**: charge into the enemy line alone (it is hard and you can't walk out), then fight beside allies (it is easier and they take enemies off you).

### Result
Done 2026-11-02. A Bubble now holds at most 4 enemies fighting its Player (the Attack Slots) and promotes up to 3 of the Player's allies to fight beside them. The other enemies in the Bubble wait as Soldiers on a ring just outside sword reach, closing in front of the Player. An ally that engages a slot-holder lets the next enemy in.

- **Tuning Data** (`data/battle.json`, in `tuningDataHash`): `slots` (`SlotsTuning`): `enemies` 4, `allies` 3, `engaged` 2.5 m. `ring` (`RingTuning`): `radius` 3.5 m, `spacing` 1.2 m, `pathAhead` 3 m, `pathWidth` 0.8 m (a Fighter's radius plus half a Soldier's separation). The parser refuses fewer than 1 enemy slot, a non-whole ally count, slots that leave the Player no room in the Pool, and a ring inside `bubble.hold` or beyond `bubble.promote`.
- **The binding's role** (`SoldierBinding.role`, `SoldierRole`): `Attack` (an enemy holding an Attack Slot), `Ally` (an ally slot), or `Waiting` (an enemy without a slot). It is plain data in `FighterState.soldier`, so it is hashed, snapshotted and rolled back with the binding. A role change is not a new binding, so neither the Pool AI nor the swap restarts on it.
- **The Bubbles' step** (`stepBubbles`), after the Stage 3 deaths and far Demotions, from positions only:
  - **Release.** Each promoted ally engages at most one enemy: one within `slots.engaged` of it, with the ally nearer it than any Player is. Pairs are made closest first, an already Waiting enemy before a slot-holder (so a pair holds), then lower slots. A paired slot-holder becomes `Waiting`: its slot is free.
  - **Fill.** Each Bubble fills its free Attack Slots, nearest its Player first, from its waiting enemies within `promote`: an unpaired `Waiting` Fighter takes one back where it stands (it wins a tie), or a Soldier is promoted into a free Pool slot. A fallen slot-holder holds no slot, so a death frees its slot at once, though the corpse keeps its Pool slot for `corpseSeconds`.
  - **Waiting with nothing to do.** An unpaired `Waiting` Fighter that got no slot back demotes as soon as its Action allows (Idle on the ground, past `minPromotedSeconds`), wherever it is. Back in the Crowd, it waits on the ring.
  - **Allies.** An ally whose Bubble has no enemy Fighter left demotes as soon as it may. While an enemy holds an Attack Slot, each Bubble promotes its Player's allied Soldiers within `promote`, nearest the slot-holders first, up to `slots.allies`.
  - With several Bubbles (Stage 6), a promoted enemy counts in its nearest enemy Player's Bubble, and an ally in its nearest Team-mate's.
- **The waiting ring** (`stepCrowd`, `ringSpots`). Each Tick, the Crowd hands out ring spots round each Player's Fighter (scratch, never state) to its waiting enemies: in the Crowd, within `promote`, not engaged on their last step. The spots sit on rings from `radius` out, `spacing` apart, filled straight ahead first (the Player's way of travel this Tick, or their facing while standing), then alternately right and left, then the next ring out. Each spot goes to the nearest waiting enemy without one. A waiting Soldier walks to its spot facing the Player, unless an enemy Soldier is within engage reach (then it fights). A spot more than 45° round the Player it walks to round them (`RING_DETOUR`), never across their reach. The Stage 3 hold still puts every enemy step back outside `hold`. Walking into a crowd of waiting enemies, the Player meets one on the front spot, pushed back step by step but staying in front.
- **Out of the path.** A Soldier whose step ends in a moving Team-mate full Fighter's path (less than `pathAhead` ahead, less than `pathWidth` aside) is moved aside by at most a stride. This runs before the hold, so the hold always wins. Enemies are already kept out by the hold, and a path rule for them would fight the ring, so it applies to Team-mates only (a Player walks through their own army without overlapping it). `stepBattle` passes each full Fighter's way of travel over the Tick (`CrowdFighter.dx`, `dz`), and each Player's `ahead`.
- **AI** (`ai.ts`, Battle only: it reads `soldier.role` only when the state has a Crowd, so no Duel or Run changes):
  - **Waiting.** A `Waiting` Fighter does not see the Players as enemies. It fights promoted allies, and with none it walks to its ring spot (`battle.ring.radius` out, on its own bearing from the nearest enemy Player) and stands there facing them (`waitAtRing`).
  - **Holding a slot.** A slot-holder never takes the Disengage tactic (not when hurt, not on a re-roll), so it chases without giving up. Without `chase` its random draws are exactly as before.
- **Dev page**: the panel and `battleBench` show the promoted Fighters by role. `battleBench` also reports the Player's HP and the damage taken.
- **`CONTEXT.md`**: Attack Slot (new); Bubble updated.

**What changed from the plan:**
- **"Never more than the enemy-slot count of promoted enemies"** is "never more than 4 enemies *holding an Attack Slot*". The plan also says an enemy an ally engages lets its slot go, so it stays promoted (fighting the ally) while the next enemy comes in. Promoted enemies can therefore number 4 plus one per ally, plus any slotless one still mid-Action on its way back to the Crowd. Only slot-holders may fight a Player.
- **One ally takes one enemy off the Player.** The first version let any ally within 2.5 m release any number of enemies. In the browser, three allies in a melee released 10 or 11, so the Pool filled to 15 bound while only 1 or 2 held slots. Pairing fixed it: about 10 to 11 bound, 4 holding slots.
- **"A full enemy whose Player-side targets are all gone"**: when its Player falls, the Stage 3 rule already demotes it (no Bubble left). When it has lost its slot and its ally, it demotes as soon as it may. Meanwhile its AI holds at its ring spot.
- **The path rule is for Team-mates only** (see above). It also runs before the hold, not after: after the hold, it once pushed a Soldier to 1.1 m from the Player.
- **Waiting Soldiers walk round the Player.** A Soldier straight behind a Player, sent to the front spot, walked into the hold and stood there. Now it heads at most 45° round at a time.
- **A Bubble's ally slots open only while an enemy holds an Attack Slot**, so allies near a Player who is not fighting stay in the Crowd. This is the reading of "nearest to the slot-holding enemies".
- **Two Stage 3 tests changed.** The binding carries `role` (the Promotion test's `toEqual`). "Fills the free slots nearest first, and never binds more than the Pool" now runs with Attack Slots raised past the Pool, since Stage 4 caps a Bubble at 4.

**Measured** (this laptop, as at Stage 0):
- **Tick (AI + `stepMatch`), Node**, full 200 v 200, a scripted Player up the right flank into the enemy line, seed 1: **2.03 ms mean, 7.9 ms p99** overall. On the 895 Ticks with 8 or more slots bound (mean 10.1, at most 11): **3.14 ms mean, 7.8 ms p99**. The Bubbles' step is 0.14 ms of that. Stage 3 measured 4.3 ms mean, 13.2 ms p99 on the same kind of Ticks with up to 15 bound.
- **Browser** (`battleBench`, dev build, Intel UHD iGPU, 780 × 788; each frame a Tick, the draw, `gl.finish()`), the same charge with about 10 to 11 bound (4 attacking, 3 waiting, 3 allies): Tick **5.5 to 6.7 ms mean** (p99 27 to 41), frame **7.3 to 7.9 ms mean** (p99 16 to 44) once the models were in, so **Tick plus frame about 13 to 14.5 ms**, against Stage 3's 17 to 19 ms. The first 200 frames of contact, while the soldier models load, averaged 48 ms a frame. A second run's 500 frames averaged 24 ms a frame (p99 35).
- **Frame rate by eye: still not seen.** At the start of this Stage the Browser pane was displayed and `document.visibilityState` was `visible`, but the window had no focus and `requestAnimationFrame` ran at 0.25 to 0.7 fps. Screenshots showed a stale frame. All browser numbers come from `battleBench`'s synchronous frames. The 60 fps check in a visible, focused window is still outstanding for Stages 2 to 4.

**Check in `npm run dev`** (`#/battle/1/play?dev=1`, driven through `battleBench`):
- **The charge** (up the right flank and into the enemy line): 4 enemies took the Attack Slots as contact began. 3 allies from the Player's own army joined at once, and up to 3 enemies were taken off the Player (Waiting, each fighting an ally). The Pool held 10 to 12, never 16. No console errors.
- **Alone versus beside allies** could not be set up in the page. The Player can't reach the enemy before their own army (both walk at 2.5 m/s), and every seed's war ends by about Tick 2090. So the same scripted charge ran in Node, with ally slots at 3 and at 0, seeds 1 to 3:

| seed | HP lost in the first 10 s of contact, beside allies / alone | walked out in 6 s (trying, from 10 s in), beside allies / alone | HP at the end, beside allies / alone |
|---|---|---|---|
| 1 | 0 / 42 | 15.0 m / (war over first) | 100 / 11 |
| 2 | 0 / 89 | 6.7 m / (fell at Tick 1830) | 82 / 0 |
| 3 | 5 / 22 | 7.1 m / 2.6 m | 50 / 20 |

  Alone it is hard and the Player can't walk out; beside allies the allies take enemies off them and they can break away.

**Tests**:
- `src/sim/attackSlots.test.ts` (19):
  - Attack Slots: the 4 nearest promote and the others wait as Soldiers. A death frees a slot at once for the next nearest, though the corpse keeps its Pool slot. So does a Demotion. Allies promote only while an enemy holds a slot, nearest the slot-holders first, up to 3. An ally engaging a slot-holder lets the next one in; the engaged one keeps its Pool slot while the ally stays, and demotes once the ally leaves and no slot is free. One ally between two slot-holders takes only one. A Waiting Fighter takes a slot back ahead of a farther Soldier. An ally whose Bubble has no enemy left demotes.
  - The ring: `ringSpots` (straight ahead first, alternating sides, spaced, outside reach, ring by ring, turned with `ahead`). Five Soldiers behind a standing Player end up in front of them on the ring, facing them. Scripted: a Player walking into a block of waiting enemies (no Attack Slots) finds one in their way within 2.8 s, and one is in the way at least 90% of the next 2 s. Team-mates step out of a walking Player's path.
  - The Pool AI: a Waiting Fighter holds at its ring spot facing the Player and never swings; a slot-holder closes in and swings.
  - A Player charging beside their army with Pool AIs for 1,500 Ticks: never more than 4 slot-holders, 3 allies or 15 bound; allies and enemies struck each other; enemies went Waiting. Every waiting Soldier in the Bubble ends its step beyond sword reach (`ai.attackRange`). A slot-holder's AI never Disengages. The same seed and Intents give the same hash every Tick. A Rollback across an Attack Slot changing hands re-simulates to the same hash and the same AI memory.
- `src/tuning/battle.test.ts` (+1, and the hash test covers `slots` and `ring`). `src/tuning/tuning.test.ts`'s raw fixture gained the two sections. Two Stage 3 tests changed (above). No Duel or Dungeon assertion changed.
- `npm run typecheck` and `npm run build` pass. `npm test`: **1684 passed, 5 skipped, 1 failed**: the Door spot soak's 20 s timeout. An earlier full run, made while the CPU was busy, had 4 failures, all timing-bound: the Door spot soak, two 1,500-Tick Battle hash replays (the Stage 3 one and this Stage's) on 20 s timeouts, and the four-Player resync test, whose session reads `performance.now()`. Each passed alone. Because 4 is more than Stage 3's 3, the unchanged tree (a worktree at the last commit) and this tree were then run one after the other: **1664 passed, 5 skipped, 1 failed** against **1684 passed, 5 skipped, 1 failed**, the same Door spot timeout in both. So no failure comes from this Stage.

## Stage 5: a full Battle offline (end of Milestone 1)
- **Taking over an ally**: when the Player's Fighter dies, the nearest living ally Soldier promotes into slot 0 as the Player's Fighter (the generic soldier's Body and Weapon, its HP), the camera moves to it, and the Player plays on. The Player is out (spectator camera) when their Team has no Soldiers.
- **Minimap**: render only, a top-down map of the Battlefield with both armies (density or dots), the Player and their facing, on a key or always in a corner.
- **HUD**: each army's strength and the Rout threshold.
- **Rout presentation**: the losing army flees, a banner, then a results screen (winner, the Player's kills, the soldiers taken over).
- **Lobby**: Battle as a Format in Skirmish (offline), with the Player's Body and Weapon pick as today.
- **Tuning pass**: Bubble distances, Crowd damage and HP, Rout threshold, slot counts, Beginner AI in groups. The target: a Player can hold off four soldiers but not a dozen, and a good Player decides a close Battle.
- **`CONTEXT.md`**: the Battle Format's entry, the takeover rule.
- **Tests**: takeover picks the nearest living ally and keeps its HP; out when the Team has none; the Battle ends exactly once; a 10-minute AI-autopilot soak with no hash divergence on replay and no Tick over budget.
- **Check in `npm run dev`**: three full Battles from the Lobby, one won, one lost, one with several takeovers.

### Result
Done 2026-11-03. A Battle is played from the Skirmish Lobby: Format → **Battle**, pick a Weapon, Fight. The Player fights in the red army with their own Body and Weapon. When they fall, they play on as the nearest living soldier of their army. A HUD shows both armies' strength against the Rout mark, and a minimap the field. Banners mark the Rout and the Player's falls, and a results screen leads back to the Lobby. Milestone 1 is complete.

- **Taking over an ally** (`stepBubbles`, at the start of each Battle Tick):
  - A Player's fallen Fighter that had taken over a Soldier kills that Soldier at once, so the Rout counts it.
  - `battle.takeover.seconds` (1.5 s) after the fall, the Player takes over the living ally Soldier nearest where they fell. That is either a Crowd Soldier, made a Fighter as at a Promotion (the generic soldier's Weapon, its own HP, max HP `crowd.hp`), or a promoted Ally Fighter as it stands (its binding and Mods dropped, its Pool slot freed). Either becomes the Player's Fighter in the Player's own slot, and the Soldier's `crowd.slot` points there.
  - The Player's own chosen Fighter moves into a free Pool slot and lies there to the Battle's end (`BattlePlayer.corpse`). A Soldier the Player had taken over that falls lies in the Crowd.
  - With no living ally Soldier left, the Player is out, and the camera watches from above.
- **Each Player's record** (`CrowdState.players`, `BattlePlayer`: the Soldier it is, takeovers, kills, the corpse's slot), made by `createCrowd(battle, seed, players)`. It is plain data, hashed and snapshotted with the Crowd. **Kills** (`countKills`, `stepBattle`): a Death whose same-Tick Hit or KickLanded (attacker) or DaggerHit (thrower) was a Player's slot, on an enemy.
- **Tuning Data** (`data/battle.json`, in `tuningDataHash`): `takeover.seconds` 1.5; `ring.waiting` 8; `soldier.difficulty` "Beginner", a Battle-only `soldier.style` (`throwRate` 0, keys checked against the AI's Style keys) and `soldier.mods` (`damage` 0.5; Relic multipliers only, applied at Promotion). The Pool AI now plays `battle.soldier.difficulty` with that Style. Crowd numbers from the tuning pass (below).
- **Lobby** (`src/lobby/lobby.ts`, `src/play/lobbyView.ts`, `src/play/menu.ts`): `lobbyFormats(online)` offers Battle offline only, kept apart from `MATCH_FORMATS` (the wire's list, unchanged, so a Lobby message carrying a Battle is refused). `formatProblem` refuses a Battle with more than one member, and `startProblem` skips the Seat checks for a Battle. A Battle shows an "Armies" card and hides the Seats, the Maps, the seed and the Match length. A saved Battle Format is restored offline only.
- **Game** (`src/game.ts`, `playerInBattle` in `src/play/driver.ts`): the Fight starts a Battle with a Pool AI on every other slot. It waits for the impostor bake and lazily loads `BattleScreen`. There's no Final Blow Shot. The results stay 8 s, then the game returns to the Lobby. Dev only: `?dev=1&battlePilot=<difficulty>` puts the Player on a Battle autopilot (`createBattlePilot`), and `window.battleAdvance(ticks)` steps the Battle synchronously.
- **`BattleScreen`** (`src/play/battleScreen.ts`): the Crowd's impostors and the swap (`BubbleSwap.forget` on a takeover). Bodies come per slot from `battleBodies`: the Player's chosen Body until a takeover, the generic soldier's after, and their corpse keeps the chosen one. The camera is third person while fighting, an orbit while fallen, and from above once out (on `battleFocus`). A takeover turns the Local Controller's yaw to the new Fighter's facing.
- **`BattleHud`** (`src/play/battleHud.ts`, `src/render/minimap.ts`): the army strength bars with the Rout mark, the Player's HP and status line, and the minimap (N toggles it; your army at the bottom, +x to the left, as the camera sees it). Banners: the Rout, "You fell", "You fight on as a soldier", "You are out". Results: the winner, kills, soldiers taken over, each army left standing, the time.
- **`CONTEXT.md`**: the Format entry (Battle offline only), the Battle entry (the results screen, the Lobby, the takeover rule), Attack Slot (the waiting ring's cap), Promotion (the soldier's difficulty, Style and Mods) and the Fighter Pool (the corpse slot).

**What changed from the plan:**
- **The takeover waits 1.5 s** (`takeover.seconds`), so the Death Ragdoll and the "You fell" banner play before the camera jumps. The plan said "when the Player's Fighter dies".
- **The Player's own Fighter lies in a free Pool slot**, not in slot 0 (which the Player's new Fighter takes). Only a full Fighter can show the chosen Body and Weapon lying where it fell, and an impostor would show the generic soldier. A slot counts as free only when it is Benched and unbound, so the corpse's slot is never reused. A taken-over Soldier that falls is a Soldier, so it lies in the Crowd like any other.
- **A promoted ally can be taken over**, as it stands (its HP, its place, mid-fight), not only a Crowd Soldier. Skipping it would make the nearest ally often the wrong one in a melee.
- **The soldier's difficulty, Style and Mods are Battle-only Tuning Data** (`battle.soldier`). The Duel's Beginner AI is untouched, so no Duel number moves.
- **The waiting ring is capped** at the 8 nearest (`ring.waiting`). Uncapped, 25 to 34 enemies stood idle round a Player who was fighting, out of the war, which tipped it to the Player's side for nothing they did (below).
- **The Lobby keeps `lobbyFormats` apart from `MATCH_FORMATS`**, so the wire refuses a Battle until Stage 6 without a special case in the protocol.
- **Two fixes from verification.** First, the hold (no Soldier step ends within `bubble.hold` of an enemy full Fighter) ran once over the Fighters: put out of one Fighter's hold, a Soldier could land in another's. It now repeats up to 4 times (`HOLD_PASSES`). Stage 4's test caught it (1.22 m from an ally at Tick 769), once the new data put a demoted `Waiting` Soldier between two allies 1.5 m apart. Second, `SwingTrails` threw on returning from a Battle to the Lobby: a Pool slot that never swung leaves a gap in its trails, and the cleanup now skips gaps, as its draw loop already did.

**Tuning pass** (Node, `createBattlePilot` on Hard standing in for a good Player, the full 200 v 200; measured before the hold fix, which changes each seed's details but not the data):
- **Before**: the uncapped waiting ring held 25 to 34 idle enemies round the Player. A Player with 0 kills swung the war 11–1 over 12 seeds, against 3–9 with no Player.
- **After**, with `ring.waiting` 8: 9–15 with a Player over 24 seeds, against 10–14 without, so neutral within noise. Caps of 6, 12 and 20 gave 9–15, 11–13 and 12–12.
- **`crowd.hp` 100 → 50 and `crowd.damage` [8, 20] → [4, 10]**, so a Crowd fight takes the same number of blows (about 7.1). Promoted Soldiers have half the HP, so a Player can cut through some.
- **`crowd.hitChance` 0.2 → 0.08**: Battles last about 2,900 to 3,550 Ticks (about 52 s), up from about 2,100, which leaves the Player time to act.
- **`soldier.style` `{ throwRate: 0 }` and `soldier.mods` `{ damage: 0.5 }`.** The Style levers (lower `aggression`, `pressure` or `chainRate`) barely changed the result. Soldier HP and the damage Mod are what moved it.
- **Unchanged**: the Bubble distances, the slot counts (4 enemies, 3 allies) and the Rout threshold (0.2).
- **Surround test** (a Hard AI ringed by N Beginners at 6 m, N Attack Slots, no allies, 8 seeds):
  - Old data, N = 4: dies in 12 to 18 s with 0 kills.
  - Final data, N = 1: wins every time, in 7 to 21 s.
  - Final data, N = 4: survives 21 to 60 s and wins 3 of 8.
  - Final data, N = 12: dies every time, in 14 to 36 s.

  So "a Player can hold off four soldiers but not a dozen" holds for the Hard AI.
- **"A good Player decides a close Battle" is not shown.** With the final data the Hard-AI Player gets only 0 to 5 kills a Battle (about 1.5 on average) and doesn't decide close Battles. That needs a human playtest. Two things for it, seen in the browser: a Player who just walks forward is pushed through the enemy army and out the back with 17 HP lost (Soldiers aren't solid to full Fighters, and the waiting ring gives way step by step: body-blocking is Later). A Player who stands still in the enemy line, not blocking, took about 25 s to cut down.

**The soak** (`src/sim/battleSoak.test.ts`): full-size Battles back to back (seeds 1, 2, …), the Player on a Hard autopilot and a Pool AI on every other slot, for 36,000 Ticks (ten minutes of Battle time). The same Intents are then replayed through `stepMatch` alone, with hashes compared every 30th Tick and at each Battle's end. **Every hash matched**, in every run. Alone (after the hold fix): 11 Battles finished (Team 0 won 5, Team 1 won 6) and a 12th was cut off. Tick (AI + `stepMatch`) **1.78 ms mean, 5.94 ms p99, 66 ms max**, 77 Ticks over 8 ms and 6 over a 60 fps frame. The 77 slow Ticks, listed by seed, Tick and bound slots:
- 57 had 8 to 12 slots bound, mostly 9 or 10: a full Bubble's tail, as Stage 4 measured (p99 7.8 ms with about 10 bound).
- 16 had none bound (the AI was idle, so garbage collection or the OS); the 66 ms max was one of them.
- 5 were warm-up (before Tick 100).

Nothing looks broken, so the Ticks weren't made cheaper. **The assertion**: mean under 8 ms (the whole per-Tick budget) and p99 under 25 ms (a frame and a half). It isn't tighter because the full parallel suite slows every Tick about 2.5 times on this laptop: 4.4 to 4.6 ms mean and a p99 of 16 to 18 ms across three full runs. CPU time (`process.cpuUsage`) rose with it (2.3 → 4.0 ms a Tick), so it can't tell a busy machine from a slow Tick and was dropped. The alone figures are in the log. **Its timeout is 600 s**: ten minutes of Battle is 36,000 Ticks plus the replay, which took 118 to 124 s alone and 170 to 180 s in the suite, so it can't fit in the suite's 20 s.

**Measured** (this laptop, as at Stage 0):
- **Game, in the browser** (`battleAdvance`, which steps Ticks with the HUD's presentation and no drawing): 0.9 to 1.3 ms a Tick on the march, 1.7 to 2.6 ms through the melee, with the Hard pilot at the front.
- **Play page** (`#/battle/1/play?dev=1`, `battleBench`: each frame a Tick, the draw, `gl.finish()`; Intel UHD iGPU, 1024 × 768), a charge up the right flank:
  - marching (nothing bound): Tick 1.8 ms mean, frame 6.8 ms mean (p99 16.6);
  - into the line (8 bound on average, at most 11: 4 attacking, 3 or 4 waiting, 3 allies): Tick 5.3 ms mean (p99 31), frame 9.6 ms mean (p99 20). That is about 15 ms of Tick plus frame, as at Stage 4 (13 to 14.5 ms).
- **Bundle**: the main chunks grew by about 11 kB (about 4 kB gzipped), because `styles.ts` imports the HUD's CSS and with it the HUD and the minimap. That code shares a chunk with the renderer, which Rollup now names `battleHud`. `BattleScreen`, `CrowdView` and the impostor bake stay in lazily loaded chunks.
- **Frame rate by eye: still not seen.** The pane was visible this time, but without focus: the menus drew at about 23 fps and a Battle at about 1.3 fps, and screenshots often showed a stale frame. The Battles were driven with `battleAdvance`, and the costs above come from synchronous frames. The 60 fps check in a visible, focused window is still outstanding for Stages 2 to 5.

**Check in `npm run dev`** (the Skirmish Lobby, Format → Battle, Fight; driven with `battleAdvance`):
- **Won** (`battlePilot=Hard`): the Player got 2 kills at 99 HP. "The blue army breaks and flees!" played and the enemy bar read "routed". Results: Victory, 2 kills, 0 taken over, 43 red v 31 blue, 0:51. 8 s later the game was back in the Lobby, with the result line under the title. A second won Battle (`battlePilot=Beginner`) went the same way.
- **Lost** (no pilot, W held through the page's own key events, so the Player walked through both armies and out the back): "Your army breaks and flees!". Results: Defeat, 30 red v 67 blue, 0:48. Another loss later: 37 v 42.
- **Takeovers**: the Player walked into the enemy mass and stood still.
  - Fell at Tick 2980. At Tick 3070 (1.5 s later) took over Soldier 26 (34 HP) 2.3 m away, with their own Fighter moved to Pool slot 1. The HUD read "A soldier of your army · 34 / 50" under "You fight on as a soldier", and the Player wore the generic soldier. The war ended a second later: Victory, 1 taken over.
  - Another Battle: fell behind the enemy army and took over the nearest ally, 12 m away.
  - **Several takeovers in one Battle weren't reached live.** Beginner soldiers at half damage take about 25 s to cut down a Player who stands still, and a war lasts about 50 s, so at most one fall fitted. Repeated takeovers (a second fall takes over the next Soldier, the corpse stays put, out when none is left) are covered by `takeover.test.ts`.
- The minimap: your army at the bottom, the enemy at the top, and the Player at x = −3 drawn right of centre, as the camera sees it. The Lobby's Armies card replaces the Seats and Maps, and its hint says "Pick your Weapon, then fight."
- **Console**: one error, the `SwingTrails` cleanup on returning to the Lobby (fixed, above). None in the five Battles after the fix.

**Tests**:
- `src/sim/takeover.test.ts` (7): the takeover picks the nearest living ally and keeps its HP, and not before the delay; a promoted ally is taken over as it stands; a second fall takes over the next Soldier and the corpse stays put; out when the Team has none left; a whole small Battle ends exactly once (one `BattleEnd`, one `Rout`, nothing after); the same Intents give the same hash; a Rollback across a takeover re-simulates identically, AI memory included. The whole-Battle tests have 120 s timeouts.
- `src/sim/battleSoak.test.ts` (1): the soak, above.
- `src/play/battleHud.test.ts` (6): strengths, status, the result, bodies (`battleBodies`), the minimap's mapping.
- `src/lobby/lobby.test.ts` (+3): Battle offline only, apart from the wire's list; it starts with the host alone and is one player's; a Lobby message carrying it is refused.
- `src/tuning/battle.test.ts` (+1, and the hash covers the new fields): the takeover delay, the ring's cap, and the soldier's difficulty, Style and Mods, with what each refuses.
- **Changed assertions**:
  - `battle.test.ts`'s ring `toEqual` gained `waiting: 8`, and `tuning.test.ts`'s raw fixture gained the new fields (its soldier difficulty is 'Normal', the fixture's only one).
  - The Stage 1 separation test's tolerance went from a sixth of the separation to an eighth. With the new Crowd numbers, two back-rank Soldiers of Team 0 squeeze to 0.12 m for a moment at Tick 630, as the front stops at contact (2 or 3 of about 95 samples a war, the same pair in seeds 1 to 3), then part.

  No Duel or Dungeon assertion changed.
- `npm run typecheck` and `npm run build` pass. `npm test` (the final run): **1699 passed, 5 skipped, 4 failed**, all timing-bound and in suites a Battle never runs: the Door spot soak and the four-Player "goes silent" Rollback test (20 s timeouts), and the two navmesh-under-250 ms checks (301 and 265 ms). The soak passed in it at 4.78 ms mean, 17.6 ms p99. Which tests fail changes from run to run: two earlier full runs, after the fixes, had 3 and 5 failures (the soak's first, stricter timing assertion, and the four-Player resync test besides). The unchanged tree (a worktree of the last commit, run right after one of them) had **1683 passed, 5 skipped, 2 failed** (the Door spot timeout and a navmesh check). The 18 new tests account for the difference in totals. The first full run, before the fixes, had two real failures, the hold and the separation test (above), and both are fixed.

## Stage 6: online Battle, the Simulation side (Milestone 2)
- **Four Bubbles**: one per Player's Fighter. Overlapping Bubbles share the Pool. A rule for shrinking each Bubble's budgets when several Bubbles are in use, so the Pool never overflows (from the Stage 0 numbers).
- **Players' slots**: slots 0 to 3 are the Players. A guest leaving is an AI Takeover of its slot as today (ADR 0010), and that Fighter then counts as an ally, not a Bubble.
- **Resync** carries the Crowd and every bound slot's AI memory. `PROTOCOL_VERSION` + 1. Checksums cover the Crowd.
- **Rollback cost**: a soak with four Bubbles full measures the worst Rollback; if it is over budget, lower the Bubble budgets, not the 15-Tick window.
- **Tests**: loopback tests over the memory transport (two and four Players, a resync mid-battle, a Takeover mid-battle), as the Dungeon's Stage 4 did.

### Result
Done 2026-11-03. A Battle runs in a Rollback session for two to four Players, every peer agreeing Tick by Tick, the Crowd and the Fighter Pool included, through Rollbacks, a resync and a Player leaving. The Lobby doesn't offer it online yet (Stage 7). `PROTOCOL_VERSION` 22 → 23.

- **Several Bubbles share the Pool** (`stepBubbles`, `data/battle.json` `slots.shared`, `bubbleSlots`, in `tuningDataHash`):
  - With n Bubbles in use (the Players' Fighters still fighting, not one that left), each holds `slots.shared[n − 2]`: 2 enemies and 1 ally at two or three Bubbles, 1 and 1 at four. One Bubble keeps `slots.enemies` and `slots.allies` (4 and 3), so no offline number moves.
  - The parser refuses an entry larger than the one before it, and one whose Players and slots don't fit the Pool (n × (1 + enemies + allies) ≤ `poolSize`).
  - **Shedding**: past its share, a Bubble's slot-holders farthest from its Player let their Attack Slots go (`Waiting`, at once), and its farthest allies demote as soon as their Action allows. A Bubble can be past its share when more Bubbles come into use, or when a Fighter comes nearer another Bubble's Player.
- **The Players' slots**: a Battle's Lineup names only its Players, slots 0 to 3 of the Pool, at most `MAX_TEAM_SIZE` a Team, no AI (`checkLineup`). `lineupAis` gives every other Pool slot a Pool AI, so the session's Controllers cover the whole Pool on every peer.
- **A Player who leaves** (`takeOverFighter`, now also for a Battle): the session applies it at the Takeover Tick as for a Run. The Player's record is marked away (`BattlePlayer.away`, absent while it plays). Its Fighter, driven by the Normal takeover AI, has no Bubble and no ring, takes over no Soldier when it falls, and counts no more kills. To the AI it is an ally of its Team like a promoted Soldier (`bubblePlayer`): a `Waiting` Fighter may fight it, and none waits at a ring round it.
- **The session** (`src/net/session.ts`):
  - Its per-Fighter arrays come from `lineupAis`, so they cover the Pool.
  - On a Rollback a Pool AI's null memory (its slot unbound at the base Tick) is loaded too. Before, null was skipped, so a Pool AI that had bound a Soldier in the Ticks being re-simulated kept that AI's memory when the same Promotion happened again.
  - A resync must carry the Pool's size of Fighters and AI entries, a Crowd of `2 × armySize` Soldiers with a record per Player, a Pool AI's memory (or null) on each Pool slot, and an ordinary AI's nowhere else.
- **The wire** (`src/net/messages.ts`):
  - The session's hello and resync accept a Battle, on a Battlefield (`battle:<seed>`, or none). The Lobby's messages still refuse it (`isFormatOnMap` keeps `MATCH_FORMATS` by default), until Stage 7.
  - A Lineup, teams and weapons may be of one (a one-Player Battle). A Duel still needs two Fighters.
  - A Battle's state: up to 64 Pool slots (`MAX_POOL`), each Fighter's `soldier` binding, and the Crowd (`isCrowd`: every array as long as `x`, each entry what it may hold, every index in range, the Players' records with `away`). The Pool and the Crowd must agree on who is bound where (`isBattle`). Only a Battle has a Crowd.
  - Pool AI memory (`isPoolAiMemory`). An AI memory's sightings may cover the Pool. `chamberedBy` holds Fighter indices up to the Pool, not Player numbers: a real Battle state with a Chamber by slot 12 was refused before.
  - The checksums already hashed the whole state, the Crowd with it.

**What changed from the plan:**
- **"So the Pool never overflows"**: the Pool can't overflow (`openSlot` finds no free slot and nothing promotes), so the rule is about sharing it. Without shedding, a Bubble's counts ran past its share (6 slot-holders in one of two Bubbles side by side, Fighters drifting from one to the other), which `sharedBubbles.test.ts` caught.
- **The shared slots are smaller than Stage 0 guessed** (2 enemies + 1 ally each at four Bubbles). Waiting Fighters and corpses keep the Pool fuller than the slots alone, and at 2 + 1 four Bubbles held 11 to 12 bound, the whole free Pool, most of the time. 1 + 1 holds 9.5 on average, Stage 0's 8 to 10.
- **A Player who left "counts as an ally"**: its Fighter isn't promoted into an ally slot (it keeps its own), and it releases no Attack Slot by engaging a slot-holder as a promoted ally does. It is simply a full Fighter of its Team with no Bubble.
- **The 15-Tick window stays**, as the plan says. But a Rollback is costly even with nothing bound (below), and Stage 7's check with four browsers will show whether that is felt.

**Rollback cost** (`src/net/battleRollback.test.ts`, the full 200 v 200, four Players two a Team on a Hard Battle autopilot, a Pool AI on every other slot, each Tick snapshotted with every Pool AI's memory saved as the session does; every 10th Tick from 300 a 15-Tick Rollback: restore, load the Pool AIs, re-simulate, same hash every time). This laptop, alone, seed 1:

| four Bubbles at | bound in the melee (mean / most) | 15-Tick Rollback in the melee, mean / max ms | Tick (+ snapshot, AI save) mean ms |
|---|---|---|---|
| 2 enemies + 1 ally | 11 to 12 / 12 | 76 / 142 | 3.9 |
| **1 + 1 (chosen)** | **9.5 / 12** | **61 to 66 / 130 to 163** | **3.6** |
| 2 + 0 | 8 to 9 / 12 | 55 / 118 | 3.0 |
| 1 + 0 | 4 to 5 / 7 | 40 / 90 | 2.4 |

- With nothing bound (the march), a 15-Tick Rollback is still 22 to 25 ms: the Crowd, the four Players' Fighters and the snapshots. Each bound Fighter adds about 0.3 ms a re-simulated Tick.
- With two Players at 2 + 1: 7 to 8 bound, 46 ms. With three: 9 to 11 bound, 56 ms.
- The max is noisy (the march alone reaches 64 to 73 ms), so the budget is the bound count Stage 0 named (about 8 to 10).
- In the loopback tests (40 ms ± 20) the deepest Rollback was 3 to 9 Ticks and the session never stalled. At 1 + 1 a 6-Tick Rollback in the melee is about 25 ms here, on top of the Tick and the frame. Several of those a second would show. **Not measured**: the frame rate online in a browser (Stage 7's check).
- The test asserts the structure: four Bubbles fought on more than 100 timed Ticks, at most `BOUND_BUDGET` (10) bound on average, never more than the free Pool, every Rollback to the same hash. Its time bound is relative, a Rollback in the melee under 4.5 times one on the march in the same run (about 2.2 to 2.8 measured). A first, absolute bound (180 ms) failed in the full suite, which slowed it about 3 times (173 ms mean overall).

**Loopback tests** (`src/net/battle.test.ts`; 60 a side 10 m out; 40 ms ± 20; a virtual clock; each Player on a Hard Battle autopilot fed its own session's state; every peer's every simulated Tick hashed and compared with the same Intents stepped offline):
- **Two Players**, one a Team: a whole Battle to its end (Tick 1966, the same on every peer, one Rout, one BattleEnd), with no Desync. Both Bubbles promoted enemies, and each peer rolled back about 1,100 times (deepest 3 to 7).
- **Four Players**, two a Team, 1500 Ticks: 1,210 Ticks with four Bubbles and 8 or more slots bound. Every peer agreed every Tick, with 1,000 to 1,250 Rollbacks each (deepest 7 to 9).
- **A resync**: on Tick 311 the guest moved a promoted Fighter and cut a Soldier's HP. It was caught at the next checksum and resynced to Tick 336 with 8 slots bound, so the Pool AIs' memory came with it. After that it matched the host and the offline Battle on every Tick.
- **A Takeover**: Player 2 of three (Team 0) left on Tick 297 while its Bubble held enemies. Both other peers took the same Takeover Tick, and every peer marked it away from that Tick on and not before. Every Attack Slot a Team 1 Fighter took after it was taken within reach of Player 0, the one Team 0 Player still playing. The remaining two Bubbles stayed at their 2 + 1 share and the fights were slow, so only one slot changed hands in the 1,200 Ticks after.

**Tests**:
- `src/net/battle.test.ts` (4): above.
- `src/net/battleRollback.test.ts` (1): above.
- `src/net/battleMessages.test.ts` (5): a hello with a Battle of one to four Players, on a Battlefield only, and the Lobby still refusing it. Every state of a small Battle (each role, bound Pool AIs' memory, a takeover of a Soldier, a Player who left) is accepted as a resync through JSON, with the same hash. Refusals: a malformed Crowd, a Pool and Crowd that disagree, a Battle without its Crowd or a Duel with one, a Rematch, too many slots, malformed Pool AI memory.
- `src/sim/sharedBubbles.test.ts` (4): four Bubbles never hold more than their shared slots (allies over it only while they may not demote yet) and were all full at once for a while. One Bubble holds 4, two hold 2 each. A Player who left is marked away once, with `bubblePlayer` false. After it, Team 0 Soldiers promote only as Player 0's allies, and its Fighter falling takes over no one.
- `src/tuning/battle.test.ts` (+1, and the hash test covers `shared`): the table, `bubbleSlots`, and what the parser refuses.
- **Changed assertions**:
  - `messages.test.ts`: the protocol is 23, and a hello's options with one Weapon are now accepted (a one-Player Battle), so that refusal case became an empty list.
  - `battle.test.ts`: its `slots` `toEqual` became `toMatchObject` (the new `shared`), and its `allies: 0` case passes `shared: []`.
  - `tuning.test.ts`: the raw fixture gained `shared: []`.
  - `teams.test.ts`: a Lineup of one is no longer a malformed one on the wire (a one-Player Battle; `checkLineup` judges it), so that refusal case became an empty Lineup.

  No Duel, Dungeon or offline Battle assertion changed: one Bubble's slots are as before, and the Stage 3 to 5 Battle tests pass unchanged.
- `npm run typecheck` and `npm run build` pass. `npm test` (one full run): **1707 passed, 5 skipped, 11 failed**. Two were real, both fixed since: `teams.test.ts`'s one-Player Lineup (above) and the soak's absolute time bound (above). The other nine are timing-bound, 20 s timeouts and the navmesh-under-250 ms checks, in the Door spot soak, the two navmesh checks, the Run pickups test, the four-Player "goes silent" and resync tests, the Gauntlet's four-Player net test, and two 1,500-Tick Battle hash replays (Stage 3's and Stage 4's). That is more than Stage 5's 4: this Stage's loopback tests and soak (about 5 minutes of CPU) run beside them. Run on their own afterwards, the Battle replays, `teams.test.ts`, `players.test.ts`, `dungeonRun.test.ts` and the soak passed (141 tests).

## Stage 7: online Battle, presentation and Lobby
- Battle offered online in the Lobby (the host chooses it; Players pick their Team).
- A marker for each Player (a name tag and a minimap icon), since a Player who took over a soldier looks like every other soldier.
- **Check in `npm run dev`**: two browsers, then four, through a full Battle.

## Later
Elites (captains with Relic-style `mods`); Soldiers solid to full Fighters; orders (Charge, Hold, Follow me, Form line); more troop types and Bodies; ranged soldiers (Throwing Daggers, then bows); obstacles and fortifications (Crowd pathfinding beyond a flow field); a third render tier (render-only full models for nearby Soldiers, posed from Motions, which moves the swap further out without a bigger Pool); adjustable army sizes in the Lobby; reinforcement waves for bigger battles.

## Open questions
1. **A close swap is visible.** With the third-person camera a few metres behind the Player, 10 m is mid-screen. The crossfade hides some of it; the third render tier (Later) is the cheap fix with no new art if playtesters notice.
2. **Beginner AI was tuned for Duels.** Four of them taking turns may feel too passive or too deadly in a crowd. Stage 5 tuning judges it against "a Player can hold off four soldiers but not a dozen".
3. **The Pool size online.** Four Bubbles × (4 + 3) = 28 slots plus the Players. If Stage 0 says the laptop can't Roll back that many, Stage 6's shrinking rule decides it. **Settled in Stage 6**: `battle.slots.shared`, 1 enemy + 1 ally a Bubble at four, about 9.5 bound.
