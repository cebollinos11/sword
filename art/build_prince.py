"""
Builds the Prince Fighter model in Blender, after the original Prince of
Persia: loose white shirt and baggy trousers gathered at the ankles, bare
feet, black hair, with a Team-coloured open vest, sash and headband, and a
futuristic edge (brass bracers and anklets with glowing bands, a glowing sash
clasp). Shared helpers are in art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_prince.py").read(), {"__file__": r"C:/Repos/sword/art/build_prince.py"})
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

NAME = 'Prince'
SAVE = globals().get('SAVE', True)  # write art/prince.blend and public/models/prince.glb
OUT_BLEND = os.path.join(REPO, 'art', 'prince.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'prince.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Skin': (0xc08a62, 0.0, 0.6, False),
    'Cloth': (0xe9e4d8, 0.0, 0.85, False),
    'Skirt': (0xa3201f, 0.0, 0.8, True),  # vest, sash and headband: the Team colour
    'Metal': (0xc9a24a, 0.8, 0.35, False),
    'Glow': (0x6fe8ff, 0.0, 0.3, False),
    'Hair': (0x17110f, 0.0, 0.7, True),
    'Eyes': (0x2b1a14, 0.0, 0.3, False),
}
B = Body(NAME, MATERIALS, flat=('Metal', 'Glow'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth)
    (0.88, 0.135, 0.095),
    (0.94, 0.155, 0.105),
    (1.00, 0.158, 0.106),
    (1.07, 0.15, 0.10),
    (1.14, 0.15, 0.104),
    (1.21, 0.162, 0.112),  # the shirt billows over the sash
    (1.28, 0.165, 0.112),
    (1.34, 0.17, 0.112),
    (1.40, 0.177, 0.112),
    (1.46, 0.183, 0.104),
    (1.515, 0.178, 0.088),
    (1.555, 0.105, 0.068),
    (1.59, 0.062, 0.056),
    (1.625, 0.05, 0.046),
    (1.65, 0.036, 0.034),
]


def torso_mat(c):
    if c.z > 1.55:
        return 'Skin'
    # The shirt's open neck.
    if c.y < 0 and abs(c.x) < 0.07 - (1.53 - c.z) * 0.35 and c.z > 1.37:
        return 'Skin'
    return 'Cloth'


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.13, 0.18, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.6)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 16, (0, -1, 0))
    B.part('torso', bm, torso_mat, torso_weights)

# ---------------------------------------------------------------- vest, sash


def build_vest():
    rings = [(1.17, 0.165, 0.118), (1.28, 0.175, 0.122), (1.40, 0.186, 0.122), (1.47, 0.192, 0.114), (1.52, 0.184, 0.096)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 16, (0, -1, 0), cap0=False, cap1=False)
    # Open at the front, and cut away under the arms.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if (lambda c: (c.y < -0.06 and abs(c.x) < 0.075)
                                                       or (abs(c.x) > 0.16 and c.z > 1.42))(f.calc_center_median())], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    B.part('vest', bm, const('Skirt'), torso_weights)


def build_sash():
    rings = [(1.165, 0.158, 0.112), (1.15, 0.166, 0.12), (1.06, 0.166, 0.118), (1.045, 0.158, 0.11)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 16, (0, -1, 0), cap0=False, cap1=False)
    # The knotted tail hanging at the left hip.
    tube(bm, [(0.12, -0.10, 1.09), (0.14, -0.11, 0.98), (0.15, -0.11, 0.86)], [(0.03, 0.006), (0.034, 0.006), (0.036, 0.005)], 4, (0, -1, 0),
         phase=math.pi / 4)

    def weights(p):
        w = trunk_weights(p)
        return blend(w, {'thigh_L': 1}, smooth(1.02, 0.86, p.z) * 0.6)

    B.part('sash', bm, const('Skirt'), weights, smooth_shade=False)
    bm = bmesh.new()
    tube(bm, [(0, -0.115, 1.105), (0, -0.13, 1.105)], [(0.026, 0.026), (0.022, 0.022)], 8, (0, 0, 1))
    B.part('clasp', bm, lambda c: 'Glow' if c.y < -0.128 else 'Metal', trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth): baggy trousers gathered at the ankle
    (0.98, 0.10, 0.104),
    (0.86, 0.102, 0.104),
    (0.72, 0.096, 0.098),
    (0.58, 0.094, 0.096),
    (0.44, 0.098, 0.102),
    (0.30, 0.094, 0.098),
    (0.19, 0.076, 0.08),
    (0.14, 0.05, 0.054),
    (0.135, 0.054, 0.058),
    (0.105, 0.054, 0.058),
    (0.10, 0.044, 0.048),
    (0.065, 0.04, 0.045),
]


def leg_mat(c):
    if c.z > 0.135:
        return 'Cloth'
    if c.z > 0.117:
        return 'Glow'
    if c.z > 0.10:
        return 'Metal'
    return 'Skin'


def build_leg(mirror):
    def push(i, p, t):
        # The trousers sag in folds above the ankle.
        if i in (5, 6):
            p.y += 0.006 * math.cos(3 * t)
        return p

    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], 10, (0, -1, 0), phase=math.pi / 10, push=push)
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, leg_weights, mirror)


def build_foot(mirror):
    rings = [  # (y, half width, half height); a bare foot, its sole on the floor
        (0.055, 0.038, 0.048),
        (0.025, 0.044, 0.056),
        (-0.03, 0.048, 0.042),
        (-0.09, 0.052, 0.03),
        (-0.15, 0.05, 0.022),
        (-0.19, 0.04, 0.016),
    ]
    bm = bmesh.new()
    tube(bm, [(HIP_X, y, rz) for y, _, rz in rings], [(rx, rz) for _, rx, rz in rings], 8, (0, 0, 1))
    B.part('foot_R' if mirror else 'foot_L', bm, const('Skin'), foot_weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height): a loose sleeve to a brass bracer
    (0.10, 1.49, 0.055, 0.06),
    (0.17, 1.50, 0.062, 0.068),
    (0.24, 1.505, 0.062, 0.066),
    (0.32, 1.508, 0.06, 0.062),
    (0.42, 1.508, 0.064, 0.066),
    (0.50, 1.506, 0.07, 0.072),
    (0.58, 1.507, 0.072, 0.07),
    (0.625, 1.512, 0.06, 0.056),
    (0.64, 1.518, 0.042, 0.038),
    (0.67, 1.518, 0.043, 0.038),
    (0.685, 1.518, 0.042, 0.036),
    (0.715, 1.518, 0.037, 0.031),
]


def arm_mat(c):
    if c.x < 0.635:
        return 'Cloth'
    if 0.67 < c.x < 0.685:
        return 'Glow'
    return 'Metal'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.036, 0.03), (0.75, 1.516, 0.047, 0.03), (0.80, 1.514, 0.049, 0.025),
             (0.845, 1.510, 0.047, 0.018), (0.875, 1.505, 0.041, 0.012)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.031, 1.512), (0.765, -0.061, 1.507), (0.795, -0.079, 1.50)], [(0.014, 0.012), (0.012, 0.011), (0.009, 0.008)], 6, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Skin'), hand_weights, mirror)

# ---------------------------------------------------------------- head, hair


def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm, size=(0.077, 0.097, 0.119)), rigid('head'))

    # Thick black hair: a cap over the crown, a fringe, and locks down to the nape.
    bm = bmesh.new()
    verts = sphere(bm, 12, 8, (0, 0.012, HEAD_Z + 0.01), (0.088, 0.112, 0.13), skull)
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < HEAD_Z + 0.005 - 0.9 * max(0.0, v.co.y + 0.03)
                               and not (v.co.y > 0.0 and v.co.z > HEAD_Z - 0.09)], context='VERTS')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.07 and v.co.z < HEAD_Z + 0.045], context='VERTS')
    for sx in (1, -1):
        tube(bm, [(sx * 0.07, 0.02, HEAD_Z + 0.06), (sx * 0.08, 0.05, HEAD_Z - 0.03), (sx * 0.06, 0.08, HEAD_Z - 0.11)],
             [(0.016, 0.03), (0.016, 0.03), (0.008, 0.016)], 4, (0, -1, 0))
    B.part('hair', bm, const('Hair'), lambda p: blend({'head': 1}, {'spine': 1}, smooth(HEAD_Z - 0.06, HEAD_Z - 0.13, p.z) * 0.6))

    # The headband, its tails trailing behind.
    rings = [(HEAD_Z + 0.05, 0.0), (HEAD_Z + 0.075, 0.0)]

    def onto_skull(i, p, t):
        dz = (0.032, 0.058)[i] + 0.012 * max(0.0, -math.sin(t))
        k = math.sqrt(max(0.0, 1 - (dz / 0.12) ** 2)) * 1.2
        back = 1.08 if math.sin(t) < 0 else 1.0
        return Vector((-0.078 * k * math.cos(t), 0.005 - 0.098 * k * back * math.sin(t), HEAD_Z + dz))

    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _ in rings], [(1, 1)] * 2, 12, (0, -1, 0), push=onto_skull, cap0=False, cap1=False)
    tube(bm, [(0.02, 0.11, HEAD_Z + 0.05), (0.04, 0.16, HEAD_Z - 0.02), (0.05, 0.18, HEAD_Z - 0.10)], [(0.012, 0.003)] * 3, 4, (1, 0, 0))
    B.part('headband', bm, const('Skirt'), lambda p: blend({'head': 1}, {'spine': 1}, smooth(HEAD_Z, HEAD_Z - 0.1, p.z) * 0.5),
           smooth_shade=False)

# ---------------------------------------------------------------- assemble


build_torso()
build_vest()
build_sash()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
