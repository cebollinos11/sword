# 0013 — Shortcut jump Links: the AI Jumps up when it beats walking round

## Status

Accepted

## Context

Jump Links (ADR 0011) only led onto Walk Surfaces that walking and dropping could not reach. In the library, a player who Jumps from the ground floor onto the bridge or a mezzanine (from beside it, where no rail stands) was followed the long way, up a ramp, because the ramps already join the floors. The AI should Jump when it is worth it, still with nothing baked per Arena.

## Decision

The navmesh also keeps a jump Link up (more than a step) onto a Walk Surface walking already reaches, when walking there from the takeoff costs at least `SHORTCUT_SAVING` (1 m) more than the Jump (its flight and `JUMP_COST`). Walking is measured along the string-pulled path through the walk and drop Links (portal midpoints overstate it and found false shortcuts between floors at the same height). Every slightly-off variant of the Jump must still be such a shortcut, as well as pass ADR 0011's error check. Such a Link is marked `shortcut`, and `findPath` then picks it or the walk by cost as usual.

Shortcut Links are taken by every difficulty, whatever their hold: `jumpNav` limits only Links onto places nothing but a Jump reaches. The plain AI (no `jumpNav`) and a Slowed one still take none.

## Consequences

- To keep building cheap, a shortcut is only looked for up onto a target, with the shortest hold that could get there, and not over a railed edge or from under a floor that would stop the Jump. Shortcuts down (over a railing) or across a gap walking also gets round are not looked for: drop Links already cover going down. The library builds in about 90 ms alone (was about 50 ms).
- The library's AI now gets from the ground floor to the gallery by Jumping onto the bridge, not by a ramp.
