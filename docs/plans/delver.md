# Delver: the Run as one continuous dungeon per Floor

> Status: scope agreed (2026-11-12), the open questions answered by the user. Stage 0 done (2026-11-12): a go on large Floors (ADR 0028). Stage 1 done (2026-11-12): the Floor generator, judged over 500 seeds and viewable in the Map Editor. Stage 2 done (2026-11-13): a solo Delver Run on empty Floors, behind `?dev=1&delver=1`. Stage 3 done (2026-11-13): Warbands guard, patrol, chase and return on the Floors, promoted by an enemy-only Bubble; the first playable Run against them. Stage 4 done (2026-11-13): Warband drops and Treasure pedestals per Player, elite Warbands with Relics, and a Boss Floor ending each tier, its Stairs gated until the Boss Warband is wiped. Stage 5 done (2026-11-13): the Reveal (by entering) and the fog-of-war minimap and Floor Map, stand-in Stairs and pedestal art, the Floor HUD line, the Descending banner and a results screen with Floors reached, Warbands and Bosses beaten and each Build; the last Boss now wins at its Stairs, not at its wipe. Stage 6 done (2026-11-14): Floors of several levels, with sloped Passages, galleries (balconies and stairwells) and Jump shortcuts onto their Decks taken by the AI by shortcut jump Links. Stage 7 (rooms, added 2026-11-14 after Stage 6's playtest) runs in sub-stages 7a to 7e. Stage 7a done (2026-11-14): Halls 14 to 28 m on a coarser 6 × 6 lattice, 1 or 2 great halls a Floor (the Boss Hall always one), and L, S and Z Passages of legs and corners. Stage 7b done (2026-11-14): L, T, cross and ring Halls cut out by solid Blocks, and pillars in colonnades and grids. Stage 7c done (2026-11-16): split levels, sunken pits (2 and 4 m), daises (a Boss's throne, a Treasure altar), galleries that wrap round corners and stairwells far more often; about 1 Hall in 4 has a split, pit or dais. Floor length by tier (issue #135, 2026-11-16): `delver.tierRooms` [7, 10, 20], so the first tier's Floors have a third of a full Floor's Halls, the second's half and the last's all 20 (`floorTuningOf`; `DELVER_VERSION` 9). 7d and 7e were parked (2026-11-16, the user's call). Stage 8 done (2026-11-16): four Players online, AI allies and an AI Takeover proven in step, name tags over the party, and a four-peer Run to Victory at Input Delay 3. Stage 8a done (2026-11-16): traitors (issue #134), Players on Team 1 who take over Warband Soldiers out of the party's sight, with a growing wait after each death; an all-AI party; `PROTOCOL_VERSION` 31. Stage 9 done (2026-11-16): the Hall graph and Doors retired; a Gauntlet is always a Run on generated Floors; `PROTOCOL_VERSION` 32. Stage 7d done (2026-11-23): lava in pits, rivers with bridges and troughs, about 1 Hall in 6, 4 and 3 that may hold it by tier, judged and kept off by the Soldiers and the AI; `DELVER_VERSION` 14. Stage 7f done (2026-11-24): set pieces (Lava Bridge, Uphill Room, Spiral Stair); `DELVER_VERSION` 15. Stage 7g done (2026-11-24): drawn rooms, drawn 1:1 in the Map Editor's room mode and saved as `data/delver/rooms/<name>.json`, the first one `crucible`; `DELVER_VERSION` 16. Left: the parked 7e. Builds on the Dungeon (`docs/plans/dungeon.md`, Stages 1 to 4 done), the Big Battle's Crowd, Squads and Bubble (`docs/plans/big-battle.md`, `docs/plans/battle-objectives.md`, ADRs 0020 to 0022) and the Map Editor's Map Source and Enclosure Brush (`docs/plans/map-editor.md`, ADR 0023). Each Stage ends with a `### Result`, as in the other plans.

## Progress
- [x] Stage 0: spike and ADR (one continuous Arena per Floor; budgets measured)
- [x] Stage 1: the Floor generator (rooms and passages on one level → Map Source → compiled Arena)
- [x] Stage 2: the Delver Run loop, solo (entrance, Stairs, Rest fires, revive, no enemies)
- [x] Stage 3: Warbands (Crowd Squads that guard, patrol, chase and return; enemy-only Bubble)
- [x] Stage 4: loot, Treasure Halls and Boss Floors
- [x] Stage 5: presentation (fog-of-war minimap and Floor Map, Stairs and fires, HUD)
- [x] Stage 6: verticality (balconies, stairwells, sloped Passages, Jump shortcuts)
- [x] Stage 7a: bigger Halls, great halls, L-, S- and Z-shaped Passages
- [x] Stage 7b: Hall shapes (L, T, cross, ring), pillars and cover
- [x] Stage 7c: verticality inside a Hall (split levels, sunken pits, daises, more stairwells and galleries)
- [x] Stage 7d: lava (pits, rivers with bridges, troughs; the judge's lava rules)
- [x] Stage 7f: set-piece rooms (Lava Bridge, Uphill Room, Spiral Stair)
- [x] Stage 7g: drawn rooms (special rooms drawn 1:1 in the Map Editor's room mode, saved as `data/delver/rooms/<name>.json`; designed 2026-11-24)
- [ ] Stage 7e: archetypes (procedural room recipes per Hall kind) (parked)
- [x] Stage 8: online co-op (up to four Players, Input Delay, soak)
- [x] Stage 8a: traitors (humans on Team 1 driving Warband Soldiers; issue #134)
- [x] Stage 9: retire the Hall graph and Doors; `CONTEXT.md` and ADRs brought up to date

## Context
A Run today is a walk through a Floor graph of Halls. Each Hall is its own small Generated Arena (7 × 7 cells) holding one Duel against one Encounter of at most four enemies. Doors chosen by walking lead to the next Hall (ADR 0019). It plays well, but it feels like a string of separate duels with a fade between them.

We want a dungeon crawler. Each Floor is one continuous, generated dungeon of rooms and passages, with squads of enemies living in it, loot, Rest places and Stairs down somewhere in it. The party explores, fights the squads it runs into (or sneaks past them) and finds the Stairs. Then it does the same again, deeper.

Since the Dungeon plan, three things exist that make this possible:
- **The Enclosure Brush and the Map Compiler.** A room with Walls, doorways and a roof is one Brush. A pure, deterministic compiler (`compileMap`) turns a Map Source into ordinary `ArenaGeometry`, checked by the game's own `parseBattleMap` and `walkCheck`, with a generated look (`mapModel`) that needs no Blender.
- **The Crowd, Squads and Bubble.** Hundreds of cheap Soldiers live in `SimState.crowd`. Near a Player they are promoted into a fixed Fighter Pool (16 slots) and fight as full Fighters. This removes the four-slot Team 1 limit that ruled out a continuous dungeon in `dungeon.md`.
- **Battle maps of several levels.** The walk rule, per-level destination fields and Promotion across floors (ADR 0022).

## Decisions (agreed in the brainstorm)
- **It replaces the Gauntlet's Hall graph and keeps the Run's meta.** It is still the Gauntlet Format and still a Run: Team 0 has 1 to 4 Fighters (Players and AI allies), HP carries over, Relics, the Inventory, per-Player loot, AI Takeover, the Run seed from the Random Map, a results screen, and no Rematch. What changes is the inside of a Floor. It stops being a graph of Halls and becomes one continuous Arena. The Hall/Door graph code is retired in Stage 9, as the Dungeon retired the v1 Run.
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
- **Rest places are fires in Rest Halls, one on each even Floor and none on an odd one** (`delver.restEvery` 2, `floor.rests` [1, 1]; it was 1 or 2 on every Floor):
  - **Heal once**: each Player's Fighter that stands at a fire heals `dungeon.restHeal` of its max HP, once per fire.
  - **Revive, once a fire**: the first time a living Player reaches a fire, it brings back every Player fallen at that moment, at the fire, at `dungeon.restRevive` of max HP (0.75; a Player brought back takes no heal at that fire, so it stands at 75% while the living there heal `restHeal`, 1, to full; changed 2026-11-18 to make the Run easier). Then that fire's revive is spent (its heal is still there for those who have not taken it). A fallen Player watches with the orbit camera until a fire or the Stairs revives them. Taking the Stairs revives everyone too. A wipe ends the Run (a Defeat). A fallen Fighter keeps its Inventory.
  - **The Inventory changes only at a fire** (within its radius). This stands in for "the Hall is Cleared", since a Floor is never wholly cleared. Picking an item up is allowed anywhere there is room for it. _(Superseded: the Inventory now changes anywhere on the Floor, in a fight too, only never mid-Action, in the air, fallen or while Descending.)_
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
- **Door**, **Floor graph**: retired in Stage 9.

## How it fits the existing code
- **A Floor's Duel is a Battle-shaped Duel inside a Run.** `SimState.crowd` holds the Warbands' Soldiers. `fighters` is the Fighter Pool, with the party in slots 0 to 3 for good and the rest bound by the Bubble. `stepMatch`'s Gauntlet branch keeps `RunState` and steps the Crowd and Bubbles as the Battle branch does. What a Battle has and a Floor does not: Objectives, Commanders, Tickets, respawning Squads, Troop choice and takeover of Soldiers. Split them behind the Format instead of copying the Battle branch.
- **`RunState`** becomes `{ floor, phase, stairsTicks, restUsed, revealed, startTick, ... }`. `row`, `hall`, `path` and `doorTicks` go (in Stage 9). `phase` is `Exploring` or `Descending` (the fade).
- **Floor generator** (`src/sim/delverGen.ts`, pure, Opus): seed → Hall layout → Map Source, then `compileMap` → Arena. The current Map Source is a Battle map's (Objectives, Bases, `front`). It needs a Delver variant, or a section of markers: entrance spawns, Stairs zone, fires, Treasure pedestals, Warband posts and patrol loops. `compileMap` takes `BattleTuning` fields today, so check what it really needs.
- **Destination fields**: a Battle builds one per Objective. A Floor needs one per post and patrol waypoint (static, built with the Floor) plus one toward each chased Player, rebuilt when that Player changes cell. These are caches derived from state, never stored. Measure their cost in Stage 0.
- **Squad brain**: `stepSquads` follows a Commander's Order. A Floor's Squads follow their Warband brain instead. Keep Formation, narrowing, morale and the walk rule; replace the Order.
- **Bubble**: enemy-only, as above. `battle.bubble.promote` and `demote` and the Attack Slots apply. Line of sight should gate Promotion through a Wall on one level, as height gates it through a floor (check `inSight`).
- **Rest fires, pickups, Inventory**: `restFire` and `atRestFire` (`src/sim/hall.ts`), `pickups.ts` and `inventory.ts` carry over. The Inventory's "Cleared" gate becomes "within a fire's radius".
- **AI allies** (`allyAi.ts`): follow the nearest Player, as after a Clear today, and fight what the Bubble promotes. They walk to the Stairs only once no Player lives.
- **Render**: the Floor's look comes from `mapModel`, as Map Editor maps do. Fog of war belongs on the minimap and the Floor Map, plus perhaps dimming unrevealed Halls in the world (open question 6).

## Testing the generator (agreed 2026-11-24)
Work on the Floor generator (`src/sim/delver/`: the plan, the source, the judge) is tested in the Map Editor and with the AI check, **not by playing a Run**. Playing a Run was the old loop, and it is much slower.
- **Look at a Floor**: `npm run dev`, open `/sword/#/mapeditor?dev=1&delverSeed=S&delverFloor=F` (or File, Delver seed and floor, Open Delver Floor). The checks list the Soldiers' problems (reachability, edges, clearance, cell centres).
- **Check the AI on it**: add `&aiwalk=1`, or press **Walk the AI** in the Checks folder, and switch on **AI navmesh** and **AI routes**. The AI's problems are listed under the map's, and the traces show where a leg stuck, was slow or died (`docs/plans/map-editor.md`, "the AI check").
- **Soak many Floors after a change**: `npm run ai-walk -- --seeds 1-50 --floors 1,5,9` (add `--drawn`, `--walk-only`, `--difficulty Beginner` or `--quirks Hopper` to vary the AI). It exits 1 on a problem and prints an editor link for each Floor that has one; open the link to see it.
- **Play every set piece in one go**: the main menu's **Set Piece Gallery (dev)** button (with `?dev=1`) starts a solo Run of one Floor, Arena `battle:delver1g<S>` (`galleryFloorTuning`): the Entrance, a plain Hall, then a Lava Bridge, an Uphill, a Spiral and each drawn room in `data/delver/rooms/` file order, snaking over the lattice to the Stairs. Each set piece is a Fight Hall with its Warband; the plain Halls (where the snake turns) are Empty. A new room file joins it with no code change. Add `&immortal=1` or `&autopilot=1` as for any Run.
- The judge's soak (`src/sim/delver/delverGen.slow.test.ts`) and the tests stay as they are. Play a Run only to judge what the editor cannot show: how a Floor feels, fights and Warbands.

## Ramps have no side walls (2026-11-26)
The user asked for every Ramp in Delver to lose its side walls (its `rails`), so a Fighter can walk or be knocked off a ramp's side. This covers the generator's ramps (a split's and a pit's steps, a dais's step, a gallery's Ramp, a Passage's sloped leg, the Spiral's and the Uphill's) and the drawn rooms' (`data/delver/rooms/`, which the Duel maps `room:<name>` share). A ramp's long sides now get only the compiler's step-high skirt, like a platform's edge. `DelverStep.rails` is gone, `DELVER_VERSION` is 17, and a test refuses a rail on a shipped room's Ramp. A Passage's Ramp is still walled on both sides by its Passage's own Enclosure. The judge's Spiral rules now find a Ramp's wall side from its rect (the long side on the Hall's edge, `wallSides` in `judge.ts`) instead of from its rail. The Map Editor can still put rails on a Battle map's Ramps.

## Stages
Run each Stage with `docs/plans/delver-prompt.md`: an Opus session designs the Stage (a `#### Design` section under it) and Sonnet subagents write the code. A Stage's **Model** line says how much design it needs from the orchestrator. Each Stage is one chat, solo and offline until Stage 8. Determinism tests run from Stage 1: same seed, same bytes; whole Floors hashed in slow tests.

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
Done 2026-11-12. **Go** on 20-room Floors with Warbands, and ADR 0028 is written. Online Runs should take an Input Delay (Stage 8). Stage 1 must make every Passage visible to the destination fields.

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
  - **Input Delay**: a full Bubble on a Floor costs what it does on the open field. A Battle Tick of that size needed Input Delay online (ADR 0025), so Stage 8 starts online Runs at `BATTLE_INPUT_DELAY` and measures four Players.
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
- `floorSource(plan): MapSource`, version 1, `size` 200, `grid { step: 0.5, cell: 2 }`, `levels [-8, 0, 4]`. Brushes in this order: the abyss (`kind: 'hazard'`, `hazard: 'abyss'`, the whole field, y −8, as the spike's), then the Halls in index order (Enclosures at y 0, their `doors`, a render-only `material` by kind: Entrance `plaster`, Stairs `cobble` (was `glow` until 2026-11-17), Boss `bloodstone` (dark red dungeon stone), Rest `brick`, Treasure `tile`, Fight `dungeon`, Empty `basalt`), then the Passages in order (Enclosures at y 0, `material: 'stone'`). Objectives `D` (Entrance centre, owner 0, spawn) and `E` (Stairs centre, owner 1, spawn), both weight 1; `bases` the same two points; `front` 52; `armySize { standard: 50, max: 50 }`; no Tickets. `look.props` in this order: `entrance` (banner, team 0, Entrance centre), `fire<n>` (torch), `post<n>` (banner, team 1), `pedestal<n>` (crate), all y 0, turn 0. No sky, no Lobby card.

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
Stage 2 puts the party on generated Floors: a Delver Run of `delver.tiers × delver.floorsPerTier` empty Floors, chosen in solo by a dev flag while the Hall-graph Run stays the Gauntlet's default (until Stage 9). Nothing about a Duel, a Battle or a Hall-graph Run changes: every new field is absent outside a Delver Run, so every existing hash, snapshot and test stands.

**Choosing a Delver Run.**
- **The Match option**: `MatchConfig.delver?: true` (in `MatchOptions` through `Partial<MatchConfig>`). `createMatch` refuses it unless `format` is `'Gauntlet'`, and refuses it with `start` (no dev start Hall). `relics` (dev) still give the first inventory. Absent, a Gauntlet is the Hall-graph Run, as now.
- **The dev flag**: `devDelverRun(search, hash): boolean` (`src/devMode.ts`), true for `?dev=1&delver=1` only. `game.ts` `launch()` adds `delver: true` to a solo Gauntlet's options (`members.length <= 1`), as it adds `devRunStart`. With `&autopilot=…` it puts the local Fighter on the Delver pilot (below) instead of the Hall autopilot.
- **The Lobby**: no setting in Stage 2. An online Gauntlet is always the Hall-graph Run (the flag is read only for solo, so no `PROTOCOL_VERSION` change). Stage 8 adds a Lobby knob synced to guests; Stage 9 drops the choice.
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
/** `MatchState.delver`: a Delver Run's progress (docs/plans/delver.md). Becomes RunState in Stage 9. */
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
- **What stays until Stage 9**: the whole Hall-graph `RunState` (`row`, `hall`, `path`, `doorTicks`, `rested`, its `phase`) and `SimHall`, for the Hall-graph Run only. Stage 9 deletes them and renames `DelverRun` to `RunState` and `MatchState.delver` to `run`.
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
- **Existing tests**: none is rewritten or removed. The Hall-graph Run ships until Stage 9, so `dungeonRun.test.ts`, `gauntlet.soak.test.ts`, `takeover.test.ts`, the Door and Floor Map tests and the rest stay as its tests. `delverRun.test.ts` is their Floor counterpart, and Stage 9 removes the Hall-graph ones. `src/tuning/delver.test.ts` gains the `fireRadius` check (a new test, no changed expectation).

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
- **No existing test was rewritten or removed.** The Hall-graph Run ships until Stage 9, so `dungeonRun.test.ts` and the rest stay as its tests, and `delverRun.test.ts` is their Floor counterpart. Two existing files gained a key: `delver.test.ts` and `tuning.test.ts`'s `goodRaw()` have `fireRadius`.

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
- **Online now, not in Stage 8.** The Delver Run is wired into the Lobby and the Rollback session ahead of its Stage:
  - **The Lobby**: `LobbySettings.delver?: true`, for the Gauntlet only. The host chooses it with a "Dungeon: Halls | Delver" row in the Map section, which shows only for the Gauntlet. It is synced to guests like the other settings (`src/lobby/messages.ts` checks it) and remembered in storage (`sword.delver`). `?dev=1&delver=1` still turns it on.
  - **The session**:
    - The host's Match options carry `delver: true`, and so does every hello a peer sends after the start, as `humans` does today.
    - `src/net/messages.ts` accepts and checks `MatchOptions.delver`, `MatchConfig.delver`, `MatchState.delver` and `SimState.delver` in a resync. A Delver state has `run` null, its Duel has no `hall`, and `duel.delver` mirrors the Run's floor, phase and away.
    - `PROTOCOL_VERSION` goes up by 1.
    - **Input Delay stays 0** for a Run. With no Crowd on a Floor yet, the Tick is a Duel's. Stage 8 measures it with Warbands, as ADR 0028 says.
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
- **The Lobby Lineup** is unchanged: a Gauntlet's Lineup keeps its 4 Team 1 slots, which a Delver Run ignores (Stage 9 drops them). `lineupMatch` is unchanged (`createMatch` drops the slots). `lineupAis(tuning, lineup, format, match)` takes `delver` in `match` (`Pick<MatchOptions, 'seed' | 'arena' | 'delver'>`): for a Delver Gauntlet it returns the party's entries as now (null for a Player, an Ally AI for an AI) and then a Pool AI (`createPoolAi`) for every slot k to poolSize − 1. No Hall AI. Every caller passes `delver` (`game.ts`, `play/driver.ts`, `net/session.ts`, the harnesses).
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
"postFill": 75, "patrolFill": 100, "perPlayerSoldiers": 1, "attackSlots": [4, 3, 3, 3], "tierHp": [1, 1.25, 1.5],
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
- **The Tuning Data keys and defaults**: `sight` 16 m, `leash` 45 m (walking: about one and a half Halls), `forgetSeconds` 8, `chaseSpeed` 1 (× `crowd.walkSpeed`, 2.5 m/s; Guard, Patrol and Return walk at `squad.speed` 0.8 of it), `closeIn` 4 m, `arrive` 3 m, `postFill` 75, `patrolFill` 100, `perPlayerSoldiers` 1, `attackSlots` [4, 3, 3, 3], `tierHp` [1, 1.25, 1.5].

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
- **Roofs** (an Enclosure's `top`, below): a plain Hall `HALL_STOREY = 4` m over its floor (as today; raised to 6 m by issue #163, and the gallery Hall's to 8 m, so a full Jump has room; a Passage keeps 4 m as `PASSAGE_STOREY`). A gallery Hall `GALLERY_STOREY = 6` m, so its Deck stands 4 m under the roof: more than a Fighter's height at the largest Size (`fighter.height` × MAX_SIZE = 2.52 m). Under the Deck there is 2 m: Fighters walk under it (nothing in the Simulation stops a walk under a Walk Surface; a tall body clips the Deck when drawn, accepted). A Passage's roof is `HALL_STOREY` over its higher door.
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

### Result
Done 2026-11-14. Delver Floors now have levels. Halls stand at 0 to 8 m. About a third of the Passages are sloped, a Ramp along their whole length. About five Halls a Floor have a gallery: a Deck 2 m up along one wall, reached by a Ramp inside the Hall. Most galleries are balconies; about one in nine is a stairwell, with a Passage leaving through its wall at the Deck's height. The Deck's open front is the Floor's only Jump shortcut, and the AI allies, the pilot and promoted enemies take it by a shortcut jump Link. Seen from above nothing overlaps, so the Reveal, the minimap and the Floor Map are unchanged. Battles, Duels and the Hall-graph Run are unchanged. With a flat Tuning (`levels.max` 0, `galleryPercent` 0) a Floor's map is byte-identical to Stage 5's.

**What was built** (as the Design gives it, with the changes below):
- **The Map Source and the navmesh**:
  - `EnclosureBrush.top`, a ceiling higher than the next level.
  - `shortcuts: true` on a Map Source and a compiled map.
  - `ArenaGeometry.jumpLinks: 'shortcuts'`: the navmesh keeps only shortcut jump Links (ADR 0013), never onto a roof.
- **The generator** (`plan.ts`, `source.ts`; `DELVER_VERSION` 5):
  - `delver.floor.levels` (`max` 4, `min` 2, `changePercent` 35, `galleryPercent` 40).
  - Galleries, levels on the tree, the loop filter, door heights, Deck posts and every marker's `y`.
  - The source's levels, tall Hall and Passage Enclosures, Decks and Ramps.
- **The judge**:
  - the new `levels` and `galleries` rules;
  - `passages` both ways, along the Passage itself;
  - `markers` and `sight` at each marker's height;
  - `floorNear`, the floor nearest a height that is neither deadly nor a roof.
- **The Run** (`delverRun.ts`, `delverLoot.ts`, `warbands.ts`, `warband.ts`, `delverPilot.ts`, `allyAi.ts`):
  - Spawns, the Stairs, fires, revives, drops, pedestals, homes and deployment are at their heights.
  - A Deck post faces along its Deck toward its Ramp.
  - A Warband sees within `levels.promote` (2.5 m) above or below.
  - A drop's height is where its last Soldier died.
- **Render**:
  - The Stairs, the gate, fires, rings and pedestal rings are drawn at their heights.
  - The Promotion puff appears on the Soldier's own Walk Surface.

**Changed from the Design:**
- **The `passages` rule measures the Passage itself**, 1 m inside each end. Hall centre to Hall centre, a stairwell's way round its Ramp and back along its Deck (up to 42 m against a 24 m Passage) made 28% of attempts reroll.
- **An Enclosure's roof is no ledge to wall for a floor inside that same Enclosure** (`compile.ts`'s face rule). Without it a Deck under its own roof got a Wall along its open front, sealing the floor beneath. The first version skipped every Enclosure's roof; the code review narrowed it to the body's own Enclosure, so hand-made maps keep their face Walls.
- **`fieldAt` reads the node within a step on the same level** (the fields' own `nodeIn`, now exported) when a seam between floor pieces falls on a Hall's centre.
- **From the code review**:
  - Drops and the `passages` rule's end points stand on `floorNear`. Before, a spot more than a step above the fall height on a Ramp landed in the abyss, and every 4 m sloped Passage was refused, which forced rerolls.
  - The fall's height is read where the Soldier died, not where it was promoted.
  - The Map Editor's panel keeps an Enclosure's `top`.
  - A missing Passage Brush fires `passages` again (Stage 1's test restored).
  - No roof targets on a shortcuts map.
  - The judge's fields are cached.
  - `DELVER_VERSION` 5.
- **The full Run's Boss-first check** is now Stage 4's rule as written. Before, it asserted that the Boss is promoted before any guard, which held only by luck. On levelled Floor 9 a guard was 10.0 m from the Player by walking and the Boss 10.8 m (`bubble.promote` 10), so only the guard was promotable. The check now is that no guard is promoted while the Boss is promotable into that Bubble and left out.

**Existing tests changed (as Design §8 allows):**
- `golden.test.ts`:
  - The default pins are rewritten.
  - A new flat case gives the Stage 5 map pins exactly, and so does the old-Floor-9 case.
- `tuning.test.ts`'s `goodRaw()` and `delver.test.ts`: the `levels` block.
- `delverLoot.test.ts`: `dropSpots`' new arguments.
- `delverMarks.test.ts`: the gate's height is now `stairs.y`.
- These run on `flatFloors`, their expectations unchanged:
  - `delverRun.test.ts`, `delverBoss.test.ts`, `delverWarbands.test.ts`
  - `delverAi.test.ts`, `delverPilot.test.ts`, `floorPoolAi.test.ts`
  - `warband.test.ts`, `floorBubble.test.ts`, `fieldToward.test.ts`
  - the net `delverRun.test.ts`
  - the Delver parts of `arenaWorlds.test.ts` and `hud.test.ts`
  - the soak's "a chase given up" and "the patrols"
- `warbands.test.ts` went flat and came back once Deck posts faced their Ramp.
- None was removed.

**Measured** (the test container, about 3× a mid-range laptop):
- **The generator** (500 pairs; the first figures are from `DELVER_VERSION` 5, the counts from version 4's run):
  - Every pair passed on its first attempt.
  - Build mean 255 ms, total with the judge 272 ms (p95 346). Stage 1 was 241 ms; Stage 0's "Floor ready" was 110 to 153 ms.
  - Navmesh mean 95.5 ms on 20 Floors (Stage 1: 17 ms). It is the jump Link search. It is warmed a Floor ahead, so the fade only reads the cache.
  - 122 jump Links, all shortcuts onto a Deck, and every Deck has one.
  - Hall levels per Floor: 2 levels on 61 Floors, 3 on 234, 4 on 161 and 5 on 44.
  - 2,948 galleries: 2,607 balconies and 341 stairwells.
  - 4,490 of 12,447 Passages sloped, and 1,393 Deck posts.
- **The levelled Runs** (`warbandSoak.slow.test.ts`; 3 seeds × 3 Floors, the pilot and two Hard allies, immortal; version 4):
  - Every Floor had 2 to 4 Hall levels, and the party spent 508 s on Ramps in all.
  - 3 chases crossed a level (the anchor rose 2 m each time).
  - 10 Promotions were of a Soldier on a Deck.
  - The AI allies took 2 jump Links unprompted.
  - Tick mean 0.49 ms, p99 3.25 (Stage 3's soak: 0.51; Stage 0's T2: 0.31 to 0.41).
  - Floor build 307 ms and navmesh 106 ms cold, under load.
- **The scenarios**:
  - **A jump shortcut**: the ally was on the Deck in 1.7 s, airborne 58 Ticks, and never on the Ramp.
  - **A chase across a level**: the guard's anchor climbed 1.56 m up a sloped Passage. The 1.5 m bar is a thin margin.
  - **A balcony Promotion**: all 3 of a Deck post's Soldiers were promoted on the Deck.
- **Stage 2's empty-Floor walk** on levelled Floors: 148 to 201 s to the Stairs (was about 130 s), and the allies trailed by 1.5 to 2.2 m.

**Tests**:
- `npm run typecheck` is clean.
- `npm test`: **2915 passed, 5 skipped** (2849 before the Stage).
  - New files: `delverLevels.test.ts` (sim, 11) and `delverLevels.test.ts` (controllers, 2).
  - New cases in `enclosure.test.ts`, `plan.test.ts`, `judge.test.ts`, `golden.test.ts`, `delverLoot.test.ts`, `delver.test.ts` and `delverMarks.test.ts`.
- `npm run test:slow`: 24 files and **50 tests** passed (46 before), including the soak's 4 new cases.

**In the game** (`npm run dev`, `?dev=1&delver=1&autopilot=1&immortal=1`, an Expert ally; the camera placed by a temporary dev hook, not committed; screenshots in `docs/plans/delver-stage6/`, all looked at):
- `sloped-passage.png`: a Passage climbing from a lower Hall's doorway to a higher one.
- `stairwell.png` (collider view): a Deck along a Hall's back wall with its Ramp, a Passage leaving through the wall at the Deck's height, and a magenta jump Link arc up onto the Deck.
- `balcony-warband.png`: a guard Warband standing on its balcony's Deck under its banner.
- `jump-shortcut.png` (collider view): the jump Link arc from the floor onto a balcony with two promoted enemies on it.
- The Run played on through Floors 1 to 4 at speed 4 with no error. The Deck is drawn as a thin wooden board with no supports under it.

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Dungeon: Delver, add an AI ally, Fight.
- Jump onto a balcony (hold Space) and see your ally follow by the same Jump.
- Fight a Warband posted on a balcony from below, or go up its Ramp.
- Walk up a sloped Passage with a Warband chasing you.

**To watch next**:
- **The camera in galleries**: under a Deck there are 2 m of headroom, and a tall Fighter's head goes through the Deck when drawn.
- **Soldiers drop off a Deck** (2 m, within `levels.drop`) when they chase. Promoted Fighters that drop Stagger past `safeHeight`.
- **Stairwells are rare** (1 in 9 galleries): they need a Hall at least 9 m along and 8 m across its wall.
- **The Deck's look** is a plain board. #62's art could give it supports and a railing.
- **The navmesh is 5 to 6 times Stage 1's** (about 0.3 s laptop-equivalent). It is warmed a Floor ahead, but a cold first Floor pays it behind the menu.

### Stage 7: rooms
Added 2026-11-14 after Stage 6's playtest. The user's feedback: rooms should be bigger and more interesting, some should have more verticality (doorways at different heights), and some should have lava pits to push enemies into. The calls are in "Answered questions (2026-11-14, after Stage 6)".

Stage 7 is run as five sub-stages, 7a to 7e, in order. Each is one orchestrator session (`docs/plans/delver-prompt.md`) with its own `#### Design`, its own 2 to 6 Sonnet tasks and its own `### Result`, and each ends in a playtest. Each sub-stage raises `DELVER_VERSION` by one. Each keeps a golden case with its own knobs off, byte-identical to the sub-stage before it. With every Stage 7 knob off, a Floor is byte-identical to Stage 6's (a `flatRooms` case in `golden.test.ts`). Battles, Duels and the Hall-graph Run are unchanged throughout. Commits are "Delver Stage 7a: ..." and so on.

What every sub-stage shares:
- **The Hall's footprint** becomes a list of rects (7b), not one rect. Until 7b it is one rect.
- **The judge** gains each sub-stage's rules, and every sub-stage reruns the 500-seed pair run. Rerolls must stay rare, about 1 attempt in 20 at most.
- **The measurements**: build time, judge time and navmesh time on the 500 pairs; the soak (`warbandSoak.slow.test.ts`) on the new Floors; and Stage 2's empty-Floor walk time.

### Stage 7a: bigger Halls, great halls and turning Passages
**Model**: Opus (layout).
- **Bigger Halls**: most Halls 14 to 28 m across (now 10 to 22, `halfSize`).
- **Great halls**: 1 or 2 a Floor, 35 to 45 m across. The Boss Hall is always one, and the others go to Treasure Halls and the biggest fight posts. A great hall may take two grid cells.
- **The grid** grows to fit (`gaps`). If the walk to the Stairs grows past about 1.3× Stage 6's, `rooms` comes down so a Floor stays about as long.
- **L-, S- and Z-shaped Passages**: a Passage may turn once (an L) or twice (an S or a Z, its two ends parallel and offset), always at right angles.
  - Two Halls that are not face to face can then be joined, and a Passage can go round a Hall.
  - A sloped Passage climbs on its straight legs only, and every corner is level.
  - The judge's `passages` rule measures along every leg. Seen from above, no Passage crosses another or a Hall.
  - Each leg is one Passage Brush (Floor or Ramp) inside its own Enclosure, joined at an open corner.
- **Squads** must file round a corner: the soak shows a patrol and a chase through an L and an S Passage.
- **Done**: the 500 pairs judged, with L, S and Z Passages counted; the soak; the walk time; screenshots of a great hall and of each Passage shape.

#### Design
Written 2026-11-14 at the sub-stage's start. Battles, Duels and the Hall-graph Run are unchanged. **No new hashed state**: everything new is in the plan and the Map Source, rebuilt on every peer from (Run seed, Floor). `PROTOCOL_VERSION` stays 30; `DELVER_VERSION` goes to 6. **With every 7a knob off** (`flatRooms`, below) a Floor's compiled map is byte for byte Stage 6's: no new pick changes a decision, the candidate lists are the same, and every straight Passage is written as before.

**The field stays the Battles' 200 m.** A Floor's field is `battle.field.size`, which `compileMap`, the Crowd, the fields and the Map Editor all read. So the lattice gets coarser instead: 6 × 6 cells 30 to 32 m apart, against Stage 6's 7 × 6 cells 22 to 28 m apart. The Floor is about 155 m across either way (Stage 6: 150 × 125).

**1. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`, `delver.floor`), the shipped values, with Stage 6's in brackets:
```json
"cols": 6, "rows": 6, "rooms": 20, "gaps": [30, 32], "halfSize": [7, 14],
"turnPercent": 30,
"great": { "count": [1, 2], "half": [18, 22] }
```
(cols 7, rows 6, rooms 22, gaps [22, 24, 26, 28], halfSize [5, 11]; `turnPercent` and `great` are new.) Every other `floor` key is unchanged.
- `halfSize` [7, 14]: Halls 14 to 28 m across, as the plan asks. A gap of 30 caps a Hall at 26 m (`limX` 13) and 32 at 28.
- `turnPercent`: the chance (in 100) that a growth step takes a turning candidate (an L, S or Z Passage) when there is one. With 0, no turning Passage is ever made, as a tree Passage or as a loop.
- `great.count` [min, max]: great halls per Floor (whole, 0 ≤ min ≤ max ≤ 4). `great.half` [min, max]: a great hall's half length along its two cells (whole m). [18, 22] gives 36 to 44 m.
- **Parse checks** (new): `turnPercent` is a percent. `great.count` is an ascending whole pair with max ≤ 4. `great.half` is an ascending whole pair with `great.half[0] > halfSize[1]`. Also `great.half[1] + 1 ≤ min(gaps) / 2 + min(floor((min(gaps) − minPassage) / 2), halfSize[1])`, so a great hall can always take its size and dodge an even-metre Wall. The existing lattice-fits-the-field check is unchanged: 5 × 32 / 2 + 14 + 2 = 96 ≤ 100.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts` gain the keys and their checks.
- **`flatRooms(tuning)`** (tests only, `src/sim/delver/flat.testdata.ts`): Stage 6's lattice with the knobs off: `cols 7, rows 6, rooms 22, gaps [22, 24, 26, 28], halfSize [5, 11], turnPercent 0, great { count [0, 0], half [12, 16] }`. `flatFloors(flatRooms(t))` is Stage 5's flat Floor.
- **`rooms7a(tuning)`** (tests only, same file; Tasks 1 to 3 only, removed in Task 4): the shipped values above, for the tests written before the bundled data switches.
- **The walk**: if the mean Stairs depth over the 500 pairs (plan metres, `halls[stairs].depth`) is more than 1.3 × Stage 6's (the same pairs planned under `flatRooms`), `rooms` comes down one at a time (not below 16) until it is not. Task 4 does this and records it.

**2. Words.** A **great hall** is a Hall over two neighbouring lattice cells: one Enclosure rect, centred between the two cells' centres. A Hall's **slots** are where a Passage may leave it: one per side for a one-cell Hall, at the side's centre. A great hall has one at each short end (at the side's centre) and two on each long side, one on each of its cells' centre lines (offset from the side's centre by half a gap). A slot holds at most one Passage. A Passage is **straight** (one leg) or **turns** at right angles: an **L** (one corner), or an **S** or a **Z** (two corners, its two ends parallel and offset). It is a Z when its first turn, walking from `a`, is clockwise, and an S when it is anticlockwise. A **leg** is a straight stretch `passage` m wide. A **corner** is the `passage` × `passage` square where two legs meet. Legs and corners are a Passage's **pieces**. Each is its own Enclosure, joined to the next by a full-width doorway.

**3. The plan** (`plan.ts`; all `readonly`):
```ts
export type PassageShape = 'straight' | 'L' | 'S' | 'Z';
export interface PassagePiece {
  rect: Rect;
  /** A corner is the w × w square two legs meet in; a leg runs along `axis` (a corner's `axis` is that of the leg before it). */
  corner: boolean;
  axis: 'x' | 'z';
  /** The side it is entered by, walking from `a`'s end, and the side it is left by toward `b`'s. A leg's are opposite; a corner's are not. */
  from: Side;
  to: Side;
  /** Its floor's height (m) at its `from` and at its `to` side: equal, but on the Passage's one sloped leg. */
  y0: number;
  y1: number;
}
DelverHall    += cells: readonly number[] /* the lattice cells it covers, ascending: one, or two for a great hall */; great: boolean
DelverPassage += shape: PassageShape; sideA: Side; sideB: Side /* the sides of a and b it leaves by */; pieces: readonly PassagePiece[] /* from a's end to b's */
```
- `rect` becomes the bounding rect of its pieces: for a straight Passage, its one piece's rect (as before). **It is never a place test**: whatever asks "which place holds this point", or draws a Passage, uses its pieces (§6).
- `axis` is the axis of its first leg.
- **`a` and `b`**: a straight Passage keeps Stage 1's rule (a west or south of b). A turning one has `a` the Hall it was grown or found from.
- `length` is unchanged: centre to centre, |Δx| + |Δz|.
- `i`, `j` are the lowest cell's.

New constants: `PASSAGE_CLEAR = 1` (the least gap, m, between a turning Passage's piece and any Hall or other Passage it does not join, and between a great hall and a Passage; Walls are drawn 0.6 m thick) and `MIN_LEG = 2` (an S or Z's shortest end leg, m).

New `SALT` keys: greatCount 40, greatAxis 41, greatLong 42, great 43, turn 44, turnPick 45.

**The algorithm**, Stage 6's steps with these changes.
- **0. A cell's Hall rect** (`cellRect(c)`): what `place(c)` gives a one-cell Hall there, from its own picks. The **reach rect** of a cell is its `cellRect`. The one exception is a Boss Floor with `great.count[1]` 0: there Stage 4 may grow the Stairs Hall, so the reach rect is the grown rect, `offDots(min(halfSize[1], lim))` on both axes. The clearance checks below test against reach rects, so no later Hall can land on a Passage.
- `offDots(half, centre, lo, hi)` takes its bounds as arguments: lo is `halfSize[0]` (or `great.half[0]` for a great hall's long half), and hi is the limit.
- **1b. Great halls wanted**: when `great.count[1] > 0`, G = `count[0] + pick(0, greatCount, count[1] − count[0] + 1)`, else 0.
- **A great hall's rect**, over cells c and c' = c + one step along axis k (c the lower):
  - Along k: the centre is the midpoint of the two cell centres (a whole metre, since gaps are even). The half is `offDots(min(great.half[0] + pick(c, greatLong, span), cap), centre, great.half[0], cap)`, with `cap = g / 2 + min(lim_k(c), lim_k(c'), halfSize[1])` and g the gap between the two cells.
  - Across: the shared cell line, half `offDots(min(halfSize[1], lim_across), line, halfSize[0], lim_across)`.
  - So it keeps `minPassage` from every cell beyond it, as a Hall does, and every Wall is on an odd metre.
  - `occupied` holds its index on both cells.
- **3. Growth**:
  - **The start**: on a Boss Floor with G ≥ 1, Hall 0 is a great hall. Its cell is `pick(0, start, cells)` as now, its axis `pick(0, greatAxis, 2)` (0 x, 1 z), and its second cell is the next one along that axis, or the one before it when that is off the lattice. It will be the Boss Hall. The growth then places G − 1 great halls; otherwise it places G.
  - **Due steps**: the k-th of the Gg great halls placed in growth (k = 0 .. Gg − 1) is due from step `floor((k + 1) × rooms / (Gg + 1))`.
  - **Candidates** are listed per Hall (index order), then per free slot (side n, e, s, w; on a side, by ascending cell), with c the slot's cell:
    - **near / far**: as Stage 1, from the slot's cell.
    - **great** (only while one is due): a near candidate's c1, with a second cell tried in this order: c1 + d (along), then c1 + p for each p perpendicular to d in n, e, s, w order. The second cell must be inside the lattice, empty and unreserved, and the great hall's rect must keep `PASSAGE_CLEAR` from every piece of every Passage placed so far. The Passage joining it is straight, into its slot on side opposite(d) at c1.
    - **L** (only when `turnPercent > 0`): c1 = c + d is inside, empty and unreserved (it becomes the corner cell), and t = c1 + p (p perpendicular, n, e, s, w order) is inside, empty and unreserved. The corner is at c1's centre. The new Hall at t is entered by its side opposite(p).
    - **S/Z** (only when `turnPercent > 0`): t = c + d + p is inside, empty and unreserved. The new Hall at t is entered by its side opposite(d). The middle leg runs across the gap between c's and t's lattice lines on d's axis, at a whole-metre line m (below).
    - Each L or S/Z candidate is listed L first, then S/Z, per p.
    - Each L or S/Z must pass the **clearance check**, with t's Hall taken at its reach rect. Its pieces must keep `PASSAGE_CLEAR` from:
      - every other Passage's pieces;
      - every Hall rect (a placed Hall's, or the reach rect of each empty, unreserved cell, t included).
      The exceptions are its first piece against a, and its last piece against t's Hall: those touch and must not overlap.
  - **The step**, in this order:
    1. If a great hall is due and the great list is not empty, place one: `great[pick(step, great, n)]`.
    2. Else, if the turning list (L and S/Z together, in listing order) is not empty and `pick(step, turn, 100) < turnPercent`, take `turns[pick(step, turnPick, n)]`. Place a one-cell Hall at t, join it, and reserve an L's corner cell.
    3. Else Stage 1's far / near step, with its picks unchanged.
    With G 0 and `turnPercent` 0 the lists and picks are Stage 6's.
  - **S/Z's middle line m**, for d along x (along z it is the same with x and z swapped). A is the Hall left (the slot's line z_a), B's reach rect is the one entered (line z_b). H1 is the reach rect of cell c + p and H2 that of c + d, each ignored when its cell is reserved or is the target. Then:
    - `lo = max(A.x1 + MIN_LEG, H1.x1 + PASSAGE_CLEAR) + w/2`;
    - `hi = min(B.x0 − MIN_LEG, H2.x0 − PASSAGE_CLEAR) − w/2` (for d = e; mirrored for d = w);
    - m = `max(ceil(lo), floor((lo + hi) / 2))`, a candidate only if m ≤ hi.
    - The corners are (m, z_a) and (m, z_b). Every value is a multiple of 0.5, so it is exact.
- **3b. Galleries**: as Stage 6, never on a great hall.
- **3c. Levels**: as Stage 6, with each Passage's two slots in place of `p.d` and `opposite(p.d)`. A Passage is forced flat (options [0]) when either end is a gallery's wall or a great hall's long-side slot.
- **4. Loops**: Stage 6's straight candidates, from the slots, then, when `turnPercent > 0`, turning loops. They are found as in growth, but t holds a Hall b with a free slot on the entered side (opposite(p) for an L, opposite(d) for S/Z), and b > h. They must pass the clearance check (b at its own rect), Stage 1's rules (not joined, at least 3 tree Passages apart) and Stage 6's door-level rule (forced flat as in 3c). An L's corner cell is then reserved.
- **5. Pieces**: built from the route (its corners) and the Halls' final rects by one pure function, `passagePieces`:
  - The legs run between consecutive points: a's side, the corners, b's side. A leg stops at a Hall's side or at the edge of a corner's square. Corners are squares on their points.
  - Every leg and corner centre line is a whole metre, so every Passage Wall is on a half metre, off the field's dots.
  - **Heights**: flat Passages are flat throughout. A sloped Passage has exactly one sloped leg: the only leg of a straight one, the leg at the lower end of an L, and the middle leg of an S or Z. Pieces before it stand at `ya`, pieces after it at `yb`, and every corner is level.
    - So a sloped leg's high end always meets a corner, or (straight only) a Hall's side-centre slot, whose doorway cuts it. Stage 6's rule.
    - Every sloped leg is at least 2 × `LEVEL_RISE` long: an L's legs are at least about half a gap, an S/Z middle leg is a gap less w.
  - **A Hall's `doors`** list a side when a Passage attaches there, at the Hall's floor, at that side's centre. That covers a one-cell Hall's sides and a great hall's short ends, as before. A great hall's long-side slots are never listed: their flat Passage's own doorway opens the shared Wall (ADR 0023's rule).
  - **The Boss growth** (Stage 4) runs only when `great.count[1]` is 0. It rebuilds the pieces of every Passage on the Boss Hall. The corners stay put: they were placed against the grown reach rect.
- **7. Kinds**:
  - **A Boss Floor with G ≥ 1**: the Stairs (Boss) Hall is Hall 0. The Entrance is the Hall furthest from Hall 0 by walking among the leaves that are not great (ties go to the lower index). With none, it is the furthest Hall that is not great. Depth and `mainPath` are then from that Entrance, as now. There is no Boss growth.
  - **Otherwise**: the Entrance is picked as now, among the leaves that are not great (and, with none, among the Halls that are not great). The Stairs is the deepest Hall.
  - **Treasure**: its pool is restricted to its great halls when it has any.
  - **Fight / Empty**: an in-line great hall is Empty. Any other great hall is Fight: the first E of the seeded order that are not great become Empty.
  - With G 0 every rule is Stage 6's.
- **In line**: only straight Passages carry the line. A Hall's exit is its slot on the side opposite the one entered, on the same lattice line.
- Patrols, markers (at each Hall's centre, a great hall's included), depth and the main path are unchanged.

**4. The source** (`floorSource`):
- Each Passage writes its pieces in order as Enclosures (`material: 'stone'`). The ids are `pass<n>` for a one-piece Passage (as before) and `pass<n>-<k>` for piece k of a turning one.
- An Enclosure stands at `min(y0, y1)`, with its roof at `max(y0, y1) + HALL_STOREY` (written only when it is not the next level). Its doors are `{ [from]: w, [to]: w }` when flat, else `{ [y0 < y1 ? from : to]: w }` (its low end).
- After the galleries, each sloped leg writes a Ramp, `pass<n>-ramp` or `pass<n>-<k>-ramp`: over the leg's rect, `up` its higher side (`y1 > y0 ? to : from`), railed on both sides across its axis, `stone`.
- `levels` gains every piece's floor and roof.
- A straight-only Floor writes exactly Stage 6's Brushes.

**5. The judge** (`judge.ts`):
- **1. rooms** gains:
  - `rooms: N great halls, A to B wanted` (only when `great.count[1] > 0`);
  - `rooms: the Boss Hall hallX is not a great hall` (a Boss Floor, `great.count[1] > 0`).
- **New `layout`** (plan-only, after `levels`): seen from above, nothing overlaps.
  - No two Halls share interior.
  - No piece shares interior with another Passage's piece, or with any Hall (its own end Halls included: those it may only touch).
  - Every Hall and piece is inside the field.
  - Each line reads `layout: <id> overlaps <id>`, or `layout: <id> is outside the field`.
- **4. passages**, **along every leg**:
  - The checkpoints are the point 1 m inside the first piece from its `from` side (on its centre line, at `y0`), each corner's centre (at its height), and the point 1 m inside the last piece from its `to` side (at `y1`). Each stands on `floorNear` as now.
  - For each consecutive pair of checkpoints, both ways, the field distance must be ≥ 0 and ≤ `follow` × the nominal length between them. The nominal length runs from a's side to the first corner's centre, corner centre to corner centre, and the last corner's centre to b's side.
  - A straight Passage has one pair, of nominal length its whole length, and the same message as before. A turning one names the leg: `passages: pass7 (hall2 to hall9) leg 2 of 3 is not followed from corner 1 to hall9's end: …`.
- Rules 3, 5, 6 and 7 are unchanged (`sight` is blocked by a corner's Walls).
- **`describeFloor`** adds `, G great halls, l L, s S and z Z Passages`.

**6. What reads a Passage's rect** (each moves to its pieces; behaviour on a straight Passage unchanged):
- `revealPlace` (`reveal.ts`): the Halls first, then the first Passage, by index, any of whose pieces holds the point (the same inclusive and exclusive edges).
- `dropSpots`' `rectOf` (`delverLoot.ts`): the Halls' rects, then every Passage's pieces in order.
- `guardFacing` (`warbands.ts`): by `sideA` and `sideB` (a Passage leaves Hall `a` by `sideA`), the sides in n, e, s, w order and the Passages in order within a side, so a great hall's two Passages on a side compare by depth.
- `Minimap.drawDelver` (`src/render/minimap.ts`) and `delverMapLayout` (`src/play/floorMap.ts`): a revealed Passage is drawn as each of its pieces' rects.
- The judge (§5) and the soak's scenario searches, which read `axis` or `rect` as a straight Passage's, are restricted to `shape === 'straight'` where they assume one.

**7. Existing tests this sub-stage rewrites** (only these, and only as said):
- `golden.test.ts`:
  - the default pins are rewritten (`DELVER_VERSION` 6);
  - a new `flatRooms` case gives **Stage 6's default map pins exactly**;
  - the flat and old-Floor-9 cases move onto `flatRooms`, with their map pins unchanged. Every plan pin is new: the plan gained fields.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the new keys.
- `plan.test.ts` and `judge.test.ts`: the cases that assume a one-cell Hall or a straight Passage (side-centred doorways, `rect` as the one piece, a loop's Brush id) run on `flatRooms`, their expectations unchanged.
- `delverGen.slow.test.ts`: far Passages counted as `shape === 'straight'` and longer than `max(gaps)`, and the new counts.
- `warbandSoak.slow.test.ts`'s "a chase across a level": its search takes straight Passages only.
- **Any other existing Delver test that fails only because its Floor's layout changed** (a Hall's place, a marker, a Warband's walk) runs on `flatRooms(tuning)`, composed with `flatFloors` where it was already flat, with its expectations unchanged. Task 4 lists each one. A test that still fails on `flatRooms` is a bug to report.
- No test is removed.

**8. Tests to add**:
- `plan.test.ts` (200 seeds × Floors 1 to 9 on the 7a Tuning):
  - Hall Walls on odd metres. One-cell halves in `halfSize`, and great halls' long halves in `great.half`, over two lattice-neighbour cells and centred between them. The great-hall count in range, with Hall 0 great and the Boss Hall on a Boss Floor.
  - Every Passage's pieces: in a chain, each `to` edge on the next one's `from` edge. The first touches a on `sideA` and the last touches b on `sideB`, at a slot line. Legs are w wide on whole-metre centre lines and corners are w × w. The shape matches the corner count (an S or Z's ends parallel). At most one sloped leg, at least 2 × `LEVEL_RISE` long and placed by §3.5's rule; corners level; heights matching `ya` and `yb`.
  - Pieces keep `PASSAGE_CLEAR` from every Hall and Passage they do not join. A great hall's long-side Passage is flat.
  - Doors as §3.5. The Entrance is never great (when a leaf that is not great exists). A great hall is never Empty unless it is in line. In-line Halls only through straight Passages.
  - Across the 200: L, S and Z Passages, both in the tree and as loops; a sloped L and a sloped S or Z; Floors with 1 and with 2 great halls; a great hall with a long-side Passage; a Boss great hall.
  - On `flatRooms`: every Passage straight with one piece equal to its rect, no great hall, and no 7a pick made (the salts' test, as Stage 6's).
- `source.test.ts` / `judge.test.ts`:
  - a turning Passage's Enclosures, doors and Ramp are as §4, and its Floor compiles and passes `walkCheck`;
  - 7a Floors pass the judge first try;
  - `layout` fires on a piece moved onto a Hall;
  - `rooms` fires on a plan with its great flags stripped, and on a Boss Floor whose Boss Hall is not great;
  - `passages` fires, naming the leg, when a corner's Enclosure is removed from the source;
  - the editor's `checkMap` at 2 m finds no Wall on a node;
  - the navmesh's shortcut-link case holds on a 7a Floor.
- The consumers: `revealPlace` in a corner piece, `dropSpots` for a fall in a corner, `guardFacing` across a turning Passage and a great hall's two Passages on one side, and `delverMapLayout` drawing every piece.
- `delverGen.slow.test.ts` (500 pairs):
  - per Floor, the great halls and the straight, L, S and Z Passages (tree and loop), and the mean Stairs depth against the same pairs under `flatRooms`;
  - the budgets of Stage 6 (build mean ≤ 600 ms, none over 2 s, navmesh mean ≤ 300 ms);
  - **failed attempts at most 1 in 20 pairs**.
  - **It must show it exercised** L, S and Z Passages, sloped turning Passages, great halls on every Boss Floor, Floors with 2 great halls, and Treasure and Fight great halls.

**9. The soak** (`warbandSoak.slow.test.ts`; immortal party):
- The levelled Runs case reruns on the 7a Floors: the Tick against Stage 6's 0.49 ms mean, and the Floor build and navmesh.
- New cases, each on the first Floor in seed order that has what it needs:
  - **A patrol round corners**: with no party (the patrols test's harness), a patrol Warband whose loop holds an L Passage and one whose loop holds an S or Z (one Floor or two). Each walks its whole loop. Each turning leg is walked within 3 s of its walking time. Its anchor stands in every corner piece of those Passages. No Soldier is ever more than 6 m from its place.
  - **A chase round a corner**: a guard in a Hall with an L, and one with an S or Z, on its floor. The Player, in sight, walks away by the navmesh through that Passage to its far Hall. The anchor reaches each corner piece, and at least half the Warband's Soldiers stand in the Passage's last leg at some Tick.
  - Must show, else fail: every corner reached, and the patrols' loops completed.
- **Stage 2's empty-Floor walk** (`delverRun.slow.test.ts`) on the 7a Floors, against Stage 6's 148 to 201 s.

**Tasks** (Tasks 2 and 3 may run side by side: their files are disjoint):
1. **The plan and its Tuning**: `data/delver.json` (the new keys with the knobs off: `turnPercent` 0, `great.count` [0, 0], the lattice unchanged), `src/tuning/delver.ts` with `delver.test.ts` and `tuning.test.ts`, `plan.ts`, `flat.testdata.ts` (`flatRooms`, `rooms7a`), and `plan.test.ts`.
2. **The source and the judge**: `source.ts`, `judge.ts`, `generate.ts` and their tests (on `rooms7a`).
3. **The consumers**: `reveal.ts`, `delverLoot.ts`, `warbands.ts`, `src/render/minimap.ts`, `src/play/floorMap.ts` and their tests.
4. **The switch**: the shipped values in `data/delver.json`, `DELVER_VERSION` 6, the golden pins, §7's moves onto `flatRooms`, `rooms7a` removed, `delverGen.slow.test.ts`, and the walk's `rooms` rule.
5. **The soak**: §9's cases and measurements.

### Result
Done 2026-11-14. Delver Floors now have bigger Halls (14 to 28 m across) on a coarser 6 × 6 lattice 30 to 32 m apart, 1 or 2 great halls a Floor over two lattice cells (36 to 44 m long; the Boss Hall is always one), and Passages that turn: L, S and Z, built of legs and 3 m corner squares, each its own Enclosure. Battles, Duels and the Hall-graph Run are unchanged. With every 7a knob off (`flatRooms`) a Floor's map and plan are byte for byte Stage 6's. No hashed state is new; `DELVER_VERSION` is 6, `PROTOCOL_VERSION` stays 30.

**What was built** (as the Design gives it, with the changes below):
- **Tuning Data** (`delver.floor`): `cols` 6, `rows` 6, `rooms` 20, `gaps` [30, 32], `halfSize` [7, 14], `turnPercent` 30, `great` { `count` [1, 2], `half` [18, 22] }, with their parse checks. `flatRooms(tuning)` (tests) is Stage 6's lattice with the knobs off.
- **The plan** (`plan.ts`): Hall slots; great halls (`cells`, `great`), placed at due growth steps or, on a Boss Floor, as Hall 0 and the Boss Hall; L and S/Z candidates in growth and loops with the clearance check against reach rects; `passagePieces` (legs, corners, the one sloped leg, level corners); `PassagePiece`, `shape`, `sideA`, `sideB`, `pieces`; kinds (the Entrance never great, Treasure prefers a great hall, great halls are Fight unless in line); in line only through straight Passages.
- **The source**: each piece an Enclosure (`pass<n>` for one piece, `pass<n>-<k>` from 0), its low end's doorway on a sloped leg, a Ramp on each sloped leg.
- **The judge**: the great-hall `rooms` lines; the plan-only `layout` rule (nothing overlaps from above, everything inside the field); `passages` along every leg, both ways, a straight Passage's line unchanged; `describeFloor` counts great halls and shapes.
- **The readers**: the Reveal, drops, a guard's facing (by `sideA` and `sideB`), the minimap and the Floor Map go by a Passage's pieces and sides.

**Changed from the Design:**
- **Growth takes a turn when only turns are left** (code review): a step with no near candidate but a turning one takes the turn instead of stalling. The turning list is built only on a step that will use it (the turn pick passed, or nothing else is left): the same plans, less work.
- **Drops in a corner** (code review): a fall in a corner square, or on a leg under 4 m, lays its items along the longest neighbouring leg, so they do not stack on two spots.
- **`great.count[0]` must be at least 1 when `count[1]` is above 0** (code review): a Boss Floor that picked no great hall was always refused.
- **The judge reports a checkpoint with no floor once per Passage**, and far Passages are counted by cells, not length (a great hall's straight Passage is longer than a gap).
- **The L's corner cell is not in its own clearance list** (it holds the corner), and a great candidate is one per near candidate (the first second cell that fits).
- **The S/Z chase scenario runs with a 90 m Leash** (test knob): on the 80 seeds searched, an S or Z's last leg lies 44 to 67 m from the guard's post by walking, beyond the shipped 45 m Leash. So a guard gives up partway along a long S or Z Passage. That is the Leash as tuned (balance is the user's).

**Existing tests changed (as Design §7 allows):**
- `golden.test.ts`: default pins rewritten; a `flatRooms` case whose map and plan hashes are Stage 6's default pins exactly; the flat and old-Floor-9 cases on `flatFloors(flatRooms)`, map pins unchanged. The plan pins moved once in Task 1, when the plan gained its fields.
- `tuning.test.ts`'s `goodRaw()` and `delver.test.ts`: the new keys (its bad-value cases on `flatRooms`; one accepted `great.count` [0, 4] became [1, 4] with the code review's rule).
- On `flatRooms` (or `flatFloors(flatRooms)`), expectations unchanged: the pre-7a cases of `plan.test.ts`, `judge.test.ts`, `reveal.test.ts`, `source.test.ts`'s all-straight case, `floorMap.test.ts`'s layout cases, `fieldToward.test.ts`, `warband.test.ts`, `delverPilot.test.ts` (its pilot takes the Stairs at 171 to 206 s on 7a Floors, against its 180 s window: a longer walk, not a stuck pilot), and the soak's "a chase given up" and full immortal Run (which met no elite on 7a Floors).
- `plan.test.ts`'s Boss helper restores `pieces` with `rect`; `warbands.test.ts`'s hand-built plan gained `sideA` and `sideB`; `delverLoot.test.ts`'s corner case follows the code review's drop rule.
- `warbandSoak.slow.test.ts`'s "a chase across a level" searches straight Passages only.
- None was removed.

**Measured** (the test container, about 3× a mid-range laptop):
- **The generator** (500 pairs): every pair passed on its first attempt (0 failed attempts; 25 allowed). Plan 4.8 ms, build 350 ms (p95 434, max 568), judge 47.5 ms; total 402 ms (p95 493, max 635), against Stage 6's 272 ms. Navmesh 126 ms mean (Stage 6: 95.5) with 130 jump Links, all shortcuts onto the 130 Decks.
  - 748 great halls (252 Floors with 1, 248 with 2): 283 Treasure, 181 Fight, 166 Boss (every Boss Floor), 118 Empty in line.
  - 11,376 Passages: 8,083 straight, 1,721 L, 816 S and 756 Z (590 turning loops); 1,101 sloped turning Passages; 1,548 far.
  - **The walk**: mean Stairs depth 320 m against Stage 6's 259 m (1.24×, under 1.3), so `rooms` stays 20.
- **The soak** (`warbandSoak.slow.test.ts`, 14 tests):
  - **A patrol round corners** (seed 1, Floor 1): one patrol walked its 8-Hall loop in 223.5 s through two L, one S and two Z Passages (one L sloped), each leg within its walking time (19.5 to 22.9 s against 20.0 to 23.5 s), every corner reached, no Soldier more than 2.1 m from its place.
  - **A chase round an L** (seed 21): the guard chased through the corner, and all its Soldiers stood in the last leg at 15.7 s. **Round an S** (seed 9, 90 m Leash): both corners reached, all Soldiers in the last leg at 23.7 s.
  - **Levelled Runs** on 7a Floors: 3 or 4 Hall levels a Floor, 306.6 s on Ramps; Tick mean 0.40 ms, p99 2.62 (Stage 6: 0.49); Floor build 479 ms (max 696) and navmesh 173 ms (max 219) cold, under load.
  - Over the soak's 218,453 Ticks: mean 0.40 ms, p99 2.04.
- **Stage 2's empty-Floor walk**: 134.6, 235.6 and 150.5 s to the Stairs on Floors 1 to 3 (Stage 6: 148 to 201 s).

**Tests**: `npm run typecheck` is clean. `npm test`: **2977 passed, 5 skipped** (2915 before the Stage). `npm run test:slow`: 24 files and **53 tests** passed (50 before).

**In the game** (`npm run dev`, a headless browser at 3 to 8 fps; `?dev=1&delver=1&autopilot=1&immortal=1&speed=4` with an Expert ally; screenshots in `docs/plans/delver-stage7a/`, all looked at; no console errors):
- `editor-seed7-floor1.png`: the Map Editor's top view of Floor 1 of seed 7, with two great halls, L Passages and S/Z jogs; "No checks fire".
- `passage.png`: a 3 m stone Passage leg leading to its next piece.
- `floor-map-turns.png`: the Floor Map with the revealed Halls, a great Treasure Hall and an L Passage round a corner.
- `boss-great-hall.png`: the Floor 3 Boss fight in the great Boss Hall (still the flat orange `glow`).
- The Run played through Floors 1 to 3 to the Boss fight with no error.

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Dungeon: Delver, add an AI ally, Fight. `&delverStart=3` starts on the first Boss Floor.
- Walk an L or S Passage with a Warband after you, and fight one round a corner.
- Fight in a great hall (a Treasure Hall or a big Fight post) and in the great Boss Hall.
- See whether a Floor still takes 5 to 10 minutes.

**To watch next**:
- **Long S and Z Passages outrun the Leash** (45 m): a guard gives up partway along them.
- **Floors are a little longer**: 1.24× Stage 6's walk; one empty-Floor walk took 236 s.
- **Great halls are plain**: one big empty rect. 7b's shapes and pillars and 7e's archetypes fill them.
- **The navmesh and build are slower** (126 ms and 402 ms here, about 0.4 s and 1.3 s laptop-equivalent). They are warmed a Floor ahead.

### Stage 7b: Hall shapes, pillars and cover
**Model**: Opus (geometry).
- **Shapes**: L, T, cross and ring Halls, each built from several rects into one Hall. A ring goes round a central Block.
  - The Reveal, the minimap and the Floor Map draw a Hall as its rects.
  - A Hall's centre, used by markers, fields and the judge, is a floor point of its largest rect.
- **Pillars and colonnades**: Blocks that break sight lines and Formations. The judge's `sight` rule looks through them (a Block stops sight). Every marker still has its clearance.
- **Done**: the 500 pairs, with the shapes counted; the soak, which must show a Warband promoted and fighting round pillars; screenshots of each shape.

#### Design
Written 2026-11-14 at the sub-stage's start. Battles, Duels and the Hall-graph Run are unchanged. **No new hashed state**: everything new is in the plan and the Map Source, rebuilt on every peer from (Run seed, Floor). `PROTOCOL_VERSION` stays 30; `DELVER_VERSION` goes to 7. **With every 7b knob off** (`plainHalls`, below) a Floor's compiled map is byte for byte 7a's: no Block is written, and growth, Passages, kinds and markers are untouched. With every Stage 7 knob off (`flatRooms`, which now turns 7b's off too) it is Stage 6's.

**The approach: a shape is cut out of the Hall's rect by Blocks, not built of several Enclosures.** A Hall stays one Enclosure over its rect, placed by 7a's growth exactly as now. After the kinds are known, a shaped Hall gets **solids**: Blocks from its floor to its ceiling that fill a corner notch (L, T, cross) or its middle (ring). **Pillars** are 2 × 2 m Blocks to the ceiling. The Hall's **rects** are its rect less its solids: its floor seen from above. So growth, the clearance checks, the Passages, the slots, the doors, depth, the main path and the in-line rule are all 7a's. Several Enclosures would put a lintel across the inside of the Hall at every seam, and would have needed a new growth. Nothing goes in a notch: it is solid rock inside the Hall's rect.

**1. The Map Compiler** (`src/mapEditor/compile.ts`): today a Block may not stand under any floor ("nothing may stand over a Block"). In a Delver Floor the abyss lies under everything and the Enclosure's roof lies over the Hall, so no Block can stand in a Hall. The new rule:
- **A Block in an Enclosure**: the first Enclosure in Brush order whose rect holds the Block's rect (edges included) and whose ceiling (`enclosureTop`) equals the Block's `top` (within EPS). The Block stands on that Enclosure's floor (`y`).
  - The floors under the Block at levels below its `top` are cut (the abyss and the Enclosure's floor).
  - The Enclosure's roof over it (at `top`) is kept.
  - Any other floor at a level above the Enclosure's floor and below `top` is refused as now ("stands under").
  - The Walls check (`BLOCK_BOTTOM`) uses the Enclosure's floor as `lowest`.
- **Every other Block** compiles exactly as before. Every shipped map and Map Source compiles to the same bytes: such a Block threw before, so none exists.
- `enclosure.test.ts` gains:
  - a pillar inside an Enclosure compiles. Its BLOCK, the Hall's floor cut under it, the roof kept over it, no extra face Wall, and `walkCheck` passes.
  - a Block whose top is under the ceiling is still refused, and so is one sticking out of the Enclosure's rect.
  - a Deck over a pillar inside an Enclosure is still refused.

**2. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`, `delver.floor`), the shipped values:
```json
"shapes": { "percent": 50, "weights": { "L": 3, "T": 2, "cross": 2, "ring": 2 } },
"pillars": { "percent": 40, "weights": { "colonnade": 1, "grid": 1 } }
```
- `shapes.percent`: the chance (in 100) that a Hall that may take a shape is picked for one. `weights`: whole, at least 0, summing to at least 1, keys exactly L, T, cross, ring.
- `pillars.percent` and `pillars.weights` work the same way, with keys colonnade and grid.
- **Parse checks**: both are percents, and the weights are as said (the exact key set, so a typo fails).
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts` gain the keys and their checks.
- **`plainHalls(tuning)`** (tests only, `flat.testdata.ts`): `shapes.percent` 0 and `pillars.percent` 0, the weights unchanged. **`flatRooms`** also sets both percents to 0. **`rooms7b(tuning)`** (Tasks 2 to 4 only, removed in Task 5): the shipped values above.

**3. Words.** A Hall's **shape** is `rect`, `L`, `T`, `cross` or `ring`. Its **solids** are the Blocks that cut the shape. A **notch** is a solid in a corner of the rect, and a ring's **core** is the solid in its middle. Its **rects** are its floor seen from above: the rect less its solids. Its **pillars** are 2 × 2 m Blocks standing on its floor, in a **colonnade** (two rows along its long axis) or a **grid**. Solids and pillars stand from the Hall's floor to its ceiling (`top`).

**4. The plan** (`plan.ts`; all `readonly`):
```ts
export type HallShape = 'rect' | 'L' | 'T' | 'cross' | 'ring';
export type PillarLayout = 'colonnade' | 'grid';
DelverHall += shape: HallShape;
              rects: readonly Rect[]   /* its floor seen from above: rect less solids, in band order (below); [rect] for a rect */
              solids: readonly Rect[]  /* notches (corner order NE, SE, SW, NW) or the ring's core; [] for a rect */
              pillars: readonly Rect[] /* ascending z, then x; [] for none */
              layout?: PillarLayout    /* absent: no pillars */
```
- `rect` is unchanged: the Enclosure's rect, the bounding rect of `rects`.
- **`cx`, `cz`** is the Hall's **centre**, a floor point that every marker, patrol point, Objective and field uses. For rect, L, T and cross it is the rect's centre, as before: the notches never reach it. For a ring it is the centre of its south band (its first largest rect): (cx, z0 + band_z / 2).
  - A Passage's `length` (and so depth, the main path and the kinds) stays the distance between the rects' centres, computed before the shapes as now.
- New constants:
  - `NOTCH_MIN = 4`: a notch's least extent on each axis (m).
  - `CENTRE_KEEP = 4`: the least distance from the centre to a notch's inner edge on each axis (m).
  - `RING_BAND = 6`: a ring's least band (m).
  - `WALL_GAP = 3`: the least gap from a pillar to a wall or a solid (m).
  - `MARKER_KEEP = 5`: the half side of the square round the centre that no pillar enters (m).
  - `DOOR_LANE = 6` and `DOOR_SIDE = 1`: a doorway's lane goes DOOR_LANE m inward and is DOOR_SIDE m wider than the doorway on each side.
  - `PILLAR_HALF = 1`, `COLONNADE_ROW = 6`, `COLONNADE_STEP = 6`, `GRID_STEP = 8`, `PILLARS_MIN = 2`.
- New `SALT` keys: shape 50, shapeKind 51, shapeTurn 52, notchX 53, notchZ 54, ringX 55, ringZ 56, pillars 57, pillarLayout 58, colonnadeRow 59.
- **`ev(v)`**: the even metre nearest v, the lower on a tie: `2 * Math.ceil((v - 1) / 2)`. Every solid and pillar edge is on an odd metre (off the fields' 2 m dots), as Hall Walls are. A notch's inner edge is the rect's odd edge less an even extent. A pillar is centred on an even metre.

**The algorithm**: a new step **7c**, after the Fight / Empty kinds and before the patrol loops (8), so the patrol points and the markers (9) read the final centres. For each Hall h in index order, with hw, hd its rect's half sizes:
- **May it take a shape?** Only if it has no gallery (`galleryOf[h]` absent). If `pick(h, shape, 100) < shapes.percent`, the shape is picked by weight with `pick(h, shapeKind, sum)`, in the order L, T, cross, ring. A shape that does not fit (below) leaves the Hall a rect. No other shape is tried.
- **Notches** (L, T, cross):
  - `capX` = the largest even ≤ hw − CENTRE_KEEP, and `capZ` the same with hd. The shape fits only if both are ≥ NOTCH_MIN.
  - The extents are `nx = NOTCH_MIN + 2 × pick(h, notchX, (capX − NOTCH_MIN) / 2 + 1)`, and nz the same with notchZ and capZ.
  - Corner k, in the order NE, SE, SW, NW:
    - NE: {x1 − nx, z1 − nz, x1, z1}
    - SE: {x1 − nx, z0, x1, z0 + nz}
    - SW: {x0, z0, x0 + nx, z0 + nz}
    - NW: {x0, z1 − nz, x0 + nx, z1}
  - **The door check**: a notch fails it if, on a side its rect lies along, it covers part of [line − w/2 − DOOR_SIDE, line + w/2 + DOOR_SIDE] of any slot on that side that holds a Passage. Touching the span is allowed. On a one-cell Hall this never fails, since CENTRE_KEEP keeps a side-centre doorway clear. It bites only on a great hall's long-side slots.
  - **L**: corner k0 = `pick(h, shapeTurn, 4)`, then k0 + 1 to k0 + 3 (mod 4). The first corner that passes the door check is the notch.
  - **T**: side s0 = `pick(h, shapeTurn, 4)` (n, e, s, w), then the next sides in turn. Side n's corners are NE and NW, e's NE and SE, s's SE and SW, and w's SW and NW. The first side both of whose corners pass is used, so its two corners are notched and the T's stem reaches that side.
  - **cross**: all four corners must pass.
  - The solids are listed in corner order.
- **Ring**:
  - It fits only if hw ≥ RING_BAND + 2 and hd ≥ RING_BAND + 2.
  - `band_x = RING_BAND + 2 × pick(h, ringX, floor((hw − 2 − RING_BAND) / 2) + 1)`, and band_z the same with ringZ and hd.
  - The core is {cx − (hw − band_x), cz − (hd − band_z), cx + (hw − band_x), cz + (hd − band_z)}, so its halves are ≥ 2.
  - The centre moves to (cx, z0 + band_z / 2).
  - Every doorway opens onto a band, since a band is ≥ 6 m deep.
- **Rects** (`floorRects(rect, solids)`, exported and pure):
  - Cut the rect into z-bands at every solid's z-edges, ascending. In each band, take the x-runs not covered by a solid, ascending.
  - Merge a band into the one before it when their runs are the same.
  - So a rect gives [rect]; an L, T or cross gives its bands, south first; a ring gives south, west, east, north.
- **Pillars**:
  - Only a Hall of shape rect, L, T or cross with no gallery may have them. If `pick(h, pillars, 100) < pillars.percent`, the layout is picked by weight with `pick(h, pillarLayout, sum)`, in the order colonnade, grid.
  - **Candidate centres** (even metres):
    - **Colonnade**, along the long axis u (x when hw ≥ hd, else z), with v across it.
      - The rows are at `vS − o` and `vN + o`, where vS is the largest even ≤ cv − COLONNADE_ROW and vN the smallest even ≥ cv + COLONNADE_ROW.
      - o = 2 × `pick(h, colonnadeRow, K)`, and K is the number of o in 0, 2, 4, … for which both rows keep WALL_GAP + PILLAR_HALF from the walls across. With K 0 the Hall has no pillars.
      - Along u, the centres are ev(cu) + COLONNADE_STEP × n for every whole n that keeps WALL_GAP + PILLAR_HALF from the walls along u.
    - **Grid**: (ev(cx) + GRID_STEP × a, ev(cz) + GRID_STEP × b) for every whole a and b within the same wall gap.
  - **Each candidate** P = its centre ± PILLAR_HALF is kept only if it:
    - keeps WALL_GAP from each solid (`apartBy(P, solid, WALL_GAP)`);
    - does not overlap the centre's keep (cx ± MARKER_KEEP, cz ± MARKER_KEEP), touching allowed;
    - does not overlap any held slot's **lane**: the span above along its side, going DOOR_LANE m inward from that wall.
  - The pillars are the kept candidates, sorted by z then x. With fewer than PILLARS_MIN, the Hall has none, and `layout` is absent.
- With both percents 0 nothing of this is picked. Every Hall is then a rect, with `rects` [rect] and no solids or pillars.

**5. The source** (`floorSource`): after the slopes, each Hall in order writes its solids and then its pillars as Blocks, with `top` = `hall.top`:
- `hall<k>-solid<n>`, with the Hall's material;
- `hall<k>-pillar<n>`, `stone`.

The Brush list is then [abyss, halls, passages, galleries, slopes, blocks]. With none of them, the source is 7a's byte for byte. Nothing else changes: the Hall's Enclosure is its rect, and its doors are as before.

**6. The judge** (`judge.ts`):
- **New `shapes`** (plan-only, after `layout`; one line per failure):
  - Each Hall's rects and solids lie inside its rect and share no interior. Their areas sum to the rect's: `shapes: hall3's rects and solids do not tile its rect`.
  - Its centre lies in one of its rects (edges included) and inside no solid or pillar: `shapes: hall3's centre (x, z) is not on its floor`.
  - Every solid and pillar edge is on an odd metre: `shapes: hall3-pillar2 has a Wall on the field's dots`.
  - Every pillar lies inside a rect of its Hall and shares no interior with a solid: `shapes: hall3-pillar2 is not on hall3's floor`.
  - Every marker (spawns, the Stairs zone's centre, fires, pedestals, posts, patrol points, the Boss) keeps at least 1 m from each solid and pillar of its Hall: `shapes: post2 is within 1 m of hall3-pillar0`.
  - Each Passage's doorway into a Hall stays clear. That is the edge of its first piece on `a` (or of its last on `b`) carried 3 m into the Hall, the doorway's width, and it shares no interior with that Hall's solids or pillars: `shapes: pass4's doorway into hall3 is blocked by hall3-solid0`.
- **`sight`** is unchanged in code, but a Block already stops it (`inSight` reads the compiled map's blocks), so a pillar may now hide a post from the Entrance.
- **`describeFloor`** adds `, S shaped Halls (l L, t T, c cross, r ring), p pillars in H Halls (c colonnades, g grids)`.

**7. What reads a Hall's rect** (each moves to its rects or minds its pillars; behaviour on a rect Hall unchanged):
- `revealPlace` (`reveal.ts`): a Hall holds the point when one of its rects holds it, with the same edges.
- `dropSpots` (`delverLoot.ts`):
  - `rectOf` takes each Hall's rects, in Hall then rect order, in place of its rect.
  - A candidate spot within DROP_MARGIN of a pillar of the Hall the fall is in is skipped.
  - If no candidate is left, the one spot is the fall point clamped into R.
- `Minimap.drawDelver` and `delverMapLayout`: a revealed Hall is drawn as each of its rects, each a `DelverMapRect` with `hall: true` and its kind. Pillars are drawn on neither.
- `bossHold` (`delverRun.ts`) and `delverMapMarks`' Treasure test keep the rect: nobody stands in a solid.

**8. Existing tests this sub-stage rewrites** (only these, and only as said):
- `golden.test.ts`:
  - the default pins are rewritten (`DELVER_VERSION` 7);
  - a new `plainHalls` case gives **7a's default map pins exactly**;
  - the `flatRooms` case keeps its map pins (Stage 6's), as do the flat and old-Floor-9 cases. Every plan pin is new: the plan gained fields.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the new keys.
- **Any other existing Delver test that fails only because its Floor's Halls changed** (a marker, a Warband's walk, a drop spot) runs on `plainHalls(tuning)`, composed with whatever it already used, with its expectations unchanged. Task 5 lists each one. A test that still fails on `plainHalls` is a bug to report.
- No test is removed.

**9. Tests to add**:
- `plan.test.ts` (200 seeds × Floors 1 to 9 on `rooms7b`):
  - The rects tile the rect less its solids, by `floorRects`. Solid and pillar edges are on odd metres.
  - Notches are at corners, between NOTCH_MIN and their cap. Pillars keep WALL_GAP from walls and solids, stay out of the keep and the lanes, and are 2 × 2.
  - The centre is on the floor (the rect's centre unless a ring). No gallery Hall is shaped or pillared.
  - A great hall's shape passes the door check.
  - Across the 200: every shape on a one-cell Hall and on a great hall, both layouts, a Boss Hall with a shape or pillars, and a ring holding a marker in its south band.
  - On `plainHalls`: every Hall a rect, and the plan equals 7a's, but for the new fields.
  - `floorRects` cases by hand for each shape.
- `source.test.ts` / `judge.test.ts`:
  - a shaped Hall's Blocks (ids, tops, materials) and their order. The Floor compiles and passes `walkCheck`.
  - 7b Floors pass the judge first try. The editor's `checkMap` at 2 m finds no Wall on a node.
  - `shapes` fires on:
    - a pillar moved onto a marker;
    - a solid moved over a doorway;
    - a rect dropped from a Hall's rects;
    - a pillar moved half a metre.
  - `sight` passes on a post hidden from a spawn by a pillar, and fires on the same with the pillar removed. Hand-built, or found by search.
  - The navmesh's shortcut-link case holds on a 7b Floor.
- **The consumers**:
  - `revealPlace` in each band of an L and a ring, and nowhere in a solid's middle;
  - `dropSpots` for a fall beside a pillar, no spot within the margin of it;
  - `delverMapLayout` and the minimap drawing every rect.
- `delverGen.slow.test.ts` (500 pairs):
  - per Floor, the shapes, the pillars and layouts, and the Blocks a Floor (mean, max);
  - the budgets of Stage 6 (build mean ≤ 600 ms, none over 2 s, navmesh mean ≤ 300 ms);
  - **failed attempts at most 1 in 20 pairs**.
  - **It must show it exercised** every shape, both layouts, a shaped great hall, a shaped or pillared Boss Hall, and a ring Entrance or Stairs Hall (its markers in the band).

**10. The soak** (`src/controllers/warbandSoak.slow.test.ts`; immortal party):
- The levelled Runs case reruns on the 7b Floors: the Tick against 7a's 0.40 ms mean and 2.04 ms p99, and the Floor build and navmesh. **If the Tick mean passes 0.60 ms or the p99 4 ms**, the Blocks' cost is too high: lower `pillars.percent` (Task 6 records it).
- **New case, a fight round pillars**: on the first Floor in seed order whose Fight Hall has pillars and a guard post, the immortal party walks to the post.
  - At least one of that Warband's Soldiers is promoted while inside that Hall.
  - A promoted Fighter of it lands a hit or takes one inside the Hall.
  - A promoted Fighter stands within 2 m of a pillar's face at some Tick.
  - No Fighter's or Soldier's position is ever inside a pillar or a solid (shrunk by 0.2 m).
  - Must show, else fail: the Promotion, the hit and the pillar pass.
- **A patrol through a shaped Hall**: the patrols harness, on a patrol whose loop holds an L, T, cross or ring Hall. It walks its whole loop, and no Soldier is ever inside a solid.
- **Stage 2's empty-Floor walk** (`delverRun.slow.test.ts`) on the 7b Floors, against 7a's 134.6 to 235.6 s.

**Tasks** (1 and 2 may run side by side, and so may 3 and 4: their files are disjoint):
1. **The compiler**: `compile.ts`'s Block-in-an-Enclosure rule and `enclosure.test.ts` (§1).
2. **The plan and its Tuning**: `data/delver.json` (the new keys with the knobs off, both percents 0), `src/tuning/delver.ts` with `delver.test.ts` and `tuning.test.ts`, `plan.ts`, `flat.testdata.ts` (`plainHalls`, `flatRooms`, `rooms7b`) and `plan.test.ts`.
3. **The source and the judge**: `source.ts`, `judge.ts`, `generate.ts` (`describeFloor`) and their tests (on `rooms7b`).
4. **The consumers**: `reveal.ts`, `delverLoot.ts`, `src/render/minimap.ts`, `src/play/floorMap.ts` and their tests.
5. **The switch**: the shipped values in `data/delver.json`, `DELVER_VERSION` 7, the golden pins, §8's moves onto `plainHalls`, `rooms7b` removed, and `delverGen.slow.test.ts`.
6. **The soak**: §10's cases and measurements.

### Result
Done 2026-11-14. Delver Halls now come in five shapes: rect, L, T, cross and ring. The shape is cut out of the Hall's rect by solid Blocks from its floor to its ceiling: corner notches, or a ring's core. Some Halls also stand 2 × 2 m pillars, in a colonnade (two rows along the long axis) or a grid. Battles, Duels and the Hall-graph Run are unchanged. With every 7b knob off (`plainHalls`) a Floor's map is byte for byte 7a's, and with every Stage 7 knob off (`flatRooms`) Stage 6's. No hashed state is new; `DELVER_VERSION` is 7, and `PROTOCOL_VERSION` stays 30.

**What was built** (as the Design gives it, with the changes below):
- **The Map Compiler**: a Block wholly inside an Enclosure whose ceiling is its top stands on that Enclosure's floor. The abyss and the floor under it are cut, and the roof over it is kept. Every other Block compiles as before.
- **Tuning Data** (`delver.floor`): `shapes` { `percent` 50, `weights` L 3, T 2, cross 2, ring 2 } and `pillars` { `percent` 40, `weights` colonnade 1, grid 1 }, with their parse checks. `plainHalls(tuning)` (tests) turns both off, and `flatRooms` does too.
- **The plan** (`plan.ts`):
  - step 7c after the kinds: `shape`, `rects` (by `floorRects`), `solids`, `pillars` and `layout` on each Hall;
  - the door check on great halls' long-side slots;
  - a ring's centre moved into its south band;
  - no shape and no pillars on a gallery Hall.
- **The source**: each Hall's solids (`hall<k>-solid<n>`, the Hall's material), then its pillars (`hall<k>-pillar<n>`, stone), as Blocks after the slopes.
- **The judge**: the plan-only `shapes` rule (tiling, the centre on the floor, odd-metre Walls, pillars on the floor, markers 1 m clear, doorways 3 m clear). `sight` sees pillars through the compiled map's blocks. `describeFloor` counts the shapes and pillars.
- **The readers**:
  - The Reveal, drop spots, the minimap and the Floor Map go by a Hall's rects.
  - Drop spots keep `DROP_MARGIN` off a pillar.
  - The Floor Map draws one outline round a shaped Hall.

**Changed from the Design:**
- **The front rank moves off Blocks.** The Battle map's own check refuses a map whose Team 0 front rank (z = −`front`) runs through a Block. That refusal failed 29 % of first attempts in Task 3. `floorSource` now takes the first of 52, 51, 53, 50, … that crosses no Block. A Floor never deploys from its front rank, and with no Block across z = −52 it is 52 as before.
- **A Block in an Enclosure over any other floor is refused** (code review). Only deadly ground (a Delver Hall's abyss) may lie under the Enclosure's floor beneath a Block. Before, a pillar in a raised Enclosure would have cut a hole in an unrelated floor under it.
- **The Floor Map draws a Hall's rects twice** (code review): stroked, then filled with no stroke, at twice the old stroke width. So a shaped Hall shows one outline, on its outside, and a rect Hall looks as before.
- **The fight round pillars takes the first candidate that shows the fight**: on the first one (seed 2, Floor 1, hall9, a T with 2 pillars) the promoted Fighters never came within 2 m of a pillar.
- **A cross on a great hall is rare** (8 in the 500 pairs): it needs all four corners clear of the long-side doorways. The 200-seed plan test finds one by searching on past seed 200.
- **The `sight` case is hand-built.** On dealt Floors the posts are far from the Entrance and already hidden by Walls.
- **No screenshots** this sub-stage (the user's call).

**Existing tests changed (as Design §8 allows):**
- `golden.test.ts`:
  - the default pins are rewritten;
  - a new `PLAIN_PINS` table (`plainHalls`) whose map and plan hashes are 7a's default pins exactly;
  - `ROOMS_PINS`, `FLAT_PINS` and `OLD_FLOOR_9` keep their map pins. Their plan pins moved once in Task 2, when the plan gained its fields.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the new keys and the bundled values.
- Moved onto `plainHalls`, with their expectations unchanged:
  - `floorMap.test.ts`'s "draws a revealed Passage as one rect per piece";
  - `judge.test.ts`'s 7a block (its `layout` case);
  - `plan.test.ts`'s 7a block (Hall Walls and halves, Passage pieces, doors, and the `flatRooms` key test).
- The helpers of `plan.test.ts`'s Boss case and `judge.test.ts`'s outside-the-field case now move a Hall's `rects` (and `cx`) with its `rect`.
- `source.test.ts`'s plain-source case no longer compares against the bundled source. That is now 7b's, and `PLAIN_PINS` holds the 7a bytes instead.
- None was removed.

**Measured** (the test container, about 3× a mid-range laptop):
- **The generator** (500 pairs):
  - every pair passed on its first attempt (0 failed attempts; 25 allowed);
  - plan 2.5 ms, build 501 ms (p95 669, max 989), judge 42.6 ms; total 546 ms (p95 720, max 1061), against 7a's 402 ms and the 600 ms budget;
  - navmesh 162 ms mean (7a: 126), with 130 jump Links;
  - **the total is load-sensitive**: run beside `npm test` it measured 942 ms mean and failed its budget.
  - Shapes: L 813, T 552, cross 454 and ring 547 (great halls: 119 L, 64 T, 8 cross, 85 ring), in 498 of 500 Floors.
  - Pillars: 3,253 in 527 Halls (288 colonnades, 239 grids), in 335 Floors.
  - Of the 166 Boss Halls, 58 are shaped and 53 pillared. 59 rings are an Entrance, Stairs or Boss Hall.
  - **Blocks a Floor**: 15.1 mean, 36 at most.
  - Stairs depth 1.24 × Stage 6's, as 7a's.
- **The soak** (`warbandSoak.slow.test.ts`):
  - **A fight round pillars** (seed 2, Floor 1, hall12, a 22 m rect with a 5-pillar colonnade, a guard of 3):
    - all 3 Soldiers promoted inside the Hall, the first at 0.7 s;
    - 56 hits landed on the immortal Player there;
    - a promoted Fighter 1.89 m from a pillar's face on 39 Fighter-Ticks.
  - **A patrol through a shaped Hall** (seed 1, Floor 1): an 8-Hall loop walked in 223.5 s, with its anchor 10 s in a cross Hall.
  - **Nobody inside a Block**: checked on every Fighter and unpromoted Soldier over 360,145 Ticks (the long Runs, the levelled Runs and both new cases): 0 inside.
  - **The Tick**:
    - levelled Runs: mean 0.39 ms, p99 2.77 (7a: 0.40, 2.62);
    - the 5-Run soak: mean 0.37 ms, p99 1.81 (7a: 0.40, 2.04);
    - Floor build 553 ms (max 761) and navmesh 176 ms (max 210), cold, under load.
    - The Blocks cost nothing measurable, far under the Design's 0.60 ms / 4 ms trigger, so `pillars.percent` stays 40.
  - Exercised: 221 Promotions, 77 Chases, 6 Returns, 70 Warbands wiped, 26 patrol loops.
- **Stage 2's empty-Floor walk**: 136.8, 236.0 and 151.8 s to the Stairs on Floors 1 to 3 (7a: 134.6, 235.6, 150.5).

**Tests**: `npm run typecheck` is clean. `npm test`: **3051 passed, 5 skipped** (2977 before the Stage). `npm run test:slow`: 24 files and **55 tests** (53 before). 54 pass in the full parallel run. `delverGen.slow.test.ts` misses its 600 ms build budget there under the other files' load, and passes alone (543 ms mean). Its budget has little headroom left on 7b Floors (see To watch next).

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Dungeon: Delver, add an AI ally, Fight. `&delverStart=3` starts on the first Boss Floor. `#/mapeditor?dev=1&delverSeed=S&delverFloor=F` shows a Floor's Halls from above.
- Fight a Warband in a pillared Hall (a colonnade or a grid): use the pillars to break its Formation, and see whether it pours round them.
- Walk an L, T, cross and ring Hall. Does a ring's loop round its core make a good chase?
- Open the Floor Map (`M`) on a shaped Hall.
- See whether a Boss fight in a shaped or pillared great hall plays better.

**To watch next**:
- **The generator's 600 ms budget is nearly spent**: 543 ms mean alone, over it when the slow suite runs in parallel. Before 7c adds more, either the build gets faster (the Blocks' `fillBlocked` and `clearanceOf` passes) or the budget is raised, which is the user's call.
- **Floor build is slower**: 501 ms mean against 7a's 402 (about 1.7 s laptop-equivalent at most), still warmed a Floor ahead. 7c to 7e add more.
- **Rings move the centre**: a ring Hall's markers stand in its south band, not its middle.
- **Notch Blocks are plain**: solid rock in the Hall's material. 7e's archetypes may dress them.
- **No cover lower than the ceiling**: every Block is full height. A low Block would need a walkable top (a Platform), left for later.

### Stage 7c: verticality inside a Hall
**Model**: Opus (geometry and levels). The user's calls are in "Answered questions (2026-11-14, before Stage 7c)".
- **Split-level floors**: two or three tiers, each a whole level (2 m) from its neighbour, joined by Ramps, with doorways opening on different tiers. A tier's edge is open (no rail): a 2 m drop down and a Jump shortcut up, as a gallery's Deck front.
- **Sunken pits**: the doorways at the rim, the pit's floor 2 or 4 m below, Ramps down from the rim, the rim's edge open.
  - **Depth**: a mix. Most pits are 2 m (a Jump out anywhere, Soldiers drop in when they chase). Some are 4 m, more often on deeper tiers. A fall into one does about 53 damage, twice that when knocked down, so a knock-in is a real hit. Ramps are the only way out, and Soldiers (`levels.drop` 3) never drop in.
  - A 4 m rim is never a Jump shortcut: the AI must not be given a jump Link up it (`JUMP_SHORTCUT_CAP` 2.5).
- **Daises**: a throne or an altar **1 m** high, reached by a step Ramp, to hold or to be knocked off. A knock-off does no fall damage (under `safeHeight` 1.6) but costs the high ground. Anyone may Jump onto it from any side.
  - **Who stands on one**: a Boss Hall with a dais puts the Boss Soldier's post on it (the throne). A Treasure Hall with a dais stands its pedestals on it (the altar). No other marker moves onto a dais.
  - 1 m is under `levels.height` (1.8), so Soldiers on a dais and beside it count as one level. The Design must check that this holds for `fieldAt`, `levels.promote`, the walk rule and Soldiers stepping off.
- **More stairwells and galleries**: doors at Deck height far more often (now 1 gallery in 9). A gallery may **wrap round a corner**: one L- or U-shaped Deck along two or three walls, turning at the corners, with one Ramp, so more walls carry a high door.
- **Where**: rect Halls only. A Hall gets at most one vertical feature (a gallery, a split level, a pit or a dais), and a Hall with one gets no 7b shape and no pillars. **7c picks first**: about **1 Hall in 4** gets a split level, a pit or a dais, picked before 7b's shapes and pillars, which then skip those Halls (as they skip gallery Halls). Split levels and pits change door heights, so they are picked with the galleries, before the levels (Stage 6's steps 3b and 3c). Daises do not, so they may be picked after the kinds (the Boss and Treasure Halls). With every 7c knob off, no 7c pick is made and a Floor is byte for byte 7b's.
- The navmesh, shortcut jump Links, `floorNear`, `levels.promote` and `fieldAt` hold on every tier. No two floors overlap seen from above, except a Deck inside its own Hall (as Stage 6 allows). A tier, a rim and a dais are solid underneath (the Map Source's Platform), not Decks.
- **The build budget is raised** (the user's call): `delverGen.slow.test.ts`'s mean goes from 600 ms to **800 ms**, and the 2 s cap stays. No speed work in 7c.
- **No screenshots** this sub-stage (the user's call).
- **Done**: the 500 pairs, with tiers, pits (by depth), daises (thrones and altars) and galleries (wrapped, stairwells) counted; the soak, which must show a chase between tiers, a fight on a dais, and a Boss on its throne; Stage 2's walk.

**Tasks** (proposed 2026-11-14 before the sub-stage; the orchestrator's `#### Design` fixes every contract and may move a boundary, writing why). Seven tasks this time, smaller than 7b's, one after another, except that 1 may run beside 2:
1. **The compiler and the navmesh**: a Platform wholly inside an Enclosure stands on that Enclosure's floor, as 7b's Block does (the abyss and the floor under it cut, the roof kept). Hand-built maps in `enclosure.test.ts` and `nav.test.ts`: a two-tier Enclosure, a 2 m and a 4 m pit with a rim, a 1 m dais with its step Ramp; `walkCheck` passes; doorways at a tier's or a rim's height open (cut by the Passage, as a stairwell's high door); shortcut jump Links up a 2 m tier edge and onto a 1 m dais, and none up a 4 m rim. Files: `src/mapEditor/compile.ts`, `checks.ts` if needed, `src/sim/nav.ts` only if a 4 m rim needs it, their tests.
2. **Galleries that wrap and more stairwells**: the plan's gallery becomes a list of wall runs (one Deck turning at the corners, one Ramp), with its Tuning (the wrap share and a stairwell knob), off by default in this task. Files: `data/delver.json`, `src/tuning/delver.ts` and its tests, `plan.ts`, `flat.testdata.ts` (the 7c knobs-off helper and a `rooms7c` all-on helper), `plan.test.ts`.
3. **Split levels and pits in the plan**: `DelverHall.feature` (split: its tiers' rects and levels and Ramps; pit: its depth, rim and Ramps), picked in step 3b, their door levels in step 3c and the loops, the Tuning (percent, weights, the deep-pit share by tier), off by default. Files: as Task 2 (after it).
4. **Daises in the plan**: picked after the kinds; the Boss post and the Treasure pedestals moved onto them; then 7b's shapes and pillars skip every Hall with a 7c feature. Files: as Task 2 (after Task 3).
5. **The source and the judge**: each feature's Platforms and Ramps (ids and materials), the levels list, `shortcuts`; the judge's new rule(s) (every tier, rim and dais reached by walking; a pit's floor reached and left by its Ramps; markers on their tier; doorways on their tier; no jump Link up a 4 m rim); `describeFloor`'s counts. Files: `source.ts`, `judge.ts`, `generate.ts`, their tests (on `rooms7c`).
6. **The consumers and the switch**: drop spots on tiers and in pits (`groundNear`), Warband homes and the Boss's throne post facing, the Reveal and maps checked over tiers; then the shipped values, `DELVER_VERSION` 8, the golden pins (a new knobs-off table equal to 7b's pins exactly), tests that break only because of 7c moved onto the knobs-off helper, `rooms7c` removed, the generator slow test's counts, its must-exercise list and the 800 ms budget. Files: `delverLoot.ts`, `src/sim/delver/warbands.ts`, `reveal.ts`, `src/render/` and `src/play/floorMap.ts` only if they need it, `version.ts`, `golden.test.ts`, `delverGen.slow.test.ts`, and the moved tests.
7. **The soak**: `warbandSoak.slow.test.ts`'s new cases (a chase between tiers, a fight on a dais, a Boss on its throne, nobody inside a Platform), the Tick, the build and navmesh, and Stage 2's walk.

#### Design
Written 2026-11-14 at the sub-stage's start, with the user's answers of that day. Battles, Duels and the Hall-graph Run are unchanged. **No new hashed state**: everything new is in the plan and the Map Source, rebuilt on every peer from (Run seed, Floor). `PROTOCOL_VERSION` stays 30; `DELVER_VERSION` goes to 8. **With every 7c knob off** (`flatHalls`, below) no 7c pick is made and a Floor's plan, source and compiled map are byte for byte 7b's: every new plan field is optional and absent, every new pick sits behind a knob, and no Brush is written. `plainHalls` and `flatRooms` turn the 7c knobs off too, so their pins stay 7a's and Stage 6's.

**What was checked in the code before writing this** (a scratch probe, not committed, on hand-built maps of the shapes below):
- A Platform inside an Enclosure already compiles as 7c needs: it cuts every floor under its top (the abyss and the Enclosure's floor), the Enclosure's roof over it stays, its faces get face Walls owned by it (from under the lower floor to its top), and `walkCheck` passes on a two-tier Hall, a 2 m and a 4 m pit with Ramps, and a 1 m dais with a step Ramp. So the compiler needs no new rule (Task 1 proves it with tests and changes `compile.ts` only if a test shows a gap).
- **A 4 m rim gets jump Links today**: on a `shortcuts` map the navmesh found shortcut jump Links from a 4 m pit's floor onto its rim (rise 4.0; `maxUp` is the full Jump's apex plus a step, about 4.6 m). So the navmesh needs a rule (§5).
- **Every Ramp inside an Enclosure is walled to the ceiling on its open long sides.** A Ramp's long side takes the Enclosure's own roof as the "higher floor beside it" (`compile.ts`'s Ramp side faces have no own-roof exception, unlike `faceFrom`), so a Wall stands from under its foot to the roof along it. Stage 6's gallery Ramps have had this all along. It is kept: changing it would move every gallery Floor's bytes. So every step Ramp of 7c is a walled chute on its open sides, and a step's rails add nothing but a uniform look (no fractional skirt Walls: a 1 m skirt is cut in thirds of a metre).

**1. The words.** A Hall's **vertical feature** is one of: a gallery (Stage 6, now possibly wrapped), a **split** (its floor in two or three **tiers**, each a level from its neighbour, joined by step Ramps, the edges open), a **pit** (its middle sunk 2 or 4 m under a **rim** that holds every doorway, Ramps down) or a **dais** (a 1 m Platform against one wall, a **throne** in a Boss Hall, an **altar** in a Treasure Hall). A Hall has one at most. A **step** is a feature's Ramp. A Hall's **main floor** is where its centre stands: a split's **main tier**, a pit's floor, any other Hall's floor. A door is **raised** when it opens above its Hall's Enclosure floor (a gallery wall's Deck door, a split's main-tier doors, every pit door): its Passage cuts it, as Stage 6's stairwell high door. A gallery **wraps** when its Deck turns a corner onto the next wall (an **L**) or two corners onto the next two walls (a **U**), with one Ramp.

**2. The height model** (constants in `plan.ts`, fixed by rules, not Tuning):
- **`level` and `y` of a Hall are its main floor's.** Every centre marker, patrol point, Objective and `judgeFields`' centre already stands at `hy(h)` = the Hall's `y`, so none of them changes. `top` is its highest floor + `HALL_STOREY` (a gallery Hall's `y + GALLERY_STOREY` as now). `hallBase(h)` (new, exported) is its Enclosure's floor: a split's lowest tier, else `y`.
  - **Split**: the main tier is at `level` (1 to `levels.max`), every outer tier at `level − 1`. The Enclosure stands at `y − 2`; the main tier is a Platform (top `y`); the outer tiers are the Enclosure's own floor. `top = y + 4`, so an outer tier has 6 m of headroom.
  - **Pit**: `level` is the pit floor's (0 or more), the rim at `y + depth`. The Enclosure stands at the pit floor; the rim is four Platforms (top `y + depth`). `top = y + depth + 4`. So no floor of a Floor is ever below 0, and the abyss at −8 lies at least 8 m under every floor, as before: a pit fits `levels.max` because its rim is a door level (`level + depth / 2 ≤ max`).
  - **Dais**: `level` and `y` are the Hall's floor; the dais's top is `y + DAIS_RISE` (1); `top = y + 4` (3 m over the dais, more than the tallest Fighter's 2.52).
- **Door levels.** `doorLevel(h, d) = level[h] + lift(h, d)`:
  - a gallery wall (each wall of a wrap too): +1, as Stage 6;
  - a split's outer tier's end wall: −1; its other walls: 0;
  - a pit: `depth / 2` (1 or 2) on every wall;
  - else 0.
- **Raised doors and flat Passages.** A Passage is forced flat (options [0] in step 3c, and equal door levels for a loop) when either end's door is raised, or (as now) is a great hall's long-side slot. A raised door is never listed in its Hall's `doors`: the Passage's own flat doorway opens the shared Wall at its height (ADR 0023's rule, as Stage 6's stairwell). So a pit Hall lists no doors, a split Hall lists only its outer tiers' end walls, a dais Hall lists its doors as now. A sloped straight Passage's high end can then only meet a Hall door that the Hall lists, as Stage 6 requires.
- **Range.** A Hall's level must keep each of its feature's floors and door levels in 0 to `levels.max`: a split `1 ≤ level ≤ max`; a pit `0 ≤ level` and `level + depth / 2 ≤ max`; a wrapped gallery `level + 1 ≤ max` (an unwrapped gallery keeps Stage 6's rule: none). Step 3c below keeps this.
- **The 1 m dais against the walk rule** (read in `levels.ts`, `destinations.ts`, `crowd.ts`, `squad.ts`, `warband.ts`, `bubble.ts`, `nav.ts`), the answer the Design fixes:
  - **Stepping up**: 1 m is more than `levels.stepUp` (0.35), so a Soldier never walks up it; only the step Ramp gets one on. **Stepping off**: walking off its edge is a drop (1 ≤ `levels.drop` 3), and its face Wall (from under the floor to the dais top) does not stop it, since `walled` skips a Wall whose top is at most a step over the feet.
  - **One node a cell**: the dais is a Platform, solid underneath, so every 2 m cell centre over it has one node, at the dais top, and every cell beside it the floor's. Never two in one cell. The joins are dais → floor (a drop, one way), floor → step → dais (walking), and nothing straight up the face. The dais is 10 × 6 m (5 × 3 node centres) and its step 6 × 2 m (3 × 1), all edges on odd metres, so every node lies clear of a Wall.
  - **`fieldAt`** on the floor's Walk Surface at a point whose cell centre is on the dais gives −1 (its `nodeIn` finds no node within a step), and the dais's surface gives the dais node. So no floor marker may stand where its cell centre is on the dais: the dais and its step keep `CENTRE_CLEAR` from the centre, and only the throne and altar markers stand on it, each in a cell whose centre is on the dais (the throne post on an even metre in both axes; a pedestal at an odd metre rounds to a centre 1 m from it, still on the dais).
  - **`floorNear`** finds the dais top over the dais and the floor beside it, and never the abyss.
  - **One level for the Crowd**: 1 m is under `levels.height` (1.8), so a Soldier on the dais and one beside it push each other (`crowd.ts`), are each other's targets (`squad.ts`), and a Warband arrives at its throne post from beside it (`warband.ts`'s `arrived`). It is under `levels.promote` (2.5), so Promotion and a Warband's sight reach across it. A promoted Fighter knocked off falls 1 m, under `fall.safeHeight` (1.6): no damage, only the high ground lost.
- **Tiers and rims of 2 m** are more than `levels.height`, so they are different levels for the Crowd, as a gallery's Deck. A 2 m drop is one Soldiers take (`levels.drop` 3) and a Jump shortcut up (§5). A 4 m rim is neither: Soldiers never drop into a 4 m pit, and its Ramps are the only way down and out.

**3. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`, `delver.floor`), the shipped values (Task 6; Tasks 2 to 5 ship the knobs off):
```json
"galleries": { "wrapPercent": 40, "uPercent": 30, "stairPercent": 60 },
"features": { "percent": 50, "weights": { "split": 1, "pit": 1 }, "threePercent": 40, "deepPercent": [25, 40, 55], "daisPercent": 60 }
```
- `galleries.wrapPercent`: the chance (in 100) that a gallery wraps when an L fits. `uPercent`: the chance a wrapped gallery is a U when one fits (else an L). `stairPercent`: the chance a gallery Hall with a fitting side that holds a tree Passage takes its side from those sides (a stairwell), when it has one.
- `features.percent`: the chance (in 100) that a one-cell Hall with no gallery is picked for a split or a pit. `weights`: whole, at least 0, summing to at least 1, keys exactly `split` and `pit`, picked in that order. `threePercent`: the chance a split has three tiers. `deepPercent`: per Run tier (`tierOf`, the last for any deeper tier), the chance a pit is 4 m deep (else 2 m). `daisPercent`: the chance a Boss or Treasure Hall with room and no other feature gets a dais.
- **Parse checks**: every percent whole 0 to 100; `weights` as said (the exact key set); `deepPercent` a non-empty list of percents; `features.percent > 0` needs `levels.max ≥ 1` (a split's main tier stands a level over its outer one, and a pit's rim a level over its floor).
- **The knobs-off helper `flatHalls(tuning)`** (tests only, `flat.testdata.ts`): `galleries.wrapPercent` 0 and `stairPercent` 0, `features.percent` 0 and `daisPercent` 0, the rest unchanged. It is 7b's Floor byte for byte. **`plainHalls`** and **`flatRooms`** apply it too (`plainHalls(t)` = 7b's knobs off on `flatHalls(t)`; `flatRooms` sets the four to 0 as well). **`rooms7c(tuning)`** (Tasks 2 to 5 only, removed in Task 6): the shipped values above. Each task adds its own keys to all three helpers.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts` gain the keys and their checks.
- **`planFloor(t, seed, floor, attempt, boss = false, tier = 1)`**: `tier` is the Run tier (`tierOf(delver, floor)`), read only by `deepPercent`. `delverFloor` passes it. Every other caller keeps the default.

**4. The plan** (`plan.ts`; all `readonly`; every new field optional and absent when off):
```ts
/** A feature's Ramp: on the lower floor, its high end against the higher floor's edge. */
export interface DelverStep { rect: Rect; lo: number; hi: number; up: Side; rails: readonly Side[] }
export interface DelverTier { rect: Rect; level: number; y: number }
export interface DelverSplit { kind: 'split'; axis: 'x' | 'z' /* the tiers follow one another along it */; tiers: readonly DelverTier[] /* 2 or 3, ascending along axis; the main one at the Hall's level */; steps: readonly DelverStep[] /* one per outer tier, in tier order */ }
export interface DelverPit { kind: 'pit'; depth: 2 | 4; pit: Rect /* its floor, at the Hall's y */; rim: number /* the rim's height */; rims: readonly Rect[] /* floorRects(rect, [pit]) */; steps: readonly DelverStep[] /* two */ }
export interface DelverDais { kind: 'dais'; side: Side /* its wall */; rect: Rect; y: number /* its top */; steps: readonly DelverStep[] /* one */ }
export type DelverFeature = DelverSplit | DelverPit | DelverDais;
DelverHall    += feature?: DelverFeature   /* written after `gallery`; absent: none */
DelverGallery += wrap?: { walls: readonly Side[] /* the next wall, then for a U the one after */; decks: readonly Rect[] /* the Deck along each, in that order */ }
```
- `DelverGallery.high` becomes "a Passage leaves through any of its walls at the Deck's height" (unwrapped, the same as now).
- New constants: `DAIS_RISE = 1`, `DAIS_HALF = 5` (half its length along the wall), `DAIS_DEPTH = 6`, `DAIS_STEP = 2` (the step's length; its width `DAIS_STEP_HALF = 3` each side), `SPLIT_CUT = 4` (the least distance from the centre to a tier edge), `TIER_MIN = 6` (an outer tier's least depth), `STEP_WIDTH = 4` (a tier's or pit's step), `PIT_RIM = 4`, `PIT_WIDE = 12` (the larger half a pit needs), `PIT_LONG = 8` (the smaller half). `hallBase(h)` is exported. `JUMP_SHORTCUT_CAP` stays 2.5 and must equal `nav.ts`'s `SHORTCUT_RISE` (a test).
- **New `SALT` keys** (after 59, the highest so far, so no existing pick moves): galleryStair 60, galleryWrap 61, galleryU 62, feature 63, featureKind 64, splitAxis 65, splitTiers 66, splitSide 67, splitStep 68, pitDeep 69, pitTurn 70, dais 71, daisSide 72.
- `byWeight` (7b's, now hoisted to the top of `planFloor`) picks every weighted kind.

**The algorithm**, 7b's steps with these changes, in this order:
- **3b. Galleries** (Stage 6's picks first, unchanged): for each Hall chosen for a gallery, in the order chosen:
  1. **Stairwells**: when `stairPercent > 0` and some fitting side holds a tree Passage (`high` sides), and `pick(h, galleryStair, 100) < stairPercent`, the side is `high[pick(h, gallerySide, high.length)]`, else `fitting[pick(h, gallerySide, fitting.length)]` as now. Then `end = pick(h, galleryEnd, 2)` as now.
  2. **Wrap**: when `wrapPercent > 0` and `pick(h, galleryWrap, 100) < wrapPercent`, and an L fits, the gallery wraps onto `w1`, the wall at the Deck's end: for a wall along x (n, s), end 0 is w and end 1 is e; for a wall along z (e, w), end 0 is s and end 1 is n. Then when `pick(h, galleryU, 100) < uPercent` and a U fits, it wraps on to `w2 = opposite(side)`.
  - **An L fits** when `w1`'s across half (the Hall's half size perpendicular to `w1`) is at least `GALLERY_DEPTH + CENTRE_CLEAR` (8), and `w1`'s Deck covers `w1`'s centre with `passage / 2 + 1` each side (always on 7a's Halls: half ≥ 6.5). **A U fits** when the L does and `w2`'s Deck covers `w2`'s centre likewise (its across half is `side`'s, already ≥ 8).
- **3b′. Splits and pits** (new, after the galleries): for each Hall h in index order that is not great and has no gallery, when `features.percent > 0` and `pick(h, feature, 100) < features.percent`: the kind is `byWeight(h, featureKind, [split, pit])`. A kind that does not fit leaves the Hall plain (no other is tried, as 7b). Each fit is tested on the Hall's rect as it stands; the geometry is cut in step 7 from the final rect (a Boss Hall's grown one), which only grows.
  - **Split** along axis k (`x`: tiers west to east; `z`: south to north). With c the centre's coordinate along k and half its half size along k, the **cuts** are `cutHi` = the smallest odd metre ≥ c + `SPLIT_CUT` and `cutLo` = the largest odd metre ≤ c − `SPLIT_CUT` (so 4 or 5 m from the centre, by c's parity, and the same both sides). An axis fits when `half − (cutHi − c) ≥ TIER_MIN` (an outer tier at least 6 m deep: the step's 4 and 2 m of approach). Fitting axes in the order x, z; with two, `k = [x, z][pick(h, splitAxis, 2)]`. **Tiers**: three when `pick(h, splitTiers, 100) < threePercent` (an outer tier at each end), else two, the outer one at the low end (`pick(h, splitSide, 2)` 0) or the high end (1). **Outer tiers are always one level below the main tier**: the main tier holds the centre and both side walls' doorways (the walls along k, whose side-centre doorways are 4 m from either cut), and an outer tier's step lies on the outer tier, so no step ever stands on the main tier, the centre's markers or a doorway's lane. (A raised outer tier would need its step on the main tier, beside a side door, which fits only in Halls of half 13 or more.)
  - **Pit**: v is the axis of the larger half (z on a tie), u the other. It fits when the half along v is at least `PIT_WIDE` (12: the rim's 4, the step's 4 and the centre's 4) and the half along u at least `PIT_LONG` (8: the rim's 4 and the centre's 4; it also holds a 4 m pit's 8 m step). Depth: 4 when `pick(h, pitDeep, 100) < deepPercent[min(tier, length) − 1]` and the pit is at least `2 × 4 + PIT_APPROACH` (10 m) long along u (`PIT_APPROACH = 2`: pit floor before the 8 m step's foot; amended in Task 5's review, where a 4 m pit 8 m long had its step fill the pit and the walk check refused it), else 2. The steps' corners: `turn = pick(h, pitTurn, 2)`.
- **3c. Levels**, Stage 6's walk down the tree with `doorLevel` and its lifts (§2):
  - **Hall 0**: after `level[0]` is picked, a feature or wrap whose range (§2) it breaks is dropped (a wrap back to its first wall).
  - **Each tree Passage** P → C: the options are [0] when either end's door is raised or a long-side slot (was: a gallery wall or a long-side slot), else as now. C's level is `doorLevel(P, dp) + δ − lift(C, dc)` for the first δ that keeps C's level in 0 to `max` **and** in C's range (§2). If none does and C has a split, a pit or a wrap, it is dropped (a wrap back to its first wall) and the same options are tried again. If that fails too, Stage 6's fallback runs unchanged (P's gallery on this side is dropped, else C's, and [0]).
  - A parent's feature is never dropped: its level was settled within its range, so its door levels are all in 0 to `max`, and a forced-flat [0] always fits a plain child.
  - With the knobs off no feature or wrap exists, every lift is Stage 6's, and every option and level is unchanged.
- **4. Loops**: `loopOk`'s forced-equal test uses "raised" (was a gallery wall), and its door levels `doorLevel`. A loop landing on a gallery wall needs its Deck to cover the door: the first wall's stairwell room as now, a wrap wall always (its whole strip is Deck).
- **5. Passages**: `ya`, `yb` from `doorLevel` × 2. A Hall's `doors` list a side only when its door is not raised and not a long-side slot.
- **7. Kinds**, unchanged. Then each gallery's and feature's geometry from the Hall's final rect:
  - **A wrapped gallery**: `deck`, `ramp`, `up`, `y` as now on its first wall. `wrap.decks`: for an L, `w1`'s strip (`GALLERY_DEPTH` in from `w1`) from the first wall's strip's inner edge to the far wall (the far corner square included); for a U, `w1`'s strip between the first wall's strip and `w2`'s, then `w2`'s whole strip, corner to corner. The Deck post (`DECK_POST`) stays on the first wall's `deck`.
  - **A split** along z (along x the same with x and z swapped): tiers in ascending z: an outer tier `[z0, cutLo]` (when it has one at the low end), the main tier (from `cutLo` or `z0` to `cutHi` or `z1`), an outer tier `[cutHi, z1]`; each full width. With `s = pick(h, splitStep, 2)`, the low-end outer tier's step stands against the low side wall (x0) when s is 0, else the high (x1); the high-end outer tier's against the other one. A step is `STEP_WIDTH` wide from its side wall and 4 m long (`LEVEL_RISE / MAX_SLOPE`), from the cut into the outer tier: the high end's step `z ∈ [cutHi, cutHi + 4]`, `up: 's'`; the low end's `z ∈ [cutLo − 4, cutLo]`, `up: 'n'`; `lo` the outer tier's y, `hi` the main tier's; `rails` both long sides.
  - **A pit**: `pit` = the rect less `PIT_RIM` on every side; `rims` = `floorRects(rect, [pit])` (south, west, east, north); `rim = y + depth`. Its two steps lie on the pit floor along the pit's edges across v, each `STEP_WIDTH` wide and `2 × depth` long (4 or 8), from a corner of the pit, rising toward the rim at that corner's u end. With turn 0: one along the low-v edge from the low-u corner (`up` the low-u side) and one along the high-v edge from the high-u corner (`up` the high-u side); with turn 1 the other two corners. `lo` the pit floor, `hi` the rim, `rails` both long sides. Each step's high end meets the rim's u band at v ≥ 4 m from the centre line, so it is off that wall's doorway; its rim-side long side lies against the rim's face.
  - Every tier edge, rim edge and step edge is on an odd metre (Hall edges are odd; 4, 8 and the cuts keep it).
- **7c′. Daises** (new, after the kinds and before 7b's shapes): for each Hall of kind Boss or Treasure with no gallery and no feature, when `daisPercent > 0` and `pick(h, dais, 100) < daisPercent`: sides in turn from `pick(h, daisSide, 4)` (n, e, s, w, wrapping), the first that fits:
  - the side holds no Passage (no slot of it held);
  - the Hall's half across it is at least `DAIS_DEPTH + DAIS_STEP + CENTRE_CLEAR` (12);
  - with m = `ev(centre's coordinate along the wall)`, the dais is `[m − DAIS_HALF, m + DAIS_HALF]` along the wall and `DAIS_DEPTH` in from it; its step `[m − 3, m + 3]` along and `DAIS_STEP` further in, `up` toward the wall, `lo` the floor, `hi` the dais top, `rails` both long sides;
  - neither overlaps a held slot's lane (7b's: the doorway ± `DOOR_SIDE`, `DOOR_LANE` in), touching allowed.
  - None fits: no dais. A great Boss Hall may take one (rect Halls only means 7b's shape, which comes after).
- **7c. Shapes and pillars** (7b's step): a Hall with a gallery **or a feature** is neither shaped nor pillared.
- **9. Markers**: a Boss Hall with a dais has `markers.boss` on it (the **throne**): at `(m, wall − DAIS_DEPTH / 2)` in the wall's frame, at the dais's `y`. A Treasure Hall with a dais has its three pedestals on it (the **altar**): at `m − 3`, `m`, `m + 3` along the wall (ascending), `DAIS_DEPTH / 2` in, at the dais's `y`. No other marker moves; a pit Hall's centre markers stand on its floor and a split's on its main tier, both at `hy(h)` as now.
- **The rate**: about 1 Hall in 4 with a split, a pit or a dais over the 500 pairs. On 7b's Floors about 6.5 Halls of 20 have a gallery and about 1.5 are great, so about 12 a Floor are candidates for a split or pit; with about 70 % fitting, `features.percent` 50 gives about 4, and the daises about 0.5. Task 6 measures the share and moves `features.percent` in steps of 5 until it lies within 22 to 28 %, and records it. Stairwells: at least 1 gallery in 3 (Stage 6: 1 in 9); Task 6 raises `stairPercent` (at most 100) if the share is under it.

**5. The navmesh** (`src/sim/nav.ts`): on a map with `jumpLinks: 'shortcuts'` a jump try rising more than `SHORTCUT_RISE = 2.5` m (exported; the plan's `JUMP_SHORTCUT_CAP`) is never made: `rise > SHORTCUT_RISE` joins the existing `rise > maxUp` test in the "onto a target" search, before any arc is run. So a 4 m rim, which the probe showed the navmesh takes, gives no jump Link, and a 2 m tier edge, a 2 m rim, a Deck and a 1 m dais keep theirs. A Battle map (`jumpLinks` true) is unchanged, and so is every existing Floor's navmesh (every Deck is 2 m). Nobody is stranded: `walkCheck` already proves every Walk Surface but a roof is walked to and back from, and the judge's `tiers` rule (§7) proves a pit is left by walking. `enclosure.test.ts` proves the Link rule on hand-built maps; the generator soak on its 20 navmesh Floors.

**6. The source** (`floorSource`):
- A Hall's Enclosure stands at `hallBase(h)` (was `h.y`), roofed at `h.top`.
- After the galleries, each Hall in order writes its feature's Brushes: a split its main tier (`<hall>-tier`, a Platform, top the Hall's `y`, the Hall's material) and its steps; a pit its rims (`<hall>-rim<n>`, Platforms, top `rim`, the Hall's material) and its steps; a dais `<hall>-dais` (a Platform, top its `y`, `stone`) and its step. Steps are `<hall>-step<n>` Ramps (`stone`, their `rails`), n from 0 in the feature's order. A wrapped gallery adds `<hall>-deck1` (and `-deck2`) after its Deck, before its Ramp.
- The Brush list is [abyss, halls, passages, galleries, features, slopes, blocks]. A Floor with none is 7b's byte for byte.
- `levels` gains every base, tier, rim and dais height. `shortcuts: true` when the plan has a gallery or a feature.

**7. The judge** (`judge.ts`):
- **New `features`** (plan-only, after `shapes`; one line per failure):
  - a split or a pit stands only on a one-cell Hall, and any feature only on a Hall of shape rect with no gallery, solid or pillar: `features: hall3's pit is not on a one-cell rect Hall without a gallery`;
  - a split's tiers tile its rect along its axis, its main tier at the Hall's level and holding the centre, each outer tier one level under it and at least `TIER_MIN` deep, each cut at least `SPLIT_CUT` from the centre;
  - a pit's floor is the rect less `PIT_RIM`, its rims tile the rest, its depth 2 or 4, its rim at `y + depth`;
  - a dais lies against its side, inside the rect, on a side no Passage leaves by;
  - every Platform, tier, rim and step edge is on an odd metre: `features: hall3-step1 has a Wall on the field's dots`;
  - each step lies inside its Hall, on its lower floor, its high end on the higher floor's edge, its slope at most 1 in 2;
  - each Passage's door height at a Hall (`ya`, `yb`) is the height of that Hall's floor at that side (an outer tier's, the main tier's, the rim's, a Deck's, or the Hall's): `features: pass4's door into hall3 is at 2, its floor there at 0`;
  - each doorway's lane (7b's 3 m) lies on its floor and clear of every step and dais: `features: pass4's doorway into hall3 is blocked by hall3-step0`;
  - every marker of a feature Hall stands on the floor part at its `y`, at least 1 m inside it, and at least 1 m from every step.
- **New `tiers`** (built, after `galleries`): for each feature Hall, each floor part's centre (each tier; a pit's floor and its first rim rect; a dais's top) is a Walk Surface at its height (`floorNear`) that is no roof, reached from the Entrance, and from which the Hall's centre is reached; for a pit, also the field to its first rim rect's centre, read at the Hall's centre, is ≥ 0 (the pit is left by walking): `tiers: hall3's rim (x, z) at 4 is not reached from hall3's floor`.
- **`galleries`** checks each wrap Deck's centre as it does the first Deck's.
- The navmesh is still not built by the judge.
- **`describeFloor`** adds `, s split Halls (t two-tier, h three-tier), p pits (a 2 m, b 4 m), d daises (t thrones, a altars), w wrapped galleries (l L, u U)`; its stairwells count any wall.

**8. What reads the new geometry** (Task 6; each is checked and changed only where said):
- `dropSpots` (`delverLoot.ts`): unchanged. Each spot already lands on `groundNear` of the fall's height, so a fall near a tier edge or a pit's rim lays a spot on the floor that is there (a tier below, or the rim). Tests show a fall on a main tier, in a pit and on a dais each give spots on floors that are neither deadly nor a roof.
- `warbandHomes` (`warbands.ts`): **a throne post faces away from its wall** (n → SOUTH, e → WEST, s → NORTH, w → EAST), not by `guardFacing`, so the Boss and its guard stand on the dais facing the Hall. With the column's files ±1.5 m and ranks up to 2.25 m ahead of a post 3 m from the wall, a Warband of up to six stands on the dais whatever the facing; a seventh or more stands on the floor in front.
- `revealPlace`, `delverMapLayout`, the minimap: unchanged (a feature lies inside its Hall's rect). Tests check `revealPlace` on a main tier, an outer tier, a pit's floor, its rim and a dais.
- `bossHold`, `inStairs`, the fires and the pilot already go by rects and marker heights: unchanged.

**9. Existing tests this sub-stage rewrites** (only these, and only as said):
- `golden.test.ts` (Task 6): the default pins rewritten (`DELVER_VERSION` 8); a new `FLAT_HALLS_PINS` table (`flatHalls`) whose map hashes, plan hashes and attempts are **7b's default pins exactly** (today's `PINS`); `PLAIN_PINS`, `ROOMS_PINS`, `FLAT_PINS` and `OLD_FLOOR_9` unchanged (their helpers turn 7c off); `HOLDS` gains whether each pinned Floor has a split, a pit, a dais and a wrapped gallery (recorded, not forced).
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the new keys (Tasks 2 to 4) and the bundled values (Task 6).
- `delverGen.slow.test.ts` (Task 6): its own `planFloor` call passes the tier (so it agrees with `delverFloor`); the build budget becomes **800 ms mean** (the 2 s cap and the 300 ms navmesh mean stay); the jump Link check becomes: every jump Link is a shortcut rising at most `SHORTCUT_RISE`, none takes off from a 4 m pit's floor, and every Deck still has one; the new counts and must-shows (§10).
- `plan.test.ts`'s Stage 6 and 7b blocks: a case that fails on the shipped values only because 7c's features or wraps changed a Hall (a gallery's Deck, `high`, a shape skipped) runs on `flatHalls`, its expectations unchanged (Task 6 lists each).
- **Any other existing Delver test that fails only because its Floor's Halls changed** runs on `flatHalls(tuning)`, composed with whatever it already used, expectations unchanged. Task 6 lists each. A test that still fails on `flatHalls` is a bug to report.
- `judge.test.ts`'s "levels: refuses a plan flattened to one level" (Task 5's review): it flattens the Halls but not their Passages, so the new `features` door-height check refuses it too; it now reads the `levels` line alone, its expectation unchanged.
- No test is removed.

**10. Tests to add**:
- **Task 1** (`src/mapEditor/enclosure.test.ts`, hand-built on the abyss as the stairwell case; the exact maps are in its brief):
  - a two-tier Hall (Enclosure at 0, roof 6; main tier Platform at 2; outer tier at 0; a railed step; a Passage at 0 through the outer tier's end wall, listed, and one at 2 through a side wall, not listed): compiles, `walkCheck` passes, the floor under the main tier is cut, the roof kept, the main tier's face Wall along the cut runs from −1 to 2, a body walks from the high Passage onto the main tier and from the outer tier up the step;
  - a 2 m and a 4 m pit (rims as four Platforms, two steps): both compile and pass `walkCheck`; a Soldier `trace` from the rim into a 4 m pit is refused (a 4 m drop) and into a 2 m pit allowed;
  - a 1 m dais with its 6 × 2 step: compiles, `walkCheck` passes, `trace` up its face is refused, off its edge allowed (a drop), the destination field's cells over it have one node each (at 1), and `fieldAt`-style reads of the floor's surface there give none;
  - on each with `shortcuts: true`: shortcut jump Links up the 2 m tier edge, onto the 1 m dais and up the 2 m rim; none from the 4 m pit's floor onto its rim; every jump Link a shortcut rising at most `SHORTCUT_RISE` (2.5); and with `jumpLinks` true (a Battle map) the 4 m rim's Links come back (the rule is the shortcuts map's only).
  - The existing stairwell and jump-Link cases unchanged.
- **Task 2** (`plan.test.ts` on `rooms7c`, 200 seeds × Floors 1 to 9): wrap decks in their strips, tiling the walls' strips with the first Deck and the Ramp (no overlap), covering each wrap wall's centre ± (w/2 + 1); every Passage through any gallery wall flat at the Deck's height and not listed in the Hall's doors; a wrapped Hall's level ≤ max − 1; `high` true when any wall holds a Passage; across the 200: L and U wraps, stairwells on a first wall and on a wrap wall, and the stairwell share printed and at least 1 in 3. On `flatHalls`: the plan equals the bundled one (`JSON.stringify`), no new pick (a changed 7c salt changes nothing).
- **Task 3** (`plan.test.ts` on `rooms7c`): splits and pits exactly as §4 (cuts, tiers, levels, steps, rims, pits, odd metres, steps clear of the centre square and every side-centre lane); levels in range; every Passage at a split's main wall or a pit flat and not listed; door heights matching each side's floor; markers at the main floor; no feature on a great hall or a gallery Hall; deep pits more often at tier 3 than tier 1 (the same 200 pairs planned with tier 1 and with tier 3); across the 200: two- and three-tier splits on both axes, 2 m and 4 m pits, a split or pit Entrance, Stairs and Fight Hall; `JUMP_SHORTCUT_CAP === SHORTCUT_RISE`. On `flatHalls`: unchanged bytes.
- **Task 4** (`plan.test.ts` on `rooms7c`): daises only in Boss and Treasure Halls with no other feature, against a wall no Passage leaves by, `DAIS_HALF`/`DEPTH` as §4, clear of lanes and the centre square; the throne and altar markers on the dais at its `y`; no shape or pillar on any feature Hall; across the 200 a throne (on a great Boss Hall) and an altar; the share of Halls with a split, pit or dais printed.
- **Task 5** (`source.test.ts`, `judge.test.ts`, on `rooms7c`): each feature's Brushes (ids, kinds, tops, rails, materials) and order, the Enclosure at `hallBase`, `levels` and `shortcuts`; a 7c Floor compiles and passes the judge first try; the editor's `checkMap` at 2 m finds no Wall on a node; `features` fires on a step moved onto a doorway lane, a tier edge moved half a metre, a marker moved off its tier, a Passage's `ya` raised 2 m; `tiers` fires on a pit with its step Brushes removed from the source (its floor not left by walking), and on a tier's Platform removed; `galleries` fires on a wrap Deck's Brush removed; the navmesh of one 7c Floor with a 4 m pit has no jump Link from that pit's floor, and its shortcut Links rise at most 2.5.
- **Task 6**: `warbands.test.ts` (a throne post faces away from its wall and its Warband deploys on the dais), `delverLoot.test.ts` (drops on a tier, in a pit, on a dais), `reveal.test.ts` (each floor part), and the golden and generator changes of §9.
- **`delverGen.slow.test.ts`** (Task 6, 500 pairs): per Floor and overall, splits (two- and three-tier, by axis), pits by depth and by Run tier, daises (thrones, altars), wrapped galleries (L, U), stairwells (on a first wall and on a wrap wall) against all galleries, the share of Halls with a split, pit or dais (printed), rerolls by rule, and the navmesh's jump Links by kind of ledge (Deck, tier, rim, dais). The budgets (800 ms mean, 2 s, navmesh 300 ms mean) and failed attempts at most 1 in 20 pairs. **It must show it exercised**, else fail: two- and three-tier splits, 2 m and 4 m pits, 4 m pits on more of tier 3's Floors than tier 1's, thrones and altars, L and U wraps, stairwells at least 1 gallery in 3, a share of 22 to 28 %, shortcut jump Links onto a tier, a rim and a dais, and none from a 4 m pit's floor.

**11. The soak** (Task 7, `src/controllers/warbandSoak.slow.test.ts`; immortal party, `withImmortalParty`):
- **The levelled Runs** rerun on the 7c Floors: the Tick against 7b's (mean 0.39 ms, p99 2.77), the Floor build and the navmesh; per Floor the features.
- **A chase between tiers**: the first Floor in seed order with a guard post in a split Hall (the post on the main tier) that has an outer tier with a Passage through its end wall. The Player, in sight of the guard, walks by the navmesh down onto that outer tier and out through its door to the next Hall. Must show: the Warband chases, its anchor's height falls by 1.5 m or more during the Chase, and a Soldier stands on the outer tier while chasing.
- **A Boss on its throne**: the first Boss Floor in seed order whose Boss Hall has a throne; the immortal party (the pilot and two Hard allies) walks to the Boss Hall. Must show: the Boss Soldier deployed on the dais (its Walk Surface the dais's), and promoted while standing on it.
- **A fight on a dais**: in the same Run, a hit landed or taken by a Fighter whose feet are on the dais (inside its rect, within 0.1 m of its top). It prints how many Fighters left the dais other than by its step (knocked or stepped off).
- **Nobody inside a Platform**: over every Tick of these cases and the levelled Runs, no Fighter's or Soldier's position lies inside a tier, rim or dais Platform's rect (shrunk by 0.2 m) with its feet more than 0.2 m under that Platform's top.
- **No Soldier drops into a 4 m pit**: over the same Ticks, no unpromoted Soldier's Walk Surface goes from a 4 m pit's rim to its floor between two Ticks (only its steps lead down), printed with how many Soldier-Ticks were spent in 4 m pit Halls.
- **Stage 2's empty-Floor walk** (`delverRun.slow.test.ts`) on the 7c Floors, against 7b's 136.8, 236.0 and 151.8 s.

**Tasks** (the plan's seven, one after another but 1 beside 2; the boundaries as proposed, with two moves: Task 3 also passes the Run tier in `generate.ts` (one line, so `deepPercent` reaches the plan) and Task 6, not Task 5, makes `delverGen.slow.test.ts` pass it, since the knobs are off until Task 6):
1. **The compiler and the navmesh**: `src/sim/nav.ts` (`SHORTCUT_RISE`), `src/mapEditor/enclosure.test.ts`; `compile.ts` and `checks.ts` only if a test shows a gap (the probe found none).
2. **Galleries that wrap and more stairwells**: `data/delver.json` (`galleries`, knobs off), `src/tuning/delver.ts`, `delver.test.ts`, `tuning.test.ts`, `plan.ts` (3b's stairwell and wrap picks, 3c's wrap range, the raised-door rules for every gallery wall, step 7's wrap decks, `high`), `flat.testdata.ts` (`flatHalls`, `rooms7c`, `plainHalls` and `flatRooms` turning 7c off), `plan.test.ts`.
3. **Splits and pits in the plan**: the same files (`features` without `daisPercent`), plus `generate.ts`'s tier argument.
4. **Daises in the plan**: the same files (`daisPercent`); step 7c′; the throne and altar markers; 7b's shapes and pillars skipping every feature Hall.
5. **The source and the judge**: `source.ts`, `judge.ts`, `generate.ts` (`describeFloor`), `source.test.ts`, `judge.test.ts` (on `rooms7c`).
6. **The consumers and the switch**: `warbands.ts` (the throne's facing), `delverLoot.ts`, `reveal.ts` and `src/render/`, `src/play/floorMap.ts` only if a test shows a need, their tests; the shipped values in `data/delver.json`, `DELVER_VERSION` 8, `golden.test.ts`, `delverGen.slow.test.ts`, `rooms7c` removed, the moved tests, the rate's tuning.
7. **The soak**: §11's cases and measurements.

### Result
Done 2026-11-16. Delver Halls now have verticality inside them:
- **Split levels**: two or three tiers, each a level apart and joined by step Ramps, with doorways on different tiers.
- **Sunken pits**: 2 or 4 m deep. Every doorway is on the rim, and two step Ramps lead down.
- **Daises**: a 1 m throne for the Boss in a Boss Hall, or an altar holding the pedestals in a Treasure Hall.
- **Galleries that wrap**: a gallery may turn one corner (an L) or two (a U).
- **More stairwells**: about 3 galleries in 5 now carry a door at Deck height (Stage 6: 1 in 9).

Battles, Duels and the Hall-graph Run are unchanged. With every 7c knob off (`flatHalls`) a Floor's plan, source and map are byte for byte 7b's. No hashed state is new; `DELVER_VERSION` is 8 and `PROTOCOL_VERSION` stays 30.

**What was built** (as the Design gives it, with the changes below):
- **The navmesh**: `SHORTCUT_RISE` (2.5 m). On a shortcuts map no jump try climbs higher, so a 4 m rim gets no jump Link. A tier edge, a 2 m rim, a dais and a Deck keep theirs.
- **Tuning Data** (`delver.floor`):
  - `galleries` { `wrapPercent` 40, `uPercent` 30, `stairPercent` 60 };
  - `features` { `percent` 80, `weights` split 1 and pit 1, `threePercent` 40, `deepPercent` [25, 40, 55], `daisPercent` 60 };
  - their parse checks.
  - `flatHalls(tuning)` (tests) turns the 7c knobs off; `plainHalls`, `flatRooms` and `flatFloors` apply it too.
- **The plan** (`plan.ts`):
  - wrapped galleries (`DelverGallery.wrap`), and a stairwell's side preferred by `stairPercent`;
  - `DelverHall.feature` (a split, pit or dais) with its tiers, rims and steps;
  - door lifts and raised doors (a Passage through a raised door is flat and cuts its own doorway);
  - each Hall's level kept in its feature's range, a child's feature or wrap dropped when it cannot be;
  - daises after the kinds, with the throne and altar markers on them;
  - 7b's shapes and pillars skip every feature Hall;
  - `hallBase`;
  - `planFloor`'s `tier` argument, read only by `deepPercent`.
- **The source**:
  - each Hall's Enclosure at its lowest floor;
  - a split's main tier, a pit's rims and a dais as Platforms, and their steps as railed Ramps;
  - wrap Decks;
  - the levels, and `shortcuts` for any feature.
- **The judge**:
  - the plan-only `features` rule: geometry, odd metres, every Passage's door at its Hall's floor there, doorways clear of steps and daises, markers on their floor part and off a dais;
  - the built `tiers` rule: every tier, rim, pit floor and dais reached by walking and leading back, and a pit left by walking;
  - wrap Decks in `galleries`;
  - `describeFloor`'s counts.
- **The Run**: a throne post faces away from its wall, so the Boss and its guard stand on the dais.

**Changed from the Design:**
- **Outer tiers are always a level below the main tier**, as written. The Design explains why: a raised outer tier would need its step beside a side doorway.
- **A 4 m pit needs a pit 10 m long** (`PIT_APPROACH` 2 m before its 8 m step's foot). In Task 5, 4 % of first attempts had a step that filled an 8 m pit and failed the walk check.
- **`features.percent` is 80, not 50.** At 50 the share of Halls with a split, pit or dais was 16.6 %. Under the range rule (a split's main tier at level 1 or more, a pit's rim within `levels.max`) about one picked feature in five is dropped.
- **A stuck patrol on a wrapped Deck** (the soak). A patrol Soldier, then its anchor, cut a U-wrapped Deck's inner corner. Deck edges are odd metres and cell centres even, so the field's diagonal join passes exactly through the corner. They dropped 2 m to the floor. The Warband then deadlocked: the anchor sat on the lagging Soldier, the other Soldier walked on along the patrol field, and the dropped one inched along its formation place into a wall. Two fixes, both in the Simulation, Delver-only, no bytes moved:
  - **A lagging Warband's lead is the field to its anchor** (`warband.ts`), so a Soldier cut off walks back and the Warband regroups.
  - **A Warband's Soldier or anchor following its lead field drops off a ledge only where that field leads down**: the way left from where it would land is shorter than from where it stands (`crowd.ts`, `squad.ts`). Else it walks the step without dropping and slides along the edge. Battle Squads keep their drops: the code review caught that the first version applied the rule to them too.
- **The Delver pilot goes to the Boss's post while the Boss Warband lives.** A throne can stand more than 18 m from the Stairs zone, beyond a Warband's 16 m sight. The pilot then parked in the zone and the Boss stood on its throne, and neither came. The pilot is a test and dev harness; a Player walks up.
- **The generator soak's navmesh budget is 500 ms mean (was 300).** The shortcut jump Link search now runs over every tier, rim and dais edge: 291 to 436 ms mean on 7c Floors, against 7b's 162. **This budget is the user's call** (see To watch next).
- **The soak's scenarios take the first candidate that shows what they must**, as 7b's fight round pillars did:
  - **The chase between tiers**: on 7 of 8 candidates the guard was promoted whole before its anchor moved, since the outer tier lies within the Bubble's 10 m.
  - **The Boss on its throne**: one earlier Boss Floor had the Boss walk down its step before Promotion.
- **From the code review**:
  - the drop rule kept off Battle Squads;
  - `flatFloors` turns 7c off (tests built on it alone had got daises);
  - the judge refuses a floor marker under a dais.

**Existing tests changed** (as Design §9 allows):
- `golden.test.ts`:
  - the default pins are rewritten;
  - a new `FLAT_HALLS_PINS` table whose map hashes, plan hashes and attempts are 7b's default pins exactly;
  - `PLAIN_PINS`, `ROOMS_PINS`, `FLAT_PINS` and `OLD_FLOOR_9` are unchanged;
  - `HOLDS` records each pin's features.
- `tuning.test.ts` and `delver.test.ts`: the new keys and the bundled values.
- `delverGen.slow.test.ts`:
  - it passes the tier to its own `planFloor`;
  - the budgets are 800 ms build mean and 500 ms navmesh mean;
  - its jump Link rule: every Link a shortcut rising at most 2.5 m, none from a 4 m pit's floor, and every Deck still with one;
  - the 7c counts and must-shows.
- `judge.test.ts`'s "levels: refuses a plan flattened to one level" reads its `levels` line alone. It flattens the Halls but not their Passages, which the new door-height check also refuses.
- Moved onto `flatHalls`, expectations unchanged:
  - `delverWarbands.test.ts`'s Boss-rule block: its case teleports the Boss Soldier off its dais with its surface left on it;
  - `plan.test.ts`'s 7b "changes nothing of 7a but the Halls' shapes";
  - the soak's "a chase across a level": its first candidate became a one-Soldier guard promoted at once;
  - `src/net/delverCoop.slow.test.ts`: on 7c Floors the two pilots outrun its 20,000-Tick cap against Warbands, with no desync.
- `plan.test.ts`'s Stage 7c `flatHalls` cases compare against the knobs-off plan once the bundled data switched.
- None was removed.

**Measured** (the test container: after a restart it ran `battleSoak.slow.test.ts` at 0.89 ms against Stage 0's 0.79, so about 12 % slower than before):
- **The generator** (500 pairs, alone):
  - 499 passed on the first attempt and 1 on its second (the `levels` rule); 1 failed attempt, 25 allowed.
  - Total plan, build and judge: mean 704 ms, p95 903, max 1129. That is against the new 800 ms mean and the 2 s cap; 7b's was 546.
  - Navmesh: 379 ms mean on 20 Floors, max 656 (7b: 162). Task 6 measured 291 on the earlier container.
  - 412 jump Links, all shortcuts rising at most 2.5 m, none from a 4 m pit's floor. They land on 209 Decks, 80 tiers, 75 rims and 48 daises, and every one of the 134 Decks has one.
  - **Halls with a split, pit or dais: 2,448 of 10,000 (24.5 %).**
  - Splits: 1,456 (883 two-tier, 573 three-tier; 736 along x, 720 along z).
  - Pits: 734 (556 at 2 m, 178 at 4 m). Of the 4 m pits: tier 1 has 48, 0.29 a Floor; tier 2 has 45, 0.27; tier 3 has 85, 0.52.
  - Daises: 258 (83 thrones, 175 altars).
  - Wrapped galleries: 1,039 (743 L, 296 U).
  - Stairwells: 2,028 of 3,445 galleries (58.9 %; Stage 6: 1 in 9), 1,826 on a first wall and 563 on a wrap wall.
  - Stairs depth 1.245 × Stage 6's, as 7b's.
- **The soak** (`warbandSoak.slow.test.ts`, 18 tests, alone):
  - **Levelled Runs**: Tick mean 0.43 ms, p99 2.65 (7b: 0.39, 2.77). Floor build 715 ms mean (max 825) and navmesh 459 ms (max 651), cold, under the soak's own load. The party was on a Ramp for 168.4 s.
  - **The 5-Run soak**: Tick mean 0.45, p99 2.28. 184 Promotions, 71 Chases, 5 Returns, 65 Warbands wiped and 33 patrol loops. The longest patrol leg is 45.5 s, the stuck one fixed.
  - **A chase between tiers** (seed 2, Floor 2, hall8; three tiers along z, main tier at 4): the guard chased for 150 s. Its anchor fell 2.00 m to the outer tier, and a Soldier stood on the outer tier on 204 chase-Ticks.
  - **A Boss on its throne and a fight on a dais** (seed 7, Floor 3, hall0, a 44 × 28 m Boss Hall with its dais on the east wall):
    - the Boss Soldier started on the dais and was promoted on it at 310 s;
    - 10 hits were landed and 9 taken by Fighters standing on the dais;
    - 3 Fighters left the dais by its step and 8 otherwise.
  - **Nobody inside a Platform**: 0 over 537,345 Ticks (12.9 M bodies).
  - **No Soldier dropped into a 4 m pit**: 0, over 75,385 Soldier-Ticks in 4 m pit Halls.
  - **Nobody inside a Block**: 0.
- **Stage 2's empty-Floor walk**: 230.9, 241.7 and 146.0 s to the Stairs on Floors 1 to 3 (7b: 136.8, 236.0, 151.8). Floor 1 is 94 s longer.
- **The Battles** are unchanged:
  - `battleSoak`: the same outcomes, Tick 0.89 ms on this container.
  - `levels.slow.test.ts`: the same outcomes.

**Tests**: `npm run typecheck` is clean. `npm test`: **3162 passed, 5 skipped** (3051 before the Stage). The slow suite: 24 files and **56 tests**, each file run alone, all passing. `src/net/gauntlet.test.ts`'s four-Player checksum test still fails now and then under full-suite load and passes alone, as before this Stage.

**In the game** (no screenshots, the user's call): `npm run dev` with `?dev=1&delver=1&autopilot=1&immortal=1&speed=4` and an Expert AI ally, in a headless browser. The Run played Floors 1 to 9 in 22 minutes of wall time: the Bosses of Floors 3 and 6 were beaten and it reached Floor 9's Boss Floor. The console had no errors, only the headless WebGL "GPU stall" performance warnings.

**To try in a playtest**: `npm run dev`, open `/sword/?dev=1&delver=1`, Skirmish, Gauntlet, Delver, add an AI ally, Fight. `&delverStart=3` starts on the first Boss Floor.
- Fight down from a split's main tier onto its outer tier, and Jump back up. Knock an enemy off a tier edge.
- Walk a pit's rim. Knock an enemy into a 4 m pit and see it climb out by a step; drop into a 2 m one and Jump out.
- Climb a throne's step to the Boss, or Jump onto the dais. Knock it off.
- Walk a U-wrapped gallery and leave through its high door.

**To watch next**:
- **The navmesh budget** is the user's call: 300 ms (Stage 6) or 500 ms (now). The search runs over every new ledge; about 1.1 to 1.3 s laptop-equivalent, warmed a Floor ahead.
- **Floor 1's empty walk is 94 s longer.** 3 tiers, pits and wrapped galleries lengthen the walk inside Halls. Two pilots on Warbands Floors now outrun the co-op test's cap.
- **A throne Boss often walks down its step** before it is promoted. And it stands beyond a Warband's sight of the Stairs zone, so a party waiting at the gate never meets it.
- **Every Ramp inside a Hall is walled to the ceiling on its open sides** (an old compile behaviour, kept for byte identity). A step is a walled chute.
- **Accidental drops off a Deck's inner corner** are now refused for a Warband's lead. Other walks (a Battle Squad, a free agent) still cut such corners.

### Stage 7d: lava
**Model**: Opus (the rules and the AI around them). The user's calls are in "Answered questions (2026-11-23, before Stage 7d)".
- **Lava** is the kit's `lava` Hazard: a Death by Lava for anyone. It lies 4 m under the Hall's floor, as the Cavern's river lies under its ledges: a body that walks, falls or is knocked over the edge dies in it. Soldiers in the Crowd never drop 4 m, so they can never walk in.
- **Shapes**:
  - a central pit ringed by floor;
  - a river from wall to wall, crossed by one or two bridges with no rails, at least 4 m wide (the user's call);
  - troughs along one or two walls.
  - No trough under a Deck's open front or round a dais's edge: they would put lava in a Hall with a gallery or a dais (the user's call: one feature a Hall).
- **Where**: rect Halls only, one feature a Hall, as 7c's rule: a Hall with lava has no gallery, split, pit, dais, 7b shape or pillars, and lava picks before 7b's shapes and pillars. Fight, Empty, Boss and Stairs Halls and great halls may hold it; the Entrance, a Rest Hall and a Treasure Hall never do (the user's call).
- **Amount** (lowered, the user's call): it grows with the tier, about 1 in 6 of the Halls that may hold it on tier 1, 1 in 4 on tier 2 and 1 in 3 on tier 3 (about 1 Hall in 7 of all on tier 3). So 7b's shapes and pillars stay about as common as now. None in the Entrance, and none on the walk to a Rest Hall's fire (no Rest Hall holds lava).
- **Who it threatens**: everyone, as the AI already plays it. Enemies and allies kick toward a hazard more readily (`hazardBehind`). Allies, the pilot and Soldiers never step in by choice. A fire still revives a Player who died in it.
- **The budget** may rise if lava needs it (the user's call): to at most 900 ms build mean and 600 ms navmesh mean in `delverGen.slow.test.ts`; the 2 s cap stays.
- **The judge**:
  - No post, spawn, fire, pedestal, drop spot or the Stairs is on lava, or within a Knockdown's Slide of it.
  - A Warband's home and patrol keep off it.
  - The walk between any two doorways never needs a bridge narrower than a Formation can file through.
  - A drop where a Soldier died in lava lands on `floorNear` off the lava.
- **Render**: lava is drawn glowing, with the kit's look.
- **Done**:
  - the 500 pairs, with the lava per tier counted;
  - the soak, which must show Soldiers and promoted Fighters dying in lava, and no Soldier walking in;
  - a scenario test of a kick into lava and one of a Knockdown's Slide into it;
  - screenshots of each lava shape (the user's call: yes).

#### Design
Written 2026-11-23 at the sub-stage's start, with the user's answers of that day, on base commit `4849ebd`. Battles, Duels and every Floor without lava are unchanged. **No new hashed state**: all of 7d is in the plan and the Map Source, rebuilt on every peer from (Run seed, Floor), as 7a to 7c. `DELVER_VERSION` 13 → 14. `PROTOCOL_VERSION` stays 37: the Tuning Data hash (`tuningDataHash`, which folds in `data/delver.json` and `DELVER_VERSION`) is the handshake's `TuningDataMismatch` check, not the protocol, and 7a to 7c changed it with no protocol bump. **With every 7d knob off** (`noLava`, below) no 7d pick is made and a Floor's plan, source and map are byte for byte today's: the new plan field is optional and absent, and no Brush is written.

**Step 0b baseline** (this container, base commit, each slow file alone): `delverGen.slow.test.ts`: plan 1.70 ms, build 357 ms, judge 24.5 ms, total mean 383 ms (p95 744, max 925); navmesh 186 ms mean (max 505) on 20 Floors; 15 failed attempts (25 allowed: 8 `rooms: no Fight Hall`, 7 `levels`). `warbandSoak.slow.test.ts` (run with `--disableConsoleIntercept`, else its report is not printed): 18 passed in 380 s; the 5-Run soak's Tick mean 0.32 ms, p99 1.72 over 122,956 Ticks, Floor build 245 ms mean (max 347) cold; the levelled Runs' Tick mean 0.29, p99 2.00, `delverFloor` 199 ms mean (max 270), navmesh 98 ms (max 159). **The implementing session re-measures both on its own container** before Task 1 (another container's numbers differ) and compares the Result against those, citing these as well.

**Resuming** (the user's call, 2026-11-23: the Design was written in one chat, the tasks run in a new one): start at Task 1 with this Design as the contract. The Stage's base for the review range is `4849ebd`.

**What was checked in the code before writing this:**
- **Soldiers cannot reach lava 4 m down.** The walk rule (`levels.ts` `trace`/`stepOff`) drops at most `levels.drop` (3 m), so a Crowd step, a Squad's anchor and every destination-field join refuse a 4 m drop: a field never leads onto lava. A lava cell gets its own nodes (lava at y − 4, the abyss at −8) that no floor node joins, so they are islands with distance −1. This is how the Cavern keeps Soldiers out of its river. `walkCheck` skips deadly surfaces. Unpromoted Soldiers therefore never die in lava; promoted Fighters, the party, traitors' Soldiers and human Players can.
- **The navmesh** joins no Link onto deadly ground (`nav.ts`: walk Links between surfaces within a step, drop Links refuse deadly, jump `eligible` refuses deadly). A shortcut jump needs a rise of at least a step (`rise < stepUp` for a shortcut is skipped), so no jump Link crosses a river or a trough at floor level. Portals keep `radius + 0.3` m from their ends, so a funnel path over a bridge never cuts its corner.
- **The Fighter side already works:** a body walked, kicked or Slid over an open edge goes airborne (`settleGround`) and dies on landing on lava (`step.ts`, `deadlyGround`). `stepIsSafe` (`safeMove`) refuses a ledge and deadly ground; `hazardBehind` reads a ledge or lava within 2.4 m behind a target, so the AI already kicks toward it more readily.
- **Knockdown Slides** are at most 1.5 m (`kick.knockdownSlide`, `whirlwind.knockdownSlide`, the Sledge's heavy blow; others 0.9 to 1.2).
- **The compiler**: a `hole` Brush at the Hall's floor height after its Enclosure takes that floor away (`masks`); a `hazard` Brush (`lava`) at y − 4 paints there; no face Wall is stood from a deadly cell or from a floor whose neighbour is lower, so every lava edge is an open ledge. The Enclosure's Walls stand from y − 1 (`BELOW`), so a trough or river against a Hall wall shows a 3 m gap under the wall in the 3D view (render only; Task 6).
- **Drop spots and the Stone are not safe today:** `dropSpots` falls back to the fall's `y` where `floorNear` finds no floor, so a Warband wiped by a death in lava (its last Soldier written back on the lava surface, `bubble.ts` `writeBack`) would lay its items on lava. A Resurrection Stone's spots (±1.5 m round its user, clamped into its Hall rect) can land over lava. A Warband's deploy places (`deployWarbands`, `groundOf`) would stand a Soldier on lava if a place lay over it. Fires (Rest Halls), spawns (the Entrance) and a Boss's revive at the Stairs centre are safe by the markers' rule below.
- **The render already draws lava**: `mapModel.ts` gives a `lava` Walk Surface `HAZARD_LOOKS.lava` (emissive orange) and draws banks from a floor edge down to the lava.

**1. The words.** A Hall's **lava** is one of: a **pit** (one lava rect in its middle, ringed by floor; the Hall's centre moves into the band on one side, as a 7b ring's does), a **river** (a band of lava from wall to wall, parallel to its **bank wall**, cut by **bridges**: the floor left between its rects, no rail), or **troughs** (lava strips along one or two walls). Lava lies `LAVA_DEPTH` (4 m) under the Hall's floor. A Hall **may hold lava** when its kind is Fight, Empty, Boss or Stairs and it has no gallery and no 7c feature (shapes and pillars are picked after lava and skip it). The **keep** (`LAVA_KEEP`, 2.5 m) is a Knockdown's longest Slide (1.5) and 1 m more: no marker, drop spot or revive spot comes closer to lava than that.

**2. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`, `delver.floor`), shipped at the switch (Task 3); Tasks 1 and 2 ship `percent` [0, 0, 0]:
```json
"lava": { "percent": [25, 35, 50], "weights": { "pit": 2, "river": 2, "trough": 3 }, "twoPercent": 40 }
```
- `percent`: per Run tier (`tierOf`, the last entry for any deeper tier), the chance (in 100) that a Hall that may hold lava is picked for it. The starting values are estimates; Task 3 tunes them (below).
- `weights`: whole, at least 0, summing to at least 1, keys exactly `pit`, `river`, `trough`, picked in that order with `byWeight`.
- `twoPercent`: the chance a river wants two bridges (else one), and the chance a trough Hall wants a second wall.
- **Parse checks**: `percent` a non-empty list of whole percents; `weights` as said (the exact key set); `twoPercent` a percent.
- **`noLava(tuning)`** (tests only, `flat.testdata.ts`): `lava.percent` [0], the rest unchanged. It does **not** apply `fullFloors`. `flatHalls` applies it (so `plainHalls`, `flatRooms` and `flatFloors`, which go through `flatHalls`, do too). **`lava7d(tuning)`** (Tasks 1 and 2 only, removed in Task 3): `lava.percent` [25, 35, 50], the rest as bundled.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts` gain the key and its checks.

**3. The plan** (`plan.ts`; all `readonly`):
```ts
export type LavaKind = 'pit' | 'river' | 'trough';
export interface DelverLava {
  kind: LavaKind;
  /** A pit: [the side of the band holding the Hall's centre]; a river: [its bank wall]; troughs: their walls, one or two, in pick order. */
  walls: readonly Side[];
  /** The lava seen from above, ascending z then x: each a Hole in the Hall's floor and a lava Hazard LAVA_DEPTH under it. */
  rects: readonly Rect[];
  /** Its height (m): the Hall's y − LAVA_DEPTH. */
  y: number;
  /** A river's bridges (the floor between its rects, across the whole band), ascending along the river; [] for a pit or troughs. */
  bridges: readonly Rect[];
}
DelverHall += lava?: DelverLava   /* written after `feature`; absent: none */
```
- `rects` (the Hall's floor, rect less solids) is unchanged: lava lies inside it. The Reveal, the minimap and the Floor Map keep reading `rects`.
- New constants: `LAVA_DEPTH = 4`; `LAVA_KEEP = 2.5`; `LAVA_CENTRE = 6` (no lava inside the square centre ± 6: every centre marker, at most 3 m off the centre, then keeps 3 m ≥ `LAVA_KEEP`); `LAVA_LANE = 1` (lava keeps 1 m from every held slot's lane, 7b's lane: doorway ± (`passage / 2 + DOOR_SIDE`), `DOOR_LANE` deep); `LAVA_MIN = 2` (a lava rect's least extent); `BRIDGE_MIN = 4`; `RIVER_BANK = 4` (the floor between a river and its bank wall); `LAVA_BAND = 8` (a pit's side band); `PIT_MIN = 4` (a pit's least extent); `TROUGH_MIN = 4` (a trough segment's least length).
- A test asserts `LAVA_KEEP >= 1 + max(kick.knockdownSlide, whirlwind.knockdownSlide, every weapon's heavy blow knockdownSlide)` on the bundled Tuning (as `JUMP_SHORTCUT_CAP === SHORTCUT_RISE`).
- **New `SALT` keys** (after 72, the highest so far, so no pick moves): lava 73, lavaKind 74, lavaSide 75, lavaWide 76, lavaTwo 77.
- `oddDown(v) = 2 * Math.floor((v - 1) / 2) + 1`, `oddUp(v) = 2 * Math.ceil((v - 1) / 2) + 1`. Every lava edge is on an odd metre (a Hall's walls are), off the fields' 2 m dots, as 7b's solids.
- **`lavaDry(hall, keep): Rect[]`** (exported, pure): `floorRects(hall.rect, [...hall.solids, ...grown])` where `grown` is each lava rect grown by `keep` on every side and clipped to the rect: the Hall's floor at least `keep` from lava, in band order. [] when the Hall has no lava is not used: callers test `hall.lava` first.

**The pick: a new step 7d′, after 7c′ (daises) and before 7c (shapes and pillars)**, so the kinds and the final rects (the Boss Hall's growth) are known, and 7b's shapes and pillars skip lava Halls. For each Hall h in index order that may hold lava, when `p = lava.percent[min(tier, length) − 1] > 0` and `pick(h, lava, 100) < p`: the kind is `byWeight(h, lavaKind, [pit, river, trough])`. A kind that does not fit leaves the Hall plain; no other kind is tried (7b's rule). The fits below are tried with sides in turn from `pick(h, lavaSide, 4)` (n, e, s, w, wrapping); the first side that fits is taken. With r the rect, (cx, cz) its centre, C the square centre ± `LAVA_CENTRE`, and L the lanes of its held slots (7b's formula, as the dais step builds them). Written for one side; the others are its turns (x and z swapped, signs mirrored):
- **Trough** on wall d = n, depth t = [2, 4][`pick(h, lavaWide, 2)`]: the strip S = {x0, z1 − t, x1, z1}. It fits only when z1 − t ≥ cz + `LAVA_CENTRE`. Then cut S along the wall: from [x0, x1] take away, for each lane ℓ that comes within `LAVA_LANE` of S (its rect grown by 1 overlaps S), the span [oddDown(ℓ.x0 − 1), oddUp(ℓ.x1 + 1)]. The runs left that are at least `TROUGH_MIN` long are the troughs on d; with none, d does not fit. **Two walls**: when `pick(h, lavaTwo, 100) < twoPercent`, the opposite wall is tried with the same t, and taken if it fits (else one wall). `walls` is [d] or [d, opposite(d)]; `rects` every run, sorted z then x.
- **River** with bank wall d = n, width w = [2, 4][`pick(h, lavaWide, 2)`]: the band z ∈ [a, a + w] with a = oddUp(cz + `LAVA_CENTRE`); it fits only when z1 − (a + w) ≥ `RIVER_BANK`, and every lane **not on d** keeps `LAVA_LANE` from the whole band {x0, a, x1, a + w}. **Bridges**, along x:
  1. a **door bridge** for each held slot on d (its line ℓ): [oddDown(ℓ − 2), oddUp(ℓ + 2)] (the doorway with 0.5 m each side: 4 m when ℓ is odd, 6 when even), clipped to [x0, x1];
  2. `want` = 2 when `pick(h, lavaTwo, 100) < twoPercent`, else 1. While the bridges are fewer than `want`: in the longest lava run (the first on a tie), a **free bridge** [m − 2, m + 2] with m the odd metre nearest the run's middle (the lower on a tie), only if it leaves at least `LAVA_MIN` of lava on both sides; else stop.
  3. A lava run shorter than `LAVA_MIN` becomes floor (it widens its bridge). With no lava run left, d does not fit.
  - `rects` are the runs × [a, a + w]; `bridges` the gaps between them, each × [a, a + w], and also a gap against a wall's end that holds a doorway on d (a **wall-end door bridge**: a great hall's long-side slot within 2 m of a corner); a gap against a wall with no doorway on d is no bridge: it is floor. So `rects`, `bridges` and at most two wall-end floor gaps tile the band. Every bridge is at least `BRIDGE_MIN` wide by construction (a clipped door bridge still holds its doorway and 0.5 m, on odd metres: at least 4 m), every doorway on d opens straight onto one, and every river has at least one bridge. Step 2 counts every door bridge, a wall-end one included, toward `want`. (Amended 2026-11-23 in Task 1's review: the first cut left 5 of 245 rivers with no listed bridge, their only crossing at a wall end.)
  - Why the walk is never cut: the river lies beyond C, so the centre, the walls across it and every doorway not on d are on the centre's side; every lane on d crosses a bridge; the bank behind the river is at least 4 m wide and reached by every bridge. A great hall's long-side lane that lies wholly on the bank side is allowed (it keeps 1 m from the band) and is reached over a bridge.
- **Pit**, with the centre band on side d = s: the pit P = {x0 + `LAVA_BAND`, z0 + 2·`LAVA_CENTRE`, x1 − `LAVA_BAND`, z1 − `LAVA_BAND`}. It fits when both its extents are at least `PIT_MIN` (a Hall half of at least 10 across the band and 12 along it). Every band is then at least 8 m, more than a lane's 6 + 1, so every lane is clear. **The centre moves** to the centre band's middle: for d = s, (cx, z0 + `LAVA_CENTRE`); n: (cx, z1 − 6); e: (x1 − 6, cz); w: (x0 + 6, cz). This is set on the work Hall before 7c and step 9, as the ring does. `walls` [d], `rects` [P].
- `y` = the Hall's y − `LAVA_DEPTH`.
- **7c (shapes and pillars)**: a Hall with a gallery, a feature **or lava** is neither shaped nor pillared.
- **The rate** (Task 3): over the 500 pairs, the share of Halls that may hold lava which hold it is printed per tier and per kind. Task 3 moves each `percent` entry in steps of 5 until tier 1's share lies within 14 to 20 % (1 in 6), tier 2's within 22 to 28 % (1 in 4) and tier 3's within 30 to 36 % (1 in 3), and records the values. The share of all Halls is printed too (about 1 in 7 expected on tier 3). If a kind is under 10 % of the lava Halls, its weight is raised.

**4. The source** (`floorSource`): after the features and before the slopes, each lava Hall in index order writes, for each lava rect n: `<hall>-hole<n>` (`hole`, y the Hall's y, the rect) then `<hall>-lava<n>` (`hazard`, `lava`, y the lava's y, the rect). The Brush list is [abyss, halls, passages, galleries, features, lava, slopes, blocks]. `levels` gains each lava's y. `shortcuts` is unchanged (lava alone does not ask for it). A Floor with no lava writes today's source byte for byte. Exported ids: `holeId(hall, n)`, `lavaId(hall, n)`.

**5. The judge** (`judge.ts`):
- **New plan-only `lava` rule** (after `features`; one line per failure):
  - lava only on a Hall of kind Fight, Empty, Boss or Stairs, of shape rect with no gallery, feature, solid or pillar: `lava: hall3's lava is not on a plain Fight, Empty, Boss or Stairs Hall`;
  - each rect inside the Hall's rect, at least `LAVA_MIN` on each axis, no two sharing interior, every edge on an odd metre (`lava: hall3-lava1 has an edge on the field's dots`), and `y` the Hall's y − `LAVA_DEPTH`;
  - no rect shares interior with the centre square ± `LAVA_CENTRE`;
  - every marker standing in the Hall (spawns, the Stairs zone as a rect, fires, pedestals, posts, patrol points, the Boss) is at least `LAVA_KEEP` from every rect, by the squared distance from above (point to rect, or rect to rect; no `hypot`): `lava: post2 is within 2.5 m of hall3-lava0`;
  - every held slot's lane keeps `LAVA_LANE` from every rect, but a river's lanes on its bank wall, whose doorway ± 0.5 m must lie inside one bridge's span: `lava: pass4's doorway into hall3 is not clear of hall3-lava1`, `... is not on a bridge`;
  - by kind: a river's rects and bridges tile one band from wall to wall, each bridge at least `BRIDGE_MIN`, the band beyond the centre square and its bank at least `RIVER_BANK`; a pit is one rect with its bands `LAVA_BAND` and its centre band 2 × `LAVA_CENTRE`, and the Hall's centre in that band's middle; each trough lies against one of its walls;
  - **Warband homes**: for each post and the Boss post in a lava Hall, every Formation place of a full column Squad stands at least 1 m from every rect. This is proved without trig (amended 2026-11-23, Task 3's brief: a verdict that decides a reroll must not hang on `sin`/`cos`). The column's reach is ρ² = r² + f² with r = (`column.wide` − 1) / 2 · `spacing` and f = (⌈`size` / `column.wide`⌉ − 1) / 2 · `spacing` (2.70 m on the shipped data, whatever the facing). The post's squared distance to each rect must be at least (ρ + 1)². The failure reads: `lava: post2's Formation (reach 2.7 m) comes within 1 m of hall3-lava0`.
- **New built `lavaWalk` rule** (after `tiers`): for each lava Hall, (a) at each rect's centre the Walk Surface `groundBelow` finds under the Hall's y + `stepUp` is lava at the lava's y (the Hole and the Hazard compiled); (b) the field toward the Hall's centre (`distanceTo`) reads ≥ 0 at the point 1 m inside the Hall on each held slot's line (at the door's height) and, for a river, at each bridge's centre: `lavaWalk: pass4's doorway into hall3 does not reach its centre`.
- **A failed rule rerolls the Floor** (it is a proof: the pick only makes what fits, so the target is 0). The generator slow test counts rerolls by rule, as now.
- **`describeFloor`** adds `, l lava Halls (p pits, r rivers with b bridges, t trough Halls)`.

**6. Deaths, drops and revives** (Task 4):
- **`dropSpots`** (`delverLoot.ts`): when R's Hall (`rectOf`'s `hall` ≥ 0) has lava, R is replaced by the rect of `lavaDry(hall, LAVA_KEEP)` nearest the fall point (`gap2`, the first on a tie), and each spot's floor is looked up at the Hall's `y` (not the fall's, which is the lava's). Everything else is as now. So every spot lies at least `LAVA_KEEP + DROP_MARGIN` from lava, on the Hall's floor. With no lava, unchanged.
- **The Resurrection Stone** (`delverRun.ts` `useConsumables`): `placeRect` also gives the Hall it found (or −1). When that Hall has lava, `fit` clamps each spot into the rect of `lavaDry(hall, LAVA_KEEP)` nearest the spot (shrunk by `REVIVE_MARGIN`) in place of the Hall rect. With no lava, unchanged.
- **Unchanged, and why**: a fire's revive (no Rest Hall holds lava); a new Floor's spawns (none in the Entrance); a Boss's revive at the Stairs centre ± 1.5 m (the Stairs zone keeps `LAVA_KEEP`); a Player's own drop at its feet (only on the ground, never mid-air); a traitor's Soldier and a promoted Fighter that die in lava (written back where they fell: dead, and their Warband's drops go by `dropSpots`); demotion (never in the air, and a living Fighter never stands on lava); `deployWarbands` (the judge's home rule).

**7. The AI** (Task 5, only on the soak's evidence): nothing is changed up front, since the checks above show allies, the Delver pilot and promoted enemies path by the navmesh (no Link onto lava, portals clear of corners), step by `safeMove`, and kick by `hazardBehind`. If the soak shows an ally, pilot or promoted Soldier walking into lava (a Death by Lava with no kick, Knockdown, Slide or Whirlwind blow on it in the 3 s before), Task 5 finds the cause and fixes it there, with a scenario test of its own. The traitor pilot and human Players may walk in.

**8. The render** (Task 6, render only, never an outcome):
- **Walls over lava**: in `mapModel.ts`, a Wall whose foot stands over lava (a Hall Wall above a trough's or a river's end) is drawn down to the lava's height, so no gap shows under it.
- **Light**: one warm point light per lava Hall (colour 0xff5a18, as the chamber's `LIGHT_lava`), 1 m over the centre of its largest lava rect; only the 2 nearest the camera are on in a frame (Task 6 and the review: a fixed pool of 2, `LAVA_POOL`, on every Delver Floor, so a Floor's light count, and with it three.js's shader programs, is the same with lava or without; 4 was the first plan).
- **Maps**: the minimap (`Minimap.drawDelver`) and the Floor Map (`delverMapLayout`, `floorMapView`) draw a revealed Hall's lava rects in lava orange over its floor.

**9. Existing tests this sub-stage rewrites** (only these):
- `golden.test.ts` (Task 1 adds, Task 3 rewrites): new `NO_LAVA_PINS` and `NO_LAVA_TIER_PINS` tables, on `noLava(tuning)`, whose map hashes, plan hashes and attempts are **today's `PINS` and `TIER_PINS` exactly**. At the switch (Task 3) `PINS` and `TIER_PINS` are rewritten (`DELVER_VERSION` 14) and `HOLDS` records whether each pin has lava (and its kind). `FLAT_HALLS_PINS`, `PLAIN_PINS`, `ROOMS_PINS`, `FLAT_PINS` and `OLD_FLOOR_9` are unchanged (their helpers turn lava off, and an absent field adds nothing to a plan's hash).
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts`: the new key (Task 1) and the bundled values (Task 3).
- `delverGen.slow.test.ts` (Task 3): the lava counts and must-shows (§10); the budgets may rise to 900 ms build mean and 600 ms navmesh mean if needed (the user's call), recorded.
- **Any other existing Delver test that fails only because its Floor's Halls changed** (Task 3's switch) runs on `noLava(tuning)`, composed with what it already used, its expectations unchanged. Task 3 lists each. A test that still fails on `noLava` is a bug to report.
- No test is removed.

**10. Tests to add**:
- **Task 1** (`plan.test.ts` on `lava7d`, 200 seeds × Floors 1 to 9, with the tier passed): every lava rect as §3 (odd edges, inside, `LAVA_MIN`, out of the centre square, out of the lanes but a river's bank-wall lanes, which lie on a bridge); bridges at least 4 m, a river band from wall to wall with its bank; a pit's bands and its moved centre; every marker `LAVA_KEEP` from lava; lava only on Halls that may hold it, never Entrance, Rest or Treasure; no shape or pillar on a lava Hall; across the 200: each kind, a river with two bridges, a door bridge, a two-wall trough, lava in a Boss Hall, a Stairs Hall and a great hall. On `noLava` (and on the bundled data while it is off): the plan equals today's (`JSON.stringify`), and a changed 7d salt changes nothing. `lavaDry` by hand for each kind. `LAVA_KEEP` against the Slides.
- **Task 2** (`source.test.ts` on `lava7d`): the Hole and Hazard Brushes (ids, kinds, heights, order) and `levels`; a lava Floor compiles and passes `walkCheck`; at a lava rect's centre the ground is lava 4 m under the floor; no face Wall along a lava edge; a Soldier `trace` from the floor into the lava is refused and one across a bridge allowed; the destination fields have no node of the floor joined to a lava node; the navmesh of a river Floor has no Link onto lava and no jump Link that takes off or lands in a lava Hall. On `noLava`: the source equals today's.
- **Task 3** (`judge.test.ts` on the shipped data): lava Floors pass the judge first try; the editor's `checkMap` at 2 m finds no Wall on a node; `lava` fires on a rect moved onto a marker, onto a lane, half a metre (dots), a bridge narrowed to 2 m, lava put in the Entrance; `lavaWalk` fires on a bridge's Hole widened over it in the source (the far bank cut off), and on a Hazard removed (the ground is no lava). `describeFloor`'s counts.
- **Task 4** (`delverLoot.test.ts`, `delverRun.test.ts`/the Consumables tests): a fall on lava in a pit, a river and a trough Hall gives spots all `LAVA_KEEP` from lava, on the floor at the Hall's height; a Resurrection Stone used on a bridge's edge revives everyone `LAVA_KEEP` from lava; a fall in a Hall without lava gives today's spots exactly.
- **`delverGen.slow.test.ts`** (Task 3, 500 pairs): per tier and per kind, the Halls with lava against the Halls that may hold it and against all Halls; rivers by bridges (1, 2) and bridges by width (4, 6 m); trough Halls by walls (1, 2) and depth; pits; the lava rects a Floor (mean, max); rerolls by rule (the `lava` and `lavaWalk` lines); the navmesh's jump Links that take off or land within `LAVA_KEEP` of lava or pass over it (expected 0) and the Links onto lava (must be 0); the budgets and failed attempts at most 1 in 20 pairs. **It must show**, else fail: each kind on every tier, a river with two bridges, a 6 m door bridge, a two-wall trough, lava in a Boss Hall, a Stairs Hall and a great hall, the three tier shares in their ranges, and no Link onto lava.

**11. The soak and the scenarios** (Task 7, `warbandSoak.slow.test.ts`; the immortal party, `withImmortalParty`; a lava death kills whatever its HP, so the party may still fall in it):
- **The levelled Runs and the 5-Run soak** rerun on the 7d Floors: the Tick against the Step 0b baseline, the build and the navmesh; per Floor the lava Halls.
- **Instrumentation over every Tick of every case**: each Death by Lava classified by what pushed the victim in the 3 s before (a Kick, a Knockdown or its Slide, a Whirlwind blow, else **walked**), and by who died (party Player, ally, promoted Soldier, traitor). The ground under each unpromoted Soldier (never lava), each Pickup's spot and each `Revived` spot (never on lava, never within `LAVA_KEEP`).
- **Must show, else fail**:
  - Floors with lava on every tier, each kind at least once, and the party walking through a lava Hall (a party Fighter's feet on a bridge, on a pit's ring and beside a trough);
  - Fighters dying in lava by a push (a kick, a Slide, a Knockdown or a Whirlwind), with the count by cause and by victim (the review's call: the Design first asked for promoted Soldiers, whom the party never pushed in over the soak; see the Result);
  - no Soldier, ally or pilot walking into lava: 0 walked-in Deaths by Lava of an ally, the pilot or a promoted Soldier, over a printed number of Soldier-Ticks in lava Halls, and 0 unpromoted Soldiers on lava;
  - no drop, revive or Pickup on lava: 0.
- **A kick into lava** (a scenario, its own `it`): on the first Floor in seed order with a river, an Expert AI Fighter beside a bridge's edge kicks a promoted Soldier (or a Duel Fighter placed there) standing with lava behind it; the target dies of Lava within 3 s.
- **A Knockdown's Slide into lava**: the same with a heavy blow's Knockdown (a Sledge Hammer) whose 1.5 m Slide carries it over a pit's edge.
- If either does not happen on the first candidate, it takes the next (as 7b's and 7c's scenarios did) and prints which.

**Tasks** (one after another; Task 6 may run beside Task 4, their files disjoint):
1. **The plan and its Tuning**: `data/delver.json` (`lava` with `percent` [0, 0, 0]), `src/tuning/delver.ts`, `delver.test.ts`, `tuning.test.ts`, `plan.ts` (§3), `flat.testdata.ts` (`noLava`, `lava7d`, `flatHalls` applying `noLava`), `plan.test.ts`, `golden.test.ts` (the two `NO_LAVA` tables only).
2. **The source**: `source.ts` (§4), `source.test.ts`, and a `nav.test.ts` or `source.test.ts` case for the navmesh and field checks of §10. `compile.ts` only if a test shows a gap (the read found none).
3. **The judge and the switch**: `judge.ts`, `generate.ts` (`describeFloor`), `judge.test.ts`; the shipped `lava` values tuned to the rate, `version.ts` (14), `golden.test.ts`'s `PINS`, `TIER_PINS` and `HOLDS`, `delverGen.slow.test.ts`, `lava7d` removed, and the tests moved onto `noLava`. The generator slow test is run alone.
4. **Deaths, drops and revives**: `delverLoot.ts`, `delverRun.ts` (the Stone), their tests.
5. **The AI**, only where Task 7's soak shows a fault: `ai.ts`, `allyAi.ts`, `delverPilot.ts`, `crowd.ts`. Run after a first soak pass, or skipped with the reason recorded.
6. **The render**: `src/render/mapModel.ts`, the lava lights (`src/render/`), `src/render/minimap.ts`, `src/play/floorMap.ts` and `floorMapView.ts`, their tests.
7. **The soak and the scenarios**: §11 in `warbandSoak.slow.test.ts`, run alone.

### Result
Done 2026-11-23. Delver Halls may now hold lava, 4 m down in a Hole cut through the floor:
- **Pits**: one long lava rect in the middle of the Hall, the centre moved into its wide band.
- **Rivers**: a band from wall to wall beyond the centre square, crossed by bridges (4 or 6 m: a door bridge in front of each doorway on the bank wall, and free 4 m bridges), the bank behind it at least 4 m.
- **Troughs**: 2 or 4 m deep strips along one wall, or two opposite walls, cut round the doorway lanes.

Battles, Duels and every Floor without lava are unchanged (the AI's new lava checks run only on an Arena that has lava). With 7d's knob off (`noLava`) a Floor's plan, source and map are byte for byte 7c's (the `NO_LAVA` pins). No hashed state is new; `DELVER_VERSION` is 14 and `PROTOCOL_VERSION` stays 37.

**What was built** (as the Design gives it, with the changes below):
- **Tuning Data** (`delver.floor.lava`): `percent` [20, 55, 70] by Run tier, `weights` pit 2, river 2, trough 3, `twoPercent` 40; their parse checks.
- **The plan** (`plan.ts`, step 7d′ after the daises): `DelverHall.lava` { kind, walls, rects, y, bridges }, every edge on an odd metre, and `lavaDry(hall, keep)`. A lava Hall is neither shaped nor pillared.
- **The source**: `<hall>-hole<n>` and `<hall>-lava<n>` Brushes after the features; `levels` gains each lava's y.
- **The judge**: the plan rule `lava` (rects, lanes, markers, bridges, banks) and the built rule `lavaWalk` (the walk over the built map: each bridge joins its banks, the ground under each rect is lava). Warband homes keep `LAVA_KEEP` by a trig-free reach bound (ρ = 2.70 m).
- **Drops and revives**: `dropSpots` and the Resurrection Stone's `fit` use the nearest `lavaDry` rect of a lava Hall, at the Hall's height.
- **The render**: a Wall over lava is drawn down to it (`overLava`); a fixed pool of 2 warm lights follows the camera over the lava (`delverLava.ts`); the minimap and the Floor Map draw lava in orange; clutter keeps 1 m off lava.
- **The AI** (Task 5, on the soak's evidence): `edgeKeep` (an Arena with lava only) drops the outward part of a walk within 0.5 m of Lava and steps inboard within 0.42 m, which also holds against body pushes; `waitAtRing` steps by `safeMove`; `stepIsSafe` also probes at a quarter of its reach. The last two apply only on an Arena with lava.
- **Tests**: the plan, source, judge, loot, run, render and Floor Map tests; the generator slow test's lava counts; the soak's `lavaWatcher` and a lava-Floors case; `lavaScenes.slow.test.ts` (a kick off a river bridge, a Sledge Hammer's Slide into a pit, an edge held against a push).

**Changes from the Design**:
- **Rivers**: a wall-end gap holding a doorway counts as a bridge, and a river with no crossing leaves its Hall plain (the review). Every river has a bridge.
- **Warband homes**: the judge's reach check is trig-free (placeOffset's sin/cos could not decide a reroll).
- **Lights**: a pool of 2, on every Delver Floor, not 4: the light count, and with it three.js's shader programs, is the same with lava or without.
- **The soak's push must-show**: the Design asked for promoted Soldiers pushed into lava. Over 95 soak Floors the party never pushed one in (one did die in a Task 5 run, by a fellow Soldier's kick). Warband posts, drops and revives keep 2.5 m off lava, and most kicks near lava land on a Blocking Soldier and are only a Shove. The must-show now counts any Fighter pushed in, by cause and by victim; `lavaScenes` proves a kick and a Slide into lava kill. If promoted Soldiers should go in more often, the AI's kick toward lava (`hazardBehind`) is the place: a later call.
- **A render bug found in the playtest**: in a roofed Hall `overLava` found the roof before the lava, so a trough's Wall stopped at its foot and the trough showed the void. The roof is skipped (`mapModel.test.ts` covers it).

**Generation** (`delverGen.slow.test.ts`, 500 pairs, run alone; base numbers from this container's Step 0b):
- **Share of Halls with lava**, of those that may hold it (a Fight, Empty, Boss or Stairs Hall with no gallery or feature) and of all Halls:
  - tier 1: 47 of 270, **17.4 %** (4.0 % of all); pit 7, river 9, trough 31;
  - tier 2: 115 of 462, **24.9 %** (6.9 %); pit 26, river 19, trough 70;
  - tier 3: 388 of 1154, **33.6 %** (11.8 %); pit 60, river 48, trough 280.
  - All: 550 lava Halls (pit 93, river 76, trough 381, so troughs are 69 %). Floors with lava 279 of 500; lava rects a Floor mean 1.97, max 14. Lava in 39 Boss Halls, 41 Stairs Halls, 347 Fight, 123 Empty, 151 great halls.
- **Bridges**: 76 rivers, 49 with one bridge and 27 with two; 103 bridges, 64 of 4 m and 39 of 6 m.
- **Troughs**: 381 Halls, 260 on one wall and 121 on two; 222 of 2 m depth and 159 of 4 m.
- **Rerolls**: 15 of 500 pairs, 15 failed attempts (allowed 25), none by `lava` or `lavaWalk` (base: 15).
- **Dropped picks** (a Hall picked for lava whose kind did not fit, so it stays plain; counted on the first attempts of the 500 pairs): 576 of 1126 picks (51 %). Tier 1: 13 of 57; tier 2: 131 of 249; tier 3: 432 of 820. By kind: pits 236 of 328 (72 %), rivers 225 of 302 (75 %), troughs 115 of 496 (23 %). This is why troughs dominate; `percent` was tuned with the drops in it.
- **Build** (mean, the passing attempt): plan 1.58 ms (base 1.72), build 338 (350), judge 24.1 (23.8), total 363, p95 677, max 845 (base 376, 733, 922). **Navmesh** on 20 Floors: mean 179 ms, max 469 (base 195, 566). Both are inside the Stage 6 budgets (build mean ≤ 600 ms, none over 2 s, navmesh mean ≤ 300 ms), so the user's raise to 900 and 600 ms was not needed.
- **Jump Links near lava**: of 253 jump Links on the 20 Floors, 0 take off or land within `LAVA_KEEP` of lava or pass over it, and 0 Links go onto or from a lava Walk Surface.

**The soak** (`warbandSoak.slow.test.ts`, run alone, 24 tests in 916 s against 418 s at base; the lava-Floors case adds about 7 minutes):
- **Floors with lava**: 95 Floors seen, 49 with lava: tier 1 8 of 44, tier 2 12 of 16, tier 3 29 of 35; Floors holding a pit 15, a river 20, a trough 42.
- **The party past lava** (Fighter-Ticks over 1,514,982 Ticks): 9,754 on a river's bridge, 40,463 on a pit's ring, 26,299 beside a trough.
- **Deaths by Lava**: 2, both AI allies: 1 by an enemy's kick, 1 by a chain Knockdown. 0 promoted Soldiers, 0 the pilot.
- **Walk-ins**: 0 Deaths by Lava of an ally, the pilot or a promoted Soldier with nothing pushing them, over 2,683,231 Soldier-Ticks in lava Halls (of 20,579,762 unpromoted Soldier-Ticks). 0 unpromoted Soldiers on lava. The first soak (before Task 5) found 3 walk-ins: a Waiting Soldier stepping off a bridge, and a Soldier and an ally pushed over a pit's edge by the bodies around them.
- **Drops, revives and Pickups**: 676 Pickups and 2 revives, 0 on lava or within 2.5 m of it.
- **Tick**: the 5-Run soak mean 0.32 ms, p99 1.87, max 161.8 over 122,465 Ticks (base 0.36, 1.98, 212.9 over 122,956); Floor build 238 ms mean, 341 max (base 273, 380). The levelled Runs: Tick mean 0.30, p99 1.92 (base 0.32, 2.24); `delverFloor` 217 ms mean, 302 max (base 264, 401); navmesh 108 ms, 202 max (base 133, 221).
- The final soak run had the push must-show in its first form, which failed (no promoted Soldier pushed in); in its new form the same run's 2 push deaths pass it. The file was not rerun after the assertion changed.

**The scenarios** (`lavaScenes.slow.test.ts`, 3 of 3): a kick off a 4 m river bridge (Run 1 Floor 8, the second candidate) kills by Lava 51 Ticks after the KickLanded; a Sledge Hammer's heavy blow Slides a Fighter into a pit (Run 1 Floor 7, the first candidate); 5 set-ups of a Fighter pushed toward a pit's side, corner and a bridge's edges all stand for 20 s, and all 5 died at Ticks 55 to 83 without Task 5's fix.

**The review** (`/code-review high` on 4849ebd..HEAD): 6 findings. Fixed: `edgeKeep` read a Wall's far side (the abyss) as deadly, so on a lava Floor the AI shied from every Wall (it now reads Lava only); Task 5's two global changes reached Battles and Duels (now on lava Arenas only); a river could be planned with no bridge. Recorded, not changed: the light pool (above); no parse check of `battle.levels.drop` against `LAVA_DEPTH` (the Delver parse does not see the Battle's Tuning; the source test checks no destination field joins floor to lava); and an empty `lavaDry` falls back to the Hall's rect, which the plan's constants cannot reach (the centre square is always dry).

**The playtest** (`npm run dev`, `?dev=1&autopilot=1&immortal=1&speed=4`, solo Gauntlet, software WebGL at 1 to 9 fps): Floors 1 to 3 to Floor 4; then `delverStart` 5 (tier 2, played on into Floor 6, a Boss Floor with lava), 7 (tier 3) and 9 (a Boss Floor). The console showed only the software renderer's warnings. (Two earlier tries at 5 and 7 fell back to the menu when Vite reloaded the page on a source edit, and were run again.) Screenshots of a pit (Run seed 10, Floor 1), a river with two bridges (seed 10, Floor 5) and two-wall troughs (seed 10, Floor 3) were taken with a temporary camera hook, not committed. They found the trough bug above.

**Known gaps**:
- **Promoted Soldiers are rarely pushed into lava** by the party (above).
- **Pits and rivers drop often**: half the picks on tiers 2 and 3 do not fit, so troughs are 69 % of lava Halls. Looser fits (a pit off-centre, a river on a door wall) are 7e's to weigh.
- **5 Size tests fail on the base commit** (`src/lobby/size.test.ts` 2, `src/sim/size.test.ts` 2, `troops.test.ts`'s `sizeOfHp` 1), before and after 7d; not 7d's.
- **The soak file is slow**: 916 s against 418 s.

### Stage 7f: set-piece rooms
**Model**: Opus (the geometry, the levels and the compiler), then Sonnet for the counts and the editor. The user's calls are in "Answered questions (2026-11-24, before Stage 7f)". The user's layouts (three spreadsheets, 9 × 13 cells with the doorways outside the walls) are summarised in §1; they are a layout, not a scale.
- **Three set pieces**, hand-designed by the user (a change from 7e's "no hand-made templates", the user's call), scaled to the Hall they land in:
  - a **Lava Bridge**: a cross of 4 m bridges over lava, meeting on a dry plaza in the middle;
  - an **Uphill Room**: the whole Hall one big Ramp, from a low landing at one end to a high landing at the other;
  - a **Spiral Stair**: a 4 m ledge that climbs round three walls of the Hall over an open floor, with a landing at each wall's doorway, each a level higher than the last.
- **Where**: rect Halls of kind Fight, Empty, Boss or Stairs, and great halls where the size fits. Never the Entrance, a Rest Hall or a Treasure Hall. One feature a Hall: a set piece is picked before every other feature (galleries, splits, pits, daises, lava, shapes, pillars), which then skip its Hall.
- **Amount**: about 1 Hall in 10, the three weighted alike. A rare set piece, not one a Floor.
- **Done**:
  - the 500 pairs, with each set piece counted per tier (one run, at the switch);
  - a set-piece soak case (§14), not the full soak;
  - `npm run ai-walk -- --seeds 1-50 --floors 1,5,9` clean;
  - a screenshot of each set piece in the Map Editor.

#### Design
Written 2026-11-24 with the user's answers of that day, on base commit `a0469b1`. Battles, Duels and every Floor with no set piece are unchanged. **No new hashed state**: all of 7f is in the plan and the Map Source, rebuilt on every peer from (Run seed, Floor), as 7a to 7d. `DELVER_VERSION` 14 → 15. `PROTOCOL_VERSION` stays (7d's reasoning: the Tuning Data hash folds in `DELVER_VERSION`). **With the 7f knob off** (`noSetPieces`, below) no 7f pick is made and a Floor's plan, source and map are byte for byte 7d's: every new plan field is optional and absent, every new filter is a no-op, and no Brush is written.

**Resuming** (the user's call, 2026-11-24: this Design was written in one chat; the tasks run in a new one). Start at Task 1 with this Design as the contract. Where the code proves a rule here wrong, amend the Design in place with the date and the reason, as 7d did.

**No baseline run** (the user's call, 2026-11-24). 7d's Result is the baseline:
- the generator: build mean 363 ms, p95 677, max 845, navmesh mean 179 ms, 15 failed attempts in 500 pairs;
- the soak: Tick mean 0.32 ms, p99 1.87.

With the knob off, a Floor is byte for byte 7d's, and the golden pins prove it. So nothing measured before Task 1 would add anything. The budgets that decide pass or fail are absolute: an 800 ms build mean, a 2 s cap, and a 300 ms navmesh mean.

**The flow** (the user's call: no wasted time or tokens):
- **Run only the test files a task touches** (`npx vitest run <files>`) while working. Run the whole fast suite (`npm test`) once, at the end of Task 5. Never run a `*.slow.test.ts` before Task 5.
- **Tune the rate with a plan-only probe**, not the slow test. A scratch script (not committed) calls `planFloor` over the 500 pairs; at about 2 ms a plan, that is about a second. It prints §4's shares and drops. Iterate `percent` and `weights` on it. Run `delverGen.slow.test.ts` once, alone, when the values are settled.
- **Test in the Map Editor, never by playing a Run** ("Testing the generator" above; the user's call). No playtest is part of 7f: unlike 7d, there is no `autopilot` Run through Floors 1 to 9. Every visual and AI check is done in the editor:
  - **Look at a set piece**: `npm run dev`, then open `/sword/#/mapeditor?dev=1&delverSeed=S&delverFloor=F&delverPiece=spiral` (or `cross`, `uphill`). The same works from File, Delver seed and floor, then the Set piece choice. The checks folder lists the set pieces and the map's problems.
  - **Check the AI on it**: add `&aiwalk=1` (or press Walk the AI), and switch on AI navmesh and AI routes. On a Spiral, look at the jump Links up to R1 and L1 and at the routes round the ledge.
  - **Check many Floors**: `npm run ai-walk -- --seeds 1-50 --floors 1,5,9`. It prints an editor link for each Floor with a problem: open that link rather than reproduce the problem in a Run.
  - Start checking by eye as soon as Task 3 lands, rather than reasoning about geometry from tests alone.
  - The screenshots of the Done list are taken in the editor.
  - A Run is played only if the user asks, to judge how a room feels in a fight.
- **The soak is one new case** (§14), run alone with `-t` on its name. The existing soak cases are not rerun: they never see a set piece, since their Floors are 7d's.
- **Work in one session**, the tasks in order, without a subagent per task. For the review, use `/code-review high` once over the Stage's range, not `max`.
- **Read only what a task needs**. This Design names the files; `plan.ts`'s 7c (3b′, 7b′) and 7d′ blocks are the templates to copy.

**1. The user's layouts, read** (cell = a layout unit, not a metre; rows north to south as drawn, the south door at the bottom):
- **Lava Bridge** (Sheet 1): all lava but a one-cell cross. One arm runs north–south between the north and south doors; the other runs west–east at the middle row between the west and east doors. The crossing is in the middle.
- **Uphill** (Sheet 2): from the south door, 2 rows of Floor, then 7 rows of Ramp the full width of the Hall, then 2 rows of HighFloor up to the north door. The side walls hold no door (the user's call).
- **Spiral** (Sheet 3), from the south door's floor, counter-clockwise seen from above:
  - Floor0 is the big floor: the south door, the whole south half, and the west wall's lower half.
  - The first ramp runs along the east wall to Floor1, the east door's landing.
  - A ramp continues to Floor2, the NE corner.
  - Along the north wall to Floor3, the north door's landing.
  - On to Floor4, the NW corner.
  - Down the west wall to Floor5, the west door's landing, where the ledge ends.
  - The ledge is one cell wide and its inner edge is open (no rail): a Fighter can be knocked off it onto Floor0.

**2. The words.**
- A Hall's **set piece** is one of `cross` (the Lava Bridge), `uphill` and `spiral`.
- The Lava Bridge is a fourth **lava** kind (`DelverLava`, Stage 7d), so the source, drops, revives, render, lights, maps and the AI's lava handling all read it with no new code path.
- The Uphill and the Spiral are two new **vertical features** (`DelverFeature`, Stage 7c), so the one-feature rule, `hallBase`, `lift`, `raised`, `inRange` and the skips of daises, lava, shapes and pillars cover them.
- A Spiral's **ledge** is its landings and ramps. Its **well** is the Hall's floor that the ledge does not cover (Floor0).

**3. Tuning Data** (`data/delver.json`, `src/tuning/delver.ts`, `delver.floor`), shipped at the switch (Task 5); Tasks 1 to 4 ship `percent` [0, 0, 0]:
```json
"setPieces": { "percent": [15, 20, 25], "weights": { "cross": 1, "uphill": 1, "spiral": 1 } }
```
- `percent`: per Run tier (`tierOf`; the last entry for any deeper tier), the chance (in 100) that a Hall is rolled for a set piece. These are starting estimates; Task 5 tunes them (§4, the rate).
- `weights`: whole numbers, each at least 0, summing to at least 1, with exactly the keys `cross`, `uphill`, `spiral`, picked in that order with `byWeight`.
- **Parse checks**:
  - `percent` is a non-empty list of whole percents;
  - `weights` as above, with exactly that key set;
  - when `percent` has an entry > 0 and `weights.spiral > 0`, `levels.max ≥ 3`;
  - when `percent` has an entry > 0 and `weights.uphill > 0`, `levels.max ≥ 1`.
- **`noSetPieces(tuning)`** (tests only, `flat.testdata.ts`): `setPieces.percent` [0]. `flatHalls` and `noLava` apply it, so every existing knobs-off helper keeps its pins.
- **`setPieces7f(tuning)`** (Tasks 1 to 4 only; removed in Task 5): the shipped values above.
- **`onlySetPiece(tuning, kind)`** (tests and the editor, §9): `percent` [100], and that kind's weight 1 with the others 0.
- `tuning.test.ts`'s `goodRaw()` and `src/tuning/delver.test.ts` gain the key and its checks.

**4. The pick** (`plan.ts`):
- **New `SALT` keys** go after 77, so no existing pick moves: setPiece 78, setPieceKind 79, uphillAxis 80, uphillEnd 81, spiralBase 82, spiralTurn 83.
- **One roll a Hall.** With `p = setPieces.percent[min(tier, length) − 1]`, Hall h is **rolled** when `p > 0` and `pick(h, setPiece, 100) < p`. Its kind is then `byWeight(h, setPieceKind, [cross, uphill, spiral])`.
- **Step 3a′ (new, after 3's growth and before 3b's galleries).** Each rolled Hall, in index order:
  - If it is great, an `uphill` or `spiral` roll leaves it plain. The two features need side-centre doorways, and a great hall's long-side slots are not.
  - If its kind fits (§5, §6, tested on the rect as it stands; a Boss Hall's growth only enlarges it), its feature is set in `feat[h]`, as 3b′'s are.
  - A `cross` roll only **reserves** the Hall. Its fit is tested at step 7d″, once the kinds, the loops and the final rects are known.
  - A reserved Hall, or one with an uphill or spiral, is skipped by:
    - 3b's galleries;
    - 3b′'s splits and pits;
    - 7c′'s daises;
    - 7d′'s lava, unless it is the reserved Hall's own Lava Bridge;
    - 7c's shapes and pillars.

  A kind that does not fit leaves the Hall plain, and no other kind is tried (7b's rule).
- **3c. Levels** use the new lifts (§5, §6) through `lift`, `raised` and `inRange`. When a feature's range fails, `unwrap` drops it as it drops a split's, and the drop is counted.
- **4. Loops**: `loopOk` also refuses a slot on an Uphill's side wall (`uphillSide(h, d)`). Door levels and the forced-flat rule come through `doorLevel` and `raised`, unchanged.
- **7. Kinds**: the Entrance's pool, each Rest's pool and the Treasure's pool each drop the Halls with an uphill or a spiral (`setHall(h)`), but only when what is left is not empty. When it would be empty the pick is made as now, and the Hall keeps its set piece (counted; expected 0 in the 500 pairs). With no set piece, every filter is a no-op.
- **7b′**: the Uphill's and the Spiral's geometry, cut from the Hall's final rect as a split's is (§5, §6).
- **7d″ (new, after 7c′'s daises and before 7d′'s lava)**: each reserved Hall, in index order, takes a Lava Bridge when it fits (§7). Otherwise it stays plain: no lava is tried for it, but shapes and pillars may be.
- **The rate** (Task 5): over the 500 pairs, print per tier and per kind the share of all Halls holding a set piece, and the dropped rolls by reason (great, size, door walls, kind, range). Task 5 moves each `percent` entry in steps of 5 until the share of all Halls with a set piece is within 7 to 13 % on every tier. It records the values. When a kind is under 20 % of the set pieces, its weight is raised.

**5. The Uphill** (`DelverUphill`):
```ts
export interface DelverUphill {
  kind: 'uphill';
  axis: 'x' | 'z';
  up: Side; /* the high end's wall */
  rise: 1 | 2; /* levels */
  low: Rect;
  ramp: DelverStep;
  high: Rect;
}
```
- **Constants**: `UPHILL_FOOT = 6` (the low landing's depth: a doorway lane, `DOOR_LANE`) and `UPHILL_TOP = 10` (the high landing's depth; the centre stands in its middle, 5 m from the wall and the ramp's top).
- **Fit**, on axis k, with half the Hall's half size along k:
  - the ramp is `2·half − UPHILL_FOOT − UPHILL_TOP` long and must be at least `rise · LEVEL_RISE / MAX_SLOPE`. `rise` is 2 when that holds for 2, else 1; with neither, axis k does not fit. So a half of at least 10 is needed for 1 level and 12 for 2;
  - **every tree Passage of the Hall leaves by an end wall of k** (the walls across k). None leaves by a side wall.
  - With both axes fitting, k is `[x, z][pick(h, uphillAxis, 2)]`. `up` is the low-coordinate or high-coordinate end wall by `pick(h, uphillEnd, 2)` (0: s or w; 1: n or e).
- **Heights**: the Hall's `level` and `y` are the high landing's, like a split's main tier.
  - The Enclosure stands at `y − rise · LEVEL_RISE` (`hallBase`), and the low landing is its floor.
  - The high landing is a Platform with its top at `y`.
  - The ramp is a full-width Ramp from `lo = hallBase` to `hi = y`, rising toward `up`, with no rails: both long sides lie against the Hall's walls.
  - `top = y + 4`, as a split's, so the low landing has `4 + 2·rise` m of headroom.
- **Doors**:
  - `lift` is 0 on the `up` wall and `−rise` on the opposite wall;
  - the `up` wall is raised (its Passage is flat and cuts the door), so `doors` lists only the low end's wall;
  - `inRange` requires `rise ≤ level ≤ levels.max`;
  - the side walls hold no slot: the tree fit, plus `loopOk`.
- **The centre** moves to the middle of the high landing: `(cx, z1 − UPHILL_TOP / 2)` for `up` n, and the turns of that for the other walls. It is set on the work Hall before 7c and step 9, as the ring's is. Every centre marker (posts, the Boss, the Stairs zone, patrol points) then stands on the high landing: the defenders hold the high ground.
- There is no open edge anywhere: the ramp is full width and meets both landings flush.
- Every edge lands on an odd metre: the walls are odd, and 6, 10 and the ramp's length are even.

**6. The Spiral** (`DelverSpiral`):
```ts
export interface DelverSpiral {
  kind: 'spiral';
  base: Side; /* the wall of the well's door */
  turn: 0 | 1; /* 0: counter-clockwise from above (s → e → n → w for base s); 1: clockwise */
  landings: readonly DelverTier[]; /* 5, in climbing order: wall 2's door, corner, wall 3's door, corner, wall 4's door */
  ramps: readonly DelverStep[]; /* 5, in climbing order, each before its landing */
  well: readonly Rect[]; /* floorRects(rect, the ledge's footprints) */
}
```
- **Constants**:
  - `LEDGE_WIDE = 4`, the ledge's width (at least a Formation's file, `BRIDGE_MIN`);
  - `SPIRAL_FOOT = 4`, the well floor between the base wall and the first ramp's foot, which is where the first ramp is entered from;
  - `LANDING_HALF`: a door landing's span along its wall is `[oddDown(m − 2), oddUp(m + 2)]`, with m the wall's centre. That is the doorway and 0.5 m each side, 7d's door-bridge span, 4 or 6 m long.
- **The walls in climbing order**:
  1. `base` (the well's door, lift 0);
  2. the next wall in the turn (lift +1);
  3. the one after (+2);
  4. the last (+3), whose ledge runs only from its corner to its door landing.

  The rest of wall 4, and all of the base wall, face the well.
- **Geometry** for base s and turn 0; the other cases are turns and mirrors of it:
  - **R1** runs along wall e (strip `x ∈ [x1 − 4, x1]`) from `z0 + SPIRAL_FOOT` to the start of landing **L1** (wall e's door span). It rises from 0 to +2 m. Then L1 at +2 m.
  - **R2** runs from L1's end to the NE corner square **L2** (`[x1 − 4, x1] × [z1 − 4, z1]`). It rises from +2 to +3 m.
  - **R3** runs along wall n (strip `z ∈ [z1 − 4, z1]`) from L2 to **L3** (wall n's door span) at +4 m.
  - **R4** runs from L3 to the NW corner **L4** at +5 m.
  - **R5** runs along wall w from L4 down to **L5** (wall w's door span) at +6 m. The ledge ends at L5's far edge.
  - Each ramp's `rails` hold only its long side against the Hall wall, and its inner long side is **open**. Each landing is a Platform; each ramp a Ramp solid underneath (§8). `lo` and `hi` are as above, relative to `y`.
- **Fit**: both halves are at least 9, and every ramp is at least its rise / `MAX_SLOPE` long. R1 rises 2 m, so it needs 4 m, which wants a half of at least 11 along wall 2. The others rise 1 m and need 2 m each. Then:
  - `base = [n, e, s, w][pick(h, spiralBase, 4)]`, and the next three in turn, tried in order: the first base that fits is taken;
  - `turn = pick(h, spiralTurn, 2)`;
  - tree Passages may leave by any wall.
- **Heights**: `level` and `y` are the well's, and `hallBase` is `y`.
  - `lift` is 0, 1, 2 and 3 on walls 1 to 4.
  - Walls 2 to 4 are raised (their Passages are flat and cut the door at the landing's height), so `doors` lists only the base wall.
  - `inRange` requires `level + 3 ≤ levels.max`. With the shipped max 4, the well is on level 0 or 1.
  - `top = y + 3 · LEVEL_RISE + 4` (10 m: 4 m of headroom over L5, and a door 6 m up fits its 4 m Passage storey).
- **The centre** stays at the rect's centre: with halves of at least 9, it keeps at least 5 m from the ledge, more than `CENTRE_CLEAR`.
- **Falls**: a body knocked off the ledge falls up to 6 m onto the well: the fall damage is the threat (the user's call: open, no rail).
  - Soldiers never drop more than `levels.drop` (3 m), so the Crowd takes only R1's low end and L1 down, and walks the ramps otherwise.
  - The `shortcuts` flag is already set for any Floor with a feature. The navmesh adds Jump shortcut Links from the well up onto R1 and L1, where the rise is at most `JUMP_SHORTCUT_CAP`, and none higher.
- Every edge lands on an odd metre: the walls are odd; 4 and the landing spans are even or odd by construction.

**7. The Lava Bridge** (`LavaKind += 'cross'`; `DelverLava` gains `plaza?: Rect`):
- **Fit** at 7d″:
  - the Hall's kind is Fight, Empty, Boss or Stairs; it has no gallery and no feature; it is a rect;
  - both halves are at least `CROSS_HALF = 11` (the plaza's 6, then at least 4 m of lava past it, odd-snapped);
  - every held slot's door span (`[oddDown(ℓ − 2), oddUp(ℓ + 2)]` along its wall) lies within the plaza's span on that axis. Side-centre slots always do; a great hall's long-side slots do only when they are near enough the middle, else the Hall does not fit.
- **Geometry**:
  - The **plaza** is `[oddDown(cx − LAVA_CENTRE), oddUp(cx + LAVA_CENTRE)] × [same for z]`. It is 7d's dry centre square, odd-snapped, 12 to 14 m a side (larger than the 8 × 8 first proposed, since it must hold 7d's centre rule). The Warband, the Stairs zone and the Boss stand on it.
  - **An arm for each held slot** (the user's call: no arm to a wall with no door). It spans the door span across, and runs from the wall to the plaza's edge. These are the `bridges`, ascending z then x. With 2 doors on opposite walls the result is a straight bridge, with 3 a T, with 4 the user's cross, and with 2 on adjacent walls an L. A leaf Hall gets a peninsula.
  - **The lava** is `floorRects(rect, [plaza, ...arms])`, sorted z then x. A piece thinner than `LAVA_MIN` on either axis becomes floor, which widens its arm. With no lava left, the Hall does not fit.
  - `walls` are the arms' walls in n, e, s, w order, and `y` is the Hall's `y − LAVA_DEPTH`.
- Everything else is 7d's: the Hole and Hazard Brushes, `lavaDry`, drop spots, the Resurrection Stone, the render, the lights, the maps, `edgeKeep`. Arms are 4 m (6 m at an even slot line), as 7d's door bridges are, so a Formation files over them.

**8. The source and the compiler** (`source.ts`, `compile.ts`):
- **Uphill**: `<hall>-high` (a Platform, top `y`) and `<hall>-ramp0` (a Ramp, no rails).
- **Spiral**: `<hall>-landing<n>` (Platforms) and `<hall>-ramp<n>` (Ramps), in climbing order.
- Both are written where the 7c features are written, with ids from exported `landingId` and `rampId`. Each landing's `y` goes into `levels`.
- **Cross**: as 7d's lava (`hole<n>`, `lava<n>`).
- **Compiler checks (Task 1, hand-built maps first, as 7c's Task 1)**:
  - (a) **A Ramp whose `lo` is above its Enclosure's floor** (R2 to R5) must be solid down to that floor, as a Platform is: no void under it, and face Walls on its open side. If it is not, either give Ramp Brushes a solid base, or write a Platform under each such Ramp at its `lo` height; Task 1 picks the smaller change and records it.
  - (b) **7c found that every Ramp inside an Enclosure is walled to the roof on its open long sides.** That would wall a Spiral's inner edge to the ceiling, so it must change for a Spiral. Add an optional `open: Side[]` to `RampBrush`: an open side gets only the face Wall from the lower floor up to the Ramp's surface, never one to the roof. Parse rule: `open` is a long side and no `rails` side. Absent, the side compiles exactly as now, so no existing map's bytes move. The Spiral's ramps set `open` to their inner side.
  - (c) `walkCheck` passes on a hand-built Uphill and Spiral. A Fighter knocked off L5 lands in the well. Jump Links go up onto R1 and L1 only.
  - **Amended 2026-11-24 (Task 1), on hand-built maps in `enclosure.test.ts`**:
    - (a) needs no compiler change. **Each landing but L5 is written as a Platform over its own rect and the next ramp's** (the union is a rect: the ramp continues the landing's strip at its width). Its top is that ramp's `lo`, so it cuts the Hall floor under the ramp, and the ramp cuts its top in turn: solid underneath, no warning, no extra Brush. The plan's landing rects stay the landings themselves; only the source widens them.
    - (b) is not needed: the claim from 7c does not hold since issue #157. A Ramp's long side with no rail already compiles to a skirt stepped up to its slope where the floor beside is lower (each step's top at the slope's height at its high end), and the Enclosure's roof is no floor beside a Ramp. So the Spiral's inner edge is open as it stands, and `RampBrush.open` is not added (nor its parse test).
    - (c) holds, with one correction: the shortcut jump Links from the well land on R1, L1 and **the foot of R2** (2.34 m, within `JUMP_SHORTCUT_CAP`), and none higher. §13's "no navmesh jump Link lands above L1" reads "none lands on R2 past its foot, or on L2 to L5".

**Amended 2026-11-24 (Task 2), from the code:**
- **Types**: every feature keeps its Ramps in `steps`, as 7c's do, so the clutter, the source and the judge read them with no new path. So `DelverUphill` is `{ kind, axis, up, rise, low, high, steps: [the Ramp] }` and `DelverSpiral` is `{ kind, base, turn, landings, steps: [R1 to R5], well }`. A Spiral landing's `level` is `y / LEVEL_RISE` (a half for a corner). The source names the Ramps `<hall>-step<n>` (`stepId`), the Uphill's high landing `<hall>-high` (`highId`) and a Spiral's landings `<hall>-landing<n>` (`landingId`).
- **Roofs**: a split's roof is in fact `y + HALL_STOREY` (6 m), not `y + 4`. So an Uphill's `top` is `y + HALL_STOREY`, as a split's, and a Spiral's is `y + 3 · LEVEL_RISE + HALL_STOREY` (12 m over the well, 6 m over L5): every top floor keeps a full Jump's headroom, as issue #163 asked.
- **Frames**: the Uphill and the Spiral are cut by `uphillGeometry` and `spiralGeometry` (exported, pure), written for base s and turn 0, then turned and mirrored into the world (`frameOf`), which keeps whole and odd metres. `spiralOrder(base, turn)` gives the walls in climbing order. An Uphill's frame is its low wall's.
- **The drop counts** come out of `planFloor` through an optional last argument, `drops: SetPieceDrops` (`great`, `size`, `doorWalls`, `kind`, `range`, `fallback`). It is never part of the plan.
- **No Uphill or Spiral on a Boss Hall**: under the shipped Tuning a Boss Floor's Boss Hall is always a great hall (`great.count[0]` ≥ 1). So §13's and the slow test's "each kind on a Boss Hall" holds for the Lava Bridge only; the Uphill and the Spiral must show on a Stairs Hall.
- **The fallback is not 0**: tier 1's Floors have 7 Halls and often a single leaf, so the Entrance's pool can be only an Uphill (23 in the 1800 Floors of `plan.test.ts`, on the 7f values). The Hall keeps its set piece, as §4 says. The judge counts these rather than failing them (§10), and the slow test reports the count instead of expecting 0.
- **A probe before tuning** (attempt 0, the 500 pairs, `percent` [15, 20, 25]): set pieces on 2.3 %, 2.4 % and 4.8 % of the Halls by tier. Most rolls drop for size (Halls under the least halves), so Task 5's `percent` will be well above the first estimates.

**Amended 2026-11-24 (Task 5, the switch):**
- **The rate**: on the plan-only probe (attempt 0, the 500 pairs) `percent` [40, 45, 35] gave 6.9 / 6.6 / 6.6 %, [55, 55, 40] 9.3 / 8.3 / 7.6 %, and **[60, 60, 50] 10.2 / 8.9 / 9.1 %**, which ships. Every kind is at least 21 % of the set pieces on every tier (crosses 21.7 / 29.5 / 24.4 %), so the weights stay 1, 1, 1.
- **What the set pieces take from 7c and 7d**: picked first, a set-piece Hall (and a Hall reserved for a Lava Bridge that did not fit) takes no other feature and no 7d lava. So the shipped Floors hold fewer of both: Halls with a split, pit or dais fall from 23.9 % to 15.3 % (22.3 % counting the Uphills and Spirals), and the Halls that may hold 7d lava which do from 16.2 / 25.2 / 33.6 % to 13.7 / 20.2 / 25.9 % by tier. The slow test now checks 7c's and 7d's shares on the same pairs planned with set pieces off (what their knobs control) and prints the shipped ones. **Raising `features.percent` or `lava.percent` to win them back is the user's call**; nothing was retuned.
- **The existing soak cases** play `loadTuningData()`, so from this switch they meet set pieces. They were not rerun (the Design's flow), so their Floors are no longer 7d's.

**Result (2026-11-24, Tasks 6 and 7):**
- **The AI check** (Task 6): `npm run ai-walk -- --seeds 1-50 --floors 1,5,9` on the shipped data, run as four shards of seeds (1–13, 14–26, 27–39, 40–50) at once: 150 Floors, 0 with problems, 2,629 legs arrived. §11's fix was not needed, so it was not made, and the `--difficulty Beginner` run was skipped (no ally fault was found).
- **The soak** (Task 7, `warbandSoak.slow.test.ts -t "set-piece Floors"`, run alone, 74 s). The Floors were found by a plan scan of the Runs `gen:greybox:<n>`, Floors 1 to 9, in seed order, the first two of each kind on the main path. Uphill: a Hall gone through by both end walls. Lava Bridge: a Fight Hall. Spiral: the main path uses wall 4's door (L5). The Floors are Run 2 Floors 5 and 8 (Uphills in hall2 and hall18), Run 1 Floors 1 and 4 (crosses in hall2) and Run 3 Floor 6 and Run 4 Floor 5 (Spirals in hall1, with base w and s, turn 0). All 6 reached their Stairs, in 141 to 502 s.
  - The party's Fighter-Ticks: 1,016 on an Uphill's Ramp, 9,935 on a Lava Bridge's arm and 510 on a Spiral's L5.
  - 0 falls off a Spiral's ledge. 63 Pickups and 0 revives, none on a ledge's edge or on lava or within 2.5 m of it. 0 Deaths by Lava.
  - **No fight on a plaza**: 0 Hits on a plaza, 44 on an arm. On both cross Floors the Warband comes out to meet the party, and the fight is on the arm 1–2 m short of the plaza. **By the user's call the plaza fight is a measurement, not a must-show.**
  - **Tick**: mean 0.52 ms, p99 2.73 over 117,009 Ticks. 7d's 0.32 and 1.87 are the 5-Run soak on one-tier Floors, so they are not like for like: these Floors are tier 1 to 3 on the full Tuning, with set pieces and 7d lava. Nothing was tuned for it.
- **The review** (`/code-review high` over `fa4e9a8..HEAD` and the soak case): 4 findings, all in the soak's new watcher, all fixed.
  - The plaza must-show is above.
  - A walk down a Spiral (L2 to the well in under 3 s) would have counted as a walked-off fall. The watcher now keeps the last ledge Tick at any height, and counts a fall only from `levels.drop` or more over the well.
  - The ledge-edge check ignored height, so a drop on the well floor beside R1 counted. It now asks for `levels.drop` over the well.
  - The Tick line now labels 7d's numbers as not like for like.
  - Nothing was found in the plan, the source, the judge or the editor.
- The existing soak cases and `npm test` were not rerun: only the slow soak file changed after Task 5's `npm test`.

**9. The Map Editor** (the user's test loop, "Testing the generator"): the Delver seed and floor dialog gains a **Set piece** choice (off, cross, uphill, spiral). The URL form is `&delverPiece=spiral`. It opens the Floor on `onlySetPiece(tuning, kind)`, editor only, never in a Run. So the user can open a Floor with many of one set piece and walk the AI on it (`&aiwalk=1`). The checks folder lists them under "Set pieces" (Hall id, kind, rise or base and turn, arms).

**10. The judge** (`judge.ts`):
- **New plan rule `setPieces`** (after `lava`). It fails with one line each:
  - an uphill or spiral on a great hall, or on an Entrance, Rest or Treasure Hall while another Hall could have taken that kind. This is counted, not failed, when §4's fallback took it;
  - an Uphill:
    - a slot on a side wall;
    - a ramp steeper than `MAX_SLOPE`;
    - the landings not `UPHILL_FOOT` and `UPHILL_TOP` deep;
    - the centre not in the high landing's middle;
    - a door not at its end's height;
  - a Spiral:
    - 5 landings and 5 ramps that do not chain (each ramp's `lo` the previous floor and its `hi` its landing, along its wall, `LEDGE_WIDE` wide, no steeper than `MAX_SLOPE`);
    - a door not inside its wall's landing span or not at its height;
    - a marker within 2 m of the ledge's footprint, which would put its cell centre under the ledge (7c's dais lesson);
  - a cross:
    - a held slot's doorway ± 0.5 m not inside an arm;
    - an arm under `BRIDGE_MIN`, or not running from its wall to the plaza;
    - the plaza not holding the centre square;
    - plus 7d's marker, keep and Warband-home rules, which already run on every lava kind.

  Every edge must land on an odd metre.
- **New built rule `setPieceWalk`** (after `lavaWalk`):
  - the field toward the Hall's centre reads ≥ 0 at 1 m inside each held doorway (at its door's height), at each landing's centre and at the middle of each arm;
  - at each Spiral ramp's inner edge, no Wall rises more than a step above the ramp's surface (the open edge compiled);
  - under each cross arm the ground is floor, and beside it lava.
- **A failed rule rerolls the Floor.** The pick only makes what fits, so the target is 0 rerolls.
- **`describeFloor`** adds `, s set pieces (c crosses, u uphills, p spirals)`.
- **Amended 2026-11-24 (Task 4)**:
  - The Entrance and Treasure parts of "while another Hall could have taken that kind" are judged exactly (another leaf that is not great with no Uphill or Spiral; another Fight or Empty Hall off the main path with none). A Rest's pool is not rebuilt by the judge (its second pick depends on the first), so an Uphill or Spiral on a Rest is counted by the slow test, never failed.
  - A door's height and a Lava Bridge doorway's lane were already judged by 7c's `features` rule (through `floorAt`, which now knows both new features) and 7d's `lava` rule (a cross's lanes are taken as a river's bank lanes: each doorway ± 0.5 m on an arm). `setPieces` adds the arm's own check all the same.
  - 7c's `features` and `tiers` rules skip an Uphill and a Spiral, which `setPieces` and `setPieceWalk` judge instead.
  - `describeFloor`'s lava count leaves out the crosses, which it counts as set pieces.

**11. The AI and the Crowd.** Nothing changes up front:
- the Lava Bridge is 7d's lava, which the AI already handles;
- an Uphill is a Ramp;
- a Spiral is Ramps and Platforms, which 7c's splits proved for the navmesh, the fields, `floorNear` and `levels.promote`.

Task 6's `ai-walk` and Task 7's soak case are the evidence. If an ally, the pilot or a promoted Soldier walks off a Spiral's open edge with nothing pushing it (7d's classification, by Fall), Task 6 finds the cause and fixes it, with a scenario test of its own. `edgeKeep` today runs on lava Arenas only; extending it to tall open ledges is the likely place.

**12. Existing tests this sub-stage rewrites** (only these):
- `golden.test.ts`: new `NO_SET_PIECE_PINS` and `NO_SET_PIECE_TIER_PINS` tables on `noSetPieces(tuning)`. Their hashes and attempts are **exactly today's `PINS` and `TIER_PINS`** (Task 1 adds them). At the switch (Task 5) `PINS` and `TIER_PINS` are rewritten, and `HOLDS` records each pin's set piece.
- `tuning.test.ts` and `src/tuning/delver.test.ts`: the key (Task 1) and the shipped values (Task 5).
- `delverGen.slow.test.ts` (Task 5): the counts and must-shows (§13). The budget stays Stage 7c's: an 800 ms build mean, a 2 s cap, a 300 ms navmesh mean. If the set pieces need more, ask the user first.
- Any other Delver test that fails only because its Floor's Halls changed at the switch runs on `noSetPieces(tuning)`, composed with what it already used, with its expectations unchanged. Task 5 lists each one. A test that still fails on `noSetPieces` is a bug to report.
- No test is removed.

**13. Tests to add**:
- **Task 1**: the compiler cases of §8 in `enclosure.test.ts` and `nav.test.ts`, and the `RampBrush.open` parse in `source.test.ts` (mapEditor).
- **Task 2** (`plan.test.ts` on `setPieces7f`, 200 seeds × Floors 1 to 9, with the tier passed):
  - every rule of §5 to §7;
  - set pieces only on the allowed Halls;
  - no other feature on a set-piece Hall;
  - across the 200: each kind on a Boss and a Stairs Hall, a 2-level Uphill, a cross with 4 arms, a T and a straight one, a cross in a great hall, and a Spiral with each base and both turns.

  On `noSetPieces` the plan equals today's (`JSON.stringify`), and a changed 7f salt changes nothing. Add hand-cut cases of each kind at its smallest and its largest Hall.
- **Task 3** (`source.test.ts`):
  - the Brushes, ids, heights and order, and `levels`;
  - each kind compiles and passes `walkCheck`;
  - a Soldier `trace` up an Uphill and round a Spiral is allowed, and one off L5 is refused (6 m > `levels.drop`);
  - no navmesh jump Link lands above L1.

  On `noSetPieces` the source equals today's.
- **Task 4** (`judge.test.ts`):
  - set-piece Floors pass first try;
  - `setPieces` fires on a moved arm, a side-wall slot on an Uphill, a ramp made too steep, a marker under the ledge, and a Spiral on an Entrance with another leaf free;
  - `setPieceWalk` fires on a Spiral ramp given a Wall to the roof, and on an arm's Hole widened over it;
  - `describeFloor`'s counts.
- **`delverGen.slow.test.ts`** (Task 5, 500 pairs):
  - per tier and kind: set pieces against all Halls, and dropped rolls by reason;
  - Uphills by rise; Spirals by well level; crosses by arm count, with great-hall crosses;
  - the §4 fallback count (expected 0), rerolls by rule, the budgets, and failed attempts at most 1 in 20 pairs.

  **It must show, else fail**: each kind on every tier, a 2-level Uphill, a 4-arm cross, a great-hall cross, and each Spiral base, with the shares in range.

**14. The soak** (Task 7: one new case in `warbandSoak.slow.test.ts`, run alone with `-t`; the immortal party). The existing cases are not rerun.
- **Floors**: the first 6 Floors in seed order that hold each kind, 2 a kind, found with the plan-only probe and listed in the test. They are played on the shipped Tuning (not `onlySetPiece`), so each Floor is a real one. The case prints its Tick mean and p99 against 7d's 0.32 and 1.87.
- **Must show, else fail**:
  - the party walking each kind: a party Fighter's feet on an Uphill's ramp, on a cross's arm, and on a Spiral's L5;
  - a fight on a cross's plaza;
  - 0 walked-off Falls from a Spiral by an ally, the pilot or a promoted Soldier;
  - 0 Pickups or revives on a ledge's edge or on lava.
- Also, `npm run ai-walk -- --seeds 1-50 --floors 1,5,9` exits 0. It runs before the soak case: it is cheaper and finds most ledge faults. A run with `--difficulty Beginner` is needed only if an ally fault is found and fixed.

**Tasks**, one after another:
1. **The compiler**: §8 (`src/mapEditor/source.ts`, `compile.ts`, `checks.ts` if needed, and their tests). Hand-built maps only.
2. **The plan and its Tuning**: `data/delver.json` (`percent` [0, 0, 0]), `src/tuning/delver.ts` and its tests, `plan.ts` (§4 to §7), `flat.testdata.ts`, `plan.test.ts`, and `golden.test.ts` (the `NO_SET_PIECE` tables only).
3. **The source and the editor**: `source.ts` and its tests, then §9's `delverPiece` (`src/mapEditor/`). This is moved up from last, so every later task can be checked by eye. Take one screenshot of each set piece here, shown to the user and not committed. Fix any geometry they show before the judge is written.
4. **The judge**: `judge.ts`, `generate.ts` (`describeFloor`), `judge.test.ts`.
5. **The switch**: tune the values with the plan-only probe, then `version.ts` (15), the golden pins, `delverGen.slow.test.ts` (run once, alone), `setPieces7f` removed, the moved tests (listed), and `npm test` once.
6. **The AI check**: `npm run ai-walk` (§14). Make §11's fix only on that evidence; otherwise record that it was skipped and why.
7. **The soak case**: §14's one case. Then `/code-review high` over the Stage, and the Result.

### Stage 7g: drawn rooms
**Model**: Opus (the room format, the plan's placement and the editor's room mode), then Sonnet for the tests and the checks. Asked for by the user on 2026-11-24, after 7f: new special rooms should be drawn by the user in the Map Editor, not designed as code. The user's calls of that day:
- a room is drawn **1:1**: never scaled; the Hall takes the room's size;
- doorways stand **only at a wall's centre**, as every Hall's do today;
- the drawn rooms share **one** set-piece weight, `room`, and are picked evenly within it.

What 7g ships:
- a **room mode** in the Map Editor: the user drags in the room's pieces, marks its doorways and centre, presses **Check room** (seconds, this room only) and **Save**;
- a **room file** per room, `data/delver/rooms/<name>.json`;
- a **fourth set-piece kind**, `room`, which places a drawn room in a Hall that can take it.

Once 7g is in, **adding a room is data only**: draw, Check room, Save, commit. No code, no version bump, no golden pin to retake (§9).

- **Done**:
  - a room drawn in the editor, checked, saved, and seen in a generated Floor (`&delverPiece=room&delverRoom=<name>`);
  - the fixture room's tests (§10);
  - `npm run ai-walk -- --seeds 1-20 --floors 1,5,9 --piece room` clean;
  - a screenshot of the room mode and of a placed room.

#### Design
Written 2026-11-24 on base commit `11a4378` (7f done). Battles, Duels and every Floor with no drawn room are unchanged. **No new hashed state**: a room is Tuning Data, so the plan and the Map Source are rebuilt from (Run seed, Floor) on every peer, as 7a to 7f. `DELVER_VERSION` 15 → 16 (the engine). A new room file changes the Tuning Data hash by itself, so it needs no version bump. **With no room file, or `weights.room` 0**, no room is picked, and a Floor's plan, source and map are byte for byte 7f's.

**The flow** (the user's calls for 7f hold):
- Test in the Map Editor and with the AI check, never by playing a Run ("Testing the generator").
- Run only the test files a task touches. Run `npm test` once, at the end.
- No `*.slow.test.ts` is rerun. No soak case is added: Check room (§5) and `ai-walk` are the evidence.
- Work in one session, the tasks in order. Review once with `/code-review high` over the Stage.
- Where the code proves a rule here wrong, amend this Design in place with the date and the reason.

**1. The words.**
- A **drawn room** (a *room*) is a special room the user draws in the Map Editor's room mode and saves as a room file.
- The **room frame** is its own coordinates: its centre at (0, 0), north +z, its floor (the doorway level 0) at y 0.
- A room is placed in one of 8 **frames**: 4 quarter turns, each optionally mirrored. Turns and mirrors keep whole metres and the walls' parity, as `frameOf` does for 7f.
- Like the Uphill and the Spiral, a room is a **vertical feature** (`DelverFeature += DelverRoom`). So the one-feature rule, `hallBase`, `lift`, `raised`, `inRange` and the skips of galleries, splits, pits, daises, 7d lava, shapes and pillars all cover it.

**2. The room file** (`data/delver/rooms/<name>.json`; Tuning Data, parsed by `parseRoom` in `src/tuning/delverRooms.ts`, bundled by a glob as `data/battlemaps/` is, and folded into `tuningDataHash`):
```json
{
  "name": "crucible",
  "half": [11, 9],
  "doorways": { "n": 0, "s": 0, "e": 2 },
  "centre": [0, -3],
  "kinds": ["Fight", "Empty", "Stairs"],
  "brushes": [ { "kind": "platform", "id": "p0", "rect": { "x0": -11, "z0": 5, "x1": 11, "z1": 9 }, "top": 2 }, "..." ]
}
```
- `name` is the file's name: letters, digits and `-`.
- `half` is [half-width, half-depth] in whole metres, each within `delver.floor.halfSize` ([7, 14] shipped: rooms 14 to 28 m a side).
  - Great halls are **not** in 7g: their long-side doorways are not at a wall's centre.
- `doorways`: the walls that **may** hold a doorway (at the wall's centre, `passage` wide), each with its floor's height in levels (`LEVEL_RISE`), relative to the room's floor.
  - At least one wall must be listed.
  - Any wall left out is always solid. A listed wall that the Floor does not use is solid too.
- `centre`: the room's centre point (room frame), where every centre marker stands: posts, the Warband home, the Boss, the Stairs zone, patrol points.
- `kinds`: the Hall kinds it may serve, from Fight, Empty, Stairs and Boss. Absent means all four.
  - Never Entrance, Rest or Treasure (7f's rule).
  - Boss works only once a room is great-sized, so in practice not in 7g.
- `brushes`: the pieces, in room-frame metres. They are Map Source Brushes parsed by the Map Editor's own parser (`parseMapSource`'s Brush half):
  - allowed kinds: `platform`, `ramp`, `block`, `rail`, `wall`, `hole` and `hazard` (`hazard: "lava"` only; a lava pool is a Hole with its Hazard under it, as 7d writes them);
  - no `enclosure`, `floor` or `deck`: the generator writes the Hall's Enclosure from `half` and the used doorways.
- **Parse checks**:
  - every Brush lies inside the room's rect;
  - every rect edge, and every Rail or Wall end, is a whole even number of metres from the walls. Then it lands on an odd world metre, off the fields' 2 m dots, in every frame;
  - every height is a whole metre at or above `−LAVA_DEPTH`;
  - each doorway floor is a whole level in 0..3. The floor 1 m inside the doorway must be at that height: the room's floor at 0, or a Platform's `top`;
  - no Ramp is steeper than `MAX_SLOPE`;
  - `centre` is on a floor, at least `CENTRE_CLEAR` from any Block, Hole, lava or edge;
  - the `id`s are unique.

  A room that fails is refused by `loadTuningData` with the file and the reason, as a bad Battle map is.
- A room's **top** is its highest floor (doorway or Platform) plus `HALL_STOREY`, as a Spiral's is.

**3. The Tuning** (`data/delver.json`, `delver.floor.setPieces`):
- `weights` gains `room`, **last** in the pick order: `[cross, uphill, spiral, room]`.
  - With `room` 0, `byWeight` picks exactly as 7f does. Task 1 proves this; if it does not hold, `room` gets its own roll instead and this line is amended.
- Shipped: `room` 0 until the first room file lands. Task 5 sets it to 1 if a room file has shipped by then.
- **Parse check**: `room` > 0 needs at least one room file.
- `noRooms(tuning)` (tests, `flat.testdata.ts`): `weights.room` 0 and no rooms. `noSetPieces` applies it.
- `onlySetPiece(tuning, 'room', name?)`: as 7f's, and with `name`, that room only (the editor and `ai-walk`).

**4. The pick** (`plan.ts`, step 3a′, beside the Uphill and the Spiral):
- **New `SALT` keys** go after 83, so no existing pick moves: `roomPick` 84, `roomFrame` 85.
- When a Hall's set-piece kind is `room`:
  - It is great: it stays plain (counted, `great`).
  - Otherwise, the **candidates** are each (room, frame) pair where:
    - the Hall's kind can be one of the room's `kinds` (the kinds come at step 7, so this filter is applied there, as 7f's Entrance, Rest and Treasure filters are);
    - every tree Passage of the Hall leaves by a wall that is a doorway in that frame;
    - `inRange` holds: `level + max(doorway lifts, Platform tops / LEVEL_RISE) ≤ levels.max`, and `level ≥ 0`.

    With no candidate, the Hall stays plain (counted, `fit`).
  - Among the candidates, the room is `pick(h, roomPick, rooms)`, picked **evenly** among the rooms that have at least one fitting frame (the user's call). Its frame is `pick(h, roomFrame, frames)`, among that room's fitting frames.
  - **The Hall takes the room's size**: its half-width and half-depth become the frame's `half` (swapped on a quarter turn).
    - This happens before any Passage is cut. Task 2 checks in `plan.ts` that the Passages' rects are cut from the final Hall rects. If any is cut earlier, it re-cuts it, and records which.
    - `halfSize` bounds the room, so the lattice gaps (which hold `halfSize[1]`) still fit.
- **4. Loops**: `loopOk` refuses a slot on a wall that is not a doorway in the room's frame.
- **Door heights**: `lift` on each doorway wall is its level. A wall with lift > 0 is `raised` (its Passage is flat and cuts the door at that height), as the Spiral's walls 2 to 4 are.
- The Hall's `level` and `y` are the room's floor. `hallBase` is `y` lowered by the room's deepest Hole (lava or a pit), if it has one.
- **The centre** is set from `centre` (in the frame) on the work Hall before 7c and step 9, as the Uphill's is.
- **Kinds (7)**: the Entrance's, each Rest's and the Treasure's pool drop the Halls with a room (`setHall(h)`), as 7f's do, with the same fallback. A Hall whose final kind is not in its room's `kinds` loses the room and stays plain (counted, `kind`).
- `DelverRoom` is `{ kind: 'room', name, frame, half, steps, lava }`:
  - `steps`: its Ramps as `DelverStep`, so the clutter, the source and the judge read them;
  - `lava`: its lava rects, given to `DelverLava` as a new `LavaKind` `'room'`, so drops, revives, the Resurrection Stone, `edgeKeep`, the render, the lights and the maps cover it with no new path.
- `SetPieceDrops` gains `fit`, and reuses `great` and `kind`.

**5. The Map Editor's room mode** (`src/mapEditor/`; the user's test loop):
- **File → New dungeon room**: a name, a width and a depth (even, 14 to 28 m, from `halfSize`).
  - It opens a source holding the room's Enclosure, **locked**: it cannot be moved, resized or deleted.
  - It also has an abyss field, as the spike Floor has, and a stub Passage 8 m long at each doorway.
  - Levels 0 to 3 (`LEVEL_RISE` apart) are set up.
- **File → Open dungeon room** lists the bundled `data/delver/rooms/*.json`, or takes a file.
- **The Room folder**:
  - per wall, a doorway toggle and its level; the stub Passage follows;
  - the room's `kinds`;
  - the **centre**, a marker dragged like an Objective;
  - the room's size, which can be changed later; Brushes outside the new rect are flagged red.
- **The tools** are the usual ones, limited to the allowed kinds (§2). **Lava** is one tool that writes the Hole and its Hazard together, at `LAVA_DEPTH`.
  - The grid snaps to whole metres and to 2 m steps from the walls, so every edge meets §2's parity.
  - Heights snap to whole metres.
- **Check room** (button, and `&roomcheck=1` on the URL) works on the room alone, as the stub map, in frame 0 and in one turned and mirrored frame:
  1. `parseRoom` (§2's checks);
  2. compile, then `walkCheck`;
  3. the navmesh;
  4. **the AI walk** (`walkAll`, `navWalk.ts`, as `&aiwalk=1` uses):
     - a leg from the centre to 1 m inside each doorway and back;
     - a leg between each pair of doorways;
     - a leg from the centre to the middle of each Platform and each Ramp's top.

  Problems are listed in the Checks folder under "Room", with the AI traces drawn as today. No Floor is generated, so it takes seconds.
  - A Platform no leg reaches is a **warning**, not an error: a ledge may be meant to be reached only by a Jump.
  - A doorway or the centre unreachable is an **error**.
- **Save** writes the room file (`saveJsonFile`), only once Check room has passed on the source as it stands. Otherwise the first problem is shown, as a Battle map's Save does.
- **Try in a Floor**: the Delver dialog's Set piece choice gains `room`, and a Room choice lists the rooms.
  - The URL form is `&delverPiece=room&delverRoom=<name>`.
  - It deals the Floor on `onlySetPiece(tuning, 'room', name)`, editor only.
  - The room being edited is used even if unsaved (it is passed to the Tuning in place of the bundled file).
- `npm run room-check -- <name>` (or `--all`): the same checks from the command line, for an agent. It exits 1 on a problem and prints the editor link (`#/mapeditor?dev=1&room=<name>&roomcheck=1`).

**6. The source** (`source.ts`):
- The Hall's Enclosure, with `top` from §2.
- Then the room's Brushes, turned into its frame and moved to the Hall's centre, with ids `<hall>-<brush id>`.
- Each Platform's `top` and each lava floor go into `levels`.
- The Brushes are written where the 7c features are, so the order is fixed by the Hall index and the room's Brush order.

**7. The judge** (`judge.ts`):
- **New plan rule `rooms`** (after `setPieces`). It fails, one line each, on:
  - the Hall's rect not the frame's size;
  - a held slot on a wall that is not a doorway;
  - a door's height not its doorway's;
  - the centre not at the frame's centre point;
  - a room on a kind outside its `kinds`, or on the Entrance, a Rest or the Treasure (counted, not failed, on 7f's fallback);
  - a Brush outside the rect.
- **New built rule `roomWalk`** (after `setPieceWalk`): the field toward the centre reads ≥ 0 at 1 m inside each held doorway, at its height.
- 7d's marker, keep and Warband-home rules already run on every lava kind, so they run on `'room'` too.
- `describeFloor` adds `r drawn rooms` to its set-piece count.

**8. The AI.** Nothing changes up front: a room is Platforms, Ramps, Blocks and 7d lava, which the AI already handles. Check room and `ai-walk` are the evidence.
- If a fault shows only in rooms (most likely an ally walking off a tall open Platform edge with nothing pushing it), Task 5 fixes it with a scenario test. 7f's §11 note about `edgeKeep` applies.

**9. Pins and tests that a new room must not break**:
- The existing golden pins (`PINS`, `TIER_PINS`) run on `noRooms(shipped)`, and so do the existing Delver tests that use the shipped Tuning. So committing a room file moves no pin.
- The rooms' own pins use a **fixture room** (`src/sim/delver/rooms.testdata.ts`), not the shipped files.
- `src/tuning/delverRooms.test.ts` loads **every** shipped room file and runs `parseRoom` and Check room's checks on each, without the AI walk. That makes a bad room file a fast test failure.
- `delverGen.slow.test.ts` is not changed by 7g.

**10. Tests to add**:
- **Task 1**:
  - `delverRooms.test.ts`: each §2 parse check refused with its reason, and the 8 frames of the fixture keep whole metres and parity;
  - `tuning.test.ts`: the `room` key and its check;
  - with `room` 0, `planFloor` equals 7f's (`JSON.stringify`) over 200 seeds × Floors 1 to 9.
- **Task 2** (`plan.test.ts`, on `onlySetPiece(tuning, 'room')` with the fixture):
  - the Hall takes the frame's size;
  - Passages only on doorway walls, at the doorway's height;
  - the centre is placed;
  - no other feature in the Hall;
  - kinds are respected;
  - each frame is seen over the 200 seeds;
  - on `noRooms`, the plan equals 7f's.
- **Task 3** (`source.test.ts`): the Brushes in each frame, ids and `levels`; the placed room compiles and passes `walkCheck`; on `noRooms`, the source equals 7f's.
- **Task 4** (the editor):
  - `session.test.ts`: the locked Enclosure refuses a move, resize and delete; the Lava tool writes both Brushes;
  - `roomCheck` tests on the fixture, and on a broken copy with a walled-off doorway (an error) and an unreachable Platform (a warning).
- **Task 5** (`judge.test.ts`): `rooms` fires on a moved door, a slot on a solid wall and a wrong door height; `roomWalk` fires on a doorway blocked by a Block; `describeFloor`'s count.

**Amended 2026-11-24 (the tasks), from the code:**
- **Where the rooms live**: `delver.floor.drawnRooms` (the bundled files in file order, read by `loadTuningData` into the raw `delver.floor` and parsed by `parseDelver`), so `planFloor` reads them from its Floor Tuning and the Tuning Data hash folds them in. `parseBrush` (the Map Source's) is exported for `parseRoom`. `SetPieceDrops.fit` is optional, so the slow test is untouched.
- **The room is carried whole in the plan**: `DelverRoom` holds its pieces as the source writes them (`brushes`, world metres, ids `<hall>-<id>`, every height raised by the Hall's `y`, each Block to the Hall's ceiling), and its `doorways` (world sides), `top`, `centre` and `shift`. `floorSource` writes them where the 7c features go, and its pools' Holes and Hazards are among them, so the 7d lava writer skips a `room` lava. The Team 0 front check counts a room's Blocks too.
- **The lattice parity (a gap in §4)**: a Hall's centre is its lattice point, and on a given Floor every column's (row's) point is odd or every one even. A room's walls must land on odd metres, so with the rule as written a room fitted only a quarter to a half of the Floors, whatever its frame (a first look found `crucible` on none of 18). So a room whose wall would land on an even metre is **shifted 1 m** along that axis (west or south first, then the other way), within the cell's limits. Its doorway on a wall along that axis is then 1 m off the wall's centre, on the Passage's line, and the Passage cuts it, as a raised door's does (`raised` holds for that wall; the Hall's `doors` leave it out). `parseRoom` checks a doorway's floor a metre beyond each side of it (`DOOR_SHIFT`), and Check room's second frame is shifted (1, 1). The judge checks every door on its doorway's line (the wall's centre less the shift).
- **The fit** (`roomFits`): the frame's half (and the shift) within the cell's `limX`/`limZ` (which keep `minPassage` to every neighbour; `halfSize[1]` is not always within them, so a 28 m room fits only between 32 m gaps), a doorway on every held wall, the highest doorway level within `levels.max`, and every Passage re-cut against the new rect clear of it by `PASSAGE_CLEAR` (the piece meeting it: touching, at least `MIN_LEG` long). The room Hall's rect is its reach rect from then on, so the loops' clearance sees it.
- **A room dropped at 3c** (out of the level range) gives its Hall back its cell's own rect, centred on its lattice point: kept at the room's (perhaps shifted) rect, the Hall's later shapes and 7d lava were cut off-centre.
- **Kinds**: rather than drop a room whose final kind its file does not name (its doors already stand at its levels, so it could not be dropped there), the kinds are steered: the Stairs (a Boss Floor's Boss Hall) skips a room that may not be one for the next deepest Hall, and a free room that may not be Empty is a Fight (and one that may not be a Fight, Empty). What is left (an in-line Hall that may not be Empty, or no other Stairs) keeps its room and is counted (`kind`); the judge passes it.
- **The centre** stands on the room's floor (y 0): every centre marker is at the Hall's `y`.
- **Lava**: a room's pools keep 7d's rules (none within `LAVA_CENTRE` of the centre, each `LAVA_LANE` from every doorway's lane, widened by `DOOR_SHIFT`). `parseRoom` checks both, so Check room finds them while drawing; the judge's 7d `lava` rule runs on `room` lava as on every kind (its markers, lanes, centre square and Warband homes), only not its plain-Hall rule.
- **Check room's Platform warning**: a Platform nothing walks up to is refused by the compiler's own walk check (Soldiers must reach every Walk Surface) before the AI walks, so it is an **error**, as a walled-off doorway is. The AI walk's leg to a Platform's middle or a Ramp's top is still a warning when it fails.
- **The editor**: the editing stub keeps the room's walls on even metres (its centre at (hw mod 2, hd mod 2)), so the session's snap (`snapStep` 2) is 2 m from the walls; its Blocks stand to a 16 m ceiling (`blockTop`), and the live checks drop the field-dot warnings there (Check room's own stub puts the walls on odd metres). The centre is the stub's Objective D. File → Open room file… opens a room from disk. The judge rule is named `drawnRooms` (`rooms` is the plan's Hall-count rule).
- **`crucible`** (24 x 20 m, the first room): a balcony across the north wall (doorway a level up), a long Ramp up the east wall, a lava pool in the south-west corner, a pillar and a rail along half the balcony's edge; doorways n 1, s 0, w 0. Check room found two faults while it was drawn (a pillar in a doorway's lane, then one on a doorway's centre line, where the AI snags in the turned frame), and the parse found its first pool too near the centre.

**Amended 2026-11-24 (the review, `/code-review high` over `dcf064c..HEAD`):**
- Check room walks **three** frames: 0 as drawn, 5 shifted (1, 1) and 2 shifted (-1, -1), since the generator shifts west or south first.
- `parseRoom` keeps every **Block and Wall out of each doorway's lane** (the doorway, `DOOR_SIDE` and `DOOR_SHIFT` each side, `DOOR_LANE` deep), as 7b keeps pillars out: the AI and Formations snag there.
- Drop spots keep `DROP_MARGIN` off a room's Blocks, as off pillars; the clutter keeps off its Platforms and Blocks.
- The editor: Ctrl+S in room mode is the room's Save; Try in a Floor asks before discarding unsaved edits, and room mode ends only once the Floor has opened; a change to the room's settings keeps it unsaved (the undo history of its Brushes still ends there: the stub is rebuilt); a room file a rule refuses opens as it stands, with the reason, so it can be fixed.

**Tasks**, one after another:
1. **The room file and the Tuning**:
   - `src/tuning/delverRooms.ts` (`parseRoom`, the frames, the glob) and its tests;
   - `delver.ts`'s `room` weight;
   - `flat.testdata.ts`'s `noRooms`;
   - the fixture room.
2. **The plan**: §4, `plan.test.ts`, the golden pins moved onto `noRooms` (their hashes unchanged), and `version.ts` (16).
3. **The source**: §6 and its tests.
4. **The editor**: §5 (room mode, Check room, Save, Try in a Floor, `room-check`).
   - Then the user's first room is drawn in it. The user draws it, or Claude draws the fixture through the session in the console.
   - Take the screenshots, shown to the user and not committed. Fix anything they show before the judge is written.
5. **The judge and the AI check**:
   - §7, `judge.test.ts`;
   - `npm run ai-walk -- --seeds 1-20 --floors 1,5,9 --piece room` (`--piece room` deals on `onlySetPiece(tuning, 'room')` over every shipped room);
   - §8's fix only on that evidence;
   - `weights.room` 1 if a shipped room exists;
   - `npm test` once. Then `/code-review high` over the Stage, and the Result.

**Adding a room after 7g** (the checklist for the user, or for an agent asked to add one):
1. `npm run dev`, open `/sword/#/mapeditor?dev=1`, then File → New dungeon room (or Open dungeon room).
2. Draw it, set the doorways, the kinds and the centre. Tick **Duel map** (`"duel": true` in the file) to offer it as a Duel map too (see "Drawn rooms as Duel maps" below).
3. Check room until it is clean.
4. Save it to `data/delver/rooms/<name>.json`.
5. Optionally, Try in a Floor with `&delverPiece=room&delverRoom=<name>&aiwalk=1`.
6. `npx vitest run src/tuning/delverRooms.test.ts`, then commit the file. For a Duel room, also `npx vitest run src/sim/roomArena.test.ts src/play/lobbyView.test.ts` (add its name to the lists there), and draw its map card on `/sword/#/thumbs/arenas/room-<name>` (dev server), then commit `public/thumbs/arenas/room-<name>.webp`.

No other test, pin or version needs to change.

### Result
Done 2026-11-24. A **drawn room** is a special room drawn 1:1 in the Map Editor's room mode and saved as `data/delver/rooms/<name>.json`; the Floor generator places it whole, in one of 8 frames, in a Hall that takes its size, as a fourth set-piece kind, `room`. Adding a room is now data only (the checklist above). The first room, **`crucible`** (24 x 20 m: a balcony across the north wall with its doorway a level up, a long Ramp up the east wall, a lava pool in the south-west corner, a pillar, a rail along half the balcony), ships with `weights.room` 1. Battles, Duels and every Floor with no drawn room are unchanged: the golden pins run on `noRooms` with their hashes unchanged. No new hashed state; `DELVER_VERSION` 16. What changed from the Design is in its amendments above; the large ones:
- **The lattice parity**: a room whose wall would land on an even metre is shifted 1 m, and its Passage cuts the doorway there. Without it a room fitted a quarter to a half of the Floors.
- **Room lava keeps 7d's rules**, checked when the room is parsed; a Platform nothing walks up to is a Check room **error** (the compiler's walk check), not a warning.
- **Kinds are steered**, not dropped; the judge rule is `drawnRooms`.

**Evidence**:
- **Check room** (`npm run room-check -- --all`): `crucible` clean, 3 frames, 33 of 33 AI legs arrived. While it was drawn, Check room found a pillar in a doorway's lane, then one on a doorway's centre line (the AI stuck on it in the turned frame), and the parse found its first pool too near the centre: three real faults, fixed in the room.
- **The AI check**: `npm run ai-walk -- --seeds 1-20 --floors 1,5,9 --piece room` (four shards at once): 60 Floors, 0 with problems, 886 legs arrived. §8's fix was not needed.
- **The judge**, on the fixture room dealt with `onlySetPiece` (12 seeds x Floors 1, 5, 9): 1 reroll in 36 Floors (a Floor with one Hall level); with `crucible`, 1 in 36 (no Fight Hall). Both are ordinary rerolls.
- **The share** (plan-only, 200 seeds x Floors 1 to 9, shipped data): drawn rooms on 9.6 / 10.8 / 8.7 % of the Halls by tier; the 7f pieces on 1.1 to 3.0 % each. A room fits far more often than a 7f piece (which drops mostly for size), so with one room shipped, about 1 Hall in 10 is `crucible`. **Lowering `weights.room` (or raising the 7f weights) is the user's call**; nothing was tuned.
- **Tests**: new `delverRooms.test.ts` (the parse checks, the 8 frames, every shipped room passing Check room's checks without the AI walk), `roomCheck.test.ts`, and drawn-room cases in `plan.test.ts`, `source.test.ts`, `judge.test.ts`, `session.test.ts`, `delverLoot.test.ts` and `devMode.test.ts`. The tests of 7f's set pieces, the 7b source case and the torches run on `noRooms` with their expectations unchanged; the shipped-value pins gain `room: 1`. `npm test` after the review: 3,560 passed, 3 skipped (240 files), typecheck clean.
- **Screenshots** (in the editor, shown to the user, not committed): `#/mapeditor?dev=1&room=crucible&roomcheck=1` (the room mode after Check room, its AI traces drawn) and `&delverSeed=4&delverFloor=1&delverPiece=room&delverRoom=crucible` (crucible placed in a Floor, frame 3, shifted 1 m west).
- **Not rerun**: `delverGen.slow.test.ts` and the soak (the Design's flow). From this switch both meet drawn rooms, so the slow test's 7f shares now count fewer 7f set pieces per roll.

**To try**: draw a room (File → New dungeon room), Check room, Save, then Try in a Floor with `&aiwalk=1`. Watch for repetition: with one room file, `crucible` is about 1 Hall in 10.

### Stage 7e: archetypes
**Model**: Opus (the recipes), then Sonnet.
- **Archetypes**: seeded procedural recipes that combine 7a to 7d and scale to a Hall's size, shape and door sides. Examples: arena pit, throne room, bridge hall, colonnade, crypt, lava hall. There are no hand-made templates.
- Each Hall kind (Entrance, Rest, Treasure, Boss, a fight post, Empty) has its own set of archetypes and weights in `data/delver.json`. The Boss Hall picks from great-hall archetypes only.
- The judge checks every archetype over the 500-seed run, and each archetype has a seeded test of its own at the smallest and largest sizes.
- **Done**: the 500 pairs, with the archetypes counted; the full soak; Stage 2's walk; a screenshot of each archetype; and the Run played through Floors 1 to 9 with no error.

### Stage 8: online co-op
**Model**: Opus.
- Up to four Players in a Rollback session. Input Delay as a Battle's if Stage 0 says so. AI Takeover marks a Player away (no Stairs count, no fire, no pickups; Warband sizes unchanged). Loopback tests and a four-Player soak. `PROTOCOL_VERSION` + 1 if the Intent or session messages change.
- **Done**: an online four-Player Run to Victory with no desync in the soak.

#### Design
**What is already built.** Most of the netcode came early: the Lobby's Delver row and its sync (Stage 2's follow-up), the resync check of a Delver state with its Crowd and Warbands (Stage 3), the Pool AIs run past the party on every peer, Input Delay `BATTLE_INPUT_DELAY` for an online Delver Run (Stage 3's measurement), and an AI Takeover marking `delver.away` (Stage 2), which already keeps an away Player out of the Stairs count, the fires, the Reveal, the drops and the pedestals. A Room in Gauntlet already seats up to four Players on Team 0, and its host may set a Seat to an AI ally. So Stage 8 is mostly proof: tests of what is there with four peers, AI allies and a Takeover, plus the one missing piece of the view, name tags. Nothing in the Simulation, the Intent or the session's messages changes, so `PROTOCOL_VERSION` stays 30 and no hash moves.

**1. The harness** (`src/net/coopHarness.ts`):
- `runLineup(players, allies = 0)`: the `players` Players on Team 0, then `allies` AI allies on Team 0 (pilot `{ kind: 'AI', difficulty: 'Expert' }`, weapon `WEAPON`), then the MAX_TEAM_SIZE Floor slots. `players + allies` ≤ MAX_TEAM_SIZE.
- `RunOptions.allies?: number` (default 0) and `RunOptions.inputDelay?: number` (default 0), passed to every peer's `createRollbackSession`. With a delay, each peer's pilot walks (`createDelverPilot(…, { walk: true })`, below).
- `offline(...)` replays a Delver Run too. It takes `{ match, step, inputDelay }` in an options argument (defaults: `MATCH`, `stepMatch`, 0), builds its AIs by `lineupAis(tuning, lineup, 'Gauntlet', match)`, and reads a Player's Intent for Tick t as `sent.get(t − inputDelay)` (idle for t ≤ inputDelay). A Delver pickup list is `delver.pickups`. `startRun` returns `match` and `step` for it.

**2. Name tags** (render only):
- `partyMarkers(config, duel, me)` (`src/render/minimap.ts`): the present Players (`presentPlayers(config, duel.delver?.away)`) besides `me` whose Fighter is in the Duel and has no `death`, as `PlayerMarker`s, in slot order.
- `PlayerTags.update` takes the marks as an optional last argument (default `playerMarkers(state, me)`, so a Battle is unchanged). `PlayerTags.names` becomes settable (`setNames`).
- `game.ts`: one `PlayerTags` beside the HUD, in Team 0's army colour (`battle.soldier.colours`). Each frame of an online Delver Run (`driver.ping` not undefined and `curr.delver`) it is updated with `partyMarkers`, the names by Fighter slot (`lineup[i]`'s Player's name). In every other Match it shows nothing. Stage 8a reuses it for the traitors' view.

**3. Fast loopback tests** (`src/net/delverParty.test.ts`, on the three-Floor, one-Tier flat Floors and a `nearWarband` set-down in the harness, `delverRun.test.ts`'s with the party spread 0.8 m apart; `delverRun.test.ts` keeps its own):
- **Four Players at Input Delay 3**: 400 confirmed Ticks. Every checksum of every peer equals the host's and the offline replay's, with no Desync and no resync. `config.humans` is 4. A Soldier was promoted, and on some Tick two or more Players' Bubbles held promoted enemies at once (two distinct nearest Players among the promoted Fighters).
- **Two Players and two AI allies**: the Lineup [P0, P1, AI, AI]. The checksums equal the offline replay's, `config.players` is [0, 1], both allies moved, and the Ally AIs run on every peer (the guest's state equals the host's).
- **A guest leaving**: three Players; Player 2's tab closes at Tick 150. Every peer marks `delver.away` [2] from the same Tick, the offline replay with that Takeover gives the same checksums, `doorCounters` leaves Fighter 2 out from then on, and the Fighter keeps moving (driven by the Ally AI).

**4. The slow soak** (`src/net/delverFour.slow.test.ts`): four peers on the Delver pilot at Input Delay 3, as the game plays it. The party is kept at max HP each Tick by `withImmortalParty` in the step of every peer (the same edit on every peer, so a Rollback repeats it). The Tuning is one Tier of two Floors on `flatHalls`, Floor 2 the Boss Floor, with the bundled Warbands. It must show a Victory (`status Over`, winner 0), Floor 2 entered, two or more Bubbles in use on some Tick (it prints the most), every checksum of the four peers equal, and no Desync or resync. It prints the Rollbacks (frames with one, Ticks re-simulated, ms p50 / p99 / max), the Ticks, and the wall time.

**Tasks**: (1) harness and the fast tests; (2) name tags; (3) the slow soak and its numbers.

### Result
Done 2026-11-16. Up to four Players can now play a Delver Run online. The Lobby can also seat AI allies in the party, a guest who leaves is taken over by an Ally AI on every peer, and each peer sees a name tag over the party's other Players. No Simulation state, Intent or session message changed: `PROTOCOL_VERSION` stays 30, and every hash is unchanged.

**What was built**:
- **The harness** (`src/net/coopHarness.ts`): AI allies seated on Team 0 (`runLineup(players, allies)`), an Input Delay for every peer, `nearWarband`, and an offline replay of a Delver Run (its Pool AIs past the party, the Intents played `inputDelay` Ticks after they were sent, the test's Tick function).
- **Name tags** (`partyMarkers` in `src/render/minimap.ts`, `PlayerTags` in `game.ts`): over each other present, living Player of the party, in Team 0's army colour, only online. Stage 8a builds the traitors' view on it.
- **The walking pilot** (`createDelverPilot(…, { walk })`, found by the soak): a pilot played through an Input Delay takes no jump Link, only Ramps and drops. It is used by the harness with a delay and by the game's online dev autopilot.

**Changed from the Design**:
- **The walking pilot is new.** At Input Delay 3 the four pilots never left Floor 1: a pilot pressed Jump at the takeoff of a shortcut Link up onto a 2 m Deck, the press was played 3 Ticks later from past the takeoff, and the Jump fell short. It walked back and tried again for ever. Offline with the Intents delayed 3 Ticks the same happened, even solo. With `walk` the same offline party won at Tick 34,046. Only a pilot driving a Player's slot is touched: an AI ally, a Pool AI and an AI Takeover run inside the Tick on every peer, with no delay.
- **The soak asserts two Bubbles or more**, not four, since where the pilots stand is up to the Floor. It saw four.
- **`nearWarband` is the harness's own** (the party spread 0.8 m, so four Fighters do not start inside one another); `delverRun.test.ts` keeps its copy, so its expectations are unchanged.

**Tests**: `npm run typecheck` is clean. `npm test`: **3191 passed, 5 skipped** (3185 before the Stage). New: `src/net/delverParty.test.ts` (3 tests, about 28 s), `src/render/partyMarkers.test.ts` (3) and the slow `src/net/delverFour.slow.test.ts` (1, about 7 minutes).
- `delverParty.test.ts`: four Players at Input Delay 3, 400 Ticks against a Warband (a Promotion, two Bubbles at work); two Players and two Expert AI allies; three Players with Player 2 leaving at Tick 150 (marked away from one Tick on every peer, out of the Stairs count, its Fighter still walking). Every checksum of every peer equals the offline replay's. With the replay's delay set wrong, the first check fails at Tick 30, so the replay is what the checksums are compared with.
- The slow `coop.slow.test.ts` and `delverCoop.slow.test.ts` (the harness's other users) pass. The rest of the slow suite was not run.
- `warbandSoak.slow.test.ts`'s "a chase round a corner" fails, alone too, on this Stage's base commit (`d23eec8`) as on its last: it predates the Stage (the Floor lengths of issue #135 or the Enclosure Walls change, not looked into).

**Measured** (`delverFour.slow.test.ts`, the test container, about 3× a mid-range laptop): four peers on walking pilots at Input Delay 3, the harness's 40 ± 20 ms, one Tier of two Floors on 7b's Halls (7 Halls a Floor), the party immortal.
- Victory at Tick 31,220 (Floor 2 entered at Tick 12,520), in 418 s of wall time for all four peers.
- 0 resyncs and no Desync on any peer, and every checksum the four recorded agrees.
- At most 11 Soldiers promoted at once, and four Players' Bubbles holding enemies at once.
- A plain frame costs 0.92 ms (median). Rollbacks ran in 70% of frames, re-simulating 4 Ticks at p50 and 6 at p99. A Rollback cost 2.18 ms at p50, 12.0 ms at p99 and 315 ms at most.

**To try in a playtest**: two to four browsers, `npm run dev`, a Room in Gauntlet with the Delver row on. Seat an AI ally in an Open Seat. Play down a Floor together:
- each other Player has a name tag over their Fighter;
- close one guest's tab mid-Floor: an AI takes over its Fighter, its tag goes, and the Stairs no longer wait on it;
- with `?dev=1&autopilot=1` on a guest, its pilot walks round the Decks rather than Jumping onto them.

**To watch next**:
- **Rollbacks are frequent with four peers.** The guests talk through the host, so a guest's Intent reaches another guest two hops late (about 80 ± 40 ms here), beyond the 3-Tick delay. 70% of frames roll back, by 4 Ticks at p50. A Rollback's p99 (12 ms here, about 4 ms on a laptop) is within a frame, but a larger Input Delay for three or four Players is worth a playtest (the user's call).
- **The one-off 315 ms Rollback** was not looked into: likely a Floor's navmesh or fields built inside it, or a GC pause.
- **The pre-existing "chase round a corner" failure** above.

### Stage 8a: traitors
**Model**: Opus. Issue #134. Scope agreed 2026-11-16 (the user's answers). Builds on Stage 8's session and on a Battle's takeover (`CONTEXT.md`, Take over).
- **Who**: in an online Delver Run any number of Players may pick Team 1 by their Seat. These Players are the **traitors**. Team 0 may be all AI allies. Tests and dev Runs drive a traitor by an AI stand-in (a pilot on Team 1).
- **Taking over**: a traitor takes over a random living Warband Soldier that no party Fighter sees and that is at least `delver.traitor.minDistance` (20 m to start) from every party Fighter by walking. The pick is seeded from (Run seed, Floor, Player, takeover count). Any Soldier but the Boss counts: plain and elite Warbands (their Relics included) and the Boss Warband's guards. The Soldier becomes a full Fighter in the traitor's Pool slot with its own Troop's Body, Weapon, Mods and HP, under the half-damage rule of promoted Soldiers. The Fighter has the Soldier's own Size (height and thickness), not the traitor's (the user's call, 2026-11-18; unlike a Battle, where a Player keeps their own). With no Soldier out of sight and reach, it takes any non-Boss Warband Soldier at random (the user's call, 2026-11-17), one already fighting the party included. With no Soldier left at all, it watches.
- **Its Warband**: the Soldier leaves its Squad, as in a Battle, and the Warband carries on without it. Its death still counts toward wiping that Warband, and the drops fall where it fell.
- **Respawn**: once a traitor's Fighter falls it dies at once, as a taken-over Soldier does in a Battle. It watches for `delver.traitor.respawnSeconds` (8 s to start) plus `respawnStep` (4 s) per earlier death, at most `respawnMax` (30 s), then takes over another Soldier. There is no limit. The growing wait counts only this Floor's deaths: each new Floor resets it to `respawnSeconds` (the user's call, 2026-11-17; `floorDeaths`, `PROTOCOL_VERSION` 33). The Run's death count still carries across Floors, for the results.
- **Floors**: on the Stairs the traitor's Soldier goes with the old Floor. On the new one it takes over a Soldier after its first delay (`respawnSeconds`), its wait reset.
- **What a traitor may not do**: take a pickup, a Treasure pedestal, a fire's heal or revive, or count at the Stairs. It never takes over the Boss.
- **Seeing**: a traitor's minimap and Floor Map show the whole Floor with no fog, plus an arrow for each party Fighter. In 3D it sees the party's name tags. Team 0 sees no name tag or map arrow for a traitor: its Fighter looks like any promoted Soldier.
- **Scaling**: only Team 0's humans count toward `delver.perPlayerSoldiers` and the enemy HP scale. A traitor adds no Soldiers.
- **Bubble**: a traitor has no Bubble. The party's Bubbles promote the Soldiers round it as now.
- **Leaving**: an AI Takeover of a traitor makes its Fighter an ordinary promoted enemy (a Pool AI of its Troop's difficulty), demoted back into the Crowd by the usual rules. That Player takes over no more Soldiers.
- **Winning**: traitors have no win state. The Run ends as before, by the party. The results screen adds each traitor's kills and deaths.
- **State**: the traitor records (Soldier taken, death count, next takeover Tick, kills) are plain Run state, hashed and rolled back. `PROTOCOL_VERSION` + 1 if the Lobby's Seats or the Intents change.
- **Done**: an online Run with two party Players and one traitor, and one with an all-AI party and two traitors, played with no desync. A soak with a traitor pilot shows the takeovers out of sight, the growing delay, no pickups or fires taken by a traitor, and no Boss taken over. Plus tests of the tag and map visibility per Team.

#### Design
**The shape.** A traitor is a Player on Team 1 of a Delver Lineup. It has no Fighter of its own: it has a **Pool slot** of its own, right after the party's (`teams.length + j` for the j-th traitor), and plays as a Warband Soldier it takes over into that slot. Its record lives in the Run's state; the Bubbles never bind its slot to anyone else while it plays.

**1. The Lineup, the Lobby and the config**:
- **Lobby** (`src/lobby/lobby.ts`): in a Delver Lobby a Member may move to a Team 1 Seat (`moveMember` allows it; `join` still seats a guest on Team 0). `setDelver(…, false)` and `setFormat` to a Hall-graph Gauntlet move every Team 1 Player back to Team 0 (as `setFormat` does now). `lobbyLineup` of a Delver Lobby: Team 0's Seats as now, then Team 1's **Player** Seats in Seat order (the traitors), then Floor slots up to MAX_TEAM_SIZE Team 1 slots in all. So Lineup index = Fighter index for a traitor too. `startProblem`: Team 0 still needs a Fighter (a Player or an AI ally); "Team 0 may be all AI allies" needs no change. `formatProblem` counts only Team 0's Players for a Hall-graph Gauntlet.
- **Lineup** (`src/controllers/lineup.ts`): `checkLineup(tuning, lineup, players, format, delver = false)`: with `delver`, a Team 1 slot is a Floor slot or a Player, every Player slot of Team 1 before every Floor slot. `lineupMatch` for a Delver (`options.delver`): `humans` and `players` are Team 0's Player slots only; `traitors` is one `{ size? }` per Team 1 Player slot, in order. `lineupAis` is unchanged (a traitor's slot gets the Pool AI of its Pool slot, never asked while a Player drives it).
- **MatchConfig / MatchOptions** (`src/sim/match.ts`): `traitors?: readonly TraitorSeat[]` (`TraitorSeat = { size?: Size }`), Delver only, absent when none (so every other config hashes as it always did). Traitor j's Fighter is slot `config.teams.length + j` (`traitorSlot`). `party + traitors ≤ MAX_TEAM_SIZE + MAX_TEAM_SIZE` and `humans + traitors ≤ MAX_PLAYERS`. A Delver Run may field `humans` 0 when it has a traitor (an all-AI party); a Run with neither is refused. `deployWarbands` is already sized by `max(0, humans − 1)`, so traitors add no Soldier and an all-AI party is sized as one Player.

**2. State** (`src/sim/delverTraitors.ts`, new):
```ts
interface TraitorState {
  soldier: number;   // the Soldier (Crowd index) its Fighter is, or was while it lies fallen; -1 none yet on this Floor
  warband: number;   // that Soldier's Warband (Squad) before it left it; -1 with none
  deaths: number;    // over the whole Run
  taken: number;     // takeovers over the whole Run (the pick's salt)
  next: number;      // the Duel Tick (SimState.tick) from which it takes over its next Soldier
  kills: number;     // party Fighters felled by its Fighter's blow
  away?: true;       // an AI Takeover took it: it takes over no more
}
```
- `DelverRun.traitors?: readonly TraitorState[]`, one per `config.traitors`, absent when none; mirrored on `SimDelver.traitors` (the very array, as `pickups`) for the Controllers and the view. Hashed and snapshotted with the Match; nothing else is new state. `parseNetMessage` checks both.
- **Watching**: a traitor watches while its slot's Fighter is not in the Duel (Benched) or has fallen.
- **The delay** (`respawnTicks(t, n) = secondsToTicks(min(respawnMax, respawnSeconds + respawnStep × n))`), `n` the deaths before the wait began, not counting the fall that began it: at the Run's start and on each new Floor `n = deaths`; after a fall `n = deaths − 1` (its earlier deaths). The first fall waits 8 s, the second 12 s, … capped at 30 s.
- **Tuning** (`delver.traitor`, `data/delver.json`): `minDistance` 20 (m, positive), `respawnSeconds` 8, `respawnStep` 4, `respawnMax` 30 (seconds, ≥ 0, `respawnMax ≥ respawnSeconds`).

**3. The step** (`stepTraitors(duel, records, config, tuning, plan, seed, floor)`, pure; in `stepDelver` before `stepBubbles`, Tick `t = duel.tick + 1`). For each traitor j, not away, slot `k = traitorSlot(config, j)`:
- **Its fall**: `soldier ≥ 0`, its Fighter has `death`, and the Soldier is still alive in the Crowd: the Soldier is written back where its Fighter fell (x, z, Walk Surface, heading), `hp` 0, `alive` 0, and back in its Warband (`squad[s] = warband`, so the wipe of the Warband counts it and its drops lie there). `crowd.slot[s]` stays `k` (its Fighter's ragdoll is the body; the impostor stays hidden) until the next takeover frees it. Record: `deaths + 1`, `next = death.tick + respawnTicks(deaths)` (the deaths before this one).
- **A takeover**: watching and `t ≥ next`: the pick (below). Found: the slot becomes the Soldier as a full Fighter at guard where it stands, facing its heading, with its Troop's Weapon and Mods (its Relics folded in, the half damage of `battle.soldier.mods` included: `promotedFighter`, the Bubble's own promote made public) and its HP and max HP, in the traitor's own Size (`config.traitors[j].size`), with **no** `soldier` binding (so no Bubble rule touches it). `crowd.slot[s] = k`, `crowd.squad[s] = −1` (it leaves its Warband), the old Soldier's `slot` back to −1. Record: `soldier s`, `warband` its Squad, `taken + 1`. None out of sight and reach: any living non-Boss Warband Soldier at random (`traitorFallback`, the same seeded pick), one already promoted included (its Pool slot is freed and the Soldier taken where its Fighter stands, with its HP). None at all: `next` stays put and it looks again each whole second past it (`(t − next) mod secondsToTicks(1) = 0`), so the HUD reads that it is looking rather than a countdown stuck at 1 s.
- **The pick** (`traitorPick`): the candidates, in Crowd order: alive, in the Crowd (`slot −1`), in a Warband (`squad ≥ 0`), not the Boss (the lowest index of the BOSS Warband), unseen by every party Fighter (Team 0, slots below `teams.length`, in the Duel, not fallen: `inSight(map.fields, f, soldier, 0, fy, sy)` with no range), and at least `minDistance` from each of them by walking (`walkDistance(walkField(...))`, Infinity unreached). The pick is `candidates[runPick(seed, floor, 16 + j, 0x7a17 + taken, n)]`.
- **Kills** (after the Duel's step): each Death event of a party Fighter whose last blow (`killerOf`: the Hit, Kick, Throwing Dagger or Chain Knockdown, as a Battle's `countKills`, made public) was a present traitor's slot adds 1 to its `kills`.
- **The Bubbles**: `stepBubbles(…, reserved)` takes the present traitors' slots, which `openSlot` never hands out. The traitor has no Bubble (its slot is past the party's). Everything else about the Bubbles is unchanged.
- **The Warbands' wipe**: a Soldier a traitor holds alive counts as its Warband's (`warband`) in `stepDelver`'s pass, so a Warband is never wiped while a traitor is one of it.
- **Floors**: `startFloor` gives every record `soldier −1, warband −1, next = respawnTicks(deaths)` (the Duel Tick starts at 0); the Soldier went with the old Floor's Crowd. The Run's first Floor the same, from fresh records.
- **What a traitor may not do** is already true: pickups, pedestals, fires, the Reveal and the Stairs all read `presentPlayers` (Team 0's Players), and the traitor is a Team 1 Fighter that the party fights.

**4. Leaving** (`takeOverFighter` for a traitor's slot): the record is marked `away`. If it holds a Soldier, that Soldier goes back to its Warband (`squad[s] = warband`) and its Fighter gets a binding `{ index s, since duel.tick + 1, role 'Attack' }`: an ordinary promoted enemy from then on, demoted (or freed when it falls) by the usual rules. Record `soldier −1, warband −1`. Its slot is no longer reserved. The session's `takeoverAi` gives a Delver traitor's Fighter (a Team 1 Lineup slot of a Gauntlet) a Pool AI.

**5. The session and the wire**: `PROTOCOL_VERSION` 31 (a Lineup's Team 1 Player slots, `config.traitors`, the records). `checkLineup` gets the `delver` flag from the Match options. The resync's memory check needs nothing new (a traitor's slot is a Pool slot).

**6. The view** (render only):
- `floorBodies` takes the traitor records: a traitor's slot holding a Soldier wears that Soldier's Body. Its colour is already Team 1's soldier colour (`drawColours`), so Team 0 sees a promoted Soldier.
- `partyMarkers(config, duel, me)`: unchanged for Team 0 (a traitor's slot is no party Player: no tag, no arrow). For a traitor `me` (`traitorMarkers`) it is every living party Fighter, Players and AI allies, in slot order: the arrows on its maps, and the name tags (a Player's name, an ally's `AI`).
- **The traitor's map** (`Minimap`, Floor Map): with `traitorView` the Reveal is ignored (every Hall and Passage drawn) and every party Fighter has an arrow in Team 0's colour.
- **The traitor's camera**: while it watches, it orbits the party's centre (`fightCentre` of Team 0's living Fighters).
- **HUD**: a watching traitor reads "Taking over a Soldier in N s" (or "No Soldier to take over").
- **Results**: each traitor's name, kills and deaths, under the party's Builds.

**7. Tests**:
- `src/sim/delverTraitors.test.ts`: the delay; the pick (out of sight, walk distance, never the Boss, never promoted, seeded); a takeover (Body, Weapon, HP, Size, no binding, out of its Warband); a fall (Soldier dead in its Warband, the delay, a second fall longer); a new Floor; kills; an away traitor's Fighter becomes a promoted enemy; a Warband held by a traitor is not wiped; `openSlot` skips a traitor's slot.
- Lobby and Lineup tests: Team 1 Seats in a Delver, the Lineup's order, `lineupMatch`, `checkLineup`.
- `src/render/partyMarkers.test.ts` (+): no marker of a traitor for Team 0; the party's Fighters for a traitor.
- `src/net/delverTraitors.test.ts` (fast, loopback at Input Delay 3): two party Players and one traitor; an all-AI party (two Expert allies) and two traitors. Every checksum equals the offline replay's, no Desync, a takeover happened on every peer.
- `src/net/delverTraitor.slow.test.ts` (soak): two party pilots and one traitor stand-in (`createTraitorPilot`: walks to the nearest party Fighter and fights it with its AI), the party immortal. Must show: takeovers ≥ 3, every one out of sight and ≥ minDistance (checked on the takeover Tick), a delay that grew (a second wait longer than the first), no pickup taken, fire used or Stairs counted by a traitor, no Boss taken over, and the Run reaching Floor 2. (Removed 2026-11-17, the user's call: a whole Run to Victory was too slow for what it checked; `src/sim/delverTraitors.test.ts` and `src/net/delverTraitors.test.ts` cover the rules and the online play.)

**Tasks**: (1) the Simulation (traitors, the Bubbles' `reserved`, `takeOverFighter`, the Tuning, its tests); (2) Lineup, Lobby, session, wire; (3) the view; (4) the loopback tests and the soak.

### Result
Done 2026-11-16. An online Delver Run can now seat traitors: Players on Team 1 who play the Warbands, each taking over a Soldier out of the party's sight and reach, again after every death, with a longer wait each time. Team 0 may be all AI allies. `PROTOCOL_VERSION` is 31 (a Lineup's Team 1 Player slots, `config.traitors`, the traitors' records). A Run without traitors hashes as before: its config, Run and Duel carry no new key, and its Tick is unchanged.

**What was built**:
- **The Simulation** (`src/sim/delverTraitors.ts`): `TraitorState` records in `DelverRun.traitors` (mirrored on `SimDelver.traitors`), `stepTraitors` before the Bubbles (a fall kills the Soldier back in its Warband and starts the wait; a takeover by `traitorPick`), `countTraitorKills` after the Duel's step, `traitorLeaves` for an AI Takeover, and the delay `respawnTicks`. `stepBubbles(…, reserved)` keeps a playing traitor's slot from any Promotion; `promotedFighter` (the Bubble's promote, made public) builds its Fighter; `killerOf` is the Battle's kill rule, shared. A Warband held by a traitor is not wiped until its Soldier dies. Tuning `delver.traitor` { minDistance 20, respawnSeconds 8, respawnStep 4, respawnMax 30 }.
- **Lobby, Lineup and session**: a Delver Lobby lets a Member take a Team 1 Seat ("Play as a traitor" on the Floors card online); picking the Halls (or a Hall-graph Gauntlet) moves them back to Team 0. The Lineup puts the traitors first among Team 1's slots, so Lineup index = Fighter index. `lineupMatch` gives `traitors` and counts only Team 0's Players as `humans`; Ally AIs walk with Team 0's Players only. A traitor who leaves is taken over by a Pool AI.
- **The view**: a traitor's slot wears its Soldier's Body (Team 0 sees a promoted Soldier: no tag, no arrow); a traitor's minimap and Floor Map show the whole Floor (`fullReveal`, `viewReveal`) with its own arrow and the party's; it tags every living party Fighter (an ally as `AI`); watching, it orbits the party and reads "Taking over a Soldier in N s"; the results screen lists each traitor's kills and deaths. `createTraitorPilot` is its stand-in (tests and `?autopilot` on a Team 1 Seat).

**Changed from the Design**:
- **The Ally AI and the Delver pilot fight a traitor** (`promotedNear` counts any Team 1 Fighter in play on a Floor, not only a bound one): without it the party's AIs walked past it. Only a traitor is an unbound Team 1 Fighter in play, so no Run without one changes. `delverAi.test.ts`'s "not a promoted enemy" case now uses a Benched slot, and a new case checks a traitor's Fighter is fought.
- **The pilot's Boss check** (`bossLives`) counts a Boss guard a traitor plays, so the pilot does not wait at shut Stairs.
- **The host's hello** sends each Player's own pick for a Weapon past the party's slots (found by the first loopback run: the guests dropped a hello with no Weapon for the traitor and never connected).
- `formatProblem` needed no change: `setFormat` moves Team 1's Players back first.
- `humans` 0 is accepted on the wire only for a Delver Run (options) or with traitors (a state), so `messages.test.ts` keeps refusing it elsewhere.

**Tests**: `npm run typecheck` is clean. `npm test`: **3216 passed, 5 skipped** (3192 before the Stage). New: `src/sim/delverTraitors.test.ts` (8), `src/net/delverTraitors.test.ts` (3, about 10 s), `src/play/traitorView.test.ts` (4), traitor cases in `src/lobby/delver.test.ts` (2), `src/net/delverMessages.test.ts` (2), `src/render/partyMarkers.test.ts` (1), `src/play/floorBodies.test.ts` (1) and `src/tuning/delver.test.ts` (3), and the slow `src/net/delverTraitor.slow.test.ts` (1, about 6 minutes). Rewritten: the protocol pins (30 to 31), the bundled Tuning's expected values (the `traitor` key) and the one `delverAi.test.ts` case above.
- Loopback, at Input Delay 3: two party Players and one traitor; an all-AI party (two Expert allies) and two traitors, the host one of them; a traitor leaving (marked away from one Tick on every peer). Every checksum of every peer equals the offline replay's, with no Desync or resync, and every traitor took a Soldier over on every peer.
- The rest of the slow suite was not run this Stage. Without a traitor the new code does nothing (no record, no reserved slot, and `promotedNear` sees no unbound Team 1 Fighter), but Stage 8's `delverFour` and `delverCoop` soaks were not run again to prove it.

**Measured** (`delverTraitor.slow.test.ts`, three peers, two Delver pilots and a traitor pilot, Input Delay 3, one Tier of two Floors on 7b's Halls, the party immortal, the traitor not): Victory at Tick 52,731 in 375 s of wall time. 7 takeovers (4 on Floor 1, 3 on Floor 2), every one a candidate on the Tick before (unseen, ≥ 20 m by walking, in a Warband) and none the Boss. 7 deaths, waits after each fall 8, 12, 16, 20, 24, 28 and 30 s (capped). No pickup, fire, revive or Stairs count by the traitor. 0 kills (the party is immortal). No Desync, no resync.

**To try in a playtest**: three browsers, `npm run dev`, a Room in Gauntlet with the Delver row on. One guest presses "Play as a traitor" on the Floors card. Then:
- the traitor sees the whole Floor and the party's arrows and tags, and after 8 s is a Warband Soldier somewhere out of sight;
- the party sees it as any promoted Soldier (no tag, no arrow), and the AI allies fight it;
- kill it: it waits longer each time (the HUD counts down); the results screen shows its kills and deaths;
- close the traitor's tab while it plays a Soldier: that Soldier fights on as an ordinary enemy;
- seat only AI allies on Team 0 and two traitors: the allies walk the Floor alone.

**To watch next**:
- **The traitor pilot rarely reaches the party** before the party's AIs or Warbands kill it (0 kills in the soak). Takeovers ≥ 20 m away and out of sight mean a long walk; whether 20 m feels right is a playtest call.
- **A traitor's HUD** is the ordinary one (its bars were not looked at in a browser); no screenshots were taken this Stage.
- **The Pool shrinks by one slot per traitor** (16 in all): four party Bubbles and two traitors leave 10 for Promotions.

### Stage 9: retire the Hall graph
**Model**: Sonnet.
- Remove `floorGraph`, Doors, Hall rows, the `:d` Arena names in Runs, and their tests. Update `CONTEXT.md` (Floor, Hall, Door, Run, Inventory, Floor Map) and mark the superseded parts of ADR 0019 and `dungeon.md`.

#### Design
After this Stage a Gauntlet **is** a Delver Run: there is no second kind of Run to choose. Nothing in a Delver Run's Simulation changes how it plays; what goes is every line that only the Hall graph reads. The hashes of every Match move (its state loses `run: null`, its config `delver: true`), so `PROTOCOL_VERSION` 31 → 32, and the Tuning Data hash moves (the Dungeon loses its Floors).

**1. The Match** (`src/sim/match.ts`):
- `MatchConfig.delver` and `MatchOptions.delver` go. A Gauntlet is a Delver Run: every check that read `config.delver` (or `options.delver`, `match.delver` as a flag) reads `config.format === 'Gauntlet'`. `delverStart` and `traitors` stay, refused outside a Gauntlet.
- `MatchState.run`, `RunState` (the Hall graph's), `hallDuel`, `enterHall`, `stepRun`, `takenExit`, `hallBehind`, `runHall`, `runCleared`, `checkRunTeams`, `MatchOptions.start` (`RunStart`), `HallClearedEvent` and `DoorTakenEvent` go. `stepMatch`'s Gauntlet branch is `stepDelver`.
- `DelverRun` is renamed **`RunState`** (`src/sim/delverRun.ts`); `MatchState.delver` keeps its name (`config`, `tuning` and `SimState` all have a `delver` already, so a rename of the field would only churn). `takeOverFighter` loses its Hall branch.
- `RunEndEvent.halls` goes (a Delver Run always sent 0); `bosses` and `warbands` become required.
- `createMatch` for a Gauntlet takes Team 0's Fighters alone or followed by MAX_TEAM_SIZE Team 1 slots (`delverParty`, as now).

**2. The Duel's state** (`src/sim/state.ts`, `step.ts`): `SimHall`, `HallPhase` and `SimState.hall` go. `updateDuel`'s "a Run's Duel goes on past a wipe of Team 1" reads `state.delver` alone.

**3. The Dungeon module**: `src/sim/dungeon.ts` keeps only `runSeed`, `runPick` (and `mix32`). `src/sim/hall.ts` becomes **`src/sim/party.ts`** with only what a Delver Run reads: `runPlayers`, `presentPlayers`, `stairsCounters` (was `doorCounters`), `stairsTicksNeeded` (was `doorTicksNeeded`, reading `dungeon.stairsSeconds`), `standsWithin`, `ZONE_HEIGHT`. Everything else goes (`hallOf`, `hallRoster`, `enemyMaxHp`, `runPathTo`, `hallKey`, `runKit`, `exitDoor`, `inExitZone`, `restFire`, `atRestFire`, `REST_FIRE_RADIUS`, `HallRef`, `HallEnemy`, `RunStart`). `src/sim/pickups.ts` loses `hallDrops`, `startPickups`, the Hall `pickItem` and an Elite's carried Relic pick; `pickItemAt`, `takePickups`, `placeDrop` and the rest stay.

**4. Tuning Data** (`data/dungeon.json`, `src/tuning/dungeon.ts`): `floors`, `perPlayerHp` and `depthHp` go, with `DungeonFloor`, `DungeonEncounter`, `DungeonEnemy`, `HallKind`, `WeightedHallKind`, `PooledHallKind`, `MAX_ENCOUNTER_ENEMIES`, `MAX_ENEMY_RELICS`, `floorEncounters`, `dungeonDifficultyLadder`, the Run knobs (`RunKnobs`, `RUN_KNOB_KEYS`, `parseRunKnobs`, `applyDungeonKnobs`). `doorSeconds` is renamed `stairsSeconds` (1.5) and `hallFadeSeconds` `fadeSeconds` (1). `RANDOM_PICK` moves to `src/tuning/index.ts` (the Lineup's random Style still uses it). `revive`, `restHeal`, `inventory`, `loot` and `leftOutWeapons` stay.

**5. Generated Arenas** (`src/sim/arenaGen/`): the `:d<n>` names go: `parseGeneratedName` gives `{ kit, seed }` and refuses a third part; `generatedName(kit, seed)`; `GenParams.doors`, `placeDoors`, the Door assembly and Team 1's Hall spawns (`hallSpawns`), the judge's `doors` rule and `generateArena`'s Hall attempts go. A Random Map builds byte for byte as before (it never had Doors), so `arenaGen` golden hashes stay; `doors.test.ts` goes. The Kits' `door` Piece stays in Tuning Data (unused, removed with the Kits' next change). `ArenaGeometry.doors` stays: the Map Editor writes Doors.

**6. Controllers** (`src/controllers/`): `hallAi.ts`, `doorSpot.ts` and `autopilot.ts` (the Hall-graph autopilot; the Delver pilot replaced it) go with their tests. `allyAi.ts` loses its Hall branch (the Door walk): the Ally AI is the Delver one. `lineupAis`'s Gauntlet is the Delver one (no Hall AI). `checkLineup(…, format)` loses its `delver` argument (a Gauntlet's Team 1 Players are traitors). `lineupMatch` reads the format. The dev `?autopilot` on a Gauntlet is the Delver pilot. `FLOOR_DIFFICULTY` stays (the Lineup's Floor slots).

**7. Net** (`src/net/`): `messages.ts` drops `isRun`, `isRunHall`, `isSimHall`, `isHallRef`, `isHallAiMemory` and the `delver` key of a Match's options and config; a Gauntlet's state must carry `delver` (`isDelverRun`) and `run` is no key at all. `PROTOCOL_VERSION` 32. `session.ts` reads the format for a Run. `coopHarness.ts` loses the Hall-graph trace (`hallsIn`, the Door checks); its Run options lose `delver`.

**8. The Lobby and the view**: `LobbySettings.delver` and `run` (the knobs) go, with `isDelver`, `setDelver` and the Halls/Floors choice row; a Gauntlet's Lobby is the Floors' (traitors and all). `game.ts` loses the Hall-graph paths (`HallCleared`, Doors, the Hall shot, `runCleared`, Hall Bodies); the stored `sword.delver` and Run knobs keys are no longer read. `devMode.ts` loses `devRunStart` (`?start=`) and `devDelverRun` (`?delver=1`). Removed with their tests: `play/doorMarks.ts`, `render/doorMarks.ts`, `render/hallMarks.ts`, the Hall-graph half of `play/floorMap.ts` and `floorMapView.ts`, the Hall half of `hud.ts` (`hallScore`, a Hall's enemy tag), `announcer.ts`'s Hall Cleared, `arenaWorlds.ts`'s warm next Hall, `finalBlow.ts`'s Door cut, `inventoryView`'s `HallPhase` argument, `icons.ts`'s Hall kinds (kept only for the kinds the Delver map uses).

**9. Tests**: removed with their code: `sim/dungeon.test.ts`, `sim/dungeonRun.test.ts`, `sim/devStart.test.ts`, `sim/gauntlet.soak.test.ts`, `sim/runWeapons.test.ts` (its Hall half), `sim/arenaGen/doors.test.ts`, `controllers/hallAi.test.ts`, `doorSpot*.test.ts`, `doorGather.slow.test.ts`, `autopilot.test.ts`, the Hall cases of `ai.test.ts`, `allyAi.test.ts`, `fourASide.test.ts`, `net/gauntlet.test.ts`, `net/coop.test.ts`, `net/messages.test.ts`, `lobby/*.test.ts`, `play/*.test.ts` and `render/hallMarks.test.ts`. Every other test keeps its expectations, with `delver: true` dropped from its options. No Delver behaviour changes, so `delverRun.test.ts`, the traitor tests and the generator goldens pass as they are.

**Not done**: renaming `MatchState.delver` and `SimState.delver` to `run` (churn only); the Kits' `door` Piece; the Map Editor's Doors.

### Result
Done 2026-11-16. The Hall-graph Run is gone: a Gauntlet is a Run on generated Floors, with nothing to choose between. Nothing a Run does changed; every Match's hash moved (no `run: null`, no `config.delver`), so `PROTOCOL_VERSION` is 32 and the Tuning Data hash moved (the Dungeon lost its Floors).

**What was built** (one commit, `Delver Stage 9: retire the Hall graph and Doors`): everything in the Design's items 1 to 9, done by the orchestrator itself rather than by subagents (it was a deletion across about 135 files whose types only line up once all of it is gone).

**Changed from the Design**:
- `checkRunTeams` stays: the Lobby's Gauntlet Lineup still has Team 0 then MAX_TEAM_SIZE Team 1 slots (traitors, then Floor slots), and `checkLineup` reads it.
- `RANDOM_PICK` stays in `src/tuning/dungeon.ts` (re-exported as before); only the Encounter types around it went.
- **`ArenaGeometry.doors` and `ArenaDoor` went too.** The Design kept them for the Map Editor, but its Enclosure `doors` are doorway widths on a Brush, not `ArenaDoor`s: nothing produced or read an Arena's Doors once the Hall Arenas went. `render/doorway.ts` went with them. A hand-made Arena file's `doors` key is ignored.
- `finalBlow.ts` lost all of a Hall's clear shot (holding the Player, `shotIntent`, `takeRest`, the Door cut), not just the cut: only a Hall had a clear mid-Duel. A Run's shot plays on its wipe, as a Duel's does.
- `inventoryHoldsInput` went (always false on a Floor); `syncInventoryInput` in `game.ts` keeps its Floor behaviour (hands the keys back).
- `devAutopilot` is now a flag (`autopilot=1`), since there are no Doors to name; `?loot=` and `?floor=&row=` went with the Hall autopilot and the start Hall.
- `hallFade` is renamed `floorFade`. `arenasToWarm` and `warmingWaits` went: `arenaToWarm(match)` names the one Arena to build ahead.
- The Lobby: a Player may take a Team 1 Seat in any Gauntlet Lobby (a traitor); picking the Gauntlet still moves Team 1's Players to Team 0 first.

**Tests**: `npm run typecheck` clean; `npm test` **2965 passed, 3 skipped** (3216 before: the Hall graph's own tests went). Removed with their code: `dungeon`, `dungeonRun`, `devStart`, `gauntlet.soak`, `arenaGen/doors`, `hallAi`, `doorSpot` (and its soak), `doorGather`, `autopilot`, `allyAi` (all Hall cases), `net/gauntlet`, `net/coop` (and its slow test), `play/doorMarks`, `render/doorMarks`, `render/hallMarks`, `render/doorway`. Rewritten on Runs: `runWeapons` (on `pickItemAt`), `tuning/dungeon`, the Lobby's `gauntlet` and `delver` tests, the Run halves of `messages.test.ts`, `inventoryView`, `hud`, `arenaWorlds`, `finalBlow`, `floorMap`, `announcer`, `lobbyView`, `devMode`, `aiMemorySweep`, `fourASide`, `named`. New: `src/net/runConnect.test.ts` (the two connect refusals `net/gauntlet.test.ts` held). `delver: true` dropped from every test's options; `halls: 0` from the RunEnd expectations.
- **The AI golden was re-recorded** (`aiGolden.testdata.json`): with `run: null` put back into the hashed Match, every one of the 9 recordings matched the old one Tick for Tick, so AI play is unchanged.
- `npm run test:slow`: 52 passed, 1 failed: `warbandSoak` "a chase round a corner" (the anchor never stands in pass4's corner piece 1). It fails the same way on the Stage's base commit (30d9f0f), so it predates this Stage. Stage 8's `delverFour` and `delverCoop` soaks and 8a's `delverTraitor` passed.
- `/code-review` was not run: the session hit its usage limit. Run it on `30d9f0f..HEAD` in the next session.

**Found, not fixed**: the Relic effect `healOnClear` healed on a Hall's clear; a Run has no clear, so it does nothing now (it did nothing in a Delver Run before either). The Kits' `door` Piece and the pickup marks' cylinder pedestal (a Hall's) are dead weight, left for their next change.

**To try in a playtest**: `npm run dev`, a Skirmish in Gauntlet: no Halls/Floors row and no Run difficulty knobs; the Floors card describes the generated Floors. Play to the first Stairs and check the fade, the HUD line and the Floor Map (`M`). Online, a guest may take a Team 1 Seat as a traitor without any setting. Old bookmarks with `?delver=1` or `?floor=` do nothing now; `?dev=1&autopilot=1&immortal=1` still pilots a Run.

### Stage 10: consumables
- A third kind of item: a **Consumable**, picked up like a Relic, held in a Relic slot, and **used** from the inventory screen instead of equipped. Using it acts at once and destroys it.

#### Design
**1. Tuning Data** (`data/consumables.json`, `src/tuning/consumables.ts`, hashed): each a name, an icon id and one effect from a fixed vocabulary the Simulation implements:
- `healFull`: the user's HP to its max HP (its Relics' `maxHp` counted). The **Health Potion**.
- `revealFloor`: every Hall and Passage of the Floor into the Reveal (`fullReveal`), for the whole party, since the Reveal is shared. Only for this Floor: the next one starts fogged as ever. The **Map**.
- `reviveFallen`: every fallen Team 0 Fighter (AI allies too, as a fire does) back on its feet round the user at `dungeon.revive` of its max HP, as a fire revives. The **Resurrection Stone**.
A Consumable's name is unique among the Relics and Consumables together (a Relic slot holds names of either). `dungeon.loot.weights` gains `Consumable` (optional, 0 when absent; the data says 2, against Relic 4 and Weapon 1), so a Warband's drops and a Treasure Hall's pedestals may be one.

**2. The Inventory** (`src/sim/inventory.ts`): a Consumable takes a Relic slot (`Inventory.relics` holds its name; the `relics` size counts both) and never stacks. It is never equipped: `equip` on its slot is refused, so `equipped` and the Mods never hold one. It is dropped and taken as a Relic is; `Dropped.kind` (and a Pickup's) gains `'consumable'`, read from the name when it leaves a slot.

**3. Use** (Intent `use: InventoryRef`, a `relic` slot holding a Consumable): acted on by `stepDelver` while Exploring, after `equip` and `drop`, for a Player's Fighter with an inventory that still fights and lives. **No other condition**: mid-Action, in the air, Staggered, Blocking, in a fight, all allowed. Its effect is instant and the item leaves the slot (later slots close up, the equipped indices with them). A use that would do nothing is refused and keeps the item: a Potion at full HP, a Map on a Floor fully revealed, a Stone with nobody fallen. An `ItemUsed { fighter, item, effect }` event. A stone's revive places the fallen round the user as a fire's do, each spot kept inside the Hall or Passage piece the user stands in (`REVIVE_MARGIN` m from its edges), so a 3 m Passage never puts one in a Wall.

**4. The inventory screen**: a Consumable's slot shows its effect in words and a **Use** button where a Relic has Equip, greyed with the reason when it would be refused ("Descending", "You have fallen", "Already at full HP", "Floor already mapped", "Nobody has fallen"). There are **no keys**: a number key on its slot does nothing (Shift and a number key still selects it, so X drops it), and the screen's click sends `use` for one Tick. The results screen's Build lists carried Consumables with the carried Relics.

**5. Presentation**: icons `potion`, `map` and `stone` (`src/play/icons.ts`); a Consumable pickup is drawn as a Relic's (its icon on a base), its label coloured as a Relic's. The announcer already says "Revived" when the local Player is brought back.

**6. Net**: the Intent's `use`, a pickup's `consumable` kind, and the Tuning Data hash all move, so `PROTOCOL_VERSION` goes up by one.

**Not done**: a drinking Action or Motion; keys for Consumables; stacking; AI allies or the Delver pilot using them; other Consumables.

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

## Answered questions (2026-11-14, after Stage 6)
The user's playtest feedback: rooms bigger and more interesting, more verticality (doorways at different heights), lava pits to push enemies into. It becomes Stage 7.
1. **Size**: a mix. Most Halls are bigger, with 1 or 2 great halls a Floor (the Boss, Treasure and big fights).
2. **Verticality**: all four kinds: split-level floors, sunken pits, daises and Platforms, and more stairwells and galleries.
3. **Lava**: central pits, rivers with bridges and edge troughs. No Abyss chasms.
4. **Also**: pillars and cover, non-rectangular shapes and themed archetypes. No low walls or rails splitting lanes.
5. **Where**: a new Stage 7. Online co-op moves to Stage 8, and retiring the Hall graph moves to Stage 9.
6. **Archetypes**: procedural recipes in code, not hand-made Map Sources.
7. **How much lava**: it grows with the tier (about 1 Hall in 6 to 1 in 3). None in the Entrance, and none on the way to a fire.
8. **Who it threatens**: everyone, as the AI already plays it: an instant Death by Lava, which a fire can revive.
9. **L-, S- and Z-shaped Passages** (added afterwards): a Passage may turn one or two corners, as part of Stage 7.
10. **Stage 7 is split** into sub-stages 7a to 7e. Each is one orchestrator session with Sonnet subagents.

## Answered questions (2026-11-14, before Stage 7c)
1. **The build budget**: raise it to 800 ms mean (the 2 s cap stays). No speed work first.
2. **Pit depth**: a mix of 2 m and 4 m, the 4 m pits more often on deeper tiers.
3. **Dais height**: 1 m.
4. **Where**: rect Halls only, one vertical feature a Hall; no 7b shape or pillars with one.
5. **How often**: about 1 Hall in 4 gets a split level, a pit or a dais (7c picks before 7b's shapes and pillars).
6. **Galleries on two or more walls**: one Deck wrapping round the corners, with one Ramp.
7. **Who stands on a dais**: the Boss on a throne, and a Treasure Hall's pedestals on an altar.
8. **Screenshots**: none this sub-stage.

## Answered questions (2026-11-17, before Stage 10)
1. **Slots**: a Consumable takes a Relic slot; no stacks.
2. **Use**: no limits or impediments; the effect is instant.
3. **Keys**: none; a Consumable is used from the inventory screen.
4. **Drop rate**: loot weight 2 (against Relic 4, Weapon 1).
5. **A third Consumable**: the Resurrection Stone brings back every fallen ally, as a fire or a new Floor does.

## Answered questions (2026-11-23, before Stage 7d)
1. **Amount**: lower than proposed, one feature a Hall. About 1 in 3 of the Halls that may hold lava on tier 3 (about 1 Hall in 7 of all), fewer on tiers 1 and 2, so 7b's shapes and pillars stay about as common as now.
2. **Which Halls**: Fight, Empty, Boss and Stairs Halls and great halls. Never the Entrance, a Rest Hall or a Treasure Hall.
3. **Shapes**: a central pit ringed by floor, a river with one or two railless bridges at least 4 m wide, and troughs along a wall. No trough under a Deck's front or round a dais.
4. **Proof**: screenshots of each lava shape. The generator's budget may rise to at most 900 ms build mean and 600 ms navmesh mean; the 2 s cap stays.

## Answered questions (2026-11-24, before Stage 7f)
The user designed three rooms (a Lava Bridge, an Uphill Room, a Spiral Stair) in a spreadsheet and took every proposed default:
1. **Scale**: the sheets are a layout, not to scale. Walkways (bridges, ledge) stay 4 m wide, and the rest stretches to the Hall.
2. **Size**: each set piece scales to the Hall, with a least size of its own. A Hall too small stays plain.
3. **Lava Bridge posts**: a dry plaza at the crossing holds the Warband (7d's 12 m dry centre square).
4. **Lava Bridge arms**: one for each wall with a doorway (a straight bridge, a T or a cross).
5. **Uphill rise**: 1 or 2 levels, whichever fits the Hall's length.
6. **Uphill doors**: at the two ends only.
7. **Uphill ramp**: plain, with nothing on it.
8. **Spiral heights**: its four doors 0, 1, 2 and 3 levels up, with half-level corner landings between them.
9. **Spiral doors**: a doorway at each of the four landings.
10. **Spiral ledge**: its inner edge open, with no rail.
11. **Spiral fights**: the Warband guards the bottom floor (the well).
12. **Which Halls**: Fight, Empty, Boss, Stairs and great halls where the size fits; never the Entrance, a Rest Hall or a Treasure Hall. (The Design keeps the Uphill and the Spiral off great halls, whose long-side doorways are not at a wall's centre; the Lava Bridge may take one.)
13. **How often**: about 1 Hall in 10, the three weighted alike, picked before every other feature.
14. **Hand-made rooms**: recorded as Stage 7f, a change from 7e's "no hand-made templates".
15. **Process**: the Design is written in this plan, and implemented in a new chat.
16. **No re-baseline, a lean flow** (asked after the Design): 7d's Result is the baseline; only the tests a task touches run while working; the rate is tuned with a plan-only probe; the generator slow test runs once; the soak is one new set-piece case; the editor comes early, for checks by eye.

### Drawn rooms as Duel maps (2026-11-26)
A drawn room whose file says `"duel": true` is also a Duel map, the Arena `room:<name>` (`src/sim/roomArena.ts`), offered on the Skirmish and online map picker after the hand-made Arenas. It is built from its name and the room file alone, as a Random Map is, so every peer builds the same one with nothing sent and no new hashed state (the room files are already Tuning Data). The room stands as Check room places it in frame 0, closed: no doorway is cut and no stub Passage built, so every doorway, a raised one too, is wall (`roomDuelSource`, `src/mapEditor/room.ts`). Its source is compiled as a Battle map's is, then given every jump Link (as a hand-made Arena has) and 8 spawns: the two Teams at the ends of the room's long axis (through its centre marker), up to 6 m from the middle, facing each other, each spawn moved to the nearest flat, safe floor clear of Walls if its spot is not. A room with no such floor near a spawn throws, so `roomArena.test.ts` catches it. It is drawn as a Delver Floor is (`mapModel`, the crypt look), with sconces along its walls and its Blocks taken as pillars, and a glow over its largest lava pool. The Floor generator ignores the flag. All six rooms (bastion, brink, chasm, colonnade, colosseum, crucible) ship flagged.
