# Gauntlet mode: a Run of Floors on Generated Arenas, solo or online co-op

> Status: plan, not started. The decisions below are proposed answers to the brainstorm's open questions; confirm or change them before Stage 1. Builds on the Generated Arenas (`docs/plans/generated-arenas.md`, Stages 1–6 done).

## Context
You, alone or with up to two other humans online, fight through a series of enemy groups. Clear one and you move on to the next, on a new Generated Arena, until your Team is wiped out or you beat the final boss.

What the code already gives us, and the plan relies on:
- **A Match is a pure function of its options, its Lineup, the Intents and Tuning Data** (ADR 0001). `stepMatch` (`src/sim/match.ts`) already moves from one Duel to the next inside the Simulation (`nextDuelTick`), and a Rematch already moves to another Arena by name (`MatchState.arena`, `nextArenaName`).
- **A Generated Arena is built from its name alone** (`gen:<kit>:<seed>`, ADR 0014). `arenaOf` builds a name it does not hold lazily, through a pure cache, so the Simulation can switch Arenas mid-Match and every peer builds the same one. The game warms the next one ahead of the Tick that needs it (`warmNextArena` in `src/game.ts`).
- **The Renderer draws whatever Arena the current Match state names** (`renderer.ts` calls `stage.setArena(curr.arena, …)` every frame), so an Arena change between Duels draws without new work.
- **AI Fighters run on every peer** (ADR 0005), and their memory is snapshotted for Rollback and sent on a resync.
- **Online already supports Players as allies** on one Team, relayed through the host (ADR 0010), with an AI Takeover when a guest leaves.

What a Match cannot do today, and the Gauntlet needs:
- **The set of Fighters is fixed for a Match.** Intents, AI Controllers, Players' Fighters and the session's bookkeeping are all indexed by Fighter, so a Floor cannot add or remove one.
- **Every Duel resets every Fighter** (`freshDuel`): full HP, the Match's Weapons, the Arena's spawns.
- **Max HP is one Tuning Data number** (`fighter.maxHp`) for everyone.
- **An AI Controller's difficulty is fixed when it is made** (`lineupAis`), and a Controller only sees `SimState`, not `MatchState`.

## Design in one paragraph
A **Run** is a Match in Gauntlet mode: a fixed set of Fighters for its whole length, Team 0 being the Players and their AI allies, Team 1 always MAX_TEAM_SIZE enemy slots. Each **Floor** is one Duel of the Run, fought on its own Generated Arena (floor 1 on the Lobby's Random Map seed, each next Floor on the next seed, `nextArenaName`), against the enemies Tuning Data lists for that Floor (`data/gauntlet.json`). Enemy slots a Floor does not use are **Benched**: out of that Duel, not simulated, not drawn. When Team 0 wins a Floor, `stepMatch` builds the next Floor after a pause, carrying each survivor's HP (plus a heal) and bringing fallen teammates back at reduced HP. The Run ends when Team 0 is wiped out or the last Floor (the boss) is cleared. The whole Run is a pure function of the Run's options, the Lineup and Tuning Data, so online co-op sends nothing new during play: the only new data on the wire is the Gauntlet's options in the Lobby and the start message, plus the Run's state inside `MatchState` on a resync.

## Decisions (proposed: confirm before Stage 1)
- **Names:** **Run** (the whole gauntlet: one Match in Gauntlet mode) and **Floor** (one Duel of a Run). **Benched** for an enemy slot a Floor leaves empty. **Match Mode** stays as is; the Lobby gains a **Format** setting: Duels (best-of-N, today) or Gauntlet. Added to `CONTEXT.md` in Stage 1.
- **A new Generated Arena every Floor.** That is what the random levels are for. Floor 1 is the Lobby's Random Map (`gen:<kit>:<seed>`), Floor n is `nextArenaName` applied n − 1 times. So the Map seed *is* the Run seed: typing a seed in replays the same Run, and friends can share one. Gauntlet requires a Random Map (the Lobby hides the hand-made Maps in Gauntlet). Every Floor uses `DEFAULT_GEN_PARAMS`; a bigger boss Arena is Later (it needs the name to carry params, and a `GENERATOR_VERSION` bump).
- **Enemies come from Tuning Data, not random generation (v1).** `data/gauntlet.json` lists each Floor's enemies (difficulty, Weapon, Body, HP scale). A Weapon or Body may be `"random"`, picked by a pure hash of (Run seed, Floor, slot), so a Run seed always gives the same enemies. Fully random rosters are Later.
- **Enemy HP scales with the number of humans.** Each enemy's max HP is `fighter.maxHp × hpScale × (1 + perPlayerHp × (humans − 1))`, `perPlayerHp` 0.5 to start (Tuning Data): solo 1×, two humans 1.5×, three 2×. `humans` is the number of human Players in the Lineup when the Run starts; AI allies do not count. It stays fixed for the whole Run: a guest who leaves (AI Takeover) does not lower it, so no peer's Floors change mid-Run. Enemy counts stay as listed (scaling them is Later).
- **Run length:** 7 Floors, the 7th the boss. Tuning Data, so it can change without code.
- **HP carries over.** A survivor starts the next Floor with `min(maxHp, hp + heal × maxHp)`, `heal` 0.3. A fallen teammate (co-op or AI ally) sits out the rest of its Floor and comes back on the next at `revive × maxHp`, `revive` 0.4. No cost.
- **Throwing Daggers refill every Floor** (3 each, as every Duel today). Simplest, and keeps the dagger game alive.
- **A draw is a loss:** if the last Fighters of both Teams fall on the same Tick, Team 0 has not cleared the Floor.
- **The boss (v1):** a Hard AI with the Sledge Hammer, 3× HP, wearing the wraith Body, alone or with one Normal add. Needs per-Fighter max HP and nothing else. Phases and a bigger Skeleton are Later.
- **Co-op size:** Team 0 holds 1 to 3 Fighters (MAX_TEAM_SIZE, and a Generated Arena has three spawns a Team), so at most **3 humans** in a Run; empty Team 0 Seats may be AI allies. A Room of four cannot start a Gauntlet (the host's Format choice says why). Raising the cap is Later.
- **No Rematch.** A Run ends on a results screen (Victory or Defeat, Floors cleared, time, the Run seed). Offline: back to the Skirmish Lobby. Online: the host starts a new Run from the in-game menu (Restart, which moves to the next seed as a Random Map does today) or goes back to the Lobby. `rematchTicks` is null for a Run.
- **A guest who leaves mid-Run** is taken over by a Normal AI for the rest of the Run, exactly as in a Match today (ADR 0010). The host leaving ends the Run.

## How it fits the existing code

### The Run inside `MatchState` (pure, rollback-safe)
- `MatchConfig` gains `format: 'Duels' | 'Gauntlet'` (default Duels). For Gauntlet, `bestOf` is ignored and `teams` must be Team 0's 1–3 Fighters followed by exactly MAX_TEAM_SIZE Team 1 slots.
- `MatchConfig` also gains `humans` (1 to 3 for a Run): the number of human Players, which today only the Lineup knows. `lineupMatch` fills it from `lineupPlayers(lineup)`, so every peer, building the Match from the same Lineup, gets the same number. `createMatch` checks it is 1 to Team 0's size.
- `MatchState` gains `run: RunState | null`: `{ floor, floors, cleared, startTick }`. `hashValue` and `snapshot` cover it like the rest of the state, so Rollback and resync carry it.
- `SimState` gains `floor?: number` (the Floor this Duel is), so a Controller, which only sees `SimState`, can tell Floors apart.
- `stepMatch`, Gauntlet branch:
  - When a Floor's Duel ends with Team 0 the winner and Floors left: `nextDuelTick = tick + interFloorTicks` (`gauntlet.interFloorSeconds`, at least as long as the Final Blow Shot needs, as `match.interDuelSeconds` is today).
  - On `nextDuelTick`: `floor + 1`, `arena = nextArenaName(match.arena)`, and the Duel is `floorDuel(tuning, config, run, previousDuel, arena)`, carrying the generator (`rng`) on as `freshDuel` does.
  - When Team 0 loses (or draws) a Floor, or clears the last one: `status: Over` (winner 1 or 0), a `RunEnd` event with Floors cleared.
- `floorDuel` replaces `freshDuel` for a Run. Per Fighter: Team 0 HP from the previous Duel (heal or revive, as above), Team 1 from the Floor's roster (its Weapon, and max HP scaled by `hpScale` and the number of humans, as in Decisions), every Fighter drawn (not Sheathed), daggers refilled, at the Arena's spawns. A Team 1 slot the Floor has no enemy for is Benched.

### Benched slots
- `FighterState` gains `benched?: true`, set only at a Floor's start. A Benched Fighter has 0 HP and no `death`, stands at its slot's spawn, and is treated everywhere as out of the Duel: not stepped, never hits or is hit, never blocks bodies, never a target (the AI's enemy and threat choice), not counted by `updateDuel`, not drawn, no HUD bar, no Death Ragdoll, no Final Blow Shot.
- Implementation: one helper, `inDuel(f)`, and every place that today checks `f.death` or `f.hp > 0` to skip a fallen Fighter goes through it. A test per kind of check (body collision, Blade Sweep, dagger, Kick, AI targeting, Duel end) proves a Benched Fighter is invisible to it.

### Per-Fighter max HP
- `FighterState` gains `maxHp` (default `fighter.maxHp`). The six places that read `tuning.fighter.maxHp` (HP clamps, the HUD bar, AI HP judgement) read the Fighter's own. Duels mode is unchanged: every Fighter gets the Tuning Data value.

### Tuning Data: `data/gauntlet.json` (hashed)
```json
{
  "interFloorSeconds": 5,
  "heal": 0.3,
  "revive": 0.4,
  "perPlayerHp": 0.5,
  "floors": [
    { "enemies": [{ "difficulty": "Easy", "weapon": "random", "body": "random" }] },
    { "enemies": [{ "difficulty": "Easy", "weapon": "random" }, { "difficulty": "Easy", "weapon": "random" }] },
    { "enemies": [{ "difficulty": "Normal", "weapon": "random" }, { "difficulty": "Easy", "weapon": "random" }] },
    { "enemies": [{ "difficulty": "Normal", "weapon": "random" }, { "difficulty": "Normal", "weapon": "random" }] },
    { "enemies": [{ "difficulty": "Hard", "weapon": "random" }, { "difficulty": "Normal", "weapon": "random" }] },
    { "enemies": [{ "difficulty": "Normal", "weapon": "random" }, { "difficulty": "Normal", "weapon": "random" }, { "difficulty": "Normal", "weapon": "random" }] },
    { "boss": true, "enemies": [{ "difficulty": "Hard", "weapon": "Sledge Hammer", "body": "wraith", "hpScale": 3 }, { "difficulty": "Normal", "weapon": "Arming Sword" }] }
  ]
}
```
Numbers are starting points, tuned in Stage 3. The parser checks every difficulty and Weapon exists, 1 to MAX_TEAM_SIZE enemies a Floor, and at least one Floor. `perPlayerHp` must be 0 or more. Scaling a Floor's enemy count with the number of humans is Later.

### AI per Floor
- Enemy slots keep one Controller each for the whole Run (the session and `playerVsAi` stay indexed by Fighter), but the Controller is a **Floor AI**: it reads `state.floor`, takes that Floor's difficulty for its slot from `gauntlet.json`, and keeps one `AiController` per difficulty. When `state.floor` differs from the Floor it last saw, it starts that Floor's AI from fresh memory. Its `save`/`load` carry the Floor it last saw plus the inner AI's memory, so Rollback across a Floor change and a resync both restore it exactly. A Benched slot's Floor AI returns `IDLE_INTENT`.
- Team 0's AI allies are ordinary AI Controllers; a taken-over guest gets the usual Normal AI.
- `lineupAis` builds Floor AIs for Team 1 slots when the Match's format is Gauntlet. Nothing else in the session or driver changes.

### Arena warming
- Building a Generated Arena (and its navmesh) takes a few hundred ms. Today `warmNextArena` builds the next one while a Match's result shows. For a Run, the game warms the next Floor's Arena and its navmesh as soon as a Floor ends (the Floor's last Fighter falls), well inside `interFloorSeconds`, on every peer. Better still: warm it during the Floor's first seconds, so a slow device is never late. Either way the Floor-change Tick, and any Rollback re-simulating it, only reads the cache.
- A guest that resyncs into the pause before warming builds the Arena inside the Tick: slow, but identical (as for a Rematch today).
- The cache keeps 8 names; a Run only ever needs the current and next.

### Lobby and Skirmish
- `LobbySettings` gains `format: 'Duels' | 'Gauntlet'`. In Gauntlet:
  - The Map must be Random (hand-made Map cards hidden; picking Gauntlet with a hand-made Map selected switches to Random with a fresh seed). The Random card's label reads "Run seed N".
  - Team 1's Seats are hidden: the Lineup fills Team 1 with MAX_TEAM_SIZE Floor AI slots. Team 0 shows its three Seats; Players can sit only there. Best of N is hidden.
  - Online, a new Room in Gauntlet opens two Open Seats beside the host. Switching an existing Lobby to Gauntlet moves every seated Player to Team 0, and is refused (with the reason shown) if that would put more than three Fighters on it.
- `lobbyLineup` builds the Gauntlet Lineup; `checkLineup` accepts it.

### Online co-op
- **Nothing new during play.** Every peer builds each Floor (its Arena, its enemies, carried HP) from the Run options, the Lineup and Tuning Data; the only Intents on the wire are still the Players'. Checksums cover `MatchState.run`, the Benched flags and per-Fighter max HP, so any drift between peers shows up as a Desync and is resynced from the host.
- **Messages:** the Lobby message's `LobbyState.settings` gains `format`; the start message's `MatchOptions` gains `format` and `humans`; a resync's `MatchState` gains `run`, `floor` and the new Fighter fields. Each is checked by its validator in `src/net/messages.ts` (a guest refuses a format it does not know, or a Gauntlet with a hand-made Map). `PROTOCOL_VERSION` goes up by one, so peers on different builds refuse each other.
- **Tuning Data:** `gauntlet.json` is part of `tuningDataHash`, so peers with different Floors refuse each other at connect.
- **AI Takeover mid-Run** works as today: the Fighter is a Team 0 slot, its takeover AI is an ordinary Normal AI that lasts for the Run. A guest who joins mid-Run waits for the next Run.
- **A fallen Player spectates** with the orbit camera (as a fallen Fighter does today) until the next Floor, where they come back at `revive` HP.
- **Restart/new Run:** the host's Restart starts a new Lobby generation on the next seed (`nextMatchArena`, as a Random Map does), so the next Run is a different one.

### HUD and presentation (render only)
- Floor banner at each Floor's start: `Floor 3 / 7 · seed N`, and `Boss` on the last.
- HP bars show the Fighter's own max HP; the boss's bar is wider.
- Results screen at Run end: Victory or Defeat, Floors cleared, Run time, the Run seed (to replay or share).
- The Final Blow Shot plays at each Floor's end as at each Duel's end; the Arena switches only on the next Floor's first Tick, after the shot.
- The in-game menu names the Floor and the Arena being played.

## Stage 1: the Run in the Simulation (no UI)
- `data/gauntlet.json` and its parser, in `tuningDataHash`.
- `MatchConfig.format`, `MatchState.run`, `SimState.floor`, `FighterState.maxHp` and `benched`, `inDuel`, `floorDuel`, the Gauntlet branch of `stepMatch`, `RunEnd` event.
- The Floor AI Controller; `lineupAis` uses it for a Gauntlet's Team 1.
- `CONTEXT.md`: Run, Floor, Benched, Format; Match, Duel and Death entries updated to mention the Run.
- **Tests:**
  - A Run is deterministic: the same options give equal `hashValue` at every Tick; a Run seed gives the same Floor Arenas and enemies every time.
  - Floor change: Arena is the next seed, HP carried with the heal, a fallen teammate revived at `revive`, daggers refilled, unused enemy slots Benched.
  - A Benched Fighter is invisible to collision, Blade Sweep, daggers, Kicks, AI targeting and `updateDuel`.
  - Loss on a wipe, loss on a draw, win on the last Floor; `RunEnd` with Floors cleared.
  - Enemy HP scaling: with 1, 2 and 3 humans in the Lineup, each enemy's max HP (and starting HP) is `maxHp × hpScale × (1 + perPlayerHp × (humans − 1))`; AI allies do not change it; the boss's `hpScale` multiplies with it.
  - Floor AI: memory reset at a Floor change; `save`/`load` across a Floor change gives the same Intents (Rollback).
  - Duels mode is untouched: existing Match tests pass unchanged, and an existing replay plays back identically.
- **Soak:** AI vs AI Runs (three Hard allies vs the Floors) across 50 seeds: every Run ends, how far Runs get, how long Floors take, any Floor that hangs (enemies never reaching Team 0).

## Stage 2: Gauntlet in Skirmish (offline, playable)
- Lobby `format`, the Gauntlet Lobby rules above, the Skirmish Lobby view (Format toggle, Team 1 hidden, "Run seed").
- Arena warming for the next Floor; HUD Floor banner, per-Fighter HP bars, results screen; the Renderer hides Benched Fighters.
- **Tests:** Lobby rules (Gauntlet forces a Random Map, Players only on Team 0, the Gauntlet Lineup), the Arena worlds across a Floor change, Lobby view.
- **Check in `npm run dev`:** Skirmish → Gauntlet → Fight; play through at least three Floors, a death, and a full Run with AI allies; the Floor change shows no hitch.

## Stage 3: GATE, tune the Run
- Play Runs solo and with AI allies, and tune `gauntlet.json` (enemy counts, difficulties, heal, revive, Run length, boss HP) until a Run feels like it builds to the boss. Record what changed and why in a Result section here.
- Tune `perPlayerHp` with two and three humans (online, in Stage 4's checks, if not before): a co-op Run should be about as hard as a solo one. Decide from play whether enemy counts should scale too (Later, below).

## Stage 4: online co-op
- Lobby message, start message and resync carry the new fields; validators; `PROTOCOL_VERSION` + 1.
- The online Lobby view's Gauntlet rules (two guest Seats on Team 0, the four-Member refusal).
- Warming on every peer; the results screen online, and the host's Restart onto the next Run seed.
- **Tests** (memory transport, latency and jitter, as `src/net/randomMap.test.ts`):
  - Two and three Players with one-hit enemies play through Floor 1 → 3: every checksum on every peer equals the Run stepped offline, and every peer built each Floor's Arena itself (different objects, equal hashes).
  - A guest leaves on Floor 2: AI Takeover on every peer, the Run goes on, checksums agree, and Floor 3's enemies still have the HP of the Run's starting number of humans.
  - Every peer's enemies have the same scaled HP (from `config.humans`, which the start message carries inside the Match options).
  - A guest forced to resync during the pause between Floors (before warming) catches up with no Desync after.
  - A Rollback that crosses a Floor change (a late Intent from the Tick before it) re-simulates to the same state.
  - A guest with a different `gauntlet.json` is refused at connect; one with the old protocol is refused.
- **Check in `npm run dev`:** a two-tab and a three-tab Room play a full Run; host's and guests' Match states equal at every sampled Tick across Floor changes; a guest closes its tab mid-Run and the Run goes on.

## Stage 5: the boss and polish
- The boss Floor's presentation: `Boss` banner, wider bar, the wraith Body, a short pause before the boss Floor.
- Results screen polish (per-Player stats: damage dealt, Floors survived), thumbnails for the Format card.

## Later
- **Waves within a Floor:** more enemies than MAX_TEAM_SIZE, a Benched slot coming in when another falls. The Benched flag is the hook: unbenching a slot mid-Floor at the next free spawn.
- **More enemies per human:** extra enemies (or waves) per Player, beyond the HP scaling of v1.
- **Boons between Floors** (pick one of three): a choice is an input, so it must travel as an Intent during the pause between Floors. Real protocol work.
- **Elite enemies:** more HP, faster Wind-up, always Chambering.
- **Random rosters** from the Run seed, by tier, instead of the hand-written list.
- **Floor-specific generator params** (a bigger boss Arena, more levels deeper in): the Arena name has to carry them (`gen:<kit>:<seed>:<params>`), with a `GENERATOR_VERSION` bump.
- **Themed Kits per Floor depth** (once there is more than greybox).
- **Four humans in a Run** (raise Team 0's cap, and the generator's spawns, for Gauntlet).

## Open questions
- Confirm the Decisions above, especially: a new Arena every Floor; HP carry-over numbers; daggers refilled; 7 Floors; 3 humans at most.
- Should the host be able to pick a starting Floor (practice the boss), dev only or for everyone?
