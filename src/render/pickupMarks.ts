import * as THREE from 'three';

const WEAPON_COLOR = 0x9fd0ff;
const RELIC_COLOR = 0xffb0f0;
/** The marker's height over the ground (m) and its size. */
const HOVER = 0.45;
const SIZE = 0.22;

/** One pickup to draw: where it lies and what kind. */
export interface PickupPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: 'weapon' | 'relic';
}

/**
 * Placeholder markers for the pickups lying in a Run's Hall (docs/plans/dungeon.md, Stage 2; Stage 3 brings the art): a small spinning
 * diamond over each, blue for a Weapon and pink for a Relic. Render only; the caller passes the ones the local Player sees
 * (`pickupVisibleTo`), so a taken pickup is simply not in the list. The spin follows the frames drawn, never the Simulation.
 */
export class PickupMarks {
  readonly root = new THREE.Group();
  private readonly geometry = new THREE.OctahedronGeometry(SIZE);
  private readonly materials = {
    weapon: new THREE.MeshBasicMaterial({ color: WEAPON_COLOR }),
    relic: new THREE.MeshBasicMaterial({ color: RELIC_COLOR }),
  };
  private meshes: THREE.Mesh[] = [];

  /** Show a marker at each of `points`, `seconds` of wall time after the last call. */
  update(points: readonly PickupPoint[], seconds: number): void {
    while (this.meshes.length < points.length) {
      const mesh = new THREE.Mesh(this.geometry, this.materials.weapon);
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
    this.meshes.forEach((mesh, i) => {
      const p = points[i];
      mesh.visible = p !== undefined;
      if (!p) return;
      mesh.material = this.materials[p.kind];
      mesh.position.set(p.x, p.y + HOVER, p.z);
      mesh.rotation.y += seconds * 2;
    });
  }
}
