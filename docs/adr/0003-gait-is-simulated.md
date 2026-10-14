# 0003 — The Gait is simulated, not drawn

## Status

Accepted

## Context

Fighters' legs did not step when the body moved over the floor. The obvious fix is a cosmetic walk cycle layered on in the renderer. But the Skeleton is solved inside the Tick (ADR 0001), and Attacks hit whatever the Blade Sweep intersects on that Skeleton, legs included (ADR 0002). A renderer-only Gait would draw legs where the limb Hit Zones are not, so a sword could pass visibly through a leg and miss, or visibly miss and still hit.

## Decision

The Gait runs in the simulation. Each foot's planted world position and step progress are part of the Fighter's state, so they are snapshotted, hashed and restored by Rollback like everything else. The Gait is derived only from that state and Tuning Data, so nothing new crosses between peers. Intents remain the only thing exchanged.

Procedural stepping replaces authored walk cycles. A foot steps, one at a time, when it falls too far from where it belongs under the body. This covers walking at any angle, turning in place and being pushed, including while Staggered.

## Consequences

- Feet never slide, and the leg Hit Zones are always where the legs are drawn.
- The Gait may move the legs and bob the hips, but hand targets stay relative to the ground. Walking never changes a Blade Sweep or an Attack's reach.
- Simulation state grows by a few numbers per Fighter, and any change to Gait rules or Gait Tuning Data is a desync risk between mismatched builds. It is covered by the same Tuning Data hash and state checksums as Motions.
- A foot landing is a simulation event (`Step`), so audio and effects can react to it without reading the pose.
