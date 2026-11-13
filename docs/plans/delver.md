# Delver: the Run as one continuous dungeon per Floor

> Status: scope agreed (2026-11-12), the open questions answered by the user. Stage 0 done (2026-11-12): a go on large Floors (ADR 0028). Stage 1 done (2026-11-12): the Floor generator, judged over 500 seeds and viewable in the Map Editor. Stage 2 done (2026-11-13): a solo Delver Run on empty Floors, behind `?dev=1&delver=1`. Stage 3 is next. Builds on the Dungeon (`docs/plans/dungeon.md`, Stages 1 to 4 done), the Big Battle's Crowd, Squads and Bubble (`docs/plans/big-battle.md`, `docs/plans/battle-objectives.md`, ADRs 0020 to 0022) and the Map Editor's Map Source and Enclosure Brush (`docs/plans/map-editor.md`, ADR 0023). Each Stage ends with a `### Result`, as in the other plans.

## Progress
- [x] Stage 0: spike and ADR (one continuous Arena per Floor; budgets measured)
- [x] Stage 1: the Floor generator (rooms and passages on one level → Map Source → compiled Arena)
- [x] Stage 2: the Delver Run loop, solo (entrance, Stairs, Rest fires, revive, no enemies)
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
  - On the Floor, after `createMatch` and before the first Tick, the armies are moved into rooms (`relocate`, a pure function in the test file). Team 1's four Squads (the enemies) go to rooms 1, 2, 5 and 6, around the Player, and Team 0's to 13, 14, 18 and 19, in Squad order. (A first run put Team 1 far away: the Battle pilot stuck on room 0's wall by a doorway and no Soldier was ever promoted, so the Bubble went unmeasured. Starting the Player among the Warbands makes every scenario fight.) Each anchor goes to its room's centre, heading 0 for Team 0 and π for Team 1, with `aim` the same and `speed` 0. Soldier p of a Squad goes to anchor + (((p mod 4) − 1.5)·1.5, (⌊p / 4⌋ − (rows − 1)/2)·1.5), where rows = ⌈n / 4⌉, with velocity 0 and the Squad's heading. Every `surface` (Soldier and anchor) comes from `groundOf(battle, field, x, z)` (the floor, never the roof). The Player's Fighter goes to (cx₁, cz₁ − 5), 5 m south of room 1's centre, so Team 1's first Squad is within `bubble.promote` of it (`position`, `y` 0, and its Walk Surface field if `FighterState` has one, from `groundOf`). Nothing else changes, and the Commander re-plans from there.
  - Per scenario it prints the mean, p50, p99 and max Tick (ms), the Ticks over 8 ms and over a frame, the most slots bound at once, and the mean Tick by bound slots (0–3, 4–7, 8–11, 12–15).
  - Then T1's Intents are replayed through `stepMatch` from a fresh `createMatch` and the same `relocate`, and the final `hashValue` must match.
- **Asserted** (structure, not time): the source parses and compiles twice to the same `mapFileText`; `walkCheck` is null; 20 rooms and 23 passages; `distanceTo` gives equal arrays on two calls; the T1 replay hash matches; every scenario ran 6,000 Ticks. Only one loose time bound: "Floor ready" under 10 s, so a regression to minutes fails.
- **The machine**: the container is not the MSI laptop in `big-battle.md`'s Stage 0. The orchestrator runs `battleSoak.slow.test.ts` alone on the same machine (1.78 ms mean on the laptop) for the ratio, and scales by it and by the laptop's 1.3× margin to a mid-range laptop.

**Go or no-go** (decided in the Result, from laptop-equivalent numbers):
- **Floor ready**: within `dungeon.hallFadeSeconds` (1 s) is a go as planned. Within 3 s is a go with a loading banner, and the next Floor built during play (as `warmArena` does). Over 3 s is a no-go for 20-room Floors until the slow part is made cheaper.
- **Tick**: T2's mean must be within the 8 ms Tick budget (`battleSoak`) and its p99 within 25 ms, or 20-room Floors with Warbands are a no-go. Whether online Runs take an Input Delay follows from how T1 and T2 compare with a Battle's Tick, which needed one (about 2 ms with a dozen bound, ADR 0025).
- **Doorways**: if room-centre fields do not all reach room 0 at flowCell 4, Stage 1 must use a finer field for Floors (or wider doorways), and the cost at flowCell 2 is the one that counts.

### Result
Done 2026-11-12. **Go** on 20-room Floors with Warbands, and ADR 0028 is written. Online Runs should take an Input Delay (Stage 7). Stage 1 must make every Passage visible to the destination fields.

**What was built** (no game feature):
- **`distanceTo`** (`src/sim/destinations.ts`): a destination field to any point. It is equal, entry for entry, to the field `destinationFields` builds for an Objective standing there. Both now build their fields through one shared helper per kind of map: `backward` for maps of several levels, whose backward joins are cached per `FieldLevels`, and `levelField` for one-level maps. So the two cannot drift, and the existing fields are bit-identical (every existing test and hash unchanged). On an Enclosure map the caller passes the floor's Walk Surface, since −1 means the roof.
- **The spike Floor** (`src/mapEditor/delverSpike.testdata.ts`), exactly as the Design describes. It is 87 Walk Surfaces (a floor and a roof for each of 43 Enclosures, plus the abyss) and 222 Walls, and it is `layered` because of the roofs.
- **Its measurements** (`src/mapEditor/delverSpike.slow.test.ts`, 6 slow tests, about 15 s alone).

**Changed from the Design:**
- **The armies' placement.** The first run put Team 1 far from the Player. The Battle autopilot then stuck on room 0's wall 6.5 m from its doorway, and in 6,000 Ticks no Soldier was promoted, so T1 and T2 measured no Bubble. The Design now starts Team 1 in rooms 1, 2, 5 and 6 and the Player 5 m from room 1's centre.
- **The doorway check.** The Design's check (does every room's field reach room 0) cannot see a cut passage, since the spanning tree joins everything anyway. The code review caught this. The check now counts the Passages a field follows: room a's field read at room b's exact centre node must be within 1.5 × the 30 m between their centres.
- **Smaller review fixes:** `walkCheck` is timed cold, `relocate` also moves the Player's `blade` and `kickLeg`, there is no double build, and a warning is printed if a Battle ends early (none did).

**Measured**: the test container, 4 cores, run alone. Timings are medians of 5, ms. This machine runs `battleSoak.slow.test.ts` at **0.79 ms a Tick** (p99 2.85 ms), against 1.78 ms on `big-battle.md`'s Stage 0 laptop. Taking it as 2.25× faster than that laptop, plus the laptop's 1.3× margin to a mid-range one, the **laptop-equivalent figures are ×3**. The code has changed since that laptop run, so the ratio is approximate, and it is meant to err slow.

| Build (flowCell 4) | here | ×3 |
|---|---|---|
| `compileMap` (parse and walk check) | 26 to 34 | ~90 |
| `walkCheck` alone, cold | 5 to 6 | ~18 |
| `battlefieldOf` | 13 to 22 | ~45 |
| `destinationFields` (12 fields, 3,429 nodes) | 49 to 80 | ~180 |
| `distanceTo` × 20 posts | 1.1 to 1.4 (0.06 each) | ~4 |
| moving `distanceTo` × 100 | 0.05 mean, max 0.5 to 2.7 | ~0.15 |
| `navMesh` (87 polygons, 184 links) | 21 to 28 | ~75 |
| **Floor ready** | **110 to 153** | **~0.33 to 0.46 s** |

- **Doorways.** At flowCell 4, 20 of 20 rooms reach room 0, but only **21 of 23 Passages are followed**. pass20 (room 6 to 11) and pass22 (room 13 to 18) are vertical Passages at x = ±30, and no 4 m cell centre falls inside them, so the field goes round by 209 m and 87 m. At **flowCell 2 all 23 are followed**: 13,531 nodes, `destinationFields` 172 to 210 ms, 0.29 to 0.42 ms a `distanceTo`. The whole Floor is then about 240 ms here, about **0.7 s laptop-equivalent**. Either way it fits the 1 s fade (`dungeon.hallFadeSeconds`).
- **Ticks** (6,000 each, seed 1, 100 Soldiers, the Player on a Hard autopilot, ms):

| Scenario | mean | p99 | max | most bound | mean at 12–15 bound |
|---|---|---|---|---|---|
| T0 open field, default slots | 0.69 to 0.94 | 2.3 to 3.5 | 10 to 22 | 12 | 0.89 to 1.12 (83 Ticks) |
| T1 Floor, default slots | 0.28 to 0.38 | 1.3 to 1.9 | 12 to 15 | 4 | (at 4–7: 0.59 to 0.79, 1,713 Ticks) |
| T2 Floor, full Pool (12 + 3) | 0.31 to 0.41 | 1.7 to 2.7 | 10 to 12 | 12 | 0.92 to 1.24 (1,300 Ticks) |

  At most 1 Tick per scenario was over 8 ms and none was over a frame. The T1 replay hashes match. On the Floor the Player fell once and 43 of Team 1's 50 lived; the Battles did not end.
- **Verdicts.**
  - **Floor ready**: ~0.5 s (0.7 s at a 2 m cell) laptop-equivalent, within the fade, so a go as planned.
  - **Tick**: T2's full Pool is ~2.8 ms mean and ~5 to 8 ms p99 laptop-equivalent, against 8 and 25. A go.
  - **Input Delay**: a full Bubble on a Floor costs what it does on the open field. A Battle Tick of that size needed Input Delay online (ADR 0025), so Stage 7 starts online Runs at `BATTLE_INPUT_DELAY` and measures four Players.
  - **Doorways**: Stage 1 must keep every Passage's centre line on a field cell centre (multiples of `flowCell`), or build Floors at a 2 m cell. **Decided by the user (2026-11-12): a 2 m cell for Floors**, a `delver.flowCell` of their own (2) since `crowd.flowCell` (4) is the Battles'. This leaves the generator's layout free.
- **ADR 0028** is accepted on the working branch, with no PR (the user's call). "Merged" in the Done above means that.

**Tests**: `src/sim/distanceTo.test.ts` (5 fast):
- it equals the Objective and Base fields on the open field and on the Fort;
- it is fresh on each call;
- a point no node stands on gives all −1;
- it reaches through an Enclosure's doorway.

No shipped map is one level with blocks, so the one-level blocks branch is covered only by sharing `levelField` with `destinationFields`. `src/mapEditor/delverSpike.slow.test.ts` (6 slow): parse and twice-compile to the same `mapFileText`, the build, doorways, T0, T1 with its replay, and T2. `npm run typecheck` is clean. `npm test`: **2393 passed, 5 skipped** (2388 before). The slow file passes alone.

**To watch next**:
- The Battle autopilot stuck on a wall by a doorway. The navmesh AI (AI allies, promoted enemies) needs watching at Enclosure doorways from Stage 2.
- 3 m doorways against Formations (`squad.narrow`). The spike's Squads did walk the Passages, but nobody looked at how.
- A playtest has nothing new to try yet.

### Stage 1: the Floor generator
**Model**: Opus (layout and geometry).
- `delverGen`: rooms of a few sizes placed on the grid (BSP or a seeded graph of rooms), joined by passages into a spanning tree with a few loops. Kinds assigned: Entrance, Stairs (furthest by walking), Rest (1 or 2, with one about halfway), Treasure (off the main path), Fight posts, Empty. Patrol loops are drawn along cycles. The output is a Map Source with Delver markers.
- Floors build their destination fields at `delver.flowCell` (2 m, decided after Stage 0), not the Battles' `crowd.flowCell` (4 m), so every 3 m Passage holds a node wherever it lies.
- Judge: `walkCheck`; every Hall reached from the entrance; every Passage followed by the fields (Stage 0's per-Passage check); Stairs and fires reached; no marker on a hazard; posts not within sight of the entrance spawns. Reroll by a salted seed until it passes.
- A dev route or Map Editor button opens a generated Floor. Golden-seed tests (bytes stable) and a soak over 500 seeds (all pass the judge within N rerolls).
- **Done**: any seed gives a valid, varied Floor, viewable in the editor.

#### Design
Stage 1 ships no game feature. It adds a pure, seeded Floor generator (`src/sim/delver/`), its Tuning Data (`delver`, new), a judge with a capped reroll, and a dev entry that opens a generated Floor in the Map Editor. Nothing in `SimState`, the state hash or the snapshot changes. The Tuning Data hash grows by the `delver` block and a `delverVersion` (below). The Hall graph Run is untouched.

**Where the markers live (decided).** The Map Source format does not change. `compileMap` needs only `battle.field` (the size), `deploy` and `squad` (`parseBattleMap`'s army-fits check) and `levels` (the walk check), and a map needs 1 to 12 Objectives, two Bases, a `front` and an `armySize`. So a Floor is two things, both rebuilt from (Run seed, Floor) on every peer and never stored:
- a **`FloorPlan`**, plain data, the truth the later Stages read: the Halls, the Passages, and every Delver marker (entrance spawns, Stairs zone, fires, Treasure pedestals, Warband posts, patrol loops);
- a **Battle map's Map Source** written from it (`floorSource`), so that `compileMap` and the Map Editor take it as they are. It carries the markers for the eye only: Objective `D` (owner 0, spawn) at the Entrance's centre and `E` (owner 1, spawn) at the Stairs' centre, the Bases on the same two points, and render-only props (a torch on each fire, a Team 1 banner on each post, a crate on each pedestal, a Team 0 banner at the Entrance's centre). The Simulation never reads markers back from a map file. A hand-made Floor (Later) would need a Delver section in the source; not now.

**`delver` Tuning Data** (`data/delver.json`, `src/tuning/delver.ts` `parseDelver(raw, fieldSize): DelverTuning`, `TuningData.delver`, loaded and hashed like the others):
```json
{ "flowCell": 2,
  "floor": { "cols": 7, "rows": 6, "rooms": 22, "gaps": [22, 24, 26, 28], "halfSize": [5, 11], "minPassage": 4, "passage": 3,
             "farPercent": 25, "loops": [3, 5], "rests": [1, 2], "treasures": 1, "emptyPercent": 30, "patrols": 2, "follow": 1.5,
             "maxAttempts": 10 } }
```
- `flowCell`: the destination fields' cell (m) on a Floor. The Battles keep `crowd.flowCell` (4).
- `floor`: `cols` × `rows` lattice; `rooms` Halls wanted; `gaps`: the metres between neighbouring lattice columns (rows), one picked per gap, all even; `halfSize` [min, max] of a Hall's half-width and half-depth (whole m); `minPassage`: the shortest Passage between lattice neighbours (m); `passage`: a Passage's width and its doorways' (m); `farPercent`: the chance (in 100) that a growth step joins a Hall two lattice steps away over an empty cell; `loops` [min, max] extra Passages after the spanning tree; `rests` [min, max] Rest Halls; `treasures`: Treasure Halls at most; `emptyPercent`: the share (in 100) of the Halls left after the named kinds that are Empty; `patrols`: patrol loops at most; `follow`: the judge's Passage slack (Stage 0's 1.5); `maxAttempts`: the most layouts tried for one (seed, Floor).
- Parse checks: whole numbers where whole; `gaps` even and `min(gaps) - minPassage >= 2 * halfSize[0]`; `passage <= 2 * halfSize[0]`; `(cols - 1) * max(gaps) / 2 + halfSize[1] + 2 <= fieldSize / 2` and the same for rows (the lattice fits the Battle's field, `battle.field.size`, 200); `rooms <= cols * rows`; ranges ascending; percents 0 to 100; `flowCell` positive.
- **How the fields pick up `delver.flowCell`**: a Floor's Battle Tuning is `delverBattle(tuning, map) = { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: tuning.delver.flowCell }, maps: { [map.name]: map } }` (`src/sim/delver/build.ts`). Its Battlefield (`battlefieldOf(battle, 'battle:' + map.name)`), its destination fields and `distanceTo` then all run at 2 m with no change to them, and so will the Crowd's density grid and the Squads in Stage 3, since everything reads `battle.crowd.flowCell`. The Battles' Tuning is never touched.
- **Hash**: `delver` is in the Tuning Data hash like every block. `src/sim/delver/version.ts` exports `DELVER_VERSION = 1` (depends on nothing), and `tuningDataHash` hashes `{ ...simulated, generatorVersion, delverVersion: DELVER_VERSION }`, so peers whose Floor generators differ refuse each other. Bump it on any change to the plan, the source, the judge or the reroll (the golden test says so when its pinned hashes move).

**Picks.** Every choice is `runPick(s, floor, slot, salt, count)` (`src/sim/dungeon.ts`), where `s` is the attempt's seed: `attemptSeed(seed, floor, 0) = seed >>> 0` and, for attempt a ≥ 1, `runPick(seed, floor, a, SALT.reroll, 0x1_0000_0000)`. `SALT` (in `plan.ts`): gapX 1, gapZ 2, start 3, grow 4, far 5, hw 6, hd 7, loopCount 8, loop 9, entrance 10, rests 11, treasure 12, order 13, reroll 14. Lists are arrays in fixed order, every tie goes to the lower index, and all coordinates are whole metres or half metres (a Passage's edges), so nothing hangs on float rounding.

**The plan** (`src/sim/delver/plan.ts`, `planFloor(t: DelverFloorTuning, seed: number, floor: number, attempt: number): FloorPlan`):
```ts
export type DelverHallKind = 'Entrance' | 'Stairs' | 'Rest' | 'Treasure' | 'Fight' | 'Empty';
export interface DelverHall { id: string /* hall<k> */; i: number; j: number /* lattice cell */; cx: number; cz: number; rect: Rect; doors: Doors; kind: DelverHallKind; depth: number /* m from the Entrance by the Passage graph */ }
export interface DelverPassage { id: string /* pass<n> */; a: number; b: number /* a west of b ('x') or south of b ('z') */; axis: 'x' | 'z'; rect: Rect; length: number /* centre to centre, m */; loop: boolean }
export interface MarkerPoint { hall: number; x: number; z: number }
export interface DelverPatrol { halls: readonly number[]; points: readonly GroundPoint[] }
export interface DelverMarkers { spawns: readonly MarkerPoint[] /* 4 */; stairs: { hall: number; zone: Rect }; fires: readonly MarkerPoint[]; pedestals: readonly MarkerPoint[]; posts: readonly MarkerPoint[]; patrols: readonly DelverPatrol[] }
export interface FloorPlan { seed: number; floor: number; attempt: number; halls: readonly DelverHall[]; passages: readonly DelverPassage[]; entrance: number; stairs: number; mainPath: readonly number[]; markers: DelverMarkers }
```
(all fields `readonly`). The algorithm, in order:
1. **Lattice.** Column gaps `gx[k] = gaps[pick(k, gapX, gaps.length)]` for k = 0 .. cols − 2, row gaps `gz[k]` likewise (gapZ). `X[0] = −Σgx / 2`, `X[i+1] = X[i] + gx[i]`; Z the same. The gaps are even, so Σ/2 and every centre is a whole metre (odd or even). A 3 m Passage on any whole-metre centre line holds a 2 m field cell centre, so the fields see every Passage. Cell c = j · cols + i. Directions in fixed order n (0, +1), e (+1, 0), s (0, −1), w (−1, 0).
2. **A Hall's size** when it is placed in cell (i, j): `limX = floor((min(gx[i−1], gx[i]) − minPassage) / 2)` over the gaps that exist, `hw = min(halfSize[0] + pick(c, hw, halfSize[1] − halfSize[0] + 1), limX)`, hd the same along z (hd salt). Its rect is `cx ± hw, cz ± hd`. So neighbours never touch, and a Passage between lattice neighbours is at least `minPassage` long. **Walls off the field's dots** (added after Stage 1's editor check, `DELVER_VERSION` 2): a Hall's Walls must not stand on a 2 m field cell centre (an even metre), or that node is cut off and a Squad there is led by its neighbours. So when `cx + hw` is even, `hw` becomes `hw − 1` if that is still ≥ `halfSize[0]`, else `hw + 1` (still ≤ `limX`, since `limX ≥ halfSize[0] + 1` whenever the gaps leave room; if neither fits, it stays and the plan test fails). The same for `hd` with `cz`. Every Hall edge is then an odd metre, and a Passage's Walls are at half metres, so no Wall of a Floor stands on a node. This assumes `delver.flowCell` 2 (the parse refuses any other flowCell while the rule is written for it).
3. **Growth (the spanning tree).** `occupied[c]` (Hall index or −1) and `reserved[c]` (a cell a long Passage runs through). The first Hall is at cell `pick(0, start, cols · rows)`. Then for step = 1, 2, … while fewer than `rooms` Halls: list the candidates in Hall index order, then direction order: for Hall h and direction d whose side has no Passage yet, c1 = its cell + d inside the lattice, not reserved and empty, gives a *near* candidate (target c1); if also c2 = c1 + d is inside, not reserved and empty, a *far* one (target c2 over c1). No candidate at all: stop (the layout stalled; the judge refuses it). Take the far list when it is not empty and either the near list is empty or `pick(step, far, 100) < farPercent`, else the near list; the candidate is `list[pick(step, grow, list.length)]`. Place the new Hall (index = its order of placement) at the target, join h to it by a Passage (tree), and reserve c1 when far.
4. **Loops.** Candidates, Hall index order, directions n then e only: side free, c1 inside and not reserved; if c1 holds Hall b, the pair (h, b), else if c2 = c1 + d is inside, not reserved and holds Hall b, the pair (h, b) over c1. A pair counts only if b's facing side is free too, no Passage joins them, and they are at least 3 Passages apart in the tree (so a loop makes a cycle of 4 Halls or more). `count = loops[0] + pick(0, loopCount, loops[1] − loops[0] + 1)`; for n = 0 .. count − 1, re-filter the candidates by the same rules against what is placed so far, stop when none is left, else add `valid[pick(n, loop, valid.length)]` as a loop Passage and reserve its c1 when far.
   This keeps every rule an Enclosure needs: one doorway centred on a side (a side holds at most one Passage, always to the nearest Hall that way), Passages straight between side centres (Halls in a lattice row share cz, in a column cx), and no Passage through a Hall or across another Passage (a long Passage's middle cell is reserved for good).
5. **A Passage's geometry.** a is the west (south) Hall, b the east (north). With w = `passage`: along x, `rect = { x0: a.rect.x1, x1: b.rect.x0, z0: cz − w/2, z1: cz + w/2 }`, doors `{ e: w, w: w }`, and Hall a gets door `e: w`, b `w: w`; along z the same with n and s. `length = |cxa − cxb| + |cza − czb|`. Passages are numbered tree ones first (in growth order), then loops.
6. **Depth.** Dijkstra from the Entrance over the Passages with `length` as the weight (whole numbers, exact), ties by lower Hall index. Computed once the Entrance is known (step 7), stored as each Hall's `depth`.
7. **Kinds**, in this order:
   - **Entrance**: `leaves[pick(0, entrance, leaves.length)]`, the leaves being the Halls with one Passage, in index order (all Halls if there is none).
   - **Stairs**: the Hall of the greatest depth, ties by lower index.
   - `mainPath`: the Dijkstra path Entrance → Stairs (each Hall's predecessor the one it was first reached from at its final distance, ties by lower index), Entrance first.
   - **In line**: from the Entrance, follow its Passage(s) straight on: through each Hall reached, the Passage on the side opposite the one entered, until there is none. Those Halls are *in line*: a Warband there could see the entrance spawns through the aligned doorways. They are never posts or patrol Halls.
   - **Rest**: `count = rests[0] + pick(0, rests, rests[1] − rests[0] + 1)`. The first is the `mainPath` Hall other than Entrance and Stairs that minimises `|2 · depth − D|` (D = the Stairs' depth), ties lower index; with no such Hall, any Hall but those two by the same rule. The second, if any: among the Halls with no kind yet and not joined to the first Rest, minimise `|4 · depth − 3 · D|`, ties lower index.
   - **Treasure** (up to `treasures`): among the Halls not on `mainPath` and with no kind, those whose walking distance to the nearest `mainPath` Hall (a Dijkstra from all of `mainPath` at once) is greatest; the one at `pick(0, treasure, tied.length)` of them in index order. None off the path: no Treasure.
   - **Fight / Empty**: the Halls left. Those in line are Empty. The others are ordered by `runPick(s, floor, hall, order, 0x1_0000_0000)`, ties lower index; with `E = max(0, floor(left · emptyPercent / 100) − inLine)`, the first E are Empty and the rest Fight.
8. **Patrol loops.** For each loop Passage in order: its cycle is the tree path from a to b (Halls in path order, a first), closed by the loop. A cycle through the Entrance or an in-line Hall is dropped. The rest are sorted by Hall count (most first), ties by Passage order, and the first `patrols` kept, each with `points` = its Halls' centres in order.
9. **Markers** (all on the 0.5 m grid, at least 1 m inside their Hall, since halfSize ≥ 5):
   - spawns: the Entrance centre ± 1.5 on both axes, in the order (−,−), (+,−), (−,+), (+,+);
   - Stairs zone: its centre ± 2 (`STAIRS_HALF`);
   - a fire at each Rest Hall's centre, Rests in index order;
   - three pedestals per Treasure Hall at (cx − 3, cz), (cx, cz), (cx + 3, cz) (`PEDESTAL_GAP`);
   - a post at each Fight Hall's centre, in index order;
   - the patrols of step 8.

**The source** (`src/sim/delver/source.ts`):
- `floorName(seed, floor) = \`delver${floor}s${seed >>> 0}\`` (at most 19 characters, within `MAX_MAP_NAME`).
- `floorSource(plan): MapSource`, version 1, `size` 200, `grid { step: 0.5, cell: 2 }`, `levels [-8, 0, 4]`. Brushes in this order: the abyss (`kind: 'hazard'`, `hazard: 'abyss'`, the whole field, y −8, as the spike's), then the Halls in index order (Enclosures at y 0, their `doors`, a render-only `material` by kind: Entrance `plaster`, Stairs `glow`, Rest `brick`, Treasure `tile`, Fight `dungeon`, Empty `basalt`), then the Passages in order (Enclosures at y 0, `material: 'stone'`). Objectives `D` (Entrance centre, owner 0, spawn) and `E` (Stairs centre, owner 1, spawn), both weight 1; `bases` the same two points; `front` 52; `armySize { standard: 50, max: 50 }`; no Tickets. `look.props` in this order: `entrance` (banner, team 0, Entrance centre), `fire<n>` (torch), `post<n>` (banner, team 1), `pedestal<n>` (crate), all y 0, turn 0. No sky, no Lobby card.

**Build and judge** (`src/sim/delver/build.ts`, `src/sim/delver/judge.ts`):
```ts
export interface BuiltFloor { plan: FloorPlan; source: MapSource; map: BattleMapTuning; battle: BattleTuning; field: Battlefield; fields: DestinationFields }
export function delverBattle(tuning: Pick<TuningData, 'battle' | 'delver'>, map: BattleMapTuning): BattleTuning;
/** compileMap (its parse and walkCheck included), the Battlefield and the destination fields at delver.flowCell. Throws MapCompileError. */
export function buildFloor(tuning: Pick<TuningData, 'battle' | 'delver'>, plan: FloorPlan): BuiltFloor;
export interface FloorJudgement { ok: boolean; reasons: readonly string[] }
/** The rules on a built Floor; each failure one line naming the Hall, Passage or marker. */
export function judgeBuilt(t: DelverFloorTuning, b: BuiltFloor): string[];
/** fieldAt: the distance at the node of the cell (x, z) lies in on Walk Surface s's level exactly (-1: none), as the spike's `exactAt`. */
export function fieldAt(f: DestinationFields, d: Float64Array, x: number, z: number, s: number): number;
```
`compileMap` is imported from `src/mapEditor/compile.ts` (pure). The delver modules are not re-exported from `src/sim/index.ts` in Stage 1 (that import would close a cycle through the compiler); they are imported from `src/sim/delver/index.ts`. Every point's Walk Surface is `groundOf(battle, field, x, z)` (put down anew: the floor, never a roof). The rules, in this order, each line prefixed by its rule's name:
1. **rooms**: the plan has `rooms` Halls (else the layout stalled), exactly one Entrance and one Stairs, Rests within `rests`, at least one Fight.
2. **compile**: `buildFloor` threw (its message). This is `walkCheck` too. The other rules are skipped.
3. **halls**: every Hall's centre is reached by the field from the Entrance's centre (`distanceTo` on its floor's surface, read with `fieldAt`, ≥ 0).
4. **passages** (Stage 0's per-Passage check): for each Passage, the field to Hall a's centre read at Hall b's centre is ≥ 0 and ≤ `follow · length`. One `distanceTo` per Hall, shared by rules 3 to 5.
5. **markers**: each marker point (spawns, the Stairs zone's centre, fires, pedestals, posts, patrol points) stands inside its Hall's rect shrunk by 1 m, on a Walk Surface that is not deadly, not a roof and at height 0 there, and is reached by the Entrance's field. A marker is named `spawn<k>`, `stairs`, `fire<k>`, `pedestal<k>`, `post<k>`, `patrol<k>.<n>`.
6. **sight**: no post and no patrol point is in sight of any entrance spawn: `inSight(fields, spawn.x, spawn.z, p.x, p.z, 0, 0, 0)` is false (the Walls at a body's height on its floor, `walled`).

**Generate and reroll** (`src/sim/delver/generate.ts`):
```ts
export interface DelverFloor extends BuiltFloor { attempts: number; judgement: FloorJudgement }
export function delverFloor(tuning: Pick<TuningData, 'battle' | 'delver'>, seed: number, floor: number, opts?: { maxAttempts?: number; judge?: (t: DelverFloorTuning, b: BuiltFloor) => string[] }): DelverFloor;
export function describeFloor(f: DelverFloor): string;
```
Attempts 0, 1, … up to `maxAttempts` (default `delver.floor.maxAttempts`): plan, build, judge; the first with no reasons is returned (`attempts` = its index + 1). If none passes, the built one with the fewest reasons (ties the first) comes back with `judgement.ok` false and `attempts` = maxAttempts; if none even compiled, it throws, naming the seed, Floor and the last reason. Deterministic from (seed, Floor) alone: no clock. `describeFloor` is one line: `Floor F of seed S, attempt A: N Halls (Entrance hallX, Stairs hallY, Rest …, Treasure …, n Fight, n Empty), P Passages (L loops), K patrols; passes the judge | fails: <reasons>`.

**The dev entry**. `src/devMode.ts`: `devDelverFloor(search, hash): { seed: number; floor: number } | null`, from `delverSeed` (a whole number ≥ 0) and `delverFloor` (≥ 1), only with `dev=1`. The Map Editor's File folder (`src/mapEditor/ui/index.ts`) gains a `Delver seed` and a `Delver floor` field and an **Open Delver Floor** button: `delverFloor(tuning, seed, floor)`, then `openRaw(JSON.parse(JSON.stringify(floor.source)), …)` with `describeFloor` in the status line. On start, `devDelverFloor()` opens that Floor at once, so `#/mapeditor?dev=1&delverSeed=7&delverFloor=1` shows Floor 1 of seed 7. Saving it writes it out like any map (a Floor copied out as a source). The editor's checks and overlays stay at `crowd.flowCell`.

**Tests**:
- `src/tuning/delver.test.ts`: the bundled `delver` parses; each parse check refuses a bad value with its path; `tuningDataHash` changes with `delver.flowCell` and with `delverVersion`.
- `src/sim/delver/plan.test.ts` (fast, plan only, no compile): the same (seed, Floor, attempt) gives a deep-equal plan twice; over 50 seeds: `rooms` Halls, centres whole metres, rects inside the field and apart, every Passage between side centres with a matching doorway on both Halls, at most one Passage per side, no two Passages or a Passage and a Hall overlapping, the tree plus loops connected, one Entrance (a leaf when any exists) and one Stairs of greatest depth, the first Rest on `mainPath`, any Treasure off it, in-line Halls never Fight, patrols never through the Entrance; and each attempt seed differs.
- `src/sim/delver/judge.test.ts` (fast, a few real builds): a good Floor has no reasons; then one test per rule on a passing Floor: rooms (a plan cut to 21 Halls; no Stairs), compile (a leaf's only Passage Brush removed from the source: the walk check fails), halls (a Hall's recorded centre moved into the abyss), passages (a loop Passage's Brush removed: its Halls' fields go round), markers (a fire moved into the abyss; a post moved into another Hall), sight (a post moved into the first in-line Hall, or, when the Floor has none, onto the Entrance's spawn line in its neighbour), and the reroll (a judge that refuses attempt 0 gives attempt 1; a judge that refuses all gives the best with `ok` false, and the same call twice gives the same bytes).
- `src/sim/delver/golden.test.ts` (fast): seeds 1, 7, 123456789 and 4294967295 at Floors 1 and 9: `delverFloor` twice gives the same `mapFileText` bytes; each passes; its `hashValue(mapFileText(map))` and `attempts` equal pinned values (written down on the first run; a change means `DELVER_VERSION` + 1 and new pins).
- `src/sim/delver/delverGen.slow.test.ts` (slow soak): 500 (seed, Floor) pairs, seed k = `runPick(0x5eed, 0, k, 0, 0x1_0000_0000)`, Floor `1 + k % 9`. Every one passes within `maxAttempts`. It prints the attempts histogram, the failed attempts' reasons by rule, the build time per Floor (compile, fields, judge; mean, p50, p95, max of the passing attempt, and of all attempts summed), a `navMesh` time on 20 of them, and per-kind counts. **It must show it exercised**: every Hall kind on some Floor (Treasure on most), Floors with 1 and with 2 Rests, at least one far Passage, loop Passages, patrol loops, and at least one reroll or else a printed note that none was needed; any of these missing fails the test.
- `src/devMode.test.ts`: `devDelverFloor` reads both, refuses bad values, and is null without `dev=1`.
- Existing tests: `src/tuning/hash.test.ts`'s "ignores key order" lists every TuningData key, so it gains `delver: tuning.delver`. No other existing test changes.

### Result
Done 2026-11-12. Any (Run seed, Floor) now gives a judged, varied, one-level Floor of 22 Halls in about 0.24 s here, and it can be opened in the Map Editor. Nothing in the Simulation's state changed. The Hall graph Run still ships as before.

**What was built** (`src/sim/delver/`, imported from `src/sim/delver/index.ts`, not from `src/sim/index.ts`):
- **`delver` Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`): `flowCell` 2 and the `floor` block, as the Design gives them. It is hashed with the rest, and `tuningDataHash` also hashes `DELVER_VERSION` (1).
- **`planFloor`** (`plan.ts`): the Design's steps 1 to 9, plain data.
  - Lattice gaps are picked per column and row.
  - Halls are sized to their gaps and grown into a spanning tree, with about a quarter of the joins far, over an empty cell.
  - It adds 3 to 5 loops between Halls at least 3 tree Passages apart.
  - It assigns the kinds, the in-line Halls, patrols along the loops' cycles, and the markers.
- **`floorSource`** (`source.ts`): a Battle map's Map Source with an abyss, Enclosure Halls (a material by kind) and Enclosure Passages. The Objectives D and E and the Bases stand at the Entrance and the Stairs. Render-only props mark the entrance, fires, posts and pedestals. The field size comes from `battle.field.size`.
- **`buildFloor` and `delverBattle`** (`build.ts`): `compileMap`, then the Battlefield and destination fields under `{ ...battle, crowd.flowCell: delver.flowCell, maps: { floor } }`.
- **The judge** (`judge.ts`): rules 1 to 6 by `judgeAttempt`, the only path to a verdict, which `delverFloor` (`generate.ts`) calls once per attempt with a salted attempt seed. `describeFloor` gives the one-line summary.
- **The dev entry**: `devDelverFloor` (`src/devMode.ts`) and the Map Editor's File folder fields `Delver seed` and `Delver floor`, with the **Open Delver Floor** button. `#/mapeditor?dev=1&delverSeed=7&delverFloor=1` opens that Floor at once.

**Changed from the Design:**
- **Hall centres are whole metres, not always even.** Σgaps/2 is odd for some seeds. That does no harm: a 3 m Passage on any whole-metre line holds a 2 m field cell centre. The Design is corrected.
- **Rule 1 runs first and stops the attempt.** A plan with too few Halls, or missing a kind, is not built. This is in `judgeAttempt`, from the code review. An injected judge (tests only) stands in for rules 3 to 6.
- **Tuning checks the code review added:** `minPassage` ≥ 1, `halfSize[0]` ≥ 4 (the pedestals at ±3 m plus the judge's 1 m margin), and `passage` > `flowCell`.
- **The golden test pins the plan's hash beside the map's,** since the markers and kinds never reach the compiled map.
- **Two existing test files changed:** `hash.test.ts` gains `delver` in its key-order literal, and `tuning.test.ts`'s `goodRaw()` gains a small `delver` block, since `parseTuningData` now needs one.

**Measured** (the test container, which is about 3× a mid-range laptop, as Stage 0 measured; 500 Floors, `delverGen.slow.test.ts`):
- **Attempts:** all 500 passed on the first attempt, so no rule failed and no reroll was needed.
- **Build per Floor:** plan 0.5 ms, build (compile, Battlefield, fields at 2 m) mean 234 ms (p95 280, max 388), judge 6.5 ms. That is 241 ms in total (p95 288, max 399), or about 0.75 s laptop-equivalent, within the 1 s fade.
- **Navmesh:** 17 ms mean on 20 Floors (95 polygons, 200 links), which Stage 2 adds.
- **What the 500 Floors held:**
  - Every Floor has a Treasure Hall.
  - 247 Floors have 1 Rest and 253 have 2.
  - Fight Halls average 12.5 a Floor and Empty Halls 5.
  - Passages total 12,516: 10,500 tree, 2,016 loop, and 3,083 far.
  - Patrols per Floor: 413 Floors have 2, 61 have 1 and 26 have none.
  - In-line Halls average 2.3 a Floor.
- **The judge:** on Floors `planFloor` makes, it does not fail. The plan avoids every rule by construction: in-line Halls are never posts, markers sit at Hall centres, and every Passage lies on a 2 m node. The fast tests show that each rule fires on a broken Floor. The judge is a guard for Stage 6's levels and for Tuning changes. Its reroll path is tested only with an injected judge.

**Tests**:
- `src/tuning/delver.test.ts`: 34 tests.
- `src/sim/delver/plan.test.ts`: 7 tests.
- `judge.test.ts`: 12 tests, one per rule plus the reroll and the no-build case.
- `golden.test.ts`: 8 tests, seeds 1, 7, 123456789 and 4294967295 at Floors 1 and 9. Each builds the same bytes twice, and its map and plan hashes are pinned.
- `devMode.test.ts`: 3 new tests.
- `delverGen.slow.test.ts`: the soak, about 2 minutes.

`npm run typecheck` is clean. `npm test`: **2464 passed, 5 skipped** (2425 before the Stage). `npm run test:slow`: 21 files and 36 tests passed. `src/net/gauntlet.test.ts`'s four-Player checksum test failed once under full-suite load and passed alone, with and without the Stage's code. It is a flaky test that predates the Stage.

**In the editor** (screenshots taken with the run skill):
- **The views:** the top view shows the lattice of Halls of varied sizes, straight Passages (long ones over empty cells), loops, a banner on each post, a torch on each fire, three crates in the Treasure Hall, and the Entrance (0) and Stairs (1) markers. The 3D view shows the Enclosures with their roofs and the Stairs Hall in `glow`.
- **The warnings:** the editor's checks and its field-cell overlay still use the Battles' 4 m `crowd.flowCell`. So a Floor lists warnings that its Walls run through 4 m cell centres. That is harmless on a Floor, whose fields are at 2 m.

**After the Stage (2026-11-13, the user's calls):**
- **Depth in Tuning Data.** `delver.tiers` and `delver.floorsPerTier` (3 and 3) are now Tuning Data, for Stage 2. The editor's `Delver floor` field goes up to their product.
- **The editor checks a Floor at its own cell.** It uses `isFloorName` and the 2 m `delver.flowCell`. That showed every Floor with Walls on 2 m field nodes, since Hall edges sat on even metres.
- **So Hall Walls are now kept on odd metres** (the Design's "Walls off the field's dots"). `delver.flowCell` must be 2, `DELVER_VERSION` is 2, and the golden pins moved.
- **Results after the change:** a judge test checks a Floor with the editor's `checkMap` at 2 m and finds no Wall on a node, and the editor reports "No checks fire". The 500-Floor soak still passes every pair first try, at 238 ms mean (p95 287) a Floor.
- **Accepted as is:** the user is fine with gridded Floors for now.

**To watch next**:
- **The Floors look gridded.** Every Hall sits on a 7 × 6 lattice and every Passage is straight, so Floors differ by gaps, sizes, holes and loops, not by shape. L-shaped Passages (a corner Enclosure) or a jittered lattice would loosen that later.
- **Every Passage is straight, so in-line sight is common.** Each Floor has about 2.3 in-line Halls, which are always Empty. Stage 3 should keep posts out of them, as the plan does.
- **No playtest yet.** Stage 2 puts the party on these Floors.

### Stage 2: the Run loop, solo
**Model**: Sonnet.
- The Gauntlet Format starts a Delver Run on Floor 1 of the generated Dungeon. Team 0 spawns at the entrance. The Stairs zone takes the party down (fade, next Floor). Rest fires heal once per Player per fire and revive the fallen. Inventory changes only at a fire. A wipe is a Defeat. Taking the last Stairs is a Victory for now, with Bosses in Stage 4.
- No enemies yet: the loop, the fade, HP carry-over and revive are tested on empty Floors.
- **Done**: a solo Run walks three empty Floors to Victory; `dungeonRun` style tests are rewritten for Floors.

#### Design
Stage 2 puts the party on generated Floors: a Delver Run of `delver.tiers × delver.floorsPerTier` empty Floors, chosen in solo by a dev flag while the Hall-graph Run stays the Gauntlet's default (until Stage 8). Nothing about a Duel, a Battle or a Hall-graph Run changes: every new field is absent outside a Delver Run, so every existing hash, snapshot and test stands.

**Choosing a Delver Run.**
- **The Match option**: `MatchConfig.delver?: true` (in `MatchOptions` through `Partial<MatchConfig>`). `createMatch` refuses it unless `format` is `'Gauntlet'`, and refuses it with `start` (no dev start Hall). `relics` (dev) still give the first inventory. Absent, a Gauntlet is the Hall-graph Run, as now.
- **The dev flag**: `devDelverRun(search, hash): boolean` (`src/devMode.ts`), true for `?dev=1&delver=1` only. `game.ts` `launch()` adds `delver: true` to a solo Gauntlet's options (`members.length <= 1`), as it adds `devRunStart`. With `&autopilot=…` it puts the local Fighter on the Delver pilot (below) instead of the Hall autopilot.
- **The Lobby**: no setting in Stage 2. An online Gauntlet is always the Hall-graph Run (the flag is read only for solo, so no `PROTOCOL_VERSION` change). Stage 7 adds a Lobby knob synced to guests; Stage 8 drops the choice.
- **The solo menu**: unchanged. The Gauntlet Format plus `?dev=1&delver=1`.
- **Replays**: `replaySetup` writes `config` as it is, so `delver: true` rides along and a replay rebuilds a Delver Run through `createMatch`. A test replays one.

**Floors from (Run seed, Floor) alone** (`src/sim/delver/world.ts`, pure, imports only from `src/sim/delver/*` and leaf modules, never from `src/sim/index.ts`):
- **The arena name** is `floorArenaName(seed, floor) = 'battle:' + floorName(seed, floor)`, i.e. `battle:delver<F>s<S>`. `parseFloorArena(name): { seed, floor } | null` reads it back (via `isFloorName`). The Run seed is `runSeed(config.arena)`.
- **`floorOf(tuning, name): DelverFloor | null`**: `delverFloor(tuning, seed, floor)` for a Floor name, else null. Built once per (base Tuning Data object, name) and kept (`KEPT_FLOORS = 4`: the current, the next warmed, and slack), in a module `WeakMap<TuningData, Map<string, …>>`, most recently used last, exactly as `generatedArena` keeps builds. A copy made by `arenaTuning` maps back to its base (a `WeakMap` of copies), so it shares the builds. A cache derived from static data: never in the state, and a rebuilt one is equal.
- **`arenaTuning(tuning, name): TuningData`**: for any name that is not a Floor's, `tuning` itself (the same object). For a Floor's, `{ ...base, battle: floor.battle }`, made once per entry and returned as the same object while kept. `floor.battle` is `delverBattle`'s: the Battles' Tuning with `crowd.flowCell` = `delver.flowCell` and the Floor's map as its only `battle.maps` entry. So with that Tuning Data, `arenaOf(t, name)` resolves the Floor (through `battlefieldOf(t.battle, name)`, which finds the map and returns the very Battlefield `buildFloor` built, since the cache is per `BattleTuning` object), the navmesh is `navMesh(arenaOf(t, name), t)` (cached per Arena and Tuning Data), and the destination fields run at 2 m. **The rule**: whoever reads the Arena of a state that may be on a Floor reads it under `arenaTuning(tuning, state.arena)`. In Stage 2 that is `stepDelver` (it steps the Duel under it), `floorDuel`, the AI (`RuleAi`, `prepareAi`), `warmArena`, and the Renderer's world (`createArenaWorlds`). `arenaOf` itself does not learn Floors, so no import cycle reaches the Map Compiler from `arena.ts`.
- **Build budget**: about 0.24 s here, 0.75 s laptop-equivalent (Stage 1's soak), all in `delverFloor` (compile, Battlefield, fields at 2 m, judge). Floor 1 builds in `createMatch` (behind the menu). Each later Floor is warmed by the game at the start of the Floor before it (`arenasToWarm`), while that Floor's fade-in still darkens the screen, so the Tick that enters it, and any Rollback over that Tick, only reads the cache. A miss (dropped, or not warmed) builds it on that Tick: correct, a hitch. The slow test prints the build of each Floor and fails over 2 s.

**The state** (all plain data, hashed with `hashValue(match)` and snapshotted with the Match; every new field is absent outside a Delver Run):
```ts
/** A Delver Run's phase: Exploring the Floor, or Descending (the fade after the Stairs, until `nextDuelTick`). */
export type DelverPhase = 'Exploring' | 'Descending';
/** One fire of the current Floor (plan.markers.fires order): whether its revive is spent, and which Players took its heal. */
export interface RestUse { readonly revived: boolean; readonly healed: readonly number[] /* ascending Fighter indices */ }
/** `MatchState.delver`: a Delver Run's progress (docs/plans/delver.md). Becomes RunState in Stage 8. */
export interface DelverRun {
  readonly floor: number;            // 1-based
  readonly floors: number;           // delver.tiers × delver.floorsPerTier, fixed at the start
  readonly phase: DelverPhase;
  readonly stairsTicks: number;      // Ticks in a row every counted Fighter stood in the Stairs zone; 0 when one is out; kept while Descending
  readonly restUsed: readonly RestUse[];
  readonly pickups: readonly Pickup[]; // inventory drops (Stage 4 adds loot); empty on each new Floor
  readonly startTick: number;
  readonly away?: readonly number[]; // AI Takeover, as RunState.away
}
/** `SimState.delver`: the Run mirrored for the Controllers, which see only SimState. */
export interface SimDelver { readonly floor: number; readonly phase: DelverPhase; readonly away?: readonly number[] }
```
- `MatchState.delver?: DelverRun`; `MatchState.run` is null in a Delver Run, so no Hall-graph code (Doors, `hallOf`, the Floor Map, `runCleared`) ever reads one. `SimState.delver?: SimDelver`; `step` carries it through as it carries `hall`, and a Duel with `hall` or `delver` ends only when Team 0 is wiped out (`updateDuel`'s flag).
- **What stays until Stage 8**: the whole Hall-graph `RunState` (`row`, `hall`, `path`, `doorTicks`, `rested`, its `phase`) and `SimHall`, for the Hall-graph Run only. Stage 8 deletes them and renames `DelverRun` to `RunState` and `MatchState.delver` to `run`.
- `score[0]` is the Floors whose Stairs were taken; `duelNumber` the Floor. `MatchState.arena` is the Floor's arena name; `config.arena` stays the Random Map (the Run seed).
- **Not in the state**: the FloorPlan, BuiltFloor, Battlefield, navmesh, fields and the Floor's Tuning Data copy (all `floorOf`/`arenaTuning` caches).

**A Floor's Duel** (`floorDuel(tuning, config, floor, previous, rng, relics = [])`, `src/sim/delverRun.ts`), replacing `hallDuel` for a Delver Run:
- The arena is `floorArenaName(runSeed(config.arena), floor)`, built under `t = arenaTuning(tuning, arena)` by `createInitialState(t, 0, placements, weapons, config.teams, arena, sizes)`.
- **Team 0** (1 to 4 Fighters: Players and AI allies, in Fighter order) stands at `plan.markers.spawns[k]` (k its rank in Team 0), y 0, facing into the Entrance's Passage: its door side in the fixed order n, e, s, w gives facing 0, π/2, π, −π/2 (0 faces +z, π/2 faces +x; constants, no trig).
- **Team 1**: the four slots are Benched (hp 0, `benched`), standing at the Stairs zone's centre. Stage 3 replaces them with the Fighter Pool.
- **Inventories, Mods and HP** as `hallDuel`: a Player's inventory carried from `previous` (Floor 1: `startingInventory` plus the dev Relics; `withRelics` moves from `match.ts` to `inventory.ts` as `withStartingRelics` so both use it), `holdInventory` for a Player, `setMods(NO_MODS)` for an AI ally. HP is carried from `previous` (min max HP), and a fallen one (not `inDuel`) comes back at `dungeon.revive` × max HP: **taking the Stairs revives the fallen**. Daggers refill. No full heal (no Bosses yet).
- `delver: { floor, phase: 'Exploring', away? }` on the SimState.
- `enterFloor(run, floor, plan)` gives the `DelverRun`: `phase 'Exploring'`, `stairsTicks 0`, `restUsed` one `{ revived: false, healed: [] }` per fire, `pickups []`, `floors`, `startTick` and `away` carried.
- `createMatch` with `delver`: `floors = tiers × floorsPerTier`, `duel = floorDuel(tuning, config, 1, null, createRng(seed), options.relics)`, `run: null`, `delver: enterFloor(...)`, `arena: duel.arena`, `duelNumber 1`, `score [0, 0]`, events `[DuelStart 1]`.

**The step** (`stepDelver(match, run, intents, tuning, tick)`, `src/sim/delverRun.ts`; `stepMatch` calls it first when `match.delver` and the Match is in progress). `delverRun.ts` imports from `match.ts` only with `import type`; `match.ts` imports `delverRun.ts`. In order:
1. **The fade is over** (`nextDuelTick !== null && tick >= nextDuelTick`): `floorDuel(…, run.floor + 1, match.duel, match.duel.rng)`, `delver: enterFloor(...)`, `arena`, `duelNumber + 1`, `nextDuelTick null`, event `DuelStart`. Return.
2. `t = arenaTuning(tuning, match.duel.arena)`; `duel = step(match.duel, intents, t)`.
3. **A wipe** (`duel.duel.status === 'Over'`, i.e. Team 0 all fallen) is a Defeat in any phase: `status Over, winner 1`, event `RunEnd { winner: 1, cleared: run.floor - 1, floors, halls: 0 }`. Return.
4. While `Exploring` (none of a to c runs while Descending):
   a. **The Inventory**: a Player's Fighter's `equip`/`drop` (`useInventory`, as `stepRun` does it) is taken only while it stands **at a fire**: `atFire(plan, f, radius)` = `standsWithin({ x, y: 0, z }, delver.fireRadius, f)` for some fire. Elsewhere it is refused (nothing changes). A drop becomes a shared pickup (`droppedPickup`) and an `ItemDropped` event. Then `takePickups` anywhere (picking up needs no fire), with `ItemTaken` events.
   b. **The fires**, in plan order. For fire k, the arrivers are the present Players (`presentPlayers(config, run.away)`) that are `inDuel`, hp > 0, and `standsWithin` its radius.
      - **Revive**: if `!restUsed[k].revived` and there is an arriver, every Team 0 Fighter with `death` at that moment comes back, in Fighter order, the j-th at (fire.x + DX[j mod 4], fire.z + DZ[j mod 4]) with offsets (−1.5, −1.5), (+1.5, −1.5), (−1.5, +1.5), (+1.5, +1.5), y 0, keeping its facing: `standingFighter(t, arena, …, weapon, 0, size)`, then its inventory (`holdInventory`) or `setMods(NO_MODS)` as in `floorDuel`, hp `revive × maxHp`, no `death`. Event `Revived { fighter, fire: k }` each. Then `revived: true`, **spent at the first arrival even when nobody had fallen** (the plan's rule, read literally). A revived Fighter keeps its Inventory.
      - **Heal**: then every arriver (the just-revived Players among them, who stand within the radius) not in `restUsed[k].healed` heals `dungeon.restHeal × maxHp`, never above max: event `Rested { fighter, healed }`, and joins `healed` (ascending). An AI ally never heals or revives.
   c. **The Stairs**: `counting = doorCounters(config, duel.fighters, run.away)` (every living present Player; with none alive, the living AI allies). `stairsTicks = counting.length > 0 && counting.every((i) => inStairs(plan, fighters[i])) ? stairsTicks + 1 : 0`, where `inStairs` is inside the zone's rect (edges included) and `y` within (−0.5, ZONE_HEIGHT). At `doorTicksNeeded(tuning)` (`dungeon.doorSeconds`):
      - on the last Floor (`floor === floors`): **Victory**. `status Over, winner 0`, the Duel ended as `stepRun` ends it on the last Boss (`duel Over winner 0` plus a `DuelEnd` event), event `RunEnd { winner: 0, cleared: floors, floors, halls: 0 }`. No fade.
      - else `phase 'Descending'`, `nextDuelTick = tick + max(1, secondsToTicks(dungeon.hallFadeSeconds))`, `score[0] + 1`, event `StairsTaken { floor }`.
5. Mirror `phase` (and `away`) onto `duel.delver`.
- New Match events: `StairsTaken { type, floor }` and `Revived { type, fighter, fire }`; `Rested`, `ItemDropped`, `ItemTaken`, `DuelStart`, `RunEnd` are reused.
- **AI Takeover**: `takeOverFighter` marks `delver.away` and `duel.delver.away` as it does `run.away` (idempotent; not a Player: unchanged).

**Tuning Data**: `delver.fireRadius`, default **3** (m; the Hall-graph fire's 1.5 m is too tight for four Players and the Inventory screen), a positive number, parsed in `src/tuning/delver.ts`. `dungeon.doorSeconds` (1.5), `hallFadeSeconds` (1), `restHeal` (0.5) and `revive` (0.25) are read as they are. The Stairs zone is the plan's (±2 m).

**The AI on an empty Floor**:
- **`RuleAi`** (`src/controllers/ai.ts`) reads every Arena and navmesh under `arenaTuning(this.tuning, state.arena)`, as does `prepareAi`. No other change.
- **The Ally AI** (`allyAi.ts`), with `state.delver`: while Descending, or fallen, its AI's own Intent (it stands). While Exploring, follow the nearest living present Player (as after a Clear, `FOLLOW_DISTANCE`). With no Player alive, walk to the Stairs: its spot is the zone's centre plus (±1, ±1) by its rank among the living Team 0 Fighters (same order as the spawns), stop 0.3 m, by `walkTo` (the navmesh). It never decides anything a Player could.
- **The Hall AI** returns `IDLE_INTENT` whenever `state.delver` is present.
- **The Delver pilot** (`src/controllers/delverPilot.ts`, `createDelverPilot(tuning, difficulty = 'Hard')`, for tests and `&autopilot`): Idle while Descending or fallen. Else it walks (its AI's `walkTo`) to the nearest fire it has not yet reached this Floor (straight-line distance, ties lower index; reached = within 1 m), then to the Stairs zone's centre (stop 0.3). Its memory, `{ floor, reached: number[] }`, is saved and loaded as plain data.
- **Doorways**: Stage 0's Battle autopilot stuck on a Wall beside a doorway. The slow test measures how far each ally trails when the Stairs are taken, and fails past 8 m.

**Presentation, the least that makes it playable** (Stage 5 does the rest):
- **The world**: `createArenaWorlds` returns `{ tuning: arenaTuning(tuning, name) }` for a Floor name. `warmArena` builds the navmesh under `arenaTuning`. `arenasToWarm` returns the next Floor's arena name while a Delver Run is Exploring a Floor below the last.
- **The Floor's look**: in `stage.ts`'s `battle()`, for a Floor's map, `drawnMapModel(mapModel(source, compileDraft(source, battle)))` from `floorOf`. Roofs are drawn as the editor's 3D view draws them. If the camera cannot see under them, Step 5.3 decides.
- **Marks** (`src/render/delverMarks.ts`): a flat square on the Stairs zone, and a ring of `fireRadius` round each fire, dimmed once the local Player has taken its heal.
- **The HUD**:
  - `hallFade` fades for a Delver Run as for a Hall change: dark over the fade, light over the Floor's first `hallFadeSeconds`, none on Floor 1.
  - A banner on each `DuelStart`: "Floor F / N · Run seed S".
  - "Revived" and "Rested" announcements.
  - The results screen on `RunEnd`: Victory or Defeat, Floors reached, time and seed, with no Halls.
  - The Floor Map button and the minimap stay hidden.
  - A fallen Player watches with the orbit camera, as a fallen Player in a Hall does.
- **The Inventory screen** takes input at a fire only: "Only at a fire" elsewhere, "Descending" while Descending.

**Tests**:
- Fast, `src/sim/delverRun.test.ts` (Fighters moved by editing the state, as `dungeonRun.test.ts` does):
  - the start: arena, spawns, facing, Benched Team 1, the run fields, and `createMatch` refusing a bad option;
  - `arenaTuning` and `floorOf`: identity for other names, one object while kept, the Floor's map at `delver.flowCell`;
  - the Stairs dwell, a reset, an AI ally alone not counting, and the AI allies counting once no Player lives;
  - the fade to Floor 2: a new arena, HP carried, the fallen revived, pickups and fires reset;
  - the heal, once per Player per fire, never an AI ally;
  - the revive, once per fire, at the fire, at `revive` of max HP, spent on the first arrival;
  - the Inventory gate at the fire's radius, a drop at a fire, and a take anywhere;
  - a wipe is a Defeat; the last Stairs are a Victory;
  - a Takeover;
  - determinism: same Intents give the same hash at every Tick across a Floor change, and a snapshot restored before it re-simulates the same;
  - a replay;
  - Hall-graph Runs untouched.
- Fast, controllers: the Ally AI on a Floor follows, walks to the Stairs with no Player, and idles while Descending; the Hall AI idles; the pilot's target order.
- Slow, `src/controllers/delverRun.slow.test.ts`: Tuning `delver.tiers 1, floorsPerTier 3`. One Player on the pilot and two Hard AI allies. At each Floor's first Tick the harness sets the Player to half HP and fells ally 1 (a `death` written into the state). It prints each Floor's build time (cold, `floorOf` before the Run), its seconds to the Stairs, the ms per Tick, and the allies' trail when the Stairs are taken.
  - **It must show it exercised**, on every Floor: a `Rested` with `healed` > 0, a `Revived`, and the Stairs (`StairsTaken` on Floors 1 and 2, then the Victory).
  - A second case fells the Player at Floor 1's start: the AI allies walk to the Stairs and take them, and the Player stands on Floor 2 at `revive` of max HP.
- **Existing tests**: none is rewritten or removed. The Hall-graph Run ships until Stage 8, so `dungeonRun.test.ts`, `gauntlet.soak.test.ts`, `takeover.test.ts`, the Door and Floor Map tests and the rest stay as its tests. `delverRun.test.ts` is their Floor counterpart, and Stage 8 removes the Hall-graph ones. `src/tuning/delver.test.ts` gains the `fireRadius` check (a new test, no changed expectation).

### Result
Done 2026-11-13. A solo Delver Run now plays: `?dev=1&delver=1` with the Gauntlet Format starts one on generated, empty Floors. Team 0 spawns at the Entrance. Fires heal and revive. The Stairs take the party down after a fade, and the last Stairs win the Run. The Hall-graph Run is still the Gauntlet's default, unchanged, and every hash and test from before is unchanged.

**What was built** (as the Design gives it, with the changes below):
- **Floors from (Run seed, Floor)** (`src/sim/delver/world.ts`): the arena `battle:delver<F>s<S>`, `floorOf` and `arenaTuning`. Whoever reads a Floor's Arena reads it under `arenaTuning`: the Simulation, the AI, `warmArena`, the Renderer's world, blood, Fighter poses and marks.
- **The state**: `MatchConfig.delver`, `MatchState.delver` (`DelverRun`: floor, floors, phase Exploring or Descending, stairsTicks, restUsed per fire, pickups, startTick, away) and `SimState.delver`. They are hashed and snapshotted, and absent outside a Delver Run. `MatchState.run` is null in a Delver Run.
- **The Run** (`src/sim/delverRun.ts`):
  - `floorDuel` and `enterFloor`.
  - `stepDelver` handles the fade, the wipe (Defeat), the Inventory gate at a fire, pickups anywhere, each fire's revive and heal, the Stairs dwell (`doorCounters`, `doorTicksNeeded`) and the Victory.
  - New events: `StairsTaken` and `Revived`.
  - `delver.fireRadius` is 3 m.
  - `withStartingRelics` moved to `inventory.ts`, `placeDrop` to `pickups.ts`, and `doorTicksNeeded` to `hall.ts`.
- **The AI**:
  - `RuleAi` reads Arenas and navmeshes through one `world(state)` helper.
  - The Ally AI follows the nearest Player on a Floor, and with no Player alive walks to its own spot in the Stairs zone.
  - The Hall AI idles on a Floor.
  - The new **Delver pilot** (`createDelverPilot`) walks to the fires, nearest first, then to the Stairs. It is used by the tests and by `&autopilot=1`.
- **The game**:
  - `devDelverRun` turns the Run on.
  - The next Floor is warmed from the current Floor's first Tick.
  - The Floor is drawn from its source (`mapModel`, cached, old ones disposed).
  - `DelverMarks` draws the gold Stairs square, and a fire and a `fireRadius` ring at each fire.
  - The HUD fades as for a Hall change, shows "Floor F / N · Run seed S" at each Floor's start, announces "Rested" and "Revived", and shows "Floor F / N" as its score line.
  - The results screen has no Halls.
  - The Inventory screen works at a fire only ("Only at a fire", "Descending").
  - Replays carry `delver: true`.

**Changed from the Design:**
- **Built Floors are keyed by the Battle and Delver Tuning objects**, not by the Tuning Data object. The game reads a Floor under two Tuning Data objects (`matchTuning` and the Renderer's base), so the first version built each Floor twice. The code review caught it. The Tuning Data copies are still made per base.
- **`score[0]`** counts every Floor whose Stairs were taken, the last one included. Both `RunEnd`s give it as `cleared`, from the code review.
- **The Inventory screen never takes over movement in a Delver Run.** Walking into a fire's ring with the screen open froze the Player at the ring's edge. Its buttons still work at a fire.
- **A finished Delver Run** steps the generic path under `arenaTuning`, which would otherwise throw on the Floor's name.
- **The camera** (`cameraCollider.ts`, found in the playtest): Floors are drawn with Walls 0.6 m thick, and the camera stopped 0.25 m from a Wall's centre line, so about a quarter of the frames were inside a Wall. It now stops 0.45 m off the face it hits, measured square to the face, more at a glancing angle. Afterwards about 1 frame in 16 was inside a doorway post. This affects every Arena's camera (render only).
- **No existing test was rewritten or removed.** The Hall-graph Run ships until Stage 8, so `dungeonRun.test.ts` and the rest stay as its tests, and `delverRun.test.ts` is their Floor counterpart. Two existing files gained a key: `delver.test.ts` and `tuning.test.ts`'s `goodRaw()` have `fireRadius`.

**Measured** (the test container, about 3× a mid-range laptop; `src/controllers/delverRun.slow.test.ts`, Run seed 4242, 1 tier × 3 Floors, one Player on the pilot and two Hard AI allies):

| | Floor 1 | Floor 2 | Floor 3 |
|---|---|---|---|
| Build, cold (ms) | 364 to 431 | 301 to 351 | 290 to 355 |
| To the Stairs (s, simulated) | 128.4 | 136.9 | 126.7 (Victory) |
| Heal (the Player at 50%) | +50 | +50 | +50 |
| Revive | ally 1 | ally 1 | ally 1 |
| Allies' trail at the Stairs (m) | 1.5, 2.0 | 1.5, 2.1 | 1.5, 2.1 |

- **The Tick**, over 23,640 Ticks: mean 0.09 to 0.13 ms, p99 0.34 to 0.44 ms, max 49 to 75 ms. The max is a one-off, about the Floor change.
- **With the Player felled on Floor 1**, the allies took the Stairs in 90.9 s, and the Player stood on Floor 2 at 25% HP.
- **The allies never stuck at a doorway**: they trailed by about 2 m at every Stairs.
- **A build** is about 0.3 to 0.4 s here, about 1 s laptop-equivalent. That is a little over Stage 1's 0.24 s, as the slow test builds under load. It is warmed a Floor ahead, so the fade only reads the cache.

**Tests**:
- `npm run typecheck` is clean.
- `npm test`: **2544 passed, 5 skipped** (2464 before the Stage).
  - `delverRun.test.ts`: 36 tests.
  - `world.test.ts`: 6.
  - `delverAi.test.ts`: 5.
  - `delverPilot.test.ts`: 3.
  - New Delver cases in `delver.test.ts`, `replay.test.ts`, `devMode.test.ts`, `arenaWorlds.test.ts`, `hud.test.ts`, `inventoryView.test.ts`, `announcer.test.ts` and `delverMarks.test.ts`.
- `npm run test:slow`: 22 files and 38 tests passed, the new `delverRun.slow.test.ts` (2 tests) among them.
- The gauntlet flake did not occur in this Stage.

**In the game** (`npm run dev`, a headless browser on the Delver pilot with one AI ally, screenshots looked at):
- The Entrance faces its Passage.
- The Passages are 3 m stone corridors with doorway frames.
- The Rest Hall has its torch and ring, and "Rested" shows.
- The Stairs Hall glows (flat orange, no texture yet).
- The fade darkens over the party in the Stairs zone, and Floor 2 opens with its banner.
- The ally followed through every doorway.
- The software renderer ran at 8 to 15 fps, so the Run was "Slowed". Floor 1 took about 100 s of real time.
- The Floor change dropped to 2 fps for a frame. That is the drawn model being built, which happens during the fade.

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, add an AI ally or two, Fight. Add `&autopilot=1` to watch the pilot.
- Walk the Floor and find a fire. Fall on purpose (or let an ally fall) and see a fire bring them back.
- Open the Inventory (`I`) at a fire and away from one.
- Stand in the gold square to go down.

**To watch next**:
- **The fire's revive is spent at the first arrival, even when nobody has fallen** (the plan's rule, read literally). A party that passes a fire healthy loses its revive. This needs the user's call (below).
- **The camera still sits inside a doorway post now and then**, and the Stairs Hall's `glow` is a flat colour. Stage 5 does the art.
- **The Floor's model is built at the Floor change** (a frame's hitch inside the fade). Building it with the warm-ahead would remove it.
- **9 Floors at about 2 minutes each** for a pilot that goes straight to the fires and the Stairs. That is about 20 minutes before any fighting, within the plan's 30 to 45.
- **Stage 3** replaces the four Benched Team 1 slots with the Fighter Pool, and steps the Crowd under the Floor's own Tuning Data (`arenaTuning`: 2 m fields).

#### After the Stage (2026-11-13, the user's calls)
- **A fire's revive is spent only when it brings someone back.** The first living Player to reach a fire while any Team 0 Fighter has fallen revives them all, and only then is `restUsed[k].revived` set. A party that passes a fire with nobody fallen keeps that fire's revive for later.
- **A fire revives everyone fallen**: Players and AI allies alike, as built.
- **Online now, not in Stage 7.** The Delver Run is wired into the Lobby and the Rollback session ahead of its Stage:
  - **The Lobby**: `LobbySettings.delver?: true`, for the Gauntlet only. The host chooses it with a "Dungeon: Halls | Delver" row in the Map section, which shows only for the Gauntlet. It is synced to guests like the other settings (`src/lobby/messages.ts` checks it) and remembered in storage (`sword.delver`). `?dev=1&delver=1` still turns it on.
  - **The session**:
    - The host's Match options carry `delver: true`, and so does every hello a peer sends after the start, as `humans` does today.
    - `src/net/messages.ts` accepts and checks `MatchOptions.delver`, `MatchConfig.delver`, `MatchState.delver` and `SimState.delver` in a resync. A Delver state has `run` null, its Duel has no `hall`, and `duel.delver` mirrors the Run's floor, phase and away.
    - `PROTOCOL_VERSION` goes up by 1.
    - **Input Delay stays 0** for a Run. With no Crowd on a Floor yet, the Tick is a Duel's. Stage 7 measures it with Warbands, as ADR 0028 says.
  - **Tests**:
    - Loopback: two peers step a Delver Run with equal checksums. A resync state of a Delver Run passes the message check, and a malformed one fails.
    - Slow: two peers on Delver pilots go down a Floor with no desync.

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
