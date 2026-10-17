import * as THREE from 'three';
import type { ArenaGeometry } from '../tuning';

/** Walls lower than this (balustrades) do not stop the camera: it looks over and through them. */
const MIN_WALL_HEIGHT = 1.5;
/** How far short of what it hit the camera stops (m). */
const MARGIN = 0.25;

/**
 * Keeps the third-person camera inside the Arena: a ray from the pivot (over
 * the Fighter's shoulder) to where the camera wants to be, against a cheap
 * proxy of the Arena (its tall Walls and its Walk Surfaces, both sides). On a
 * hit, the camera is pulled in to just short of it. Render-only.
 */
export class CameraCollider {
  private readonly mesh: THREE.Mesh;
  private readonly ray = new THREE.Raycaster();
  private readonly dir = new THREE.Vector3();

  constructor(arena: ArenaGeometry) {
    const positions: number[] = [];
    const tri = (a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (const w of arena.walls) {
      if (w.top - w.bottom < MIN_WALL_HEIGHT) continue;
      const p = [
        { x: w.a.x, y: w.bottom, z: w.a.z },
        { x: w.b.x, y: w.bottom, z: w.b.z },
        { x: w.b.x, y: w.top, z: w.b.z },
        { x: w.a.x, y: w.top, z: w.a.z },
      ];
      tri(p[0]!, p[1]!, p[2]!);
      tri(p[0]!, p[2]!, p[3]!);
    }
    for (const s of arena.walk) for (let k = 1; k + 1 < s.points.length; k++) tri(s.points[0]!, s.points[k]!, s.points[k + 1]!);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.mesh.updateMatrixWorld(true);
  }

  /** Move `eye` (in place) towards `pivot` if the Arena stands between them. */
  pull(pivot: THREE.Vector3, eye: THREE.Vector3): void {
    this.dir.subVectors(eye, pivot);
    const length = this.dir.length();
    if (length < 1e-6) return;
    this.dir.divideScalar(length);
    this.ray.set(pivot, this.dir);
    this.ray.far = length;
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    if (hit) eye.copy(pivot).addScaledVector(this.dir, Math.max(0.05, hit.distance - MARGIN));
  }
}
