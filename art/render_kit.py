"""
Renders Generated Arenas drawn from a Kit (art/build_kit_<name>.py), with the collision
over them, to check the Kit's art matches the geometry the simulation uses (as
art/render_library.py does for the library). Workbench engine, material colours.

First dump some Arenas from the game (their Kit placements, exactly as the renderer
draws them, and their assembled geometry):
    KIT_DUMP=<folder>/kit_layouts.json npx vitest run src/render/kitPlacement.dump.test.ts
Then, inside Blender, after build_kit_<name>.py:
    exec(open(r"C:/Repos/sword/art/render_kit.py").read(), {"DUMP": r"<folder>/kit_layouts.json", "OUT": r"<folder>/"})

Shots per Arena (seed s):
  - kit_<s>_art: from a high corner, the Kit's art alone;
  - kit_<s>_overlay: the same view with the collider view over it: Walk Surfaces
    see-through, tinted by level (ramps yellow), Walls red;
  - kit_<s>_top: orthographic from above, with the collider view.
`result["files"]` lists the PNGs.
"""
import json

import bpy
from mathutils import Matrix, Vector

scene = bpy.context.scene
DUMP = globals()['DUMP']
OUT = globals()['OUT']
KIT_COLLECTION = globals().get('KIT_COLLECTION', 'Kit_greybox')
# Game (x, y up, z) to Blender (x, -z, y).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def collection(name):
    c = bpy.data.collections.get(name)
    if c:
        for obj in list(c.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
    else:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
    return c


def overlay_material(name, rgba):
    m = bpy.data.materials.get(f'KitOverlay_{name}') or bpy.data.materials.new(f'KitOverlay_{name}')
    m.diffuse_color = rgba
    return m


OVERLAY = {
    'L0': overlay_material('L0', (0.05, 0.9, 0.15, 0.6)),
    'L1': overlay_material('L1', (0.05, 0.4, 1.0, 0.6)),
    'L2': overlay_material('L2', (1.0, 0.2, 0.8, 0.6)),
    'Ramp': overlay_material('Ramp', (1.0, 0.85, 0.05, 0.65)),
    'Wall': overlay_material('Wall', (1.0, 0.05, 0.05, 0.75)),
    'Abyss': overlay_material('Abyss', (0.02, 0.02, 0.03, 1.0)),
}


def face_object(name, pts, mat, coll, lift=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(to_blender((p[0], p[1] + lift, p[2]))) for p in pts], [], [list(range(len(pts)))])
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def place_kit(arena, coll):
    """Every placement's node, its meshes shared with the Kit's: Blender's world matrix is C · P · C⁻¹ times the mesh's place in its root."""
    for k, p in enumerate(arena['placements']):
        root = bpy.data.objects[p['node']]
        m = p['matrix']
        P = Matrix([[m[c * 4 + r] for c in range(4)] for r in range(4)])
        world = C @ P @ C.inverted()
        for child in root.children:
            if child.type != 'MESH':
                continue
            o = bpy.data.objects.new(f'{p["node"]}#{k}', child.data)
            o.matrix_world = world @ (root.matrix_world.inverted() @ child.matrix_world)
            coll.objects.link(o)


def place_colliders(arena, coll):
    for s in arena['arena']['walk']:
        pts = [(q['x'], q['y'], q['z']) for q in s['points']]
        ys = [q[1] for q in pts]
        if s.get('abyss'):
            face_object(s['id'], pts, OVERLAY['Abyss'], coll)
            continue
        key = 'Ramp' if max(ys) - min(ys) > 0.01 else ('L0' if max(ys) < 2 else 'L1' if max(ys) < 5 else 'L2')
        face_object(s['id'], pts, OVERLAY[key], coll, lift=0.03)
    for w in arena['arena']['walls']:
        a, b = w['a'], w['b']
        q = [(a['x'], w['bottom'], a['z']), (b['x'], w['bottom'], b['z']), (b['x'], w['top'], b['z']), (a['x'], w['top'], a['z'])]
        face_object(w['id'], q, OVERLAY['Wall'], coll)


cam = bpy.data.objects.new('KitPreviewCam', bpy.data.cameras.new('KitPreviewCam'))
scene.collection.objects.link(cam)
previous_camera = scene.camera
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.render.resolution_x = globals().get('WIDTH', 1000)
scene.render.resolution_y = globals().get('HEIGHT', 800)
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
# Plain colours: the default view transform washes the overlay's tints out.
previous_view = scene.view_settings.view_transform
scene.view_settings.view_transform = 'Standard'
world = scene.world or bpy.data.worlds.new('World')
scene.world = world
world.color = (0.024, 0.026, 0.032)


def look_at(eye, target):
    cam.location = to_blender(eye)
    cam.rotation_euler = (to_blender(target) - to_blender(eye)).to_track_quat('-Z', 'Y').to_euler()


def shot(name, eye, target, ortho=None, lens=28):
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        cam.data.ortho_scale = ortho
    cam.data.lens = lens
    cam.data.clip_start = 0.1
    cam.data.clip_end = 300
    look_at(eye, target)
    scene.render.filepath = OUT + name + '.png'
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath


data = json.load(open(DUMP))
# Show only what this script places.
hidden = {}
for c in scene.collection.children:
    hidden[c.name] = c.hide_render
    c.hide_render = True
kit = collection('KitLayout')
colliders = collection('KitColliders')
kit.hide_render = False
files = []
for arena in data['arenas']:
    collection('KitLayout')
    collection('KitColliders')
    place_kit(arena, kit)
    place_colliders(arena, colliders)
    span = max(arena['cols'], arena['rows']) * data['cell']
    seed = arena['seed']
    eye = (-0.75 * span, 0.95 * span, -1.0 * span)
    colliders.hide_render = True
    files.append(shot(f'kit_{seed}_art', eye, (0, 1.5, 0)))
    colliders.hide_render = False
    files.append(shot(f'kit_{seed}_overlay', eye, (0, 1.5, 0)))
    files.append(shot(f'kit_{seed}_top', (0, 60, 0.001), (0, 0, 0), ortho=span * 1.1 * scene.render.resolution_x / scene.render.resolution_y))
collection('KitLayout')
collection('KitColliders')
for name, h in hidden.items():
    bpy.data.collections[name].hide_render = h
scene.camera = previous_camera
scene.view_settings.view_transform = previous_view
bpy.data.objects.remove(cam, do_unlink=True)
result = {'files': files}
