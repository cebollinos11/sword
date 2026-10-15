# 0002 — Attacks hit physically, Blocks resolve by rule

## Status

Accepted

## Context

Attacks land only when the Blade Sweep intersects the opponent's Skeleton, so footwork, range and Motion tuning all matter. The natural question is whether Blocks should be physical too, meaning the defender's blade must intersect the attacker's Blade Sweep.

## Decision

Blocks are resolved by rule, not by geometry. When an Attack's Blade Sweep would hit a defender who is in a Block with the matching Direction and roughly faces the attacker, the Attack counts as blocked. Blade-on-blade contact may drive visuals and effects, but it never decides the outcome.

Amendment: when the rule says an Attack is blocked, the defender's blade is a capsule (Tuning Data `block.bladeRadius`) the Blade Sweep can reach as well as the Hit Zones, and whichever it reaches first is where the Block lands. So the Block happens where the blades meet, not when the Attack reaches the shoulders, and an Attack that only reaches the Blocking blade is Blocked too. A blade that is not Blocking that Attack (Idle, attacking, or Blocking the wrong way) is no obstacle: the rule still decides whether, geometry only decides when.

## Consequences

- Blocking stays readable and fair, which is the Mount & Blade feel. A Block cannot fail because of an IK quirk or a gap between two blades.
- Tuning a Block Motion never makes a Block fail (the body still catches what the blade misses), but where it holds the blade sets when the Block lands and how far out it reaches. Tuning an Attack Motion changes balance.
- A future "physical parry" mechanic would have to be added as a separate concept, not by changing Block.
