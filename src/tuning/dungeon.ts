/**
 * The Dungeon as Tuning Data (data/dungeon.json, hashed): a Run's Floors, each with the widths of its rows, the weights
 * that pick its Halls' kinds, its Encounter pools per Hall kind and its Boss Encounter, plus how HP and Doors work across
 * Halls (docs/plans/dungeon.md). Every peer builds each Floor's graph from this and the Run seed (`floorGraph`), so peers
 * with different Dungeons refuse each other at connect.
 */
import { array, nonEmptyString, nonNegativeNumber, positiveNumber, record, TuningDataError } from './validate';

/** A Weapon, Body or AI Style written `"random"` is picked by a pure hash of the Run seed, the Hall and the slot. */
export const RANDOM_PICK = 'random';

/** The most enemies an Encounter lists: one per Team 1 slot (MAX_TEAM_SIZE in `src/sim/match.ts`). */
export const MAX_ENCOUNTER_ENEMIES = 4;
/** The most Relics an Elite's enemy carries. */
export const MAX_ENEMY_RELICS = 2;

/** A Hall's kind. Shop is Later (with Gold). */
export type HallKind = 'Fight' | 'Elite' | 'Treasure' | 'Rest' | 'Boss';
/** The kinds a Floor's `weights` pick rows 2 to 4 from (Rest is placed, one in row 4; the Boss is row 5). */
export const WEIGHTED_HALL_KINDS = ['Fight', 'Elite', 'Treasure'] as const;
export type WeightedHallKind = (typeof WEIGHTED_HALL_KINDS)[number];
/** The kinds with an Encounter pool (the Boss has its own Encounter; Treasure and Rest Halls have none). */
export const POOLED_HALL_KINDS = ['Fight', 'Elite'] as const;
export type PooledHallKind = (typeof POOLED_HALL_KINDS)[number];

/** One enemy of an Encounter, in Team 1 slot order (as a v1 Floor's enemy). */
export interface DungeonEnemy {
  /** An AI difficulty (Tuning Data `ai.difficulties`). */
  readonly difficulty: string;
  /** A Weapon name, or `"random"`. */
  readonly weapon: string;
  /** A Body name, or `"random"`; absent: the usual random Body. Render-only, never read by the Simulation. */
  readonly body?: string;
  /** An AI Style (Tuning Data `ai.styles`), or `"random"`; absent: the default Style. */
  readonly style?: string;
  /** Its max HP as a multiple of `fighter.maxHp`, before scaling with the humans and the Hall's depth. */
  readonly hpScale: number;
  /** It fights only when Team 0 fields at least this many Fighters (1 to MAX_ENCOUNTER_ENEMIES); absent: always. Benched otherwise. */
  readonly minTeam?: number;
  /** How many Relics it carries (1 to MAX_ENEMY_RELICS; an Elite's); absent: none. Read from Stage 2. */
  readonly relics?: number;
}

/** One hand-written group of 1 to MAX_ENCOUNTER_ENEMIES enemies; Team 1 slots past the last are Benched. */
export interface DungeonEncounter {
  readonly enemies: readonly DungeonEnemy[];
}

export interface DungeonFloor {
  /** The widths of rows 2 to 4 (2 or 3 each); row 1 and the Boss's row 5 are one Hall each. */
  readonly rows: readonly number[];
  /** Relative weights of the kinds of rows 2 to 4 (never an Elite in row 2; row 4 also holds one Rest Hall). */
  readonly weights: Readonly<Record<WeightedHallKind, number>>;
  /** The Encounter pools a Hall of that kind picks from. Fight is never empty; Elite may be, when its weight is 0. */
  readonly encounters: Readonly<Record<PooledHallKind, readonly DungeonEncounter[]>>;
  /** The Boss Hall's Encounter. */
  readonly boss: DungeonEncounter;
}

export interface DungeonTuning {
  /** Seconds every living Player must stand in a Door's zone, once the Hall is cleared, to take it. */
  readonly doorSeconds: number;
  /** Seconds of fade from taking a Door to the next Hall's start. */
  readonly hallFadeSeconds: number;
  /** A fallen Team 0 Fighter comes back in the next Hall with this share of its max HP. */
  readonly revive: number;
  /** A Player's Fighter at a Rest Hall's fire heals this share of its max HP (once). */
  readonly restHeal: number;
  /** Each human beyond the first adds this much to every enemy's max HP multiplier. */
  readonly perPlayerHp: number;
  /** Each row of depth within its Floor adds this much to every enemy's max HP multiplier. */
  readonly depthHp: number;
  /** Inventory sizes: Weapons held, Relics held and how many of those are equipped (Stage 2). */
  readonly inventory: { readonly weapons: number; readonly relics: number; readonly equippedRelics: number };
  /** The Run's Floors in order; clearing the last Floor's Boss wins the Run. */
  readonly floors: readonly DungeonFloor[];
}

function share(obj: Record<string, unknown>, key: string, where: string, min: 'zero' | 'positive'): number {
  const v = min === 'zero' ? nonNegativeNumber(obj, key, where) : positiveNumber(obj, key, where);
  if (v > 1) throw new TuningDataError(`${where}.${key} must be at most 1, got ${v}`);
  return v;
}

function wholeNumber(obj: Record<string, unknown>, key: string, where: string, lo: number, hi: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new TuningDataError(`${where}.${key} must be a whole number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
  return v;
}

/** Refuses any key of `obj` outside `kinds`. */
function onlyKinds(obj: Record<string, unknown>, kinds: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) if (!kinds.includes(key)) throw new TuningDataError(`${where}: unknown Hall kind "${key}" (have: ${kinds.join(', ')})`);
}

/** Validate the raw Dungeon against the Weapon roster and the AI difficulties and Styles. Accepts its own output. */
export function parseDungeon(raw: unknown, weapons: readonly string[], difficulties: readonly string[], styles: readonly string[]): DungeonTuning {
  const d = record(raw, 'dungeon');
  const encounter = (rawEncounter: unknown, where: string): DungeonEncounter => {
    const enemies = array(record(rawEncounter, where).enemies, `${where}.enemies`).map((rawEnemy, k): DungeonEnemy => {
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
      const minTeam = e.minTeam === undefined ? undefined : wholeNumber(e, 'minTeam', at, 1, MAX_ENCOUNTER_ENEMIES);
      const relics = e.relics === undefined ? undefined : wholeNumber(e, 'relics', at, 1, MAX_ENEMY_RELICS);
      return {
        difficulty,
        weapon,
        ...(body === undefined ? {} : { body }),
        ...(style === undefined ? {} : { style }),
        hpScale,
        ...(minTeam === undefined ? {} : { minTeam }),
        ...(relics === undefined ? {} : { relics }),
      };
    });
    if (enemies.length < 1 || enemies.length > MAX_ENCOUNTER_ENEMIES)
      throw new TuningDataError(`${where}.enemies must list 1 to ${MAX_ENCOUNTER_ENEMIES} enemies, got ${enemies.length}`);
    return { enemies };
  };

  const floors = array(d.floors, 'dungeon.floors').map((rawFloor, n): DungeonFloor => {
    const where = `dungeon.floors[${n}]`;
    const f = record(rawFloor, where);
    const rows = array(f.rows, `${where}.rows`);
    if (rows.length !== 3 || !rows.every((w) => w === 2 || w === 3))
      throw new TuningDataError(`${where}.rows must list the widths of rows 2 to 4, each 2 or 3, got ${JSON.stringify(f.rows)}`);
    const w = record(f.weights, `${where}.weights`);
    onlyKinds(w, WEIGHTED_HALL_KINDS, `${where}.weights`);
    const weights = {
      Fight: positiveNumber(w, 'Fight', `${where}.weights`),
      Elite: w.Elite === undefined ? 0 : nonNegativeNumber(w, 'Elite', `${where}.weights`),
      Treasure: w.Treasure === undefined ? 0 : nonNegativeNumber(w, 'Treasure', `${where}.weights`),
    };
    const pools = record(f.encounters, `${where}.encounters`);
    onlyKinds(pools, POOLED_HALL_KINDS, `${where}.encounters`);
    const pool = (kind: PooledHallKind) => {
      const at = `${where}.encounters.${kind}`;
      if (pools[kind] === undefined && kind === 'Elite') return [];
      const list = array(pools[kind], at).map((e, k) => encounter(e, `${at}[${k}]`));
      if (list.length === 0) throw new TuningDataError(`${at} must list at least one Encounter`);
      return list;
    };
    const encounters = { Fight: pool('Fight'), Elite: pool('Elite') };
    if (weights.Elite > 0 && encounters.Elite.length === 0) throw new TuningDataError(`${where}: Elite Halls are weighted, but encounters.Elite lists no Encounter`);
    return { rows: rows as number[], weights, encounters, boss: encounter(f.boss, `${where}.boss`) };
  });
  if (floors.length === 0) throw new TuningDataError('dungeon.floors must list at least one Floor');

  const inv = record(d.inventory, 'dungeon.inventory');
  const relics = wholeNumber(inv, 'relics', 'dungeon.inventory', 0, 99);
  return {
    doorSeconds: positiveNumber(d, 'doorSeconds', 'dungeon'),
    hallFadeSeconds: nonNegativeNumber(d, 'hallFadeSeconds', 'dungeon'),
    revive: share(d, 'revive', 'dungeon', 'positive'),
    restHeal: share(d, 'restHeal', 'dungeon', 'zero'),
    perPlayerHp: nonNegativeNumber(d, 'perPlayerHp', 'dungeon'),
    depthHp: nonNegativeNumber(d, 'depthHp', 'dungeon'),
    inventory: {
      weapons: wholeNumber(inv, 'weapons', 'dungeon.inventory', 1, 99),
      relics,
      equippedRelics: wholeNumber(inv, 'equippedRelics', 'dungeon.inventory', 0, relics),
    },
    floors,
  };
}

/** Every Encounter of a Floor: its Fight pool, its Elite pool, then its Boss. */
export function floorEncounters(f: DungeonFloor): DungeonEncounter[] {
  return [...f.encounters.Fight, ...f.encounters.Elite, f.boss];
}

/** The difficulties the Dungeon's Encounters name, easiest first (the order they first appear in, Floor by Floor). */
export function dungeonDifficultyLadder(d: DungeonTuning): string[] {
  return [...new Set(d.floors.flatMap((f) => floorEncounters(f).flatMap((e) => e.enemies.map((x) => x.difficulty))))];
}

/**
 * A Run's difficulty knobs, picked in the Lobby (the host's, sent to every guest with the Lobby): each one absent keeps
 * Tuning Data as it is. `applyDungeonKnobs` folds them into the Dungeon before the Run starts, so the Simulation, the
 * enemy AIs and the Tuning Data hash every peer compares all see the same Encounters.
 */
export interface RunKnobs {
  /**
   * Steps every enemy's difficulty this many places along the Dungeon's difficulty ladder (the difficulties its
   * Encounters name, in the order they first appear: Beginner, Skilled, Expert), held at either end. Negative is easier.
   */
  readonly difficulty?: number;
  /** Multiplies every enemy's max HP. */
  readonly enemyHp?: number;
  /** At most this many enemies an Encounter (1 to MAX_ENCOUNTER_ENEMIES): those listed first stay, a Boss among them. */
  readonly maxEnemies?: number;
  /**
   * Replaces `restHeal`: the share of max HP a Rest Hall's fire gives back. Not called `heal`, v1's heal between Floors:
   * a `heal` remembered from a v1 Lobby (0 there meant no heal between Floors) is dropped, not taken for the Rest's.
   */
  readonly rest?: number;
  /** Replaces `perPlayerHp`: how much each human beyond the first adds to every enemy's max HP multiplier. */
  readonly perPlayerHp?: number;
}

/** Every Run knob's key. */
export const RUN_KNOB_KEYS: readonly (keyof RunKnobs)[] = ['difficulty', 'enemyHp', 'maxEnemies', 'rest', 'perPlayerHp'];

/** Run knobs read back from storage: each of RUN_KNOB_KEYS that is a finite number (any other key dropped), or null for none. */
export function parseRunKnobs(raw: unknown): RunKnobs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const knobs = Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => (RUN_KNOB_KEYS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v)),
  ) as RunKnobs;
  return Object.keys(knobs).length > 0 ? knobs : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The Dungeon with the Lobby's Run knobs applied to every Encounter; `d` itself when none change anything. `rest`
 * replaces `restHeal`, the Dungeon's heal. Out-of-range values are held to their range.
 */
export function applyDungeonKnobs(d: DungeonTuning, knobs: RunKnobs | undefined): DungeonTuning {
  if (!knobs) return d;
  const { difficulty = 0, enemyHp = 1, maxEnemies = MAX_ENCOUNTER_ENEMIES, rest = d.restHeal, perPlayerHp = d.perPlayerHp } = knobs;
  const steps = Math.round(difficulty);
  const keep = clamp(Math.round(maxEnemies), 1, MAX_ENCOUNTER_ENEMIES);
  const hp = enemyHp > 0 ? enemyHp : 1;
  if (steps === 0 && hp === 1 && keep === MAX_ENCOUNTER_ENEMIES && rest === d.restHeal && perPlayerHp === d.perPlayerHp) return d;
  const ladder = dungeonDifficultyLadder(d);
  const shift = (x: string) => ladder[clamp(ladder.indexOf(x) + steps, 0, ladder.length - 1)]!;
  const knob = (e: DungeonEncounter): DungeonEncounter => ({ enemies: e.enemies.slice(0, keep).map((x) => ({ ...x, difficulty: shift(x.difficulty), hpScale: x.hpScale * hp })) });
  return {
    ...d,
    restHeal: clamp(rest, 0, 1),
    perPlayerHp: Math.max(0, perPlayerHp),
    floors: d.floors.map((f) => ({ ...f, encounters: { Fight: f.encounters.Fight.map(knob), Elite: f.encounters.Elite.map(knob) }, boss: knob(f.boss) })),
  };
}
