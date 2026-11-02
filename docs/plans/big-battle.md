# Big Battle: 200 v 200 on an open field, with the duel's combat where the Players are

> Status: Stage 3 done (2026-11-02). Decisions below came from an interview, one question at a time. Milestone 1 (Stages 0 to 5) is offline with one Player; Milestone 2 (Stages 6 and 7) is online with up to four. Each Stage ends with a `### Result` written by whoever builds it (what was done, what changed from the plan, test counts), as in `docs/plans/dungeon.md`. Next: Stage 4.

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

## Stage 6: online Battle, the Simulation side (Milestone 2)
- **Four Bubbles**: one per Player's Fighter. Overlapping Bubbles share the Pool. A rule for shrinking each Bubble's budgets when several Bubbles are in use, so the Pool never overflows (from the Stage 0 numbers).
- **Players' slots**: slots 0 to 3 are the Players. A guest leaving is an AI Takeover of its slot as today (ADR 0010), and that Fighter then counts as an ally, not a Bubble.
- **Resync** carries the Crowd and every bound slot's AI memory. `PROTOCOL_VERSION` + 1. Checksums cover the Crowd.
- **Rollback cost**: a soak with four Bubbles full measures the worst Rollback; if it is over budget, lower the Bubble budgets, not the 15-Tick window.
- **Tests**: loopback tests over the memory transport (two and four Players, a resync mid-battle, a Takeover mid-battle), as the Dungeon's Stage 4 did.

## Stage 7: online Battle, presentation and Lobby
- Battle offered online in the Lobby (the host chooses it; Players pick their Team).
- A marker for each Player (a name tag and a minimap icon), since a Player who took over a soldier looks like every other soldier.
- **Check in `npm run dev`**: two browsers, then four, through a full Battle.

## Later
Elites (captains with Relic-style `mods`); Soldiers solid to full Fighters; orders (Charge, Hold, Follow me, Form line); more troop types and Bodies; ranged soldiers (Throwing Daggers, then bows); obstacles and fortifications (Crowd pathfinding beyond a flow field); a third render tier (render-only full models for nearby Soldiers, posed from Motions, which moves the swap further out without a bigger Pool); adjustable army sizes in the Lobby; reinforcement waves for bigger battles.

## Open questions
1. **A close swap is visible.** With the third-person camera a few metres behind the Player, 10 m is mid-screen. The crossfade hides some of it; the third render tier (Later) is the cheap fix with no new art if playtesters notice.
2. **Beginner AI was tuned for Duels.** Four of them taking turns may feel too passive or too deadly in a crowd. Stage 5 tuning judges it against "a Player can hold off four soldiers but not a dozen".
3. **The Pool size online.** Four Bubbles × (4 + 3) = 28 slots plus the Players. If Stage 0 says the laptop can't Roll back that many, Stage 6's shrinking rule decides it.
