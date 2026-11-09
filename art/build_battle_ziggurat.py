"""
Builds the Ziggurat, the second hand-built Battle map (docs/plans/battle-objectives.md, Stage 5; ADR 0022), in Blender: the look (a mesh
with flat-colour materials) and the geometry the Simulation reads (helper objects in a `Collision` collection). This script is the source of
truth for both (ADR 0006): re-run it to change the map.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_battle_ziggurat.py").read(), {"__file__": r"C:/Repos/sword/art/build_battle_ziggurat.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_battle_ziggurat.py').read(), {'__file__': r'C:/Repos/sword/art/build_battle_ziggurat.py', 'SAVE': True})"

With SAVE = True it writes public/models/arenas/battle_ziggurat.glb (the look) and data/battlemaps/ziggurat.json (the Battle map, read
back from the Collision helpers). The helpers are the Fort's (art/build_battle_fort.py): WALK_* (Walk Surfaces), WALL_* (Walls), OBJ_*
(Objectives: weight, owner, spawn and, new here, `y`, the height of the level it stands on when another Walk Surface lies over it),
BASE_T<team> and DEPLOY. This map has no BLOCK_*: every solid part of it is a raised Walk Surface with no ground under it, Walls on its
faces and a rail on its edge (the Fort's keep, ADR 0022), so no Soldier is ever pushed out of anything.

Everything is authored in game coordinates (x east, y up, z toward Team 1; facing 0 looks along +z) and placed in Blender as (x, -z, y),
which the glTF export (export_yup) turns back into game coordinates.

The map: a four-tier stepped temple, 96 m at its foot, in the middle of a jungle of rolling hills. Each tier is 12 m narrower than the one
under it and 4 m taller, so its terraces ("floors") are at 4, 8 and 12 m, and the summit at 16 m. A straight 6 m ramp climbs each of the four
faces from the ground to the summit, each on the terrace in front of its tier (9 m long, a 3 m landing between). The inside is one hollow hall 48 m square (the plaza, on the
ground, with B at its centre) under the third tier, reached by a 6 m corridor through the foot of each face. Along its south and north walls
a ramp climbs to a 6 m corridor through the second tier that opens on the first terrace (floor 1); along its east and west walls a long
ramp climbs to a doorway on the second terrace (floor 2). The Objectives: A and D at two opposite corners of the second terrace, B in the
plaza, C on the summit (B and C share their x and z, and differ in `y`). The map is its own half turn (the armies are a half turn of each
other): every Walk Surface and Wall has its half turn among them, and Objective k mirrors Objective 3 - k in x and z.

The floor plan is one raster of 3 m cells over the 120 m square round the temple (`LEVELS`: per height, the cells that have a floor
there); the Walk Surfaces, Walls and look are read off it. A cell is present at its height where the ground, a terrace, a hall floor or a
balcony is. The ramps stand over cells with no floor at their height, outside the raster.
"""
import json
import math
import os
import random

try:
    import bmesh
    import bpy
    from mathutils import Vector
except ImportError:  # the geometry below runs without Blender (a quick check of the numbers)
    bpy = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if '__file__' in globals() else os.getcwd()
SAVE = globals().get('SAVE', False)
NAME = 'Ziggurat'
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'battle_ziggurat.glb')
OUT_JSON = os.path.join(REPO, 'data', 'battlemaps', 'ziggurat.json')

HALF = 100.0  # the field's half side (battle.field.size / 2)
FRONT = 58.0  # Team 0's front rank stands at z = -FRONT: clear of the temple's foot (z = -48) and its ramps
BASE = 88.0  # each Team's Base, behind its deployment
ARMY_SIZE = {'standard': 144, 'max': 144}  # as the Fort's: a whole Match Tick costs 1.4 ms at 144 v 144 (the Fort's 2.1); 200 v 200 cost 1.9 ms but its Rollback soak, run on a loaded machine, was far over the gate (Stage 5)
TICKETS = 2.4

U = 3.0  # the raster's cell (m)
DOMAIN = 60.0  # the raster covers the square of half side 60 m: the temple (48 m) and its flat apron
TIER = 12.0  # each tier is this much narrower than the one under it
RISE = 4.0  # and this much taller (above a Soldier's drop, battle.levels.drop, 3 m, so nobody drops off a terrace)
RAIL = 1.0  # a parapet's height above its floor
WIDE = 6.0  # corridors and ramps
RUN = 9.0  # a ramp's length: 4 m up in 9 (the Fort's slope)
EPS = 1e-6

rng = random.Random(11)

# name: (sRGB colour, roughness, double sided; the export is double sided throughout, so a face seen from behind is never missing)
MATERIALS = {
    'Stone': (0x8f8473, 1.0, False),
    'StoneDark': (0x6b5f50, 1.0, False),
    'StoneLight': (0xb3a68d, 1.0, False),
    'Wall': (0x8a7e6c, 1.0, True),
    'WallTop': (0xb09f84, 1.0, True),
    'Moss': (0x5f7048, 1.0, False),
    'Plaza': (0x7d7260, 1.0, False),
    'Gold': (0xc9a227, 1.0, False),
    'Fire': (0xe8742c, 1.0, False),
    'Grass0': (0x4f6b34, 1.0, False),
    'Grass1': (0x5e7a3b, 1.0, False),
    'Grass2': (0x6f8a45, 1.0, False),
    'Dirt': (0x7d6a4f, 1.0, False),
    'Bark': (0x4a3826, 1.0, False),
    'Leaf0': (0x2f5a2c, 1.0, False),
    'Leaf1': (0x3f7433, 1.0, False),
    'Leaf2': (0x264a2a, 1.0, False),
    'Wood': (0x5a4330, 1.0, False),
    'Banner0': (0xf1c40f, 1.0, False),
    'Banner1': (0x2e86c1, 1.0, False),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- the raster (game coordinates)

N = int(DOMAIN / U)  # cells each side of the centre


def centre(i):
    return (i + 0.5) * U


def mass_top(xc, zc):
    """The height of the temple's top at (xc, zc): the highest tier whose square holds it (0 off the temple)."""
    r = max(abs(xc), abs(zc))
    top = 0.0
    for k in range(4):
        if r < 48.0 - TIER * k:
            top = RISE * (k + 1)
    return top


def cells_in(x0, x1, z0, z1):
    """The cells whose centres lie inside the rectangle."""
    return {(i, j) for i in range(-N, N) for j in range(-N, N) if x0 < centre(i) < x1 and z0 < centre(j) < z1}


def rot(p, quarter):
    """A point (x, z) turned by `quarter` quarter turns: (x, z) -> (-z, x)."""
    x, z = p
    for _ in range(quarter % 4):
        x, z = -z, x
    return (x, z)


def rot_rect(r, quarter):
    (ax, az), (bx, bz) = rot((r[0], r[2]), quarter), rot((r[1], r[3]), quarter)
    return (min(ax, bx), max(ax, bx), min(az, bz), max(az, bz))


class Ramp:
    """A sloped Walk Surface over a rectangle (x0, x1, z0, z1): `lo` at its low end, `hi` at its high end, which lies along `high` (-x, +x, -z
    or +z side of the rectangle). Its rails stand on its two long sides."""

    def __init__(self, id, rect, lo, hi, high):
        self.id, self.rect, self.lo, self.hi, self.high = id, rect, lo, hi, high

    def turned(self, quarter, id):
        side = {'-x': (-1, 0), '+x': (1, 0), '-z': (0, -1), '+z': (0, 1)}[self.high]
        vx, vz = rot(side, quarter)
        high = {(-1, 0): '-x', (1, 0): '+x', (0, -1): '-z', (0, 1): '+z'}[(vx, vz)]
        return Ramp(id, rot_rect(self.rect, quarter), self.lo, self.hi, high)

    def height(self, x, z):
        x0, x1, z0, z1 = self.rect
        t = {'-x': (x1 - x) / (x1 - x0), '+x': (x - x0) / (x1 - x0), '-z': (z1 - z) / (z1 - z0), '+z': (z - z0) / (z1 - z0)}[self.high]
        return self.lo + (self.hi - self.lo) * t

    def corners(self):
        x0, x1, z0, z1 = self.rect
        return [(x0, self.height(x0, z0), z0), (x1, self.height(x1, z0), z0), (x1, self.height(x1, z1), z1), (x0, self.height(x0, z1), z1)]

    def rails(self):
        """The two Walls along the long sides: (id, a, b, bottom, top)."""
        x0, x1, z0, z1 = self.rect
        bottom, top = self.lo - 1.0, self.hi + RAIL
        if self.high in ('-x', '+x'):
            return [(f'{self.id}_s', (x0, z0), (x1, z0), bottom, top), (f'{self.id}_n', (x0, z1), (x1, z1), bottom, top)]
        return [(f'{self.id}_w', (x0, z0), (x0, z1), bottom, top), (f'{self.id}_e', (x1, z0), (x1, z1), bottom, top)]


def build_plan():
    """The floor plan: {height: set of cells}, the ramps, and the Walls' and look's raw material."""
    levels = {0.0: set(), 4.0: set(), 8.0: set(), 12.0: set(), 16.0: set()}
    # Every cell has the temple's top over it (its terrace, or the ground off the temple, the roof over a hollow).
    for i in range(-N, N):
        for j in range(-N, N):
            levels[mass_top(centre(i), centre(j))].add((i, j))
    ramps = []
    w = WIDE / 2

    def hollow(level, rect, quarters=(0,)):
        for q in quarters:
            levels[level] |= cells_in(*rot_rect(rect, q))

    def solid_under(rect, quarters=(0,)):
        for q in quarters:
            levels[0.0] -= cells_in(*rot_rect(rect, q))

    # The plaza: the ground under the third tier (the hall, 48 m square), and a corridor through each face to it, turned a quarter each.
    hollow(0.0, (-24, 24, -24, 24))
    hollow(0.0, (9, 15, -48, -24), (0, 1, 2, 3))
    # South and north (half turn): a 6 m corridor through the second tier from floor 1's terrace to a landing over the plaza, and a ramp down
    # from it into the plaza.
    c1 = (-15, -9, -36, -24)
    l1 = (-15, -9, -24, -18)
    hollow(4.0, c1, (0, 2))
    hollow(4.0, l1, (0, 2))
    solid_under(l1, (0, 2))
    r0 = Ramp('ramp_in_1', (-9, 0, -24, -18), 0.0, 4.0, '-x')
    ramps += [r0, r0.turned(2, 'ramp_in_1_turned')]
    # East and west (half turn): a long ramp along the wall up to a landing at the doorway on the second terrace (floor 2).
    l2 = (18, 24, -21, -15)
    hollow(8.0, l2, (0, 2))
    solid_under(l2, (0, 2))
    r2 = Ramp('ramp_in_2', (18, 24, -15, 3), 0.0, 8.0, '-z')
    ramps += [r2, r2.turned(2, 'ramp_in_2_turned')]
    # The stairs up each face: four straight ramps, each on the terrace in front of the tier it climbs (the first on the ground at the foot),
    # with a 3 m landing on every terrace between, so the summit stays one piece.
    for q in range(4):
        for k in range(4):
            z0 = -57.0 + TIER * k
            ramps.append(Ramp(f'ramp_up_{q}_{k}', (-w, w, z0, z0 + RUN), RISE * k, RISE * (k + 1), '+z').turned(q, f'ramp_up_{q}_{k}'))
    for ramp in ramps:
        # A ramp stands over no floor of its low end's height: its footprint is cut out of that level.
        levels[ramp.lo] -= cells_in(*ramp.rect)
    return levels, ramps


LEVELS, RAMPS = build_plan()
RAMP_COLS = {}
for _r in RAMPS:
    for _c in cells_in(*_r.rect):
        RAMP_COLS.setdefault(_c, []).append(_r)


def present(c):
    return [h for h, cs in LEVELS.items() if c in cs]


def in_domain(c):
    return -N <= c[0] < N and -N <= c[1] < N


# ---------------------------------------------------------------- the floor: Walk Surfaces


def rects_of(cells):
    """`cells` as rectangles (x0, x1, z0, z1): runs along x merged where the same run repeats on the next row of z."""
    rows = {}
    for (i, j) in cells:
        rows.setdefault(j, []).append(i)
    rects, open_ = [], {}
    for j in range(-N, N + 1):
        runs = []
        xs = sorted(rows.get(j, []))
        k = 0
        while k < len(xs):
            m = k
            while m + 1 < len(xs) and xs[m + 1] == xs[m] + 1:
                m += 1
            runs.append((xs[k], xs[m] + 1))
            k = m + 1
        nxt = {}
        for run in runs:
            nxt[run] = open_.pop(run, j)
        for (a, b), j0 in open_.items():
            rects.append((a * U, b * U, j0 * U, j * U))
        open_ = nxt
    return sorted(rects, key=lambda r: (r[2], r[0]))


def hill(x, z):
    """The rolling ground beyond the flat apron (m, never below 0), its own half turn, flat round the temple, on the avenue each army deploys
    along and at each Base."""
    def bumps(x, z):
        a = (math.sin(0.085 * x + 0.04 * z + 0.7) + 1) / 2
        b = (math.sin(0.06 * z - 0.05 * x + 2.1) + 1) / 2
        c = (math.sin(0.13 * x + 0.11 * z) + 1) / 2
        return 4.2 * a * b + 1.3 * c
    d_box = math.hypot(max(abs(x) - DOMAIN, 0), max(abs(z) - DOMAIN, 0))
    d_avenue = max(abs(x) - 30.0, 0)
    d = min(d_box, d_avenue)
    t = min(1.0, d / 20.0)
    mask = t * t * (3 - 2 * t)
    return round(mask * (bumps(x, z) + bumps(-x, -z)) / 2, 4)


HILL_STEP = 10.0
HILL_EDGES = [-HALF + HILL_STEP * k for k in range(int(2 * HALF / HILL_STEP) + 1)]


def hill_triangles():
    """The hills: a grid of 10 m cells over the whole field, each cell outside the apron as two triangles of Walk Surfaces."""
    tris = []
    for a in range(len(HILL_EDGES) - 1):
        for b in range(len(HILL_EDGES) - 1):
            x0, x1, z0, z1 = HILL_EDGES[a], HILL_EDGES[a + 1], HILL_EDGES[b], HILL_EDGES[b + 1]
            if x0 >= -DOMAIN and x1 <= DOMAIN and z0 >= -DOMAIN and z1 <= DOMAIN:
                continue
            p = lambda x, z: (x, hill(x, z), z)
            tris.append((f'h{a:02d}_{b:02d}a', [p(x0, z0), p(x1, z0), p(x1, z1)]))
            tris.append((f'h{a:02d}_{b:02d}b', [p(x0, z0), p(x1, z1), p(x0, z1)]))
    return tris


def walk_surfaces():
    """[(id, [(x, y, z), ...])]: every level's rectangles, the ramps, and the hills."""
    out = []
    for h, cells in sorted(LEVELS.items()):
        for k, (x0, x1, z0, z1) in enumerate(rects_of(cells)):
            out.append((f'L{int(h):02d}_{k:03d}', [(x0, h, z0), (x1, h, z0), (x1, h, z1), (x0, h, z1)]))
    for r in RAMPS:
        out.append((r.id, r.corners()))
    return out + hill_triangles()


# ---------------------------------------------------------------- Walls and the look's faces


def edge_kinds():
    """Every edge of every present cell that has no floor of the same height beyond it: (kind, a, b, y, top) with kind 'face' (a wall of
    the mass beyond, up to `top`) or 'rail' (a parapet on the cell's own edge), a and b as (x, z)."""
    out = []
    for h, cells in LEVELS.items():
        for c in cells:
            i, j = c
            mc = mass_top(centre(i), centre(j))
            for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                n = (i + di, j + dj)
                if not in_domain(n) or n in cells:
                    continue
                if any(r.lo - EPS <= h <= r.hi + EPS for r in RAMP_COLS.get(n, [])):
                    continue
                levels_n = present(n)
                above = [l for l in levels_n if l > h + EPS]
                if abs(h - mc) < EPS:  # the temple's top at this cell: its terrace, summit or ground
                    mn = mass_top(centre(n[0]), centre(n[1]))
                    if mn > h + EPS:
                        kind = 'face'
                    elif mn < h - EPS:
                        kind = 'rail'
                    else:
                        continue
                else:  # a floor in the hollow
                    kind = 'rail' if any(l < h - EPS for l in levels_n) else 'face'
                    if kind == 'face' and not above:
                        continue
                if di:
                    x = (i + 1) * U if di > 0 else i * U
                    a, b = (x, j * U), (x, (j + 1) * U)
                else:
                    z = (j + 1) * U if dj > 0 else j * U
                    a, b = (i * U, z), ((i + 1) * U, z)
                out.append((kind, a, b, h, min(above) if kind == 'face' else h + RAIL))
    return out


def merged(edges):
    """Collinear touching edges of the same kind, height and top as one: [(kind, a, b, y, top)]."""
    groups = {}
    for kind, a, b, y, top in edges:
        axis = 'x' if abs(a[0] - b[0]) < EPS else 'z'
        coord = a[0] if axis == 'x' else a[1]
        lo, hi = sorted((a[1], b[1])) if axis == 'x' else sorted((a[0], b[0]))
        groups.setdefault((axis, coord, kind, y, top), []).append((lo, hi))
    out = []
    for (axis, coord, kind, y, top), spans in sorted(groups.items()):
        spans.sort()
        cur = list(spans[0])
        for lo, hi in spans[1:]:
            if lo <= cur[1] + EPS:
                cur[1] = max(cur[1], hi)
            else:
                out.append((kind, axis, coord, cur[0], cur[1], y, top))
                cur = [lo, hi]
        out.append((kind, axis, coord, cur[0], cur[1], y, top))
    return out


def walls_and_faces():
    """(walls for the Simulation, faces and rails for the look). Walls: (id, a, b, bottom, top)."""
    faces = merged(edge_kinds())
    walls = []
    for k, (kind, axis, coord, lo, hi, y, top) in enumerate(faces):
        a, b = ((coord, lo), (coord, hi)) if axis == 'x' else ((lo, coord), (hi, coord))
        walls.append((f'{kind}_{k:03d}', a, b, y - 1.0 if kind == 'face' else y, top))
    for r in RAMPS:
        walls += r.rails()
    edge = [('edge_s', (-HALF, -HALF), (HALF, -HALF)), ('edge_e', (HALF, -HALF), (HALF, HALF)), ('edge_n', (HALF, HALF), (-HALF, HALF)), ('edge_w', (-HALF, HALF), (-HALF, -HALF))]
    walls += [(i, a, b, -1.0, 4.0) for i, a, b in edge]
    return walls, faces


# ---------------------------------------------------------------- Objectives

# In the order a Battle numbers them: A and D at opposite corners of the second terrace, B in the plaza, C on the summit. B and C are at the
# same x and z (the centre), told apart by `y`: id, x, z, weight, y (None: the highest floor there).
OBJECTIVES = [
    ('A', -30.0, -30.0, 1.0, None),
    ('B', 0.0, 0.0, 1.4, 0.0),
    ('C', 0.0, 0.0, 1.2, 16.0),
    ('D', 30.0, 30.0, 1.0, None),
]

# ---------------------------------------------------------------- the look (game coordinates)


class Geo:
    """Faces with a material each; vertices are not shared, so shading is flat."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def face(self, pts, mat):
        base = len(self.verts)
        self.verts.extend(tuple(p) for p in pts)
        self.faces.append((list(range(base, base + len(pts))), MAT_INDEX[mat]))

    def box(self, x0, x1, y0, y1, z0, z1, mat, top=None, skip_bottom=True):
        c = lambda i, j, k: (x1 if i else x0, y1 if j else y0, z1 if k else z0)
        sides = [
            ([c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], mat),
            ([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], mat),
            ([c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], mat),
            ([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], mat),
            ([c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)], top or mat),
        ]
        if not skip_bottom:
            sides.append(([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], mat))
        for pts, m in sides:
            self.face(pts, m)

    def cone(self, x, y, z, r, h, mat, sides=6):
        """A cone's lateral faces (point up), its base left open: seen from above and the side only."""
        ring = [(x + r * math.cos(2 * math.pi * k / sides), y, z + r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        for k in range(sides):
            self.face([ring[k], (x, y + h, z), ring[(k + 1) % sides]], mat)


G = Geo()


def flat(rect, y, mat):
    x0, x1, z0, z1 = rect
    G.face([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], mat)  # facing up (game coordinates: counter-clockwise from above is x then z...)


def top_faces():
    for h, cells in sorted(LEVELS.items()):
        for rect in rects_of(cells):
            cx, cz = (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2
            inside = max(abs(cx), abs(cz)) < 48.0
            if h == 0.0:
                flat(rect, h + 0.01, 'Plaza' if inside else 'Grass1')
            else:
                flat(rect, h, 'StoneLight')


def wall_looks(faces):
    """Each face a stone wall in two bands (a lighter cornice), double sided; each rail a thin parapet."""
    for kind, axis, coord, lo, hi, y, top in faces:
        if kind == 'face':
            cut = y + (top - y) * 0.82
            for (b0, b1, mat) in ((y, cut, 'Wall'), (cut, top, 'WallTop')):
                if axis == 'x':
                    G.face([(coord, b0, lo), (coord, b0, hi), (coord, b1, hi), (coord, b1, lo)], mat)
                else:
                    G.face([(lo, b0, coord), (lo, b1, coord), (hi, b1, coord), (hi, b0, coord)], mat)
        else:
            t = 0.35
            if axis == 'x':
                G.box(coord - t / 2, coord + t / 2, y, top, lo, hi, 'StoneDark', top='Stone')
            else:
                G.box(lo, hi, y, top, coord - t / 2, coord + t / 2, 'StoneDark', top='Stone')


def prism_x(profile, z0, z1, mat):
    """A prism: `profile`, counter-clockwise seen from +z as points (x, y), stood from z0 to z1."""
    G.face([(x, y, z1) for x, y in profile], mat)
    G.face([(x, y, z0) for x, y in reversed(profile)], mat)
    for k, (x, y) in enumerate(profile):
        x2, y2 = profile[(k + 1) % len(profile)]
        G.face([(x, y, z0), (x2, y2, z0), (x2, y2, z1), (x, y, z1)], mat)


def ramp_looks():
    """Each ramp: its way in bands (a worn step to the eye every metre), and a stone rail along each side."""
    for r in RAMPS:
        x0, x1, z0, z1 = r.rect
        steps = int(RUN)
        along_x = r.high in ('-x', '+x')
        for s in range(steps):
            a, b = s / steps, (s + 1) / steps
            if along_x:
                xa, xb = x0 + (x1 - x0) * a, x0 + (x1 - x0) * b
                pts = [(xa, r.height(xa, z0), z0), (xb, r.height(xb, z0), z0), (xb, r.height(xb, z1), z1), (xa, r.height(xa, z1), z1)]
                pts = [pts[0], pts[3], pts[2], pts[1]]
            else:
                za, zb = z0 + (z1 - z0) * a, z0 + (z1 - z0) * b
                pts = [(x0, r.height(x0, za), za), (x0, r.height(x0, zb), zb), (x1, r.height(x1, zb), zb), (x1, r.height(x1, za), za)]
            G.face(pts, 'StoneLight' if s % 2 == 0 else 'Stone')
        # A rail each side, outside the way: a wedge of stone on the floor under the ramp's foot, as long as the ramp, rising with it.
        t = 0.5
        if along_x:
            prof = [(x0, r.lo), (x1, r.lo), (x1, r.height(x1, z0) + RAIL), (x0, r.height(x0, z0) + RAIL)]
            wedge(prof, (z0 - t, z0), 'x')
            wedge(prof, (z1, z1 + t), 'x')
        else:
            prof = [(z0, r.lo), (z1, r.lo), (z1, r.height(x0, z1) + RAIL), (z0, r.height(x0, z0) + RAIL)]
            wedge(prof, (x0 - t, x0), 'z')
            wedge(prof, (x1, x1 + t), 'z')


def wedge(prof, lat, axis):
    """A prism of stone: `prof` (four points (s, y): the foot, the far foot, the far top, the near top) stood across the lateral range `lat`;
    s runs along x ('x', lateral z) or along z ('z', lateral x). Double sided, so it needs no winding."""
    p = lambda k, l: (prof[k][0], prof[k][1], l) if axis == 'x' else (l, prof[k][1], prof[k][0])
    l0, l1 = lat
    G.face([p(0, l1), p(1, l1), p(2, l1), p(3, l1)], 'Wall')
    G.face([p(0, l0), p(1, l0), p(2, l0), p(3, l0)], 'Wall')
    G.face([p(2, l0), p(3, l0), p(3, l1), p(2, l1)], 'WallTop')
    G.face([p(3, l0), p(0, l0), p(0, l1), p(3, l1)], 'Wall')
    G.face([p(1, l0), p(2, l0), p(2, l1), p(1, l1)], 'Wall')


def brazier(x, y, z, s=1.0):
    G.box(x - 0.5 * s, x + 0.5 * s, y, y + 1.0 * s, z - 0.5 * s, z + 0.5 * s, 'StoneDark', top='Stone')
    G.box(x - 0.35 * s, x + 0.35 * s, y + 1.0 * s, y + 1.7 * s, z - 0.35 * s, z + 0.35 * s, 'Fire')


def banner(x, z, mat, facing):
    G.box(x - 0.1, x + 0.1, 0, 6, z - 0.1, z + 0.1, 'Wood')
    G.box(x + 0.1, x + 1.7, 3.6, 5.8, z - 0.03 * facing, z + 0.03 * facing, mat)


def decorations():
    # The summit: a low altar of gold and stone at its centre, a brazier in each corner and on every terrace's corners.
    G.box(-4, 4, 16.0, 16.5, -4, 4, 'StoneDark', top='Stone')
    G.box(-2, 2, 16.5, 16.8, -2, 2, 'Gold')
    for sx in (-1, 1):
        for sz in (-1, 1):
            brazier(sx * 10.0, 16.0, sz * 10.0)
            brazier(sx * 22.0, 12.0, sz * 22.0)
            brazier(sx * 34.0, 8.0, sz * 34.0)
            brazier(sx * 46.0, 4.0, sz * 46.0)
    # The plaza: an inlaid square about B, and a gold tile at its heart.
    G.face([(-8, 0.03, -8), (-8, 0.03, 8), (8, 0.03, 8), (8, 0.03, -8)], 'StoneLight')
    G.face([(-3, 0.05, -3), (-3, 0.05, 3), (3, 0.05, 3), (3, 0.05, -3)], 'Gold')
    brazier(-16, 0.0, -16)
    brazier(16, 0.0, 16)
    brazier(-16, 0.0, 16)
    brazier(16, 0.0, -16)
    # Worn earth at the foot of each ramp up from the ground.
    for q in range(4):
        r = Ramp('foot', (-WIDE / 2 - 1.5, WIDE / 2 + 1.5, -60.0, -57.0), 0, 0, '+z').turned(q, 'foot')
        x0, x1, z0, z1 = r.rect
        G.face([(x0, 0.03, z0), (x0, 0.03, z1), (x1, 0.03, z1), (x1, 0.03, z0)], 'Dirt')
    banner(0, -BASE, 'Banner0', 1)
    banner(0, BASE, 'Banner1', -1)


def hill_look():
    for a in range(len(HILL_EDGES) - 1):
        for b in range(len(HILL_EDGES) - 1):
            x0, x1, z0, z1 = HILL_EDGES[a], HILL_EDGES[a + 1], HILL_EDGES[b], HILL_EDGES[b + 1]
            if x0 >= -DOMAIN and x1 <= DOMAIN and z0 >= -DOMAIN and z1 <= DOMAIN:
                continue
            p = lambda x, z: (x, hill(x, z) + 0.01, z)
            for tri in ([p(x0, z0), p(x0, z1), p(x1, z1)], [p(x0, z0), p(x1, z1), p(x1, z0)]):
                h = sum(v[1] for v in tri) / 3
                mat = 'Grass0' if h < 1.2 else 'Grass1' if h < 2.6 else 'Grass2'
                if rng.random() < 0.12:
                    mat = 'Moss'
                G.face(tri, mat)


def hill_surface(x, z):
    """The height of the hill's mesh at (x, z): its cells' triangles (the diagonal from the low corner) interpolate hill() between 10 m corners."""
    x0 = -HALF + HILL_STEP * min(int((x + HALF) // HILL_STEP), len(HILL_EDGES) - 2)
    z0 = -HALF + HILL_STEP * min(int((z + HALF) // HILL_STEP), len(HILL_EDGES) - 2)
    u, v = (x - x0) / HILL_STEP, (z - z0) / HILL_STEP
    h00, h11 = hill(x0, z0), hill(x0 + HILL_STEP, z0 + HILL_STEP)
    if u >= v:  # the triangle (x0, z0), (x1, z0), (x1, z1)
        return h00 + u * (hill(x0 + HILL_STEP, z0) - h00) + v * (h11 - hill(x0 + HILL_STEP, z0))
    return h00 + v * (hill(x0, z0 + HILL_STEP) - h00) + u * (h11 - hill(x0, z0 + HILL_STEP))


def forest():
    """Jungle trees (render only: the Simulation walks through them) on the hills, never on the apron nor on the avenue each army deploys along."""
    n = 0
    step = 7.0
    x = -HALF + 4
    while x < HALF - 2:
        z = -HALF + 4
        while z < HALF - 2:
            px, pz = x + rng.uniform(-2.5, 2.5), z + rng.uniform(-2.5, 2.5)
            apron = abs(px) < DOMAIN + 4 and abs(pz) < DOMAIN + 4
            avenue = abs(px) < 36
            if not apron and not avenue and abs(px) < HALF - 3 and abs(pz) < HALF - 3 and rng.random() < 0.62:
                y = hill_surface(px, pz) - 0.2  # on the mesh, not the curve under it, and sunk a little so no trunk floats
                h = rng.uniform(5.5, 9.5)
                r = rng.uniform(1.8, 3.0)
                G.box(px - 0.3, px + 0.3, y, y + h * 0.55, pz - 0.3, pz + 0.3, 'Bark')
                leaf = rng.choice(('Leaf0', 'Leaf1', 'Leaf2'))
                G.cone(px, y + h * 0.3, pz, r, h * 0.7, leaf, 6)
                G.cone(px, y + h * 0.55, pz, r * 0.7, h * 0.55, leaf, 6)
                n += 1
            z += step
        x += step
    return n


def build_look(faces):
    top_faces()
    wall_looks(faces)
    ramp_looks()
    decorations()
    hill_look()
    return forest()


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
    for name, (colour, rough, double) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = rough
        m.diffuse_color = rgba
        m.use_backface_culling = False  # every face is drawn from both sides: the look's faces are authored without a winding
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


def empty(coll, name, x, z, **props):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.location = to_blender((x, 0.0, z))
    for k, v in props.items():
        obj[k] = v
    coll.objects.link(obj)
    return obj


def poly_object(coll, name, pts):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
    coll.objects.link(bpy.data.objects.new(name, me))


def collision(coll, surfaces, walls):
    for id, pts in surfaces:
        poly_object(coll, f'WALK_{id}', pts)
    for id, a, b, bottom, top in walls:
        poly_object(coll, f'WALL_{id}', [(a[0], bottom, a[1]), (b[0], bottom, b[1]), (b[0], top, b[1]), (a[0], top, a[1])])
    for k, (id, x, z, weight, y) in enumerate(OBJECTIVES):
        props = {'weight': weight, 'owner': -1, 'spawn': 0}
        if y is not None:
            props['y'] = y
        empty(coll, f'OBJ_{k}_{id}', x, z, **props)
    empty(coll, 'BASE_T0', 0.0, -BASE)
    empty(coll, 'BASE_T1', 0.0, BASE)
    empty(coll, 'DEPLOY', 0.0, -FRONT)


def to_game(v):
    r = lambda x: round(x, 4) + 0.0
    return [r(v.x), r(v.z), r(-v.y)]


def export_json(coll):
    """The Battle map, read back from the Collision helpers."""
    objs = sorted(coll.objects, key=lambda o: o.name)
    walk, walls, objectives, bases = [], [], [], [None, None]
    front = None
    for o in objs:
        world = lambda i: to_game(o.matrix_world @ o.data.vertices[i].co)
        if o.name.startswith('WALK_'):
            walk.append({'id': o.name, 'points': [world(i) for i in o.data.polygons[0].vertices]})
        elif o.name.startswith('WALL_'):
            vs = [world(i) for i in range(len(o.data.vertices))]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('OBJ_'):
            p = to_game(o.matrix_world.translation)
            site = {'id': o.name.split('_', 2)[2], 'x': p[0], 'z': p[2], 'weight': float(o['weight']), 'owner': int(o['owner']), 'spawn': bool(o['spawn'])}
            if 'y' in o.keys():
                site['y'] = float(o['y'])
            objectives.append((int(o.name.split('_')[1]), site))
        elif o.name.startswith('BASE_T'):
            p = to_game(o.matrix_world.translation)
            bases[int(o.name[-1])] = [p[0], p[2]]
        elif o.name == 'DEPLOY':
            front = -to_game(o.matrix_world.translation)[2]
    return {
        'name': 'ziggurat',
        'front': front,
        'armySize': ARMY_SIZE,
        'ticketsPerSoldier': TICKETS,
        'bases': bases,
        'objectives': [o for _, o in sorted(objectives, key=lambda e: e[0])],
        'blocks': [],
        'walls': walls,
        'walk': walk,
    }


def write_json(path, data):
    """Compact enough to read: one surface, wall or Objective per line."""
    def items(key):
        rows = data[key]
        return [f'    {json.dumps(r)}' + (',' if k < len(rows) - 1 else '') for k, r in enumerate(rows)]
    lines = ['{', '  "name": "ziggurat",', f'  "front": {json.dumps(data["front"])},', f'  "armySize": {json.dumps(data["armySize"])},', f'  "ticketsPerSoldier": {json.dumps(data["ticketsPerSoldier"])},',
             f'  "bases": {json.dumps(data["bases"])},', '  "objectives": [', *items('objectives'), '  ],', '  "blocks": [],', '  "walls": [', *items('walls'),
             '  ],', '  "walk": [', *items('walk'), '  ]', '}', '']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        f.write('\n'.join(lines))


def build():
    surfaces = walk_surfaces()
    walls, faces = walls_and_faces()
    trees = build_look(faces)
    report = {'walk': len(surfaces), 'walls': len(walls), 'trees': trees, 'faces': len(G.faces), 'saved': bool(SAVE)}
    if bpy is None:
        return report
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    mats = materials()
    look = collection(NAME)
    helpers = collection('Collision')
    for c in bpy.context.scene.collection.children:
        c.hide_render = c.hide_viewport = c.name not in (NAME, 'Collision')
    temple = mesh_object(NAME, G, look, mats)
    collision(helpers, surfaces, walls)
    helpers.hide_render = True
    report['triangles'] = sum(len(p.vertices) - 2 for p in temple.data.polygons)
    report['faces_dropped'] = len(G.faces) - len(temple.data.polygons)
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        temple.select_set(True)
        bpy.context.view_layer.objects.active = temple
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('ZIGGURAT_RESULT', json.dumps(result))
