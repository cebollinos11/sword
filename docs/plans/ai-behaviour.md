# AI behaviour: new tiers × Styles, in four playtestable Stages

> Status: Stages 1 and 2 done and their playtests passed. Stage 3 (Feel) done, waiting for its playtest; Stage 4 (Adapt) is next. Stages run in order (1 Styles, 2 Team, 3 Feel, 4 Adapt); stop for a playtest after each.
> Every Stage first reads this file, `CONTEXT.md`, ADRs 0001, 0005 and 0007, `src/controllers/ai.ts` and `src/controllers/ai.test.ts`. A Stage ends when `npm run typecheck` and `npm test` pass and the work is committed; then mark it done below and add its Result.
> The Gauntlet named below (`data/gauntlet.json`, `src/tuning/gauntlet.ts`, `floorRoster`, the Floor AI) was replaced by the Dungeon (`docs/plans/dungeon.md`): an enemy's `style` (or `"random"`) is now an Encounter's in `data/dungeon.json`, resolved by `hallRoster` and played by the Hall AI.

## Progress
- [x] Stage 1: Styles, new tiers, exploit fixes
- [x] Stage 2: Team coordination
- [x] Stage 3: Feel
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

## Stage 2, Result
**Built**
- **One knob, `teamwork`** (a chance 0..1 in `AiDifficulty` and `AI_DIFFICULTY_EXTRAS`, 0 in `skillOf`, drawn only through `chance()`). Beginner, Skilled and Expert have it at 0.4 / 0.7 / 0.9. The golden test passes unchanged. With the knob at 0 the AI never even looks at its allies.
- **By observation only.** It reads its allies in the same `seen` Observation as its enemies, Reaction Time ago: position, walk and Action. "Allies on its target" means each ally seen nearer that enemy than any other. It takes no plans from another AI, so humans count as allies too.
- **Flank slots** (rolled with the circling side in `think`, kept in `Strafe.flank`): the team on a target, ranked by Fighter index, takes slots about the mean bearing of the team from the target: two at ±70°, three at 0° and ±115°. `footwork` circles to its slot and stops there, instead of circling at random. It also steers clear of any ally within 1 m.
- **Turns** (rolled once per own Attack, kept in `turn` until it starts one):
  - It starts no Attack from its spacing while an ally on its target is seen in Wind-up or Release.
  - Otherwise it starts one only in its own turn window: 60-Tick windows, one per team member by rank, open for their first 30 Ticks. In its window it presses `n` times as often, so the team keeps the pace of one AI.
  - It swings at once at a target seen facing an ally on it and not itself (`aimedAt`). It still punishes openings at once.
- **No friendly fire** (same roll):
  - `keepClear`, a last check on every Intent whatever plan pressed the Attack: it never lets a Wind-up go with an ally in its swing line. The line reaches its reach + 0.4 m and spans ±90° for a Left or Right (±135° for an ally within 1 m) or ±30° for an Overhead or Thrust. It holds the Wind-up up to 30 Ticks, until the ally is 0.4 m clearer, then Feints into a Block.
  - With an ally beside its line it picks an Overhead or Thrust.
  - It waits while an ally is in the narrow line.
  - It tries no Chamber or Outpace with an ally near its line.
  - Played as a team, it does not Chain while others share its target.
- **Target spread** (rolled when it picks a new focus, kept in `Focus.spread`): the team is shared out in Fighter-index order. Each member takes, of the enemies within 3 m of its nearest, the one fewest before it took. An enemy below 35% of its max HP, or the last standing, counts as free.
- **Memory**: `Strafe.flank`, `Focus.spread`, `AttackPlan.team`, `turn` and `lineHold`, all plain booleans or Ticks in `save()` and `load()`. The resync check in `src/net/messages.ts` validates them, and `PROTOCOL_VERSION` is now 18.
- **Tests** (`ai.test.ts`, "AI Stage 2"):
  - The ladder, off on the old tiers, no Style scaling it.
  - 2 v 1 against a dummy: the two end up more than 120° apart in every seed (140° in practice).
  - Never two Wind-ups at once while the target faces them both, and they still land blows.
  - No teammate Hits in 8 seeded 2 v 1 fights against a Skilled enemy (many without the knob).
  - Spread over two dummies, and piling onto a low-HP one.
  - A `save()`/`load()` round trip mid-fight.
  - The resync check accepts a real team memory and refuses malformed rolls (`messages.test.ts`).

**Decided along the way (asked) and deviations**
- **Rolls per situation**, like Stage 1's: the flank slot with the circling side; the turn and swing line once per own Attack; the spread once per focus pick.
- **No Style scales `teamwork`.** It follows the tier only. It is in `AI_STYLE_KEYS`, so a Style could scale it later as data.
- **Every ally counts**, a human too: the AI waits while you swing, never swings through you, and takes the slot opposite yours.
- **Spread**: "low on HP" is below 35% of max HP; "alone" is the last of its Team standing.
- **Beyond the plan**:
  - **Turn windows.** "Hold while an ally is seen swinging" alone cannot stop two AIs starting within one Reaction Time of each other. The windows use only the Duel's Tick, which every peer and Fighter shares.
  - **Pressing `n` times as often in its own window.** Without it a team of two landed about 40% of the blows one AI does.
  - **A swing line that depends on the Direction, with Overhead or Thrust chosen beside an ally.** A single wide line stopped friendly fire but made a team of three lose 6 Matches in 20 to a single Skilled AI: it mostly stopped swinging.
- **Soak, not a harness** (20 seeds, library, Skilled with `teamwork` 1 against Skilled with it 0; teammate Hits with teamwork off → on, then team 0's wins with it on):
  - 2 v 1: friendly hits 32 → 0, won 20/20.
  - 3 v 1: friendly hits 69 → 9, won 20/20.
  - 2 v 2: friendly hits 46 → 10, won 9/20 (7/20 with it off).
  - What still gets through is four bodies in a scrum, where an ally steps into a Release already on its way. Teamwork does not make a team win more. It changes how they fight.
- **Gauntlet** (proposed and approved): the floors move to the new tiers with random Styles (`data/gauntlet.json`): Easy → Beginner, Normal → Skilled, Hard → Expert, every enemy `"style": "random"`, the boss included. Counts, Weapons, Bodies and `hpScale` are unchanged.
- **A Stage 1 test gap, fixed**: the online Gauntlet test (`src/net/gauntlet.test.ts`) built its offline reference AIs without the Match options. Their `"random"` Styles came from the default Arena's seed instead of the Run's, so its reference disagreed with the peers as soon as a Floor named `"random"`. The game was right: every peer agreed with the others, with no Desync. The reference now passes the Match options, as the session does.

**Playtest (`npm run dev`)**
- **1 v 2** (Skirmish, two Skilled or Expert enemies): they should split to either side of you instead of queueing in front. Usually only one swings at a time. The one behind you swings when you turn to the other. Compare two Normal enemies, which crowd in and sometimes hit each other.
- **1 v 3** (three Skilled or Expert): one ahead and two at the sides, taking turns. Does it feel like a group fight and still fair? Is it too passive, or too punishing when you turn your back?
- **Allies**: you plus a Skilled or Expert AI ally against two enemies. Your ally should take the enemy you are not on, keep out of your swings and never swing through you.
- **2 v 2 and 3 v 3 AI vs AI** (the Editor or a Skirmish with AI allies): do teams spread out one-on-one and pile onto a low-HP enemy?
- **The Gauntlet**: Beginner to Expert with random Styles. Floors 2, 4 and 6 are the team fights. Is the difficulty curve still right?
- **Online, two tabs**: the host sets two Expert AIs on the guest's Team, or against both Players. Play a Match with no resyncs; then a Gauntlet Run.

## Stage 3: Feel (`rhythm`, `reactionJitter`, human mistakes, `jumpStep`)
- **Rhythm:** a rolled attack timer replaces the per-Tick coin flip from spacing. The delay is a bell-ish roll (a sum of uniforms) scaled by aggression, with occasional fast double threats (step in, Attack, Chain) and pauses. The timer lives in memory.
- **Reaction jitter:** each new threat gets a rolled extra delay (0..`reactionJitter`), stored in `DefencePlan`. The `seen` buffer grows by the jitter's Ticks.
- **Human mistakes:** a mistake is now usually a *late* Block (it raises the Block a few Ticks too late) or a wrong Direction biased to the one beside the right Block, instead of a uniformly random wrong Direction. Lapses are a little likelier right after its own Attack or after being hit.
- **Idle life:** it varies its spacing, stops circling at times and takes the odd short pause.
- **Jump repositioning (`jumpStep`):** today it jumps only to leap in with an Overhead, to reach another level, or to get out while Disengaging. Circling, spacing and Stage 2's flank slots all walk. With `jumpStep` (rolled when it re-picks its circling side, like `Strafe.flank`) it may also hop to reposition:
  - **To its flank slot:** a hop that carries it most of the way to a slot that is far round the target (say more than 60° off), instead of the long walk round.
  - **Out of a pincer:** two enemies within reach on roughly opposite sides of it: a hop out sideways, so both are in front of it again.
  - **Spacing:** the odd hop in or out to its spacing, instead of a walk.

  Never from inside an enemy's reach while it is seen in Wind-up or Release, since a Fighter in the air cannot Block (a hit in the air is a Knockdown, ADR 0012). Every hop is a tap checked with `jumpIsSafe` first, as every Jump it makes is today. Old presets leave it off. Open questions for the Stage: the tier values (0.4/0.7/0.9 or lower, since hops are showy), and whether a Style scales it (Tricky up, Defensive down).
- **Tests:** with `jumpStep` 1 in a 2 v 1 against a dummy, it reaches its flank slot by a hop sooner than walking does; caught between two enemies it hops out to have both in front; it never hops with an enemy Wind-up in reach, and never where `jumpIsSafe` says no; old presets never hop to reposition (the golden test).

## Stage 3, Result
**Built**
- **Five knobs**, each a chance 0..1 in `AiDifficulty` and `AI_DIFFICULTY_EXTRAS`, 0 in `skillOf`, drawn only through `chance()` (or `random()` behind it). The golden test passes unchanged. With a knob off, the code path is the old one: the coin flip, and a `seen` buffer of Reaction Time + 1.
  - `rhythm` (rolled once per Attack from its spacing): instead of a coin flip every Tick, a beat (`Beat`). Each Tick at its spacing it adds the pace the coin flip would have pressed at (its aggression in reach, 0.6 of it stepping in, none beyond; Pressure, Disengage and taking turns scale it as before). It swings once that adds up to a bell-shaped need (3 uniforms, mean 1). At 0.15 the need has a pause of one to two beats more, at 0.2 the beat is a double threat (step in, swing, always Chain), and the mistake is a swing from out of reach once the beat comes. Only a spacing Attack uses the beat up.
  - `reactionJitter` (rolled once per enemy Attack seen coming in reach, newer than any it rolled for): noticed 1 to half its Reaction Time late, at most 6 Ticks. Until then it acts on the Observation from the Tick before it noticed (`sight`), as if nothing had changed. A Feint is a new Attack, so a late notice of one keeps the old Block a moment. The `seen` buffer grows by those Ticks.
  - `humanMistakes` (rolled once per Attack it defends): a mistake (at `mistakeRate`) is at 0.6 a Block raised 3 to 9 Ticks late (`DefencePlan.raiseAt`), else one in a Direction beside the right one, never its opposite (a Left meets Overhead or Thrust, not Right). For 45 Ticks after its own Recovery or being hit (`shaken`), mistakes are 1.5 times as likely.
  - `idleLife` (rolled with its circling side): a spacing of its own (0.15 m in to 0.35 m out, in Neutral), at 0.3 no circling for that while, and at 0.3 a pause of 15 to 30 Ticks first, never inside the enemy's reach.
  - `jumpStep` (rolled with its circling side, one hop per roll, a tap): out of a pincer (two enemies on its level within their reach + 0.3 m, more than 120° apart as seen from it, hopping sideways off the line between them), or round to its flank slot more than 20° off when the walk round is blocked (the step is unsafe, or an ally stands in the way). It never hops with an enemy Attack or Kick seen within reach + 0.5 m, using its unjittered view (as seen Reaction Time ago, even an Attack it has not noticed yet). Every hop passes `jumpIsSafe`. The arc (for a pincer, its last quarter) stays 0.1 m beyond every enemy's reach and 0.6 m from every ally.
- **Tiers**: Beginner, Skilled and Expert have `rhythm`, `reactionJitter`, `humanMistakes` and `idleLife` at 0.4 / 0.7 / 0.9, and `jumpStep` at 0.2 / 0.35 / 0.5. **Styles**: Tricky ×2 and Defensive ×0.5 on `jumpStep`, nothing else.
- **Memory**: `beat`, `jitter`, `shaken`, `Strafe.spacing/still/pause/hop`, `DefencePlan.raiseAt` and `AttackPlan.double`, all plain numbers and booleans in `save()`/`load()`. The resync check in `src/net/messages.ts` validates them, and `PROTOCOL_VERSION` is now 19.
- **Tests** (`ai.test.ts`, "AI Stage 3"; `messages.test.ts`): the ladder and Style scaling; rhythm (no spacing Attack before its beat, a double threat always Chains, the coin flip's pace); reactionJitter (the Block 1 to 6 Ticks late, varying per Attack, the longer buffer); humanMistakes (late or beside, never opposite; the old random wrong Direction without it; shaken after its own Attack); idleLife (it stands and varies its spacing more); jumpStep (a hop over a Lava strip blocking its walk reaches the slot in about 60 Ticks where walking takes 111 to 146, and on open ground it walks; caught between two enemies it hops out and lands with both within 100°; no hop with an enemy Attack or Kick seen in reach, over seeded 1 v 1 and 1 v 2 fights; on a pier over Lava it never hops off sideways, while on open ground it does); a `save()`/`load()` round trip mid-beat, mid-late-notice and shaken; the resync check accepting real memory and refusing malformed new fields.

**Decided along the way (asked) and deviations**
- **Stage 2's playtest passed** with no notes.
- **reactionJitter** is a chance, not a size: on the ladder, late by 1 up to half its own Reaction Time. **Capped at 6 Ticks** (asked, after the soak): uncapped, Beginner's notices ran up to 12 Ticks on top of 0.4 s, and Beginner with every feel knob won only 57/160 against its plain self. Leave-one-out pinned it on the jitter.
- **jumpStep** tiers at half the ladder (0.2 / 0.35 / 0.5), Tricky ×2, Defensive ×0.5.
- **No spacing hops** (asked): a tap carries it at walk speed (1.7 m in 41 Ticks), then lands, cannot Block in the air, and the enemy meets its Landing. With them, Expert won 14/40 and Skilled 15/40 against themselves without feel; without them, 23/40 and 22/40.
- **Flank hops only when the walk round is blocked** (asked): on open ground a hop reaches the slot later than walking (81 vs 73 Ticks in a 2 v 1, 127 vs 112 in a 3 v 1), so the plan's "sooner than walking" test holds only where walking is blocked. The test uses a Lava strip.
- **The beat counts pace, not Ticks**: a beat set in Ticks ignored a change of tactic or range on the way, and was reset by any other Attack (a punish, a Chain). It threw away progress a coin flip never has, and Skilled attacked 15% less and won 12/40.
- **The jitter is its own memory (`jitter`), not in `DefencePlan`**: while it is late there is no Attack in its sight, so no plan to carry it.
- **Stage 1 and 2 tests on the new tiers** (lowSwingRead's Beginner, the no-friendly-fire Skilled teams) now turn the feel knobs off (`NO_FEEL`). They test their own knobs. With a feeling enemy, a team of two lets 0 to 3 teammate Hits through in 20 seeds whether its own feel knobs are on or off: the Stage 2 scrum residue.
- **Soak** (library, best of 3, sides alternating; feel on = the tier as shipped, feel off = the same tier with the five knobs at 0):
  - Feel on against feel off: Skilled 44/80, Expert 41/80, Beginner 33/80.
  - Against the old counterpart (feel on / feel off): Expert vs Hard 20/40 / 19/40, Skilled vs Normal 15/40 / 16/40, Beginner vs Easy 75/200 / 90/200.
  - Beginner still trails a little (about 7 points, 1.5 SD). Leaving out each knob in turn (160 seeds vs Easy) lands between 33% and 44%, within noise. No single part does it. If the playtest finds Beginner too weak, lower its `rhythm` or `reactionJitter`.
  - Rhythm alone keeps the coin flip's pace (Skilled 20/40, Beginner 61/120, the same number of Attacks).
  - Hops in team fights: 2 v 2 wins 26 → 28/30; in a 1 v 2 it survived 12% longer.

**Playtest (`npm run dev`)**
- Skirmish against Beginner, Skilled and Expert, each with Balanced and Tricky (most hops) and Defensive (fewest). Does it feel less robotic?
  - **Rhythm and pauses**: its Attacks from spacing should come in uneven beats, sometimes a pause, sometimes a quick step-in swing and Chain, not a steady random drip. Does it still feel threatening?
  - **Late Blocks**: now and then its Block goes up a moment late, or it Blocks the Direction beside yours (never the opposite). Is it likelier just after it swings or is hit? Feint against it: does a late notice sometimes keep the old Block?
  - **Idle life**: it stands still for a moment, stops circling, drifts in and out of its spacing.
- **Hops**: with an AI ally against one Skilled or Expert Tricky enemy, get that enemy between you and your ally: it should hop out sideways so you are both in front of it. In 2 v 1 against you, an AI whose way round to its flank is blocked (a ledge, Lava, an ally) should hop round. It must never hop while you swing at it in reach, and on a Generated Arena with Lava or ledges a hop should never land it in danger.
- **1 v 2 and 1 v 3** with Skilled and Expert: does the feel make group fights more natural, or messier?
- **Beginner** against Easy: is Beginner still beatable but not hopeless, and not weaker than it should be?
- **The Gauntlet**: Beginner to Expert with random Styles. Is the difficulty curve still right?
- **Online, two tabs**: Expert AIs on both Teams, a Match with no resyncs, then a Gauntlet Run.

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
