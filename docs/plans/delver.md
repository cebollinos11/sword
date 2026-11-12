# Delver: the Run as one continuous dungeon per Floor

> Status: scope agreed (2026-11-12), the open questions answered by the user; nothing built. Stage 0 is next. Builds on the Dungeon (`docs/plans/dungeon.md`, Stages 1 to 4 done), the Big Battle's Crowd, Squads and Bubble (`docs/plans/big-battle.md`, `docs/plans/battle-objectives.md`, ADRs 0020 to 0022) and the Map Editor's Map Source and Enclosure Brush (`docs/plans/map-editor.md`, ADR 0023). Each Stage ends with a `### Result`, as in the other plans.

## Progress
- [ ] Stage 0: spike and ADR (one continuous Arena per Floor; budgets measured)
- [ ] Stage 1: the Floor generator (rooms and passages on one level → Map Source → compiled Arena)
- [ ] Stage 2: the Delver Run loop, solo (entrance, Stairs, Rest fires, revive, no enemies)
- [ ] Stage 3: Warbands (Crowd Squads that guard, patrol, chase and return; enemy-only Bubble)
- [ ] Stage 4: loot, Treasure Halls and Boss Floors
- [ ] Stage 5: presentation (fog-of-war minimap and Floor Map, Stairs and fires, HUD)
- [ ] Stage 6: verticality (balconies, stairwells, bridges over passages)
- [ ] Stage 7: online co-op (up to four Players, Input Delay, soak)
- [ ] Stage 8: retire the Hall graph and Doors; `CONTEXT.md` and ADRs brought up to date

## Context
A Run today is a walk through a Floor graph of Halls. Each Hall is its own small Generated Arena (7 × 7 cells) holding one Duel against one Encounter of at most four enemies. Doors chosen by walking lead to the next Hall (ADR 0019). It plays well, but it feels like a string of separate duels with a fade between them.

We want a dungeon crawler. Each Floor is one continuous, generated dungeon of rooms and passages, with squads of enemies living in it, loot, Rest places and Stairs down somewhere in it. The party explores, fights the squads it runs into (or sneaks past them) and finds the Stairs. Then it does the same again, deeper.

Since the Dungeon plan, three things exist that make this possible:
- **The Enclosure Brush and the Map Compiler.** A room with Walls, doorways and a roof is one Brush. A pure, deterministic compiler (`compileMap`) turns a Map Source into ordinary `ArenaGeometry`, checked by the game's own `parseBattleMap` and `walkCheck`, with a generated look (`mapModel`) that needs no Blender.
- **The Crowd, Squads and Bubble.** Hundreds of cheap Soldiers live in `SimState.crowd`. Near a Player they are promoted into a fixed Fighter Pool (16 slots) and fight as full Fighters. This removes the four-slot Team 1 limit that ruled out a continuous dungeon in `dungeon.md`.
- **Battle maps of several levels.** The walk rule, per-level destination fields and Promotion across floors (ADR 0022).

## Decisions (agreed in the brainstorm)
- **It replaces the Gauntlet's Hall graph and keeps the Run's meta.** It is still the Gauntlet Format and still a Run: Team 0 has 1 to 4 Fighters (Players and AI allies), HP carries over, Relics, the Inventory, per-Player loot, AI Takeover, the Run seed from the Random Map, a results screen, and no Rematch. What changes is the inside of a Floor. It stops being a graph of Halls and becomes one continuous Arena. The Hall/Door graph code is retired in Stage 8, as the Dungeon retired the v1 Run.
  - **This reverses `dungeon.md`'s first Decision** ("Rooms are separate Arenas joined by doors, not one continuous Arena"). The things it named as blockers are now answered: the four-slot Team 1 by the Crowd and Bubble; the 7 × 7 footprint by the Map Compiler; the jump Link budget by building the navmesh without Jump Links, as Battle maps do (ADR 0022); and one navmesh for the whole map by the Battle maps' own. Stage 0 writes this up as ADR 0028.
- **Floors are generated procedurally: rooms and passages as Enclosures, written as a Map Source and compiled.** A pure, seeded Floor generator lays out rooms and passages, writes a Map Source, and `compileMap` builds the Arena. Every peer builds it from the Run seed and the Floor number alone (as `floorGraph` and Generated Arenas are built today), so nothing new crosses the wire. The judge rerolls a Floor that fails `walkCheck` or the Delver checks (below), as ADR 0014's judge does.
  - A generated Floor can be opened in the Map Editor (a dev button, "open Floor N of seed S"), so a bad layout can be looked at, and copied out as a source for a hand-made Floor.
- **Enemies are Warbands: Crowd Squads with a dungeon brain, promoted by the Bubble.** A Floor holds many small Squads (3 to 8 Soldiers each, maybe 40 to 150 enemies on a Floor). They live as Soldiers in the Crowd. Within `bubble.promote` of a Player they are promoted into the Fighter Pool and fight as full Fighters with their Troop's Weapon and their Encounter's difficulty and Style.
  - **Only enemies are Soldiers.** Team 0 is the party, all full Fighters for good (Players and AI allies, slots 0 to 3). There are no allied Soldiers, so the Bubble's ally slots stay empty and every other Pool slot is an Attack Slot for an enemy.
  - **A Soldier never hurts a full Fighter** (as in a Battle). An unpromoted enemy holds outside sword reach or waits on the ring, so every blow the party takes comes from a full Fighter's Blade Sweep. This keeps the duelling honest.
- **What a Warband does, by its brain (2 Hz, as a Squad's):**
  - **Guard**: holds a room (its post), facing its doorways. This is the default.
  - **Patrol**: walks a loop of waypoints through passages and rooms, so fights also happen in the open and the Floor feels alive.
  - **Chase**: once it sees a Player (line of sight on its level, within `delver.sight`), its anchor follows that Player by a destination field toward them.
  - **Return**: past `delver.leash` from its post or patrol loop, or with no Player seen for `delver.forgetSeconds`, it walks back and takes up its post again. A Warband down to its morale threshold falls back toward its post (the Squad's existing fall-back).
  - No "call for help" between Warbands to begin with (Later).
- **The Stairs are the way down, and they only need to be found.** The Stairs are a zone at the far end of the Floor from the entrance (furthest by walking). When every living Player's Fighter that counts has stood in it for `dungeon.doorSeconds`, the party goes down after a fade. This is the Door rule unchanged (ADR 0019), applied to one zone. There is no key and no kill quota, so a party may skip fights and pay for it later, under-geared.
- **Party size makes Warbands bigger, not tougher.** Each human after the first adds `delver.perPlayerSoldiers` to every Warband (rounded per Warband by a pure pick, so every peer agrees). Enemy max HP does not scale with the humans (no `perPlayerHp` in a Delver Run). As today, the count is the humans the Run started with, so an AI Takeover never changes a Floor.
- **Rest places are fires in Rest Halls, 1 or 2 a Floor:**
  - **Heal once**: each Player's Fighter that stands at a fire heals `dungeon.restHeal` of its max HP, once per fire.
  - **Revive, once a fire**: the first time a living Player reaches a fire, it brings back every Player fallen at that moment, at the fire, at `dungeon.revive` of max HP. Then that fire's revive is spent (its heal is still there for those who have not taken it). A fallen Player watches with the orbit camera until a fire or the Stairs revives them. Taking the Stairs revives everyone too. A wipe ends the Run (a Defeat). A fallen Fighter keeps its Inventory.
  - **The Inventory changes only at a fire** (within its radius). This stands in for "the Hall is Cleared", since a Floor is never wholly cleared. Picking an item up is allowed anywhere there is room for it.
  - A fire is not a safe zone: Warbands may follow a party into a Rest Hall.
- **A wiped Warband stays dead for its Floor.** No respawns; a Warband that fell back and still has Soldiers comes back to its post at whatever strength it has.
- **Loot comes from Warband drops and Treasure Halls.** A wiped Warband drops one item per Player where its last Soldier fell (a pure pick of Run seed, Floor, Warband and Player, weighted by `loot.weights`, more for an elite Warband). A Treasure Hall (about one a Floor, off the path to the Stairs) holds `loot.pedestals` (pick 1 of 3), as a Treasure Hall does now. There are no chests, consumables or Gold yet (Later).
- **Fixed depth: three tiers of three Floors, a Boss at the end of each tier** (Tuning Data, `delver.tiers`, `delver.floorsPerTier`). Each tier's third Floor is a Boss Floor: its Stairs stand in the Boss Hall behind a gate that opens when the Boss Warband is wiped. There is a full heal after each Boss, and beating the third Boss wins the Run. That is about 30 to 45 minutes a Run.
- **A Boss is a Warband like any other, promoted by the Bubble.** Its Encounter names the Boss (a Troop with its own Weapon, Body, Size, difficulty, Style, Relics and HP scale) and its guard. Two rules keep it a boss fight: the Boss Soldier always takes the first free Attack Slot in its Bubble (ahead of nearer guards), and it never demotes while a Player is in the Boss Hall.
- **Exploration is fog of war, shared by the party.** A Hall or passage is revealed on the minimap and the Floor Map (`M`) once any present Player's Fighter enters it or sees into it. Revealed parts stay revealed for the Floor. The Stairs, fires and Treasure Halls show once revealed. This reverses `dungeon.md`'s "the whole Floor map is shown", which made sense for a route graph but not for a dungeon you explore.
  - **The fog is on the maps only.** The 3D view draws the whole Floor as it is; nothing in the world is dimmed or hidden.
  - **What has been revealed is a bitset in `RunState`** (one bit per Hall and passage, hashed and snapshotted), not render-side memory. It costs a few bytes, keeps every peer's map the same, and survives a resync. Revealing never changes an outcome.
- **The Run seed stays the Random Map's**, as today: the Lobby, its online sync and the results screen already carry it, so a Delver Run needs no new Lobby setting. The Map's name gives the seed (`runSeed`); its arena is never used, since each Floor is generated.
- **Floors are large and have several levels.** Each Floor has 20 or more rooms, with balconies over halls, stairwells (Ramps) between heights and bridges over passages, using the multi-level walk rule. It takes 5 to 10 minutes. It is built one level first (Stage 1) and grown into levels in Stage 6, so the Run loop and Warbands are proven on flat Floors before verticality adds its own bugs.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Floor** (changes meaning again): one continuous generated dungeon of a Run, from its entrance to its Stairs. It is one Arena, one Duel and one Crowd. _Avoid_: level, act, stage, map.
- **Hall** (changes meaning): one room of a Floor, an Enclosure the generator placed, with a kind: Fight (a post for a Warband), Rest (a fire), Treasure (pedestals), Stairs, Boss, Entrance, or Empty. _Avoid_: room (the online connection), chamber, cell.
- **Passage**: a corridor between Halls (an Enclosure with two opposite doorways, or several in a line). _Avoid_: corridor (in code), hallway.
- **Warband**: one Squad of a Floor's enemies, with its post or patrol, its Encounter and its brain's state (Guard, Patrol, Chase, Return). A Battle's Squad with a dungeon brain. _Avoid_: wave, mob, group, pack.
- **Encounter** (grows): a hand-written Warband template: its Soldiers' Troops (Weapon, Body, difficulty, Style), how many there are, its HP scale and its brain (Guard or Patrol). Each tier has pools of them per Hall kind, and its own Boss Encounter. `minTeam` goes: party size adds Soldiers instead.
- **Stairs**: a zone in the Stairs Hall. Every counted Player standing in it takes the party to the next Floor. _Avoid_: exit, portal, door.
- **Reveal**: the shared fog of war of a Floor: the Halls and Passages any Player has entered or seen into. _Avoid_: explored, discovered.
- **Leash**: how far a chasing Warband follows from its post before it returns.
- **Door**, **Floor graph**: retired in Stage 8.

## How it fits the existing code
- **A Floor's Duel is a Battle-shaped Duel inside a Run.** `SimState.crowd` holds the Warbands' Soldiers. `fighters` is the Fighter Pool, with the party in slots 0 to 3 for good and the rest bound by the Bubble. `stepMatch`'s Gauntlet branch keeps `RunState` and steps the Crowd and Bubbles as the Battle branch does. What a Battle has and a Floor does not: Objectives, Commanders, Tickets, respawning Squads, Troop choice and takeover of Soldiers. Split them behind the Format instead of copying the Battle branch.
- **`RunState`** becomes `{ floor, phase, stairsTicks, restUsed, revealed, startTick, ... }`. `row`, `hall`, `path` and `doorTicks` go (in Stage 8). `phase` is `Exploring` or `Descending` (the fade).
- **Floor generator** (`src/sim/delverGen.ts`, pure, Opus): seed → Hall layout → Map Source, then `compileMap` → Arena. The current Map Source is a Battle map's (Objectives, Bases, `front`). It needs a Delver variant, or a section of markers: entrance spawns, Stairs zone, fires, Treasure pedestals, Warband posts and patrol loops. `compileMap` takes `BattleTuning` fields today, so check what it really needs.
- **Destination fields**: a Battle builds one per Objective. A Floor needs one per post and patrol waypoint (static, built with the Floor) plus one toward each chased Player, rebuilt when that Player changes cell. These are caches derived from state, never stored. Measure their cost in Stage 0.
- **Squad brain**: `stepSquads` follows a Commander's Order. A Floor's Squads follow their Warband brain instead. Keep Formation, narrowing, morale and the walk rule; replace the Order.
- **Bubble**: enemy-only, as above. `battle.bubble.promote` and `demote` and the Attack Slots apply. Line of sight should gate Promotion through a Wall on one level, as height gates it through a floor (check `inSight`).
- **Rest fires, pickups, Inventory**: `restFire` and `atRestFire` (`src/sim/hall.ts`), `pickups.ts` and `inventory.ts` carry over. The Inventory's "Cleared" gate becomes "within a fire's radius".
- **AI allies** (`allyAi.ts`): follow the nearest Player, as after a Clear today, and fight what the Bubble promotes. They walk to the Stairs only once no Player lives.
- **Render**: the Floor's look comes from `mapModel`, as Map Editor maps do. Fog of war belongs on the minimap and the Floor Map, plus perhaps dimming unrevealed Halls in the world (open question 6).

## Stages
Run each Stage with `docs/plans/delver-prompt.md`: an Opus session designs the Stage (a `#### Design` section under it) and Sonnet subagents write the code. A Stage's **Model** line says how much design it needs from the orchestrator. Each Stage is one chat, solo and offline until Stage 7. Determinism tests run from Stage 1: same seed, same bytes; whole Floors hashed in slow tests.

### Stage 0: spike and ADR
**Model**: Opus.
- Hand-write a Map Source of about 20 Enclosure rooms and passages on one 150 m level. Measure `compileMap`, `walkCheck`, the navmesh build, and a destination field per post plus a moving one, on a slow machine profile. Budget: a Floor ready during the fade (`hallFadeSeconds`, or a longer loading banner if it must be).
- Measure the Tick: about 100 Soldiers in Warbands plus a 16-slot Pool, solo. It decides whether a Run must take a Battle's Input Delay online (ADR 0025).
- Write ADR 0028 ("A Floor is one continuous Arena with a Crowd"), superseding the relevant part of `dungeon.md`.
- **Done**: numbers in the Result and the ADR merged; a go or no-go on the large Floors.

#### Design
Stage 0 ships no game feature. It adds one Simulation helper that Stage 3 will need anyway (a destination field to any point), a hand-written spike Floor, and a slow test that measures it and prints the numbers for the Result. Nothing in `SimState`, the hash or the snapshot changes.

**The spike Floor** (`src/mapEditor/delverSpike.testdata.ts`, `delverSpikeSource(): MapSource` and `SPIKE_ROOMS`). It is a Battle map's Map Source, since that is what `compileMap` takes, laid out the way a Delver Floor would be:
- **Field**: `withBrushes(brushes, [-8, 0, 4], more)` from `sample.testdata.ts` (200 m field, grid step 0.5). The first Brush is a Hazard `abyss` (`kind: 'hazard'`, `hazard: 'abyss'`) over the whole field at y −8. `parseBattleMap` needs a floor reaching every side of the field, and `walkCheck` skips deadly ground, so the space between rooms is solid rock to the Simulation: an abyss nobody walks to. There is no `GROUND`.
- **Rooms**: 20 Enclosures at y 0 (roof at 4), ids `room0` to `room19`. Room k = j·5 + i for column i 0..4 and row j 0..3, centred at cx = −60 + 30i, cz = −45 + 30j. Their half-widths along x (`hw`) and half-depths along z (`hd`) in metres, by k:
  - `hw = [8,6,10,7,9, 7,9,6,10,8, 10,8,7,9,6, 6,10,9,8,7]`
  - `hd = [7,9,6,10,8, 10,6,8,7,9, 6,8,10,7,9, 9,7,6,10,8]`
  - rect `{ x0: cx − hw, z0: cz − hd, x1: cx + hw, z1: cz + hd }`. A room has a 3 m doorway (`doors`) on each side a Passage leaves from, and no other. `n` is +z, `e` is +x (as in `enclosure.test.ts`).
- **Passages**: 23 Enclosures 3 m wide at y 0, ids `pass0` to `pass22` in the order below. Each runs straight between two neighbouring rooms' facing sides, edge to edge with both. Its two ends are doorways as wide as the passage (3), so the end is open, and the room's own 3 m doorway lines up with it (both are centred on the room's side).
  - Horizontal, from room (i, j) to (i+1, j): rect `{ x0: cx_i + hw_a, x1: cx_{i+1} − hw_b, z0: cz_j − 1.5, z1: cz_j + 1.5 }`, doors `{ e: 3, w: 3 }`.
  - Vertical, from room (i, j) to (i, j+1): rect `{ z0: cz_j + hd_a, z1: cz_{j+1} − hd_b, x0: cx_i − 1.5, x1: cx_i + 1.5 }`, doors `{ n: 3, s: 3 }`.
  - The edges, in this order: the 16 horizontal ones, row by row (j 0..3, i 0..3), then the vertical ones (0,0)–(0,1), (4,1)–(4,2) and (0,2)–(0,3). Those 19 are a spanning tree (a serpentine). Then four loops: (2,0)–(2,1), (1,1)–(1,2), (2,2)–(2,3) and (3,2)–(3,3).
  - Brush order: the abyss, then rooms 0..19, then passages 0..22.
- **Markers**: Objectives at room centres (posts), all weight 1: `D` at room 0 (spawn, owner 0), `E` at room 19 (spawn, owner 1), and owner −1 at rooms 2, 4, 7, 9, 10, 12, 15 and 17 (ids `F` to `M`). That is 10 Objectives (`MAX_OBJECTIVES` is 12). Bases at (cx₀ − 3, cz₀) and (cx₁₉ + 3, cz₁₉). `front` 52, `armySize { standard: 50, max: 50 }`, `ticketsPerSoldier` 100 (no Rout by Tickets during the measurement), `name: 'delverspike'`.
- `SPIKE_ROOMS`: per room `{ id, cx, cz, rect }`, so the test can place things in rooms without reparsing.

**`distanceTo`** (`src/sim/destinations.ts`, pure, exported from `src/sim/index.ts` with the other field functions):
```ts
/** A destination field to one point (x, z) on Walk Surface s (-1: the cell's highest node), over the same cells (or nodes) as f:
 *  per cell (node) the path length (m) to it, or -1. Built fresh each call and never cached; equal, entry for entry, to the field
 *  `destinationFields` builds for an Objective standing at that point. */
export function distanceTo(f: DestinationFields, x: number, z: number, s = -1): Float64Array
```
- One level (`f.levels === null`): `fill(side, cell, blocked, cellAt(f, x, z))`, then `fillBlocked` when `f.blocks.length > 0`, exactly as `destinationFields` does for one place.
- Several levels: the same backward Dijkstra `layeredFields` runs per place, from `nodeAt(f, x, z, s)` (an all −1 field when that is −1). The backward joins (`into`) are built from `levels.next` once per `FieldLevels` and kept in a module `WeakMap<FieldLevels, …>`, as a cache derived from static data, never in the state. `layeredFields` uses the same helper for its own places, so the two can never drift.
- The cost to watch is one Dijkstra over the nodes. Stage 3 rebuilds one when a chased Player changes cell.

**The measurement** (`src/mapEditor/delverSpike.slow.test.ts`). Each timing is the median of 5 runs after one warm-up. The cached builds are defeated by a fresh copy each run: `{ ...battle, maps: { ...battle.maps, delverspike: map } }` for the Battlefield and fields, `{ ...tuning, battle }` for the navmesh. It prints one report to stderr, in the same style as `battleSoak.slow.test.ts`:
- **Build**: (1) `compileMap` (its parse and `walkCheck` included), (2) `walkCheck` alone on the compiled arena, (3) `battlefieldOf`, (4) `destinationFields` (10 Objectives and 2 Bases), (5) `distanceTo` once per room centre (20 posts, on the room floor's surface from `groundOf`), the total and per field, (6) 100 `distanceTo` calls at successive points 1 m apart along a walk from room 0 through `pass0` into room 1 and on (a moving field), mean and max, (7) `navMesh(field.arena, tuning)` with its polygon and link counts. It also prints the node count, the Walk Surface and Wall counts, and the total "Floor ready" time (1 + 3 + 4 + 5 + 7).
- **Doorways**: steps 3 to 5 again with `crowd.flowCell` 2 (the map is unchanged). At flowCell 4 and at 2, the test prints how many room-centre fields reach room 0's centre node (dist ≥ 0). That tells Stage 1 whether 3 m doorways need a finer field.
- **Ticks**: three scenarios of 6,000 Ticks (100 s) each. Each is one Battle (`createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0], arena })` with `applyBattleKnobs` at armySize 50, so 100 Soldiers). The Player is on `createBattlePilot(tuning, 'Hard')` and every other Pool slot on `poolControllers`. Timing is as in the soak (controllers' intents plus `stepMatch`):
  - **T0 open field**: `battle:1` at armySize 50, default slots. The baseline.
  - **T1 Floor, Run-sized Bubble**: `battle:delverspike`, default slots (4 enemies, 3 allies).
  - **T2 Floor, full Pool**: as T1 with `slots.enemies` 12 and `allies` 3 (15 bound at most).
  - On the Floor, after `createMatch` and before the first Tick, the armies are moved into rooms (`relocate`, a pure function in the test file). Team 0's four Squads go to rooms 1, 5, 6 and 2, and Team 1's to 13, 14, 18 and 19, in Squad order. Each anchor goes to its room's centre, heading 0 for Team 0 and π for Team 1, with `aim` the same and `speed` 0. Soldier p of a Squad goes to anchor + (((p mod 4) − 1.5)·1.5, (⌊p / 4⌋ − (rows − 1)/2)·1.5), where rows = ⌈n / 4⌉, with velocity 0 and the Squad's heading. Every `surface` (Soldier and anchor) comes from `groundOf(battle, field, x, z)` (the floor, never the roof). The Player's Fighter goes to room 0's centre (`position`, `y` 0, and its Walk Surface field if `FighterState` has one, from `groundOf`). Nothing else changes, and the Commander re-plans from there.
  - Per scenario it prints the mean, p50, p99 and max Tick (ms), the Ticks over 8 ms and over a frame, the most slots bound at once, and the mean Tick by bound slots (0–3, 4–7, 8–11, 12–15).
  - Then T1's Intents are replayed through `stepMatch` from a fresh `createMatch` and the same `relocate`, and the final `hashValue` must match.
- **Asserted** (structure, not time): the source parses and compiles twice to the same `mapFileText`; `walkCheck` is null; 20 rooms and 23 passages; `distanceTo` gives equal arrays on two calls; the T1 replay hash matches; every scenario ran 6,000 Ticks. Only one loose time bound: "Floor ready" under 10 s, so a regression to minutes fails.
- **The machine**: the container is not the MSI laptop in `big-battle.md`'s Stage 0. The orchestrator runs `battleSoak.slow.test.ts` alone on the same machine (1.78 ms mean on the laptop) for the ratio, and scales by it and by the laptop's 1.3× margin to a mid-range laptop.

**Go or no-go** (decided in the Result, from laptop-equivalent numbers):
- **Floor ready**: within `dungeon.hallFadeSeconds` (1 s) is a go as planned. Within 3 s is a go with a loading banner, and the next Floor built during play (as `warmArena` does). Over 3 s is a no-go for 20-room Floors until the slow part is made cheaper.
- **Tick**: T2's mean must be within the 8 ms Tick budget (`battleSoak`) and its p99 within 25 ms, or 20-room Floors with Warbands are a no-go. Whether online Runs take an Input Delay follows from how T1 and T2 compare with a Battle's Tick, which needed one (about 2 ms with a dozen bound, ADR 0025).
- **Doorways**: if room-centre fields do not all reach room 0 at flowCell 4, Stage 1 must use a finer field for Floors (or wider doorways), and the cost at flowCell 2 is the one that counts.

### Stage 1: the Floor generator
**Model**: Opus (layout and geometry).
- `delverGen`: rooms of a few sizes placed on the grid (BSP or a seeded graph of rooms), joined by passages into a spanning tree with a few loops. Kinds assigned: Entrance, Stairs (furthest by walking), Rest (1 or 2, with one about halfway), Treasure (off the main path), Fight posts, Empty. Patrol loops are drawn along cycles. The output is a Map Source with Delver markers.
- Judge: `walkCheck`; every Hall reached from the entrance; Stairs and fires reached; no marker on a hazard; posts not within sight of the entrance spawns. Reroll by a salted seed until it passes.
- A dev route or Map Editor button opens a generated Floor. Golden-seed tests (bytes stable) and a soak over 500 seeds (all pass the judge within N rerolls).
- **Done**: any seed gives a valid, varied Floor, viewable in the editor.

### Stage 2: the Run loop, solo
**Model**: Sonnet.
- The Gauntlet Format starts a Delver Run on Floor 1 of the generated Dungeon. Team 0 spawns at the entrance. The Stairs zone takes the party down (fade, next Floor). Rest fires heal once per Player per fire and revive the fallen. Inventory changes only at a fire. A wipe is a Defeat. Taking the last Stairs is a Victory for now, with Bosses in Stage 4.
- No enemies yet: the loop, the fade, HP carry-over and revive are tested on empty Floors.
- **Done**: a solo Run walks three empty Floors to Victory; `dungeonRun` style tests are rewritten for Floors.

### Stage 3: Warbands
**Model**: Opus (brains and fields).
- Encounters become Warband templates (`data/dungeon.json`). The generator's posts and loops are filled by a seeded pick per tier. The Crowd is deployed at the posts.
- Warband brain: Guard, Patrol, Chase, Return, morale fall-back. Destination fields go to posts and waypoints, and toward chased Players.
- Enemy-only Bubble: Promotion and Demotion and Attack Slots; nobody is promoted through a Wall or floor; and an unpromoted Soldier never hurts a Fighter (existing rule).
- Warband size grows with the humans (`delver.perPlayerSoldiers`); enemy max HP is scaled by tier only.
- **Done**: a solo Run is playable end to end against Warbands; a slow soak of AI-driven Runs shows no stuck Warbands (time out of place measured, as in battle-objectives Stage 3b).

### Stage 4: loot, Treasure Halls and Boss Floors
**Model**: Sonnet.
- A wiped Warband drops one item per Player where its last Soldier fell. Treasure Halls hold pedestals (pick 1 of 3). Elite Warbands carry Relics and drop them.
- Boss Floors: the Boss Hall with the Stairs behind its gate; the Boss Warband, its Boss Soldier first into an Attack Slot and never demoted while a Player is in the Hall; the gate opens when it is wiped; a full heal after the Boss.
- **Done**: a full three-tier Run with bosses; loot tests per Player are deterministic.

### Stage 5: presentation
**Model**: Sonnet.
- The Reveal bitset (Simulation) and the fog-of-war minimap and Floor Map (`M`): Halls, Passages, the party, fires, Treasure, Stairs once revealed.
- Stairs, fire and pedestal art (stand-ins until #62 lands); a "descending" banner; a HUD line for the Floor and tier; the results screen lists Floors reached, Warbands beaten and the Build.
- **Done**: playtest-ready solo.

### Stage 6: verticality
**Model**: Opus.
- The generator grows levels: a hall with a balcony (a Deck round its walls, a Ramp up), stairwells between a lower and an upper set of Halls, and a bridge over a Passage. Hall heights are a whole number of levels (Enclosure roofs at the next level).
- Warbands on several levels by the walk rule. Patrols cross levels; Chase fields have a node per level.
- **Done**: large multi-level Floors pass the judge and the soak.

### Stage 7: online co-op
**Model**: Opus.
- Up to four Players in a Rollback session. Input Delay as a Battle's if Stage 0 says so. AI Takeover marks a Player away (no Stairs count, no fire, no pickups; Warband sizes unchanged). Loopback tests and a four-Player soak. `PROTOCOL_VERSION` + 1 if the Intent or session messages change.
- **Done**: an online four-Player Run to Victory with no desync in the soak.

### Stage 8: retire the Hall graph
**Model**: Sonnet.
- Remove `floorGraph`, Doors, Hall rows, the `:d` Arena names in Runs, and their tests. Update `CONTEXT.md` (Floor, Hall, Door, Run, Inventory, Floor Map) and mark the superseded parts of ADR 0019 and `dungeon.md`.

## Risks
- **Tick cost.** A Run today is a cheap 8-Fighter Duel with no Input Delay. A Crowd plus a 16-slot Pool may force a Battle's 3-Tick Input Delay online. That is fine for PvE, but measure it first (Stage 0).
- **Generation time on every peer.** Compile, judge, navmesh and fields must fit in a fade, with rerolls. Seeds that need many rerolls are a hitch. Precompute the next Floor during play (as `warmArena` does).
- **Promotion through Walls.** The Bubble goes by ground distance. In a dungeon a Warband in the next room, 8 m away through a Wall, would be promoted and wait on the ring. Promotion and the ring need line of sight, or a walking distance.
- **Squads in passages.** Formations already narrow through gates, but 3 m doorways and long passages are tighter than any Battle map. Expect tuning (`squad.narrow`) and a "loose" Formation for Warbands.
- **AI navmesh without Jump Links.** Promoted enemies and AI allies never jump on such maps (ADR 0022). That is fine, but generated Floors must never need a jump.

## Answered questions (2026-11-12)
1. A Boss is a promoted Warband, not full Fighters from the start; its Stairs are gated in the Boss Hall.
2. More Players make Warbands bigger; no HP bonus.
3. A fire revives once, bringing back everyone fallen at that moment.
4. Wiped Warbands stay dead for the Floor.
5. Three tiers of three Floors.
6. Fog of war on the maps only.
7. The Run seed stays the Random Map's.
