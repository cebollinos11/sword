"""
Builds the Librarian Fighter model in Blender: a woman in a tight black suit
with glasses and black hair in a bun, given a futuristic edge (Team-coloured
piping down the suit's sides, a high collar with a glowing seam, glowing
lenses and hair pins, a book clasped at the hip). Shared helpers are in
art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_librarian.py").read(), {"__file__": r"C:/Repos/sword/art/build_librarian.py"})
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

NAME = 'Librarian'
SAVE = globals().get('SAVE', True)  # write art/librarian.blend and public/models/librarian.glb
OUT_BLEND = os.path.join(REPO, 'art', 'librarian.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'librarian.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Skin': (0xe0b49a, 0.0, 0.6, False),
    'Suit': (0x16161a, 0.0, 0.55, False),
    'Skirt': (0xa3201f, 0.0, 0.7, False),  # piping, belt and book cover: the Team colour
    'Boots': (0x0c0c0e, 0.3, 0.3, False),
    'Metal': (0xb8bec6, 0.85, 0.3, False),
    'Glow': (0x6fe8ff, 0.0, 0.3, False),
    'Lens': (0xbfefff, 0.0, 0.1, True),
    'Paper': (0xe8dfc4, 0.0, 0.9, False),
    'Hair': (0x0f0d0e, 0.0, 0.6, True),
    'Eyes': (0x2b1a14, 0.0, 0.3, False),
}
B = Body(NAME, MATERIALS, flat=('Metal', 'Glow', 'Lens', 'Paper'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth)
    (0.88, 0.128, 0.088),
    (0.94, 0.165, 0.106),
    (1.00, 0.168, 0.106),
    (1.07, 0.152, 0.096),
    (1.14, 0.132, 0.088),
    (1.21, 0.13, 0.088),
    (1.28, 0.14, 0.094),
    (1.34, 0.148, 0.096),
    (1.40, 0.154, 0.096),
    (1.46, 0.16, 0.09),
    (1.515, 0.16, 0.078),
    (1.555, 0.098, 0.063),
    (1.59, 0.048, 0.046),
    (1.64, 0.035, 0.033),
]
BUST = {1.28: 0.3, 1.34: 0.9, 1.40: 0.7, 1.46: 0.15}
GLUTES = {0.88: 0.4, 0.94: 1.0, 1.00: 0.75, 1.07: 0.25}


def torso_push(i, p, t):
    z, x, s = TORSO[i][0], abs(p.x), math.sin(t)
    if s > 0:
        p.y -= BUST.get(z, 0) * 0.062 * math.exp(-((x - 0.082) / 0.05) ** 2) * s
    else:
        p.y -= GLUTES.get(z, 0) * 0.04 * math.exp(-((x - 0.075) / 0.06) ** 2) * s
    return p


def torso_mat(c):
    if c.z > 1.59:
        return 'Skin'
    # Piping down each side, from the armpit to the hip.
    width = next(rx for z, rx, _ in TORSO if z >= c.z - 0.035)
    if abs(c.y) < 0.03 and abs(c.x) > width * 0.85 and 0.9 < c.z < 1.47:
        return 'Skirt'
    return 'Suit'


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.12, 0.17, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.6)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 20, (0, -1, 0), push=torso_push)
    B.part('torso', bm, torso_mat, torso_weights)


def build_collar():
    rings = [(1.545, 0.078, 0.064, 0.002), (1.565, 0.064, 0.056, 0.004), (1.585, 0.058, 0.052, 0.006),
             (1.595, 0.058, 0.052, 0.006), (1.62, 0.054, 0.049, 0.008)]
    bm = bmesh.new()
    tube(bm, [(0, y, z) for z, _, _, y in rings], [(rx, ry) for _, rx, ry, _ in rings], 12, (0, -1, 0), cap0=False, cap1=False)
    B.part('collar', bm, lambda c: 'Glow' if 1.585 < c.z < 1.595 else 'Suit',
           lambda p: blend(trunk_weights(p), {'head': 1}, smooth(1.57, 1.63, p.z) * 0.4), smooth_shade=False)


def build_belt():
    rings = [(1.17, 0.134, 0.09), (1.165, 0.142, 0.098), (1.125, 0.142, 0.098), (1.12, 0.134, 0.09)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 20, (0, -1, 0), cap0=False, cap1=False)
    B.part('belt', bm, const('Skirt'), trunk_weights, smooth_shade=False)
    bm = bmesh.new()
    box(bm, (0, -0.1, 1.145), (0.022, 0.005, 0.022))
    B.part('buckle', bm, const('Metal'), trunk_weights, smooth_shade=False)

    # A book clasped at the right hip, spine up.
    bm = bmesh.new()
    box(bm, (-0.165, 0.0, 1.03), (0.022, 0.07, 0.09))
    box(bm, (-0.165, 0.004, 1.03), (0.016, 0.068, 0.086))

    def mat(c):
        return 'Paper' if abs(c.x + 0.165) < 0.017 and (abs(c.y - 0.004) > 0.066 or abs(c.z - 1.03) > 0.084) else 'Skirt'

    B.part('book', bm, mat, lambda p: blend({'hips': 1}, {'thigh_R': 1}, 0.35), smooth_shade=False)
    bm = bmesh.new()
    box(bm, (-0.165, 0.0, 1.03), (0.026, 0.012, 0.094))
    B.part('book_clasp', bm, const('Metal'), lambda p: blend({'hips': 1}, {'thigh_R': 1}, 0.35), smooth_shade=False)

# ---------------------------------------------------------------- legs, boots

LEG = [  # (z, half width, half depth): slim, in heeled boots to the knee
    (0.97, 0.092, 0.096),
    (0.86, 0.085, 0.089),
    (0.74, 0.071, 0.075),
    (0.64, 0.061, 0.064),
    (0.585, 0.064, 0.068),  # the boot's top
    (0.56, 0.063, 0.068),
    (0.46, 0.064, 0.07),
    (0.36, 0.068, 0.074),
    (0.24, 0.056, 0.062),
    (0.14, 0.046, 0.052),
    (0.10, 0.05, 0.056),
    (0.065, 0.048, 0.054),
]


def leg_mat(c):
    if c.z < 0.59:
        return 'Boots'
    if c.x - HIP_X > 0.055 and abs(c.y) < 0.03:
        return 'Skirt'
    return 'Suit'


def build_leg(mirror):
    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], 10, (0, -1, 0))
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, leg_weights, mirror)


def build_foot(mirror):
    rings = [  # (y, half width, half height): a pointed boot on a heel
        (0.05, 0.046, 0.06),
        (0.02, 0.052, 0.062),
        (-0.04, 0.054, 0.048),
        (-0.10, 0.052, 0.034),
        (-0.16, 0.044, 0.024),
        (-0.205, 0.026, 0.016),
    ]
    bm = bmesh.new()
    tube(bm, [(HIP_X, y, rz + 0.012 * (1 if y > -0.05 else 0)) for y, _, rz in rings], [(rx, rz) for _, rx, rz in rings], 8, (0, 0, 1))
    box(bm, (HIP_X, 0.04, 0.018), (0.024, 0.02, 0.018))
    B.part('foot_R' if mirror else 'foot_L', bm, lambda c: 'Metal' if c.z < 0.03 and c.y > 0.02 else 'Boots', foot_weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height)
    (0.10, 1.49, 0.043, 0.048),
    (0.17, 1.50, 0.05, 0.056),
    (0.21, 1.507, 0.048, 0.053),
    (0.27, 1.512, 0.045, 0.048),
    (0.36, 1.515, 0.038, 0.041),
    (0.44, 1.517, 0.035, 0.036),
    (0.52, 1.518, 0.038, 0.038),
    (0.60, 1.518, 0.036, 0.034),
    (0.64, 1.518, 0.033, 0.029),
    (0.655, 1.518, 0.036, 0.032),  # the glove's cuff
    (0.715, 1.518, 0.034, 0.029),
]


def arm_mat(c):
    if 0.64 < c.x < 0.655:
        return 'Glow'
    if c.x > 0.655:
        return 'Boots'
    # Piping along the top of the arm.
    return 'Skirt' if c.z > 1.518 + 0.03 and c.x > 0.2 else 'Suit'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.034, 0.029), (0.75, 1.516, 0.044, 0.028), (0.80, 1.514, 0.046, 0.023),
             (0.845, 1.510, 0.044, 0.017), (0.875, 1.505, 0.038, 0.011)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.029, 1.512), (0.765, -0.058, 1.507), (0.795, -0.075, 1.50)], [(0.013, 0.011), (0.011, 0.01), (0.008, 0.007)], 6, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Boots'), hand_weights, mirror)

# ---------------------------------------------------------------- head, hair, glasses


def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm, size=(0.074, 0.094, 0.116), nose=0.016), rigid('head'))

    # Hair pulled back tight: a cap with a side-swept fringe, and a bun at the back of the crown.
    bm = bmesh.new()
    verts = sphere(bm, 12, 8, (0, 0.01, HEAD_Z + 0.008), (0.082, 0.106, 0.126), skull)
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < HEAD_Z - 0.02 - 0.7 * max(0.0, v.co.y)], context='VERTS')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.07 and v.co.z < HEAD_Z + 0.05 + 0.25 * v.co.x], context='VERTS')
    sphere(bm, 8, 6, (0, 0.105, HEAD_Z + 0.06), (0.05, 0.045, 0.05))
    B.part('hair', bm, const('Hair'), rigid('head'))

    # Two glowing pins crossed through the bun.
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.08, 0.10, HEAD_Z + 0.10), (-sx * 0.07, 0.11, HEAD_Z + 0.03)], [(0.005, 0.005)] * 2, 4, (0, 1, 0))
    B.part('pins', bm, lambda c: 'Glow', rigid('head'), smooth_shade=False)

    # Glasses: two framed lenses, a bridge, and arms back to the ears.
    lens_z = HEAD_Z + 0.017
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.032, -0.098, lens_z), (sx * 0.032, -0.104, lens_z)], [(0.024, 0.016), (0.024, 0.016)], 8, (0, 0, 1),
             cap0=False, cap1=False)
        tube(bm, [(sx * 0.056, -0.099, lens_z + 0.006), (sx * 0.075, -0.06, lens_z + 0.008), (sx * 0.077, 0.0, lens_z + 0.002)],
             [(0.003, 0.004)] * 3, 4, (0, 0, 1))
    tube(bm, [(0.01, -0.106, lens_z + 0.004), (-0.01, -0.106, lens_z + 0.004)], [(0.003, 0.003)] * 2, 4, (0, 0, 1))
    B.part('frames', bm, const('Boots'), rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.032, -0.101, lens_z), (sx * 0.032, -0.1012, lens_z)], [(0.022, 0.014), (0.022, 0.014)], 8, (0, 0, 1),
             cap0=False, cap1=True)
    B.part('lenses', bm, const('Lens'), rigid('head'), smooth_shade=False)

# ---------------------------------------------------------------- assemble


build_torso()
build_collar()
build_belt()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
