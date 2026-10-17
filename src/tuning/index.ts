/**
 * Tuning Data: all Editor-authored data, stored as JSON files in `data/`.
 *
 * This module owns the typed shape and validation on load (and, later, the
 * content hash used for the peer compatibility check).
 */
import fighterJson from '../../data/fighter.json';
import arenaJson from '../../data/arena.json';
import skeletonJson from '../../data/skeleton.json';
import hitZonesJson from '../../data/hitZones.json';
import aiJson from '../../data/ai.json';
import chamberJson from '../../data/chamber.json';
import blockJson from '../../data/block.json';
import matchJson from '../../data/match.json';
import gaitJson from '../../data/gait.json';
import cameraJson from '../../data/camera.json';
import fallJson from '../../data/fall.json';
import { parseArena, parseArenaSelection, type ArenaGeometry, type ArenaSelection } from './arena';
import { parseGait, type GaitTuning } from './gait';
import { parseMotion, motionFileName, type Motion } from './motion';
import { parseWeapon, weaponFileName, type WeaponTuning } from './weapon';
import { array, finiteNumber, positiveNumber, record, TuningDataError } from './validate';

export { TuningDataError } from './validate';
export { GAIT_FIELDS, type GaitTuning } from './gait';
export { tuningDataHash } from './hash';
export type { ArenaGeometry, ArenaPoint, ArenaSelection, SpawnPoint, WalkSurface, WallSegment } from './arena';
export { parseArena, surfacePlane } from './arena';
export type { Ease, FootPlant, HandTarget, Motion, PoseKey, PoseKeyChannel, TorsoTarget } from './motion';
export { EASES, POSE_KEY_CHANNELS, motionFileName, parseMotion, serializeMotion } from './motion';
export type { OffHandGrip, WeaponBlockImpact, WeaponGrip, WeaponLook, WeaponTuning } from './weapon';
export { parseWeapon, serializeWeapon, WEAPON_GRIPS, WEAPON_LOOKS, weaponFileName } from './weapon';

export interface FighterTuning {
  /** Starting HP of a Fighter. */
  readonly maxHp: number;
  /** Walk speed in metres per second. */
  readonly walkSpeed: number;
  /** Collision capsule radius in metres. */
  readonly radius: number;
  /** Standing height in metres. */
  readonly height: number;
  /** How fast a Fighter turns toward its Intent's `face`, in degrees per second. */
  readonly turnSpeed: number;
  /** Seconds over which the pose crossfades whenever the Motion changes (e.g. Block → Idle), so poses never snap. */
  readonly motionBlend: number;
  /** How far (degrees) a Fighter may look up or down from level (Intent `pitch`). */
  readonly lookPitchMax: number;
  /** The share of its look pitch a Fighter leans its torso by (0 = upright; 1 = as far as it looks). */
  readonly lookLean: number;
  /** How far (m) the hips move back as the torso leans fully forward (forward as it leans back), scaled by the lean's sine. */
  readonly lookHipShift: number;
  /** How far (m) a fully crouched Fighter's hips and hands drop; its feet stay planted, so the knees bend. */
  readonly crouchDepth: number;
  /** How fast (per second) the crouch amount moves between standing (0) and fully crouched (1). */
  readonly crouchSpeed: number;
  /** The share of `walkSpeed` a fully crouched Fighter walks at (blends in with the crouch amount). */
  readonly crouchWalkFactor: number;
}

/** Height, falling and jumping (data/fall.json): how Fighters stand on, step between and fall onto Walk Surfaces. */
export interface FallTuning {
  /** Downward acceleration (m/s²) of an airborne Fighter. */
  readonly gravity: number;
  /** Upward speed (m/s) a Jump starts with. */
  readonly jumpSpeed: number;
  /** How fast (m/s²) an airborne Fighter can steer its horizontal velocity toward where its Intent walks. */
  readonly airControl: number;
  /** Seconds airborne (without jumping) before the Fall Action takes over, so a step off a low ledge does not. */
  readonly fallDelay: number;
  /** The highest drop (m, from the top of the arc to the ground) that lands softly. */
  readonly safeHeight: number;
  /** Damage per metre dropped beyond `safeHeight`. */
  readonly damagePerMetre: number;
  /** The highest rise (m) a walking Fighter steps up onto. Higher ground is a wall. */
  readonly stepUp: number;
  /** The deepest drop (m) a walking Fighter follows down (down a ramp, off a step). Deeper, it goes airborne. */
  readonly snapDown: number;
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
/** The Block rule's facing check (also used by Chambers), and the Block Impact a stopped Attack leaves on the defender. */
export interface BlockTuning {
  /** How far (degrees either side of straight ahead, 0 < a <= 180) the attacker may be from the defender's facing: "roughly faces the attacker". */
  readonly facingHalfAngle: number;
  /** Radius (m) of the blade a Blocking defender presents to an Attack it Blocks: the Block lands where the blades meet. */
  readonly bladeRadius: number;
  /** Block Impact: how far (m) the sword hand gives at the first peak of a blow at the Weapon's reference Blade Speed. */
  readonly impactDistance: number;
  /** Block Impact: how far (degrees) the blade tips back at that peak. */
  readonly impactTilt: number;
  /** Block Impact: how far (degrees) the torso leans back at that peak. */
  readonly impactLean: number;
  /** Block Impact: how fast (Hz) the hand bounces back and forth while it settles. */
  readonly impactFrequency: number;
  /** Block Impact: seconds until the bounce has died out (and ends). */
  readonly impactDuration: number;
  /** Seconds after a Block is raised during which changing the Intent's Direction re-aims it (a late flick still counts). */
  readonly correctionWindow: number;
}

/**
 * Where the game camera sits. Presentation only: it never reaches the simulation,
 * so it is left out of the Tuning Data hash and peers may differ.
 */
export interface CameraTuning {
  /** Third-person camera: metres behind the Fighter. */
  readonly back: number;
  /** Third-person camera: metres to the Fighter's right (over the shoulder; negative = left). */
  readonly shoulder: number;
  /** Third-person camera: height (m) above the floor. */
  readonly eyeHeight: number;
  /** Third-person camera: the point looked at is this far (m) ahead of the Fighter... */
  readonly ahead: number;
  /** ...at this height (m). */
  readonly lookHeight: number;
  /** Orbit camera (a fallen Fighter watching the fight): distance (m) back from the fight's centre. */
  readonly orbitDistance: number;
  /** Orbit camera: height (m) above the floor. */
  readonly orbitHeight: number;
}

/** How a Match is paced. */
export interface MatchTuning {
  /** Distance (m) between the Fighters at the start of every Duel. */
  readonly duelDistance: number;
  /** Pause (s) between a Duel ending and the next one starting. */
  readonly interDuelSeconds: number;
  /** Distance (m) between teammates standing side by side in their team's line at the start of every Duel. */
  readonly lineSpacing: number;
}

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

/** One AI difficulty preset: together, Reaction Time and mistake rate define AI difficulty. */
export interface AiDifficulty {
  /** Reaction Time in seconds: the AI only acts on what it saw of its opponent this long ago. */
  readonly reactionTime: number;
  /** Chance (0..1) of a mistake per decision: a wrong-Direction Block, or a mistimed Attack. */
  readonly mistakeRate: number;
  /** Chance (0..1) that one of its Attacks is a deliberate Feint: it holds the Wind-up, then switches Direction. */
  readonly feintRate: number;
}

/** The rule-based AI Controller's behaviour and its difficulty presets. */
export interface AiTuning {
  /** Distance (m) to the opponent within which the AI attacks; further away it walks in. */
  readonly attackRange: number;
  /** Closer than this (m) the AI backs off. */
  readonly retreatRange: number;
  /** Chance (0..1) per Tick that an unthreatened, in-range, Idle AI starts an Attack (it always punishes an opening). 0 = it never attacks. */
  readonly aggression: number;
  /** Difficulty presets by name (e.g. Easy, Normal, Hard), in file order. */
  readonly difficulties: Readonly<Record<string, AiDifficulty>>;
}

export interface TuningData {
  readonly fighter: FighterTuning;
  /** Which Arena a Match, and the Editor, use. */
  readonly arena: ArenaSelection;
  /** Every Arena, keyed by name (data/arenas/<name>.json). */
  readonly arenas: Readonly<Record<string, ArenaGeometry>>;
  /** Height, falls and jumps. */
  readonly fall: FallTuning;
  /** The Weapon roster, keyed by name, in file order; the first is the default Weapon. */
  readonly weapons: Readonly<Record<string, WeaponTuning>>;
  readonly hitZones: Readonly<Record<HitZone, HitZoneTuning>>;
  readonly chamber: ChamberTuning;
  readonly block: BlockTuning;
  readonly match: MatchTuning;
  readonly skeleton: SkeletonTuning;
  readonly ai: AiTuning;
  /** How feet step whenever the body moves (the Gait). */
  readonly gait: GaitTuning;
  /** Where the game camera sits (presentation only; not hashed). */
  readonly camera: CameraTuning;
  /** Every default Motion, keyed by name. Always contains `Idle`. */
  readonly motions: Readonly<Record<string, Motion>>;
  /**
   * Motion overrides: per Weapon name, the Motions that Weapon plays instead of
   * the default of the same name. Look Motions up with `weaponMotion`.
   */
  readonly motionOverrides: Readonly<Record<string, Readonly<Record<string, Motion>>>>;
}

/** The default Weapon: the first in the roster. */
export function defaultWeaponName(tuning: Pick<TuningData, 'weapons'>): string {
  return Object.keys(tuning.weapons)[0]!;
}

/** A Weapon of the roster by name. Throws on an unknown name. */
export function weaponByName(tuning: Pick<TuningData, 'weapons'>, name: string): WeaponTuning {
  const w = tuning.weapons[name];
  if (!w) throw new Error(`Unknown Weapon "${name}" (have: ${Object.keys(tuning.weapons).join(', ')})`);
  return w;
}

/** `tuning` with some fields of one Weapon changed (default: the default Weapon), e.g. for tests and experiments. */
export function withWeapon(tuning: TuningData, patch: Partial<WeaponTuning>, name = defaultWeaponName(tuning)): TuningData {
  return { ...tuning, weapons: { ...tuning.weapons, [name]: { ...weaponByName(tuning, name), ...patch } } };
}

/**
 * The Motion a Fighter wielding `weapon` plays for `name`: the Weapon's override
 * if it has one, otherwise the default. Every Motion lookup goes through here.
 */
export function weaponMotion(tuning: Pick<TuningData, 'motions' | 'motionOverrides'>, weapon: string, name: string): Motion | undefined {
  return tuning.motionOverrides[weapon]?.[name] ?? tuning.motions[name];
}

/**
 * Check a Motion override against the default it replaces: it must have the
 * same name as an existing default and keep every marker the default has (the
 * markers its Action needs). Throws TuningDataError naming the path.
 */
export function checkMotionOverride(defaults: Readonly<Record<string, Motion>>, weapon: string, motion: Motion): void {
  const at = `motionOverrides/${weapon}/${motion.name}`;
  const base = defaults[motion.name];
  if (!base) throw new TuningDataError(`${at}: there is no default Motion "${motion.name}" to override`);
  for (const marker of Object.keys(base.markers)) {
    if (motion.markers[marker] === undefined) throw new TuningDataError(`${at}.markers.${marker} is required (the default Motion has it)`);
  }
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

function fraction(obj: Record<string, unknown>, key: string, where: string): number {
  const v = finiteNumber(obj, key, where);
  if (v < 0 || v > 1) throw new TuningDataError(`${where}.${key} must be between 0 and 1, got ${v}`);
  return v;
}

function parseAi(raw: unknown): AiTuning {
  const ai = record(raw, 'ai');
  const d = record(ai.difficulties, 'ai.difficulties');
  const names = Object.keys(d);
  if (names.length === 0) throw new TuningDataError('ai.difficulties must define at least one difficulty');
  const difficulties = Object.fromEntries(
    names.map((name) => {
      const where = `ai.difficulties.${name}`;
      const p = record(d[name], where);
      const reactionTime = finiteNumber(p, 'reactionTime', where);
      if (reactionTime < 0) throw new TuningDataError(`${where}.reactionTime must be >= 0, got ${reactionTime}`);
      return [name, { reactionTime, mistakeRate: fraction(p, 'mistakeRate', where), feintRate: fraction(p, 'feintRate', where) }];
    }),
  );
  return {
    attackRange: positiveNumber(ai, 'attackRange', 'ai'),
    retreatRange: positiveNumber(ai, 'retreatRange', 'ai'),
    aggression: fraction(ai, 'aggression', 'ai'),
    difficulties,
  };
}

/**
 * Validate raw (parsed JSON) Tuning Data. Throws TuningDataError when invalid.
 * `motions` is a list of raw Motions (one per file).
 */
export function parseTuningData(raw: unknown): TuningData {
  const root = record(raw, 'tuning');
  const f = record(root.fighter, 'fighter');
  const arenas: Record<string, ArenaGeometry> = {};
  (Array.isArray(root.arenas) ? root.arenas : Object.values(record(root.arenas, 'arenas'))).forEach((raw, i) => {
    const arena = parseArena(raw, `arenas[${i}]`);
    if (arenas[arena.name]) throw new TuningDataError(`arenas: duplicate Arena name "${arena.name}"`);
    arenas[arena.name] = arena;
  });
  const fa = record(root.fall, 'fall');
  const s = record(root.skeleton, 'skeleton');
  const hz = record(root.hitZones, 'hitZones');
  const ch = record(root.chamber, 'chamber');
  const bl = record(root.block, 'block');
  const ma = record(root.match, 'match');
  const cam = record(root.camera, 'camera');
  const facingHalfAngle = positiveNumber(bl, 'facingHalfAngle', 'block');
  if (facingHalfAngle > 180) throw new TuningDataError(`block.facingHalfAngle must be at most 180, got ${facingHalfAngle}`);
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

  const weapons: Record<string, WeaponTuning> = {};
  array(root.weapons, 'weapons').forEach((raw, i) => {
    const weapon = parseWeapon(raw, `weapons[${i}]`);
    if (weapons[weapon.name]) throw new TuningDataError(`weapons: duplicate Weapon name "${weapon.name}"`);
    weapons[weapon.name] = weapon;
  });
  if (Object.keys(weapons).length === 0) throw new TuningDataError('weapons: the roster must hold at least one Weapon');

  const motionOverrides: Record<string, Record<string, Motion>> = {};
  const rawOverrides = root.motionOverrides === undefined ? {} : record(root.motionOverrides, 'motionOverrides');
  for (const weapon of Object.keys(rawOverrides)) {
    if (!weapons[weapon]) throw new TuningDataError(`motionOverrides: no Weapon "${weapon}" in the roster`);
    const own: Record<string, Motion> = {};
    array(rawOverrides[weapon], `motionOverrides.${weapon}`).forEach((m, i) => {
      const motion = parseMotion(m, `motionOverrides.${weapon}[${i}]`);
      if (own[motion.name]) throw new TuningDataError(`motionOverrides/${weapon}: duplicate Motion name "${motion.name}"`);
      checkMotionOverride(motions, weapon, motion);
      own[motion.name] = motion;
    });
    if (Object.keys(own).length > 0) motionOverrides[weapon] = own;
  }

  return {
    fighter: {
      maxHp: positiveNumber(f, 'maxHp', 'fighter'),
      walkSpeed: positiveNumber(f, 'walkSpeed', 'fighter'),
      radius: positiveNumber(f, 'radius', 'fighter'),
      height: positiveNumber(f, 'height', 'fighter'),
      turnSpeed: positiveNumber(f, 'turnSpeed', 'fighter'),
      motionBlend: positiveNumber(f, 'motionBlend', 'fighter'),
      lookPitchMax: positiveNumber(f, 'lookPitchMax', 'fighter'),
      lookLean: finiteNumber(f, 'lookLean', 'fighter'),
      lookHipShift: finiteNumber(f, 'lookHipShift', 'fighter'),
      crouchDepth: finiteNumber(f, 'crouchDepth', 'fighter'),
      crouchSpeed: positiveNumber(f, 'crouchSpeed', 'fighter'),
      crouchWalkFactor: positiveNumber(f, 'crouchWalkFactor', 'fighter'),
    },
    arena: parseArenaSelection(root.arena, arenas),
    arenas,
    fall: {
      gravity: positiveNumber(fa, 'gravity', 'fall'),
      jumpSpeed: positiveNumber(fa, 'jumpSpeed', 'fall'),
      airControl: finiteNumber(fa, 'airControl', 'fall'),
      fallDelay: finiteNumber(fa, 'fallDelay', 'fall'),
      safeHeight: finiteNumber(fa, 'safeHeight', 'fall'),
      damagePerMetre: finiteNumber(fa, 'damagePerMetre', 'fall'),
      stepUp: finiteNumber(fa, 'stepUp', 'fall'),
      snapDown: finiteNumber(fa, 'snapDown', 'fall'),
    },
    weapons,
    hitZones,
    chamber: { windowSeconds: positiveNumber(ch, 'windowSeconds', 'chamber') },
    block: {
      facingHalfAngle,
      bladeRadius: positiveNumber(bl, 'bladeRadius', 'block'),
      impactDistance: positiveNumber(bl, 'impactDistance', 'block'),
      impactTilt: positiveNumber(bl, 'impactTilt', 'block'),
      impactLean: positiveNumber(bl, 'impactLean', 'block'),
      impactFrequency: positiveNumber(bl, 'impactFrequency', 'block'),
      impactDuration: positiveNumber(bl, 'impactDuration', 'block'),
      correctionWindow: positiveNumber(bl, 'correctionWindow', 'block'),
    },
    match: {
      duelDistance: positiveNumber(ma, 'duelDistance', 'match'),
      interDuelSeconds: positiveNumber(ma, 'interDuelSeconds', 'match'),
      lineSpacing: positiveNumber(ma, 'lineSpacing', 'match'),
    },
    skeleton,
    ai: parseAi(root.ai),
    gait: parseGait(root.gait),
    camera: {
      back: finiteNumber(cam, 'back', 'camera'),
      shoulder: finiteNumber(cam, 'shoulder', 'camera'),
      eyeHeight: positiveNumber(cam, 'eyeHeight', 'camera'),
      ahead: finiteNumber(cam, 'ahead', 'camera'),
      lookHeight: finiteNumber(cam, 'lookHeight', 'camera'),
      orbitDistance: positiveNumber(cam, 'orbitDistance', 'camera'),
      orbitHeight: positiveNumber(cam, 'orbitHeight', 'camera'),
    },
    motions,
    motionOverrides,
  };
}

/** Raw Motion files bundled from `data/motions/`, keyed by repo path. */
const motionFiles = import.meta.glob<unknown>('../../data/motions/*.json', { eager: true, import: 'default' });
/** Raw Motion override files, `data/motions/<Weapon file stem>/<Motion file>`, keyed by repo path. */
const overrideFiles = import.meta.glob<unknown>('../../data/motions/*/*.json', { eager: true, import: 'default' });
/** Raw Weapon files bundled from `data/weapons/`, keyed by repo path. */
const weaponFiles = import.meta.glob<unknown>('../../data/weapons/*.json', { eager: true, import: 'default' });
/** Raw Arena files bundled from `data/arenas/`, keyed by repo path. */
const arenaFiles = import.meta.glob<unknown>('../../data/arenas/*.json', { eager: true, import: 'default' });

/** Bundled files in file (path) order. */
const inFileOrder = (files: Record<string, unknown>) => Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** A Motion file's raw Motion, checked to be named after its Motion. */
function namedMotionFile(path: string, raw: unknown): unknown {
  const repoPath = path.replace('../../', '');
  const file = path.slice(path.lastIndexOf('/') + 1);
  const name = record(raw, repoPath).name;
  if (typeof name === 'string' && motionFileName(name) !== file) {
    throw new TuningDataError(`${repoPath}: Motion "${name}" must live in ${motionFileName(name)}`);
  }
  return raw;
}

/** Load and validate the Tuning Data bundled from the repo's `data/` folder. */
export function loadTuningData(): TuningData {
  const motions = inFileOrder(motionFiles).map(([path, raw]) => namedMotionFile(path, raw));
  // Weapon files are named after their Weapon; override folders after their Weapon's file.
  const weaponByStem = new Map<string, string>();
  const weapons = inFileOrder(weaponFiles).map(([path, raw]) => {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const name = record(raw, `data/weapons/${file}`).name;
    if (typeof name === 'string') {
      if (weaponFileName(name) !== file) throw new TuningDataError(`data/weapons/${file}: Weapon "${name}" must live in ${weaponFileName(name)}`);
      weaponByStem.set(file.replace(/\.json$/, ''), name);
    }
    return raw;
  });
  const motionOverrides: Record<string, unknown[]> = {};
  for (const [path, raw] of inFileOrder(overrideFiles)) {
    const stem = path.split('/').at(-2)!;
    const weapon = weaponByStem.get(stem);
    if (!weapon) throw new TuningDataError(`${path.replace('../../', '')}: no Weapon in data/weapons/ lives in ${stem}.json`);
    (motionOverrides[weapon] ??= []).push(namedMotionFile(path, raw));
  }
  return parseTuningData({
    fighter: fighterJson,
    arena: arenaJson,
    arenas: inFileOrder(arenaFiles).map(([path, raw]) => {
      const file = path.slice(path.lastIndexOf('/') + 1);
      const name = record(raw, `data/arenas/${file}`).name;
      if (typeof name === 'string' && `${name}.json` !== file) throw new TuningDataError(`data/arenas/${file}: Arena "${name}" must live in ${name}.json`);
      return raw;
    }),
    fall: fallJson,
    weapons,
    hitZones: hitZonesJson,
    chamber: chamberJson,
    block: blockJson,
    match: matchJson,
    skeleton: skeletonJson,
    ai: aiJson,
    gait: gaitJson,
    camera: cameraJson,
    motions,
    motionOverrides,
  });
}
