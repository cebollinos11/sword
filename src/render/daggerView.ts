import * as THREE from 'three';
import { TICK_SECONDS, type DaggerState, type FighterState, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import { bladeSteel } from './steel';

/** How long (s) a dagger that stuck in a Wall or the floor stays drawn there. Render-only: the Simulation has already dropped it. */
export const STUCK_SECONDS = 2;

/** Dagger dimensions (m): blade, then handle. */
const BLADE = 0.22;
const HANDLE = 0.1;

/** Where a dagger that Hit a Fighter sits on it, in the Fighter's own frame (x right of its facing, z ahead), so it moves and turns with the body. */
export interface Embed {
  readonly defender: number;
  /** Offset from the Fighter's feet, rotated by minus its facing. */
  readonly local: { x: number; y: number; z: number };
}

/** The `DaggerHit` point as an offset in the defender's frame. */
export function embedAt(defender: number, point: Vec3, fighter: Pick<FighterState, 'position' | 'y' | 'facing'>): Embed {
  const dx = point.x - fighter.position.x;
  const dz = point.z - fighter.position.z;
  const c = Math.cos(fighter.facing);
  const s = Math.sin(fighter.facing);
  return { defender, local: { x: dx * c - dz * s, y: point.y - fighter.y, z: dx * s + dz * c } };
}

/** The same offset back in the world, for the Fighter as it stands now. */
export function embedPosition(e: Embed, fighter: Pick<FighterState, 'position' | 'y' | 'facing'>): Vec3 {
  const c = Math.cos(fighter.facing);
  const s = Math.sin(fighter.facing);
  return { x: fighter.position.x + e.local.x * c + e.local.z * s, y: fighter.y + e.local.y, z: fighter.position.z - e.local.x * s + e.local.z * c };
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const spin = new THREE.Quaternion();
const SIDE = new THREE.Vector3(1, 0, 0);

/** How fast (turns per second) a dagger in flight spins end over end, as a dagger thrown by its point does. Render-only. */
export const SPIN_TURNS_PER_SECOND = 2.5;

/**
 * How far (radians) a dagger `ticks` (and `alpha` of one more) into its flight has turned end over end about its side, from leaving
 * the hand handle first (pi): the tip goes back, up and over toward the front, as an overhand throw spins it.
 */
export const spinAngle = (ticks: number, alpha = 0): number => Math.PI + 2 * Math.PI * SPIN_TURNS_PER_SECOND * (ticks + alpha) * TICK_SECONDS;

/** How far (m) past the wrist, along the forearm, the point sits in the hand: the blade lies along the fingers, the handle sticks out past them. */
const PINCH = 0.03;

/**
 * A dagger held by its point in the left hand of `pose`: its tip a little past the wrist and the blade pointing back down the forearm,
 * so the handle stands out beyond the fingers. `origin` is where the mesh's blade meets its handle; `tip` the way its point faces.
 */
export function heldDagger(pose: SkeletonPose): { origin: Vec3; tip: Vec3 } {
  const { leftHand: h, leftElbow: e } = pose.joints;
  const fx = h.x - e.x;
  const fy = h.y - e.y;
  const fz = h.z - e.z;
  const len = Math.hypot(fx, fy, fz) || 1;
  const out = { x: fx / len, y: fy / len, z: fz / len };
  const reach = PINCH + BLADE;
  return { origin: { x: h.x + out.x * reach, y: h.y + out.y * reach, z: h.z + out.z * reach }, tip: { x: -out.x, y: -out.y, z: -out.z } };
}

/** Whether Fighter `f` has a dagger in its hand to show: it is winding up a Throw (from Release on, the dagger is in flight). */
export const holdsDagger = (f: FighterState): boolean => !f.death && f.action.kind === 'Throw' && f.action.phase === 'Wind-up';

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
 * Draws the Throwing Daggers: one held by its point in the left hand of each Fighter winding up a Throw, so its opponent can see it
 * coming; those in flight as small blades along their velocity, spinning end over end and interpolated between Ticks like the
 * Fighters; and each one that stuck at its `DaggerStuck` point for `STUCK_SECONDS`. It only reads the Simulation.
 */
export class DaggerViews {
  private readonly root = new THREE.Group();
  private readonly shared = {
    // Cones point along +y; the meshes are rotated onto +z.
    blade: new THREE.ConeGeometry(0.018, BLADE, 4),
    handle: new THREE.CylinderGeometry(0.014, 0.014, HANDLE, 6),
    steel: bladeSteel(),
    wood: new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true }),
  };
  private readonly flying = new Map<string, THREE.Group>();
  private readonly stuck: { mesh: THREE.Group; left: number }[] = [];
  /** Daggers sticking out of a Fighter for as long as its Slow lasts (render-only, from `DaggerHit` and `slow`). */
  private readonly embedded: { embed: Embed; mesh: THREE.Group }[] = [];
  /** The dagger in each Fighter's hand, by Fighter index (made on first use, hidden when it holds none). */
  private readonly held: THREE.Group[] = [];
  private lastTick = -Infinity;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /**
   * Draw the daggers between Tick `prev` and Tick `curr` (`alpha` in [0, 1]); `seconds` is the time since the last draw, for the stuck
   * ones' fade. `poses` are the Fighters' poses as drawn this frame, for the daggers in their hands (none for a Fighter not drawn).
   */
  update(prev: SimState, curr: SimState, alpha: number, seconds: number, poses: readonly (SkeletonPose | undefined)[]): void {
    if (curr.tick < this.lastTick) this.clear();
    if (curr.tick !== this.lastTick) {
      // Each new Tick's `DaggerStuck` events plant a dagger once, however many frames draw that Tick.
      if (curr.tick > this.lastTick) for (const e of curr.events) {
        if (e.type === 'DaggerStuck') this.plant(e.point, e.direction);
        else if (e.type === 'DaggerHit') this.embed(embedAt(e.defender, e.point, curr.fighters[e.defender]!));
      }
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
      mesh.quaternion.multiply(spin.setFromAxisAngle(SIDE, spinAngle(d.ticks, a - 1)));
    }
    for (const [k, mesh] of this.flying) {
      if (seen.has(k)) continue;
      this.root.remove(mesh);
      this.flying.delete(k);
    }

    for (let i = 0; i < Math.max(this.held.length, curr.fighters.length); i++) {
      const f = curr.fighters[i];
      const pose = poses[i];
      const holding = f !== undefined && pose !== undefined && holdsDagger(f);
      let mesh = this.held[i];
      if (!holding) {
        if (mesh) mesh.visible = false;
        continue;
      }
      if (!mesh) {
        mesh = daggerMesh(this.shared);
        this.held[i] = mesh;
        this.root.add(mesh);
      }
      const { origin, tip } = heldDagger(pose);
      mesh.visible = true;
      mesh.position.set(origin.x, origin.y, origin.z);
      mesh.quaternion.setFromUnitVectors(FORWARD, new THREE.Vector3(tip.x, tip.y, tip.z));
    }

    for (let i = this.embedded.length - 1; i >= 0; i--) {
      const { embed, mesh } = this.embedded[i]!;
      const was = prev.fighters[embed.defender];
      const now = curr.fighters[embed.defender];
      // Gone with the Slow (or the Duel): only the newest dagger in a Fighter stays while the Slow is refreshed.
      if (!now?.slow || this.embedded.some((o, j) => j > i && o.embed.defender === embed.defender)) {
        this.root.remove(mesh);
        this.embedded.splice(i, 1);
        continue;
      }
      const at = embedPosition(embed, now);
      const from = was ? embedPosition(embed, was) : at;
      mesh.position.set(from.x + (at.x - from.x) * alpha, from.y + (at.y - from.y) * alpha, from.z + (at.z - from.z) * alpha);
      // The tip points into the body: from the surface toward the Fighter's axis, in the Fighter's frame.
      const inward = new THREE.Vector3(now.position.x - at.x, 0, now.position.z - at.z);
      if (inward.lengthSq() > 1e-6) mesh.quaternion.setFromUnitVectors(FORWARD, inward.normalize());
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

  private embed(embed: Embed): void {
    const mesh = daggerMesh(this.shared);
    this.root.add(mesh);
    this.embedded.push({ embed, mesh });
  }

  private clear(): void {
    for (const e of this.embedded.splice(0)) this.root.remove(e.mesh);
    for (const mesh of this.flying.values()) this.root.remove(mesh);
    this.flying.clear();
    for (const s of this.stuck.splice(0)) this.root.remove(s.mesh);
    // Sparse: only Fighters that have held a dagger have one.
    for (const mesh of this.held) if (mesh) mesh.visible = false;
  }
}
