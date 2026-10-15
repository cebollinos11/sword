/**
 * Placeholder impact effects: a burst where a Hit connects or a Block stops a
 * blow. Like audio, they live outside the Simulation and only listen to its
 * events (ADR 0001); which burst each event makes is pure, so it is tested headlessly.
 */
import * as THREE from 'three';
import type { SimState, Vec3 } from '../sim';
import { weaponByName, type TuningData } from '../tuning';

/** A burst at a contact point. `strength` is 0..1, from the Blade Speed at contact. */
export interface ImpactBurst {
  readonly kind: 'Hit' | 'Block';
  readonly point: Vec3;
  readonly strength: number;
}

/** The bursts triggered by one Tick's events, in event order (strength: Blade Speed over the attacker's Weapon's reference speed). */
export function impactBursts(duel: Pick<SimState, 'events' | 'fighters'>, tuning: TuningData): ImpactBurst[] {
  const bursts: ImpactBurst[] = [];
  for (const e of duel.events) {
    if (e.type !== 'Hit' && e.type !== 'Block') continue;
    const { speed } = weaponByName(tuning, duel.fighters[e.attacker]!.weapon);
    bursts.push({ kind: e.type, point: e.point, strength: Math.min(1, Math.max(0.3, e.bladeSpeed / speed)) });
  }
  return bursts;
}

interface Look {
  /** Particle colours, picked at random per particle. */
  readonly colours: readonly number[];
  readonly flashColour: number;
  readonly count: number;
  /** Particle speed at full strength, m/s. */
  readonly speed: number;
  /** Particle size: [width, length], metres. Long thin particles read as sparks. */
  readonly size: readonly [number, number];
  readonly life: number;
  readonly gravity: number;
  /** Flash radius at full strength, metres. */
  readonly flashRadius: number;
  readonly flashLife: number;
}

const LOOKS: Record<ImpactBurst['kind'], Look> = {
  // Chunky red bits that fall.
  Hit: {
    colours: [0xff2a1a, 0xd01010, 0x8a0808],
    flashColour: 0xff7040,
    count: 18,
    speed: 2.6,
    size: [0.05, 0.05],
    life: 0.55,
    gravity: 9,
    flashRadius: 0.26,
    flashLife: 0.15,
  },
  // Fast bright streaks off the steel.
  Block: {
    colours: [0xffffff, 0xfff2a0, 0xffd040],
    flashColour: 0xfff8d0,
    count: 12,
    speed: 4.5,
    size: [0.012, 0.09],
    life: 0.28,
    gravity: 4,
    flashRadius: 0.22,
    flashLife: 0.09,
  },
};

interface Particle {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly velocity: THREE.Vector3;
  born: number;
  life: number;
  gravity: number;
  /** A flash grows instead of flying; null for a particle. */
  flashRadius: number | null;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * Draws impact bursts in a scene. Any loop that drives a Simulation calls
 * `onTick(tick, duel)` (the Duel state that Tick produced) after each step and `update(seconds)` before each
 * draw, with the time that passed (scaled by slow-motion, 0 while paused). As with SimAudio, each Tick bursts at most once (so rollback
 * re-simulation does not repeat a burst); call `seek(tick)` when the loop jumps.
 */
export class ImpactEffects {
  private readonly root = new THREE.Group();
  private readonly live: Particle[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly sphere = new THREE.SphereGeometry(1, 8, 6);
  private lastTick = -Infinity;
  /** Effect time, seconds. */
  private clock = 0;

  constructor(
    scene: THREE.Scene,
    private readonly tuning: TuningData,
  ) {
    scene.add(this.root);
  }

  onTick(tick: number, duel: Pick<SimState, 'events' | 'fighters'>): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    for (const b of impactBursts(duel, this.tuning)) this.burst(b);
  }

  /** The loop jumped to `tick`: clear what is flying; Ticks after it will burst. */
  seek(tick: number): void {
    this.lastTick = tick;
    for (const p of this.live.splice(0)) this.remove(p);
  }

  /** Advance the particles by `seconds`. */
  update(seconds: number): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    this.clock += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      const t = (this.clock - p.born) / p.life;
      if (t >= 1) {
        this.remove(p);
        this.live.splice(i, 1);
        continue;
      }
      if (p.flashRadius !== null) {
        p.mesh.scale.setScalar(p.flashRadius * (0.4 + 0.6 * t));
        p.mesh.material.opacity = 1 - t;
        continue;
      }
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.velocity.lengthSq() > 1e-6) p.mesh.quaternion.setFromUnitVectors(FORWARD, p.velocity.clone().normalize());
      p.mesh.material.opacity = 1 - t * t;
    }
  }

  private burst({ kind, point, strength }: ImpactBurst): void {
    const look = LOOKS[kind];
    const at = new THREE.Vector3(point.x, point.y, point.z);
    const flash = this.spawn(this.sphere, look.flashColour, at, look.flashLife, 0);
    flash.flashRadius = look.flashRadius * (0.6 + 0.4 * strength);
    const count = Math.round(look.count * (0.5 + 0.5 * strength));
    for (let k = 0; k < count; k++) {
      const colour = look.colours[Math.floor(Math.random() * look.colours.length)]!;
      const p = this.spawn(this.box, colour, at, look.life * (0.6 + 0.4 * Math.random()), look.gravity);
      p.velocity.randomDirection().multiplyScalar(look.speed * strength * (0.4 + 0.6 * Math.random()));
      p.mesh.scale.set(look.size[0], look.size[0], look.size[1]);
    }
  }

  private spawn(geometry: THREE.BufferGeometry, colour: number, at: THREE.Vector3, life: number, gravity: number): Particle {
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(at);
    this.root.add(mesh);
    const p: Particle = { mesh, velocity: new THREE.Vector3(), born: this.clock, life, gravity, flashRadius: null };
    this.live.push(p);
    return p;
  }

  private remove(p: Particle): void {
    this.root.remove(p.mesh);
    p.mesh.material.dispose();
  }
}
