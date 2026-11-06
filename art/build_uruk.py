"""
Builds the Uruk Fighter model in Blender: a hulking Isengard-style heavy
warrior with grey-olive skin, a broad black plate cuirass of stacked lames,
big spiked pauldrons, bare thick arms with black bracers, a crude iron cap
with a nasal bar and cheek guards, small tusks, a heavy belt, a ragged
loincloth front and back (the Team colour), and chunky greaved legs and
boots. Shared helpers are in art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_uruk.py").read(), {"__file__": r"C:/Repos/sword/art/build_uruk.py"})
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

NAME = 'Uruk'
SAVE = globals().get('SAVE', True)  # write art/uruk.blend and public/models/uruk.glb
OUT_BLEND = os.path.join(REPO, 'art', 'uruk.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'uruk.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Skin': (0x686a4c, 0.0, 0.7, False),      # grey-olive hide
    'Cloth': (0x2b2520, 0.0, 0.9, False),     # the padded jerkin under the plate
    'Leather': (0x3a2a1c, 0.0, 0.8, True),    # trousers, belt
    'Skirt': (0x8a8a84, 0.0, 0.9, True),      # the ragged loincloth: the Team colour
    'Plate': (0x1d1e22, 0.7, 0.5, True),      # black iron
    'Trim': (0x45484e, 0.8, 0.4, False),      # worn lighter iron: rims, bars, buckle
    'Bone': (0xd6cdb0, 0.0, 0.7, False),      # tusks
    'Eyes': (0xc2321a, 0.0, 0.3, False),      # red eyes and mouth line
    'Hair': (0x15120f, 0.0, 0.7, True),       # heavy brows
}
B = Body(NAME, MATERIALS, flat=('Plate', 'Trim', 'Bone'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth): a huge barrel chest
    (0.90, 0.135, 0.085),
    (0.97, 0.16, 0.10),
    (1.04, 0.175, 0.112),
    (1.11, 0.17, 0.11),
    (1.19, 0.17, 0.112),
    (1.27, 0.185, 0.12),
    (1.35, 0.20, 0.125),
    (1.43, 0.212, 0.126),
    (1.49, 0.215, 0.115),
    (1.535, 0.195, 0.095),
    (1.565, 0.11, 0.075),
    (1.61, 0.068, 0.062),
    (1.67, 0.062, 0.058),
    (1.70, 0.045, 0.045),
]


def torso_size(z):
    for (z0, x0, y0), (z1, x1, y1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    return TORSO[-1][1:] if z > TORSO[-1][0] else TORSO[0][1:]


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.14, 0.2, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.4)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 12, (0, -1, 0))
    B.part('torso', bm, lambda c: 'Skin' if c.z > 1.575 else 'Cloth', torso_weights)


def build_cuirass():
    """Stacked black lames from the waist to a gorget, each a little proud of the one below."""
    bm = bmesh.new()
    zs = [1.19 + 0.04 * i for i in range(10)] + [1.555]
    radii = []
    for i, z in enumerate(zs):
        rx, ry = torso_size(z)
        k = 1.075 + 0.03 * (i % 2)
        radii.append((rx * k + 0.006, ry * k + 0.008))
    tube(bm, [(0, 0, z) for z in zs], radii, 12, (0, -1, 0))
    B.part('cuirass', bm, const('Plate'), torso_weights, smooth_shade=False)
    # A pale iron plate across the chest's centre.
    bm = bmesh.new()
    box(bm, (0, -0.158, 1.38), (0.05, 0.012, 0.07))
    B.part('chestplate', bm, const('Trim'), trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- loincloth, belt


def cloth_weights(p):
    back = smooth(-0.04, 0.04, p.y)
    return drape_weights(p, top=1.08 - 0.08 * back, bottom=0.9 - 0.1 * back, shins=0.0, amount=0.95)


def build_loincloth():
    rows = [(1.11, 0.15), (0.98, 0.17), (0.82, 0.18), (0.66, 0.185), (0.52, 0.185)]
    cols = 7
    bm = bmesh.new()
    for side, hem in ((-1, 0.52), (1, 0.64)):
        grid = []
        for z, w in rows:
            if z < hem - 1e-6:
                continue
            row = []
            for k in range(cols):
                x = -w + 2 * w * k / (cols - 1)
                y = 0.17 - 0.02 * (x / w) ** 2
                # ragged hem: alternate columns hang lower
                zz = z - (0.05 if (k % 2) and z == hem else 0.0)
                row.append(bm.verts.new((x, side * y, zz)))
            grid.append(row)
        for r in range(len(grid) - 1):
            for k in range(cols - 1):
                quad = (grid[r][k], grid[r + 1][k], grid[r + 1][k + 1], grid[r][k + 1])
                bm.faces.new(quad if side < 0 else tuple(reversed(quad)))
    B.part('loincloth', bm, const('Skirt'), cloth_weights)


def build_belt():
    rings = [(1.145, 0.178, 0.133), (1.095, 0.184, 0.139), (1.045, 0.18, 0.135)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 12, (0, -1, 0), cap0=False, cap1=False)
    B.part('belt', bm, const('Leather'), trunk_weights, smooth_shade=False)
    bm = bmesh.new()
    box(bm, (0, -0.145, 1.095), (0.04, 0.008, 0.032))
    B.part('buckle', bm, const('Trim'), trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth): fat trousers, then a black greave from knee to ankle
    (0.98, 0.10, 0.088),
    (0.84, 0.107, 0.104),
    (0.72, 0.1, 0.1),
    (0.62, 0.085, 0.09),
    (0.54, 0.08, 0.086),
    (0.47, 0.083, 0.09),
    (0.38, 0.083, 0.092),
    (0.26, 0.074, 0.082),
    (0.16, 0.064, 0.072),
    (0.13, 0.066, 0.074),
    (0.06, 0.056, 0.064),
]


def leg_mat(c):
    if c.z > 0.505:
        return 'Leather'
    if c.z > 0.145:
        return 'Plate'
    return 'Cloth'


def build_leg(mirror):
    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], 8, (0, -1, 0), phase=math.pi / 8)
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, leg_weights, mirror)

    bm = bmesh.new()
    sphere(bm, 6, 5, (HIP_X, -0.058, KNEE_Z + 0.005), (0.085, 0.05, 0.078))
    tube(bm, [(HIP_X, -0.095, KNEE_Z + 0.005), (HIP_X, -0.14, KNEE_Z + 0.01)], [(0.02, 0.02), (0.002, 0.002)], 5, (0, 0, 1))
    B.part('knee_R' if mirror else 'knee_L', bm, const('Trim'), lambda p: {'thigh_L': 0.45, 'shin_L': 0.55}, mirror,
           smooth_shade=False)


def build_foot(mirror):
    rings = [  # (y, centre z, half height, half width): a chunky iron-toed boot
        (0.06, 0.06, 0.058, 0.056),
        (0.02, 0.068, 0.068, 0.066),
        (-0.04, 0.054, 0.054, 0.07),
        (-0.10, 0.042, 0.042, 0.068),
        (-0.16, 0.034, 0.034, 0.06),
        (-0.205, 0.03, 0.028, 0.048),
        (-0.222, 0.027, 0.018, 0.03),
    ]

    def mat(c):
        return 'Plate' if c.y < -0.07 else 'Cloth'

    bm = bmesh.new()
    tube(bm, [(HIP_X, y, z) for y, z, _, _ in rings], [(rz, rx) for _, _, rz, rx in rings], 6, (1, 0, 0))
    B.part('foot_R' if mirror else 'foot_L', bm, mat, foot_weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height): thick bare arm to a black bracer
    (0.10, 1.49, 0.07, 0.075),
    (0.18, 1.50, 0.078, 0.082),
    (0.26, 1.505, 0.07, 0.072),
    (0.36, 1.508, 0.063, 0.065),
    (0.46, 1.508, 0.06, 0.06),
    (0.52, 1.509, 0.068, 0.066),
    (0.60, 1.511, 0.066, 0.062),
    (0.675, 1.514, 0.056, 0.052),
    (0.69, 1.516, 0.046, 0.042),
    (0.71, 1.518, 0.042, 0.036),
]


def arm_mat(c):
    if c.x < 0.512:
        return 'Skin'
    if c.x < 0.685:
        return 'Plate'
    return 'Leather'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)

    # A big domed pauldron with a spike, its lower rim open.
    bm = bmesh.new()
    verts = sphere(bm, 8, 6, (0.225, 0, 1.55), (0.135, 0.12, 0.1))
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < 1.5], context='VERTS')
    tube(bm, [(0.235, 0, 1.64), (0.255, 0, 1.76)], [(0.032, 0.032), (0.002, 0.002)], 5, (0, -1, 0))

    def pauldron_weights(p):
        return blend({'spine': 1}, {'upperArm_L': 1}, 0.35 + 0.55 * smooth(0.12, 0.28, p.x))

    B.part('pauldron_R' if mirror else 'pauldron_L', bm, lambda c: 'Plate' if c.z < 1.7 else 'Trim', pauldron_weights,
           mirror, smooth_shade=False)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.044, 0.038), (0.75, 1.516, 0.056, 0.036), (0.80, 1.514, 0.058, 0.03),
             (0.845, 1.510, 0.054, 0.022), (0.88, 1.505, 0.047, 0.015)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.036, 1.512), (0.765, -0.068, 1.507), (0.795, -0.088, 1.50)],
         [(0.017, 0.015), (0.015, 0.014), (0.012, 0.011)], 4, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Skin'), hand_weights, mirror)

# ---------------------------------------------------------------- head

HEAD_SIZE = (0.084, 0.1, 0.118)


def build_head():
    bm = bmesh.new()
    B.part('head', bm, head_with_face(bm, size=HEAD_SIZE, nose=0.012), rigid('head'))
    face_features(B, size=HEAD_SIZE, brow='Hair', brow_tilt=-0.007, mouth_width=0.024)

    # Tusks rising from the lower jaw.
    bm = bmesh.new()
    y = face_y(0, -0.066, HEAD_SIZE)
    for sx in (1, -1):
        tube(bm, [(sx * 0.03, y + 0.002, HEAD_Z - 0.066), (sx * 0.033, y - 0.006, HEAD_Z - 0.036)],
             [(0.008, 0.008), (0.001, 0.001)], 4, (0, -1, 0))
    B.part('tusks', bm, const('Bone'), rigid('head'), smooth_shade=False)

    # A crude iron cap: a dome above the brow, a rim, a nasal bar, cheek guards and a neck guard.
    bm = bmesh.new()
    verts = sphere(bm, 12, 7, (0, 0.005, HEAD_Z + 0.005), (0.088, 0.106, 0.124))
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < HEAD_Z + 0.045], context='VERTS')
    B.part('cap', bm, const('Plate'), rigid('head'), smooth_shade=False)

    bm = bmesh.new()
    tube(bm, [(0, 0.005, HEAD_Z + 0.05), (0, 0.005, HEAD_Z + 0.04)], [(0.085, 0.102), (0.085, 0.102)], 12, (0, -1, 0),
         cap0=False, cap1=False)
    box(bm, (0, face_y(0, 0.0, HEAD_SIZE) - 0.024, HEAD_Z + 0.0), (0.008, 0.005, 0.052))
    for sx in (1, -1):
        box(bm, (sx * 0.086, 0.0, HEAD_Z - 0.03), (0.005, 0.05, 0.04))
    B.part('cap_trim', bm, const('Trim'), rigid('head'), smooth_shade=False)

    # A horn out of each side of the cap, sweeping out and up, on a dark iron collar.
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.072, 0.005, HEAD_Z + 0.04), (sx * 0.125, 0.005, HEAD_Z + 0.048), (sx * 0.175, 0.005, HEAD_Z + 0.08),
                  (sx * 0.2, 0.005, HEAD_Z + 0.14), (sx * 0.205, 0.005, HEAD_Z + 0.2)],
             [(0.02, 0.02), (0.018, 0.018), (0.014, 0.014), (0.009, 0.009), (0.001, 0.001)], 6, (0, -1, 0))
    B.part('horns', bm, const('Bone'), rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.07, 0.005, HEAD_Z + 0.04), (sx * 0.097, 0.005, HEAD_Z + 0.042)], [(0.03, 0.03), (0.03, 0.03)], 8, (0, -1, 0))
    B.part('horn_collars', bm, const('Trim'), rigid('head'), smooth_shade=False)

    bm = bmesh.new()
    zs = [HEAD_Z + 0.05, HEAD_Z - 0.01, HEAD_Z - 0.07]
    rings = [(0.1, 0.116), (0.098, 0.114), (0.086, 0.102)]
    tube(bm, [(0, 0.01, z) for z in zs], rings, 12, (0, -1, 0), cap0=False, cap1=False)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < 0.0], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    B.part('neck_guard', bm, const('Plate'), rigid('head'), smooth_shade=False)

# ---------------------------------------------------------------- assemble


build_torso()
build_cuirass()
build_loincloth()
build_belt()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
