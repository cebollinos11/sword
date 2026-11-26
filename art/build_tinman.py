"""
Builds the TinMan Fighter model in Blender: a hulking knight in full plate,
all flat-shaded, chamfered blocks. A tall bucket helm with a ridged face and
a recessed eye slit, a ridged cuirass with a stepped plackart, huge layered
pauldrons, couters, vambraces with flared gauntlet cuffs, big square tassets
over mail, cuisses, knee cops, greaves and segmented sabatons, brown leather
belt and straps, and a tattered cloth hanging front and back (the Team colour).
Shared helpers are in art/body_common.py.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_tinman.py").read(), {"__file__": r"C:/Repos/sword/art/build_tinman.py"})
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

NAME = 'TinMan'
SAVE = globals().get('SAVE', True)  # write art/tinman.blend and public/models/tinman.glb
OUT_BLEND = os.path.join(REPO, 'art', 'tinman.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'tinman.glb')

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Metal': (0x8e9194, 0.8, 0.45, False),    # the plate
    'Trim': (0x676b6e, 0.8, 0.5, False),      # darker steel: lames, steps, rims
    'Mail': (0x4c4f52, 0.6, 0.7, False),      # chainmail under the plate
    'Leather': (0x5a3a22, 0.0, 0.75, False),  # belt and straps
    'Skirt': (0x6b4a33, 0.0, 0.9, True),      # the tattered cloth: the Team colour
    'Dark': (0x121314, 0.0, 0.6, False),      # the eye slit
}
B = Body(NAME, MATERIALS, flat=tuple(MATERIALS))

# ---------------------------------------------------------------- lofting

# A chamfered box with a ridge down the front (-y), counter-clockwise from above (+x, back +y, -x, front -y).
RIDGED = [(1.0, 0.0), (0.93, 0.55), (0.6, 0.95), (0.0, 1.0), (-0.6, 0.95), (-0.93, 0.55),
          (-1.0, 0.0), (-0.96, -0.45), (-0.55, -0.8), (0.0, -1.0), (0.55, -0.8), (0.96, -0.45)]


def ring(profile, centre, hw, hd, inset=None):
    """`profile` scaled to (hw, hd) about `centre` at its z; `inset(px, py)` can scale a point (e.g. to recess it)."""
    cx, cy, z = centre
    out = []
    for px, py in profile:
        k = inset(px, py) if inset else 1.0
        out.append((cx + px * hw * k, cy + py * hd * k, z))
    return out


def loft(bm, rings, cap0=True, cap1=True):
    """Faces between rings (each counter-clockwise seen from where the loft runs to): outward-facing."""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(vs[0])
    for a, b in zip(vs, vs[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if cap0:
        bm.faces.new(list(reversed(vs[0])))
    if cap1:
        bm.faces.new(vs[-1])
    return vs


def octa(bm, centres, radii, ref, cap0=True, cap1=True):
    """An octagonal tube, flat faces toward `ref` and across it: the blocky limb section."""
    return tube(bm, centres, radii, 8, ref, phase=math.pi / 8, cap0=cap0, cap1=cap1)

# ---------------------------------------------------------------- torso

TORSO = [  # (z, half width, half depth): a barrel of plate, mail below the belt and at the neck
    (0.90, 0.12, 0.09),
    (0.98, 0.16, 0.115),
    (1.05, 0.2, 0.14),
    (1.145, 0.21, 0.148),
    (1.15, 0.222, 0.158),  # a lame's lip
    (1.155, 0.215, 0.152),
    (1.195, 0.222, 0.158),
    (1.20, 0.234, 0.168),  # the plackart's lip
    (1.21, 0.226, 0.162),
    (1.30, 0.245, 0.172),
    (1.40, 0.252, 0.172),
    (1.47, 0.246, 0.16),
    (1.53, 0.215, 0.135),
    (1.57, 0.13, 0.1),
    (1.61, 0.085, 0.08),
    (1.66, 0.07, 0.07),
]


def torso_mat(c):
    if c.z < 1.06 or c.z > 1.565:
        return 'Mail'
    return 'Trim' if 1.19 < c.z < 1.215 or 1.145 < c.z < 1.16 else 'Metal'


def torso_weights(p):
    side = 'L' if p.x >= 0 else 'R'
    x = abs(p.x)
    w = trunk_weights(p)
    w = blend(w, {f'upperArm_{side}': 1}, smooth(0.15, 0.22, x) * smooth(1.38, 1.48, p.z) * 0.5)
    w = blend(w, {f'thigh_{side}': 1}, min(1, x / 0.1) * smooth(0.98, 0.88, p.z) * 0.4)
    return w


def build_torso():
    bm = bmesh.new()
    loft(bm, [ring(RIDGED, (0, 0, z), hw, hd) for z, hw, hd in TORSO])
    B.part('torso', bm, torso_mat, torso_weights)

# ---------------------------------------------------------------- belt, faulds, tassets, cloth


def build_belt():
    bm = bmesh.new()
    loft(bm, [ring(RIDGED, (0, 0, z), hw, hd) for z, hw, hd in
              ((1.035, 0.208, 0.15), (1.06, 0.214, 0.156), (1.10, 0.214, 0.156), (1.125, 0.21, 0.152))],
         cap0=False, cap1=False)
    B.part('belt', bm, const('Leather'), trunk_weights)
    bm = bmesh.new()
    box(bm, (0, -0.16, 1.08), (0.032, 0.008, 0.03))
    B.part('buckle', bm, const('Trim'), trunk_weights)


def thigh_hang(p, top=1.06, bottom=0.86, amount=0.95):
    """A plate hanging off the left hip: the hips at the belt, the left thigh below it (no mixing with the right)."""
    return blend(trunk_weights(p), {'thigh_L': 1}, smooth(top, bottom, p.z) * amount)


def build_tassets(mirror):
    """Two stepped square lames on the front and side of the thigh, from the belt to mid-thigh."""
    lx = HIP_X + 0.012
    bm = bmesh.new()
    for z0, z1, r in ((1.06, 0.91, 0.14), (0.925, 0.77, 0.148)):
        rows = []
        for z in (z0, z1):
            row = []
            for a in (-145, -112, -80, -45, -5):  # around the thigh, front-inside to the outer side
                t = math.radians(a)
                row.append(bm.verts.new((lx + r * math.cos(t) * 1.05, r * math.sin(t), z)))
            rows.append(row)
        faces = [bm.faces.new((rows[0][k + 1], rows[0][k], rows[1][k], rows[1][k + 1])) for k in range(4)]
        bmesh.ops.solidify(bm, geom=faces, thickness=0.012)
    B.part('tasset_R' if mirror else 'tasset_L', bm, lambda c: 'Trim' if c.z < 0.925 else 'Metal', thigh_hang, mirror)


def cloth_weights(p):
    back = smooth(-0.04, 0.04, p.y)
    return drape_weights(p, top=1.06 - 0.06 * back, bottom=0.88 - 0.08 * back, shins=0.0, amount=0.95)


HEM = [0.03, -0.05, 0.0, 0.06, -0.03, 0.02, -0.06]  # a torn edge, per column


def build_cloth():
    """Tattered cloth panels hanging from under the belt, front to the knee and a longer one behind."""
    bm = bmesh.new()
    for side, w, hem, y0 in ((-1, 0.13, 0.54, 0.152), (1, 0.16, 0.50, 0.155)):
        cols = len(HEM)
        zs = [1.09, 1.01, 0.92, 0.82, 0.72, 0.62]
        grid = []
        for r, z in enumerate(zs + [hem]):
            row = []
            for k in range(cols):
                x = -w + 2 * w * k / (cols - 1)
                y = y0 + 0.03 * smooth(1.08, 0.98, z) - 0.012 * (x / w) ** 2
                zz = z + (HEM[k] if r == len(zs) else 0.0) * (1 if side < 0 else -1)
                row.append(bm.verts.new((x, side * y, zz)))
            grid.append(row)
        for r in range(len(grid) - 1):
            for k in range(cols - 1):
                quad = (grid[r][k], grid[r + 1][k], grid[r + 1][k + 1], grid[r][k + 1])
                bm.faces.new(quad if side < 0 else tuple(reversed(quad)))
    B.part('cloth', bm, const('Skirt'), cloth_weights)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth): mail at the top, a cuisse, the knee, a heavy greave
    (1.00, 0.08, 0.085),
    (0.90, 0.088, 0.092),
    (0.88, 0.1, 0.104),
    (0.70, 0.096, 0.1),
    (0.60, 0.08, 0.086),
    (0.52, 0.074, 0.08),
    (0.47, 0.096, 0.1),
    (0.45, 0.1, 0.106),
    (0.33, 0.106, 0.112),
    (0.20, 0.094, 0.1),
    (0.10, 0.086, 0.092),
]


def leg_mat(c):
    if c.z > 0.89:
        return 'Mail'
    if 0.445 < c.z < 0.475:
        return 'Trim'
    return 'Metal'


def build_leg(mirror):
    lx = HIP_X + 0.012
    bm = bmesh.new()
    octa(bm, [(lx, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry in LEG], (0, -1, 0))
    B.part('leg_R' if mirror else 'leg_L', bm, leg_mat, leg_weights, mirror)

    # A faceted knee cop with a fan on the outside, and leather straps round cuisse and greave.
    bm = bmesh.new()
    sphere(bm, 6, 4, (lx, -0.065, KNEE_Z + 0.01), (0.1, 0.065, 0.09))
    sphere(bm, 4, 3, (lx + 0.095, -0.02, KNEE_Z + 0.01), (0.024, 0.055, 0.065))
    B.part('knee_R' if mirror else 'knee_L', bm, lambda c: 'Trim' if c.x > lx + 0.07 else 'Metal',
           lambda p: {'thigh_L': 0.45, 'shin_L': 0.55}, mirror)
    bm = bmesh.new()
    octa(bm, [(lx, 0, 0.76), (lx, 0, 0.73)], [(0.102, 0.106)] * 2, (0, -1, 0), cap0=False, cap1=False)
    octa(bm, [(lx, 0, 0.27), (lx, 0, 0.24)], [(0.106, 0.112)] * 2, (0, -1, 0), cap0=False, cap1=False)
    B.part('leg_straps_R' if mirror else 'leg_straps_L', bm, const('Leather'), leg_weights, mirror)


def build_foot(mirror):
    lx = HIP_X + 0.012
    rings = [  # (y, centre z, half height, half width): a segmented sabaton, each lame stepping down
        (0.08, 0.075, 0.075, 0.088),
        (0.03, 0.088, 0.088, 0.098),
        (-0.03, 0.07, 0.07, 0.1),
        (-0.032, 0.06, 0.06, 0.094),
        (-0.09, 0.053, 0.053, 0.094),
        (-0.092, 0.045, 0.045, 0.088),
        (-0.15, 0.038, 0.038, 0.084),
        (-0.20, 0.03, 0.03, 0.068),
        (-0.225, 0.022, 0.02, 0.045),
    ]
    bm = bmesh.new()
    octa(bm, [(lx, y, z) for y, z, _, _ in rings], [(rz, rx) for _, _, rz, rx in rings], (1, 0, 0))
    B.part('foot_R' if mirror else 'foot_L', bm, lambda c: 'Trim' if c.z < 0.012 else 'Metal', foot_weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height): mail at the shoulder, rerebrace, elbow, vambrace
    (0.12, 1.50, 0.078, 0.08),
    (0.24, 1.505, 0.08, 0.08),
    (0.27, 1.508, 0.08, 0.08),
    (0.44, 1.512, 0.074, 0.074),
    (0.50, 1.512, 0.062, 0.062),
    (0.54, 1.513, 0.08, 0.078),
    (0.66, 1.515, 0.078, 0.074),
    (0.70, 1.516, 0.055, 0.05),
]


def arm_mat(c):
    return 'Mail' if c.x < 0.26 else 'Metal'


def build_arm(mirror):
    bm = bmesh.new()
    octa(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], (0, -1, 0))
    B.part('arm_R' if mirror else 'arm_L', bm, arm_mat, limb_arm_weights, mirror)

    # Leather straps round the rerebrace and vambrace.
    bm = bmesh.new()
    octa(bm, [(0.36, 0, 1.51), (0.39, 0, 1.51)], [(0.081, 0.081)] * 2, (0, -1, 0), cap0=False, cap1=False)
    octa(bm, [(0.58, 0, 1.514), (0.61, 0, 1.514)], [(0.082, 0.084)] * 2, (0, -1, 0), cap0=False, cap1=False)
    B.part('arm_straps_R' if mirror else 'arm_straps_L', bm, const('Leather'), limb_arm_weights, mirror)

    # A couter over the elbow (which points back, +y, in the rest pose).
    bm = bmesh.new()
    sphere(bm, 6, 4, (ELBOW_X, 0.02, CHEST_Z - 0.005), (0.066, 0.085, 0.085))
    B.part('couter_R' if mirror else 'couter_L', bm, const('Trim'),
           lambda p: {'upperArm_L': 0.5, 'forearm_L': 0.5}, mirror)

    # A flared gauntlet cuff over the wrist.
    bm = bmesh.new()
    octa(bm, [(0.685, 0, 1.516), (0.74, 0, 1.516)], [(0.075, 0.082), (0.064, 0.07)], (0, -1, 0), cap0=False)
    B.part('cuff_R' if mirror else 'cuff_L', bm, const('Metal'), hand_weights, mirror)

    # A great pauldron: a faceted dome over the shoulder, then two lames down the upper arm.
    bm = bmesh.new()
    verts = sphere(bm, 6, 5, (0.265, 0, 1.52), (0.17, 0.18, 0.14))
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < 1.43 or v.co.x < 0.11], context='VERTS')

    def pauldron_weights(p):
        return blend({'spine': 1}, {'upperArm_L': 1}, 0.35 + 0.6 * smooth(0.14, 0.32, p.x))

    B.part('pauldron_R' if mirror else 'pauldron_L', bm, const('Metal'), pauldron_weights, mirror)
    bm = bmesh.new()
    octa(bm, [(0.32, 0, 1.50), (0.37, 0, 1.50)], [(0.135, 0.13), (0.128, 0.124)], (0, 0, 1), cap0=False, cap1=False)
    octa(bm, [(0.365, 0, 1.502), (0.415, 0, 1.504)], [(0.118, 0.114), (0.11, 0.106)], (0, 0, 1), cap0=False, cap1=False)
    B.part('lames_R' if mirror else 'lames_L', bm, const('Trim'), pauldron_weights, mirror)


def build_hand(mirror):
    rings = [(0.735, 1.516, 0.056, 0.04), (0.78, 1.514, 0.06, 0.038), (0.83, 1.51, 0.058, 0.032),
             (0.875, 1.505, 0.052, 0.026), (0.9, 1.50, 0.04, 0.018)]
    bm = bmesh.new()
    octa(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], (0, -1, 0))
    octa(bm, [(0.75, -0.035, 1.512), (0.78, -0.066, 1.506), (0.81, -0.084, 1.50)],
         [(0.017, 0.015), (0.015, 0.013), (0.011, 0.01)], (0, 0, 1))
    B.part('hand_R' if mirror else 'hand_L', bm, const('Metal'), hand_weights, mirror)

# ---------------------------------------------------------------- helm

HELM_PROFILE = [(1.0, 0.0), (0.93, 0.6), (0.55, 0.97), (0.0, 1.0), (-0.55, 0.97), (-0.93, 0.6),
                (-1.0, 0.0), (-0.95, -0.35), (-0.55, -0.68), (0.0, -1.0), (0.55, -0.68), (0.95, -0.35)]


def build_helm():
    """A tall bucket helm, its face ridged down the middle, crossed by a recessed dark eye slit."""
    def recess(px, py):
        return 0.9 if py < -0.3 else 1.0

    c = (0, 0.008, 0)
    rows = [  # (dz, half width, half depth, recessed)
        (-0.15, 0.118, 0.13, False),
        (-0.11, 0.122, 0.135, False),
        (0.0, 0.124, 0.137, False),
        (0.004, 0.124, 0.137, True),
        (0.03, 0.124, 0.137, True),
        (0.034, 0.124, 0.137, False),
        (0.09, 0.12, 0.132, False),
        (0.125, 0.1, 0.11, False),
        (0.14, 0.06, 0.07, False),
    ]
    bm = bmesh.new()
    loft(bm, [ring(HELM_PROFILE, (c[0], c[1], HEAD_Z + dz), hw, hd, recess if r else None) for dz, hw, hd, r in rows],
         cap0=False)

    def mat(f):
        if HEAD_Z + 0.004 < f.z < HEAD_Z + 0.03 and f.y < -0.04:
            return 'Dark'
        if f.z < HEAD_Z - 0.105:
            return 'Trim'
        return 'Metal'

    B.part('helm', bm, mat, rigid('head'))
    # Breaths: two short dark slots low on each cheek of the face.
    bm = bmesh.new()
    for sx in (1, -1):
        for dz in (-0.045, -0.07):
            box(bm, (sx * 0.05, -0.108, HEAD_Z + dz), (0.022, 0.012, 0.004))
    B.part('breaths', bm, const('Dark'), rigid('head'))

# ---------------------------------------------------------------- assemble


build_torso()
build_belt()
build_cloth()
for mirror in (False, True):
    build_tassets(mirror)
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_helm()
result = B.finish(SAVE, OUT_BLEND, OUT_GLB)
