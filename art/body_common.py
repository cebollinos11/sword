"""
Shared pieces of the Body model generators (art/build_<body>.py): the
Skeleton's rest joints, the bone table, mesh helpers (`tube`, `sphere`),
weighting helpers, and `Body`, which makes the parts, joins them, rigs them
and exports.

A generator imports this module (art/ is put on sys.path by the generator)
and only describes its body shapes. The rest pose and axes are as in
build_female.py: legs straight down, T-pose arms, facing -Y with the
character's left on +X; shapes are authored on the left and mirrored.
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

def srgb(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), 1.0)


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


def box(bm, centre, half):
    """An axis-aligned box."""
    geom = bmesh.ops.create_cube(bm, size=2.0)
    for v in geom['verts']:
        v.co = Vector((v.co.x * half[0] + centre[0], v.co.y * half[1] + centre[1], v.co.z * half[2] + centre[2]))
    return geom['verts']


def const(mat):
    return lambda c: mat


def rigid(bone):
    return lambda p: {bone: 1.0}


def skull(co):
    """A unit sphere shaped into a head: the jaw narrows to the chin, the cranium bulges at the back."""
    if co.z < 0:
        k = -co.z
        co.x *= 1 - 0.35 * k * k
        co.y *= (1 - 0.6 * k) if co.y > 0 else (1 - 0.15 * k)
    elif co.y > 0:
        co.y *= 1.08
    return co


def head_with_face(bm, eye_colour_tag=True, size=(0.076, 0.096, 0.118), nose=0.02):
    """A 16x12 head with a pushed-out nose and two eye spheres (tagged). Returns a face-material lookup."""
    verts = sphere(bm, 16, 12, (0, 0.005, HEAD_Z), size, skull)
    tip = min((v for v in verts if abs(v.co.x) < 1e-4 and HEAD_Z - 0.04 < v.co.z < HEAD_Z), key=lambda v: v.co.y)
    tip.co.y -= nose
    tip.co.z -= 0.004
    for v in verts:
        v.tag = False
    for sx in (1, -1):
        for v in sphere(bm, 6, 4, (sx * 0.031, -size[1] * 0.875, HEAD_Z + 0.017), (0.013, 0.007, 0.009)):
            v.tag = True
    mats = {}
    for f in bm.faces:
        mats[f.calc_center_median().to_tuple(5)] = 'Eyes' if all(v.tag for v in f.verts) else 'Skin'
    return lambda c: mats[c.to_tuple(5)]


def face_y(x, dz, size=(0.076, 0.096, 0.118)):
    """The y of the front of a `head_with_face` head (`size`) at x, dz above HEAD_Z (the inverse of `skull`)."""
    rx, ry, rz = size
    cz = dz / rz
    k = max(0.0, -cz)
    cx = x / (rx * (1 - 0.35 * k * k))
    cy = math.sqrt(max(0.0, 1 - cx * cx - cz * cz))
    return 0.005 - cy * ry * (1 - 0.15 * k)


def face_features(B, size=(0.076, 0.096, 0.118), brow='Hair', ears=True, brow_tilt=0.0, mouth_width=0.019):
    """Brows (in `brow`), ears and a mouth line on a `head_with_face` head of the same `size`."""
    rx = size[0]
    bm = bmesh.new()
    for sx in (1, -1):
        pts = []
        for x, dz in ((0.013, 0.036), (0.032, 0.043 + brow_tilt), (0.052, 0.036 + 2 * brow_tilt)):
            pts.append((sx * x, face_y(x, dz, size) - 0.004, HEAD_Z + dz))
        tube(bm, pts, [(0.0045, 0.003), (0.005, 0.0035), (0.003, 0.003)], 4, (0, -1, 0))
    B.part('brows', bm, const(brow), rigid('head'), smooth_shade=False)
    bm = bmesh.new()
    y = face_y(0, -0.062, size) - 0.001
    tube(bm, [(mouth_width, y + 0.006, HEAD_Z - 0.058), (0, y, HEAD_Z - 0.061), (-mouth_width, y + 0.006, HEAD_Z - 0.058)],
         [(0.0025, 0.002)] * 3, 4, (0, -1, 0))
    B.part('mouth', bm, const('Eyes'), rigid('head'), smooth_shade=False)
    if ears:
        bm = bmesh.new()
        for sx in (1, -1):
            sphere(bm, 6, 5, (sx * rx * 0.97, 0.012, HEAD_Z - 0.006), (0.013, 0.02, 0.03))
        B.part('ears', bm, const('Skin'), rigid('head'))


def leg_side(x):
    """How far a point between the legs belongs to the left leg (1) rather than the right (0)."""
    return smooth(-0.07, 0.07, x)


def drape_weights(p, top=1.06, bottom=0.82, shins=0.55, amount=0.88):
    """Hanging cloth: hips and spine at the waist, following the legs (thigh, then a little shin) below it."""
    w = trunk_weights(p)
    drape = smooth(top, bottom, p.z) * amount
    shin = smooth(0.62, 0.30, p.z) * shins
    left = leg_side(p.x)
    legs = {'thigh_L': left * (1 - shin), 'shin_L': left * shin, 'thigh_R': (1 - left) * (1 - shin), 'shin_R': (1 - left) * shin}
    return blend(w, legs, drape)


def trunk_weights(p, waist=(1.00, 1.25), neck=(1.56, 1.64)):
    """A torso's own weights: hips below the waist, spine above, head at the neck."""
    head = smooth(neck[0], neck[1], p.z)
    spine = smooth(waist[0], waist[1], p.z)
    return {'hips': 1 - spine, 'spine': spine * (1 - head), 'head': spine * head}


def limb_arm_weights(p):
    """Weights for a left arm tube (shoulder to wrist), blending into the spine at the shoulder."""
    w = by_distance(p, ['upperArm_L', 'forearm_L', 'hand_L'])
    return blend(w, {'spine': 1}, smooth(0.19, 0.13, p.x) * 0.6)


def hand_weights(p):
    return blend({'forearm_L': 1}, {'hand_L': 1}, smooth(0.70, 0.76, p.x))


def leg_weights(p):
    w = by_distance(p, ['thigh_L', 'shin_L', 'foot_L'])
    return blend(w, {'hips': 1}, smooth(0.92, 1.0, p.z) * 0.5)


def foot_weights(p):
    return blend({'foot_L': 1}, {'shin_L': 1}, smooth(0.09, 0.13, p.z) * 0.6)

# ---------------------------------------------------------------- the body


class Body:
    """
    One Body model being built: `materials` is {name: (sRGB colour, metallic,
    roughness, double-sided)}; exactly one name must be 'Skirt' (the Team
    colour). Materials named in `flat` are never smooth-shaded.
    """

    def __init__(self, name, materials, flat=()):
        assert 'Skirt' in materials, 'a Body needs one Team-coloured material named Skirt'
        self.name = name
        self.materials = materials
        self.mat_index = {n: i for i, n in enumerate(materials)}
        self.flat = set(flat)
        self.parts = []
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        self._clear_previous()
        self.collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
        if self.collection.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(self.collection)
        # Show only this Body, so preview renders see one model at a time.
        for c in bpy.context.scene.collection.children:
            c.hide_render = c.hide_viewport = c is not self.collection and c.name != 'Collection'
        self.mats = self._make_materials()

    def _clear_previous(self):
        for obj in list(bpy.data.objects):
            if obj.name == self.name or obj.name.startswith(self.name + '.') or obj.name.startswith(self.name + 'Rig') \
                    or (obj.users_collection and obj.users_collection[0].name == self.name):
                bpy.data.objects.remove(obj, do_unlink=True)
        for me in list(bpy.data.meshes):
            if me.users == 0:
                bpy.data.meshes.remove(me)
        for arm in list(bpy.data.armatures):
            if arm.users == 0:
                bpy.data.armatures.remove(arm)

    def _make_materials(self):
        mats = []
        for mname, (colour, metal, rough, double) in self.materials.items():
            m = bpy.data.materials.get(f'{self.name}_{mname}') or bpy.data.materials.new(f'{self.name}_{mname}')
            m.use_nodes = True
            bsdf = m.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = srgb(colour)
            bsdf.inputs['Metallic'].default_value = metal
            bsdf.inputs['Roughness'].default_value = rough
            m.diffuse_color = srgb(colour)
            m.use_backface_culling = not double
            mats.append(m)
        return mats

    def part(self, name, bm, material_of, weights_of, mirror=False, smooth_shade=True):
        """Make an object from `bm` (authored on the left, +X); `mirror` makes the right-side copy instead."""
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        names = list(self.materials)
        face_mats = [self.mat_index[material_of(f.calc_center_median())] for f in bm.faces]
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
        for m in self.mats:
            me.materials.append(m)
        for poly, mi in zip(me.polygons, face_mats):
            poly.material_index = mi
            poly.use_smooth = smooth_shade and names[mi] not in self.flat
        obj = bpy.data.objects.new(f'{self.name}.{name}', me)
        self.collection.objects.link(obj)
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
        self.parts.append(obj)
        return obj

    def _armature(self):
        data = bpy.data.armatures.new(f'{self.name}Rig')
        rig = bpy.data.objects.new(f'{self.name}Rig', data)
        self.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        for bname, (head, tail, parent) in BONES.items():
            eb = data.edit_bones.new(bname)
            eb.head, eb.tail = Vector(head), Vector(tail)
            eb.roll = 0
        for bname, (head, tail, parent) in BONES.items():
            if parent:
                eb = data.edit_bones[bname]
                eb.parent = data.edit_bones[parent]
                eb.use_connect = (Vector(head) - Vector(BONES[parent][1])).length < 1e-6
        bpy.ops.object.mode_set(mode='OBJECT')
        data.display_type = 'STICK'
        rig.show_in_front = True
        return rig

    def finish(self, save, out_blend, out_glb):
        """Join the parts into `<name>`, rig it to `<name>Rig`, and (if `save`) export. Returns a report."""
        bpy.ops.object.select_all(action='DESELECT')
        for obj in self.parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        body = bpy.context.view_layer.objects.active
        body.name = self.name
        body.data.name = self.name

        rig = self._armature()
        body.parent = rig
        mod = body.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig

        triangles = sum(len(p.vertices) - 2 for p in body.data.polygons)
        if save:
            os.makedirs(os.path.dirname(out_glb), exist_ok=True)
            bpy.ops.object.select_all(action='DESELECT')
            body.select_set(True)
            rig.select_set(True)
            bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_skins=True,
                                      export_animations=False, export_apply=False, export_yup=True)
            # Only this Body's collection (and what it uses) goes into its .blend.
            bpy.data.libraries.write(out_blend, {self.collection}, fake_user=True)
        return {'name': self.name, 'triangles': triangles, 'saved': bool(save)}
