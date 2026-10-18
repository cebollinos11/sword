import * as THREE from 'three';
import type { DaggerState, SimState } from '../sim';

/** How long (s) a dagger that stuck in a Wall or the floor stays drawn there. Render-only: the Simulation has already dropped it. */
export const STUCK_SECONDS = 2;

/** Dagger dimensions (m): blade, then handle. */
const BLADE = 0.22;
const HANDLE = 0.1;

const FORWARD = new THREE.Vector3(0, 0, 1);

/** A small dagger mesh pointing along +z, its tip at z = BLADE. Shares geometry and materials. */
function daggerMesh(shared: { blade: THREE.BufferGeometry; handle: THREE.BufferGeometry; steel: THREE.Material; wood: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(shared.blade, shared.steel);
  blade.rotation.x = Math.PI / 2;
  blade.position.z = BLADE / 2;
  const handle = new THREE.Mesh(shared.handle, shared.wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -HANDLE / 2;
  g.add(blade, handle);
  return g;
}

/** Which dagger it is across Ticks: no two share an owner and a throw start. */
const key = (d: DaggerState): string => `${d.owner}:${d.thrownAt}`;

/**
 * Draws the Throwing Daggers in flight as small blades along their velocity, interpolated between Ticks like the Fighters,
 * and leaves each one that stuck at its `DaggerStuck` point for `STUCK_SECONDS`. It only reads the Simulation.
 */
export class DaggerViews {
  private readonly root = new THREE.Group();
  private readonly shared = {
    // Cones point along +y; the meshes are rotated onto +z.
    blade: new THREE.ConeGeometry(0.018, BLADE, 4),
    handle: new THREE.CylinderGeometry(0.014, 0.014, HANDLE, 6),
    steel: new THREE.MeshLambertMaterial({ color: 0xd0d4d8, flatShading: true }),
    wood: new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true }),
  };
  private readonly flying = new Map<string, THREE.Group>();
  private readonly stuck: { mesh: THREE.Group; left: number }[] = [];
  private lastTick = -Infinity;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Draw the daggers between Tick `prev` and Tick `curr` (`alpha` in [0, 1]); `seconds` is the time since the last draw, for the stuck ones' fade. */
  update(prev: SimState, curr: SimState, alpha: number, seconds: number): void {
    if (curr.tick < this.lastTick) this.clear();
    if (curr.tick !== this.lastTick) {
      // Each new Tick's `DaggerStuck` events plant a dagger once, however many frames draw that Tick.
      if (curr.tick > this.lastTick) for (const e of curr.events) if (e.type === 'DaggerStuck') this.plant(e.point, e.direction);
      this.lastTick = curr.tick;
    }

    const before = new Map(prev.daggers.map((d) => [key(d), d]));
    const seen = new Set<string>();
    for (const d of curr.daggers) {
      const k = key(d);
      seen.add(k);
      let mesh = this.flying.get(k);
      if (!mesh) {
        mesh = daggerMesh(this.shared);
        this.flying.set(k, mesh);
        this.root.add(mesh);
      }
      const from = before.get(k)?.position ?? d.position;
      const a = before.has(k) ? alpha : 1;
      mesh.position.set(from.x + (d.position.x - from.x) * a, from.y + (d.position.y - from.y) * a, from.z + (d.position.z - from.z) * a);
      mesh.quaternion.setFromUnitVectors(FORWARD, new THREE.Vector3(d.velocity.x, d.velocity.y, d.velocity.z).normalize());
    }
    for (const [k, mesh] of this.flying) {
      if (seen.has(k)) continue;
      this.root.remove(mesh);
      this.flying.delete(k);
    }

    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i]!;
      s.left -= Math.min(0.1, Math.max(0, seconds));
      if (s.left <= 0) {
        this.root.remove(s.mesh);
        this.stuck.splice(i, 1);
      }
    }
  }

  private plant(point: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): void {
    const mesh = daggerMesh(this.shared);
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    // Its tip is in the surface: back the mesh off so only the handle and some blade show.
    mesh.position.set(point.x, point.y, point.z).addScaledVector(dir, BLADE * 0.4);
    mesh.quaternion.setFromUnitVectors(FORWARD, dir);
    this.root.add(mesh);
    this.stuck.push({ mesh, left: STUCK_SECONDS });
  }

  private clear(): void {
    for (const mesh of this.flying.values()) this.root.remove(mesh);
    this.flying.clear();
    for (const s of this.stuck.splice(0)) this.root.remove(s.mesh);
  }
}
