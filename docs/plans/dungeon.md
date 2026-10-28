# Dungeon: the Gauntlet's next version, a seeded map of rooms

> Status: Stage 1 done (Halls and Floors in the Simulation, playable in Skirmish offline with placeholder presentation: Stage 1, Result); Stage 2 (loot) is next. The Decisions were confirmed one by one before Stage 1. Stages 1 to 5 below, solo first; stop after Stage 5 for player feedback. Builds on the Gauntlet v1 (`docs/plans/gauntlet.md`, Stages 1, 2 and 4 done) and the Generated Arenas (`docs/plans/generated-arenas.md`).

## Context
The Gauntlet v1 Run is a straight line of Floors: one Duel each, on its own Generated Arena, against the enemies `data/gauntlet.json` lists. We want a dungeon crawler, solo or co-op: a randomly generated dungeon with rooms, enemies and loot, instead of separate duels.

## Decisions
- **Rooms are separate Arenas joined by doors, not one continuous Arena.** Each room is its own small Generated Arena; the dungeon is a seeded map of rooms (a graph), not one big mesh. A fight in a room stays one Duel: at most four enemies (MAX_TEAM_SIZE), a navmesh within ADR 0014's budget, ending when a Team is wiped out. One continuous Arena with many rooms (enemies waking as you near, many asleep Fighters outside the Simulation, a navmesh per room) was weighed and left for Later: it breaks the four-slot Team 1, the 7 × 7 footprint and the 40 jump Link budget at once, and the room map can grow into it.
- **It is the Gauntlet's next version, not a new Format.** The Gauntlet Format stays; its Run becomes a walk through a dungeon. A v1 Run is the special case of a dungeon with one straight path, and is replaced, not kept beside it (below).
- **Two levels: Dungeon → Floor → Hall.** A Run walks a **Dungeon**: a few Floors (3 to start, Tuning Data), each harder than the last. A **Floor** is a small branching graph of Halls (about 10, Floor graph below), from an entrance to a Boss Hall; clearing the boss takes the Run down to the next Floor. A **Hall** is one node: one Generated Arena, with a kind (Fight, Elite, Treasure, Rest, Boss; Shop is Later, with Gold). Clearing a Hall opens its doors to the next ones, with a choice of route at most of them. A v1 Run is one Floor of seven Fight Halls in a line.
  - Names: **Dungeon** comes off the Run's _Avoid_ list. **Floor** changes meaning, from one Duel to one depth of Halls. **Hall**, because Room is the online connection, Chamber a combat term, Cell the generator's grid. As with the Gauntlet, `CONTEXT.md` changes with the code that makes it true: Stage 1 added Dungeon, Floor (new meaning), Hall, Door and Encounter; Relic and Inventory wait for Stage 2.
- **Every choice is made by walking, never by menu.** Doors, loot and Rest spots are places in a Hall that the Simulation checks, not prompts. A cleared Hall opens its doors, each marked with the kind of Hall behind it; the party leaves through one when every living Player has stood in its zone for a moment (about 1.5 s, Tuning Data), and the AI allies follow. Choices follow from positions, which follow from Intents (ADR 0001), so they roll back and resync like everything else, and a Run still puts nothing new on the wire during play. A menu vote was weighed and turned down: each pick would be a new reliable message with its own Rollback handling, plus tie and no-vote rules. Cost: the Hall generator must place doors on an Arena's edge (a Generated Arena is open to the Abyss all round today) and the Arena data needs door zones.
- **Each Player gets their own loot.** A pickup is per Player: each Player sees and takes their own copy, so co-op never races for it. What a copy holds is a pure hash of (Run seed, Hall, Player), so every peer agrees.
- **Loot is Weapons and Relics; no Gold (so no Shop Halls in v1).** A Weapon found is a Weapon of the roster exactly as tuned: no variants, no affixes, nothing that changes its Motion or Tempo. A **Relic** is a passive modifier from a list in Tuning Data, applied in the Simulation. Gold, Shops, consumables and armour are Later. This changes the Weapon rule (today chosen before the Match and kept across Duels): in a Run, the Weapon a Fighter holds can change between Halls.
- **Players have an inventory: they can equip and drop items.**
  - **Only while no enemy is alive in the Hall** (a cleared Hall, a Treasure or Rest Hall). In a fight a Fighter plays with what it has equipped; a Weapon swap is never a combat move (no swap Motion; Sheathe and Draw stay what they are).
  - **It holds 1 equipped Weapon and 2 carried, 3 equipped Relics and 3 carried** (Tuning Data). Only equipped Relics take effect, so the slots are the build.
  - **Equip and drop travel as Intent fields** (`equip`, `drop`, by slot), simulated and rolled back like any key; the inventory screen is render only. Nothing new on the wire but the Intent's shape (`PROTOCOL_VERSION` + 1).
  - **A dropped item lies in the Hall as a shared pickup** any Player may take: the one exception to loot per Player, and how a Player hands a teammate a Weapon. It is gone when the party leaves the Hall.
  - **AI allies get no loot** and keep what they started with; nothing has to teach the AI an inventory.
- **A Relic is pure data: a name, an icon and a list of effects from a fixed vocabulary** the Simulation implements, so new Relics are Tuning Data, not code. A Fighter's equipped Relics are applied to its own numbers at each Hall's start and on each equip, and the result is kept in `FighterState` (hashed, rolled back). The v1 vocabulary:
  - `maxHp` +% (the Fighter's own max HP, already per Fighter since the Gauntlet)
  - `damage` × (its Weapon's blade damage), `heavyDamage` × (Heavy Blows only)
  - `damageTaken` × (Hits it takes), `blockImpactTaken` × (Block Impact it takes)
  - `daggers` + n (`dagger.count`), `daggerDamage` × (`dagger.damage`)
  - `kickDamage` × (`kick.knockdownDamage`)
  - `healOnKill` + HP (its Hit causes a Death), `healOnClear` + % (a Hall is cleared)
  - **No Motion, Tempo or walk speed effects**, as for Weapons: how a Fighter moves stays readable, and the AI's Reaction Time stays fair.
  - Multipliers multiply, additions add; the same Relic may be equipped twice.
  - **Enemies can carry Relics.** An Elite is an ordinary enemy with one or two; beating it drops one.
- **Four Weapons are enough for now.** Growing the roster (each needs a model and Motion tuning) is not part of this plan; a Run's variety comes from its Relics.
- **HP is the resource a Run manages.**
  - **No heal between Halls:** HP carries as it is. Healing comes from Rest Halls (+50% of max HP, Tuning Data, taken per Player by walking to the fire), from Relics, and from a full heal after each Floor's Boss.
  - **A fallen teammate comes back in the next Hall at 25% of max HP**, not the next Floor: in co-op, waiting a Floor would be minutes. It watches with the orbit camera until then.
  - **A fallen Fighter keeps its inventory:** nothing drops, no corpse-run.
  - **A wipe ends the Run** (a Defeat, as in v1). No saving mid-Run.
- **A Hall's enemies come from hand-written Encounters, picked by seed.** An **Encounter** is one group of 1 to 4 enemies in Tuning Data, each with its difficulty, Style, Weapon (or `random`), HP scale and `minTeam`, as a v1 Floor's list is. Each Floor has a pool of Encounters per Hall kind (Fight, Elite), harder deeper in the Dungeon; an Elite Encounter gives an enemy one or two Relics. Each Floor has its own Boss Encounter (three bosses, the wraith the last). A pure hash of (Run seed, Floor, Hall) picks a Hall's Encounter, avoiding repeats within a Floor where it can. Enemy max HP scales with the humans, as in v1 (`perPlayerHp`), and a little with the Hall's depth within its Floor, so the Halls just before the Boss are the hardest. Fully random groups are Later: varied, but hard to balance.
- **A Hall's Arena is a Generated Arena with doors, and a door is an alcove, not a passage.**
  - **Door** is a new Piece of the Kit: a doorway in a Wall on an edge cell, with a door zone on the ground before it. Nobody walks through it: standing in the zone (once the Hall is cleared) takes the party to the next Hall. No geometry changes during play (Walls stay fixed for an Arena, ADR 0006; a closed gate is only drawn closed), and no navmesh edge leaves the footprint.
  - **Spawns:** Team 0 starts at the door it came in by (which has no exit zone); Team 1 in the cell furthest from it by walking, as today. The judge (ADR 0014) adds: every door reaches every spawn by walking and dropping alone.
  - **The Arena's name carries its doors** (`gen:greybox:1234:d3`: one entrance and two exits), so every peer still builds it from the name alone. `GENERATOR_VERSION` goes up.
  - **Every Hall kind uses the same 7 × 7 footprint**, the Boss's included. Treasure and Rest Halls are the same Arenas with the chest or the fire in the middle and no Encounter. A bigger Boss Arena is Later.
  - Real passages (walking out of a Hall down a corridor) were weighed and turned down: they need geometry that opens during play, or navmesh edges off the footprint.
- **A Floor is a small layered graph: 5 rows, 2 to 3 Halls wide.** Row 1 is one entrance Fight Hall; rows 2 to 4 hold 2 to 3 Halls each; row 5 is the Boss Hall. Each Hall has 1 to 3 Doors to Halls in the next row; paths may cross, and every Hall is reachable. A Run visits 5 Halls a Floor (about 15 in all) out of about 10. Kinds by row, as weights in Tuning Data: row 1 always a Fight; rows 2 to 4 mostly Fights, with Elites (never in row 2) and Treasure Halls, and one Rest Hall always in row 4; row 5 the Boss. A pure hash of (Run seed, Floor).
- **Loot sources:** every Fight Hall drops one item per Player when cleared (mostly Relics, sometimes a Weapon); an Elite drops the Relic it carried plus one; a Treasure Hall offers each Player one of three items on pedestals (walking onto one takes it and closes the other two for that Player); a Boss drops two.
- **The whole Floor map is shown.** A map screen (render only, any time, on a key) draws the Floor's graph, the Halls visited and where the party stands; the Doors' marks name the Halls behind them. Seeing the whole map is what makes a route a plan, not a guess. Fog of war was weighed and turned down.
- **The Dungeon replaces the v1 Run; it is not kept as an option.** Floor changes meaning, and two meanings would live on in code and glossary. A Dungeon of one Floor with one Hall a row, all Fights, rebuilds a v1 Run as a test.
- **Tuning Data: `data/gauntlet.json` becomes `data/dungeon.json`** (Floors, row weights, Encounter pools, Bosses, heal and revive, inventory sizes), **and the Relics live in `data/relics.json`.** Both are in `tuningDataHash`, so peers with different Dungeons refuse each other.
- **Starting deeper in (a Floor, a row, a set of Relics) is dev mode only** (`devMode.ts`): essential for tuning the three Bosses, never a way to skip a Run. This settles the v1 open question.
- **Unchanged from v1:** the Lobby requires a Random Map and its seed is the Run seed; Team 0 holds 1 to 4 Fighters, empty Seats may be AI allies; no Rematch, a results screen at Run end; a guest who leaves is taken over by an AI, the host leaving ends the Run.

## Glossary (proposed, for `CONTEXT.md` in Stages 1 and 2)
- **Dungeon**: the seeded map a Run walks: its Floors, each a graph of Halls. A pure function of the Run seed and Tuning Data, so every peer builds the same one.
- **Floor**: one depth of a Dungeon: a branching graph of Halls from an entrance to a Boss Hall. _Avoid_: level, act, stage.
- **Door**: a Piece on a Hall's edge: a doorway in a Wall with a door zone before it, marked with the kind of Hall behind it. Every living Player standing in its zone, once the Hall is cleared, takes the party to that Hall. _Avoid_: exit, portal, gate.
- **Encounter**: one hand-written group of 1 to 4 enemies (each with difficulty, Style, Weapon, HP scale), in a Floor's pool for a Hall kind; the seed picks which one a Hall holds. _Avoid_: wave, squad, spawn group.
- **Inventory**: the Weapons and Relics a Player's Fighter holds, equipped or carried; changed only while no enemy in the Hall is alive. _Avoid_: bag, loadout.
- **Relic**: a passive modifier a Player finds and equips: a list of effects from a fixed vocabulary, applied to its Fighter's own numbers. Tuning Data. _Avoid_: perk, buff, boon, item (an item is a Weapon or a Relic).
- **Hall**: one node of a Floor, fought or visited on its own Generated Arena, with a kind (Fight, Elite, Treasure, Rest, Boss). A Hall with enemies is one Duel. _Avoid_: room (the online connection), chamber (a combat term), cell (the generator's grid), node.

## How it fits the existing code

What the v1 Run already gives us (`docs/plans/gauntlet.md`, Results): a Run inside `MatchState` (`run: RunState`), stepped by the Gauntlet branch of `stepMatch` (`src/sim/match.ts`); Benched Team 1 slots and `inDuel`; per-Fighter `maxHp`; Floor AIs that pick their difficulty from the Floor (`src/controllers/floorAi.ts`); a Run seed from the Random Map's name (`runSeed`, `runPick` in `src/sim/gauntlet.ts`); Run knobs from the Lobby (`applyRunKnobs`); the next Arena warmed after the Final Blow Shot (`warmArena`, `src/play/arenaWorlds.ts`); the Floor banner, per-Fighter bars and results screen (`src/play/hud.ts`).

What it cannot do, and the Dungeon needs:
- **A Duel ends when a Team is wiped out.** A Hall's Duel must go on after its Encounter falls (the party walks to a Door, takes loot), and a Hall with no Encounter (Treasure, Rest) has no one to beat.
- **The next Arena is known in advance** (`nextArenaName`). Now it hangs on the Door the party takes.
- **A Generated Arena has no Doors**, its name carries no settings, and its Team 0 spawn is wherever the generator put it.
- **A Fighter's Weapon is fixed for the Match**, and its numbers (damage, daggers, damage taken) are everyone's Tuning Data.
- **An Intent has no inventory actions.**

### The Run inside `MatchState`
- `RunState` becomes `{ floor, floors, row, hall, path, phase, doorTicks, startTick }`: where the party is (Floor, row, the Hall's index in its row), the Halls it has visited (for the map and results), `phase` (`Fighting` or `Cleared`), and how long the party has stood at each Door. Hashed and snapshotted as today.
- **The Floor graph is never stored**: `floorGraph(dungeon, runSeed, floor)` (`src/sim/dungeon.ts`, pure) rebuilds it from the seed whenever it is needed, like a Generated Arena from its name. Each Hall: its kind, its exits (indices into the next row), its Arena name (`gen:<kit>:<seed>:d<n>`, the seed a `runPick` of (Run seed, Floor, row, Hall), `n` its exits plus the entrance) and its Encounter (`hallEncounter`, a pick from the Floor's pool for its kind).
- `stepMatch`, Dungeon branch, replacing the v1 Floor branch:
  - **Fighting → Cleared** when Team 1 has no Fighter `inDuel` (at once for a Treasure or Rest Hall). The Duel does not end: Team 0 walks on. A `HallCleared` event (the Final Blow Shot plays on it, as at a Duel's end).
  - **Cleared:** each Tick, for each exit Door, if every living Player's Fighter stands in its zone, its `doorTicks` counts up, else back to 0. At `dungeon.doorSeconds` the party leaves: after a short fade (`dungeon.hallFadeSeconds`) the next Duel is `hallDuel(...)` on that Hall's Arena. Leaving the Boss Hall goes to row 1 of the next Floor; leaving the last Boss is a Victory.
  - **A wipe of Team 0** in any phase is a Defeat (`RunEnd`, Halls and Floors cleared).
- `hallDuel` replaces `floorDuel`: Team 0 at the entrance Door's spawns with the HP it had (a fallen Fighter at `dungeon.revive` of its max HP, a full heal after a Boss), Team 1 from the Hall's Encounter (Benched otherwise), max HP scaled by the humans and by the Hall's row (`dungeon.depthHp`).
- `SimState.floor` becomes `SimState.hall: { floor, row, index, kind, phase }`, so a Controller can tell Halls apart and see that a Hall is cleared.

### Hall Arenas: Doors in the generator
- **Name:** `gen:<kit>:<seed>:d<n>` (`parseGeneratedName` gains `doors`; a name without `:d` is a Random Map as today, no Doors). `GENERATOR_VERSION` 3.
- **Kit:** a `door` Piece in `greybox` (`art/build_kit_greybox.py`, `data/kits/greybox.json`): one edge cell, a Wall with a doorway along its outer side, a `DOOR_*` helper for the zone.
- **Layout:** `generateLayout` places `n` Doors on edge cells at ground level, spread round the footprint (Door 0, the entrance, first), each on a cell walking joins.
- **Assembly:** `ArenaGeometry` gains `doors: { zone: polygon, facing, spawns }[]`. Team 0's spawns are Door 0's (its four spawns in front of it); Team 1's are the cell furthest from Door 0 by walking. Door 0 has no exit zone.
- **Judge:** every Door's zone and spawns reach every enemy spawn by walking and dropping alone; Door zones are never deadly ground.
- **Warming:** once a Hall is cleared and its Final Blow Shot is over, the game warms every exit's Arena (two or three; the cache keeps eight), so the Hall change only reads the cache whichever Door the party takes. A Door is taken no sooner than `doorSeconds` after the party starts gathering, which covers a late warm on a slow device as the v1 pause did.

### AI in a Hall
- **Floor AI → Hall AI:** an enemy slot's Controller reads `state.hall` and takes its difficulty and Style from the Hall's Encounter, starting fresh memory whenever the Hall changes (as v1 does per Floor). Benched: `IDLE_INTENT`.
- **AI allies in a cleared Hall** walk to the Door with the most living Players in its zone (ties to the lowest index), else follow the nearest Player. They never count towards a Door, and never take loot.

### Loot and the inventory (Stage 2)
- `FighterState` gains `inventory: { weapons: string[], relics: string[], weapon: index, equipped: index[] }` (Team 0 Players only; empty otherwise) and `mods`: its equipped Relics folded into one record (`maxHp`, `damage`, `heavyDamage`, `damageTaken`, `blockImpactTaken`, `daggers`, `daggerDamage`, `kickDamage`, `healOnKill`, `healOnClear`), recomputed at each Hall's start and on each equip. Every place that reads those numbers reads the Fighter's own: the Hit in `combat.ts`, a Throwing Dagger's damage and count, a Kick's knockdown damage, a Block Impact. Team 1's `mods` come from an Elite Encounter's Relics.
- `weapon` stays a `FighterState` field, now changed by an equip; nothing reads the Match's Weapons after a Hall starts. A Weapon swap only in a cleared Hall, so never mid-Action.
- `MatchState.run.pickups`: this Hall's items `{ id, owner: player | null, item, at, taken }`. Fight, Elite and Boss Halls drop theirs at `HallCleared`; a Treasure Hall's three pedestals per Player stand from its start (taking one marks the other two taken). What each holds is `runPick(Run seed, Floor, row, Hall, Player, …)`. A dropped item is a pickup with `owner: null`. Cleared at each Hall change.
- A Fighter takes a pickup it owns (or a shared one) by standing on it with room in its inventory; a full inventory leaves it lying.
- **Intent:** `equip?: { kind: 'weapon' | 'relic', slot }` and `drop?: { kind, slot }`, acted on only in a `Cleared` Hall (or one with no Encounter). `isIntent` (`src/net/messages.ts`) checks them; `PROTOCOL_VERSION` 20.
- `data/relics.json` (`src/tuning/relics.ts`, hashed): each Relic's name, icon and effects; the parser checks every effect is in the vocabulary.

### Tuning Data: `data/dungeon.json` (replaces `data/gauntlet.json`)
```json
{
  "doorSeconds": 1.5,
  "hallFadeSeconds": 1,
  "revive": 0.25,
  "restHeal": 0.5,
  "perPlayerHp": 0.5,
  "depthHp": 0.1,
  "inventory": { "weapons": 3, "relics": 6, "equippedRelics": 3 },
  "floors": [
    {
      "rows": [2, 3, 2],
      "weights": { "Fight": 6, "Elite": 1, "Treasure": 1 },
      "encounters": {
        "Fight": [{ "enemies": [{ "difficulty": "Easy", "weapon": "random" }] }],
        "Elite": [{ "enemies": [{ "difficulty": "Normal", "weapon": "random", "relics": 1 }] }]
      },
      "boss": { "enemies": [{ "difficulty": "Hard", "weapon": "Sledge Hammer", "hpScale": 2.5 }] }
    }
  ]
}
```
`rows` are the widths of rows 2 to 4 (row 1 and the Boss are one Hall each); Elites never in row 2; row 4 always holds one Rest Hall. Run knobs (`applyRunKnobs`) work on Encounters as they did on Floors. Numbers are starting points, tuned in Stage 5.

## Stage 1: Halls and Floors in the Simulation, solo, no loot
- `data/dungeon.json` and its parser (`src/tuning/dungeon.ts`) replace `gauntlet.json`; `floorGraph`, `hallEncounter`, the new `RunState`, `SimState.hall`, `hallDuel`, the Dungeon branch of `stepMatch`, `HallCleared`; v1's `floorRoster`/`floorDuel` go.
- The generator's Doors: the `door` Piece, `:d<n>` names, Door placement, `ArenaGeometry.doors`, the judge's rule, `GENERATOR_VERSION` 3.
- Rest Halls: a fire zone in the middle; a Player's Fighter standing in it once heals `restHeal` (per Player, once). Treasure Halls stand empty until Stage 2.
- Hall AIs; AI allies walking to the Door.
- Skirmish (offline only): the Gauntlet Format plays a Dungeon. Placeholder presentation: a text label over each Door (the kind behind it, and "2 / 3" while the party gathers), the banner "Floor 2 · Hall 3 / 5 · seed N", the Final Blow Shot on each clear, warming every exit.
- Dev mode: start at a Floor and row (`devMode.ts`).
- `CONTEXT.md`: Dungeon, Floor (new meaning), Hall, Door, Encounter; Run, Duel, Death, Benched and Generated Arena updated; Floor's _Avoid_ "room" kept, Run's "dungeon" removed. ADR 0019 Accepted.
- **Tests:**
  - A Run is deterministic: equal `hashValue` every Tick for the same Intents; a Run seed gives the same Floor graphs, Hall Arenas and Encounters every time.
  - `floorGraph`: 5 rows, widths from Tuning Data, every Hall reachable, 1 to 3 exits each, one Rest in row 4, no Elite in row 2.
  - Generator: every `:d<n>` seed in a soak passes the judge; Door 0 holds Team 0's spawns; Doors on the edge at ground level; a name without `:d` builds exactly the Arena it does today.
  - Hall flow: a cleared Hall stays in play; the party standing at a Door for `doorSeconds` moves on (one Player out of the zone resets it; an AI ally never counts; a fallen Player does not have to stand there); Boss → next Floor's row 1 with a full heal; last Boss → Victory; Team 0 wiped → Defeat; a fallen teammate back next Hall at 25%; a Rest heals each Player once.
  - Rollback across a Hall change re-simulates to the same state.
- **Check in `npm run dev`:** Skirmish → Gauntlet → a full Floor solo and with two AI allies, choosing different Doors on two Runs of the same seed; a death and a revive; a Rest Hall.

### Result (done)
Commits (on the integration branch from `7145646`): 3476fee (`data/dungeon.json`, its parser, `floorGraph`), e68f3c7 (Doors in the generator), 202dac7 (the Run walks Halls in `stepMatch`), 17b7e77 (dev start), 27f60bd (Hall AIs and Ally AIs), c69e398 (Skirmish and placeholder presentation), 923a5c7 (Hall AI wording), 4812ab4 (dev autopilot, for the check), a82604b (an HP text fix the check found), then this Result with `CONTEXT.md` and ADR 0019.
- **Tuning Data:** `data/dungeon.json` replaces `data/gauntlet.json` (deleted), parsed by `parseDungeon` (`src/tuning/dungeon.ts`) into `TuningData.dungeon`, part of `tuningDataHash`. Three Floors on the real difficulty ladder (Beginner, Skilled, Expert), not the plan's Easy/Normal/Hard example; every enemy `"style": "random"` but the first two Bosses. The parser also requires a Fight weight above 0 and a non-empty Elite pool when Elites are weighted, and refuses weights or pools for kinds never weighted (Rest, Boss). An enemy's `relics` (1 or 2) and `inventory` are parsed and not read until Stage 2. The Lobby's Run knobs work on every Encounter (`applyDungeonKnobs`, `dungeonDifficultyLadder`; the `heal` knob, now labelled "Rest Hall heal", sets `restHeal`), and `RANDOM_PICK` and `RunKnobs` moved into `src/tuning/dungeon.ts`.
- **The Floor graph** (`src/sim/dungeon.ts`, pure, never stored): `floorGraph(dungeon, runSeed, floor, kit)` and `hallEncounter` as planned, with `runSeed` and `runPick` moved here. Each Hall's Arena is `gen:<kit>:<seed>:d<n>`; the last Floor's Boss has no exit (`:d1`), the other Bosses one (`:d2`, to the next Floor's entrance).
- **Doors in the generator** (`src/sim/arenaGen/`): `GENERATOR_VERSION` 3; `parseGeneratedName` gives `doors` (0 without `:d`), `MAX_DOORS` 4. A `door` Piece in `data/kits/greybox.json` with its `zone`. The Layout places the Doors on edge cells (not corners) at ground level, spread round the footprint, rails flanking each and the three cells inward kept clear. `ArenaGeometry.doors` is `{ zone, facing, spawns }[]` (`[]` for every other Arena); Team 0's spawns are Door 0's, Team 1's in the cell furthest from it by walking. The judge's `doors` rule: the Door count the name asks for, every Door's zone and spawns reaching every enemy spawn by walk and drop Links, no zone over deadly ground. A Layout that comes up short of Doors (about 2 to 15 %, more with `:d4`) is rerolled by that rule: 1.6 to 1.9 attempts on average over 50 seeds × `:d1` to `:d4` (Random Maps about 1.5), every one passing. A name without `:d` builds exactly the Arena it did before.
- **The Run** (`src/sim/match.ts`, `src/sim/hall.ts`): `RunState` is `{ floor, floors, row, hall, path, phase, doorTicks, rested, startTick }` (`floor` 1-based, `row` and `hall` 0-based; `phase` `Fighting`, `Cleared` or `Leaving`). `SimState.hall` is `{ floor, row, index, kind, phase }`, and while it is there `updateDuel` ends the Duel only when Team 0 is wiped out. `MatchState.arena` is the current Hall's; `config.arena` only gives the Run seed and Kit and is never built. `hallDuel` and `hallRoster` replace `floorDuel` and `floorRoster`. The Dungeon branch of `stepMatch` (`stepRun`) is as planned: `HallCleared` (the Duel goes on; only the last Boss ends it, with a `DuelEnd`), `doorTicks` per exit, `DoorTaken` then the fade (`nextDuelTick`), `Rested`, and `RunEnd { winner, cleared, floors, halls }` on a wipe in any phase or the last Boss. `score[0]` counts Halls cleared, `duelNumber` Halls entered.
- **Hall AI and Ally AI** (`src/controllers/hallAi.ts`, `allyAi.ts`): the Floor AI renamed and keyed by Hall (`{ hall, memory }`, `isHallAiMemory`). Every Team 0 AI slot of a Run gets an Ally AI: its own AI while the Hall is Fighting; once Cleared it walks (the AI's navmesh `approach`, now `AiController.walkTo`, with a sidestep round a Fighter in the way) to a Team 0 spawn of the exit Door with the most living Players in its zone, else follows the nearest Player to 1.5 m. Over `gen:greybox:1` to `40` × every exit, Beginner, Hard and Expert allies all reached the Players' Door zone (worst 921 Ticks, about 15 s).
- **Skirmish** (`src/play/`, `src/render/hallMarks.ts`, `src/render/doorway.ts`): the Lobby offers Gauntlet offline only; its Floors card reads "3 Floors of Halls". `arenasToWarm` warms every exit Hall's Arena once the Final Blow Shot is over (the taken one first while Leaving); the Arena cache keeps eight, least recently used out. The Final Blow Shot plays on a Hall's clear, framing the last enemy to fall. The announcer says "Hall cleared" (not for Treasure, Rest or the last Boss) and "Rested". HUD: the banner "Floor 2 · Hall 3 / 5 · seed N" ("Boss · Floor 2 / 3"; a Treasure or Rest Hall prefixes its kind), the same top line, a label over each exit Door ("Elite", "Elite · 2 / 3" while gathering, "Floor N+1" after a Boss), a black fade between Halls, and "Halls cleared" on the results screen. The Renderer draws a greybox frame in each doorway, each exit's zone as a patch (grey, gold once Cleared) and a Rest Hall's fire as a disc and cone.
- **Dev mode** (`src/devMode.ts`): `?dev=1&floor=F&row=R&hall=H` (1-based) gives `MatchOptions.start`; `runPathTo` walks the lowest-index exits there and the Run opens in that Hall, its path, Halls cleared and Halls entered as if walked. `?dev=1&autopilot=D1,D2,...` puts the local Player's Fighter on a Hard AI that fights, takes a Rest fire and walks into exit Door Dr in row r (added for the check).
- **Deviations from the plan, and why:**
  - `floorGraph` takes a fourth argument, the Kit (the first Arena's): a Hall's Arena name needs one.
  - With no Player alive, the living AI allies count at a Door (and walk to the first exit); otherwise a Run whose Players have all fallen would hang. The plan said allies never count.
  - `MatchConfig.players` (the Players' Fighters, filled by `lineupMatch`) and `RunState.rested` were added, for "an AI ally never counts" and "a Rest heals each Player once".
  - The Rest fire is at the middle of the Hall's Team 1 spawns (a Rest Hall leaves them empty), not the Arena's centre, often a pillar top or a pit; the judge already proves those spawns reachable and safe.
  - Depth HP is `× (1 + depthHp × row)` with `row` 0-based (the plan's `row − 1` counted from 1); the Boss's row scales too (× 1.4).
  - A row 4 one Hall wide holds no Rest Hall (only a hand-built Dungeon has one), so a Dungeon of one Floor, one Hall a row, all Fights, rebuilds a v1 Run as the plan's test asks.
  - The `door` Piece was written into `data/kits/greybox.json` by the build script's own writer with Blender stubbed out; `public/models/kits/greybox.glb` was not rebuilt, so the Kit model has no door (a rail stands in) and a Door is seen by the Renderer's frame, until `art/build_kit_greybox.py` is run in Blender.
  - The fade is a HUD overlay, not drawn by the Renderer (which sees only the Duel), and the Door labels are HUD text projected from 3D, not in the scene. The HP bars and Door labels stay drawn over the fade (placeholder).
  - During a Hall's Final Blow Shot (3 s) the Run keeps running and the Player's input still drives the Fighter, unseen; v1 paused between Duels. Harmless with the enemies down.
  - The Ally AI walks by where Players and allies are now, not as seen Reaction Time ago: the fairness rule is about enemies.
  - Dev start is local only (Skirmish), and starts Team 0 at full HP.
  - `PROTOCOL_VERSION` stays 19: the new Tuning Data changes `tuningDataHash`, so old and new peers refuse each other at connect anyway.
- **v1 replaced:** `data/gauntlet.json`, `src/tuning/gauntlet.ts`, `src/sim/gauntlet.ts` and their tests are gone (`src/sim/dungeonRun.test.ts` replaces `src/sim/gauntlet.test.ts`, keeping its Benched and Duels-untouched tests). The online Run's net code and tests (`src/net/gauntlet.test.ts`) were moved to Halls and still pass, with a Tick wrapper standing the Players in exit 0's zone, though the Lobby no longer offers it.
- **Tests:** `src/sim/dungeon.test.ts` and `src/tuning/dungeon.test.ts` (graph shape over a seed soak, weights, Encounter repeats, Arena names; the parser), `src/sim/arenaGen/doors.test.ts` (Door placement, every `:d1` to `:d4` seed of a soak passing the judge, the judge's Door rules, the navmesh budget, a name without `:d` unchanged), `src/sim/dungeonRun.test.ts` (every Hall flow, end, determinism and Rollback-across-a-Hall-change test the plan lists; Door zones; Benched; Duels untouched), `src/sim/devStart.test.ts`, `src/controllers/allyAi.test.ts`, `hallAi.test.ts` and `autopilot.test.ts`, and the presentation's pure parts (`src/play/hud.test.ts`, `announcer.test.ts`, `finalBlow.test.ts`, `arenaWorlds.test.ts`, `lobbyView.test.ts`, `src/render/doorway.test.ts`). Some Hall flow tests, and the soak (`src/sim/gauntlet.soak.test.ts`, updated but not run for this Result), stand the party in a Door zone directly rather than walking it there. `npm test`: 1347 passed, 4 skipped (113 files passed, 4 skipped); `npx tsc --noEmit` green.
- **Checked in `npm run dev`:** Playwright in headless Chromium with SwiftShader at 640 × 400 (2 to 17 fps; the Simulation ran at a quarter to full real time), with a temporary, uncommitted hook to read the Match state, and the Player's Fighter on the dev autopilot in every Run. Run seed 4242 throughout; no console errors in any Run.
  - **A full Floor with two Hard AI allies:** Halls 1 → 2 → 3 → Rest → Boss → Floor 2's entrance, each with its banner and top line, and "Hall cleared" with the Final Blow Shot after each of the four fights (none in the Rest Hall). The Door labels named the Halls behind them, turned open once Cleared and read "Fight · 1 / 1" while gathering (the allies don't count while a Player lives); each Door was taken about 1.5 s after the gathering began. HP carried over (52 into Hall 2, still 52 at the Rest Hall); "Rested" took it to 100 (52 + 50 %, capped), the allies did not take the fire, and every Team 0 Fighter, a fallen ally too, started Floor 2 at 100. Enemy max HP by row 100 / 110 / 120, the Boss 350 (100 × 2.5 × 1.4).
  - **A full Floor solo:** on standard knobs the autopilot alone lost in Hall 1 to 3 on all five tries, so the solo Floor ran on the knobs Enemy skill "Easiest" and one enemy a Hall: the same path and Arenas as above, through the Boss to Floor 2.
  - **Different Doors on two Runs of the same seed:** taking exit 1 every time gave Arenas 72933 → 888730 → 1461 → 370880 (Rest) → 804308 (Boss); exit 2 gave 72933 → 759612 (Fight) → 865386 (Treasure, Cleared on arrival) → 56831 (Fight) → the same Boss, then the same Floor 2 entrance. The first Hall, its Arena and its enemy were the same in both.
  - **A death and a revive** (two Easy allies): a fallen ally came back in the next Hall at 25 / 100. Then the Player fell ("You fell"); the allies cleared the Hall, walked to a Door and were counted ("Fight · 1 / 2", then "2 / 2") since no Player lived, and the Player was back at 25 / 100 in the next Hall. A wipe in Hall 3 showed "Defeat | Floors cleared 0 / 3 | Halls cleared 2 | Run time 1:59 | Run seed 4242", and the Lobby the same line.
  - **A Rest Hall** by dev start (`floor=1&row=4&hall=1`): Cleared at once, the fire drawn, "Rested", then the fade and the Boss Hall.
  - **Dev start and Victory:** `floor=2&row=2` opened at Floor 2 Hall 2 and went on to Floor 3; `floor=3&row=5` (easy knobs) beat the last Boss with no "Hall cleared" and showed "Victory | Floors cleared 3 / 3 | Halls cleared 15 | Run time 0:21", the Halls counted as if walked and the time from the dev start.
  - Found and fixed: the HP bars read 111 for a 110 max HP (`100 × 1.1` is `110.00000000000001`, rounded up); the new `hpText` (a82604b) rounds first.

  Not checked: a human-driven Player (mouse turning under pointer lock at a few fps headless is impractical), so every Run here was the autopilot's; the solo Floor on standard settings (the autopilot alone loses it, so it ran on the easiest knobs, and whether a human can clear Floor 1 solo as tuned is open for Stage 5); warming's timing and cache hits in the browser (unit-tested only, and software rendering cannot show a hitch); the exact Door label positions over every doorway; the fade's curve (only its peak was seen; unit-tested); anything online.

## Stage 2: loot, Relics and the inventory
- `data/relics.json` and its parser; `FighterState.inventory` and `mods`; every read of damage, daggers, Kick damage and Block Impact through the Fighter's `mods`; `healOnKill`, `healOnClear`.
- Pickups: Fight, Elite and Boss drops, Treasure pedestals (one of three per Player), shared drops; taking by standing on it.
- Intent `equip`/`drop`, `isIntent`, `PROTOCOL_VERSION` 20; the Local Controller's inventory keys (placeholder: number keys equip, a key drops) acting only in a cleared Hall.
- Elite Encounters' Relics on Team 1, dropping one when beaten.
- Placeholder presentation: a pickup drawn only for its owner (shared ones for everyone), as a floating label; a text list of the inventory on a key.
- `CONTEXT.md`: Relic, Inventory; Weapon (in a Run it changes by equipping) and Fighter updated.
- **Tests:** each effect changes exactly its number and stacks as said (multipliers multiply, additions add); equip and drop refused while an enemy lives; a pickup taken only by its owner, a shared one by anyone, a full inventory leaves it; a Treasure Hall gives each Player one of three; pickups are the same for the same seed; Rollback over a pickup and an equip; an Elite's Relic dropped.

## Stage 3: presentation
- The map screen (render only, any time, on a key): the Floor graph, Hall kinds as icons, the path taken, where the party stands.
- The inventory screen (render only): slots, equipped marks, each Relic's icon and effects in words; equips and drops made from it become the Intent fields.
- Door marks (an icon above each Door for the kind behind it; a gate drawn closed until the Hall is cleared; "2 / 3" while gathering), pedestals, the Rest fire, pickups drawn as the Weapon or a Relic's icon.
- Results screen: Victory or Defeat, Floors and Halls cleared, time, Run seed, and each Player's build.
- Art: the `door`, pedestal and fire pieces in Blender, with the Kit.

## Stage 4: online co-op
- Gauntlet offered online again (as v1 Stage 4): Team 0 up to four Players.
- A pickup is drawn only for its owner on every peer; the Simulation already has it for everyone.
- Message validators for the new `MatchState` (`run`'s new fields, pickups, inventories, `mods`) on a resync, and the Intent fields; `tuningDataHash` covers `dungeon.json` and `relics.json`.
- **Tests:** a two- and a four-Player Run over the loopback transport with latency: Hall changes, Door gathering, pickups and equips all agree (checksums), across a resync; an AI Takeover mid-Hall (the taken-over Fighter keeps its inventory and stops counting at Doors).
- **Check:** a Floor with two browsers online.

## Stage 5: tuning
- The Encounter pools for three Floors, the three Bosses, the first ~15 Relics, `depthHp`, `revive`, `restHeal`, using the dev-mode start; the Run lasts about 20 to 30 minutes.

## Version 1: stop after Stage 5 and get player feedback
Things to learn: is a Run's length and difficulty right, solo and in co-op? Do routes feel like choices? Which Relics are taken and which never? Is walking to a Door clear, or does the party wait on someone? Do players miss Gold and Shops?

## Later
- Gold and Shop Halls; consumables (a use Intent); armour.
- A bigger Boss Arena, and Kits themed per Floor.
- Weapons beyond the four.
- One continuous Arena for a Floor (ADR 0019 says what it costs).
- Fog of war, if the full map makes routes too easy to plan.

## Open questions
- None open. Each Decision above was confirmed one by one; numbers are starting points for Stage 5.
