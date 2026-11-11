# Flail (ball and chain): staged implementation plan

> Built one Stage per session with `docs/plans/flail-prompt.md`. The decisions under **Context** are agreed with the user and fixed: if a Stage cannot be built as written, take the smallest deviation that keeps them and note it in the Stage's Result; if it would change them, stop and ask. File and function names below were read from the code when the plan was written; numbers are starting values to tune.

Status: planned, nothing built.

## Progress

- [ ] Stage 1: the Flail as a plain Weapon (sections 1 and 2): data, Motions, rigid look, icon, no Thrust
- [ ] Stage 2: the Spin-up in the Simulation (section 3), its ADR, the tuning panel
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
