"""
Builds the female Fighter model in Blender: a low-poly skinned mesh fitted to
the game's Skeleton (data/skeleton.json), plus an armature whose bones run
between the Skeleton's joints (src/sim/skeleton.ts). The shared helpers are in
art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_female.py").read(), {"__file__": r"C:/Repos/sword/art/build_female.py"})

Rest pose: legs straight down, arms straight out (T-pose), facing -Y with the
character's left on +X (glTF export turns this into +z forward, y up, which is
the game's facing 0).
"""
import importlib
import math
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body_common
importlib.reload(body_common)
from body_common import *  # noqa: F401,F403

NAME = 'Female'
SAVE = globals().get('SAVE', True)  # write art/female.blend and public/models/female.glb
OUT_BLEND = os.path.join(REPO, 'art', 'female.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'female.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {  # bronze, dark leather and platinum-blonde hair
    'Skin': (0xc48c6a, 0.0, 0.6, False),
    'Top': (0x3a2922, 0.0, 0.8, False),
    'Skirt': (0xa3201f, 0.0, 0.8, True),  # the Team colour
    'Belt': (0x6b4a2e, 0.0, 0.7, False),
    'Buckle': (0xe0bb5c, 0.8, 0.3, False),
    'Armour': (0xc99a52, 0.75, 0.35, True),
    'Black': (0x241c19, 0.0, 0.8, False),
    'Hair': (0xe6d3a0, 0.0, 0.7, True),
    'Eyes': (0x2b1a14, 0.0, 0.3, False),
}
B = Body(NAME, MATERIALS, flat=('Buckle', 'Belt'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth)
    (0.88, 0.13, 0.09),
    (0.94, 0.17, 0.11),
    (1.00, 0.172, 0.11),
    (1.07, 0.158, 0.10),
    (1.14, 0.138, 0.092),
    (1.21, 0.135, 0.092),
    (1.28, 0.145, 0.098),
    (1.34, 0.152, 0.10),
    (1.40, 0.158, 0.10),
    (1.46, 0.165, 0.092),
    (1.515, 0.165, 0.08),
    (1.555, 0.10, 0.065),
    (1.59, 0.05, 0.048),
    (1.64, 0.036, 0.034),
]
BUST = {1.28: 0.3, 1.34: 1.0, 1.40: 0.8, 1.46: 0.15}
GLUTES = {0.88: 0.4, 0.94: 1.0, 1.00: 0.75, 1.07: 0.25}


def torso_push(i, p, t):
    z, x, s = TORSO[i][0], abs(p.x), math.sin(t)
    if s > 0:
        p.y -= BUST.get(z, 0) * 0.07 * math.exp(-((x - 0.085) / 0.05) ** 2) * s
    else:
        p.y -= GLUTES.get(z, 0) * 0.04 * math.exp(-((x - 0.075) / 0.06) ** 2) * s
    return p


def torso_mat(c):
    x, z = abs(c.x), c.z
    if z < 1.10:
        return 'Black'
    # A strapless leather bodice, cut straight across the chest.
    return 'Top' if z < (1.445 if c.y < 0 else 1.47) else 'Skin'


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.12, 0.17, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.6)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 24, (0, -1, 0), push=torso_push)
    B.part('torso', bm, torso_mat, torso_weights)

# ---------------------------------------------------------------- skirt, belt

def build_skirt():
    rings = [(1.13, 0.146, 0.100, 0.005), (1.04, 0.192, 0.146, 0.012), (0.92, 0.238, 0.196, 0.015), (0.80, 0.272, 0.226, 0.016),
             (0.72, 0.29, 0.24, 0.016)]
    pleat = [0.0, 0.02, 0.05, 0.07, 0.08]

    def push(i, p, t):
        k = round((t - 0) / (2 * math.pi / 28))
        if k % 2:
            c = Vector((0, rings[i][3], p.z))
            p = c + (p - c) * (1 - pleat[i])
        return p

    bm = bmesh.new()
    tube(bm, [(0, y, z) for z, _, _, y in rings], [(rx, ry) for _, rx, ry, _ in rings], 28, (0, -1, 0), push=push, cap0=False, cap1=False)

    def weights(p):
        w = {'hips': 1.0}
        w = blend(w, {'spine': 1}, smooth(1.00, 1.25, p.z))
        drape = smooth(1.05, 0.78, p.z) * 0.88
        w = blend(w, {'thigh_L': 1}, drape * max(0, min(1, (p.x + 0.03) / 0.15)))
        w = blend(w, {'thigh_R': 1}, drape * max(0, min(1, (-p.x + 0.03) / 0.15)))
        return w

    B.part('skirt', bm, const('Skirt'), weights, smooth_shade=False)


def build_belt():
    rings = [(1.25, 0.140, 0.097), (1.245, 0.150, 0.107), (1.105, 0.153, 0.109), (1.10, 0.146, 0.103)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 20, (0, -1, 0), cap0=False, cap1=False)
    B.part('belt', bm, const('Belt'), trunk_weights, smooth_shade=False)
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for v in geom['verts']:
        v.co = Vector((v.co.x * 0.085, v.co.y * 0.012 - 0.113, v.co.z * 0.10 + 1.175))
    B.part('buckle', bm, const('Buckle'), trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth, shin-plate ridge): bronze greaves with a knee cop, over boots
    (0.97, 0.095, 0.098, 0),
    (0.86, 0.088, 0.092, 0),
    (0.74, 0.074, 0.078, 0),
    (0.66, 0.064, 0.067, 0),
    (0.625, 0.066, 0.069, 0),
    (0.615, 0.086, 0.09, 0.02),  # the greave's flared rim
    (0.585, 0.08, 0.086, 0.055),  # the knee cop
    (0.53, 0.072, 0.078, 0.035),
    (0.46, 0.068, 0.074, 0.014),
    (0.38, 0.077, 0.085, 0.022),
    (0.28, 0.071, 0.079, 0.022),
    (0.19, 0.062, 0.068, 0.016),
    (0.175, 0.075, 0.08, 0.014),  # the boot's cuff
    (0.14, 0.072, 0.077, 0.01),
    (0.10, 0.068, 0.074, 0),
    (0.065, 0.06, 0.066, 0),
]


def leg_mat(c):
    if c.z > 0.645:
        return 'Skin'
    if c.z > 0.62:
        return 'Black'
    if c.z > 0.18:
        return 'Armour'
    return 'Black'


def build_leg(mirror):
    def push(i, p, t):
        p.y -= LEG[i][3] * max(0, math.sin(t)) ** 4
        return p

    def weights(p):
        w = by_distance(p, ['thigh_L', 'shin_L', 'foot_L'])
        return blend(w, {'hips': 1}, smooth(0.92, 1.0, p.z) * 0.5)

    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry, _ in LEG], 12, (0, -1, 0), phase=math.pi / 12, push=push)
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, weights, mirror)


def build_foot(mirror):
    rings = [  # (y, half width, half height); the sole sits on the floor
        (0.07, 0.05, 0.055),
        (0.03, 0.064, 0.07),
        (-0.03, 0.064, 0.06),
        (-0.10, 0.066, 0.046),
        (-0.17, 0.06, 0.038),
        (-0.22, 0.045, 0.032),
    ]
    bm = bmesh.new()
    tube(bm, [(HIP_X, y, rz) for y, _, rz in rings], [(rx, rz) for _, rx, rz in rings], 8, (0, 0, 1))

    def weights(p):
        return blend({'foot_L': 1}, {'shin_L': 1}, smooth(0.09, 0.13, p.z) * 0.6)

    B.part('foot_R' if mirror else 'foot_L', bm, const('Black'), weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height)
    (0.10, 1.49, 0.045, 0.05),
    (0.17, 1.50, 0.052, 0.058),
    (0.21, 1.507, 0.05, 0.055),
    (0.27, 1.512, 0.047, 0.05),
    (0.36, 1.515, 0.040, 0.043),
    (0.44, 1.517, 0.037, 0.038),
    (0.465, 1.518, 0.039, 0.040),
    (0.475, 1.518, 0.056, 0.058),  # the vambrace's flared cuff
    (0.52, 1.518, 0.052, 0.053),
    (0.60, 1.518, 0.050, 0.047),
    (0.67, 1.518, 0.044, 0.039),
    (0.715, 1.518, 0.036, 0.030),
]


def arm_mat(c):
    if c.x < 0.455:
        return 'Skin'
    if c.x < 0.468:
        return 'Black'
    return 'Armour'


def build_arm(mirror):
    def weights(p):
        w = by_distance(p, ['upperArm_L', 'forearm_L', 'hand_L'])
        return blend(w, {'spine': 1}, smooth(0.19, 0.13, p.x) * 0.6)

    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 10, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, weights, mirror)


def build_pauldron(mirror):
    """A two-plate bronze pauldron capping the shoulder, hanging lower on the outside."""
    bm = bmesh.new()
    cx, cz = 0.22, 1.50
    verts = sphere(bm, 14, 8, (cx, 0.0, cz), (0.125, 0.112, 0.098))
    # Cut away the underside: high toward the neck, low over the arm.
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < cz - 0.005 + 0.5 * (0.2 - v.co.x)], context='VERTS')
    # A rolled rim along the lower edge, over the arm.
    tube(bm, [(cx + 0.09, -0.085, cz - 0.035), (cx + 0.122, 0.0, cz - 0.058), (cx + 0.09, 0.085, cz - 0.035)],
         [(0.014, 0.014)] * 3, 6, (0, 0, 1))

    def weights(p):
        a = 0.35 + 0.6 * smooth(0.13, 0.26, p.x)
        return {'upperArm_L': a, 'spine': 1 - a}

    B.part('pauldron_R' if mirror else 'pauldron_L', bm, const('Armour'), weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.036, 0.03), (0.75, 1.516, 0.046, 0.029), (0.80, 1.514, 0.048, 0.024),
             (0.845, 1.510, 0.046, 0.018), (0.875, 1.505, 0.04, 0.012)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.03, 1.512), (0.765, -0.06, 1.507), (0.795, -0.078, 1.50)], [(0.014, 0.012), (0.012, 0.011), (0.009, 0.008)], 6, (0, 0, 1))

    def weights(p):
        return blend({'forearm_L': 1}, {'hand_L': 1}, smooth(0.70, 0.76, p.x))

    B.part('hand_R' if mirror else 'hand_L', bm, const('Black'), weights, mirror)

# ---------------------------------------------------------------- head, hair

def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm), rigid('head'))
    face_features(B, brow_tilt=0.004)


def build_hair():
    bm = bmesh.new()
    verts = sphere(bm, 12, 8, (0, 0.01, HEAD_Z + 0.008), (0.088, 0.112, 0.13), skull)
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < HEAD_Z - 0.015 - 0.5 * v.co.y], context='VERTS')
    # Locks hanging in front of the ears, framing the face.
    for sx in (1, -1):
        tube(bm, [(sx * 0.074, -0.04, HEAD_Z + 0.07), (sx * 0.084, -0.05, HEAD_Z - 0.01), (sx * 0.078, -0.045, HEAD_Z - 0.10)],
             [(0.012, 0.022), (0.012, 0.02), (0.006, 0.01)], 4, (0, -1, 0))
    B.part('hair', bm, const('Hair'), rigid('head'))

    braid = [(1.83, 0.07), (1.81, 0.12), (1.76, 0.145), (1.68, 0.13), (1.60, 0.125), (1.52, 0.13), (1.44, 0.135),
             (1.36, 0.135), (1.28, 0.135), (1.20, 0.14), (1.12, 0.15), (1.05, 0.17), (0.98, 0.19), (0.93, 0.20)]
    radii = []
    for i in range(len(braid)):
        r = (0.034 if i % 2 else 0.026) * (1 - 0.5 * i / len(braid))
        radii.append((r, r))
    radii[0] = (0.03, 0.03)
    radii[-1] = (0.01, 0.01)
    bm = bmesh.new()
    tube(bm, [(0, y, z - 1.73 + HEAD_Z) for z, y in braid], radii, 6, (0, 1, 0))
    B.part('braid', bm, const('Hair'), lambda p: blend({'spine': 1}, {'head': 1}, smooth(1.62, 1.72, p.z)))

# ---------------------------------------------------------------- assemble

build_torso()
build_skirt()
build_belt()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
    build_pauldron(mirror)
build_head()
build_hair()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
