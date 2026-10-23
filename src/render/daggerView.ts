import * as THREE from 'three';
import { groundBelow, TICK_SECONDS, wallCrossing, type DaggerState, type FighterState, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import type { ArenaGeometry } from '../tuning';
import { bladeSteel } from './steel';
import { Ribbon, ribbonMaterial, type RibbonStyle } from './swingTrail';

/** How long (s) a dagger that stuck in a Wall or the floor stays drawn there. Render-only: the Simulation has already dropped it. */
export const STUCK_SECONDS = 2;

/** The ribbon a dagger in flight leaves, swept by its spinning blade: longer-lived than a swing's, as a dagger is small and fast. */
const TRAIL_STYLE: RibbonStyle = { life: 0.22, tipAlpha: 0.6, innerAlpha: 0.2, colour: new THREE.Color(0xf4f8ff) };

/** A Blocked dagger flies off (render-only, the Simulation has already dropped it): this fast back, sideways and up (m/s, min and max). */
const DEFLECT_BACK = [1.5, 3.5] as const;
const DEFLECT_SIDE = 3.5;
const DEFLECT_UP = [3, 5.5] as const;
/** How fast (turns per second, min and max) a Blocked dagger tumbles as it flies off. */
const DEFLECT_SPIN = [3, 6] as const;
const GRAVITY = 9.8;
/** How long (s) a Blocked dagger may fly before it is dropped, if it never lands (over an Abyss). */
const DEFLECT_MAX_SECONDS = 3;
/** How much of its speed a Blocked dagger keeps, bounced back off a Wall. */
const WALL_BOUNCE = 0.35;

/** Dagger dimensions (m): blade, then handle. */
const BLADE = 0.22;
const HANDLE = 0.1;
/**
 * Where a dagger's centre of mass sits (m along its blade from where blade meets handle): its steel blade outweighs the wooden
 * handle. A dagger in flight turns about this point, as a thrown one does.
 */
export const CENTRE_OF_MASS = 0.05;

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

/**
 * The velocity a dagger Blocked while flying at `incoming` flies off with: knocked back the way it came, up, and randomly to one side
 * (`random` gives numbers in [0, 1)). Render-only, so it need not match between peers.
 */
export function deflectVelocity(incoming: Vec3, random: () => number): Vec3 {
  const flat = Math.hypot(incoming.x, incoming.z);
  const angle = random() * 2 * Math.PI;
  // Back along where it came from; any way at all for a dagger that fell straight down.
  const bx = flat > 1e-6 ? -incoming.x / flat : Math.sin(angle);
  const bz = flat > 1e-6 ? -incoming.z / flat : Math.cos(angle);
  const back = DEFLECT_BACK[0] + (DEFLECT_BACK[1] - DEFLECT_BACK[0]) * random();
  const side = (random() * 2 - 1) * DEFLECT_SIDE;
  const up = DEFLECT_UP[0] + (DEFLECT_UP[1] - DEFLECT_UP[0]) * random();
  return { x: bx * back + bz * side, y: up, z: bz * back - bx * side };
}

/** Place a dagger mesh, already turned, so its centre of mass is at `centre`. */
export function placeByCentre(mesh: THREE.Object3D, centre: { x: number; y: number; z: number }): void {
  mesh.position.set(0, 0, -CENTRE_OF_MASS).applyQuaternion(mesh.quaternion).add(new THREE.Vector3(centre.x, centre.y, centre.z));
}

/** The ribbon edge of a dagger mesh: from where its blade meets the handle out to its tip. */
function daggerEdge(mesh: THREE.Object3D): { inner: Vec3; tip: Vec3 } {
  const tip = new THREE.Vector3(0, 0, BLADE).applyQuaternion(mesh.quaternion).add(mesh.position);
  return { inner: mesh.position.clone(), tip };
}

/** A Blocked dagger tumbling away under gravity until it lands (then it lies there for `STUCK_SECONDS`). */
interface Deflected {
  readonly mesh: THREE.Group;
  readonly trail: Ribbon;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  readonly axis: THREE.Vector3;
  /** Radians per second about `axis`. */
  readonly spin: number;
  /** Seconds since it was Blocked. */
  age: number;
}

/** Which dagger it is across Ticks: no two share an owner and a throw start. */
const key = (d: DaggerState): string => `${d.owner}:${d.thrownAt}`;

/**
 * Draws the Throwing Daggers: one held by its point in the left hand of each Fighter winding up a Throw, so its opponent can see it
 * coming; those in flight as small blades along their velocity, spinning end over end and interpolated between Ticks like the
 * Fighters, each leaving a fading trail like a swing's; each one that stuck at its `DaggerStuck` point for `STUCK_SECONDS`; and each
 * one Blocked tumbling away from its `DaggerBlocked` point, trailing, until it lands and lies there for `STUCK_SECONDS`. It only
 * reads the Simulation.
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
  /** Each dagger's trail, by its key: a dagger that stops flying leaves its trail to fade, then it goes. */
  private readonly trails = new Map<string, Ribbon>();
  private readonly trailMaterial = ribbonMaterial();
  private readonly deflected: Deflected[] = [];
  /** Trails of Blocked daggers that have landed, fading out. */
  private readonly fading: Ribbon[] = [];
  /** Effect time, seconds, for the trails. */
  private clock = 0;
  /** Called when a Blocked dagger lands, with where, for its clatter. */
  onClatter: ((point: Vec3) => void) | null = null;
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
   * `arena` is what a Blocked dagger flies off into: it lands on its Walk Surfaces and bounces off its Walls (without one, it falls
   * until it is dropped).
   */
  update(prev: SimState, curr: SimState, alpha: number, seconds: number, poses: readonly (SkeletonPose | undefined)[], arena?: ArenaGeometry): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    this.clock += dt;
    if (curr.tick < this.lastTick) this.clear();
    if (curr.tick !== this.lastTick) {
      // Each new Tick's `DaggerStuck` events plant a dagger once, however many frames draw that Tick.
      if (curr.tick > this.lastTick) for (const e of curr.events) {
        if (e.type === 'DaggerStuck') this.plant(e.point, e.direction);
        else if (e.type === 'DaggerHit') this.embed(embedAt(e.defender, e.point, curr.fighters[e.defender]!));
        else if (e.type === 'DaggerBlocked') this.deflect(e.point, this.incoming(prev, curr, e.thrower, e.defender));
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
      mesh.quaternion.setFromUnitVectors(FORWARD, new THREE.Vector3(d.velocity.x, d.velocity.y, d.velocity.z).normalize());
      mesh.quaternion.multiply(spin.setFromAxisAngle(SIDE, spinAngle(d.ticks, a - 1)));
      // The Simulation's dagger is a point: its centre of mass, which the blade spins about.
      placeByCentre(mesh, { x: from.x + (d.position.x - from.x) * a, y: from.y + (d.position.y - from.y) * a, z: from.z + (d.position.z - from.z) * a });
      let trail = this.trails.get(k);
      if (!trail) {
        trail = new Ribbon(this.trailMaterial, TRAIL_STYLE);
        this.trails.set(k, trail);
        this.root.add(trail.mesh);
      }
      trail.update(daggerEdge(mesh), this.clock);
    }
    for (const [k, mesh] of this.flying) {
      if (seen.has(k)) continue;
      this.root.remove(mesh);
      this.flying.delete(k);
    }
    for (const [k, trail] of this.trails) {
      if (seen.has(k)) continue;
      trail.update(null, this.clock);
      if (!trail.empty) continue;
      this.dropTrail(trail);
      this.trails.delete(k);
    }
    this.flyDeflected(dt, arena);

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

  /** The velocity `thrower`'s dagger had when `defender` Blocked it: from its last Tick in flight, or else straight from thrower to defender. */
  private incoming(prev: SimState, curr: SimState, thrower: number, defender: number): Vec3 {
    const flying = prev.daggers.filter((d) => d.owner === thrower && !curr.daggers.some((c) => key(c) === key(d)));
    const d = flying[flying.length - 1];
    if (d) return d.velocity;
    const from = curr.fighters[thrower]?.position;
    const to = curr.fighters[defender]?.position;
    return from && to ? { x: to.x - from.x, y: 0, z: to.z - from.z } : { x: 0, y: 0, z: 1 };
  }

  private deflect(point: Vec3, incoming: Vec3): void {
    const mesh = daggerMesh(this.shared);
    const velocity = deflectVelocity(incoming, Math.random);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const turns = DEFLECT_SPIN[0] + (DEFLECT_SPIN[1] - DEFLECT_SPIN[0]) * Math.random();
    mesh.quaternion.setFromUnitVectors(FORWARD, new THREE.Vector3(incoming.x, incoming.y, incoming.z).normalize());
    placeByCentre(mesh, point);
    const trail = new Ribbon(this.trailMaterial, TRAIL_STYLE);
    this.root.add(mesh, trail.mesh);
    this.deflected.push({
      mesh,
      trail,
      position: new THREE.Vector3(point.x, point.y, point.z),
      velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      axis: axis.normalize(),
      spin: 2 * Math.PI * turns * (Math.random() < 0.5 ? -1 : 1),
      age: 0,
    });
  }

  /** Move each Blocked dagger on by `dt` seconds: it tumbles, falls, bounces off Walls, and lies down where it lands. */
  private flyDeflected(dt: number, arena: ArenaGeometry | undefined): void {
    for (let i = this.deflected.length - 1; i >= 0; i--) {
      const f = this.deflected[i]!;
      f.age += dt;
      if (f.age > DEFLECT_MAX_SECONDS) {
        this.root.remove(f.mesh);
        this.dropTrail(f.trail);
        this.deflected.splice(i, 1);
        continue;
      }
      f.velocity.y -= GRAVITY * dt;
      const next = f.position.clone().addScaledVector(f.velocity, dt);
      if (arena && wallCrossing(f.position, next, arena)) {
        // Knocked back off the Wall, where it was.
        f.velocity.set(-f.velocity.x * WALL_BOUNCE, f.velocity.y, -f.velocity.z * WALL_BOUNCE);
        next.copy(f.position);
      }
      const ground = arena ? groundBelow(arena, next.x, next.z, f.position.y) : null;
      f.mesh.quaternion.premultiply(spin.setFromAxisAngle(f.axis, f.spin * dt));
      if (ground && next.y <= ground.y && f.velocity.y < 0) {
        // Landed: it lies flat on the floor, then fades like a stuck one.
        const lying = new THREE.Vector3(f.velocity.x, 0, f.velocity.z);
        if (lying.lengthSq() < 1e-6) lying.set(1, 0, 0);
        f.mesh.quaternion.setFromUnitVectors(FORWARD, lying.normalize());
        placeByCentre(f.mesh, { x: next.x, y: ground.y + 0.015, z: next.z });
        f.trail.update(null, this.clock);
        this.stuck.push({ mesh: f.mesh, left: STUCK_SECONDS });
        this.fading.push(f.trail);
        this.deflected.splice(i, 1);
        this.onClatter?.({ x: next.x, y: ground.y, z: next.z });
        continue;
      }
      f.position.copy(next);
      placeByCentre(f.mesh, next);
      f.trail.update(daggerEdge(f.mesh), this.clock);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const trail = this.fading[i]!;
      trail.update(null, this.clock);
      if (!trail.empty) continue;
      this.dropTrail(trail);
      this.fading.splice(i, 1);
    }
  }

  private dropTrail(trail: Ribbon): void {
    this.root.remove(trail.mesh);
    trail.dispose();
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
    for (const trail of this.trails.values()) this.dropTrail(trail);
    this.trails.clear();
    for (const f of this.deflected.splice(0)) {
      this.root.remove(f.mesh);
      this.dropTrail(f.trail);
    }
    for (const trail of this.fading.splice(0)) this.dropTrail(trail);
    // Sparse: only Fighters that have held a dagger have one.
    for (const mesh of this.held) if (mesh) mesh.visible = false;
  }
}
