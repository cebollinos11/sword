# 0027 — A body knocked down and still pushed knocks down whoever it runs into

## Status

Accepted.

## Context

A Knockdown pushes its victim a long way (a Kick's 1.5 m Slide, further for a Heavy Blow, a whole flight for a Hit in the air), but until now that body only shoved other Fighters aside through body collision. With up to four Fighters a side, and many more in a Battle, kicking one enemy into another should be a play of its own: knock a body into a group and the group goes down.

## Decision

- **Who carries a chain.** A Fighter knocked down by a Kick's Knockdown, a Heavy Blow, a Hit in the air or a Chain Knockdown records the Fighter whose blow started the chain (`FighterState.knockedBy`). It keeps that record only while it is in Knockdown and its push still moved it last Tick (a Slide on the ground, or its flight). A Shove never sets it, and Shoving a Fighter lying down clears it, so the short push of a Shove bowls nobody over.
- **What counts as running into.** After every other contact of the Tick (blades, Kicks, daggers), each carrier, in index order, is checked against every other Fighter as body collision sees them: heights overlapping, the circles within `CHAIN_TOUCH` (5 cm) of touching (collision has just pushed them apart), and the push driving toward the other body (a Fighter beside or behind a sliding body is not struck).
- **What it does.** The struck Fighter takes a Kick's Knockdown in full: `kick.knockdownDamage`, by the starter's `kickDamage` and its own `damageTaken` (none if it is the starter's teammate), and the long Slide (`kick.knockdownSlide`) away from the body that struck it, or as much speed added to its flight. It records the same starter, so the chain carries on through it: dominoes at full strength, each Fighter pushed as hard as the first. The carrier keeps its own push.
- **Who is safe.** The starter of a chain is never knocked down by it, and nobody already down is knocked down again. Everyone else, teammates of the starter included, goes down.
- **Credit.** A chain's kill belongs to its starter (`healOnKill`, a Battle's kill count). Event `ChainKnockdown { fighter, by, source, point, damage }`; audio, dust and camera shake follow it as they do a Kick's Knockdown.

## Consequences

- One more optional field on a Fighter's state, present only while a Knockdown's push lasts. A Duel with no Knockdown hashes as before; recorded Matches with one do not (the AI golden fixture was re-recorded).
- In a crowd, full-strength dominoes can lay a whole group down from one Kick, and a starter's own teammates standing behind its victim go down with the enemies. Balance is in `data/kick.json` (the Slide's length and the Knockdown's damage), with no code change.
- The AI does not plan around chains: it neither kicks enemies into each other on purpose nor keeps out of a sliding body's path. A Fighter that is down cannot be struck, so the length of a chain is bounded by the Fighters in the Duel.
- Soldiers in a Battle's Crowd are not Fighters (ADR 0020): a chain reaches only promoted Soldiers.
