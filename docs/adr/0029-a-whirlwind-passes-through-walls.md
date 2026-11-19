# 0029 — A Whirlwind's blade passes through Walls and hits what is beyond

## Status

Accepted (built in docs/plans/whirlwind.md, Stage 3).

## Context

A Blade Sweep that reaches an Arena Wall before any Fighter stops there: nothing behind the Wall is hit, and the attacker recoils as from a Block (`wallContact`, `resolveWall` in `combat.ts`). That keeps aimed Attacks honest in corridors and among pillars.

The Whirlwind (docs/plans/whirlwind.md) is a 360° spin of five turns, driven forward. In a Delver Floor's corridors, among a Battle map's walls, or beside any pillar, almost every turn would meet a Wall, so under the usual rule the spin would recoil at once nearly everywhere but an open field. The move exists for spectacle and must work in every mode.

## Decision

- **The Whirlwind's blade is never stopped by a Wall.** `findContacts` skips `wallContact` for a Whirlwind: no Wall contact, no recoil.
- **It hits through Walls.** Defenders beyond a Wall are met as if the Wall were not there, by the same sweep against their Hit Zones. This is purely physical: what the blade sweeps, it hits.
- The Whirlwind's **body** still collides with Walls as any Fighter's does: only the blade passes through.
- Every other blade (an Attack, a Throwing Dagger) keeps the old rule.

## Consequences

- A Fighter cannot hide behind a pillar or a thin wall from a Whirlwind within reach. Thick walls still shield by distance, since the blade only reaches as far as the Weapon does.
- The drawn blade visibly passes through geometry. Accepted for the spectacle; the trail may hide it.
- The AI's sense of cover (where it has one) must not count Walls against a Whirlwind.
- Hashes and the AI golden change only once Whirlwinds are thrown; Matches without one are unchanged.
