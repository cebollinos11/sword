"""
Builds the female Fighter model in Blender: a low-poly skinned mesh fitted to
the game's Skeleton (data/skeleton.json), plus an armature whose bones run
between the Skeleton's joints (src/sim/skeleton.ts).

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_female.py").read(), {"__file__": r"C:/Repos/sword/art/build_female.py"})

Rest pose: legs straight down, arms straight out (T-pose), facing -Y with the
character's left on +X (glTF export turns this into +z forward, y up, which is
the game's facing 0). Body shapes are authored in metres for the current
skeleton.json; the script stops if the Skeleton has changed.
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(REPO, 'data', 'skeleton.json')))
AUTHORED_FOR = {'hipWidth': 0.2, 'thigh': 0.48, 'shin': 0.48, 'ankleHeight': 0.06, 'spine': 0.5,
                'shoulderWidth': 0.4, 'neck': 0.1, 'headRadius': 0.11, 'upperArm': 0.3, 'forearm': 0.28}
for k, v in AUTHORED_FOR.items():
    assert abs(S[k] - v) < 1e-6, f'skeleton.json {k} changed ({S[k]} != {v}): re-author the body shapes'

ANKLE_Z = S['ankleHeight']
KNEE_Z = ANKLE_Z + S['shin']
HIP_Z = KNEE_Z + S['thigh']
CHEST_Z = HIP_Z + S['spine']
HEAD_Z = CHEST_Z + S['neck'] + S['headRadius']
HIP_X = S['hipWidth'] / 2
SHOULDER_X = S['shoulderWidth'] / 2
ELBOW_X = SHOULDER_X + S['upperArm']
HAND_X = ELBOW_X + S['forearm']
TOE_LENGTH = 0.14  # TOE_LENGTH in src/sim/skeleton.ts

NAME = 'Female'
SAVE = globals().get('SAVE', True)  # write art/female.blend and public/models/female.glb
OUT_BLEND = os.path.join(REPO, 'art', 'female.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'female.glb')

# ---------------------------------------------------------------- materials

def srgb(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), 1.0)

# name: (sRGB colour, metallic, roughness, double-sided)
MATERIALS = {
    'Skin': (0xc48c6a, 0.0, 0.6, False),
    'Top': (0x231e24, 0.0, 0.8, False),
    'Skirt': (0xa3201f, 0.0, 0.8, True),  # candidate Team colour
    'Belt': (0x5a4030, 0.0, 0.7, False),
    'Buckle': (0x7d7770, 0.7, 0.4, False),
    'Armour': (0xc9738f, 0.6, 0.35, False),
    'Black': (0x1d1819, 0.0, 0.8, False),
    'Hair': (0x9f84cc, 0.0, 0.7, True),
    'Eyes': (0x2b1a14, 0.0, 0.3, False),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}


def make_materials():
    mats = []
    for name, (colour, metal, rough, double) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = srgb(colour)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        m.diffuse_color = srgb(colour)
        m.use_backface_culling = not double
        mats.append(m)
    return mats

# ---------------------------------------------------------------- bones

def bone_table():
    b = {
        'hips': ((0, 0, HIP_Z), (0, 0, HIP_Z - 0.12), None),
        'spine': ((0, 0, HIP_Z), (0, 0, CHEST_Z), 'hips'),
        'head': ((0, 0, CHEST_Z), (0, 0, HEAD_Z), 'spine'),
    }
    for s, sx in (('L', 1), ('R', -1)):
        b[f'upperArm_{s}'] = ((sx * SHOULDER_X, 0, CHEST_Z), (sx * ELBOW_X, 0, CHEST_Z), 'spine')
        b[f'forearm_{s}'] = ((sx * ELBOW_X, 0, CHEST_Z), (sx * HAND_X, 0, CHEST_Z), f'upperArm_{s}')
        b[f'hand_{s}'] = ((sx * HAND_X, 0, CHEST_Z), (sx * (HAND_X + 0.1), 0, CHEST_Z), f'forearm_{s}')
        b[f'thigh_{s}'] = ((sx * HIP_X, 0, HIP_Z), (sx * HIP_X, 0, KNEE_Z), 'hips')
        b[f'shin_{s}'] = ((sx * HIP_X, 0, KNEE_Z), (sx * HIP_X, 0, ANKLE_Z), f'thigh_{s}')
        b[f'foot_{s}'] = ((sx * HIP_X, 0, ANKLE_Z), (sx * HIP_X, -TOE_LENGTH, 0), f'shin_{s}')
    return b


BONES = bone_table()

# ---------------------------------------------------------------- helpers

def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def seg_dist(p, a, b):
    a, b = Vector(a), Vector(b)
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def by_distance(p, names):
    ws = {n: 1 / max(seg_dist(p, *BONES[n][:2]), 1e-4) ** 8 for n in names}
    total = sum(ws.values())
    return {n: w / total for n, w in ws.items()}


def blend(base, extra, amount):
    """`base` weights scaled by (1 - amount), plus `extra` weights scaled by amount."""
    out = {n: w * (1 - amount) for n, w in base.items()}
    for n, w in extra.items():
        out[n] = out.get(n, 0) + w * amount
    return out


def tube(bm, centers, radii, n, ref, phase=0.0, push=None, cap0=True, cap1=True):
    """A loft of elliptical rings (radii: (across, toward `ref`)) along `centers`; faces point outward."""
    rings = []
    for i, c in enumerate(centers):
        c = Vector(c)
        a = (Vector(centers[min(i + 1, len(centers) - 1)]) - Vector(centers[max(i - 1, 0)])).normalized()
        v = Vector(ref) - a * a.dot(Vector(ref))
        v.normalize()
        u = v.cross(a)
        ru, rv = radii[i]
        ring = []
        for k in range(n):
            t = phase + 2 * math.pi * k / n
            p = c + u * (ru * math.cos(t)) + v * (rv * math.sin(t))
            if push:
                p = push(i, p, t)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(n):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]))
    if cap0:
        bm.faces.new(list(reversed(rings[0])))
    if cap1:
        bm.faces.new(rings[-1])
    return rings


def sphere(bm, u, v, centre, radii, shape=None):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    verts = geom['verts']
    for vert in verts:
        co = shape(vert.co.copy()) if shape else vert.co.copy()
        vert.co = Vector((co.x * radii[0], co.y * radii[1], co.z * radii[2])) + Vector(centre)
    return verts


PARTS = []


def part(name, bm, material_of, weights_of, mirror=False, smooth_shade=True):
    """Make an object from `bm` (authored on the left, +X); `mirror` makes the right-side copy instead."""
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    face_mats = [MAT_INDEX[material_of(f.calc_center_median())] for f in bm.faces]
    weights = [weights_of(v.co.copy()) for v in bm.verts]
    if mirror:
        for v in bm.verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        swap = {'_L': '_R', '_R': '_L'}
        weights = [{(n[:-2] + swap[n[-2:]] if n[-2:] in swap else n): w for n, w in ws.items()} for ws in weights]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
        me.materials.append(m)
    for poly, mi in zip(me.polygons, face_mats):
        poly.material_index = mi
        poly.use_smooth = smooth_shade and material_of_name(mi) not in ('Armour', 'Buckle', 'Belt')
    obj = bpy.data.objects.new(name, me)
    COLLECTION.objects.link(obj)
    groups = {}
    for vi, ws in enumerate(weights):
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:3]
        total = sum(w for _, w in top) or 1
        for n, w in top:
            if w / total < 0.01:
                continue
            g = groups.get(n) or obj.vertex_groups.new(name=n)
            groups[n] = g
            g.add([vi], w / total, 'REPLACE')
    PARTS.append(obj)
    return obj


def material_of_name(i):
    return list(MATERIALS)[i]


def const(mat):
    return lambda c: mat


def rigid(bone):
    return lambda p: {bone: 1.0}

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
    if z < 1.42:
        return 'Skin' if (x > 0.14 and z > 1.38) else 'Top'
    if c.y > 0 and z < 1.49 and x < 0.14:
        return 'Top'
    if z < 1.53 and 0.05 < x < 0.10:
        return 'Top'
    return 'Skin'


def trunk_weights(p):
    """The torso's own weights: hips below the waist, spine above, head at the neck."""
    head = smooth(1.56, 1.64, p.z)
    spine = smooth(1.00, 1.25, p.z)
    return {'hips': 1 - spine, 'spine': spine * (1 - head), 'head': spine * head}


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
    part('torso', bm, torso_mat, torso_weights)

# ---------------------------------------------------------------- skirt, belt

def build_skirt():
    rings = [(1.13, 0.146, 0.100, 0.005), (1.04, 0.188, 0.142, 0.012), (0.92, 0.228, 0.188, 0.015), (0.79, 0.258, 0.212, 0.015)]
    pleat = [0.0, 0.02, 0.05, 0.07]

    def push(i, p, t):
        k = round((t - 0) / (2 * math.pi / 24))
        if k % 2:
            c = Vector((0, rings[i][3], p.z))
            p = c + (p - c) * (1 - pleat[i])
        return p

    bm = bmesh.new()
    tube(bm, [(0, y, z) for z, _, _, y in rings], [(rx, ry) for _, rx, ry, _ in rings], 24, (0, -1, 0), push=push, cap0=False, cap1=False)

    def weights(p):
        w = {'hips': 1.0}
        w = blend(w, {'spine': 1}, smooth(1.00, 1.25, p.z))
        drape = smooth(1.05, 0.80, p.z) * 0.85
        w = blend(w, {'thigh_L': 1}, drape * max(0, min(1, (p.x + 0.03) / 0.15)))
        w = blend(w, {'thigh_R': 1}, drape * max(0, min(1, (-p.x + 0.03) / 0.15)))
        return w

    part('skirt', bm, const('Skirt'), weights, smooth_shade=False)


def build_belt():
    rings = [(1.25, 0.140, 0.097), (1.245, 0.150, 0.107), (1.105, 0.153, 0.109), (1.10, 0.146, 0.103)]
    bm = bmesh.new()
    tube(bm, [(0, 0, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], 20, (0, -1, 0), cap0=False, cap1=False)
    part('belt', bm, const('Belt'), trunk_weights, smooth_shade=False)
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for v in geom['verts']:
        v.co = Vector((v.co.x * 0.085, v.co.y * 0.012 - 0.113, v.co.z * 0.10 + 1.175))
    part('buckle', bm, const('Buckle'), trunk_weights, smooth_shade=False)

# ---------------------------------------------------------------- legs, feet

LEG = [  # (z, half width, half depth, shin-plate ridge)
    (0.97, 0.095, 0.098, 0),
    (0.86, 0.088, 0.092, 0),
    (0.74, 0.074, 0.078, 0),
    (0.66, 0.063, 0.066, 0),
    (0.62, 0.064, 0.067, 0),
    (0.585, 0.076, 0.082, 0.04),
    (0.52, 0.070, 0.076, 0.03),
    (0.46, 0.068, 0.074, 0.012),
    (0.38, 0.076, 0.084, 0.02),
    (0.28, 0.070, 0.078, 0.02),
    (0.19, 0.062, 0.068, 0.015),
    (0.13, 0.068, 0.074, 0.012),
    (0.10, 0.068, 0.074, 0),
    (0.065, 0.06, 0.066, 0),
]


def leg_mat(c):
    if c.z > 0.64:
        return 'Skin'
    if c.z > 0.60:
        return 'Black'
    if c.z > 0.115:
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
    tube(bm, [(HIP_X, 0, z) for z, *_ in LEG], [(rx, ry) for _, rx, ry, _ in LEG], 10, (0, -1, 0), phase=math.pi / 10, push=push)
    part('leg_R' if mirror else 'leg_L', bm, leg_mat, weights, mirror)


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

    part('foot_R' if mirror else 'foot_L', bm, const('Black'), weights, mirror)

# ---------------------------------------------------------------- arms, hands

ARM = [  # (x, z, half depth, half height)
    (0.10, 1.49, 0.045, 0.05),
    (0.17, 1.50, 0.052, 0.058),
    (0.21, 1.507, 0.05, 0.055),
    (0.27, 1.512, 0.047, 0.05),
    (0.36, 1.515, 0.040, 0.043),
    (0.44, 1.517, 0.037, 0.038),
    (0.475, 1.518, 0.045, 0.046),
    (0.52, 1.518, 0.050, 0.050),
    (0.60, 1.518, 0.050, 0.047),
    (0.67, 1.518, 0.043, 0.038),
    (0.715, 1.518, 0.036, 0.030),
]


def arm_mat(c):
    if c.x < 0.46:
        return 'Skin'
    if c.x < 0.50:
        return 'Black'
    return 'Armour'


def build_arm(mirror):
    def weights(p):
        w = by_distance(p, ['upperArm_L', 'forearm_L', 'hand_L'])
        return blend(w, {'spine': 1}, smooth(0.19, 0.13, p.x) * 0.6)

    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in ARM], [(rz, ry) for _, _, ry, rz in ARM], 8, (0, -1, 0))
    part('arm_R' if mirror else 'arm_L', bm, arm_mat, weights, mirror)


def build_hand(mirror):
    rings = [(0.70, 1.518, 0.036, 0.03), (0.75, 1.516, 0.046, 0.029), (0.80, 1.514, 0.048, 0.024),
             (0.845, 1.510, 0.046, 0.018), (0.875, 1.505, 0.04, 0.012)]
    bm = bmesh.new()
    tube(bm, [(x, 0, z) for x, z, _, _ in rings], [(rz, ry) for _, _, ry, rz in rings], 8, (0, -1, 0))
    tube(bm, [(0.735, -0.03, 1.512), (0.765, -0.06, 1.507), (0.795, -0.078, 1.50)], [(0.014, 0.012), (0.012, 0.011), (0.009, 0.008)], 6, (0, 0, 1))

    def weights(p):
        return blend({'forearm_L': 1}, {'hand_L': 1}, smooth(0.70, 0.76, p.x))

    part('hand_R' if mirror else 'hand_L', bm, const('Black'), weights, mirror)

# ---------------------------------------------------------------- head, hair

def skull(co):
    if co.z < 0:  # the jaw narrows to the chin
        k = -co.z
        co.x *= 1 - 0.35 * k * k
        co.y *= (1 - 0.6 * k) if co.y > 0 else (1 - 0.15 * k)
    elif co.y > 0:
        co.y *= 1.08  # the back of the cranium
    return co


def build_head():
    bm = bmesh.new()
    verts = sphere(bm, 12, 9, (0, 0.005, HEAD_Z), (0.076, 0.096, 0.118), skull)
    # The nose: the front-most vertex just below eye level.
    nose = min((v for v in verts if abs(v.co.x) < 1e-4 and HEAD_Z - 0.04 < v.co.z < HEAD_Z), key=lambda v: v.co.y)
    nose.co.y -= 0.02
    nose.co.z -= 0.004
    for sx in (1, -1):
        eye = sphere(bm, 6, 4, (sx * 0.031, -0.084, HEAD_Z + 0.017), (0.013, 0.007, 0.009))
        for v in eye:
            v.tag = True
    mats = {}
    for f in bm.faces:
        mats[f.calc_center_median().to_tuple(5)] = 'Eyes' if all(v.tag for v in f.verts) else 'Skin'
    part('head', bm, lambda c: mats[c.to_tuple(5)], rigid('head'))


def build_hair():
    bm = bmesh.new()
    verts = sphere(bm, 12, 8, (0, 0.01, HEAD_Z + 0.008), (0.088, 0.112, 0.13), skull)
    bmesh.ops.delete(bm, geom=[v for v in verts if v.co.z < HEAD_Z - 0.015 - 0.5 * v.co.y], context='VERTS')
    # Locks hanging in front of the ears, framing the face.
    for sx in (1, -1):
        tube(bm, [(sx * 0.074, -0.04, HEAD_Z + 0.07), (sx * 0.084, -0.05, HEAD_Z - 0.01), (sx * 0.078, -0.045, HEAD_Z - 0.10)],
             [(0.012, 0.022), (0.012, 0.02), (0.006, 0.01)], 4, (0, -1, 0))
    part('hair', bm, const('Hair'), rigid('head'))

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
    part('braid', bm, const('Hair'), lambda p: blend({'spine': 1}, {'head': 1}, smooth(1.62, 1.72, p.z)))

# ---------------------------------------------------------------- assemble

def clear_previous():
    for obj in list(bpy.data.objects):
        if obj.name.startswith(NAME):
            bpy.data.objects.remove(obj, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for arm in list(bpy.data.armatures):
        if arm.users == 0:
            bpy.data.armatures.remove(arm)


def build_armature():
    data = bpy.data.armatures.new(f'{NAME}Rig')
    rig = bpy.data.objects.new(f'{NAME}Rig', data)
    COLLECTION.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, parent) in BONES.items():
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = 0
    for name, (head, tail, parent) in BONES.items():
        if parent:
            eb = data.edit_bones[name]
            eb.parent = data.edit_bones[parent]
            eb.use_connect = (Vector(head) - Vector(BONES[parent][1])).length < 1e-6
    bpy.ops.object.mode_set(mode='OBJECT')
    data.display_type = 'STICK'
    rig.show_in_front = True
    return rig


if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
clear_previous()
COLLECTION = bpy.data.collections.get(NAME) or bpy.data.collections.new(NAME)
if COLLECTION.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(COLLECTION)
MATS = make_materials()

build_torso()
build_skirt()
build_belt()
for mirror in (False, True):
    build_leg(mirror)
    build_foot(mirror)
    build_arm(mirror)
    build_hand(mirror)
build_head()
build_hair()

bpy.ops.object.select_all(action='DESELECT')
for obj in PARTS:
    obj.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = NAME
body.data.name = NAME

rig = build_armature()
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE')
mod.object = rig

triangles = sum(len(p.vertices) - 2 for p in body.data.polygons)

if SAVE:
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=False, export_apply=False, export_yup=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
