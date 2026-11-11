# Flail (ball and chain): staged implementation plan

> Built one Stage per session with `docs/plans/flail-prompt.md`. The decisions under **Context** are agreed with the user and fixed: if a Stage cannot be built as written, take the smallest deviation that keeps them and note it in the Stage's Result; if it would change them, stop and ask. File and function names below were read from the code when the plan was written; numbers are starting values to tune.

Status: Stages 1 and 2 built (the Flail is a playable Weapon with no Thrust, and its Spin-up scales its Blade Speed in the Simulation); Stage 3 (the loose chain, the whirl and the sounds) next.

## Progress

- [x] Stage 1: the Flail as a plain Weapon (sections 1 and 2): data, Motions, rigid look, icon, no Thrust
- [x] Stage 2: the Spin-up in the Simulation (section 3), its ADR, the tuning panel
- [ ] Stage 3: the loose chain, the whirl and the sounds (sections 4 and 5)
- [ ] Stage 4: the AI spins up and reads a spin (section 6)
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
