"""
Builds the City, the third hand-built Battle map (docs/plans/battle-objectives.md, Stage 6; ADR 0022), in Blender: the look (a mesh with
flat-colour materials) and the geometry the Simulation reads (helper objects in a `Collision` collection). This script is the source of
truth for both (ADR 0006): re-run it to change the map.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_battle_city.py").read(), {"__file__": r"C:/Repos/sword/art/build_battle_city.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_battle_city.py').read(), {'__file__': r'C:/Repos/sword/art/build_battle_city.py', 'SAVE': True})"
or, with no Blender at all (the Walk Surfaces, Walls and JSON only; no model):
    python art/build_battle_city.py

With SAVE = True it writes public/models/arenas/battle_city.glb (the look) and data/battlemaps/city.json (the Battle map, read back from the
Collision helpers). The helpers are the Ziggurat's (art/build_battle_ziggurat.py): WALK_* (Walk Surfaces), WALL_* (Walls), OBJ_*
(Objectives), BASE_T<team> and DEPLOY. Like the Ziggurat it has no BLOCK_*: every solid part is a raised Walk Surface with no ground under
it, Walls on its faces and a rail on its edge, so no Soldier is ever pushed out of anything.

Everything is authored in game coordinates (x east, y up, z toward Team 1; facing 0 looks along +z) and placed in Blender as (x, -z, y),
which the glTF export (export_yup) turns back into game coordinates.

The map: a walled hill town, 114 m across, of 24 blocks of houses on a grid of 6 m streets (a 3 m ring road round it), with a market square
at its middle, a cathedral to the west of it, and a castle on a rock in the north-east corner. It is NOT symmetric: the armies are not a half
turn of each other (the castle is Team 1's end), and balancing that is left to the Players (nothing here tunes Tickets or spawns).

The rooftops are the second city: every block has a flat roof (6, 9 or 12 m up, the castle's rampart 9 and its keep 15), and they are joined:
a stair (a 6 m ramp inside the block, from its street door up to its roof) for each 6 m block, a wooden bridge across the street between
two roofs of one height, and a ramp over the street between two roofs 3 or 6 m apart. So the whole city is one graph of levels, each one
walked to from every other (the Fort's check), and a Soldier never jumps: a roof's edge is a parapet, a rail. Streets run under the
bridges (the layered walk rule keeps a Soldier on his own level).

Five Objectives, four of them up: A on a low roof near Team 0, B in the market square (the one on the ground), C on the keep, D on the tall
roof across the street from Team 0's other flank, E on a tall roof near Team 1.

The floor plan is one raster of 3 m cells over the 120 m square round the town (`LEVELS`: per height, the cells that have a floor there);
the Walk Surfaces, Walls and look are read off it. Ramps stand over cells whose floor was cut out; a cell with no floor at all (`VOIDS`) is
solid up to a height (a tower, or the building under a ramp).
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
NAME = 'City'
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'battle_city.glb')
OUT_JSON = os.path.join(REPO, 'data', 'battlemaps', 'city.json')

HALF = 100.0  # the field's half side (battle.field.size / 2)
FRONT = 70.0  # Team 0's front rank stands at z = -FRONT: on the avenue outside the town (its edge is z = -60)
BASE = 88.0  # each Team's Base, behind its deployment
ARMY_SIZE = {'standard': 144, 'max': 144}  # as the Fort's and the Ziggurat's
TICKETS = 2.4  # the Fort's: not tuned for this map

U = 3.0  # the raster's cell (m)
DOMAIN = 60.0  # the raster covers the square of half side 60 m
RAIL = 1.0  # a parapet's height above its floor
WIDE = 6.0  # streets, stairs and bridges
EPS = 1e-6
N = int(DOMAIN / U)  # cells each side of the centre

rng = random.Random(7)

# name: (sRGB colour, roughness, double sided; the export is double sided throughout, so a face seen from behind is never missing)
MATERIALS = {
    'Plaster0': (0xd9c7a0, 1.0, False),
    'Plaster1': (0xc9a26b, 1.0, False),
    'Plaster2': (0xcfa79a, 1.0, False),
    'Plaster3': (0xb9b3a3, 1.0, False),
    'Timber': (0x5a4330, 1.0, False),
    'Eave': (0x7a5a3c, 1.0, False),
    'Window': (0x2d2a2a, 1.0, False),
    'Tile0': (0xa8472f, 1.0, False),
    'Tile0b': (0x9a4029, 1.0, False),
    'Tile1': (0x8d3d2b, 1.0, False),
    'Tile1b': (0x7f3626, 1.0, False),
    'Tile2': (0x4f5d73, 1.0, False),
    'Tile2b': (0x465369, 1.0, False),
    'Tile3': (0x5d4e43, 1.0, False),
    'Tile3b': (0x52443a, 1.0, False),
    'Cobble0': (0x8a8070, 1.0, False),
    'Cobble1': (0x7d7464, 1.0, False),
    'PlazaStone': (0xa89c84, 1.0, False),
    'Stone': (0x8f8473, 1.0, False),
    'StoneDark': (0x6b5f50, 1.0, False),
    'StoneLight': (0xb3a68d, 1.0, False),
    'Wall': (0x8a7e6c, 1.0, True),
    'WallTop': (0xb09f84, 1.0, True),
    'Rock': (0x6e675c, 1.0, False),
    'Deck': (0x7a5a3a, 1.0, False),
    'Gold': (0xc9a227, 1.0, False),
    'Fire': (0xe8742c, 1.0, False),
    'Grass0': (0x4f6b34, 1.0, False),
    'Grass1': (0x5e7a3b, 1.0, False),
    'Grass2': (0x6f8a45, 1.0, False),
    'Moss': (0x5f7048, 1.0, False),
    'Dirt': (0x7d6a4f, 1.0, False),
    'Bark': (0x4a3826, 1.0, False),
    'Leaf0': (0x2f5a2c, 1.0, False),
    'Leaf1': (0x3f7433, 1.0, False),
    'Leaf2': (0x264a2a, 1.0, False),
    'Wood': (0x5a4330, 1.0, False),
    'Awning0': (0xb03a2e, 1.0, False),
    'Awning1': (0x2e6fa1, 1.0, False),
    'Awning2': (0xd4a52b, 1.0, False),
    'Slate': (0x3c4656, 1.0, False),
    'Banner0': (0xc0392b, 1.0, False),
    'Banner1': (0x2e86c1, 1.0, False),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- the town (game coordinates)

# Five columns and five rows of 18 m blocks on 6 m streets, with a 3 m ring road round them: block k spans COLS[k]. GRID[j][i] is the roof height
# of the block at column i (x) and row j (z, from Team 0's end): a number, 'CAT' (the cathedral, 12 m), 'M' (the market, no roof), or 'C' (the
# castle, the four blocks of the north-east corner and the streets between them as one rampart 9 m up).
COLS = [(-57.0, -39.0), (-33.0, -15.0), (-9.0, 9.0), (15.0, 33.0), (39.0, 57.0)]
GRID = [
    [6, 9, 6, 6, 9],
    [6, 6, 9, 12, 6],
    [9, 'CAT', 'M', 6, 9],
    [9, 6, 9, 'C', 'C'],
    [6, 12, 6, 'C', 'C'],
]
CASTLE = (15.0, 57.0, 15.0, 57.0)
CASTLE_H = 9.0
KEEP = (30.0, 42.0, 33.0, 45.0)  # the keep's roof (15 m) on the rampart
KEEP_H = 15.0
# Solid towers (no floor: the Walls of their faces stop everyone): rect and top.
TOWERS = [
    ((15.0, 21.0, 15.0, 21.0), 16.0),
    ((51.0, 57.0, 15.0, 21.0), 16.0),
    ((15.0, 21.0, 51.0, 57.0), 16.0),
    ((51.0, 57.0, 51.0, 57.0), 16.0),
    ((-33.0, -27.0, -9.0, -3.0), 17.0),  # the cathedral's two west towers
    ((-33.0, -27.0, 3.0, 9.0), 17.0),
]
HEIGHTS = [0.0, 6.0, 9.0, 12.0, 15.0]

# In the order a Battle numbers them: id, x, z, weight, y (None: the highest floor there).
OBJECTIVES = [
    ('A', -48.0, -24.0, 1.0, None),  # a low roof on Team 0's west flank
    ('B', 0.0, 0.0, 1.4, None),  # the market square: the ground
    ('C', 36.0, 39.0, 1.2, None),  # the keep (15 m)
    ('D', 24.0, -24.0, 1.0, None),  # the tall roof (12 m) across from Team 0's east flank
    ('E', -24.0, 48.0, 1.0, None),  # a tall roof (12 m) on Team 1's west flank
]


class Block:
    def __init__(self, id, rect, h, kind):
        self.id, self.rect, self.h, self.kind = id, rect, float(h), kind


def build_blocks():
    out = []
    for j, row in enumerate(GRID):
        for i, v in enumerate(row):
            if v == 'M' or v == 'C':
                continue
            rect = (COLS[i][0], COLS[i][1], COLS[j][0], COLS[j][1])
            out.append(Block(f'b{i}{j}', rect, 12 if v == 'CAT' else v, 'cathedral' if v == 'CAT' else 'house'))
    out.append(Block('castle', CASTLE, CASTLE_H, 'castle'))
    return out


BLOCKS = build_blocks()


def centre(i):
    return (i + 0.5) * U


def cells_in(x0, x1, z0, z1):
    """The cells whose centres lie inside the rectangle."""
    return {(i, j) for i in range(-N, N) for j in range(-N, N) if x0 < centre(i) < x1 and z0 < centre(j) < z1}


def expand(cells):
    return {(i + a, j + b) for (i, j) in cells for a in (-1, 0, 1) for b in (-1, 0, 1)}


def rot(p, quarter):
    x, z = p
    for _ in range(quarter % 4):
        x, z = -z, x
    return (x, z)


class Ramp:
    """A sloped Walk Surface over a rectangle (x0, x1, z0, z1): `lo` at its low end, `hi` at its high end, which lies along `high` (-x, +x, -z
    or +z side of the rectangle). Its rails stand on its two long sides."""

    def __init__(self, id, rect, lo, hi, high):
        self.id, self.rect, self.lo, self.hi, self.high = id, rect, lo, hi, high

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


def mk(axis, a0, a1, l0, l1):
    """A rectangle from `a0` to `a1` along `axis` and `l0` to `l1` across it."""
    return (a0, a1, l0, l1) if axis == 'x' else (l0, l1, a0, a1)


def build_plan():
    """The floor plan: {height: set of cells}, the ramps, the solid cells {cell: top}, the bridges' cells."""
    levels = {h: set() for h in HEIGHTS}
    voids, deck, ramps = {}, set(), []
    for i in range(-N, N):
        for j in range(-N, N):
            levels[0.0].add((i, j))
    for b in BLOCKS:
        cs = cells_in(*b.rect)
        levels[0.0] -= cs
        levels[b.h] |= cs
    keep = cells_in(*KEEP)
    levels[CASTLE_H] -= keep
    levels[KEEP_H] |= keep
    used = set()
    for rect, top in TOWERS:
        for c in cells_in(*rect):
            for h in HEIGHTS:
                levels[h].discard(c)
            voids[c] = top
            used.add(c)
    for _, x, z, _, _ in OBJECTIVES:
        used |= cells_in(x - 3.0, x + 3.0, z - 3.0, z + 3.0)

    def free(cells):
        return not (cells & used)

    def place(ramp, cut_levels):
        cs = cells_in(*ramp.rect)
        for h in cut_levels:
            for c in cs & levels[h]:
                voids[c] = max(voids.get(c, 0.0), h)
            levels[h] -= cs
        ramps.append(ramp)
        used.update(cs)

    # The castle's two long stairs, by hand: from the street at its south face up to the rampart (9 m in 21), and from the rampart up to the keep.
    place(Ramp('ramp_castle', (21.0, 27.0, 15.0, 36.0), 0.0, CASTLE_H, '+z'), [CASTLE_H])
    place(Ramp('ramp_keep', (33.0, 39.0, 18.0, 33.0), CASTLE_H, KEEP_H, '+z'), [CASTLE_H])

    parent = {b.id: b.id for b in BLOCKS}
    parent['G'] = 'G'

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        parent[find(a)] = find(b)

    union('castle', 'G')

    # A stair up from the street into each 6 m house: inside the block, 15 m long, from the face to a roof cell beyond it.
    for b in BLOCKS:
        if b.kind != 'house' or abs(b.h - 6.0) > EPS:
            continue
        X0, X1, Z0, Z1 = b.rect
        cands = []
        for off in (0.0, U, 2 * U, 3 * U, 4 * U):
            cands.append(('x', X0, X0 + 15.0, Z0 + off, '+x', mk('x', X0 - U, X0, Z0 + off, Z0 + off + WIDE), mk('x', X0 + 15.0, X0 + 18.0, Z0 + off, Z0 + off + WIDE)))
            cands.append(('x', X1 - 15.0, X1, Z0 + off, '-x', mk('x', X1, X1 + U, Z0 + off, Z0 + off + WIDE), mk('x', X1 - 18.0, X1 - 15.0, Z0 + off, Z0 + off + WIDE)))
            cands.append(('z', Z0, Z0 + 15.0, X0 + off, '+z', mk('z', Z0 - U, Z0, X0 + off, X0 + off + WIDE), mk('z', Z0 + 15.0, Z0 + 18.0, X0 + off, X0 + off + WIDE)))
            cands.append(('z', Z1 - 15.0, Z1, X0 + off, '-z', mk('z', Z1, Z1 + U, X0 + off, X0 + off + WIDE), mk('z', Z1 - 18.0, Z1 - 15.0, X0 + off, X0 + off + WIDE)))
        rng.shuffle(cands)
        done = False
        for axis, a0, a1, l0, high, outside, beyond in cands:
            rect = mk(axis, a0, a1, l0, l0 + WIDE)
            cs = cells_in(*rect)
            if cs <= levels[b.h] and free(cs) and cells_in(*beyond) <= levels[b.h] and cells_in(*outside) <= levels[0.0] and len(cells_in(*outside)) > 0:
                place(Ramp(f'ramp_door_{b.id}', rect, 0.0, b.h, high), [b.h])
                union(b.id, 'G')
                done = True
                break
        if not done:
            raise SystemExit(f'no stair fits block {b.id}')

    # Between blocks across a street: a bridge between roofs of one height, a ramp between two roofs 3 or 6 m apart.
    pairs = []
    for P in BLOCKS:
        for Q in BLOCKS:
            if P is Q:
                continue
            if abs(Q.rect[0] - P.rect[1] - WIDE) < EPS:
                lat = (max(P.rect[2], Q.rect[2]), min(P.rect[3], Q.rect[3]))
                if lat[1] - lat[0] >= WIDE + U - EPS:
                    pairs.append((P, Q, 'x', lat))
            if abs(Q.rect[2] - P.rect[3] - WIDE) < EPS:
                lat = (max(P.rect[0], Q.rect[0]), min(P.rect[1], Q.rect[1]))
                if lat[1] - lat[0] >= WIDE + U - EPS:
                    pairs.append((P, Q, 'z', lat))
    rng.shuffle(pairs)

    def try_pair(P, Q, axis, lat):
        pe = P.rect[1] if axis == 'x' else P.rect[3]
        qs = Q.rect[0] if axis == 'x' else Q.rect[2]
        rise = abs(P.h - Q.h)
        if rise > 6.0 + EPS:
            return False
        offs = []
        s = lat[0]
        while s + WIDE <= lat[1] + EPS:
            offs.append(s)
            s += U
        rng.shuffle(offs)
        for l0 in offs:
            l1 = l0 + WIDE
            if rise < EPS:
                rect = mk(axis, pe, qs, l0, l1)
                cs = cells_in(*rect)
                before = cells_in(*mk(axis, pe - U, pe, l0, l1))
                after = cells_in(*mk(axis, qs, qs + U, l0, l1))
                if cs <= levels[0.0] and free(cs) and before <= levels[P.h] and after <= levels[P.h]:
                    levels[P.h] |= cs
                    deck.update(cs)
                    used.update(cs)
                    return True
                continue
            run = 9.0 if rise < 4.0 else 15.0
            low, high_b = (P, Q) if P.h < Q.h else (Q, P)
            if low is P:
                rect, high = mk(axis, pe - (run - WIDE), qs, l0, l1), '+' + axis
                front, back = mk(axis, pe - (run - WIDE) - U, pe - (run - WIDE), l0, l1), mk(axis, qs, qs + U, l0, l1)
            else:
                rect, high = mk(axis, pe, qs + (run - WIDE), l0, l1), '-' + axis
                front, back = mk(axis, qs + (run - WIDE), qs + (run - WIDE) + U, l0, l1), mk(axis, pe - U, pe, l0, l1)
            cs = cells_in(*rect)
            street = cells_in(*mk(axis, pe, qs, l0, l1))
            roof = cs - street
            if roof <= levels[low.h] and street <= levels[0.0] and free(cs) and cells_in(*front) <= levels[low.h] and cells_in(*back) <= levels[high_b.h]:
                place(Ramp(f'ramp_{low.id}_{high_b.id}_{int(l0)}', rect, low.h, high_b.h, high), [low.h])
                # the street's floor stays under the ramp: only the low roof's cells were cut
                return True
        return False

    for P, Q, axis, lat in pairs:
        joined = find(P.id) != find(Q.id)
        if joined or rng.random() < 0.5:
            if try_pair(P, Q, axis, lat) and joined:
                union(P.id, Q.id)
    if len({find(b.id) for b in BLOCKS} | {find('G')}) != 1:
        raise SystemExit('some roof is not joined to the ground: ' + ', '.join(sorted(b.id for b in BLOCKS if find(b.id) != find('G'))))
    filled = prune(levels, ramps, voids)
    return levels, ramps, voids, deck, filled


def prune(levels, ramps, voids):
    """A stair or ramp can cut a roof in two, leaving a piece no Soldier can reach (the walk check refuses it): every piece of floor that is
    not joined to the ground by cells, bridges and ramps is made solid instead (`voids`, and returned as {cell: height} for the look)."""
    comp = {}
    parts = []
    for h, cells in levels.items():
        for c in sorted(cells):
            if (h, c) in comp:
                continue
            k = len(parts)
            todo, members = [c], []
            comp[(h, c)] = k
            while todo:
                a = todo.pop()
                members.append(a)
                for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    b = (a[0] + d[0], a[1] + d[1])
                    if b in cells and (h, b) not in comp:
                        comp[(h, b)] = k
                        todo.append(b)
            parts.append((h, members))
    links = {k: set() for k in range(len(parts))}
    for r in ramps:
        x0, x1, z0, z1 = r.rect
        # the cells just beyond each end of the way (not those beside it: its rails stand there)
        along_x = r.high in ('-x', '+x')
        if along_x:
            hi_end = (x1, x1 + U, z0, z1) if r.high == '+x' else (x0 - U, x0, z0, z1)
            lo_end = (x0 - U, x0, z0, z1) if r.high == '+x' else (x1, x1 + U, z0, z1)
        else:
            hi_end = (x0, x1, z1, z1 + U) if r.high == '+z' else (x0, x1, z0 - U, z0)
            lo_end = (x0, x1, z0 - U, z0) if r.high == '+z' else (x0, x1, z1, z1 + U)
        ends = set()
        for h, rect in ((r.lo, lo_end), (r.hi, hi_end)):
            for b in cells_in(*rect):
                if (h, b) in comp:
                    ends.add(comp[(h, b)])
        ends = list(ends)
        for a in ends:
            links[a].update(ends)
    start = comp[(0.0, (-N, -N))]
    seen, todo = {start}, [start]
    while todo:
        for b in links[todo.pop()]:
            if b not in seen:
                seen.add(b)
                todo.append(b)
    filled = {}
    for k, (h, members) in enumerate(parts):
        if k in seen:
            continue
        for c in members:
            levels[h].discard(c)
            voids[c] = max(voids.get(c, 0.0), h)
            filled[c] = h
    return filled


LEVELS, RAMPS, VOIDS, DECK, FILLED = build_plan()
RAMP_COLS = {}
for _r in RAMPS:
    for _c in cells_in(*_r.rect):
        RAMP_COLS.setdefault(_c, []).append(_r)


def present(c):
    return [h for h, cs in LEVELS.items() if c in cs]


def in_domain(c):
    return -N <= c[0] < N and -N <= c[1] < N


def block_at(x, z):
    for b in BLOCKS:
        if b.rect[0] <= x <= b.rect[1] and b.rect[2] <= z <= b.rect[3]:
            return b
    return None


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
    """The rolling ground beyond the town (m, never below 0), flat on the avenue each army deploys along and at each Base."""
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
    """The hills: a grid of 10 m cells over the whole field, each cell outside the town as two triangles of Walk Surfaces."""
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
    """Every edge of every present cell that has no floor of the same height beyond it: (kind, a, b, y, top, side) with kind 'face' (a wall of
    the mass beyond, up to `top`) or 'rail' (a parapet on the cell's own edge), a and b as (x, z), side the way the edge faces (toward the cell)."""
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
                        continue
                if di:
                    x = (i + 1) * U if di > 0 else i * U
                    a, b = (x, j * U), (x, (j + 1) * U)
                else:
                    z = (j + 1) * U if dj > 0 else j * U
                    a, b = (i * U, z), ((i + 1) * U, z)
                out.append((kind, a, b, h, top, (-di, -dj)))
    return out


def merged(edges):
    """Collinear touching edges of the same kind, height, top and side as one: [(kind, axis, coord, lo, hi, y, top, side)]."""
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
    """(walls for the Simulation, faces and rails for the look). Walls: (id, a, b, bottom, top). A face seen from two sides (a wall between two
    floors both below its top) is one Wall for each side: it is the same quad, so the second is dropped."""
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
    walls += [(i, a, b, -1.0, 4.0) for i, a, b in edge]
    return walls, faces


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
    G.face([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], mat)


def tile_of(x, z):
    b = block_at(x, z)
    return 3 if b is None else (BLOCKS.index(b) % 4)


def in_stone(x, z):
    """Whether (x, z) is part of the castle or the cathedral (stone, not plaster)."""
    cx0, cx1, cz0, cz1 = CASTLE
    if cx0 - 1 <= x <= cx1 + 1 and cz0 - 1 <= z <= cz1 + 1:
        return True
    b = block_at(x, z)
    return b is not None and b.kind == 'cathedral'


def top_faces():
    for h, cells in sorted(LEVELS.items()):
        for (i, j) in sorted(cells):
            x0, x1, z0, z1 = i * U, (i + 1) * U, j * U, (j + 1) * U
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            chk = (i + j) % 2 == 0
            if h == 0.0:
                flat((x0, x1, z0, z1), 0.01, ('Cobble0' if chk else 'Cobble1') if not (abs(cx) < 9 and abs(cz) < 9) else 'PlazaStone')
            elif (i, j) in DECK:
                flat((x0, x1, z0, z1), h, 'Deck')
            elif in_stone(cx, cz) and h >= CASTLE_H - EPS and cx > 12 and cz > 12:
                flat((x0, x1, z0, z1), h, 'StoneLight' if chk else 'Stone')
            elif in_stone(cx, cz):
                flat((x0, x1, z0, z1), h, 'Slate' if chk else 'Tile2b')
            else:
                t = tile_of(cx, cz)
                flat((x0, x1, z0, z1), h, f'Tile{t}' if chk else f'Tile{t}b')
    for (i, j), h in sorted(FILLED.items()):
        x0, x1, z0, z1 = i * U, (i + 1) * U, j * U, (j + 1) * U
        t = tile_of((x0 + x1) / 2, (z0 + z1) / 2)
        flat((x0, x1, z0, z1), h, f'Tile{t}' if (i + j) % 2 == 0 else f'Tile{t}b')
    # The tower tops are roofed too.
    for rect, top in TOWERS:
        flat(rect, top, 'Stone')
    # The rock the castle stands on: its foot is wall; its top is the rampart.


def wall_looks(faces):
    """Each face a plaster (or stone) wall in bands with windows; each rail a thin parapet (wood on a bridge)."""
    for kind, axis, coord, lo, hi, y, top, side in faces:
        if kind == 'face':
            mid = (lo + hi) / 2
            px, pz = (coord, mid) if axis == 'x' else (mid, coord)
            ix, iz = px - side[0] * 1.5, pz - side[1] * 1.5  # a point inside the building
            stone = in_stone(ix, iz)
            b = block_at(ix, iz)
            body = 'Wall' if stone else f'Plaster{(BLOCKS.index(b) if b else 3) % 4}'
            cap = 'WallTop' if stone else 'Eave'
            cut = top - 0.8 if not stone else y + (top - y) * 0.82
            for (b0, b1, mat) in ((y, cut, body), (cut, top, cap)):
                if axis == 'x':
                    G.face([(coord, b0, lo), (coord, b0, hi), (coord, b1, hi), (coord, b1, lo)], mat)
                else:
                    G.face([(lo, b0, coord), (lo, b1, coord), (hi, b1, coord), (hi, b0, coord)], mat)
            if not stone and top - y > 3.5:
                # windows: two or three floors of them, every 4.5 m along the wall, standing out of it toward the street
                pos = lo + 2.25
                while pos + 0.6 < hi - 0.9:
                    for base in (1.4, 4.6, 7.8):
                        if y + base + 1.4 <= top - 0.9:
                            a0, a1 = pos - 0.6, pos + 0.6
                            if axis == 'x':
                                lo_c, hi_c = sorted((coord, coord + side[0] * 0.12))
                                G.box(lo_c, hi_c, y + base, y + base + 1.4, a0, a1, 'Window')
                            else:
                                lo_c, hi_c = sorted((coord, coord + side[1] * 0.12))
                                G.box(a0, a1, y + base, y + base + 1.4, lo_c, hi_c, 'Window')
                    pos += 4.5
        else:
            t = 0.35
            mid = (lo + hi) / 2
            px, pz = (coord, mid) if axis == 'x' else (mid, coord)
            cells = {(math.floor((px + a) / U), math.floor((pz + b) / U)) for a in (-1, 1) for b in (-1, 1)}
            on_deck = bool(cells & DECK)
            mat, topm = ('Wood', 'Timber') if on_deck else (('StoneDark', 'Stone') if in_stone(px, pz) else ('Eave', 'Timber'))
            if axis == 'x':
                G.box(coord - t / 2, coord + t / 2, y, top, lo, hi, mat, top=topm)
            else:
                G.box(lo, hi, y, top, coord - t / 2, coord + t / 2, mat, top=topm)


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


def ramp_looks():
    """Each ramp: its way in bands (a worn step to the eye every metre or so), and a rail along each side."""
    for r in RAMPS:
        x0, x1, z0, z1 = r.rect
        along_x = r.high in ('-x', '+x')
        steps = int(round((x1 - x0) if along_x else (z1 - z0)))
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
        t = 0.5
        if along_x:
            prof = [(x0, r.lo), (x1, r.lo), (x1, r.height(x1, z0) + RAIL), (x0, r.height(x0, z0) + RAIL)]
            wedge(prof, (z0 - t, z0), 'x')
            wedge(prof, (z1, z1 + t), 'x')
        else:
            prof = [(z0, r.lo), (z1, r.lo), (z1, r.height(x0, z1) + RAIL), (z0, r.height(x0, z0) + RAIL)]
            wedge(prof, (x0 - t, x0), 'z')
            wedge(prof, (x1, x1 + t), 'z')


def bridge_looks():
    """A bridge's planks stand on timber beams a half metre thick, so it reads from the street under it."""
    for (i, j) in sorted(DECK):
        for h, cells in LEVELS.items():
            if h > 0 and (i, j) in cells:
                G.box(i * U, (i + 1) * U, h - 0.6, h - 0.02, j * U, (j + 1) * U, 'Timber', skip_bottom=False)


def brazier(x, y, z, s=1.0):
    G.box(x - 0.5 * s, x + 0.5 * s, y, y + 1.0 * s, z - 0.5 * s, z + 0.5 * s, 'StoneDark', top='Stone')
    G.box(x - 0.35 * s, x + 0.35 * s, y + 1.0 * s, y + 1.7 * s, z - 0.35 * s, z + 0.35 * s, 'Fire')


def banner(x, z, mat, facing):
    G.box(x - 0.1, x + 0.1, 0, 6, z - 0.1, z + 0.1, 'Wood')
    G.box(x + 0.1, x + 1.7, 3.6, 5.8, z - 0.03 * facing, z + 0.03 * facing, mat)


def stall(x, z, mat):
    G.box(x - 1.2, x + 1.2, 0, 0.9, z - 0.8, z + 0.8, 'Wood', top='Timber')
    G.box(x - 1.3, x + 1.3, 2.4, 2.55, z - 1.0, z + 1.0, mat)
    for sx in (-1, 1):
        for sz in (-1, 1):
            G.box(x + sx * 1.2 - 0.05, x + sx * 1.2 + 0.05, 0, 2.4, z + sz * 0.9 - 0.05, z + sz * 0.9 + 0.05, 'Wood')


def decorations():
    # The market: stalls round its edge, a gold tile inlaid at its heart (B).
    G.face([(-3, 0.05, -3), (-3, 0.05, 3), (3, 0.05, 3), (3, 0.05, -3)], 'Gold')
    for k, (sx, sz) in enumerate(((-6.5, -6.5), (6.5, -6.5), (-6.5, 6.5), (6.5, 6.5), (0, -7.5), (0, 7.5), (-7.5, 0), (7.5, 0))):
        stall(sx, sz, f'Awning{k % 3}')
    # The cathedral: pinnacles on its roof's east corners and a conical roof on each west tower, a gold cross over its nave.
    for sz in (-7.5, 7.5):
        G.cone(-16.5, 12.0, sz, 1.1, 5.0, 'Slate', 4)
    for rect, top in TOWERS[4:]:
        cx, cz = (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2
        G.cone(cx, top, cz, 4.2, 9.0, 'Slate', 8)
        G.box(cx - 0.1, cx + 0.1, top + 9.0, top + 10.4, cz - 0.1, cz + 0.1, 'Gold')
    # The castle: a conical roof on each corner tower, braziers on the rampart, banners on the keep.
    for rect, top in TOWERS[:4]:
        cx, cz = (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2
        G.cone(cx, top, cz, 4.4, 7.0, 'Tile1', 8)
    for bx, bz in ((24.0, 30.0), (48.0, 30.0), (24.0, 48.0), (48.0, 48.0)):
        brazier(bx, CASTLE_H, bz)
    for sx in (-1, 1):
        G.box(36 + sx * 5.5 - 0.1, 36 + sx * 5.5 + 0.1, KEEP_H, KEEP_H + 5.0, 39 - 0.1, 39 + 0.1, 'Wood')
        G.box(36 + sx * 5.5 + 0.1, 36 + sx * 5.5 + 0.12, KEEP_H + 2.6, KEEP_H + 4.8, 39 - 1.0, 39 + 1.0, 'Banner0')
    # The rock under the castle's south and west faces, a stone lip at the foot.
    for x0, x1, z0, z1 in ((14.0, 58.0, 14.0, 15.0), (14.0, 15.0, 14.0, 58.0)):
        G.box(x0, x1, 0, 1.2, z0, z1, 'Rock', top='StoneDark')
    banner(0, -BASE, 'Banner0', 1)
    banner(0, BASE, 'Banner1', -1)
    # Worn earth where the avenues meet the town.
    for sx in (-1, 1):
        G.face([(sx * 8 - 6, 0.03, -66.0), (sx * 8 - 6, 0.03, -60.0), (sx * 8 + 6, 0.03, -60.0), (sx * 8 + 6, 0.03, -66.0)], 'Dirt')


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
    if u >= v:
        return h00 + u * (hill(x0 + HILL_STEP, z0) - h00) + v * (h11 - hill(x0 + HILL_STEP, z0))
    return h00 + v * (hill(x0, z0 + HILL_STEP) - h00) + u * (h11 - hill(x0, z0 + HILL_STEP))


def forest():
    """Trees (render only: the Simulation walks through them) on the hills, never on the town's ground nor on the avenue each army deploys along."""
    n = 0
    step = 7.0
    x = -HALF + 4
    while x < HALF - 2:
        z = -HALF + 4
        while z < HALF - 2:
            px, pz = x + rng.uniform(-2.5, 2.5), z + rng.uniform(-2.5, 2.5)
            apron = abs(px) < DOMAIN + 4 and abs(pz) < DOMAIN + 4
            avenue = abs(px) < 36
            if not apron and not avenue and abs(px) < HALF - 3 and abs(pz) < HALF - 3 and rng.random() < 0.55:
                y = hill_surface(px, pz) - 0.2
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
    bridge_looks()
    decorations()
    hill_look()
    return forest()


# ---------------------------------------------------------------- the Battle map file (read straight from the data, and from the helpers in Blender)


def r4(x):
    return round(x, 4) + 0.0


def plain_json(surfaces, walls):
    """The same file `export_json` reads back from the helpers, from the data directly (for a run without Blender)."""
    walk = sorted(({'id': f'WALK_{id}', 'points': [[r4(x), r4(y), r4(z)] for x, y, z in pts]} for id, pts in surfaces), key=lambda w: w['id'])
    wl = sorted(({'id': f'WALL_{id}', 'a': [r4(a[0]), r4(a[1])], 'b': [r4(b[0]), r4(b[1])], 'bottom': r4(bottom), 'top': r4(top)} for id, a, b, bottom, top in walls), key=lambda w: w['id'])
    objectives = []
    for k, (id, x, z, weight, y) in enumerate(OBJECTIVES):
        site = {'id': id, 'x': r4(x), 'z': r4(z), 'weight': float(weight), 'owner': -1, 'spawn': False}
        if y is not None:
            site['y'] = float(y)
        objectives.append(site)
    return {'name': 'city', 'front': FRONT, 'armySize': ARMY_SIZE, 'ticketsPerSoldier': TICKETS, 'bases': [[0.0, -BASE], [0.0, BASE]], 'objectives': objectives, 'blocks': [], 'walls': wl, 'walk': walk}


def write_json(path, data):
    """Compact enough to read: one surface, wall or Objective per line."""
    def items(key):
        rows = data[key]
        return [f'    {json.dumps(r)}' + (',' if k < len(rows) - 1 else '') for k, r in enumerate(rows)]
    lines = ['{', '  "name": "city",', f'  "front": {json.dumps(data["front"])},', f'  "armySize": {json.dumps(data["armySize"])},', f'  "ticketsPerSoldier": {json.dumps(data["ticketsPerSoldier"])},',
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
    for name, (colour, rough, double) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = rough
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
    return [r4(v.x), r4(v.z), r4(-v.y)]


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
        'name': 'city',
        'front': front,
        'armySize': ARMY_SIZE,
        'ticketsPerSoldier': TICKETS,
        'bases': bases,
        'objectives': [o for _, o in sorted(objectives, key=lambda e: e[0])],
        'blocks': [],
        'walls': walls,
        'walk': walk,
    }


def build():
    surfaces = walk_surfaces()
    walls, faces = walls_and_faces()
    trees = build_look(faces)
    report = {'walk': len(surfaces), 'walls': len(walls), 'ramps': len(RAMPS), 'bridges': len(DECK) // 4, 'trees': trees, 'faces': len(G.faces), 'saved': bool(SAVE)}
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
    town = mesh_object(NAME, G, look, mats)
    collision(helpers, surfaces, walls)
    helpers.hide_render = True
    report['triangles'] = sum(len(p.vertices) - 2 for p in town.data.polygons)
    report['faces_dropped'] = len(G.faces) - len(town.data.polygons)
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        town.select_set(True)
        bpy.context.view_layer.objects.active = town
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('CITY_RESULT', json.dumps(result))
