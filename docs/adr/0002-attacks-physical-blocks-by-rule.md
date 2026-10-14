# 0002 — Attacks hit physically, Blocks resolve by rule

## Status

Accepted

## Context

Attacks land only when the Blade Sweep intersects the opponent's Skeleton, so footwork, range and Motion tuning all matter. The natural question is whether Blocks should be physical too, meaning the defender's blade must intersect the attacker's Blade Sweep.

## Decision

Blocks are resolved by rule, not by geometry. When an Attack's Blade Sweep would hit a defender who is in a Block with the matching Direction and roughly faces the attacker, the Attack counts as blocked. Blade-on-blade contact may drive visuals and effects, but it never decides the outcome.

## Consequences

- Blocking stays readable and fair, which is the Mount & Blade feel. A Block cannot fail because of an IK quirk or a gap between two blades.
- Tuning a Block Motion is purely cosmetic. Tuning an Attack Motion changes balance.
- A future "physical parry" mechanic would have to be added as a separate concept, not by changing Block.
