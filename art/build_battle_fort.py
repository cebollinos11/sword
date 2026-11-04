"""
Builds the Fort, the first hand-built Battle map (docs/plans/battle-objectives.md, Stage 3a; ADR 0022), in
Blender: the look (a mesh with flat-colour materials) and the geometry the Simulation reads (helper objects in a
`Collision` collection). This script is the source of truth for both (ADR 0006): re-run it to change the map.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_battle_fort.py").read(), {"__file__": r"C:/Repos/sword/art/build_battle_fort.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_battle_fort.py').read(), {'__file__': r'C:/Repos/sword/art/build_battle_fort.py', 'SAVE': True})"

With SAVE = True it writes public/models/arenas/battle_fort.glb (the look) and data/battlemaps/fort.json (the
Battle map, read back from the Collision helpers):
  - WALK_<id>:  one planar convex face of the floor (a Walk Surface). The ground is the field's square less the
                solid blocks and less what the keep stands over (no ground under a deck or a ramp), cut into
                rectangles along every such side, so a side lies on the ground's edges and the navmesh never links
                across one. WALK_deck_*: the keep's deck, 4 m up; WALK_ramp_*: its two ramps (sloped faces).
  - BLOCK_<id>: a solid block of wall or tower, a box from the ground to its `top`: a Wall stands on each of its
                four sides (the Simulation adds them), and the Soldiers and the destination fields keep out of it.
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights: the field's edge, and the keep's faces,
                its parapets (a Fighter's rail along the deck) and its ramps' sides.
  - OBJ_<id>:   an empty at an Objective, with its `weight`, `owner` (-1 none) and `spawn` (0 or 1) properties.
  - BASE_T<team>: an empty at each Team's Base.
  - DEPLOY:     an empty on Team 0's front rank (z = -front); Team 1 deploys as its half turn.
  The map's army size (standard and most) is written beside them (`ARMY_SIZE`, measured: see the plan's Stage 3a).

Everything is authored in game coordinates (x east, y up, z toward Team 1; facing 0 looks along +z) and placed in
Blender as (x, -z, y), which the glTF export (export_yup) turns back into game coordinates.

Layout: a ruined square fort in the middle of the field. Its curtain wall (4 m thick) has a
gatehouse in the middle of each side the armies face (D toward Team 0, E toward Team 1, a 10 m gate between two
towers), a breach in each east and west side (A's and C's way in) and a smaller breach on each gate side, to the
right of the army facing it. Two corners still stand as towers, the other two have fallen to stumps. Inside stands
the keep (Stage 4b): a 28 m square block 4 m high with B on its deck, reached by a ramp up its west face and one up its east
face (each 11 m wide and 9 m long, railed), with a 6 m tunnel under it from one gatehouse's side to the other's (D to E). The
deck and ramps stand over no ground and the tunnel is the ground, so a Soldier in the tunnel is on its floor, not on the deck
over it (ADR 0022: never a block under a deck, since blocks push Soldiers off). Outside, A and C stand on the flanks by a
ruined outbuilding each. The whole map is its own half turn about the centre (the armies are a half turn of each other), so
neither Team has the shorter way to anything: Objective k mirrors Objective 4 - k, and block k mirrors block n - 1 - k, as
the Walk Surfaces and Walls do (the keep, its ramps and its tunnel included).
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
NAME = 'Fort'
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'battle_fort.glb')
OUT_JSON = os.path.join(REPO, 'data', 'battlemaps', 'fort.json')

HALF = 100.0  # the field's half side (battle.field.size / 2)
FRONT = 52.0  # Team 0's front rank stands at z = -FRONT: clear of the gatehouses (their towers reach z = -37)
BASE = 88.0  # each Team's Base, behind its deployment
ARMY_SIZE = {'standard': 144, 'max': 144}  # measured on the budget gate (Stage 4b: the keep makes the Fort a map of several levels, which costs more a Soldier)
TICKETS = 2.4  # Tickets a Team starts with for each Soldier (the open field's is 3.5): the keep and tunnel slow the killing, so Battles on the Fort last about 7 minutes on fewer than the open field (Stage 4b)

KEEP = 14.0  # the keep's half side: a 28 m square in the courtyard, B on its deck
DECK = 4.0  # the keep's deck, above a Soldier's drop (battle.levels.drop, 3 m), so nobody drops off it
RAIL = 1.0  # its parapet's height above the deck
TUNNEL = 3.0  # the tunnel under the keep, joining the gatehouses (D and E): 6 m wide, DECK high, along z
RAMP = 5.5  # each ramp is 2 x RAMP wide (11 m: a column fits it) and RAMP_LEN long (9 m), up the keep's west and east faces; its rails stand off the destination grid's 2 m cell edges
RAMP_LEN = 9.0

CURTAIN = 5.0  # the curtain wall's top
TOWER = 9.0  # a gatehouse tower's or a standing corner tower's top
STUMP = 3.0  # a fallen corner tower's stump
RUIN = 2.5  # the outbuildings

# Team 0's half of the solid blocks, (id, x0, x1, z0, z1, top); Team 1's half is its half turn (`turned`).
SOUTH = [
    ('curtain_s_w', -30, -13, -34, -30, CURTAIN),
    ('gate_s_w', -13, -5, -37, -27, TOWER),
    ('gate_s_e', 5, 13, -37, -27, TOWER),
    ('curtain_s_m', 13, 17, -34, -30, CURTAIN),  # the breach x 17 to 25: to Team 0's right as it faces the fort
    ('curtain_s_e', 25, 30, -34, -30, CURTAIN),
    ('corner_sw', -38, -30, -38, -30, TOWER),
    ('corner_se', 30, 38, -38, -30, STUMP),
    ('curtain_e_s', 30, 34, -30, -6, CURTAIN),  # the east breach z -6 to 6 (and, turned, the west one)
    ('curtain_e_n', 30, 34, 6, 30, CURTAIN),
    ('shed_a', -58, -54, -15, -7, RUIN),  # A's outbuilding (C's, turned)
    ('shed_a2', -66, -62, 7, 15, RUIN),
]


def turned(b):
    """Block b turned half round the centre, its compass letters turned with it (s and n, e and w; A's shed is C's)."""
    id, x0, x1, z0, z1, top = b
    flip = str.maketrans('nsew', 'snwe')
    parts = [p.translate(flip) if set(p) <= set('nsew') else p for p in id.split('_')]
    return ('_'.join(parts).replace('shed_a', 'shed_c'), -x1, -x0, -z1, -z0, top)


# Block k and block len - 1 - k are each other's half turn (as Objectives k and 4 - k are), so Team 1 can break a tie the mirrored way.
BLOCKS = SOUTH + [turned(b) for b in reversed(SOUTH)]

# Objectives in the order a Battle numbers them: D (Team 0's gatehouse), A, B (the courtyard), C, E (Team 1's).
OBJECTIVES = [
    ('D', 0.0, -32.0, 1.0, -1, True),
    ('A', -60.0, 0.0, 1.0, -1, False),
    ('B', 0.0, 0.0, 1.4, -1, False),
    ('C', 60.0, 0.0, 1.0, -1, False),
    ('E', 0.0, 32.0, 1.0, -1, True),
]

rng = random.Random(7)

# name: (sRGB colour, roughness)
MATERIALS = {
    'Stone': (0x8d877c, 1.0),
    'StoneDark': (0x6a645b, 1.0),
    'StoneLight': (0xa9a294, 1.0),
    'Rubble': (0x7a7368, 1.0),
    'Dirt': (0x7d6a4f, 1.0),
    'Wood': (0x5a4330, 1.0),
    'Banner0': (0xc0392b, 1.0),
    'Banner1': (0x2e86c1, 1.0),
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- the floor (game coordinates)


# What the keep stands over, where there is no ground (x0, x1, z0, z1): its two halves beside the tunnel, and the ramps. Its deck and
# ramps are Walk Surfaces over this; the tunnel (x -TUNNEL to TUNNEL, under the deck) is ground.
CARVED = [
    (-KEEP, -TUNNEL, -KEEP, KEEP),
    (TUNNEL, KEEP, -KEEP, KEEP),
    (-KEEP - RAMP_LEN, -KEEP, -RAMP, RAMP),
    (KEEP, KEEP + RAMP_LEN, -RAMP, RAMP),
]
SOLIDS = [b[1:5] for b in BLOCKS] + CARVED


def floor_rects():
    """The ground: the field's square less the blocks and less what the keep stands over, as rectangles (x0, x1, z0, z1):
    cut along every such side, the free cells merged along x, then runs of the same span merged along z. Each side lies on
    rectangles' edges."""
    xs = sorted({-HALF, HALF, *(v for b in SOLIDS for v in (b[0], b[1]))})
    zs = sorted({-HALF, HALF, *(v for b in SOLIDS for v in (b[2], b[3]))})

    def solid(x, z):
        return any(b[0] < x < b[1] and b[2] < z < b[3] for b in SOLIDS)

    rows = []
    for j in range(len(zs) - 1):
        zc = (zs[j] + zs[j + 1]) / 2
        runs, start = [], None
        for i in range(len(xs) - 1):
            free = not solid((xs[i] + xs[i + 1]) / 2, zc)
            if free and start is None:
                start = xs[i]
            if not free and start is not None:
                runs.append((start, xs[i]))
                start = None
        if start is not None:
            runs.append((start, xs[-1]))
        rows.append(runs)
    rects, open_ = [], {}
    for j, runs in enumerate(rows):
        nxt = {}
        for r in runs:
            nxt[r] = open_.pop(r, zs[j])
        for (x0, x1), z0 in open_.items():
            rects.append((x0, x1, z0, zs[j]))
        open_ = nxt
    for (x0, x1), z0 in open_.items():
        rects.append((x0, x1, z0, zs[-1]))
    return sorted(rects, key=lambda r: (r[2], r[0]))


WALK = [(f'{k:03d}', r) for k, r in enumerate(floor_rects())]

# The keep's deck: 9 rectangles cut along the tunnel's sides (x) and the ramps' (z), so Walk Surfaces' edges lie under the Walls, at DECK.
DECK_X = (-KEEP, -TUNNEL, TUNNEL, KEEP)
DECK_Z = (-KEEP, -RAMP, RAMP, KEEP)
DECK_WALK = [(f'deck_{i}{j}', (DECK_X[i], DECK_X[i + 1], DECK_Z[j], DECK_Z[j + 1])) for j in range(3) for i in range(3)]
# Sloped faces, (id, four corners (x, y, z)): the west ramp rises toward +x, the east one toward -x.
RAMP_WALK = [
    ('ramp_w', [(-KEEP - RAMP_LEN, 0.0, -RAMP), (-KEEP, DECK, -RAMP), (-KEEP, DECK, RAMP), (-KEEP - RAMP_LEN, 0.0, RAMP)]),
    ('ramp_e', [(KEEP + RAMP_LEN, 0.0, RAMP), (KEEP, DECK, RAMP), (KEEP, DECK, -RAMP), (KEEP + RAMP_LEN, 0.0, -RAMP)]),
]


def _walls():
    """Walls, (id, a, b, bottom, top) with a and b as (x, z): the field's edge; the keep's faces (solid from the ground to the deck, the
    tunnel's mouths and the ramps' mouths open); a parapet along the deck's edge (a Fighter's rail, open at the ramps); the tunnel's sides;
    and the ramps' sides (solid below, a rail above). A Soldier on the deck is stopped by the parapet, and a face topped at the deck stops
    one on the ground but not one above it: no ground lies within a step of the deck's edge, which is what keeps a Soldier on it."""
    k, t, r, d = KEEP, TUNNEL, RAMP, DECK
    edge = [('edge_s', (-HALF, -HALF), (HALF, -HALF)), ('edge_e', (HALF, -HALF), (HALF, HALF)),
            ('edge_n', (HALF, HALF), (-HALF, HALF)), ('edge_w', (-HALF, HALF), (-HALF, -HALF))]
    face = [('face_s_w', (-k, -k), (-t, -k)), ('face_s_e', (t, -k), (k, -k)), ('face_n_w', (-k, k), (-t, k)), ('face_n_e', (t, k), (k, k)),
            ('face_w_s', (-k, -k), (-k, -r)), ('face_w_n', (-k, r), (-k, k)), ('face_e_s', (k, -k), (k, -r)), ('face_e_n', (k, r), (k, k)),
            ('tunnel_w', (-t, -k), (-t, k)), ('tunnel_e', (t, -k), (t, k))]
    parapet = [('parapet_s', (-k, -k), (k, -k)), ('parapet_n', (-k, k), (k, k)),
               ('parapet_w_s', (-k, -k), (-k, -r)), ('parapet_w_n', (-k, r), (-k, k)), ('parapet_e_s', (k, -k), (k, -r)), ('parapet_e_n', (k, r), (k, k))]
    ramp = [('ramp_w_s', (-k - RAMP_LEN, -r), (-k, -r)), ('ramp_w_n', (-k - RAMP_LEN, r), (-k, r)),
            ('ramp_e_s', (k, -r), (k + RAMP_LEN, -r)), ('ramp_e_n', (k, r), (k + RAMP_LEN, r))]
    return ([(i, a, b, -1.0, 4.0) for i, a, b in edge] + [(i, a, b, -1.0, d) for i, a, b in face]
            + [(i, a, b, d, d + RAIL) for i, a, b in parapet] + [(i, a, b, -1.0, d + RAIL) for i, a, b in ramp])


WALLS = _walls()

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
        """An axis-aligned box, its faces wound outward; `top` gives its lid another material."""
        c = lambda i, j, k: (x1 if i else x0, y1 if j else y0, z1 if k else z0)
        sides = [
            ([c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], mat),  # -x
            ([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], mat),  # +x
            ([c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], mat),  # -z
            ([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], mat),  # +z
            ([c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)], top or mat),  # top
        ]
        if not skip_bottom:
            sides.append(([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], mat))
        for pts, m in sides:
            self.face(pts, m)


G = Geo()


def merlons(x0, x1, z0, z1, y, mat, gap=0.0):
    """Battlements round the top of a block: merlons along each long side (skipped where `gap` says), a course of
    stone in from the edge."""
    w, h, t = 1.0, 0.9, 0.6
    for side in ('x', 'z'):
        a0, a1 = (x0, x1) if side == 'x' else (z0, z1)
        n = max(1, int((a1 - a0) / (2 * w)))
        step = (a1 - a0) / n
        for k in range(n):
            a = a0 + step * (k + 0.25)
            b = a + step * 0.5
            for edge in (0, 1):
                if side == 'x':
                    zz = (z0, z0 + t) if edge == 0 else (z1 - t, z1)
                    G.box(a, b, y, y + h * rng.uniform(0.6, 1.0), zz[0], zz[1], mat)
                else:
                    xx = (x0, x0 + t) if edge == 0 else (x1 - t, x1)
                    G.box(xx[0], xx[1], y, y + h * rng.uniform(0.6, 1.0), a, b, mat)


def block_look(b):
    id, x0, x1, z0, z1, top = b
    if id.startswith('curtain'):
        # Courses of stone: a darker plinth, the wall, a lighter walk along the top, its battlements broken here and there.
        G.box(x0 - 0.15, x1 + 0.15, 0, 0.8, z0 - 0.15, z1 + 0.15, 'StoneDark')
        G.box(x0, x1, 0.8, top, z0, z1, 'Stone', top='StoneLight')
        if rng.random() < 0.8:
            merlons(x0, x1, z0, z1, top, 'Stone')
    elif id.startswith(('gate', 'corner')) and top >= TOWER:
        G.box(x0 - 0.2, x1 + 0.2, 0, 1.2, z0 - 0.2, z1 + 0.2, 'StoneDark')
        G.box(x0, x1, 1.2, top, z0, z1, 'Stone', top='StoneLight')
        # A corbelled parapet a little proud of the tower.
        G.box(x0 - 0.35, x1 + 0.35, top, top + 0.5, z0 - 0.35, z1 + 0.35, 'StoneDark')
        merlons(x0 - 0.35, x1 + 0.35, z0 - 0.35, z1 + 0.35, top + 0.5, 'Stone')
        # Arrow slits on the faces.
        for y in (3.0, 6.0):
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            G.box(cx - 0.12, cx + 0.12, y, y + 1.0, z0 - 0.02, z0, 'StoneDark')
            G.box(cx - 0.12, cx + 0.12, y, y + 1.0, z1, z1 + 0.02, 'StoneDark')
    else:
        # Stumps and ruins: a ragged top of a few stepped stones.
        G.box(x0, x1, 0, top * 0.7, z0, z1, 'StoneDark', top='Stone')
        for _ in range(4):
            a = rng.uniform(x0, x1 - 1.2)
            c = rng.uniform(z0, z1 - 1.2)
            G.box(a, min(x1, a + rng.uniform(1.0, 2.5)), top * 0.7, top * rng.uniform(0.8, 1.0), c, min(z1, c + rng.uniform(1.0, 2.5)), 'Stone')


def rubble(x0, x1, z0, z1, n):
    """Low fallen stones (render only: the Simulation walks through them) heaped round a breach, never above knee height."""
    for _ in range(n):
        x = rng.uniform(x0, x1)
        z = rng.uniform(z0, z1)
        s = rng.uniform(0.3, 0.9)
        G.box(x - s, x + s, 0, rng.uniform(0.15, 0.45), z - s * 0.8, z + s * 0.8, rng.choice(('Rubble', 'StoneDark', 'Stone')))


def gate(z_face, inward):
    """A gatehouse's arch over the 10 m gate (above head height, so nothing the Simulation sees) and its broken doors."""
    za, zb = sorted((z_face, z_face + 10 * inward))
    G.box(-5, 5, 6.0, TOWER - 0.5, za, zb, 'Stone', top='StoneLight')
    merlons(-5, 5, za, zb, TOWER - 0.5, 'Stone')
    # One door leaf hangs open against the tower, the other lies in the gateway.
    G.box(-4.9, -4.6, 0, 5.2, z_face + inward * 1.0, z_face + inward * 4.5, 'Wood')
    G.box(0.5, 4.2, 0, 0.25, z_face + inward * 3.0, z_face + inward * 6.5, 'Wood')


def banner(x, z, mat, facing):
    """A team's banner on a pole at its Base."""
    G.box(x - 0.1, x + 0.1, 0, 6, z - 0.1, z + 0.1, 'Wood')
    G.box(x + 0.1, x + 1.7, 3.6, 5.8, z - 0.03 * facing, z + 0.03 * facing, mat)


def prism_x(profile, z0, z1, mat):
    """A prism: `profile`, counter-clockwise seen from +z as points (x, y), stood from z0 to z1."""
    G.face([(x, y, z1) for x, y in profile], mat)
    G.face([(x, y, z0) for x, y in reversed(profile)], mat)
    for k, (x, y) in enumerate(profile):
        x2, y2 = profile[(k + 1) % len(profile)]
        G.face([(x, y, z0), (x2, y2, z0), (x2, y2, z1), (x, y, z1)], mat)


def keep_look():
    """The keep (Stage 4b): two halves of stone either side of the tunnel with a lighter deck, a roof over the tunnel, a low parapet round
    the deck (open at the ramps) with posts, and the ramps with a rail along each side. Nothing the Simulation reads: its Walls and Walk
    Surfaces are the helpers (`collision`), and the look stays outside them so a Fighter never clips a parapet."""
    k, t, r, d = KEEP, TUNNEL, RAMP, DECK
    for x0, x1 in ((-k, -t), (t, k)):
        # A darker plinth round the outer faces, then the wall under a lighter deck.
        out0, out1 = (x0 - 0.15, x1) if x0 < 0 else (x0, x1 + 0.15)
        G.box(out0, out1, 0, 0.8, -k - 0.15, k + 0.15, 'StoneDark')
        G.box(x0, x1, 0.8, d, -k, k, 'Stone', top='StoneLight')
    # The roof of the tunnel, seen from below too.
    G.box(-t, t, d - 1.0, d, -k, k, 'Stone', top='StoneLight', skip_bottom=False)
    # The parapet, 0.4 m thick on the deck's edge (inside the Walls), open at the ramps; posts at the corners and the ramps' mouths.
    w, h = 0.4, RAIL
    G.box(-k, k, d, d + h, -k, -k + w, 'Stone', top='StoneLight')
    G.box(-k, k, d, d + h, k - w, k, 'Stone', top='StoneLight')
    for sx in (-1, 1):
        for a, b in ((-k + w, -r), (r, k - w)):
            G.box(*sorted((sx * k, sx * (k - w))), d, d + h, a, b, 'Stone', top='StoneLight')
    for sx in (-1, 1):
        for sz in (-1, 1):
            G.box(*sorted((sx * k, sx * (k - 0.8))), d, d + 2.2, *sorted((sz * k, sz * (k - 0.8))), 'StoneDark', top='Stone')
        for sz in (-1, 1):
            G.box(*sorted((sx * k, sx * (k - 0.6))), d, d + 1.6, *sorted((sz * r, sz * (r + 0.6))), 'StoneDark', top='Stone')
    # The ramps: a sloped way (one face, seen from above) and a rail each side, a parallelogram stood along it, 0.6 m thick, outside the way.
    for sx in (-1, 1):
        a, b = sx * k, sx * (k + RAMP_LEN)
        G.face([(a, d, -r), (a, d, r), (b, 0.0, r), (b, 0.0, -r)] if sx > 0 else [(a, d, r), (a, d, -r), (b, 0.0, -r), (b, 0.0, r)], 'StoneLight')
        profile = [(a, 0.0), (b, 0.0), (b, RAIL), (a, d + RAIL)]
        if sx < 0:
            profile.reverse()
        for z0, z1 in ((r, r + 0.6), (-r - 0.6, -r)):
            prism_x(profile, z0, z1, 'Stone')
    # Worn steps of dirt at the ramps' feet.
    for sx in (-1, 1):
        G.face([(sx * (k + RAMP_LEN), 0.02, -r - 1.5), (sx * (k + RAMP_LEN), 0.02, r + 1.5), (sx * (k + RAMP_LEN + 3), 0.02, r + 1.5), (sx * (k + RAMP_LEN + 3), 0.02, -r - 1.5)] if sx > 0 else
               [(sx * (k + RAMP_LEN), 0.02, r + 1.5), (sx * (k + RAMP_LEN), 0.02, -r - 1.5), (sx * (k + RAMP_LEN + 3), 0.02, -r - 1.5), (sx * (k + RAMP_LEN + 3), 0.02, r + 1.5)], 'Dirt')


def build_look():
    # The courtyard's trodden earth, a centimetre over the grass the game draws (src/render/stage.ts).
    G.face([(-30, 0.01, -30), (-30, 0.01, 30), (30, 0.01, 30), (30, 0.01, -30)], 'Dirt')
    for b in BLOCKS:
        block_look(b)
    # The gates' arches and doors, and the breaches' rubble.
    gate(-37, 1)
    gate(37, -1)
    for sx in (1, -1):
        rubble(sx * 17, sx * 25, sx * -35, sx * -29, 26)
        rubble(sx * 29, sx * 35, -6, 6, 30)
    for b in BLOCKS:
        if b[0].startswith('corner') and b[5] == STUMP:
            rubble(b[1] - 3, b[2] + 3, b[3] - 3, b[4] + 3, 18)
    keep_look()
    banner(0, -BASE, 'Banner0', 1)
    banner(0, BASE, 'Banner1', -1)


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
    for name, (colour, rough) in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = rough
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


def collision(coll):
    for id, (x0, x1, z0, z1) in WALK:
        pts = [(x0, 0.0, z0), (x1, 0.0, z0), (x1, 0.0, z1), (x0, 0.0, z1)]
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [[0, 1, 2, 3]])
        coll.objects.link(bpy.data.objects.new(f'WALK_{id}', me))
    for id, (x0, x1, z0, z1) in DECK_WALK:
        pts = [(x0, DECK, z0), (x1, DECK, z0), (x1, DECK, z1), (x0, DECK, z1)]
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [[0, 1, 2, 3]])
        coll.objects.link(bpy.data.objects.new(f'WALK_{id}', me))
    for id, pts in RAMP_WALK:
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [[0, 1, 2, 3]])
        coll.objects.link(bpy.data.objects.new(f'WALK_{id}', me))
    for k, (id, x0, x1, z0, z1, top) in enumerate(BLOCKS):
        # The block's footprint, lifted to its top.
        pts = [(x0, top, z0), (x1, top, z0), (x1, top, z1), (x0, top, z1)]
        me = bpy.data.meshes.new(f'BLOCK_{k:02d}_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [[0, 1, 2, 3]])
        coll.objects.link(bpy.data.objects.new(f'BLOCK_{k:02d}_{id}', me))
    for id, a, b, bottom, top in WALLS:
        q = [(a[0], bottom, a[1]), (b[0], bottom, b[1]), (b[0], top, b[1]), (a[0], top, a[1])]
        me = bpy.data.meshes.new(f'WALL_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in q], [], [[0, 1, 2, 3]])
        coll.objects.link(bpy.data.objects.new(f'WALL_{id}', me))
    for k, (id, x, z, weight, owner, spawn) in enumerate(OBJECTIVES):
        empty(coll, f'OBJ_{k}_{id}', x, z, weight=weight, owner=owner, spawn=int(spawn))
    empty(coll, 'BASE_T0', 0.0, -BASE)
    empty(coll, 'BASE_T1', 0.0, BASE)
    empty(coll, 'DEPLOY', 0.0, -FRONT)


def to_game(v):
    r = lambda x: round(x, 4) + 0.0
    return [r(v.x), r(v.z), r(-v.y)]


def export_json(coll):
    """The Battle map, read back from the Collision helpers."""
    objs = sorted(coll.objects, key=lambda o: o.name)
    walk, blocks, walls, objectives, bases = [], [], [], [], [None, None]
    front = None
    for o in objs:
        world = lambda i: to_game(o.matrix_world @ o.data.vertices[i].co)
        if o.name.startswith('WALK_'):
            walk.append({'id': o.name, 'points': [world(i) for i in o.data.polygons[0].vertices]})
        elif o.name.startswith('BLOCK_'):
            vs = [world(i) for i in range(len(o.data.vertices))]
            xs, zs = [v[0] for v in vs], [v[2] for v in vs]
            blocks.append({'id': o.name, 'min': [min(xs), min(zs)], 'max': [max(xs), max(zs)], 'top': vs[0][1]})
        elif o.name.startswith('WALL_'):
            vs = [world(i) for i in range(len(o.data.vertices))]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('OBJ_'):
            p = to_game(o.matrix_world.translation)
            objectives.append((int(o.name.split('_')[1]), {'id': o.name.split('_', 2)[2], 'x': p[0], 'z': p[2], 'weight': float(o['weight']), 'owner': int(o['owner']), 'spawn': bool(o['spawn'])}))
        elif o.name.startswith('BASE_T'):
            p = to_game(o.matrix_world.translation)
            bases[int(o.name[-1])] = [p[0], p[2]]
        elif o.name == 'DEPLOY':
            front = -to_game(o.matrix_world.translation)[2]
    return {
        'name': 'fort',
        'front': front,
        'armySize': ARMY_SIZE,
        'ticketsPerSoldier': TICKETS,
        'bases': bases,
        'objectives': [o for _, o in sorted(objectives, key=lambda e: e[0])],
        'blocks': blocks,
        'walls': walls,
        'walk': walk,
    }


def write_json(path, data):
    """Compact enough to read: one surface, block, wall or Objective per line."""
    def items(key):
        rows = data[key]
        return [f'    {json.dumps(r)}' + (',' if k < len(rows) - 1 else '') for k, r in enumerate(rows)]
    lines = ['{', '  "name": "fort",', f'  "front": {json.dumps(data["front"])},', f'  "armySize": {json.dumps(data["armySize"])},', f'  "ticketsPerSoldier": {json.dumps(data["ticketsPerSoldier"])},',
             f'  "bases": {json.dumps(data["bases"])},', '  "objectives": [', *items('objectives'), '  ],', '  "blocks": [', *items('blocks'),
             '  ],', '  "walls": [', *items('walls'), '  ],', '  "walk": [', *items('walk'), '  ]', '}', '']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        f.write('\n'.join(lines))


def build():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    build_look()
    mats = materials()
    look = collection(NAME)
    helpers = collection('Collision')
    for c in bpy.context.scene.collection.children:
        c.hide_render = c.hide_viewport = c.name not in (NAME, 'Collision')
    fort = mesh_object(NAME, G, look, mats)
    collision(helpers)
    helpers.hide_render = True
    triangles = sum(len(p.vertices) - 2 for p in fort.data.polygons)
    report = {'triangles': triangles, 'faces_dropped': len(G.faces) - len(fort.data.polygons), 'walk': len(WALK) + len(DECK_WALK) + len(RAMP_WALK), 'blocks': len(BLOCKS), 'walls': len(WALLS), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        fort.select_set(True)
        bpy.context.view_layer.objects.active = fort
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('FORT_RESULT', json.dumps(result))
