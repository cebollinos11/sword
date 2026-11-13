import * as THREE from 'three';
import type { FloorPlan } from '../sim/delver';
import type { CrowdState, RestUse } from '../sim';
import { gateOpen } from '../sim/delverRun';
import { fireState, RestFire, type FireState } from './restFire';
import { pedestalRings, StairsStandIn } from './delverStandIns';

/** A fire's ring: warm while its heal is waiting for the local Player, dim once taken. */
const RING_LIT = 0xffb040;
const RING_SPENT = 0x6a5a48;
const RING_WIDTH = 0.12;
/** Drawn this far (m) over the ground, so the marks never flicker into it. */
const LIFT = 0.03;

/** The Boss Hall's gate: iron grey bars, this high (m), this thick (m), this far apart (m) along the ring, standing this far (m) outside the Stairs square. */
const GATE_COLOR = 0x4a4540;
const GATE_HEIGHT = 2.4;
const GATE_BAR = 0.07;
const GATE_GAP = 0.55;
const GATE_MARGIN = 0.3;
/** The seconds the bars take to sink into the floor (and to rise again, were the gate shut anew). */
const GATE_SECONDS = 1.2;

/** A Boss Floor's gate as the Run shows it: none on any other Floor, closed until the Boss Warband is wiped, open after. */
export type GateState = 'none' | 'closed' | 'open';

/** The gate of the Floor `plan` (`gateOpen`, the rule of the Run: the Stairs count only once the Boss Warband is wiped). Pure; render only. */
export function gateState(plan: FloorPlan, crowd: CrowdState | undefined, wiped: readonly number[]): GateState {
  if (plan.halls[plan.stairs]?.kind !== 'Boss') return 'none';
  return crowd && gateOpen(plan, crowd, wiped) ? 'open' : 'closed';
}

/** How far down (0 standing, 1 sunk) the bars are `seconds` after they were `sink`, heading for `state`'s end. */
export function gateSink(sink: number, state: GateState, seconds: number): number {
  const step = seconds / GATE_SECONDS;
  return state === 'open' ? Math.min(1, sink + step) : Math.max(0, sink - step);
}

/** What the Renderer draws a Delver Run's Floor marks from (`Renderer.setDelver`): the Floor's plan, its fires' use, the local Player, the heal radius and the gate. */
export interface DelverMarksView {
  readonly plan: FloorPlan;
  /** The Boss Hall's gate (`gateState`); absent: none. */
  readonly gate?: GateState;
  readonly restUsed: readonly RestUse[];
  /** The Fighter the local Player drives (-1: none). */
  readonly me: number;
  /** `delver.fireRadius` (m). */
  readonly fireRadius: number;
}

/** How each fire of the Floor burns for the local Player (plan order): lit until they are among those who took its heal, then embers. Render only. */
export const fireStates = (restUsed: readonly RestUse[], viewer: number): FireState[] => restUsed.map((u) => fireState(u.healed, viewer));

/**
 * Stand-in marks for a Delver Run's Floor (docs/plans/delver.md, Stage 2; Stage 5's stand-ins until #62): the Stairs' pit (`StairsStandIn`),
 * a ring at each pedestal, a `RestFire` at each fire with a flat ring of the heal radius round it (dimmed once the local Player has taken the heal).
 * Render only; rebuilt when the Floor changes. Nothing outside a Delver Run.
 */
export class DelverMarks {
  readonly root = new THREE.Group();
  private plan: FloorPlan | null = null;
  private radius = 0;
  private fires: RestFire[] = [];
  /** The Stairs' stand-in (`delverStandIns.ts`), glowing while they count. */
  private stairs: StairsStandIn | null = null;
  private rings: THREE.MeshBasicMaterial[] = [];
  /** The gate's bars, one group, and how far down they are (0 to 1). */
  private gate: THREE.Group | null = null;
  private gateState: GateState = 'none';
  private sink = 0;
  private readonly owned: { dispose(): void }[] = [];

  /** Draw the marks of `view`'s Floor, or none for `null` (not a Delver Run). */
  update(view: DelverMarksView | null): void {
    if (!view) {
      if (this.plan) this.clear();
      return;
    }
    const gate = view.gate ?? 'none';
    if (view.plan !== this.plan || view.fireRadius !== this.radius) {
      this.build(view.plan, view.fireRadius, gate);
      this.sink = gate === 'open' ? 1 : 0;
    }
    this.gateState = gate;
    this.stairs?.setOpen(gate !== 'closed');
    this.showGate();
    const states = fireStates(view.restUsed, view.me);
    this.fires.forEach((fire, k) => {
      const state = states[k] ?? 'lit';
      fire.setState(state);
      fire.setSpent(view.restUsed[k]?.revived ?? false);
      this.rings[k]?.color.setHex(state === 'lit' ? RING_LIT : RING_SPENT);
      if (this.rings[k]) this.rings[k]!.opacity = state === 'lit' ? 0.5 : 0.25;
    });
  }

  /** Flicker the fires, `seconds` of wall time after the last call. */
  animate(seconds: number): void {
    for (const fire of this.fires) fire.animate(seconds);
    this.stairs?.animate(seconds);
    this.sink = gateSink(this.sink, this.gateState, seconds);
    this.showGate();
  }

  /** The gate's bars: stood while it is shut, sunk (and out of the scene's way) once it is open; none on another Floor. */
  private showGate(): void {
    if (!this.gate) return;
    this.gate.visible = this.gateState !== 'none' && this.sink < 1;
    this.gate.position.y = 0 - GATE_HEIGHT * this.sink;
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
    this.stairs?.dispose();
    this.stairs = null;
    this.rings = [];
    for (const child of [...this.root.children]) this.root.remove(child);
    for (const r of this.owned) r.dispose();
    this.owned.length = 0;
    this.gate = null;
    this.gateState = 'none';
    this.sink = 0;
    this.plan = null;
  }

  private build(plan: FloorPlan, radius: number, gate: GateState): void {
    this.clear();
    this.plan = plan;
    this.radius = radius;
    const { zone } = plan.markers.stairs;
    this.stairs = new StairsStandIn(zone);
    this.stairs.setOpen(gate !== 'closed');
    this.root.add(this.stairs.root);
    const rings = pedestalRings(plan.markers.pedestals);
    this.owned.push(...rings.owned);
    for (const ring of rings.meshes) this.root.add(ring);
    if (gate !== 'none') this.buildGate(zone);
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

  /** A ring of vertical bars round the Stairs square (placeholder; Stage 5 does the art). */
  private buildGate(zone: FloorPlan['markers']['stairs']['zone']): void {
    const x0 = zone.x0 - GATE_MARGIN;
    const x1 = zone.x1 + GATE_MARGIN;
    const z0 = zone.z0 - GATE_MARGIN;
    const z1 = zone.z1 + GATE_MARGIN;
    const group = new THREE.Group();
    group.name = 'gate';
    const geometry = this.own(new THREE.CylinderGeometry(GATE_BAR, GATE_BAR, GATE_HEIGHT, 6));
    const material = this.own(new THREE.MeshLambertMaterial({ color: GATE_COLOR, flatShading: true }));
    const bar = (x: number, z: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, GATE_HEIGHT / 2, z);
      group.add(mesh);
    };
    const along = (from: number, to: number) => Math.max(1, Math.round((to - from) / GATE_GAP));
    const nx = along(x0, x1);
    const nz = along(z0, z1);
    // Each side from its first corner to just short of the next, so no corner holds two bars.
    for (let i = 0; i < nx; i++) {
      bar(x0 + ((x1 - x0) * i) / nx, z0);
      bar(x1 - ((x1 - x0) * i) / nx, z1);
    }
    for (let i = 0; i < nz; i++) {
      bar(x1, z0 + ((z1 - z0) * i) / nz);
      bar(x0, z1 - ((z1 - z0) * i) / nz);
    }
    this.gate = group;
    this.root.add(group);
  }
}
