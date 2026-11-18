/**
 * docs/plans/map-editor.md, Stage 5: the model of a map made in the Map Editor, generated from its Brushes. Each part is in its Brush's
 * material (one mesh per material, named so the game's texturing reads it), it stands where the compiled map does, the pit's banks are
 * closed down to the lava, the props and the torches' lights are in, the sky rides on the root, and the same source gives the same model.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { compileDraft } from '../mapEditor/compile';
import { MAP_MODEL_ROOT, MAX_TORCH_LIGHTS, TORCH_LIGHT } from '../mapEditor/look';
import { dressedSampleSource, GROUND, sampleSource, withBrushes } from '../mapEditor/sample.testdata';
import type { Brush, EnclosureBrush, MapSource } from '../mapEditor/source';
import { mapModel } from './mapModel';
import { SEAM_SHADE } from './seamShade';

const battle = loadTuningData().battle;
const modelOf = (s: MapSource) => mapModel(s, compileDraft(s, battle));
const meshes = (root: THREE.Object3D) => root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
const mesh = (root: THREE.Object3D, name: string) => meshes(root).find((m) => m.name === name);
const box = (m: THREE.Mesh) => new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute);

/**
 * The places two faces of different materials lie in one plane over each other, so they fight for depth (issue #157), as (materials,
 * a point of the overlap): those seen from any of `eyes` (nothing nearer on the line to that point; a face inside a box is not seen).
 */
function fights(root: THREE.Object3D, eyes: readonly THREE.Vector3[]): string[] {
  type Tri = { mat: string; p: THREE.Vector3[]; axis: 'x' | 'y' | 'z' };
  const tris: Tri[] = [];
  for (const m of meshes(root)) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)));
      const n = new THREE.Vector3().subVectors(p[1]!, p[0]!).cross(new THREE.Vector3().subVectors(p[2]!, p[0]!));
      if (n.length() < 1e-9) continue;
      n.normalize();
      const axis = (['x', 'y', 'z'] as const).find((a) => Math.abs(n[a]) > 0.99);
      if (axis) tris.push({ mat: m.name, p, axis });
    }
  }
  // Each triangle's shadow on its plane, and the overlap of two (convex polygons, clipped one by the other).
  const flat = (t: Tri): [number, number][] => t.p.map((v) => (t.axis === 'x' ? [v.y, v.z] : t.axis === 'y' ? [v.x, v.z] : [v.x, v.y]));
  const area = (q: [number, number][]) => q.reduce((s, [x, y], i) => s + x * q[(i + 1) % q.length]![1] - q[(i + 1) % q.length]![0] * y, 0) / 2;
  const clip = (subject: [number, number][], by: [number, number][]) => {
    const turn = Math.sign(area(by));
    let out = subject;
    by.forEach((a, i) => {
      const b = by[(i + 1) % by.length]!;
      const side = (p: [number, number]) => turn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
      const input = out;
      out = [];
      input.forEach((p, j) => {
        const q = input[(j + 1) % input.length]!;
        const [sp, sq] = [side(p), side(q)];
        if (sp > 1e-9 !== sq > 1e-9) out.push([p[0] + ((q[0] - p[0]) * sp) / (sp - sq), p[1] + ((q[1] - p[1]) * sp) / (sp - sq)]);
        if (sq > 1e-9) out.push(q);
      });
    });
    return out;
  };
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const seen = (at: THREE.Vector3) =>
    eyes.some((eye) => {
      const far = eye.distanceTo(at);
      ray.set(eye, at.clone().sub(eye).normalize());
      const hit = ray.intersectObjects(meshes(root), false)[0];
      return hit !== undefined && hit.distance > far - 1e-3;
    });
  const found: string[] = [];
  for (let i = 0; i < tris.length; i++)
    for (let j = i + 1; j < tris.length; j++) {
      const [s, t] = [tris[i]!, tris[j]!];
      if (s.mat === t.mat || s.axis !== t.axis || Math.abs(s.p[0]![s.axis] - t.p[0]![t.axis]) > 1e-3) continue;
      const o = clip(flat(s), flat(t));
      if (o.length < 3 || Math.abs(area(o)) < 1e-3) continue;
      const [u, v] = o.reduce(([x, y], [a, b]) => [x + a / o.length, y + b / o.length], [0, 0]);
      const w = s.p[0]![s.axis];
      const at = s.axis === 'x' ? new THREE.Vector3(w, u, v) : s.axis === 'y' ? new THREE.Vector3(u, w, v) : new THREE.Vector3(u, v, w);
      if (seen(at)) found.push(`${s.mat}/${t.mat} at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)})`);
    }
  return found;
}

describe('the model of a Map Editor map', () => {
  it('is one mesh per material, each named as its material, the Brushes in theirs and the props in their own', () => {
    const root = modelOf(dressedSampleSource());
    expect(root.name).toBe(MAP_MODEL_ROOT);
    for (const m of meshes(root)) expect((m.material as THREE.Material).name).toBe(m.name);
    expect(meshes(root).map((m) => m.name).sort()).toEqual(
      ['Map_Grass', 'Map_BrickWall', 'Map_Cobble', 'Map_Wood', 'Map_Metal', 'Map_Lava', 'Map_Dirt', 'Map_Bark', 'Map_Leaf', 'Map_Rubble', 'Map_Banner0', 'Map_Banner1', 'Map_Banner', 'Map_Fire', 'Map_CrateWood', 'Map_SeamShade'].sort(),
    );
    // Undressed, each Brush takes its kind's: the ground grass, the keep and the ramps stone, the bridge and its rails wood.
    expect(meshes(modelOf(sampleSource())).map((m) => m.name).sort()).toEqual(['Map_Dirt', 'Map_Grass', 'Map_Lava', 'Map_SeamShade', 'Map_Stone', 'Map_Wood']);
  });

  it('stands where the compiled map does: the keep 4 m up in brick, the lava 8 m down in the pit, the bridge a slab over it', () => {
    const root = modelOf(dressedSampleSource());
    const keep = box(mesh(root, 'Map_BrickWall')!);
    // Its faces are 0.3 m slabs centred on the keep's sides (float32 positions).
    expect(keep.min.x).toBeCloseTo(-12.15, 5);
    expect(keep.max.x).toBeCloseTo(12.15, 5);
    expect(keep.max.y).toBe(4);
    const lava = box(mesh(root, 'Map_Lava')!);
    expect([lava.min.x, lava.max.x, lava.min.z, lava.max.z, lava.min.y, lava.max.y]).toEqual([20, 36, -12, 12, -8, -8]);
    const bridge = box(mesh(root, 'Map_Wood')!);
    expect([bridge.min.x, bridge.max.x, bridge.max.y]).toEqual([12, 44, 4]);
    // Its slab's underside (the Walls under it, to the ground beside the pit, are wood too: they are the bridge's faces).
    const ys = Array.from(mesh(root, 'Map_Wood')!.geometry.getAttribute('position').array).filter((_, i) => i % 3 === 1);
    expect(ys.some((y) => Math.abs(y - 3.55) < 1e-5)).toBe(true);
    // The pit's banks are closed from the ground down to the lava (no Wall stands there: deadly ground faces nothing), in the ground's dirt.
    const banks = box(mesh(root, 'Map_Dirt')!);
    expect([banks.min.x, banks.max.x, banks.min.y, banks.max.y]).toEqual([20, 36, -8, 0]);
    // The ground runs on into the haze beyond the field, just under it; nothing stands on the field's edge Walls.
    const ground = box(mesh(root, 'Map_Grass')!);
    expect(ground.min.x).toBeLessThan(-700);
    expect(ground.min.y).toBeCloseTo(-0.02, 5);
    expect(ground.max.y).toBe(0);
  });

  it('carries the props, the first torches’ lights, and the map’s sky', () => {
    const dressed = dressedSampleSource();
    const root = modelOf(dressed);
    const lights = root.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight);
    expect(lights.map((l) => l.name)).toEqual(['LIGHT_torch_0', 'LIGHT_torch_1', 'LIGHT_torch_2', 'LIGHT_torch_3']);
    expect(lights[0]!.position.toArray()).toEqual([-11, 6.8, -7]);
    expect(root.userData).toEqual({ sky: 'mystic' });
    expect(modelOf(sampleSource()).userData).toEqual({ sky: 'dusk' });
    // A tree's leaves stand over its trunk, a few metres up.
    const leaf = box(mesh(root, 'Map_Leaf')!);
    expect(leaf.max.y).toBeGreaterThan(4);
    // Many torches: only the first few carry a light (each light costs every pixel it reaches).
    const torches = Array.from({ length: 20 }, (_, k) => ({ id: `t${k}`, kind: 'torch' as const, x: -90 + 5 * k, z: -60, y: 0, turn: 0 }));
    const lit = modelOf({ ...dressed, look: { props: torches } }).children.filter((o) => o instanceof THREE.PointLight);
    expect(lit).toHaveLength(MAX_TORCH_LIGHTS);
    expect(lit.every((l) => l.name.startsWith(TORCH_LIGHT.prefix))).toBe(true);
  });

  it('stands each prop on the floor nearest under the level it names, and runs the ground on at the ground’s height', () => {
    const dressed = dressedSampleSource();
    // Placed while editing the keep's level (4 m), but one out on the field and one on the south ramp, half way up.
    const props = [
      { id: 'out', kind: 'crate' as const, x: 60, z: -60, y: 4, turn: 0 },
      { id: 'onramp', kind: 'crate' as const, x: 0, z: -14, y: 4, turn: 0 },
      { id: 'top', kind: 'crate' as const, x: 0, z: 0, y: 4, turn: 0 },
    ];
    const root = modelOf({ ...dressed, look: { props } });
    const crates = mesh(root, 'Map_CrateWood')!.geometry.getAttribute('position');
    const lowest = (x: number, z: number) => {
      let y = Infinity;
      for (let i = 0; i < crates.count; i++) if (Math.abs(crates.getX(i) - x) < 1.5 && Math.abs(crates.getZ(i) - z) < 1.5) y = Math.min(y, crates.getY(i));
      return y;
    };
    expect(lowest(60, -60)).toBeCloseTo(0, 5);
    expect(lowest(0, -14)).toBeCloseTo(2, 5);
    expect(lowest(0, 0)).toBeCloseTo(4, 5);
    // A sunken floor somewhere (a ditch at -4) leaves the ground beyond the field at the ground's own height.
    const ditch = { ...dressed, levels: [-8, -4, 0, 4], brushes: [...dressed.brushes, { kind: 'hole' as const, id: 'cut', rect: { x0: -60, z0: 40, x1: -50, z1: 50 }, y: 0 }, { kind: 'floor' as const, id: 'ditch', rect: { x0: -60, z0: 40, x1: -50, z1: 50 }, y: -4 }] };
    const grass = mesh(modelOf(ditch), 'Map_Grass')!.geometry.getAttribute('position');
    const beyond = Array.from({ length: grass.count }, (_, i) => i).filter((i) => Math.abs(grass.getX(i)) > 101);
    expect(beyond.length).toBeGreaterThan(0);
    for (const i of beyond) expect(grass.getY(i)).toBeCloseTo(-0.02, 5);
  });

  it('is the same for the same source', () => {
    const flat = (root: THREE.Object3D) => meshes(root).map((m) => [m.name, Array.from(m.geometry.getAttribute('position').array)]);
    expect(flat(modelOf(dressedSampleSource()))).toEqual(flat(modelOf(dressedSampleSource())));
  });

  it('draws an Enclosure’s Walls outside its rect, their inner faces on the lines bodies and the camera stop at; a shared Wall between two rooms', () => {
    const room = (id: string, x0: number, x1: number, doors: EnclosureBrush['doors'] = {}): EnclosureBrush => ({ kind: 'enclosure', id, rect: { x0, z0: -5, x1, z1: 5 }, y: 0, doors });
    const stone = (s: MapSource) => {
      const m = mesh(modelOf(s), 'Map_Stone')!;
      const p = m.geometry.getAttribute('position');
      return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) })).filter((v) => v.y > 0.5);
    };
    // One room alone: nothing of its Walls stands inside its rect (each slab is 0.6 m, wholly outside), and the corners are closed outside.
    const alone = stone(withBrushes([GROUND, room('hall', -5, 5)], [0, 4]));
    expect(alone.every((v) => Math.abs(v.x) >= 5 - 1e-5 || Math.abs(v.z) >= 5 - 1e-5)).toBe(true);
    const bounds = new THREE.Box3().setFromPoints(alone.map((v) => new THREE.Vector3(v.x, v.y, v.z)));
    expect([bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z].map((n) => Math.round(n * 1e4) / 1e4)).toEqual([-5.6, 5.6, -5.6, 5.6]);
    // Two rooms edge to edge through a doorway: their shared Wall on x = 0 stands centred on its line, between them.
    const pair = stone(withBrushes([GROUND, room('west', -10, 0, { e: 2 }), room('east', 0, 10, { w: 2 })], [0, 4]));
    const middle = pair.filter((v) => Math.abs(v.x) < 1 && Math.abs(v.z) < 4.9);
    expect(Math.min(...middle.map((v) => v.x))).toBeCloseTo(-0.3, 5);
    expect(Math.max(...middle.map((v) => v.x))).toBeCloseTo(0.3, 5);
  });

  it('draws a Passage into a Hall with no faces fighting for depth: no stubs in the doorway, the jambs and a Gallery’s threshold clean (issue #157)', () => {
    const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: -8, hazard: 'abyss' };
    const hall = (y: number, doors: EnclosureBrush['doors']): EnclosureBrush => ({ kind: 'enclosure', id: 'hall', rect: { x0: -10, z0: -10, x1: 10, z1: 0 }, y, doors, top: 6, material: 'brick' });
    const passage = (y: number): EnclosureBrush => ({ kind: 'enclosure', id: 'pass', rect: { x0: -1.5, z0: 0, x1: 1.5, z1: 12 }, y, doors: { s: 3, n: 3 }, top: 6, material: 'stone' });
    const levels = [-8, 0, 2, 4, 6];
    // A Passage into a Hall through a doorway in the Hall's side, both on one floor.
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Where a body or the camera stands: about the Hall, in the doorway, along the Passage.
    const eyes = (y: number) => [v(0, y + 1.6, -6), v(-6, y + 1.6, -1), v(6, y + 1.6, -1), v(-1, y + 2.5, -0.5), v(1, y + 1, -0.3), v(0, y + 1.6, 1), v(0.8, y + 2, 6)];
    const level = modelOf(withBrushes([abyss, hall(2, { n: 3 }), passage(2)], levels));
    expect(fights(level, eyes(2))).toEqual([]);
    // Nothing of the Passage's Walls stands inside the Hall (bar a lip of a few cm).
    const stone = mesh(level, 'Map_Stone')!.geometry.getAttribute('position');
    for (let i = 0; i < stone.count; i++) if (stone.getY(i) > 2.5 && stone.getY(i) < 5.5) expect(stone.getZ(i)).toBeGreaterThan(-0.05);
    // A stairwell: the Passage comes in at a Gallery's Deck, 2 m over the Hall's floor, a Ramp up to it inside the Hall.
    const deck: Brush = { kind: 'deck', id: 'deck', rect: { x0: -10, z0: -4, x1: 6, z1: 0 }, y: 2, material: 'wood' };
    const ramp: Brush = { kind: 'ramp', id: 'ramp', rect: { x0: 6, z0: -4, x1: 10, z1: 0 }, lo: 0, hi: 2, up: 'w', rails: ['n', 's'], material: 'marble' };
    const stairwell = modelOf(withBrushes([abyss, hall(0, {}), passage(2), deck, ramp], levels));
    expect(fights(stairwell, [...eyes(2), v(-6, 1, -5), v(8, 1.6, -6), v(8, 2.5, -2), v(0.5, 2.2, -0.2)])).toEqual([]);
  });

  it('shades where Walls meet floor and ceiling: wall bases, a roof, a pillar, a Deck’s underside; never a doorway (issue #171)', () => {
    const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: -8, hazard: 'abyss' };
    const hall: EnclosureBrush = { kind: 'enclosure', id: 'hall', rect: { x0: -10, z0: -10, x1: 10, z1: 0 }, y: 0, doors: { n: 3 }, top: 6, material: 'brick' };
    const passage: EnclosureBrush = { kind: 'enclosure', id: 'pass', rect: { x0: -1.5, z0: 0, x1: 1.5, z1: 12 }, y: 0, doors: { s: 3, n: 3 }, top: 4, material: 'stone' };
    const pillar: Brush = { kind: 'block', id: 'pillar', rect: { x0: -5, z0: -6, x1: -4, z1: -5 }, top: 6, material: 'stone' };
    const deck: Brush = { kind: 'deck', id: 'deck', rect: { x0: -10, z0: -10, x1: -7, z1: -7 }, y: 2, material: 'wood' };
    const root = modelOf(withBrushes([abyss, hall, passage, pillar, deck], [-8, 0, 2, 4, 6]));
    // One mesh, one draw call: unlit, fogged, see-through, writing no depth, pulled towards the eye.
    const shades = meshes(root).filter((m) => m.name === SEAM_SHADE);
    expect(shades).toHaveLength(1);
    const material = shades[0]!.material as THREE.MeshBasicMaterial;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect([material.transparent, material.depthWrite, material.polygonOffset, material.fog, material.vertexColors]).toEqual([true, false, true, true, true]);
    const pos = shades[0]!.geometry.getAttribute('position');
    const colour = shades[0]!.geometry.getAttribute('color');
    expect(colour.itemSize).toBe(4);
    /** Whether a dark vertex (the seam's edge of a strip) lies within `r` of (x, y, z). */
    const dark = (x: number, y: number, z: number, r = 0.2) => {
      for (let i = 0; i < pos.count; i++) if (colour.getW(i) > 0.5 && Math.hypot(pos.getX(i) - x, pos.getY(i) - y, pos.getZ(i) - z) < r) return true;
      return false;
    };
    // The Hall's wall bases and its roof's edge, the Passage's, the pillar's foot and top, and the Deck's underside against the Hall's Wall.
    expect(dark(5, 0, -10)).toBe(true);
    expect(dark(10, 0, -5)).toBe(true);
    expect(dark(5, 6, -10)).toBe(true);
    expect(dark(1.5, 0, 6)).toBe(true);
    expect(dark(-1.5, 4, 6)).toBe(true);
    expect(dark(-5, 0, -5.5)).toBe(true);
    expect(dark(-4.5, 6, -6)).toBe(true);
    expect(dark(-10, 2 - 0.45, -8.5)).toBe(true);
    // Its fade reaches half a metre out over the floor, clear there.
    let far = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) + 9.5) < 1e-3 && Math.abs(pos.getY(i)) < 0.01 && pos.getX(i) > 0) far = Math.max(far, colour.getW(i));
    expect(far).toBe(0);
    // Nothing across the doorway, on either side of it.
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (Math.abs(x) < 0.9 && Math.abs(z) < 0.6 && y < 3.5) expect(colour.getW(i)).toBe(0);
    }
    // Over deadly ground there is nothing to shade.
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeGreaterThan(-1);
  });
});
