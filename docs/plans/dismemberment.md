# Dismemberment on kill hits: staged implementation plan

> Built one Stage per session with `docs/plans/dismemberment-prompt.md`. The decisions under **Context** are agreed with the user and fixed: if a Stage cannot be built as written, take the smallest deviation that keeps them and note it in the Stage's Result; if it would change them, stop and ask.

Status: Stage 1 built (the Simulation records the cut); Stage 2 next. Nothing is drawn differently yet.

## Progress

- [x] Stage 1: the Simulation records the cut (sections 1 and 6's ADR)
- [ ] Stage 2: which parts are severed, and the Death Ragdoll in pieces (sections 2 and 3)
- [ ] Stage 3: the bare Skeleton drawn in pieces, wired through `drawnPose` and its callers (section 4, bare Skeleton)
- [ ] Stage 4: splitting and capping the skinned Body models (section 4, skinned Body)
- [ ] Stage 5: blood from the stumps, and the docs (sections 5 and 6)

## Context

A Fighter that falls today goes limp as one whole body (the Death Ragdoll, `src/render/ragdoll.ts`). The ask: when a kill hit lands, work out the path the blade cut through the victim and split the body model along that plane, dynamically, so every kill cuts where it really struck.

Decisions taken with the user:

- **Trigger**: every killing Overhead, Left or Right swing that lands with a bladed Weapon's Head. No cut for a Thrust, the Sledge Hammer, a shaft hit, a Throwing Dagger, a Kick, a Fall, Lava or Water.
- **Extent**: the plane comes from the blade's real sweep, but only the body parts the blade actually passes through are severed (forearm hit: the arm comes off; neck: the head; deep torso hit: the body in two).
- **Scope**: every full Fighter (skinned Body models and the bare primitive Skeleton; Duels, Runs, a Battle's Players and promoted Soldiers). Crowd Soldiers keep their impostor death clip.
- **Look**: both cut faces closed with a red flesh cap, blood spurting from the stumps and staining the floor. Always on.

Shape of the solution, following how the Death Ragdoll already works (ADR 0001): the Simulation only **records** the cut in the Death; the severing, the mesh split and the falling pieces are **render-only** and a pure function of the Death and the pose it fell in, so Rollback, scrubbing and the Final Blow Shot all draw the same cut.

## 1. Simulation: record the cut in the Death

- `src/tuning/weapon.ts`, `data/weapons/sledge-hammer.json`: new Weapon field `cuts` (boolean, default true; false for the Sledge Hammer).
- `src/sim/events.ts`, `src/sim/combat.ts` (`resolveContact`): `HitEvent` gains the blade at the moment of contact: `blade: { hilt, tip }` (last Tick's blade to this Tick's, interpolated at the contact's `s`) and `travel` (unit direction the contact point was moving). `sweepContact` already yields `s` and `along`; carry them through `BladeContact`.
- `src/sim/state.ts`: `DeathBlow` gains optional `cut: { hilt: Vec3; tip: Vec3; travel: Vec3 }`.
- `src/sim/step.ts` (`fellingBlow`): set `cut` only when the felling Hit is a blade Hit with `head` true, Direction not Thrust, and the attacker's Weapon `cuts`. Decided here, not in the renderer, because the attacker's Weapon may change later (a Run's Inventory).
- `src/net/messages.ts` (`isDeath`): accept and validate the optional `cut`. `hashState` is generic, so checksums follow by themselves; both peers compute the same cut.

## 2. Which parts are severed (pure, new `src/render/dismember.ts`)

`severing(pose, cut, sizedTuning) → Severed[]`, each `{ bone: [JointName, JointName], at: Vec3, normal: Vec3 }`:

- Plane: through the contact point, normal = `blade axis × travel`.
- Reach: the blade segment carried `dismember.carry` metres along `travel` (new Tuning Data, `data/fighter.json` `dismember`: `carry`, scaled by Blade Speed over the Weapon's reference speed; plus `maxCuts`).
- A bone of `BONES` (`src/sim/skeleton.ts`) is severed when its axis crosses the plane inside that reach grown by the bone's thickness (Hit Zone radii, at the Fighter's Size). Severable: spine, neck, upper arms, forearms, thighs, shins. A blade running nearly along a bone does not sever it. Nearest to the contact first, at most `maxCuts`.
- The crossing point is kept a little off each joint (10% to 90% of the bone), so a cut never lands exactly on an elbow or knee.
- No bone crossed: no cut, the whole Death Ragdoll as today.

## 3. Death Ragdoll in pieces (`src/render/ragdoll.ts`)

- `ragdollPose` takes the `Severed[]` and returns the pose plus the stumps. Each severed bone gets two extra Verlet particles (one stump end per side) rodded rigidly to its own side.
- `constraints()` drops every rod, fold, hinge and hip limit that spans two pieces; `torso()` frames are taken per piece (the stump particles give a cut-off pelvis or chest its "up").
- Start velocities: each piece keeps the blow's push; the far piece gets extra along `travel` and a little spin, so it comes away from the body.
- The fall cache key already includes the Death (so the cut); still pure and deterministic. A hand that is cut off still lets go of the Weapon as today.
- `piecePoses(fall) → SkeletonPose[]` (in `dismember.ts`): one full pose per piece; a severed bone's missing end is rebuilt from its stump (own joint + stump direction × bone length), joints of other pieces ride along rigidly so `boneFrames` stays well-defined.

## 4. Splitting the model (new `src/render/meshCut.ts`, used by `FighterView`)

Done once, when a view first draws a Death with severed bones; undone when the Death goes away (Rollback, a new Duel, scrubbing back).

Skinned Body (`bodyModel.ts`, `bodyRig.ts`):

1. Pose the rig in the death pose and skin every vertex on the CPU (`SkinnedMesh.getVertexPosition`).
2. Give each vertex a piece: by the bones it is weighted to (the Skeleton decides the pieces), except near a cut (within the limb's girth of the crossing point), where the plane side decides (the plane decides the boundary).
3. Triangles wholly in one piece go to it; triangles the plane separates are clipped, new vertices taking interpolated position, normal, UV and skin weights (written back in bind space).
4. Cap: chain the clipped edges into loops on the plane and fan each from its centroid, once per side, in a flesh material (dark red Lambert, slightly emissive, like `bladeBloodMaterial`).
5. Each piece becomes its own `SkinnedMesh` on its own clone of the rig (`SkeletonUtils.clone`, a `BodyRig` each), with weights to bones across the cut moved onto the severed bone, so nothing stretches between pieces. Each piece is posed by its `piecePoses` entry.

Bare Skeleton (`fighterView.ts`): the severed bone's cylinder is drawn as two (joint to stump on each side) with a red disc on each stump; everything else already follows the particles.

`FighterView.update` gains an optional `pieces` argument; `drawnPose` (`fighterView.ts`) returns it alongside the pose when `f.death.blow.cut` severs something. Callers: `renderer.ts` (the game), `editor/sandbox.ts`, `editor/bench.ts`; `thumbs` and `soldierClips` (impostor baking) pass nothing and stay whole. Blob shadows (`blobShadow.ts`) keep using the main piece's pose.

## 5. Blood from the stumps (`src/render/impacts.ts`, `blood.ts`)

- On the Death's Tick: one full-strength `BloodEffects.spurt` from each stump, along the cut normal (the existing droplets then stain floor and Walls and splatter aloud).
- For about two seconds after: `BloodEffects.drip` from each stump end as the pieces fall, fed the stump positions the way `impacts.drip` is fed blade poses now.

## 6. Docs

- `CONTEXT.md`: new term **Dismemberment** (the cut recorded in the Death; severed parts; render-only), and amend **Death**, **Death Ragdoll** and **Weapon** (`cuts`).
- `docs/adr/0024-the-cut-is-recorded-in-the-death-and-drawn-outside-the-simulation.md`: why the Simulation stores the blade at contact but never the pieces.

## Stages

Each Stage ends green (`npm run typecheck`, `npm test`) and leaves the game playable.

1. **The record.** Section 1, with tests in `src/sim/death.test.ts` (a cutting kill has `cut`; a Thrust, a Sledge Hammer, a shaft hit, a dagger and a Fall do not; the blade and `travel` match the sweep) and `src/net/messages.test.ts`. Run `npm run test:slow` too: the Rollback and Battle harnesses hash the state. Write ADR 0024. Nothing is drawn differently yet.
2. **The pieces.** Sections 2 and 3, with tests for `severing` (arm, neck, waist, shallow reach severs less, a blade along a bone severs nothing) and in `ragdoll.test.ts` (pieces separate, each settles on the floor, no energy gain, same inputs same fall, an uncut Death falls exactly as before).
3. **The bare Skeleton.** `piecePoses`, `drawnPose` returning the pieces, `FighterView.update` drawing them for the primitives, and every caller passing them on. First visible result: check it at `?body=skeleton`.
4. **The skinned Bodies.** `src/render/meshCut.ts` with `meshCut.test.ts` on a small synthetic skinned tube (triangle area conserved, caps closed, every vertex in exactly one piece, weights only to bones of its own piece), then `FighterView` using it. Check every Body by eye.
5. **Blood and docs.** Section 5, then `CONTEXT.md`.

## Results

(Each Stage adds a `### Stage N result` here: what was built, names chosen, deviations and why, test counts, measured timings, what to try in `npm run dev`.)

### Stage 1 result

Built as section 1. What the later Stages build on:

- **Weapon `cuts`** (`src/tuning/weapon.ts`): boolean, default true. Only `data/weapons/sledge-hammer.json` has `"cuts": false`. `serializeWeapon` writes it only when false (like a missing `heavyBlow`), so the other files are unchanged. The Editor's Weapon panel has a `cuts (Dismemberment)` toggle.
- **`BladeContact.blade` / `travel`** (`src/sim/combat.ts`, `findContacts`): `blade = { hilt, tip }` is last Tick's blade lerped to this Tick's at the contact's `s`. `travel` is the unit direction the contact point (at `along`) moved this Tick. When that point did not move at all, `travel` falls back to the blade's `edge`, never to +y. They are computed in `findContacts` because only it holds last Tick's blade; `resolveContact` passes them on to the `HitEvent`.
- **`HitEvent.blade?` / `travel?`** (`src/sim/events.ts`): the Simulation sets them on every Hit. **Deviation:** they are optional in the type, so the hand-written Hit literals in existing tests (`audio/cues`, `render/bladeBlood`, `render/cameraShake`) still compile unchanged.
- **`DeathBlow.cut?: Cut`** with `Cut = { hilt, tip, travel }` (`src/sim/state.ts`, type `Cut` exported from it). `fellingBlow` (`src/sim/step.ts`) sets it only for a blade Hit with `head`, a Direction other than Thrust, and an attacker Weapon that `cuts`. A blow without a cut has no `cut` key at all (not `cut: undefined`), so its hash is exactly as before. Daggers, Kicks, Falls, Lava and Water never have one.
- **`isDeath`** (`src/net/messages.ts`): accepts an optional `cut`. It needs three Vec3s, hilt and tip apart, and `travel` of unit length; it refuses a cut on a Thrust. `PROTOCOL_VERSION` stays 26: peers on different builds are already refused by the Tuning Data hash, which now includes `cuts`.
- **ADR 0024** written.
- **Deviation, the AI golden fixture re-recorded** (`src/controllers/aiGolden.testdata.json`): its per-Tick hash covers the Tick's events, so every Hit Tick changed. Before re-recording, all 9 Matches were replayed with `blade`, `travel` and `cut` stripped from the state. They hashed exactly as the old recording at every Tick (356 Hits and cutting Deaths on hundreds of Ticks across them), so no outcome changed. The test code itself is untouched.
- **Deviation, one existing assertion amended:** `death.test.ts`'s "records the blow that felled a Fighter" now expects the `cut` in its `toEqual`, because its Overhead Arming Sword kill now cuts, as the plan decides.
- **Tests:** `death.test.ts` gained 11: Overhead, Left and Right Arming Sword, Longsword and Halberd Head kills cut, with the blade on the Blade Sweep at one `s`, the point on it, and `travel` along the point's path. These do not cut: Thrust, Sledge Hammer (Head), Halberd shaft, Throwing Dagger, Fall, a Weapon with `cuts: false`. Also `messages.test.ts` (a real cut through a resync, malformed ones and a Thrust refused) and `weapons.test.ts` (`cuts` defaults, file round trip, bad value). Fast suite 2144 passed, 5 skipped; slow suite 28 passed.
- **Nothing is drawn differently yet**, so there is nothing to try in `npm run dev` beyond the Editor toggle.

## Verification

- `npm run typecheck`, `npm test` (fast project), and `npm run test:slow` for the Rollback and Battle harnesses, which hash the state with the new `cut`.
- In the app (`npm run dev`, driven with the pre-installed Playwright): in the Editor's sandbox, kill with each swing Direction on the head, an arm, the torso and a leg, for the Arming Sword, Longsword and Halberd on several Bodies including `?body=skeleton`; confirm the Sledge Hammer and a Thrust leave the body whole. Screenshot each and check caps, no stretched triangles, pieces lying on the floor.
- Scrub the Final Blow Shot back and forth over a cutting kill: the same cut every time, and the body is whole again before the Death's Tick.
- A Battle with a Player killing promoted Soldiers: frame time unchanged while no one is being cut (the split runs once per Death).

## Risks to watch while building

- Small tears where an oblique plane passes close to a joint: handled by keeping the crossing off the joints and by the plane ruling near the cut; to be judged by eye on the generated multi-shell Bodies (clothes, hair) as well as the hand-made single-mesh ones.
- The one-off split cost on the heaviest Body: measure it; if it is felt as a hitch, spread it over the Weapon's lodge Ticks (the blade sits in the victim for 18 Ticks before the swing carries on).
