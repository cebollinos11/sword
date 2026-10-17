"""
Builds the Brawler Fighter model in Blender: a heavy-shouldered fighter with
a green mohawk crest and high ponytail over shaved sides, a sleeveless
Team-coloured top with a high collar, bare muscular arms with wrapped fists,
a single big steel shoulder guard on the left and a bandolier across the
chest, olive trousers with thigh pouches and straps, belts with a hip pouch,
and chunky boots; the futuristic edge is steel with glowing orange bands. Shared helpers are in
art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_brawler.py").read(), {"__file__": r"C:/Repos/sword/art/build_brawler.py"})
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

NAME = 'Brawler'
SAVE = globals().get('SAVE', True)  # write art/brawler.blend and public/models/brawler.glb
OUT_BLEND = os.path.join(REPO, 'art', 'brawler.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'brawler.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {  # olive, tan leather, gunmetal and orange light, green hair
    'Skin': (0xd29a7c, 0.0, 0.6, False),
    'Skirt': (0x3c5a8c, 0.0, 0.8, False),  # the top: the Team colour
    'Trousers': (0x3a3d2a, 0.0, 0.85, False),
    'Leather': (0x8b5a32, 0.0, 0.75, True),
    'Bracer': (0xd8ccb2, 0.0, 0.9, False),  # hand and forearm wraps
    'Metal': (0x6e747c, 0.8, 0.35, True),
    'Glow': (0xff8a2a, 0.0, 0.3, False),
    'Sole': (0x1e1c18, 0.0, 0.8, False),
    'Hair': (0x8fdc4a, 0.0, 0.7, True),
    'Eyes': (0x2b2a3a, 0.0, 0.3, False),
}
B = Body(NAME, MATERIALS, flat=('Glow', 'Leather'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth): a broad back and shoulders over a narrow waist
    (0.88, 0.135, 0.092),
    (0.94, 0.17, 0.11),
    (1.00, 0.172, 0.11),
    (1.07, 0.158, 0.10),
    (1.14, 0.146, 0.096),
    (1.21, 0.152, 0.10),
    (1.28, 0.168, 0.108),
    (1.34, 0.182, 0.114),
    (1.40, 0.194, 0.116),
    (1.46, 0.205, 0.11),
    (1.515, 0.2, 0.098),
    (1.55, 0.15, 0.08),  # the trapezius, sloping up to the neck
    (1.58, 0.075, 0.056),
    (1.64, 0.044, 0.04),
]
BUST = {1.28: 0.3, 1.34: 0.7, 1.40: 0.55, 1.46: 0.1}
GLUTES = {0.88: 0.4, 0.94: 1.0, 1.00: 0.75, 1.07: 0.25}


def torso_push(i, p, t):
    z, x, s = TORSO[i][0], abs(p.x), math.sin(t)
    if s > 0:
        p.y -= BUST.get(z, 0) * 0.065 * math.exp(-((x - 0.085) / 0.05) ** 2) * s
    else:
        p.y -= GLUTES.get(z, 0) * 0.04 * math.exp(-((x - 0.075) / 0.06) ** 2) * s
    return p


def torso_mat(c):
    x, z = abs(c.x), c.z
    if z < 1.12:
        return 'Trousers'
    if z > 1.575:
        return 'Skin'
    # Sleeveless: the bare arms come straight out of the top.
    return 'Skirt'


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.14, 0.2, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.6)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 24, (0, -1, 0), push=torso_push)
    B.part('torso', bm, torso_mat, torso_weights)


def build_collar():
    """The top's high collar: a steel band with a glowing seam over a chain-mail yoke."""
    rings = [(1.535, 0.13, 0.094, 0.0), (1.555, 0.118, 0.086, 0.0), (1.575, 0.078, 0.066, 0.004), (1.585, 0.064, 0.058, 0.006),
             (1.60, 0.064, 0.058, 0.006), (1.625, 0.06, 0.054, 0.008)]
    bm = bmesh.new()
    tube(bm, [(0, y, z) for z, _, _, y in rings], [(rx, ry) for _, rx, ry, _ in rings], 12, (0, -1, 0), cap0=False, cap1=False)

    def mat(c):
        if c.z < 1.572:
            return 'Metal'
        return 'Glow' if 1.585 < c.z < 1.60 else 'Skirt'

    B.part('collar', bm, mat, lambda p: blend(trunk_weights(p), {'head': 1}, smooth(1.57, 1.63, p.z) * 0.4), smooth_shade=False)

# ---------------------------------------------------------------- belts, pouches


def build_belts():
    for top, bottom, tilt in ((1.17, 1.13, 0.0), (1.10, 1.06, 0.04)):
        rings = [(top, 0.142, 0.096), (top - 0.005, 0.152, 0.106), (bottom + 0.005, 0.156, 0.108), (bottom, 0.148, 0.10)]

        def push(i, p, t, tilt=tilt):
            p.z -= tilt * p.x / 0.15  # the lower belt hangs toward the right hip
            return p

        bm = bmesh.new()
        tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 18, (0, -1, 0), push=push, cap0=False, cap1=False)
        B.part('belt', bm, const('Leather'), lambda p: trunk_weights(p, waist=(1.0, 1.3)), smooth_shade=False)
    bm = bmesh.new()
    box(bm, (0, -0.108, 1.15), (0.026, 0.006, 0.024))
    B.part('buckle', bm, const('Metal'), trunk_weights, smooth_shade=False)
    # The pouch on the left hip.
    bm = bmesh.new()
    box(bm, (0.15, -0.04, 1.06), (0.022, 0.045, 0.055))
    box(bm, (0.156, -0.04, 1.10), (0.022, 0.048, 0.018))
    B.part('pouch', bm, const('Leather'), lambda p: blend({'hips': 1}, {'thigh_L': 1}, 0.3), smooth_shade=False)



def torso_width(z):
    for (z0, w0, _), (z1, w1, _) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    return TORSO[0][1] if z < TORSO[0][0] else TORSO[-1][1]


def torso_depth(z):
    for (z0, _, d0), (z1, _, d1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            return d0 + (d1 - d0) * (z - z0) / (z1 - z0)
    return TORSO[0][2] if z < TORSO[0][0] else TORSO[-1][2]


def build_bandolier():
    """A leather strap from the left shoulder across the chest and back to the right hip, with steel rivets."""
    n = 32
    bm = bmesh.new()
    rows = []
    for k in range(n):
        t = 2 * math.pi * k / n
        z = 1.33
        for _ in range(6):  # the strap lies in a tilted plane: high on the left, low on the right
            x = (torso_width(z) + 0.012) * math.cos(t)
            z = 1.32 + 0.17 * x / 0.2
        y = -(torso_depth(z) + 0.014) * math.sin(t)
        if math.sin(t) > 0:
            y -= 0.02 * math.sin(t) ** 2  # over the chest
        rows.append([bm.verts.new((x, y, z + dz)) for dz in (0.024, -0.024)])
    for k in range(n):
        a, b = rows[k], rows[(k + 1) % n]
        bm.faces.new((a[0], a[1], b[1], b[0]))
    B.part('bandolier', bm, const('Leather'), torso_weights, smooth_shade=False)
    bm = bmesh.new()
    for f in (0.25, 0.4, 0.55):
        z = 1.32 + 0.17 * (0.17 - 0.34 * f) / 0.2
        x = 0.17 - 0.34 * f
        box(bm, (x * 0.92, -(torso_depth(z) + 0.035), z), (0.014, 0.008, 0.012))
    B.part('bandolier_rivets', bm, const('Metal'), torso_weights, smooth_shade=False)


def build_shoulder_guard():
    """One big layered steel guard on the left shoulder, with a glowing edge, strapped under the arm."""
    bm = bmesh.new()
    for i, (cx, cz, r) in enumerate(((0.22, 1.525, (0.135, 0.125, 0.105)), (0.27, 1.475, (0.12, 0.118, 0.085)))):
        verts = sphere(bm, 14, 8, (cx, 0.0, cz), r)
        bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < cz - 0.005 + 0.45 * (0.21 - v.co.x) - 0.02 * i], context='VERTS')
    tube(bm, [(0.33, -0.09, 1.45), (0.385, 0.0, 1.425), (0.33, 0.09, 1.45)], [(0.012, 0.012)] * 3, 6, (0, 0, 1))

    def mat(c):
        return 'Glow' if c.x > 0.36 and c.z < 1.44 else 'Metal'

    def weights(p):
        a = 0.35 + 0.6 * smooth(0.13, 0.28, p.x)
        return {'upperArm_L': a, 'spine': 1 - a}

    B.part('shoulder_guard', bm, mat, weights)

# ---------------------------------------------------------------- legs, boots

LEG = [  # (z, half width, half depth)
    (0.97, 0.096, 0.1),
    (0.86, 0.09, 0.094),
    (0.74, 0.078, 0.082),
    (0.64, 0.068, 0.072),
    (0.56, 0.07, 0.076),
    (0.48, 0.07, 0.076),
    (0.44, 0.08, 0.086),  # the boot's top
    (0.40, 0.08, 0.088),
    (0.30, 0.074, 0.082),
    (0.19, 0.064, 0.07),
    (0.12, 0.066, 0.074),
    (0.065, 0.06, 0.066),
]
STRAPS = (0.36, 0.24)  # boot straps


def leg_mat(c):
    if any(abs(c.z - z) < 0.012 for z in STRAPS):
        return 'Leather'
    return 'Leather' if c.z < 0.445 else 'Trousers'


def build_leg(mirror):
    rows = []
    for z, rx, ry in LEG:
        rows.append((z, rx, ry))
    for z in STRAPS:  # thin raised bands
        r = next((rx, ry) for zz, rx, ry in reversed(LEG) if zz >= z)
        rows += [(z + 0.012, r[0] + 0.004, r[1] + 0.004), (z - 0.012, r[0] + 0.004, r[1] + 0.004)]
    rows.sort(key=lambda r: -r[0])
    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in rows], [(rx, ry) for _, rx, ry in rows], 10, (0, -1, 0), phase=math.pi / 10)
    # A pouch on the outside of the thigh, between the straps.
    box(bm, (HIP_X + 0.085, -0.01, 0.75), (0.018, 0.04, 0.05))
    B.part('leg_R' if mirror else 'leg_L', bm, lambda c: 'Leather' if c.x > HIP_X + 0.085 and 0.68 < c.z < 0.82 else leg_mat(c), leg_weights, mirror)


def build_foot(mirror):
    rings = [  # (y, half width, half height); the boot stands on a thick sole
        (0.075, 0.058, 0.062),
        (0.03, 0.072, 0.076),
        (-0.03, 0.073, 0.066),
        (-0.10, 0.075, 0.054),
        (-0.17, 0.07, 0.048),
        (-0.225, 0.054, 0.04),
    ]
    bm = bmesh.new()
    tube(bm, [(HIP_X, y, rz + 0.012) for y, _, rz in rings], [(rx, rz) for _, rx, rz in rings], 10, (0, 0, 1))
    box(bm, (HIP_X, -0.075, 0.014), (0.078, 0.158, 0.014))
    B.part('foot_R' if mirror else 'foot_L', bm, lambda c: 'Sole' if c.z < 0.03 else 'Leather', foot_weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height): bare, heavy arms
    (0.10, 1.49, 0.058, 0.066),
    (0.17, 1.50, 0.07, 0.078),  # the deltoid
    (0.22, 1.505, 0.068, 0.076),
    (0.28, 1.51, 0.062, 0.068),
    (0.34, 1.513, 0.06, 0.064),  # the biceps
    (0.40, 1.516, 0.05, 0.052),
    (0.45, 1.517, 0.05, 0.05),
    (0.50, 1.518, 0.056, 0.056),  # the wraps
    (0.57, 1.518, 0.057, 0.054),
    (0.61, 1.518, 0.052, 0.049),
    (0.625, 1.518, 0.05, 0.047),
    (0.68, 1.518, 0.045, 0.039),
    (0.715, 1.518, 0.039, 0.032),
]


def arm_mat(c):
    if c.x < 0.48:
        return 'Skin'
    if 0.61 < c.x < 0.625:
        return 'Glow'
    return 'Bracer'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 10, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.04, 0.033), (0.745, 1.516, 0.053, 0.037), (0.79, 1.514, 0.056, 0.038),
             (0.83, 1.510, 0.052, 0.034), (0.855, 1.506, 0.044, 0.025)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.03, 1.512), (0.765, -0.058, 1.507), (0.79, -0.072, 1.50)], [(0.015, 0.013), (0.013, 0.012), (0.01, 0.009)], 6, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, lambda c: 'Bracer' if c.x < 0.82 else 'Skin', hand_weights, mirror)

# ---------------------------------------------------------------- head, hair


def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm), rigid('head'))

    face_features(B, brow='Hair', brow_tilt=-0.004, mouth_width=0.021)

    # Shaved sides: a short strip of hair over the crown, under a spiked crest.
    bm = bmesh.new()
    verts = sphere(bm, 12, 8, (0, 0.01, HEAD_Z + 0.008), (0.084, 0.108, 0.128), skull)
    bmesh.ops.delete(bm, geom=[v for v in verts if abs(v.co.x) > 0.05 or v.co.z < HEAD_Z + 0.02 - 0.5 * max(0.0, v.co.y)
                               or (v.co.y < -0.08 and v.co.z < HEAD_Z + 0.07)], context='VERTS')
    crest = [(-0.085, 0.07), (-0.07, 0.105), (-0.035, 0.13), (0.0, 0.135), (0.035, 0.125), (0.065, 0.10)]
    pts, radii = [], []
    for i, (y, dz) in enumerate(crest):
        spike = 0.012 if i % 2 else 0.0
        pts.append((0, y, HEAD_Z + dz + 0.012 + spike * 0.5))
        radii.append((0.022, 0.03 + spike))
    tube(bm, pts, radii, 6, (0, 0, 1))
    B.part('hair', bm, const('Hair'), rigid('head'))

    # The high ponytail: tied at the crown, arcing up and back, falling to the shoulder blades.
    path = [(0, 0.07, HEAD_Z + 0.09), (0, 0.10, HEAD_Z + 0.13), (0, 0.15, HEAD_Z + 0.14), (0.01, 0.20, HEAD_Z + 0.10),
            (0.02, 0.23, HEAD_Z + 0.02), (0.03, 0.24, HEAD_Z - 0.08), (0.04, 0.23, HEAD_Z - 0.18), (0.05, 0.22, HEAD_Z - 0.27)]
    radii = [(0.03, 0.03), (0.036, 0.032), (0.05, 0.04), (0.055, 0.045), (0.05, 0.04), (0.042, 0.032), (0.03, 0.022), (0.006, 0.006)]
    bm = bmesh.new()
    tube(bm, path, radii, 7, (1, 0, 0))
    # The tie: a steel ring.
    tube(bm, [(0, 0.06, HEAD_Z + 0.075), (0, 0.085, HEAD_Z + 0.115)], [(0.034, 0.034), (0.034, 0.034)], 8, (1, 0, 0))

    def mat(c):
        return 'Metal' if (c - Vector((0, 0.072, HEAD_Z + 0.095))).length < 0.04 and c.z < HEAD_Z + 0.12 else 'Hair'

    B.part('ponytail', bm, mat, lambda p: blend({'head': 1}, {'spine': 1}, smooth(HEAD_Z - 0.02, HEAD_Z - 0.2, p.z) * 0.7))

# ---------------------------------------------------------------- assemble


build_torso()
build_collar()
build_belts()
build_bandolier()
build_shoulder_guard()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
