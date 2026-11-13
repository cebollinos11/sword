import * as THREE from 'three';
import type { FloorPlan } from '../sim/delver';
import type { RestUse } from '../sim';
import { fireState, RestFire, type FireState } from './restFire';

/** The Stairs zone's mark, gold as a Hall-graph Door's open zone. */
const STAIRS_COLOR = 0xffd56a;
const STAIRS_OPACITY = 0.45;
/** A fire's ring: warm while its heal is waiting for the local Player, dim once taken. */
const RING_LIT = 0xffb040;
const RING_SPENT = 0x6a5a48;
const RING_WIDTH = 0.12;
/** Drawn this far (m) over the ground, so the marks never flicker into it. */
const LIFT = 0.03;

/** What the Renderer draws a Delver Run's Floor marks from (`Renderer.setDelver`): the Floor's plan, its fires' use, the local Player and the heal radius. */
export interface DelverMarksView {
  readonly plan: FloorPlan;
  readonly restUsed: readonly RestUse[];
  /** The Fighter the local Player drives (-1: none). */
  readonly me: number;
  /** `delver.fireRadius` (m). */
  readonly fireRadius: number;
}

/** How each fire of the Floor burns for the local Player (plan order): lit until they are among those who took its heal, then embers. Render only. */
export const fireStates = (restUsed: readonly RestUse[], viewer: number): FireState[] => restUsed.map((u) => fireState(u.healed, viewer));

/**
 * Placeholder marks for a Delver Run's Floor (docs/plans/delver.md, Stage 2; Stage 5 brings the art): a flat gold square on the Stairs
 * zone, a `RestFire` at each fire with a flat ring of the heal radius round it (dimmed once the local Player has taken the heal).
 * Render only; rebuilt when the Floor changes. Nothing outside a Delver Run.
 */
export class DelverMarks {
  readonly root = new THREE.Group();
  private plan: FloorPlan | null = null;
  private radius = 0;
  private fires: RestFire[] = [];
  private rings: THREE.MeshBasicMaterial[] = [];
  private readonly owned: { dispose(): void }[] = [];

  /** Draw the marks of `view`'s Floor, or none for `null` (not a Delver Run). */
  update(view: DelverMarksView | null): void {
    if (!view) {
      if (this.plan) this.clear();
      return;
    }
    if (view.plan !== this.plan || view.fireRadius !== this.radius) this.build(view.plan, view.fireRadius);
    const states = fireStates(view.restUsed, view.me);
    this.fires.forEach((fire, k) => {
      const state = states[k] ?? 'lit';
      fire.setState(state);
      this.rings[k]?.color.setHex(state === 'lit' ? RING_LIT : RING_SPENT);
      if (this.rings[k]) this.rings[k]!.opacity = state === 'lit' ? 0.5 : 0.25;
    });
  }

  /** Flicker the fires, `seconds` of wall time after the last call. */
  animate(seconds: number): void {
    for (const fire of this.fires) fire.animate(seconds);
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  private clear(): void {
    for (const fire of this.fires) {
      this.root.remove(fire.root);
      fire.dispose();
    }
    this.fires = [];
    this.rings = [];
    for (const child of [...this.root.children]) this.root.remove(child);
    for (const r of this.owned) r.dispose();
    this.owned.length = 0;
    this.plan = null;
  }

  private build(plan: FloorPlan, radius: number): void {
    this.clear();
    this.plan = plan;
    this.radius = radius;
    const { zone } = plan.markers.stairs;
    const square = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(zone.x1 - zone.x0, zone.z1 - zone.z0)),
      this.own(new THREE.MeshBasicMaterial({ color: STAIRS_COLOR, transparent: true, opacity: STAIRS_OPACITY, side: THREE.DoubleSide, depthWrite: false })),
    );
    square.rotation.x = -Math.PI / 2;
    square.position.set((zone.x0 + zone.x1) / 2, LIFT, (zone.z0 + zone.z1) / 2);
    this.root.add(square);
    const ring = this.own(new THREE.RingGeometry(Math.max(0, radius - RING_WIDTH), radius, 48));
    for (const at of plan.markers.fires) {
      const fire = new RestFire({ x: at.x, y: 0, z: at.z });
      this.fires.push(fire);
      this.root.add(fire.root);
      const material = this.own(new THREE.MeshBasicMaterial({ color: RING_LIT, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      this.rings.push(material);
      const mesh = new THREE.Mesh(ring, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(at.x, LIFT, at.z);
      this.root.add(mesh);
    }
  }
}
