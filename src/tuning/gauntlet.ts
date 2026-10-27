/**
 * The Gauntlet as Tuning Data (data/gauntlet.json, hashed): a Run's Floors, each listing its enemies, and how HP
 * carries from one Floor to the next (docs/plans/gauntlet.md). Every peer builds each Floor from this, the Run's
 * options and the Lineup, so peers with different Floors refuse each other at connect.
 */
import { clampSize, MAX_SIZE, MIN_SIZE, type Size } from './size';
import { array, nonNegativeNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

/** A Weapon, Body or AI Style written `"random"` is picked by a pure hash of the Run seed, the Floor and the slot. */
export const RANDOM_PICK = 'random';

/** The most enemies a Floor lists: one per Team 1 slot (MAX_TEAM_SIZE in `src/sim/match.ts`). */
export const MAX_FLOOR_ENEMIES = 4;

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
  /** It fights only when Team 0 fields at least this many Fighters (1 to MAX_FLOOR_ENEMIES); absent: always. Its slot is Benched otherwise. */
  readonly minTeam?: number;
  /** Its Size (`{ height, thick }`, each MIN_SIZE to MAX_SIZE); absent: the standard body. */
  readonly size?: Size;
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

function parseEnemySize(raw: unknown, at: string): Size {
  const o = record(raw, at);
  const part = (key: 'height' | 'thick'): number => {
    const v = o[key] === undefined ? 1 : positiveNumber(o, key, at);
    if (v < MIN_SIZE || v > MAX_SIZE) throw new TuningDataError(`${at}.${key} must be from ${MIN_SIZE} to ${MAX_SIZE}, got ${v}`);
    return v;
  };
  return clampSize({ height: part('height'), thick: part('thick') });
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
      const minTeam = e.minTeam === undefined ? undefined : positiveNumber(e, 'minTeam', at);
      if (minTeam !== undefined && (!Number.isInteger(minTeam) || minTeam > MAX_FLOOR_ENEMIES))
        throw new TuningDataError(`${at}.minTeam must be a whole number from 1 to ${MAX_FLOOR_ENEMIES}, got ${minTeam}`);
      const size = e.size === undefined ? undefined : parseEnemySize(e.size, `${at}.size`);
      return { difficulty, weapon, ...(size === undefined ? {} : { size }), ...(body === undefined ? {} : { body }), ...(style === undefined ? {} : { style }), hpScale, ...(minTeam === undefined ? {} : { minTeam }) };
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

/**
 * A Run's difficulty knobs, picked in the Lobby (the host's, sent to every guest with the Lobby): each one absent keeps
 * Tuning Data as it is. `applyRunKnobs` folds them into the Gauntlet before the Run starts, so the Simulation, the
 * Floor AIs and the Tuning Data hash every peer compares all see the same Floors.
 */
export interface RunKnobs {
  /**
   * Steps every enemy's difficulty this many places along the Run's difficulty ladder (the difficulties its Floors name,
   * in the order they first appear: Beginner, Skilled, Expert), held at either end. Negative is easier.
   */
  readonly difficulty?: number;
  /** Multiplies every enemy's max HP. */
  readonly enemyHp?: number;
  /** At most this many enemies a Floor (1 to MAX_FLOOR_ENEMIES): those listed first stay, the boss among them. */
  readonly maxEnemies?: number;
  /** Replaces `heal`: the share of max HP a surviving Fighter gets back between Floors. */
  readonly heal?: number;
  /** Replaces `perPlayerHp`: how much each human beyond the first adds to every enemy's max HP multiplier. */
  readonly perPlayerHp?: number;
}

/** The difficulties the Run's Floors name, easiest first (the order they first appear in). */
export function runDifficultyLadder(g: GauntletTuning): string[] {
  return [...new Set(g.floors.flatMap((f) => f.enemies.map((e) => e.difficulty)))];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The Gauntlet with `knobs` applied; `g` itself when none change anything. Out-of-range values are held to their range. */
export function applyRunKnobs(g: GauntletTuning, knobs: RunKnobs | undefined): GauntletTuning {
  if (!knobs) return g;
  const { difficulty = 0, enemyHp = 1, maxEnemies = MAX_FLOOR_ENEMIES, heal = g.heal, perPlayerHp = g.perPlayerHp } = knobs;
  const steps = Math.round(difficulty);
  const keep = clamp(Math.round(maxEnemies), 1, MAX_FLOOR_ENEMIES);
  const hp = enemyHp > 0 ? enemyHp : 1;
  if (steps === 0 && hp === 1 && keep === MAX_FLOOR_ENEMIES && heal === g.heal && perPlayerHp === g.perPlayerHp) return g;
  const ladder = runDifficultyLadder(g);
  const shift = (d: string) => ladder[clamp(ladder.indexOf(d) + steps, 0, ladder.length - 1)]!;
  return {
    ...g,
    heal: clamp(heal, 0, 1),
    perPlayerHp: Math.max(0, perPlayerHp),
    floors: g.floors.map((f) => ({
      ...f,
      enemies: f.enemies.slice(0, keep).map((e) => ({ ...e, difficulty: shift(e.difficulty), hpScale: e.hpScale * hp })),
    })),
  };
}
