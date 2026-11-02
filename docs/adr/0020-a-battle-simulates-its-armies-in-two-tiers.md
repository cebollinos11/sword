# 0020 — A Battle simulates its armies in two tiers: the Crowd and the Fighter Pool

## Status

Proposed (`docs/plans/big-battle.md`). Stage 1 built the Crowd tier and the Battlefield as decided here (Stage 1, Result). To be Accepted when Stage 3 lands the Fighter Pool, Promotion and Demotion.

## Context

The Battle Format is 200 soldiers a side on an open field, up to four of them human Players, the rest AI. Every peer must reach the same state from the same Intents and roll back up to 15 Ticks (ADR 0001, ADR 0005, ADR 0010). A full Fighter (Skeleton, Pose-Key IK, Blade Sweep, an AI Controller) costs about 0.2 ms a Tick with its AI, and far more in a Rollback (Stage 0's bench): 400 of them cannot fit, and neither can 24 near one Player. The ways to field the armies:

- **400 full Fighters**: the duel's combat everywhere, at about 70 ms a Tick. Ruled out.
- **A cosmetic crowd**: the far battle drawn but not simulated, each peer playing its own. Cheap, but the battle's outcome would then differ between peers, or have to be sent, and it could not count.
- **Two simulated tiers**: most soldiers as cheap plain data stepped at a low rate, fighting by rule; the few near a Player as full Fighters; a deterministic rule moves a soldier between the tiers.

## Decision

A Battle simulates its armies in two tiers, both inside `SimState`, both hashed, snapshotted and rolled back like the rest of the state:

- **The Crowd**: every Soldier that is not a full Fighter right now, as plain number arrays (struct-of-arrays, `SimState.crowd`), not typed arrays, so `snapshot`, `hashValue` and a JSON resync work on it unchanged. It steps every `battle.crowd.stagger`th Tick (10 Hz), 1/stagger of the Soldiers on each Tick, by each Soldier's place in its army (so neither army is ever a step ahead of the other). It steers by a per-Team flow field and separation from neighbours, both rebuilt from the Tick's positions as scratch (never state), and fights by rule: an engaged Soldier rolls its blows from the Crowd's own seeded generator, apart from the Duel's, so the Crowd never shifts what the Fighters and their AI draw. A Tick's blows land together, after its steps.
- **The Fighter Pool** (Stage 3): a fixed number of full Fighter slots (`fighters[]`), the Players' Fighters in permanent ones, the rest bound to Soldiers that are **promoted** near a Player and **demoted** away from one. Promotion and Demotion are decided from Simulation positions only, never the camera, so every peer promotes alike, and they roll back like any position (ADR 0019).
- **Only full Fighters hit full Fighters.** A Soldier never damages a Fighter, and a Fighter never fights a Soldier: anything that fights a human has a Skeleton, a Blade Sweep and a Block.
- **The Battlefield** is an Arena built from its name (`battle:<seed>`): a heightfield whose grid cells are two flat triangles each, which are also its Walk Surfaces, so a Fighter's movement and `groundBelow` stand on exactly the ground the Crowd reads in constant time (`battlefieldHeight`). No Walls, Kit, Jump Links or Abyss.

## Consequences

- Only the Players' Intents cross the wire, as before. The Crowd adds about 4,000 numbers to the state: a snapshot copies it in about 0.14 ms, and `hashValue` walks it in about 1.3 ms, paid only by the periodic checksum (a byte-level fast path is there if checksums ever need it).
- The battle's outcome is the same on every peer and counts. Fights between Soldiers are abstract and noisy, so equal armies are about a coin flip without Players, and the Players decide close Battles.
- A Duel's and a Run's state are unchanged: `crowd` is absent outside a Battle, and `step` only carries it through.
- The Crowd's steering is a flow field over open ground: obstacles and fortifications would need pathfinding beyond it (Later).
- A Soldier near a Player but not promoted (the Attack Slots are full) must stay out of the duel's way: it waits as a Soldier, steering only, never colliding with a Fighter (Stage 4).
- Every system that iterates `fighters` must tolerate an unbound Pool slot (Stage 3), and the AI must see only bound slots.
