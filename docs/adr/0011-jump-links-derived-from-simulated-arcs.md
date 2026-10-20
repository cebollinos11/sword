# 0011 — Jump Links are derived from simulated arcs, with an error check

## Status

Accepted

## Context

A held Jump reaches lids, ledges and the far side of gaps on every Arena (`docs/jump-reach.md`), but the navmesh (ADR 0006) only had walk and drop Links, so the AI could not follow a player onto any of them. Ways to give it jump Links:

- **Hand-placed jump points per Arena**: exact, but every Arena change needs them redone, they drift from the geometry, and an Arena-specific rule creeps into the AI.
- **A reach envelope** (anything within 4.3 m up and the level distance is reachable): cheap, but it ignores Walls, ceilings, rails and the arc's shape, so the AI would jump into a bulkhead or under a mezzanine and fail.
- **Simulated arcs**: run candidate Jumps through the Simulation's own in-air steps and keep the ones that land.

## Decision

Jump Links are derived from the Arena and Tuning Data alone, like the rest of the navmesh. `jumpArc` predicts a Jump with the very steps the Tick runs a Fighter through (take-off, flight, head bump, Wall push-out, landing, moved out of `step.ts` into `air.ts`), so it is exact for a lone Fighter. The navmesh tries Jumps onto each target's edges (lids, ledges) and off each source's edges (gaps) toward Walk Surfaces the source cannot already walk or drop to, and keeps a Jump only if it passes an error check (`jumpHolds`): it still lands in the same walk group, without being deadly or dealing more than `DROP_DAMAGE_LIMIT`, when taken off 0.2 m off along or across its heading, held a Tick shorter or longer, or aimed 5° off. Every Jump the AI makes on its own (a jumping Attack, a hop back) passes the same check with no fall damage allowed (`jumpIsSafe`).

## Consequences

- No Arena is named in code and nothing is placed by hand: a new or changed Arena gets its jump Links on its first navmesh build, and `src/sim/jumpLinks.test.ts` checks every documented spot still has one.
- The AI never relies on a perfect Jump: what it carries out off by a Tick or a few centimetres still lands. Some Jumps a skilled player makes (a narrow window at the edge of reach) have no Link.
- Building costs simulated arcs. The search is pruned to Walk Surfaces not already reachable, holds that could get there (`ledgeReach`) and one error check per Link, and the arena lookups the Tick shares were made cheaper without changing any outcome; the biggest Arena (the train) builds in about 160 ms, once per Arena and Tuning Data.
- Walk Surfaces that touch along an edge at the same height count as joined for this, even where a Wall at the shared edge's midpoint kept them from getting a walk Link (the train's left deck bevel by the waste drums): jump Links do not stand in for missing walk Links.
- A Fighter in the air moves only over ground (with none below at all it is held where ground last was), so gaps in test Arenas need ground, Lava or Water under them, as every real Arena has.
