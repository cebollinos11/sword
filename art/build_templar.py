"""
Builds the Templar Fighter model in Blender: a futuristic crusader in a
flat-topped great helm with a cross-shaped face and two glowing cyan lenses,
an olive quilted gambeson, steel pauldrons, vambraces, knee cops, greaves and
sabatons with glowing cyan seams, brown leather tassets, belt and gloves, and
a long white tabard (the Team colour) hanging front and back to the shins.
Shared helpers are in art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_templar.py").read(), {"__file__": r"C:/Repos/sword/art/build_templar.py"})
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

NAME = 'Templar'
SAVE = globals().get('SAVE', True)  # write art/templar.blend and public/models/templar.glb
OUT_BLEND = os.path.join(REPO, 'art', 'templar.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'templar.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Cloth': (0x3d4733, 0.0, 0.9, False),     # olive gambeson
    'Leather': (0x5e3f27, 0.0, 0.75, True),   # tassets, trousers, belt, gloves
    'Skirt': (0xebe9e4, 0.0, 0.85, True),     # the tabard: the Team colour
    'Metal': (0x9ea5aa, 0.85, 0.35, False),
    'Plate': (0x56604c, 0.6, 0.45, False),    # the green-painted pauldrons
    'Trim': (0x5c6368, 0.85, 0.35, False),    # darker steel: the helm's cross
    'Glow': (0x40dcff, 0.0, 0.3, False),
    'Boot': (0x3b2919, 0.0, 0.7, False),
    'Dark': (0x15181b, 0.0, 0.5, False),
}
B = Body(NAME, MATERIALS, flat=('Metal', 'Plate', 'Trim', 'Glow', 'Dark'))

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth): a broad, padded chest
    (0.90, 0.13, 0.08),   # the crotch, slim and well inside the tabard, so a swinging thigh cannot push it through
    (0.97, 0.15, 0.095),
    (1.04, 0.162, 0.108),
    (1.11, 0.154, 0.104),
    (1.19, 0.158, 0.108),
    (1.27, 0.17, 0.114),
    (1.35, 0.18, 0.118),
    (1.43, 0.19, 0.118),
    (1.49, 0.193, 0.108),
    (1.535, 0.175, 0.088),
    (1.565, 0.095, 0.068),
    (1.61, 0.064, 0.06),
    (1.67, 0.058, 0.056),
    (1.70, 0.035, 0.035),
]


def torso_size(z):
    """The torso's (half width, half depth) at height z."""
    for (z0, x0, y0), (z1, x1, y1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    return TORSO[-1][1:] if z > TORSO[-1][0] else TORSO[0][1:]


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.13, 0.18, x) * smooth(1.40, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.4)
    return w


def build_torso():
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in TORSO], [(rx, ry) for _, rx, ry in TORSO], 12, (0, -1, 0))
    B.part('torso', bm, const('Cloth'), torso_weights)

# ---------------------------------------------------------------- tabard, tassets, belt


def cloth_weights(p):
    """The tabard and tassets: the same strong leg weights, so they swing together and neither cuts through the other."""
    # No shin weight: the hem hangs off the knee, and a bending shin would drag it back into the knee cop.
    # Behind, the thigh takes over lower down, so a thigh stepping forward does not drag the back of the
    # cloth in through the seat.
    back = smooth(-0.04, 0.04, p.y)
    return drape_weights(p, top=1.08 - 0.08 * back, bottom=0.9 - 0.1 * back, shins=0.0, amount=0.95)


def build_tabard():
    """Two white panels, front and back, hugging the chest and hanging loose below the belt."""
    rows = [  # (z, half width)
        (1.525, 0.115), (1.47, 0.125), (1.37, 0.13), (1.25, 0.13), (1.14, 0.13), (1.06, 0.135),
        (0.92, 0.14), (0.76, 0.142), (0.58, 0.145), (0.42, 0.145)]
    cols = 5
    bm = bmesh.new()
    # Front, then back: the back stops above the knee, so a calf swinging back on a stride stays out of it.
    for side, hem in ((-1, 0.42), (1, 0.58)):
        grid = []
        for z, w in rows:
            if z < hem - 1e-6:
                continue
            row = []
            for k in range(cols):
                x = -w + 2 * w * k / (cols - 1)
                rx, ry = torso_size(max(z, 1.06))
                hug = (ry + 0.012) * math.sqrt(max(0.0, 1 - (x / (rx + 0.012)) ** 2))
                loose = 0.162 - 0.018 * (x / w) ** 2
                y = hug if z >= 1.06 else hug + (loose - hug) * smooth(1.06, 0.92, z)
                row.append(bm.verts.new((x, side * y, z)))
            grid.append(row)
        for r in range(len(grid) - 1):
            for k in range(cols - 1):
                quad = (grid[r][k], grid[r + 1][k], grid[r + 1][k + 1], grid[r][k + 1])
                bm.faces.new(quad if side < 0 else tuple(reversed(quad)))
    B.part('tabard', bm, const('Skirt'), cloth_weights)


def build_tassets():
    """Brown leather tassets at the hips' sides, to the knees (none under the tabard)."""
    rings = [(1.10, 0.162, 0.112), (0.98, 0.205, 0.124), (0.82, 0.225, 0.13), (0.64, 0.235, 0.134)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 12, (0, -1, 0), cap0=False, cap1=False)
    # Open front and back, under the tabard, so a thigh swinging either way cannot punch it through the tabard.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.calc_center_median().x) < 0.125],
                     context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    B.part('tassets', bm, const('Leather'), cloth_weights)


def build_belt():
    rings = [(1.115, 0.168, 0.125), (1.08, 0.172, 0.129), (1.045, 0.168, 0.125)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 12, (0, -1, 0), cap0=False, cap1=False)
    B.part('belt', bm, const('Leather'), trunk_weights, smooth_shade=False)
    bm = bmesh.new()
    box(bm, (0, -0.131, 1.08), (0.026, 0.006, 0.024))
    B.part('buckle', bm, const('Metal'), trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth): leather trousers, then a steel greave from knee to ankle
    (0.98, 0.09, 0.08),  # slim where the tabard hides it, so a swinging thigh stays under the cloth
    (0.84, 0.094, 0.094),
    (0.72, 0.088, 0.092),
    (0.62, 0.075, 0.082),
    (0.54, 0.07, 0.078),
    (0.47, 0.072, 0.082),
    (0.38, 0.072, 0.084),
    (0.26, 0.064, 0.074),
    (0.16, 0.056, 0.064),
    (0.13, 0.058, 0.066),
    (0.06, 0.05, 0.058),
]


def leg_mat(c):
    if c.z > 0.505:
        return 'Leather'
    if c.z > 0.145:
        return 'Metal'
    return 'Boot'


def build_leg(mirror):
    bm = bmesh.new()
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], 8, (0, -1, 0), phase=math.pi / 8)
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, leg_weights, mirror)

    # A knee cop, and a glowing seam down the front of the greave.
    bm = bmesh.new()
    sphere(bm, 6, 5, (HIP_X, -0.052, KNEE_Z + 0.005), (0.074, 0.046, 0.07))
    B.part('knee_R' if mirror else 'knee_L', bm, const('Metal'), lambda p: {'thigh_L': 0.45, 'shin_L': 0.55}, mirror,
           smooth_shade=False)
    bm = bmesh.new()
    tube(bm, [(HIP_X, -0.083, 0.44), (HIP_X, -0.087, 0.36), (HIP_X, -0.077, 0.22)], [(0.006, 0.004)] * 3, 4, (0, -1, 0))
    B.part('greave_glow_R' if mirror else 'greave_glow_L', bm, const('Glow'), rigid('shin_L'), mirror, smooth_shade=False)


def build_foot(mirror):
    rings = [  # (y, centre z, half height, half width): an armoured boot with a steel toe
        (0.055, 0.058, 0.055, 0.05),
        (0.02, 0.064, 0.064, 0.058),
        (-0.04, 0.05, 0.05, 0.062),
        (-0.10, 0.038, 0.038, 0.06),
        (-0.16, 0.03, 0.03, 0.052),
        (-0.20, 0.026, 0.024, 0.042),
        (-0.215, 0.024, 0.016, 0.026),
    ]

    def mat(c):
        if c.z < 0.016:
            return 'Boot'
        return 'Metal' if c.y < -0.06 else 'Boot'

    bm = bmesh.new()
    tube(bm, [(HIP_X, y, z) for y, z, _, _ in rings], [(rz, rx) for _, _, rz, rx in rings], 6, (1, 0, 0))
    B.part('foot_R' if mirror else 'foot_L', bm, mat, foot_weights, mirror)
    bm = bmesh.new()
    tube(bm, [(HIP_X - 0.056, -0.075, 0.03), (HIP_X, -0.08, 0.078), (HIP_X + 0.056, -0.075, 0.03)], [(0.005, 0.004)] * 3, 4, (0, -1, 0))
    B.part('toe_glow_R' if mirror else 'toe_glow_L', bm, const('Glow'), rigid('foot_L'), mirror, smooth_shade=False)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height): a quilted sleeve to a steel vambrace
    (0.10, 1.49, 0.06, 0.065),
    (0.18, 1.50, 0.066, 0.07),
    (0.26, 1.505, 0.058, 0.06),
    (0.36, 1.508, 0.052, 0.054),
    (0.46, 1.508, 0.05, 0.05),
    (0.52, 1.509, 0.058, 0.056),
    (0.60, 1.511, 0.056, 0.052),
    (0.675, 1.514, 0.048, 0.044),
    (0.69, 1.516, 0.04, 0.036),
    (0.71, 1.518, 0.036, 0.031),
]


def arm_mat(c):
    if c.x < 0.512:
        return 'Cloth'
    if c.x < 0.685:
        return 'Metal'
    return 'Leather'


def build_arm(mirror):
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)

    # A glowing seam along the vambrace's outer face.
    bm = bmesh.new()
    tube(bm, [(0.53, -0.004, 1.567), (0.60, -0.004, 1.565), (0.665, -0.004, 1.559)], [(0.005, 0.003)] * 3, 4, (0, 0, 1))
    B.part('vambrace_glow_R' if mirror else 'vambrace_glow_L', bm, const('Glow'), rigid('forearm_L'), mirror,
           smooth_shade=False)

    # A domed pauldron over the shoulder, its lower rim open.
    bm = bmesh.new()
    verts = sphere(bm, 8, 6, (0.205, 0, 1.52), (0.112, 0.102, 0.088))
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < 1.47], context='VERTS')

    def pauldron_weights(p):
        return blend({'spine': 1}, {'upperArm_L': 1}, 0.35 + 0.55 * smooth(0.12, 0.28, p.x))

    B.part('pauldron_R' if mirror else 'pauldron_L', bm, lambda c: 'Metal' if c.z < 1.50 else 'Plate', pauldron_weights,
           mirror, smooth_shade=False)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.038, 0.032), (0.75, 1.516, 0.048, 0.031), (0.80, 1.514, 0.05, 0.026),
             (0.845, 1.510, 0.048, 0.019), (0.875, 1.505, 0.042, 0.013)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.031, 1.512), (0.765, -0.061, 1.507), (0.795, -0.079, 1.50)],
         [(0.015, 0.013), (0.013, 0.012), (0.01, 0.009)], 4, (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Leather'), hand_weights, mirror)

# ---------------------------------------------------------------- helm


def build_helm():
    """A flat-topped great helm: a flat face crossed by a steel bar and a dark visor slit with two cyan lenses."""
    rings = [(HEAD_Z - 0.125, 0.094, 0.11), (HEAD_Z - 0.02, 0.097, 0.114), (HEAD_Z + 0.085, 0.095, 0.11),
             (HEAD_Z + 0.105, 0.086, 0.1)]
    front = 0.005 - 0.096

    def flat_face(i, p, t):
        p.y = max(p.y, front)
        return p

    bm = bmesh.new()
    tube(bm, [(0, 0.005, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 12, (0, -1, 0),
         phase=math.pi / 2, push=flat_face, cap0=False)
    B.part('helm', bm, const('Metal'), rigid('head'), smooth_shade=False)

    bm = bmesh.new()
    box(bm, (0, front - 0.004, HEAD_Z + 0.015), (0.047, 0.005, 0.014))
    B.part('visor', bm, const('Dark'), rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    box(bm, (0, front - 0.008, HEAD_Z - 0.035), (0.011, 0.008, 0.088))    # the cross's upright
    box(bm, (0, front - 0.006, HEAD_Z + 0.04), (0.047, 0.006, 0.008))    # its arms, above the slit
    B.part('cross', bm, const('Trim'), rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, [(sx * 0.027, front - 0.006, HEAD_Z + 0.015), (sx * 0.027, front - 0.014, HEAD_Z + 0.015)],
             [(0.014, 0.014), (0.012, 0.012)], 6, (0, 0, 1))
    B.part('lenses', bm, const('Glow'), rigid('head'), smooth_shade=False)

# ---------------------------------------------------------------- assemble


build_torso()
build_tabard()
build_tassets()
build_belt()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_helm()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
