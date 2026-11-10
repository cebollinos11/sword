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
import { dressedSampleSource, sampleSource } from '../mapEditor/sample.testdata';
import type { MapSource } from '../mapEditor/source';
import { mapModel } from './mapModel';

const battle = loadTuningData().battle;
const modelOf = (s: MapSource) => mapModel(s, compileDraft(s, battle));
const meshes = (root: THREE.Object3D) => root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
const mesh = (root: THREE.Object3D, name: string) => meshes(root).find((m) => m.name === name);
const box = (m: THREE.Mesh) => new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute);

describe('the model of a Map Editor map', () => {
  it('is one mesh per material, each named as its material, the Brushes in theirs and the props in their own', () => {
    const root = modelOf(dressedSampleSource());
    expect(root.name).toBe(MAP_MODEL_ROOT);
    for (const m of meshes(root)) expect((m.material as THREE.Material).name).toBe(m.name);
    expect(meshes(root).map((m) => m.name).sort()).toEqual(
      ['Map_Grass', 'Map_BrickWall', 'Map_Cobble', 'Map_Wood', 'Map_Metal', 'Map_Lava', 'Map_Dirt', 'Map_Bark', 'Map_Leaf', 'Map_Rubble', 'Map_Banner0', 'Map_Banner1', 'Map_Banner', 'Map_Fire', 'Map_CrateWood'].sort(),
    );
    // Undressed, each Brush takes its kind's: the ground grass, the keep and the ramps stone, the bridge and its rails wood.
    expect(meshes(modelOf(sampleSource())).map((m) => m.name).sort()).toEqual(['Map_Dirt', 'Map_Grass', 'Map_Lava', 'Map_Stone', 'Map_Wood']);
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
});
