/**
 * Blade blood: a Weapon that lands a Hit is bloodied where it struck, and stays so for the rest of the Duel. A very bloody one
 * now and then drips onto the floor while it is still wet. Render-only, like the other impact effects (ADR 0001): it listens
 * to the Simulation's Hit events and never feeds back.
 *
 * A mark is kept in the Weapon's own frame (how far from the hand towards the tip), so it moves with the blade, through
 * swings, a Sheathe and a Death Ragdoll alike. Where on the Weapon it is drawn is `FighterView`'s business: it puts each mark
 * on the striking part nearest that spot (a sword's blade or point, a polearm's axe or spike, a hammer's head).
 */
import { fighterPose, type BladeTransform, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import type { TuningData } from '../tuning';
import type { FlailChain } from './flailChain';

/** Blood left on a Weapon by one Hit (or several close together, merged). */
export interface BladeMark {
  /** The Tick of the Hit that laid it (the latest, once merged): a rewind to before it washes it off. */
  tick: number;
  /** Where it struck, as a share of the way from the hand (0) to the tip (1). */
  t: number;
  /** 0..1: how much blood (a Heavy Blow's Hit is 1); a mark hit again gets bloodier. */
  strength: number;
  /** 0..1, fixed when laid: which way the splatter is turned and how long it runs, so marks do not all look alike. */
  readonly look: number;
  /** 0..1: how wet it still is (it drips while wet); dries over `DRY_SECONDS`. */
  wet: number;
}

/** Blood laid on Fighter `fighter`'s Weapon by one Hit this Tick. */
export interface BladeSplash {
  readonly fighter: number;
  readonly t: number;
  readonly strength: number;
}

/** A Hit of this much damage bloodies at full strength (as for the spray: a head Hit with repo Tuning Data). */
const FULL_DAMAGE = 15;
/** Most marks on one Weapon; a Hit past that bloodies the nearest mark further instead. */
export const MAX_MARKS = 10;
/** A Hit this close (share of the Weapon's length) to a mark bloodies that mark further rather than laying a new one. */
const MERGE = 0.08;
/** How long a mark stays wet enough to drip, seconds (it dries off exponentially, by this time constant). */
const DRY_SECONDS = 8;
/** Below this much wet blood on a Weapon (the sum of its marks' strength x wet), it does not drip. */
const DRIP_THRESHOLD = 0.6;
/** Drips per second per unit of wet blood above the threshold. */
const DRIP_RATE = 1.2;

/** Where `point` lies along the blade from hilt (0) to tip (1), clamped to the Weapon. */
export function alongBlade(blade: BladeTransform, point: Vec3): number {
  const dx = blade.tip.x - blade.hilt.x;
  const dy = blade.tip.y - blade.hilt.y;
  const dz = blade.tip.z - blade.hilt.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return 1;
  const t = ((point.x - blade.hilt.x) * dx + (point.y - blade.hilt.y) * dy + (point.z - blade.hilt.z) * dz) / len2;
  return Math.min(1, Math.max(0, t));
}

/**
 * The blood one Tick's events lay on Weapons, in event order: a Hit that does damage with the Weapon's Head bloodies the
 * attacker's Weapon where it connected. A shaft Hit (behind the Head) leaves the striking parts clean, as does a Throwing Dagger.
 */
export function bladeSplashes(duel: Pick<SimState, 'events' | 'fighters'>, tuning: TuningData): BladeSplash[] {
  const out: BladeSplash[] = [];
  for (const e of duel.events) {
    if (e.type !== 'Hit' || e.damage <= 0 || !e.head) continue;
    const f = duel.fighters[e.attacker];
    if (!f) continue;
    const t = alongBlade(fighterPose(f, tuning).blade, e.point);
    const strength = e.heavy ? 1 : Math.min(1, Math.max(0.3, e.damage / FULL_DAMAGE));
    out.push({ fighter: e.attacker, t, strength });
  }
  return out;
}

/** Each Fighter's Weapon blood through a Duel. */
export class BladeBlood {
  private readonly marks: BladeMark[][] = [];
  /** The Weapon each Fighter's marks are on: another Weapon (a Run's equip, a Battle slot reused) starts clean. */
  private readonly weapons: (string | undefined)[] = [];
  private lastDuelTick = -Infinity;
  /** A seek just happened: the next Tick's Duel time may be earlier without it being a new Duel. */
  private seeked = true;
  /** Drip clock: wall seconds owed to drips not yet made, per Fighter. */
  private readonly owed: number[] = [];

  constructor(private readonly tuning: TuningData) {}

  /** The blood on Fighter `i`'s Weapon now (none: an empty list). Read-only to the caller. */
  marksOf(i: number): readonly BladeMark[] {
    return this.marks[i] ?? NONE;
  }

  /** Take in Tick `tick`'s Duel: a fresh Duel washes every Weapon, then its Hits bloody theirs. */
  onTick(tick: number, duel: Pick<SimState, 'events' | 'fighters' | 'tick'>): void {
    if (duel.tick < this.lastDuelTick && !this.seeked) this.clear();
    this.lastDuelTick = duel.tick;
    this.seeked = false;
    duel.fighters.forEach((f, i) => {
      if (f.benched || this.weapons[i] !== f.weapon) {
        this.weapons[i] = f.weapon;
        if (this.marks[i]?.length) this.marks[i] = [];
      }
    });
    for (const s of bladeSplashes(duel, this.tuning)) this.splash(tick, s);
  }

  /** The loop jumped to Tick `tick`: a mark laid after it is washed off (a replay lays it again). */
  seek(tick: number): void {
    this.seeked = true;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m?.some((k) => k.tick > tick)) this.marks[i] = m.filter((k) => k.tick <= tick);
    }
  }

  clear(): void {
    this.marks.length = 0;
    this.owed.length = 0;
  }

  private splash(tick: number, s: BladeSplash): void {
    const marks = (this.marks[s.fighter] ??= []);
    let near: BladeMark | undefined;
    for (const m of marks) if (!near || Math.abs(m.t - s.t) < Math.abs(near.t - s.t)) near = m;
    if (near && (Math.abs(near.t - s.t) < MERGE || marks.length >= MAX_MARKS)) {
      near.strength = Math.min(1, near.strength + s.strength * 0.5);
      near.wet = 1;
      near.tick = Math.max(near.tick, tick);
      return;
    }
    marks.push({ tick, t: s.t, strength: s.strength, look: Math.random(), wet: 1 });
  }

  /**
   * Let `seconds` of wall time pass: the blood dries a little, and each Weapon still very wet now and then drips, `drip` being
   * called with where the drop leaves the blade and the floor under its Fighter. `poses` are as drawn this frame (none: not drawn).
   */
  drip(poses: readonly ((SkeletonPose & { readonly flail?: FlailChain }) | undefined)[], seconds: number, drip: (point: Vec3, floorY: number) => void): void {
    const dt = Math.min(0.1, Math.max(0, seconds));
    if (dt <= 0) return;
    const dry = Math.exp(-dt / DRY_SECONDS);
    for (let i = 0; i < this.marks.length; i++) {
      const marks = this.marks[i];
      if (!marks?.length) continue;
      let wet = 0;
      for (const m of marks) {
        m.wet *= dry;
        wet += m.strength * m.wet;
      }
      const pose = poses[i];
      if (!pose || wet <= DRIP_THRESHOLD) {
        this.owed[i] = 0;
        continue;
      }
      // Drips come at random, more often the wetter the blade.
      this.owed[i] = (this.owed[i] ?? 0) + dt * DRIP_RATE * (wet - DRIP_THRESHOLD);
      if (Math.random() >= this.owed[i]!) continue;
      this.owed[i] = 0;
      // From a mark chosen by how wet it is.
      let pick = Math.random() * wet;
      let from = marks[0]!;
      for (const m of marks) {
        from = m;
        pick -= m.strength * m.wet;
        if (pick <= 0) break;
      }
      const b = pose.blade;
      const t = from.t;
      const floor = floorUnder(pose);
      // A flail's ball is drawn loose (`flail`): a mark past the shaft's end (where its chain starts) drips from the ball where it is drawn.
      const chain = pose.flail;
      const len = Math.hypot(b.tip.x - b.hilt.x, b.tip.y - b.hilt.y, b.tip.z - b.hilt.z);
      const start = chain?.links[0];
      if (chain && start && t * len > Math.hypot(start.x - b.hilt.x, start.y - b.hilt.y, start.z - b.hilt.z)) drip(chain.ball, floor);
      else drip({ x: b.hilt.x + (b.tip.x - b.hilt.x) * t, y: b.hilt.y + (b.tip.y - b.hilt.y) * t, z: b.hilt.z + (b.tip.z - b.hilt.z) * t }, floor);
    }
  }
}

const NONE: readonly BladeMark[] = [];

/** The floor a drop off a Fighter falls to when the Arena's geometry is unknown: as low as its lowest joint. */
export function floorUnder(pose: SkeletonPose): number {
  let floor = Infinity;
  for (const n in pose.joints) floor = Math.min(floor, pose.joints[n as keyof SkeletonPose['joints']].y);
  return floor;
}
