# Enemy Behaviours: Stage 0 implementation prompt

Paste this into a new session. It builds Stage 0 of `docs/plans/enemy-behaviours.md`: in dev mode, a Duel AI Seat can be set to any Delver Troop (a Prefab and one of its Variants) and fights as that enemy would on a Floor. The session stops after Stage 0. Stages 1 to 6 get their own prompts.

```
Implement Stage 0 of docs/plans/enemy-behaviours.md ("Fight a Troop in Duels (dev mode)"), and
nothing else. With ?dev=1, a Duel AI Seat can be set to any Delver Prefab and Variant (Boss
Variants included) and fights as that enemy would on a Floor: its Body, Weapon, HP, Size from HP,
tier (AI difficulty), Style, Mods and Relics. Quirks come in Stage 4: leave a clear place for them
in the Troop resolution, but add none now.

READ FIRST
- docs/plans/enemy-behaviours.md: all of it, Stage 0 in detail. Its Decisions are settled: don't
  re-litigate them.
- CONTEXT.md: Lobby, Seat, Lineup, Match, Duel, Fighter, AI difficulty, Style, Prefab, Variant,
  Troop, Delver Soldier, Size, Mods, Relic, Bubble, Promotion. Use its terms in code and comments.
- docs/plans/delver-troops.md: how Prefabs and Variants became Troops.
- The code:
  - Seat and Lineup: src/lobby/lobby.ts (Seat, setSeat, the Lineup built around line 346),
    src/controllers/lineup.ts (LineupSlot, Pilot, its validation around line 88).
  - Match: src/sim/match.ts (createMatch, MatchConfig, how per-Fighter `sizes` are carried and
    kept absent when standard: copy that pattern for HP, Mods and Body).
  - FighterState.maxHp in src/sim/state.ts, and setMods / foldMods in src/sim/mods.ts.
  - How a promoted Soldier is built: src/sim/delver/troops.ts (troopOf, sizeOfHp),
    src/sim/delver/warbands.ts (tierHp), src/sim/bubble.ts (foldMods over a Troop's mods and Relics,
    around line 245), src/tuning/delver.ts (DelverPrefab, DelverVariant, parseDelver).
  - Bodies: src/play/floorBodies.ts and wherever a Duel picks each Fighter's Body (an AI has none
    today, so it's drawn as a random one).
  - Lobby UI: src/play/lobbyView.ts (the AI Seat row around line 326, styleSelect, weaponSelect,
    sizeSelect), src/devMode.ts (devMode()).
  - Online: src/net/messages.ts (the Lobby and Lineup validators, around line 238), src/lobby/sync.ts.
  - Tests to extend: src/lobby/lobby.test.ts, src/lobby/sync.test.ts, src/play/lobbyView.test.ts,
    src/sim/match.test.ts, src/sim/delver/troops.test.ts.

SET UP
Run `npm ci`. Find how the repo runs its tests, typecheck and lint (package.json), and run them once
before changing anything, so you know the baseline.

DESIGN FIRST
Before writing code, add a "#### Design" section under Stage 0 in the plan, covering:
- the exact shape of `troop` on the Seat and the LineupSlot;
- the one pure function that resolves a Troop ref to what the Match needs (body, weapon,
  difficulty, style, mods, relics, max HP, Size), where it lives, and how the Delver's own Soldier
  building and this function share code rather than duplicate it;
- the new MatchConfig fields, and how they stay absent when no Seat has a Troop;
- where HP and Mods are applied at each Duel's start;
- how the Body reaches the renderer;
- what the validators accept and refuse;
- which tests you add.

Settle every open choice yourself and say what you chose. Two are left open:
- how a Variant is named in the ref (difficulty for a plain Variant, `name` for a Boss Variant, as
  the plan says, or something firmer);
- whether the Floor tier lives on the Seat (`troop.tier`) or elsewhere.

RULES
- Determinism and Rollback: a Match with no Troop Seat must have exactly the same config, state and
  hash as before. Prove it with a test, and don't touch any existing test's expected hash.
- The Troop select is shown only under devMode(). A Seat that already has a Troop still plays it
  without dev=1, so an online guest plays what the host set.
- A Troop the Tuning Data doesn't know is refused with a clear error naming the known ones, as
  an unknown Style is.
- Keep sim/ pure (src/sim/purity.test.ts): no DOM, no devMode() calls inside sim/.
- Match the code style around you: doc comments that state contracts, CONTEXT.md terms.

CHECK IT
- Run the full test suite, the typecheck and the lint. Everything that passed at the baseline
  must still pass.
- Run the app (use the `run` skill). Open it with ?dev=1 and set up a Duel against
  "Uruk · Beginner", then against a Boss Variant such as "Wraith Lord". Screenshot the Lobby row
  and the fight, and confirm the Body, Weapon, HP and Size are right. Then confirm the Troop select
  is absent without ?dev=1.

FINISH
- Add a "### Result" under Stage 0 in the plan: what was built, where, what differs from the plan
  and why, and anything Stage 4 (Quirks) must know to plug in.
- If you introduced a new term, update CONTEXT.md.
- Commit with a clear message and push to your session's branch. Don't open a pull request
  unless asked.
- Report: what changed, the test results (with output if anything failed), the screenshots, and
  any open questions.
```
