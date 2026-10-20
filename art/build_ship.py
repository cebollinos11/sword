"""
Builds the pirate ship Arena in Blender: the look (a mesh with flat-colour
materials) and the geometry the simulation stands Fighters on (helper objects
in a `Collision` collection). This script is the source of truth for both
(ADR 0006): re-run it to change the Arena.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_ship.py").read(), {"__file__": r"C:/Repos/sword/art/build_ship.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_ship.py').read(), {'__file__': r'C:/Repos/sword/art/build_ship.py', 'SAVE': True})"

With SAVE = True it writes art/ship.blend, public/models/arenas/ship.glb
(the look) and data/arenas/ship.json (the sim geometry, read back from the
Collision helpers):
  - WALK_<id>:  one planar convex face, a floor (a Walk Surface); `water` = 1 on the sea.
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights.
  - SPAWN_T<team>_<slot>: an empty where that Fighter starts, its yaw in the `facing` property.

Everything is authored in game coordinates (x east, y up, z; facing 0 looks
along +z) and placed in Blender as (x, -z, y), which the glTF export
(export_yup) turns back into game coordinates.

Layout: a ship under sail, bow toward +z. The fight is on the main deck (y 0),
between the mainmast and a raised quarterdeck (y QD) at the stern where the
wheel stands, reached by a stair on each side. The bulwarks stand RAIL above
the deck: too high to walk over, low enough to jump over. A plank juts out over
the sea from the port side. Off the plank or over the rail is the sea, and the
sea drowns. Under 10 000 triangles.
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
NAME = 'Ship'
OUT_BLEND = os.path.join(REPO, 'art', 'ship.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'ship.glb')
OUT_JSON = os.path.join(REPO, 'data', 'arenas', 'ship.json')

QD = 1.5  # the quarterdeck's height (a drop no worse than the fall's safe height)
QD_FRONT = -5.0  # where the quarterdeck starts (z); it runs aft to the stern
STAIR_FOOT = -2.0  # where the stairs meet the main deck (z)
STAIR_IN = 1.8  # the stairs run between |x| STAIR_IN and the bulwark
RAIL = 0.75  # bulwark height over the deck: a Jump (peak ~0.82) clears it, a walk does not
WATER = -2.5  # the sea's drawn surface
SINK = 0.12  # the sea's Walk Surface lies this far under it, so the drowned float half under
STERN = -11.5  # the inner face of the stern bulwark
SEA_R = 110.0  # the drawn sea's radius (lost in the haze long before)
SEA_SIM = 25.0  # the sea's Walk Surface's half size
PLANK_Z = (0.1, 0.9)  # the plank's sides (z), on the port side
PLANK_END = -6.2  # how far out it reaches (x)
PLANK_GAP = (0.0, 1.0)  # the gap in the port bulwark it goes through (z)

# The bulwark's inner face (the deck's edge) on the starboard side, stern to bow tip: (z, half width).
INNER = [(STERN, 2.6), (-9.5, 3.0), (4.0, 3.0), (6.5, 2.6), (8.5, 1.8), (10.0, 0.8), (10.8, 0.0)]
THICK = 0.25  # bulwark thickness

MAINMAST = (0.0, 5.0)
FOREMAST = (0.0, 8.3)
MIZZEN = (0.0, -10.0)
WHEEL_Z = -7.5
CANNONS = [(1, -0.6), (1, 1.6), (-1, -0.6), (-1, 1.6)]  # (side, z): +1 starboard, -1 port
BARRELS = [(1.95, 6.0), (1.55, 6.6), (2.25, 6.55)]
CRATES = [(-1.95, 6.1, 0.5), (-1.55, 6.75, 0.35)]  # (x, z, half size)
CHEST = (1.7, -10.4)

rng = random.Random(7)

# name: (sRGB colour, metallic, roughness, emission strength)
MATERIALS = {
    'Deck': (0xb08a5a, 0.0, 0.8, 0),
    'Deck2': (0x9f7b4e, 0.0, 0.8, 0),
    'Wood': (0x7a4f2c, 0.0, 0.8, 0),
    'WoodDark': (0x4a2e18, 0.0, 0.8, 0),
    'Hull': (0x5c3a20, 0.0, 0.8, 0),
    'HullDark': (0x3a2414, 0.0, 0.8, 0),
    'Wale': (0x1a1512, 0.0, 0.8, 0),
    'Stripe': (0xc0922e, 0.0, 0.7, 0),
    'Iron': (0x2a2a2d, 0.7, 0.5, 0),
    'Rope': (0x8a7350, 0.0, 0.9, 0),
    'Sail': (0xeae0c6, 0.0, 0.9, 0),
    'SailBack': (0xcfc4a6, 0.0, 0.9, 0),
    'Black': (0x121212, 0.0, 0.9, 0),
    'Bone': (0xeeeae0, 0.0, 0.9, 0),
    'Port': (0x0c0806, 0.0, 1.0, 0),
    'Window': (0xffc46a, 0.0, 0.5, 1.5),
    'Lamp': (0xffd27a, 0.0, 0.5, 2.5),
    'Gold': (0xe8b830, 0.6, 0.4, 0.4),
    'Sea': (0x1d5d86, 0.0, 0.4, 0),
    'SeaLight': (0x2f7aa2, 0.0, 0.4, 0),
    'Foam': (0xdcecf3, 0.0, 0.6, 0),
    'Sand': (0xd8c48c, 0.0, 1.0, 0),
    'Green': (0x3d7436, 0.0, 1.0, 0),
    'Rock': (0x6d6a60, 0.0, 1.0, 0),
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
        """A thin sheet (a sail, a flag): seen from either side, a colour each."""
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

    def strut(self, a, b, width, mat):
        """A square beam (or a rope) from point a to point b (3D), `width` across."""
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


def pipe(geo, a, b, r0, mat, sides=8, r1=None, caps=False):
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
        geo.face([ra[k], ra[k1], rb[k1], rb[k]], mat, tuple(mid - (a + b) / 2 - d * (mid - (a + b) / 2).dot(d)))
    if caps:
        geo.face(ra, mat, tuple(-d))
        geo.face(rb, mat, tuple(d))


def clip(poly, axis, lo, hi):
    """A convex polygon (from above: (x, z) pairs) cut to lo <= coordinate `axis` <= hi (Sutherland-Hodgman)."""
    def cut(pts, keep, at):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            if keep(p):
                out.append(p)
            if keep(p) != keep(q):
                t = (at - p[axis]) / (q[axis] - p[axis])
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
        return out
    pts = cut(poly, lambda p: p[axis] >= lo, lo)
    return cut(pts, lambda p: p[axis] <= hi, hi) if pts else []


def interp(table, z):
    if z <= table[0][0]:
        return table[0][1]
    for (z0, w0), (z1, w1) in zip(table, table[1:]):
        if z <= z1:
            return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    return table[-1][1]


def half_width(z):
    """The deck's half width (to the bulwark's inner face) at z."""
    return interp(INNER, z)


def rail_top(z):
    """The bulwark's top at z: RAIL over the main deck, rising beside the stairs to RAIL over the quarterdeck."""
    if z >= STAIR_FOOT:
        return RAIL
    if z <= QD_FRONT:
        return QD + RAIL
    return RAIL + QD * (STAIR_FOOT - z) / (STAIR_FOOT - QD_FRONT)


def outline(z0, z1):
    """The deck outline from z0 to z1, from above, as a convex polygon of (x, z), anticlockwise from the starboard stern corner."""
    zs = [z0] + [z for z, _ in INNER if z0 < z < z1] + [z1]
    right = [(half_width(z), z) for z in zs]
    left = [(-x, z) for x, z in reversed(right)]
    pts = right + left
    # Drop repeated points (the bow tip).
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) + abs(out[-1][1] - p[1]) > 1e-6:
            out.append(p)
    if abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


G = Geo()  # the ship and the sea
RIGGING = Geo()  # masts, yards, sails, ropes: hidden in deck renders

# ---------------------------------------------------------------- the sim geometry

WALK = []  # (id, [(x, y, z)], water)
WALLS = []  # (id, (ax, az), (bx, bz), bottom, top)
SPAWNS = []  # (team, slot, (x, y, z), facing)

r4 = lambda v: round(v, 4) + 0.0
WALK.append(('deck', [(r4(x), 0.0, r4(z)) for x, z in outline(STAIR_FOOT, INNER[-1][0])], False))
WALK.append(('waist', [(-STAIR_IN, 0.0, STAIR_FOOT), (-STAIR_IN, 0.0, QD_FRONT), (STAIR_IN, 0.0, QD_FRONT), (STAIR_IN, 0.0, STAIR_FOOT)], False))
for side, name in ((1, 'starboard'), (-1, 'port')):
    xi, xo = side * STAIR_IN, side * half_width(QD_FRONT)
    pts = [(xi, 0.0, STAIR_FOOT), (xo, 0.0, STAIR_FOOT), (xo, QD, QD_FRONT), (xi, QD, QD_FRONT)]
    WALK.append((f'stair_{name}', pts if side < 0 else list(reversed(pts)), False))
WALK.append(('quarterdeck', [(r4(x), QD, r4(z)) for x, z in outline(STERN, QD_FRONT)], False))
WALK.append(('plank', [(-half_width(0.5), 0.04, PLANK_Z[0]), (PLANK_END, 0.04, PLANK_Z[0]), (PLANK_END, 0.04, PLANK_Z[1]), (-half_width(0.5), 0.04, PLANK_Z[1])], False))
s = SEA_SIM
WALK.append(('sea', [(-s, WATER - SINK, -s), (s, WATER - SINK, -s), (s, WATER - SINK, s), (-s, WATER - SINK, s)], True))


def wall(id, a, b, bottom, top):
    WALLS.append((id, (r4(a[0]), r4(a[1])), (r4(b[0]), r4(b[1])), bottom, top))


def square(id, x, z, hx, hz, bottom, top):
    """Four Walls round a box of half extents hx, hz at (x, z); returns its corners."""
    corners = [(x - hx, z - hz), (x + hx, z - hz), (x + hx, z + hz), (x - hx, z + hz)]
    for e in range(4):
        wall(f'{id}_{e}', corners[e], corners[(e + 1) % 4], bottom, top)
    return corners


def lid(id, corners, y):
    """A Walk Surface over a prop's Walls (the same corners), at their top: clear the Walls and you stand on it."""
    WALK.append((f'{id}_top', [(r4(x), y, r4(z)) for x, z in corners], False))


# The bulwarks. Over the main deck from -0.5 (so a body is never under one) to RAIL; beside the stairs, stepped up with them; round the quarterdeck from 1.0.
for side, name in ((1, 's'), (-1, 'p')):
    pt = lambda z: (side * half_width(z), z)
    wall(f'qd_{name}0', pt(STERN), pt(-9.5), 1.0, QD + RAIL)
    wall(f'qd_{name}1', pt(-9.5), pt(QD_FRONT), 1.0, QD + RAIL)
    for k, (z0, z1) in enumerate(((QD_FRONT, -4.0), (-4.0, -3.0), (-3.0, STAIR_FOOT))):
        wall(f'stair_{name}{k}', pt(z0), pt(z1), 1.0 if k < 2 else 0.0, rail_top(z0) + 0.001)
    runs = [(STAIR_FOOT, 4.0)]
    if side < 0:
        runs = [(STAIR_FOOT, PLANK_GAP[0]), (PLANK_GAP[1], 4.0)]
    for k, (z0, z1) in enumerate(runs):
        wall(f'waist_{name}{k}', pt(z0), pt(z1), -0.5, RAIL)
    bow = [z for z, _ in INNER if z >= 4.0]
    for k, (z0, z1) in enumerate(zip(bow, bow[1:])):
        wall(f'bow_{name}{k}', pt(z0), pt(z1), -0.5, RAIL)
wall('stern', (half_width(STERN), STERN), (-half_width(STERN), STERN), 1.0, QD + RAIL)
wall('qd_rail', (-STAIR_IN, QD_FRONT), (STAIR_IN, QD_FRONT), 1.0, QD + RAIL)

# What stands on deck. The masts are tall Walls, so the camera stops short of them; the rest it looks over.
square('mainmast', *MAINMAST, 0.32, 0.32, 0.0, 19.5)
square('foremast', *FOREMAST, 0.26, 0.26, 0.0, 16.5)
square('mizzen', *MIZZEN, 0.24, 0.24, QD, QD + 12.5)
square('wheel', 0.0, WHEEL_Z, 0.82, 0.16, QD, QD + 1.4)
square('chest', *CHEST, 0.45, 0.3, QD, QD + 0.7)
for k, (side, z) in enumerate(CANNONS):
    x = side * (half_width(z) - 0.6)
    square(f'cannon{k}', x, z, 0.6, 0.3, 0.0, 0.7)
for k, (x, z) in enumerate(BARRELS):
    square(f'barrel{k}', x, z, 0.3, 0.3, 0.0, 0.9)
# The crates have lids at their tops, so a Jump that clears one lands on it; where the pair overlaps, the higher wins.
for k, (x, z, h) in enumerate(CRATES):
    lid(f'crate{k}', square(f'crate{k}', x, z, h, h, 0.0, 2 * h), 2 * h)

# The two teams face each other along the waist, between the stairs and the mainmast.
for slot, x in enumerate((0.0, 1.4, -1.4)):
    SPAWNS.append((0, slot, (x, 0.0, 2.2), math.pi))
    SPAWNS.append((1, slot, (-x, 0.0, -2.2), 0.0))

# ---------------------------------------------------------------- the look


def deck_planks(z0, z1, y, width=0.34):
    """A deck from z0 to z1 at height y, in strips along the ship (alternating boards)."""
    poly = outline(z0, z1)
    xs = [p[0] for p in poly]
    n = int(math.ceil((max(xs) - min(xs)) / width))
    x = min(xs)
    for k in range(n):
        piece = clip(poly, 0, x, min(max(xs), x + width))
        x += width
        if len(piece) >= 3:
            G.face([(px, y, pz) for px, pz in piece], 'Deck' if k % 2 else 'Deck2', (0, 1, 0))


def hull():
    """The hull: lofted between stations along the ship, closed by a stem at the bow and a transom at the stern."""
    zs = [STERN, -10.5, -9.5, -8, -6.5, -5, -4, -3, -2, -0.5, 1, 2.5, 4, 5.25, 6.5, 7.5, 8.5, 9.25, 10, 10.5]
    stem_z = INNER[-1][0] + 0.35
    outer = lambda z: half_width(z) + THICK

    def taper(y):
        # Fuller at the wale, drawn in toward the waterline.
        return 1.0 if y >= -0.8 else 1.0 - 0.08 * (-0.8 - y) / 1.9

    def rows(z):
        top = rail_top(z)
        return [(WATER - 0.3, 'HullDark'), (-1.6, 'Wale'), (-1.2, 'Hull'), (-0.3, 'Stripe'), (0.15, 'HullDark'), (min(top, RAIL), 'Hull'), (top, None)]

    zs_out = [STERN - 0.2] + zs[1:]
    for side in (1, -1):
        for i in range(len(zs) - 1):
            za, zb = zs_out[i], zs_out[i + 1]
            ra, rb = rows(zs[i]), rows(zs[i + 1])
            for k in range(len(ra) - 1):
                (ya0, mat), (ya1, _) = ra[k], ra[k + 1]
                yb0, yb1 = rb[k][0], rb[k + 1][0]
                if ya1 - ya0 < 1e-6 and yb1 - yb0 < 1e-6:
                    continue
                p = [(side * outer(zs[i]) * taper(ya0), ya0, za), (side * outer(zs[i + 1]) * taper(yb0), yb0, zb),
                     (side * outer(zs[i + 1]) * taper(yb1), yb1, zb), (side * outer(zs[i]) * taper(ya1), ya1, za)]
                G.face(p, mat, (side, 0, 0))
        # The bow: each row closes onto the stem.
        z = zs[-1]
        r = rows(z)
        for k in range(len(r) - 1):
            (y0, mat), (y1, _) = r[k], r[k + 1]
            G.face([(side * outer(z) * taper(y0), y0, z), (0, y0, stem_z), (0, y1, stem_z), (side * outer(z) * taper(y1), y1, z)], mat, (side, 0, 1))
    # The bow's rail cap, closing the bulwark at the stem.
    zt = zs[-1]
    G.face([(outer(zt), RAIL, zt), (0, RAIL, stem_z), (-outer(zt), RAIL, zt), (-half_width(zt), RAIL, zt), (0, RAIL, INNER[-1][0]), (half_width(zt), RAIL, zt)], 'Wood', (0, 1, 0))
    # The transom: flat across the stern, with the great cabin's windows and the name board.
    zt = STERN - 0.2
    w = outer(STERN)
    top = QD + RAIL
    G.face([(w * taper(WATER - 0.3), WATER - 0.3, zt), (-w * taper(WATER - 0.3), WATER - 0.3, zt), (-w * taper(-0.8), -0.8, zt), (w * taper(-0.8), -0.8, zt)], 'HullDark', (0, 0, -1))
    G.face([(w, -0.8, zt), (-w, -0.8, zt), (-w, top, zt), (w, top, zt)], 'Hull', (0, 0, -1))
    for k in range(5):
        x = -1.9 + k * 0.95
        G.face([(x - 0.3, 0.3, zt - 0.01), (x + 0.3, 0.3, zt - 0.01), (x + 0.3, 1.0, zt - 0.01), (x - 0.3, 1.0, zt - 0.01)], 'Window', (0, 0, -1))
    G.obox((0, -0.25, zt - 0.03), (2.3, 0.18, 0.03), 0, 'Stripe')
    G.obox((0, top + 0.06, zt + 0.1), (w + 0.05, 0.06, 0.16), 0, 'Wood')
    # Stern lanterns.
    for x in (-2.0, 0.0, 2.0):
        pipe(G, (x, top, zt - 0.1), (x, top + 0.3, zt - 0.1), 0.04, 'Iron', sides=4)
        G.box((x - 0.14, top + 0.3, zt - 0.24), (x + 0.14, top + 0.75, zt + 0.04), 'Lamp')
        G.box((x - 0.17, top + 0.75, zt - 0.27), (x + 0.17, top + 0.82, zt + 0.07), 'Iron')

    # Bulwarks' inner faces and the rail cap on top (the bow's cap, above, covers the last stretch to the tip).
    inner_zs = zs + [INNER[-1][0]]
    for side in (1, -1):
        for i in range(len(inner_zs) - 1):
            za, zb = inner_zs[i], inner_zs[i + 1]
            base_a = QD if za < QD_FRONT - 1e-6 else 0.0
            base_b = QD if zb < QD_FRONT + 1e-6 and za < QD_FRONT - 1e-6 else 0.0
            if side < 0 and za < PLANK_GAP[1] and zb > PLANK_GAP[0]:
                # The gap for the plank.
                for z0, z1 in ((za, PLANK_GAP[0]), (PLANK_GAP[1], zb)):
                    G.face([(side * half_width(z0), 0, z0), (side * half_width(z1), 0, z1), (side * half_width(z1), RAIL, z1), (side * half_width(z0), RAIL, z0)], 'Wood', (-side, 0, 0))
                    cap(side, z0, z1)
                for z in PLANK_GAP:
                    G.face([(side * half_width(z), 0, z), (side * outer(z), 0, z), (side * outer(z), RAIL, z), (side * half_width(z), RAIL, z)], 'WoodDark', (0, 0, 1 if z == PLANK_GAP[0] else -1))
                # The hull's top between the cut ends, at deck level.
                G.face([(side * half_width(PLANK_GAP[0]), 0.001, PLANK_GAP[0]), (side * outer(PLANK_GAP[0]), 0.001, PLANK_GAP[0]), (side * outer(PLANK_GAP[1]), 0.001, PLANK_GAP[1]), (side * half_width(PLANK_GAP[1]), 0.001, PLANK_GAP[1])], 'WoodDark', (0, 1, 0))
                continue
            G.face([(side * half_width(za), base_a, za), (side * half_width(zb), base_b, zb), (side * half_width(zb), rail_top(zb), zb), (side * half_width(za), rail_top(za), za)], 'Wood', (-side, 0, 0))
            if zb <= zs[-1]:
                cap(side, za, zb)
    # The stern bulwark's inner face, and its cap.
    w = half_width(STERN)
    G.face([(w, QD, STERN), (-w, QD, STERN), (-w, QD + RAIL, STERN), (w, QD + RAIL, STERN)], 'Wood', (0, 0, 1))
    G.face([(w, QD + RAIL, STERN), (-w, QD + RAIL, STERN), (-outer(STERN), QD + RAIL, STERN - 0.2), (outer(STERN), QD + RAIL, STERN - 0.2)], 'WoodDark', (0, 1, 0))
    # Stanchions on the bulwarks' inner faces.
    for side in (1, -1):
        z = -9.0
        while z < 9.6:
            if not (side < 0 and PLANK_GAP[0] - 0.1 < z < PLANK_GAP[1] + 0.1):
                x = side * (half_width(z) - 0.04)
                base = QD if z < QD_FRONT else 0.0
                G.box((x - 0.04, base, z - 0.06), (x + 0.04, rail_top(z) - 0.02, z + 0.06), 'WoodDark', skip=('-y', '+y'))
            z += 1.5


def cap(side, z0, z1):
    """The rail cap over the bulwark from z0 to z1."""
    t0, t1 = rail_top(z0), rail_top(z1)
    hw0, hw1 = half_width(z0), half_width(z1)
    G.face([(side * (hw0 - 0.03), t0, z0), (side * (hw1 - 0.03), t1, z1), (side * (hw1 + THICK + 0.03), t1, z1), (side * (hw0 + THICK + 0.03), t0, z0)], 'WoodDark', (0, 1, 0))


def decks():
    deck_planks(QD_FRONT, INNER[-1][0], 0.0)
    deck_planks(STERN, QD_FRONT, QD)
    # The quarterdeck's front: a bulkhead with the cabin door and windows, a gilt fascia under the rail.
    z = QD_FRONT
    G.face([(-STAIR_IN, 0, z), (STAIR_IN, 0, z), (STAIR_IN, QD, z), (-STAIR_IN, QD, z)], 'Wood', (0, 0, 1))
    G.face([(-0.45, 0, z + 0.01), (0.45, 0, z + 0.01), (0.45, 1.25, z + 0.01), (-0.45, 1.25, z + 0.01)], 'WoodDark', (0, 0, 1))
    G.box((0.25, 0.6, z), (0.32, 0.67, z + 0.05), 'Gold')
    for x in (-1.15, 1.15):
        G.face([(x - 0.28, 0.55, z + 0.01), (x + 0.28, 0.55, z + 0.01), (x + 0.28, 1.05, z + 0.01), (x - 0.28, 1.05, z + 0.01)], 'Window', (0, 0, 1))
    G.box((-STAIR_IN, QD - 0.14, z), (STAIR_IN, QD, z + 0.05), 'Stripe', skip=('-z',))
    # The rail along its front: balusters under a top rail.
    G.box((-STAIR_IN, QD + RAIL - 0.08, z - 0.06), (STAIR_IN, QD + RAIL, z + 0.06), 'WoodDark')
    G.box((-STAIR_IN, QD, z - 0.05), (STAIR_IN, QD + 0.08, z + 0.05), 'WoodDark', skip=('-y',))
    for k in range(13):
        x = -STAIR_IN + 0.05 + k * (2 * STAIR_IN - 0.1) / 12
        G.box((x - 0.04, QD + 0.08, z - 0.04), (x + 0.04, QD + RAIL - 0.08, z + 0.04), 'Wood', skip=('-y', '+y'))
    # A hatch grating amidships, and ring bolts.
    G.box((-0.9, 0.0, -0.3), (0.9, 0.06, 1.3), 'WoodDark', skip=('-y',))
    for k in range(5):
        G.box((-0.82 + k * 0.36, 0.06, -0.22), (-0.68 + k * 0.36, 0.065, 1.22), 'Port', skip=('-y',))


def stairs():
    """Each stair: six steps up beside the bulwark from the main deck to the quarterdeck."""
    n = 6
    run = (STAIR_FOOT - QD_FRONT) / n
    for side in (1, -1):
        xi, xo = side * STAIR_IN, side * half_width(QD_FRONT)
        for k in range(n):
            top = (k + 0.5) * QD / n + QD / (2 * n)
            z0, z1 = STAIR_FOOT - (k + 1) * run, STAIR_FOOT - k * run
            G.box((min(xi, xo), 0.0, z0), (max(xi, xo), top, z1), 'Deck' if k % 2 else 'Deck2', skip=('-y',))
            G.box((min(xi, xo), top - 0.04, z1 - 0.06), (max(xi, xo), top + 0.01, z1 + 0.02), 'WoodDark', skip=('-y',))
        # A newel post at the foot and the head.
        for z, y in ((STAIR_FOOT - 0.1, 0.0), (QD_FRONT + 0.1, QD)):
            G.box((xi - 0.07, y, z - 0.07), (xi + 0.07, y + 1.0, z + 0.07), 'WoodDark', skip=('-y',))
            G.box((xi - 0.1, y + 1.0, z - 0.1), (xi + 0.1, y + 1.1, z + 0.1), 'Stripe', skip=('-y',))


def plank():
    x0 = -half_width(0.5) - 0.3
    G.box((PLANK_END, -0.02, PLANK_Z[0]), (x0, 0.04, PLANK_Z[1]), 'Deck')
    for k in range(1, 4):
        z = PLANK_Z[0] + k * (PLANK_Z[1] - PLANK_Z[0]) / 4
        G.box((PLANK_END + 0.02, 0.04, z - 0.005), (x0, 0.042, z + 0.005), 'WoodDark', skip=('-y',))
    # Lashed to two cleats on deck.
    for z in (PLANK_Z[0] - 0.08, PLANK_Z[1] + 0.08):
        G.box((-half_width(0.5) + 0.2, 0.0, z - 0.06), (-half_width(0.5) + 0.5, 0.14, z + 0.06), 'Iron', skip=('-y',))


def cannon(side, z):
    x_in = side * (half_width(z) - 1.2)
    x_out = side * (half_width(z) + THICK)
    lo, hi = min(x_in, x_out - side * THICK), max(x_in, x_out - side * THICK)
    G.box((lo + 0.05, 0.12, z - 0.27), (hi - 0.02, 0.38, z + 0.27), 'Wood', skip=('-y',))
    for dx in (0.25, 0.85):
        for dz in (-1, 1):
            x = x_in + side * dx
            pipe(G, (x, 0.13, z + dz * 0.27), (x, 0.13, z + dz * 0.33), 0.13, 'WoodDark', sides=6, caps=True)
    pipe(G, (x_in + side * 0.05, 0.5, z), (x_out + side * 0.35, 0.5, z), 0.13, 'Iron', sides=8, r1=0.1, caps=True)
    G.face([(x_out + side * 0.002, 0.28, z - 0.25), (x_out + side * 0.002, 0.28, z + 0.25), (x_out + side * 0.002, 0.72, z + 0.25), (x_out + side * 0.002, 0.72, z - 0.25)], 'Port', (side, 0, 0))
    # Shot stacked by the gun.
    for k, (dx, dz) in enumerate(((0.3, 0.5), (0.5, 0.5), (0.4, 0.62))):
        G.obox((x_in + side * dx, 0.07 + (k == 2) * 0.1, z + dz), (0.07, 0.07, 0.07), 0.4 * k, 'Iron')


def gunports():
    """The lower gun deck's ports along both sides, each with a muzzle."""
    for side in (1, -1):
        for z in (-8.0, -6.0, -3.5, -1.0, 1.5, 3.5):
            x = side * (half_width(z) + THICK + 0.005)
            G.face([(x, -1.05, z - 0.3), (x, -1.05, z + 0.3), (x, -0.45, z + 0.3), (x, -0.45, z - 0.3)], 'Port', (side, 0, 0))
            G.face([(x, -0.42, z - 0.34), (x, -0.42, z + 0.34), (x + side * 0.02, -0.2, z + 0.34), (x + side * 0.02, -0.2, z - 0.34)], 'Wale', (side, 0.5, 0))
            pipe(G, (x - side * 0.05, -0.75, z), (x + side * 0.45, -0.75, z), 0.12, 'Iron', sides=6, caps=True)


def cargo():
    for x, z in BARRELS:
        pipe(G, (x, 0.0, z), (x, 0.9, z), 0.28, 'Wood', sides=8, caps=True)
        for y in (0.15, 0.75):
            pipe(G, (x, y, z), (x, y + 0.05, z), 0.295, 'Iron', sides=8)
    for x, z, h in CRATES:
        G.obox((x, h, z), (h, h, h), 0.15, 'Wood', skip=('-y',))
        G.obox((x, 2 * h + 0.005, z), (h * 0.95, 0.005, h * 0.2), 0.15, 'WoodDark', skip=('-y',))
    # A coil of rope by the mainmast and the treasure chest on the quarterdeck.
    pipe(G, (-1.0, 0.0, 4.2), (-1.0, 0.12, 4.2), 0.35, 'Rope', sides=10, caps=True)
    x, z = CHEST
    G.box((x - 0.42, QD, z - 0.27), (x + 0.42, QD + 0.42, z + 0.27), 'WoodDark', skip=('-y',))
    G.box((x - 0.43, QD + 0.42, z - 0.28), (x + 0.43, QD + 0.62, z + 0.28), 'Wood', skip=('-y',))
    G.box((x - 0.44, QD + 0.2, z - 0.29), (x + 0.44, QD + 0.26, z + 0.29), 'Gold', skip=('-y', '+y'))
    G.box((x - 0.06, QD + 0.36, z + 0.27), (x + 0.06, QD + 0.5, z + 0.3), 'Gold', skip=('-y',))
    for k in range(5):
        G.obox((x + 0.6 + 0.12 * (k % 2), QD + 0.012 + 0.024 * (k // 2), z + 0.15 - 0.12 * k), (0.06, 0.012, 0.06), k, 'Gold')


def wheel():
    """The ship's wheel on its pedestal: rim, eight spokes with handles, and the binnacle before it."""
    cy = QD + 1.15
    z = WHEEL_Z
    for x in (-0.35, 0.35):
        G.box((x - 0.07, QD, z - 0.12), (x + 0.07, cy - 0.05, z + 0.12), 'WoodDark', skip=('-y',))
    G.box((-0.42, cy - 0.1, z - 0.1), (0.42, cy + 0.0, z + 0.1), 'WoodDark')
    pipe(G, (0, cy, z - 0.14), (0, cy, z + 0.16), 0.09, 'Gold', sides=8, caps=True)
    n, r = 16, 0.62
    for k in range(n):
        a0, a1 = angle(k, n), angle(k + 1, n)
        p0 = (r * math.cos(a0), cy + r * math.sin(a0), z + 0.12)
        p1 = (r * math.cos(a1), cy + r * math.sin(a1), z + 0.12)
        G.strut(p0, p1, 0.07, 'Wood')
    for k in range(8):
        a = angle(k, 8) + math.pi / 8
        G.strut((0, cy, z + 0.12), (0.84 * math.cos(a), cy + 0.84 * math.sin(a), z + 0.12), 0.05, 'Wood')
        pipe(G, (0.7 * math.cos(a), cy + 0.7 * math.sin(a), z + 0.12), (0.88 * math.cos(a), cy + 0.88 * math.sin(a), z + 0.12), 0.035, 'WoodDark', sides=6, r1=0.025)
    # Binnacle (the compass stand).
    G.box((-0.22, QD, z + 1.3), (0.22, QD + 1.0, z + 1.65), 'Wood', skip=('-y',))
    pipe(G, (0, QD + 1.0, z + 1.475), (0, QD + 1.15, z + 1.475), 0.2, 'Gold', sides=8, caps=True)


def sail(geo, top_y, bottom_y, half_top, half_bottom, z, belly):
    """A square sail hung from a yard at top_y, its foot at bottom_y, bellied forward (+z) by the wind."""
    cols, rows = 4, 3
    pts = {}
    for i in range(cols + 1):
        for j in range(rows + 1):
            u, v = i / cols, j / rows
            half = half_top + (half_bottom - half_top) * v
            x = -half + 2 * half * u
            y = top_y + (bottom_y - top_y) * v
            pts[(i, j)] = (x, y, z + belly * math.sin(math.pi * u) * (0.35 + 0.65 * math.sin(math.pi * min(1.0, v * 1.1))))
    for i in range(cols):
        for j in range(rows):
            quad = [pts[(i, j)], pts[(i + 1, j)], pts[(i + 1, j + 1)], pts[(i, j + 1)]]
            geo.both(quad, 'Sail', 'SailBack')


def mast(base, foot_y, height, r, yards):
    """A mast: two pieces with a fighting top between, yards across it, and a sail under each yard."""
    x, z = base
    top_y = foot_y + height * 0.55
    pipe(RIGGING, (x, foot_y, z), (x, top_y + 0.4, z), r, 'Wood', sides=10, r1=r * 0.85)
    pipe(RIGGING, (x, top_y, z), (x, foot_y + height, z), r * 0.65, 'Wood', sides=8, r1=r * 0.35, caps=True)
    RIGGING.box((x - 0.8, top_y - 0.08, z - 0.7), (x + 0.8, top_y + 0.05, z + 0.7), 'WoodDark')
    for y, half, drop in yards:
        pipe(RIGGING, (x - half, y, z + r + 0.1), (x + half, y, z + r + 0.1), 0.09, 'WoodDark', sides=6, caps=True)
        sail(RIGGING, y - 0.1, y - drop, half - 0.15, half + 0.15 if drop > 4 else half - 0.05, z + r + 0.18, 0.9)
    return top_y


def rigging():
    main_top = mast(MAINMAST, 0.0, 19.5, 0.3, [(9.0, 4.3, 4.6), (15.0, 3.3, 4.2)])
    fore_top = mast(FOREMAST, 0.0, 16.5, 0.25, [(8.2, 3.5, 3.8), (13.2, 2.7, 3.6)])
    mizzen_top = mast(MIZZEN, QD, 12.5, 0.22, [(QD + 9.8, 2.4, 3.0)])
    # The spanker: a fore-and-aft sail between the mizzen and its boom over the stern.
    mx, mz = MIZZEN
    boom_y, gaff_y = QD + 3.4, QD + 7.8
    pipe(RIGGING, (mx, boom_y, mz - 0.2), (mx, boom_y, STERN - 2.6), 0.07, 'WoodDark', sides=6, caps=True)
    pipe(RIGGING, (mx, gaff_y, mz - 0.2), (mx, gaff_y + 1.0, STERN - 1.6), 0.06, 'WoodDark', sides=6, caps=True)
    RIGGING.both([(mx + 0.02, boom_y + 0.1, mz - 0.3), (mx + 0.02, gaff_y - 0.1, mz - 0.3), (mx + 0.25, gaff_y + 0.6, (mz + STERN) / 2 - 0.6), (mx + 0.02, gaff_y + 0.85, STERN - 1.5), (mx + 0.02, boom_y + 0.1, STERN - 2.5)], 'Sail', 'SailBack')
    # Bowsprit and the jib.
    stem = INNER[-1][0]
    tip = (0, 4.2, stem + 6.0)
    pipe(RIGGING, (0, 0.6, stem - 1.5), tip, 0.2, 'Wood', sides=8, r1=0.09, caps=True)
    RIGGING.both([(0, 13.5, FOREMAST[1] + 0.35), (0, 4.5, stem + 5.6), (0.6, 3.6, stem + 1.4)], 'Sail', 'SailBack')
    # Stays fore and aft, and the shrouds down to the channels on each side.
    RIGGING.strut((0, fore_top + 6.5, FOREMAST[1]), tip, 0.04, 'Rope')
    RIGGING.strut((0, main_top + 7.5, MAINMAST[1]), (0, fore_top + 1.0, FOREMAST[1]), 0.04, 'Rope')
    RIGGING.strut((0, main_top, MAINMAST[1]), (0, 0.9, FOREMAST[1] + 0.2), 0.04, 'Rope')
    RIGGING.strut((0, mizzen_top + 4.0, MIZZEN[1]), (0, main_top + 2.0, MAINMAST[1]), 0.04, 'Rope')
    for (mx, mz), top, foot, count in ((MAINMAST, main_top, 0.0, 4), (FOREMAST, fore_top, 0.0, 3), (MIZZEN, mizzen_top, QD, 3)):
        for side in (1, -1):
            for k in range(count):
                z = mz - 0.4 - 0.55 * k
                x = side * (half_width(z) + THICK + 0.1)
                RIGGING.strut((mx + side * 0.6, top, mz), (x, rail_top(z) - 0.05, z), 0.04, 'Rope')
            z0, z1 = mz - 0.4 - 0.55 * (count - 1) - 0.1, mz - 0.3
            G.box((side * (half_width(mz - 0.8) + THICK), rail_top(mz) - 0.3, z0), (side * (half_width(mz - 0.8) + THICK + 0.15), rail_top(mz) - 0.18, z1), 'WoodDark')
    # The Jolly Roger at the main truck, streaming forward.
    fy, fz = MAINMAST[1] + 0.12, 19.5 - 0.9
    pipe(RIGGING, (0, 19.5, MAINMAST[1]), (0, 20.3, MAINMAST[1]), 0.04, 'Wood', sides=4)
    flag = [(0, fz, fy), (0, fz, fy + 2.0), (0, fz + 1.1, fy + 2.0), (0, fz + 1.1, fy)]
    RIGGING.both([(x, y, z) for x, y, z in flag], 'Black', 'Black')
    for s in (1, -1):
        cx, cy, cz = s * 0.012, fz + 0.65, fy + 1.0
        skull = [(cx, cy + 0.22 * math.sin(angle(k, 8)), cz + 0.2 * math.cos(angle(k, 8))) for k in range(8)]
        RIGGING.face(skull, 'Bone', (s, 0, 0))
        jaw = [(cx, cy - 0.3, cz - 0.11), (cx, cy - 0.3, cz + 0.11), (cx, cy - 0.12, cz + 0.13), (cx, cy - 0.12, cz - 0.13)]
        RIGGING.face(jaw, 'Bone', (s, 0, 0))
        for dz in (-0.08, 0.08):
            RIGGING.face([(cx + s * 0.004, cy - 0.02, cz + dz - 0.05), (cx + s * 0.004, cy - 0.02, cz + dz + 0.05), (cx + s * 0.004, cy + 0.07, cz + dz + 0.05), (cx + s * 0.004, cy + 0.07, cz + dz - 0.05)], 'Black', (s, 0, 0))
        for d in (1, -1):
            a = (cx, cy - 0.45, cz - 0.42 * d)
            b = (cx, cy - 0.75, cz + 0.42 * d)
            n = Vector((0, 0.84 * d, 0.3)).normalized() * 0.05  # across the bone
            RIGGING.face([Vector(a) + n, Vector(b) + n, Vector(b) - n, Vector(a) - n], 'Bone', (s, 0, 0))


def sea():
    n = 48
    fan = [(SEA_R * math.cos(angle(k, n)), WATER, SEA_R * math.sin(angle(k, n))) for k in range(n)]
    for k in range(n):
        G.face([(0, WATER, 0), fan[k], fan[(k + 1) % n]], 'Sea', (0, 1, 0))
    # Wave crests: lighter slivers scattered round the ship.
    placed = 0
    while placed < 90:
        r = rng.uniform(5.0, 45.0)
        a = rng.uniform(0, 2 * math.pi)
        cx, cz = r * math.cos(a), r * math.sin(a)
        if abs(cx) < 4.2 and -13 < cz < 12:
            continue
        L, W = rng.uniform(0.8, 2.6), rng.uniform(0.12, 0.3)
        spin = rng.uniform(-0.3, 0.3)
        d = (math.cos(spin), math.sin(spin))
        pts = [(cx - d[0] * L, WATER + 0.01, cz - d[1] * L), (cx + d[1] * W, WATER + 0.01, cz - d[0] * W), (cx + d[0] * L, WATER + 0.01, cz + d[1] * L), (cx - d[1] * W, WATER + 0.01, cz + d[0] * W)]
        G.face(pts, 'SeaLight' if placed % 5 else 'Foam', (0, 1, 0))
        placed += 1
    # Foam round the hull at the waterline, and a wake astern.
    zs = [STERN - 0.2] + [z for z in range(-10, 11)] + [10.5]
    hw = lambda z: (half_width(z) + THICK) * 0.95 if z < 10.5 else 0.6
    for side in (1, -1):
        for za, zb in zip(zs, zs[1:]):
            spread = lambda z: 0.25 + 0.5 * max(0.0, (z - 6) / 5)
            G.face([(side * hw(za), WATER + 0.02, za), (side * (hw(za) + spread(za)), WATER + 0.02, za), (side * (hw(zb) + spread(zb)), WATER + 0.02, zb), (side * hw(zb), WATER + 0.02, zb)], 'Foam', (0, 1, 0))
    G.face([(-0.6, WATER + 0.02, 11.4), (0.6, WATER + 0.02, 11.4), (0, WATER + 0.02, 12.6)], 'Foam', (0, 1, 0))
    w = half_width(STERN)
    G.face([(-w, WATER + 0.02, STERN - 0.2), (w, WATER + 0.02, STERN - 0.2), (w + 2.5, WATER + 0.02, STERN - 16), (-w - 2.5, WATER + 0.02, STERN - 16)], 'SeaLight', (0, 1, 0))
    for k in range(6):
        z = STERN - 1.5 - k * 2.4
        x = (k % 2 - 0.5) * 1.6
        G.face([(x - 0.5, WATER + 0.03, z), (x + 0.5, WATER + 0.03, z), (x + 0.2, WATER + 0.03, z - 1.6)], 'Foam', (0, 1, 0))


def island(cx, cz, r, h):
    """A low island on the horizon: a sand ring, a green hill and a rock."""
    n = 14
    for k in range(n):
        a0, a1 = angle(k, n), angle(k + 1, n)
        p = lambda rr, a, y: (cx + rr * math.cos(a), y, cz + rr * math.sin(a))
        G.face([p(r * 1.25, a0, WATER + 0.02), p(r * 1.25, a1, WATER + 0.02), p(r, a1, WATER + 0.5), p(r, a0, WATER + 0.5)], 'Sand', (math.cos(a0), 1, math.sin(a0)))
        G.face([p(r, a0, WATER + 0.5), p(r, a1, WATER + 0.5), (cx + r * 0.2, WATER + h, cz)], 'Green', (math.cos(a0), 1, math.sin(a0)))
    G.strut((cx - r * 0.6, WATER, cz + r * 0.3), (cx - r * 0.5, WATER + h * 0.8, cz + r * 0.25), r * 0.35, 'Rock')


def build_look():
    hull()
    decks()
    stairs()
    plank()
    for side, z in CANNONS:
        cannon(side, z)
    gunports()
    cargo()
    wheel()
    rigging()
    sea()
    island(-62.0, 44.0, 9.0, 5.0)
    island(70.0, -26.0, 6.0, 3.5)
    island(48.0, 70.0, 4.0, 2.5)


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


def sun(coll):
    """A sun for renders in Blender; the game lights the ship itself (src/render/stage.ts)."""
    data = bpy.data.lights.new('SUN_ship', 'SUN')
    data.energy = 3.5
    obj = bpy.data.objects.new('SUN_ship', data)
    obj.rotation_euler = (math.radians(50), 0, math.radians(150))
    coll.objects.link(obj)
    return obj


def collision(coll):
    for id, pts, water in WALK:
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'WALK_{id}', me)
        if water:
            obj['water'] = 1
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
            w = {'id': o.name, 'points': [to_game(o.matrix_world @ o.data.vertices[i].co) for i in poly.vertices]}
            if o.get('water'):
                w['water'] = True
            walk.append(w)
        elif o.name.startswith('WALL_'):
            vs = [to_game(o.matrix_world @ v.co) for v in o.data.vertices]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('SPAWN_'):
            spawns.append({'team': int(o['team']), 'slot': int(o['slot']), 'position': to_game(o.matrix_world.translation), 'facing': round(float(o['facing']), 6)})
    return {'name': 'ship', 'walk': walk, 'walls': walls, 'spawns': spawns}


def write_json(path, data):
    """Compact enough to read: one surface, wall or spawn per line."""
    def surface(w):
        water = ', "water": true' if w.get('water') else ''
        return f'    {{ "id": {json.dumps(w["id"])}{water}, "points": {json.dumps(w["points"])} }}'
    lines = ['{', '  "name": "ship",', '  "walk": [']
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
    ship = mesh_object(NAME, G, look, mats)
    rig = mesh_object(f'{NAME}.Rigging', RIGGING, look, mats)
    light = sun(look)
    collision(helpers)
    helpers.hide_render = True
    triangles = sum(len(p.vertices) - 2 for o in (ship, rig) for p in o.data.polygons)
    report = {'triangles': triangles, 'walk': len(WALK), 'walls': len(WALLS), 'spawns': len(SPAWNS), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (ship, rig):
            o.select_set(True)
        bpy.context.view_layer.objects.active = ship
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        bpy.data.libraries.write(OUT_BLEND, {look, helpers}, fake_user=True)
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('SHIP_RESULT', json.dumps(result))
