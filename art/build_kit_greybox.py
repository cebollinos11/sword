"""
Builds the greybox Kit in Blender (docs/plans/generated-arenas.md, Stage 4): the
Pieces a Generated Arena is assembled from, each with its look and its own
collision. This script is the source of truth for both (ADR 0006, ADR 0014):
re-run it to change the Kit.

Run inside Blender:
    exec(open(r"C:/Repos/sword/art/build_kit_greybox.py").read(), {"__file__": r"C:/Repos/sword/art/build_kit_greybox.py", "SAVE": False})

With SAVE = True it writes art/kit_greybox.blend, public/models/kits/greybox.glb
(the look) and data/kits/greybox.json (the Kit, read back from the helpers):
  - PIECE_<id>: an empty, the root of one Piece, holding its look (child meshes)
    and, as properties, its footprint (cols, rows), whether it is solid, and its
    connectors and skirts (JSON).
  - WALK_<id>_<n> (Collision): one planar convex face, a Walk Surface of Piece <id>;
    `tile` marks a whole flat cell the assembler may merge.
  - WALL_<id>_<n> (Collision): one vertical quad, a Wall of Piece <id>, solid
    between its bottom and top heights.
  - DOOR_<id>_0 (Collision): one flat convex face on the ground, the door zone of
    Piece <id> (the door alone: docs/plans/dungeon.md, Doors).
  - TRIM_support: a column one cell wide and one level tall, its top at y 0, which
    the renderer stacks under every cell of a solid Piece above level 0.
Helpers are in cell-local coordinates relative to their Piece's root: x and z run
from 0 to cols·CELL and rows·CELL, y from the level the Piece stands on. The
roots stand side by side along x so the Kit can be looked over; the renderer
places each copy by whole cells and quarter turns, ignoring where it stands here.

Everything is authored in game coordinates (x east, y up, z) and placed in
Blender as (x, -z, y), which the glTF export (export_yup) turns back.

The numbers are the hand-written TypeScript greybox Kit's: a 3 m cell, floors at
0, 3 and 6 m, 0.8 m crates, 1 m rails, 4 m pillars; the door (added with the
Dungeon's Hall Arenas) is a floor walled along its outer side by a 4 m Wall with
a doorway drawn in it, nobody walks through. The look is plain greys, tinted per
Piece kind; a dark border round each floor tile shows the grid.
"""
import json
import os

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE = globals().get('SAVE', False)
KIT = 'greybox'
NAME = 'Kit_greybox'
OUT_BLEND = os.path.join(REPO, 'art', 'kit_greybox.blend')
OUT_GLB = os.path.join(REPO, 'public', 'models', 'kits', 'greybox.glb')
OUT_JSON = os.path.join(REPO, 'data', 'kits', 'greybox.json')

CELL = 3.0
LEVEL = 3.0
MAX_LEVELS = 3
CRATE = 0.8
RAIL = 1.0
PILLAR = 4.0
DOOR_WALL = 4.0  # the door's Wall, along its -z side
DOORWAY = (0.75, 2.25, 2.6)  # the doorway drawn in it: from x, to x, how tall
DOOR_THICKNESS = 0.3  # the door's Wall drawn this thick, centred on it
SLAB = 0.4  # how thick a floor tile is drawn, below its Walk Surface
BORDER = 0.05  # the dark border round a floor tile's top
RAIL_THICKNESS = 0.12  # drawn centred on the rail's Wall
SUPPORT_INSET = 0.02  # a support column stands this far inside its cell, so its faces never meet a tile's
SPACING = 4 * CELL  # how far apart the Piece roots stand in Blender

# name: sRGB colour
MATERIALS = {
    'Top': 0xa4a8ae,
    'Edge': 0x5a5d62,
    'Side': 0x7c8087,
    'Ramp': 0xb3b0a6,
    'Bridge': 0x9aa3ad,
    'Crate': 0x8d9096,
    'CrateTop': 0xb9bcc1,
    'Pillar': 0x8a8e95,
    'Rail': 0x6e7279,
    'Support': 0x5f6268,
    'Door': 0x7a7468,
    'Doorway': 0x2a2724,
}
MAT_INDEX = {n: i for i, n in enumerate(MATERIALS)}

# ---------------------------------------------------------------- the Kit's numbers (game coordinates, cell-local)


def rect(x0, z0, x1, z1, y=0.0):
    return [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]


def box_walls(x0, z0, x1, z1, top):
    return [((x0, z0), (x1, z0), 0.0, top), ((x1, z0), (x1, z1), 0.0, top), ((x1, z1), (x0, z1), 0.0, top), ((x0, z1), (x0, z0), 0.0, top)]


def ring(lo, hi):
    """The floor of a cell round a box from lo to hi (both axes): four rectangles, so the navmesh goes round it."""
    return [(rect(0, 0, CELL, lo), False), (rect(hi, lo, CELL, hi), False), (rect(0, hi, CELL, CELL), False), (rect(0, lo, lo, hi), False)]


ALL_SIDES = [{'col': 0, 'row': 0, 'side': s, 'y': 0} for s in range(4)]
LEVEL_SKIRTS = [{'col': 0, 'row': 0, 'side': s, 'min': 0, 'max': 0} for s in range(4)]
TILE = (rect(0, 0, CELL, CELL), True)

# id: cols, rows, solid, walk [(points, tile)], walls [(a, b, bottom, top)], connectors, skirts (and the door's zone [(x, z)])
PIECES = {
    'floor': dict(cols=1, rows=1, solid=True, walk=[TILE], walls=[], connectors=ALL_SIDES, skirts=LEVEL_SKIRTS),
    # Rises one level along +z over two cells.
    'ramp': dict(
        cols=1, rows=2, solid=True,
        walk=[([(0, 0, 0), (CELL, 0, 0), (CELL, LEVEL, 2 * CELL), (0, LEVEL, 2 * CELL)], False)],
        walls=[],
        connectors=[{'col': 0, 'row': 0, 'side': 0, 'y': 0}, {'col': 0, 'row': 1, 'side': 2, 'y': LEVEL}],
        skirts=[
            {'col': 0, 'row': 0, 'side': 0, 'min': 0, 'max': 0},
            {'col': 0, 'row': 0, 'side': 1, 'min': 0, 'max': LEVEL / 2},
            {'col': 0, 'row': 0, 'side': 3, 'min': 0, 'max': LEVEL / 2},
            {'col': 0, 'row': 1, 'side': 1, 'min': LEVEL / 2, 'max': LEVEL},
            {'col': 0, 'row': 1, 'side': 3, 'min': LEVEL / 2, 'max': LEVEL},
            {'col': 0, 'row': 1, 'side': 2, 'min': LEVEL, 'max': LEVEL},
        ],
    ),
    # A 1.5 m crate in the middle of the cell, with a lid to Jump onto.
    'crate': dict(cols=1, rows=1, solid=True, walk=ring(0.75, 2.25) + [(rect(0.75, 0.75, 2.25, 2.25, CRATE), False)], walls=box_walls(0.75, 0.75, 2.25, 2.25, CRATE), connectors=ALL_SIDES, skirts=LEVEL_SKIRTS),
    'pillar': dict(cols=1, rows=1, solid=True, walk=ring(1, 2), walls=box_walls(1, 1, 2, 2, PILLAR), connectors=ALL_SIDES, skirts=LEVEL_SKIRTS),
    # A floor with a low Wall along its -z side.
    'rail': dict(cols=1, rows=1, solid=True, walk=[TILE], walls=[((0, 0), (CELL, 0), 0.0, RAIL)], connectors=[c for c in ALL_SIDES if c['side'] != 0], skirts=LEVEL_SKIRTS),
    # A 2 m wide floor along z, with nothing either side of it.
    'bridge': dict(cols=1, rows=1, solid=False, walk=[(rect(0.5, 0, 2.5, CELL), False)], walls=[], connectors=[{'col': 0, 'row': 0, 'side': 0, 'y': 0}, {'col': 0, 'row': 0, 'side': 2, 'y': 0}], skirts=[]),
    'void': dict(cols=1, rows=1, solid=False, walk=[], walls=[], connectors=[], skirts=[]),
    # An edge cell's floor with a tall Wall along its -z side (the footprint's edge), a doorway drawn in it, and a
    # door zone on the ground before it. Placed on an edge cell turned so -z faces out.
    'door': dict(
        cols=1, rows=1, solid=True, walk=[TILE], walls=[((0, 0), (CELL, 0), 0.0, DOOR_WALL)],
        connectors=[c for c in ALL_SIDES if c['side'] != 0], skirts=LEVEL_SKIRTS,
        zone=[(0.25, 0), (2.75, 0), (2.75, 2.5), (0.25, 2.5)],
    ),
}

# ---------------------------------------------------------------- the look (game coordinates, cell-local)


class Geo:
    """Faces with a material each; vertices are not shared, so shading is flat."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def face(self, pts, mat):
        base = len(self.verts)
        self.verts += [tuple(p) for p in pts]
        self.faces.append((list(range(base, base + len(pts))), MAT_INDEX[mat]))

    def box(self, lo, hi, mat, top=None, skip=()):
        """An axis-aligned box; `top` the material of its top face (default `mat`); `skip` faces by name (+y, -y, ...)."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        faces = {
            '+y': ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], top or mat),
            '-y': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], mat),
            '-z': ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], mat),
            '+z': ([(x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1)], mat),
            '-x': ([(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)], mat),
            '+x': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], mat),
        }
        for k, (pts, m) in faces.items():
            if k not in skip:
                self.face(pts, m)


def tile_slab(g, x0, z0, x1, z1, top='Top'):
    """A floor slab whose top is the Walk Surface (y 0), with a dark border round the top so the grid shows."""
    g.box((x0, -SLAB, z0), (x1, 0, z1), 'Side', skip=('+y',))
    b = BORDER
    g.face([(x0 + b, 0, z0 + b), (x0 + b, 0, z1 - b), (x1 - b, 0, z1 - b), (x1 - b, 0, z0 + b)], top)
    g.face([(x0, 0, z0), (x0, 0, z1), (x0 + b, 0, z1 - b), (x0 + b, 0, z0 + b)], 'Edge')
    g.face([(x0, 0, z1), (x1, 0, z1), (x1 - b, 0, z1 - b), (x0 + b, 0, z1 - b)], 'Edge')
    g.face([(x1, 0, z1), (x1, 0, z0), (x1 - b, 0, z0 + b), (x1 - b, 0, z1 - b)], 'Edge')
    g.face([(x1, 0, z0), (x0, 0, z0), (x0 + b, 0, z0 + b), (x1 - b, 0, z0 + b)], 'Edge')


def look(id):
    g = Geo()
    if id in ('floor', 'crate', 'pillar', 'rail', 'door'):
        tile_slab(g, 0, 0, CELL, CELL)
    if id == 'crate':
        g.box((0.75, 0, 0.75), (2.25, CRATE, 2.25), 'Crate', top='CrateTop', skip=('-y',))
    elif id == 'pillar':
        g.box((1, 0, 1), (2, PILLAR, 2), 'Pillar', skip=('-y',))
    elif id == 'rail':
        h = RAIL_THICKNESS / 2
        g.box((0, 0, -h), (CELL, RAIL, h), 'Rail', skip=('-y',))
    elif id == 'door':
        h = DOOR_THICKNESS / 2
        x0, x1, tall = DOORWAY
        # Two jambs and a lintel round the doorway, and the doorway itself dark, at the Wall's outer face.
        g.box((0, 0, -h), (x0, DOOR_WALL, h), 'Door', skip=('-y',))
        g.box((x1, 0, -h), (CELL, DOOR_WALL, h), 'Door', skip=('-y',))
        g.box((x0, tall, -h), (x1, DOOR_WALL, h), 'Door', skip=('-y',))
        g.face([(x0, 0, -h + 0.01), (x0, tall, -h + 0.01), (x1, tall, -h + 0.01), (x1, 0, -h + 0.01)], 'Doorway')
        g.face([(x1, 0, -h + 0.01), (x1, tall, -h + 0.01), (x0, tall, -h + 0.01), (x0, 0, -h + 0.01)], 'Doorway')
    elif id == 'bridge':
        tile_slab(g, 0.5, 0, 2.5, CELL, top='Bridge')
    elif id == 'ramp':
        d = 2 * CELL
        # The slope (the Walk Surface), a solid wedge under it down to the slab's bottom.
        g.face([(0, 0, 0), (0, LEVEL, d), (CELL, LEVEL, d), (CELL, 0, 0)], 'Ramp')
        g.face([(0, -SLAB, 0), (0, 0, 0), (CELL, 0, 0), (CELL, -SLAB, 0)], 'Side')
        g.face([(CELL, -SLAB, d), (CELL, LEVEL, d), (0, LEVEL, d), (0, -SLAB, d)], 'Side')
        g.face([(0, -SLAB, d), (0, LEVEL, d), (0, 0, 0), (0, -SLAB, 0)], 'Side')
        g.face([(CELL, -SLAB, 0), (CELL, 0, 0), (CELL, LEVEL, d), (CELL, -SLAB, d)], 'Side')
        g.face([(0, -SLAB, 0), (CELL, -SLAB, 0), (CELL, -SLAB, d), (0, -SLAB, d)], 'Side')
    return g


def support():
    g = Geo()
    i = SUPPORT_INSET
    g.box((i, -LEVEL, i), (CELL - i, 0, CELL - i), 'Support', skip=('+y', '-y'))
    return g

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
    for name, colour in MATERIALS.items():
        m = bpy.data.materials.get(f'{NAME}_{name}') or bpy.data.materials.new(f'{NAME}_{name}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgba = srgb(colour)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.9
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


def mesh_object(name, geo, coll, mats, parent=None):
    bm = bmesh.new()
    verts = [bm.verts.new(to_blender(p)) for p in geo.verts]
    used = sorted({mi for _, mi in geo.faces})
    slot = {mi: k for k, mi in enumerate(used)}
    for idx, mi in geo.faces:
        f = bm.faces.new([verts[i] for i in idx])
        f.material_index = slot[mi]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mi in used:
        me.materials.append(mats[mi])
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def collision(coll, id, piece, origin):
    for n, (pts, tile) in enumerate(piece['walk']):
        me = bpy.data.meshes.new(f'WALK_{id}_{n}')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'WALK_{id}_{n}', me)
        obj.location = origin
        obj['piece'] = id
        obj['index'] = n
        obj['tile'] = tile
        coll.objects.link(obj)
    for n, (a, b, bottom, top) in enumerate(piece['walls']):
        q = [(a[0], bottom, a[1]), (b[0], bottom, b[1]), (b[0], top, b[1]), (a[0], top, a[1])]
        me = bpy.data.meshes.new(f'WALL_{id}_{n}')
        me.from_pydata([tuple(to_blender(p)) for p in q], [], [[0, 1, 2, 3]])
        obj = bpy.data.objects.new(f'WALL_{id}_{n}', me)
        obj.location = origin
        obj['piece'] = id
        obj['index'] = n
        coll.objects.link(obj)
    if 'zone' in piece:
        pts = [(x, 0.0, z) for x, z in piece['zone']]
        me = bpy.data.meshes.new(f'DOOR_{id}_0')
        me.from_pydata([tuple(to_blender(p)) for p in pts], [], [list(range(len(pts)))])
        obj = bpy.data.objects.new(f'DOOR_{id}_0', me)
        obj.location = origin
        obj['piece'] = id
        obj['index'] = 0
        coll.objects.link(obj)


def num(x):
    """A coordinate as the Kit file writes it: rounded to 0.1 mm, whole numbers without a point."""
    x = round(x, 4) + 0.0
    return int(x) if x == int(x) else x


def export_kit(roots, helpers):
    """The Kit, read back from the Piece roots and their Collision helpers (cell-local: relative to each root)."""
    pieces = {}
    for id, root in roots.items():
        to_local = root.matrix_world.inverted()

        def local(o, co):
            v = to_local @ (o.matrix_world @ co)
            return [num(v.x), num(v.z), num(-v.y)]

        def own(prefix):
            objs = [o for o in helpers.objects if o.name.startswith(prefix) and o.get('piece') == id]
            return sorted(objs, key=lambda o: int(o['index']))

        walk = []
        for o in own('WALK_'):
            surface = {'points': [local(o, o.data.vertices[i].co) for i in o.data.polygons[0].vertices]}
            if o['tile']:
                surface['tile'] = True
            walk.append(surface)
        walls = []
        for o in own('WALL_'):
            vs = [local(o, v.co) for v in o.data.vertices]
            walls.append({'a': [vs[0][0], vs[0][2]], 'b': [vs[1][0], vs[1][2]], 'bottom': vs[0][1], 'top': vs[2][1]})
        pieces[id] = {
            'id': id,
            'cols': int(root['cols']),
            'rows': int(root['rows']),
            'walk': walk,
            'walls': walls,
            'connectors': [{k: num(v) for k, v in c.items()} for c in json.loads(root['connectors'])],
            'skirts': [{k: num(v) for k, v in s.items()} for s in json.loads(root['skirts'])],
            'solid': bool(root['solid']),
        }
        for o in own('DOOR_'):
            pieces[id]['zone'] = [[p[0], p[2]] for p in (local(o, o.data.vertices[i].co) for i in o.data.polygons[0].vertices)]
    return {'name': KIT, 'cell': num(CELL), 'levelHeight': num(LEVEL), 'maxLevels': MAX_LEVELS, 'pieces': pieces}


def write_json(path, kit):
    """Compact enough to read: one Walk Surface, Wall, connector or skirt per line (a door's zone on one line)."""
    d = lambda v: json.dumps(v, separators=(', ', ': '))
    lines = ['{', f'  "name": {d(kit["name"])},', f'  "cell": {kit["cell"]},', f'  "levelHeight": {kit["levelHeight"]},', f'  "maxLevels": {kit["maxLevels"]},', '  "pieces": {']
    ids = list(kit['pieces'])
    for k, id in enumerate(ids):
        p = kit['pieces'][id]
        lines.append(f'    {d(id)}: {{')
        lines.append(f'      "id": {d(id)}, "cols": {p["cols"]}, "rows": {p["rows"]}, "solid": {d(p["solid"])},')
        for key in ('walk', 'walls', 'connectors', 'skirts'):
            items = p[key]
            last = key == 'skirts' and 'zone' not in p
            if not items:
                lines.append(f'      "{key}": []' + ('' if last else ','))
                continue
            lines.append(f'      "{key}": [')
            lines += [f'        {d(v)}' + (',' if i < len(items) - 1 else '') for i, v in enumerate(items)]
            lines.append('      ]' + ('' if last else ','))
        if 'zone' in p:
            lines.append(f'      "zone": {d(p["zone"])}')
        lines.append('    }' + (',' if k < len(ids) - 1 else ''))
    lines += ['  }', '}', '']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        f.write('\n'.join(lines))


def build():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    mats = materials()
    looks = collection(NAME)
    helpers = collection('Collision')
    # Show only the Kit, so preview renders see it alone.
    for c in bpy.context.scene.collection.children:
        c.hide_render = c.hide_viewport = c.name not in (NAME, 'Collision')
    roots = {}
    exported = []
    for i, (id, piece) in enumerate(PIECES.items()):
        origin = to_blender((i * SPACING, 0, 0))
        root = bpy.data.objects.new(f'PIECE_{id}', None)
        root.empty_display_type = 'PLAIN_AXES'
        root.location = origin
        root['cols'] = piece['cols']
        root['rows'] = piece['rows']
        root['solid'] = piece['solid']
        root['connectors'] = json.dumps(piece['connectors'])
        root['skirts'] = json.dumps(piece['skirts'])
        looks.objects.link(root)
        roots[id] = root
        exported.append(root)
        g = look(id)
        if g.faces:
            exported.append(mesh_object(f'PIECE_{id}.look', g, looks, mats, parent=root))
        collision(helpers, id, piece, origin)
    trim = bpy.data.objects.new('TRIM_support', None)
    trim.empty_display_type = 'PLAIN_AXES'
    trim.location = to_blender((len(PIECES) * SPACING, 0, 0))
    looks.objects.link(trim)
    exported += [trim, mesh_object('TRIM_support.look', support(), looks, mats, parent=trim)]
    helpers.hide_render = True
    bpy.context.view_layer.update()
    kit = export_kit(roots, helpers)
    report = {'pieces': len(roots), 'walk': sum(len(p['walk']) for p in kit['pieces'].values()), 'walls': sum(len(p['walls']) for p in kit['pieces'].values()), 'saved': bool(SAVE)}
    if SAVE:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in exported:
            o.select_set(True)
        bpy.context.view_layer.objects.active = exported[0]
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_lights=False, export_animations=False, export_extras=False)
        write_json(OUT_JSON, kit)
        bpy.data.libraries.write(OUT_BLEND, {looks, helpers}, fake_user=True)
        report['glb_bytes'] = os.path.getsize(OUT_GLB)
    return report


result = build()
