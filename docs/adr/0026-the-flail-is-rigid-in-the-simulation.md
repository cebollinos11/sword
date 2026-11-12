# 0026 — The Flail is rigid in the Simulation; its Spin-up is a Tick count

## Status

Accepted.

## Context

The Flail is a shaft with a chain and a spiked ball on its end. A real flail's ball swings loose: it lags the shaft, wraps around a guard and carries momentum that builds as it is whirled. Simulating that (a chain of links or a pendulum on the shaft's end, its momentum carried from Tick to Tick) would make the ball's path, and so every Hit, Block and Chamber, depend on a physical state the rest of the game does not have.

- ADR 0001: the Simulation is a pure, deterministic function of state and Intents, cheap to snapshot and re-simulate on Rollback. A chain's dynamics would be more state to carry, more float error to diverge between browsers, and costly to re-simulate several times a frame.
- The AI plans on a Weapon's reach and its Attack timings (`reach`, `attackTimings`). A ball whose reach and timing depend on how it was swung would need its own model in the AI.
- Motions are tuned in the Editor against the blade they move (ADR 0016). A loose ball would hit where the Motion does not show.

The Flail still needs one rule of its own, or it is a Halberd with a different look: whirling it should make it hit harder.

## Decision

- **Rigid in the Simulation.** The Flail is an ordinary rigid Weapon: hand to tip, with a Head (the ball) at the tip and a shaft behind it. The Blade Sweep, Blocks (ADR 0002), Chambers (ADR 0018), Heavy Blows, Dismemberment and the AI's reach treat it like any Weapon. Its chain (`chain` in its Weapon file) is render-only: only the Renderer draws it loose, and during Release it draws the ball on the simulated tip, so the ball that is seen is the ball that hits.
- **The Spin-up is a count of Ticks, not a mass.** A Weapon with `spinUp: { seconds, from, to }` (only the Flail) gives its Attack a `charge`: 0 as the Attack starts, one more each Wind-up Tick (a Feint's Tick included) up to full (`seconds`), then frozen through Release and Recovery. At contact the Blade Speed is multiplied by `spinUpSpeed`: `from` at no charge, rising evenly to `to` at full. That one multiplication is made where `findContacts` produces each contact's Blade Speed (Fighters and Walls), so damage (`hitDamage`), the Heavy Blow (`isHeavyBlow`), Block Impact and the `Hit` / `Block` / `WallStrike` events all follow through the rules they already have. There is no separate damage rule.
- What keeps it: an Attack Feint into another Direction carries it on. What drops it: a Block Feint, a Stagger, a Knockdown and anything else that ends the Attack. A Chain and a Whiff Chain start a new Attack, at no charge.
- The whirl is visual only: the Simulation holds the usual static Wind-up pose plus the charge. Nothing is live before Release.
- A Weapon without `spinUp` carries no `charge` field at all, so its states, hashes and snapshots are byte for byte what they were.

## Consequences

- Outside Release the drawn ball differs from the simulated tip (whirling in the Wind-up, hanging in Recovery and at guard). Accepted: nothing is live then. The collider view shows the true rigid Weapon.
- The opponent reads the charge from the whirl's speed and its sound, never from a HUD; the AI reads it from the Action it sees, Reaction Time ago.
- Holding the Wind-up is now a choice with a payoff for one Weapon: a long spin is a Heavy Blow, a quick Release is weaker than the Motion alone would make it (`from` below 1, and a tap's Wind-up builds only part of the charge). Balance is tuned in the Weapon file (`spinUp`, `speed`, `heavyBlow.speed`) with no code change.
- Block Impact scales with the spun Blade Speed too, so a full spin into a Block knocks the defender's hand back harder.
- A Block lands where the blades meet (ADR 0002), so a full spin pushes a Blocking defender back only from about the ball's reach: closer in, the Blocking blade meets the Flail nearer the hands, on the shaft or where it moves slower, and the Block is not Heavy.
