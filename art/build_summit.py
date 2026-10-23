"""
Builds the snowy summit Arena in Blender: the look (a mesh with flat-colour
materials) and the geometry the simulation stands Fighters on (helper objects
in a `Collision` collection). This script is the source of truth for both
(ADR 0006): re-run it to change the Arena.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_summit.py").read(), {"__file__": r"C:/Repos/sword/art/build_summit.py", "SAVE": False})
or headless:
    blender --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/art/build_summit.py').read(), {'__file__': r'C:/Repos/sword/art/build_summit.py', 'SAVE': True})"

With SAVE = True it writes art/summit.blend, public/models/arenas/summit.glb
(the look) and data/arenas/summit.json (the sim geometry, read back from the
Collision helpers):
  - WALK_<id>:  one planar convex face, a floor (a Walk Surface).
  - WALL_<id>:  one vertical quad, solid between its bottom and top heights.
  - SPAWN_T<team>_<slot>: an empty where that Fighter starts, its yaw in the `facing` property.

Everything is authored in game coordinates (x east, y up, z; facing 0 looks
along +z) and placed in Blender as (x, -z, y), which the glTF export
(export_yup) turns back into game coordinates.

Layout: a snowy mountain top where a starship came down. The fight is on a
lower shelf (y 0); behind it a summit plateau (y HIGH) holds the wreck of the
hull, reached by a snow ramp along the west crag, or by climbing nothing: its
face is a ledge to jump down from. Crags close the west, the back and the
summit's rear; the whole east side is a cliff edge, with a narrow rock tongue
(the overlook) jutting out over it. Below the cliff, under a sea of cloud, is a
valley floor far enough down that the fall kills (a Death by Fall). Debris from
the ship lies on both levels. The layout from above is S times the first
summit's; heights and the wreck and its debris keep their size. Under 10 000
triangles.
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
NAME = 'Summit'
OUT_BLEND = os.path.join(REPO, 'art', 'summit.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'arenas', 'summit.glb')
OUT_JSON = os.path.join(REPO, 'data', 'arenas', 'summit.json')

S = 3.0  # the layout's scale from above (x, z); heights and the props keep their size
HIGH = 2.0  # the summit plateau's height: a walk off it stings (fall.safeHeight is 1.6), a jump off it hurts more
RAMP_X = (-7.0 * S, -4.5 * S)  # the ramp runs up along the west crag between these
RAMP_Z = (-1.5 * S, -5.0 * S)  # from the shelf (y 0) to the plateau's front (y HIGH)
CLOUD = -12.0  # the cloud sea's top, hiding the drop
VALLEY = -30.0  # the valley floor's Walk Surface: a fall to it kills from anywhere
VALLEY_SIM = 45.0 * S  # its half size
SKY_R = 200.0  # the drawn cloud sea's radius (lost in the haze long before)


def scaled(pts):
    """Points from above, (x, z, ...), at the layout's scale (anything after x, z kept)."""
    return [(p[0] * S, p[1] * S, *p[2:]) for p in pts]


# The floors from above, (x, z). Each is convex.
SHELF = scaled([(-7.0, -1.5), (6.3, -1.5), (6.6, 1.0), (6.6, 2.2), (6.2, 4.6), (5.4, 7.0), (-7.0, 7.0)])
NOOK = scaled([(-4.5, -5.0), (5.6, -5.0), (6.3, -1.5), (-4.5, -1.5)])
OVERLOOK = scaled([(6.6, 1.0), (9.0, 1.15), (9.3, 1.65), (9.0, 2.05), (6.6, 2.2)])
UPPER = scaled([(-7.0, -12.0), (1.5, -12.0), (4.6, -10.8), (5.6, -8.0), (5.6, -5.0), (-7.0, -5.0)])

# The crags, one run from the summit's rear round the west and along the back: (x, z).
CRAG = scaled([(4.6, -10.8), (1.5, -12.0), (-7.0, -12.0), (-7.0, 7.0), (5.4, 7.0)])
CRAG_INSIDE = (5.0 * S, 0.0)  # a point the crags and ridges face (their inner face): the shelf by the cliff
# Past each end the crag runs on as a ridge falling away beside the cliff, into the cloud: (x, z, foot height).
RIDGE_FRONT = scaled([(15.0, -20.0, -20.0), (10.0, -16.0, -12.0), (7.6, -12.6, -4.0)])
RIDGE_BACK = scaled([(8.6, 8.6, -4.0), (11.5, 12.5, -12.0), (15.0, 18.0, -20.0)])
# The cliff's rim, the summit's rear crag to the back crag: (x, z, top). The overlook juts from the shelf's edge.
RIM = scaled([(4.6, -10.8, HIGH), (5.6, -8.0, HIGH), (5.6, -5.0, HIGH), (5.6, -5.0, 0.0), (6.3, -1.5, 0.0), (6.6, 1.0, 0.0),
              (6.6, 2.2, 0.0), (6.2, 4.6, 0.0), (5.4, 7.0, 0.0)])
SEAM = (5.6 * S, -5.0 * S)  # where the plateau's and the shelf's cliffs meet

HULL = ((-1.8 * S, -10.1 * S), 0.18)  # the wrecked starship's hull on the plateau: centre (x, z), yaw
HULL_TOP = 3.45  # the drawn hull's spine (3.3 to 3.5 along it, measured): its Walls' top and its lid
NACELLE = ((-5.4 * S, 3.7 * S), 0.25)  # its engine, thrown onto the shelf: centre, yaw (its axis along local z)
NACELLE_TOP = 1.3  # the drawn nacelle's top (1.05 to 1.37 along it, measured): its Walls' top and its lid
CONTAINERS = ((3.0 * S, -5.0 * S + 0.9), 0.12)  # two cargo containers, one on the other, under the plateau's face
DISH = (3.8 * S, 5.6 * S)  # a fallen comms dish, lying face-up
DISH_R = 1.1  # the octagon round its rim (radius 1.05), from above
DISH_RIM = 1.1  # its rim's height (1.0 to 1.2, tilted): its Walls' top and its lid
PYLON = (3.9 * S, -6.3 * S)  # a beacon pylon the crew planted on the plateau
CRATES = [(-3.4 * S, -5.0 * S + 0.7, 0.4, 0.3), (-2.6 * S, 7.0 * S - 0.7, 0.45, -0.2)]  # (x, z, half size, yaw): one by the plateau's face, one by the back crag

rng = random.Random(11)

# name: (sRGB colour, metallic, roughness, emission strength)
MATERIALS = {
    'Snow': (0xe9eff6, 0.0, 0.9, 0),
    'SnowShade': (0xcfdbe8, 0.0, 0.9, 0),
    'Ice': (0xa8cde4, 0.0, 0.3, 0),
    'Rock': (0x5b5e66, 0.0, 1.0, 0),
    'RockDark': (0x3e4148, 0.0, 1.0, 0),
    'RockLight': (0x7a7e87, 0.0, 1.0, 0),
    'Scorch': (0x2c2a2b, 0.0, 1.0, 0),
    'Hull': (0x9aa1aa, 0.6, 0.5, 0),
    'HullDark': (0x4c525b, 0.6, 0.5, 0),
    'Panel': (0xc4cad1, 0.5, 0.5, 0),
    'Hazard': (0xe2a21e, 0.2, 0.6, 0),
    'Red': (0xb8352a, 0.2, 0.6, 0),
    'Black': (0x15171a, 0.3, 0.8, 0),
    'Window': (0x3fb8e8, 0.0, 0.2, 1.2),
    'Glow': (0x56e4ff, 0.0, 0.5, 3.0),
    'GlowOrange': (0xff7a2e, 0.0, 0.5, 3.0),
    'Beacon': (0xff3a2a, 0.0, 0.5, 4.0),
    'Cloud': (0xe2eaf3, 0.0, 1.0, 0),
    'CloudShade': (0xc6d3e2, 0.0, 1.0, 0),
    'Valley': (0x2b3038, 0.0, 1.0, 0),
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
        """A thin sheet (a dish, a wing's edge): seen from either side, a colour each."""
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
        geo.face([ra[k], ra[k1], rb[k1], rb[k]], mat, tuple(mid - (a + b) / 2 - d * (mid - (a + b) / 2).dot(d)))
    if caps:
        geo.face(ra, cap_mat or mat, tuple(-d))
        geo.face(rb, cap_mat or mat, tuple(d))


def placed(x, y, z, yaw=0.0, roll=0.0, pitch=0.0):
    """A local frame at (x, y, z), turned `yaw` about y (local +x then points along (cos yaw, -sin yaw) in x, z),
    after `pitch` about its local z and `roll` about its local x."""
    return Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'Z') @ Matrix.Rotation(roll, 4, 'X')


def inside(poly, x, z, margin=0.0):
    """Whether (x, z) lies inside the convex polygon `poly` (from above), at least `margin` from its edges."""
    sign = 0
    for i, (ax, az) in enumerate(poly):
        bx, bz = poly[(i + 1) % len(poly)]
        ex, ez = bx - ax, bz - az
        cross = ex * (z - az) - ez * (x - ax)
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        if s != sign or abs(cross) / math.hypot(ex, ez) < margin:
            return False
    return True


def floor_y(x, z):
    """The height of the floor at (x, z) (on the plateau, the ramp or the shelf)."""
    if z <= RAMP_Z[1]:
        return HIGH
    if x <= RAMP_X[1] and z < RAMP_Z[0]:
        return HIGH * (RAMP_Z[0] - z) / (RAMP_Z[0] - RAMP_Z[1])
    return 0.0


def normal_of(pts):
    a, b, c = (Vector(p) for p in pts[:3])
    n = (b - a).cross(c - a)
    return n.normalized() if n.length > 1e-9 else Vector((0, 1, 0))


G = Geo()  # the summit: floors, crags, cliff, debris
SKY = Geo()  # the cloud sea, the far peaks and the valley floor: hidden in close renders

# ---------------------------------------------------------------- the sim geometry

WALK = []  # (id, [(x, y, z)])
WALLS = []  # (id, (ax, az), (bx, bz), bottom, top)
SPAWNS = []  # (team, slot, (x, y, z), facing)

r4 = lambda v: round(v, 4) + 0.0
WALK.append(('shelf', [(x, 0.0, z) for x, z in SHELF]))
WALK.append(('nook', [(x, 0.0, z) for x, z in NOOK]))
WALK.append(('overlook', [(x, 0.0, z) for x, z in OVERLOOK]))
WALK.append(('ramp', [(RAMP_X[0], 0.0, RAMP_Z[0]), (RAMP_X[1], 0.0, RAMP_Z[0]), (RAMP_X[1], HIGH, RAMP_Z[1]), (RAMP_X[0], HIGH, RAMP_Z[1])]))
WALK.append(('summit', [(x, HIGH, z) for x, z in UPPER]))
s = VALLEY_SIM
WALK.append(('valley', [(-s, VALLEY, -s), (s, VALLEY, -s), (s, VALLEY, s), (-s, VALLEY, s)]))


def wall(id, a, b, bottom, top):
    WALLS.append((id, (r4(a[0]), r4(a[1])), (r4(b[0]), r4(b[1])), bottom, top))


def ring(id, corners, bottom, top):
    """A Wall along each edge of the convex footprint `corners` ((x, z), in order); returns the corners."""
    for e in range(len(corners)):
        wall(f'{id}_{e}', corners[e], corners[(e + 1) % len(corners)], bottom, top)
    return corners


def rect(id, x, z, hx, hz, yaw, bottom, top):
    """Four Walls round a box of half extents hx, hz at (x, z), turned `yaw` like `placed`; returns its corners."""
    cs, sn = math.cos(yaw), math.sin(yaw)
    return ring(id, [(x + lx * cs + lz * sn, z - lx * sn + lz * cs) for lx, lz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz))], bottom, top)


def lid(id, corners, y):
    """A Walk Surface over a prop's Walls (the same corners), at their top: clear the Walls and you stand on it."""
    WALK.append((f'{id}_top', [(r4(x), y, r4(z)) for x, z in corners]))


# The crags: tall, so the camera stops short of them. Each runs from under the floor beside it.
for k, (a, b) in enumerate(zip(CRAG, CRAG[1:])):
    wall(f'crag{k}', a, b, min(floor_y(*a), floor_y(*b)) - 0.5, 14.0)

# The wreck and its debris. Each prop's Walls stop at its drawn top, with a lid there, so a Jump that
# clears them lands on top and a Fighter can walk about up there (and walk off the edge).
(hx, hz), hyaw = HULL
lid('hull', rect('hull', hx, hz, 3.7, 1.25, hyaw, HIGH - 0.5, HULL_TOP), HULL_TOP)
(nx, nz), nyaw = NACELLE
lid('nacelle', rect('nacelle', nx, nz, 0.8, 1.5, nyaw, -0.5, NACELLE_TOP), NACELLE_TOP)
(cx, cz), cyaw = CONTAINERS
lid('containers', rect('containers', cx, cz, 1.2, 0.62, cyaw, -0.5, 2.5), 2.5)
# The dish lies face-up: an octagon round its rim.
lid('dish', ring('dish', [(DISH[0] + DISH_R * math.cos(angle(k, 8) + math.pi / 8), DISH[1] + DISH_R * math.sin(angle(k, 8) + math.pi / 8)) for k in range(8)], -0.5, DISH_RIM), DISH_RIM)
rect('pylon', *PYLON, 0.22, 0.22, 0.0, HIGH - 0.5, HIGH + 3.5)
for k, (x, z, h, yaw) in enumerate(CRATES):
    lid(f'crate{k}', rect(f'crate{k}', x, z, h, h, yaw, -0.5, 2 * h), 2 * h)

# The two teams face each other across the shelf, the summit's face behind one of them.
for slot, x in enumerate((0.0, 1.4 * S, -1.4 * S)):
    SPAWNS.append((0, slot, (x, 0.0, 3.4 * S), math.pi))
    SPAWNS.append((1, slot, (-x, 0.0, -1.0 * S), 0.0))

# ---------------------------------------------------------------- the look


def floors():
    for id, pts in WALK:
        if id == 'valley' or id.endswith('_top'):  # the lids sit on props, which draw their own tops
            continue
        G.face(pts, 'Snow', (0, 1, 0))
    # Wind-packed hollows, ice and the odd bare rock, scattered over the floors.
    polys = [(SHELF, 0.0), (NOOK, 0.0), (UPPER, HIGH)]
    made = 0
    while made < 34 * S:
        poly, y = polys[rng.choice((0, 0, 0, 1, 2, 2))]
        xs, zs = [p[0] for p in poly], [p[1] for p in poly]
        x, z = rng.uniform(min(xs), max(xs)), rng.uniform(min(zs), max(zs))
        r = rng.uniform(0.35, 1.3) * S ** 0.5
        n = 7
        a0 = rng.uniform(0, math.pi)
        blob = [(x + r * rng.uniform(0.6, 1.0) * math.cos(a0 + angle(k, n)), z + r * rng.uniform(0.6, 1.0) * math.sin(a0 + angle(k, n))) for k in range(n)]
        if not all(inside(poly, bx, bz, 0.15) for bx, bz in blob):
            continue
        mat = 'Ice' if made % 7 == 3 else 'RockDark' if made % 9 == 5 else 'SnowShade'
        G.face([(bx, y + 0.004, bz) for bx, bz in blob], mat, (0, 1, 0))
        made += 1
    # The ramp: a trodden path up the middle, and footholds cut across it.
    x0, x1 = RAMP_X
    z0, z1 = RAMP_Z
    G.face([(x0 + 0.7, 0.004, z0), (x1 - 0.6, 0.004, z0), (x1 - 0.6, HIGH + 0.004, z1), (x0 + 0.7, HIGH + 0.004, z1)], 'SnowShade', (0, 1, 0))
    for k in range(1, 18):
        z = z0 + (z1 - z0) * k / 18
        y = floor_y(x0 + 1, z) + 0.006
        G.face([(x0 + 0.8, y, z - 0.06), (x1 - 0.7, y, z - 0.06), (x1 - 0.7, y, z + 0.06), (x0 + 0.8, y, z + 0.06)], 'Ice', (0, 1, 0))
    # The ramp's open side above the nook, and its snow lip.
    G.face([(x1, 0.0, z0), (x1, 0.0, z1), (x1, HIGH, z1)], 'Rock', (1, 0, 0))
    G.face([(x1, 0.0, z0), (x1, HIGH, z1), (x1 + 0.12, HIGH - 0.12, z1), (x1 + 0.12, -0.1, z0)], 'Snow', (1, 0.4, 0))


def crags():
    """The crags round the west and back: a jagged face leaning back as it rises, snow on every ledge,
    and the mountain's shoulder behind, climbing out of sight."""
    run = RIDGE_FRONT + [(x, z, None) for x, z in CRAG] + RIDGE_BACK
    pts, feet = [], []
    for a, b in zip(run, run[1:]):
        n = max(1, int(math.ceil(math.dist(a[:2], b[:2]) / (1.1 if a[2] is None and b[2] is None else 2.2))))
        for k in range(n):
            t = k / n
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            fa = floor_y(*a[:2]) if a[2] is None else a[2]
            fb = floor_y(*b[:2]) if b[2] is None else b[2]
            pts.append((x, z))
            feet.append(floor_y(x, z) if a[2] is None and b[2] is None else fa + (fb - fa) * t)
    pts.append(run[-1][:2])
    feet.append(run[-1][2])
    normals = []
    for i, p in enumerate(pts):
        q0, q1 = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        d = Vector((q1[0] - q0[0], 0, q1[1] - q0[1])).normalized()
        n = Vector((d.z, 0, -d.x))
        if n.dot(Vector((CRAG_INSIDE[0] - p[0], 0, CRAG_INSIDE[1] - p[1]))) > 0:
            n = -n
        normals.append(n)
    cols = []
    for i, (x, z) in enumerate(pts):
        base = feet[i]
        top = base + rng.uniform(4.5, 8.0)
        ridge = base < -0.01
        prof = [(0.0, CLOUD - 6 if ridge else base - 0.3), (rng.uniform(0.0, 0.3), base + 1.3), (rng.uniform(0.15, 0.7), base + 2.9),
                (rng.uniform(0.4, 1.2), base + 4.6), (rng.uniform(1.0, 2.0), top),
                (rng.uniform(3.0, 4.5), top + rng.uniform(0.3, 1.2)), (rng.uniform(9.0, 13.0), top + rng.uniform(5.0, 11.0))]
        cols.append([Vector((x, 0, z)) + normals[i] * o + Vector((0, y, 0)) for o, y in prof])
    for i in range(len(cols) - 1):
        a, b = cols[i], cols[i + 1]
        facing = -(normals[i] + normals[i + 1])
        for j in range(len(a) - 1):
            for tri in ((a[j], b[j], b[j + 1]), (a[j], b[j + 1], a[j + 1])):
                n = normal_of(tri)
                if n.dot(facing) < 0:
                    n = -n
                mat = 'Snow' if j >= 4 or n.y > 0.45 else ('Rock', 'RockDark', 'RockLight')[rng.randrange(3)]
                G.face(tri, mat, tuple(n))
    # Close each end where it meets the cliff: the crag's profile, down past the clouds.
    for col, along in ((cols[0], Vector((pts[0][0] - pts[1][0], 0, pts[0][1] - pts[1][1]))), (cols[-1], Vector((pts[-1][0] - pts[-2][0], 0, pts[-1][1] - pts[-2][1])))):
        foot = col[0].copy()
        far = col[-1].copy()
        cap = col + [Vector((far.x, CLOUD - 6, far.z)), Vector((foot.x, CLOUD - 6, foot.z))]
        G.face(cap, 'RockDark', tuple(along))


def cliff():
    """The east side: the rim's edge, a snow cornice and the rock dropping away under it into the cloud."""
    cols = []
    for x, z, top in RIM:
        seam = (x, z) == SEAM  # the plateau's and the shelf's cliffs share this column: keep it straight
        local = random.Random(f'{x:.2f},{z:.2f}')
        prof = [(0.0, top), (0.0 if seam else rng.uniform(0.05, 0.15), top - 0.25), (0.0 if seam else rng.uniform(-0.4, 0.0), top - 1.5)]
        prof += [(local.uniform(-1.0, -0.2), -2.5), (local.uniform(-1.6, -0.4), -6.0), (local.uniform(-2.6, -0.6), -10.5), (local.uniform(-3.2, -1.2), CLOUD - 6)]
        cols.append((x, z, prof))
    for (xa, za, pa), (xb, zb, pb) in zip(cols, cols[1:]):
        if (xa, za) == (xb, zb):
            continue
        d = Vector((xb - xa, 0, zb - za)).normalized()
        n = Vector((d.z, 0, -d.x))
        if n.x < 0:
            n = -n
        A = [Vector((xa, y, za)) + n * o for o, y in pa]
        B = [Vector((xb, y, zb)) + n * o for o, y in pb]
        for j in range(len(A) - 1):
            mat = 'Snow' if j == 0 else ('Rock', 'RockDark', 'RockLight', 'Rock')[rng.randrange(4)]
            for tri in ((A[j], B[j], B[j + 1]), (A[j], B[j + 1], A[j + 1])):
                if (tri[0] - tri[1]).length < 1e-6 or (tri[1] - tri[2]).length < 1e-6 or (tri[0] - tri[2]).length < 1e-6:
                    continue
                G.face(tri, mat, tuple(n + Vector((0, 0.2 if j == 0 else 0, 0))))
    # The plateau's face over the nook: rock from the shelf up to a snow cornice, over the whole width.
    z = RAMP_Z[1]
    cols = 28
    xs = [RAMP_X[1] + k * (SEAM[0] - RAMP_X[1]) / (cols - 1) for k in range(cols)]
    face = [[Vector((x, 0.0, z)), Vector((x, 0.9, z - (0 if k in (0, cols - 1) else rng.uniform(0.0, 0.3)))), Vector((x, HIGH - 0.15, z)), Vector((x, HIGH, z + 0.14))] for k, x in enumerate(xs)]
    for a, b in zip(face, face[1:]):
        for j in range(3):
            mat = 'Snow' if j == 2 else ('Rock', 'RockDark', 'RockLight')[rng.randrange(3)]
            for tri in ((a[j], b[j], b[j + 1]), (a[j], b[j + 1], a[j + 1])):
                G.face(tri, mat, (0, 0.3 if j == 2 else 0, 1))
    # The overlook: a tongue of rock out over the drop, its sides tapering back into the cliff.
    ox = OVERLOOK[0][0]
    oz0, oz1 = OVERLOOK[0][1], OVERLOOK[-1][1]  # where it meets the cliff
    om = (oz0 + oz1) / 2
    keel = lambda p, t: Vector((ox + (p[0] - ox) * t, -1.9 * (1 - t) - 0.2 - 1.6 * t * (1 - t), p[1] + (om - p[1]) * (1 - t) * 0.5))
    for i in range(len(OVERLOOK) - 1):
        p, q = OVERLOOK[i], OVERLOOK[i + 1]
        top_p, top_q = Vector((p[0], 0.0, p[1])), Vector((q[0], 0.0, q[1]))
        lip_p, lip_q = Vector((p[0], -0.25, p[1])), Vector((q[0], -0.25, q[1]))
        out = Vector(((p[0] + q[0]) / 2 - ox, 0, (p[1] + q[1]) / 2 - om))
        G.face([top_p, top_q, lip_q, lip_p], 'Snow', tuple(out))
        G.face([lip_p, lip_q, keel(q, 0.25), keel(p, 0.25)], ('Rock', 'RockDark')[i % 2], tuple(out + Vector((0, -0.5, 0))))
    # Its underside, closing onto the cliff.
    under = [keel(p, 0.25) for p in OVERLOOK[1:-1]]
    G.face([Vector((ox, -2.1, oz0)), *under, Vector((ox, -2.1, oz1))], 'RockDark', (0.3, -1, 0))
    G.face([Vector((ox, -0.25, oz0)), keel(OVERLOOK[1], 0.25), Vector((ox, -2.1, oz0))], 'Rock', (0, 0, -1))
    G.face([Vector((ox, -0.25, oz1)), Vector((ox, -2.1, oz1)), keel(OVERLOOK[-2], 0.25)], 'Rock', (0, 0, 1))


def hull():
    """The starship's hull, nose-down in the snow where it skidded to a stop, its tail torn open."""
    (x, z), yaw = HULL
    m = placed(x, HIGH + 0.45, z, yaw, roll=0.1, pitch=-0.04)
    ring = [(-0.7, 1.0), (0.1, 1.25), (0.75, 0.95), (1.0, 0.35), (1.0, -0.35), (0.75, -0.95), (0.1, -1.25), (-0.7, -1.0)]
    stations = [(-3.9, 0.12, 0.12), (-3.3, 0.5, 0.55), (-2.4, 0.85, 0.9), (-1.2, 1.0, 1.0), (1.0, 1.0, 1.0), (2.6, 1.0, 1.0), (3.6, 0.98, 0.98)]
    rings = []
    for si, (lx, sy, sz) in enumerate(stations):
        torn = si == len(stations) - 1
        rings.append([m @ Vector((lx + (rng.uniform(-0.55, 0.25) if torn else 0.0), ly * sy, lz * sz)) for ly, lz in ring])
    axis = (m.to_3x3() @ Vector((1, 0, 0))).normalized()
    centre = m.translation
    for s in range(len(rings) - 1):
        for k in range(8):
            k1 = (k + 1) % 8
            quad = [rings[s][k], rings[s][k1], rings[s + 1][k1], rings[s + 1][k]]
            mid = sum(quad, Vector()) / 4
            out = mid - centre - axis * (mid - centre).dot(axis)
            if s == 1 and k in (1, 2, 3):
                mat = 'Window'
            elif s == 3 and k in (0, 6):
                mat = 'Red'
            elif s == 4 and k in (0, 6):
                mat = 'Hazard'
            elif k == 7:
                mat = 'HullDark'
            else:
                mat = 'Panel' if (s + k) % 3 == 0 else 'Hull'
            if s == len(rings) - 2:
                G.face(quad[:3], mat, tuple(out))
                G.face([quad[0], quad[2], quad[3]], mat, tuple(out))
            else:
                G.face(quad, mat, tuple(out))
    G.face(rings[0], 'HullDark', tuple(-axis))
    # The torn end: dark inside, with live conduits still glowing and cables hanging out.
    end = rings[-1]
    hub = sum(end, Vector()) / 8 - axis * 0.4
    for k in range(8):
        G.face([end[k], end[(k + 1) % 8], hub], 'Black', tuple(axis))
    for lyz, mat in (((0.3, 0.4), 'Glow'), ((-0.2, -0.3), 'GlowOrange'), ((0.5, -0.5), 'Glow')):
        G.tbox(m, (3.1, lyz[0] - 0.12, lyz[1] - 0.12), (3.55, lyz[0] + 0.12, lyz[1] + 0.12), mat)
    for lz in (-0.6, 0.0, 0.7):
        G.strut(m @ Vector((3.3, 0.6, lz)), m @ Vector((4.4, -0.75, lz * 1.3 + 0.2)), 0.05, 'Black')
    # One engine pod left on its back (the other lies on the shelf below), its exhaust still lit.
    a, b = m @ Vector((0.4, 1.05, 0.55)), m @ Vector((2.5, 1.05, 0.55))
    pipe(G, a, b, 0.32, 'HullDark', sides=8, caps=True, cap_mat='Glow')
    G.strut(m @ Vector((0.9, 0.8, 0.55)), m @ Vector((0.9, 1.05, 0.55)), 0.18, 'Hull')
    G.strut(m @ Vector((2.0, 0.8, 0.55)), m @ Vector((2.0, 1.05, 0.55)), 0.18, 'Hull')
    # The far wing, snapped upright against the crag; the near one torn off at the root.
    hinge = m @ Matrix.Translation((0.0, 0.2, -1.15)) @ Matrix.Rotation(-1.1, 4, 'X')
    G.tbox(hinge, (-0.6, -0.06, -3.0), (2.0, 0.06, 0.0), 'Hull')
    G.tbox(hinge, (1.6, -0.065, -3.0), (2.0, 0.065, -0.2), 'Hazard', skip=('-y',))
    G.tbox(hinge, (-0.3, 0.06, -2.9), (0.2, 0.25, -2.4), 'Beacon')
    G.tbox(m, (-0.5, 0.05, 1.1), (1.4, 0.2, 1.65), 'HullDark')
    for k in range(4):
        lx = -0.4 + k * 0.5
        G.tbox(m, (lx, 0.0, 1.6), (lx + 0.25, 0.25, 1.75 + rng.uniform(0.0, 0.3)), 'Black')
    # A mast on its back, bent.
    G.strut(m @ Vector((-1.5, 1.0, 0.0)), m @ Vector((-1.2, 2.3, -0.2)), 0.06, 'HullDark')
    G.strut(m @ Vector((-1.2, 2.3, -0.2)), m @ Vector((-0.4, 2.7, -0.6)), 0.05, 'HullDark')
    # The skid: a scorched furrow from the cliff's edge, where it came over, to the torn tail.
    tail = m @ Vector((3.6, 0, 0))
    G.face([(SEAM[0] - 0.05, HIGH + 0.006, -8.4 * S), (SEAM[0] - 0.05, HIGH + 0.006, -6.6 * S), (tail.x + 0.2, HIGH + 0.006, tail.z + 1.0), (tail.x - 0.4, HIGH + 0.006, tail.z - 0.6)], 'Scorch', (0, 1, 0))
    for k in range(18):
        px, pz = rng.uniform(tail.x + 0.5, SEAM[0] - 0.4), rng.uniform(-9.2 * S, -6.2 * S)
        r = rng.uniform(0.15, 0.4)
        G.face([(px + r * math.cos(angle(i, 5)), HIGH + 0.008, pz + r * math.sin(angle(i, 5))) for i in range(5)], 'Scorch', (0, 1, 0))


def nacelle():
    (x, z), yaw = NACELLE
    m = placed(x, 0.55, z, yaw, roll=0.12)
    a, b = m @ Vector((0, 0, -1.4)), m @ Vector((0, 0, 1.4))
    pipe(G, a, b, 0.72, 'Hull', sides=10, r1=0.62)
    G.face([a + (m.to_3x3() @ Vector((math.cos(angle(k, 10)), math.sin(angle(k, 10)), 0))) * 0.72 for k in range(10)], 'Black', tuple(a - b))
    pipe(G, a - (b - a).normalized() * 0.01, a + (b - a).normalized() * 0.15, 0.5, 'Glow', sides=10)
    G.face([b + (m.to_3x3() @ Vector((math.cos(angle(k, 10)), math.sin(angle(k, 10)), 0))) * 0.62 for k in range(10)], 'HullDark', tuple(b - a))
    for lz in (-0.7, 0.6):
        pipe(G, m @ Vector((0, 0, lz)), m @ Vector((0, 0, lz + 0.18)), 0.75, 'Hazard', sides=10)
    for k, ang in enumerate((0.6, 2.4, 4.2)):
        f = m @ Matrix.Rotation(ang, 4, 'Z')
        G.tbox(f, (0.55, -0.04, 0.2), (1.05, 0.04, 1.3), 'HullDark')
    # The pylon that held it, snapped.
    G.tbox(m, (-0.18, 0.55, -0.6), (0.18, 0.95, 0.5), 'Panel')
    G.strut(m @ Vector((0, 0.9, 0.3)), m @ Vector((0.15, 1.25, 0.6)), 0.12, 'Black')
    # Snow drifted against its side.
    G.face([m @ Vector((-0.72, -0.4, -1.3)), m @ Vector((-0.72, -0.4, 1.3)), m @ Vector((-1.3, -0.62, 1.2)), m @ Vector((-1.3, -0.62, -1.2))], 'Snow', (-1, 1, 0))


def containers():
    (x, z), yaw = CONTAINERS
    for k, (dy, dyaw, dx) in enumerate(((0.0, 0.0, 0.0), (1.25, -0.22, 0.15))):
        m = placed(x + dx, dy, z, yaw + dyaw, roll=0.0 if k == 0 else 0.03)
        G.tbox(m, (-1.15, 0.0, -0.58), (1.15, 1.22, 0.58), 'Red' if k == 0 else 'Panel', skip=('-y',) if k == 0 else ())
        for i in range(7):
            lx = -1.05 + i * 0.35
            G.tbox(m, (lx, 0.05, 0.58), (lx + 0.09, 1.17, 0.62), 'HullDark', skip=('-y', '+y'))
            G.tbox(m, (lx, 0.05, -0.62), (lx + 0.09, 1.17, -0.58), 'HullDark', skip=('-y', '+y'))
        G.tbox(m, (-1.16, 0.9, -0.59), (1.16, 1.02, 0.59), 'Hazard', skip=('-y', '+y'))
        G.tbox(m, (1.15, 0.3, -0.12), (1.18, 0.8, 0.12), 'Glow' if k == 0 else 'GlowOrange')
    # Snow on the top one's lid.
    m = placed(x + 0.15, 2.47, z, yaw - 0.22, roll=0.03)
    G.tbox(m, (-1.0, 0.0, -0.5), (1.1, 0.06, 0.45), 'Snow', skip=('-y',))


def crates():
    for x, z, h, yaw in CRATES:
        m = placed(x, floor_y(x, z), z, yaw)
        G.tbox(m, (-h, 0.0, -h), (h, 2 * h, h), 'HullDark', skip=('-y',))
        G.tbox(m, (-h - 0.01, 0.6 * h, -h - 0.01), (h + 0.01, 0.8 * h, h + 0.01), 'Hazard', skip=('-y', '+y'))
        G.tbox(m, (-h * 0.8, 2 * h, -h * 0.8), (h * 0.7, 2 * h + 0.05, h * 0.8), 'Snow', skip=('-y',))
        G.tbox(m, (h, 1.2 * h, -0.25 * h), (h + 0.02, 1.6 * h, 0.25 * h), 'Glow')


def dish():
    """Knocked off its mount, it lies face-up and a little tilted, its rim at about DISH_RIM; its feed arm buckled into the bowl."""
    x, z = DISH
    pipe(G, (x, -0.2, z), (x, 0.8, z), 0.16, 'HullDark', sides=6)
    G.box((x - 0.4, 0.0, z - 0.3), (x + 0.4, 0.25, z + 0.3), 'Panel', skip=('-y',))
    n, r, depth, tilt = 12, 1.05, 0.3, 0.12
    m = placed(x, DISH_RIM - depth * math.cos(tilt), z, 2.4) @ Matrix.Rotation(tilt - math.pi / 2, 4, 'X')
    rim = [m @ Vector((r * math.cos(angle(k, n)), r * math.sin(angle(k, n)), depth)) for k in range(n)]
    apex = m @ Vector((0, 0, 0))
    for k in range(n):
        G.both([apex, rim[k], rim[(k + 1) % n]], 'Panel', 'HullDark')
    feed = m @ Vector((0.55, -0.35, 0.4))
    for k in (0, 4, 8):
        G.strut(rim[k], feed, 0.04, 'HullDark')
    G.box(tuple(feed - Vector((0.08, 0.08, 0.08))), tuple(feed + Vector((0.08, 0.08, 0.08))), 'Beacon')
    # Bent panels torn off the dish, half buried beside it.
    for dx, dz, yaw in ((-1.1, 0.4, 0.4), (0.9, -0.9, 1.9)):
        G.tbox(placed(x + dx, 0.05, z + dz, yaw, roll=0.5), (-0.35, -0.02, -0.25), (0.35, 0.02, 0.25), 'Panel')


def pylon():
    x, z = PYLON
    top = Vector((x + 0.15, HIGH + 3.4, z - 0.1))
    G.strut((x, HIGH - 0.2, z), top, 0.22, 'HullDark')
    G.strut((x + 0.04, HIGH + 1.2, z - 0.03), (x + 0.07, HIGH + 1.5, z - 0.05), 0.25, 'Hazard')
    G.box(tuple(top - Vector((0.14, 0.0, 0.14))), tuple(top + Vector((0.14, 0.32, 0.14))), 'Beacon')
    G.box(tuple(top + Vector((-0.17, 0.32, -0.17))), tuple(top + Vector((0.17, 0.38, 0.17))), 'Black')
    # Guy lines to stakes in the snow.
    for dx, dz in ((1.0, 0.6), (-1.1, 0.5), (0.1, -1.2)):
        G.strut(top - Vector((0, 0.8, 0)), (x + dx, HIGH, z + dz), 0.03, 'Black')
        G.box((x + dx - 0.04, HIGH, z + dz - 0.04), (x + dx + 0.04, HIGH + 0.15, z + dz + 0.04), 'Hazard', skip=('-y',))
    G.box((x - 0.35, HIGH, z - 0.35), (x + 0.35, HIGH + 0.18, z + 0.35), 'Panel', skip=('-y',))


def plates():
    """Hull plates thrown from the wreck, sticking up out of the snow along the crags and the summit."""
    spots = [(-6.2, -0.3), (-6.3, 5.8), (-1.0, 6.5), (1.9, 6.4), (4.6, 6.3), (-5.6, -6.2), (-3.5, -6.0), (-0.3, -7.4),
             (2.9, -7.6), (4.7, -9.6), (-6.2, -11.0), (0.6, -11.5), (4.8, -0.6), (5.3, 3.6), (-2.0, -4.6),
             (-3.6, 2.0), (1.2, 4.0), (3.4, 1.5), (-0.8, 0.8), (-4.8, -9.0), (0.5, -9.0), (2.5, -10.2), (-5.4, -3.0)]
    for k, (x, z) in enumerate(scaled(spots)):
        y = floor_y(x, z)
        m = placed(x, y + 0.04, z, rng.uniform(0, math.pi), roll=rng.uniform(0.4, 0.9), pitch=rng.uniform(-0.2, 0.2))
        w, d = rng.uniform(0.25, 0.5), rng.uniform(0.15, 0.3)
        G.tbox(m, (-w, -0.02, -d), (w, 0.02, d), ('Hull', 'Panel', 'HullDark', 'Hazard')[k % 4])


def far_peaks():
    """Other summits round the horizon, rising from the cloud."""
    peaks = [(0.3, 125, 22, 30), (0.9, 150, 34, 40), (1.6, 110, 14, 22), (2.2, 140, 28, 36), (2.8, 170, 40, 48), (3.4, 120, 18, 26),
             (4.0, 150, 30, 38), (4.6, 105, 12, 20), (5.1, 160, 36, 44), (5.7, 130, 24, 30), (6.1, 175, 30, 50)]
    for a, dist, h, r in peaks:
        cx, cz = dist * math.cos(a), dist * math.sin(a)
        n = 7
        base = [(cx + r * rng.uniform(0.8, 1.15) * math.cos(angle(k, n)), CLOUD - 2, cz + r * rng.uniform(0.8, 1.15) * math.sin(angle(k, n))) for k in range(n)]
        snow_y = CLOUD + h * rng.uniform(0.45, 0.6)
        mid = [(cx + (bx - cx) * 0.45 * rng.uniform(0.85, 1.15), snow_y, cz + (bz - cz) * 0.45 * rng.uniform(0.85, 1.15)) for bx, _, bz in base]
        tip = (cx + rng.uniform(-r * 0.15, r * 0.15), CLOUD + h, cz + rng.uniform(-r * 0.15, r * 0.15))
        for k in range(n):
            k1 = (k + 1) % n
            out = (math.cos(angle(k, n)), 0.4, math.sin(angle(k, n)))
            SKY.face([base[k], base[k1], mid[k1]], 'RockDark' if k % 2 else 'Rock', out)
            SKY.face([base[k], mid[k1], mid[k]], 'Rock', out)
            SKY.face([mid[k], mid[k1], tip], 'Snow' if k % 3 else 'SnowShade', out)


def clouds():
    n = 40
    fan = [(SKY_R * math.cos(angle(k, n)), CLOUD, SKY_R * math.sin(angle(k, n))) for k in range(n)]
    for k in range(n):
        SKY.face([(0, CLOUD, 0), fan[k], fan[(k + 1) % n]], 'Cloud', (0, 1, 0))
    # Billows on the cloud sea.
    made = 0
    while made < 46:
        r = rng.uniform(12.0 * S, 130.0)
        a = rng.uniform(0, 2 * math.pi)
        cx, cz = r * math.cos(a), r * math.sin(a)
        size = rng.uniform(2.5, 8.0)
        n = 7
        base = [(cx + size * math.cos(angle(k, n)), CLOUD - 0.3, cz + size * 0.7 * math.sin(angle(k, n))) for k in range(n)]
        mid = [(cx + size * 0.6 * math.cos(angle(k, n) + 0.3), CLOUD + size * 0.35, cz + size * 0.42 * math.sin(angle(k, n) + 0.3)) for k in range(n)]
        top = (cx, CLOUD + size * 0.5, cz)
        for k in range(n):
            k1 = (k + 1) % n
            out = (math.cos(angle(k, n)), 0.6, math.sin(angle(k, n)))
            SKY.face([base[k], base[k1], mid[k1], mid[k]], 'CloudShade' if k < 3 else 'Cloud', out)
            SKY.face([mid[k], mid[k1], top], 'Cloud', (0, 1, 0))
        made += 1
    # The valley floor far below, for whoever goes over the edge.
    n = 12
    floor = [(60 * S * math.cos(angle(k, n)), VALLEY, 60 * S * math.sin(angle(k, n))) for k in range(n)]
    SKY.face(floor, 'Valley', (0, 1, 0))


def build_look():
    floors()
    crags()
    cliff()
    hull()
    nacelle()
    containers()
    crates()
    dish()
    pylon()
    plates()
    far_peaks()
    clouds()


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
    """A sun for renders in Blender; the game lights the summit itself (src/render/stage.ts)."""
    data = bpy.data.lights.new('SUN_summit', 'SUN')
    data.energy = 3.0
    obj = bpy.data.objects.new('SUN_summit', data)
    obj.rotation_euler = (math.radians(55), 0, math.radians(120))
    coll.objects.link(obj)
    return obj


def collision(coll):
    for id, pts in WALK:
        me = bpy.data.meshes.new(f'WALK_{id}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'WALK_{id}', me)
        if id == 'valley':
            obj['abyss'] = 1  # a fall to it kills, a Jump or not (a Death by Fall)
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
            if o.get('abyss'):
                w['abyss'] = True
            walk.append(w)
        elif o.name.startswith('WALL_'):
            vs = [to_game(o.matrix_world @ v.co) for v in o.data.vertices]
            walls.append({'id': o.name, 'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        elif o.name.startswith('SPAWN_'):
            spawns.append({'team': int(o['team']), 'slot': int(o['slot']), 'position': to_game(o.matrix_world.translation), 'facing': round(float(o['facing']), 6)})
    return {'name': 'summit', 'walk': walk, 'walls': walls, 'spawns': spawns}


def write_json(path, data):
    """Compact enough to read: one surface, wall or spawn per line."""
    def surface(w):
        abyss = ', "abyss": true' if w.get('abyss') else ''
        return f'    {{ "id": {json.dumps(w["id"])}{abyss}, "points": {json.dumps(w["points"])} }}'
    lines = ['{', '  "name": "summit",', '  "walk": [']
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
    summit = mesh_object(NAME, G, look, mats)
    sky = mesh_object(f'{NAME}.Sky', SKY, look, mats)
    sun(look)
    collision(helpers)
    helpers.hide_render = True
    triangles = sum(len(p.vertices) - 2 for o in (summit, sky) for p in o.data.polygons)
    report = {'triangles': triangles, 'faces_dropped': len(G.faces) + len(SKY.faces) - sum(len(o.data.polygons) for o in (summit, sky)),
              'walk': len(WALK), 'walls': len(WALLS), 'spawns': len(SPAWNS), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (summit, sky):
            o.select_set(True)
        bpy.context.view_layer.objects.active = summit
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False)
        write_json(OUT_JSON, export_json(helpers))
        bpy.data.libraries.write(OUT_BLEND, {look, helpers}, fake_user=True)
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
print('SUMMIT_RESULT', json.dumps(result))
