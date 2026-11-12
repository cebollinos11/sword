# Delver: the Run as one continuous dungeon per Floor

> Status: brainstorm (2026-11-12). Scope agreed with the user, nothing built. Not yet confirmed decision by decision; the Open questions at the end come first. Builds on the Dungeon (`docs/plans/dungeon.md`, Stages 1 to 4 done), the Big Battle's Crowd, Squads and Bubble (`docs/plans/big-battle.md`, `docs/plans/battle-objectives.md`, ADRs 0020 to 0022) and the Map Editor's Map Source and Enclosure Brush (`docs/plans/map-editor.md`, ADR 0023). Each Stage ends with a `### Result`, as in the other plans.

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
- **Rest places are fires in Rest Halls, 1 or 2 a Floor:**
  - **Heal once**: each Player's Fighter that stands at a fire heals `dungeon.restHeal` of its max HP, once per fire.
  - **Revive**: the first Player to reach a fire brings back every fallen teammate there at `dungeon.revive` of max HP. A fallen Player watches with the orbit camera until a fire or the Stairs revives them. Taking the Stairs revives everyone too. A wipe ends the Run (a Defeat).
  - **The Inventory changes only at a fire** (within its radius). This stands in for "the Hall is Cleared", since a Floor is never wholly cleared. Picking an item up is allowed anywhere there is room for it.
  - A fire is not a safe zone: Warbands may follow a party into a Rest Hall.
- **Loot comes from Warband drops and Treasure Halls.** A wiped Warband drops one item per Player where its last Soldier fell (a pure pick of Run seed, Floor, Warband and Player, weighted by `loot.weights`, more for an elite Warband). A Treasure Hall (about one a Floor, off the path to the Stairs) holds `loot.pedestals` (pick 1 of 3), as a Treasure Hall does now. There are no chests, consumables or Gold yet (Later).
- **Fixed depth, a Boss at the end of each tier.** For example three tiers of three Floors (Tuning Data), each tier's last Floor a Boss Floor with its Stairs behind the Boss Hall's gate. It opens when the Boss and its guard fall (open question 1). There is a full heal after each Boss, and beating the last Boss wins the Run. That is about 30 to 45 minutes a Run.
- **Exploration is fog of war, shared by the party.** A Hall or passage is revealed on the minimap and the Floor Map (`M`) once any present Player's Fighter enters it or sees into it. Revealed parts stay revealed for the Floor. The Stairs, fires and Treasure Halls show once revealed. This reverses `dungeon.md`'s "the whole Floor map is shown", which made sense for a route graph but not for a dungeon you explore.
  - **What has been revealed is a bitset in `RunState`** (one bit per Hall and passage, hashed and snapshotted), not render-side memory. It costs a few bytes, keeps every peer's map the same, and survives a resync. Revealing never changes an outcome.
- **Floors are large and have several levels.** Each Floor has 20 or more rooms, with balconies over halls, stairwells (Ramps) between heights and bridges over passages, using the multi-level walk rule. It takes 5 to 10 minutes. It is built one level first (Stage 1) and grown into levels in Stage 6, so the Run loop and Warbands are proven on flat Floors before verticality adds its own bugs.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Floor** (changes meaning again): one continuous generated dungeon of a Run, from its entrance to its Stairs. It is one Arena, one Duel and one Crowd. _Avoid_: level, act, stage, map.
- **Hall** (changes meaning): one room of a Floor, an Enclosure the generator placed, with a kind: Fight (a post for a Warband), Rest (a fire), Treasure (pedestals), Stairs, Boss, Entrance, or Empty. _Avoid_: room (the online connection), chamber, cell.
- **Passage**: a corridor between Halls (an Enclosure with two opposite doorways, or several in a line). _Avoid_: corridor (in code), hallway.
- **Warband**: one Squad of a Floor's enemies, with its post or patrol, its Encounter and its brain's state (Guard, Patrol, Chase, Return). A Battle's Squad with a dungeon brain. _Avoid_: wave, mob, group, pack.
- **Encounter** (grows): a hand-written Warband template: its Soldiers' Troops (Weapon, Body, difficulty, Style), how many there are, its HP scale, its brain (Guard or Patrol) and its `minTeam`. Each tier has pools of them per Hall kind.
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
Each Stage is one chat, solo and offline until Stage 7. Determinism tests run from Stage 1: same seed, same bytes; whole Floors hashed in slow tests.

### Stage 0: spike and ADR
**Model**: Opus.
- Hand-write a Map Source of about 20 Enclosure rooms and passages on one 150 m level. Measure `compileMap`, `walkCheck`, the navmesh build, and a destination field per post plus a moving one, on a slow machine profile. Budget: a Floor ready during the fade (`hallFadeSeconds`, or a longer loading banner if it must be).
- Measure the Tick: about 100 Soldiers in Warbands plus a 16-slot Pool, solo. It decides whether a Run must take a Battle's Input Delay online (ADR 0025).
- Write ADR 0028 ("A Floor is one continuous Arena with a Crowd"), superseding the relevant part of `dungeon.md`.
- **Done**: numbers in the Result and the ADR merged; a go or no-go on the large Floors.

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
- Enemy max HP is scaled by humans (`perPlayerHp`) and tier.
- **Done**: a solo Run is playable end to end against Warbands; a slow soak of AI-driven Runs shows no stuck Warbands (time out of place measured, as in battle-objectives Stage 3b).

### Stage 4: loot, Treasure Halls and Boss Floors
**Model**: Sonnet.
- A wiped Warband drops one item per Player where its last Soldier fell. Treasure Halls hold pedestals (pick 1 of 3). Elite Warbands carry Relics and drop them.
- Boss Floors: the Boss Hall and its gate before the Stairs, the Boss Encounter as full Fighters from the start (open question 1), and a full heal after the Boss.
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
- Up to four Players in a Rollback session. Input Delay as a Battle's if Stage 0 says so. AI Takeover marks a Player away (no Stairs count, no fire, no pickups). Loopback tests and a four-Player soak. `PROTOCOL_VERSION` + 1 if the Intent or session messages change.
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

## Open questions
1. **Boss Floors:** is the Boss a Warband of promoted Soldiers, or always full Fighters (Encounter as today, Benched slots)? Is there a gate on the Stairs until it falls, or a separate small Boss Arena after the last Stairs?
2. **Difficulty with party size:** besides `perPlayerHp`, should more Players mean more Warbands, bigger ones, or neither?
3. **Revive pacing:** should a fire revive only once per fire, and should a fallen Player's Inventory stay as it is (yes today)?
4. **Do Warbands stay dead?** Yes on that Floor, presumably, with no respawns.
5. **Floor count per tier and tier count**: 3 × 3 to start?
6. **Fog in the world:** should the 3D view also dim or hide unrevealed Halls, or is the fog only on the maps?
7. **Lobby:** does the Gauntlet still require the Random Map (its seed is the Run seed), or does it get a seed field of its own?
