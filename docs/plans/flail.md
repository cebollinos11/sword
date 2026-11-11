# Flail (ball and chain): staged implementation plan

> Built one Stage per session with `docs/plans/flail-prompt.md`. The decisions under **Context** are agreed with the user and fixed: if a Stage cannot be built as written, take the smallest deviation that keeps them and note it in the Stage's Result; if it would change them, stop and ask. File and function names below were read from the code when the plan was written; numbers are starting values to tune.

Status: Stages 1 to 4 built (the Flail is a playable Weapon with no Thrust, its Spin-up scales its Blade Speed in the Simulation, it is drawn with a loose chain that whirls with the charge, with its own sounds, and the newer AI tiers spin it up and read a spin); Stage 5 (docs and a full verification pass) next.

## Progress

- [x] Stage 1: the Flail as a plain Weapon (sections 1 and 2): data, Motions, rigid look, icon, no Thrust
- [x] Stage 2: the Spin-up in the Simulation (section 3), its ADR, the tuning panel
- [x] Stage 3: the loose chain, the whirl and the sounds (sections 4 and 5)
- [x] Stage 4: the AI spins up and reads a spin (section 6)
- [ ] Stage 5: docs and a full verification pass (sections 7 and Verification)

## Context

The ask: add a ball and chain Weapon to the roster.

Decisions taken with the user:

- **Form**: a two-handed flail: a long shaft with a chain and a spiked ball on its end. Name: **Flail** (`data/weapons/flail.json`). It sits beside the Halberd and the Sledge Hammer.
- **Rigid in the Simulation, loose on screen**: the Simulation treats it as an ordinary rigid Weapon with a Head (the ball, at the tip), so the Blade Sweep, Blocks, Chambers, Heavy Blows, the AI's reach and Rollback all work as for any Weapon. Only the Renderer draws a loose chain; during Release the drawn ball is on the simulated one. Outside Release the drawn ball may differ from the simulated tip, which is accepted (nothing is live then).
- **Spin-up**: the one new rule. Holding the Wind-up builds a charge that ramps to a cap over a tuned time, then holds for as long as the Wind-up is held.
  - The charge multiplies the **Blade Speed** at contact. Damage follows through the existing rule (`hitDamage`), and so does the Heavy Blow: a full charge crosses the Flail's `heavyBlow.speed`, an uncharged swing is weak and never Heavy. No separate damage rule.
  - A Feint into another Direction **keeps** the charge. A Feint into a Block, a Stagger, a Knockdown or anything else that ends the Attack drops it.
  - A Chain or Whiff Chain **starts from zero**.
  - The whirl is **visual only**: the Simulation holds the usual static Wind-up pose plus the charge; nothing is live before Release. The opponent reads the charge from the whirl's speed and its sound, never from a HUD.
- **Moveset**: Overhead, Left and Right. **No Thrust**: a Thrust Attack falls back to Overhead, in the Simulation, so no press is ever dead. It Blocks all four Directions as any Weapon does.
- **Cuts**: the spiked ball counts as cutting (`cuts: true`): Dismemberment applies as for a sword.
- **Sounds**: its own: a whirl that quickens with the charge and a heavy impact.
- **AI**: by difficulty. It holds the Wind-up longer when it has room and lets go early under threat; defenders read the charge they see, Reaction Time ago.
- **Scope**: a full roster Weapon: pickable in the menu and the Lobby, usable by the AI, equippable from a Run's Inventory, playable in a Battle by a Player. **No** Battle Troop carries it and **no** Run Encounter or loot names it (the user left that out); do not add them.

## 1. Tuning Data: the Weapon, its look, its Motions

- `data/weapons/flail.json`, modelled on `halberd.json`. Starting values: `grip` twoHanded, `length` 1.5 (sword hand to the ball's centre), `gripLength` 0.6, `offHandGrip.along` 0.45, `head` 0.22 (the ball), `shaftDamage` 0.15 (shaft and chain), `damage` 45, `speed` 20, `cuts` true, `blockImpact` { dealt 1.6, taken 1.0 }, `heavyBlow` { speed 1.25, knockdownSlide 1.2, knockdownSlideTicks 26, blockSlide 0.4, blockSlideTicks 7 }, `tempo` { windUp 1.1, release 1, recovery 1.2 }, `sheathe.slot` back, `look` flail. The roster loads by glob (`src/tuning/index.ts`, `weaponFiles`), so the file alone registers it; the Arming Sword stays first and so the default.
- `src/tuning/weapon.ts`:
  - `WEAPON_LOOKS` gains `'flail'`.
  - New optional field `attacks`: the Directions the Weapon attacks in (default all four; the Flail: Overhead, Left, Right; must include Overhead). Parse, validate and `serializeWeapon` it; omit it from the file when it is all four, so the other Weapon files do not change.
  - New helper `attackDirection(weapon, direction)`: `direction` if the Weapon attacks in it, else Overhead.
  - New field `chain` (metres of chain between the shaft's end and the ball, render-only, 0 for other looks) if the look needs it.
- Motion overrides in `data/motions/flail/`, generated like the Halberd's: add the Flail to `tools/two-handed-motions/choreo.mjs` and run `npm run motions:two-handed` (do not hand-edit generated files). At least `overhead`, `left`, `right`, `blockoverhead`, `drawback`, `sheatheback`, and an `idle` if the default guard does not suit the long shaft. Swings are wide and round; the held Wind-up poses hold the shaft high and clear of the body so the whirl (Stage 3) has room. Every override keeps `windUpEnd` and `releaseEnd` (`checkMotionOverride`) and the guard links (`checkIdleLinks`). No `thrust` override: the default is never played.
- `src/play/icons.ts`: a Flail icon beside `Halberd` and `'Sledge Hammer'`.

## 2. No Thrust: the fallback, in one place

A naive mapping in `startAttack` alone would break Feints: `feint()` compares `intent.direction` with the Action's Direction, so an Intent of Thrust against an Overhead Attack would restart the Wind-up every Tick. So every place an Intent's Direction becomes an **Attack's** Direction goes through `attackDirection`:

- `src/sim/actions/attack.ts`: `startAttack`, the Whiff Chain's queued Direction (`whiffChain: intent.direction`, `startWhiffChain`), the Chain's Direction in `recover`.
- `src/sim/actions/feint.ts`: compare against the mapped Direction (Thrust held during an Overhead Wind-up is no Feint; the emitted `Feint` event carries the mapped Direction).
- `src/sim/chamber.ts`: a Chamber is judged on the Direction the Attack really has. Consequence, accepted: a Flail cannot Chamber a Thrust (it has no Thrust to answer with); it must Block it.
- Blocks are untouched: a Block reads `intent.direction` as before.
- `src/controllers/ai.ts` (`chooseDirection`, the `THRUST_REACH` sums at the four `reach(...) + (direction === 'Thrust' ? ...)` sites, `BESIDE`): an AI with a Flail never picks Thrust and never counts Thrust reach for itself or for a Flail it sees. Only when a Flail is involved: with the other Weapons every choice and every random draw stays exactly as it is (the AI golden test, `src/controllers/aiGolden.test.ts`, must pass unchanged).
- Controllers and the Wheel Attack (`src/controllers/local.ts`) need no change: wheel down asks for a Thrust and gets an Overhead.

Tests (new `src/sim/flail.test.ts`, or beside `directions.test.ts` / `feint.test.ts` / `chamber.test.ts`): a Thrust press with a Flail starts an Overhead; holding Thrust through the Wind-up does not Feint; Overhead to Left still Feints; a Chain and a Whiff Chain held in Thrust start an Overhead; a Flail still Blocks a Thrust in the Thrust Direction; every other Weapon still Thrusts.

Stage 1 draws the Flail rigid: shaft from the butt to `length - chain - ball`, a straight chain, the ball at the tip (`src/render/fighterView.ts`: a `FlailMeshes` group beside `hammer`, a `placeFlail`, the look switch at the `weapon.look === 'hammer'` sites; `src/render/sheathed.ts` for the back slot). After Stage 1 the Flail is a complete, playable Weapon without its rule.

## 3. Simulation: the Spin-up

- `src/tuning/weapon.ts`: optional `spinUp: { seconds, from, to }`: the time to full charge, and the Blade Speed multiplier at no charge and at full charge. Starting values `{ seconds: 1.5, from: 0.7, to: 1.4 }`. Absent: no Spin-up (every other Weapon), nothing changes. Validate `seconds > 0`, `0 < from <= to`. Helper `spinUpSpeed(weapon, chargeTicks)`: 1 without `spinUp`, else `from + (to - from) × min(1, chargeTicks / secondsToTicks(seconds))`.
- `src/sim/state.ts`: `AttackAction` gains optional `charge: number`, whole Ticks. Present **only** for a Weapon with `spinUp`, so every other Fighter's state, hash and snapshot are byte-for-byte what they are today.
- `src/sim/actions/attack.ts`:
  - `startAttack`: `charge: 0` for a Weapon with `spinUp`.
  - Wind-up: `charge + 1` each Tick of the phase (from its first Tick, so the ball starts turning as the shaft rises), capped at the full-charge Tick count. It is kept, frozen, through Release and Recovery (the Renderer and the sounds read it there).
  - Chain and Whiff Chain start through `startAttack`: zero.
- `src/sim/actions/feint.ts`: an Attack Feint carries the old Action's `charge` into the new one; a Block Feint drops it with the Action.
- `src/sim/combat.ts` (`findContacts`): multiply the attacker's contact `bladeSpeed` by `spinUpSpeed` for Fighter contacts and for the wall contact, at the one place it is produced, so damage, `isHeavyBlow`, Block Impact, the `Hit` / `Block` / `WallStrike` events and Dismemberment's carry all see the same speed. Do not touch `hitDamage` or `isHeavyBlow`.
- `src/net/messages.ts`: wherever an Attack Action is validated for a resync, accept the optional `charge` (a non-negative integer). `hashState` is generic.
- `src/editor/tuningPanel.ts` (and its sections test): `spinUp` and `attacks` editable for a Weapon that has them.
- New ADR `docs/adr/0026-the-flail-is-rigid-in-the-simulation.md`: the Flail is a rigid Weapon in the Simulation and its chain is drawn outside it (why: ADR 0001, the AI's reach, Motion tuning; the cost: the drawn ball differs from the simulated tip outside Release); the Spin-up is a count of Ticks in the Attack that scales Blade Speed, not a simulated mass.

Tests (test-first, in `flail.test.ts`): the charge grows per Wind-up Tick and caps; a Release at zero, half and full charge Hits for `from`, the midpoint and `to` times the uncharged-rule damage; a full charge is a Heavy Blow (Knockdown and Slide on a Hit, the push on a Block) and a quick Release is not; an Attack Feint keeps the charge, a Block Feint and a Stagger drop it; a Chain and a Whiff Chain start at zero; a Longsword's states carry no `charge` and an existing recorded Match hashes the same; save and restore a state mid-spin (Rollback) and re-simulate to the same hash.

## 4. Renderer: the loose chain and the whirl

Render-only and a pure function of what the Simulation holds (the Fighter's pose this Tick and last, its Action, `charge`, the Motion playhead): no `Math.random`, no wall clock, no state kept between frames that a Rollback, the Editor's scrubbing or the Final Blow Shot would leave wrong.

- New pure module `src/render/flailChain.ts` (unit-tested, no DOM): `flailBall(blade, action, motionTick, timings, weapon, alpha) → { ball: Vec3, links: Vec3[] }`:
  - **Wind-up**: the ball circles the shaft's end on a cone. Its angle is a pure function of `charge`: the sum of a turn rate that rises from slow to fast with the charge (closed form, so scrubbing works), and keeps turning at the top rate while held at the cap (use the Motion's held Ticks or the state Tick, whichever the code makes available without new state; if neither is, add the smallest thing to the Simulation and note it).
  - **Release**: over the first part of the phase the ball blends from the whirl onto the simulated tip, and is exactly on it from then to `releaseEnd`, so the ball that is seen is the ball that hits.
  - **Recovery, Idle, Block, anything else**: the ball hangs from the shaft's end, straight down under gravity, blended in from where the swing left it; kept out of the floor and, as far as cheap, the Fighter's own body.
  - The swing's turn sense matches the Release's Direction (a Left spins the way a Left swings), so the whirl is also the read of the Direction.
- `src/render/fighterView.ts`: the Stage 1 `placeFlail` takes the chain from `flailBall`; links are instanced or a handful of small meshes. A lodged Weapon (`AttackAction.lodge`) holds the ball in the victim.
- `src/render/swingTrail.ts`: the trail follows the drawn ball. `src/render/colliderView.ts` keeps showing the true rigid Weapon (that is what it is for). `src/render/bladeBlood.ts`: blood on the ball if the look allows it cheaply.
- `src/render/sheathed.ts`: on the back, chain wrapped or hanging, static.
- Dismemberment (`src/render/dismember.ts`) reads the Death's recorded cut, which comes from the simulated blade: nothing to change, but check a Flail kill cuts sensibly.

## 5. Audio

`src/audio/cues.ts` derives cues from events and state; keep it that way.

- `Whirl`: one whoosh per turn of the ball, cued on the Tick the whirl's angle (the same closed form as the Renderer's, shared from a pure helper in `src/sim` or `src/tuning` so audio does not import the Renderer) crosses a full turn; pitch and level rise with the charge. No loop to start and stop, so Rollback and scrubbing cannot leave one running.
- The Flail's `Hit`: a heavy spiked thud, and a chain rattle on `Block` and `WallStrike`, chosen by the attacker's Weapon look. Synthesised in `src/audio/synth.ts` like the others; add to `data/audio.json` only what the existing cues tune there.

## 6. AI

`src/controllers/ai.ts`. Every new behaviour is an optional `AiDifficulty` knob in `data/ai.json`, off by default in `skillOf`, drawing randomness only through `chance()` and **only when a Flail is in play**, so Easy, Normal and Hard and every existing golden hash stay exactly as they are. New memory goes in `AiMemory` / `save()` / `load()` as small plain data. The AI uses only what it sees, Reaction Time ago (a Sighting's Action carries the `charge`).

- **Spinning up** (attacker with a Flail): `spinHold`, 0..1, how much of the full charge it aims for when it has room: its target out of its reach, Staggered, knocked down, Sheathed, or busy with an ally. It lets go early when an enemy Wind-up it sees would Release inside its own remaining spin, or when the target steps into reach and is open. The newer tiers (Beginner, Skilled, Expert) get rising values; Easy, Normal and Hard get none (they swing it like any Weapon).
- **Reading a spin** (defender facing a Flail): `spinRespect`, 0..1: against a charge above a threshold it prefers to step out of reach, Chamber, or hit first if its own Wind-up Releases before the spin could land, rather than stand and Block a Heavy Blow (which pushes it back). Same tiers.
- Reach and timing helpers (`reach`, `attackTimings`) need nothing: the Flail is rigid.

Tests in `src/controllers/ai.test.ts` with the existing helpers (`vsAi`, `scriptedController`, `runControllers`): an Expert with a Flail and a far target holds toward full charge; it Releases early when the target winds up in reach; an Expert facing a full spin backs off or Chambers more often than it Blocks; Hard does none of this; the golden test passes unchanged.

## 7. Docs

- `CONTEXT.md`: **Weapon roster** gains the Flail; **Weapon** gains `attacks` and `spinUp`; new terms **Spin-up** (charge, what keeps and drops it; _Avoid_: charge attack, power-up) and, under Weapon or its own entry, the Flail's missing Thrust; **Heavy Blow** ("today the Halberd's, the Sledge Hammer's and a spun-up Flail's"); **Feint**, **Chain**, **Whiff Chain** and **Chamber** each gain their one Flail sentence; **Direction** notes a Weapon may lack an Attack Direction; **Reaction Time** gains the two AI behaviours.
- ADR 0026 (written in Stage 2); amend it if Stage 3 had to add anything to the Simulation.
- `README.md` if it lists the Weapons.

## Stages

1. **A plain Weapon.** Sections 1 and 2. Playable everywhere a Weapon is picked; rigid chain; no Spin-up.
2. **The Spin-up.** Section 3, ADR 0026.
3. **The chain, the whirl, the sounds.** Sections 4 and 5.
4. **The AI.** Section 6.
5. **Docs and verification.** Section 7, the Verification list, tuning notes for the user.

Each Stage ends with `npm run typecheck` and `npm test` clean (`npm run test:slow` too when it touched `src/sim`, `src/net` or `src/controllers`), a Result below, and a stop for a playtest.

## Results

(One "### Stage N result" per Stage: what was built, any deviation from the plan and why, what to playtest.)

### Stage 1 result

**Built.**
- `data/weapons/flail.json`: the plan's values but `speed` (below), plus `attacks: ["Overhead", "Left", "Right"]`, `look: "flail"` and `chain: 0.35`. It loads second in the roster (file order), after the Arming Sword, which stays the default.
- `src/tuning/weapon.ts`: the `flail` look; optional `attacks` (parsed into Direction order, absent when all four, written to the file only when fewer, must hold Overhead); `attackDirection(weapon, direction)`; optional render-only `chain` (any look may carry it, only the flail look draws it, so switching a look in the Editor never strands a draft). `sizedTuning` scales `chain` with height. No other Weapon file changed.
- The fallback, in one place per site: `attackDirectionOf` (`src/sim/actions/attack.ts`) maps the Intent's Direction in `startAttack`, the Whiff Chain's queued Direction and the Chain's Direction; `feint` compares against the mapped Direction (an Attack Feint's event carries it; a Block Feint keeps the Intent's). `src/sim/chamber.ts` needed no change: it already judges the Attack's own Direction, so a Flail cannot Chamber a Thrust.
- AI (`src/controllers/ai.ts`): `chooseDirection`, its mistake pick and `chooseFeint` draw from the Weapon's `attacks` (the same draws as before for every other Weapon: the same option lists, the same `pick`); the hop's threat reach counts `THRUST_REACH` only for a Weapon with a Thrust; it never plans a Chamber in a Direction its Weapon lacks. The three other `THRUST_REACH` sites read the Attack's own Direction, which is never Thrust for a Flail, so they needed nothing. `BESIDE` is a Block's and stays.
- Rigid look (`src/render/fighterView.ts`, `placeFlail`): shaft to `length - chain - head`, an iron cap, seven interlocked torus links, a ball of 60% of the Head with fourteen spikes reaching the tip (the Head's centre is the ball's). Blood: a shaft contact smears the shaft, a ball contact patches the ball. `src/render/sheathed.ts` needed nothing (it is Weapon-generic): on the back the rigid ball stands up above the shoulder until Stage 3 hangs it.
- Icon (`src/play/icons.ts`), the menu thumbnail (`public/thumbs/weapons/flail.webp`, from `#/thumbs/weapons/flail`), and a `chain` slider in the Editor's Weapon panel.
- Tests: `src/sim/flail.test.ts` (the Feint loop first: it fails without the `feint` mapping; Thrust press, Thrust held, Overhead→Left and Left→Thrust Feints, Block Feint in Thrust, Chain and Whiff Chain in Thrust, Blocking a Thrust, no Chamber of a Thrust, Hits by the ball at reach and by the shaft up close, never Heavy unspun, every other Weapon still Thrusts), `src/sim/runWeapons.test.ts`, `attacks`/`chain` in `src/tuning/weapons.test.ts`, `leftOutWeapons` in `src/tuning/dungeon.test.ts`, and two AI vs AI Matches in `src/controllers/ai.test.ts` (a Hard and an Expert Flail AI never ask for a Thrust Attack and still fight).

**Deviations.**
- **`"random"` in a Run.** Run Encounters' `"random"` Weapon (`hallRoster`) and Weapon loot (`pickItem`) drew from the whole roster, so the Flail would have entered Runs (against the scope) and every seeded Run would have moved. New Tuning Data `dungeon.leftOutWeapons: ["Flail"]` and `runWeapons(tuning)` (the roster without them, in file order): both draws read it, so their pools are exactly the old roster in the old order and no recorded hash moved. Nothing was re-recorded; the AI golden test passes unchanged. Battle Troops name their Weapons, so nothing changes there.
- **Motions.** The plan wanted the Flail's own wide, round swings. Choreographed side swings came out of the generator's body clearance either lifted over a standing head, or level but low enough to hit a Crouch looking up 24° (the AI's Duck rule, `ai.duckMaxPitch`, assumes no side swing does at -1° or more: `ai.test.ts` checks every Weapon), and slow through contact (0.6× the Halberd's Blade Speed). The Halberd has the same length and hand spacing and its Editor-tuned swings pass all of that, so the Flail takes them: `copies` in `choreo.mjs` writes the Halberd's Overhead, Left, BlockOverhead, DrawBack and SheatheBack into `data/motions/flail/`; its Right is the default, as the Halberd's is (so there is no `right` override). Its Idle is its own, generated (a two-handed guard). The three held Wind-ups read apart from behind at a glance (high over the left shoulder, high behind the head, high over the right).
- **`gen.mjs` takes Weapon names** (`npm run motions:two-handed -- Flail`) and `copies`. The Longsword's, the Halberd's and the Sledge Hammer's committed overrides have been tuned in the Editor since they were generated (a full run rewrites some of their files and adds dozens they do not have), so the Flail is generated alone. Copied files are read before anything is written.
- **`speed` 45, not 20.** With the Halberd's swings the ball meets a body at 44 to 52 m/s. At 20 every Head Hit would be a Heavy Blow (2.2 to 2.6× the reference, over `heavyBlow.speed` 1.25) and deal over 100. At 45 a Head Hit deals about `damage` (44 to 52) and none is Heavy, so Stage 2's `spinUp` behaves as section 3 means it: `from` 0.7 never Heavy, `to` 1.4 always (about 1.4 to 1.6× the reference).
- **Two existing tests changed, both roster listings:** the roster's names in `src/tuning/weapons.test.ts` and `src/editor/tuningSections.test.ts` gained the Flail, and `src/sim/tempo.test.ts`'s "the unit Tempo is every Weapon today" leaves the Flail out (its Tempo is the plan's 1.1 / 1 / 1.2).

**Numbers worth tuning.** `speed` 45 and `damage` 45 (a Head Hit ≈ 45 to 52, against the Halberd's ≈ 95 to 120 and the Longsword's ≈ 45 to 65); `shaftDamage` 0.15 (up close, 1.0 to 1.6 m, only the shaft lands, for 2 to 7); `tempo` 1.1 / 1 / 1.2; `chain` 0.35 and `head` 0.22 (the ball is 60% of the Head, its spikes the rest).

**Playtest.** Pick the Flail in the menu and in a Lobby Seat (its card and icon), and in the Editor's sandbox (Weapons folder). Swing each Direction from about 2 m; press Thrust and wheel down (an Overhead); hold Thrust through an Overhead, then Feint to Left and back; Chain and Whiff Chain holding Thrust; Block all four Directions, Thrust included; Sheathe and Draw (the ball stands up over the shoulder for now). Fight a Hard or Expert AI with it, and against an AI that has it. Start a Run with it from the Lineup and check no enemy and no drop is a Flail. Feel whether it is usable up close.

### Stage 2 result

**Built.**
- `data/weapons/flail.json` gains `spinUp: { seconds: 1.5, from: 0.7, to: 1.4 }`; no other Weapon file changed. `src/tuning/weapon.ts`: optional `spinUp` (parsed, validated `seconds > 0`, `0 < from <= to`, written to the file only when present), `spinUpChargeTicks(weapon)` (full charge in Ticks, 90; 0 without one) and `spinUpSpeed(weapon, charge)` (1 without one, else `from + (to - from) × min(1, charge / full)`).
- `AttackAction.charge` (`src/sim/state.ts`), present only for a Weapon with `spinUp`. `startAttack` sets it to 0 (so do a Chain and a Whiff Chain, which start through it); each Wind-up Tick adds one, capped at full (`windUpCharge`); the Tick that lets go is Release's first and adds nothing; it is kept, frozen, through Release, Recovery and a lodge. An Attack Feint carries it into the new Wind-up (`feint.ts`); a Block Feint, a Stagger, a Knockdown or anything else that replaces the Action drops it with the Action.
- `findContacts` (`src/sim/combat.ts`) multiplies the contact's Blade Speed by `spinUpSpeed` for Fighter contacts and the Wall contact, where it is produced. `hitDamage` and `isHeavyBlow` are untouched; damage, Heavy Blows, Block Impact and the `Hit` / `Block` / `WallStrike` events (and so a Death's recorded blow) all see the spun speed.
- Resync validation (`src/net/messages.ts`) accepts an optional `charge`, a non-negative whole number (`messages.test.ts`: a negative, fractional or string charge is refused; a spinning Attack round-trips).
- The Editor's Weapon panel: a Spin-up folder (to full (s), no charge ×, full charge ×) for a Weapon with one, and Attacks toggles (Left, Right, Thrust; Overhead always) for a Weapon that lacks a Direction or has the flail look. Checked in the sandbox (`#/editor/sandbox?dev=1`, Weapons → Flail): it fights, both folders are there, no page errors.
- ADR 0026; CONTEXT.md: **Spin-up**, and the Spin-up sentences in **Blade Speed**, **Weapon**, **Heavy Blow**, **Feint**, **Chain** and **Whiff Chain**.
- Tests (`src/sim/flail.test.ts`, written first): the charge per Tick and its cap, frozen through Release and Recovery; Hits at zero, half and full charge for `from`, the midpoint and `to` × the same swing unspun (Blade Speed and damage, every Direction); a full charge Heavy at every distance the ball lands on a body, in every Direction, a tap never; a full Hit knocks down and Slides, a full Block pushes and holds, a tapped Block does not; an Attack Feint keeps it (and a Feint every Tick still builds it), a Block Feint and a Stagger drop it; a Chain and a Whiff Chain start at zero; no other Weapon's states carry `charge`, and a Longsword Duel recorded on the code before Stage 2 hashes the same (`3d3fe12b`); a state saved mid-spin restores and re-simulates to the same hash. `src/tuning/weapons.test.ts` (parse, validate, serialize, `spinUpSpeed`) and `src/editor/tuningSections.test.ts` (Spin-up and Attacks edited, saved and reloaded; an invalid Spin-up refused).

**Deviations.**
- **A Feint's Tick adds one.** The plan has an Attack Feint carry the old charge. The Feint Tick is a Wind-up Tick of the new Attack, so it also adds one, as any Wind-up Tick does: otherwise a Player whose aim crosses a Direction boundary every Tick would hold the Wind-up and never build a charge.
- **Two Stage 1 Flail tests changed**: two `toEqual`s on a Flail's Attack Action in `flail.test.ts` now include `charge: 0` (a Flail's Attack carries it, by design). No other existing test changed; `npm test` and `npm run test:slow` pass, the AI golden test unchanged.
- `startAttack` takes an optional fourth argument (the charge to start with), used only by the Feint.

**Checked against the measured contact speeds.** Head Hits on an idle body land at 2.1 to 2.2 m (Overhead), 1.7 to 2.1 m (Left) and 1.9 to 2.1 m (Right). A tap Releases with the charge its Wind-up built (23 Ticks of 90 in every Direction): 0.88×, so its Head Hits meet at 0.85 to 1.01× the reference Blade Speed (38 to 45 damage) and are never Heavy. Unspun (0.7×) is lower still. A full charge meets at 1.32 to 1.60× (59 to 72 damage), always over `heavyBlow.speed` 1.25. Closer in, only the shaft lands (never Heavy, 3 to 10 damage). On a Block, a full spin is Heavy only where the ball meets the Blocking blade: from about 2.2 m for an Overhead or a Left, 1.8 m or 2.3 m and more for a Right; closer, the blades meet slower down the Weapon and the Block is not Heavy.

**Numbers worth tuning.** `spinUp.seconds` 1.5 (full charge after 90 Ticks of Wind-up, about 67 Ticks past the held pose); `spinUp.from` 0.7 (a tap is 0.88×, since its Wind-up already builds 23 Ticks; lower `from` to make taps weaker still); `spinUp.to` 1.4 (with `heavyBlow.speed` 1.25 every full Head Hit is Heavy; at 1.3 a Left or Right near the edge of reach would not be); `blockImpact.dealt` 1.6, which now multiplies with the spun Blade Speed: a full spin's Block Impact is up to 1.6× a tap's (1.4 / 0.88), until the clamp in `startBlockImpact` (Blade Speed over the reference at most 1.5) caps it.

**Playtest.** In the Editor's sandbox (Weapons → Flail, Tuning Data → Weapons → Flail → Spin-up) or against an AI: tap each Direction from 2 m (it Staggers, never knocks down); hold the Wind-up about 1.5 s and Release (Knockdown and a Slide on a Hit at reach; a Blocker pushed back from 2.2 m); hold then Feint Left to Right and Release (still full); hold then Block-Feint, then attack again (back to a tap's strength); hold while being hit (the Stagger drops it); Chain and Whiff Chain after a full spin (the next swing is a tap's). Feel whether holding 1.5 s is worth the risk, and whether a tap is too weak up close. There is no whirl yet: the charge cannot be seen until Stage 3, so the AI and the opponent read nothing.

### Stage 3 result

**Built.**
- `src/render/flailChain.ts` (pure, no DOM): `flailBall(input) → { ball, links }` and `flailChainOf(from, to, i, alpha, tuning, drawnPose?)`, a function of the two states drawn between, alpha and Tuning Data only, holding nothing between frames.
  - **Wind-up**: the ball whirls on a cone round the shaft's end. The cone's axis leans from the shaft toward the swing's own axis (an Overhead's turns about the Fighter's left, a Left's down, a Right's up, measured from each Release), and the ball turns about it the way the swing goes, so the plane and sense of the whirl are a second read of the Direction. Turn 0 is the circle's lowest point; the ball is carried out of the hang over its first `WHIRL_BLEND` Ticks of charge, and only as far as the shaft is raised (`WHIRL_LOW`..`WHIRL_HIGH`), so a Chain whose shaft is still low from the Recovery lifts the ball into the whirl instead of sweeping it through the body. A Whiff Chain (recognised by its Motion Blend of `windUpEnd + 1` Ticks) carries it out of the simulated ball where the swing left it.
  - **Release**: from the whirl (still turning) onto the simulated ball over `RELEASE_BLEND` Ticks, at once on a Hit, then exactly on it to the first Recovery Tick (`releaseEnd`); a lodged Weapon holds it in the victim.
  - **Recovery and a Blocked or Chambered Stagger**: from the simulated ball to hanging over `HANG_BLEND` Ticks (the follow-through carries it on first). **Everything else** hangs straight down from the shaft's end. A fallen Fighter's ball falls from where it was as it fell to hanging from the falling Weapon.
  - Off the simulated ball it is kept out of the floor and of the Fighter's head (a sphere) and torso (a capsule whose push fades out at its ends, so it never snaps). The chain's links lie evenly on a straight line when taut and on a sagging parabola when slack.
- **The angle, shared**: `whirlTurns(weapon, tick, charge)` in `src/tuning/weapon.ts` (beside `spinUpSpeed`): `to·tick + ∫₀^charge (rate(c) − to) dc`, the rate rising evenly from `WHIRL_TURNS_PER_SECOND.from` to `.to` over the charge. Each Wind-up Tick adds one to the state Tick and (to full) the charge, so the ball turns at its charge's rate and, held at full, on at the top rate with only the Tick moving. Continuous through an Attack Feint (the charge carries on), so the same Tick always draws and sounds the same whirl.
- `drawnPose` gives a flail's pose its `flail` chain (in hand, Sheathed, fallen); `FighterView`'s `placeFlail` draws the links along it (each along the chain where it is, a quarter turn from the last) and turns the ball and its spikes with the chain's last stretch. Without a chain (the Motion Editor, a thumbnail) it is rigid as in Stage 1. Blood on the ball rides and turns with the drawn ball, and drips fall from it (`bladeBlood.ts`). The swing trail follows the drawn ball (`renderer.ts`). The sandbox's Blade Sweep and Hit Zone overlays read the Simulation's blade, so they still show the rigid Weapon (`colliderView.ts` draws Arena colliders only and needed nothing). Sheathed on the back the ball hangs down the outside of the shaft from its end, static (`sheathedFlail`). A Flail Kill cuts as the Death records it (`dismember.ts` unchanged).
- **Audio**: a `Whirl` cue, one whoosh on each Tick the whirl's angle passes a whole turn (`whirlTurns` of the state Tick and the charge, from that state alone, so Rollback, scrubbing and the Final Blow Shot hear the same), its `charge` (0..1) raising pitch (0.75× to 1.5×) and level (35% to 100%) and shortening it. The Flail's Head Hit is `by: 'Ball'`: the stock heavy blow pitched down (rate 0.78) with a synthesised spike crunch over it (a deep synthesised thud until the clip loads); its Block and WallStrike carry `chain: true` and add a rattle of small iron links. Chosen by the attacker's Weapon look, which `soundCues` reads from Tuning Data now passed to it (`SimAudio` gets it from `createBrowserAudio(hearing, tuning)`; the sandbox passes its live Tuning Data). Every other Weapon's cues are byte for byte as before, with or without the Tuning Data.
- The Editor sandbox has a **Spin-up** script (yellow spins each Direction past full at blue, a Block, a hang, a Sheathe and Draw), used for the screenshots below.
- Tests: `src/render/flailChain.test.ts` (scrubbing forward and back gives the same chain; the ball exactly on the simulated ball from the blend's end through `releaseEnd` in every Direction at a tap, half and full, and on a Hit and while lodged; hanging straight down at Idle and in a Block; above the floor in a Knockdown; the turn sense of each Direction against its Release; the rate rising with the charge and holding at full, the ball still turning when held there; the whirl clear of the head at Size 0.6, 1 and 1.4; no pop through a spin, its Release and Recovery, a Whiff Chain or a Chain); `src/audio/cues.test.ts` (the Whirl's Ticks, count, charge and quickening against `whirlTurns`; none for a tap, an Attack Feint carrying the whirl on, none without Tuning Data or from another Weapon; Ball, Shaft, Block and WallStrike sounds by the attacker's look; every other Weapon's cues unchanged); `src/audio/listener.test.ts` (heard through `SimAudio`, the same after a scrub back). No existing test changed.

**Deviations.**
- **Nothing in the Simulation changed**, so ADR 0026 is not amended. A first cut added a count of Ticks held at full charge to `AttackAction`; review showed the state Tick already gives the held-at-full turning in closed form, so it was taken out. The cost: where on the circle a whirl starts depends on the Tick it starts on (hidden by the blend out of the hang).
- The cone's axis is not the shaft but leans toward the swing's axis (always the same way, so it never flips sides): around the shaft alone an Overhead has no turn sense (its shaft lies square to the swing's axis).
- **Snaps left in** (render only, outside Release): the Simulation keeps nothing of a whirl once the Attack is gone, so a Block Feint, a Hit Stagger, a Knockdown or a killing Hit out of a spin drops the ball straight to hanging (up to about 0.8 m in a frame). A Hit Stagger or Knockdown out of Idle or Recovery is already hanging and does not jump. A Sheathe or Draw moves the ball to the back with the Weapon at the swap, as the Weapon itself does.
- The whoosh's synth layers use the same `Math.random` variation as every synthesised sound (playback only); which Ticks whoosh is pure.

**Numbers worth tuning** (render and sound only, code constants): `WHIRL_TURNS_PER_SECOND` 0.8 → 2.6 turns a second (a tap's Wind-up turns about a third of a turn; a full spin about 2.4 turns while charging, then 2.6 a second); `WHIRL_CONE` 62° (circle radius about 0.41 m, centre 0.22 m beyond the shaft's end at standard Size), `WHIRL_TILT` 1 (the axis halfway between shaft and swing axis); `WHIRL_BLEND` 12 Ticks, `WHIRL_LOW`/`WHIRL_HIGH` shaft height 0 to 0.35; `RELEASE_BLEND` 2 Ticks; `HANG_BLEND` 20 Ticks; head 0.12 m and torso 0.17 m keep-out radii (× Size). Sounds (`synth.ts`): `WHIRL_LEVEL` 0.9, `RATTLE_LEVEL` 0.8, the Ball's stock rate 0.78 and level 0.8 + 0.4 × strength (`stock.ts`). Measured: the held whirl clears the head by 0.35 m (Size 0.6) to 0.8 m and more (1.4).

**Playtest.** In the Editor sandbox (`#/editor/sandbox`, Weapons → yellow Flail, script Spin-up), play at speed 1 with sound on, then scrub: does each Direction's whirl read at a glance from behind and from the side, and does the whoosh quicken and rise convincingly toward full? Is 2.6 turns a second at full too frantic or too lazy? Does the Release blend (2 Ticks) look like the ball flying off the whirl, or like a snap? Kill script (Right, 2.0 m): the ball on the body, the spiked thud. In a Duel against an AI: hold a spin and Release into a Block (the rattle), Feint across Directions mid-spin (the whirl reverses its sense), Block-Feint out of a full spin (the accepted snap to hanging: is it acceptable?), Chain and Whiff Chain, Sheathe and Draw (the ball on the back). Try Size 0.6 and 1.4 and a few Body models.

### Stage 4 result

**Built** (`src/controllers/ai.ts`; nothing in `src/sim`, `src/render` or `src/audio` changed).
- Two optional `AiDifficulty` knobs in `data/ai.json`, off in `skillOf`, in `AI_DIFFICULTY_EXTRAS` (so the Editor's AI panel shows them as sliders for the tiers that set them, and a Style may scale them): `spinHold` and `spinRespect`, 0.4 / 0.7 / 0.9 on Beginner / Skilled / Expert, absent on Easy / Normal / Hard. New optional `ai.spinThreat` (0.6, the share of full charge from which a spin is read; absent means 1), parsed as a fraction, with an Editor slider at the top of the AI panel.
- **Spinning up** (`spinAim`, `spinOn`, `spinRoom`, `spinUnder`). `startAttack` gives a Flail Attack an aim of `spinHold` × full charge (`AttackPlan.spin`), plus a deadline (`spinUntil`: the aim plus SPIN_PATIENCE, 60 Ticks). A timed Attack (a leap or a Landing punish) gets no aim. In the Wind-up, short of the aim:
  - it holds while it has room: the target is beyond the ball's reach, Staggered for longer than the spin left plus the way to contact, lying in a Knockdown, Sheathed, or facing an ally on it and not itself;
  - it also holds against a target Blocking in the Direction that meets it;
  - a target open in the ball's reach, it lets go;
  - where only the shaft lands, it backs out while it holds, or lets go if it has no safe way back.
  
  Once spun up, it walks in to the ball's reach and lets go there. At the deadline, out of the ball's reach or inside the shaft's range, it lets the spin go into a Block. With an enemy Wind-up coming (`spinUnder`, from `defend`), it spins on while the enemy's blow would land after its own spin's, or while the enemy is busy with an ally. Otherwise, at its held pose with the attacker in the ball's reach (and, in a team, no ally in its swing line), it lets go at once (an Outpace). Failing that, it defends as ever. A spinning Flail AI stands its ground through its Release instead of walking on into shaft range, and pressing it keeps out of shaft range (a spacing floor at the ball's reach).
- **Reading a spin** (`readSpin`, `backOut`). The first time the charge it sees in a Flail's Wind-up reaches `spinThreat` of full, it rolls `chance(spinRespect)` once per Attack (`DefencePlan.spinRead`). An Attack Feint is a new Attack, so it is read again. When it reads the spin, in order:
  1. it hits first (Outpace) if its own Wind-up plus its way to contact lands before the spin's earliest Release, way to contact and walk into the ball's reach;
  2. it Chambers a Wind-up still rising to its held pose (a spin Feinted into a new Direction), if its Weapon attacks in the Direction that meets it (a Flail's Attack is never a Thrust);
  3. otherwise it steps out (`Back`): it backs out to twice SPIN_OUT (0.15 m) beyond where the ball lands, keeping its Block up until it is SPIN_OUT clear, then stands Idle and lets the Release whiff. `breakHold` is skipped for a Back plan.
  
  A tap (under the threshold) is met exactly as before.
- New memory is plain data in plans already saved: `AttackPlan.spin` and `spinUntil`, `DefencePlan.spinRead` and the `Back` kind. Randomness: only the `spinRespect` roll, and only for a Flail's spin. The spinner draws nothing new.
- Tests (`src/controllers/ai.test.ts`, "AI Stage 4", written first, each under 1 s):
  - the knob values per tier and Style;
  - an Expert with a far target Releases at 0.9 of full or more and lands a Heavy Blow, a Beginner much less, and the same Expert without the knob taps;
  - it lets go early when the target winds up in reach or steps in open;
  - it never stands spinning where only the shaft lands, and never Releases a spin there;
  - an Expert facing a full spin clears or Chambers it more often than it Blocks over seeds 1 to 10 (without the knob it Blocks 9 of 10 or more);
  - against taps it plays hash for hash as without the knob;
  - Hard Blocks every full spin and does not spin;
  - Expert and Skilled Matches with every other Weapon hash the same with the knobs zeroed;
  - a Flail AI saved mid-spin restores and plays on to the same hashes.

**Deviations.**
- **The ball's reach is per Direction, not `reach`.** A spin pays only where the ball lands, and the measured Head Hit distances (Stage 2: Overhead 2.1 to 2.2 m, Left 1.7 to 2.1, Right 1.9 to 2.1) differ by Direction and run past the AI's `reach` (2.0). A first cut Released at `reach` and walked on through the Release, so most full spins landed with the shaft. Now `SPIN_BALL` holds the measured band per Direction as offsets from `reach`, scaled with Size: a code constant tied to the Flail's Motions, to update if they change. The plan said `reach` and `attackTimings` need nothing, and they still need nothing.
- **Chamber against a spin** works only on a Wind-up still rising (a spin Feinted into a new Direction). A held spin's Release cannot be timed: the Chamber window is 9 Ticks, and even an Expert's Reaction Time is 10.
- **One existing test changed**: "Beginner, Skilled and Expert play Easy, Normal and Hard with every new knob on" destructures the new tiers' knobs before comparing the rest with the old tiers. It now lists `spinHold` and `spinRespect` too. A tier knob in `data/ai.json` cannot be added without this. No other test changed, and no golden hash was re-recorded.

**Measured** (headless, the sandbox's AI vs AI Match, Expert vs Expert, best of 3, seeds 1 to 6, the editor Arena; "full" means a Release at 0.6 of full or more):

| Match | Wins | Flail Releases spun | Median charge | Full spins: Blocked / Hit / Chambered / whiffed | Heavy Hits / Blocks | Longest hold | Spins let go into a Block |
|---|---|---|---|---|---|---|---|
| Flail v Longsword | 3–3 | 75 of 126 (60%) | 60 | 32 / 11 / 1 / 4 | 6 / 12 | 69 Ticks | 7 |
| knobs off | 0–6 | 39 of 117 (33%, swing-in holds) | 32 | 2 / 1 / 0 / 0 | 0 / 0 | — | — |
| Flail v Flail | 3–3 | 238 of 428 (56%) | 87 | 138 / 35 / 2 / 0 | 32 / 90 | 117 Ticks | 9 |
| knobs off | 1–1 (4 hit the time cap) | 539 of 1804 (30%) | 32 | 32 / 8 / 0 / 0 | 0 / 0 | — | — |

A defender that reads a spin backs off under its Block. The spinner walks after it faster than it can back off (the backward walk is 0.6×), so many reads still end in a Block, but a pushed one rather than a Heavy Hit. No AI was stuck spinning: the longest hold was 117 Ticks, then the deadline. In the sandbox (`#/editor/sandbox?dev=1`, yellow Expert Flail, blue Expert Longsword, seed 1) there were no page errors. Around Match Tick 1608 to 1624 the Flail holds its spin while the Longsword steps back under its Block. Before the review's fixes, the Flail won 6–0 against the Longsword (5–1 after the Block margin fix). Without the knobs it loses 0–6, and with them it is even.

**Numbers worth tuning.**
- Tier values `spinHold` and `spinRespect` 0.4 / 0.7 / 0.9. Beginner's 0.4 aim (36 Ticks) is never Heavy.
- `ai.spinThreat` 0.6: about where a spin starts to be Heavy at contact.
- Code constants: `SPIN_BALL` (the ball's band per Direction), SPIN_PATIENCE 60 Ticks, SPIN_OUT 0.15 m.

**Playtest.**
- In the sandbox, watch Expert Flail vs Expert Longsword, and Flail vs Flail, over a few seeds. Does a spin read as a threat, and does the Flail AI's let-go timing feel fair: early when you step in or wind up, late when you keep away?
- Play against an Expert with the Flail from about 2 m:
  - stay out of reach (it spins and comes in);
  - step in during its spin (it lets go);
  - wind up inside its spin (it lets go first if it is at its held pose);
  - Block a full spin (the push).
- Play with the Flail against an Expert: spin up in front of it (it backs off under its Block), spin and Feint into another Direction (it may Chamber), and tap (it Blocks as ever).
- Is a 3–3 Expert Flail against a Longsword the balance wanted? Is the backing-off defender too passive?

## Verification

- Menu, Lobby and a Run's Inventory offer the Flail with its icon; a Duel, a Run Hall and a Battle (as a Player) play with it; a Soldier a Player takes over behaves as today.
- In the Editor's sandbox: each Direction at no, half and full charge against an idle, a Blocking and a Chambering opponent; Thrust presses and wheel-down give an Overhead; Feints keep the whirl going; Chains restart it; a full charge knocks down and pushes a Blocker back.
- Screenshots (Playwright, `npm run dev`): the whirl at three charges, the ball on the contact point at a Hit, the hang at Idle and in a Block, Sheathed on the back, on `?body=skeleton` and two Body models, at Size 0.6 and 1.4. Scrub back and forth across a spin: the chain is the same at the same Tick.
- Online: two peers, one with a Flail, no checksum mismatch through spins, Feints and Heavy Blows.
- Every test that existed before passes unchanged, the AI golden test above all.

## Risks to watch while building

- **Golden hashes and seeded picks.** Adding a roster Weapon changes anything that picks `"weapon": "random"` from the whole roster (Run Encounters in `data/dungeon.json`, AI Seats, tests that record seeded Runs). Find how random Weapons are drawn before Stage 1; if recorded hashes move only because the roster grew, say so in the Result and re-record just those, never the AI golden Matches (which name their Weapons).
- **The Feint loop** described in section 2: the first test to write.
- **The whirl and the body.** A long shaft's ball circling a cone can pass through the Fighter's head or an ally. It is render-only, so it cannot hurt, but it must not look wrong: tune the cone and the held Wind-up poses together.
- **Reading the Direction.** With a static held pose plus a whirl, the three Wind-ups must still be told apart at a glance: the held poses and the whirl's plane carry it.
- **Balance.** `from` below 1 makes a tapped swing weaker than the Motion alone would be; with `tempo.windUp` this decides whether the Flail is usable up close. Leave the numbers easy to tune in the Editor and list them in the Stage 2 Result.
- **Block Impact** also scales with Blade Speed: a full spin into a Block will knock the defender's hand far. Check it still looks right at `to`.
