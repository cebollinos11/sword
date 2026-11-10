# Dismemberment on kill hits: staged implementation plan

> Built one Stage per session with `docs/plans/dismemberment-prompt.md`. The decisions under **Context** are agreed with the user and fixed: if a Stage cannot be built as written, take the smallest deviation that keeps them and note it in the Stage's Result; if it would change them, stop and ask.

Status: all five Stages built (the Simulation records the cut; which bones it severs and the Death Ragdoll in pieces; the bare Skeleton drawn in pieces; the skinned Body models split along the cut and capped with flesh; blood spurting and dripping from the stumps, and the docs). Left to playtest.

## Progress

- [x] Stage 1: the Simulation records the cut (sections 1 and 6's ADR)
- [x] Stage 2: which parts are severed, and the Death Ragdoll in pieces (sections 2 and 3)
- [x] Stage 3: the bare Skeleton drawn in pieces, wired through `drawnPose` and its callers (section 4, bare Skeleton)
- [x] Stage 4: splitting and capping the skinned Body models (section 4, skinned Body)
- [x] Stage 5: blood from the stumps, and the docs (sections 5 and 6)

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

### Stage 2 result

Built as sections 2 and 3, pure and unit-tested. Nothing calls it from the game yet: `drawnPose` still passes no severed bones, so every Death falls and draws as before. Stage 3 wires it.

- **`severing(pose, blow, tuning) → Severed[]`** (`src/render/dismember.ts`), `Severed = { bone, at, normal }`. **Deviation:** it takes the whole `DeathBlow`, not just its `cut`, because it needs the Blade Speed (reach) and the contact point (nearest first). `tuning` is the fallen Fighter's own (`sizedTuning`). The plane goes through the recorded blade, normal `blade × travel`; the reach is the parallelogram of the blade (hilt to tip) carried along `travel`. A bone is severed when its axis crosses the plane within its Hit Zone radius of that parallelogram (spine: torso; neck: head; arms: limbs; legs: legs), and it lies at least `MIN_CROSSING` (sine 0.3, about 17°) off the plane. `at` is kept 10% to 90% along the bone.
- **The neck** (`chest>head`): the head joint is the middle of the head, so the neck's bone is tested as far up as the top of the head, and `at` is always kept within the neck itself. A cut anywhere through the head takes it off at the neck.
- **Tuning Data `fighter.dismember`** (`data/fighter.json`): `{ carry: 0.25, speed: 22, maxCuts: 3 }`. **Deviation:** the plan scales `carry` by Blade Speed over the attacker's Weapon's reference speed, but the Death does not record the attacker's Weapon (and Stage 1 decided the renderer must not look it up later). So `dismember.speed` is the Blade Speed at which the blade carries `carry`. Optional in the raw data (`DEFAULT_DISMEMBER`), so hand-written Tuning Data in tests is unchanged. It is part of the Tuning Data hash.
- **`pieceOf(severed)`**: joint → piece number; piece 0 has the pelvis, the others are numbered in `JOINT_NAMES` order. **`piecesOf(severed, stumpsFrom)`** adds each piece's ragdoll particles. Stage 3's `piecePoses` should build on these.
- **`ragdollPose(…, sheathed, severed = [])` returns `RagdollPose`** (`SkeletonPose` plus optional `stumps: Stump[]`, `Stump = { bone, ends: [Vec3, Vec3] }`; `ends[0]` rides with `bone[0]`'s piece). With nothing severed there is no `stumps` key and the fall is the old one: checked bit for bit against the Stage 1 `ragdoll.ts` over 2048 falls (every Weapon, Direction, Sheathed or not, two Sizes, with and without an Arena, with and without a blow). The existing ragdoll tests are untouched.
- **How a body in pieces is held together** (`rig` in `ragdoll.ts`): two stump particles per severed bone after the Weapon's. A constraint between two pieces is dropped, unless one end is just across a cut, where that side's stump stands in (so a cut forearm's elbow still hinges on the stub). A stump on the torso (spine, neck, shoulder, hip) is rodded to the whole torso. A torso cut in two has a frame per half (the chest's across the shoulders, each half's stump as the lost end of the spine). **Deviations:** (1) a piece with neither pelvis nor chest (a head, an arm, a leg, a foot) is one rigid body, since it has no torso to tell its hinges which way to bend; (2) the hips' half of a torso cut in two has no hip limits: with so little above the hips they fought the floor and the legs never came to rest.
- **How pieces come away:** every piece but piece 0 gets `SEVER_FLING` (1.2 m/s) along `travel` and `SEVER_SPIN` (3 rad/s) about its own middle, round the cut's normal. A cut-off sword hand still lets go of the Weapon; a Sheathed Weapon stays on the half its slot is on.
- **Known limits, left as they are:** (1) the whole blade from hand to tip cuts, so a Halberd's shaft can sever a bone it sweeps although only a Head Hit records a cut; the Death does not say where the Head begins. (2) Pieces, like the whole ragdoll, are not stopped by Walls, and they are flung a little further. (3) A plane that runs along the body (an Overhead straight down onto a shoulder or the crown, or a tip that only grazes the front) crosses no severable bone and leaves the body whole, as the plan says. With the real Motions: Left and Right sword kills at 0.9 to 1.3 m sever an upper arm and the spine; sword Overheads at that range sever the left upper arm; a Longsword or Halberd Overhead at 1.7 m severs nothing.
- **Tests:** `dismember.test.ts` (12: no cut, arm, neck, waist, shallow and deep reach, `maxCuts`, a blade along a bone, off the joints, a thicker Fighter, real sword kills, `pieceOf`), `ragdoll.test.ts` (+43: for a neck, waist, thigh, shin and forearm cut: starts in the pose, same fall every time and when scrubbed, comes apart, other bones whole, settles and comes to rest, gains no height; plus a sweep of 30+ cuts at every height, the knees, the Weapon, a Sheathed Weapon on a body cut in two, and the uncut fall), `tuning.test.ts` (+1). Fast suite 2200 passed, 5 skipped; slow suite 28 passed.
- **Nothing to see in `npm run dev` yet.**

### Stage 3 result

Built as section 4's bare Skeleton part, plus `piecePoses` from section 3. Visible at `?body=skeleton`.

- **`piecePoses(fellIn, fall, piece?)`** (`src/render/dismember.ts`): one whole `SkeletonPose` per piece, numbered as `pieceOf`. A piece's own joints are where the fall left them; a severed bone's missing end is rebuilt from its own joint out through its stump at the bone's length (taken from `fellIn`, the pose the Fighter fell in); every joint beyond it rides along rigidly, turned as that bone turned. So every bone of every piece pose keeps its length (the limp piece's own within the ragdoll's give). All pieces share the fall's Weapon. **Deviation:** it takes `fellIn` as well as the fall, for the bone lengths and the far joints' shape.
- **`Pieces = { piece, stumps, poses }`** and `piecesOfFall(fellIn, fall)` (`dismember.ts`): what a view needs to draw a body in pieces. Stage 4 will likely add what the mesh cut needs (the severed bones as cut in `fellIn`).
- **`drawnPose(…, dismember = false)` returns `DrawnPose`** (`SkeletonPose` plus optional `pieces`). Only with `dismember` does it sever (`severing` of the Fighter's own `sizedTuning`) and fall in pieces. **Deviation:** opt-in rather than always on, so the callers the plan says stay whole (`thumbs`, `soldierClips`, which bakes a Soldier's struck-down clip from a cutting Overhead) need no change and do not fall in pieces at all. The game's `renderer.ts`, `editor/sandbox.ts` and `editor/bench.ts` pass `true` and hand `pose.pieces` to `FighterView.update`. Pieces are memoised per ragdoll pose object (a `WeakMap`), so a body lying still is not taken apart every frame; a pure cache, nothing a scrub or Rollback can leave wrong.
- **`FighterView.update(pose, weapon, size, pieces?)`**: on the bare Skeleton a severed bone's cylinder runs from its first joint to its cut end, and a second one (`stubs`, made as needed) from the other cut end to its second joint; each cut end gets a flesh disc (`caps`, two per cut, a thin cylinder 8% wider than the bone, flush with the end). `fleshMaterial()` (exported for Stage 4's caps): dark red Lambert, a little emissive, like `bladeBloodMaterial` without the smear; it takes the view's dither fade.
- **Before the Death it is whole.** Found by eye: the frame drawn between the Tick before the Death and the Death's own (alpha toward the Death's Tick) showed the caps on a whole body. `ragdollPose` now gives no `stumps` for a negative time (the Death's own Tick still has them, both ends at the cut).
- **Deviation, skinned Bodies:** until Stage 4 cuts their mesh, a skinned Body with `pieces` is posed by `pieces.poses[0]` (the piece with the pelvis, the others riding along with it): it falls whole, nothing stretches between pieces. Checked on monk, duelist, female and templar. Blob shadows use that piece's pose too (`renderer.ts`).
- **Editor: a "Kill" script** in the Duel sandbox (folder "Kill": Direction and distance): yellow swings once at blue, standing still on 1 HP, so the first Hit fells it. With the Weapons and Sizes folders it makes any cutting or non-cutting kill to look at.
- **Checked in the browser** (sandbox, Playwright, screenshots before, during, after and scrubbed back): Arming Sword Left and Right (torso in two, with an arm), Overhead (an upper arm), neck (head off: a shorter blue, or a taller yellow), thighs (a taller blue, a shorter yellow, Right); Longsword Left, Right (body in two) and Overhead (whole, as Stage 2 found); Halberd Left, Right (upper body off) and Overhead (whole); Thrust and Sledge Hammer kills whole. Caps closed, pieces lying on the floor, the body whole when scrubbed back. No console errors. An Overhead onto the thighs leaves them whole (the plane runs along them, Stage 2's known limit).
- **Split time:** nothing is split yet (Stage 4); `piecePoses` is a few hundred multiplications per new ragdoll step.
- **Tests:** `dismember.test.ts` +6 (`piecePoses`: whole body, own joints where they lie, the rebuilt end along its stump at its length, every bone of every piece keeps its length, the pose it fell in on the Death's Tick, the same every time), `ragdoll.test.ts` +5 (still whole before the Death). Fast suite 2220 passed, 5 skipped. Nothing in `src/sim` or `src/net` changed.
- **Try in `npm run dev`:** `?body=skeleton`, Editor → Duel sandbox → script "Kill", vary Direction, distance, Weapon and Sizes; scrub back and forth over the Death. In a Duel or Run at `?body=skeleton`, a sword's killing Left or Right cuts.

### Stage 4 result

Built as section 4's skinned Body part. Every Body model now falls in pieces, cut along the plane, with flesh over the cut ends.

- **`src/render/meshCut.ts`** (pure, plain arrays, no three.js): `skinned` (CPU skinning), `cutMesh(mesh, plan) → PieceMesh[]`, `dropScraps`, `capOf`. `CutPlan = { pieceOfBone, cuts: BoneCut[], pieces }`, `BoneCut = { bone, beside?, at, normal, along, reach, pieces }`.
- **Which piece a vertex goes to:** its heaviest bone's. On the severed bone itself the plane decides within `reach` of the cut; beyond it, how far along the bone the vertex is (a bent limb may come back across the plane). A vertex of another bone goes across only if it has at least `ON_BONE` (0.3) of its weight on the severed bone and is within reach. **Deviations:** (1) `reach` is 3 girths (`REACH` in `bodyCut.ts`, girth = the bone's Hit Zone radius, `girth()` in `dismember.ts`), not one: an oblique cut meets the surface further out. (2) The hips are `beside` the spine: a waist cut parts their vertices by the plane too, else a low cut left a ragged edge all round.
- **Triangles:** all in one piece, or clipped by the cut that parts their corners (new vertices take interpolated position, normal, UV and weights). Where no plane parts a triangle (weights and plane disagree, off the limb), it goes whole to the piece most of it is in, the odd corner skinned as one of the others, so it cannot stretch.
- **Weights:** a vertex is weighted only to bones of its own piece (a severed bone belongs to both its pieces); weight on a bone of another piece moves onto the severed bone toward it. What is left of a severed bone holds nothing beyond its cut end (a robe hanging between the legs does not swing with a thigh's stump).
- **Deviation, posed space instead of bind space:** the pieces keep their vertices where they stood in the pose the Fighter fell in, and are bound to the bones as they stood then (`THREE.Skeleton` with those inverses). Same result as writing them back into bind space, with no per-vertex matrix inverse, and on the Death's Tick the pieces make up exactly the whole body (no pop).
- **Scraps (`dropScraps`, deviation: some surface is dropped):** a part joined to nothing else across all the Body's meshes, clipped by a cut and lying within a girth of its plane, is dropped. Found by eye: the hem of the monk's cowl hung in the air as a ring.
- **Flesh (`capOf`):** the clipped edges of all the Body's meshes, chained where their ends meet, each chain fanned from its middle and facing out of its piece. A chain open by more than a quarter of its length (a tabard's edge) gets none. Material: the view's `fleshMaterial()`.
- **`src/render/bodyCut.ts`:** `cutPlan(boneNames, pieces)` (pure) and `BodyCut` (one `SkeletonUtils.clone` of the model per piece, its meshes' geometry replaced, a `BodyRig` each, posed by `pieces.poses[p]`). `BodyRig`'s constructor takes `like`, the rig a posed copy takes its bones' turns from.
- **`Pieces`** gained `fellIn` (the pose as drawn on the Death's Tick) and `severed` (each with its `girth`); `piecesOfFall(fellIn, fall, severed, tuning)`.
- **`FighterView`:** cuts its model the first time it is asked for a cut and keeps it while the cut is the same (compared by value: bones, places, pose, Size), so scrubbing over a Death cuts once; before the Death the whole model is shown again. `Renderer` now disposes a view it drops (it never did), which frees the pieces.
- **`piecePoses` amended:** joints that ride along with a severed bone are now also rolled about it as the piece rolled (measured on the piece's own joint nearest the cut, off the bone's line). Before, a Body's stump could be wrung against its piece; the bare Skeleton never showed it.
- **Split time:** 13 to 23 ms per Death (median of 20, 3 pieces) on asturian and duelist, 9 to 16 ms on monk, in headless software-GL Chromium: about one frame, once per Death. Not spread over the lodge Ticks.
- **Checked in the browser** (sandbox "Kill", screenshots at the Death, 10 Ticks on and settled from four sides, scrubbed back): monk, duelist, female, templar and asturian; Arming Sword Left, Right and Overhead, a neck cut, a thigh cut, Longsword Left and Right, Halberd Left and Right; Thrust and Sledge Hammer whole. Caps closed, pieces on the floor, whole again before the Death, no console errors.
- **Known limits:** (1) a long robe or skirt on the hips' half after a thigh or waist cut can crumple into short spikes: that half has no hip limits (Stage 2), so its legs fold further than in life. (2) Where the weights and the plane disagree (an armpit under a high chest cut, a very steep cut on a wide sleeve) the edge is ragged and has no flesh. (3) Separate hollow shells (a sleeve, a boot top) are each closed with their own flesh disc.
- **Tests:** `meshCut.test.ts` (18: area kept, every vertex in one piece on its side, own-piece weights, clipped UV/normal/weights, caps closed, several meshes, two cuts, reach, beside, stumps, scraps, open chains, `skinned`), `bodyCut.test.ts` (2: `cutPlan`; the pieces make up the whole body on the Death's Tick, then part without stretching), `dismember.test.ts` +1 (the roll). Fast suite 2241 passed, 5 skipped. Nothing in `src/sim` or `src/net` changed.
- **Try in `npm run dev`:** Editor → Duel sandbox → script "Kill" with `?body=monk`, `duelist`, `asturian`...; vary Direction, distance, Weapon and Sizes; scrub over the Death. In a Duel, Run or Battle a sword's killing Left or Right cuts the body in two.

### Stage 5 result

Built as section 5, and section 6's `CONTEXT.md` (ADR 0024 was written in Stage 1). Nothing in `src/sim` or `src/net` changed.

- **`stumpSpurts(duel, tuning) → BloodSpurt[]`** (`src/render/blood.ts`, pure): on the Tick of a Death whose cut severs bones, one full-strength spurt from each cut end of each severed bone (`severing` of the pose it fell in, at the Fighter's Size), at the cut (`Severed.at`), out of its own piece along the cut's normal: the end on the bone's first joint's side toward its second joint, the other the opposite way. `ImpactEffects.onTick` sprays them after the wound's own spurt; the existing droplets then stain the floor and Walls as before.
- **`BloodSpurt.rise?`**: how steeply a spurt sprays up or down (the sine of its tilt). Absent on a wound's spurt, which sprays exactly as before (same velocities, same random draws). **Deviation:** a cut whose plane lies nearly level (a neck or a level torso cut: the normal's level part under `LEVEL_CUT`, 0.2) does not spray straight up and straight down; it sprays along the blow, tilted up or down by `LEVEL_RISE` (0.7), found by the review.
- **Silent spurts. Deviation:** `BloodEffects.spurt(spurt, heard = true)`; stump spurts pass `false`, so a cut that severs three bones does not play six more Splatter sounds on top of the wound's.
- **Drips:** `stumpDrops(before, after)` (pure) is how many drops each cut end sheds while the Death Ragdoll goes from `before` to `after` seconds after the Death: `STUMP_DROPS` (8) over `STUMP_BLEED_SECONDS` (2 s of Duel time), most at first, none after. It is a difference of whole drops of one curve, so however the time is cut into frames the drops add up to the same, and none fall while paused or scrubbing back. `stumpDrips(stumps, before, after)` gives where they fall from (each cut end as it lies). No `Math.random` decides when or where.
- **`DrawnPose.since`** (`fighterView.ts`): with `pieces`, the Duel seconds since the Death. `ImpactEffects.drip(poses, seconds)` now takes `DrawnPose`s and drips the stumps for the time gone by since each body was last drawn (`bled`, one number per Fighter, cleared by `seek`; a body first seen in pieces right after a jump drips from then on, otherwise from its Death). `floorUnder(pose)` (`bladeBlood.ts`) is the fallback floor for both blade and stump drips.
- **Editor sandbox:** it now calls `impacts.drip` and draws each Weapon's blood (`setBlood`), as the game does (**deviation:** before, its blades stayed clean and nothing dripped). `ImpactEffects.onTick` takes an optional `tuning`, which the sandbox passes so the stumps bleed under its live-edited Tuning Data, as they are drawn.
- **Split time:** the mesh split is Stage 4's, unchanged (13 to 23 ms once per Death on the heaviest Bodies). Stage 5 adds one `severing` per cutting Death on its Tick, and per frame only a subtraction for a body in pieces, nothing once it has stopped bleeding.
- **Checked in the browser** (sandbox "Kill", screenshots at the Death, 1 s and 4 s on, and scrubbed back to 2 Ticks before the Death): `?body=skeleton`, monk, duelist, female and templar; Arming Sword Left, Right and Overhead, a neck cut (a shorter blue, Left), an arm and a thigh (a taller blue, Right), Longsword Left and Right, Halberd Left and Right; Thrust and Sledge Hammer kills only bleed from the wound, as before. Spurts come out of the cut both ways, the floor under and around the pieces is stained, drops fall while the pieces fall, and scrubbing back washes the stains and shows the body whole. No console errors.
- **Known limits:** (1) a cutting kill now stains a much larger area than a plain kill (up to six full spurts on top of the wound's), on the generous side; `STUMP_DROPS`, `LEVEL_RISE` and the spurt strength are the knobs. (2) Several drops shed by one end in one frame (a long frame, a stepped Tick) fall from the same point together.
- **Tests:** `blood.test.ts` +4 (`stumpSpurts`: both ends of every severed bone, at the cut, full strength, away from each other and out of their own pieces, on the Death's Tick only, the same every time; none for a Thrust, a Sledge Hammer, a Fall or no Death. `stumpDrops`: stops after `STUMP_BLEED_SECONDS`, slows, the same however the time is cut into frames, none when time stands still or runs back). Fast suite 2245 passed, 5 skipped. `test:slow` not run: nothing in `src/sim` or `src/net` changed.
- **Try in `npm run dev`:** Editor → Duel sandbox → script "Kill" (Left or Right, distance 1.1) on any `?body=`, play at slow motion to watch the spurts and drips; scrub back over the Death. In a Duel, Run or Battle, a sword's killing Left or Right.

## Verification

- `npm run typecheck`, `npm test` (fast project), and `npm run test:slow` for the Rollback and Battle harnesses, which hash the state with the new `cut`.
- In the app (`npm run dev`, driven with the pre-installed Playwright): in the Editor's sandbox, kill with each swing Direction on the head, an arm, the torso and a leg, for the Arming Sword, Longsword and Halberd on several Bodies including `?body=skeleton`; confirm the Sledge Hammer and a Thrust leave the body whole. Screenshot each and check caps, no stretched triangles, pieces lying on the floor.
- Scrub the Final Blow Shot back and forth over a cutting kill: the same cut every time, and the body is whole again before the Death's Tick.
- A Battle with a Player killing promoted Soldiers: frame time unchanged while no one is being cut (the split runs once per Death).

## Risks to watch while building

- Small tears where an oblique plane passes close to a joint: handled by keeping the crossing off the joints and by the plane ruling near the cut; to be judged by eye on the generated multi-shell Bodies (clothes, hair) as well as the hand-made single-mesh ones.
- The one-off split cost on the heaviest Body: measure it; if it is felt as a hitch, spread it over the Weapon's lodge Ticks (the blade sits in the victim for 18 Ticks before the swing carries on).
