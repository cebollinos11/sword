/**
 * The Gauntlet as Tuning Data (data/gauntlet.json, hashed): a Run's Floors, each listing its enemies, and how HP
 * carries from one Floor to the next (docs/plans/gauntlet.md). Every peer builds each Floor from this, the Run's
 * options and the Lineup, so peers with different Floors refuse each other at connect.
 */
import { array, nonNegativeNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

/** A Weapon, Body or AI Style written `"random"` is picked by a pure hash of the Run seed, the Floor and the slot. */
export const RANDOM_PICK = 'random';

/** The most enemies a Floor lists: one per Team 1 slot (MAX_TEAM_SIZE in `src/sim/match.ts`). */
export const MAX_FLOOR_ENEMIES = 3;

/** One enemy of a Floor, in Team 1 slot order. */
export interface GauntletEnemy {
  /** An AI difficulty (Tuning Data `ai.difficulties`). */
  readonly difficulty: string;
  /** A Weapon name, or `"random"`. */
  readonly weapon: string;
  /** A Body name, or `"random"`; absent: the usual random Body. Render-only, never read by the Simulation. */
  readonly body?: string;
  /** An AI Style (Tuning Data `ai.styles`), or `"random"`; absent: the default Style. */
  readonly style?: string;
  /** Its max HP as a multiple of `fighter.maxHp`, before scaling with the number of humans. */
  readonly hpScale: number;
}

export interface GauntletFloor {
  /** The boss Floor (presentation only). */
  readonly boss: boolean;
  /** 1 to MAX_FLOOR_ENEMIES enemies; Team 1 slots past the last are Benched. */
  readonly enemies: readonly GauntletEnemy[];
}

export interface GauntletTuning {
  /** Seconds from a Floor's end to the next Floor's start (long enough for the Final Blow Shot). */
  readonly interFloorSeconds: number;
  /** A surviving Fighter starts the next Floor with this share of its max HP added (up to its max). */
  readonly heal: number;
  /** A fallen Team 0 Fighter comes back on the next Floor with this share of its max HP. */
  readonly revive: number;
  /** Each human beyond the first adds this much to every enemy's max HP multiplier. */
  readonly perPlayerHp: number;
  /** The Run's Floors in order; the last is the boss. */
  readonly floors: readonly GauntletFloor[];
}

function share(obj: Record<string, unknown>, key: string, where: string, min: 'zero' | 'positive'): number {
  const v = min === 'zero' ? nonNegativeNumber(obj, key, where) : positiveNumber(obj, key, where);
  if (v > 1) throw new TuningDataError(`${where}.${key} must be at most 1, got ${v}`);
  return v;
}

/** Validate the raw Gauntlet against the Weapon roster and the AI difficulties and Styles. Accepts its own output. */
export function parseGauntlet(raw: unknown, weapons: readonly string[], difficulties: readonly string[], styles: readonly string[]): GauntletTuning {
  const g = record(raw, 'gauntlet');
  const floors = array(g.floors, 'gauntlet.floors').map((rawFloor, n): GauntletFloor => {
    const where = `gauntlet.floors[${n}]`;
    const f = record(rawFloor, where);
    if (f.boss !== undefined && typeof f.boss !== 'boolean') throw new TuningDataError(`${where}.boss must be a boolean, got ${JSON.stringify(f.boss)}`);
    const enemies = array(f.enemies, `${where}.enemies`).map((rawEnemy, k): GauntletEnemy => {
      const at = `${where}.enemies[${k}]`;
      const e = record(rawEnemy, at);
      const difficulty = nonEmptyString(e, 'difficulty', at);
      if (!difficulties.includes(difficulty)) throw new TuningDataError(`${at}.difficulty: unknown AI difficulty "${difficulty}" (have: ${difficulties.join(', ')})`);
      const weapon = nonEmptyString(e, 'weapon', at);
      if (weapon !== RANDOM_PICK && !weapons.includes(weapon)) throw new TuningDataError(`${at}.weapon: unknown Weapon "${weapon}" (have: ${weapons.join(', ')}, or "${RANDOM_PICK}")`);
      const body = e.body === undefined ? undefined : nonEmptyString(e, 'body', at);
      const style = e.style === undefined ? undefined : nonEmptyString(e, 'style', at);
      if (style !== undefined && style !== RANDOM_PICK && !styles.includes(style)) throw new TuningDataError(`${at}.style: unknown AI Style "${style}" (have: ${styles.join(', ')}, or "${RANDOM_PICK}")`);
      const hpScale = e.hpScale === undefined ? 1 : positiveNumber(e, 'hpScale', at);
      return { difficulty, weapon, ...(body === undefined ? {} : { body }), ...(style === undefined ? {} : { style }), hpScale };
    });
    if (enemies.length < 1 || enemies.length > MAX_FLOOR_ENEMIES)
      throw new TuningDataError(`${where}.enemies must list 1 to ${MAX_FLOOR_ENEMIES} enemies, got ${enemies.length}`);
    return { boss: f.boss === true, enemies };
  });
  if (floors.length === 0) throw new TuningDataError('gauntlet.floors must list at least one Floor');
  return {
    interFloorSeconds: positiveNumber(g, 'interFloorSeconds', 'gauntlet'),
    heal: share(g, 'heal', 'gauntlet', 'zero'),
    revive: share(g, 'revive', 'gauntlet', 'positive'),
    perPlayerHp: nonNegativeNumber(g, 'perPlayerHp', 'gauntlet'),
    floors,
  };
}
