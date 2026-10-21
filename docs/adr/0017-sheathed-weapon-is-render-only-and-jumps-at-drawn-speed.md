# 0017 — A sheathed Weapon is render-only; a Sheathed Fighter Jumps at its drawn speed

## Status

Accepted.

## Context

A Fighter can Sheathe its Weapon to cover ground faster, and Draw it again to fight. Two questions follow.

First, where the sheathed Weapon is in the Simulation. A drawn Weapon is solved inside the Tick (ADR 0001, ADR 0004): it sweeps (ADR 0002), it Blocks, and a Wall stops it. A Weapon on the hip or back could keep a capsule too, so a blow landing on it would be stopped, or it could knock into Walls. But it would be a second Weapon pose to solve, hash and keep rollback-safe, and it would turn the back slot into a free shield behind a running Fighter, while a Sheathed Fighter is meant to be open: it cannot Block.

Second, how far the speed bonus reaches. A Jump carries its walk into the air (`takeOff`), and the air steers toward the walk speed (`fly`). Jump reach (`docs/jump-reach.md`), the AI's jump Links (ADR 0011, ADR 0013) and its Jump safety check are all measured from the drawn walk speed. A faster Sheathed walk carried into the Jump would reach further than any of them know: a Sheathed Fighter could clear gaps the navmesh says cannot be crossed, and the AI's check that a slightly-off Jump is safe would no longer hold for it.

## Decision

- A sheathed Weapon is render-only. While a Fighter is Sheathed, the Simulation gives its Weapon no Blade Sweep, no Block, no Chamber and no collision: no Hit, Block or Wall touches it. The blade transform stays whatever the hand pose solves (the renderer draws the Weapon in its slot instead), and nothing in the Tick reads it while Sheathed, since a Sheathed Fighter cannot Attack or Block.
- Sheathed is plain Fighter state (`FighterState.sheathed`), so it is hashed and snapshotted like the rest. It flips at the Sheathe or Draw Motion's `swap` marker, and an interrupt keeps whatever has already happened.
- The Sheathed speed bonus (`fighter.sheathedWalkFactor`) is ground-only. A Jump takes off with, and steers in the air toward, the drawn walk speed, so a Sheathed Jump flies exactly the arc a drawn one does.

## Consequences

- Jump reach, `jumpArc`, jump Links and the AI's Jump checks stay valid unchanged for Sheathed Fighters.
- Sheathing is a pure trade: faster on the ground, no defence. A sheathed Weapon on the back never stops a blow.
- What the renderer draws in the slot may overlap a Wall or another Fighter: cosmetic only.
- The Death Ragdoll keeps a Sheathed Weapon on the body; a drawn one still leaves the hand.
