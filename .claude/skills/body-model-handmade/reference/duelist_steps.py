"""
Worked example: the Blender calls that built the Duelist (art/duelist.blend),
cleaned up and in order. This is a record to copy shapes and numbers from,
not a generator: the source of truth for a hand-built Body is its .blend.
Each STEP block was one `execute_blender_code` call, followed by a render.

Axes as in every Body: faces -Y, left on +X, metres, T-pose (see SKILL.md).
"""

# ============================================================== STEP 1: volumes
# Smooth lofted profiles for torso and limbs (Catmull-Rom between control
# rings), ellipsoids only for anatomy. Everything overlaps; the voxel remesh
# in step 2 makes it one surface.
import bpy, bmesh, math
from mathutils import Vector, Matrix

col = bpy.data.collections.get('Duelist') or bpy.data.collections.new('Duelist')
if col.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(col)
bm = bmesh.new()

def cr(p0, p1, p2, p3, t):
    return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)

def loft(ctrl, axis, n=28, step=0.008):
    """ctrl: [(centre, radius along u, radius along w)]; rings are perpendicular to `axis`."""
    U = {'z': (Vector((1, 0, 0)), Vector((0, 1, 0))), 'x': (Vector((0, 1, 0)), Vector((0, 0, 1))),
         'y': (Vector((1, 0, 0)), Vector((0, 0, 1)))}[axis]
    P = [(Vector(c), a, b) for c, a, b in ctrl]; P = [P[0]] + P + [P[-1]]
    rings = []
    for i in range(1, len(P)-2):
        k = max(1, int((P[i+1][0]-P[i][0]).length/step))
        for j in range(k):
            t = j/k
            c = cr(P[i-1][0], P[i][0], P[i+1][0], P[i+2][0], t)
            a = cr(*[Vector((p[1], p[2], 0)) for p in (P[i-1], P[i], P[i+1], P[i+2])], t)
            rings.append((c, a.x, a.y))
    rings.append((P[-2][0], P[-2][1], P[-2][2]))
    vr = [[bm.verts.new(c + U[0]*a*math.cos(2*math.pi*q/n) + U[1]*b*math.sin(2*math.pi*q/n)) for q in range(n)]
          for c, a, b in rings]
    for r0, r1 in zip(vr, vr[1:]):
        for q in range(n):
            bm.faces.new((r0[q], r0[(q+1) % n], r1[(q+1) % n], r1[q]))
    for r in (vr[0], vr[-1]):
        bm.faces.new(r)

def ell(c, r, rot=None):
    g = bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    M = Matrix.Diagonal((r[0], r[1], r[2], 1))
    if rot:
        M = rot @ M
    for v in g['verts']:
        v.co = (M @ v.co.to_4d()).to_3d() + Vector(c)

# torso (z, half width, half depth, y offset): hips widest at 0.95, waist 1.16, neck 1.56+
T = [(0.85, 0.07, 0.06, 0.0), (0.89, 0.15, 0.095, 0.005), (0.95, 0.182, 0.105, 0.008), (1.02, 0.172, 0.10, 0.005),
     (1.09, 0.146, 0.09, 0), (1.16, 0.122, 0.08, 0), (1.24, 0.124, 0.083, 0), (1.32, 0.134, 0.09, 0),
     (1.40, 0.145, 0.09, 0.005), (1.46, 0.15, 0.083, 0.01), (1.50, 0.135, 0.072, 0.012), (1.53, 0.085, 0.058, 0.012),
     (1.56, 0.05, 0.046, 0.012), (1.63, 0.045, 0.045, 0.01)]
loft([((0, y, z), rx, ry) for z, rx, ry, y in T], 'z', n=32)
for s in (1, -1):
    ell((s*0.07, 0.045, 0.94), (0.078, 0.068, 0.085))     # glutes
    ell((s*0.068, -0.038, 1.345), (0.066, 0.05, 0.062))   # bust: wide and shallow, or it reads as stuck-on spheres
    ell((s*0.10, 0.02, 1.505), (0.075, 0.045, 0.03))      # trapezius
    x = s*0.1
    # leg (z, rx, ry, y offset); the first ring tapers inside the pelvis so the top is not a flat cap
    L = [(1.04, 0.03, 0.04, 0), (1.00, 0.08, 0.088, 0), (0.92, 0.087, 0.09, 0), (0.78, 0.074, 0.077, -0.004),
         (0.66, 0.061, 0.065, -0.005), (0.56, 0.05, 0.054, -0.006), (0.50, 0.047, 0.05, 0.002),
         (0.42, 0.051, 0.057, 0.013), (0.32, 0.044, 0.05, 0.008), (0.20, 0.033, 0.037, 0.002),
         (0.10, 0.029, 0.033, 0.004), (0.06, 0.03, 0.035, 0.01)]
    loft([((x*(0.93 if z > 0.95 else 1), y, z), rx, ry) for z, rx, ry, y in L], 'z', n=24)
    F = [(0.045, 0.026, 0.035, 0.045), (0.0, 0.036, 0.045, 0.045), (-0.07, 0.042, 0.03, 0.032),
         (-0.14, 0.037, 0.02, 0.022), (-0.175, 0.025, 0.013, 0.016)]                       # foot along -Y
    loft([((x, y, z), rx, rz) for y, rx, rz, z in F], 'y', n=20)
    A = [(0.10, 1.495, 0.05, 0.05), (0.19, 1.50, 0.054, 0.056), (0.27, 1.51, 0.046, 0.048), (0.38, 1.515, 0.042, 0.043),
         (0.48, 1.518, 0.034, 0.035), (0.53, 1.518, 0.036, 0.037), (0.62, 1.518, 0.033, 0.034),
         (0.72, 1.519, 0.026, 0.026), (0.775, 1.52, 0.03, 0.02), (0.81, 1.519, 0.042, 0.019),
         (0.85, 1.517, 0.045, 0.017), (0.885, 1.513, 0.04, 0.012), (0.91, 1.51, 0.03, 0.009),
         (0.92, 1.51, 0.015, 0.006)]                                                     # arm + flat mitten hand
    loft([((s*ax, 0, z), ry, rz) for ax, z, ry, rz in A], 'x', n=20, step=0.006)
    loft([((s*px, py, pz), 0.012, 0.01) for px, py, pz in [(0.785, -0.025, 1.515), (0.81, -0.05, 1.51), (0.835, -0.068, 1.505)]],
         'y', n=10, step=0.005)                                                          # thumb
    ell((s*0.08, 0.012, 1.68), (0.012, 0.02, 0.027))                                     # ears
ell((0, 0.015, 1.705), (0.079, 0.095, 0.098))    # cranium: chin ~1.60, crown ~1.80
ell((0, -0.018, 1.648), (0.058, 0.062, 0.05))    # jaw
ell((0, -0.052, 1.613), (0.026, 0.024, 0.02))    # chin
ell((0, -0.088, 1.668), (0.009, 0.014, 0.019))   # nose
me = bpy.data.meshes.new('Duelist'); bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('Duelist', me); col.objects.link(ob)
r = ob.modifiers.new('Remesh', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = 0.005; r.use_smooth_shade = True
sm = ob.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH'); sm.iterations = 20; sm.factor = 0.5; sm.use_only_smooth = True
# -> render front / 3/4 / side / back / head and iterate on the numbers above before going on.

# ============================================================== STEP 2: one surface, game budget
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.modifier_apply(modifier='Remesh'); bpy.ops.object.modifier_apply(modifier='Smooth')
d = ob.modifiers.new('Dec', 'DECIMATE'); d.ratio = 3200/(len(ob.data.polygons)*2); d.use_symmetry = True; d.symmetry_axis = 'X'
bpy.ops.object.modifier_apply(modifier='Dec')
bpy.ops.object.shade_smooth()
# Symmetric decimation can leave twin faces (same verts, opposite normals) on the
# centre line: they render as black triangles. Delete the inward twin of each pair
# (see SKILL.md), then `ob.data.validate()`.
# Later polish: bmesh.ops.smooth_vert (factor 0.5, 3-4 passes) on just the face verts
# (z > 1.60, y < -0.03) and the shoulder/trapezius verts removed decimation creases.

# ============================================================== STEP 3: skirt (its own object until joined)
bm = bmesh.new(); N = 48
rings = [(1.18, 0.13, 0.098, 0.0), (1.13, 0.152, 0.112, 0.0), (1.05, 0.193, 0.14, 0.0), (0.97, 0.228, 0.172, 0.06),
         (0.89, 0.257, 0.2, 0.11), (0.815, 0.276, 0.22, 0.13)]   # (z, rx, ry, pleat depth)
vr = []
for z, rx, ry, pl in rings:
    row = []
    for q in range(N):
        a = 2*math.pi*q/N
        k = 1 - pl*(0.5+0.5*math.cos(a*N/2))          # alternate vertices in / out = pleats
        row.append(bm.verts.new((rx*k*math.cos(a), 0.008+ry*k*math.sin(a), z)))
    vr.append(row)
for r0, r1 in zip(vr, vr[1:]):
    for q in range(N):
        bm.faces.new((r0[q], r1[q], r1[(q+1) % N], r0[(q+1) % N]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
for e in bm.edges:                                     # keep the pleat folds crisp
    if len(e.link_faces) == 2 and e.calc_face_angle() > math.radians(25):
        e.smooth = False
# UVs: u = angle around the waist (with the wrap fixed per face), v = height. Name the
# layer 'UVMap' (me.uv_layers.new(name='UVMap')) so it merges with the body's on join.

# ============================================================== STEP 4: hair
# Cap: a sphere a little larger than the cranium, cut along a hairline that is
# high at the face and low at the nape. Fringe: delete the front below 1.722,
# then pull every other boundary vertex down 0.028 (deleting vertices in a zig-zag
# instead kills the faces between them). Ponytail: a 12-sided tube from the crown
# over the back of the head to the shoulder blades; a short fat tube is the tie.
# Side locks: thin flattened tubes that start inside the cap (so no cap end shows).
#   cap      sphere(0.089, 0.106, 0.108) at (0, 0.02, 1.712), 32x20
#   cut      y > 0: z < 1.612;  -0.06 < y <= 0: z < 1.66 - 0.6*y;  front: z < 1.722
#   tail     (0,.06,1.80) (0,.11,1.815) (0,.15,1.78) (0,.168,1.70) (0,.165,1.60) (0,.155,1.50)
#            (0,.145,1.40) (0,.135,1.32) (0,.125,1.25); radii .034 .04 .044 .046 .043 .038 .031 .02 .005
#   locks    (±.066,-.055,1.77) (±.079,-.06,1.71) (±.077,-.052,1.65) (±.068,-.04,1.595); radii .016 .015 .011 .003, flat 0.45

# ============================================================== STEP 5: weights (after joining and parenting)
# Islands are tagged before joining loses them: ob["part_tags"] is one char per
# vertex, 'b' body / 'h' hair / 's' skirt. Compare against those chars, not words.
def sm(e0, e1, x):
    t = max(0, min(1, (x-e0)/(e1-e0))); return t*t*(3-2*t)

def body_weights(x, y, z):
    ax = abs(x); s = 'L' if x >= 0 else 'R'; w = {}
    hs = sm(1.00, 1.22, z); sh = sm(1.55, 1.63, z)
    trunk = {'hips': 1-hs, 'spine': hs*(1-sh), 'head': hs*sh}
    leg = sm(0.99, 0.84, z)*min(1, ax/0.03)
    ts = sm(0.60, 0.48, z); sf = sm(0.12, 0.065, z)
    legw = {f'thigh_{s}': 1-ts, f'shin_{s}': ts*(1-sf), f'foot_{s}': ts*sf}
    arm = sm(0.12, 0.24, ax)*sm(1.36, 1.43, z)
    uf = sm(0.46, 0.54, ax); fh = sm(0.75, 0.80, ax)
    armw = {f'upperArm_{s}': 1-uf, f'forearm_{s}': uf*(1-fh), f'hand_{s}': uf*fh}
    for part, k in ((trunk, (1-leg)*(1-arm)), (legw, leg*(1-arm)), (armw, arm)):
        for n, ww in part.items():
            if ww*k > 0:
                w[n] = w.get(n, 0) + ww*k
    return w

def hair_weights(x, y, z):
    h = sm(1.54, 1.70, z) if y > 0.06 else 1.0     # the ponytail follows the back below the head
    return {'head': h, 'spine': 1-h}

def skirt_weights(x, y, z):
    sp = sm(1.00, 1.25, z); drape = sm(1.10, 0.86, z)*0.92
    l = drape*max(0, min(1, (x+0.04)/0.14)); r = drape*max(0, min(1, (-x+0.04)/0.14))
    if l+r > 0.92:
        k = 0.92/(l+r); l *= k; r *= k
    base = 1-l-r
    return {'hips': base*(1-sp), 'spine': base*sp, 'thigh_L': l, 'thigh_R': r}
