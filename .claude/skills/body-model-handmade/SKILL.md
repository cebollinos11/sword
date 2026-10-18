---
name: body-model-handmade
description: Hand-build a textured Body model (a skinned character a Fighter is drawn as) directly in Blender over the Blender MCP, sculpting one continuous mesh and painting a texture, then rig it and wire it into the game. Use when asked to make or remake a character model "by hand", "in Blender", "without a script", "like the Meshy one", or to make one look less blocky.
---

A **Body** (see `CONTEXT.md`) is render-only: a skinned mesh whose bones are placed on the solved Skeleton's joints every frame. This skill builds one interactively in Blender rather than with a generator script (that older route is the `body-model` skill). The source of truth is `art/<body>.blend`. `reference/duelist_steps.py` (the shapes, numbers and weight formulas) and `reference/duelist_paint.py` (the texture painter) are the worked example from the Duelist; `reference/before_after.png` shows what the method buys.

**Why it looks better than the generated Bodies:** the generated ones are separate tubes and spheres glued together with one flat colour per face, so they show seams and stair-step colour borders. This method makes **one continuous surface** (overlapping volumes → voxel remesh → smooth → decimate to a triangle mesh, the same kind of topology as an AI-generated model like Meshy's), and puts the detail into a **texture painted from 3D position**, so clothing edges, faces and hair strands no longer follow polygons.

## Contract (the same as every Body)

- Bones and rest pose: copy the armature from an existing Body's `.blend` (for example `FemaleRig` from `art/female.blend`, or `DuelistRig`), or build it from `art/body_common.py` `bone_table()`. Joints: pelvis 1.02, chest 1.52, head joint 1.73, shoulders x ±0.2, elbows ±0.5, wrists ±0.78, hand tips ±0.88, hips x ±0.1, knees 0.54, ankles 0.06, toes 0.14 ahead of the ankle.
- Faces **-Y**, left on **+X**, T-pose, metres. The export (`export_yup`) turns that into the game's facing 0.
- Exactly one material name ends `_Skirt`: the game tints it with the Team colour (multiplying its texture). Every other material keeps its texture (`map`) in `loadBodyModel`.
- Budget about 5,000 triangles (the Duelist is 4,911).

## Steps

Every step is an `execute_blender_code` call followed by renders you Read (front, 3/4, side, back, head close-up) with `art/render_views.py`. Work in a collection named after the Body, and hide the other Bodies and the default cube from render.

1. **Block out the volumes** (`duelist_steps.py` STEP 1). Use lofted Catmull-Rom profiles for the torso and limbs, ellipsoids only for anatomy (bust, glutes, trapezius, cranium, jaw, chin, nose, ears), and a flat mitten-plus-thumb hand. Add a voxel remesh (0.005) and a corrective smooth (20 iterations) as modifiers so you can iterate on the numbers cheaply. Done when all five views read as a person in proportion: hips the widest point, a short neck, chin about 1.60, crown about 1.80.
2. **Apply and decimate** (STEP 2): apply both modifiers, then a symmetric (X) decimate to about 3,200 triangles. Remove twin faces, run `validate()`, and smooth just the face and shoulder vertices if decimation left creases. Render with a Wireframe modifier to check the triangles are even.
3. **Clothes and hair as their own pieces** where they stand off the body (STEPS 3–4): a pleated skirt, a hair cap with a fringe, side locks and a ponytail. Everything that lies on the body (tops, boots, bracers, belts, faces) is texture, not geometry.
4. **UV unwrap and paint.** Join the body and hair (two material slots while painting: 0 body, 1 hair). Run Smart UV Project (angle limit 1.15, margin 0.003), then **Pack Islands** (concave, rotate). Smart Project alone covered only 18% of the image; packed, it covered 40%. Copy `duelist_paint.py`, change its colour rules, and run it. It paints at 2048 and box-filters down to 1024, dilates into empty texels, and bakes a soft downward darkening. Give the skirt its own simple cylindrical UVs and a **greyscale** texture (pleat shading, hem band, waistband), so the Team tint shows through.
5. **Rig.** Copy the rig, join the skirt in, merge the material slots into `<Name>_Body` + `<Name>_Skirt`, tag each vertex's island as body, hair or skirt (`ob["part_tags"]`), parent with `ARMATURE_NAME` (empty groups), and set every weight explicitly with the formulas in STEP 5. Pose-test: thigh lifted 50° with the knee at 80°, spine twisted 25°, an elbow at 80°. Render, then clear the pose.
6. **Export** with `bpy.ops.export_scene.gltf(... export_format='GLB', use_selection=True, export_skins=True, export_animations=False, export_apply=False, export_yup=True, export_image_format='AUTO')` on the mesh and rig, to `public/models/<body>.glb`. Save the collection with `bpy.data.libraries.write('art/<body>.blend', {collection}, fake_user=True, compress=True)`. Then check the GLB with node: the skin lists exactly the 15 `BODY_BONES` names (no `neutral_bone`), both materials have a `baseColorTexture`, and the embedded image is the latest paint (write it out and Read it).
7. **Register** in `BODY_MODELS` and `BODY_LABELS` in `src/render/bodyModel.ts`, and in the Body entry in `CONTEXT.md`. Run `npx tsc --noEmit` and `npx vitest run src/render`.
8. **See it in a Match:** `preview_start` `dev`, open `/sword/?body=<body>` (every Fighter then wears it), and click Start Match. Done when both Fighters show it in Team colours, the texture is right way round (we see the back of the player's own Fighter), swords are in hand, and there are no console errors.

## Gotchas learned the hard way

- **Skin modifier blockouts** came out thin with holes at the shoulder junction. **Chains of ellipsoids** along a limb come out lumpy like a caterpillar. Use lofts.
- **Loft ends are flat caps.** Taper the first ring inside the neighbouring volume (the leg tops start at z 1.04 with radius 0.03).
- **The neck reads too long** if the head is centred on the head joint (1.73). Centre the cranium near 1.70.
- **A symmetric decimate leaves twin faces** on the centre line that render as black triangles, even in plain Workbench renders. Find faces sharing a vertex set and delete the one facing inward.
- **Hair zig-zags:** deleting alternate vertices removes the faces between them. Move boundary vertices instead.
- **Workbench shows textures only** with `display.shading.color_type = 'TEXTURE'`, and `render_views.py` forces `'MATERIAL'`. Exec it with `.replace("color_type = 'MATERIAL'", "color_type = 'TEXTURE'")`. It shows the material's **active** image node.
- **A packed image goes stale:** the export embeds the packed copy, not the pixels you just painted. After any repaint, `im.save()` then `im.pack()` (the painter does this). The symptom in game is a scrambled texture: front details showing on the back.
  If an image was already packed, `im.save(); im.pack()` can still leave the old bytes packed (it happened on the Snake). Use `im.unpack(method='REMOVE')`, set `filepath` to the fresh PNG, `im.reload()`, `im.pack()`, then `cmp` the PNG written out of the GLB against it.
- **`me.materials.pop(index=i)` already shifts the face material indices.** Shifting them yourself as well puts every face on slot 0, and the Team-tinted pieces then sample the body texture. Set each face's index from `part_tags` after merging the slots.
- **UV layer names must match before joining.** A bmesh `uv.verify()` layer can be called `Float2`; on join the skirt's UVs landed in a second layer and its `UVMap` was all zeros. Copy them across and remove the extra layer.
- **Bone-heat auto weights** left 352 body vertices unweighted and can't cope with separate hair or skirt islands. The exporter then adds a `neutral_bone` to the skin. Use the explicit smooth blends instead.
- **The skirt over a lifted thigh** needs about 0.9 thigh weight from 1.10 down to the hem, starting 0.04 past the centre line, or the leg pokes out under it.
- **Tag codes:** `part_tags` stores single characters; comparing them with `'hair'` silently matches nothing.
- Hair and skirt are open shells: keep `use_backface_culling = False` so they export double-sided.
- `execute_blender_code` must set `result` to a dict. Large intermediate arrays are fine inside one call; keep renders in the scratchpad.
