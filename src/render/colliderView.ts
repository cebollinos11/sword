import * as THREE from 'three';
import type { ArenaGeometry, WalkSurface } from '../tuning';

/** Walk Surface colours by kind: plain ground, lava, water. */
const WALK_COLORS = { plain: 0x3ddc4a, lava: 0xff3020, water: 0x2a7bff } as const;
const WALL_COLOR = 0xff9020;
const WALK_OPACITY = 0.5;
const WALL_OPACITY = 0.35;
/** Drawn after the Arena's model (and the snow). */
const RENDER_ORDER = 10;

type WalkKind = keyof typeof WALK_COLORS;

const kindOf = (s: WalkSurface): WalkKind => (s.lava ? 'lava' : s.water ? 'water' : 'plain');

/** The Walk Surfaces as triangle fans (x, y, z per vertex), `lift` metres up. */
export function walkFans(surfaces: readonly WalkSurface[], lift = 0): number[] {
  const positions: number[] = [];
  for (const s of surfaces) {
    const p = s.points;
    for (let k = 1; k + 1 < p.length; k++) for (const q of [p[0]!, p[k]!, p[k + 1]!]) positions.push(q.x, q.y + lift, q.z);
  }
  return positions;
}

const overlay = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false });

const outline = (color: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false });

function mesh(name: string, positions: number[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.renderOrder = RENDER_ORDER;
  return m;
}

function lines(name: string, positions: number[], material: THREE.Material): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const l = new THREE.LineSegments(geometry, material);
  l.name = name;
  l.renderOrder = RENDER_ORDER + 1;
  return l;
}

/**
 * The Arena's collision geometry, to see where it is (a developer view, `?dev=1`): its
 * Walk Surfaces as see-through fans coloured by kind (`walk-plain`, `walk-lava`, `walk-water`)
 * and its Walls as orange quads from bottom to top (`walls`), each with its outline
 * (`…-edges`). Kinds with nothing in them are left out. Render-only.
 */
export function colliderView(arena: ArenaGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = 'colliders';
  for (const kind of Object.keys(WALK_COLORS) as WalkKind[]) {
    const surfaces = arena.walk.filter((s) => kindOf(s) === kind);
    if (surfaces.length === 0) continue;
    // A couple of centimetres up, so it shows over the model's floor.
    const lift = 0.02;
    group.add(mesh(`walk-${kind}`, walkFans(surfaces, lift), overlay(WALK_COLORS[kind], WALK_OPACITY)));
    const edges: number[] = [];
    for (const s of surfaces) {
      const p = s.points;
      for (let k = 0; k < p.length; k++) {
        const a = p[k]!;
        const b = p[(k + 1) % p.length]!;
        edges.push(a.x, a.y + lift, a.z, b.x, b.y + lift, b.z);
      }
    }
    group.add(lines(`walk-${kind}-edges`, edges, outline(WALK_COLORS[kind])));
  }
  if (arena.walls.length > 0) {
    const quads: number[] = [];
    const edges: number[] = [];
    for (const w of arena.walls) {
      const c = [
        [w.a.x, w.bottom, w.a.z],
        [w.b.x, w.bottom, w.b.z],
        [w.b.x, w.top, w.b.z],
        [w.a.x, w.top, w.a.z],
      ] as const;
      for (const k of [0, 1, 2, 0, 2, 3]) quads.push(...c[k]!);
      for (let k = 0; k < 4; k++) edges.push(...c[k]!, ...c[(k + 1) % 4]!);
    }
    group.add(mesh('walls', quads, overlay(WALL_COLOR, WALL_OPACITY)));
    group.add(lines('walls-edges', edges, outline(WALL_COLOR)));
  }
  return group;
}

/** How see-through an Arena's model is drawn under the collider view. */
const SEE_THROUGH_OPACITY = 0.3;

/** Draw `model`'s Lambert materials dithered see-through (alpha hashing: no sorting needed), or solid again. */
export function seeThrough(model: THREE.Object3D, on: boolean): void {
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshLambertMaterial) || m.alphaHash === on) continue;
      m.alphaHash = on;
      m.opacity = on ? SEE_THROUGH_OPACITY : 1;
      m.needsUpdate = true;
    }
  });
}
