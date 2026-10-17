# 0006 — Arena geometry is simulated, from one exported file

## Status

Accepted

## Context

The Arena was a flat circle: one radius in Tuning Data, a clamp in body collision, a disc in the renderer. The library Arena has three levels, ramps, open ledges and walls, and falling is gameplay: fall damage, a Fall Action and a hard-Landing Stagger, a Jump. The AI must find its way between levels.

- **Render-only geometry** (the model decides where the feet go, the Tick stays flat): cheap, but height would differ between peers' frames and the Tick could not decide a fall, its damage or a Death by Fall, so Rollback and the checksum (ADR 0001) could not see them; the Hit Zones (solved in the Tick, ADR 0003) would sit on the wrong floor.
- **Physics from the render mesh** (collide against its triangles): ~50 000 triangles of bookcases and books in every Tick, on both peers; the mesh is art, changed for looks, and every change would silently change the game.
- **A small hand-written geometry beside the art**: what is walkable could drift from what is drawn.

## Decision

The Arena's geometry is Tuning Data, simulated in the Tick: planar convex Walk Surfaces (floors and ramps), vertical Walls with a bottom and top height, and spawns, in `data/arenas/<name>.json`, hashed with the rest of Tuning Data. Fighters have a height (`y`) and, off the ground, a velocity and the top of their arc in `SimState`; the Tick snaps them to the Walk Surface under them within a step, stops them at Walls and higher ground, drops them off ledges under gravity, and lands them.

One Blender generator (`art/build_library.py`) is the source of truth for both: it builds the look and, from the same layout numbers, `WALK_*`, `WALL_*` and `SPAWN_*` helper objects in a `Collision` collection, then exports the model (`.glb`) and the sim geometry (`.json`, read back from the helpers). An overlay render of the Walk Surfaces on the model checks they agree.

The navmesh is the Walk Surfaces themselves (`src/sim/nav.ts`): no extra data, built and cached per Arena, pure, with every tie broken by index, so the AI (on both peers, ADR 0005) paths identically; its route is part of its saved memory.

## Consequences

- Height, falls, Landings and Deaths by Fall are deterministic and rolled back like everything else; the Skeleton is solved at the Fighter's height, so Hit Zones, the Blade Sweep and Blocks follow it for free.
- The Tick does a few grid lookups per Fighter (a 1 m grid over the Walk Surfaces) and a Wall pass; the render mesh never enters it.
- Changing the Arena's shape is a Tuning Data change: it changes the Tuning Data hash, so peers with different Arenas refuse each other, as with any other tuning.
- What the sim sees is simpler than what is drawn: small props (chairs, ladders) are not Walls, and balustrades block bodies fully though they look open. The camera uses the same geometry (tall Walls and Walk Surfaces) to keep out of the walls, and the Death Ragdoll lands on the Walk Surfaces, both outside the Tick.
- A new Arena needs its generator to emit the helpers; the flat `circle` (the Editor's) is written by hand.
