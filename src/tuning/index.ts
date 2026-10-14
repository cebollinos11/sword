/**
 * Tuning Data: all Editor-authored data, stored as JSON files in `data/`.
 *
 * This module owns the typed shape, validation on load, and (later) the
 * content hash used for the peer compatibility check. Later tickets add
 * Weapon, Motion, Hit Zone and AI difficulty sections.
 */
import fighterJson from '../../data/fighter.json';
import arenaJson from '../../data/arena.json';

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

export interface TuningData {
  readonly fighter: FighterTuning;
  readonly arena: ArenaTuning;
}

export class TuningDataError extends Error {
  override name = 'TuningDataError';
}

function positiveNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new TuningDataError(`${where}.${key} must be a positive number, got ${JSON.stringify(v)}`);
  }
  return v;
}

function record(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new TuningDataError(`${where} must be an object`);
  }
  return v as Record<string, unknown>;
}

/** Validate raw (parsed JSON) Tuning Data. Throws TuningDataError when invalid. */
export function parseTuningData(raw: unknown): TuningData {
  const root = record(raw, 'tuning');
  const f = record(root.fighter, 'fighter');
  const a = record(root.arena, 'arena');
  return {
    fighter: {
      maxHp: positiveNumber(f, 'maxHp', 'fighter'),
      walkSpeed: positiveNumber(f, 'walkSpeed', 'fighter'),
      radius: positiveNumber(f, 'radius', 'fighter'),
      height: positiveNumber(f, 'height', 'fighter'),
    },
    arena: {
      radius: positiveNumber(a, 'radius', 'arena'),
    },
  };
}

/** Load and validate the Tuning Data bundled from the repo's `data/` folder. */
export function loadTuningData(): TuningData {
  return parseTuningData({ fighter: fighterJson, arena: arenaJson });
}
