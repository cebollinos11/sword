# AI behaviour: new tiers × Styles, in four playtestable Stages

> Status: planned, no Stage started. Stages run in order (1 Styles, 2 Team, 3 Feel, 4 Adapt); stop for a playtest after each.
> Every Stage first reads this file, `CONTEXT.md`, ADRs 0001, 0005 and 0007, `src/controllers/ai.ts` and `src/controllers/ai.test.ts`. A Stage ends when `npm run typecheck` and `npm test` pass and the work is committed; then mark it done below and add its Result.

## Progress
- [ ] Stage 1: Styles, new tiers, exploit fixes
- [ ] Stage 2: Team coordination
- [ ] Stage 3: Feel
- [ ] Stage 4: Adaptation

## Context
The AI (`src/controllers/ai.ts`, a single rule-based `AiController` tuned by `data/ai.json`) feels robotic and random, can be exploited, and plays badly in group fights. Exploits the user reported:
- **Bait then punish:** stepping in and out of reach makes it whiff, and you punish the Recovery.
- **Duck vs a low swing:** it Crouches under a Left or Right swing even when the attacker looks down, and a low-aimed swing hits a Crouch.
- **Held Wind-up:** hold an Attack's Wind-up and it stands there Blocking forever.

Weaknesses in the code:
- It attacks on a per-Tick coin flip (`aggression` is about 0.02 per Tick at 60 Hz).
- It reads nothing of the opponent's habits.
- Defence is all-or-nothing after a fixed Reaction Time.
- Each AI just fights its nearest enemy.
- Its play ignores the Weapon apart from reach.
- Every AI of a difficulty plays alike.

User decisions:
- Leave **Easy / Normal / Hard exactly as they are**. Add new presets, and phase the old ones out later.
- Offer **both** new difficulty tiers and a separately chosen **Style** (difficulty × Style).
- Stage order: **Style → team → feel → adapt**.
- No measurement harness: judge by playtesting.

## Ground rules for every Stage
- **Old presets stay bit-identical.** Every new knob is optional in `AiDifficulty` (`src/tuning/index.ts:256`), and `skillOf` (`ai.ts`) defaults it to off. New code draws randomness only through `chance()`, which never draws at 0 or 1, so old presets consume the same RNG stream. A **golden test**, recorded before any change, keeps them honest: AI vs AI Matches (Easy/Normal/Hard, 1 v 1 library, 2 v 2 generated arena, 1 v 3 chamber) with the `hashValue` checked at every Tick. The same technique was used in the Gauntlet Stage 1.
- **Fairness** (header of `ai.ts`): the AI uses only what a human could see, delayed by its Reaction Time.
- **Determinism and Rollback** (ADR 0001, 0005): new memory is plain data added to `AiMemory`, `save()` and `load()`, and kept small because it is copied every Tick.
- Reuse the existing helpers: `chance`, `safeMove`, `stepIsSafe`, `attackTimings`, `reach`, `aimedAt`, `goesFor`, `startAttack`, `chooseDirection`, and the test helpers in `ai.test.ts` (`vsAi`, `scriptedController`, `runControllers`, `duel`).
- This file carries the Stages and gets a Result per Stage. Add terms to `CONTEXT.md`: Style, AI tier names. Write an ADR only if Styles cross the wire in a non-obvious way.
- After each Stage, stop for a playtest.

## Stage 1: Styles, new tiers, exploit fixes
**New behaviour knobs** (old presets leave them off):
- `lowSwingRead`: Sightings gain `pitch` (it leans the torso, so it is visible: `pose.ts` `applyLook`). It never Ducks a Left or Right when the attacker's seen pitch is below `ai.duckMaxPitch`, and it re-checks the Duck plan every Tick, switching to Block if the pitch drops mid-Wind-up. Derive the threshold from the Simulation with a test that sweeps pitch against a Crouched dummy, not a guess.
- `holdBreak`: against a Wind-up held past its `windUpEnd` for more than N Ticks, it stops turtling:
  - It backs out of the attacker's reach while keeping its Block, using `safeMove`.
  - If the attacker walks after it while holding, it Kicks. They are moving, so the Kick is a Knockdown (ADR 0007).
  - Once it is out of reach, a held Wind-up is no longer a threat to sit and Block. It hovers just outside and baits (steps in and back) to draw the Release, then punishes the Recovery.
- `whiffCheck` (the bait-then-punish fix): rolled once per own Attack. In its Wind-up, if the target seen backing out of reach will be beyond reach at Release, it holds the Wind-up (closing in, as `holdUntil` already allows) or Feints into a Block instead of swinging at air.
- `punishFits` (weapon-aware): it punishes an opening only if its own Wind-up for the chosen Direction (`attackTimings`, Tempo included) lands before the opening's remaining Ticks, as read from the seen `motionTick`. Otherwise it spaces out. This stops a Sledge Hammer from "punishing" a short Recovery into a counter.

**Styles:** Tuning Data `ai.styles` in `data/ai.json`. Each Style holds multipliers on the difficulty's chances plus values for new knobs. A starting set:
- **Balanced**: no change; this is the default.
- **Brute**: more aggression, pressure and Chains; fewer Feints; less caution.
- **Fencer**: a counter-puncher with more footwork, punish, Chambers and `whiffCheck`, and less aggression.
- **Trickster**: more Feints, Kicks, jumping Attacks and Throws.
- **Guardian**: more caution, Ducks, Chambers and `holdBreak`; less pressure.

Merge the Style into the Skill in `skillOf`, clamping chances to 0..1. Pass it as `createAiController(tuning, difficulty, style?)`.

**New tiers:** add `Squire`, `Knight` and `Champion` to `ai.difficulties`, based on Easy/Normal/Hard with every new knob on. These names are placeholders; rename them freely.

**Wiring the Style through:**
- `Pilot` AI in `src/controllers/lineup.ts` gains an optional `style` (absent means Balanced). `lineupAis` passes it on. `validateLineup` rejects an unknown Style.
- Lobby and net: the host's Lineup carries the Style. Validate it in `src/lobby/messages.ts`, `src/lobby/sync.ts` and the `src/net` message checks.
- Menu (`src/play/menu.ts`, `lobbyView.ts`): a Style picker beside each AI seat's difficulty, including "Random", which is resolved from the seed so every peer agrees.
- Editor sandbox (`src/editor/sandbox.ts:471`) and the tuning panel: a Style picker and the new knobs (`AI_DIFFICULTY_EXTRAS`).
- Gauntlet (`src/tuning/gauntlet.ts`, `data/gauntlet.json`): an optional `style` per enemy, "random" allowed. Moving the Gauntlet floors to the new tiers is a data change, proposed at the end of Stage 2.
- Tuning validation and the hash (`src/tuning/hash.ts`) cover `ai.styles`.

**Tests:** the golden test; one test per knob (a low-pitched Left hits a Squire that would have Ducked, but not a Knight; a held Wind-up no longer pins it; a target stepping out makes it hold or Feint instead of whiffing; a hammer doesn't punish a short Recovery); `save()`/`load()` round-trips; Lineup, lobby and Gauntlet validation with Styles.

## Stage 2: Team coordination (`teamwork` knob)
It coordinates by observation only, reading allies' seen positions and Actions, so there is no shared memory and both peers stay in sync.
- **Flank slots:** allies on the same target are ranked by Fighter index and each takes an angle around the target (two allies about ±70°; three allies at 0° and ±115°). `footwork` aims at its slot instead of circling at random.
- **Turns and openings:** it holds its own Attack while an ally is seen in Wind-up or Release on the same target. It attacks when the target faces an ally (its back exposed, using `aimedAt`) or shows an opening.
- **No friendly fire or crowding:** it doesn't swing when an ally stands in its swing line (teammates' blades Stagger each other), and it steers apart from allies within about 1 m.
- **Target spread:** in team fights, it doesn't pile onto one enemy unless that enemy is low on HP or alone.
- Then propose Gauntlet floors on the new tiers with random Styles, as `gauntlet.json` data.
- **Tests:** in a 2 v 1 against a dummy, the two end up on opposite sides; they never Stagger each other in N seeded fights; only one is ever in Wind-up at a time when the target faces both.

## Stage 3: Feel (`rhythm`, `reactionJitter`, human mistakes)
- **Rhythm:** a rolled attack timer replaces the per-Tick coin flip from spacing. The delay is a bell-ish roll (a sum of uniforms) scaled by aggression, with occasional fast double threats (step in, Attack, Chain) and pauses. The timer lives in memory.
- **Reaction jitter:** each new threat gets a rolled extra delay (0..`reactionJitter`), stored in `DefencePlan`. The `seen` buffer grows by the jitter's Ticks.
- **Human mistakes:** a mistake is now usually a *late* Block (it raises the Block a few Ticks too late) or a wrong Direction biased to the one beside the right Block, instead of a uniformly random wrong Direction. Lapses are a little likelier right after its own Attack or after being hit.
- **Idle life:** it varies its spacing, stops circling at times and takes the odd short pause.

## Stage 4: Adaptation (`adapt` knob)
- **Habit memory per enemy:** decaying counts of the attack Directions it saw, the Block Directions held, held Wind-ups, and stepping out after it began a Wind-up (baiting). It is kept across the Duels of a Match: the `observe()` new-Duel reset spares it. A Gauntlet's Floor AI carries it from Floor to Floor.
- **Use:**
  - Defence: it Blocks the predicted Direction a little sooner, while still needing to see the Attack.
  - Offence: it favours the Direction the enemy Blocks least.
  - Against a baiter: more `whiffCheck` and less `preempt`.
  - Against a Wind-up holder: it uses `holdBreak` sooner.
- **Tests:** against a scripted always-Overhead attacker, its Block success rises over a Duel; against a scripted always-Block-Left player, its attacks shift away from that Direction.

## Verification (each Stage)
- Run `npm run typecheck` and `npm test` (vitest), including the golden test proving Easy/Normal/Hard unchanged.
- Run the new behaviour tests in `src/controllers/ai.test.ts` (and `floorAi.test.ts` and the lineup and lobby tests where touched).
- Playtest with `npm run dev`:
  - Skirmish against each new tier × Style.
  - Retry the three exploits (Stage 1).
  - Fight 1 v 2 and 1 v 3, and play the Gauntlet (Stage 2).
  - Play online with two tabs to check both peers' AIs agree through Rollbacks.
- Commit and push each Stage to the working branch, then stop for feedback.
