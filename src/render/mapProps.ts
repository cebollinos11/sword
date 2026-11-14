/**
 * The props of a Map Editor map (docs/plans/map-editor.md, Stage 5): a small set of low-poly models built here, in code, so a map needs no
 * Blender step and no file of its own beyond its model: a tree (a trunk under three cones of leaves), rubble (a heap of broken stones), a
 * banner (a pole and crossbar hung with a cloth, plain or in a Team's colour), crates (one, or two stacked) and a torch (a post, a cup and a
 * flame, the first few with a light). Each is laid into the map's model by material (`MeshBuckets`), so a hundred props add no draw call.
 * Render-only: a prop never reaches the compiled map.
 */
import * as THREE from 'three';
import { MAX_TORCH_LIGHTS, PROP_LOOKS, TORCH_LIGHT } from '../mapEditor/look';
import type { SourceProp } from '../mapEditor/source';
import type { MeshBuckets } from './meshBuckets';

/** A fixed number in [0, 1) for a prop (from its id), so each tree and heap differs from the next and the same map gives the same model. */
function vary(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/** The placement of a prop's part at (x, y, z) in the prop's frame, turned with it, scaled by `s`. */
function at(p: SourceProp, x: number, y: number, z: number, s: THREE.Vector3Like = { x: 1, y: 1, z: 1 }, spin = 0): THREE.Matrix4 {
  const turn = (p.turn * Math.PI) / 180;
  return new THREE.Matrix4()
    .makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationY(turn))
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeRotationY(spin))
    .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z));
}

/** Whether the crate prop `id` has a smaller crate stacked on top (every other one, by its id): the rule `placeProps` draws by, and the pedestal items stand by. */
export const crateStacked = (id: string): boolean => vary(id, 1) < 0.5;

/** Lay `props` into `buckets`, and return the torches' lights (the first MAX_TORCH_LIGHTS torches carry one, `LIGHT_torch_<n>`). */
export function placeProps(props: readonly SourceProp[], buckets: MeshBuckets): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  const shapes = {
    trunk: new THREE.CylinderGeometry(0.16, 0.26, 2.4, 7),
    cone: new THREE.ConeGeometry(1, 1, 8),
    stone: new THREE.DodecahedronGeometry(1, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    pole: new THREE.CylinderGeometry(0.06, 0.07, 1, 6),
    cloth: new THREE.PlaneGeometry(1, 1),
    flame: new THREE.OctahedronGeometry(1, 0),
  };
  for (const p of props) {
    const v = (k: number) => vary(p.id, k);
    switch (p.kind) {
      case 'tree': {
        const s = 0.8 + 0.5 * v(1);
        buckets.geometry(PROP_LOOKS.bark, shapes.trunk, at(p, 0, 1.2 * s, 0, { x: s, y: s, z: s }));
        // Three cones, each narrower and higher, each turned a little.
        [
          [2.2, 1.9, 1.8],
          [1.7, 1.6, 3.0],
          [1.1, 1.3, 4.0],
        ].forEach(([r, h, y], k) => buckets.geometry(PROP_LOOKS.leaf, shapes.cone, at(p, 0, y! * s, 0, { x: r! * s, y: h! * s, z: r! * s }, v(2 + k) * Math.PI)));
        break;
      }
      case 'rubble':
        // A heap of five stones within a metre and a half, squashed, the largest in the middle.
        for (let k = 0; k < 5; k++) {
          const r = k === 0 ? 0.75 : 0.3 + 0.35 * v(10 + k);
          const a = (k / 5) * 2 * Math.PI + v(20 + k);
          const d = k === 0 ? 0 : 0.7 + 0.6 * v(30 + k);
          buckets.geometry(PROP_LOOKS.rubble, shapes.stone, at(p, Math.cos(a) * d, r * 0.45, Math.sin(a) * d, { x: r, y: r * 0.65, z: r * (0.8 + 0.3 * v(40 + k)) }, v(50 + k) * Math.PI));
        }
        break;
      case 'crate':
        buckets.geometry(PROP_LOOKS.crate, shapes.box, at(p, 0, 0.6, 0, { x: 1.2, y: 1.2, z: 1.2 }));
        // Every other crate has a smaller one on top, askew.
        if (crateStacked(p.id)) buckets.geometry(PROP_LOOKS.crate, shapes.box, at(p, 0.1, 1.6, -0.05, { x: 0.8, y: 0.8, z: 0.8 }, 0.25 + 0.4 * v(2)));
        break;
      case 'banner': {
        const cloth = p.team === 0 ? PROP_LOOKS.banner0 : p.team === 1 ? PROP_LOOKS.banner1 : PROP_LOOKS.banner;
        buckets.geometry(PROP_LOOKS.pole, shapes.pole, at(p, 0, 2.5, 0, { x: 1, y: 5, z: 1 }));
        // The crossbar across the prop's facing, and the cloth hanging from it, facing north (along +z) when the prop is not turned.
        buckets.geometry(PROP_LOOKS.pole, shapes.pole, new THREE.Matrix4().multiplyMatrices(at(p, 0, 4.7, 0), new THREE.Matrix4().makeRotationZ(Math.PI / 2).scale(new THREE.Vector3(1, 1.5, 1))));
        buckets.geometry(cloth, shapes.cloth, at(p, 0, 3.55, 0.08, { x: 1.3, y: 2.3, z: 1 }));
        break;
      }
      case 'torch': {
        buckets.geometry(PROP_LOOKS.bark, shapes.pole, at(p, 0, 1.1, 0, { x: 1.4, y: 2.2, z: 1.4 }));
        buckets.geometry(PROP_LOOKS.pole, shapes.trunk, at(p, 0, 2.3, 0, { x: 0.9, y: 0.1, z: 0.9 }));
        buckets.geometry(PROP_LOOKS.fire, shapes.flame, at(p, 0, 2.55, 0, { x: 0.16, y: 0.32, z: 0.16 }, v(1)));
        if (lights.length < MAX_TORCH_LIGHTS) {
          const light = new THREE.PointLight(TORCH_LIGHT.color, TORCH_LIGHT.intensity, TORCH_LIGHT.distance, 1.6);
          light.name = `${TORCH_LIGHT.prefix}_${lights.length}`;
          light.position.set(p.x, p.y + 2.8, p.z);
          lights.push(light);
        }
        break;
      }
    }
  }
  for (const g of Object.values(shapes)) g.dispose();
  return lights;
}
