"""
Worked example: the texture painter used for the Duelist (art/duelist.blend).
Rasterises every UV triangle into a texel -> (3D position, normal, material
slot) map, then paints colours as functions of 3D position, so feature edges
never follow polygon edges and a re-unwrap only needs a repaint.

Copy it to the scratchpad, change NAME / OUT and the colour rules for the new
Body, and exec it in Blender (see SKILL.md). Slot 0 = skin and clothes, slot 1 = hair
while painting; the slots are merged before export.
"""
import bpy, numpy as np

S = 2048  # painted at 2x and box-filtered down to OUT_S, so edges are anti-aliased
OUT_S = 1024
NAME = 'Duelist'
OUT = globals().get('OUT', r'C:/tmp/duelist_tex.png')  # pass a scratchpad path
ob = bpy.data.objects[NAME]; me = ob.data
me.calc_loop_triangles()
nt = len(me.loop_triangles)
L = np.zeros(nt*3, dtype=np.int64); me.loop_triangles.foreach_get('loops', L)
V = np.zeros(nt*3, dtype=np.int64); me.loop_triangles.foreach_get('vertices', V)
M = np.zeros(nt, dtype=np.int64); me.loop_triangles.foreach_get('material_index', M)
uvl = me.uv_layers.active.data
uv = np.zeros(len(uvl)*2); uvl.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
co = np.zeros(len(me.vertices)*3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
nrm = np.zeros(len(me.vertices)*3); me.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
TU = uv[L].reshape(nt, 3, 2)*S - 0.5; TP = co[V].reshape(nt, 3, 3); TN = nrm[V].reshape(nt, 3, 3)
P = np.zeros((S, S, 3)); N = np.zeros((S, S, 3)); MI = np.full((S, S), -1, dtype=np.int64)
for t in range(nt):
    u = TU[t]; x0, y0 = np.floor(u.min(0)).astype(int); x1, y1 = np.ceil(u.max(0)).astype(int)
    x0 = max(x0-1, 0); y0 = max(y0-1, 0); x1 = min(x1+1, S-1); y1 = min(y1+1, S-1)
    xs, ys = np.meshgrid(np.arange(x0, x1+1), np.arange(y0, y1+1))
    a, b, c = u
    d = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
    if abs(d) < 1e-12:
        continue
    w0 = ((b[1]-c[1])*(xs-c[0]) + (c[0]-b[0])*(ys-c[1]))/d
    w1 = ((c[1]-a[1])*(xs-c[0]) + (a[0]-c[0])*(ys-c[1]))/d
    w2 = 1-w0-w1
    m = (w0 >= -0.03) & (w1 >= -0.03) & (w2 >= -0.03)
    if not m.any():
        continue
    W = np.stack([w0[m], w1[m], w2[m]], 1)
    P[ys[m], xs[m]] = W @ TP[t]; N[ys[m], xs[m]] = W @ TN[t]; MI[ys[m], xs[m]] = M[t]

def hexc(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255]) / 255.0

def sm(e0, e1, v):
    t = np.clip((v-e0)/(e1-e0), 0, 1); return t*t*(3-2*t)

X, Y, Z = P[..., 0], P[..., 1], P[..., 2]; ax = np.abs(X)
img = np.zeros((S, S, 3))
def put(mask, colour, alpha=1.0):
    global img
    a = (mask.astype(float) * alpha)[..., None]
    img = img*(1-a) + (hexc(colour) if np.isscalar(colour) else colour)*a

body = MI == 0; hair = MI == 1
torso = body & (ax < 0.17) & (Z > 0.84) & (Z < 1.56)
arm = body & (ax >= 0.17) & (Z > 1.42)
leg = body & (Z < 0.86)
front = Y < 0

# ---- skin, with a little warmth on cheeks, knees and elbows
put(body, 0xe0aa86)
put(body & (Y < -0.05) & (Z > 1.62) & (Z < 1.70), 0xe8958a, 0.35*np.exp(-((ax-0.045)/0.018)**2 - ((Z-1.665)/0.015)**2))

# ---- face: eyes, brows, lashes, lips
face = body & (Y < -0.055) & (Z > 1.60) & (Z < 1.76)
ex = (ax-0.031)/0.0135; ez = (Z-1.700)/0.0068
put(face & (ex**2 + ez**2 < 1), 0xf4ede4)
ir = np.sqrt(((ax-0.030)/0.0062)**2 + ((Z-1.6995)/0.0062)**2)
put(face & (ir < 1) & (ex**2+ez**2 < 1), 0x3b6e5a)
put(face & (ir < 0.45) & (ex**2+ez**2 < 1), 0x10100f)
put(face & (np.abs(ez-1.0) < 0.42) & (np.abs(ex) < 1.15) , 0x1c120e)          # upper lash line
put(face & (ax > 0.013) & (ax < 0.048) & (np.abs(Z - (1.716 + 0.004*np.sin((ax-0.013)/0.035*np.pi))) < 0.0028), 0x6e4a2a)  # brows
lx = ax/0.0135; lz = (Z-1.634)/0.0042
put(face & (lx**2 + lz**2 < 1), 0xb4555a)
put(face & (lx < 1) & (np.abs(Z-1.634) < 0.0009), 0x6b2a2e)

# ---- bodice: halter top in dark leather with gold trim and lacing
neck_front = 1.43 - 0.045*np.exp(-(ax/0.035)**2)
top_edge = np.where(front, neck_front, 1.455)
strap = (ax > 0.045) & (ax < 0.075) & (Z < 1.56)
bod = torso & (Z > 1.20) & ((Z < top_edge) | strap)
put(bod, 0x3a2922)
put(bod & (Z > 1.20) & (Z < 1.215), 0xc9a24f)                                       # bottom trim
put(torso & ~strap & (np.abs(Z-top_edge) < 0.006) & (Z > 1.3), 0xc9a24f)             # neckline trim
put(bod & strap & ((np.abs(ax-0.047) < 0.003) | (np.abs(ax-0.073) < 0.003)), 0xc9a24f)
lace = bod & front & (ax < 0.018) & (Z > 1.23) & (Z < neck_front-0.01)
put(lace & (np.abs(ax - 0.5*0.016*(1+np.sin((Z-1.23)/0.022*np.pi*2)))*1 < 0.0022), 0xd9c7a0)
put(bod & (np.abs(ax-0.10) < 0.0015), 0x22160f)                                      # seams
# ---- belt and the shorts under the skirt
belt = torso & (Z > 1.165) & (Z <= 1.20)
put(belt, 0x6b4a2e)
put(belt & front & (ax < 0.025), 0xe0bb5c)
put(belt & front & (ax < 0.014) & (Z > 1.172) & (Z < 1.193), 0x6b4a2e)
put(body & (Z > 0.84) & (Z <= 1.165) & (ax < 0.19), 0x241c19)

# ---- bracers and gloves
br = arm & (ax > 0.50) & (ax < 0.765)
put(br, 0x5a3b26)
put(br & ((ax < 0.512) | (ax > 0.753)), 0xc9a24f)
put(br & (np.abs(((ax-0.52)/0.03) % 1 - 0.5) < 0.06), 0x3d281a)
put(arm & (ax >= 0.765), 0x2e221c)
put(arm & (ax >= 0.765) & (ax < 0.78), 0x5a3b26)

# ---- boots, knee high, with a folded cuff and a strap
boot = leg & (Z < 0.50)
put(boot, 0x4a3022)
put(leg & (Z >= 0.455) & (Z < 0.50), 0x6e4a32)
put(leg & (np.abs(Z-0.455) < 0.003), 0x2a1a12)
put(boot & (np.abs(Z-0.30) < 0.012), 0x2a1a12)
put(boot & (np.abs(Z-0.30) < 0.012) & (X*np.sign(X+1e-9) > 0) & (Y < -0.02) & (np.abs(ax-0.1) < 0.012), 0xc9a24f)
put(leg & (Z < 0.018), 0x1d1410)
put(boot & (Z < 0.12) & (Y < -0.05) & (np.abs(Y + 0.08) < 0.003), 0x2a1a12)

# ---- hair: platinum with strands and a darker underside
a = np.arctan2(X, -(Y-0.02))
def wav(t):
    return 0.5 + 0.5*(0.6*np.sin(t) + 0.3*np.sin(2.3*t + 1.7) + 0.1*np.sin(5.1*t + 0.4))
cap_t = a*46 + 6*np.sin(Z*31) + 2*np.sin(a*7)
tail_t = X*400 + 18*np.sin(Z*17) + 5*np.sin(Y*90)
strands = np.where(Y > 0.09, wav(tail_t), wav(cap_t))
base = hexc(0xe9d6a4); dark = hexc(0xae9060); light = hexc(0xfff4d6)
hc = base*(1-0.28*strands[..., None]) + dark*0.28*strands[..., None]
hc = hc*(1-0.25*sm(0.4, 0.9, N[..., 2])[..., None]) + light*0.25*sm(0.4, 0.9, N[..., 2])[..., None]
put(hair, hc)
put(hair & (Y > 0.03) & (Y < 0.11) & (Z > 1.79), 0x6b4a2e)   # the hair tie

# ---- soft baked occlusion: darker facing down
ao = 0.86 + 0.14*sm(-0.8, 0.3, N[..., 2])
img *= ao[..., None]

# ---- dilate into empty texels so seams do not show
filled = MI >= 0
for _ in range(6):
    acc = np.zeros_like(img); cnt = np.zeros((S, S))
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(filled, dx, 1), dy, 0); si = np.roll(np.roll(img, dx, 1), dy, 0)
        acc += si*sh[..., None]; cnt += sh
    grow = ~filled & (cnt > 0)
    img[grow] = acc[grow]/cnt[grow][:, None]; filled |= grow

img = img.reshape(OUT_S, S//OUT_S, OUT_S, S//OUT_S, 3).mean((1, 3))
S = OUT_S
srgb = np.clip(img, 0, 1)
lin = np.where(srgb <= 0.04045, srgb/12.92, ((srgb+0.055)/1.055)**2.4)
name = NAME + '_Tex'
im = bpy.data.images.get(name) or bpy.data.images.new(name, S, S)
im.colorspace_settings.name = 'sRGB'
px = np.concatenate([srgb, np.ones((S, S, 1))], 2).astype(np.float32)
im.pixels.foreach_set(px.ravel())
im.filepath_raw = OUT; im.file_format = 'PNG'; im.save()
if im.packed_file:
    im.pack()  # a packed image is what the glTF export embeds: refresh it after every repaint

mat = bpy.data.materials.get(NAME + '_Body') or bpy.data.materials.new(NAME + '_Body')
mat.use_nodes = True; nt_ = mat.node_tree
bsdf = nt_.nodes.get('Principled BSDF')
tex = nt_.nodes.get('Tex') or nt_.nodes.new('ShaderNodeTexImage'); tex.name = 'Tex'; tex.image = im
nt_.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.75
mat.use_backface_culling = False
me.materials[0] = mat
if len(me.materials) > 1 and me.materials[1].name.endswith('_Hair'):
    me.materials[1] = mat
nt_.nodes.active = tex  # Workbench TEXTURE shading shows the active image node
result = {"file": OUT}
