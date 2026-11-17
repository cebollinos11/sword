/**
 * Stand-in art for a Delver Floor's Stairs and pedestals (docs/plans/delver.md, Stage 5), until the Kit's models land (issue #62): a dark
 * stepped pit with a glowing square for the Stairs (dull red while a Boss Floor's gate is shut), and a gold ring on the ground round each
 * pedestal. Fires are `RestFire` (its flame shrinks once the fire's revive is spent) and a pedestal's item is `pickupView`'s, so neither is
 * made here. One small module, so the real art can replace it whole. Render only.
 */
import * as THREE from 'three';
import type { Rect } from '../mapEditor/source';
import type { MarkerPoint } from '../sim/delver/plan';

/** The pit's steps, outermost first: each is this share of the zone's side, drawn this dark. */
const STEPS: readonly { readonly side: number; readonly color: number }[] = [
  { side: 1, color: 0x2a2630 },
  { side: 0.78, color: 0x1c1922 },
  { side: 0.56, color: 0x100e14 },
];
const GLOW_OPEN = 0xffd56a;
const GLOW_SHUT = 0x7a3a30;
const PLINTH_COLOR = 0xc9a24a;
/** Drawn this far (m) over the ground, one more for each layer, so the layers never flicker into each other. */
const LIFT = 0.03;
const LAYER = 0.012;
/** The plinth ring's radii (m). */
const PLINTH_INNER = 0.55;
const PLINTH_OUTER = 0.7;

/** The Stairs' stand-in: steps and a glowing square that pulses while the Stairs are open. `root` is added to the scene by its owner, which disposes it. */
export class StairsStandIn {
  readonly root = new THREE.Group();
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly owned: { dispose(): void }[] = [];
  private open = true;
  private clock = 0;

  /** `y` is the floor the Stairs stand on (the plan's `stairs.y`, m); the layers sit over it. */
  constructor(zone: Rect, y = 0) {
    const w = zone.x1 - zone.x0;
    const d = zone.z1 - zone.z0;
    this.root.position.set((zone.x0 + zone.x1) / 2, y, (zone.z0 + zone.z1) / 2);
    STEPS.forEach((step, i) => {
      const mesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w * step.side, d * step.side)), this.own(new THREE.MeshBasicMaterial({ color: step.color })));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LIFT + LAYER * i;
      this.root.add(mesh);
    });
    this.glow = this.own(new THREE.MeshBasicMaterial({ color: GLOW_OPEN, transparent: true, opacity: 0.85, depthWrite: false }));
    const centre = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w * 0.3, d * 0.3)), this.glow);
    centre.rotation.x = -Math.PI / 2;
    centre.position.y = LIFT + LAYER * STEPS.length;
    this.root.add(centre);
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  /** Whether the Stairs count: gold and pulsing, else a dull red (a Boss Floor's gate is shut). */
  setOpen(open: boolean): void {
    this.open = open;
    this.glow.color.setHex(open ? GLOW_OPEN : GLOW_SHUT);
    if (!open) this.glow.opacity = 0.5;
  }

  /** Pulse the glow, `seconds` of wall time after the last call. */
  animate(seconds: number): void {
    this.clock += seconds;
    if (this.open) this.glow.opacity = 0.65 + 0.25 * Math.sin(this.clock * 3);
  }

  dispose(): void {
    for (const r of this.owned) r.dispose();
    this.owned.length = 0;
  }
}

/** A gold ring on the floor at each pedestal point, at the marker's own height `y` (the item itself stands on its crate, as `pickupView` draws it). Returns the meshes (add them to a group) and what to dispose. */
export function pedestalRings(points: readonly (Pick<MarkerPoint, 'x' | 'z'> & { readonly y?: number })[]): { readonly meshes: THREE.Mesh[]; readonly owned: { dispose(): void }[] } {
  const geometry = new THREE.RingGeometry(PLINTH_INNER, PLINTH_OUTER, 24);
  const material = new THREE.MeshBasicMaterial({ color: PLINTH_COLOR, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  const meshes = points.map((p) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, (p.y ?? 0) + LIFT, p.z);
    return mesh;
  });
  return { meshes, owned: [geometry, material] };
}
