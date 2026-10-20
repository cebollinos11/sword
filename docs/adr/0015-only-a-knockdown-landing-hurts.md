# 0015 — Only a Knockdown Landing deals fall damage

## Status

Accepted. Amends ADR 0012.

## Context

ADR 0012 made a Jump's Landing unhurt, but a Fighter that walked, slid or was pushed off a ledge still took fall damage. Stepping off a drop while fighting cost HP for no fault of the opponent, and the two ways down a ledge (jumping and walking) were judged differently.

## Decision

- A Landing deals fall damage only when the Fighter is in Knockdown as it lands: `fall.knockdownDamageFactor` times the fall damage (by the metre beyond `fall.safeHeight`), from the real top of its arc, Jump or not, as ADR 0012 set.
- A Fighter that walked, slid or was pushed off a ledge lands unhurt, however deep the drop. A drop beyond `fall.safeHeight` still Staggers it (Landed).
- A Jump's Landing is unchanged: unhurt and never hard.

## Consequences

- Only an Abyss (or Lava, Water) kills from a drop on its own; fall damage now comes only from being knocked down over a ledge.
- The AI's walk-off drop Links (`nav.ts`) still limit and cost drops by the fall damage they would have dealt; that now stands in for the hard-Landing Stagger, not lost HP.
