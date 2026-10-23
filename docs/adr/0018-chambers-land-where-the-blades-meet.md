# 0018 — Chambers land where the blades meet

## Status

Accepted

## Context

A Chamber was decided entirely on the Tick the chamberer pressed Attack: the right Direction, inside the Chamber window, roughly facing the attacker. Nothing asked whether the two Fighters were anywhere near each other, so two Fighters facing each other across the Arena who swung at about the same time Chambered: the far attacker Staggered and the Chamber clash sounded with the blades metres apart.

Requiring the blades to physically touch would not work as the rule itself: on the press Tick the chamberer's blade is at the start of its Wind-up, nowhere near the incoming one, and thin, fast blades meeting is the kind of geometry ADR 0002 keeps out of defensive outcomes.

## Decision

As for a Block (ADR 0002, amendment), the rule decides whether and the geometry decides when. The press is judged by the same four conditions as before, but it only marks the incoming Attack as Chambered by that Fighter (`AttackAction.chamberedBy`). The Chamber lands when that Attack's Blade Sweep reaches the chamberer's whole Weapon (the Block's capsule) or, failing that, its Hit Zones, whichever first, while the chamberer is still in its Attack in the mirrored Direction. Then, and only then, the attacker Staggers (cause Chambered) and the `Chamber` event fires, at the meeting point. An Attack whose sweep reaches nothing is no Chamber: it plays out as a whiff.

## Consequences

- No Chamber, and no Chamber sound, out of reach: range is each Weapon's real reach, with no separate distance to tune.
- The attacker Staggers on the contact Tick, a few Ticks after the press, rather than on the press itself.
- A chamberer that Feints into another Direction, or is Staggered, before the blades meet drops its pending Chamber.
- The AI keeps its Chamber's Attack going while the incoming Release lasts, and lets its counter swing once it sees the Chamber land, rather than Feinting into a Block a few Ticks after the press.
