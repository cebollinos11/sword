# Battle Objectives: squads, a Commander and five Objectives, then walls and levels

> Status: Stages 0, 1, 2a and 2b done (2026-11-03): 200 v 200 fits with Squads, the Simulation has Squads and Formations, and Battles on the open field are fought over five Objectives, ended by Tickets, with a Commander per Team giving Squads their Orders and Squads respawning; the HUD, minimap, Results and Lobby present them, and the tuning is set (an AI-v-AI Battle lasts about 6.7 minutes). Eight Stages: 0, 1, 2a, 2b, 3a, 3b, 4a, 4b, each one chat (see "How to run each Stage"). Decisions below came from an interview, in rounds. This plan builds on `docs/plans/big-battle.md` (Milestones 1 and 2, done) and ADR 0020, and takes from its Later list: orders (per squad), obstacles and fortifications (Crowd pathfinding beyond a flow field) and reinforcement waves. Each Stage ends with a `### Result` written by whoever builds it (what was done, what changed from the plan, test counts), as in `docs/plans/big-battle.md`.

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

### Result
Done 2026-11-03 (pending the Opus review below). A Battle's armies are now Squads: 16 a side at 200 v 200 (12 Soldiers, the remainder 8 folded one each into the last 8, so 13), deployed in column in ranks of 6 Squads, marching on the nearest living enemy Squad in column, forming line once an enemy Soldier is within 15 m, falling back and merging when broken. ADR 0021 (Proposed) and `CONTEXT.md` (Squad, Formation) are written.

**Built**
- **Tuning Data** `battle.squad` (`SquadTuning`, in `tuningDataHash`): size 12, spacing 1.5, turnRate 1.2 rad/s, catchUp 1.2, speed 0.8 (of walk speed), lag 6 m, brainSeconds 0.5, moraleThreshold 0.3, looseBelow 0.5, engage 15 m, mergeRange 6 m, mergeMax 16, baseDistance 85 m, column 3 wide, line 6 wide, loose spread 0.8. `deploy.file` and `deploy.rank` are gone (`squad.spacing` sets the layout); `deploy.perRank` is Soldiers wide, so a rank holds 6 Squads. `deployLayout`/`squadSizes` (tuning) are shared by the Simulation, the spawns and `maxArmySize`.
- **State** (`CrowdState.squads`: team, anchor x/z/heading, aim, speed, Formation, living, fall; and per Soldier `squad`, `place`): plain arrays, hashed, snapshotted, in the JSON resync (validated in `messages.ts`, the session checks the Squad count).
- **`stepSquads`** (`src/sim/squad.ts`), at the start of `stepCrowd`: brains at 2 Hz, each Squad on its own Tick by its place in its army (the two armies' k-th Squads think together); anchors turn and walk every Tick. Brains read the other Team's Squads and the Soldiers as they stood at the start of the Tick. The rear rank steps up into gaps (living Soldiers whose place is past the living count take the lowest free places). Morale, fall back, merge and rally as in ADR 0021.
- **Soldier step**: a Squad's Soldier engages an enemy in reach as before (except one in a Squad falling back, which breaks off), else steers to its place (catch-up 1.2×; faces the Squad's heading when in place); only the front rank of a Squad in line walks at an enemy in sight. Free agents (no Squad) keep the old flow-field code; nothing creates one but the takeover.
- **Bubble**: a promoted Soldier keeps its Squad and place; a taken-over Soldier leaves its Squad.
- **Debug view** (`#/editor/battle`): Squad anchors (cones: green column, orange line, purple loose, pink falling back), a dot at each Soldier's place, a "squads" toggle, Formation counts in the panel.

**What changed from the plan**
- **Squads = `floor(armySize / size)`**, not the plan's ⌈⌉ (the plan's own "16 a side at 200" needs floor).
- **Open question 1 (picked here, 2b settles it)**: a broken remnant falls back to its Base and, once within `mergeRange` of it, joins the nearest Squad of its Team within `mergeRange` that has room (at most `mergeMax` = 16 living Soldiers, so a merged Squad may grow past `size`). A remnant never merges on the way, and never into a Squad that thinks later in the same Tick (its count would be a step old). Merged remnants back at half strength rally and march out again. With no Commander or respawn (2a), a lone remnant at the Base waits there.
- **Soldiers of a falling Squad break off their fights** (not in the plan): otherwise an engaged Soldier stood and traded blows while its Squad's anchor left.
- **No Order data yet**: every Squad's Order is "attack the nearest living enemy Squad"; there is no Order array until 2a.
- **Seen on the full 200 v 200 war (seeds 1 to 6)**: first line on Tick 1021 (the armies close at about 4 m/s from 80 m apart); 20 to 29 Squads fall back in a Battle but most fall late, so remnants merge in only 2 of the 6 seeds (the rest die or are still walking when the Rout comes); Battles last 3,400 to 5,000 Ticks (57 to 84 s) against about 52 s before, since the falling remnants stay alive; Team 0 won 4 of 6. For 2b's tuning (morale, merging), not set here.
- `battleRollback.test.ts`'s `BOUND_BUDGET` 10 → 10.5: Squads' lines hold the four-Bubble melee at 9.7 to 10.2 bound on average (9.5 at Big Battle Stage 6); still "about 10".

**Budget gate** (this laptop, Node, `battleRollback.test.ts`'s soak, seed 1; the Squads' share is timed there on every Tick):
- Crowd step with Squads **0.30 to 0.39 ms mean** (p99 1.7 to 2.0); the same Crowd with every Soldier a free agent (today's flow-field step) 0.40 to 0.46 ms; the Squad step alone (brains and anchors) **0.03 ms mean** (p99 0.2). So Squads add about 0.5 ms to a 15-Tick Rollback for brains and anchors, and are on net slightly cheaper than the per-Team flow field they replace (-0.2 to -1.3 ms). Inside the 1 ms gate.
- **15-Tick Rollback on the march: 22.0 and 24.1 ms** in two runs with the machine quiet (inside 30 ms); 26 to 36 ms in runs while other work was running. **In the four-Bubble melee: 68 to 70 ms** quiet (61 to 66 at Stage 6; the plan's gate names the march).
- Whole Tick (AI + `stepMatch` + snapshot, four Players) 3.7 to 4.6 ms mean; the ten-minute soak 2.45 ms mean, p99 7.7 ms, every replay hash matching, 9 Battles.
- Not measured: the frame rate, and a two-browser online Battle (the loopback tests cover the Squads' state, below).

**Tests**: `squad.test.ts` (19: deployment, column on the march, line on contact, wheel rate, front rank closing and rear holding, column ignoring an enemy in sight, catch-up speed, loose, rear stepping up, falling back, breaking off a fight, merging at the Base, rally, mergeMax, Promotion/Demotion keeping Squad and place, replay hash, snapshot continuing, Rollback across a fall and a merge, Squads in the hash); `tuning/battle.test.ts` +2; `battleMessages.test.ts` refuses 9 malformed Squad edits; `takeover.test.ts` checks the takeover leaves the Squad. Changed existing tests: the stagger test now says a Soldier moves only on its due Ticks (a Soldier at its place stands), and the Team-mate path test makes its Soldiers free agents (they would otherwise walk back to places 60 m away). A two-Player online Battle, a four-Player Battle, a resync and a takeover (`net/battle.test.ts`) pass with no Desync. `npm run typecheck` passes. `npm test` full run: 1743 passed, 15 failed, all timing-bound in a loaded run (the usual navmesh-under-250 ms checks and 20 s timeouts, the soak's and Rollback test's time assertions); the six Battle files that failed there (soak, battleRollback, net/battle, bubble, attackSlots, players) pass alone (46 tests).

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

### Result
Done 2026-11-03, reviewed by Opus before the commit (below). The open field is now an Objective Battle: five Objectives, Tickets, a Commander per Team, destination fields, and Squads that respawn. ADR 0021 is Accepted and `CONTEXT.md` has Objective, Owner, Home Objective, Ticket, Commander, Order, Base and Destination field (Battle, Rout and Squad updated).

**Built**
- **Tuning Data** `battle.objectives` (circle 12 m, a Player counts 3, capture every 0.5 s at 0.01 progress a second per Soldier more, at most 0.08, and the open field's five sites: Home `H0`/`H1` at z = ∓30 owned and marked spawns, `A`/`C` at x = ∓55, `B` weight 1.4 on the highest ground within 15 m of the middle), `battle.tickets` (2 a Soldier = 400, drain 0.3 a second per Objective more, limit 900 s, respawn 10 s), `battle.commander` (plan 2.5 s, hold 15 s, stick, falloff, distance, threat radius, danger, and the four values `attack`, `retake`, `garrison`, `defend`). All in the Tuning Data hash and validated. The first-guess values are for 2b to tune.
- **State** (plain data, hashed, snapshotted, in the JSON resync): `CrowdState.objectives` (progress and Owner per Objective), `CrowdState.tickets` (two numbers), and in `SquadState` each Squad's `order` (attack, defend or respawn), `target` (an Objective, or `objectives + team` for a Base), `since` (the Tick the Order was given) and `respawnAt`. `messages.ts` validates each (ranges, whole arrays); `session.ts` checks the Objective count, the Tickets and every destination against Tuning Data (`battleStateFits`).
- **Map** (`Battlefield.objectives`, `.bases`, static) and **destination fields** (`src/sim/destinations.ts`): 7 fields (5 Objectives, 2 Bases), a Dijkstra over the 4 m flow grid (8 ways, ties by cell index), cached on the built Battlefield and kept out of the state. `stepCrowd` takes the map as a fifth argument (a default of seed 1's for tests; `stepBattle` passes the Battle's).
- **Objectives and Tickets** (`src/sim/objectives.ts`, in `stepCrowd`): capture counts Soldiers in the Crowd and the full Fighters (`CrowdFighter`, a Player's counting 3) inside each circle; the Owner holds until the progress crosses 0 against it. A death costs 1: the Crowd's own deaths in `stepCrowd`, Soldiers the Bubbles kill and a Player's own fallen Fighter in `stepBattle` (`chargeDeaths`). The drain runs each second. A Team routs when its Tickets are gone and its Soldiers have fallen below the threshold; at 54,000 Ticks the Team behind (fewer Tickets, then fewer Objectives, then the Crowd's generator) routs, so a Battle ends as it always did.
- **Respawning** (`stepSquads`): a Squad the brain finds empty respawns `respawnSeconds` later, while its Team has Tickets, into the lowest dead slots of its Team that no Fighter holds (`slot < 0`), at full HP, in column round the spawn its Order names (an owned spawn Objective with no enemy in its circle, else the Base), at its own place in the circle or a row across the Base so Squads do not stack. As many as `squad.size`, fewer if fewer slots are free.
- **The Commander** (`src/sim/commander.ts`): at deployment and every 2.5 s each Team plans from the start-of-Tick state. Value of an Objective by owner (nobody's, the enemy's, its own with or without a threat of enemy Soldiers within 30 m); each free Squad-and-Objective pair scored `value × falloff^sent − distance × path − danger × outnumbered + stick`, taken greedily best-first (lower Squad, lower Objective on a tie); an Order holds 15 s unless the Squad falls back or is wiped out; empty Squads respawn at the spawn with the lowest value-weighted path to the Objectives. Blind to Players. No reserve.
- **Squad brain**: instead of "attack the nearest enemy Squad", it follows its Order (march to its place in the circle by the field, stand there facing the enemy's end), turning to an enemy Soldier within `engage` as in Stage 1. A Squad awaiting Orders stands.
- **Debug view** (`#/editor/battle`): Objective rings (Owner) and poles (progress), a line from each Squad to its Order's place (attack red, defend green, respawn yellow, falling back pink), a pick-list that draws one destination field as arrows, Tickets, Objectives held and Orders in the panel.

**What changed from the plan**
- **Fall back still goes to the Base**, not to the nearest Objective the Team owns (Stage 1's behaviour kept; Open question 1 is 2b's).
- **No clearance stored.** On the heightfield it is unbounded; Stage 3b adds it with the Walls. The anchor walks straight at its place when the line is clear (always, today) and down the field when it is not: a destination field alone steers in the 8 octile directions, which bends a long march.
- **Respawn costs no Ticket** (a death already did) and needs only Tickets above 0, not enough for the whole Squad.
- **The Rout needs Tickets gone**, so a Team with Tickets left that is down to a handful of Soldiers goes on respawning; the HUD's threshold marker and the Lobby text ("An army breaks below 20%") are therefore wrong until 2b rewrites them.
- **The hold restarts only on a change of destination**, not when capturing turns attack into defend.
- **Fall back is not an Order kind** in the arrays: `fall` stays the morale flag and the debug view and `FALL` name it.
- Changed existing tests (the Battles last minutes now, not seconds): the small Battles in `battle.test.ts`, `takeover.test.ts` and `net/battle.test.ts` take half a Ticket a Soldier so a Team stops respawning early and the Battle still ends in a Rout; the odds test uses a 90 s limit; `crowdView`/`impostor` tests stop after 4,000/6,000 Ticks (and skip a respawned Soldier's pop-in); `battleRollback.test.ts` stops at 9,000 Ticks (2.5 min) and passes the map; the Stage 1 march test now checks the Squads with a long way to go.

**Measured** (this laptop, Node, seeds 1 to 30, 200 v 200, no Players):
- **Battles end by Tickets in 293 to 396 s (4.9 to 6.6 min), mean about 337 s**, every one in a Rout, none at the 15-minute limit; both Teams' Tickets reach 0 in 21 of 30. **Team 1 won 20 of 30** (p ≈ 0.1, not significant, and it did not move when the Commanders were made exactly mirror images, so it is not their symmetry; Stage 1 saw it the other way round; for 2b to watch). Ownership changes 9 to 17 a Battle. Each Battle respawns 528 to 600 Soldiers.
- **Order changes** (a living Squad with an attack or defend Order given a different Objective): **0.17 to 0.28 per Squad per minute** over seeds 1 to 30 (about 40 a Battle for 32 Squads); the test logs 0.34 for seed 3's first 3 minutes. No Squad ever switched inside its 15 s hold (asserted every Tick of that run). In seeds 1 to 6 every Objective was ordered to by at least one Team, and each Team sent Squads to all five in 3 of the 6 (the others never attacked the enemy Home).
- **Budget gate** (`battleRollback.test.ts`, four Players, seed 1, 9,000 Ticks, machine quiet): Crowd step with Squads, Objectives, Commander and respawns **0.30 ms mean (p99 1.63)**, the same with every Soldier a free agent 0.42; the Squad step alone 0.02 ms (0.046 ms in a micro-benchmark); a Commander plan 0.28 ms once every 150 Ticks; the Crowd step over a whole 200 v 200 war with no Fighters 0.21 ms mean (p99 1.2). **15-Tick Rollback on the march 21.8 ms mean** (inside 30); in the four-Bubble melee 60.6 ms mean (p99 120), 8.5 bound on average (Stage 1: 68 to 70; the plan's gate names the march). Whole Tick 3.7 ms mean (p99 11.3). A first Battle on a map builds its fields in a few ms (creating a Match, map included, 85 ms cold).
- Not measured: the frame rate, a two-browser online Battle (the loopback tests cover the resync and a two-Player Battle).

**Opus review** (high effort) found and these are fixed here: a Squad respawned at a Base on a big army (over 30 Squads a side) could have its anchor placed off the field and never move (the Base row is now clamped and mirrored); the destination grid was not symmetric (objectives on a cell edge fell in unmirrored cells, so Team 1 saw shorter paths: the grid is now odd and centred on the origin, and ties between Objectives go to each Team's mirrored one, so the two Commanders' deployment Orders are exact mirrors, asserted); Players and promoted Fighters now count in the threat score and in a spawn's safety, as the plan says; `danger` no longer counts a Team's own Soldiers twice; a Squad no longer merges into one that respawned the same Tick; falling back uses the map's Base; the resync refuses a Squad ordered to the other Team's Base; stray comments and a lone Latin-1 byte in `CONTEXT.md` fixed. Left as they are: `stepCrowd`'s default map (seed 1's) for tests, the magic numbers in `orderSpot`'s spread (1.5, 0.7), `battleMapOf` called each Tick (a cache lookup), and `PROTOCOL_VERSION` (mismatched Tuning Data already refuses).

**Tests**: `objectives.test.ts` adds 26 (the five Objectives and the hill; fields built once, distances, steering round a blocked line; capture rates, cap, Owner rules, a Player counting 3; Tickets per death, the drain, the Rout only at none, the limit and its tie-breaks; respawning into dead slots at the Base or a spawn Objective, not without Tickets, not into a held slot, fewer slots than a Squad; the Commander's Orders at deployment, the hold over a whole Battle with the change rate logged, empty and falling Squads; replay hash, snapshot, hash coverage, a Rollback across a capture and across a respawn, a JSON resync). `tuning/battle.test.ts` +1, `battleMessages.test.ts` +13 malformed edits. `npm run typecheck` passes.

## Stage 2b: presenting Objectives, and tuning
**Model**: Opus. Tuning is reading soaks and judging what looks right.
- HUD: Ticket bars in place of the strength bars, Objective markers (letter, Owner colour, capture ring), the minimap's Objectives and Squad arrows, the "your army is attacking B" line. Results screen: Tickets left and Objectives held.
- The Lobby's map picker (only Open field here).
- Tuning pass: k, Tickets, capture rates, Objective weights, the Commander's hold time, Squad morale. Settle Open questions 1 and 2.
- **Done**: AI-v-AI Battles end by Tickets in about 6 to 8 minutes over a soak of seeds; the Commander does not flip-flop (Order changes per Squad per minute under a bound the Result names); in a human playtest the Player changes who owns an Objective; an online Battle with two Players plays to its end with no Desync; the budget gate holds.

### Result
Done 2026-11-03, reviewed by Opus before the commit (below). The open field's Objective Battle is now shown to the player and tuned: Ticket bars, Objective markers in the world and on the minimap, "Your army is attacking B", Tickets and Objectives on the Results screen, a map row in the Lobby, and the two Open questions settled.

**Built**
- **HUD** (`src/play/battleHud.ts`): each army's bar is its **Tickets** (share of the start, "700 Tickets · 200 soldiers"; "no reinforcements" once at 0), with a thin strip of its **Soldiers** under it that carries the **Rout mark** (the 20% mark was on the strength bar, where it is wrong now: the Rout needs the Tickets gone as well, so it lives on the Soldiers strip and its tooltip says so). A line under the bars, from `armyPlan`: "Your army is attacking B" / "defending your Home and attacking B" / "regrouping", read from the Squads' Orders (the Objective most living Squads are sent to, then the next; it attacks what its Team does not own and defends what it does; flavour only). `ArmyStrength` gains `tickets` and `ticketShare`; `BattleResult` gains `tickets` and `held`, so the **Results screen** shows "Tickets left" and "Objectives held" and the Lobby's line shows the Ticket score.
- **Objective markers** (`src/render/objectiveMarks.ts`, `BattleScreen`): on the ground, following the terrain, a rim in the Owner's colour (grey for none), inside it a capture ring that fills toward the Team winning it (the arc is `|progress|`, in the leading Team's colour), and a pole with a flag in the Owner's colour and a letter sprite (a Home Objective reads H). Render only, read from `CrowdState.objectives` each frame.
- **Minimap** (`src/render/minimap.ts`): each Objective as a ring in the Owner's colour with a capture arc and its letter; every living Squad of an army still fighting as a small arrow at its anchor pointing the way it faces (falling back: pale); the Player's own army's Squads also draw a thin line to the Objective they are ordered to (red to attack, green to defend). The Soldiers' dots stay.
- **Lobby** (`src/play/lobbyView.ts`): a Map row in Battle options (`BATTLE_MAPS`, one choice, Open field, nothing to set or send until the Fort), and the Battle card's stale "An army breaks below 20%" text rewritten (Objectives, Tickets, no reinforcements, then the break).
- **Simulation changes** (the tuning and Open questions asked for them): the centre Objective's `hill` search runs **along the line across the armies only** (below); a broken Squad **rallies at the nearest spawn Objective its Team owns with no enemy on it, else its Base** (Open question 1, below). `CONTEXT.md`, ADR 0021 and this plan updated.

**The Team 1 bias was the hill, not the Commanders or the step order.** In 2a, B stood on "the highest ground within 15 m" of the middle in any direction, so a seed's hill could put it nearer one army. The Squad step and the Crowd's order are symmetric (the random draws are exchangeable, every read is of the start of the Tick, ties go to the mirrored Objective). With B fixed on the middle (no hill) 48 seeds gave Team 1 19 wins; with the hill as it was, 30 of 48. B's search now runs only along z = 0 (sideways), so both armies are always equally far from it; over 240 Battles after the change Team 1 won 123 (51%).

**Tuning** (a headless soak over seeds 1 to 96 and 1000 to 1143, 200 v 200, no Players; the harness was a throwaway test file, not committed). Changed: `tickets.perSoldier` 2 → **3.5** (700 a Team) and `tickets.drain` 0.3 → **0.6** a second per Objective more. Tried and left as they were: `commander.falloff` (at the same Tickets: 0.4 gives 449 s and a hottest fight of 28 a side; 0.6, 361 s; 0.7, 325 s; 0.8, 303 s, so concentration shortens the Battle and the Tickets set it back to length), capture `rate` (0.007, 0.01, 0.015: 13.5, 19 and 23.5 Owner changes a Battle, with the Battle's length and who wins barely moving), `squad.moraleThreshold` 0.4 (more falls and merges, no better), the 15 s hold (no Squad ever changed inside it), the Objective weights and the Commander's values. Why 3.5 and 0.6: deaths use most Tickets (the drain is about 227 of the 1,400 a Battle, a sixth), so Tickets over the death rate set the length; at `drain` 0.6 a Team holding two Objectives more than the enemy all the while takes 1.2 a second off it, and the Team that held more Objectives on average won 201 of the 222 Battles where one did.
- **Length, 240 Battles: mean 402 s (6.7 min), min 317, p10 362, median 404, p90 442, max 495.** Every one ended by Tickets in a Rout, none at the 15-minute limit (2a: 293 to 396 s, mean 337).
- **Owner changes 9 to 30 a Battle (mean 19).** **Order changes 0.23 per Squad per minute on average, 0.29 at most** over whole Battles (the bound named: under 0.5; the test asserts under 1 because the first minutes, when every Squad is first sent, run higher), no Squad changing inside its 15 s hold.
- **Winners**: Team 1 won 123 of 240; the Team holding more Objectives on average won 201 of 222 decisive Battles (91%); 146 of 240 ended with both Teams' Tickets at 0.

**Open question 1 (merging), settled**: a broken Squad falls back toward the **nearest spawn Objective its Team owns with no enemy in its circle** (its Home Objective on the open field; the same condition a respawn uses), else its Base, and merges there into the **nearest** Squad of its Team within `mergeRange` that has room, which may grow to `mergeMax` (16). Nearest, not "most short of Soldiers", because the nearest is the one standing beside it. With the Base as the rally point (2a), over 24 seeds a Battle had 106 falls, 56 merges and 290 Squad-seconds of remnants standing idle at the Base; with the Home as the rally point, 108 falls, 73 merges and 126 idle Squad-seconds, and over the 240 Battles 121 falls, 81 merges (about 2.6 Soldiers each) and 150 idle Squad-seconds (about 0.4 of a Squad idle at any moment). A remnant that finds nobody to join still waits there (its Squad is not empty, so it never respawns); that is about one Squad in 80, and left alone.

**Open question 2 (spreading thin), settled**: five Objectives at 16 Squads a side do not spread the armies thin. On average 2.3 Objectives have 6 or more Soldiers of each army within 25 m of them at once, the hottest has 36 a side (three Squads) and 26% of an army, and 93% of all living Soldiers are within 25 m of some Objective. The Objectives and weights stay; `commander.falloff` stays 0.6 (0.8 does not make the hottest fight bigger, only the Battle shorter; 0.4 makes it smaller).

**What changed from the plan**
- **Fall back goes to the Home (a spawn Objective), not "the nearest Objective its Team owns"**: the nearest owned Objective is often the one it was beaten at, so it is the nearest owned and uncontested *spawn*, which is also where Squads respawn.
- **The Rout mark moved to a strip of Soldiers under the Ticket bar**, since the bar is Tickets now.
- **A Home Objective's letter is H** (both read H on the map and the flag), spoken as "your Home" and "the enemy Home".
- **The Lobby's map picker is one choice** (Open field), disabled and sent nowhere: there is no map in the Lobby's settings to carry until Stage 3a.
- **Tickets are `perSoldier` 3.5 × `armySize`** (still derived), not the plan's "about 2 ×": 2 a Soldier gave Battles of 5.6 minutes.
- No human playtest and no two-browser online Battle were possible here (see below).

**Budget gate** (this laptop, Node, `battleRollback.test.ts`'s four-Player soak, 9,000 Ticks, machine quiet): Crowd step with Squads, Objectives, Commander and respawns **0.32 ms mean (p99 1.51)**, the same with no Squads 0.44; the Squad step alone 0.03 ms (p99 0.22). **15-Tick Rollback on the march 20.9 ms mean** (inside 30); in the four-Bubble melee 61.8 ms mean (p99 115; 2a: 60.6; the gate names the march). Whole Tick 3.7 ms mean (p99 10.6). `battleSoak.test.ts` (ten minutes of Battles on autopilot, every replay hash matching): Tick 2.23 ms mean, p99 6.34. The HUD and markers cost frames, not Ticks, and are not in these numbers.

**Checked in `npm run dev`** (the built-in browser): a 200 v 200 Battle shows the Ticket bars, the plan line, the Objective rings, flags and letters in the world, and the Objectives and Squads on the minimap; a 10 v 10 Battle starts and plays; the Results screen, rendered with a made-up result, shows Tickets left and Objectives held. **Not done**: a human playtest of a Player taking an Objective (the capture rules count a Player as 3 and the tests drive that; nobody played it), and a two-browser online Battle (the loopback tests, `net/battle.test.ts`, play a whole two-Player Battle with no Desync, and the Squads, Objectives and Tickets are in the hash).

**Tests**: `battleHud.test.ts` +3 (the army line, the markers' colours and arcs, the letters; the Ticket and Results tests updated), `squad.test.ts` +1 (rally at the Home, at the Base when the Home is lost), `objectives.test.ts` +1 (a whole 200 v 200 Battle ends by Tickets in 5 to 9 minutes, on two seeds; the hill test now checks the line across the armies; the Order-change bound 4 → 1); `tuning/battle.test.ts` and `objectives.test.ts` take 700 Tickets.

**Review** (`/code-review` at high effort, six findings, none a bug in the Simulation's state): fixed the rally variables still named `base` and `toBase`, the Lobby card's fractional Tickets ("87.5" at 25 a side), and the HUD's "1 Tickets". Left: a remnant's rally point is re-chosen every brain step, so it could turn between the Home and the Base if an enemy keeps stepping in and out of the Home's circle (not seen in the soak; a hysteresis is cheap if it shows); no test of the minimap's canvas drawing (only its pure helpers are tested).

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
1. **Merging Squads.** Which Squad a broken remnant joins (the nearest at its rally point, or the one most short of Soldiers), and whether a merged Squad may grow past `squad.size`. Stage 1 picked: a remnant falls back to its Base and merges there into the nearest Squad with room, which may grow to `mergeMax` (see Stage 1's Result); 2b settles it from what looks right.
2. **Spreading thin.** Whether five Objectives at 16 Squads a side spread the armies too thin to look like a battle. Stage 2b's tuning may move the weights or the Objectives closer.
3. **The Fort's cost.** Whether a 200 m map with walls and a keep fits the budget gate at 200 v 200, or needs about 120 v 120. Stage 0 guesses, Stage 3a measures, 4b measures again.
