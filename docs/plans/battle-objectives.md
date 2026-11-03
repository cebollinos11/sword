# Battle Objectives: squads, a Commander and five Objectives, then walls and levels

> Status: Stage 0 done (2026-11-03): 200 v 200 fits with Squads. Nothing else built yet. Eight Stages: 0, 1, 2a, 2b, 3a, 3b, 4a, 4b, each one chat (see "How to run each Stage"). Decisions below came from an interview, in rounds. This plan builds on `docs/plans/big-battle.md` (Milestones 1 and 2, done) and ADR 0020, and takes from its Later list: orders (per squad), obstacles and fortifications (Crowd pathfinding beyond a flow field) and reinforcement waves. Each Stage ends with a `### Result` written by whoever builds it (what was done, what changed from the plan, test counts), as in `docs/plans/big-battle.md`.

## Context
A Battle today is two armies of `battle.armySize` Soldiers charging each other across an open heightfield. One flow field per Team, rebuilt from positions, steers the Crowd at the enemy, and the Battle ends in a Rout (ADR 0020). It looks like a blob, and there is nothing to fight over but the other army.

We want:
- maps with several Objectives held at once, which the armies fight over;
- Soldiers moving in squads and formations, not as a blob;
- squads sent to attack or defend Objectives as a whole by one Commander per Team, so the Player does not have to be the tactician;
- maps with walls, gates, raised platforms, ramps, towers and tunnels.

Everything stays deterministic and rolls back up to 15 Ticks online (ADR 0001, 0005, 0010). What bounds a Battle online is a Rollback's re-simulation: at Stage 6 of the Big Battle plan, a 15-Tick Rollback on the march (nothing bound) was 22 to 25 ms on the reference laptop, and each bound Fighter added about 0.3 ms a re-simulated Tick. Squads, Objectives and terrain must fit inside that.

## Decisions

### Winning
- **Tickets.** Each Team starts with about 2 × `armySize` Tickets (derived, not a Lobby option). Every death of a Soldier or Fighter costs 1. Every second, a Team that owns more Objectives than the enemy drains the enemy by k × (its Objectives − theirs). It is linear: owning all five gives no bonus and does not end the Battle at once. k is tuned so holding most Objectives the whole time wins in about 6 to 8 minutes.
- **The Rout stays, as the collapse.** A Team at 0 Tickets stops respawning. The Rout then fires as it does today, once its living Soldiers fall below `battle.rout.threshold`.
- **A time limit of 15 minutes.** At the limit the Team with more Tickets wins; on a tie, the one that owns more Objectives; then a coin flip from the Simulation's seeded generator.
- **Every Battle is an Objective Battle.** The plain Rout-only Battle goes: one code path. The Lobby gains a map picker (Open field, Fort) beside army size and fighting speed.

### Objectives
- **Five capture Objectives per map**, each with a starting Owner (a Team or none) from the map's data.
- **Capturing**: an Objective is a circle (or polygon) with a progress value from −1 to +1. Each Crowd step counts the living Soldiers and Fighters of each Team inside it. Progress moves toward the Team with more inside, at a rate that grows with the difference, capped. At ±1 the Objective is owned. While both Teams are inside, the Owner keeps it until outnumbered.
- **A Player counts as 3 Soldiers** on an Objective, so a good Player matters to the Objectives even with few kills (Stage 5 of the Big Battle plan: a Hard-AI Player gets about 1.5 kills a Battle).
- **Open field**: three neutral Objectives across the centre line (left; centre, on the hill when the seed makes one; right), and one **Home Objective** per army between its deployment and the centre, owned by that army at the start. A Battle opens 1 v 1 with three to fight over.
- **Fort**: B is the keep inside the fort (raised in Stage 4b); A and C are the flanks outside the walls; D and E are the two gatehouses, one facing each army. All five start neutral.
- **Only the `Capture` kind for now.** An Objective has a kind so others (a Gate to break, a VIP to kill, siege equipment to escort) can come Later without rework.

### Squads and Formations
- **A Squad is a fixed group** of `battle.squad.size` Soldiers (12), set at deployment: 16 a side at 200, the remainder folded into the last Squads. At other army sizes, Squads = ⌈armySize / size⌉.
- **Formation by situation**, never by order: **column** (3 wide, 4 deep) on the march, **line** (6 wide, 2 deep) in contact, **loose** when broken up or the ground is cramped. Places are 1.5 m apart, as deployment is today. The Squad's anchor turns at a limited rate, so it wheels and does not flip. A Soldier out of place walks up to about 20% faster to catch up.
- **In contact**, the Squad faces the enemy in line. The front rank fights (the existing engage rule). The rear rank holds its places and steps up into gaps.
- **Morale, per Squad**: a Squad down to 30% falls back toward the nearest Objective its Team owns (or its Base) and merges into another Squad there.
- **Engaging on the way**: on the march, a Squad engages an enemy Squad only within about 15 m of its route, or once at its Objective. Otherwise it marches on. A single Soldier within engage reach still fights back.
- **Respawning**: a Squad wiped out (or merged away) respawns whole about 10 s later, if its Team has Tickets, at its Base or an owned, uncontested Objective the map marks as a spawn. The Commander picks which. The Crowd keeps a fixed capacity and reuses dead slots, so the state's shape never changes.
- **A Squad brain steps at 2 Hz**, staggered like the Crowd; Soldiers keep stepping at 10 Hz and steer to their places. Squad state is a small struct-of-arrays beside the Crowd (anchor, heading, shape, Order, Objective, morale, size), plain data, hashed and rolled back.
- **Promoted Soldiers keep their Squad** and their place. As a full Fighter it fights the Player and ignores its Squad's Order. Demoted, it walks back to its place. The Squad does not wait for it; the Formation just has a gap.
- **A taken-over Soldier leaves its Squad.** When a fallen Player takes over the nearest allied Soldier, that Soldier becomes a free agent, as Players are, and its Squad goes on one short.
- **Soldiers stay non-solid to full Fighters.** A Squad's line bends round a Player rather than blocks them, as today's steering does. The Bubble promotes anything within 10 m, so it is rarely seen.

### The Commander
- **One per Team, simulated, symmetric.** The same rules drive both Teams, on every peer, with no fog of war (it sees the whole Battle). Its memory (each Squad's Order and how long it has held) is plain data in `SimState`. Nothing new crosses the wire.
- **It re-plans every 2 to 3 s**, scoring each Squad and Objective by the Objective's weight (map data), the threat there, the path distance (from the destination fields) and what is already sent. It assigns Squads greedily. An Order holds at least about 15 s unless the Squad breaks, so Squads don't flip-flop. It keeps no reserve.
- **Orders**: attack an Objective, defend an Objective, fall back (morale), and respawn at a spawn.
- **It is blind to Players as people.** They count only through the Objective counts and the threat score (3 Soldiers each). It never sends Squads to hunt a Player.
- **Players are free agents.** No Squad follows a Player; "follow me" is a cheap Later once Orders exist. The HUD tells the Player what their army is doing ("your army is attacking B"), for flavour only.

### Terrain
- **Battle maps are hand-built** in Blender, one or two to start, through the ADR 0006 pipeline: Walk Surfaces and Walls, plus helpers for Objectives, Bases, spawns and deployment. A Kit generator (ADR 0014) is Later.
- **Battle maps are `ArenaGeometry`** from Stage 3a. The open-field heightfield stays as a map of its own. Full Fighters get the real navmesh, **without Jump Links on Battle maps**, so a 200 m map builds cheaply and promoted AI does not leap off walls.
- **`armySize` per map.** 200 v 200 stays the target, but each map sets its own default and cap, so a dense castle map may run 120 v 120. The Lobby's army-size knob is held to the map's cap.
- **Destination fields are static and cached outside `SimState`.** One flow field to each destination (each Objective and each Base, per Team, about 10 to 12) is built once per map and Tuning Data, like the navmesh. It adds nothing to state and costs nothing per Tick. This replaces today's per-Team field rebuilt from positions. A Squad's anchor follows its destination's field; the last few metres toward an enemy Squad are local steering. Soldiers steer to their places, are pushed out of Walls, and fall back to the field when their place is inside a Wall.
- **Narrow passes**: each field cell stores its clearance (distance to the nearest Wall). The Formation narrows to the clearance ahead, so a line becomes a column through a gate and opens out beyond it.
- **Soldiers live on Walk Surfaces** (Stage 4a). Each Soldier stores the Walk Surface it is on beside `x`/`z`, and `y` follows. It crosses between surfaces over shared edges by the existing walk and drop Links, and **never jumps**. A tunnel under a platform works for free: a Soldier is on the tunnel's floor, not "the highest ground at x, z". A build-time check (like ADR 0014's judge) proves every area of the map is joined by walking.
- **The Bubble across levels**: Promotion uses horizontal distance, but a Soldier more than about 2.5 m above or below the Player is never promoted. Demotion keeps its 16 m.
- **No ranged troops in this plan.** Height gives no firing advantage; walls, ramps, towers and tunnels shape the fight through chokepoints, longer routes and Objectives on keeps and gatehouses, and through the duel's own rules (falls, jumping Attacks, Slides off ledges) for full Fighters. Ranged Soldiers (Throwing Daggers, then bows) are a plan of their own.
- **The first terrain map is the Fort**, one symmetric map grown over Stages 3a to 4b: in Stage 3a, a ruined fort in the middle of the field, with a broken outer wall, two gatehouses and breaches; in Stage 4b, a raised keep inside (B moves onto it) reached by two ramps, and a tunnel under the keep joining the two gatehouses. Each Stage's check is the same Battle with one new thing in it.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Squad**: a fixed group of a Battle's Soldiers, set at deployment, that moves in a Formation and carries out one Order. _Avoid_: unit, platoon, group.
- **Formation**: the shape of a Squad's places round its anchor (column, line, loose), chosen by the situation. _Avoid_: stance, shape (on its own).
- **Objective**: a place on a Battle's map the armies fight over, with a kind (only Capture for now), a progress and an Owner. _Avoid_: zone (a Door has one), flag, point, control point.
- **Owner**: the Team that holds an Objective, or none.
- **Home Objective**: an Objective its map gives a Team at the start.
- **Ticket**: one unit of a Team's reserve. A death costs one, being out-held drains them, and at none a Team no longer respawns. _Avoid_: reinforcement, life. (An Attack Slot already avoids "ticket" for itself.)
- **Commander**: the simulated AI that gives a Team's Squads their Orders. _Avoid_: general, director, tactician.
- **Order**: what a Squad is doing for its Commander: attack or defend an Objective, fall back, respawn. _Avoid_: task, command.
- **Base**: a Team's own end of the map, behind its deployment, where its Squads respawn. It cannot be captured. _Avoid_: HQ, camp.

## How it fits the existing code
- **`SimState` gains Squads, Objectives, Tickets and the Commanders' memory**, all plain data like the Crowd (ADR 0020), in `hashValue`, `snapshot` and a JSON resync. The Crowd gains each Soldier's Squad and place, and from Stage 4a its Walk Surface.
- **`stepCrowd` keeps its stagger.** The Squad step (2 Hz) and the Commander step (every 2 to 3 s) are staggered so no Tick pays for all of them.
- **The destination fields and clearance are a per-map cache** beside the navmesh (`src/sim/nav.ts`), keyed by map and Tuning Data, pure and tie-broken by index. A Rollback never rebuilds them.
- **The Battlefield gains a second kind**: today's heightfield (`battle:<seed>`), and from Stage 3a a hand-built `ArenaGeometry` with Battle helpers. Maps are Tuning Data, so peers on different maps refuse each other, as today.
- **Promotion, Demotion and the takeover** read and write Squad membership, and the Bubble gains the height gate (Stage 4a).
- **The renderer**: Objective markers (letter, Owner colour, capture ring), the minimap's Objectives and Squad arrows, and Ticket bars in place of the strength bars.

## Working rules for every Stage
The Big Battle plan's rules hold: determinism first (every new piece of state is plain data, hashed, snapshotted, with a replay test and a Rollback test across its new event); Duels and Runs do not change; Tuning Data in `data/battle.json` (and the map files) with no magic numbers for anything marked "about"; `CONTEXT.md` changes in the Stage whose code makes a term true; `npm run typecheck`, `npm test`, `npm run build` and the Stage's checks in `npm run dev` before a Stage is done; stop at the end of each Stage and write its `### Result`.

**The budget gate**, every Stage: on the reference laptop, the Crowd step (with Squads and the Commander) stays about 1 ms mean a Tick, and a 15-Tick Rollback on the march stays within about 30 ms (22 to 25 ms at Big Battle Stage 6). If a map breaks it, lower that map's `armySize`, not the target.

## How to run each Stage
- **One chat per Stage**, started fresh from this file. The Stage's own list and its "Done" are the brief. A chat that runs long enough to be summarized loses detail, so the Stages are cut small enough to finish in one.
- **The model each Stage names.** Sonnet where the work is well specified and the tests catch mistakes mechanically; Opus where it is judgement (the Commander, tuning) or where a bug shows as a rare Desync or a stuck Soldier that tests miss (the move to `ArenaGeometry`, Soldiers on Walk Surfaces).
- **A review before the commit**, every Stage: `/code-review` at `high` effort or more, on Opus, against this plan (Spec) and the repo's standards, in the same chat or a fresh one. Fix what it finds, then commit. A Sonnet Stage's review is still on Opus.
- **Stop at the Stage's "Done"** and write its `### Result` honestly: what was built, what changed from the plan, test counts, and the budget gate's numbers as measured, including anything over budget. The next Stage reads that Result before it starts.
- **One Stage at a time.** Each Stage builds on the last one's code; none runs in parallel with another.

## Stage 0: the bench
**Model**: Sonnet.

- Extend Stage 0's bench (and `battleRollback.test.ts`'s measure) with a 200 v 200 Battle with Squads: 32 Squad brains, the cached destination fields, formation steering, and (a stub for Stage 3b) Wall push-out against a box of Walls.
- Measure one Tick and a 15-Tick Rollback re-simulation on the march and in the melee. Write down the numbers and the budget gate's figures.
- **Done**: the numbers are in the Result, and they say whether 200 v 200 fits with Squads. If not, the default `armySize` this plan uses.

### Result
**Built** (`src/editor/benchSquads.ts`, tests in `benchSquads.test.ts`, a Squads button on the bench page `#/editor/bench`): benchCore's Crowd prototype with Squads on top. 200 v 200 is 32 Squads (16 a side, 12 Soldiers, the remainder 8 folded one each into the last 8, so 13). Per Squad a brain at 2 Hz, staggered by index (morale under 30% falls back to the Base; Formation column, line or loose, or column when the clearance under the anchor is under 6 m; anchor heading turning at a limited rate, speed 0.8 of a Soldier's, halting in contact, at its destination or when the Squad lags 6 m). The destination fields are 12 BFS fields (five Objectives, two Bases, five spawn points) plus a clearance per cell, built once with the Walls and held outside the state. Soldiers steer to their place (up to 20% faster to catch up), the front six of a line close with the enemy, a Soldier whose place is in a Wall follows the field, and everyone is pushed out of a box of 24 Walls (two rows with gates and blocks on the centre line). The state is the Crowd's arrays plus the Squad arrays, snapshotted per Tick and restored by copying back; a 15-Tick Rollback lands on the same byte hash every time. No Commander, merging or respawning (a brain's cost does not depend on them).

**Measured** (this laptop, Node, `npx vitest run src/editor/benchSquads.test.ts`; two runs agree to within 0.01 to 0.1 ms; Crowd only, not a whole Match):

| 3,600 Ticks | Tick mean / p99 / max | online Tick (+ snapshot) | march: Tick, 15-Tick Rollback mean / p99 | melee: Tick, 15-Tick Rollback mean / p99 |
|---|---|---|---|---|
| 100 v 100 (16 Squads) | 0.13 / 0.25 / 1 to 3 | 0.17 | 0.15, 2.6 / 4.5 | 0.12, 2.1 / 4.2 |
| **200 v 200 (32 Squads)** | **0.25 / 1.1 / 4.8** | **0.30** | **0.34, 5.5 / 17.5** | **0.20, 3.6 / 11 to 15** |
| 300 v 300 (50 Squads) | 0.39 / 0.8 / 4 | 0.45 | 0.43, 7.4 / 13.7 | 0.33, 6.0 / 12.9 |

- The 32 brains cost under 0.01 ms a Tick (about one brain a Tick), the anchors 0.01 ms, the Soldiers 0.24 ms. The 12 fields and the clearance build in 2.5 to 9 ms once.
- The same Crowd without Squads (the old prototype, in the same run) is 0.21 ms a Tick, so Squads, fields and Wall push-out add about 0.04 ms (+20%). The prototype sits under the real Crowd step (0.38 ms at 400 Soldiers, Big Battle Stage 1) because it omits the real morale and Intent plumbing; scaled by the same ratio, a real Squad Crowd is about 0.45 to 0.5 ms a Tick, inside the 1 ms gate.
- "March" and "melee" are Ticks with under 2% and over 20% of the living Soldiers in sight of an enemy. The march is the costlier because all 400 are alive; the melee thins out. The Rollback p99 is high because the machine's other processes show up in a 5 ms sample.
- **The real Rollback soak, as it stands today** (`battleRollback.test.ts`, four Players, no Squads): Tick 3.7 ms mean (12.4 p99); a 15-Tick Rollback **24.4 ms on the march**, as at Stage 6, and **67 ms in the melee with four Bubbles full** (p99 133). Adding Squads' extra to the 15 Ticks (about +0.6 ms measured, +1.5 ms scaled to the real Crowd) puts the march at about **26 ms, inside the budget gate's 30 ms**. The four-Bubble melee was over 30 ms before this plan and the gate as written names the march; the plan does not make it worse by more than that +1.5 ms. I did not extend `battleRollback.test.ts` itself: there are no Squads in the Simulation to run it with until Stage 1, so that Stage should add the Squads' share to its measure.

**Done**: 200 v 200 fits with Squads. The default `armySize` this plan uses stays **200**. A 300 v 300 would also fit the Crowd's own 1 ms, and the march Rollback has about 4 ms of head room before 30 (Squads at 300 v 300 add about 3 ms), but the plan's target stays 200.

**Unchanged findings for later Stages**: the prototype's Walls are boxes, so push-out is cheap; Stage 3b's real Walls (a navmesh or a grid) must stay within about 0.2 ms to hold the 1 ms gate. Squads never reach Wall corners that trap a column in this stub (0 Soldiers inside a Wall over every run) — not evidence that the real push-out works.

**For Stage 1**: read `src/editor/benchSquads.ts` for a working shape of the Squad arrays (anchor, heading, velocity, destination, Formation, living; per Soldier a Squad and a slot) and the 2 Hz staggered brain. It is a throwaway prototype, not the Simulation's code. Add the Squads' share to `battleRollback.test.ts`'s measure once the Simulation has Squads. This Stage was committed without the Opus `/code-review` (the user skipped it); it only adds bench code and tests, no Simulation change.

**Tests**: `benchSquads.test.ts` adds 5 (deployment, Walls, Rollback determinism, the 200 v 200 run that logs the table, the 100/300 scaling). `npm run typecheck` and `npm run build` pass. `npm test`: 1729 pass; `doorSpot.test.ts` times out at 20 s (it does with my changes stashed too, so it is the machine, not this Stage); six other files that failed in the full parallel run (attack slots, bubble, battle soak, arenaGen's timing, players) pass alone.

## Stage 1: Squads and Formations on the open field
**Model**: Sonnet.
- `battle.squad` Tuning Data (size, spacing, turn rate, catch-up, morale threshold, engage distance, Formation shapes).
- Deployment in Squads; the Squad step at 2 Hz; column, line and loose; wheeling; the front rank fights and the rear steps up; fall back and merge.
- The Battle is still a Rout Battle here. With no Commander yet, every Squad's Order is "attack the enemy army" (the Squad's own local steering toward the nearest enemy Squad).
- Promotion and Demotion keep Squad membership; the takeover takes a Soldier out of its Squad.
- Debug view (`#/editor/battle`): Squad anchors and places.
- ADR 0021 (Squads, Objectives and the Commander are simulated; destination fields are static and cached outside state) and `CONTEXT.md`: Squad, Formation.
- **Done**: in `npm run dev`, Squads march in column, form line on contact, fall back and merge; same seed and Intents give the same hash every Tick; a snapshot continues identically; a Rollback across a merge lands on the same state; a two-Player online soak has no Desync; the budget gate holds.

## Stage 2a: Objectives, Tickets and the Commander in the Simulation
**Model**: Sonnet, with the Commander's scoring and hold rule checked by the Opus review.
- `battle.objectives`, `battle.tickets` and `battle.commander` Tuning Data; the open field's five Objectives (three centre, two Home) from the Battlefield's data.
- Capture as decided (a Player counts 3), Owners, Tickets and the drain, the 15-minute limit and its tie-breaks, the Rout at 0 Tickets.
- Respawning Squads at Bases and spawn Objectives, reusing dead Crowd slots.
- Destination fields per Objective and Base, cached per map (on the heightfield there are no Walls, so clearance is unbounded); Squads march by them, replacing Stage 1's "attack the enemy army".
- The Commander: scoring, greedy assignment, the hold time, fall back and respawn Orders.
- Debug view: Orders as lines to their Objectives, Objective rings with progress, fields as arrows, Tickets on the panel. The game itself shows nothing new yet.
- `CONTEXT.md`: Objective, Owner, Home Objective, Ticket, Commander, Order, Base; the Battle and Rout entries updated.
- **Done**: AI-v-AI Battles in the debug view end by Tickets (any length; 2b tunes it); the Commander sends Squads to every Objective and its Order changes per Squad per minute are measured and logged; a Rollback across a capture and a respawn lands on the same state; a resync carries Squads, Objectives, Tickets and the Commanders; the budget gate holds.

## Stage 2b: presenting Objectives, and tuning
**Model**: Opus. Tuning is reading soaks and judging what looks right.
- HUD: Ticket bars in place of the strength bars, Objective markers (letter, Owner colour, capture ring), the minimap's Objectives and Squad arrows, the "your army is attacking B" line. Results screen: Tickets left and Objectives held.
- The Lobby's map picker (only Open field here).
- Tuning pass: k, Tickets, capture rates, Objective weights, the Commander's hold time, Squad morale. Settle Open questions 1 and 2.
- **Done**: AI-v-AI Battles end by Tickets in about 6 to 8 minutes over a soak of seeds; the Commander does not flip-flop (Order changes per Squad per minute under a bound the Result names); in a human playtest the Player changes who owns an Objective; an online Battle with two Players plays to its end with no Desync; the budget gate holds.

## Stage 3a: Battle maps as `ArenaGeometry`, and the Fort's first shape
**Model**: Opus. This is the change most likely to break Duels and Runs.
- A Battle's map as either today's heightfield or an `ArenaGeometry` with Battle helpers (Objectives, Bases, spawns, deployment), from a Blender generator (`art/build_battle_fort.py`), as ADR 0006 does for Arenas.
- The Fort, one level: broken outer wall, two gatehouses, breaches; Objectives A to E as decided.
- Full Fighters on its navmesh without Jump Links; the Crowd's ground lookup on Walk Surfaces for a one-level map (the multi-level part is 4a).
- The renderer draws the Fort; `armySize` per map, with the Lobby's knob held to the cap. The Lobby's map picker offers the Fort.
- Soldiers are only clamped out of Walls here (a crude push), enough to play; 3b makes them move well.
- ADR 0022 (Battle maps are `ArenaGeometry`; Soldiers live on Walk Surfaces and never jump), started here.
- **Done**: a Battle on the Fort plays to its end offline and online; promoted Fighters path round the walls; every existing Duel, Run and open-field Battle test passes unchanged; the budget gate's numbers on the Fort are measured (Open question 3) and the Fort's `armySize` set from them.

## Stage 3b: Squads among walls
**Model**: Sonnet, with the Opus review.
- Soldiers pushed out of Walls properly, falling back to the field when their place is inside a Wall.
- Clearance per field cell; Formations narrowing to it through gates and breaches and opening out beyond.
- A stuck counter: how long each Soldier has been out of place, logged over whole Battles.
- **Done**: no Soldier stays out of place more than 10 s over a soak of Fort Battles; Squads narrow to a column through the gates; the budget gate holds on the Fort.

## Stage 4a: Soldiers on several levels
**Model**: Opus. Walk Surfaces inside the Crowd's hot loop is the hardest part of the plan.
- Each Soldier's Walk Surface in the Crowd, crossing by walk and drop Links, never jumping; `y` from its surface.
- The destination fields over a multi-level map (per Walk Surface region, not a flat grid where levels overlap).
- The build-time walk check: every area of a Battle map joined by walking.
- The Bubble's height gate.
- Built and tested on small hand-made test maps (a platform with a ramp, a bridge over a tunnel), not the Fort.
- ADR 0022 finished.
- **Done**: on the test maps, every Soldier stands on the right level (an assertion every step: its `y` is its Walk Surface's height at its place); a Squad goes under a bridge and over it by the field's shorter route; nobody is promoted through a floor; a Rollback across a level change lands on the same state; the budget gate holds.

## Stage 4b: the Fort's keep, ramps and tunnel
**Model**: Sonnet, with the Opus review.
- The Fort grows a raised keep (B on top) reached by two ramps, and a tunnel under it joining the gatehouses, from the same generator.
- Tuning for the keep (B's weight, the Fort's `armySize` measured again).
- **Done**: over a soak of Fort Battles, every Soldier stands on the right level; Squads use the tunnel when the field says it is shorter; Battles still end by Tickets in about 6 to 8 minutes; an online Battle plays to its end with no Desync; the budget gate holds.

## Later
Ranged Soldiers (Throwing Daggers, then bows), which give towers their point; other Objective kinds (a Gate to break, a VIP, siege equipment to escort); "follow me" and other Orders a Player can give; a Kit generator for Battle maps; Soldiers solid to full Fighters; Elites; asymmetric attack-and-defend maps.

## Open questions
1. **Merging Squads.** Which Squad a broken remnant joins (the nearest at its rally point, or the one most short of Soldiers), and whether a merged Squad may grow past `squad.size`. Stage 1 picks one, 2b settles it from what looks right.
2. **Spreading thin.** Whether five Objectives at 16 Squads a side spread the armies too thin to look like a battle. Stage 2b's tuning may move the weights or the Objectives closer.
3. **The Fort's cost.** Whether a 200 m map with walls and a keep fits the budget gate at 200 v 200, or needs about 120 v 120. Stage 0 guesses, Stage 3a measures, 4b measures again.
