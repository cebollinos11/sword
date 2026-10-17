"""
Renders preview shots of the library Arena (art/build_library.py), to judge it
by eye: Workbench engine, material colours, the ceiling hidden.

Run inside Blender after build_library.py, passing an output folder:
    exec(open(r"C:/Repos/sword/art/render_library.py").read(), {"OUT": r"<folder>/"})

Shots (all in game coordinates, y up):
  - top: orthographic from above;
  - level0 / level1 / level2: from above, cut just over each level (clip);
  - walk: from above with the Walk Surfaces drawn over the room, coloured by level;
  - threequarter, threequarter_b: perspective views from two high corners;
  - floor_view: a Fighter's-eye view across the ground floor.
`result["files"]` lists the PNGs.
"""
import math

import bpy
from mathutils import Vector

scene = bpy.context.scene
OUT = globals()['OUT']
SHOTS = globals().get('SHOTS')


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
scene.collection.objects.link(cam)
previous_camera = scene.camera
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_backface_culling = True
scene.display.shading.show_shadows = False
scene.render.resolution_x = globals().get('WIDTH', 900)
scene.render.resolution_y = globals().get('HEIGHT', 900)
scene.render.resolution_percentage = 100
ceiling = bpy.data.objects.get('Library.Ceiling')
helpers = bpy.data.collections.get('Collision')

# Walk Surface overlay material per level.
overlay = {}
for name, colour in (('L0', (0.1, 0.8, 0.2, 1)), ('L1', (0.1, 0.4, 1.0, 1)), ('L2', (1.0, 0.3, 0.8, 1)), ('Ramp', (1.0, 0.85, 0.1, 1)), ('Wall', (1, 0.1, 0.1, 1))):
    m = bpy.data.materials.get(f'Overlay_{name}') or bpy.data.materials.new(f'Overlay_{name}')
    m.diffuse_color = colour
    overlay[name] = m


def look_at(eye, target):
    cam.location = to_blender(eye)
    d = to_blender(target) - to_blender(eye)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def shot(name, eye, target, ortho=None, clip=None, lens=24, walk=False):
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        cam.data.ortho_scale = ortho
    cam.data.lens = lens
    cam.data.clip_start = clip or 0.1
    cam.data.clip_end = 200
    look_at(eye, target)
    scene.display.shading.show_backface_culling = not walk  # the helper faces are wound either way
    if walk:
        for o in helpers.objects:
            o.hide_render = not (o.name.startswith('WALK_') or o.name.startswith('WALL_'))
            if o.type == 'MESH':
                o.data.materials.clear()
                if o.name.startswith('WALL_'):
                    o.data.materials.append(overlay['Wall'])
                else:
                    ys = [v.co.z for v in o.data.vertices]
                    key = 'Ramp' if max(ys) - min(ys) > 0.01 else ('L0' if max(ys) < 1 else 'L1' if max(ys) < 4 else 'L2')
                    o.data.materials.append(overlay[key])
                    o.location.z = 0.05
        helpers.hide_render = False
    else:
        helpers.hide_render = True
    scene.render.filepath = OUT + name + '.png'
    bpy.ops.render.render(write_still=True)
    if walk:
        for o in helpers.objects:
            o.location.z = 0
    return scene.render.filepath


if ceiling:
    ceiling.hide_render = True
files = []
default = [
    ('top', dict(eye=(0, 40, 0.001), target=(0, 0, 0), ortho=26)),
    ('level0', dict(eye=(0, 2.5, 0.001), target=(0, 0, 0), ortho=26, clip=0.05)),
    ('level1', dict(eye=(0, 5.5, 0.001), target=(0, 0, 0), ortho=26, clip=0.05)),
    ('level2', dict(eye=(0, 9.5, 0.001), target=(0, 0, 0), ortho=26, clip=0.05)),
    ('walk', dict(eye=(0, 40, 0.001), target=(0, 0, 0), ortho=26, walk=True)),
    ('threequarter', dict(eye=(-16, 18, -18), target=(0, 1.5, 0), lens=22)),
    ('threequarter_b', dict(eye=(15, 15, 17), target=(0, 2, -1), lens=22)),
    ('floor_view', dict(eye=(3, 1.7, -5.5), target=(-1, 2.5, 6), lens=18)),
]
for name, kw in SHOTS or default:
    files.append(shot(name, **kw))
if ceiling:
    ceiling.hide_render = False
helpers.hide_render = True
scene.camera = previous_camera
bpy.data.objects.remove(cam, do_unlink=True)
result = {'files': files}
