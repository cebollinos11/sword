# AI behaviour: new tiers × Styles, in four playtestable Stages

> Status: Stage 1 done (Styles, new tiers, exploit fixes), waiting for its playtest; Stage 2 (Team) is next. Stages run in order (1 Styles, 2 Team, 3 Feel, 4 Adapt); stop for a playtest after each.
> Every Stage first reads this file, `CONTEXT.md`, ADRs 0001, 0005 and 0007, `src/controllers/ai.ts` and `src/controllers/ai.test.ts`. A Stage ends when `npm run typecheck` and `npm test` pass and the work is committed; then mark it done below and add its Result.

## Progress
- [x] Stage 1: Styles, new tiers, exploit fixes
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
- **Aggressive**: more aggression, pressure and Chains; fewer Feints; less caution.
- **Counter**: waits for your move and punishes it, with more footwork, punish, Chambers and `whiffCheck`, and less aggression.
- **Tricky**: more Feints, Kicks, jumping Attacks and Throws.
- **Defensive**: more caution, Ducks, Chambers and `holdBreak`; less pressure.

Merge the Style into the Skill in `skillOf`, clamping chances to 0..1. Pass it as `createAiController(tuning, difficulty, style?)`.

**New tiers:** add `Beginner`, `Skilled` and `Expert` to `ai.difficulties`, the new counterparts of Easy, Normal and Hard: the same strength ladder, with every new knob on.

**Wiring the Style through:**
- `Pilot` AI in `src/controllers/lineup.ts` gains an optional `style` (absent means Balanced). `lineupAis` passes it on. `validateLineup` rejects an unknown Style.
- Lobby and net: the host's Lineup carries the Style. Validate it in `src/lobby/messages.ts`, `src/lobby/sync.ts` and the `src/net` message checks.
- Menu (`src/play/menu.ts`, `lobbyView.ts`): a Style picker beside each AI seat's difficulty, including "Random", which is resolved from the seed so every peer agrees.
- Editor sandbox (`src/editor/sandbox.ts:471`) and the tuning panel: a Style picker and the new knobs (`AI_DIFFICULTY_EXTRAS`).
- Gauntlet (`src/tuning/gauntlet.ts`, `data/gauntlet.json`): an optional `style` per enemy, "random" allowed. Moving the Gauntlet floors to the new tiers is a data change, proposed at the end of Stage 2.
- Tuning validation and the hash (`src/tuning/hash.ts`) cover `ai.styles`.

**Tests:** the golden test; one test per knob (a low-pitched Left hits an Easy AI that Ducks it, while a Beginner reads the look and Blocks it; a held Wind-up no longer pins it; a target stepping out makes it hold or Feint instead of whiffing; a hammer doesn't punish a short Recovery); `save()`/`load()` round-trips; Lineup, lobby and Gauntlet validation with Styles.

## Stage 1, Result
**Built**
- **Golden test** (`src/controllers/aiGolden.test.ts`, fixture `aiGolden.testdata.json`): Easy, Normal and Hard AI vs AI Matches (1 v 1 library, 2 v 2 `gen:greybox:5`, 1 v 3 chamber, mixed Weapons, up to 3000 Ticks each) with the Match hash at every Tick. Recorded in its own commit before `ai.ts` changed; it passes at the end of the Stage. Re-record only for a Simulation change (`RECORD_AI_GOLDEN=1`).
- **Four knobs** in `AiDifficulty` (chances 0..1, in `AI_DIFFICULTY_EXTRAS`, 0 by default in `skillOf`, drawn only through `chance()`):
  - `lowSwingRead`: rolled when it picks a Duck. Sightings carry `pitch`. A Left or Right seen pitched below `ai.duckMaxPitch` gets a Block, and a Duck turns into a Block on any Tick the look drops.
  - `holdBreak`: rolled once a Wind-up is held `HOLD_BREAK_TICKS` (15) past its held pose. It backs out of reach under its Block for 30 Ticks, then baits in 30-Tick halves: in to 0.15 m inside their reach under its Block, then out to 0.25 m beyond it, Idle there. A Release seen from out of reach leaves it Idle, and the normal opening logic punishes the Recovery. An attacker walking after it: it holds its ground under its Block until the attacker is (predicted) within `kickRange`, drops the Block for a Tick and Kicks (a Knockdown).
  - `whiffCheck`: rolled per own Attack. On the last Tick before its held pose, if the target seen backing off (carried on from when it was seen, minus its own walk-in from now) will be beyond reach mid-Release, it holds while `holdUntil` allows, else Feints into a Block.
  - `punishFits`: rolled with the `punish` roll. It punishes only if its Wind-up for the chosen Direction (Tempo included), and any step in, fits in the opening's Ticks left as seen (Recovery, Kick whiff, Stagger Motion; a Knockdown always fits). Otherwise it spaces out with `footwork`.
- **Memory**: the rolls live in the existing plans (`DefencePlan.reads`/`holdBreak`, `AttackPlan.whiff`, `OpeningRoll.fits`), so `save()`/`load()` carry them as before. The resync check (`src/net/messages.ts`) validates them, and `PROTOCOL_VERSION` is now 17.
- **Styles**: `ai.styles` in `data/ai.json` (parsed, validated, in the hash). `skillOf(tuning, difficulty, style)` multiplies the chances a Style names, clamped to 0..1. `createAiController(tuning, difficulty, style?)` takes the Style.
- **Tiers**: Beginner, Skilled and Expert copy Easy, Normal and Hard exactly and add the four knobs at 0.4 / 0.7 / 0.9.
- **Wiring**:
  - Lineup and Lobby: `Pilot.style` and the Lobby AI Seat's `style`, checked by `checkLineup`, the Lobby message check, the guest Lobby's validation and the net Lineup check. `lineupAis(…, match)` resolves `"random"` (`lineupStyle`). The Lobby has a Style picker beside each AI Seat's difficulty, and guests see "Style · Weapon".
  - Gauntlet: an enemy's optional `style` (or `"random"`), resolved in `floorRoster` from the Run seed, Floor and slot. The Floor AI plays it.
  - Editor: red and blue Style pickers in AI vs AI, a Style for Player vs AI, and a Styles folder in the tuning panel. The new knobs show in each preset that sets them.
- **CONTEXT.md**: Style; the new tiers under Reaction Time; Lineup, Seat and Floor now name the Style.

**Decided along the way (asked) and deviations**
- **Knob form**: the knobs are chances, not switches, so Styles can scale them, and all four climb the same ladder (0.4 / 0.7 / 0.9). So a Beginner can still be baited, ducked or pinned more than half the time.
- **Styles on old tiers**: any tier takes a Style, but a Style only multiplies, never sets. Easy, Normal and Hard keep the new knobs at 0 whatever the Style, and no Style touches Reaction Time, mistake rate or `jumpNav`. `Balanced` must be present and empty.
- **Random**: written `"random"` (the Gauntlet's `RANDOM_PICK`). It is resolved when a Match starts, from the Match seed and the Fighter index, so an online automatic Rematch keeps the Styles of the Match before it (its Controllers carry over), and a restart rerolls. The HUD still shows only the tier.
- **punishFits ends counted as seen**: the opponent needs as long to see the punish coming. Every Weapon still has Tempo 1 (21-Tick Wind-ups; a 30-Tick Recovery, a 29-Tick Recoil), so today every Weapon fits every Recovery and Recoil. The knob only bites once a Tempo slows a Wind-up. The test uses a Sledge Hammer at Wind-up ×2.
- **`ai.duckMaxPitch` = −1°**, from the sweep (every Weapon, 1.0 and 1.3 m, the Crouched dummy looking level or up as the AI aims): the steepest look that still hits a Crouch is −1.5° (level dummy) or −2.5° (looking up). So any visibly downward look already hits a Crouch, and an AI attacker re-aiming at a Crouch drops below it within a few Ticks.
- **whiffCheck counts its own walk**: the first version ignored it, and it Feinted at targets its walk-in would still reach.
- **Style multipliers beyond the starting set**: Aggressive also has preempt ×1.3 and footwork ×0.8. Counter has pressure ×0.5, preempt ×1.3 and punishFits ×1.4. Defensive has aggression ×0.8.
- **Defaults unchanged**: the Skirmish's AI Seat, the AI Takeover and the Gauntlet floors are still Normal and the old tiers. The Gauntlet data change waits for Stage 2.
- **Soak, not a harness** (6 seeds, best of 3): Beginner beat Easy 1/6, Skilled beat Normal 3/6, Expert beat Hard 4/6. In the library, Defensive lost to Balanced 0/4 at every tier. These only flag what to watch in the playtest.

**Playtest (`npm run dev`)**
- Skirmish: set the AI Seat to Beginner, Skilled and Expert, each with every Style and Random. Do Aggressive, Counter, Tricky and Defensive feel distinct (pressure and Chains; waiting and Chambers; Feints, Kicks, leaps and throws; backing off and Ducks)? Is Defensive too passive?
- **Bait then punish**: step in and out of reach against Skilled or Expert Counter. It should hold or Feint into a Block instead of swinging at air. Compare Normal, which still whiffs.
- **Duck vs low swing**: against Expert Defensive (most Ducks), look slightly down and swing Left or Right. It should Block. Swing level and it may still Duck. Try dropping the look mid-Wind-up too.
- **Held Wind-up**: hold an Overhead in its face. After about ¼ s plus its Reaction Time it should back out and start stepping in and out. Release while it is out: it should punish your Recovery. Walk after it holding: it should Kick you down.
- Do the new tiers feel fair (Beginner beatable, not trivially exploitable at Skilled or Expert)?
- Editor sandbox: AI vs AI with red and blue Styles, and the tuning panel's Styles folder.
- Online with two tabs: the host sets an AI Seat to a Style and one to Random. The guest's Lobby shows them, and the Match runs with no resyncs.

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
