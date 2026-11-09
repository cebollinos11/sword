"""
Builds the Cavern, the fourth hand-built Battle map (docs/plans/battle-objectives.md; ADR 0022), in Blender: the look (a mesh with flat-colour
materials) and the geometry the Simulation reads (helper objects in a `Collision` collection). This script is the source of truth for both
(ADR 0006): re-run it to change the map.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_battle_cavern.py").read(), {"__file__": r"C:/Repos/sword/art/build_battle_cavern.py", "SAVE": True})
or, with no Blender at all (the Walk Surfaces, Walls and JSON only; no model):
    python art/build_battle_cavern.py

With SAVE = True it writes public/models/arenas/battle_cavern.glb (the look) and data/battlemaps/cavern.json (the Battle map). The helpers are the
City's (art/build_battle_city.py): WALK_* (Walk Surfaces; `lava` = 1 on the river), WALL_*, OBJ_*, BASE_T<team> and DEPLOY. No BLOCK_*.

Everything is authored in game coordinates (x east, y up, z toward Team 1; facing 0 looks along +z) and placed in Blender as (x, -z, y).

The map: a sci-fi cavern of cut basalt, every surface a cube or a ramp, 200 m across and NOT symmetric. A river of lava crosses it from the west
wall to the east wall: down the west channel into a lake with an island in it (Objective B), out by the east channel, a tributary falling in from
the north. Stone bridges cross it, some wide, one a single file; their sides are open, and so is every bank, so a Fighter that is knocked or walks
off falls into the lava and dies (Soldiers never step off: no ground lies within `battle.levels.drop` of any ledge over the river, so they slide
along it, as along a wall). Four terraced platforms (4, 8 and 12 m up, joined by ramps) hold the other four Objectives; cube pillars and cut rock
fill the rest. Both armies deploy on the flat floor at either end.
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
NAME = 'Cavern'
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'battle_cavern.glb')
OUT_JSON = os.path.join(REPO, 'data', 'battlemaps', 'cavern.json')

HALF = 100.0
FRONT = 62.0  # Team 0's front rank stands at z = -FRONT
BASE = 90.0
ARMY_SIZE = {'standard': 150, 'max': 150}
TICKETS = 1.5  # a Battle here lasted 12 minutes on the City's 2.4; the lava and the bridges slow the killing

U = 4.0
N = 25  # cells each side of the centre: the raster covers the whole 200 m field
RAIL = 1.0
LAVA_Y = -8.0  # the river's surface: far below every ledge (a Soldier drops at most 3 m)
EPS = 1e-6
rng = random.Random(21)

# name: (sRGB colour, roughness, double sided, emission strength)
MATERIALS = {
    'Floor0': (0x2f2c2c, 1.0, False, 0),
    'Floor1': (0x383434, 1.0, False, 0),
    'Plat4a': (0x4a4442, 1.0, False, 0),
    'Plat4b': (0x433e3c, 1.0, False, 0),
    'Plat8a': (0x5a524e, 1.0, False, 0),
    'Plat8b': (0x514a46, 1.0, False, 0),
    'Plat12a': (0x6b625b, 1.0, False, 0),
    'Plat12b': (0x625a54, 1.0, False, 0),
    'Deck': (0x3b3f47, 1.0, False, 0),
    'DeckLine': (0x5d6572, 1.0, False, 0),
    'Beam': (0x26292f, 1.0, False, 0),
    'Wall': (0x211f20, 1.0, True, 0),
    'WallB': (0x2b2828, 1.0, True, 0),
    'WallTop': (0x4d4644, 1.0, True, 0),
    'Rock': (0x1b1919, 1.0, True, 0),
    'RockTop': (0x302c2b, 1.0, False, 0),
    'Rune': (0xff7a1f, 1.0, False, 2.5),
    'RuneBlue': (0x3fd0ff, 1.0, False, 2.5),
    'Lava': (0xff4a0f, 1.0, False, 3.0),
    'LavaHot': (0xffa62e, 1.0, False, 5.0),
    'Crust': (0x5a1c0c, 1.0, False, 0.6),
    'LavaWall': (0x3a1409, 1.0, True, 0.5),
    'Gold': (0xc9a227, 1.0, False, 0.8),
    'Fire': (0xe8742c, 1.0, False, 3.0),
    'Banner0': (0xf1c40f, 1.0, False, 0),
    'Banner1': (0x2e86c1, 1.0, False, 0),
    'Wood': (0x5a4330, 1.0, False, 0),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- the plan (game coordinates, rectangles x0, x1, z0, z1; all multiples of 4)

LAVA = [
    (-100, -28, 0, 32),  # the west channel, 32 m across
    (-28, 28, -24, 36),  # the lake
    (28, 100, -24, 8),  # the east channel
    (-72, -56, 32, 76),  # the tributary, falling in from the north wall
]
ISLAND = (-12, 12, 0, 12)  # a dais in the lake, 4 m up: Objective B

# cut rock and cube pillars: (rect, top)
ROCK = [
    ((-100, -88, -100, -68), 18), ((-100, -92, -48, -20), 16), ((-100, -96, 32, 92), 16), ((-100, -92, 92, 100), 20),
    ((92, 100, -100, -60), 18), ((88, 100, -44, -28), 16), ((92, 100, 28, 56), 18), ((88, 100, 72, 100), 20),
    ((-64, -44, 88, 100), 16), ((44, 68, 88, 100), 18), ((-64, -44, -100, -96), 12), ((44, 68, -100, -92), 14),
    ((-72, -56, 76, 92), 20), ((-96, -72, 84, 92), 14), ((-92, -64, 92, 100), 14),  # the rock the tributary falls from
    ((28, 36, -68, -60), 8), ((20, 28, 64, 72), 10), ((20, 28, -44, -36), 6), ((-16, -8, -48, -40), 6), ((8, 16, -60, -52), 6),
    ((-24, -16, 48, 56), 8), ((12, 20, 44, 52), 8), ((-36, -28, -20, -12), 6), ((60, 68, 20, 28), 6),
]

# raised platforms, painted in order: (rect, height)
PLATFORMS = [
    ((-84, -44, -60, -28), 4),  # the south-west terrace (A)
    ((44, 84, -72, -40), 4), ((52, 76, -52, -40), 8),  # the south-east terrace and its dais (D)
    ((-96, -72, 48, 84), 4), ((-92, -76, 64, 80), 8),  # the north-west terrace and its dais (E)
    ((-56, -28, 56, 80), 4),  # the north-west junction, across the tributary
    ((40, 88, 36, 84), 4), ((48, 84, 52, 80), 8), ((64, 80, 60, 76), 12),  # the north-east keep (C)
]

# ramps: (id, rect, lo, hi, which side the high end lies along)
RAMP_SPECS = [
    ('rA1', (-68, -60, -72, -60), 0, 4, '+z'), ('rA2', (-44, -32, -48, -40), 0, 4, '-x'),
    ('rD1', (56, 64, -84, -72), 0, 4, '+z'), ('rD2', (32, 44, -60, -52), 0, 4, '+x'), ('rD3', (60, 68, -64, -52), 4, 8, '+z'),
    ('rE1', (-80, -72, 36, 48), 0, 4, '+z'), ('rE2', (-88, -80, 52, 64), 4, 8, '+z'),
    ('rF1', (-44, -36, 44, 56), 0, 4, '+z'),
    ('rC1', (28, 40, 52, 60), 0, 4, '+x'), ('rC2', (60, 68, 40, 52), 4, 8, '+z'), ('rC3', (52, 64, 64, 72), 8, 12, '+x'),
]

# Bridges over the lava all arch: a ramp up from the bank, a deck 4 m up over the river, a ramp down the far bank. The decks (rects, 4 m up)
# have open sides, so whoever is knocked off falls 12 m into the lava.
def arch(id, x0, x1, south, deck, north):
    """A bridge along z: its south ramp's z range, the deck's, the north ramp's."""
    return ([(f'{id}s', (x0, x1, *south), 0, 4, '+z'), (f'{id}n', (x0, x1, *north), 0, 4, '-z')], (x0, x1, *deck))


_ARCHES = [
    arch('bW1', -48, -40, (-12, 0), (0, 32), (32, 44)),  # across the west channel
    arch('bW2', -96, -88, (-12, 0), (0, 32), (32, 44)),
    arch('bE1', 36, 44, (-36, -24), (-24, 8), (8, 20)),  # across the east channel
    arch('bE2', 68, 76, (-36, -24), (-24, 8), (8, 20)),
    arch('bE3', 52, 56, (-36, -24), (-24, 8), (8, 20)),  # a single file
    arch('bB1', -4, 4, (-36, -24), (-24, 0), (0, 0)),  # the dais's south bridge (its north end is the dais)
]
for _ramps, _ in _ARCHES:
    RAMP_SPECS += _ramps
RAMP_SPECS = [r for r in RAMP_SPECS if r[1][3] > r[1][2]]
DECKS = [d for _, d in _ARCHES if d[3] > d[2]]
# the dais's north bridge: a deck from the dais across the lake, a ramp down on the north bank
DECKS.append((-4, 4, 12, 36))
RAMP_SPECS.append(('bB2n', (-4, 4, 36, 48), 0, 4, '-z'))
# across the tributary: a flat deck between two terraces 4 m up
DECKS += [(-72, -56, 56, 64), (-72, -56, 68, 76)]

# In the order a Battle numbers them: id, x, z, weight, y (None: the highest floor there).
OBJECTIVES = [
    ('A', -64.0, -44.0, 1.0, None),  # the south-west terrace, Team 0's west
    ('B', 0.0, 6.0, 1.4, None),  # the dais in the lake
    ('C', 72.0, 68.0, 1.2, None),  # the north-east keep's top (12 m), Team 1's east
    ('D', 64.0, -46.0, 1.0, None),  # the south-east dais (8 m)
    ('E', -84.0, 72.0, 1.0, None),  # the north-west dais (8 m)
]
HEIGHTS = [0.0, 4.0, 8.0, 12.0]


def centre(i):
    return (i + 0.5) * U


def cells_in(x0, x1, z0, z1):
    return {(i, j) for i in range(-N, N) for j in range(-N, N) if x0 < centre(i) < x1 and z0 < centre(j) < z1}


class Ramp:
    def __init__(self, id, rect, lo, hi, high):
        self.id, self.rect, self.lo, self.hi, self.high = id, rect, float(lo), float(hi), high
        self.cut = float(lo)

    def height(self, x, z):
        x0, x1, z0, z1 = self.rect
        t = {'-x': (x1 - x) / (x1 - x0), '+x': (x - x0) / (x1 - x0), '-z': (z1 - z) / (z1 - z0), '+z': (z - z0) / (z1 - z0)}[self.high]
        return self.lo + (self.hi - self.lo) * t

    def corners(self):
        x0, x1, z0, z1 = self.rect
        return [(x0, self.height(x0, z0), z0), (x1, self.height(x1, z0), z0), (x1, self.height(x1, z1), z1), (x0, self.height(x0, z1), z1)]

    def rails(self):
        x0, x1, z0, z1 = self.rect
        bottom, top = self.lo - 1.0, self.hi + RAIL
        if self.high in ('-x', '+x'):
            return [(f'{self.id}_s', (x0, z0), (x1, z0), bottom, top), (f'{self.id}_n', (x0, z1), (x1, z1), bottom, top)]
        return [(f'{self.id}_w', (x0, z0), (x0, z1), bottom, top), (f'{self.id}_e', (x1, z0), (x1, z1), bottom, top)]


def build_plan():
    levels = {h: set() for h in HEIGHTS}
    for i in range(-N, N):
        for j in range(-N, N):
            levels[0.0].add((i, j))
    voids = {}
    for rect, top in ROCK:
        for c in cells_in(*rect):
            levels[0.0].discard(c)
            voids[c] = top
    lava = set()
    for rect in LAVA:
        cs = cells_in(*rect)
        for c in cs:
            assert c not in voids or True
            levels[0.0].discard(c)
            voids.pop(c, None)
        lava |= cs
    island = cells_in(*ISLAND)
    assert island <= lava
    levels[4.0] |= island
    for rect, h in PLATFORMS:
        cs = cells_in(*rect)
        assert not (cs & set(voids)), f'platform {rect} on rock'
        assert not (cs & lava), f'platform {rect} on lava'
        for k in levels:
            levels[k] -= cs
        levels[float(h)] |= cs
    deck = set()
    for rect in DECKS:
        cs = cells_in(*rect)
        assert cs <= lava, f'deck {rect} not over lava'
        levels[4.0] |= cs
        deck |= cs
    ramps = []
    for id, rect, lo, hi, high in RAMP_SPECS:
        r = Ramp(id, rect, lo, hi, high)
        cs = cells_in(*rect)
        assert cs <= levels[float(lo)], f'ramp {id} not on level {lo}'
        levels[float(lo)] -= cs
        ramps.append(r)
    return levels, ramps, voids, lava, deck


LEVELS, RAMPS, VOIDS, LAVA_CELLS, DECK = build_plan()
RAMP_COLS = {}
for _r in RAMPS:
    for _c in cells_in(*_r.rect):
        RAMP_COLS.setdefault(_c, []).append(_r)
for _id, _x, _z, *_ in OBJECTIVES:
    _c = (math.floor(_x / U), math.floor(_z / U))
    assert any(_c in cs for h, cs in LEVELS.items() if h > 0 or True), _id


def present(c):
    return [h for h, cs in LEVELS.items() if c in cs]


def in_domain(c):
    return -N <= c[0] < N and -N <= c[1] < N


def rects_of(cells):
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


def walk_surfaces():
    """[(id, [(x, y, z)], lava)]: every level's rectangles, the ramps, and (last) the river's surface."""
    out = []
    for h, cells in sorted(LEVELS.items()):
        for k, (x0, x1, z0, z1) in enumerate(rects_of(cells)):
            out.append((f'L{int(h):02d}_{k:03d}', [(x0, h, z0), (x1, h, z0), (x1, h, z1), (x0, h, z1)], False))
    for r in RAMPS:
        out.append((r.id, r.corners(), False))
    for k, (x0, x1, z0, z1) in enumerate(rects_of(LAVA_CELLS)):
        out.append((f'Z_lava_{k:03d}', [(x0, LAVA_Y, z0), (x1, LAVA_Y, z0), (x1, LAVA_Y, z1), (x0, LAVA_Y, z1)], True))
    return out


def edge_kinds():
    out = []
    for h, cells in LEVELS.items():
        for c in cells:
            i, j = c
            for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                n = (i + di, j + dj)
                if not in_domain(n) or n in cells:
                    continue
                if any(r.lo - EPS <= h <= r.hi + EPS for r in RAMP_COLS.get(n, [])):
                    continue
                if n in VOIDS:
                    if VOIDS[n] <= h + EPS:
                        continue
                    kind, top = 'face', VOIDS[n]
                else:
                    levels_n = present(n)
                    above = [l for l in levels_n if l > h + EPS]
                    if above:
                        kind, top = 'face', min(above)
                    elif any(l < h - EPS for l in levels_n):
                        kind, top = 'rail', h + RAIL
                    else:
                        continue  # lava or nothing beyond: an open ledge
                if di:
                    x = (i + 1) * U if di > 0 else i * U
                    a, b = (x, j * U), (x, (j + 1) * U)
                else:
                    z = (j + 1) * U if dj > 0 else j * U
                    a, b = (i * U, z), ((i + 1) * U, z)
                out.append((kind, a, b, h, top, (-di, -dj)))
    return out


def merged(edges):
    groups = {}
    for kind, a, b, y, top, side in edges:
        axis = 'x' if abs(a[0] - b[0]) < EPS else 'z'
        coord = a[0] if axis == 'x' else a[1]
        lo, hi = sorted((a[1], b[1])) if axis == 'x' else sorted((a[0], b[0]))
        groups.setdefault((axis, coord, kind, y, top, side), []).append((lo, hi))
    out = []
    for (axis, coord, kind, y, top, side), spans in sorted(groups.items()):
        spans.sort()
        cur = list(spans[0])
        for lo, hi in spans[1:]:
            if lo <= cur[1] + EPS:
                cur[1] = max(cur[1], hi)
            else:
                out.append((kind, axis, coord, cur[0], cur[1], y, top, side))
                cur = [lo, hi]
        out.append((kind, axis, coord, cur[0], cur[1], y, top, side))
    return out


def walls_and_faces():
    faces = merged(edge_kinds())
    walls, seen = [], set()
    for k, (kind, axis, coord, lo, hi, y, top, side) in enumerate(faces):
        a, b = ((coord, lo), (coord, hi)) if axis == 'x' else ((lo, coord), (hi, coord))
        bottom = y - 1.0 if kind == 'face' else y
        key = (axis, coord, lo, hi, bottom, top)
        if key in seen:
            continue
        seen.add(key)
        walls.append((f'{kind}_{k:04d}', a, b, bottom, top))
    for r in RAMPS:
        walls += r.rails()
    edge = [('edge_s', (-HALF, -HALF), (HALF, -HALF)), ('edge_e', (HALF, -HALF), (HALF, HALF)), ('edge_n', (HALF, HALF), (-HALF, HALF)), ('edge_w', (-HALF, HALF), (-HALF, -HALF))]
    walls += [(i, a, b, LAVA_Y - 2.0, 30.0) for i, a, b in edge]
    return walls, faces


# ---------------------------------------------------------------- the look

class Geo:
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


G = Geo()


def flat(rect, y, mat):
    x0, x1, z0, z1 = rect
    G.face([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], mat)


def vwall(axis, coord, lo, hi, y0, y1, mat):
    if axis == 'x':
        G.face([(coord, y0, lo), (coord, y0, hi), (coord, y1, hi), (coord, y1, lo)], mat)
    else:
        G.face([(lo, y0, coord), (lo, y1, coord), (hi, y1, coord), (hi, y0, coord)], mat)


def top_faces():
    for h, cells in sorted(LEVELS.items()):
        for (i, j) in sorted(cells):
            x0, x1, z0, z1 = i * U, (i + 1) * U, j * U, (j + 1) * U
            chk = (i + j) % 2 == 0
            if (i, j) in DECK:
                flat((x0, x1, z0, z1), h, 'Deck')
                # a line down the bridge's middle, and the beams under it
                G.box(x0, x1, h - 1.2, h - 0.02, z0, z1, 'Beam', skip_bottom=False)
            elif h == 0.0:
                flat((x0, x1, z0, z1), 0.01, 'Floor0' if chk else 'Floor1')
            else:
                flat((x0, x1, z0, z1), h, f'Plat{int(h)}' + ('a' if chk else 'b'))
    for (i, j), top in sorted(VOIDS.items()):
        flat((i * U, (i + 1) * U, j * U, (j + 1) * U), top, 'RockTop')


def wall_looks(faces):
    """Each face a basalt wall with a glowing seam a metre under its top; each rail (none here but on ramps' neighbours) a low cube lip."""
    for kind, axis, coord, lo, hi, y, top, side in faces:
        if kind == 'face':
            mid = (lo + hi) / 2
            px, pz = (coord, mid) if axis == 'x' else (mid, coord)
            ix, iz = px - side[0] * 1.5, pz - side[1] * 1.5
            c = (math.floor(ix / U), math.floor(iz / U))
            rock = c in VOIDS
            body = 'Rock' if rock else ('Wall' if (c[0] + c[1]) % 2 == 0 else 'WallB')
            cut = top - 1.2
            vwall(axis, coord, lo, hi, y, cut, body)
            vwall(axis, coord, lo, hi, cut, top, 'WallTop')
            if not rock and top - y >= 3.5:
                seam = 0.14
                off = side[0] * 0.04 if axis == 'x' else side[1] * 0.04
                vwall(axis, coord + off, lo + 0.6, hi - 0.6, top - 1.6 - seam, top - 1.6, 'Rune' if int(top) % 8 == 0 else 'RuneBlue')
        else:
            t = 0.35
            if axis == 'x':
                G.box(coord - t / 2, coord + t / 2, y, top, lo, hi, 'WallB', top='WallTop')
            else:
                G.box(lo, hi, y, top, coord - t / 2, coord + t / 2, 'WallB', top='WallTop')


def wedge(prof, lat, axis):
    p = lambda k, l: (prof[k][0], prof[k][1], l) if axis == 'x' else (l, prof[k][1], prof[k][0])
    l0, l1 = lat
    G.face([p(0, l1), p(1, l1), p(2, l1), p(3, l1)], 'Wall')
    G.face([p(0, l0), p(1, l0), p(2, l0), p(3, l0)], 'Wall')
    G.face([p(2, l0), p(3, l0), p(3, l1), p(2, l1)], 'WallTop')
    G.face([p(3, l0), p(0, l0), p(0, l1), p(3, l1)], 'Wall')
    G.face([p(1, l0), p(2, l0), p(2, l1), p(1, l1)], 'Wall')


def ramp_looks():
    for r in RAMPS:
        x0, x1, z0, z1 = r.rect
        along_x = r.high in ('-x', '+x')
        steps = int(round((x1 - x0) if along_x else (z1 - z0)))
        for s in range(steps):
            a, b = s / steps, (s + 1) / steps
            if along_x:
                xa, xb = x0 + (x1 - x0) * a, x0 + (x1 - x0) * b
                pts = [(xa, r.height(xa, z0), z0), (xa, r.height(xa, z1), z1), (xb, r.height(xb, z1), z1), (xb, r.height(xb, z0), z0)]
            else:
                za, zb = z0 + (z1 - z0) * a, z0 + (z1 - z0) * b
                pts = [(x0, r.height(x0, za), za), (x0, r.height(x0, zb), zb), (x1, r.height(x1, zb), zb), (x1, r.height(x1, za), za)]
            G.face(pts, 'DeckLine' if s % 2 == 0 else 'Deck')
        t = 0.5
        if along_x:
            prof = [(x0, r.lo), (x1, r.lo), (x1, r.height(x1, z0) + RAIL), (x0, r.height(x0, z0) + RAIL)]
            wedge(prof, (z0 - t, z0), 'x')
            wedge(prof, (z1, z1 + t), 'x')
        else:
            prof = [(z0, r.lo), (z1, r.lo), (z1, r.height(x0, z1) + RAIL), (z0, r.height(x0, z0) + RAIL)]
            wedge(prof, (x0 - t, x0), 'z')
            wedge(prof, (x1, x1 + t), 'z')


def lava_look():
    """The river's surface in cells (hot patches here and there, dark crust), and the bank walls down to it."""
    for (i, j) in sorted(LAVA_CELLS):
        x0, x1, z0, z1 = i * U, (i + 1) * U, j * U, (j + 1) * U
        roll = rng.random()
        flat((x0, x1, z0, z1), LAVA_Y, 'LavaHot' if roll < 0.18 else 'Crust' if roll < 0.3 else 'Lava')
    for (i, j) in sorted(LAVA_CELLS):
        for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            n = (i + di, j + dj)
            if n in LAVA_CELLS or not in_domain(n):
                continue
            top = VOIDS.get(n)
            if top is None:
                lv = [h for h in present(n)]
                if not lv:
                    continue
                top = max(lv)
            if di:
                x = (i + 1) * U if di > 0 else i * U
                vwall('x', x, j * U, (j + 1) * U, LAVA_Y, top, 'LavaWall' if top > 0 else 'Wall')
                vwall('x', x - di * 0.05, j * U, (j + 1) * U, LAVA_Y, LAVA_Y + 1.2, 'LavaHot')
            else:
                z = (j + 1) * U if dj > 0 else j * U
                vwall('z', z, i * U, (i + 1) * U, LAVA_Y, top, 'LavaWall' if top > 0 else 'Wall')
                vwall('z', z - dj * 0.05, i * U, (i + 1) * U, LAVA_Y, LAVA_Y + 1.2, 'LavaHot')


def decorations():
    # The lavafall: a glowing strip down the rock face the tributary comes from.
    G.face([(-71.6, 20.0, 76.05), (-56.4, 20.0, 76.05), (-56.4, LAVA_Y + 0.5, 76.05), (-71.6, LAVA_Y + 0.5, 76.05)], 'LavaHot')
    for dx in (-68.0, -63.0, -59.0):
        G.face([(dx, 14.0, 76.08), (dx + 1.0, 14.0, 76.08), (dx + 1.0, LAVA_Y + 0.5, 76.08), (dx, LAVA_Y + 0.5, 76.08)], 'Lava')
    # Objective dais: a gold inlay under each Objective, and a brazier cube at the corners of the island.
    for _, x, z, _, _ in OBJECTIVES:
        c = (math.floor(x / U), math.floor(z / U))
        h = max(present(c)) if present(c) else 0.0
        flat((x - 3, x + 3, z - 3, z + 3), h + 0.06, 'Gold')
    for sx in (-1, 1):
        for sz in (-1, 1):
            bx, bz = sx * 10.0, 6.0 + sz * 4.0
            G.box(bx - 0.6, bx + 0.6, 4.0, 5.2, bz - 0.6, bz + 0.6, 'Wall', top='WallTop')
            G.box(bx - 0.4, bx + 0.4, 5.2, 6.0, bz - 0.4, bz + 0.4, 'Fire')
    # Banners at the bases.
    for z, mat, f in ((-BASE, 'Banner0', 1), (BASE, 'Banner1', -1)):
        G.box(-0.15, 0.15, 0, 7, z - 0.15, z + 0.15, 'Wood')
        G.box(0.15, 2.4, 4.2, 6.8, z - 0.04 * f, z + 0.04 * f, mat)
    # Stalagmite-free glowing runes: a seam of blue along each ramp's low end, a floor line at each bridge's mouth.
    for r in RAMPS:
        x0, x1, z0, z1 = r.rect
        G.box(x0 + 0.5, x1 - 0.5, r.lo + 0.02, r.lo + 0.08, z0 + 0.5, z1 - 0.5, 'RuneBlue') if False else None
    for (x0, x1, z0, z1) in DECKS:
        if x1 - x0 >= z1 - z0:
            for xx in (x0 + 0.4, x1 - 0.8):
                G.box(xx, xx + 0.4, 4.0, 4.07, z0 + 0.4, z1 - 0.4, 'RuneBlue')
        else:
            for zz in (z0 + 0.4, z1 - 0.8):
                G.box(x0 + 0.4, x1 - 0.4, 4.0, 4.07, zz, zz + 0.4, 'RuneBlue')


def build_look(faces):
    top_faces()
    wall_looks(faces)
    ramp_looks()
    lava_look()
    decorations()


# ---------------------------------------------------------------- the Battle map file


def r4(x):
    return round(x, 4) + 0.0


def site_of(id, x, z, weight, y):
    s = {'id': id, 'x': r4(x), 'z': r4(z), 'weight': float(weight), 'owner': -1, 'spawn': False}
    if y is not None:
        s['y'] = float(y)
    return s


def plain_json(surfaces, walls):
    walk = []
    for id, pts, lava in surfaces:
        w = {'id': f'WALK_{id}', 'points': [[r4(x), r4(y), r4(z)] for x, y, z in pts]}
        if lava:
            w['lava'] = True
        walk.append(w)
    walk.sort(key=lambda w: w['id'])
    wl = sorted(({'id': f'WALL_{id}', 'a': [r4(a[0]), r4(a[1])], 'b': [r4(b[0]), r4(b[1])], 'bottom': r4(bottom), 'top': r4(top)} for id, a, b, bottom, top in walls), key=lambda w: w['id'])
    return {'name': 'cavern', 'front': FRONT, 'armySize': ARMY_SIZE, 'ticketsPerSoldier': TICKETS, 'bases': [[0.0, -BASE], [0.0, BASE]],
            'objectives': [site_of(*o) for o in OBJECTIVES], 'blocks': [], 'walls': wl, 'walk': walk}


def write_json(path, data):
    def items(key):
        rows = data[key]
        return [f'    {json.dumps(r)}' + (',' if k < len(rows) - 1 else '') for k, r in enumerate(rows)]
    lines = ['{', '  "name": "cavern",', f'  "front": {json.dumps(data["front"])},', f'  "armySize": {json.dumps(data["armySize"])},', f'  "ticketsPerSoldier": {json.dumps(data["ticketsPerSoldier"])},',
             f'  "bases": {json.dumps(data["bases"])},', '  "objectives": [', *items('objectives'), '  ],', '  "blocks": [],', '  "walls": [', *items('walls'),
             '  ],', '  "walk": [', *items('walk'), '  ]', '}', '']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        f.write('\n'.join(lines))


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
    for name, (colour, rough, double, emit) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Emission Color'].default_value = rgba if emit else (0, 0, 0, 1)
        bsdf.inputs['Emission Strength'].default_value = float(emit)
        m.diffuse_color = rgba
        m.use_backface_culling = False
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


def poly_object(coll, name, pts, **props):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
    obj = bpy.data.objects.new(name, me)
    for k, v in props.items():
        obj[k] = v
    coll.objects.link(obj)


def collision(coll, surfaces, walls):
    for id, pts, lava in surfaces:
        poly_object(coll, f'WALK_{id}', pts, **({'lava': 1} if lava else {}))
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
    return [r4(v.x), r4(v.z), r4(-v.y)]


def export_json(coll):
    objs = sorted(coll.objects, key=lambda o: o.name)
    walk, walls, objectives, bases = [], [], [], [None, None]
    front = None
    for o in objs:
        world = lambda i: to_game(o.matrix_world @ o.data.vertices[i].co)
        if o.name.startswith('WALK_'):
            w = {'id': o.name, 'points': [world(i) for i in o.data.polygons[0].vertices]}
            if 'lava' in o.keys():
                w['lava'] = True
            walk.append(w)
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
    return {'name': 'cavern', 'front': front, 'armySize': ARMY_SIZE, 'ticketsPerSoldier': TICKETS, 'bases': bases,
            'objectives': [o for _, o in sorted(objectives, key=lambda e: e[0])], 'blocks': [], 'walls': walls, 'walk': walk}


def W(v):
    """The plan lies on a lattice of 4 m; the Simulation's destination fields on one of 5 m centred on 0, whose cell centres must never lie on a Wall.
    Every coordinate is moved half a metre (the field's edges stay), so no edge of the plan is ever on a centre."""
    return -HALF if v <= -HALF else min(HALF, v + SHIFT)


SHIFT = 0.5


def build():
    global OBJECTIVES
    surfaces = walk_surfaces()
    walls, faces = walls_and_faces()
    build_look(faces)
    surfaces = [(i, [(W(x), y, W(z)) for x, y, z in pts], lava) for i, pts, lava in surfaces]
    walls = [(i, (W(a[0]), W(a[1])), (W(b[0]), W(b[1])), bo, to) for i, a, b, bo, to in walls]
    G.verts = [(W(x), y, W(z)) for x, y, z in G.verts]
    OBJECTIVES = [(i, W(x), W(z), w, y) for i, x, z, w, y in OBJECTIVES]
    report = {'walk': len(surfaces), 'walls': len(walls), 'ramps': len(RAMPS), 'bridges': len(DECKS), 'faces': len(G.faces), 'saved': bool(SAVE)}
    if bpy is None:
        if SAVE:
            write_json(OUT_JSON, plain_json(surfaces, walls))
        return report
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    mats = materials()
    look = collection(NAME)
    helpers = collection('Collision')
    for c in bpy.context.scene.collection.children:
        c.hide_render = c.hide_viewport = c.name not in (NAME, 'Collision')
    cave = mesh_object(NAME, G, look, mats)
    collision(helpers, surfaces, walls)
    helpers.hide_render = True
    report['triangles'] = sum(len(p.vertices) - 2 for p in cave.data.polygons)
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        cave.select_set(True)
        bpy.context.view_layer.objects.active = cave
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


REPORT = build()
if __name__ == '__main__':
    print(REPORT)
