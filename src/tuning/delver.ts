/**
 * A Delver Run's Floor generator as Tuning Data (data/delver.json, hashed): the lattice of rooms, the passages between
 * them and the rules that place the Halls' kinds (docs/plans/delver.md, Stage 1). Every peer builds each Floor from this
 * and the Run seed, so peers with different Delver Tuning Data refuse each other at connect.
 */
import type { BattleTuning } from './battle';
import { array, finiteNumber, record, TuningDataError } from './validate';

export interface DelverFloorTuning {
  /** Lattice columns (whole, >= 2). */
  readonly cols: number;
  /** Lattice rows (whole, >= 2). */
  readonly rows: number;
  /** Halls wanted (whole, 2 to cols * rows). */
  readonly rooms: number;
  /** The metres between neighbouring lattice columns (rows), one picked per gap; each even and positive. */
  readonly gaps: readonly number[];
  /** [min, max] of a Hall's half-width and half-depth (whole m; min >= 4, a pedestal, the Stairs zone or a spawn and the judge's 1 m margin). */
  readonly halfSize: readonly [number, number];
  /** The shortest Passage between lattice neighbours (whole m, >= 1). */
  readonly minPassage: number;
  /** A Passage's width and its doorways' (whole m); wider than `flowCell`, at most twice the smallest half size. */
  readonly passage: number;
  /** The chance (in 100) that a growth step joins a Hall two lattice steps away over an empty cell. */
  readonly farPercent: number;
  /** [min, max] extra Passages after the spanning tree. */
  readonly loops: readonly [number, number];
  /** [min, max] Rest Halls (min >= 1). */
  readonly rests: readonly [number, number];
  /** Treasure Halls at most. */
  readonly treasures: number;
  /** The share (in 100) of the Halls left after the named kinds that are Empty. */
  readonly emptyPercent: number;
  /** Patrol loops at most. */
  readonly patrols: number;
  /** The judge's Passage slack: a field distance along a Passage may be up to this times its length (>= 1). */
  readonly follow: number;
  /** The most layouts tried for one (seed, Floor) (whole, >= 1). */
  readonly maxAttempts: number;
}

/** A Warband template (docs/plans/delver.md, Stage 3): the Troops a Warband deploys with, in list order (the first its rank and file), and its HP scale. */
export interface WarbandTemplate {
  /** Each listed Troop (an index into `battle.troops`) and how many of it. */
  readonly troops: readonly { readonly troop: number; readonly count: number }[];
  /** Multiplies each Soldier's HP (on top of its tier's `tierHp`); positive. */
  readonly hpScale: number;
}

/** One tier's Warband pools: the templates a post's guard and a patrol loop's patrol are picked from. */
export interface DelverTier {
  readonly guard: readonly WarbandTemplate[];
  readonly patrol: readonly WarbandTemplate[];
}

/** The most Players in a party (`MAX_TEAM_SIZE`, `sim/match`); a local copy, since tuning must not import the Simulation. */
const MAX_TEAM_SIZE = 4;

export interface DelverTuning {
  /** The tiers in a Run (whole, >= 1); a Boss ends each (docs/plans/delver.md, Decisions). */
  readonly tiers: number;
  /** The Floors in each tier (whole, >= 1); a Run is `tiers * floorsPerTier` Floors deep. */
  readonly floorsPerTier: number;
  /** The destination fields' cell (m) on a Floor; the Battles keep `crowd.flowCell`. */
  readonly flowCell: number;
  /** How far (m, across the ground) from a fire a Fighter takes its heal and revive, and may change its Inventory (positive). */
  readonly fireRadius: number;
  /** How far (m) a Warband's Soldier sees a party Fighter (positive). */
  readonly sight: number;
  /** The Leash: how far (m, by walking) from its home a chasing Warband follows before it returns (positive). */
  readonly leash: number;
  /** The seconds a chasing Warband goes without seeing its quarry before it gives up and returns (positive). */
  readonly forgetSeconds: number;
  /** A chasing Warband's pace as a multiple of the Crowd's walk speed (positive). */
  readonly chaseSpeed: number;
  /** How near (m, by walking) a chasing Warband's anchor halts to its quarry (positive). */
  readonly closeIn: number;
  /** How near (m) a Warband's anchor must be to its home or waypoint to have arrived (positive). */
  readonly arrive: number;
  /** The share (whole percent, 0 to 100) of a Floor's posts that hold a guard. */
  readonly postFill: number;
  /** The share (whole percent, 0 to 100) of a Floor's patrol loops that hold a patrol. */
  readonly patrolFill: number;
  /** The Soldiers each Warband gains of its first Troop per human beyond the first (0 or more; the fraction is a seeded chance). */
  readonly perPlayerSoldiers: number;
  /** A Bubble's Attack Slots by the number of Bubbles in use, 1 to MAX_TEAM_SIZE (whole, >= 1); the Floor's `slots` are built from it. */
  readonly attackSlots: readonly number[];
  /** Each tier's multiple of a Troop's HP (positive), one per tier. */
  readonly tierHp: readonly number[];
  /** Each tier's Warband templates, one per tier. */
  readonly warbands: readonly DelverTier[];
  readonly floor: DelverFloorTuning;
}

/**
 * The smallest Hall half-width: a pedestal 3 m from the centre plus the judge's 1 m margin, which also covers the Stairs' 2 m half
 * zone and a spawn 1.5 m out, each plus that margin. (The Floor generator's constants live in `sim/delver`, which tuning must not import.)
 */
const MIN_HALL_HALF = 4;

function fail(where: string, what: string, v: unknown): never {
  throw new TuningDataError(`${where} must be ${what}, got ${JSON.stringify(v)}`);
}

function whole(obj: Record<string, unknown>, key: string, where: string, min: number): number {
  const v = finiteNumber(obj, key, where);
  if (!Number.isInteger(v) || v < min) fail(`${where}.${key}`, min === 0 ? 'a whole number >= 0' : `a whole number >= ${min}`, v);
  return v;
}

function range(obj: Record<string, unknown>, key: string, where: string, min: number): readonly [number, number] {
  const path = `${where}.${key}`;
  const a = array(obj[key], path);
  if (a.length !== 2) fail(path, 'a [min, max] pair', obj[key]);
  const lo = a[0];
  const hi = a[1];
  if (typeof lo !== 'number' || !Number.isInteger(lo) || lo < min) fail(`${path}[0]`, `a whole number >= ${min}`, lo);
  if (typeof hi !== 'number' || !Number.isInteger(hi) || hi < lo) fail(`${path}[1]`, `a whole number >= ${path}[0]`, hi);
  return [lo, hi];
}

function percent(obj: Record<string, unknown>, key: string, where: string): number {
  const v = whole(obj, key, where, 0);
  if (v > 100) fail(`${where}.${key}`, 'a whole number 0 to 100', v);
  return v;
}

function positive(obj: Record<string, unknown>, key: string, where: string): number {
  const v = finiteNumber(obj, key, where);
  if (v <= 0) fail(`${where}.${key}`, 'a positive number', v);
  return v;
}

function parsePool(raw: unknown, path: string, battle: Pick<BattleTuning, 'troops' | 'squad'>): WarbandTemplate[] {
  const list = array(raw, path);
  if (list.length === 0) fail(path, 'a non-empty array', raw);
  return list.map((item, i) => {
    const where = `${path}[${i}]`;
    const t = record(item, where);
    const rows = array(t.troops, `${where}.troops`);
    if (rows.length === 0) fail(`${where}.troops`, 'a non-empty array', t.troops);
    let total = 0;
    const troops = rows.map((r, k) => {
      const w = `${where}.troops[${k}]`;
      const row = record(r, w);
      const name = row.troop;
      // A Troop is named in the file; parsed Tuning Data fed back in (as the tests and the editor do with every block) names it by index.
      const index = typeof name === 'number' && Number.isInteger(name) && name >= 0 && name < battle.troops.length ? name : battle.troops.findIndex((tr) => tr.name === name);
      if (index < 0) fail(`${w}.troop`, `one of battle.troops (${battle.troops.map((tr) => tr.name).join(', ')})`, name);
      const count = whole(row, 'count', w, 1);
      total += count;
      return { troop: index, count };
    });
    if (total > battle.squad.size) fail(`${where}.troops`, `1 to battle.squad.size (${battle.squad.size}) Soldiers in all`, total);
    return { troops, hpScale: positive(t, 'hpScale', where) };
  });
}

/**
 * Parse and validate `delver`; `fieldSize` is the Battle's field side (`battle.field.size`), which the lattice must fit, and `battle` the parsed
 * Battle Tuning, for the Troop names, `squad.size` and the Pool the Attack Slots must fit.
 */
export function parseDelver(raw: unknown, fieldSize: number, battle: Pick<BattleTuning, 'troops' | 'squad' | 'bubble'>): DelverTuning {
  const root = record(raw, 'delver');
  const flowCell = finiteNumber(root, 'flowCell', 'delver');
  if (flowCell <= 0) fail('delver.flowCell', 'a positive number', flowCell);
  // The Floor generator keeps every Hall Wall on an odd metre so none runs through a 2 m cell centre; that rule is written for a 2 m cell.
  if (flowCell !== 2) fail('delver.flowCell', 'exactly 2 (the Floor generator keeps Walls off a 2 m field cell\'s centres)', flowCell);
  const fireRadius = finiteNumber(root, 'fireRadius', 'delver');
  if (fireRadius <= 0) fail('delver.fireRadius', 'a positive number', fireRadius);
  const tiers = whole(root, 'tiers', 'delver', 1);
  const floorsPerTier = whole(root, 'floorsPerTier', 'delver', 1);
  const sight = positive(root, 'sight', 'delver');
  const leash = positive(root, 'leash', 'delver');
  const forgetSeconds = positive(root, 'forgetSeconds', 'delver');
  const chaseSpeed = positive(root, 'chaseSpeed', 'delver');
  const closeIn = positive(root, 'closeIn', 'delver');
  const arrive = positive(root, 'arrive', 'delver');
  const postFill = percent(root, 'postFill', 'delver');
  const patrolFill = percent(root, 'patrolFill', 'delver');
  const perPlayerSoldiers = finiteNumber(root, 'perPlayerSoldiers', 'delver');
  if (perPlayerSoldiers < 0) fail('delver.perPlayerSoldiers', 'a number >= 0', perPlayerSoldiers);
  const slotList = array(root.attackSlots, 'delver.attackSlots');
  if (slotList.length !== MAX_TEAM_SIZE) fail('delver.attackSlots', `${MAX_TEAM_SIZE} whole numbers (one per Bubble in use)`, root.attackSlots);
  const attackSlots = slotList.map((e, b) => {
    if (typeof e !== 'number' || !Number.isInteger(e) || e < 1) fail(`delver.attackSlots[${b}]`, 'a whole number >= 1', e);
    // b + 1 Bubbles each hold e Attack Slots, and their b + 1 Players fill Pool slots too.
    if ((b + 1) * e + (b + 1) > battle.bubble.poolSize) fail(`delver.attackSlots[${b}]`, `at most ${Math.floor(battle.bubble.poolSize / (b + 1)) - 1}, so ${b + 1} Bubbles and their Players fit the Pool (${battle.bubble.poolSize})`, e);
    return e;
  });
  const hpList = array(root.tierHp, 'delver.tierHp');
  if (hpList.length !== tiers) fail('delver.tierHp', `${tiers} numbers (one per tier)`, root.tierHp);
  const tierHp = hpList.map((h, i) => {
    if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) fail(`delver.tierHp[${i}]`, 'a positive number', h);
    return h;
  });
  const tierList = array(root.warbands, 'delver.warbands');
  if (tierList.length !== tiers) fail('delver.warbands', `${tiers} tiers (one per tier)`, root.warbands);
  const warbands = tierList.map((item, i): DelverTier => {
    const where = `delver.warbands[${i}]`;
    const tier = record(item, where);
    return { guard: parsePool(tier.guard, `${where}.guard`, battle), patrol: parsePool(tier.patrol, `${where}.patrol`, battle) };
  });
  const f = record(root.floor, 'delver.floor');
  const w = 'delver.floor';

  const cols = whole(f, 'cols', w, 2);
  const rows = whole(f, 'rows', w, 2);
  const rooms = whole(f, 'rooms', w, 2);
  if (rooms > cols * rows) fail(`${w}.rooms`, `at most cols * rows (${cols * rows})`, rooms);

  const gapList = array(f.gaps, `${w}.gaps`);
  if (gapList.length === 0) fail(`${w}.gaps`, 'a non-empty array', f.gaps);
  const gaps = gapList.map((g, i) => {
    if (typeof g !== 'number' || !Number.isInteger(g) || g <= 0 || g % 2 !== 0) fail(`${w}.gaps[${i}]`, 'an even positive whole number', g);
    return g;
  });

  const halfSize = range(f, 'halfSize', w, MIN_HALL_HALF);
  const minPassage = whole(f, 'minPassage', w, 1);
  const passage = whole(f, 'passage', w, 1);
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  if (minGap - minPassage < 2 * halfSize[0]) fail(`${w}.minPassage`, `at most min(gaps) - 2 * halfSize[0] (${minGap - 2 * halfSize[0]})`, minPassage);
  // A Hall's half size may move one metre up to dodge an even-metre Wall (plan.ts), so the gaps must leave room for halfSize[0] + 1.
  if (Math.floor((minGap - minPassage) / 2) < halfSize[0] + 1) fail(`${w}.minPassage`, `at most min(gaps) - 2 * (halfSize[0] + 1) (${minGap - 2 * (halfSize[0] + 1)}), so a Hall can always grow a metre`, minPassage);
  if (passage > 2 * halfSize[0]) fail(`${w}.passage`, `at most 2 * halfSize[0] (${2 * halfSize[0]})`, passage);
  if (passage <= flowCell) fail(`${w}.passage`, `wider than delver.flowCell (${flowCell}), so a field node always lies inside a Passage`, passage);
  for (const [key, n] of [['cols', cols], ['rows', rows]] as const) {
    if (((n - 1) * maxGap) / 2 + halfSize[1] + 2 > fieldSize / 2) fail(`${w}.${key}`, `small enough that the lattice fits the ${fieldSize} m field`, n);
  }

  const farPercent = percent(f, 'farPercent', w);
  const loops = range(f, 'loops', w, 0);
  const rests = range(f, 'rests', w, 1);
  const treasures = whole(f, 'treasures', w, 0);
  const emptyPercent = percent(f, 'emptyPercent', w);
  const patrols = whole(f, 'patrols', w, 0);
  const follow = finiteNumber(f, 'follow', w);
  if (follow < 1) fail(`${w}.follow`, 'a number >= 1', follow);
  const maxAttempts = whole(f, 'maxAttempts', w, 1);

  return {
    tiers,
    floorsPerTier,
    flowCell,
    fireRadius,
    sight,
    leash,
    forgetSeconds,
    chaseSpeed,
    closeIn,
    arrive,
    postFill,
    patrolFill,
    perPlayerSoldiers,
    attackSlots,
    tierHp,
    warbands,
    floor: { cols, rows, rooms, gaps, halfSize, minPassage, passage, farPercent, loops, rests, treasures, emptyPercent, patrols, follow, maxAttempts },
  };
}
