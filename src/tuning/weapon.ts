/**
 * Weapon Tuning Data: one file per Weapon in the Weapon roster,
 * `data/weapons/<weaponFileName(name)>`. The first Weapon (in file order) is
 * the default.
 *
 * Every Weapon is drawn and solved in its own frame: the main (sword) hand
 * grips it, its axis runs from that hand to the tip, and its edge is
 * perpendicular to the axis. A two-handed Weapon's off hand holds the
 * Off-hand Grip, a spot on the grip or shaft behind the main hand.
 */
import { finiteNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

export const WEAPON_GRIPS = ['oneHanded', 'twoHanded'] as const;
/** One-handed: the off hand follows its Pose Keys. Two-handed: it holds the Off-hand Grip. */
export type WeaponGrip = (typeof WEAPON_GRIPS)[number];

export const WEAPON_LOOKS = ['sword', 'polearm'] as const;
/** How the Renderer draws the Weapon. */
export type WeaponLook = (typeof WEAPON_LOOKS)[number];

/** Where a two-handed Weapon's off hand holds it, in the Weapon's own frame. */
export interface OffHandGrip {
  /** Distance (m) from the main hand toward the pommel or butt, within `gripLength`. */
  readonly along: number;
  /** Angle (degrees) about the Weapon's axis, measured from the edge direction. */
  readonly around: number;
  /** Distance (m) from the axis, so the off hand can sit on the side of the grip. */
  readonly radial: number;
}

/** Multipliers on the Block Impact a Weapon deals (when its Attack is Blocked) and takes (when it Blocks). */
export interface WeaponBlockImpact {
  readonly dealt: number;
  readonly taken: number;
}

/** A held Weapon: one entry in the Weapon roster. */
export interface WeaponTuning {
  readonly name: string;
  readonly grip: WeaponGrip;
  /** Main hand to tip, metres. */
  readonly length: number;
  /** Damage of a Head Hit at the reference Blade Speed (`speed`) on a Hit Zone with multiplier 1. */
  readonly damage: number;
  /**
   * Reference Blade Speed, m/s. Damage = damage × (Blade Speed at contact / speed) × Hit Zone multiplier
   * (× `shaftDamage` behind the Head), so a Head moving at `speed` into the torso deals exactly `damage`.
   */
  readonly speed: number;
  /** How far (m) the grip or shaft extends behind the main hand, ending in the pommel or butt. */
  readonly gripLength: number;
  /** Two-handed only: where the off hand holds the grip or shaft. */
  readonly offHandGrip?: OffHandGrip;
  /** Length (m) of the striking part, measured back from the tip. A sword is all Head. */
  readonly head: number;
  /** Damage multiplier (0..1) for Hits behind the Head (the shaft). */
  readonly shaftDamage: number;
  readonly blockImpact: WeaponBlockImpact;
  readonly look: WeaponLook;
}

/** The repo file a Weapon lives in, under `data/weapons/` (its stem also names its Motion override folder). */
export function weaponFileName(name: string): string {
  return `${name.toLowerCase().trim().replace(/\s+/g, '-')}.json`;
}

function oneOf<T extends string>(o: Record<string, unknown>, key: string, where: string, options: readonly T[], fallback?: T): T {
  const v = o[key] ?? fallback;
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) {
    throw new TuningDataError(`${where}.${key} must be one of ${options.join(', ')}, got ${JSON.stringify(o[key])}`);
  }
  return v as T;
}

/** Validate one raw (parsed JSON) Weapon. Throws TuningDataError naming the full path, e.g. `weapons/Halberd.head`. */
export function parseWeapon(raw: unknown, where = 'weapon'): WeaponTuning {
  const o = record(raw, where);
  const name = nonEmptyString(o, 'name', where);
  const at = `weapons/${name}`;
  const grip = oneOf(o, 'grip', at, WEAPON_GRIPS);
  const length = positiveNumber(o, 'length', at);
  const gripLength = positiveNumber(o, 'gripLength', at);

  let offHandGrip: OffHandGrip | undefined;
  if (grip === 'twoHanded') {
    if (o.offHandGrip === undefined) throw new TuningDataError(`${at}.offHandGrip is required for a two-handed Weapon`);
    const g = record(o.offHandGrip, `${at}.offHandGrip`);
    const along = finiteNumber(g, 'along', `${at}.offHandGrip`);
    if (along < 0 || along > gripLength) {
      throw new TuningDataError(`${at}.offHandGrip.along must be within 0..gripLength (${gripLength}), got ${along}`);
    }
    const radial = finiteNumber(g, 'radial', `${at}.offHandGrip`);
    if (radial < 0) throw new TuningDataError(`${at}.offHandGrip.radial must be >= 0, got ${radial}`);
    offHandGrip = { along, around: finiteNumber(g, 'around', `${at}.offHandGrip`), radial };
  } else if (o.offHandGrip !== undefined) {
    throw new TuningDataError(`${at}.offHandGrip is only for a two-handed Weapon (grip is ${grip})`);
  }

  const head = o.head === undefined ? length : positiveNumber(o, 'head', at);
  if (head > length) throw new TuningDataError(`${at}.head must be at most length (${length}), got ${head}`);
  const shaftDamage = o.shaftDamage === undefined ? 1 : finiteNumber(o, 'shaftDamage', at);
  if (shaftDamage < 0 || shaftDamage > 1) throw new TuningDataError(`${at}.shaftDamage must be between 0 and 1, got ${shaftDamage}`);
  let blockImpact: WeaponBlockImpact = { dealt: 1, taken: 1 };
  if (o.blockImpact !== undefined) {
    const b = record(o.blockImpact, `${at}.blockImpact`);
    blockImpact = { dealt: positiveNumber(b, 'dealt', `${at}.blockImpact`), taken: positiveNumber(b, 'taken', `${at}.blockImpact`) };
  }

  return {
    name,
    grip,
    length,
    damage: positiveNumber(o, 'damage', at),
    speed: positiveNumber(o, 'speed', at),
    gripLength,
    ...(offHandGrip ? { offHandGrip } : {}),
    head,
    shaftDamage,
    blockImpact,
    look: oneOf(o, 'look', at, WEAPON_LOOKS, 'sword'),
  };
}

/** Stable, diff-friendly JSON for a Weapon file (every field, 2-space indent, trailing newline). */
export function serializeWeapon(w: WeaponTuning): string {
  const out: Record<string, unknown> = {
    name: w.name,
    grip: w.grip,
    length: w.length,
    damage: w.damage,
    speed: w.speed,
    gripLength: w.gripLength,
  };
  if (w.offHandGrip) out.offHandGrip = { along: w.offHandGrip.along, around: w.offHandGrip.around, radial: w.offHandGrip.radial };
  Object.assign(out, { head: w.head, shaftDamage: w.shaftDamage, blockImpact: { dealt: w.blockImpact.dealt, taken: w.blockImpact.taken }, look: w.look });
  return `${JSON.stringify(out, null, 2)}\n`;
}
