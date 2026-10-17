"""
Renders preview shots of whatever is in the open Blender scene, to check a
Body model by eye (Workbench engine, orthographic, material colours).

Run inside Blender, passing the shots and an output folder:
    exec(open(r"C:/Repos/sword/art/render_views.py").read(), {
        "OUT": r"<folder>/",
        "SHOTS": [("front", 0, (0, 0, 0.93), 2.0), ("head", 30, (0, 0, 1.66), 0.55)],
    })
Each shot is (file name, yaw in degrees: 0 looks at the front, 90 at the
character's right side, 180 at the back; point to centre on; ortho height in m).
`result["files"]` lists the PNGs. The temporary camera is removed afterwards.
"""
import math

import bpy
from mathutils import Euler, Vector

scene = bpy.context.scene
cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
previous_camera = scene.camera
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = globals().get('WIDTH', 600)
scene.render.resolution_y = globals().get('HEIGHT', 600)
scene.render.resolution_percentage = 100
files = []
for name, yaw, centre, height in SHOTS:
    a = math.radians(yaw)
    cam.location = Vector((centre[0] - 5 * math.sin(a), centre[1] - 5 * math.cos(a), centre[2]))
    cam.rotation_euler = Euler((math.radians(90), 0, -a))
    cam.data.ortho_scale = height
    scene.render.filepath = OUT + name + '.png'
    bpy.ops.render.render(write_still=True)
    files.append(scene.render.filepath)
scene.camera = previous_camera
bpy.data.objects.remove(cam, do_unlink=True)
result = {'files': files}
