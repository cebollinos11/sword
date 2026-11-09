/**
 * Blood: when a Fighter is Hit, droplets spray out of the wound away from the attacker and fly until they strike the
 * environment (the floor, or a Wall), where each leaves a stain that stays for the rest of the Match. Like the other impact
 * effects it lives outside the Simulation and only listens to its events (ADR 0001); which spurt each event makes is pure.
 *
 * Cheap by construction: every flying droplet is one point in a single `THREE.Points` draw, every stain one instance of a single
 * `InstancedMesh` (a ring buffer: past `MAX_STAINS` the oldest are overwritten), both preallocated, so a bloody Battle costs two
 * draw calls and no per-frame allocation.
 */
import * as THREE from 'three';
import { arenaOf, battlefieldHeight, battlefieldOf, deadlyGround, groundBelow, wallHit, type Heightfield, type SimState, type Vec3 } from '../sim';
import type { ArenaGeometry, TuningData } from '../tuning';

/** Blood sprayed by one Hit: where, which way (a unit vector on the floor plane: from the attacker through the defender) and how much. */
export interface BloodSpurt {
  readonly point: Vec3;
  readonly dir: { readonly x: number; readonly z: number };
  /** 0..1: a Heavy Blow's Hit is 1. */
  readonly strength: number;
  /** The defender's feet: the floor to land on when the Arena's geometry is unknown. */
  readonly floorY: number;
}

/** A Hit of this much damage sprays at full strength (a head Hit with repo Tuning Data: 5 x the head multiplier). */
const FULL_DAMAGE = 15;

/** The blood sprayed by one Tick's events, in event order: a Hit or a Dagger Hit sprays from the wound, away from whoever struck it. */
export function bloodSpurts(duel: Pick<SimState, 'events' | 'fighters'>): BloodSpurt[] {
  const spurts: BloodSpurt[] = [];
  for (const e of duel.events) {
    if (e.type !== 'Hit' && e.type !== 'DaggerHit') continue;
    if (e.damage <= 0) continue;
    const from = duel.fighters[e.type === 'Hit' ? e.attacker : e.thrower];
    const to = duel.fighters[e.defender];
    if (!from || !to) continue;
    let x = to.position.x - from.position.x;
    let z = to.position.z - from.position.z;
    const len = Math.hypot(x, z);
    if (len < 1e-6) {
      x = 0;
      z = 1;
    } else {
      x /= len;
      z /= len;
    }
    const strength = e.type === 'Hit' && e.heavy ? 1 : Math.min(1, Math.max(0.3, e.damage / FULL_DAMAGE));
    spurts.push({ point: e.point, dir: { x, z }, strength, floorY: to.y });
  }
  return spurts;
}

/** Most droplets in flight at once (a spurt that finds the pool full is thinned or skipped, so a huge Battle cannot swamp the frame). */
const MAX_DROPLETS = 512;
/** Most stains kept: past this the oldest are overwritten. */
const MAX_STAINS = 2500;
/** Droplets per spurt at full strength. */
const DROPLETS = 14;
/** A droplet that has not landed after this long (s) is dropped. */
const DROPLET_LIFE = 2;
const GRAVITY = 9.5;
/** Droplet speed at full strength, m/s. */
const SPEED = 5.5;
/** Droplet size in the world, metres. */
const DROPLET_SIZE = 0.075;
/** A stain's side at full strength, metres (the sprite is a cluster of splats, so it reads bigger than its square). */
const STAIN_SIZE = 3.55;
/** How far a stain floats off its surface so it does not z-fight. */
const LIFT = 0.012;
/** The share of landing droplets that leave a stain (the rest are too small to show). */
const STAIN_CHANCE = 0.75;

const BLOOD_COLOUR = new THREE.Color(0x8a0b0b);

const FORWARD = new THREE.Vector3(0, 0, 1);

/** What a droplet can strike: the Arena's floor and Walls, for the Arena the Duel is fought in. */
interface World {
  readonly arena: ArenaGeometry;
  /** An open-field Battlefield's heightfield (its ground is drawn from this, not from Walk Surfaces); null otherwise. */
  readonly field: Heightfield | null;
}

/** A round soft dot, the sprite of a droplet in flight. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BloodEffects {
  private readonly root = new THREE.Group();
  private readonly pos = new Float32Array(MAX_DROPLETS * 3);
  private readonly col = new Float32Array(MAX_DROPLETS * 3);
  private readonly vel = new Float32Array(MAX_DROPLETS * 3);
  private readonly life = new Float32Array(MAX_DROPLETS);
  /** Each droplet's fallback floor when no Arena geometry is known. */
  private readonly floor = new Float32Array(MAX_DROPLETS);
  private live = 0;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly stains: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private stained = 0;
  private nextStain = 0;
  private stainsDirty = false;
  private world: World | null = null;
  private arenaName: string | null = null;

  // Scratch, so a frame allocates nothing.
  private readonly from = { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number };
  private readonly to = { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number };
  private readonly normal = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private readonly size = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly tint = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly tuning: TuningData,
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: DROPLET_SIZE, sizeAttenuation: true, vertexColors: true, map: dotTexture(), alphaTest: 0.5, transparent: false }),
    );
    this.points.frustumCulled = false;

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/blood.png`, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
    });
    this.stains = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, MAX_STAINS);
    this.stains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stains.count = 0;
    this.stains.frustumCulled = false;
    this.stains.renderOrder = 1;
    this.root.add(this.stains, this.points);
    scene.add(this.root);
  }

  /** Spray `spurt`: droplets fan out away from the attacker, up and down, with a spread. */
  spurt(spurt: BloodSpurt): void {
    const n = Math.round(DROPLETS * (0.4 + 0.6 * spurt.strength));
    for (let k = 0; k < n && this.live < MAX_DROPLETS; k++) {
      const i = this.live++;
      const speed = SPEED * (0.35 + 0.65 * spurt.strength) * (0.35 + 0.65 * Math.random());
      // Mostly along the blow, fanned sideways and up.
      const side = (Math.random() - 0.5) * 1.1;
      const dx = spurt.dir.x - spurt.dir.z * side;
      const dz = spurt.dir.z + spurt.dir.x * side;
      const norm = 1 / Math.hypot(dx, dz);
      this.pos[i * 3] = spurt.point.x;
      this.pos[i * 3 + 1] = spurt.point.y;
      this.pos[i * 3 + 2] = spurt.point.z;
      this.vel[i * 3] = dx * norm * speed;
      this.vel[i * 3 + 1] = (Math.random() - 0.3) * 0.5 * speed + 0.6;
      this.vel[i * 3 + 2] = dz * norm * speed;
      this.life[i] = DROPLET_LIFE;
      this.floor[i] = spurt.floorY;
      const shade = 0.55 + 0.45 * Math.random();
      this.col[i * 3] = BLOOD_COLOUR.r * shade;
      this.col[i * 3 + 1] = BLOOD_COLOUR.g * shade;
      this.col[i * 3 + 2] = BLOOD_COLOUR.b * shade;
    }
  }

  /** The Duel is in Arena `name` now: a different one is a new place (nothing carries over), and its floor and Walls are looked up afresh. */
  setArena(name: string | undefined): void {
    if (name === undefined || name === this.arenaName) return;
    this.arenaName = name;
    this.clear();
    this.world = null;
    try {
      const field = this.tuning.battle ? battlefieldOf(this.tuning.battle, name) : null;
      this.world = { arena: arenaOf(this.tuning, name), field: field && !field.heights.walk ? field.heights : null };
    } catch {
      // An Arena this Tuning Data does not hold (a Generated Arena's Kit lives elsewhere): droplets land on the Fighter's floor.
    }
  }

  /** The loop jumped: what is flying is gone. Rewinding (to an earlier Tick) also washes the stains, which the replay lays down again. */
  seek(rewound: boolean): void {
    this.live = 0;
    this.points.geometry.setDrawRange(0, 0);
    if (rewound) this.clearStains();
  }

  clear(): void {
    this.seek(true);
  }

  private clearStains(): void {
    this.stained = this.nextStain = 0;
    this.stains.count = 0;
    this.stainsDirty = false;
  }

  /** Advance the droplets by `seconds`, laying a stain where each strikes the environment. */
  update(seconds: number): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    if (dt > 0) {
      for (let i = this.live - 1; i >= 0; i--) {
        if (this.advance(i, dt)) this.drop(i);
      }
      this.points.geometry.setDrawRange(0, this.live);
      this.points.geometry.attributes.position!.needsUpdate = true;
      this.points.geometry.attributes.color!.needsUpdate = true;
    }
    if (this.stainsDirty) {
      this.stains.instanceMatrix.needsUpdate = true;
      if (this.stains.instanceColor) this.stains.instanceColor.needsUpdate = true;
      this.stainsDirty = false;
    }
  }

  /** Move droplet `i`; true when it is spent (landed or timed out). */
  private advance(i: number, dt: number): boolean {
    const p = this.pos;
    const v = this.vel;
    this.life[i]! -= dt;
    if (this.life[i]! <= 0) return true;
    v[i * 3 + 1]! -= GRAVITY * dt;
    const { from, to } = this;
    from.x = p[i * 3]!;
    from.y = p[i * 3 + 1]!;
    from.z = p[i * 3 + 2]!;
    to.x = from.x + v[i * 3]! * dt;
    to.y = from.y + v[i * 3 + 1]! * dt;
    to.z = from.z + v[i * 3 + 2]! * dt;

    const world = this.world;
    const wall = world ? wallHit(from, to, world.arena) : null;
    if (wall) {
      const w = wall.wall;
      this.normal.set(-(w.b.z - w.a.z), 0, w.b.x - w.a.x).normalize();
      // The face the droplet came from.
      if (this.normal.x * (from.x - wall.point.x) + this.normal.z * (from.z - wall.point.z) < 0) this.normal.negate();
      this.stain(wall.point.x, wall.point.y, wall.point.z, this.normal.x, 0, this.normal.z);
      return true;
    }
    const floor = this.floorAt(to.x, to.z, from.y + 0.3, this.floor[i]!);
    if (floor === null) {
      // Over a pit with nothing under it: it falls away.
      p[i * 3] = to.x;
      p[i * 3 + 1] = to.y;
      p[i * 3 + 2] = to.z;
      return to.y < -20;
    }
    if (to.y <= floor) {
      const deadly = world && !world.field ? deadlyGround(world.arena, to.x, to.z, floor) : null;
      if (!deadly) this.stain(to.x, floor, to.z, 0, 1, 0);
      return true;
    }
    p[i * 3] = to.x;
    p[i * 3 + 1] = to.y;
    p[i * 3 + 2] = to.z;
    return false;
  }

  /** The floor height at (x, z) no higher than `maxY`, or null where there is none. */
  private floorAt(x: number, z: number, maxY: number, fallback: number): number | null {
    const world = this.world;
    if (!world) return fallback;
    if (world.field) return battlefieldHeight(world.field, x, z);
    return groundBelow(world.arena, x, z, maxY)?.y ?? null;
  }

  /** Remove droplet `i` by moving the last live one into its place. */
  private drop(i: number): void {
    const last = --this.live;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[last * 3 + k]!;
      this.col[i * 3 + k] = this.col[last * 3 + k]!;
      this.vel[i * 3 + k] = this.vel[last * 3 + k]!;
    }
    this.life[i] = this.life[last]!;
    this.floor[i] = this.floor[last]!;
  }

  /** Lay a stain at (x, y, z) on a surface whose normal is (nx, ny, nz); most droplets leave one. */
  private stain(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    if (Math.random() > STAIN_CHANCE) return;
    const slot = this.nextStain;
    this.nextStain = (slot + 1) % MAX_STAINS;
    this.stained = Math.min(MAX_STAINS, this.stained + 1);
    this.stains.count = this.stained;
    this.normal.set(nx, ny, nz);
    this.quat.setFromUnitVectors(FORWARD, this.normal);
    this.spin.setFromAxisAngle(this.normal, Math.random() * Math.PI * 2);
    this.quat.premultiply(this.spin);
    this.at.set(x + nx * LIFT, y + ny * LIFT, z + nz * LIFT);
    const size = STAIN_SIZE * (0.3 + 0.7 * Math.random());
    // Mirrored half the time, so the one sprite does not repeat.
    this.size.set(Math.random() < 0.5 ? -size : size, size, 1);
    this.stains.setMatrixAt(slot, this.matrix.compose(this.at, this.quat, this.size));
    this.stains.setColorAt(slot, this.tint.copy(BLOOD_COLOUR).multiplyScalar(0.6 + 0.4 * Math.random()));
    this.stainsDirty = true;
  }
}
