"""
Builds the Monk Fighter model in Blender: a Gregorian monk in a hooded,
ankle-length habit with a Team-coloured scapular, rope cord, tonsure and
sandals, given a futuristic edge (steel gorget and bracers with glowing bands,
a cybernetic eyepiece). Shared helpers are in art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_monk.py").read(), {"__file__": r"C:/Repos/sword/art/build_monk.py"})
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

NAME = 'Monk'
SAVE = globals().get('SAVE', True)  # write art/monk.blend and public/models/monk.glb
OUT_BLEND = os.path.join(REPO, 'art', 'monk.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'monk.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Skin': (0xb98a6a, 0.0, 0.6, False),
    'Robe': (0x3b2e26, 0.0, 0.9, True),
    'Skirt': (0xa3201f, 0.0, 0.8, True),  # the scapular: the Team colour
    'Rope': (0xb59a6a, 0.0, 0.9, False),
    'Metal': (0x8f969c, 0.8, 0.35, False),
    'Glow': (0x6fe8ff, 0.0, 0.3, False),
    'Hair': (0x4a3324, 0.0, 0.8, False),
    'Sole': (0x3a2a1c, 0.0, 0.8, False),
    'Eyes': (0x2b1a14, 0.0, 0.3, False),
}
B = Body(NAME, MATERIALS, flat=('Metal', 'Glow', 'Rope'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth)
    (0.88, 0.14, 0.10),
    (0.94, 0.16, 0.11),
    (1.00, 0.162, 0.11),
    (1.07, 0.156, 0.106),
    (1.14, 0.152, 0.104),
    (1.21, 0.156, 0.106),
    (1.28, 0.164, 0.11),
    (1.34, 0.172, 0.114),
    (1.40, 0.18, 0.115),
    (1.46, 0.186, 0.108),
    (1.515, 0.18, 0.09),
    (1.555, 0.11, 0.07),
    (1.59, 0.056, 0.05),
    (1.64, 0.042, 0.04),
]


def torso_depth(z):
    """The torso's half depth at height z (for laying things on its front and back)."""
    for (z0, _, d0), (z1, _, d1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            return d0 + (d1 - d0) * (z - z0) / (z1 - z0)
    return TORSO[0][2] if z < TORSO[0][0] else TORSO[-1][2]


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
    B.part('torso', bm, lambda c: 'Skin' if c.z > 1.56 else 'Robe', torso_weights)

# ---------------------------------------------------------------- habit, scapular, cord, cowl


def leg_side(x):
    """How far a point under the habit belongs to the left leg (1) rather than the right (0)."""
    return smooth(-0.07, 0.07, x)


def drape_weights(p, top=1.06, bottom=0.82, shins=0.55):
    """Hanging cloth: hips and spine at the waist, following the legs (thigh, then a little shin) below it."""
    w = trunk_weights(p)
    drape = smooth(top, bottom, p.z) * 0.88
    shin = smooth(0.62, 0.30, p.z) * shins
    left = leg_side(p.x)
    legs = {'thigh_L': left * (1 - shin), 'shin_L': left * shin, 'thigh_R': (1 - left) * (1 - shin), 'shin_R': (1 - left) * shin}
    return blend(w, legs, drape)


HABIT = [  # (z, half width, half depth, centre y)
    (1.14, 0.158, 0.110, 0.0),
    (1.02, 0.180, 0.130, 0.004),
    (0.86, 0.200, 0.150, 0.008),
    (0.66, 0.212, 0.162, 0.010),
    (0.44, 0.222, 0.172, 0.012),
    (0.24, 0.232, 0.182, 0.012),
    (0.09, 0.240, 0.190, 0.012),
]


def habit_surface(z, sy):
    """The y of the habit's front (sy = -1) or back (sy = 1) at height z."""
    for (z0, _, d0, c0), (z1, _, d1, c1) in zip(HABIT, HABIT[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            return c0 + (c1 - c0) * t + sy * (d0 + (d1 - d0) * t)
    return sy * HABIT[0][2]


def build_habit():
    rings = HABIT

    def push(i, p, t):
        # Folds: every other column sinks in a little toward the hem.
        k = round(t / (2 * math.pi / 20))
        if k % 2 and i > 1:
            c = Vector((0, rings[i][3], p.z))
            p = c + (p - c) * (1 - 0.035 * i / len(rings))
        return p

    bm = bmesh.new()
    tube(bm, [(0, y, z) for z, _, _, y in rings], [(rx, ry) for _, rx, ry, _ in rings], 20, (0, -1, 0), push=push, cap0=False, cap1=False)
    B.part('habit', bm, const('Robe'), drape_weights)


def build_scapular():
    """The Team-coloured panel hanging front and back over the habit, with a glowing cross on the chest."""
    for front in (True, False):
        sy = -1 if front else 1
        zs = [1.53, 1.46, 1.36, 1.24, 1.12, 0.98, 0.80, 0.60, 0.42]

        def y_at(z):
            if z > 1.12:
                return sy * (torso_depth(z) + 0.012)
            return habit_surface(z, sy) + sy * 0.014

        bm = bmesh.new()
        tube(bm, [(0, y_at(z), z) for z in zs], [(0.105, 0.006)] * len(zs), 4, (0, sy, 0), phase=math.pi / 4)
        B.part('scapular', bm, const('Skirt'), lambda p: drape_weights(p, 1.08, 0.86, 0.0), smooth_shade=False)
    bm = bmesh.new()
    y = -(torso_depth(1.36) + 0.022)
    box(bm, (0, y, 1.36), (0.012, 0.004, 0.06))
    box(bm, (0, y, 1.38), (0.04, 0.004, 0.011))
    B.part('cross', bm, const('Glow'), trunk_weights, smooth_shade=False)


def build_cord():
    rings = [(1.135, 0.166, 0.118), (1.115, 0.170, 0.122), (1.095, 0.166, 0.118)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 16, (0, -1, 0), cap0=False, cap1=False)
    # The knotted end hanging down the left side, with a steel tip.
    tube(bm, [(0.10, -0.12, 1.11), (0.11, -0.15, 0.96), (0.115, -0.165, 0.80), (0.115, -0.17, 0.74)],
         [(0.011, 0.011), (0.01, 0.01), (0.01, 0.01), (0.016, 0.016)], 5, (0, -1, 0))
    B.part('cord', bm, lambda c: 'Metal' if c.z < 0.76 else 'Rope', lambda p: drape_weights(p, 1.08, 0.9), smooth_shade=False)


def build_cowl():
    """The hood lying back on the shoulders, a steel gorget around the neck with a glowing band."""
    rings = [(1.43, 0.215, 0.14), (1.50, 0.205, 0.14), (1.555, 0.16, 0.125), (1.59, 0.105, 0.10), (1.60, 0.085, 0.085)]

    def push(i, p, t):
        # The hood gathers behind the neck.
        if math.sin(t) > 0:
            p.y += 0.05 * math.sin(t) ** 3 * (i / len(rings))
            p.z -= 0.03 * math.sin(t) ** 2 * (i / len(rings))
        return p

    bm = bmesh.new()
    tube(bm, [(0, 0.0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 16, (0, -1, 0), push=push, cap0=False, cap1=False)
    # The gathered hood behind the head.
    sphere(bm, 8, 5, (0, 0.105, 1.555), (0.12, 0.055, 0.065))
    B.part('cowl', bm, const('Robe'), lambda p: blend(trunk_weights(p), {'head': 1}, smooth(1.58, 1.62, p.z) * 0.3))

    rings = [(1.565, 0.068, 0.062), (1.585, 0.07, 0.064), (1.60, 0.07, 0.064), (1.625, 0.06, 0.055)]
    bm = bmesh.new()
    tube(bm, [(0, 0.004, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 12, (0, -1, 0), cap0=False, cap1=False)
    B.part('gorget', bm, lambda c: 'Glow' if 1.585 < c.z < 1.60 else 'Metal',
           lambda p: blend(trunk_weights(p), {'head': 1}, 0.4), smooth_shade=False)

# ---------------------------------------------------------------- arms, sleeves, hands

ARM = [  # (x, z, half depth, half height)
    (0.10, 1.49, 0.055, 0.06),
    (0.17, 1.50, 0.062, 0.068),
    (0.21, 1.507, 0.06, 0.065),
    (0.27, 1.512, 0.055, 0.058),
    (0.36, 1.515, 0.048, 0.05),
    (0.44, 1.517, 0.044, 0.045),
    (0.50, 1.518, 0.045, 0.044),
    (0.60, 1.518, 0.046, 0.044),
    (0.655, 1.518, 0.044, 0.04),
    (0.67, 1.518, 0.043, 0.038),
    (0.715, 1.518, 0.037, 0.031),
]


def arm_mat(c):
    if c.x < 0.58:
        return 'Robe'
    if 0.655 < c.x < 0.67:
        return 'Glow'
    return 'Metal'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)

    # The wide sleeve, open at the wrist, hanging lower than the arm.
    rings = [(0.40, 1.516, 0.058, 0.06, 0), (0.50, 1.512, 0.07, 0.078, -0.012), (0.60, 1.505, 0.08, 0.092, -0.022)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z + dz) for x, z, _, _, dz in rings], [(rz, ry) for _, _, ry, rz, _ in rings], 10, (0, -1, 0), cap0=False, cap1=False)

    def sleeve_weights(p):
        return blend({'upperArm_L': 1}, {'forearm_L': 1}, smooth(0.44, 0.54, p.x))

    B.part('sleeve_R' if mirror else 'sleeve_L', bm, const('Robe'), sleeve_weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.038, 0.032), (0.75, 1.516, 0.049, 0.031), (0.80, 1.514, 0.051, 0.026),
             (0.845, 1.510, 0.048, 0.019), (0.875, 1.505, 0.042, 0.013)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.032, 1.512), (0.765, -0.062, 1.507), (0.795, -0.08, 1.50)], [(0.015, 0.013), (0.013, 0.012), (0.01, 0.009)], 6, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Skin'), hand_weights, mirror)

# ---------------------------------------------------------------- legs, sandals

LEG = [  # (z, half width, half depth): only the shins show below the habit
    (0.70, 0.07, 0.074),
    (0.54, 0.066, 0.07),
    (0.38, 0.07, 0.076),
    (0.24, 0.058, 0.064),
    (0.13, 0.046, 0.05),
    (0.07, 0.042, 0.046),
]


def build_leg(mirror):
    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], 8, (0, -1, 0), phase=math.pi / 8)
    B.part('leg_R' if mirror else 'leg_L', bm, const('Skin'), leg_weights, mirror)


def build_foot(mirror):
    rings = [  # (y, half width, half height); the sole sits on the floor
        (0.055, 0.04, 0.05),
        (0.025, 0.046, 0.058),
        (-0.03, 0.05, 0.044),
        (-0.09, 0.054, 0.032),
        (-0.15, 0.052, 0.024),
        (-0.195, 0.042, 0.018),
    ]
    bm = bmesh.new()
    tube(bm, [(HIP_X, y, rz) for y, _, rz in rings], [(rx, rz) for _, rx, rz in rings], 8, (0, 0, 1))
    # The sandal's sole and its straps.
    box(bm, (HIP_X, -0.07, 0.006), (0.058, 0.135, 0.006))
    tube(bm, [(HIP_X, -0.09, 0.0), (HIP_X, -0.09, 0.035)], [(0.058, 0.007), (0.056, 0.007)], 6, (0, -1, 0), cap0=False, cap1=False)

    def mat(c):
        return 'Sole' if c.z < 0.013 or (abs(c.y + 0.09) < 0.01 and c.z < 0.04) else 'Skin'

    B.part('foot_R' if mirror else 'foot_L', bm, mat, foot_weights, mirror)

# ---------------------------------------------------------------- head


def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm, size=(0.078, 0.098, 0.12)), rigid('head'))

    # The tonsure: a ring of hair around a bald crown, high over the brow and low at the nape.
    def onto_skull(i, p, t):
        front, rear = max(0.0, math.sin(t)), max(0.0, -math.sin(t))
        dz = (-0.02 + 0.065 * front - 0.06 * rear, 0.03 + 0.025 * front, 0.072)[i]
        u = dz / 0.12
        k = math.sqrt(max(0.0, 1 - u * u)) * 1.07
        sx, sy = (1 - 0.35 * u * u, 1 - 0.15 * -u) if u < 0 else (1.0, 1.08)
        back = sy if math.sin(t) < 0 else 1.0
        return Vector((-0.078 * k * sx * math.cos(t), 0.005 - 0.098 * k * back * math.sin(t), HEAD_Z + dz))

    bm = bmesh.new()
    tube(bm, [(0, 0, HEAD_Z + z) for z in (0.0, 0.03, 0.06)], [(1, 1)] * 3, 14, (0, -1, 0), push=onto_skull, cap0=False, cap1=False)
    B.part('tonsure', bm, const('Hair'), rigid('head'))

    # A cybernetic eyepiece over the right eye.
    bm = bmesh.new()
    tube(bm, [(-0.031, -0.09, HEAD_Z + 0.017), (-0.031, -0.106, HEAD_Z + 0.017)], [(0.02, 0.02), (0.018, 0.018)], 8, (0, 0, 1))
    B.part('eyepiece', bm, lambda c: 'Glow' if c.y < -0.104 else 'Metal', rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    tube(bm, [(-0.048, -0.088, HEAD_Z + 0.02), (-0.07, -0.064, HEAD_Z + 0.022), (-0.081, -0.028, HEAD_Z + 0.022), (-0.08, 0.01, HEAD_Z + 0.02)], [(0.004, 0.006)] * 4, 4, (0, 0, 1))
    B.part('eyepiece_band', bm, const('Metal'), rigid('head'), smooth_shade=False)

# ---------------------------------------------------------------- assemble


build_torso()
build_habit()
build_scapular()
build_cord()
build_cowl()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
