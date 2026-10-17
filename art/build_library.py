"""
Builds the library Arena in Blender: the look (a mesh with flat-colour
materials, plus candle lights) and the geometry the simulation stands
Fighters on (helper objects in a `Collision` collection). This script is the
source of truth for both (ADR 0006): re-run it to change the Arena.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_library.py").read(), {"__file__": r"C:/Repos/sword/art/build_library.py", "SAVE": False})

With SAVE = True it writes art/library.blend, public/models/arenas/library.glb
(the look) and data/arenas/library.json (the sim geometry, read back from the
Collision helpers):
  - WALK_<id>:  one planar convex face, a floor or ramp (a Walk Surface).
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights.
  - SPAWN_T<team>_<slot>: an empty where that Fighter starts, its yaw in the `facing` property.

Everything is authored in game coordinates (x east, y up, z; facing 0 looks
along +z) and placed in Blender as (x, -z, y), which the glTF export
(export_yup) turns back into game coordinates.

Layout (about 24 x 24 m, three levels):
  - ground floor (y 0): the whole room, tiled into convex pieces (centre,
    north under the gallery, west and east under the mezzanine, and a south
    alcove between the two ramps);
  - mezzanine (y 3): a U along the south, west and east walls, joined across
    the room by a central bridge (east-west); twin ramps rise from the alcove
    to it;
  - gallery (y 6): along the north wall, reached by the grand ramp from the
    bridge.
Ledges are railed with gaps (open ledges); every drop lands on a solid floor.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE = globals().get('SAVE', False)
NAME = 'Library'
OUT_BLEND = os.path.join(REPO, 'art', 'library.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'library.glb')
OUT_JSON = os.path.join(REPO, 'data', 'arenas', 'library.json')

HALF = 12.0  # the room is x, z in [-HALF, HALF]
L1 = 3.0  # mezzanine and bridge
L2 = 6.0  # gallery
CEIL = 11.0
SLAB = 0.35  # floor slab thickness
INNER = 9.0  # the mezzanine's inner edge (|x| on the west/east, z on the south)
GAL = 8.0  # the gallery's front edge (z)
BRIDGE = 1.5  # half width of the bridge and the grand ramp
RAMP_X = 1.5  # the twin ramps rise from |x| = RAMP_X (y 0) to |x| = INNER (y L1)
RAMP_Z = (-9.0, -7.0)  # the twin ramps' z range
INSET = 11.6  # bookcase fronts along the outer walls (where the outer Walls stand)
CASE = HALF - INSET  # bookcase depth
RAIL = 1.0  # balustrade height
PILLARS = [(-INNER, RAMP_Z[0]), (INNER, RAMP_Z[0]), (-INNER, GAL), (INNER, GAL)]
PILLAR = 0.3  # half width
TABLES = [(-5.0, 10.1), (5.0, 10.1)]  # reading tables (with chairs) under the gallery

rng = random.Random(7)

# name: (sRGB colour, metallic, roughness, emission strength)
MATERIALS = {
    'Plank': (0x3e2818, 0.0, 0.8, 0),
    'Plank2': (0x4b311e, 0.0, 0.8, 0),
    'Plank3': (0x33221a, 0.0, 0.8, 0),
    'Wood': (0x5c3b22, 0.0, 0.7, 0),
    'DarkWood': (0x2c1b10, 0.0, 0.7, 0),
    'Panel': (0x47301f, 0.0, 0.75, 0),
    'Stone': (0x74695b, 0.0, 0.9, 0),
    'StoneDark': (0x50483f, 0.0, 0.9, 0),
    'Plaster': (0x6b5d4a, 0.0, 0.95, 0),
    'Rug': (0x6b1d1d, 0.0, 1.0, 0),
    'RugGold': (0x9a7430, 0.0, 1.0, 0),
    'RugGreen': (0x27432d, 0.0, 1.0, 0),
    'Brass': (0xb08a3a, 0.8, 0.35, 0),
    'Iron': (0x26252a, 0.6, 0.5, 0),
    'Glass': (0x7f9cc8, 0.0, 0.2, 1.2),
    'Candle': (0xeee2c4, 0.0, 0.6, 0),
    'Flame': (0xffbf5a, 0.0, 0.5, 6.0),
    'Paper': (0xd9cba6, 0.0, 0.9, 0),
}
BOOKS = [0x7a1f1f, 0x2b4a7a, 0x2f5a35, 0x8a6a2a, 0x5a2a5a, 0x3a2716, 0x9a8a6a, 0x1f3a3a, 0x6e3b1c, 0x4a1420]
for i, c in enumerate(BOOKS):
    MATERIALS[f'Book{i}'] = (c, 0.0, 0.85, 0)
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
            pts = [c[i] for i in idx]
            if (Vector(pts[0]) - Vector(pts[2])).length < 1e-6 or (Vector(pts[1]) - Vector(pts[3])).length < 1e-6:
                continue
            base = len(self.verts)
            self.verts.extend(pts)
            self.faces.append((list(range(base, base + 4)), MAT_INDEX[mat]))

    def box(self, lo, hi, mat, skip=()):
        c = {(i, j, k): (hi[0] if i else lo[0], hi[1] if j else lo[1], hi[2] if k else lo[2]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        self.prism(c, mat, skip)

    def obox(self, centre, half, yaw, mat, skip=()):
        """A box of half extents `half`, turned `yaw` about y (its local +x then points along (cos yaw, -sin yaw) in x, z)."""
        cs, sn = math.cos(yaw), math.sin(yaw)
        c = {}
        for i in (0, 1):
            for j in (0, 1):
                for k in (0, 1):
                    x, y, z = (half[0] if i else -half[0]), (half[1] if j else -half[1]), (half[2] if k else -half[2])
                    c[(i, j, k)] = (centre[0] + x * cs + z * sn, centre[1] + y, centre[2] - x * sn + z * cs)
        self.prism(c, mat, skip)

    def beam(self, a, b, ya, yb, height, width, mat, skip=()):
        """A beam along a -> b (x, z) whose top runs from ya to yb, `height` deep and `width` wide."""
        d = Vector((b[0] - a[0], 0, b[1] - a[1]))
        d.normalize()
        side = Vector((-d.z, 0, d.x))  # d x up: keeps the frame right-handed
        c = {}
        for i, (p, y) in enumerate(((a, ya), (b, yb))):
            for j in (0, 1):
                for k in (0, 1):
                    q = Vector((p[0], y - height + j * height, p[1])) + side * ((k - 0.5) * width)
                    c[(i, j, k)] = tuple(q)
        self.prism(c, mat, skip)


G = Geo()  # the room
CEILING = Geo()  # hidden in top-down renders

# ---------------------------------------------------------------- the sim geometry

WALK = []  # (id, [(x, y, z)])
WALLS = []  # (id, (ax, az), (bx, bz), bottom, top)
SPAWNS = []  # (team, slot, (x, y, z), facing)


def walk(id, pts):
    WALK.append((id, pts))


def wall(id, a, b, bottom, top):
    WALLS.append((id, a, b, bottom, top))


def rect(x0, x1, z0, z1, y):
    return [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]


walk('floor_centre', rect(-INNER, INNER, RAMP_Z[1], GAL, 0))
walk('floor_north', rect(-INNER, INNER, GAL, HALF, 0))
walk('floor_west', rect(-HALF, -INNER, -HALF, HALF, 0))
walk('floor_east', rect(INNER, HALF, -HALF, HALF, 0))
walk('floor_alcove', rect(-RAMP_X, RAMP_X, -HALF, RAMP_Z[1], 0))
walk('ramp_west', [(-RAMP_X, 0, RAMP_Z[0]), (-RAMP_X, 0, RAMP_Z[1]), (-INNER, L1, RAMP_Z[1]), (-INNER, L1, RAMP_Z[0])])
walk('ramp_east', [(RAMP_X, 0, RAMP_Z[0]), (INNER, L1, RAMP_Z[0]), (INNER, L1, RAMP_Z[1]), (RAMP_X, 0, RAMP_Z[1])])
walk('mezz_south', rect(-HALF, HALF, -HALF, RAMP_Z[0], L1))
walk('mezz_west', rect(-HALF, -INNER, RAMP_Z[0], GAL, L1))
walk('mezz_east', rect(INNER, HALF, RAMP_Z[0], GAL, L1))
walk('bridge', rect(-INNER, INNER, -BRIDGE, BRIDGE, L1))
walk('ramp_grand', [(-BRIDGE, L1, BRIDGE), (BRIDGE, L1, BRIDGE), (BRIDGE, L2, GAL), (-BRIDGE, L2, GAL)])
walk('gallery', rect(-HALF, HALF, GAL, HALF, L2))

# Outer walls, at the bookcase fronts.
wall('outer_west', (-INSET, -INSET), (-INSET, INSET), -1, CEIL)
wall('outer_east', (INSET, -INSET), (INSET, INSET), -1, CEIL)
wall('outer_south', (-INSET, -INSET), (INSET, -INSET), -1, CEIL)
wall('outer_north', (-INSET, INSET), (INSET, INSET), -1, CEIL)

# Under the twin ramps and the south mezzanine beside them: solid.
for s, side in ((-1, 'west'), (1, 'east')):
    wall(f'ramp_{side}_front', (s * RAMP_X, RAMP_Z[1]), (s * INNER, RAMP_Z[1]), 0, L1 + RAIL)  # the room side, and its rail
    wall(f'ramp_{side}_back', (s * RAMP_X, RAMP_Z[0]), (s * INNER, RAMP_Z[0]), 0, L1 + RAIL)  # under the mezzanine edge, and its rail
    wall(f'ramp_{side}_alcove', (s * RAMP_X, -INSET), (s * RAMP_X, RAMP_Z[0]), 0, L1 - 0.5)
    # The ramp's top end (and the block beside it): low enough that a Fighter walking up the ramp clears it.
    wall(f'ramp_{side}_end', (s * INNER, -INSET), (s * INNER, RAMP_Z[1]), 0, 2.2)

# Mezzanine rails, with gaps (open ledges).
wall('rail_west_a', (-INNER, RAMP_Z[1]), (-INNER, -BRIDGE), L1, L1 + RAIL)
wall('rail_west_b', (-INNER, BRIDGE), (-INNER, 3.5), L1, L1 + RAIL)
wall('rail_west_c', (-INNER, 5.0), (-INNER, GAL), L1, L1 + RAIL)
wall('rail_west_end', (-INSET, GAL), (-INNER, GAL), L1, L1 + RAIL)
wall('rail_east_a', (INNER, RAMP_Z[1]), (INNER, -5.0), L1, L1 + RAIL)
wall('rail_east_b', (INNER, -3.5), (INNER, -BRIDGE), L1, L1 + RAIL)
wall('rail_east_c', (INNER, BRIDGE), (INNER, GAL), L1, L1 + RAIL)
wall('rail_east_end', (INNER, GAL), (INSET, GAL), L1, L1 + RAIL)
# Bridge rails: open beside the grand ramp's foot and at a gap on each side.
wall('rail_bridge_south_a', (-INNER, -BRIDGE), (-6.0, -BRIDGE), L1, L1 + RAIL)
wall('rail_bridge_south_b', (-4.5, -BRIDGE), (INNER, -BRIDGE), L1, L1 + RAIL)
wall('rail_bridge_north_a', (-INNER, BRIDGE), (-BRIDGE, BRIDGE), L1, L1 + RAIL)
wall('rail_bridge_north_b', (BRIDGE, BRIDGE), (4.5, BRIDGE), L1, L1 + RAIL)
wall('rail_bridge_north_c', (6.0, BRIDGE), (INNER, BRIDGE), L1, L1 + RAIL)
# The grand ramp's rails.
wall('rail_grand_west', (-BRIDGE, BRIDGE), (-BRIDGE, GAL), L1, L2 + RAIL)
wall('rail_grand_east', (BRIDGE, BRIDGE), (BRIDGE, GAL), L1, L2 + RAIL)
# Gallery rail, open at the grand ramp's head and at one gap.
wall('rail_gallery_a', (-INSET, GAL), (-BRIDGE, GAL), L2, L2 + RAIL)
wall('rail_gallery_b', (BRIDGE, GAL), (6.5, GAL), L2, L2 + RAIL)
wall('rail_gallery_c', (8.0, GAL), (INSET, GAL), L2, L2 + RAIL)

for k, (px, pz) in enumerate(PILLARS):
    p = PILLAR
    corners = [(px - p, pz - p), (px + p, pz - p), (px + p, pz + p), (px - p, pz + p)]
    for e in range(4):
        wall(f'pillar{k}_{e}', corners[e], corners[(e + 1) % 4], -1, CEIL)

for k, (tx, tz) in enumerate(TABLES):
    hx, hz = 1.6, 0.85  # the table and its chairs
    corners = [(tx - hx, tz - hz), (tx + hx, tz - hz), (tx + hx, tz + hz), (tx - hx, tz + hz)]
    for e in range(4):
        wall(f'table{k}_{e}', corners[e], corners[(e + 1) % 4], 0, 1.0)

# The two teams face each other across the open floor south of the bridge, clear of anything overhead.
for slot, z in enumerate((-4.5, -3.0, -6.0)):
    SPAWNS.append((0, slot, (-4.5 - 0.5 * (slot > 0), 0.0, z), math.pi / 2))
    SPAWNS.append((1, slot, (4.5 + 0.5 * (slot > 0), 0.0, -9.0 - z if slot else z), -math.pi / 2))

# ---------------------------------------------------------------- the look


def planks(x0, x1, z0, z1, y, along='x', width=0.32):
    """Floorboards as coloured strips on the plane y (over a slab whose top is just below)."""
    (a0, a1), (b0, b1) = ((x0, x1), (z0, z1)) if along == 'x' else ((z0, z1), (x0, x1))
    b = b0
    row = 0
    while b < b1 - 1e-6:
        bw = min(width, b1 - b)
        a = a0 - rng.uniform(0, 2.0) if row % 2 else a0
        while a < a1 - 1e-6:
            n = min(a1, a + rng.uniform(1.8, 4.2))
            s, e = max(a, a0), n
            mat = rng.choice(['Plank', 'Plank2', 'Plank3'])
            if along == 'x':
                G.face([(s, y, b), (s, y, b + bw), (e, y, b + bw), (e, y, b)], mat, (0, 1, 0))
            else:
                G.face([(b, y, s), (b + bw, y, s), (b + bw, y, e), (b, y, e)], mat, (0, 1, 0))
            a = n
        b += bw
        row += 1


def slab(x0, x1, z0, z1, y, along='x'):
    G.box((x0, y - SLAB, z0), (x1, y - 0.005, z1), 'DarkWood', skip=('+y',))
    G.face([(x0, y - 0.005, z0), (x0, y - 0.005, z1), (x1, y - 0.005, z1), (x1, y - 0.005, z0)], 'Plank3', (0, 1, 0))
    planks(x0, x1, z0, z1, y, along)


def ramp_boards(p0, p1, p2, p3, n):
    """Boards across a ramp from its foot edge (p0, p1) to its head edge (p3, p2)."""
    lerp = lambda a, b, t: tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
    for k in range(n):
        t0, t1 = k / n, (k + 1) / n
        q = [lerp(p0, p3, t0), lerp(p1, p2, t0), lerp(p1, p2, t1), lerp(p0, p3, t1)]
        q = [(x, y + 0.01, z) for x, y, z in q]
        G.face(q, ['Plank', 'Plank2', 'Plank3'][k % 3], (0, 1, 0))


def balustrade(a, b, ya, yb, posts=True):
    """A wooden balustrade along a -> b whose foot runs from ya to yb."""
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    G.beam(a, b, ya + RAIL, yb + RAIL, 0.08, 0.12, 'Wood')  # handrail
    G.beam(a, b, ya + 0.12, yb + 0.12, 0.06, 0.08, 'DarkWood')  # foot rail
    if not posts:
        return
    n = max(1, round(length / 0.45))
    for k in range(n + 1):
        t = k / n
        x, z, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ya + (yb - ya) * t
        thick = 0.06 if 0 < k < n and k % 4 else 0.11
        G.box((x - thick, y, z - thick), (x + thick, y + RAIL - 0.05, z + thick), 'Wood' if thick > 0.06 else 'DarkWood', skip=('-y',))


def books_row(start, direction, normal, length, y, depth_back):
    """Books standing on a shelf at height y, along `direction` from `start`, spines facing `normal`."""
    s = 0.02
    while s < length - 0.05:
        if rng.random() < 0.05:
            s += rng.uniform(0.1, 0.3)  # a gap
            continue
        w = min(rng.uniform(0.06, 0.16), length - s - 0.02)
        if w < 0.04:
            break
        h = rng.uniform(0.22, 0.36)
        d = rng.uniform(0.2, 0.25)
        mat = f'Book{rng.randrange(len(BOOKS))}'
        # corners: back (at depth_back from the wall plane) to front, along s .. s + w
        def at(u, v, yy):
            return (start[0] + direction[0] * u + normal[0] * v, yy, start[1] + direction[1] * u + normal[1] * v)
        f0, f1 = depth_back + d, depth_back
        G.face([at(s, f0, y), at(s + w, f0, y), at(s + w, f0, y + h), at(s, f0, y + h)], mat, (normal[0], 0, normal[1]))
        G.face([at(s, f1, y + h), at(s + w, f1, y + h), at(s + w, f0, y + h), at(s, f0, y + h)], mat, (0, 1, 0))
        s += w + rng.uniform(0.0, 0.01)


def bookcase(start, direction, length, y0, height, ladder_at=None):
    """A run of bookcases against an outer wall: from `start` (on the wall plane) along `direction`, facing into the room."""
    normal = (direction[1], -direction[0])  # right of the direction: into the room
    end = (start[0] + direction[0] * length, start[1] + direction[1] * length)

    def at(u, v):
        return (start[0] + direction[0] * u + normal[0] * v, start[1] + direction[1] * u + normal[1] * v)

    # back panel
    p0, p1 = at(0, 0.02), at(length, 0.02)
    G.face([(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y0 + height, p1[1]), (p0[0], y0 + height, p0[1])], 'DarkWood', (normal[0], 0, normal[1]))
    mid0, mid1 = at(0, CASE / 2), at(length, CASE / 2)
    G.beam(mid0, mid1, y0 + 0.12, y0 + 0.12, 0.12, CASE, 'Wood', skip=('-y',))  # plinth
    G.beam(mid0, mid1, y0 + height, y0 + height, 0.1, CASE + 0.04, 'Wood')  # cornice
    rows = max(1, int((height - 0.25) / 0.42))
    pitch = (height - 0.22) / rows
    for r in range(rows):
        y = y0 + 0.12 + r * pitch
        if r > 0:
            G.beam(mid0, mid1, y, y, 0.03, CASE, 'Wood')
        books_row(start, direction, normal, length, y, 0.04)
    bays = max(1, round(length / 1.1))
    for k in range(bays + 1):
        u = length * k / bays
        u = min(max(u, 0.03), length - 0.03)
        c = at(u, CASE / 2)
        G.obox((c[0], y0 + height / 2, c[1]), (0.03, height / 2, CASE / 2), math.atan2(-direction[1], direction[0]), 'Wood', skip=('-y', '+y'))
    if ladder_at is not None:
        ladder(at(ladder_at, CASE + 0.05), at(ladder_at, 0.02), direction, y0, height)


def ladder(foot, top, direction, y0, height):
    """A rolling library ladder leaning on a bookcase: two rails and rungs."""
    foot = (foot[0] + (foot[0] - top[0]) * 0.6, foot[1] + (foot[1] - top[1]) * 0.6)
    for side in (-0.22, 0.22):
        a = (foot[0] + direction[0] * side, foot[1] + direction[1] * side)
        b = (top[0] + direction[0] * side, top[1] + direction[1] * side)
        lo = Vector((a[0], y0, a[1]))
        hi = Vector((b[0], y0 + height - 0.1, b[1]))
        rail_between(lo, hi, 0.025, 'Wood')
    n = int((height - 0.3) / 0.32)
    for k in range(1, n + 1):
        t = k / (n + 1)
        c = (foot[0] + (top[0] - foot[0]) * t, foot[1] + (top[1] - foot[1]) * t)
        G.obox((c[0], y0 + (height - 0.1) * t, c[1]), (0.22, 0.015, 0.02), math.atan2(-direction[1], direction[0]), 'DarkWood')


def rail_between(lo, hi, r, mat):
    """A square rod from lo to hi (any direction)."""
    d = hi - lo
    up = Vector((0, 1, 0)) if abs(d.normalized().y) < 0.99 else Vector((1, 0, 0))
    x = d.normalized()
    z = x.cross(up).normalized()
    y = z.cross(x).normalized()
    c = {}
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                p = (hi if i else lo) + y * ((j - 0.5) * 2 * r) + z * ((k - 0.5) * 2 * r)
                c[(i, j, k)] = tuple(p)
    G.prism(c, mat)


def arch_window(centre, normal_axis, sign, sill, width, height, geo=G):
    """An arched window in an outer wall: glass, stone frame, mullion. `normal_axis` 'x' or 'z' is the wall's axis; sign points into the room."""
    hw = width / 2
    spring = sill + height - hw  # where the arch starts
    wall_c = HALF - 0.02

    def p(u, y, depth=0.0):
        d = sign * (wall_c - depth) * -1  # the wall plane, pulled into the room by depth
        return (d, y, centre + u) if normal_axis == 'x' else (centre + u, y, d)

    inward = (sign, 0, 0) if normal_axis == 'x' else (0, 0, sign)
    # glass: a rectangle and a fan for the arch
    geo.face([p(-hw, sill), p(hw, sill), p(hw, spring), p(-hw, spring)], 'Glass', inward)
    n = 8
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        geo.face([p(0, spring), p(hw * math.cos(a0), spring + hw * math.sin(a0)), p(hw * math.cos(a1), spring + hw * math.sin(a1))], 'Glass', inward)
    # frame
    t = 0.12
    yaw = 0.0 if normal_axis == 'z' else math.pi / 2

    def frame_box(u, y, hu, hy):
        c = p(u, y, 0.06)
        geo.obox(c, (hu, hy, 0.08), yaw, 'Stone')

    frame_box(-hw - t / 2, (sill + spring) / 2, t / 2, (spring - sill) / 2)
    frame_box(hw + t / 2, (sill + spring) / 2, t / 2, (spring - sill) / 2)
    frame_box(0, sill - t / 2, hw + t, t / 2)
    frame_box(0, (sill + spring) / 2 + hw / 2, 0.03, (spring - sill) / 2 + hw / 2)  # mullion
    frame_box(0, spring, hw, 0.03)  # transom
    for k in range(n):
        a = math.pi * (k + 0.5) / n
        u, y = (hw + t / 2) * math.cos(a), spring + (hw + t / 2) * math.sin(a)
        seg = (hw + t) * math.pi / n / 2 + 0.01
        # a short box tangent to the arch (rotated in the wall plane)
        tangent = Vector((-math.sin(a), math.cos(a)))
        lo_u, lo_y = u - tangent.x * seg, y - tangent.y * seg
        hi_u, hi_y = u + tangent.x * seg, y + tangent.y * seg
        lo, hi = Vector(p(lo_u, lo_y, 0.06)), Vector(p(hi_u, hi_y, 0.06))
        rail_between(lo, hi, t / 2, 'Stone')


def outer_wall(axis, sign):
    """An outer wall's inner face (stone above, panelled below), facing into the room."""
    w = HALF
    inward = (-sign, 0, 0) if axis == 'x' else (0, 0, -sign)
    c = sign * w
    if axis == 'x':
        G.face([(c, 0, -w), (c, 0, w), (c, CEIL, w), (c, CEIL, -w)], 'Plaster', inward)
    else:
        G.face([(-w, 0, c), (w, 0, c), (w, CEIL, c), (-w, CEIL, c)], 'Plaster', inward)


def pillar(x, z):
    p = PILLAR
    G.box((x - p - 0.08, 0, z - p - 0.08), (x + p + 0.08, 0.3, z + p + 0.08), 'StoneDark', skip=('-y',))
    G.box((x - p, 0.3, z - p), (x + p, CEIL - 0.4, z + p), 'Stone', skip=('-y', '+y'))
    for y in (L1 - 0.2, L2 - 0.2):
        G.box((x - p - 0.06, y - 0.15, z - p - 0.06), (x + p + 0.06, y + 0.05, z + p + 0.06), 'StoneDark')
    G.box((x - p - 0.12, CEIL - 0.4, z - p - 0.12), (x + p + 0.12, CEIL, z + p + 0.12), 'StoneDark', skip=('+y',))
    # a sconce on the room side
    candle(x - math.copysign(p + 0.12, x), 2.2, z, 'Brass')


def candle(x, y, z, holder='Brass'):
    G.box((x - 0.07, y - 0.03, z - 0.07), (x + 0.07, y, z + 0.07), holder)
    G.box((x - 0.025, y, z - 0.025), (x + 0.025, y + 0.16, z + 0.025), 'Candle', skip=('-y',))
    G.obox((x, y + 0.2, z), (0.018, 0.04, 0.018), math.pi / 4, 'Flame', skip=('-y',))


def table(tx, tz):
    G.box((tx - 1.2, 0.74, tz - 0.5), (tx + 1.2, 0.8, tz + 0.5), 'Wood')
    for sx in (-1, 1):
        for sz in (-1, 1):
            G.box((tx + sx * 1.1 - 0.05, 0, tz + sz * 0.4 - 0.05), (tx + sx * 1.1 + 0.05, 0.74, tz + sz * 0.4 + 0.05), 'DarkWood', skip=('-y', '+y'))
    for cx in (-0.6, 0.6):
        for sz in (-1, 1):
            cz = tz + sz * 0.72
            G.box((tx + cx - 0.22, 0.42, cz - 0.2), (tx + cx + 0.22, 0.47, cz + 0.2), 'Wood')
            G.box((tx + cx - 0.22, 0.47, cz + sz * 0.17 - 0.03), (tx + cx + 0.22, 1.0, cz + sz * 0.17 + 0.03), 'Wood')
            for lx in (-0.18, 0.18):
                for lz in (-0.16, 0.16):
                    G.box((tx + cx + lx - 0.025, 0, cz + lz - 0.025), (tx + cx + lx + 0.025, 0.42, cz + lz + 0.025), 'DarkWood', skip=('-y', '+y'))
    candle(tx - 0.7, 0.8, tz, 'Brass')
    candle(tx + 0.8, 0.8, tz - 0.1, 'Brass')
    # open books and a stack
    G.box((tx - 0.2, 0.8, tz - 0.15), (tx + 0.25, 0.83, tz + 0.15), 'Paper')
    for k in range(4):
        G.obox((tx + 0.5, 0.8 + 0.05 * k + 0.025, tz + 0.2), (0.14, 0.025, 0.1), rng.uniform(-0.3, 0.3), f'Book{rng.randrange(len(BOOKS))}')


def rug(x0, x1, z0, z1):
    G.face([(x0, 0.006, z0), (x0, 0.006, z1), (x1, 0.006, z1), (x1, 0.006, z0)], 'Rug', (0, 1, 0))
    b = 0.35
    G.face([(x0 + b, 0.008, z0 + b), (x0 + b, 0.008, z1 - b), (x1 - b, 0.008, z1 - b), (x1 - b, 0.008, z0 + b)], 'RugGold', (0, 1, 0))
    b = 0.5
    G.face([(x0 + b, 0.01, z0 + b), (x0 + b, 0.01, z1 - b), (x1 - b, 0.01, z1 - b), (x1 - b, 0.01, z0 + b)], 'Rug', (0, 1, 0))
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    r = min(x1 - x0, z1 - z0) / 4
    pts = [(cx + r * math.cos(2 * math.pi * k / 12), 0.012, cz + r * math.sin(2 * math.pi * k / 12)) for k in range(12)]
    G.face(pts, 'RugGreen', (0, 1, 0))


CHANDELIER = (0.0, 8.6, -3.5)


def chandelier():
    cx, cy, cz = CHANDELIER
    rail_between(Vector((cx, cy + 0.3, cz)), Vector((cx, CEIL, cz)), 0.025, 'Iron')
    G.box((cx - 0.12, cy - 0.2, cz - 0.12), (cx + 0.12, cy + 0.35, cz + 0.12), 'Brass')
    for ring, r, n in ((0, 1.3, 16), (1, 0.7, 10)):
        y = cy - 0.05 * ring
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            rail_between(Vector((cx + r * math.cos(a0), y, cz + r * math.sin(a0))), Vector((cx + r * math.cos(a1), y, cz + r * math.sin(a1))), 0.03, 'Brass')
        for k in range(0, n, 2):
            a = 2 * math.pi * (k + 0.5) / n
            candle(cx + r * math.cos(a), y + 0.03, cz + r * math.sin(a), 'Brass')
        for k in range(4):
            a = math.pi / 2 * k + math.pi / 4
            rail_between(Vector((cx, cy + 0.3, cz)), Vector((cx + r * math.cos(a), y, cz + r * math.sin(a))), 0.015, 'Brass')


def build_look():
    # Ground floor and rugs.
    G.box((-HALF, -0.3, -HALF), (HALF, -0.005, HALF), 'DarkWood', skip=('-y',))
    planks(-HALF, HALF, -HALF, HALF, 0, 'x')
    rug(-5.5, 5.5, -6.5, 6.5)
    rug(-11.3, -9.6, -6, 6)
    rug(9.6, 11.3, -6, 6)

    # Mezzanine, bridge and gallery slabs, their fascias, and the brackets under them.
    slab(-HALF, HALF, -HALF, RAMP_Z[0], L1, 'x')
    slab(-HALF, -INNER, RAMP_Z[0], GAL, L1, 'z')
    slab(INNER, HALF, RAMP_Z[0], GAL, L1, 'z')
    slab(-INNER, INNER, -BRIDGE, BRIDGE, L1, 'x')
    slab(-HALF, HALF, GAL, HALF, L2, 'x')
    for (a, b, y) in (((-INNER, RAMP_Z[0]), (-INNER, GAL), L1), ((INNER, RAMP_Z[0]), (INNER, GAL), L1),
                      ((-INNER, -BRIDGE), (INNER, -BRIDGE), L1), ((-INNER, BRIDGE), (INNER, BRIDGE), L1),
                      ((-HALF, GAL), (HALF, GAL), L2), ((-HALF, GAL), (-INNER, GAL), L1), ((INNER, GAL), (HALF, GAL), L1)):
        G.beam(a, b, y - SLAB + 0.02, y - SLAB + 0.02, 0.3, 0.2, 'Wood')
    # Joists under the bridge (well above head height).
    for zs in (-BRIDGE + 0.25, 0.0, BRIDGE - 0.25):
        G.beam((-INNER, zs), (INNER, zs), L1 - SLAB, L1 - SLAB, 0.2, 0.14, 'DarkWood', skip=('+y',))
    # Iron brackets under the mezzanine edges.
    for z in (-6.0, -3.0, 3.0, 6.0):
        for s in (-1, 1):
            rail_between(Vector((s * HALF, L1 - 1.4, z)), Vector((s * (INNER + 0.2), L1 - SLAB, z)), 0.04, 'Iron')

    # The twin ramps: solid wedges (and the block under the mezzanine beside them), boards, panels.
    for s in (-1, 1):
        x0, x1 = s * RAMP_X, s * INNER
        z0, z1 = RAMP_Z
        lo, hi = (x0, x1) if s > 0 else (x1, x0)
        # solid block behind (under the south mezzanine)
        G.box((min(x0, x1), 0, -HALF), (max(x0, x1), L1 - SLAB, z0), 'Panel')
        # the wedge: corners keyed (i along x, j up, k along z)
        def h(x):
            return L1 * (abs(x) - RAMP_X) / (INNER - RAMP_X)
        c = {(i, j, k): ((lo, hi)[i], h((lo, hi)[i]) * j, (z0, z1)[k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        G.prism(c, 'Panel', skip=('-y',))
        foot = [(x0, 0, z0), (x0, 0, z1), (x1, L1, z1), (x1, L1, z0)]
        ramp_boards(foot[0], foot[1], foot[2], foot[3], 16)
        balustrade((x0, z1 - 0.06), (x1, z1 - 0.06), 0, L1)
        balustrade((x0, z0 + 0.06), (x1, z0 + 0.06), 0, L1)
        # the front panel's moulding
        G.beam((x0, z1 + 0.02), (x1, z1 + 0.02), 0.25, 0.25, 0.25, 0.06, 'Wood')

    # The grand ramp: a sloped slab with stringers, from the bridge up to the gallery.
    p0, p1, p2, p3 = (-BRIDGE, L1, BRIDGE), (BRIDGE, L1, BRIDGE), (BRIDGE, L2, GAL), (-BRIDGE, L2, GAL)
    c = {}
    for i, x in enumerate((-BRIDGE, BRIDGE)):
        for k, (z, y) in enumerate(((BRIDGE, L1), (GAL, L2))):
            c[(i, 1, k)] = (x, y - 0.005, z)
            c[(i, 0, k)] = (x, y - SLAB, z)
    G.prism(c, 'DarkWood', skip=('+y',))
    ramp_boards(p0, p1, p2, p3, 14)
    for x in (-BRIDGE, BRIDGE):
        G.beam((x, BRIDGE), (x, GAL), L1 + 0.05, L2 + 0.05, 0.5, 0.14, 'Wood')
        balustrade((x, BRIDGE), (x, GAL), L1, L2)

    # Balustrades along every railed ledge (the sim Walls named rail_*).
    for id, a, b, bottom, top in WALLS:
        if id.startswith('rail_') and not id.startswith('rail_grand'):
            balustrade(a, b, bottom, bottom)

    # Outer walls with bookcases, ladders and windows.
    for axis in ('x', 'z'):
        for sign in (-1, 1):
            outer_wall(axis, sign)
    # West and east walls: under the mezzanine, tall under the gallery, on the mezzanine and on the gallery.
    for s in (-1, 1):
        if s < 0:
            bookcase((-HALF, -HALF), (0, 1), HALF + GAL, 0, L1 - SLAB - 0.05, ladder_at=12.0)
            bookcase((-HALF, GAL), (0, 1), HALF - GAL, 0, L2 - SLAB - 0.05, ladder_at=2.0)
            bookcase((-HALF, -HALF + CASE), (0, 1), HALF + GAL - CASE, L1, 2.6, ladder_at=11.0)
            bookcase((-HALF, GAL), (0, 1), HALF - GAL, L2, 2.6)
        else:
            bookcase((HALF, GAL), (0, -1), HALF + GAL, 0, L1 - SLAB - 0.05, ladder_at=9.0)
            bookcase((HALF, HALF), (0, -1), HALF - GAL, 0, L2 - SLAB - 0.05, ladder_at=2.0)
            bookcase((HALF, GAL), (0, -1), HALF + GAL - CASE, L1, 2.6)
            bookcase((HALF, HALF), (0, -1), HALF - GAL, L2, 2.6)
    # South wall: the mezzanine level all along; on the ground, only the alcove's back and the corners.
    bookcase((HALF, -HALF), (-1, 0), 2 * HALF, L1, 2.6, ladder_at=6.0)
    bookcase((RAMP_X, -HALF), (-1, 0), 2 * RAMP_X, 0, L1 - SLAB - 0.05)
    bookcase((HALF, -HALF), (-1, 0), HALF - INNER, 0, L1 - SLAB - 0.05)
    bookcase((-INNER, -HALF), (-1, 0), HALF - INNER, 0, L1 - SLAB - 0.05)
    # North wall: tall under the gallery, and on the gallery.
    bookcase((-HALF + CASE, HALF), (1, 0), 2 * (HALF - CASE), 0, L2 - SLAB - 0.05, ladder_at=16.0)
    bookcase((-HALF + CASE, HALF), (1, 0), 2 * (HALF - CASE), L2, 2.4, ladder_at=5.0)
    # Windows: tall arches above the mezzanine (west, east, south), small ones above the gallery's bookcases.
    for z in (-8.0, -4.0, 0.0, 4.0):
        arch_window(z, 'x', 1, 6.3, 1.5, 3.9)
        arch_window(z, 'x', -1, 6.3, 1.5, 3.9)
    for x in (-8.0, -4.0, 0.0, 4.0, 8.0):
        arch_window(x, 'z', 1, 6.3, 1.5, 3.9)
        arch_window(x, 'z', -1, 8.8, 1.3, 1.9)

    for x, z in PILLARS:
        pillar(x, z)
    for tx, tz in TABLES:
        table(tx, tz)
    chandelier()

    # Ceiling and its beams (a separate object, hidden in top-down renders).
    CEILING.face([(-HALF, CEIL, -HALF), (HALF, CEIL, -HALF), (HALF, CEIL, HALF), (-HALF, CEIL, HALF)], 'DarkWood', (0, -1, 0))
    for k in range(9):
        x = -HALF + 3 * k
        CEILING.box((x - 0.15, CEIL - 0.45, -HALF), (x + 0.15, CEIL, HALF), 'Wood', skip=('+y',))
    CEILING.box((-HALF, CEIL - 0.6, -0.2), (HALF, CEIL - 0.45, 0.2), 'Wood', skip=('+y',))


# ---------------------------------------------------------------- Blender objects

def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def materials():
    mats = []
    for name, (colour, metal, rough, emit) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Emission Color'].default_value = rgba if emit else (0, 0, 0, 1)
        bsdf.inputs['Emission Strength'].default_value = float(emit)
        m.diffuse_color = rgba
        m.use_backface_culling = True
        mats.append(m)
    return mats


def srgb(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), 1.0)


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


def lights(coll):
    out = []

    def point(name, p, energy, radius=0.1, colour=(1.0, 0.72, 0.42)):
        data = bpy.data.lights.new(name, 'POINT')
        data.energy = energy
        data.color = colour
        data.shadow_soft_size = radius
        obj = bpy.data.objects.new(name, data)
        obj.location = to_blender(p)
        coll.objects.link(obj)
        out.append(obj)

    point('LIGHT_chandelier', (CHANDELIER[0], CHANDELIER[1] - 0.3, CHANDELIER[2]), 900, 1.0)
    for k, (x, z) in enumerate(PILLARS):
        sx = x - math.copysign(PILLAR + 0.12, x)
        point(f'LIGHT_sconce{k}', (sx, 2.6, z), 120)
    for k, (tx, tz) in enumerate(TABLES):
        point(f'LIGHT_table{k}', (tx, 1.3, tz), 80)
    point('LIGHT_gallery', (0, L2 + 2.2, 10.5), 250, 0.5)
    return out


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
    data = {'name': 'library', 'walk': walk, 'walls': walls, 'spawns': spawns}
    return data


def write_json(path, data):
    """Compact enough to read: one point, wall or spawn per line."""
    lines = ['{', '  "name": "library",', '  "walk": [']
    lines += [f'    {{ "id": {json.dumps(w["id"])}, "points": {json.dumps(w["points"])} }}' + (',' if k < len(data['walk']) - 1 else '') for k, w in enumerate(data['walk'])]
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
    room = mesh_object(NAME, G, look, mats)
    ceiling = mesh_object(f'{NAME}.Ceiling', CEILING, look, mats)
    lamps = lights(look)
    collision(helpers)
    helpers.hide_render = True
    triangles = sum(len(p.vertices) - 2 for o in (room, ceiling) for p in o.data.polygons)
    report = {'triangles': triangles, 'walk': len(WALK), 'walls': len(WALLS), 'spawns': len(SPAWNS), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in [room, ceiling, *lamps]:
            o.select_set(True)
        bpy.context.view_layer.objects.active = room
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=True, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        bpy.data.libraries.write(OUT_BLEND, {look, helpers}, fake_user=True)
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
