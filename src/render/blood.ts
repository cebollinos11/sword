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
import { arenaOf, battlefieldHeight, battlefieldOf, deadlyGround, fighterPose, groundBelow, wallHit, type Heightfield, type SimState, type Vec3 } from '../sim';
import { sizedTuning, type ArenaGeometry, type TuningData } from '../tuning';
import { severing } from './dismember';
import type { Stump } from './ragdoll';

/** Blood sprayed by one Hit: where, which way (a unit vector on the floor plane: from the attacker through the defender) and how much. */
export interface BloodSpurt {
  readonly point: Vec3;
  readonly dir: { readonly x: number; readonly z: number };
  /** 0..1: a Heavy Blow's Hit is 1. */
  readonly strength: number;
  /** The defender's feet: the floor to land on when the Arena's geometry is unknown. */
  readonly floorY: number;
  /**
   * How steeply it sprays up (+) or down (−): the sine of its angle off the floor plane, `dir` being the rest (a stump's
   * spurt, out along the cut). None: a wound's spray, flung out level.
   */
  readonly rise?: number;
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

/**
 * A cut end whose plane lies nearly level (its normal's level part under this) does not spray straight up or down: it
 * sprays along the blow, the way the blade went, tilted up or down out of the cut by `LEVEL_RISE` (the sine of the tilt).
 */
const LEVEL_CUT = 0.2;
const LEVEL_RISE = 0.7;

/**
 * The blood sprayed from the stumps of a body in pieces (Dismemberment) on the Tick of its Death: one full-strength spurt
 * from each cut end of each bone its cut severs (`severing`), out of its own piece along the cut's normal, in the order of
 * the severed bones (the end on its bone's first joint's side first). Pure: the Death and the pose it fell in decide it.
 */
export function stumpSpurts(duel: Pick<SimState, 'tick' | 'fighters'>, tuning: TuningData): BloodSpurt[] {
  const spurts: BloodSpurt[] = [];
  for (const f of duel.fighters) {
    const death = f.death;
    if (!death || death.tick !== duel.tick || !death.blow?.cut) continue;
    const pose = fighterPose(f, tuning);
    for (const { bone, at, normal } of severing(pose, death.blow, sizedTuning(tuning, f.size))) {
      const [a, b] = [pose.joints[bone[0]], pose.joints[bone[1]]];
      // The end on the first joint's side faces the second joint, across the cut.
      const toward = (b.x - a.x) * normal.x + (b.y - a.y) * normal.y + (b.z - a.z) * normal.z < 0 ? -1 : 1;
      for (const sign of [toward, -toward]) {
        const out = { x: normal.x * sign, y: normal.y * sign, z: normal.z * sign };
        const flat = Math.hypot(out.x, out.z);
        if (flat >= LEVEL_CUT) {
          spurts.push({ point: at, dir: { x: out.x / flat, z: out.z / flat }, strength: 1, floorY: f.y, rise: Math.max(-1, Math.min(1, out.y)) });
          continue;
        }
        const x = f.position.x - death.blow.from.x;
        const z = f.position.z - death.blow.from.z;
        const len = Math.hypot(x, z);
        const dir = len < 1e-6 ? { x: 0, z: 1 } : { x: x / len, z: z / len };
        spurts.push({ point: at, dir, strength: 1, floorY: f.y, rise: Math.sign(out.y) * LEVEL_RISE });
      }
    }
  }
  return spurts;
}

/** For this long after the Death (seconds of Duel time) a body in pieces bleeds from its stumps as they fall. */
export const STUMP_BLEED_SECONDS = 2;
/** Drops shed from each cut end over `STUMP_BLEED_SECONDS`: most at once, fewer and fewer until it stops. */
const STUMP_DROPS = 8;

/** Drops shed from one cut end in the first `t` seconds after the Death. */
function shed(t: number): number {
  const u = Math.min(1, Math.max(0, t / STUMP_BLEED_SECONDS));
  return STUMP_DROPS * u * (2 - u);
}

/**
 * How many drops each cut end of a body in pieces sheds while the Death Ragdoll goes from `before` to `after` seconds
 * after the Death. Pure in the two times: however a stretch of time is cut into frames, the drops add up to the same,
 * and none fall while time stands still (paused) or runs back (scrubbing).
 */
export function stumpDrops(before: number, after: number): number {
  return after > before ? Math.floor(shed(after)) - Math.floor(shed(before)) : 0;
}

/**
 * Where the drops fall from this frame: each cut end of `stumps` (as they lie), as many times as `stumpDrops` says.
 */
export function stumpDrips(stumps: readonly Stump[], before: number, after: number): Vec3[] {
  const n = stumpDrops(before, after);
  const points: Vec3[] = [];
  for (let k = 0; k < n; k++) for (const s of stumps) points.push(...s.ends);
  return points;
}

/** Seconds a floor stain takes to splat out to its full size. */
export const SPLAT_SECONDS = 0.14;
/** A floor stain's size the moment it lands, as a share of its full size. */
const SPLAT_FROM = 0.35;
/** Seconds a wall stain takes to run down to its full length. */
export const RUN_SECONDS = 1.6;

/** How a just-laid stain is drawn `age` seconds after it landed, as multiples of its laid size. */
export interface StainShape {
  /** Width (along the surface, sideways). */
  readonly width: number;
  /** Height (on a wall: up the wall). */
  readonly height: number;
  /** How far its centre has slid down a wall (so its top edge stays put while it runs), in laid sizes. */
  readonly drop: number;
}

/**
 * A stain's shape `age` seconds after landing. On the floor it splats: it bursts out from small, overshooting a little,
 * and settles at its laid size. On a Wall it runs: its top edge stays where the drop struck while gravity draws it down,
 * `run` (a share of its size) longer at the end, fast at first and slowing.
 */
export function stainShape(onWall: boolean, age: number, run: number): StainShape {
  if (!onWall) {
    const u = Math.min(1, Math.max(0, age / SPLAT_SECONDS));
    // Ease out with a small overshoot ("back"), so it reads as a splat rather than a grow.
    const c = 1.6;
    const e = 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
    const s = SPLAT_FROM + (1 - SPLAT_FROM) * e;
    return { width: s, height: s, drop: 0 };
  }
  const u = Math.min(1, Math.max(0, age / RUN_SECONDS));
  const e = 1 - (1 - u) ** 3;
  const height = 1 + run * e;
  return { width: 1, height, drop: (height - 1) / 2 };
}

/** A stain still splatting or running: where it is and how, so each frame can redraw it. */
interface Fresh {
  readonly slot: number;
  readonly born: number;
  readonly onWall: boolean;
  readonly run: number;
  /** Signed: negative when mirrored. */
  readonly width: number;
  readonly size: number;
  readonly at: THREE.Vector3;
  readonly quat: THREE.Quaternion;
}

/** Most stains animating at once; past this a new one is laid at once at its final shape. */
const MAX_FRESH = 256;

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
/** At most this many splatters are heard within `SPLATTER_WINDOW` seconds (a Battle's many Hits do not pile up into noise). */
const MAX_SPLATTERS = 4;
const SPLATTER_WINDOW = 0.5;
/** A drip's stain, as a share of a spurt droplet's. */
const DRIP_STAIN = 0.12;

const BLOOD_COLOUR = new THREE.Color(0x8a0b0b);

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

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
  /** Each droplet's stain size, as a share of a spurt's (a drip off a blade leaves a small one). */
  private readonly scale = new Float32Array(MAX_DROPLETS);
  /** Each droplet's spurt (a serial), or -1 for a drip: the first droplet of a spurt to land splatters aloud. */
  private readonly spurtOf = new Float64Array(MAX_DROPLETS);
  /** Spurts not yet heard landing, by serial: their strength, and when they were sprayed (effect time). */
  private readonly unheard = new Map<number, { readonly strength: number; readonly at: number }>();
  private nextSpurt = 0;
  /** Effect time, seconds, and when the latest splatters were heard (at most `MAX_SPLATTERS` within `SPLATTER_WINDOW`). */
  private clock = 0;
  private readonly heard: number[] = [];
  /** Called when a spurt first strikes the floor or a Wall, where and how strong (0..1): its sound (none: silent). */
  onSplatter: ((point: Vec3, strength: number) => void) | null = null;
  private live = 0;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly stains: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private stained = 0;
  private nextStain = 0;
  private stainsDirty = false;
  /** Stains still splatting or running. */
  private fresh: Fresh[] = [];
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

  /** Spray `spurt`: droplets fan out away from the attacker, up and down, with a spread. `heard`: its first droplet to land splatters aloud (a stump's spurt is silent: the wound's own is heard). */
  spurt(spurt: BloodSpurt, heard = true): void {
    const n = Math.round(DROPLETS * (0.4 + 0.6 * spurt.strength));
    const serial = this.nextSpurt++;
    if (heard && this.live < MAX_DROPLETS) this.unheard.set(serial, { strength: spurt.strength, at: this.clock });
    for (let k = 0; k < n && this.live < MAX_DROPLETS; k++) {
      const i = this.live++;
      const speed = SPEED * (0.35 + 0.65 * spurt.strength) * (0.35 + 0.65 * Math.random());
      // Mostly along the blow, fanned sideways and up.
      const side = (Math.random() - 0.5) * 1.1;
      const dx = spurt.dir.x - spurt.dir.z * side;
      const dz = spurt.dir.z + spurt.dir.x * side;
      // A stump's spurt is tilted up or down out of the cut; a wound's stays level.
      const rise = spurt.rise ?? 0;
      const norm = Math.sqrt(1 - rise * rise) / Math.hypot(dx, dz);
      this.pos[i * 3] = spurt.point.x;
      this.pos[i * 3 + 1] = spurt.point.y;
      this.pos[i * 3 + 2] = spurt.point.z;
      this.vel[i * 3] = dx * norm * speed;
      this.vel[i * 3 + 1] = (Math.random() - 0.3) * 0.5 * speed + 0.6 + rise * speed;
      this.vel[i * 3 + 2] = dz * norm * speed;
      this.life[i] = DROPLET_LIFE;
      this.floor[i] = spurt.floorY;
      this.scale[i] = 1;
      this.spurtOf[i] = serial;
      const shade = 0.55 + 0.45 * Math.random();
      this.col[i * 3] = BLOOD_COLOUR.r * shade;
      this.col[i * 3 + 1] = BLOOD_COLOUR.g * shade;
      this.col[i * 3 + 2] = BLOOD_COLOUR.b * shade;
    }
  }

  /** One drop falling off a bloody blade at `point` (`floorY`: the floor to land on when the Arena's geometry is unknown); it leaves a small stain. */
  drip(point: Vec3, floorY: number): void {
    if (this.live >= MAX_DROPLETS) return;
    const i = this.live++;
    this.pos[i * 3] = point.x;
    this.pos[i * 3 + 1] = point.y;
    this.pos[i * 3 + 2] = point.z;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
    this.life[i] = DROPLET_LIFE;
    this.floor[i] = floorY;
    this.scale[i] = DRIP_STAIN;
    this.spurtOf[i] = -1;
    const shade = 0.5 + 0.3 * Math.random();
    this.col[i * 3] = BLOOD_COLOUR.r * shade;
    this.col[i * 3 + 1] = BLOOD_COLOUR.g * shade;
    this.col[i * 3 + 2] = BLOOD_COLOUR.b * shade;
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
    this.unheard.clear();
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
    this.fresh.length = 0;
  }

  /** Advance the droplets by `seconds`, laying a stain where each strikes the environment. */
  update(seconds: number): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    this.clock += dt;
    if (dt > 0) {
      for (let i = this.live - 1; i >= 0; i--) {
        if (this.advance(i, dt)) this.drop(i);
      }
      // A spurt whose droplets are all gone without landing (over a pit, or timed out) is never heard.
      for (const [serial, s] of this.unheard) if (this.clock - s.at > DROPLET_LIFE) this.unheard.delete(serial);
      this.points.geometry.setDrawRange(0, this.live);
      this.points.geometry.attributes.position!.needsUpdate = true;
      this.points.geometry.attributes.color!.needsUpdate = true;
    }
    if (this.fresh.length > 0) {
      this.fresh = this.fresh.filter((f) => {
        const age = this.clock - f.born;
        this.place(f, age);
        return age < (f.onWall ? RUN_SECONDS : SPLAT_SECONDS);
      });
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
      this.stain(wall.point.x, wall.point.y, wall.point.z, this.normal.x, 0, this.normal.z, this.scale[i]!);
      this.splatter(i, wall.point);
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
      if (!deadly) {
        this.stain(to.x, floor, to.z, 0, 1, 0, this.scale[i]!);
        to.y = floor;
        this.splatter(i, to);
      }
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
    this.scale[i] = this.scale[last]!;
    this.spurtOf[i] = this.spurtOf[last]!;
  }

  /** Droplet `i` struck the floor or a Wall at `point`: the first of its spurt to do so is heard there (unless too many were just now). */
  private splatter(i: number, point: Vec3): void {
    const serial = this.spurtOf[i]!;
    const strength = this.unheard.get(serial)?.strength;
    if (strength === undefined) return;
    this.unheard.delete(serial);
    if (!this.onSplatter) return;
    while (this.heard.length > 0 && this.clock - this.heard[0]! > SPLATTER_WINDOW) this.heard.shift();
    if (this.heard.length >= MAX_SPLATTERS) return;
    this.heard.push(this.clock);
    this.onSplatter({ x: point.x, y: point.y, z: point.z }, strength);
  }

  /** Draw stain `f` as it is `age` seconds after landing. */
  private place(f: Fresh, age: number): void {
    const s = stainShape(f.onWall, age, f.run);
    this.at.copy(f.at);
    this.at.y -= s.drop * f.size;
    this.size.set(f.width * s.width, f.size * s.height, 1);
    this.stains.setMatrixAt(f.slot, this.matrix.compose(this.at, f.quat, this.size));
    this.stainsDirty = true;
  }

  /** Lay a stain `scale` times a spurt's size at (x, y, z) on a surface whose normal is (nx, ny, nz); most droplets leave one, every drip. */
  private stain(x: number, y: number, z: number, nx: number, ny: number, nz: number, scale: number): void {
    if (scale >= 1 && Math.random() > STAIN_CHANCE) return;
    const slot = this.nextStain;
    this.nextStain = (slot + 1) % MAX_STAINS;
    this.stained = Math.min(MAX_STAINS, this.stained + 1);
    this.stains.count = this.stained;
    const onWall = ny < 0.5;
    if (onWall) {
      // Upright on the Wall (its sprite's up is the world's), so it can run straight down.
      this.quat.setFromAxisAngle(UP, Math.atan2(nx, nz));
    } else {
      this.normal.set(nx, ny, nz);
      this.quat.setFromUnitVectors(FORWARD, this.normal);
      this.spin.setFromAxisAngle(this.normal, Math.random() * Math.PI * 2);
      this.quat.premultiply(this.spin);
    }
    const size = STAIN_SIZE * scale * (0.3 + 0.7 * Math.random());
    // Mirrored half the time, so the one sprite does not repeat.
    const width = Math.random() < 0.5 ? -size : size;
    const at = new THREE.Vector3(x + nx * LIFT, y + ny * LIFT, z + nz * LIFT);
    const fresh: Fresh = { slot, born: this.clock, onWall, run: 0.4 + 0.8 * Math.random(), width, size, at, quat: this.quat.clone() };
    // The slot may still be animating an older stain the ring buffer has just overwritten.
    if (this.fresh.length > 0) this.fresh = this.fresh.filter((f) => f.slot !== slot);
    if (this.fresh.length < MAX_FRESH) {
      this.fresh.push(fresh);
      this.place(fresh, 0);
    } else {
      this.place(fresh, Infinity);
    }
    this.stains.setColorAt(slot, this.tint.copy(BLOOD_COLOUR).multiplyScalar(0.6 + 0.4 * Math.random()));
    this.stainsDirty = true;
  }
}
