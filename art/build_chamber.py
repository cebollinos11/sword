"""
Builds the carbon-freezing chamber Arena in Blender: the look (a mesh with
flat-colour and glowing materials, plus lights) and the geometry the
simulation stands Fighters on (helper objects in a `Collision` collection).
This script is the source of truth for both (ADR 0006): re-run it to change
the Arena.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_chamber.py").read(), {"__file__": r"C:/Repos/sword/art/build_chamber.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_chamber.py').read(), {'__file__': r'C:/Repos/sword/art/build_chamber.py', 'SAVE': True})"

With SAVE = True it writes art/chamber.blend, public/models/arenas/chamber.glb
(the look) and data/arenas/chamber.json (the sim geometry, read back from the
Collision helpers):
  - WALK_<id>:  one planar convex face, a floor (a Walk Surface); `lava` = 1 on the lava pool.
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights.
  - SPAWN_T<team>_<slot>: an empty where that Fighter starts, its yaw in the `facing` property.

Everything is authored in game coordinates (x east, y up, z; facing 0 looks
along +z) and placed in Blender as (x, -z, y), which the glTF export
(export_yup) turns back into game coordinates.

Layout: a round shaft, its floor a pool of lava (y LAVA). A ring-shaped steel
platform (y 0, from R_IN to R_OUT) stands over it on struts, with no rail: off
its outer edge or down the hole in its centre is the lava, and the lava kills.
Above the hole hangs the freezing apparatus; two retracted catwalks stop short
of the platform at the shaft's doors, a gap a held Jump crosses (and the AI
cannot). Under 10 000 triangles.
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
NAME = 'Chamber'
OUT_BLEND = os.path.join(REPO, 'art', 'chamber.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'chamber.glb')
OUT_JSON = os.path.join(REPO, 'data', 'arenas', 'chamber.json')

R_IN = 2.0  # the hole in the platform's centre
R_OUT = 7.5  # the platform's outer edge
DECK = 0.6  # platform thickness
LAVA = -4.0  # the lava's surface
SHAFT = 15.0  # the shaft wall's radius
CEIL = 12.0  # where the shaft wall meets the ceiling cone
SEG = 48  # segments of every drawn circle
SIM_SEG = 24  # Walk Surface pieces of the platform ring
CATWALK_END = 11.0  # the retracted catwalks stop here (radius)
CATWALKS = (math.pi / 2, -math.pi / 2)  # their bearings (angle from +x toward +z)
CATWALK_HW = 0.9  # a catwalk's floor, each side of its middle (the drawn grate)
CATWALK_RAIL = 0.95  # its side rails, each side of its middle

rng = random.Random(11)

# name: (sRGB colour, metallic, roughness, emission strength)
MATERIALS = {
    'Deck': (0x3b4048, 0.6, 0.5, 0),
    'Deck2': (0x30353c, 0.6, 0.5, 0),
    'Grate': (0x1e2226, 0.5, 0.7, 0),
    'Hazard': (0xc8961c, 0.2, 0.6, 0),
    'HazardDark': (0x18181a, 0.2, 0.6, 0),
    'Steel': (0x5d636b, 0.8, 0.4, 0),
    'SteelDark': (0x34383e, 0.8, 0.5, 0),
    'Wall': (0x2a2d33, 0.4, 0.7, 0),
    'WallDark': (0x1b1d21, 0.4, 0.7, 0),
    'Rib': (0x41464e, 0.6, 0.5, 0),
    'Lava': (0xff5310, 0.0, 0.9, 3.0),
    'LavaHot': (0xffa62e, 0.0, 0.9, 5.0),
    'Crust': (0x2b120a, 0.0, 1.0, 0.0),
    'Glow': (0xff6a28, 0.0, 0.5, 2.5),
    'Rim': (0xffa040, 0.0, 0.5, 3.0),
    'Cool': (0xc4dcff, 0.0, 0.3, 4.0),
    'Door': (0x0c0d0f, 0.0, 1.0, 0),
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
        """A square beam from point a to point b (3D), `width` across."""
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
        self.prism(c, mat)


def polar(r, a, y):
    return (r * math.cos(a), y, r * math.sin(a))


def angle(k, n=SEG):
    return 2 * math.pi * k / n


def ring_band(geo, r0, r1, y, mat_for, facing=(0, 1, 0), n=SEG):
    """A flat ring between radii r0 and r1 at height y, one quad per segment (material by segment index)."""
    for k in range(n):
        a0, a1 = angle(k, n), angle(k + 1, n)
        geo.face([polar(r0, a0, y), polar(r1, a0, y), polar(r1, a1, y), polar(r0, a1, y)], mat_for(k), facing)


def cylinder_band(geo, r, y0, y1, mat_for, inward, n=SEG):
    """A vertical band of a cylinder of radius r from y0 to y1, facing in or out."""
    for k in range(n):
        a0, a1 = angle(k, n), angle(k + 1, n)
        mid = (a0 + a1) / 2
        out = (math.cos(mid), 0, math.sin(mid))
        geo.face([polar(r, a0, y0), polar(r, a1, y0), polar(r, a1, y1), polar(r, a0, y1)], mat_for(k), tuple(-x for x in out) if inward else out)


def pipe(geo, a, b, r, mat, sides=8):
    """An open-ended tube from a to b (3D)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.cross(Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))).normalized()
    v = d.cross(u)
    for k in range(sides):
        t0, t1 = angle(k, sides), angle(k + 1, sides)
        o0 = u * math.cos(t0) + v * math.sin(t0)
        o1 = u * math.cos(t1) + v * math.sin(t1)
        geo.face([a + o0 * r, a + o1 * r, b + o1 * r, b + o0 * r], mat, tuple((o0 + o1) / 2))


G = Geo()  # the chamber
CEILING = Geo()  # hidden in top-down renders

# ---------------------------------------------------------------- the sim geometry

WALK = []  # (id, [(x, y, z)], lava)
WALLS = []  # (id, (ax, az), (bx, bz), bottom, top)
SPAWNS = []  # (team, slot, (x, y, z), facing)

# The platform ring, in convex pieces (corners on the drawn circles, so the sim edge is never outside the drawn one).
for k in range(SIM_SEG):
    a0, a1 = angle(k, SIM_SEG), angle(k + 1, SIM_SEG)
    WALK.append((f'ring{k:02d}', [polar(R_IN, a0, 0.0), polar(R_IN, a1, 0.0), polar(R_OUT, a1, 0.0), polar(R_OUT, a0, 0.0)], False))
# The lava pool: one surface under everything, out to the shaft wall.
WALK.append(('lava', [polar(SHAFT, angle(k, 32), LAVA) for k in range(32)], True))

# The shaft wall (keeps the camera in).
for k in range(SEG):
    a0, a1 = angle(k), angle(k + 1)
    p, q = polar(SHAFT, a0, 0), polar(SHAFT, a1, 0)
    WALLS.append((f'shaft{k:02d}', (p[0], p[2]), (q[0], q[2]), LAVA - 2, CEIL))

# The catwalks: a floor each from its end to the shaft wall (which closes the door end), railed along its sides but
# open at its end, 3.5 m from the ring's edge: a held Jump crosses the gap onto it and back, a miss falls in the lava.
for k, b in enumerate(CATWALKS):
    across = (-math.sin(b), math.cos(b))
    at = lambda r, w: (r * math.cos(b) + w * across[0], r * math.sin(b) + w * across[1])  # r out along it, w across it
    WALK.append((f'catwalk{k}', [(x, 0.0, z) for x, z in (at(CATWALK_END, -CATWALK_HW), at(CATWALK_END, CATWALK_HW), at(SHAFT, CATWALK_HW), at(SHAFT, -CATWALK_HW))], False))
    for side, name in ((-1, 'a'), (1, 'b')):
        WALLS.append((f'catwalk{k}_rail_{name}', at(CATWALK_END, side * CATWALK_RAIL), at(SHAFT, side * CATWALK_RAIL), -0.5, 1.0))

# The two teams face each other across the hole, on the ring's middle.
SPAWN_R = (R_IN + R_OUT) / 2
for slot, off in enumerate((0.0, 0.42, -0.42)):
    for team, base, facing in ((0, math.pi, math.pi / 2), (1, 0.0, -math.pi / 2)):
        x, y, z = polar(SPAWN_R, base + off, 0.0)
        SPAWNS.append((team, slot, (round(x, 4), 0.0, round(z, 4)), facing))

# ---------------------------------------------------------------- the look


def build_platform():
    # Deck: hazard stripes round the hole, steel panels, a glowing rim band at the edge.
    ring_band(G, R_IN, R_IN + 0.45, 0, lambda k: 'Hazard' if k % 2 else 'HazardDark')
    ring_band(G, R_IN + 0.45, 4.6, 0, lambda k: 'Deck' if k % 2 else 'Deck2')
    ring_band(G, 4.6, R_OUT - 0.35, 0, lambda k: 'Deck2' if k % 2 else 'Deck')
    ring_band(G, R_OUT - 0.35, R_OUT, 0, lambda k: 'Grate')
    # Seams: thin raised strips on the radial joins every 30 degrees and a ring at r 4.6.
    for k in range(12):
        a = angle(k, 12)
        mid = polar((R_IN + 0.45 + R_OUT - 0.35) / 2, a, 0.01)
        G.obox(mid, ((R_OUT - 0.35 - R_IN - 0.45) / 2, 0.012, 0.05), -a, 'SteelDark', skip=('-y',))
    ring_band(G, 4.55, 4.65, 0.012, lambda k: 'SteelDark')
    # Sides and underside.
    cylinder_band(G, R_OUT, -DECK, 0, lambda k: 'Steel', inward=False)
    cylinder_band(G, R_IN, -DECK - 0.5, 0, lambda k: 'SteelDark', inward=True)
    ring_band(G, R_IN, R_OUT, -DECK, lambda k: 'SteelDark', facing=(0, -1, 0))
    ring_band(G, R_IN, R_IN + 0.3, -DECK - 0.5, lambda k: 'SteelDark', facing=(0, -1, 0))
    cylinder_band(G, R_IN + 0.3, -DECK - 0.5, -DECK, lambda k: 'SteelDark', inward=False)
    # Rim lights on the outer face.
    for k in range(16):
        a = angle(k, 16) + math.pi / 16
        G.obox(polar(R_OUT + 0.02, a, -DECK / 2), (0.03, 0.08, 0.35), -a, 'Rim')
    # The freezing clamps inside the hole: six jaws on the bore.
    for k in range(6):
        a = angle(k, 6)
        G.obox(polar(R_IN - 0.18, a, -0.45), (0.18, 0.3, 0.35), -a, 'Steel')
        G.obox(polar(R_IN - 0.05, a, -0.02), (0.06, 0.02, 0.3), -a, 'Rim', skip=('-y',))
    # Struts down into the lava, and the ring beam they hold.
    for k in range(8):
        a = angle(k, 8) + math.pi / 8
        G.strut(polar(5.2, a, LAVA - 0.5), polar(4.2, a, -DECK), 0.35, 'SteelDark')
        G.strut(polar(5.2, a, LAVA - 0.5), polar(6.6, a, -DECK), 0.25, 'SteelDark')
        G.strut(polar(2.6, a + math.pi / 8, LAVA - 0.5), polar(2.6, a + math.pi / 8, -DECK - 0.5), 0.3, 'SteelDark')
    for k in range(SEG // 2):
        a0, a1 = angle(k, SEG // 2), angle(k + 1, SEG // 2)
        G.strut(polar(5.2, a0, -DECK - 0.15), polar(5.2, a1, -DECK - 0.15), 0.3, 'Steel')


def build_lava():
    # The pool, a hotter glow under the hole, and dark crust drifting on it.
    fan = [polar(SHAFT, angle(k), LAVA) for k in range(SEG)]
    for k in range(SEG):
        G.face([(0, LAVA, 0), fan[k], fan[(k + 1) % SEG]], 'Lava', (0, 1, 0))
    for k in range(16):
        a0, a1 = angle(k, 16), angle(k + 1, 16)
        G.face([(0, LAVA + 0.01, 0), polar(R_IN + 0.6, a0, LAVA + 0.01), polar(R_IN + 0.6, a1, LAVA + 0.01)], 'LavaHot', (0, 1, 0))
    placed = 0
    while placed < 40:
        r = rng.uniform(R_IN + 1.0, SHAFT - 0.8)
        a = rng.uniform(0, 2 * math.pi)
        cx, _, cz = polar(r, a, 0)
        size = rng.uniform(0.3, 1.1)
        n = rng.choice((5, 6, 7))
        spin = rng.uniform(0, 2 * math.pi)
        pts = [(cx + size * rng.uniform(0.6, 1.0) * math.cos(spin + angle(i, n)), LAVA + 0.02, cz + size * rng.uniform(0.6, 1.0) * math.sin(spin + angle(i, n))) for i in range(n)]
        G.face(pts, 'Crust', (0, 1, 0))
        placed += 1
    # Hot seams where the lava meets the wall.
    ring_band(G, SHAFT - 0.6, SHAFT, LAVA + 0.015, lambda k: 'LavaHot')


def build_shaft():
    # The wall: dark below, panelled above, glowing slots between the ribs.
    cylinder_band(G, SHAFT, LAVA - 1, 1.2, lambda k: 'WallDark', inward=True)
    cylinder_band(G, SHAFT, 1.2, 2.0, lambda k: 'Glow' if k % 4 == 1 else 'Wall', inward=True)
    cylinder_band(G, SHAFT, 2.0, 7.0, lambda k: 'Wall', inward=True)
    cylinder_band(G, SHAFT, 7.0, 7.6, lambda k: 'Glow' if k % 3 == 0 else 'WallDark', inward=True)
    cylinder_band(G, SHAFT, 7.6, CEIL, lambda k: 'Wall', inward=True)
    # Ribs.
    for k in range(24):
        a = angle(k, 24)
        G.obox(polar(SHAFT - 0.2, a, (LAVA - 1 + CEIL) / 2), (0.2, (CEIL - LAVA + 1) / 2, 0.18), -a, 'Rib', skip=('+x',))
    # A gallery ledge round the wall (decorative), with a lit underside.
    ring_band(G, SHAFT - 1.0, SHAFT, 4.0, lambda k: 'SteelDark')
    ring_band(G, SHAFT - 1.0, SHAFT, 3.75, lambda k: 'Rim' if k % 6 == 0 else 'SteelDark', facing=(0, -1, 0))
    cylinder_band(G, SHAFT - 1.0, 3.75, 4.0, lambda k: 'Steel', inward=False)
    cylinder_band(G, SHAFT - 0.95, 4.85, 4.95, lambda k: 'Steel', inward=False)
    for k in range(24):
        a = angle(k, 24) + math.pi / 24
        G.obox(polar(SHAFT - 0.95, a, 4.45), (0.03, 0.45, 0.03), -a, 'Steel')
    # Vertical pipes up the wall.
    for k in range(10):
        a = angle(k, 10) + 0.12
        x, _, z = polar(SHAFT - 0.55, a, 0)
        pipe(G, (x, LAVA - 0.5, z), (x, CEIL, z), 0.16, 'Steel')
    # Doors and the retracted catwalks.
    for b in CATWALKS:
        G.obox(polar(SHAFT - 0.02, b, 1.5), (0.05, 1.5, 1.1), -b, 'Door', skip=('+x',))
        G.obox(polar(SHAFT - 0.05, b, 3.1), (0.06, 0.08, 1.25), -b, 'Rim')
        mid = (SHAFT + CATWALK_END) / 2
        half = (SHAFT - CATWALK_END) / 2
        G.obox(polar(mid, b, -0.15), (half, 0.15, 1.0), -b, 'SteelDark')
        G.obox(polar(mid, b, 0.0), (half, 0.005, CATWALK_HW), -b, 'Grate', skip=('-y',))
        for side in (-1, 1):
            s = (-math.sin(b) * side * CATWALK_RAIL, 0, math.cos(b) * side * CATWALK_RAIL)
            p0 = Vector(polar(CATWALK_END, b, 1.0)) + Vector(s)
            p1 = Vector(polar(SHAFT - 0.4, b, 1.0)) + Vector(s)
            pipe(G, p0, p1, 0.04, 'Steel', sides=6)
            for t in (0.0, 0.5, 1.0):
                q = p0.lerp(p1, t)
                pipe(G, (q.x, 0.0, q.z), (q.x, 1.0, q.z), 0.035, 'Steel', sides=6)
        # The catwalk's end: hazard stripes and a warning lamp.
        G.obox(polar(CATWALK_END + 0.15, b, 0.006), (0.15, 0.005, 0.9), -b, 'Hazard', skip=('-y',))
        G.obox(polar(CATWALK_END + 0.1, b, 1.15), (0.08, 0.08, 0.08), -b, 'Rim')


def build_apparatus():
    # The freezing head hangs over the hole: a drum, a glowing ring under it, hoses up to the ceiling.
    top, bottom = 9.2, 7.4
    cylinder_band(G, 1.6, bottom, top, lambda k: 'SteelDark' if k % 4 else 'Steel', inward=False, n=24)
    ring_band(G, 0.9, 1.6, bottom, lambda k: 'SteelDark', facing=(0, -1, 0), n=24)
    ring_band(G, 0.0001, 0.9, bottom, lambda k: 'Cool', facing=(0, -1, 0), n=24)
    ring_band(G, 1.6, 2.2, top, lambda k: 'Steel', facing=(0, -1, 0), n=24)
    cylinder_band(G, 2.2, top, top + 0.4, lambda k: 'Steel', inward=False, n=24)
    for k in range(6):
        a = angle(k, 6)
        G.strut(polar(1.7, a, bottom + 0.2), polar(1.9, a, bottom - 0.6), 0.18, 'Steel')
        G.obox(polar(1.95, a, bottom - 0.65), (0.12, 0.05, 0.12), -a, 'Cool')
    for k in range(8):
        a = angle(k, 8) + 0.2
        p0 = polar(1.9, a, top + 0.3)
        p1 = polar(3.6, a, top + 1.6)
        p2 = polar(3.0, a, CEIL + 2.2)
        pipe(CEILING, p0, p1, 0.12, 'SteelDark', sides=6)
        pipe(CEILING, p1, p2, 0.12, 'SteelDark', sides=6)
    pipe(CEILING, (0, top, 0), (0, CEIL + 3.0, 0), 0.5, 'Steel', sides=12)


def build_ceiling():
    # A low cone from the wall's top to a hub over the apparatus, with radial beams and a ring of lamps.
    hub, peak = 3.2, CEIL + 3.0
    for k in range(SEG):
        a0, a1 = angle(k), angle(k + 1)
        CEILING.face([polar(SHAFT, a0, CEIL), polar(hub, a0, peak), polar(hub, a1, peak), polar(SHAFT, a1, CEIL)], 'WallDark' if k % 2 else 'Wall', (0, -1, 0))
    for k in range(SEG // 2):
        a0, a1 = angle(k, SEG // 2), angle(k + 1, SEG // 2)
        CEILING.face([(0, peak, 0), polar(hub, a1, peak), polar(hub, a0, peak)], 'SteelDark', (0, -1, 0))
    for k in range(12):
        a = angle(k, 12)
        CEILING.strut(polar(SHAFT - 0.3, a, CEIL - 0.2), polar(hub, a, peak - 0.25), 0.3, 'Rib')
        CEILING.obox(polar(9.0, a + math.pi / 12, CEIL + 1.1), (0.4, 0.04, 0.25), -(a + math.pi / 12), 'Cool', skip=('+y',))


def build_look():
    build_platform()
    build_lava()
    build_shaft()
    build_apparatus()
    build_ceiling()


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

    def point(name, p, energy, radius=0.3, colour=(1.0, 0.45, 0.15)):
        data = bpy.data.lights.new(name, 'POINT')
        data.energy = energy
        data.color = colour
        data.shadow_soft_size = radius
        obj = bpy.data.objects.new(name, data)
        obj.location = to_blender(p)
        coll.objects.link(obj)
        out.append(obj)

    # Lava glow from below: round the pool and up through the hole.
    for k in range(4):
        point(f'LIGHT_lava{k}', polar(10.5, angle(k, 4) + math.pi / 4, LAVA + 1.2), 1500, 1.0)
    point('LIGHT_lavacore', (0, LAVA + 1.0, 0), 900, 0.8)
    # Cold light from the freezing head.
    point('LIGHT_freeze', (0, 6.8, 0), 800, 0.6, colour=(0.75, 0.85, 1.0))
    return out


def collision(coll):
    for id, pts, lava in WALK:
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'WALK_{id}', me)
        if lava:
            obj['lava'] = 1
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
            if o.get('lava'):
                w['lava'] = True
            walk.append(w)
        elif o.name.startswith('WALL_'):
            vs = [to_game(o.matrix_world @ v.co) for v in o.data.vertices]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('SPAWN_'):
            spawns.append({'team': int(o['team']), 'slot': int(o['slot']), 'position': to_game(o.matrix_world.translation), 'facing': round(float(o['facing']), 6)})
    return {'name': 'chamber', 'walk': walk, 'walls': walls, 'spawns': spawns}


def write_json(path, data):
    """Compact enough to read: one surface, wall or spawn per line."""
    def surface(w):
        lava = ', "lava": true' if w.get('lava') else ''
        return f'    {{ "id": {json.dumps(w["id"])}{lava}, "points": {json.dumps(w["points"])} }}'
    lines = ['{', '  "name": "chamber",', '  "walk": [']
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
print('CHAMBER_RESULT', json.dumps(result))
