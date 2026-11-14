# Delver: the Run as one continuous dungeon per Floor

> Status: scope agreed (2026-11-12), the open questions answered by the user. Stage 0 done (2026-11-12): a go on large Floors (ADR 0028). Stage 1 done (2026-11-12): the Floor generator, judged over 500 seeds and viewable in the Map Editor. Stage 2 done (2026-11-13): a solo Delver Run on empty Floors, behind `?dev=1&delver=1`. Stage 3 done (2026-11-13): Warbands guard, patrol, chase and return on the Floors, promoted by an enemy-only Bubble; the first playable Run against them. Stage 4 done (2026-11-13): Warband drops and Treasure pedestals per Player, elite Warbands with Relics, and a Boss Floor ending each tier, its Stairs gated until the Boss Warband is wiped. Stage 5 done (2026-11-13): the Reveal (by entering) and the fog-of-war minimap and Floor Map, stand-in Stairs and pedestal art, the Floor HUD line, the Descending banner and a results screen with Floors reached, Warbands and Bosses beaten and each Build; the last Boss now wins at its Stairs, not at its wipe. Stage 6 is next. Builds on the Dungeon (`docs/plans/dungeon.md`, Stages 1 to 4 done), the Big Battle's Crowd, Squads and Bubble (`docs/plans/big-battle.md`, `docs/plans/battle-objectives.md`, ADRs 0020 to 0022) and the Map Editor's Map Source and Enclosure Brush (`docs/plans/map-editor.md`, ADR 0023). Each Stage ends with a `### Result`, as in the other plans.

## Progress
- [x] Stage 0: spike and ADR (one continuous Arena per Floor; budgets measured)
- [x] Stage 1: the Floor generator (rooms and passages on one level → Map Source → compiled Arena)
- [x] Stage 2: the Delver Run loop, solo (entrance, Stairs, Rest fires, revive, no enemies)
- [x] Stage 3: Warbands (Crowd Squads that guard, patrol, chase and return; enemy-only Bubble)
- [x] Stage 4: loot, Treasure Halls and Boss Floors
- [x] Stage 5: presentation (fog-of-war minimap and Floor Map, Stairs and fires, HUD)
- [ ] Stage 6: verticality (balconies, stairwells, sloped Passages, Jump shortcuts)
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
- **Fixed depth: three tiers of three Floors, a Boss at the end of each tier** (Tuning Data, `delver.tiers`, `delver.floorsPerTier`). Each tier's third Floor is a Boss Floor: its Stairs stand in the Boss Hall behind a gate that opens when the Boss Warband is wiped. There is a full heal after each Boss, and taking the third Floor's Stairs (open once its Boss is down) wins the Run. That is about 30 to 45 minutes a Run.
- **A Boss is a Warband like any other, promoted by the Bubble.** Its Encounter names the Boss (a Troop with its own Weapon, Body, Size, difficulty, Style, Relics and HP scale) and its guard. Two rules keep it a boss fight: the Boss Soldier always takes the first free Attack Slot in its Bubble (ahead of nearer guards), and it never demotes while a Player is in the Boss Hall.
- **Exploration is fog of war, shared by the party.** A Hall or passage is revealed on the minimap and the Floor Map (`M`) once any present Player's Fighter enters it or sees into it. Revealed parts stay revealed for the Floor. The Stairs, fires and Treasure Halls show once revealed. This reverses `dungeon.md`'s "the whole Floor map is shown", which made sense for a route graph but not for a dungeon you explore.
  - **The fog is on the maps only.** The 3D view draws the whole Floor as it is; nothing in the world is dimmed or hidden.
  - **What has been revealed is a bitset in `RunState`** (one bit per Hall and passage, hashed and snapshotted), not render-side memory. It costs a few bytes, keeps every peer's map the same, and survives a resync. Revealing never changes an outcome.
- **The Run seed stays the Random Map's**, as today: the Lobby, its online sync and the results screen already carry it, so a Delver Run needs no new Lobby setting. The Map's name gives the seed (`runSeed`); its arena is never used, since each Floor is generated.
- **Floors are large and have several levels.** Each Floor has 20 or more rooms at different heights, with balconies inside halls, stairwell Halls and sloped Passages between heights, using the multi-level walk rule. No two Floor elements (Halls, Passages) overlap seen from above (no bridge over a Passage, no Hall over another), so the flat Floor Map and minimap stay as they are (decided 2026-11-14). It takes 5 to 10 minutes. It is built one level first (Stage 1) and grown into levels in Stage 6, so the Run loop and Warbands are proven on flat Floors before verticality adds its own bugs.

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
  - **Done (2026-11-13).**
    - **What was built**:
      - The Lobby's "Dungeon: Halls | Delver" row (`LobbySettings.delver`).
      - `PROTOCOL_VERSION` 27.
      - The resync check of a Delver state. Its arenas must be the Floor's own, `floorArenaName(runSeed(config.arena), floor)`.
      - The revive spent only on a revive.
    - **Measured**:
      - Loopback: 400 Ticks with equal checksums, and a forced desync resyncs.
      - `src/net/delverCoop.slow.test.ts`: two peers on the pilot reached Floor 2 at Tick 7,808, with 0 resyncs. About 5,700 Rollbacks a peer at the harness's 40 ± 20 ms.
    - **Tests**: `npm test` 2558 passed, 5 skipped.
    - **Left as is**: the menu's preview behind the Lobby still shows a Hall-graph Hall.

### Stage 3: Warbands
**Model**: Opus (brains and fields).
- Encounters become Warband templates (`data/dungeon.json`). The generator's posts and loops are filled by a seeded pick per tier. The Crowd is deployed at the posts.
- Warband brain: Guard, Patrol, Chase, Return, morale fall-back. Destination fields go to posts and waypoints, and toward chased Players.
- Enemy-only Bubble: Promotion and Demotion and Attack Slots; nobody is promoted through a Wall or floor; and an unpromoted Soldier never hurts a Fighter (existing rule).
- Warband size grows with the humans (`delver.perPlayerSoldiers`); enemy max HP is scaled by tier only.
- **Done**: a solo Run is playable end to end against Warbands; a slow soak of AI-driven Runs shows no stuck Warbands (time out of place measured, as in battle-objectives Stage 3b).

#### Design
Stage 3 puts Warbands on the Floors: Crowd Squads of Team 1 Soldiers, deployed at the plan's posts and patrol loops, with a dungeon brain, promoted into the Fighter Pool by an enemy-only Bubble. A Battle, a Duel and a Hall-graph Run step exactly as before (every Battle hash and test unchanged): each new field is absent outside a Delver Run, and each shared function changes only where it reads a Floor's Crowd (`crowd.warbands` present).

**The Fighter Pool on a Floor.**
- **`config.teams`** of a Delver Run is Team 0's 1 to 4 Fighters only (all 0), the party, as a Battle's `teams` names only its Players. `createMatch` with `delver` accepts `teams` as Team 0's Fighters alone, or followed by exactly MAX_TEAM_SIZE Team 1 slots (the Lobby's Gauntlet Lineup still has them): it drops those slots, and cuts `weapons` and `sizes` to the party. `checkDelverTeams(teams)` (`match.ts`): 1 to MAX_TEAM_SIZE entries, all 0. `checkRunTeams` stays the Hall-graph Run's. `humans` and `players` are checked as now.
- **The Duel's Fighters** are the party in slots 0 to k−1 (k = `config.teams.length`, for good) and then `battle.bubble.poolSize − k` unbound slots (`unboundSlot(t, arena)`), as `createBattle` builds them. The Duel's `crowd` is the Floor's (below). `stepBubbles` is called with `players = k`.
- **The Lobby Lineup** is unchanged: a Gauntlet's Lineup keeps its 4 Team 1 slots, which a Delver Run ignores (Stage 8 drops them). `lineupMatch` is unchanged (`createMatch` drops the slots). `lineupAis(tuning, lineup, format, match)` takes `delver` in `match` (`Pick<MatchOptions, 'seed' | 'arena' | 'delver'>`): for a Delver Gauntlet it returns the party's entries as now (null for a Player, an Ally AI for an AI) and then a Pool AI (`createPoolAi`) for every slot k to poolSize − 1. No Hall AI. Every caller passes `delver` (`game.ts`, `play/driver.ts`, `net/session.ts`, the harnesses).
- **Hall AI**: a Delver Run has none (`hallAi.ts` unchanged; its `state.delver` idle branch stays for safety).
- **Replays**: `replaySetup` writes `config` as it is, so a replay carries the party-only `teams` and rebuilds through `createMatch`. A Stage 2 Delver replay still loads (its Team 1 slots are dropped) but re-simulates differently (no Warbands then): accepted, they were dev artefacts.
- **Online**: the Match state's shape changes (a Crowd and a Pool on a Delver state, party-only `teams`), so `PROTOCOL_VERSION` goes to 28.
  - `src/net/messages.ts`: a Delver state's Duel must have a Floor Crowd: `isCrowd(crowd, fighters.length)` (its existing checks, with `players` empty), plus `crowd.maxHp` (n positive numbers), `crowd.warbands` (`isWarbands`, below), `rout` null, `tickets` [0, 0], and the Pool and the Crowd agreeing on who is bound where (`isBattle`'s `boundRight` and `slotRight`, with `players` = the party's size and no Player record). `duel.fighters.length > config.teams.length` and at most `MAX_POOL` (64). A non-Delver, non-Battle state still has no Crowd. `isWarbands(v, squads)`: each array as long as `squads.team`, `mode` in 0..3, `post` and `patrol` ints ≥ −1 with exactly one of them ≥ 0, `leg` an int ≥ 0, `chased` an int in −1..3, `seen` an int ≥ −1, `size` an int 1..`MAX_SQUAD_PLACES`, `encounter` an int ≥ 0.
  - `src/net/session.ts`: `poolSlot(i)` is also true for a Delver Run's slots i ≥ k; a resync compares `config.teams` with the Lineup's Team 0 prefix for a Delver Run; no slot of a Delver Run holds Hall AI memory.

**The Floor's Crowd** (`SimState.crowd`, a `CrowdState` as a Battle's, every Soldier Team 1):
- **What it holds**: the Battle's per-Soldier arrays (x, z, surface, vx, vz, heading, hp, team, target, engage, alive, slot, sizeHeight, sizeThick, troop, look, squad, place), `squads` (one Squad per Warband, in Warband order), and:
  - `maxHp?: readonly number[]` (new, optional on `CrowdState`, present only on a Floor): each Soldier's max HP. A promoted Soldier's Fighter takes it (`fighterOf` in `bubble.ts`: `maxHp: c.maxHp?.[s] ?? troop.hp`).
  - `warbands?: WarbandState` (new, optional, present only on a Floor): the brains' state, entry q for Squad q.
  - The Battle-only parts stay off and are never stepped: `objectives` is `createObjectives([])` (none), `tickets` [0, 0], `rout` null, `players` [] (no Player records: no takeover of Soldiers, no Troop choice, no kill count). The Squads' `order` is all `DEFEND`, `target` all −1, `since` all 0, `respawnAt` all −1 (no Orders, no respawning).
- **`WarbandState`** (`src/sim/warband.ts`, plain arrays):
  ```ts
  export const GUARD = 0, PATROL = 1, CHASE = 2, RETURN = 3;
  export interface WarbandState {
    readonly mode: readonly number[];      // GUARD, PATROL, CHASE or RETURN
    readonly post: readonly number[];      // its post (plan.markers.posts index), or -1 for a patrol
    readonly patrol: readonly number[];    // its loop (plan.markers.patrols index), or -1 for a guard
    readonly leg: readonly number[];       // a patrol's waypoint (index into its points) it walks to or returns to; 0 for a guard
    readonly chased: readonly number[];    // the party Fighter (Pool slot) it chases, or -1
    readonly seen: readonly number[];      // the Tick it last saw `chased`, or -1
    readonly size: readonly number[];      // Soldiers it deployed with (its morale counts from this)
    readonly encounter: readonly number[]; // its template's index in its tier's guard or patrol pool
  }
  ```
  A Warband's **home** is its post (`plan.markers.posts[post]`) for a guard, its loop's point `leg` for a patrol. The squads' `fall` (1 while falling back) and `shape` are the Squad's as in a Battle.
- **Where Warbands deploy** (`deployWarbands`, below): a guard at each filled post (the post's Hall centre), a patrol on each filled patrol loop. The plan's posts are never in sight of the entrance spawns (Stage 1's judge) and its loops avoid the Entrance and the in-line Halls.
- **The step**: `stepDelver` steps a Floor as `stepBattle` steps a Battle, under `t = arenaTuning(tuning, arena)`: `stepBubbles(duel, k, tick, t, intents)`, then `step(…, t)`, then `stepCrowd(crowd, tick, t.battle, crowdFighters(…), battleMapOf(t.battle, arena), brain)` where `brain` is the Warband brain bound to the Floor's homes and `tuning.delver`. `stepBattle`'s building of the `CrowdFighter` list moves into `crowdFighters(duel, bubbled, players, away)` (`battle.ts`, exported), shared by both. Kills are not counted and Tickets not charged on a Floor (no `countKills`, no `chargeDeaths`).
- **`step.ts`**: a Duel with a Crowd skips `updateDuel` today. A Floor's Duel must still end on a wipe, so `updateDuel` runs when `!state.crowd || state.delver !== undefined`, with the Hall flag (Team 0 wiped) for a Floor.
- **`stepCrowd`** (`crowd.ts`) gains a last optional parameter `brain?: SquadBrain`:
  ```ts
  export type SquadBrain = (crowd: CrowdState, tick: number, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[]) => SquadStep & { readonly warbands: WarbandState };
  ```
  With a `brain` (a Floor): it replaces `stepSquads`; the Objectives, Tickets, Commanders and Rout block is skipped; nothing respawns; the result carries `maxHp` and the brain's `warbands`. Without one, all is as now.
  - **The due loop** becomes `for (let i = 0; i < n; i++) if (crowdDue(i, tick, stagger, armySize) && inCrowd(crowd, i))`. For a Battle (n = 2 × armySize) that is the same Soldiers in the same order (Team 0's due ones ascending, then Team 1's), so every Battle hash is unchanged; a Floor's Crowd of any size steps a 1/stagger share per Tick.
  - **A walled-off Soldier** (its place not walkable from where it stands) walks down `toward`'s best destination field in a Battle. On a Floor the brain's `SquadStep.lead?: readonly (DestinationFields | null)[]` gives, per Squad, the one field its anchor follows this Tick (home's, or the chased Fighter's, as a one-destination `DestinationFields`, d = 0); `stepCrowd` descends that instead when `lead` is present.
  - **The waiting ring on a Floor** (`fillRings`, when `crowd.warbands`): a Soldier waits for a Bubble only within `bubble.promote` of it by walking (below), and the spots are `ringSpots(…, 3 × waiting)` kept in order only where `inSight(fields, f.x, f.z, sx, sz, crowd.separation / 2, f.y, f.y)`, the first `waiting` of them handed out as now; a waiting Soldier with no spot left keeps its Formation place.
  - `SquadStep` gains `lead?` (optional; never set in a Battle).
- **`squad.ts`**: the brain must not copy `stepSquads`. Two parts move out as exported helpers, a pure refactor (Battle bit-identical): `closeRanks(members, crowd, alive, editPlace)` (the rear rank stepping up into the lowest free places) and `walkAnchors(battle, map, team, x, z, heading, surface, aim, speed)` (every anchor turns toward its aim and walks, out of blocks, onto its Walk Surface by the walk rule). `stepSquads` calls them; so does the Warband brain. `squadNarrows`, `formationSpot` and `placeOffset` are reused as they are (a Floor's `target` −1 makes `inCircleShare` 1).
- **Hashed and snapshotted**: the whole Crowd with the Match, as a Battle's. Its size: about 60 to 120 Soldiers × 19 numbers, 10 to 16 Squads × 14 and × 8 Warband numbers, about 2,500 numbers, a fifth of a 400-Soldier Battle's. The soak prints `hashValue` and `snapshot` times a Tick. Not in the state: the plan, the homes, the static home fields and the chase fields (caches below).

**The fields** (`src/sim/destinations.ts`):
```ts
/** distanceTo, kept: the field to the node of (x, z) on Walk Surface s, built once per (f, node) and kept (FIELDS_KEPT, most recently used last). The caller must not change it. */
export function fieldToward(f: DestinationFields, x: number, z: number, s = -1): Float64Array;
/** f with `field` as its only destination (d = 0), for steerToward, descend and fieldDistance. */
export function oneField(f: DestinationFields, field: Float64Array): DestinationFields;
export const FIELDS_KEPT = 64;
```
- Keyed by the point's node (`nodeAt` on a map of several levels, `cellAt` on one level; −1 gives an all −1 field, kept too), in a module `WeakMap<DestinationFields, Map<number, Float64Array>>`, LRU. `distanceTo` depends only on that node, so a kept field equals a fresh `distanceTo` entry for entry: a cache derived from static data, never in the state, and a Rollback reads the same.
- Used for each Warband's **home field** (static: about 15 posts and 10 loop points a Floor, read every brain step so they stay kept), each **chased** Fighter's field and each **Bubble's** field (rebuilt when that Fighter changes node: about 0.3 ms at 2 m, Stage 0, a few a second).
- 64 fields × 13,500 nodes × 8 bytes is about 7 MB at most.

**Warbands from Encounters** (Tuning Data `data/delver.json`, `src/tuning/delver.ts`; the Hall-graph Encounters in `data/dungeon.json` stay the Hall-graph Run's):
```json
"sight": 16, "leash": 45, "forgetSeconds": 8, "chaseSpeed": 1, "closeIn": 4, "arrive": 3,
"postFill": 75, "patrolFill": 100, "perPlayerSoldiers": 1.5, "attackSlots": [4, 3, 3, 3], "tierHp": [1, 1.25, 1.5],
"warbands": [ { "guard": [ <template>, … ], "patrol": [ <template>, … ] }, … one per tier ]
```
- A **template** is `{ "troops": [ { "troop": "<battle.troops name>", "count": n }, … ], "hpScale": h }`: its Soldiers are each listed Troop's `count`, in list order, the first Troop its rank and file. Its brain is the pool it is listed in (guard or patrol).
- The bundled pools (three tiers, two to four templates a pool, 3 to 8 Soldiers each): tier 1 mostly Levy with a Halberdier; tier 2 adds Swordsmen; tier 3 Brutes and Swordsmen. Patrols are 3 to 5 strong, guards 4 to 8.
- **Parse checks** (`parseDelver(raw, fieldSize, battle)` now takes the parsed Battle Tuning for its Troop names and `squad.size`):
  - `sight`, `leash`, `forgetSeconds`, `chaseSpeed`, `closeIn`, `arrive` positive;
  - `postFill`, `patrolFill` whole 0 to 100; `perPlayerSoldiers` ≥ 0;
  - `attackSlots` exactly MAX_TEAM_SIZE (4) whole numbers ≥ 1, with (b + 1) × attackSlots[b] + (b + 1) ≤ `battle.bubble.poolSize` for each b (the party and its Bubbles' slots fit the Pool);
  - `tierHp` and `warbands` exactly `tiers` long, `tierHp` positive;
  - every pool non-empty; every Troop name one of `battle.troops`; every `count` whole ≥ 1; a template's total 1 to `battle.squad.size`; `hpScale` positive.
- **The Floor's slots**: `delverBattle` (`build.ts`) also sets `slots: { enemies: attackSlots[0], allies: 0, engaged: battle.slots.engaged, shared: attackSlots.slice(1).map((e) => ({ enemies: e, allies: 0 })) }`, so each Bubble holds `attackSlots[bubbles − 1]` Attack Slots and no ally slot.
- **The pure picks** (`src/sim/delver/warbands.ts`; seed `s = runSeed(config.arena)`, the Floor `f`; salts `WARBAND_SALT` in that file: postOrder 20, patrolOrder 21, guardPick 22, patrolPick 23, extra 24, height 25, thick 26, look 27):
  - **Which posts and loops**: posts ordered by `runPick(s, f, post, postOrder, 2^32)`, ties the lower index; the first `ceil(posts × postFill / 100)` are filled, taken back in post order. Loops the same with `patrolFill` and `patrolOrder`.
  - **Warband order**: the filled posts' guards first (post order), then the filled loops' patrols (loop order). q is that index, and Squad q.
  - **The tier** of Floor f is `ceil(f / floorsPerTier)`. A guard's template is `guard[runPick(s, f, post, guardPick, guard.length)]`, a patrol's `patrol[runPick(s, f, loop, patrolPick, patrol.length)]` of its tier's pools.
  - **Party size**: `extra = perPlayerSoldiers × (config.humans − 1)`, then per Warband `floor(extra) + (runPick(s, f, q, extra, 100) < round(100 × frac(extra)) ? 1 : 0)` more Soldiers of its first Troop, the total held to `battle.squad.size`. `config.humans` is fixed at the start, so an AI Takeover changes nothing.
  - **HP**: each Soldier's max HP (and HP) is `troop.hp × template.hpScale × tierHp[tier − 1]`; no `perPlayerHp` and no `depthHp` in a Delver Run.
  - **Each Soldier** (index i in the Crowd, Warbands in order, each Warband's Soldiers in template order): Size: height `lo + (hi − lo) × runPick(s, f, i, height, 1001) / 1000` over its Troop's `height` range (1 when it has none), thick the same over `width` (`thick`), then `clampSize`. Look: `runPick(s, f, i, look, bodies)` with `bodies` the Troop's Team 1 Bodies (`troopBodies(troop, 1).length`).
- **Placing them**: a Warband's anchor stands at its home: a guard at its post, facing its **guard facing** (the side of its Hall, in the order n, e, s, w, whose Passage leads to the neighbour Hall of least `depth`: the way the party comes; the facings 0, π/2, π, −π/2 as `SIDE_FACING`); a patrol at its loop's **start point** (the first point whose Hall is not a Fight Hall and not the Stairs, else point 0), `leg` the next point, facing it (the point after is straight along x or z from it, so the facing is one of the four, by sign; no trig). Soldier p stands at the anchor plus `placeOffset(battle, COLUMN, p, facing, out)`, heading the facing. Every `surface` (Soldier and anchor) is `groundOf(battle, field, x, z, 0)` (the floor, never the roof). Mode GUARD or PATROL, `chased` −1, `seen` −1, `size` its count, `fall` 0, shape COLUMN, `living` its count.
  ```ts
  /** The homes the brain reads (derived from the plan, never state): each post with its guard facing, each loop's points. */
  export interface WarbandHomes { readonly posts: readonly { x: number; z: number; facing: number }[]; readonly patrols: readonly (readonly { x: number; z: number }[])[] }
  export function warbandHomes(plan: FloorPlan): WarbandHomes;
  /** The Floor's Crowd at its start: its Warbands deployed (pure, from the Run seed, the Floor and `humans`). */
  export function deployWarbands(tuning: TuningData /* the Floor's arenaTuning */, plan: FloorPlan, field: Battlefield, seed: number, floor: number, humans: number): CrowdState;
  ```
  `warbandHomes` is cached per plan (a `WeakMap<FloorPlan, WarbandHomes>`), derived and never stored.

**The Warband brain** (`stepWarbands(crowd, tick, battle, map, fighters, homes, rules)` in `src/sim/warband.ts`, `rules` the `delver` Tuning keys above; it is the Floor's `SquadBrain`):
- It runs every Tick: the brains due think, then every anchor walks (`walkAnchors`). Warband q thinks on Ticks where `q % brainTicks(battle) === tick % brainTicks(battle)` (2 Hz, `squad.brainSeconds`). It reads the Soldiers and Fighters as they stood at the start of the Tick.
- **Each due Warband**, in Squad order:
  1. Count `living` (alive, promoted ones included) and the centroid of its Soldiers in the Crowd; `closeRanks`. A Warband with none living is **wiped**: it stands (speed 0) and never thinks again. Nothing respawns, so it stays dead for its Floor.
  2. `broken` = `living < squad.moraleThreshold × size[q]`.
  3. **Sight**: the party Fighters it sees, `S`: each Team 0 Fighter in play (a Player's or an AI ally's: the AI allies are the party too, or an ally walking alone to the Stairs would pass every Warband) that one of its living Soldiers sees: from the Soldier's place (in the Crowd: x, z at `soldierHeight`; promoted: its Fighter's position and y), the Fighter within `rules.sight` flat, its feet less than `levels.height` above or below, and `inSight(fields, sx, sz, fx, fz, 0, sy, fy)` (both heights given, so the Floor's Walls count). Computed only when the mode reads it (step 4).
  4. **The transitions** (`arrive` = `rules.arrive`, flat, and on its level):
     - **GUARD**: if `!broken` and S is not empty → **CHASE**: `chased` the Fighter of S nearest its anchor (flat; the lower slot on a tie), `seen` = tick. Else it holds: away from home, it walks back (as in RETURN, but at once GUARD); at home, aim the post's guard facing (a patrol's broken remnant: the facing it has), speed 0.
     - **PATROL**: if `!broken` and S is not empty → CHASE as above. If `broken` → GUARD (it holds the point `leg`). Else at point `leg` (within `arrive`) `leg = (leg + 1) % points`; it walks to point `leg`.
     - **CHASE**:
       - `broken` → **RETURN** with `fall` 1;
       - else if `chased` is no longer in play (fallen, or no party Fighter) → CHASE the nearest of S if any, else RETURN;
       - else if `chased` is in S → `seen` = tick; else if S holds another → `chased` = the nearest of S, `seen` = tick;
       - then `tick − seen ≥ secondsToTicks(forgetSeconds)` → RETURN (**forgetting**);
       - else the **Leash**: its walking distance from home (the home field read at its anchor, `fieldDistance(oneField(…), 0, ax, az, as)`) over `rules.leash`, or unreached → RETURN. For a patrol, home is the nearest of its loop's points by walking (the least of their fields at the anchor, the lower index on a tie);
       - else it follows: `field = fieldToward(fields, fx, fz, fs)` for the chased Fighter (fs = `groundOf(battle, field, fx, fz, fy)`); within `rules.closeIn` of it by that field it halts (speed 0) facing it (shape LINE); else `aim = steerToward(oneField(fields, field), 0, ax, az, fx, fz, 1, as, fs)`, speed `crowd.walkSpeed × rules.chaseSpeed` (0 while its Soldiers lag, `squad.lag`, as a Battle's).
       - On entering RETURN, `chased` −1, `seen` −1, and a patrol's `leg` becomes its loop's nearest point by walking (the lower index on a tie): it rejoins its loop there.
     - **RETURN**: it is deaf (S is not read). It walks to home by the home field (`steerToward(oneField(fields, home field), 0, …)`) at `crowd.walkSpeed × squad.speed`, LOOSE while `fall`, else COLUMN. At home (within `arrive`): `fall` 0, and GUARD for a guard or a broken patrol, PATROL for a patrol.
     - Walking home or along a loop it steers the same way at `walkSpeed × squad.speed` and is COLUMN; LOOSE while `fall`.
  5. `lead[q]` = the one field its anchor followed this step (the home field, the waypoint's or the chased Fighter's); the home field while it stands (it is at home, or halted near its quarry, so that field still leads to it); null once wiped. (Amended in review: the Design first said null while it stands.)
- The home fields, the waypoint fields and the chase fields all come from `fieldToward` (each home's point on the floor's Walk Surface).
- **The Tuning Data keys and defaults**: `sight` 16 m, `leash` 45 m (walking: about one and a half Halls), `forgetSeconds` 8, `chaseSpeed` 1 (× `crowd.walkSpeed`, 2.5 m/s; Guard, Patrol and Return walk at `squad.speed` 0.8 of it), `closeIn` 4 m, `arrive` 3 m, `postFill` 75, `patrolFill` 100, `perPlayerSoldiers` 1.5, `attackSlots` [4, 3, 3, 3], `tierHp` [1, 1.25, 1.5].

**The enemy-only Bubble** (`bubble.ts`; Floors only, read from `crowd.warbands` being present):
- **Who has a Bubble**: every party Fighter in play (slots 0 to k − 1: the Players' and the AI allies'). There is no Player record, so nobody takes over a Soldier, and `crowd.players` is empty.
- **No ally slots**: there are no Team 0 Soldiers, and the Floor's slots give `allies` 0, so the ally loops find nobody. Every other Pool slot is for an enemy.
- **Attack Slots**: each Bubble holds `attackSlots[bubbles − 1]` (4 solo, 3 each with 2 to 4 Bubbles in use: 12 with a party of four, which with the 4 party slots fills the 16-slot Pool).
- **Promotion and Demotion go by walking distance on a Floor, not across the ground.** The **walk** from a point to a Bubble is its field (`fieldToward` to the Bubble's Fighter's node, `fs` from `groundOf(…, f.y)`) read at the point on its Walk Surface (`fieldDistance`), Infinity where unreached. On a Floor it stands in for the flat distance everywhere the Bubble measures one: which Bubble a Soldier or promoted Fighter counts in (`nearestCentre`, `bubbleOf`), `promotable` (within `bubble.promote`), a Waiting Fighter taking a slot back (within `promote`), the fill order (nearest first), the slot-holders past a Bubble's share, and Demotion (`farFromAll`: further than `demote` from every Bubble).
  - **Why walking distance, not line of sight**: a Warband in the next Hall, 8 m away through a Wall, is a long walk away, so it is neither promoted nor sent to the ring, which is the risk the plan names. A Soldier just round a doorway post, out of sight but two steps away, is promoted, as it should be: it is about to reach the Player. Line of sight would leave it a Soldier at sword's length, and a doorway is where Floors fight. The fields are already built for the chase, and Stage 6's floors come with them (a node per level).
- **An unpromoted Soldier never hurts a full Fighter**: the existing rule (Soldiers strike only Soldiers, and a Floor has no Team 0 Soldier). A test checks it on a Floor.
- **What the AI allies fight**: promoted enemies only (the AI's enemies are the Fighters in play). The **Ally AI** on a Floor, while Exploring and in play: if a promoted enemy (Team 1, bound, in play) stands within `bubble.promote` of it flat and on its level, it is its AI (`this.ai.intent`: it fights); else it follows the nearest Player, or walks to the Stairs, as in Stage 2.
- **The Delver pilot** is taught to fight the same way: a promoted enemy within `bubble.promote` flat and on its level → its AI fights; else its route (fires, then Stairs). It does not go round Warbands: it walks through, the Soldiers keep out of its hold, and the Bubble promotes those near it, which it fights until they fall or demote. Its memory is unchanged.
- **The Pool AI** drives every enemy slot as in a Battle (its Troop's difficulty, `battle.soldier.style`; a Waiting Fighter waits at the ring and demotes, since no ally ever engages it).

**Formations in 3 m Passages and doorways.** `formationNarrow` already narrows a Formation to the files the clearance ahead holds (`narrow.room` 3, `ahead` 6): in a 3 m Passage the clearance at the centre line is 1.5, so a Warband walks it in single file, centred on its anchor (`placeOffset` with `narrow`), a column of 8 about 10.5 m long. Nothing new is added for Warbands to begin with. The measurement decides: the soak's patrol case (below) times each leg of every loop with no party, and prints the share of Soldier-steps more than 3 m from their place, per leg. If a leg takes more than twice its walking time at `squad.speed`, or a Soldier stays more than 6 m from its place for over 10 s, a Floor-only `narrow.room` (in `delverBattle`) is tried at 2 and 1.5 and the best is kept; the Result records which.

**Input Delay online.** Stage 2 left Delver Runs at 0. The soak prints the Tick by bound slots, and the slow coop test (two peers, Warbands) measures each Rollback: the Ticks it re-simulates and its ms (p50, p99, max). **The rule**: a Delver Run takes `BATTLE_INPUT_DELAY` online if a Rollback's p99 there is over 5 ms (a 60 fps frame's third at the ×3 laptop factor), else it stays at 0. The orchestrator applies the outcome (`game.ts`, where the session is made) and records the numbers.

**Tests.**
- **Existing tests that change**:
  - `src/sim/delverRun.test.ts`:
    - "the start" is rewritten: the party in slots 0 to k − 1, unbound slots to the Pool's size, the Floor's Crowd deployed (no Benched Team 1).
    - Every case that steps a Floor and asserts on the party alone (the Stairs dwell, the fade, the heal, the revive, the Inventory gate, a wipe, the Victory, a Takeover) runs on an empty Floor: a Tuning with `postFill 0` and `patrolFill 0`, which still has a Crowd of no Soldiers. Their expectations stay.
    - Its `teams` options keep their Team 1 slots, which `createMatch` drops.
  - `src/controllers/delverAi.test.ts`, `delverPilot.test.ts`: unchanged on an empty-Floor Tuning; new fight cases are added.
  - `src/controllers/delverRun.slow.test.ts` (Stage 2's empty-Floor walk, which needs a Revive and a Rested on every Floor): kept on the empty-Floor Tuning, with its prints.
  - `src/net/delverRun.test.ts` and `delverMessages.test.ts`: the malformed-state cases gain Crowd ones; the loopback runs with Warbands (the default Tuning). `src/net/delverCoop.slow.test.ts`: with Warbands, and it measures Rollbacks.
  - `src/editor/replay.test.ts`: its Delver replay case runs with Warbands.
  - `src/tuning/delver.test.ts` and `tuning.test.ts`'s `goodRaw()`: the new keys.
  - Removed: none. The Hall-graph Run's tests (`dungeonRun.test.ts`, `gauntlet.soak.test.ts`, `takeover.test.ts`, the Door and Floor Map tests) stay as they are.
- **New fast tests** (one or more each):
  - deploy at posts and patrols;
  - Warband sizes by party (humans 1 to 4), and HP by tier;
  - every brain transition;
  - the Leash, Return and forget rules;
  - a wiped Warband stays dead;
  - no Promotion through a Wall, and Promotion round a doorway;
  - a Soldier does not hurt a Fighter on a Floor;
  - Attack Slots by Bubbles;
  - Demotion;
  - the fires and the Stairs with enemies about;
  - `fieldToward` equal to `distanceTo`, kept, and evicted;
  - Battles unchanged (the existing Battle hash tests pass as they are);
  - a deterministic replay across a Floor change with Warbands (same Intents, same hash every Tick), and a snapshot restored before a Promotion re-simulating the same.
- **The slow soak** (`src/controllers/warbandSoak.slow.test.ts`), Tuning `tiers 1, floorsPerTier 3`, five Run seeds, one Player on the Delver pilot (Hard) and two Hard AI allies:
  - It prints, per Floor: Warbands deployed, met (a Soldier of it promoted), chased, wiped and returned (home again after a Chase); each Warband's time out of place (from leaving GUARD or PATROL to being back in it: count, mean, max); the Tick (mean, p99, max) by bound slots (0, 1 to 4, 5 to 8, 9 to 12); `hashValue` and `snapshot` ms a Tick; the Floor build, and the home and chase field builds (count and ms).
  - A second case, the **patrols**: every loop of the five seeds' Floor 1, no party (the party standing in the Entrance, out of sight), 120 s: each leg's seconds and its walking time at `squad.speed`, and the Soldiers out of place (as in the Formation rule above).
  - **It must show it exercised**, else fail: Promotions, Chases, Returns, a Warband wiped, a Patrol completing its whole loop, and **no Warband stuck**: no time out of place over 150 s, no RETURN over 60 s, no patrol leg over 60 s.

**Amended after the soak (Task 6), before the Stage closed:**
- **Regroup.** The soak found two patrols frozen for good: the anchor had walked through a doorway onto the next Enclosure's floor, its Soldiers could not follow it round the doorway post, and since they lagged (`squad.lag`) the anchor stood for ever. So a Warband whose Soldiers lag, with at least one of them in the Crowd, has its anchor put back where its in-Crowd Soldier nearest the anchor (flat, the lower index on a tie) stands, on that Soldier's Walk Surface, at each brain step it lags. It then walks on from there, so a Warband always goes at its Soldiers' pace and can never leave them behind a Wall. No new state.
- **Warbands walk through one another.** The regroup did not free the two patrols: the real block was another Warband. A patrol's loop point sat on a guard's post, the guard's single file stood in the doorway of a Passage, and Soldiers of two Squads of one Team push each other apart, so the patrol queued behind it for ever. On a Floor a Soldier is no longer pushed apart from (or crowded by) a Soldier of another Warband: Soldiers of its own Warband, and enemies, still are. Two Warbands may overlap when a patrol crosses a guard. Battles are unchanged.
- **When a Return happens.** A Warband whose Soldiers reach the party has them all promoted, and an Attack Slot's Fighter fights until it falls or the party gets out of `demote` by walking. Its anchor stands meanwhile (every Soldier is promoted), so a fought Warband is wiped rather than returning. Returns happen when the party walks away before contact: Fighters and Soldiers both walk at 2.5 m/s, so the Leash or forgetting ends the chase. The soak shows it with a scenario of its own, "a chase given up": a Player in sight of a guard at 14 m walks away by the navmesh, never within `promote`.
- **The slow coop test** runs with `postFill 25`. Two pilots with no AI allies against Warbands sized for two humans lose by attrition on the full Floor. That is balance, a playtest question, not the netcode the test checks.

**Tasks** (one after another; 4 and 5 may run together, their files being disjoint):
1. Tuning, the Floor's Crowd at its start, and the field cache: `data/delver.json`, `src/tuning/delver.ts` (+ `index.ts` call), `build.ts` slots, `destinations.ts` (`fieldToward`, `oneField`), `src/sim/warband.ts` (types and constants only), `src/sim/delver/warbands.ts` (`warbandHomes`, `deployWarbands`), `CrowdState.maxHp` / `warbands` types.
2. The Crowd, Squads and Bubble on a Floor, and the brain: `crowd.ts` (due loop, `brain`, `lead`, the Floor's ring), `squad.ts` (`closeRanks`, `walkAnchors`), `bubble.ts` (walking distance, `maxHp`), `warband.ts` (`stepWarbands`), their tests.
3. The Run with Warbands: `match.ts` (teams), `delverRun.ts` (Pool, Crowd, the step), `battle.ts` (`crowdFighters`), `step.ts` (the wipe), `lineup.ts`, `allyAi.ts`, `delverPilot.ts`, `game.ts` and `play/driver.ts` (passing `delver`), the rewritten and new Run tests, replay and determinism.
4. Online: `messages.ts`, `session.ts`, the harnesses, `PROTOCOL_VERSION` 28, the loopback tests and the slow coop test with its Rollback measurement.
5. Drawing Warbands in a Delver Run: the Crowd's impostors and the Promotion swaps in the Duel's view (as `battleScreen.ts` does them), and anything in the HUD, camera or minimap that reads a Crowd as a Battle.
6. The soak.

### Result
Done 2026-11-13. A Delver Run is now played against Warbands. Every Floor deploys a Crowd of Team 1 Soldiers in Squads at its posts and on its patrol loops. They guard, patrol, chase a party Fighter they see, and walk home past the Leash or once they forget. An enemy-only Bubble promotes the ones within walking reach into the 16-slot Fighter Pool, where they fight as full Fighters. Battles, Duels and the Hall-graph Run are unchanged: every Battle hash and test from before still passes.

**What was built** (as the Design gives it, with the changes below):
- **Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`):
  - the brain's keys: `sight`, `leash`, `forgetSeconds`, `chaseSpeed`, `closeIn` and `arrive`;
  - `postFill`, `patrolFill`, `perPlayerSoldiers`, `attackSlots` and `tierHp`;
  - `warbands`: three tiers of guard and patrol templates made of the Battle's Troops.
  `parseDelver` checks them against `battle.troops`, `squad.size` and the Pool's size. `delverBattle` gives a Floor its own Attack Slots and no ally slots.
- **The Floor's Crowd** (`deployWarbands`, `warbandHomes` in `src/sim/delver/warbands.ts`):
  - It is a pure deployment from the Run seed, the Floor and `config.humans`.
  - A seeded share of the posts and loops is filled.
  - Each Warband's template is picked per tier.
  - Each Warband is bigger by `perPlayerSoldiers` per human after the first, rounded by a pick.
  - Max HP is the Troop's × the template's `hpScale` × the tier's `tierHp` (`CrowdState.maxHp`).
  - Each Soldier's Size and look are picked.
  - `CrowdState.warbands` holds each brain's mode, post or loop, leg, chased Fighter, last-seen Tick, size and template.
- **The Warband brain** (`stepWarbands`, `warbandBrain` in `src/sim/warband.ts`):
  - It thinks at 2 Hz and runs Guard, Patrol, Chase and Return, with sight by `inSight` on its level within `sight`.
  - A chase follows the chased Fighter's destination field and ends past the Leash (walking from home), after `forgetSeconds` unseen, or when it breaks below morale (Return, loose).
  - A wiped Warband stays dead.
  - It steps through `stepCrowd`'s new `brain` hook, which on a Floor replaces `stepSquads` and leaves out the Objectives, Tickets, Commanders, Rout and respawns.
  - `closeRanks` and `walkAnchors` are shared with `stepSquads` (a pure refactor).
- **Kept fields** (`fieldToward` in `src/sim/destinations.ts`): `distanceTo` kept per node, 64 per map, least recently used first out. Home, chase and Bubble fields all come from it, as `walkField` and `walkDistance` (`crowd.ts`).
- **The enemy-only Bubble** (`bubble.ts`, on a Floor):
  - Every party Fighter has a Bubble.
  - Every distance the Bubble measures is the walk: Promotion, Demotion, which Bubble a Soldier counts in, the fill order and the waiting ring.
  - The ring's spots are only those in sight of the Fighter.
  - A promoted Soldier takes its `maxHp`.
  - There are no Player records, so no Soldier is taken over.
- **The Run** (`delverRun.ts`, `match.ts`, `step.ts`, `battle.ts`):
  - A Delver Run's `config.teams` is the party. `createMatch` drops a Lineup's Team 1 slots, and `checkDelverTeams` checks the rest.
  - The Duel is the party, then unbound Pool slots, plus the Floor's Crowd.
  - `stepDelver` steps the Bubbles, the Duel and the Crowd under `arenaTuning`, building the Crowd's view of the Fighters with the shared `crowdFighters`.
  - A Floor's Duel still ends on a wipe.
- **The AI**:
  - `lineupAis` gives a Delver Run Pool AIs past the party and no Hall AI.
  - The Ally AI and the Delver pilot fight a promoted enemy within `promote` (`promotedNear`), else follow or walk their route.
- **Online**:
  - `PROTOCOL_VERSION` 28.
  - The resync check knows a Floor's Crowd (`isFloorCrowd`, `isWarbands`), and the session checks it against the Floor (`warbandsFit`).
  - Pool AIs run past the party, and the Lobby Lineup's Team 1 prefix is compared.
  - **Online Delver Runs take `BATTLE_INPUT_DELAY`** (below).
- **Drawing** (`src/play/floorCrowd.ts`, `src/play/floorBodies.ts`):
  - The Crowd is drawn as impostors in the Duel's view, from atlases baked once a Run in the background.
  - Promotions crossfade (`BubbleSwap`).
  - Promoted enemies are drawn in their Troop's Body and Team 1's colour.

**Changed from the Design:**
- **Regroup** (found by the soak): a Warband whose Soldiers lag has its anchor put back on its nearest in-Crowd Soldier. Without it an anchor could walk through a doorway its Soldiers could not follow, and stand there for good.
- **Warbands walk through one another** (found by the soak):
  - A patrol's loop point sat on a guard's post, and the guard's single file stood in a Passage doorway.
  - Soldiers of two Squads of one Team push each other apart, so the patrol queued behind the guard for ever.
  - On a Floor, Soldiers of different Warbands no longer push each other apart.
- **Returns happen only before contact**:
  - A fought Warband has all its Soldiers promoted, and an Attack Slot's Fighter fights until it falls or the party walks out of `demote`, so its anchor stands until it is wiped.
  - Fighters and Soldiers both walk at 2.5 m/s, so a Warband returns only when the party walks away before it closes.
  - In the five AI Runs every Warband that chased was wiped. The soak shows Returns with a scenario of its own.
- **`lead` while standing** is the home field, not null (from the code review).
- **From the code review**:
  - the Warbands are checked against the Floor at resync;
  - promoted enemies are drawn in their Troop's Body;
  - the pilot marks a fire reached while fighting at it;
  - the final-blow shot draws the Crowd of the shot's moment;
  - there is one way to build a walk field, `lead` is lazy, and the Bubble's walks are cached per step.
- **The slow coop test** runs its Warbands case with `postFill` 25 (below).
- **The Lobby's Delver note** no longer says "No enemies yet".

**Measured** (the test container, about 3× a mid-range laptop):
- **The soak** (`src/controllers/warbandSoak.slow.test.ts`):
  - Setup: 5 Run seeds, 1 tier × 3 Floors, the Delver pilot (Hard) with two Hard AI allies.
  - All 5 Runs were Victories, in 506 to 838 s.
  - Warbands: 168 deployed, 67 met (promoted), 73 chases, 67 wiped, 5 returns (from the "chase given up" scenario), 35 whole patrol loops.
  - Time out of place: 67 excursions, mean 30.5 s, max 64 s. No Return took over 60 s and no patrol leg over 60 s.
  - The party was held by a promoted enemy for 55 to 85% of each Floor.

  | Bound Pool slots | Tick mean (ms) | p99 | max |
  |---|---|---|---|
  | 0 | 0.33 | 2.01 | 61 |
  | 1–4 | 0.62 | 3.17 | 33 |
  | 5–8 | 0.98 | 3.55 | 9.9 |

  - Over all 197,147 Ticks: mean 0.51 ms, p99 2.93 ms. `hashValue` 0.75 ms mean (p99 3.3), `snapshot` 0.14 ms (p99 0.3).
  - A Floor builds cold in 271 ms (max 451). There are about 198 field builds a Floor, at 0.5 ms each.
- **Formations in 3 m Passages**: no Floor-only `narrow.room` was needed.
  - The patrols test walked every loop of 9 patrols, 72 legs, with no party. Every leg took 10 to 26 s, within 1 to 3 s of its walking time.
  - 0 to 5% of Soldier-steps were more than 3 m from their place, and no Soldier was ever more than 6 m out.
  - The Battles' `narrow.room` 3 puts a Warband in single file in a Passage, and it walks it.
- **Rollbacks** (`src/net/delverCoop.slow.test.ts`, two peers on the pilot, the harness's 40 ± 20 ms):

  | | ms per Rollback p50 | p99 | max | re-simulated Ticks p50 / p99 |
  |---|---|---|---|---|
  | Warbands (`postFill` 25) | 1.33 | 9.26 | 19.7 | 3 / 5 |
  | Empty Floors | 0.78 | 5.59 | 78.5 | 3 / 5 |

  Both runs had 0 resyncs. A Rollback's p99 is over the Design's 5 ms rule with Warbands, so **online Delver Runs take `BATTLE_INPUT_DELAY`** (3 Ticks), each peer from the Lobby's setting.
- **Two pilots alone lose.**
  - In the coop test, two Hard pilots with no AI allies, against Warbands sized for two humans, are worn down on Floor 1, even at `postFill` 25.
  - The Bubble refills the Attack Slots about as fast as they kill.
  - With `postFill` 25 they lose at Tick 9,829. On the bundled Tuning they were still fighting at Tick 20,000, and in the soak's replica of that party they lost at 293 s.
  - That is balance, for the playtest. The coop test still checks the netcode (no desync, equal checksums), and as before it accepts a Run that ends as reaching its end.

**Tests**:
- `npm run typecheck` is clean.
- `npm test`: **2679 passed, 5 skipped** (2558 before the Stage). The new files:
  - `warbands.test.ts` (15)
  - `fieldToward.test.ts` (6)
  - `warband.test.ts` (15)
  - `floorBubble.test.ts` (7)
  - `delverWarbands.test.ts` (13)
  - `floorCrowd.test.ts` (5)
  - `drawColours.test.ts` (3)
  - `floorBodies.test.ts` (1)

  New cases in `delver.test.ts`, `delverRun.test.ts`, `delverAi.test.ts`, `delverPilot.test.ts`, `delverMessages.test.ts` and the net `delverRun.test.ts`.
- `npm run test:slow`: 24 files and 44 tests passed, including the new soak (5 tests). Stage 2's empty-Floor slow test now runs on a Tuning with no Warbands (`postFill 0, patrolFill 0`), as do the Stage 2 Run tests that check only the party.

**In the game** (`npm run dev`, a headless browser at 4 to 8 fps, "Slowed"; the Delver pilot with one Expert AI ally; screenshots looked at):
- A guard Warband stands in its Hall at the end of a Passage, drawn as impostors in Team 1's blue (`docs/plans/delver-stage3/guard.png`).
- As the party comes into its Hall, it is promoted: full models in their Troops' Bodies, Halberdiers and Levies (`docs/plans/delver-stage3/promoted.png`).
- Fights happen in the 3 m Passages, single file, the Warband strung along the Passage behind its front (`docs/plans/delver-stage3/passage-fight.png`).
- The fire in its Rest Hall, ringed (`docs/plans/delver-stage3/fire.png`).
- The party took Floor 1's Stairs in about 3.5 minutes of real time. On Floor 2 it met a Warband in a Hall, the Player fell at 44 HP after a long fight, the ally fought on alone and fell too: a Defeat at 5:44, "Floors cleared 1 / 9".
- **Not captured**: a Return (by design it happens only when the party walks away before contact, which the pilot never does; the soak's "chase given up" shows it), and a fire with enemies near.
- **The camera** (not new, but Warbands make it show): it sits inside a Wall or a doorway post, or in a Fighter's head in a crowded Passage, in about a fifth of the frames, and a fallen Player's orbit camera often sits in the floor.

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Dungeon: Delver, add an AI ally or two, Fight.
- Walk into a guarded Hall, and fight the Warband in its doorway or out in the Hall.
- Let a patrol find you in a Passage. Then walk away from a Warband before it reaches you, and see it give up and go home.
- Find out how many Warbands a Floor can take before you need a fire, and whether to skip some.
- Try two humans online: Warbands grow by 1 or 2 Soldiers each, and the Input Delay is now 3 Ticks.

**To watch next**:
- **Balance.** The solo pilot with two Hard allies won all five soak Runs, but with one Expert ally it lost on Floor 2, and two pilots alone lose by attrition: the Bubble refills the Attack Slots about as fast as the party kills, and the party is held by a fight 55 to 85% of a Floor. The knobs are `postFill`, the templates, `attackSlots`, `perPlayerSoldiers`, `tierHp` and the Troops' Mods (promoted Soldiers deal half damage, as in a Battle).
- **Fought Warbands never return.** All their Soldiers get promoted and fight to the end. If the party should be able to break off, a promoted Fighter whose Warband Returns could be demoted.
- **The camera in Passages** (above).
- **A patrol may cross a guard's post**, and the two overlap there (Warbands walk through one another). The generator could keep loop points off posts.
- **Impostors appear a few seconds into a Run** while the atlases bake.

#### After the Stage (2026-11-13, the user's calls)
- **Balance is the user's**, by hand. Later Stages make no balance passes: they keep the Tuning Data as it is unless a Stage needs a new key.
- **A fought Warband fights to the end.** Its promoted Fighters are not pulled back when it Returns.
- **The camera in Passages** is left as it is for now.
- **Patrol loops may cross guards' posts**, as now. The two Warbands overlap there.

### Stage 4: loot, Treasure Halls and Boss Floors
**Model**: Sonnet.
- A wiped Warband drops one item per Player where its last Soldier fell. Treasure Halls hold pedestals (pick 1 of 3). Elite Warbands carry Relics and drop them.
- Boss Floors: the Boss Hall with the Stairs behind its gate; the Boss Warband, its Boss Soldier first into an Attack Slot and never demoted while a Player is in the Hall; the gate opens when it is wiped; a full heal after the Boss.
- **Done**: a full three-tier Run with bosses; loot tests per Player are deterministic.

#### Design
Stage 4 adds loot and Bosses to a Delver Run. Warbands drop items when they are wiped. Treasure Halls hold pedestals from the Floor's start. Some guards are elite and wear Relics. Every tier's last Floor is a Boss Floor: its Stairs stand in a Boss Hall and count only once the Boss Warband is wiped. A Battle, a Duel and a Hall-graph Run step exactly as before. Non-Boss Floors come out of the generator byte for byte as today.

**Words.**
- A **Boss Floor** is Floor f with `f % floorsPerTier === 0`, when its tier has a Boss Encounter.
- The **Boss Hall** is a Boss Floor's Stairs Hall, of kind `'Boss'` instead of `'Stairs'`.
- The **Boss Warband** is the Warband at its post. Its **Boss Soldier** is that Warband's first Soldier.
- An **elite** Warband is a guard from its tier's elite pool.
- A Warband's **rank** is 0 for a plain one, 1 for an elite and 2 for the Boss.

**1. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`). The new keys and their defaults:
- **`elitePosts`**: 1. A whole number ≥ 0: how many of a Floor's filled posts hold an elite.
- **`warbands[i].elite`**: the tier's elite pool, a list of templates. It may be empty, and then that tier has no elites. Each elite template also has `relics`: 1 or 2 names from `data/relics.json`, which its Soldiers' promoted Fighters wear. `WarbandTemplate` gains `relics: readonly string[]`. The parse gives `[]` when the key is absent, and refuses a `relics` key in a guard or patrol pool.
  - The flag the brief asked for is the pool itself, just as the guard and patrol pools mark a template's brain.
  - The defaults copy `data/dungeon.json`'s Elites:
    - tier 1: `[{ relics ["Whetstone"], troops [Halberdier 1, Levy 2], hpScale 1.5 }]`;
    - tier 2: `[{ ["Whetstone"], [Swordsman 1, Halberdier 1], 1.5 }, { ["Heavy Gauntlet", "Glass Cannon"], [Swordsman 1, Levy 2], 2 }]`;
    - tier 3: `[{ ["Heavy Gauntlet", "Glass Cannon"], [Swordsman 1, Brute 1, Halberdier 1], 2 }]`.
- **`warbands[i].boss`** is optional. Absent means that tier has no Boss: its last Floor is an ordinary Floor, and on the last tier its Stairs are the Victory, as in Stage 2. Its shape:
  ```json
  "boss": { "troop": { "name": "Warden", "base": "Brute", "weapon": "Sledge Hammer", "body": "monk", "height": 1.3, "width": 1.3,
                       "difficulty": "Skilled", "style": "Aggressive", "relics": [], "hpScale": 2.5 },
            "guard": [ { "troops": [ { "troop": "Levy", "count": 2 } ], "hpScale": 1 } ] }
  ```
  - `base` is one of `battle.troops`, and gives the Boss Soldier's Crowd stats.
  - `weapon` is a Weapon roster name, `body` a non-empty string, and `height` and `width` lie in MIN_SIZE to MAX_SIZE.
  - `difficulty` is one of `ai.difficulties` and `style` a key of `ai.styles` (no `"random"`). `relics` holds 0 to 2 Relic names, and `hpScale` is positive.
  - `guard` is a non-empty pool of plain templates. A guard's Soldiers plus the Boss may number at most `battle.squad.size`.
  - The defaults copy `data/dungeon.json`'s Bosses:
    - tier 1: Warden, `base` Brute, Sledge Hammer, monk, 1.3 × 1.3, Skilled, Aggressive, no Relics, 2.5; its guard is 2 Levy.
    - tier 2: Duelist, `base` Swordsman, Arming Sword, prince, 1.1 × 1.1, Expert, Counter, no Relics, 2.5; its guard is Swordsman 1 and Halberdier 1.
    - tier 3: Wraith Lord, `base` Brute, Sledge Hammer, wraith, 1.4 × 1.4, Expert, Aggressive, `["Heavy Gauntlet"]`, 3; its guard is Swordsman 1, Halberdier 1 and Brute 1. Dungeon's tier 3 Style was `"random"`, and Aggressive replaces it.
  - `parseDelver(raw, fieldSize, battle, names)` gains `names: { weapons, difficulties, styles, relics }`, all string lists, which `src/tuning/index.ts` passes as it does to `parseDungeon`.
- **Drop counts** reuse `dungeon.loot.drops`: `Fight` (1) for a plain Warband, `Elite` (1) for an elite, `Boss` (2) for the Boss. `loot.weights` and `loot.pedestals` are reused too. No other key is new. There is no balance pass.

**2. Floor Troops** (`src/sim/delver/troops.ts`, pure, cached in a `WeakMap` per `(battle, delver)` objects, never state):
```ts
export interface FloorTroops {
  readonly troops: readonly TroopTuning[];               // battle.troops, then each tier's Boss Troop, then the elite Troops
  readonly boss: readonly number[];                      // per tier: its Boss Troop's index, or -1
  readonly elite: readonly (readonly (readonly number[])[])[]; // [tier][elite template][row]: that row's Troop index
}
export function floorTroops(battle: BattleTuning, delver: DelverTuning): FloorTroops;
export function tierOf(delver: DelverTuning, floor: number): number;      // min(tiers, max(1, ceil(floor / floorsPerTier)))
export function isBossFloor(delver: DelverTuning, floor: number): boolean; // floor % floorsPerTier === 0 && warbands[tierOf - 1].boss !== undefined
```
- **The order.** `battle.troops` come first, at their own indices. Then comes one Boss Troop per tier that has a Boss, in tier order. Then the elite Troops: for each tier, each elite template, then each of its rows, one Troop each.
- **A Boss Troop** is `{ ...base, name, weight: 1, bodies: [body], teamBodies: undefined, height: [h, h], width: [w, w], weapon, difficulty, mods: {}, style, relics, boss: true }`.
  - `mods: {}` means **a promoted Boss does not take the Battle's "promoted Soldiers deal half damage" Mod** (`battle.soldier.mods`). It fights at a full Fighter's strength, as the Hall-graph Boss did, plus its Relics.
- **An elite Troop** is `{ ...battle.troops[row.troop], name: name + ' (elite)', relics: template.relics }`. It keeps its base's Mods (the half damage) and wears the Relics on top.
- `TroopTuning` (`src/tuning/battle.ts`, the type only, never parsed from `battle.json`) gains three optional fields:
  - `style?: string`, a Style name. A Pool AI plays it instead of `battle.soldier.style`.
  - `relics?: readonly string[]`, worn by a promoted Soldier.
  - `boss?: true`.
- `delverBattle` sets `troops: floorTroops(battle, delver).troops`. A Floor's Crowd indexes its Troops in that list, so `troopOf`, the Bubble, `warbandsFit` and the Pool AI read them through `arenaTuning`. The Battles' `battle.troops` is never touched.

**3. The generator: Boss Halls** (`src/sim/delver/plan.ts`, `source.ts`, `judge.ts`, `generate.ts`, `version.ts`):
- `planFloor(t, seed, floor, attempt, boss = false)`. `delverFloor` passes `isBossFloor(tuning.delver, floor)`. Everything below happens only when `boss` is true and `stairs !== entrance`, and decides nothing by a new pick. So with `boss` false the plan is the very same object graph as today: no new field and no new key. `DelverHallKind` gains `'Boss'`.
- **Step 7, Kinds**:
  - **The kind.** The Stairs Hall (the furthest by walking) gets kind `'Boss'` instead of `'Stairs'`. `plan.stairs` still names it, and every later rule that skips the Stairs Hall (Rest's `other`, Treasure, Fight and Empty) skips it the same way.
  - **Grown to the largest it may be**, for room to fight a Boss Warband:
    - `hw = offDots(min(halfSize[1], limX), cx, limX)`, and `hd` the same with `limZ`, computed for its cell as in step 2.
    - Then each Passage with `a` or `b` the Boss Hall gets its `rect` again by step 5's formula. Doors, `length` and depth are unchanged, since depth is from centre to centre.
    - This is the step that changes a Boss Floor's bytes, and it never reaches a neighbour, since `limX` and `limZ` already keep every Hall apart.
- **Step 9, Markers**: `DelverMarkers.boss?: MarkerPoint` is the Boss Hall's centre, present on a Boss Floor only. The Stairs zone is the same centre ± 2. A Boss Floor keeps every other marker. `SALT` is unchanged: the Boss Hall makes no pick. The picks the Boss does need are Warband picks (`WARBAND_SALT.elitePick` 28 and `bossGuard` 29, below). They come after every existing pick, and the Floor number decides first whether any is made.
- **The source**:
  - `HALL_MATERIAL.Boss = 'glow'`, since the Boss Hall holds the Stairs.
  - A `boss` prop (a banner, team 1) at `markers.boss` goes last in `look.props`.
  - The Objective `E` and the Base still stand at `plan.stairs`'s centre.
- **The judge**:
  - **rooms**: a plan with a Boss Hall must have exactly one, it must be `plan.stairs`, and it must have no `'Stairs'` Hall. A plan without one must have one Stairs Hall, as now, with the message unchanged.
  - **markers** and **sight** treat `markers.boss` as a post named `boss`: inside its Hall, reached, and not in sight of the entrance spawns.
- `describeFloor` names the Boss Hall `Boss hallY` where it names the Stairs. The patrol start in `deployWarbands` skips `'Boss'` Halls as it skips `'Stairs'`.
- **`DELVER_VERSION` 3**, since Boss Floors' bytes change.
- **The golden pins**:
  - The Floor 9 pins are rewritten. Floor 9 is a Boss Floor under the bundled Tuning.
  - New pins are added at Floor 3 for the same four seeds.
  - A new case builds Floor 9 under a Tuning with tier 3's `boss` removed. It must give **the old Floor 9 pins exactly** (`a6bc473c`/`b7ed1574`, `5e7b9eb5`/`2ec47849`, `0ee8578e`/`14e11d8b`, `39a62be6`/`b556e6a8`). That proves non-Boss Floors are byte-identical.
  - The Floor 1 pins stay as they are.
- **`plan.test.ts`** gains a case over 200 seeds and Floors 1 to 9: `planFloor(…, true)` equals `planFloor(…, false)` once the Boss changes are undone (the kind put back to Stairs, the Hall's and its Passages' rects, and `markers.boss` removed). On Boss plans it checks that the Boss Hall is `plan.stairs`, holds the Stairs zone and `markers.boss`, has `hw` and `hd` at the most `limX` and `limZ` allow, and touches no other Hall or Passage.
- **`delverGen.slow.test.ts`** must also show it exercised Boss Halls: its pairs fall on Floors 3, 6 and 9, and every one of them has a Boss Hall.

**4. Warbands: elites and the Boss** (`src/sim/delver/warbands.ts`, `src/sim/warband.ts`):
- **`WarbandState.rank: readonly number[]`**: 0 plain, 1 elite, 2 Boss, with `PLAIN`, `ELITE` and `BOSS` exported from `warband.ts`. It is hashed and snapshotted with the Crowd. For a rank 1 Warband `encounter` indexes the elite pool, and for rank 2 the Boss's `guard` pool.
- **Elites**: the filled posts are ordered by their Hall's `depth`, deepest first, the lower post index on a tie. The first `elitePosts` of them take `elite[runPick(s, f, post, WARBAND_SALT.elitePick, elite.length)]` instead of their guard pick, when the pool is not empty, at rank 1.
  - Each Soldier of row r is of Troop `floorTroops(...).elite[tier − 1][encounter][r]`.
  - The party's extras are of the first row's elite Troop.
  - Max HP is `troop.hp × hpScale × tierHp × (1 + relicShare)`, where `relicShare` is the `maxHp` share of the folded Relics (`relicMods(tuning, relics).maxHp`).
- **The Boss Warband**, on a Boss Floor only, is appended last, after the patrols, so every other Warband keeps its index and its picks:
  - **Post and home.** Its post is `posts.length`. `warbandHomes(plan).posts` gains the Boss post at that index (its facing `guardFacing` of the Boss Hall) on a Boss Floor only.
  - **Its Soldiers.** Its guard template is `boss.guard[runPick(s, f, 0, WARBAND_SALT.bossGuard, guard.length)]`. The Boss Soldier is Soldier 0 (place 0), of Troop `boss[tier − 1]`. The guard's rows follow, and the party's extras are of the guard's first Troop, never another Boss.
  - **Max HP.** The Boss Soldier's is `tuning.fighter.maxHp × boss.hpScale × (1 + relicShare)`, with no `tierHp`: each tier's Boss has its own `hpScale`, so 250, 250 and 300 as in the Hall-graph Run. The guard's is as any guard's.
  - **Size and look.** The Boss Soldier's Size is its fixed `height` and `width`, and its look is 0.
  - **Its brain** is a guard's (GUARD, then CHASE on sight, and so on).
- **`warbandsFit`** also checks:
  - `rank`'s length, and that each entry is 0 to 2;
  - at most one rank 2, and only on a guard at post `home.posts.length − 1` on a Boss Floor;
  - every `encounter` inside its pool.

**5. The Bubble on a Boss Floor** (`src/sim/bubble.ts`):
- **Relics**: `troopMods` folds a Troop's `relics`' effects (from `tuning.relics`) with its `mods`: `foldMods([{ effects: t.mods }, ...relics])`. Battles are unchanged, since their Troops have no `relics`.
- **`stepBubbles(duel, players, tick, tuning, intents, boss?: BossHold)`**, where `BossHold` is `{ readonly soldier: number; readonly hold: boolean }`. Absent, or with `soldier` −1, everything is as now. With it:
  - **First into a slot.** In a Bubble's fill, whoever stands for the Boss Soldier sorts first, ahead of any nearer guard: its Soldier, or its promoted Fighter when that is Waiting. It still must be `promotable` (within `promote`, by walking) into that Bubble.
  - **Never the one let go.** In the share trimming (`nearestIn(b, 'Attack')`) the Boss's Fighter sorts first, so it is never the one whose slot goes.
  - **Never demoted while held.** While `hold`, the Boss's Fighter neither demotes as far from every Bubble nor as a Waiting Fighter.
- **`stepDelver` builds the `BossHold`**:
  - `soldier` is the lowest Crowd index whose Squad is the Warband of rank 2, or −1.
  - `hold` is true when some present Player's Fighter (`presentPlayers`, `inDuel`, hp > 0) stands inside the Boss Hall's `rect`, edges included and flat. It is a pure test, and the first such Fighter in index order settles it.
- **The Pool AI** (`poolAi.ts`) reads Troops under `arenaTuning(tuning, state.arena)`. It plays the Troop's `style` when it has one, else `battle.soldier.style`, and keeps one AI per (difficulty, Style).

**6. Loot** (`src/sim/delverLoot.ts`, pure; `src/sim/pickups.ts`):
- **`pickItemAt(tuning, seed, floor, slot, avoid): Dropped`** is exported from `pickups.ts`. It is `pickItem`'s body with the slot given. `pickItem` calls it, so the Hall-graph Run is bit-identical.
- **`lootSlot(source, index, player, k) = ((index × 4 + player) × 16 + k) × 2 + source`**, where `source` is 0 for a Warband's drop and 1 for a Treasure Hall's pedestal, and `index` is the Warband q or the Treasure Hall's ordinal. It throws unless 0 ≤ k < 16 and 0 ≤ player < 4.
- **`warbandLoot(tuning, crowd, q, player, seed, floor): Dropped[]`** gives one Player's items from Warband q:
  - **The carried Relic** comes first: the first of the template's `relics` (rank 1) or of the Boss Troop's (rank 2), when there is one, as `carriedRelics` does it.
  - **Then the picks**: `loot.drops.Fight`, `Elite` or `Boss` by rank. Pick k is `pickItemAt(…, lootSlot(0, q, player, k), items so far)`.
- **`dropSpots(plan, x, z, count): PickupAt[]`** gives `count` spots near the fall point, y 0 (Floors are one level until Stage 6):
  - **The rect.** R is the first Hall rect, then Passage rect, holding (x, z), edges included. If none holds it, R is the nearest by clamped distance (Halls first, then the lower index).
  - **The spots.** Shrink R by `DROP_MARGIN` 0.75 m. The base is (x, z) clamped into it. Candidate j is the base moved along R's longer side by 0, +1.2, −1.2, +2.4, −2.4, … m (`DROP_GAP` 1.2), then clamped. A candidate within 1.1 m of a spot already taken is skipped. After 16 candidates the spots found are reused in turn.
  - So no drop lies in a Wall or the abyss, and two never share a spot.
- **`warbandDrops(tuning, config, plan, crowd, q, fall, seed, floor, firstId, away): Pickup[]`**: for each present Player p (`presentPlayers(config, away)`, ascending), its items at `dropSpots(...)[k]`, owner p, ids from `firstId` on. Every Player's k-th item lies on the same spot k, and each sees only its own (`pickupVisibleTo`), as pedestals do. An away Player and the AI allies get none.
- **`treasurePickups(tuning, config, plan, seed, floor, away): Pickup[]`**, the pedestals:
  - Treasure Halls go in `markers.pedestals` order, three markers each, and t is a Hall's ordinal.
  - For each present Player p of each Hall, `loot.pedestals` items lie at that Hall's markers k mod 3, from `pickItemAt(…, lootSlot(1, t, p, k), …)`, in one `group` per (Hall, Player). Taking one closes the rest for that Player only.
  - They lie from the Floor's start: `enterFloor(run, floor, plan, pickups)` takes them, and both `createMatch` and the fade to the next Floor pass `treasurePickups`.
- **The wipe** (`stepDelver`, every Tick while Exploring, after the Crowd's step):
  - **When.** Warband q, not yet in `run.wiped`, is wiped once no Soldier of its Squad is `alive` in the stepped Crowd.
  - **Where it fell.** The fall point is the Crowd x, z of the lowest-index Soldier of q that was alive in `match.duel.crowd` (before the Tick). With none, it is q's lowest Soldier. The Bubble writes a promoted Fighter's position back to its Soldier when it falls, so this is where the last one fell, Fighter or Soldier.
  - **Then.** Its drops are appended (`firstId` = `pickups.length`), q joins `wiped` (ascending), and an event `WarbandWiped { type, warband: q, rank, at }` is sent. Warbands are visited in index order.
- **Lifetime**:
  - Pickups belong to the Floor. `enterFloor` starts the next Floor with only its pedestals, so whatever lies untaken is gone after the Stairs.
  - Taking is allowed anywhere while Exploring (`takePickups`, as now). The Inventory still changes only at a fire.
  - The AI allies never take: they hold no Inventory.
- **The Delver pilot** (`delverPilot.ts`) walks, before its fires, to the nearest pickup it sees (`pickupVisibleTo`) and has room for (`addItem` not null). Nearness is a straight line, the lower id on a tie, and it stops 0.2 m short. Its fight rule comes first, as now. Its memory is unchanged. It reads the pickups from `SimState.delver.pickups` (below).

**7. The Boss rules** (`stepDelver`):
- **The gate is a rule.** On a Boss Floor the Stairs count only once the Boss Warband is in `wiped`. Until then `stairsTicks` stays 0. The Arena, navmesh and fields never change at runtime.
- **The wipe of a Boss Warband** that is not the last tier's:
  - Every living Team 0 Fighter (Players and AI allies) heals to its max HP (`Rested { fighter, healed }`).
  - Every fallen Team 0 Fighter is revived at the Stairs zone's centre plus the fire's offsets (`REVIVE_DX` and `REVIVE_DZ` by its rank among the revived), at **full** max HP (`Revived { fighter, fire: -1 }`). This shares a `reviveFallen` helper with the fires.
  - An event `BossBeaten { type, floor }` is sent.
  - This is the "full heal after each Boss": at the wipe, so the party goes on full.
- **The last tier's Boss Warband wiped is a Victory at once**, not on its Stairs, as beating the last Boss won the Hall-graph Run:
  - `status Over, winner 0`, and the Duel ends with `DuelEnd`;
  - `score[0] + 1`;
  - `BossBeaten`, then `RunEnd { winner: 0, cleared: floors, floors, halls: 0, bosses }`.
  - The drops are still laid in that Tick, but nobody plays on.
- **`RunEnd.bosses?: number`** (Delver only): the Bosses beaten. That is the Boss Floors before the current Floor, plus 1 when the current Floor's Boss is in `wiped`. A pure `bossesBeaten(delver, run)`. A Defeat carries it too.
- **The dev start Floor**:
  - `devDelverStart(search, hash): { delverStart?: number }` (`src/devMode.ts`), from `delverStart` ≥ 1, with `dev=1` only.
  - `game.ts`'s `launch()` adds it to a solo Delver Gauntlet's options, as it adds `devRunStart`.
  - `MatchConfig.delverStart?: number`. `createMatch` refuses it without `delver`, or outside 1 to `floors`. It starts the Run on that Floor (`floorDuel(…, delverStart, null, …)`, `duelNumber` = it, `score [delverStart − 1, 0]`). The Floor is built from (Run seed, Floor) as any other.
  - It is never set online: `src/net/messages.ts` refuses a config or options carrying it.

**8. The state** (all plain data, hashed with the Match and snapshotted; every new field is absent outside a Delver Run):
- `DelverRun.wiped: readonly number[]`: the Warbands (Squad indices) whose wipe was seen this Floor, ascending. `enterFloor` gives `[]`. The gate reads it.
- `DelverRun.pickups` now holds the drops and the pedestals too.
- `WarbandState.rank` (above).
- `SimDelver.pickups: readonly Pickup[]`: the Run's pickups mirrored for the Controllers (the pilot), the same array object. `mirrored()` carries it, and `stepDelver` re-mirrors when its reference changes.
- `MatchConfig.delverStart?` (dev, solo).
- **Not in the state**: `floorTroops`, `warbandHomes`, the drop spots and the `BossHold`, all derived each Tick or cached.
- **Online**:
  - `PROTOCOL_VERSION` 29.
  - `isWarbands` checks `rank`.
  - `isDelverRun` checks `wiped`: ascending, distinct whole numbers below the Crowd's Squad count.
  - `isSimDelver` checks `pickups`, and `isDelverFloor` checks that the mirror equals the Run's pickups.
  - `delverStart` is refused.
  - The online Delver Run's loopback and resync tests stay green.

**9. Presentation** (render-only; Stage 5 does the art):
- **The gate.** `DelverMarks` draws a gate round the Stairs square on a Boss Floor: closed bars while the Boss Warband is not in `wiped`, open (sunk) once it is. It reads only the Run.
- **Pickups.** Drops and pedestals are already drawn (`pickupViews` over `delver.pickups`). A pedestal pickup is drawn on top of its crate prop, not inside it.
- **Atlases.** The impostor atlases are baked from `floorTroops(...).troops`. An elite Troop shares its base's atlases, since it has the same Bodies and Weapon. A promoted Boss is drawn in its Body and Size.
- **The HUD**:
  - announcements "Boss beaten: the gate opens" (`BossBeaten`) and, for the local Player, "Loot dropped" (a `WarbandWiped` that laid one of its items);
  - the results line adds "Bosses b / B" (B the tiers with a Boss) from `RunEnd.bosses`.

**10. Existing tests this Stage rewrites** (only these, and only as said):
- **`golden.test.ts`**: the Floor 9 pins, as above.
- **Tests that take the last Floor's Stairs to a Victory** run on a Tuning with every tier's `boss` removed (`noBosses(tuning)`, a helper in the test). Their expectations stay. These are `delverRun.test.ts` "the last Stairs are a Victory" and any other case that reaches a Boss Floor's Stairs, `src/controllers/delverRun.slow.test.ts`, and the Stage 3 cases of `warbandSoak.slow.test.ts`.
- **A Stage 3 test that pins one Warband's Soldiers** and breaks only because the deepest post is now elite runs with `elitePosts: 0`. The task lists each one.
- **`tuning.test.ts`'s `goodRaw()`** gains the new keys.
- No test is removed.

**11. The soak** (`src/controllers/warbandSoak.slow.test.ts`, a new case): a full Run of the bundled 3 tiers × 3 Floors, one Run seed, one Player on the Delver pilot (Hard) with two Hard AI allies.
- **What it prints, per Floor**: Warbands deployed, met and wiped, by rank; drops laid and taken; pedestals taken; the Boss's Promotion Tick, the Attack Slot it took, its wipe and the gate; the seconds; the Tick (mean, p99).
- **It must show it exercised**, else fail:
  - on each of Floors 3, 6 and 9, the Boss Soldier promoted before any other Soldier of its Warband, and the Boss Warband wiped;
  - the gate opened (Stairs taken on 3 and 6);
  - at least one Warband drop taken and one pedestal taken;
  - at least one elite wiped with its Relic dropped;
  - the Victory at Floor 9's Boss.
- **If the pilot cannot win on the shipped Tuning**, the case runs on a test Tuning that says what it changed (`postFill` lower, or an Expert pilot). The Result reports it. There is no rebalance.

**Tasks** (one after another):
1. **Tuning, Floor Troops and the generator**:
   - Tuning: `data/delver.json`, `src/tuning/delver.ts` (+ `index.ts`'s call), `TroopTuning`'s optional fields, `tuning.test.ts`'s `goodRaw()`, and `src/tuning/delver.test.ts`.
   - Floor Troops: `src/sim/delver/troops.ts` and its test, and `build.ts` (`delverBattle`'s troops).
   - The generator: `plan.ts`, `source.ts`, `judge.ts`, `generate.ts` and `version.ts`, with the plan, judge, golden and slow generator tests.
2. **Warbands and the Bubble**:
   - `warbands.ts` (elites, the Boss Warband, homes, `warbandsFit`, the patrol start) and `warband.ts` (`rank`);
   - `bubble.ts` (Relics, `BossHold`), `poolAi.ts`, and `delverRun.ts`'s call to `stepBubbles`;
   - `messages.ts` `isWarbands` and `PROTOCOL_VERSION` 29;
   - their tests.
3. **Loot**: `delverLoot.ts`, `pickups.ts` (`pickItemAt`), `delverRun.ts` (`wiped`, drops, pedestals, mirror), `match.ts` (`createMatch`'s `enterFloor`, `WarbandWiped`), `state.ts` (`SimDelver.pickups`), `delverPilot.ts`, `messages.ts` (`wiped`, pickups mirror), and their tests.
4. **The Boss rules**: `delverRun.ts` (the gate, heal, revive, Victory, `bossesBeaten`), `match.ts` (`BossBeaten`, `RunEnd.bosses`, `delverStart`), `devMode.ts`, `game.ts`, and `messages.ts` (`delverStart` refused). It also rewrites the Victory tests and `delverRun.slow.test.ts` onto no-Boss Tuning, and adds its tests.
5. **Render and HUD**: `delverMarks.ts`, the pickup marks, the Floor Crowd's atlases and `floorBodies.ts`, the HUD and announcer, and their tests.
6. **The soak**: `warbandSoak.slow.test.ts`.

### Result
Done 2026-11-13. A Delver Run now has loot and Bosses.
- Every wiped Warband drops items for each present Player where its last Soldier fell.
- Treasure Halls hold per-Player pedestals from the Floor's start.
- One guard a Floor is elite and wears Relics.
- Every tier's last Floor is a Boss Floor. Its Stairs stand in a Boss Hall and count only once the Boss Warband is wiped. The wipe heals and revives the party in full. The third Boss's wipe wins the Run.

Battles, Duels and the Hall-graph Run are unchanged. Non-Boss Floors are byte-identical to Stage 3's: the old Floor 9 golden pins come out exactly under a Tuning with no tier-3 Boss.

**What was built** (as the Design gives it, with the changes below):
- **Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`):
  - `elitePosts` (1);
  - each tier's `elite` pool (templates with 1 or 2 Relics, taken from `dungeon.json`'s Elites);
  - each tier's optional `boss`: the Warden (Brute, Sledge Hammer, 2.5), the Duelist (Expert, Counter, Arming Sword, 2.5) and the Wraith Lord (Expert, Sledge Hammer, Heavy Gauntlet, 3), each with a small guard.
  - Drop counts reuse `dungeon.loot.drops`, and Floor Troops are capped at `MAX_FLOOR_TROOPS` (64).
- **Floor Troops** (`src/sim/delver/troops.ts`):
  - `floorTroops` and `floorTroopLayout` list the Battles' Troops, then one Boss Troop per tier, then one elite Troop per elite row. `delverBattle` gives a Floor that list.
  - A Boss Troop has no Mods, so **a promoted Boss does not take the half damage** promoted Soldiers deal. It has its own Style, Relics and fixed Size.
  - An elite Troop keeps its base's Mods and wears its template's Relics.
  - `TroopTuning` gains `style`, `relics` and `boss`.
- **Boss Halls** (`plan.ts`, `source.ts`, `judge.ts`; `DELVER_VERSION` 3):
  - On a Boss Floor the Stairs Hall is of kind `'Boss'`, grown to the largest its gaps allow, its Passages re-rected, with `markers.boss` at its centre and a Team 1 banner.
  - The judge checks the Boss Hall and its post like a post.
  - There is no new pick, and nothing changes when `boss` is false.
- **Warbands** (`warbands.ts`, `warband.ts`):
  - `WarbandState.rank`: plain, elite or Boss.
  - The deepest filled post holds an elite.
  - On a Boss Floor the Boss Warband is appended last. Its Soldier 0 is the Boss, at `fighter.maxHp × hpScale` (250, 250, 300), followed by its guard.
  - `warbandsFit` checks ranks, pools and that a Boss Floor holds exactly one Boss.
- **The Bubble** (`bubble.ts`, `BossHold`):
  - Promoted Soldiers wear their Troop's Relics.
  - The Boss Soldier sorts first into a free Attack Slot and is never the one let go.
  - While a present Player stands in the Boss Hall (by its rect), the Boss is never demoted.
  - The Pool AI plays a Troop's own Style.
- **Loot** (`src/sim/delverLoot.ts`):
  - `lootSlot`, `warbandLoot`, `dropSpots`, `warbandDrops` and `treasurePickups`, all pure.
  - `pickItemAt` was split out of `pickItem`, and the Hall-graph Run is bit-identical.
  - `DelverRun.wiped`, a `WarbandWiped` event, and `SimDelver.pickups` (the Run's pickups mirrored for the Controllers).
  - Drops lie in the Hall or Passage holding the fall point, 0.75 m inside its Walls and at least 1.1 m apart. Every Player's k-th item lies on the same spot, and each sees only its own.
  - The Delver pilot walks to the pickups it sees and has room for, before its fires.
- **The Boss rules** (`delverRun.ts`):
  - `gateOpen` keeps the Stairs from counting until the Boss Warband is wiped.
  - At that wipe the living party heals to full (`Rested`), the fallen stand up at the Stairs at full HP (`Revived`, fire −1), and `BossBeaten` is sent. The fires share the revive helper.
  - The last tier's Boss wipe is a Victory at once.
  - `RunEnd.bosses` comes from `bossesBeaten`.
  - The dev start Floor: `?dev=1&delver=1&delverStart=N` (`MatchConfig.delverStart`, solo only, refused online).
- **Online**: `PROTOCOL_VERSION` 29.
  - The resync checks `rank`, `wiped` and the pickups mirror.
  - A Floor Crowd's Troop indices are bounded by `MAX_FLOOR_TROOPS`.
  - The Pool AI's memory records its Style.
- **Presentation**:
  - A ring of bars round a Boss Floor's Stairs, standing while the gate is shut and sinking once it opens (`DelverMarks`).
  - A pedestal's item stands on top of its crate (or its stacked crate, `crateStacked`).
  - Impostor atlases come from the Floor Troops, and an elite shares its base's.
  - Promoted Bosses and elites are drawn in their Troop's Body.
  - "Boss beaten: the gate opens" and "Loot dropped" announcements.
  - "Bosses b / B" on the results line and screen.

**Changed from the Design:**
- **A plain template may write `relics: []`.** Parsed Tuning Data is fed back through the parser, and it writes `[]` on every template, so the parse refuses only a non-empty `relics` outside the elite pool. `elite` is optional in the type (absent means none), so hand-made tiers in tests need no `elite` key.
- **The elite flag is the pool**, as the guard and patrol pools mark a brain. There is no `elite: true` key.
- **`warbandsFit` takes the Floor's pools** (`warbandPools(delver, floor)`). It also refuses an elite or Boss rank on a patrol, and requires exactly one Boss Warband on a Boss Floor (from the code review).
- **The Boss's Relics' max HP share is the Boss Soldier's alone**, not its guard's (a code-review bug; latent with the bundled Bosses).
- **From the code review**:
  - a one-pass wipe check;
  - one place for the Floor Troops' order;
  - cached Troop Mods;
  - the results read `RunEnd.bosses`;
  - the pilot's room check without allocating.
- **Three Stage 3 `warband.test.ts` cases had failed since the user's "shrink Warbands" commits.** Their 1-Soldier guards could not break morale or be walled off. They now run on a test Tuning of 4-Soldier templates, with their expectations unchanged.
- **The last-Boss Victory ends the Tick there**: no taking, fire or Stairs after it.

**Existing tests changed (only as Design §10 allows):**
- The golden Floor 9 pins were rewritten, and Floor 3 pins added.
- Victory and descent tests that reach a Boss Floor's Stairs run on a Tuning with no Bosses. These are in `delverRun.test.ts`, `delverWarbands.test.ts`, `delverRun.slow.test.ts`, `delverCoop.slow.test.ts` and the Stage 3 cases of `warbandSoak.slow.test.ts`.
- Tests that pin one Warband's Soldiers run with `elitePosts: 0`.
- Floor-start expectations include the pedestals, `wiped` and the mirror.
- Two `RunEnd` expectations gained `bosses: 0`.
- The protocol pins moved to 29.
- None was removed.

**Measured** (the test container, about 3× a mid-range laptop):
- **Generator**: 500 Floors, every pair first try. All 166 Boss-Floor pairs have a Boss Hall.
- **The Boss soak** (`warbandSoak.slow.test.ts`; Run seed 4242, the pilot at Hard with two Hard AI allies):
  - **On the shipped Tuning it is a Defeat on Floor 6** (tier 2's first Boss Floor) at 1,447 s, with 1 Boss beaten. The party was worn down by plain Warbands before that Boss was promoted. Four other seeds also lost by Floor 6.
  - On the shipped Tuning, Floor 3's Warden was promoted into Pool slot 3, wiped at Tick 52,151, and its Stairs were taken 271 Ticks later.
  - **The asserted case runs on the shipped Tuning with an immortal party** (after the user's call below): the harness sets every party Fighter back to its max HP after each Tick (test only; no Simulation or Tuning change). The Run is a Victory at Floor 9's Boss after 2,443 s (146,554 Ticks, 91 s wall), with `bosses` 3. An eased Tuning (`postFill` 25, `tierHp` [1, 1, 1]) also won, and was dropped for this.
  - **The Boss lines** (shipped Tuning, immortal party):

    | Floor | Boss promoted (Tick) | Its Pool slot | Another Soldier of its Warband promoted | Wiped and gate open (Tick) | Stairs (Tick) |
    |---|---|---|---|---|---|
    | 3 | 52,554 | 3 (the first free) | 14 Ticks later | 54,728 | 54,969 |
    | 6 | 89,223 | 3 | 24 Ticks later | 93,676 | 94,011 |
    | 9 | 140,868 | 3 | 37 Ticks later | 146,554 | Victory |

  - **Loot** (the same Run): 53 items laid (45 Relics), 6 drops and 3 pedestals taken, 3 elites wiped (each Relic laid, 1 taken). The pilot takes almost nothing after Floor 1: its Inventory's 6 Relic slots are full by then (it never drops one), so it has no room.
  - **The Tick**: mean 0.37 to 0.64 ms, p99 2.5 to 3.7 ms a Floor.
  - **The Stage 3 cases** (no Bosses, elites in): all five Runs were Victories in 560 to 843 s, and 79 Warbands were wiped with no stuck Warband. Over 214,322 Ticks the mean was 0.43 ms and the p99 3.18 ms.
  - The slow file takes 4 min 35 s.
- **Tests**:
  - `npm run typecheck` is clean.
  - `npm test`: **2816 passed, 5 skipped** (2679 before the Stage).
  - `npm run test:slow`: 24 files and 46 tests passed.
  - The new files are `troops.test.ts`, `delverLoot.test.ts`, `delverBoss.test.ts` and `floorPoolAi.test.ts`. New cases were added in about 15 others.

**In the game** (`npm run dev`, a headless browser at 2 to 5 fps, `?dev=1&delver=1&delverStart=3&autopilot=1`; screenshots looked at):
- **A drop** after a fight: the label "Berserker Mask" over a fallen Warband's spot (`docs/plans/delver-stage4/drop.png`). "Loot dropped" is announced when one of the local Player's drops is laid.
- **A Treasure pedestal**: a Weapon standing on its stacked crate (`pedestal.png`).
- **The Boss Hall's gate closed**: bars round the Stairs, with the Warden and its Sledge Hammer inside. With one Expert ally the pilot fell to it and the Run was a Defeat (`gate-closed.png`).
- **The gate open**: with three Expert allies the Warden fell, the bars sank, and the whole party stood at full HP in the Boss Hall. They took the Stairs to Floor 4 / 9 (`gate-open.png`).
- **The camera** still sits inside Walls in many Passage frames (known, Stage 3).

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Dungeon: Delver, add AI allies, Fight. Add `&delverStart=3` (or 6, or 9) to start on a Boss Floor.
- Fight the Boss in its Hall. It should take the first Attack Slot ahead of its guard and never leave while you are in the Hall. Then see the gate sink and the party healed.
- Pick up drops after a Warband falls. Take one pedestal of three in a Treasure Hall, and change your Build at a fire.
- Find the elite guard (the deepest Fight Hall) and see whether its Relic drop is worth the fight.

**To watch next**:
- **Balance (the user's).** The pilot with two Hard allies does not get past Floor 6 on the shipped Tuning, on five seeds. Tier 2's elites (Heavy Gauntlet and Glass Cannon) and `tierHp` 1.25 meet a party that, as the pilot plays it, has gathered few Relics. The knobs are `postFill`, `tierHp`, `elitePosts`, the Bosses' `hpScale`, `loot.weights` and `loot.drops`.
- **Drops are mostly Relics** (`loot.weights` 4 : 1), which matches the Hall-graph Run.
- **A Boss and a guard Soldier may be promoted on the same Tick** when two Attack Slots are free. The Boss always takes the first.
- **The fallen are revived at the Stairs** when the Boss falls, inside the Boss Hall. Players who fell far away find themselves there.

#### After the Stage (2026-11-13, the user's calls)
- **An unbeatable shipped dungeon is fine**: balance is the user's, by hand, later. So the soak's full Run plays the shipped Tuning with an immortal party (above) instead of an eased Tuning.
- The last Boss does not win the Run at its wipe: the Run is won when the party takes that Floor's Stairs.
- The fallen stand up at the Stairs after any Boss, the last one included (as built).
- The Reveal is by entering: a Hall or Passage is revealed for the whole party once any present Player's living Fighter stands inside it. No line-of-sight "seeing into" a room.

### Stage 5: presentation
**Model**: Sonnet.
#### Design
Written 2026-11-13 at the Stage's start. Three parts: two Simulation changes (the last Boss, the Reveal) and the render and play work that reads them.

**A. The last Boss wins at its Stairs** (`src/sim/delverRun.ts`)
- The Boss-wipe loop loses its `next.floor === next.floors` early win and the `won` flag with its "nobody plays on" branch. Every Boss wipe emits `BossBeaten`, heals the living party and revives the fallen at the Stairs. The Stairs path already calls `win()` on the last Floor once the gate is open, so the Run now ends there.
- Tests changed: `delverBoss.test.ts` ("is a Victory at once" becomes "does not win at its wipe" and "is a Victory on the last Stairs"), and any slow test that expects a Victory at the wipe walks the party onto the Stairs for `doorSeconds`. None weakened or skipped.

**B. The Reveal** (`src/sim/delver/reveal.ts`, `delverRun.ts`)
- `DelverRun.revealed: readonly number[]`: unsigned 32-bit words, `ceil((halls + passages) / 32)` of them, bit h Hall h and bit `halls.length + p` Passage p. A plain number array, hashed and snapshotted structurally with the rest of `MatchState.delver`; it is the only new hashed state.
- Pure helpers: `revealBits`, `emptyReveal`, `isRevealed`, `revealPlace(plan, x, z)` (Halls before Passages, lower index first, rect test inclusive on x0/z0 and exclusive on x1/z1) and `withReveal` (the same array when the bit is set, so a quiet Tick allocates nothing).
- Rule (the user's call: reveal by entering): each Exploring Tick, every present Player (`presentPlayers`) whose Fighter is in the Duel and alive sets the bit of the place it stands in. AI allies, the away and the fallen reveal nothing. `enterFloor` starts `revealed` as `emptyReveal` with the Entrance Hall set. Nothing in the Simulation reads it.
- Tests: `reveal.test.ts` (helpers, seams, ties) and `delverRun.test.ts` (Entrance starts revealed, a Passage then the next Hall, an ally alone reveals nothing, a new Floor resets, same seed same hash, snapshot round trip).
- `PROTOCOL_VERSION` rises only if a wire message's shape changes; `DelverRun` rides in the snapshot and the resync, so it is checked with the net tests.

**C. Fog-of-war maps** (render and play, read-only)
- `delverMapLayout(plan, revealed, fighters, me)` in `src/play/floorMap.ts`: revealed Halls and Passages as rects scaled to fit (with a margin, y flipped so north is up), markers for revealed Halls only (Stairs and whether the gate is open, fires and whether spent, Treasure pedestals still lying, the Boss Hall), and the party's living Fighters as arrows (`me` white). `floorMapLayout` (the Hall graph) stays for the old Run. `floorMapView.ts` draws it as an SVG.
- Minimap: `Minimap.drawDelver` draws the revealed rects around the local Fighter (the same transform helpers, a fixed window in metres), then the markers, the party and nearby promoted enemies. Nothing for unrevealed space. The Battle drawing is untouched. The Delver HUD owns a Minimap canvas.
- The 3D world is not fogged.

**D. Stand-in art, banner, HUD, results** (render and play)
- `src/render/delverStandIns.ts`: Stairs (a dark stepped pit with a glowing square, a shut gate shown as the existing bars), pedestal plinths, and a spent fire as a smaller flame. It reuses `restFire.ts` and `pickupView.ts` and is one small module so #62's art can replace it. `DelverMarks` keeps the fires and the gate and calls it.
- "Descending…" banner while `phase === 'Descending'`; "Boss beaten — the Stairs are open" for `BossBeaten` (`announcer.ts` and `game.ts`).
- HUD line `Floor f of tier t (n / N)` from `delver.floorsPerTier`, plus "Boss Floor" on a Boss Floor: a pure `delverScore` in `hud.ts`, tested in `hud.test.ts`.
- Results: Floors reached, Warbands beaten, Bosses beaten and each Player's Build. Warbands beaten is a `warbands` count on `RunEnd` (`RunEndEvent.warbands`, `WarbandWiped` events being gone with their Tick), so it is exact and the screen needs no event history; `RunEnd` tests gain it.
- Playtest only: `?dev=1&delver=1&immortal=1` keeps every living Team 0 Fighter at max HP after each step in the game loop, ignored without `dev=1`. The Simulation and the shipped Tuning are untouched.

- The Reveal bitset (Simulation) and the fog-of-war minimap and Floor Map (`M`): Halls, Passages, the party, fires, Treasure, Stairs once revealed.
- Stairs, fire and pedestal art (stand-ins until #62 lands); a "descending" banner; a HUD line for the Floor and tier; the results screen lists Floors reached, Warbands beaten and the Build.
- **Done**: playtest-ready solo.

### Result
Done 2026-11-13. A Delver Run can now be explored and read: a shared fog of war, maps that show only what the party has entered, stand-in art for the Stairs and pedestals, and a results screen that says how far the party got.
- The last Boss no longer wins at its wipe: every Boss wipe heals the party and revives the fallen at the Stairs, and the Run is won when the party takes the last Floor's Stairs (the user's call).
- The Reveal is in the Run's state and is by entering: a Hall or Passage is revealed once any present Player's living Fighter stands inside it.
- The minimap and the Floor Map (`M`) draw only revealed space, with the markers of revealed Halls and the party. The 3D world is not fogged.

Battles, Duels and the Hall-graph Run are unchanged.

**What was built:**
- **The last Boss** (`delverRun.ts`): the early `next.floor === next.floors` win and the `won` flag are gone. The Stairs path's `win()` ends the Run, with no fade and a `RunEnd`.
- **The Reveal** (`src/sim/delver/reveal.ts`): `revealBits`, `emptyReveal`, `isRevealed`, `revealPlace` (Halls first, lower index first, rects inclusive on x0/z0 and exclusive on x1/z1) and `withReveal` (the same array when nothing is new). `DelverRun.revealed` is a plain array of unsigned 32-bit words, set on each Exploring Tick for every present Player whose Fighter is alive and in the Duel, and reset on each Floor with the Entrance set. Nothing reads it.
- **`RunEnd.warbands`** (`match.ts`): the Warbands beaten over the whole Run. The Run carries `beaten` (the Warbands wiped on earlier Floors) and the Floor's `wiped` is added at the end, so the results screen needs no event history.
- **Maps** (render and play, read-only):
  - `delverMapMarks` (`src/render/delverMapMarks.ts`): the Stairs (open or shut), fires (revive spent or not), Treasure Halls (pedestals still lying for the viewer) and the Boss, for revealed Halls only. The Boss mark stands 4 m from the Stairs mark, which sits at the same centre.
  - `delverMapLayout` and `delverMapStatus` (`floorMap.ts`): revealed rects scaled to fit a square board (at least 40 m across, so a lone Hall is small), the markers and an arrow for each living party Fighter (me white). The orientation is the Battle minimap's, so the map is the Floor seen from above and not its mirror. `floorMapLayout` still serves the Hall-graph Run.
  - `FloorMapView` draws it as an SVG for a Delver Run; the map button and `M` now open in one.
  - `Minimap.drawDelver`: the same, in a 24 m window round the local Fighter, with the promoted enemies as dots. The Hud owns one canvas, top right.
- **Stand-ins** (`src/render/delverStandIns.ts`): a dark stepped pit with a glowing square for the Stairs (gold and pulsing while they count, dull red while a Boss Floor's gate is shut; the existing bars still stand round it), and a gold ring at each pedestal (the item still stands on its crate, as `pickupView` draws it). `RestFire.setSpent` makes a fire's flames smaller once its revive is spent. All of it is one small module plus `DelverMarks` calling it, so #62's art can replace it.
- **HUD and results** (`hud.ts`, `game.ts`, `announcer.ts`):
  - `delverScore`: "Floor 2 of tier 1 (2 / 9)" and "· Boss Floor" on a Boss Floor.
  - A "Descending…" banner when the phase turns to Descending, and "Boss beaten — the Stairs are open".
  - The results screen shows Floors reached, Warbands beaten, Bosses beaten and each Player's Build; the results line says the same.
- **Playtest only**: `?dev=1&delver=1&immortal=1` keeps every living Team 0 Fighter of a solo Delver Run at max HP after each Tick (`withImmortalParty` in `driver.ts`), and `speed=N` (1 to 16, dev only) runs the Ticks N times as fast per frame, at 1× during the fade between Floors. Both are ignored without `dev=1`. Neither touches the Simulation or the shipped Tuning.

**Changed from the Design:**
- **`DelverRun.beaten` was added** (a second new hashed field), for `RunEnd.warbands`: `wiped` resets on each Floor, so a Run-wide count needs state.
- **The Boss mark is offset 4 m** from the Stairs mark. Found in the playtest: both sit at the Boss Hall's centre and the skull covered the Stairs square, hiding the gate.
- **The Floor Map's `delverMapLayout` takes a fifth argument**, the status (gate, fires, pickups), since its markers need more than the plan and the Reveal.
- **The `speed` flag** was not in the Design. A headless browser at 2 to 5 fps runs a Run at half speed or less, so a Boss Floor took half an hour.
- The Design said "Descending… banner while `phase === 'Descending'`". It shows for the fade's length from the Tick the phase turns, and is replaced by the next Floor's banner.

**Existing tests changed:**
- `delverBoss.test.ts`: "is a Victory at once" became "does not win at its wipe" (BossBeaten, the heal and the revive, no `RunEnd`) and "is a Victory when the party takes the last Stairs". None was weakened or removed.
- `RunEnd` expectations gained `warbands`, and the Floor-start expectation gained `revealed` and `beaten`.
- The protocol pins moved to 30.
- No slow test needed changing: the soak's pilot walks on to the Stairs after the Boss, so its full Run still ends in a Victory with 3 Bosses.

**`PROTOCOL_VERSION`: 29 to 30.** The resync's `delver` object gains `revealed` and `beaten`. The parser requires them: 1 to 64 words of unsigned 32 bits, and a count of 0 or more. No other message changed.

**Tests:**
- `npm run typecheck` is clean. The repo has no lint script or ESLint config, so there was no lint to run.
- `npm test`: **2849 passed, 5 skipped** (2816 before the Stage).
- `npm run test:slow`: 24 files and 46 tests passed (430 s).
- New: `reveal.test.ts`; Reveal cases in `delverRun.test.ts` (the Entrance starts revealed, a Passage then the next Hall, an ally or an away or a fallen Player reveals nothing, a quiet Tick allocates nothing, a new Floor resets, same seed same hash, snapshot round trip); `delverMapLayout` in `floorMap.test.ts`; `delverScore` and the results line in `hud.test.ts`; the Reveal on the wire in `delverMessages.test.ts`; `warbands` across Floors in `delverBoss.test.ts`; `RestFire.setSpent`, the stand-ins and the immortal helper.

**In the game** (`npm run dev`, a headless browser, `?dev=1&delver=1&autopilot=1&immortal=1`, one Expert AI ally; screenshots in `docs/plans/delver-stage5/`, all looked at):
- `fresh-floor.png`: the first seconds of a Floor. The minimap shows the Entrance Hall alone.
- `explored.png` and `floor-map.png`: after 40 s the Floor Map shows three Halls and two Passages, the Entrance green, the party's arrows (me white). The rest of the Floor is black.
- `boss-floor-hud.png` and `boss-floor-map.png`: "Floor 3 of tier 1 (3 / 9) · Boss Floor" on a Boss Floor, and its map.
- `boss-gate-map.png`: the Floor Map on Floor 9 with the Boss Hall revealed: the Stairs mark shut (✕) and the skull beside it; the fires (orange) and a Treasure Hall (a gold diamond) in revealed Halls.
- `boss-hall-minimap.png`: the minimap in the Boss Hall, the shut Stairs square, the Boss as a red dot.
- `descending.png`: "Descending…" over the fade, the stepped pit with the gate's bars sunk (the Boss was down).
- `results.png`: a Victory at Floor 9's Stairs: "Floors reached 9 / 9", "Warbands beaten 6", "Bosses 3 / 3", the run time and the Build. (A Run that starts on Floor 9 counts only that Floor's Warbands.)
- **Not captured: a 3D view of the shut gate.** The pilot's camera sits inside a Wall in most Boss Hall frames (the known camera issue), so no clean frame came out. The gate's bars are Stage 4's and unchanged; the Stage 4 `gate-closed.png` shows them.
- A Run from Floor 3 (`delverStart=3&speed=8`) went on through Floors 4 and 5 on the shipped Tuning with the immortal party; a Run from Floor 9 reached the Victory in 212 to 272 s of wall time.

**To watch next**:
- **The Reveal by entering only.** A Hall is revealed when a Fighter is inside its rect, so a lit room seen from a doorway stays black on the maps until someone steps in. Say if that feels too stingy.
- **The minimap window** is 24 m with a fixed north. A rotating one (up is where the camera looks) would follow the player better, but it is a different map from the Floor Map.
- **The stand-ins** are boxes and rings: the Stairs pit reads, the pedestal rings are faint next to the crates. #62 replaces both.
- **The Descending banner** shows during a 1 s fade. It is short at real speed.
- **A Treasure Hall's diamond** stays gold while any pedestal item lies for the local Player, and goes hollow once all three are gone (taking one closes the other two for that Player, so it empties at once).
- **Stage 6** adds levels, so the maps will need a level switch (or a stack): the Floor Map is flat.

### Stage 6: verticality
**Model**: Opus.
- **No overlap from above** (decided 2026-11-14): no two Floor elements (Halls, Passages) overlap seen from above. No bridge over a Passage, no Hall over another Hall. The Floor Map and minimap stay flat and unchanged; Reveal by a Hall's rect stays right.
- The generator grows levels. Each Hall has a floor height that is a whole number of levels, and Enclosure roofs stay at the next level above it. Heights change three ways:
  - **Sloped Passages**: a Ramp along a Passage joins a lower Hall's door to a higher Hall's door.
  - **Stairwell Halls**: a Hall with a Ramp inside it that joins a low door and a high door.
  - **Balconies**: a Deck round a Hall's own walls, reached by a Ramp inside that Hall. This is the only place one Walk Surface lies over another, and it stays inside its Hall's rect.
- **Jumping** (Players can Jump up to 4 m): a ledge up to 4 m high may be a shortcut a Fighter Jumps up (a jump Link for the AI allies). Soldiers never Jump, so every Walk Surface a Warband or the party needs is still reached by walking and dropping; a jump-up ledge is only ever a shortcut, never the only way.
- Warbands on several levels by the walk rule. Patrols cross levels; Chase fields have a node per level.
- The maps are not changed in this Stage.
- **Done**: large multi-level Floors pass the judge and the soak.

#### Design
Written 2026-11-14 at the Stage's start, with the user's answers of that day (no overlap from above; a balcony only inside its own Hall; heights by sloped Passages, stairwell Halls and Jumps; the maps unchanged). A Battle, a Duel and a Hall-graph Run step exactly as before, and with a flat Tuning (`delver.floor.levels.max` 0, `galleryPercent` 0) a Floor's Map Source and compiled map are byte-identical to Stage 5's. **No new hashed state**: every height comes from the plan, the Walk Surfaces or the Fighters, which are already state. `PROTOCOL_VERSION` stays 30 (no message changes shape); `DELVER_VERSION` goes to 4, so peers whose Floors differ refuse each other through the Tuning Data hash.

**The words.** A **level** is `LEVEL_RISE` (2 m) of height. A Hall's floor stands at a whole number of levels (`level`, 0 to `levels.max`). A **gallery** is a raised walkway along one wall of its own Hall: a Deck one level over the Hall's floor, reached by a Ramp inside the Hall. It is a **stairwell** when a Passage leaves through that wall at the Deck's height (the Ramp joins a low door and a high door), else a **balcony**. A **sloped Passage** has a Ramp along its whole length joining a door one level lower to a door one level higher. The front edge of every gallery Deck is open: it is the Floor's only **Jump shortcut** (up) and a 2 m drop (down).

**1. The height model** (constants in `src/sim/delver/plan.ts`, each fixed by a rule, not Tuning):
- `LEVEL_RISE = 2`. A Hall's floor is `y = level × 2`. A Passage rises or falls at most one level. A gallery's Deck is one level over its Hall's floor.
  - Why 2 m: a Deck 2 m up is a Jump shortcut with a wide margin (below), it is a drop Soldiers may take (`battle.levels.drop` 3), and it is more than `levels.height` (1.8), so Soldiers on the Deck and under it are on different levels.
- **Roofs** (an Enclosure's `top`, below): a plain Hall `HALL_STOREY = 4` m over its floor (as today). A gallery Hall `GALLERY_STOREY = 6` m, so its Deck stands 4 m under the roof: more than a Fighter's height at the largest Size (`fighter.height` × MAX_SIZE = 2.52 m). Under the Deck there is 2 m: Fighters walk under it (nothing in the Simulation stops a walk under a Walk Surface; a tall body clips the Deck when drawn, accepted). A Passage's roof is `HALL_STOREY` over its higher door.
- **Doors**: every doorway stays `DOOR_HEIGHT` (3 m) over the floor it opens from. A Passage attaches at a **door height** at each end (`ya`, `yb`): its Hall's floor, or, through a gallery's wall, the Deck's height. A Hall's `doors` list only the Passages attached at its floor. A Passage Enclosure's `doors` list its end(s) at its own floor: both ends when it is flat, only its low end when it is sloped. The other end's opening is cut by the Hall's own door at that height (an Enclosure's doorway opens through a shared Wall, ADR 0023's compiler rule), so no doorway ever opens below a floor or into the abyss. A Passage through a gallery's wall is always flat (both its doors at the Deck's height), so a stairwell's high door is cut by the Passage alone.
- **The steepest Ramp**: 1 in 2 (`MAX_SLOPE = 0.5`, 26.6°; the Fort's and the Ziggurat's are 4 in 9). The walk rule (`levels.ts`) has no slope limit of its own and Fighters walk Ramps up to about 5 m a metre (`steepestRamp`), so this is a look-and-feel bound. A sloped Passage rises 2 m over its whole length, at least `minPassage` (4 m), so it is never steeper; the parse refuses `minPassage < 2 × LEVEL_RISE` whenever `levels.max > 0`.
- **The gallery's shape**: a strip `GALLERY_DEPTH = 4` m deep along the inside of wall `side`, the whole length of that wall, cut along it into the Deck (from one corner), the Ramp (`GALLERY_RAMP = 4` m long = `LEVEL_RISE / MAX_SLOPE`, as deep as the strip, rising toward the Deck) and an approach (`GALLERY_APPROACH = 2` m of the Hall's own floor, between the Ramp's foot and the other side wall). The Ramp is railed on both long sides (the wall's line and the strip's inner edge). The Deck's front edge (the strip's inner edge along the Deck) has no rail.
  - Every new edge stays off the 2 m field's dots (Stage 1's rule): Hall edges are odd metres, and 4, 4 and 2 are even, so the strip's inner edge and every cut along it are odd metres too.
  - **Room**: a gallery on side `s` fits its Hall when the half size across the wall (`hd` for n and s, `hw` for e and w) is at least `GALLERY_DEPTH + CENTRE_CLEAR` (`CENTRE_CLEAR = 4`: the centre's markers, the fire's 3 m ring, the pedestals at ±3 and the Stairs zone stay clear of the strip, and so do the doorways in the two side walls), and the half size along it (`par`) is at least `(GALLERY_RAMP + GALLERY_APPROACH + DECK_MIN) / 2` (`DECK_MIN = 4`: 5 m). A **stairwell** also needs the Deck to cover its high door with a metre each side: `par − GALLERY_RAMP − GALLERY_APPROACH ≥ passage / 2 + 1` (9 m with the bundled Tuning).
- **The Jump shortcut**: the Deck's front edge, 2 m over the Hall's floor. A held Jump lands on a 2 m ledge from up to 3.8 m away (`docs/jump-reach.md`, measured with today's `data/fall.json`: gravity 14, jumpSpeed 4.8, jumpBoost 25, 0.12 s and 0.35 s; checked against the file in this Stage) and the highest ledge reached is about 4.3 m, so 2 m is 2.3 m under the real Jump. Under the Deck's 4 m of headroom a full Jump is not capped. A test keeps the cap honest: `JUMP_SHORTCUT_CAP = 2.5` (`plan.ts`), and `plan.test.ts` asserts `LEVEL_RISE ≤ JUMP_SHORTCUT_CAP`. Nothing else on a Floor is a Jump shortcut: a sloped Passage's and a gallery Ramp's sides are railed, and every Hall and Passage is walled to its roof.
- **No overlap from above** is an invariant of the plan: Halls and Passages are disjoint rects as in Stage 1, and the only Walk Surface over another is a gallery's Deck over its own Hall's floor, inside that Hall's rect.

**2. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`): `delver.floor.levels`:
```json
"levels": { "max": 4, "min": 2, "changePercent": 35, "galleryPercent": 40 }
```
- `max`: the highest Hall level (whole, 0 to 6; 0 is a flat Floor). `min`: the fewest distinct Hall levels a Floor must have (whole, 1 to `max + 1`; the judge's `levels` rule). `changePercent`: the chance (in 100) that a tree Passage rises or falls a level. `galleryPercent`: the share (in 100) of the Halls with room for one that get a gallery.
- Parse checks: as above, percents whole 0 to 100, and `minPassage ≥ 2 × LEVEL_RISE` when `max > 0`. `tuning.test.ts`'s `goodRaw()` gains the block.
- **The flat Tuning** (tests only): `flatFloors(tuning)` in `src/sim/delver/flat.testdata.ts` gives `levels { max 0, min 1, changePercent 0, galleryPercent 0 }`.

**3. The plan** (`planFloor`, the new and changed fields; all `readonly`):
```ts
export interface LevelPoint { x: number; y: number; z: number }
export interface MarkerPoint { hall: number; x: number; y: number /* the floor it stands on (m) */; z: number }
export interface DelverGallery {
  side: Side;        // the wall it runs along
  end: 0 | 1;        // 0: the Deck at the low-coordinate end of the wall (west for n and s, south for e and w), 1: the other
  y: number;         // the Deck's height: the Hall's y + LEVEL_RISE
  deck: Rect; ramp: Rect;
  up: Side;          // the Ramp's high end, toward the Deck
  high: boolean;     // a stairwell: a Passage leaves through `side` at the Deck's height
}
DelverHall    += level: number; y: number; top: number /* its roof (m) */; gallery?: DelverGallery /* absent: none */
DelverPassage += ya: number; yb: number /* door heights (m) at a's and b's end */
DelverPatrol.points: readonly LevelPoint[]
DelverMarkers.stairs: { hall: number; zone: Rect; y: number }
```
New `SALT` keys (after the Warbands' 20 to 29, so no pick collides): galleryOrder 30, gallerySide 31, galleryEnd 32, levelBase 33, levelChange 34, levelUp 35. The steps, numbered as Stage 1's:
- **3b. Galleries** (after the growth, before the loops). A side fits as in §1, `high` (needs the stairwell's room) when it already has a tree Passage. The Halls with at least one fitting side are ordered by `pick(h, galleryOrder, 2³²)`, ties the lower index, and the first `ceil(fitting × galleryPercent / 100)` get one: its side is `fitting[pick(h, gallerySide, fitting.length)]` in n, e, s, w order, its end `pick(h, galleryEnd, 2)`. With `galleryPercent` 0 no pick is made.
- **3c. Levels** (on the tree). The first Hall's level is `pick(0, levelBase, max + 1)`. Then each tree Passage n in growth order, from its parent P (levelled) to its child C: `dP` = P's door level at that end (its level, + 1 through its gallery's wall). When either end is a gallery's wall the options are `[0]`; else, if `pick(n, levelChange, 100) < changePercent`, `[d, −d, 0]` with `d = pick(n, levelUp, 2) ? +1 : −1`, else `[0]`. C's door level is `dP + δ` for the first δ that puts C's level (its door level, − 1 through its gallery's wall) in 0 to `max`. If none does, P's gallery on this side is dropped (else C's), and it is tried again with `[0]`, which always fits. With `max` 0 no pick is made.
- **4. Loops**: a candidate also needs its two door levels at most one apart, equal when either end is a gallery's wall, and a gallery's wall it lands on must have the stairwell's room. Then each gallery's `high` is whether its side holds a Passage.
- **5. Passages**: `ya`, `yb` from the door levels × 2. The Halls' `doors` and the Passages' as in §1.
- **7.** After the Boss Hall grows (its rect and its Passages', as Stage 4), each gallery's `deck`, `ramp`, `up` and `y` are worked out from its Hall's final rect. Along the wall from u0 to u1 (x for n and s, z for e and w), with A = `GALLERY_APPROACH` and R = `GALLERY_RAMP`: end 0: Deck u0 to u1 − A − R, Ramp u1 − A − R to u1 − A, `up` the low-coordinate side (w, or s); end 1: Deck u0 + A + R to u1, Ramp u0 + A to u0 + A + R, `up` e (or n). Across, both are the strip: `GALLERY_DEPTH` in from the wall. `top` is `y + GALLERY_STOREY` for a gallery Hall, else `y + HALL_STOREY`.
- **9. Markers**: each has its floor's `y`. **A Fight Hall with a gallery whose Deck is at least `DECK_POST = 6` m long has its post on the Deck**: at the Deck's centre along the wall and 2 m in from the wall, at the Deck's `y` (a guard's column, three files 1.5 m apart and ranks 0.75 to 2.25 m ahead, then fits on it). Every other marker is where Stage 5 puts it, on its Hall's floor. Patrol points are Hall centres at their Hall's `y`; the Stairs zone's `y` is its Hall's.
- Kinds, depth (centre-to-centre lengths), the main path, in-line Halls and patrols are unchanged. With the flat Tuning, the plan is Stage 5's plus the new fields (every `y` 0, `level` 0, `top` 4, `ya = yb = 0`, no gallery).

**4. The source** (`floorSource`):
- `levels`: −8 and every height a Brush stands at (Hall floors and roofs, Decks, Passage floors and roofs), ascending, unique: [−8, 0, 4] on a flat Floor.
- Brush order: the abyss; the Halls (Enclosures at `y`, their `top` written only when it is not the next level up, `doors`); the Passages (Enclosures at the lower door height, `top`, `doors` as §1); then for each gallery Hall in Hall order a Deck `<hall>-deck` (`material: 'wood'`) and a Ramp `<hall>-ramp` (`lo` the Hall's `y`, `hi` the Deck's, `up`, `rails` both long sides, `material: 'stone'`); then for each sloped Passage in order a Ramp `<pass>-ramp` over its whole rect (toward its higher end, railed both sides, `stone`).
- Props stand at their marker's `y`. `shortcuts: true` (below) only when the plan has a gallery.
- `describeFloor` adds "levels a to b (n Hall levels), g galleries (b balconies, s stairwells), r sloped Passages".

**5. The Map Source and the navmesh** (general, Battles unchanged):
- **`EnclosureBrush.top?: number`**: its ceiling, one of the source's levels above `y`. Absent, the next level up, as now. `enclosureTop(b, levels)` returns `b.top` when set, so the compiler, the Map Editor's session and its panel all read it. `parseMapSource` checks it, and `sourceFileText` writes it after `doors` when set.
- **`MapSource.shortcuts?: true` → `BattleMapTuning.shortcuts?: true`** (`compileDraft` carries it, `parseBattleMap` accepts only `true` or absent, `mapFileText` writes `"shortcuts": true` after `armySize` when set). A map with it builds its Battlefield's Arena with `jumpLinks: 'shortcuts'` (`buildMap` and `compileDraft`'s draft Arena). `ArenaGeometry.jumpLinks` becomes `false | 'shortcuts'`.
- **`navMesh` with `jumpLinks: 'shortcuts'`** (`nav.ts`): `jumpLinks(...)` runs only its "onto a target" search, and keeps only shortcut Links: a try whose target walking does not reach (`!reached(k, j)`: roofs, anything a Jump alone gets to) is never made. The "off a source" search (gaps, which find only unreached targets) is skipped. Every kept Link passes the existing error check (`jumpHolds`: every slightly-off variant lands in the same walk group, none deadly) and the shortcut rule (ADR 0013). So a Floor's AI allies, its Delver pilot and its promoted enemies may Jump up onto a Deck when that saves walking round by the Ramp, and nowhere else. Soldiers never Jump (the walk rule), and `walkCheck` is unchanged: every Walk Surface but the roofs is reached without a Jump. ADR 0028's "the navmesh is a Battle map's, with no Jump Links" gains this exception at the Stage's close.

**6. The judge** (`judge.ts`): the rules, with what is new:
1. **rooms**, and new **levels**: a plan with fewer than `levels.min` distinct Hall levels (`levels: N Hall levels, at least M wanted`). Plan-only.
2. **compile**, unchanged (`walkCheck` covers every Ramp and Deck).
3. **halls**, unchanged.
4. **passages**, now **both ways and along the Passage itself** (amended in Task 2's review: Hall centre to Hall centre, a stairwell's way round its Ramp and back along its Deck is up to 42 m against a 24 m Passage, and 28% of attempts were rerolled for it): the field to the point 1 m inside b's end of the Passage, on its centre line on the Walk Surface at that end's door height, read at the same point 1 m inside a's end, and the reverse, each ≥ 0 and ≤ `follow × L`, L the Passage's rect length along its axis. A cut Passage (Stage 0's case) still goes round by tens of metres; a sloped one must be climbed and walked down. Rule 3 still checks that every Hall's centre is reached.
5. **markers**: each stands at its own `y` (was 0), on that Walk Surface (`groundOf(battle, field, x, z, y)`), not a roof, not deadly, reached.
6. **sight**: `inSight` with both heights (the spawn's and the marker's `y`).
7. new **galleries**: each gallery's Deck centre has a Walk Surface at the Deck's `y` that is not a roof, reached from the Entrance, and the Hall's centre is reached from it.
- The navmesh is not built by the judge (it is not needed for a verdict: a Deck with no jump Link still has its Ramp). The jump Links are checked by a fast test on one Floor and by the generator soak on 20.
- **Budget**: Stage 1's Floor was 241 ms here (p95 288) and its navmesh 17 ms; Stage 0's "Floor ready" 110 to 153 ms. The generator soak fails if the passing attempt's plan, build and judge average over 600 ms here or any is over 2 s, or the navmesh averages over 300 ms. A Floor is warmed a Floor ahead (`arenasToWarm`), so the fade only reads the cache; rerolls (the `levels` rule, mostly) are counted and printed.

**7. Everything Stages 2 to 5 assumed flat**, each with its fix (Simulation unless marked):
- **Spawns** (`floorDuel`): Team 0 at the spawn's `y`.
- **Stairs** (`inStairs`): `y` within (zone `y` − 0.5, zone `y` + `ZONE_HEIGHT`). The Boss wipe's revive stands at the Stairs zone's `y`.
- **Fires** (`atFire`, the fires' arrivers, the revive): the fire's `y`.
- **`dropSpots(plan, arena, lv, x, z, y, count)`**: the spots as now; each spot's `y` is the height of `groundNear(arena, lv, sx, sz, y, true)` (the ground nearest under the fall's height, never a roof), or the fall's `y` where there is none. The fall's `y` is `soldierHeight` of the fall Soldier's surface in `match.duel.crowd`, and `WarbandWiped.at.y` is that too.
- **Pedestals** (`treasurePickups`): at their marker's `y`.
- **Warband homes** (`warbandHomes`): posts `{ x, y, z, facing }` and patrol points `{ x, y, z }`. A Deck post faces along the Deck toward its Ramp (the column then lies on the Deck); every other post keeps `guardFacing`.
- **`deployWarbands`**: every anchor and Soldier surface is `groundOf(battle, field, x, z, home.y)`.
- **The brain** (`stepWarbands`): every home field and home surface at the home's `y` (`walkField(battle, map, x, z, y)`, `groundOf(…, y)`), not 0. **Sight** on a Floor takes feet no more than `battle.levels.promote` (2.5 m) above or below (was `levels.height`, 1.8), so a Warband sees a Player on a gallery over it, and the reverse.
- **The Bubble across levels**: unchanged. On a Floor every distance it measures is already the walk, by fields with a node per level, so a Deck reached by a drop is near and one reached by a long Ramp far; nobody more than `levels.promote` above or below is promoted (ADR 0022).
- **Chase fields**: unchanged (`fieldToward` at the chased Fighter's node, a node per level).
- **Patrol and Return**: unchanged but for the homes' `y`.
- **The Reveal**: unchanged. Seen from above nothing overlaps, so a Hall's rect holds its gallery and a sloped Passage's rect its Ramp.
- **The AI**: the Delver pilot walks to a fire's and the Stairs' `y`; the Ally AI to its Stairs spot at the zone's `y`. `promotedNear` keeps `levels.height`.
- **Render** (`DelverMarks`, `delverStandIns`, the Rest fire): the Stairs square, its gate, the fire, its ring and the pedestal rings stand at their marker's `y`. Pickups and the Crowd already draw at their own heights (the task checks `floorCrowd.ts` and `pickupView.ts`). The minimap and the Floor Map are not changed.

**8. Existing tests this Stage rewrites** (only these, and only as said):
- `golden.test.ts`: the default Tuning's pins are rewritten (`DELVER_VERSION` 4), and a new case builds the same seeds and Floors on `flatFloors(tuning)`: its `mapFileText` hashes must be **the Stage 5 map pins exactly**.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the `levels` block and its checks.
- `delverLoot.test.ts`: `dropSpots` calls gain their new arguments, expectations unchanged.
- **Any other existing Delver test that fails only because its Floor now has levels** (a marker's height, a Warband's place, a Hall's shape) runs on `flatFloors(tuning)`, its expectations unchanged. The task lists each one. A test that still fails on a flat Floor is a bug to report.
- `warbandSoak.slow.test.ts`'s full Run (amended in Task 5's review): its "the Boss Soldier promoted before any other Soldier of its Warband" held by luck. On levelled Floor 9 a guard stood 10.0 m from the Player by walking and the Boss 10.8 m, so only the guard was promotable (`bubble.promote` 10), as Stage 4's rule says (the Boss sorts first only among the promotable). The check becomes that rule: on no Tick is a Soldier of the Boss Warband promoted into a Bubble while the Boss Soldier is promotable into that Bubble and left unpromoted.
- No test is removed.

**9. Tests to add**:
- `src/mapEditor/enclosure.test.ts`: an Enclosure with `top` two levels up compiles its roof there and stands its Walls to it; a source with no `top` and no `shortcuts` compiles to the same bytes as before (the existing pins); a tall Enclosure holding a Ramp up its wall to a Deck, with a flat Enclosure leaving through that wall at the Deck's height, passes `walkCheck` and opens the doorway at the Deck.
- `src/sim/nav.test.ts` (or a new `shortcutLinks.test.ts`): on such a map with `jumpLinks: 'shortcuts'`, the navmesh has a shortcut jump Link from the floor onto the Deck, every jump Link is a shortcut, and with `jumpLinks: false` there is none.
- `plan.test.ts`, over 200 seeds and Floors 1 to 9: Hall levels in 0 to `max`; every Passage's door heights at most `LEVEL_RISE` apart, equal through a gallery's wall; galleries inside their Hall's rect, Deck and Ramp disjoint and inside the strip, the Deck covering a stairwell's high door; every Deck post on its Deck; every marker's `y` its Hall's floor or Deck; doors listed as §1; `LEVEL_RISE ≤ JUMP_SHORTCUT_CAP`; Deck headroom ≥ `fighter.height × MAX_SIZE`; with the flat Tuning, Stage 5's plan plus the new fields. And across the 200: some Floors with 2 or more Hall levels, a balcony, a stairwell and a sloped Passage.
- `judge.test.ts`: each new or changed rule firing on a broken Floor: `levels` (a plan flattened to one level under `min` 2), `passages` the other way (a sloped Passage's Ramp Brush removed: the walk up fails, or the compile does), `markers` at a height (a fire's `y` raised 2 m), `galleries` (a gallery's `y` raised 2 m); a levelled Floor passes; its built navmesh (under `arenaTuning`) has a shortcut jump Link onto every Deck and no other jump Link; the editor's `checkMap` at 2 m still finds no Wall on a node.
- Run tests (`delverRun.test.ts`, `delverLoot.test.ts`, `warbands.test.ts`, `warband.test.ts`): on a levelled Floor, Team 0 spawns at the Entrance's `y`; the Stairs count at the Stairs' `y` and not 2 m under it; a fire heals at its `y`; a drop on a Deck lies on the Deck and one beside it on the floor; a Deck post's Warband deploys on the Deck facing its Ramp; a Warband on the floor sees a Player on a gallery over it; same Intents, same hash, across a Floor change on levelled Floors.
- `src/sim/delver/delverGen.slow.test.ts`: as Stage 1's soak on the default Tuning, plus per Floor its Hall levels, galleries, stairwells and sloped Passages, and on its 20 navmesh Floors the jump Links. **It must show it exercised**, else fail: Floors of 3 or more Hall levels, balconies, stairwells, sloped Passages, Deck posts, and a shortcut jump Link onto every Deck of the 20.

**10. The soak** (`src/controllers/warbandSoak.slow.test.ts`, new cases; immortal party, `withImmortalParty`):
- **Levelled Runs**: 3 Run seeds, 1 tier × 3 Floors, no Bosses (`noBosses`), the Delver pilot (Hard) and two Hard AI allies. Per Floor it prints: the Hall levels, galleries (balconies, stairwells), sloped Passages; the party's seconds on a Ramp (a sloped Walk Surface); chases that crossed a level (the anchor's height changed by 1.5 m or more within one Chase); Promotions of a Soldier standing on a Deck; AI allies' jump Links taken (an ally's surface going from a Hall floor to a Deck without standing on its Ramp, airborne between); the Tick (mean, p99, max) against Stage 0's T2 (0.31 to 0.41 ms here) and Stage 3's soak (0.51); the Floor's build (`delverFloor` and `navMesh`) against Stage 1's 241 ms and 17 ms. **It must show**: every Floor with 2 or more Hall levels, and the party on a Ramp.
- **Three scenarios**, each on a Floor found by searching seeds (the first, in seed order, that has what it needs), with what it must show:
  - **A jump shortcut**: on an empty Floor (`postFill` 0, `patrolFill` 0), the Player stands on a balcony's Deck and a Hard AI ally on its Hall's floor 3 m in front of the Deck's front edge. Within 20 s the ally stands on the Deck, by a jump Link (it was airborne, and never on that gallery's Ramp).
  - **A chase across a level**: a guard in a Hall with a sloped Passage; the Player in sight of it walks away up that Passage by the navmesh. The guard chases, and its anchor climbs the Ramp.
  - **Warbands promoted on a balcony**: a Deck post's guard; the Player walks to its Hall's floor in front of the Deck. A Soldier standing on the Deck is promoted.

**Tasks** (one after another, but 4 may run beside 3: their files are disjoint):
1. **The Map Source and the navmesh**: `src/mapEditor/source.ts` (`top`, `shortcuts`), `compile.ts`, `src/tuning/battle.ts` (`shortcuts`), `src/tuning/arena.ts` (`jumpLinks`), `src/sim/battlefield.ts` (`buildMap`), `src/sim/nav.ts` (shortcuts only), their tests.
2. **The generator**: `data/delver.json`, `src/tuning/delver.ts`, `tuning.test.ts`, `delver.test.ts`, `src/sim/delver/plan.ts`, `source.ts`, `judge.ts`, `generate.ts`, `version.ts`, `flat.testdata.ts`, and the plan, judge, golden and generator slow tests.
3. **The Run on levels**: `src/sim/delverRun.ts`, `delverLoot.ts`, `src/sim/delver/warbands.ts`, `src/sim/warband.ts`, `src/controllers/delverPilot.ts`, `allyAi.ts`, and their tests (new cases; the flat-Floor moves of §8).
4. **Render**: `src/render/delverMarks.ts`, `delverStandIns.ts`, `restFire.ts` if it needs a height, and their tests; checks `floorCrowd.ts`, `floorBodies.ts` and `pickupView.ts` draw at their heights.
5. **The soak**: `warbandSoak.slow.test.ts`'s new cases and the measurements.

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

## Answered questions (2026-11-14, before Stage 6)
1. No two Floor elements overlap seen from above: no bridges over Passages, no Halls over Halls. The maps stay flat.
2. A balcony inside its own Hall is allowed.
3. Heights change by sloped Passages, stairwell Halls and Jumps (a Player Jumps up to 4 m); a Jump is only ever a shortcut.
4. The minimap and Floor Map are not changed in Stage 6.
