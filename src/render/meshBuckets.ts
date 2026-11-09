import * as THREE from 'three';
import type { MaterialLook } from '../mapEditor/look';

/**
 * Triangles gathered by material, then made one mesh per material (a Map Editor map's model, `mapModel.ts`): a model of a few thousand
 * shapes is drawn in a dozen draw calls. Each triangle is flat (its own three vertices); the material is a plain one named as the look says
 * (`MaterialLook.name`), which is what the game's texturing reads once the model is loaded. Render-only.
 */
export class MeshBuckets {
  private readonly buckets = new Map<string, { look: MaterialLook; positions: number[] }>();

  private of(look: MaterialLook): number[] {
    let b = this.buckets.get(look.name);
    if (!b) {
      b = { look, positions: [] };
      this.buckets.set(look.name, b);
    }
    return b.positions;
  }

  /** A convex polygon (a triangle fan from its first corner). */
  polygon(look: MaterialLook, points: readonly THREE.Vector3Like[]): void {
    const out = this.of(look);
    for (let k = 1; k + 1 < points.length; k++) for (const p of [points[0]!, points[k]!, points[k + 1]!]) out.push(p.x, p.y, p.z);
  }

  /** A quadrilateral a, b, c, d (in order round it). */
  quad(look: MaterialLook, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like): void {
    this.polygon(look, [a, b, c, d]);
  }

  /** A box from (x0, y0, z0) to (x1, y1, z1), axis-aligned. */
  box(look: MaterialLook, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const v = (x: number, y: number, z: number) => ({ x, y, z });
    this.quad(look, v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1));
    this.quad(look, v(x0, y0, z0), v(x0, y0, z1), v(x1, y0, z1), v(x1, y0, z0));
    this.quad(look, v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0));
    this.quad(look, v(x0, y0, z1), v(x0, y1, z1), v(x1, y1, z1), v(x1, y0, z1));
    this.quad(look, v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1));
    this.quad(look, v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0));
  }

  /** A wall `thickness` thick, centred on the segment a-b, from `bottom` to `top`. */
  slab(look: MaterialLook, a: { x: number; z: number }, b: { x: number; z: number }, bottom: number, top: number, thickness: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (thickness / 2);
    const nz = (dx / len) * (thickness / 2);
    // Corners 0-3 at the bottom, 4-7 at the top; a then b, either side of the line.
    const c = (k: number) => {
      const end = k & 1 ? b : a;
      const side = k & 2 ? 1 : -1;
      return { x: end.x + side * nx, y: k & 4 ? top : bottom, z: end.z + side * nz };
    };
    for (const [p, q, r, s] of [
      [0, 1, 5, 4],
      [3, 2, 6, 7],
      [2, 0, 4, 6],
      [1, 3, 7, 5],
      [4, 5, 7, 6],
      [2, 3, 1, 0],
    ] as const)
      this.quad(look, c(p), c(q), c(r), c(s));
  }

  /** A three.js geometry (indexed or not, left as it was), placed by `matrix`. */
  geometry(look: MaterialLook, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
    const pos = g.getAttribute('position');
    const out = this.of(look);
    for (let i = 0; i < pos.count; i++) out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    g.dispose();
  }

  /** One mesh per material, in the order the materials were first used, each named as its material. */
  meshes(): THREE.Mesh[] {
    return [...this.buckets.values()]
      .filter((b) => b.positions.length > 0)
      .map(({ look, positions }) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ name: look.name, color: look.colour, roughness: 1, metalness: 0, side: THREE.DoubleSide });
        if (look.emissive) {
          material.emissive.set(look.emissive.colour);
          material.emissiveIntensity = look.emissive.strength;
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = look.name;
        return mesh;
      });
  }
}
