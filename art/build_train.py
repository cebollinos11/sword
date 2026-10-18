"""
Builds the wasteland train Arena in Blender: the look (meshes with flat-colour
materials) and the geometry the simulation stands Fighters on (helper objects
in a `Collision` collection). This script is the source of truth for both
(ADR 0006): re-run it to change the Arena.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_train.py").read(), {"__file__": r"C:/Repos/sword/art/build_train.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_train.py').read(), {'__file__': r'C:/Repos/sword/art/build_train.py', 'SAVE': True})"

With SAVE = True it writes art/train.blend, public/models/arenas/train.glb
(the look) and data/arenas/train.json (the sim geometry, read back from the
Collision helpers):
  - WALK_<id>:  one planar convex face, a floor (a Walk Surface).
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights.
  - SPAWN_T<team>_<slot>: an empty where that Fighter starts, its yaw in the `facing` property.

Everything is authored in game coordinates (x east, y up, z; facing 0 looks
along +z) and placed in Blender as (x, -z, y), which the glTF export
(export_yup) turns back into game coordinates.

Layout: the roofs of an armoured maglev train crossing a wasteland at sunset,
heading +z on a raised twin-beam guideway. Four wagons, back to front: a
passenger car (its roof a little higher, a sensor spine down its middle), two
freight cars (the Teams start on these, facing across the gap between them)
and a low flatcar loaded with containers, waste drums and a power cell. Every
roof is flat down the middle and bevelled along both sides: the bevel is a
Walk Surface sloping down to the edge, striped and lit, so a Fighter pushed
onto it is already on the way off. A narrow gangway crosses each gap (the AI
cannot jump, and a Fighter can walk them); anywhere else a gap is a jump. Off
the sides, the ends or a gangway, the ground is far enough down that the fall
kills (a Death by Fall). A locomotive pulls ahead, out of reach.

The model has four parts:
  - Train:       the train, the guideway beams and the ground: still.
  - Train_Near:  the wasteland close by (wrecks, ruins, dead trees, pylons) as one
                 tile NEAR_TILE long along z, which the game scrolls past (src/render/stage.ts).
  - Train_Far:   a ruined skyline, mesas and far fires, FAR_TILE long, scrolled slower (they read as far off).
  - Train_Sky:   the sunset dome, the sun and the far hills: still and unfogged.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE = globals().get('SAVE', False)
NAME = 'Train'
OUT_BLEND = os.path.join(REPO, 'art', 'train.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'train.glb')
OUT_JSON = os.path.join(REPO, 'data', 'arenas', 'train.json')

HW = 1.7  # every wagon's half width, to the bevels' lower lip
TOP_HW = 1.2  # the flat middle of every roof; the bevels run from here out to HW
BEVEL = 0.4  # how far the bevels fall from the roof to their lip (about 39 degrees)
PLANK = 0.45  # the half width of the gangways across the gaps
BOX_A = (0.45, 10.45)  # the front freight car's z span (Team 0 starts on it)
BOX_B = (-10.45, -0.45)  # the rear freight car's (Team 1)
FLAT = (11.35, 20.35)  # the flatcar, ahead of freight car A
PASS = (-23.35, -11.35)  # the passenger car, behind freight car B
LOCO = (22.85, 38.0)  # the locomotive: out of reach (a 2.5 m gap)
FLAT_Y = -1.2  # the flatcar's deck: a drop that does not hurt (fall.safeHeight is 1.6), a climb back by its sloping end
FLAT_RAMP = (11.35, 13.35, -0.4)  # the flatcar's sloping rear deck: z from, z to, height at its rear
PASS_Y = 0.6  # the passenger car's roof
PASS_RAMP = (-11.35, -12.35, 0.3)  # its sloping front end: z from, z to, height at the front
CLERESTORY = (0.5, -14.0, -21.5, 0.9)  # the raised sensor spine down its roof: half width, z from, z to, height
LOCO_Y = 0.5  # the locomotive's roof
GROUND = -8.0  # the ground: a fall to it kills from anywhere (100 HP, 22 per metre past 1.6)
BODY_BOTTOM = -3.0  # the wagons' undersides
POD = (-3.75, -3.3)  # the maglev pods under them
BEAM_X = (0.95, 1.35)  # the guideway's twin beams, inner and outer x
BEAM_Y = (-4.9, -3.88)
NEAR_TILE = 240.0  # the scrolled wasteland tile's length (m)
FAR_TILE = 480.0
SKY_R = 170.0  # inside the camera's far plane (200) from anywhere on the train
SUN_DIR = Vector((0.18, 0.08, -1.0)).normalized()  # towards the sun: low, behind the train

VENTS = [(0.75, 5.2), (-0.75, 8.4), (-0.75, -5.2), (0.75, -8.4)]  # roof heat sinks (x, z): Walls
HATCHES = [(-0.6, 6.6), (0.6, 1.6), (0.6, -6.6), (-0.6, -1.6)]
CRATE_STACK = (0.75, 15.0)  # on the flatcar: a container with a smaller one on it
BARRELS = (-0.8, 17.1)  # waste drums
CELL = (0.7, 18.7)  # a glowing power cell
BULKHEAD_Z = 20.2  # the flatcar's front bulkhead (its front face)

rng = random.Random(29)

# name: (sRGB colour, metallic, roughness, emission strength). Sky* are emission only (black base).
MATERIALS = {
    'Plate': (0xc9ced3, 0.3, 0.5, 0),
    'PlateDark': (0xa9afb6, 0.3, 0.5, 0),
    'Hull': (0x7d848c, 0.6, 0.5, 0),
    'HullMid': (0x5c636b, 0.6, 0.5, 0),
    'HullDark': (0x353a41, 0.6, 0.5, 0),
    'Black': (0x15171a, 0.3, 0.8, 0),
    'Hazard': (0xe0a020, 0.2, 0.6, 0),
    'Grate': (0x24282d, 0.6, 0.6, 0),
    'Chrome': (0xb9c2cc, 0.9, 0.3, 0),
    'Neon': (0x3ff0ff, 0.0, 0.5, 3.0),
    'NeonRed': (0xff3a2a, 0.0, 0.5, 3.0),
    'NeonOrange': (0xff8a2e, 0.0, 0.5, 3.0),
    'Window': (0x5fc8ff, 0.0, 0.3, 1.2),
    'Glass': (0x1c2a36, 0.2, 0.2, 0),
    'Lamp': (0xfff2c8, 0.0, 0.5, 3.0),
    'Toxic': (0x8cff3a, 0.0, 0.5, 2.0),
    'Fire': (0xff6a1a, 0.0, 0.5, 3.0),
    'Rust': (0x7a3e22, 0.4, 0.8, 0),
    'RustDark': (0x4e2a1a, 0.4, 0.8, 0),
    'Military': (0x4f5338, 0.3, 0.8, 0),
    'Scorch': (0x2a2624, 0.0, 1.0, 0),
    'Ash': (0x8f7f6c, 0.0, 1.0, 0),
    'AshDark': (0x6d5f50, 0.0, 1.0, 0),
    'AshLight': (0xa8977f, 0.0, 1.0, 0),
    'Rubble': (0x6a625a, 0.0, 1.0, 0),
    'Concrete': (0x8a8580, 0.0, 0.9, 0),
    'ConcreteDark': (0x5a5652, 0.0, 0.9, 0),
    'Bone': (0xd8cdb5, 0.0, 0.8, 0),
    'DeadWood': (0x4a3a2e, 0.0, 1.0, 0),
    'Tumble': (0x7c6a4a, 0.0, 1.0, 0),
    'Mesa': (0x8a5040, 0.0, 1.0, 0),
    'MesaDark': (0x5a3438, 0.0, 1.0, 0),
    'Ruin': (0x6a6260, 0.0, 1.0, 0),
    'RuinDark': (0x45403f, 0.0, 1.0, 0),
    'SkyHaze': (0xb07a52, 0.0, 1.0, 1.0),
    'SkyHorizon': (0xc98a56, 0.0, 1.0, 1.0),
    'SkyGlow': (0xf0b060, 0.0, 1.0, 1.0),
    'SkyLow': (0xb8644a, 0.0, 1.0, 1.0),
    'SkyRed': (0x94463e, 0.0, 1.0, 1.0),
    'SkyMid': (0x6e3e42, 0.0, 1.0, 1.0),
    'SkyHigh': (0x45303c, 0.0, 1.0, 1.0),
    'SkyTop': (0x241c26, 0.0, 1.0, 1.0),
    'SkySun': (0xffd08a, 0.0, 1.0, 2.0),
    'SkyHills': (0x4a3236, 0.0, 1.0, 1.0),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- geometry (game coordinates)


class Geo:
    """Faces with a material each; vertices are not shared, so shading is flat."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def face(self, pts, mat, facing=None):
        """A planar face. With `facing` (a vector) it is wound so its normal points that way."""
        pts = [tuple(p) for p in pts]
        if facing is not None:
            a, b, c = (Vector(p) for p in pts[:3])
            if (b - a).cross(c - a).dot(Vector(facing)) < 0:
                pts.reverse()
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append((list(range(base, base + len(pts))), MAT_INDEX[mat]))

    def both(self, pts, front, back):
        """A thin sheet: seen from either side, a colour each."""
        self.face(pts, front)
        self.face(list(reversed(pts)), back)

    def prism(self, c, mat, skip=()):
        """A deformed box from corners c[(i, j, k)] (i along x, j along y, k along z of a right-handed frame)."""
        sides = {
            '-x': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
            '+x': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
            '-y': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
            '+y': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
            '-z': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
            '+z': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
        }
        for name, idx in sides.items():
            if name in skip:
                continue
            pts = [tuple(c[i]) for i in idx]
            if (Vector(pts[0]) - Vector(pts[2])).length < 1e-6 or (Vector(pts[1]) - Vector(pts[3])).length < 1e-6:
                continue
            base = len(self.verts)
            self.verts.extend(pts)
            self.faces.append((list(range(base, base + 4)), MAT_INDEX[mat]))

    def box(self, lo, hi, mat, skip=()):
        c = {(i, j, k): (hi[0] if i else lo[0], hi[1] if j else lo[1], hi[2] if k else lo[2]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.prism(c, mat, skip)

    def tbox(self, m, lo, hi, mat, skip=()):
        """A box from lo to hi in a local frame, placed by the matrix m (a rotation and a move)."""
        c = {(i, j, k): m @ Vector((hi[0] if i else lo[0], hi[1] if j else lo[1], hi[2] if k else lo[2])) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.prism(c, mat, skip)

    def slab(self, x0, x1, z0, z1, top0, top1, thick, mat, skip=()):
        """A slab from x0 to x1 and z0 to z1, its top at height top0 at z0 and top1 at z1 (a ramp), `thick` deep."""
        tops = (top0, top1)
        c = {(i, j, k): ((x0, x1)[i], tops[k] - (0 if j else thick), (z0, z1)[k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.prism(c, mat, skip)

    def strut(self, a, b, width, mat):
        """A square beam (or a cable) from point a to point b (3D), `width` across."""
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        u = d.cross(Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))).normalized()
        v = d.cross(u).normalized()
        h = width / 2
        c = {}
        for i, p in enumerate((a, b)):
            for j in (0, 1):
                for k in (0, 1):
                    c[(i, j, k)] = tuple(p + v * ((j - 0.5) * 2 * h) + u * ((k - 0.5) * 2 * h))
        self.prism(c, mat, skip=('-x', '+x') if width < 0.06 else ())


def angle(k, n):
    return 2 * math.pi * k / n


def pipe(geo, a, b, r0, mat, sides=8, r1=None, caps=False, cap_mat=None):
    """A tube from a to b (3D), radius r0 at a and r1 (default r0) at b; `caps` closes its ends."""
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.cross(Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))).normalized()
    v = d.cross(u)
    rim = lambda c, r: [c + (u * math.cos(angle(k, sides)) + v * math.sin(angle(k, sides))) * r for k in range(sides)]
    ra, rb = rim(a, r0), rim(b, r1)
    for k in range(sides):
        k1 = (k + 1) % sides
        mid = (ra[k] + ra[k1] + rb[k] + rb[k1]) / 4
        out = mid - (a + b) / 2 - d * (mid - (a + b) / 2).dot(d)
        if r1 < 1e-6:
            geo.face([ra[k], ra[k1], b], mat, tuple(out))
        else:
            geo.face([ra[k], ra[k1], rb[k1], rb[k]], mat, tuple(out))
    if caps:
        geo.face(ra, cap_mat or mat, tuple(-d))
        if r1 > 1e-6:
            geo.face(rb, cap_mat or mat, tuple(d))


def placed(x, y, z, yaw=0.0, roll=0.0, pitch=0.0):
    """A local frame at (x, y, z), turned `yaw` about y, after `pitch` about its local z and `roll` about its local x."""
    return Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'Z') @ Matrix.Rotation(roll, 4, 'X')


def normal_of(pts):
    a, b, c = (Vector(p) for p in pts[:3])
    n = (b - a).cross(c - a)
    return n.normalized() if n.length > 1e-9 else Vector((0, 1, 0))


def lumps(geo, x, y, z, r, h, mats, n=7, top=0.55):
    """A rough lump on the ground at (x, y, z): a ragged base ring, a smaller ring up, and a peak."""
    a0 = rng.uniform(0, math.pi)
    base = [Vector((x + r * rng.uniform(0.75, 1.1) * math.cos(a0 + angle(k, n)), y - 0.1, z + r * rng.uniform(0.75, 1.1) * math.sin(a0 + angle(k, n)))) for k in range(n)]
    mid = [Vector((x + (p.x - x) * top, y + h * rng.uniform(0.55, 0.8), z + (p.z - z) * top)) for p in base]
    peak = Vector((x + rng.uniform(-0.2, 0.2) * r, y + h, z + rng.uniform(-0.2, 0.2) * r))
    centre = Vector((x, y + h * 0.4, z))
    for k in range(n):
        k1 = (k + 1) % n
        for tri in ((base[k], base[k1], mid[k1]), (base[k], mid[k1], mid[k]), (mid[k], mid[k1], peak)):
            n_ = normal_of(tri)
            if n_.dot(sum(tri, Vector()) / 3 - centre) < 0:
                n_ = -n_
            geo.face(tri, mats[(k + (tri[2] is peak)) % len(mats)], tuple(n_))


G = Geo()  # the train, the guideway beams and the ground
NEAR = Geo()  # the scrolled wasteland close by
FAR = Geo()  # the scrolled skyline, mesas and far fires
SKY = Geo()  # the dome, the sun and the far hills

# ---------------------------------------------------------------- the sim geometry

WALK = []  # (id, [(x, y, z)])
WALLS = []  # (id, (ax, az), (bx, bz), bottom, top)
SPAWNS = []  # (team, slot, (x, y, z), facing)

r4 = lambda v: round(v, 4) + 0.0


def floor(id, x0, x1, z0, z1, y0, y1=None):
    """A rectangular Walk Surface from x0 to x1 and z0 to z1, at height y0 along z0 and y1 (default y0) along z1."""
    y1 = y0 if y1 is None else y1
    WALK.append((id, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)]))


def bevels(id, z0, z1, y0, y1=None):
    """The two bevels beside a stretch of roof from z0 to z1 (its height y0 at z0, y1 at z1), sloping down to the lip."""
    y1 = y0 if y1 is None else y1
    for s, side in ((-1, 'l'), (1, 'r')):
        WALK.append((f'{id}_bevel_{side}', [(s * TOP_HW, y0, z0), (s * HW, y0 - BEVEL, z0), (s * HW, y1 - BEVEL, z1), (s * TOP_HW, y1, z1)]))


def roof(id, z0, z1, y0, y1=None):
    floor(id, -TOP_HW, TOP_HW, z0, z1, y0, y1)
    bevels(id, z0, z1, y0, y1)


roof('box_a', *BOX_A, 0.0)
roof('box_b', *BOX_B, 0.0)
floor('plank_mid', -PLANK, PLANK, BOX_B[1], BOX_A[0], 0.0)
floor('plank_front', -PLANK, PLANK, BOX_A[1], FLAT_RAMP[0], 0.0, FLAT_RAMP[2])
roof('flat_ramp', FLAT_RAMP[0], FLAT_RAMP[1], FLAT_RAMP[2], FLAT_Y)
roof('flat_deck', FLAT_RAMP[1], FLAT[1], FLAT_Y)
floor('plank_rear', -PLANK, PLANK, BOX_B[0], PASS_RAMP[0], 0.0, PASS_RAMP[2])
roof('pass_ramp', PASS_RAMP[0], PASS_RAMP[1], PASS_RAMP[2], PASS_Y)
cw, cz0, cz1, cy = CLERESTORY
roof('pass_front', PASS_RAMP[1], cz0, PASS_Y)
floor('pass_left', -TOP_HW, -cw, cz0, cz1, PASS_Y)
floor('pass_spine', -cw, cw, cz0, cz1, cy)
floor('pass_right', cw, TOP_HW, cz0, cz1, PASS_Y)
bevels('pass_mid', cz0, cz1, PASS_Y)
roof('pass_back', cz1, PASS[0], PASS_Y)
floor('ground', -60.0, 60.0, -80.0, 80.0, GROUND)


def wall(id, a, b, bottom, top):
    WALLS.append((id, (r4(a[0]), r4(a[1])), (r4(b[0]), r4(b[1])), bottom, top))


def rect(id, x, z, hx, hz, bottom, top):
    """Four Walls round a box of half extents hx, hz at (x, z)."""
    corners = [(x - hx, z - hz), (x + hx, z - hz), (x + hx, z + hz), (x - hx, z + hz)]
    for e in range(4):
        wall(f'{id}_{e}', corners[e], corners[(e + 1) % 4], bottom, top)


for k, (x, z) in enumerate(VENTS):
    rect(f'vent{k}', x, z, 0.28, 0.28, -0.5, 0.55)
rect('crates', *CRATE_STACK, 0.55, 0.55, FLAT_Y - 0.5, FLAT_Y + 1.8)
rect('barrels', *BARRELS, 0.45, 0.45, FLAT_Y - 0.5, FLAT_Y + 0.9)
rect('cell', *CELL, 0.42, 0.42, FLAT_Y - 0.5, FLAT_Y + 1.45)
# The bulkhead closes the flatcar's front, too high to jump: past it is the gap to the locomotive.
wall('bulkhead', (-HW, BULKHEAD_Z), (HW, BULKHEAD_Z), FLAT_Y - 0.5, 0.3)

# The two teams face each other across the gangway between the freight cars.
for slot, x in enumerate((0.0, 0.9, -0.9)):
    SPAWNS.append((0, slot, (x, 0.0, 2.6), math.pi))
    SPAWNS.append((1, slot, (-x, 0.0, -2.6), 0.0))

# ---------------------------------------------------------------- the train


def ring(top):
    """A wagon's cross-section (x, y) with its roof at `top`: the flat roof, the bevels, the sides leaning in, the
    chamfered underside. Clockwise from the roof's right corner, seen from +z; edge k runs from point k to k + 1."""
    right = [(TOP_HW, top), (HW, top - BEVEL), (HW - 0.1, -2.4), (HW - 0.4, BODY_BOTTOM)]
    return right + [(-x, y) for x, y in reversed(right)]


EDGE_BEVEL_R, EDGE_SIDE_R, EDGE_CHAMFER_R, EDGE_BOTTOM, EDGE_CHAMFER_L, EDGE_SIDE_L, EDGE_BEVEL_L = range(7)


def side_x(y, top, s):
    """Where a wagon's side is (x) at height y, on side s, with its roof at `top`; a hair out, for trim."""
    t = (top - BEVEL - y) / (top - BEVEL + 2.4)
    return s * (HW - 0.1 * t + 0.012)


def hull(segs, body, roof_mats, caps=(True, True), chunk=2.5):
    """A wagon's hull along z: `segs` are (z0, z1, top0, top1) stretches, z0 < z1 in order, the roof's height
    at each end. Its sides in panels of `body` in turn, its bevels in hazard stripes with a red-lit lip, its
    roof in panels of `roof_mats`; `caps` closes the (rear, front) ends."""
    for z0, z1, t0, t1 in segs:
        n = max(1, math.ceil((z1 - z0) / chunk - 1e-6))
        top = lambda z: t0 + (t1 - t0) * (z - z0) / (z1 - z0)
        for c in range(n):
            za, zb = z0 + (z1 - z0) * c / n, z0 + (z1 - z0) * (c + 1) / n
            ra, rb = ring(top(za)), ring(top(zb))
            for e in range(len(ra) - 1):
                if e in (EDGE_BEVEL_R, EDGE_BEVEL_L):
                    continue
                mat = body[c % len(body)] if e in (EDGE_SIDE_R, EDGE_SIDE_L) else 'Black' if e == EDGE_BOTTOM else 'HullDark'
                a0, a1, b0, b1 = ra[e], ra[e + 1], rb[e], rb[e + 1]
                quad = [(a0[0], a0[1], za), (a1[0], a1[1], za), (b1[0], b1[1], zb), (b0[0], b0[1], zb)]
                mid = sum((Vector(p) for p in quad), Vector()) / 4
                out = (mid.x, mid.y - (top(mid.z) - 1.5), 0)
                if abs(t1 - t0) > 1e-6:
                    G.face(quad[:3], mat, out)
                    G.face([quad[0], quad[2], quad[3]], mat, out)
                else:
                    G.face(quad, mat, out)
            # The roof in panels.
            G.face([(-TOP_HW, top(za), za), (TOP_HW, top(za), za), (TOP_HW, top(zb), zb), (-TOP_HW, top(zb), zb)], roof_mats[c % len(roof_mats)], (0, 1, 0))
        # The bevels: hazard stripes down to a red-lit lip.
        m = max(1, round((z1 - z0) / 0.5))
        for c in range(m):
            za, zb = z0 + (z1 - z0) * c / m, z0 + (z1 - z0) * (c + 1) / m
            for s in (-1, 1):
                G.face([(s * TOP_HW, top(za), za), (s * HW, top(za) - BEVEL, za), (s * HW, top(zb) - BEVEL, zb), (s * TOP_HW, top(zb), zb)],
                       'Hazard' if c % 2 else 'HullDark', (s * BEVEL, HW - TOP_HW, 0))
        for s in (-1, 1):
            xa, xb = sorted((s * HW, s * (HW + 0.04)))
            G.slab(xa, xb, z0, z1, t0 - BEVEL + 0.01, t1 - BEVEL + 0.01, 0.09, 'NeonRed')
            # A cyan seam down each side.
            G.face([(side_x(-1.05, t0, s), -1.05, z0), (side_x(-0.97, t0, s), -0.97, z0), (side_x(-0.97, t1, s), -0.97, z1), (side_x(-1.05, t1, s), -1.05, z1)], 'Neon', (s, 0, 0))
    for (z0, z1, t0, t1), end, d, on in ((segs[0], 0, -1, caps[0]), (segs[-1], 1, 1, caps[1])):
        if on:
            z, t = (z0, t0) if end == 0 else (z1, t1)
            G.face([(x, y, z) for x, y in ring(t)], 'HullMid', (0, 0, d))


def end_lights(z, top, d):
    """Running lights on a wagon's end: a cyan bar under each bevel, hazard chevrons below."""
    za, zb = sorted((z, z + d * 0.03))
    for s in (-1, 1):
        G.box((s * 1.25 - 0.25, top - 0.75, za), (s * 1.25 + 0.25, top - 0.65, zb), 'Neon')
        G.box((s * 1.05 - 0.15, -2.6, za), (s * 1.05 + 0.15, -1.6, zb), 'Hazard')
    G.box((-0.5, -2.7, za), (0.5, top - 0.9, zb), 'HullDark')


def underframe(z0, z1):
    """The maglev pods under a wagon, glowing where they ride the beams."""
    for zc in (z0 + 1.6, z1 - 1.6):
        G.box((-HW + 0.3, POD[0], zc - 1.0), (HW - 0.3, BODY_BOTTOM, zc + 1.0), 'HullDark', skip=('+y',))
        for s in (-1, 1):
            G.box((BEAM_X[0] if s > 0 else -BEAM_X[1], POD[0] - 0.04, zc - 0.9), (BEAM_X[1] if s > 0 else -BEAM_X[0], POD[0], zc + 0.9), 'Neon', skip=('+y',))


def heat_sink(x, y, z):
    """A roof heat sink: a black base, plated fins, a cyan cap. A Wall, knee high."""
    G.box((x - 0.28, y, z - 0.28), (x + 0.28, y + 0.15, z + 0.28), 'Black', skip=('-y',))
    for k in range(4):
        fx = x - 0.24 + k * 0.16
        G.box((fx - 0.03, y + 0.15, z - 0.26), (fx + 0.03, y + 0.5, z + 0.26), 'Plate', skip=('-y',))
    G.box((x - 0.27, y + 0.5, z - 0.27), (x + 0.27, y + 0.55, z + 0.27), 'Neon', skip=('-y',))


def hatch(x, y, z):
    pipe(G, (x, y, z), (x, y + 0.04, z), 0.38, 'HullDark', sides=8, caps=True)
    pipe(G, (x, y + 0.04, z), (x, y + 0.05, z), 0.14, 'Neon', sides=8, caps=True)


def freight(z0, z1, vents, hatches):
    """An armoured freight car: gunmetal plating, a sealed cargo door each side."""
    hull([(z0, z1, 0.0, 0.0)], ('Hull', 'HullMid'), ('HullMid', 'Hull'))
    G.box((-0.3, 0.0, z0 + 0.15), (0.3, 0.02, z1 - 0.15), 'Grate', skip=('-y',))
    zm = (z0 + z1) / 2
    for s in (-1, 1):
        sx = lambda y: side_x(y, 0.0, s)
        G.face([(sx(-2.3), -2.3, zm - 1.5), (sx(-2.3), -2.3, zm + 1.5), (sx(-0.6), -0.6, zm + 1.5), (sx(-0.6), -0.6, zm - 1.5)], 'Black', (s, 0, 0))
        q = lambda y: side_x(y, 0.0, s) + s * 0.01
        G.face([(q(-2.2), -2.2, zm - 1.4), (q(-2.2), -2.2, zm + 1.4), (q(-0.7), -0.7, zm + 1.4), (q(-0.7), -0.7, zm - 1.4)], 'HullDark', (s, 0, 0))
        q2 = lambda y: side_x(y, 0.0, s) + s * 0.02
        G.face([(q2(-2.2), -2.2, zm - 1.4), (q2(-2.2), -2.2, zm + 1.4), (q2(-1.95), -1.95, zm + 1.4), (q2(-1.95), -1.95, zm - 1.4)], 'Hazard', (s, 0, 0))
        G.face([(q2(-1.5), -1.5, zm + 1.0), (q2(-1.5), -1.5, zm + 1.2), (q2(-1.2), -1.2, zm + 1.2), (q2(-1.2), -1.2, zm + 1.0)], 'NeonRed', (s, 0, 0))
    end_lights(z0, 0.0, -1)
    end_lights(z1, 0.0, 1)
    underframe(z0, z1)
    for x, z in hatches:
        hatch(x, 0.0, z)
    for x, z in vents:
        heat_sink(x, 0.0, z)


def flatcar():
    z0, z1 = FLAT
    rz0, rz1, ry = FLAT_RAMP
    hull([(rz0, rz1, ry, FLAT_Y), (rz1, z1, FLAT_Y, FLAT_Y)], ('HullMid', 'Hull'), ('Grate', 'HullDark'))
    # Treads across the sloping rear deck.
    for k in range(1, 6):
        t = k / 6
        z, y = rz0 + (rz1 - rz0) * t, ry + (FLAT_Y - ry) * t
        G.box((-TOP_HW + 0.1, y, z - 0.04), (TOP_HW - 0.1, y + 0.025, z + 0.04), 'Hazard', skip=('-y',))
    # The power cells that run the train, glowing through the hull's sides.
    for s in (-1, 1):
        for k in range(6):
            z = rz1 + 0.6 + k * 1.15
            q = lambda y: side_x(y, FLAT_Y, s) + s * 0.01
            G.face([(q(-2.3), -2.3, z), (q(-2.3), -2.3, z + 0.7), (q(-1.7), -1.7, z + 0.7), (q(-1.7), -1.7, z)], 'NeonOrange' if k % 3 == 1 else 'Neon', (s, 0, 0))
    end_lights(z0, ry, -1)
    underframe(z0, z1)
    # The front bulkhead: a blast plate, a red light bar along its top.
    G.box((-HW, FLAT_Y - BEVEL, BULKHEAD_Z), (HW, 0.3, z1), 'HullMid', skip=('-y',))
    for k in range(4):
        x = -1.5 + k * 0.9
        G.box((x, FLAT_Y, BULKHEAD_Z - 0.02), (x + 0.4, -0.2, BULKHEAD_Z), 'Hazard', skip=('-y', '+z'))
    G.box((-HW + 0.1, 0.12, BULKHEAD_Z - 0.03), (HW - 0.1, 0.22, BULKHEAD_Z), 'NeonRed', skip=('+z',))
    G.box((-HW, 0.3, BULKHEAD_Z - 0.04), (HW, 0.36, z1 + 0.02), 'Black', skip=('-y',))
    cargo()


def container(m, h):
    """A sealed cargo container of half size h on the frame m: white plate, dark ribs, a hazard band."""
    G.tbox(m, (-h, 0.0, -h), (h, 2 * h, h), 'Plate', skip=('-y',))
    for k in range(5):
        lx = -h + 2 * h * (k + 0.5) / 5
        G.tbox(m, (lx - 0.03, 0.04, -h - 0.02), (lx + 0.03, 2 * h - 0.04, h + 0.02), 'HullMid', skip=('-y', '+y'))
    G.tbox(m, (-h - 0.012, 1.2 * h, -h - 0.012), (h + 0.012, 1.4 * h, h + 0.012), 'Hazard', skip=('-y', '+y'))
    G.tbox(m, (h, 0.5 * h, -0.2 * h), (h + 0.02, 0.8 * h, 0.2 * h), 'Neon')


def cargo():
    x, z = CRATE_STACK
    container(placed(x, FLAT_Y, z, 0.0), 0.55)
    container(placed(x - 0.05, FLAT_Y + 1.1, z + 0.05, 0.25), 0.35)
    for dz in (-0.3, 0.3):
        G.strut((TOP_HW, FLAT_Y + 0.05, z + dz), (x + 0.56, FLAT_Y + 1.12, z + dz), 0.05, 'Black')
    # Waste drums, leaking.
    x, z = BARRELS
    for dx, dz in ((-0.2, -0.2), (0.2, -0.15), (-0.05, 0.22)):
        bx, bz = x + dx, z + dz
        pipe(G, (bx, FLAT_Y, bz), (bx, FLAT_Y + 0.88, bz), 0.22, 'Hazard', sides=8, caps=True, cap_mat='Toxic')
        for y in (0.15, 0.7):
            pipe(G, (bx, FLAT_Y + y, bz), (bx, FLAT_Y + y + 0.06, bz), 0.225, 'Black', sides=8)
    pipe(G, (x + 0.1, FLAT_Y, z + 0.6), (x + 0.1, FLAT_Y + 0.01, z + 0.6), 0.35, 'Toxic', sides=7, caps=True)
    # The power cell.
    x, z = CELL
    pipe(G, (x, FLAT_Y, z), (x, FLAT_Y + 0.25, z), 0.42, 'HullDark', sides=8, caps=True)
    pipe(G, (x, FLAT_Y + 0.25, z), (x, FLAT_Y + 1.2, z), 0.3, 'Neon', sides=8)
    pipe(G, (x, FLAT_Y + 1.2, z), (x, FLAT_Y + 1.45, z), 0.42, 'Chrome', sides=8, caps=True)
    for k in range(4):
        a = angle(k, 4) + 0.4
        G.strut((x + 0.4 * math.cos(a), FLAT_Y + 0.25, z + 0.4 * math.sin(a)), (x + 0.4 * math.cos(a), FLAT_Y + 1.2, z + 0.4 * math.sin(a)), 0.07, 'HullDark')
    # Scrap by the bulkhead.
    for sx, sz in ((-1.0, 19.6), (-0.55, 19.75)):
        lumps(G, sx, FLAT_Y + 0.1, sz, 0.28, 0.32, ('Rust', 'HullMid'), n=6, top=0.7)


def passenger():
    """A white-plated passenger car, a long lit window band, a sensor spine down its roof."""
    z0, z1 = PASS
    fz0, fz1, fy = PASS_RAMP  # the front (z1 of the car), sloping up to fz1
    hull([(z0, fz1, PASS_Y, PASS_Y), (fz1, fz0, PASS_Y, fy)], ('Plate', 'PlateDark'), ('Plate', 'PlateDark'))
    for s in (-1, 1):
        q = lambda y: side_x(y, PASS_Y, s) + s * 0.01
        G.face([(q(-1.6), -1.6, z0 + 0.4), (q(-1.6), -1.6, z1 - 0.4), (q(-0.55), -0.55, z1 - 0.4), (q(-0.55), -0.55, z0 + 0.4)], 'Glass', (s, 0, 0))
        q = lambda y: side_x(y, PASS_Y, s) + s * 0.02
        for k in range(8):
            zc = z0 + 1.1 + k * (z1 - z0 - 2.2) / 7
            G.face([(q(-1.45), -1.45, zc - 0.45), (q(-1.45), -1.45, zc + 0.45), (q(-0.7), -0.7, zc + 0.45), (q(-0.7), -0.7, zc - 0.45)], 'Window', (s, 0, 0))
        G.face([(q(-1.9), -1.9, z0 + 0.4), (q(-1.9), -1.9, z1 - 0.4), (q(-1.8), -1.8, z1 - 0.4), (q(-1.8), -1.8, z0 + 0.4)], 'NeonRed', (s, 0, 0))
    end_lights(z1, fy, 1)
    # The rear: a door and red tail lights.
    za, zb = z0 - 0.03, z0
    G.box((-0.5, -2.7, za), (0.5, -0.4, zb), 'HullDark')
    G.box((-0.35, -1.5, za - 0.005), (0.35, -0.8, zb), 'Window')
    for s in (-1, 1):
        G.box((s * 1.2 - 0.25, -0.5, za), (s * 1.2 + 0.25, -0.3, zb), 'NeonRed')
    # The sensor spine, raised a step off the roof, with a lit slit down each side and domes on top.
    cw, cz0, cz1, cy = CLERESTORY
    G.box((-cw, PASS_Y, cz1), (cw, cy, cz0), 'HullDark', skip=('-y', '+y'))
    n = 6
    for k in range(n):
        za, zb = cz1 + (cz0 - cz1) * k / n, cz1 + (cz0 - cz1) * (k + 1) / n
        G.face([(-cw, cy, za), (cw, cy, za), (cw, cy, zb), (-cw, cy, zb)], 'HullMid' if k % 2 else 'Hull', (0, 1, 0))
    for s in (-1, 1):
        xa, xb = sorted((s * cw, s * (cw + 0.02)))
        G.box((xa, PASS_Y + 0.12, cz1 + 0.2), (xb, PASS_Y + 0.18, cz0 - 0.2), 'Neon', skip=('-y', '+y'))
    for z in (cz1 + 0.8, cz0 - 0.8):
        pipe(G, (0, cy, z), (0, cy + 0.12, z), 0.22, 'Chrome', sides=8, r1=0.12, caps=True, cap_mat='NeonRed')
    underframe(z0, z1)


def planks():
    """The gangways across the gaps: grating with hazard edges and a cyan strip down each side."""
    def plank(z0, z1, y0, y1):
        G.slab(-PLANK, PLANK, z0, z1, y0 + 0.02, y1 + 0.02, 0.1, 'Grate')
        for s in (-1, 1):
            xa, xb = sorted((s * PLANK, s * (PLANK - 0.06)))
            G.slab(xa, xb, z0, z1, y0 + 0.035, y1 + 0.035, 0.03, 'Hazard', skip=('-y',))
            xa, xb = sorted((s * PLANK, s * (PLANK + 0.03)))
            G.slab(xa, xb, z0, z1, y0 - 0.02, y1 - 0.02, 0.06, 'Neon')
    plank(BOX_B[1] - 0.15, BOX_A[0] + 0.15, 0.0, 0.0)
    plank(BOX_A[1] - 0.15, FLAT_RAMP[0] + 0.15, 0.0 + 0.0667, FLAT_RAMP[2] - 0.0667)
    plank(PASS_RAMP[0] - 0.15, BOX_B[0] + 0.15, PASS_RAMP[2] + 0.05, 0.0 - 0.05)
    # The couplings under them.
    for za, zb in ((BOX_B[1], BOX_A[0]), (BOX_A[1], FLAT[0]), (PASS[1], BOX_B[0]), (FLAT[1], LOCO[0])):
        G.box((-0.18, -2.75, za - 0.3), (0.18, -2.45, zb + 0.3), 'HullDark')
        G.box((-0.3, -2.85, (za + zb) / 2 - 0.12), (0.3, -2.35, (za + zb) / 2 + 0.12), 'Chrome')


def locomotive():
    """A bullet-nosed engine: a plated body with a lit cab, its nose tapering low to the beams."""
    z0, z1 = LOCO
    n0 = z1 - 6.0  # where the nose starts
    hull([(z0, n0, LOCO_Y, LOCO_Y)], ('Plate', 'Hull'), ('Hull', 'HullMid'), caps=(True, False))
    end_lights(z0, LOCO_Y, -1)
    for s in (-1, 1):
        q = lambda y: side_x(y, LOCO_Y, s) + s * 0.01
        G.face([(q(-1.0), -1.0, n0 - 2.6), (q(-1.0), -1.0, n0 - 0.2), (q(-0.25), -0.25, n0 - 0.2), (q(-0.25), -0.25, n0 - 2.6)], 'Window', (s, 0, 0))
        for k in range(4):
            z = z0 + 0.8 + k * 0.9
            q = lambda y: side_x(y, LOCO_Y, s) + s * 0.01
            G.face([(q(-2.2), -2.2, z), (q(-2.2), -2.2, z + 0.5), (q(-1.4), -1.4, z + 0.5), (q(-1.4), -1.4, z)], 'NeonOrange', (s, 0, 0))
    # The nose: the cross-section narrowing and dropping in stations to a blunt tip.
    stations = []
    for i in range(6):
        t = i / 5
        sx, sy = 1 - 0.55 * t, 1 - 0.6 * t ** 1.4
        stations.append([Vector((x * sx, BODY_BOTTOM + (y - BODY_BOTTOM) * sy, n0 + 6.0 * t ** 0.9)) for x, y in ring(LOCO_Y)])
    centre = lambda st: sum(st, Vector()) / len(st)
    for i in range(5):
        a, b = stations[i], stations[i + 1]
        c = (centre(a) + centre(b)) / 2
        for e in range(8):
            e1 = (e + 1) % 8
            if e == 7:  # the roof
                mat = 'Glass' if i in (1, 2) else 'Plate'
            elif e in (EDGE_BEVEL_R, EDGE_BEVEL_L):
                mat = 'Glass' if i in (1, 2) else 'Hazard' if i == 4 else 'Hull'
            elif e == EDGE_BOTTOM:
                mat = 'Black'
            elif e in (EDGE_CHAMFER_R, EDGE_CHAMFER_L):
                mat = 'HullDark'
            else:
                mat = 'Plate'
            quad = [a[e], a[e1], b[e1], b[e]]
            out = tuple(sum(quad, Vector()) / 4 - c)
            G.face(quad[:3], mat, out)
            G.face([quad[0], quad[2], quad[3]], mat, out)
    tip = stations[-1]
    G.face(tip, 'HullDark', (0, 0, 1))
    tc = centre(tip)
    for s in (-1, 1):
        G.box((tc.x + s * 0.45 - 0.18, tc.y - 0.05, tc.z), (tc.x + s * 0.45 + 0.18, tc.y + 0.15, tc.z + 0.03), 'Lamp')
    G.box((tc.x - 0.6, tc.y - 0.45, tc.z), (tc.x + 0.6, tc.y - 0.38, tc.z + 0.03), 'Neon')
    # A fin down its back, heat sinks, and the reactor's glow under the roof.
    G.box((-0.06, LOCO_Y, z0 + 0.5), (0.06, LOCO_Y + 0.5, n0 - 0.5), 'HullDark', skip=('-y',))
    G.box((-0.07, LOCO_Y + 0.42, z0 + 0.5), (0.07, LOCO_Y + 0.5, n0 - 0.5), 'NeonRed', skip=('-y',))
    for z in (z0 + 2.0, z0 + 4.0):
        heat_sink(-0.7, LOCO_Y, z)
        heat_sink(0.7, LOCO_Y, z)
    underframe(z0, z1)


def guideway():
    """The twin beams the train rides, and the ground. Pylons, joints and ties scroll with the wasteland."""
    for s in (-1, 1):
        xa, xb = sorted((s * BEAM_X[0], s * BEAM_X[1]))
        G.box((xa, BEAM_Y[0], -200.0), (xb, BEAM_Y[1], 200.0), 'ConcreteDark', skip=('-z', '+z'))
        xa, xb = sorted((s * BEAM_X[0], s * (BEAM_X[0] + 0.08)))
        G.box((xa, BEAM_Y[1], -200.0), (xb, BEAM_Y[1] + 0.03, 200.0), 'Neon', skip=('-y', '-z', '+z'))
    n = 36
    disc = [(SKY_R * math.cos(angle(k, n)), GROUND, SKY_R * math.sin(angle(k, n))) for k in range(n)]
    for k in range(n):
        G.face([(0, GROUND, 0), disc[k], disc[(k + 1) % n]], 'Ash', (0, 1, 0))


# ---------------------------------------------------------------- the wasteland (scrolled)


def near_z(margin=3.0):
    return rng.uniform(margin, NEAR_TILE - margin)


def off_track(lo, hi):
    return rng.choice((-1, 1)) * rng.uniform(lo, hi)


def pylons():
    """The guideway's pylons every 24 m, cracked concrete, with joint bands on the beams between."""
    for k in range(int(NEAR_TILE / 24)):
        z = 12.0 + k * 24.0
        NEAR.box((-0.55, GROUND - 0.1, z - 0.55), (0.55, BEAM_Y[0] - 0.4, z + 0.55), 'Concrete' if k % 3 else 'ConcreteDark', skip=('-y',))
        NEAR.box((-1.6, BEAM_Y[0] - 0.4, z - 0.7), (1.6, BEAM_Y[0], z + 0.7), 'ConcreteDark', skip=('+y',))
        NEAR.box((-0.6, GROUND - 0.1, z - 0.6), (0.6, GROUND + 0.8, z + 0.6), 'Rust', skip=('-y',))
        NEAR.box((-0.57, -6.0, z - 0.57), (0.57, -5.9, z + 0.57), 'NeonRed' if k % 4 == 0 else 'Neon', skip=('-y', '+y'))
        if k % 3 == 1:  # a chunk knocked out, rebar showing
            for dx in (-0.3, 0.0, 0.3):
                NEAR.strut((0.55, -6.6, z + dx), (0.9, -6.4 + dx, z + dx), 0.04, 'Rust')
        for jz in (z, z + 12.0):
            for s in (-1, 1):
                xa, xb = sorted((s * (BEAM_X[0] - 0.02), s * (BEAM_X[1] + 0.02)))
                NEAR.box((xa, BEAM_Y[0] - 0.02, jz - 0.12), (xb, BEAM_Y[1] - 0.02, jz + 0.12), 'HullDark', skip=('+y',))


def power_tower(x, z, lean=0.0, height=17.0):
    """A lattice power pylon, some leaning, some down, cables hanging off them."""
    m = placed(x, GROUND - 0.1, z, 0.0, roll=lean)
    feet = [m @ Vector((dx * 1.6, 0, dz * 1.6)) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    tops = [m @ Vector((dx * 0.45, height, dz * 0.45)) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        NEAR.strut(feet[k], tops[k], 0.16, 'Rust')
        NEAR.strut(feet[k], tops[(k + 1) % 4] * 0.4 + feet[(k + 1) % 4] * 0.6, 0.07, 'RustDark')
    for h in (0.55, 0.8):
        a, b = m @ Vector((-3.5, height * h, 0)), m @ Vector((3.5, height * h, 0))
        NEAR.strut(a, b, 0.2, 'Rust')
        for p in (a, b):
            NEAR.strut(p, p + Vector((0, -2.5 - rng.uniform(0, 3), rng.uniform(-1, 1))), 0.04, 'Black')
    NEAR.box(tuple(tops[0] - Vector((0.1, 0, 0.1))), tuple(tops[2] + Vector((0.1, 0.3, 0.1))), 'NeonRed' if rng.random() < 0.5 else 'RustDark')


def dead_tree(x, z):
    h = rng.uniform(3.0, 6.5)
    base = Vector((x, GROUND - 0.1, z))
    top = base + Vector((rng.uniform(-0.8, 0.8), h, rng.uniform(-0.8, 0.8)))
    NEAR.strut(base, top, rng.uniform(0.22, 0.34), 'DeadWood')
    for k in range(rng.randint(3, 5)):
        p = base.lerp(top, rng.uniform(0.45, 0.9))
        a = rng.uniform(0, 2 * math.pi)
        reach = rng.uniform(1.0, 2.4)
        q = p + Vector((reach * math.cos(a), rng.uniform(0.4, 1.6), reach * math.sin(a)))
        NEAR.strut(p, q, 0.12, 'DeadWood')
        if rng.random() < 0.5:
            NEAR.strut(q, q + Vector((rng.uniform(-0.6, 0.6), rng.uniform(0.3, 0.8), rng.uniform(-0.6, 0.6))), 0.06, 'DeadWood')


def ruin(x, z):
    """A gutted concrete building: broken walls of uneven height, black window holes, rebar, a rubble heap."""
    w, d = rng.uniform(5.0, 10.0), rng.uniform(5.0, 9.0)
    storey = 3.2
    floors = rng.randint(2, 5)
    m = placed(x, GROUND - 0.1, z, rng.uniform(-0.3, 0.3))
    walls = [((-w, -d), (w, -d)), ((w, -d), (w, d)), ((w, d), (-w, d)), ((-w, d), (-w, -d))]
    for k, ((ax, az), (bx, bz)) in enumerate(walls):
        if rng.random() < 0.25:
            continue  # this side has come down
        segs = 3
        for sgm in range(segs):
            t0, t1 = sgm / segs, (sgm + 1) / segs
            p0 = (ax + (bx - ax) * t0, az + (bz - az) * t0)
            p1 = (ax + (bx - ax) * t1, az + (bz - az) * t1)
            h = storey * floors * rng.uniform(0.35, 1.0)
            along = Vector((p1[0] - p0[0], 0, p1[1] - p0[1]))
            length = along.length
            f = m @ Matrix.Translation((p0[0], 0, p0[1])) @ Matrix.Rotation(-math.atan2(along.z, along.x), 4, 'Y')
            NEAR.tbox(f, (0.0, 0.0, -0.15), (length, h, 0.15), 'Concrete' if (k + sgm) % 2 else 'ConcreteDark')
            out = -1 if k in (0, 3) else 1
            for fl in range(int(h / storey)):
                y = fl * storey + 1.0
                if y + 1.4 > h:
                    break
                NEAR.tbox(f, (length * 0.25, y, out * 0.16 - 0.005), (length * 0.75, y + 1.4, out * 0.16 + 0.005), 'Black')
            if rng.random() < 0.5:
                for r in range(3):
                    p = f @ Vector((length * (0.2 + 0.3 * r), h, 0))
                    NEAR.strut(p, p + Vector((rng.uniform(-0.3, 0.3), rng.uniform(0.6, 1.5), rng.uniform(-0.3, 0.3))), 0.05, 'Rust')
    for fl in range(1, floors):
        if rng.random() < 0.5:
            NEAR.tbox(m, (-w * 0.9, fl * storey - 0.2, -d * rng.uniform(0.2, 0.9)), (w * rng.uniform(0.0, 0.9), fl * storey, d * 0.9), 'ConcreteDark')
    for k in range(4):
        lumps(NEAR, x + rng.uniform(-w, w), GROUND, z + rng.uniform(-d, d) * 1.3, rng.uniform(1.0, 2.5), rng.uniform(0.6, 1.6), ('Rubble', 'ConcreteDark', 'Concrete'))


def car_wreck(x, z):
    """A rusted-out car, maybe on its roof."""
    flipped = rng.random() < 0.3
    m = placed(x, GROUND + (1.15 if flipped else 0.25), z, rng.uniform(0, math.pi), roll=math.pi if flipped else rng.uniform(-0.15, 0.15))
    NEAR.tbox(m, (-2.1, 0.0, -0.9), (2.1, 0.8, 0.9), 'Rust')
    NEAR.tbox(m, (-1.0, 0.8, -0.8), (0.9, 1.35, 0.8), 'RustDark')
    NEAR.tbox(m, (0.9, 0.82, -0.75), (0.95, 1.3, 0.75), 'Black')
    for wx in (-1.3, 1.3):
        for wz in (-0.9, 0.9):
            if rng.random() < 0.7:
                a, b = m @ Vector((wx, 0.1, wz)), m @ Vector((wx, 0.1, wz + (0.25 if wz > 0 else -0.25)))
                pipe(NEAR, a, b, 0.35, 'Black', sides=6, caps=True)


def tank(x, z):
    """A burnt-out battle tank, its gun drooping."""
    m = placed(x, GROUND - 0.3, z, rng.uniform(0, math.pi), roll=0.08)
    NEAR.tbox(m, (-3.5, 0.0, -1.7), (3.5, 1.5, 1.7), 'Military', skip=('-y',))
    for s in (-1, 1):
        NEAR.tbox(m, (-3.8, 0.0, s * 1.7 - 0.5), (3.8, 1.0, s * 1.7 + 0.5), 'Black', skip=('-y',))
    NEAR.tbox(m, (-1.6, 1.5, -1.3), (1.4, 2.4, 1.3), 'Military')
    NEAR.tbox(m, (-1.61, 1.6, -1.31), (-0.6, 2.41, 0.0), 'Scorch')
    pipe(NEAR, m @ Vector((1.4, 2.0, 0.0)), m @ Vector((6.0, 1.2, 0.4)), 0.16, 'Military', sides=6)


def aircraft(x, z):
    """A crashed transport, nose down in the ground, one wing torn off."""
    m = placed(x, GROUND, z, rng.uniform(0, math.pi), pitch=-0.25, roll=0.15)
    a, b = m @ Vector((-9.0, 0.5, 0)), m @ Vector((9.0, 3.5, 0))
    pipe(NEAR, a, b, 1.8, 'PlateDark', sides=8)
    pipe(NEAR, b, m @ Vector((12.0, 4.3, 0)), 1.8, 'PlateDark', sides=8, r1=0.5, caps=True, cap_mat='Scorch')
    NEAR.tbox(m, (-1.5, 2.0, 1.4), (2.5, 2.3, 9.0), 'Plate')
    NEAR.tbox(m, (-0.8, 2.0, -5.0), (2.0, 2.3, -1.4), 'Plate')
    NEAR.tbox(m, (9.5, 4.0, -0.15), (12.0, 8.0, 0.15), 'Plate')
    NEAR.tbox(m, (10.5, 6.5, -0.17), (11.5, 7.5, 0.17), 'NeonRed')


def skeleton(x, z):
    """The bones of something enormous: a skull, a spine and arched ribs."""
    yaw = rng.uniform(0, math.pi)
    m = placed(x, GROUND, z, yaw)
    spine = [m @ Vector((lx, 2.4 + 0.6 * math.sin(lx * 0.3), 0)) for lx in range(-8, 9, 2)]
    for a, b in zip(spine, spine[1:]):
        NEAR.strut(a, b, 0.5, 'Bone')
    for k, p in enumerate(spine[1:-2]):
        for s in (-1, 1):
            pts = [p + (m.to_3x3() @ Vector((0.3 * t, -2.4 * t * t + 0.8 * t, s * 2.6 * math.sin(t * 1.4)))) for t in (0, 0.33, 0.66, 1.0)]
            for a, b in zip(pts, pts[1:]):
                NEAR.strut(a, b, 0.22, 'Bone')
    head = spine[-1] + m.to_3x3() @ Vector((2.0, -0.6, 0))
    lumps(NEAR, head.x, GROUND, head.z, 1.8, 3.2, ('Bone', 'AshLight'), n=6, top=0.75)


def toxic_pool(x, z):
    r = rng.uniform(2.0, 5.0)
    n = 9
    a0 = rng.uniform(0, math.pi)
    pts = [(x + r * rng.uniform(0.8, 1.1) * math.cos(a0 + angle(k, n)), GROUND + 0.08, z + r * 0.7 * rng.uniform(0.8, 1.1) * math.sin(a0 + angle(k, n))) for k in range(n)]
    NEAR.face(pts, 'Toxic', (0, 1, 0))
    for k in range(0, n, 2):
        lumps(NEAR, pts[k][0], GROUND, pts[k][2], rng.uniform(0.4, 0.9), rng.uniform(0.2, 0.5), ('AshDark', 'Scorch'), n=5)


def fire_barrel(x, z):
    pipe(NEAR, (x, GROUND - 0.1, z), (x, GROUND + 0.9, z), 0.3, 'Rust', sides=8)
    for k in range(3):
        a = angle(k, 3)
        p = Vector((x + 0.1 * math.cos(a), GROUND + 0.85, z + 0.1 * math.sin(a)))
        pipe(NEAR, p, p + Vector((0, rng.uniform(0.6, 1.1), 0)), 0.18, 'Fire', sides=5, r1=0.0)


def tumbleweed(x, z, r):
    c = Vector((x, GROUND + r * 0.9, z))
    pts = [Vector(v) * r for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
    m = Matrix.Rotation(rng.uniform(0, 3), 3, Vector((rng.random(), rng.random(), rng.random())).normalized())
    pts = [c + m @ p for p in pts]
    for a, b, d in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
        tri = (pts[a], pts[b], pts[d])
        NEAR.face(tri, 'Tumble', tuple(sum(tri, Vector()) / 3 - c))


def robot(x, z):
    """A giant war robot half sunk in the ground: a rusted head with one eye still lit, an arm reaching up."""
    m = placed(x, GROUND - 0.9, z, 0.7, roll=0.25, pitch=0.2)
    NEAR.tbox(m, (-2.0, 0.0, -1.8), (2.0, 3.2, 1.8), 'Rust', skip=('-y',))
    NEAR.tbox(m, (-1.6, 3.2, -1.4), (1.6, 3.6, 1.4), 'RustDark', skip=('-y',))
    NEAR.tbox(m, (2.0, 1.6, -0.9), (2.12, 2.3, -0.2), 'NeonRed')
    NEAR.tbox(m, (2.0, 1.6, 0.3), (2.08, 2.3, 1.0), 'Black')
    NEAR.tbox(m, (2.0, 0.5, -1.2), (2.25, 1.0, 1.2), 'Black')
    NEAR.strut(m @ Vector((0.0, 3.6, 0.6)), m @ Vector((0.3, 6.0, 0.9)), 0.12, 'RustDark')
    a = placed(x + 4.5, GROUND - 0.5, z - 2.0, 0.2)
    shoulder, elbow, hand = a @ Vector((0, 0, 0)), a @ Vector((0.6, 3.2, 0.3)), a @ Vector((1.6, 5.2, -0.4))
    NEAR.strut(shoulder, elbow, 0.9, 'Rust')
    NEAR.strut(elbow, hand, 0.75, 'Rust')
    pipe(NEAR, elbow - Vector((0, 0.3, 0)), elbow + Vector((0, 0.3, 0)), 0.6, 'RustDark', sides=8, caps=True)
    for k in range(3):
        f = hand + Vector((0.3 * (k - 1), 0.2, 0.1 * k))
        NEAR.strut(f, f + Vector((0.2 * (k - 1), 1.0, 0.3)), 0.18, 'RustDark')


def slabs(x, z):
    """Broken concrete slabs tipped up out of the ground."""
    for k in range(rng.randint(1, 3)):
        m = placed(x + rng.uniform(-2, 2), GROUND - 0.3, z + rng.uniform(-2, 2), rng.uniform(0, math.pi), roll=rng.uniform(0.2, 0.9))
        w, h = rng.uniform(1.0, 2.5), rng.uniform(1.5, 3.0)
        NEAR.tbox(m, (-w, 0.0, -0.15), (w, h, 0.15), 'Concrete' if k % 2 else 'ConcreteDark')


def near_wasteland():
    pylons()
    for k in range(4):
        z = 30.0 + k * 60.0
        power_tower(16.0, z, lean=(0.0, 0.25, 0.0, -0.5)[k], height=17.0 if k != 3 else 12.0)
    robot(-30.0, 150.0)
    tank(22.0, 95.0)
    aircraft(-48.0, 40.0)
    skeleton(30.0, 190.0)
    for x, z in ((-22.0, 85.0), (40.0, 30.0), (-60.0, 120.0), (55.0, 140.0), (-35.0, 215.0), (75.0, 220.0)):
        ruin(x, z)
    for k in range(10):
        car_wreck(off_track(8.0, 60.0), near_z(6.0))
    for k in range(6):
        toxic_pool(off_track(10.0, 70.0), near_z(8.0))
    for k in range(7):
        fire_barrel(off_track(6.0, 40.0), near_z())
    for k in range(10):
        slabs(off_track(6.0, 80.0), near_z(5.0))
    for k in range(32):
        dead_tree(off_track(6.0, 90.0), near_z())
    for k in range(60):
        x, z = off_track(4.0, 110.0), near_z()
        r = rng.uniform(0.4, 2.4) * (1.0 if abs(x) > 12 else 0.6)
        lumps(NEAR, x, GROUND, z, r, r * rng.uniform(0.4, 0.9), ('Rubble', 'AshDark', 'Rubble'))
    for k in range(34):
        x, z = off_track(5.0, 120.0), near_z()
        r = rng.uniform(4.0, 11.0)
        lumps(NEAR, x, GROUND, z, r, rng.uniform(0.4, 1.1), ('AshLight', 'AshDark', 'Ash'), n=8, top=0.5)
    for k in range(16):
        tumbleweed(off_track(3.0, 30.0), near_z(), rng.uniform(0.3, 0.5))


def far_wasteland():
    """A ruined city's towers off on one side, mesas on the other, and fires burning out on the plain."""
    for k in range(18):
        x, z = rng.uniform(85.0, 160.0) * (1 if k % 3 else -1), rng.uniform(15.0, FAR_TILE - 15.0)
        w, d, h = rng.uniform(6.0, 14.0), rng.uniform(6.0, 14.0), rng.uniform(18.0, 70.0)
        lean = rng.uniform(-0.12, 0.12) if k % 4 == 0 else 0.0
        m = placed(x, GROUND - 1.0, z, rng.uniform(0, math.pi / 2), roll=lean)
        c = {(i, j, kk): m @ Vector(((-w, w)[i], 0.0 if j == 0 else h * rng.uniform(0.75, 1.0), (-d, d)[kk])) for i in (0, 1) for j in (0, 1) for kk in (0, 1)}
        FAR.prism(c, 'Ruin' if k % 2 else 'RuinDark', skip=('-y',))
    for k in range(7):
        x, z = -rng.uniform(95.0, 150.0) if k % 2 else rng.uniform(110.0, 150.0), rng.uniform(20.0, FAR_TILE - 20.0)
        r = rng.uniform(10.0, 24.0)
        h = rng.uniform(14.0, 32.0)
        n = 9
        a0 = rng.uniform(0, math.pi)
        ringf = lambda y, f: [Vector((x + r * f * math.cos(a0 + angle(i, n)) * rng.uniform(0.9, 1.1), y, z + r * f * math.sin(a0 + angle(i, n)) * rng.uniform(0.9, 1.1))) for i in range(n)]
        base, band, top = ringf(GROUND - 1, 1.25), ringf(GROUND + h * 0.55, 0.92), ringf(GROUND + h, 0.8)
        c = Vector((x, GROUND + h / 2, z))
        for i in range(n):
            i1 = (i + 1) % n
            for (a, b), mat in (((base, band), 'MesaDark'), ((band, top), 'Mesa')):
                quad = [a[i], a[i1], b[i1], b[i]]
                FAR.face(quad[:3], mat, tuple(sum(quad, Vector()) / 4 - c))
                FAR.face([quad[0], quad[2], quad[3]], mat, tuple(sum(quad, Vector()) / 4 - c))
        FAR.face(top, 'MesaDark', (0, 1, 0))
    for k in range(5):
        x, z = off_track(70.0, 150.0), rng.uniform(30.0, FAR_TILE - 30.0)
        h = rng.uniform(4.0, 8.0)
        pipe(FAR, (x, GROUND - 0.5, z), (x, GROUND + h, z), rng.uniform(1.5, 2.5), 'Fire', sides=6, r1=0.0)


# ---------------------------------------------------------------- the sky (still)


def sky():
    """The dome in bands from the dust under the horizon to dusk overhead, brighter round the sun; the sun; far hills."""
    bands = [(-25, 'SkyHaze', 'SkyHaze'), (-1, 'SkyHorizon', 'SkyGlow'), (3, 'SkyHorizon', 'SkyGlow'), (7, 'SkyLow', 'SkyHorizon'),
             (13, 'SkyRed', 'SkyLow'), (22, 'SkyMid', 'SkyRed'), (36, 'SkyHigh', 'SkyMid'), (55, 'SkyTop', 'SkyHigh'), (90, None, None)]
    n = 36
    sun_az = math.atan2(SUN_DIR.z, SUN_DIR.x)
    point = lambda el, az: Vector((SKY_R * math.cos(math.radians(el)) * math.cos(az), SKY_R * math.sin(math.radians(el)), SKY_R * math.cos(math.radians(el)) * math.sin(az)))
    for (e0, mat, glow), (e1, _, _) in zip(bands, bands[1:]):
        for k in range(n):
            a0, a1 = angle(k, n), angle(k + 1, n)
            near_sun = math.cos((a0 + a1) / 2 - sun_az) > math.cos(math.radians(50))
            m = glow if near_sun else mat
            quad = [point(e0, a0), point(e0, a1), point(e1, a1), point(e1, a0)]
            inward = -(sum(quad, Vector()) / 4)
            if e1 == 90:
                SKY.face(quad[:2] + [quad[2]], m, tuple(inward))
            else:
                SKY.face(quad, m, tuple(inward))
    # The sun, low and swollen in the dust behind the train.
    c = SUN_DIR * (SKY_R - 4)
    u = SUN_DIR.cross(Vector((0, 1, 0))).normalized()
    v = u.cross(SUN_DIR).normalized()
    SKY.face([c + (u * math.cos(angle(k, 16)) + v * math.sin(angle(k, 16))) * 11.0 for k in range(16)], 'SkySun', tuple(-SUN_DIR))
    # Low hills all round the horizon.
    n = 72
    R = SKY_R - 8
    hills = [(R * math.cos(angle(k, n)), GROUND + rng.uniform(2.0, 9.0) * (1 + 0.6 * math.sin(3 * angle(k, n))), R * math.sin(angle(k, n))) for k in range(n)]
    for k in range(n):
        a, b = hills[k], hills[(k + 1) % n]
        SKY.face([(a[0], GROUND - 2, a[2]), (b[0], GROUND - 2, b[2]), b, a], 'SkyHills', (-(a[0] + b[0]), 0, -(a[2] + b[2])))


def build_look():
    freight(*BOX_A, [v for v in VENTS if v[1] > 0], [h for h in HATCHES if h[1] > 0])
    freight(*BOX_B, [v for v in VENTS if v[1] < 0], [h for h in HATCHES if h[1] < 0])
    flatcar()
    passenger()
    planks()
    locomotive()
    guideway()
    near_wasteland()
    far_wasteland()
    sky()


# ---------------------------------------------------------------- Blender objects

def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def srgb(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), 1.0)


def materials():
    mats = []
    for name, (colour, metal, rough, emit) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1) if name.startswith('Sky') else rgba
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Emission Color'].default_value = rgba if emit else (0, 0, 0, 1)
        bsdf.inputs['Emission Strength'].default_value = float(emit)
        m.diffuse_color = rgba
        m.use_backface_culling = True
        mats.append(m)
    return mats


def collection(name):
    c = bpy.data.collections.get(name)
    if c:
        for obj in list(c.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Light) and data.users == 0:
                bpy.data.lights.remove(data)
    else:
        c = bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def mesh_object(name, geo, coll, mats):
    bm = bmesh.new()
    verts = [bm.verts.new(to_blender(p)) for p in geo.verts]
    for idx, mi in geo.faces:
        try:
            f = bm.faces.new([verts[i] for i in idx])
        except ValueError:
            continue
        f.material_index = mi
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def sun(coll):
    """A sun for renders in Blender; the game lights the train itself (src/render/stage.ts)."""
    data = bpy.data.lights.new('SUN_train', 'SUN')
    data.energy = 3.0
    data.color = (1.0, 0.72, 0.5)
    obj = bpy.data.objects.new('SUN_train', data)
    d = to_blender(-SUN_DIR)
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    coll.objects.link(obj)
    return obj


def collision(coll):
    for id, pts in WALK:
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'WALK_{id}', me)
        coll.objects.link(obj)
    for id, a, b, bottom, top in WALLS:
        q = [(a[0], bottom, a[1]), (b[0], bottom, b[1]), (b[0], top, b[1]), (a[0], top, a[1])]
        me = bpy.data.meshes.new(f'WALL_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in q], [], [[0, 1, 2, 3]])
        obj = bpy.data.objects.new(f'WALL_{id}', me)
        coll.objects.link(obj)
    for team, slot, p, facing in SPAWNS:
        obj = bpy.data.objects.new(f'SPAWN_T{team}_{slot}', None)
        obj.empty_display_type = 'SINGLE_ARROW'
        obj.location = to_blender(p)
        # The arrow (local +Z) points down the facing: yaw 0 looks along game +z, i.e. Blender -Y.
        obj.rotation_euler = (math.pi / 2, 0, math.pi - facing)
        obj['team'] = team
        obj['slot'] = slot
        obj['facing'] = facing
        coll.objects.link(obj)


def to_game(v):
    r = lambda x: round(x, 4) + 0.0
    return [r(v.x), r(v.z), r(-v.y)]


def export_json(coll):
    """The sim geometry, read back from the Collision helpers."""
    objs = sorted(coll.objects, key=lambda o: o.name)
    walk, walls, spawns = [], [], []
    for o in objs:
        if o.name.startswith('WALK_'):
            poly = o.data.polygons[0]
            walk.append({'id': o.name, 'points': [to_game(o.matrix_world @ o.data.vertices[i].co) for i in poly.vertices]})
        elif o.name.startswith('WALL_'):
            vs = [to_game(o.matrix_world @ v.co) for v in o.data.vertices]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('SPAWN_'):
            spawns.append({'team': int(o['team']), 'slot': int(o['slot']), 'position': to_game(o.matrix_world.translation), 'facing': round(float(o['facing']), 6)})
    return {'name': 'train', 'walk': walk, 'walls': walls, 'spawns': spawns}


def write_json(path, data):
    """Compact enough to read: one surface, wall or spawn per line."""
    def surface(w):
        return f'    {{ "id": {json.dumps(w["id"])}, "points": {json.dumps(w["points"])} }}'
    lines = ['{', '  "name": "train",', '  "walk": [']
    lines += [surface(w) + (',' if k < len(data['walk']) - 1 else '') for k, w in enumerate(data['walk'])]
    lines += ['  ],', '  "walls": [']
    lines += [f'    {json.dumps(w)}' + (',' if k < len(data['walls']) - 1 else '') for k, w in enumerate(data['walls'])]
    lines += ['  ],', '  "spawns": [']
    lines += [f'    {json.dumps(s)}' + (',' if k < len(data['spawns']) - 1 else '') for k, s in enumerate(data['spawns'])]
    lines += ['  ]', '}', '']
    with open(path, 'w', newline='\n') as f:
        f.write('\n'.join(lines))


def build():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    build_look()
    mats = materials()
    look = collection(NAME)
    helpers = collection('Collision')
    # Show only the Arena, so preview renders see it alone.
    for c in bpy.context.scene.collection.children:
        c.hide_render = c.hide_viewport = c.name not in (NAME, 'Collision')
    parts = [mesh_object(NAME, G, look, mats), mesh_object(f'{NAME}_Near', NEAR, look, mats),
             mesh_object(f'{NAME}_Far', FAR, look, mats), mesh_object(f'{NAME}_Sky', SKY, look, mats)]
    sun(look)
    collision(helpers)
    helpers.hide_render = True
    geos = (G, NEAR, FAR, SKY)
    report = {'triangles': {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts},
              'faces_dropped': sum(len(g.faces) for g in geos) - sum(len(o.data.polygons) for o in parts),
              'walk': len(WALK), 'walls': len(WALLS), 'spawns': len(SPAWNS), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        bpy.data.libraries.write(OUT_BLEND, {look, helpers}, fake_user=True)
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('TRAIN_RESULT', json.dumps(result))
