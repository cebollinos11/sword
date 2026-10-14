/**
 * Tuning Data: all Editor-authored data, stored as JSON files in `data/`.
 *
 * This module owns the typed shape and validation on load (and, later, the
 * content hash used for the peer compatibility check). The AI difficulty
 * section arrives in a later ticket.
 */
import fighterJson from '../../data/fighter.json';
import arenaJson from '../../data/arena.json';
import weaponJson from '../../data/weapon.json';
import skeletonJson from '../../data/skeleton.json';
import hitZonesJson from '../../data/hitZones.json';
import chamberJson from '../../data/chamber.json';
import { parseMotion, motionFileName, type Motion } from './motion';
import { array, positiveNumber, record, TuningDataError } from './validate';

export { TuningDataError } from './validate';
export { tuningDataHash } from './hash';
export type { Ease, FootPlant, HandTarget, Motion, PoseKey, PoseKeyChannel, TorsoTarget } from './motion';
export { EASES, POSE_KEY_CHANNELS, motionFileName, parseMotion, serializeMotion } from './motion';

export interface FighterTuning {
  /** Starting HP of a Fighter. */
  readonly maxHp: number;
  /** Walk speed in metres per second. */
  readonly walkSpeed: number;
  /** Collision capsule radius in metres. */
  readonly radius: number;
  /** Standing height in metres. */
  readonly height: number;
}

export interface ArenaTuning {
  /** Radius of the flat circular Arena in metres. */
  readonly radius: number;
}

/** The v1 one-handed sword. */
export interface WeaponTuning {
  /** Blade length from hilt (the hand) to tip, metres. */
  readonly length: number;
  /** Damage of a hit at the reference Blade Speed (`speed`) on a Hit Zone with multiplier 1. */
  readonly damage: number;
  /**
   * Reference Blade Speed, m/s. Damage = damage × (Blade Speed at contact / speed) × Hit Zone multiplier,
   * so a blade moving at `speed` into the torso deals exactly `damage`.
   */
  readonly speed: number;
}

/**
 * Chamber timing: countering an incoming Attack by attacking in its Direction.
 * A press counts when it falls within the first `windowSeconds` seconds of the incoming
 * Attack's Release (see `src/sim/chamber.ts` for the full rule).
 */
export interface ChamberTuning {
  /** Length of the Chamber window, seconds from the first Tick of the incoming Release. */
  readonly windowSeconds: number;
}

/** The coarse regions of the Skeleton a Blade Sweep can hit. */
export const HIT_ZONES = ['head', 'torso', 'limbs'] as const;
export type HitZone = (typeof HIT_ZONES)[number];

export interface HitZoneTuning {
  /** Damage multiplier for a hit on this Hit Zone. */
  readonly multiplier: number;
  /** Radius (metres) of the capsules built on this Hit Zone's bones. */
  readonly radius: number;
}

/** Bone lengths of the primitive-built Skeleton, metres. */
export interface SkeletonTuning {
  /** Rest height of the pelvis above the floor. */
  readonly pelvisHeight: number;
  /** Distance between the two hip joints. */
  readonly hipWidth: number;
  readonly thigh: number;
  readonly shin: number;
  /** Height of the ankle joint above a planted foot. */
  readonly ankleHeight: number;
  /** Pelvis to the base of the neck. */
  readonly spine: number;
  /** Distance between the two shoulder joints. */
  readonly shoulderWidth: number;
  readonly neck: number;
  readonly headRadius: number;
  readonly upperArm: number;
  readonly forearm: number;
}

export interface TuningData {
  readonly fighter: FighterTuning;
  readonly arena: ArenaTuning;
  readonly weapon: WeaponTuning;
  readonly hitZones: Readonly<Record<HitZone, HitZoneTuning>>;
  readonly chamber: ChamberTuning;
  readonly skeleton: SkeletonTuning;
  /** Every Motion, keyed by name. Always contains `Idle`. */
  readonly motions: Readonly<Record<string, Motion>>;
}

const SKELETON_KEYS = [
  'pelvisHeight',
  'hipWidth',
  'thigh',
  'shin',
  'ankleHeight',
  'spine',
  'shoulderWidth',
  'neck',
  'headRadius',
  'upperArm',
  'forearm',
] as const satisfies readonly (keyof SkeletonTuning)[];

/**
 * Validate raw (parsed JSON) Tuning Data. Throws TuningDataError when invalid.
 * `motions` is a list of raw Motions (one per file).
 */
export function parseTuningData(raw: unknown): TuningData {
  const root = record(raw, 'tuning');
  const f = record(root.fighter, 'fighter');
  const a = record(root.arena, 'arena');
  const w = record(root.weapon, 'weapon');
  const s = record(root.skeleton, 'skeleton');
  const hz = record(root.hitZones, 'hitZones');
  const ch = record(root.chamber, 'chamber');
  const hitZones = Object.fromEntries(
    HIT_ZONES.map((zone) => {
      const where = `hitZones.${zone}`;
      const z = record(hz[zone], where);
      return [zone, { multiplier: positiveNumber(z, 'multiplier', where), radius: positiveNumber(z, 'radius', where) }];
    }),
  ) as Record<HitZone, HitZoneTuning>;
  const skeleton = Object.fromEntries(SKELETON_KEYS.map((k) => [k, positiveNumber(s, k, 'skeleton')])) as unknown as SkeletonTuning;

  const motions: Record<string, Motion> = {};
  array(root.motions, 'motions').forEach((m, i) => {
    const motion = parseMotion(m, `motions[${i}]`);
    if (motions[motion.name]) throw new TuningDataError(`motions: duplicate Motion name "${motion.name}"`);
    motions[motion.name] = motion;
  });
  if (!motions.Idle) throw new TuningDataError('motions: an "Idle" Motion is required');

  return {
    fighter: {
      maxHp: positiveNumber(f, 'maxHp', 'fighter'),
      walkSpeed: positiveNumber(f, 'walkSpeed', 'fighter'),
      radius: positiveNumber(f, 'radius', 'fighter'),
      height: positiveNumber(f, 'height', 'fighter'),
    },
    arena: { radius: positiveNumber(a, 'radius', 'arena') },
    weapon: {
      length: positiveNumber(w, 'length', 'weapon'),
      damage: positiveNumber(w, 'damage', 'weapon'),
      speed: positiveNumber(w, 'speed', 'weapon'),
    },
    hitZones,
    chamber: { windowSeconds: positiveNumber(ch, 'windowSeconds', 'chamber') },
    skeleton,
    motions,
  };
}

/** Raw Motion files bundled from `data/motions/`, keyed by repo path. */
const motionFiles = import.meta.glob<unknown>('../../data/motions/*.json', { eager: true, import: 'default' });

/** Load and validate the Tuning Data bundled from the repo's `data/` folder. */
export function loadTuningData(): TuningData {
  const motions = Object.entries(motionFiles).map(([path, raw]) => {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const name = record(raw, `data/motions/${file}`).name;
    if (typeof name === 'string' && motionFileName(name) !== file) {
      throw new TuningDataError(`data/motions/${file}: Motion "${name}" must live in ${motionFileName(name)}`);
    }
    return raw;
  });
  return parseTuningData({ fighter: fighterJson, arena: arenaJson, weapon: weaponJson, hitZones: hitZonesJson, chamber: chamberJson, skeleton: skeletonJson, motions });
}
