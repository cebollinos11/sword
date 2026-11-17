/**
 * A Delver Run's Floor generator as Tuning Data (data/delver.json, hashed): the lattice of rooms, the passages between
 * them and the rules that place the Halls' kinds (docs/plans/delver.md, Stage 1). Every peer builds each Floor from this
 * and the Run seed, so peers with different Delver Tuning Data refuse each other at connect.
 */
import type { BattleTuning } from './battle';
import { RELIC_MULTIPLIERS, type RelicEffects } from './relics';
import { DEFAULT_STYLE } from './style';
import { array, finiteNumber, record, TuningDataError } from './validate';
/** The most Relics one list names: a Variant's own, or an elite template's set. An elite Soldier wears both (its Variant's, then the set's it lacks), so up to twice this. */
export const MAX_ENEMY_RELICS = 2;

export interface DelverFloorTuning {
  /** Lattice columns (whole, >= 2). */
  readonly cols: number;
  /** Lattice rows (whole, >= 2). */
  readonly rows: number;
  /** Halls wanted (whole, 2 to cols * rows); a tier `delver.tierRooms` names takes its own count instead (`floorTuningOf`). */
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
  /** The Floor's levels (docs/plans/delver.md, Stage 6). */
  readonly levels: DelverLevelsTuning;
  /** How galleries wrap and how often they are stairwells (docs/plans/delver.md, Stage 7c). */
  readonly galleries: DelverGalleriesTuning;
  /** The chance (in 100) that a growth step takes a turning candidate (an L, S or Z Passage) when there is one; 0: no Passage ever turns (docs/plans/delver.md, Stage 7a). */
  readonly turnPercent: number;
  /** The great halls (a Hall over two neighbouring lattice cells). */
  readonly great: DelverGreatTuning;
  /** The splits and pits a Hall may take (docs/plans/delver.md, Stage 7c). */
  readonly features: DelverFeaturesTuning;
  /** Hall shapes (docs/plans/delver.md, Stage 7b). */
  readonly shapes: DelverShapesTuning;
  /** Pillars. */
  readonly pillars: DelverPillarsTuning;
}

/**
 * A Hall's vertical features (docs/plans/delver.md, Stage 7c). `percent` 0 makes every Floor as 7b's (no split or pit, no pick made).
 */
export interface DelverFeaturesTuning {
  /** The chance (in 100) that a one-cell Hall with no gallery is picked for a split or a pit. */
  readonly percent: number;
  /** The weights of a split and a pit (whole, at least 0, summing to at least 1). */
  readonly weights: { readonly split: number; readonly pit: number };
  /** The chance (in 100) that a split has three tiers (else two). */
  readonly threePercent: number;
  /** Per Run tier (the last for any deeper tier): the chance (in 100) that a pit is 4 m deep (else 2 m). Non-empty. */
  readonly deepPercent: readonly number[];
  /** The chance (in 100) that a Boss or Treasure Hall with room and no other feature gets a dais (a throne or an altar). */
  readonly daisPercent: number;
}

/** How many Halls take a shape: the chance (in 100) that a Hall that may take one is picked for one, and the weights of L, T, cross and ring (whole, at least 0, summing to at least 1). */
export interface DelverShapesTuning {
  readonly percent: number;
  readonly weights: { readonly L: number; readonly T: number; readonly cross: number; readonly ring: number };
}

/** How many Halls take pillars: the chance (in 100), and the weights of a colonnade and a grid (as `DelverShapesTuning`). */
export interface DelverPillarsTuning {
  readonly percent: number;
  readonly weights: { readonly colonnade: number; readonly grid: number };
}

/** A Floor's great halls: how many, and how long (docs/plans/delver.md, Stage 7a). `count` [0, 0] makes a Floor have none. */
export interface DelverGreatTuning {
  /** [min, max] great halls a Floor wants (whole, 0 to 4). */
  readonly count: readonly [number, number];
  /** [min, max] of a great hall's half length along its two cells (whole m; min above `halfSize[1]`). */
  readonly half: readonly [number, number];
}

/** How a Floor grows levels: Halls at whole levels of `LEVEL_RISE` (2 m), sloped Passages and galleries. `max` 0 and `galleryPercent` 0 make every Floor flat. */
export interface DelverLevelsTuning {
  /** The highest Hall level (whole, 0 to 6; 0: a flat Floor). */
  readonly max: number;
  /** The fewest distinct Hall levels a Floor must have (whole, 1 to `max + 1`; the judge's `levels` rule). */
  readonly min: number;
  /** The chance (in 100) that a tree Passage rises or falls a level. */
  readonly changePercent: number;
  /** The share (in 100) of the Halls with room for a gallery that get one. */
  readonly galleryPercent: number;
}

/** Galleries (docs/plans/delver.md, Stage 7c), each a chance in 100. `wrapPercent` 0 and `stairPercent` 0 make every gallery as Stage 6's. */
export interface DelverGalleriesTuning {
  /** The chance that a gallery wraps onto the next wall (an L) when an L fits. */
  readonly wrapPercent: number;
  /** The chance that a wrapped gallery goes on to the wall after (a U) when a U fits. */
  readonly uPercent: number;
  /** The chance that a gallery Hall with a fitting side holding a tree Passage takes its gallery on such a side (a stairwell). */
  readonly stairPercent: number;
}

/**
 * A Warband template (docs/plans/delver.md, Stage 3; its rows by skill since docs/plans/delver-troops.md): the Soldiers a Warband deploys
 * with, in list order (the first its rank and file), and its HP scale. Each row names an AI difficulty (its skill) and a count; each of its
 * Soldiers is a Variant of that skill of one of its Floor's Prefabs (`floorPrefabs`), picked from the Run seed.
 */
export interface WarbandTemplate {
  /** Each row's skill (a name from `ai.difficulties`) and how many Soldiers of it. */
  readonly troops: readonly { readonly skill: string; readonly count: number }[];
  /** Multiplies each Soldier's HP (on top of its tier's `tierHp`); positive. */
  readonly hpScale: number;
  /** The Relics its Soldiers' promoted Fighters wear (1 or 2 names, an elite template's), on top of their Variant's own; `[]` for a guard, patrol or Boss guard template. */
  readonly relics: readonly string[];
}

/**
 * A Variant of a Delver Prefab (docs/plans/delver-troops.md): everything about a Soldier that is not drawn. Its Size is not its own: it
 * follows the Soldier's final HP (`delver.sizeHp`), and its tint follows its difficulty (`delver.skillTints`).
 */
export interface DelverVariant {
  /** Its name, for people and for a tier's Boss to name it; unique over every Prefab's Variants. */
  readonly name: string;
  /** Its HP, in a Fighter's units, before its tier's and its template's scales (a Boss's is its whole HP). */
  readonly hp: number;
  /** The AI difficulty a promoted Soldier of it plays (a name from `ai.difficulties`): its skill. */
  readonly difficulty: string;
  /** The AI Style it plays (a name from `ai.styles`). */
  readonly style: string;
  /** The Relics (0 to MAX_ENEMY_RELICS names) its promoted Fighter wears; an elite Soldier of it wears its template's set on top. */
  readonly relics: readonly string[];
  /** A promoted Soldier's Mods, as a Relic's multipliers (default `battle.soldier.mods`). */
  readonly mods: RelicEffects;
  /** Its Crowd stats (default the Crowd's own): a blow's damage, its chance and the engage reach. */
  readonly damage: readonly [number, number];
  readonly hitChance: number;
  readonly engageReach: number;
  /** A Boss Variant: only a tier's Boss is of it, and it fills no template row. */
  readonly boss?: true;
}

/** A Delver Prefab (docs/plans/delver-troops.md): one Body and one Weapon, one impostor atlas, and its Variants. */
export interface DelverPrefab {
  readonly name: string;
  /** The Body model (a name from the Body roster, `src/render/bodyModel.ts`). Render-only. */
  readonly body: string;
  /** The Weapon (a name from the Weapon roster). */
  readonly weapon: string;
  readonly variants: readonly DelverVariant[];
}

/** A tier's Boss (docs/plans/delver.md, Stage 4): its Soldier's Variant (a Boss Variant of `delver.troops`) and the guard Warband that stands with it. */
export interface DelverBoss {
  /** The Boss Variant's name. */
  readonly troop: string;
  /** Its Prefab (an index into `delver.troops`) and its Variant there. */
  readonly prefab: number;
  readonly variant: number;
  /** The plain templates the Boss Warband's other Soldiers are picked from (with the Boss at most `battle.squad.size`). */
  readonly guard: readonly WarbandTemplate[];
}

/** One tier's Warband pools: the templates a post's guard and a patrol loop's patrol are picked from, its elites and its Boss. */
export interface DelverTier {
  readonly guard: readonly WarbandTemplate[];
  readonly patrol: readonly WarbandTemplate[];
  /** The elite pool: templates carrying Relics; may be empty or absent (no elites in this tier). */
  readonly elite?: readonly WarbandTemplate[];
  /** This tier's Boss; absent: its last Floor is an ordinary Floor. */
  readonly boss?: DelverBoss;
}

/** The names the Prefabs, a Boss and an elite are checked against (the Weapon roster, `ai.difficulties`, `ai.styles` and the Relics). */
export interface DelverNames {
  readonly weapons: readonly string[];
  readonly difficulties: readonly string[];
  readonly styles: readonly string[];
  readonly relics: readonly string[];
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
  /** How many of a Floor's filled posts hold an elite Warband (whole, >= 0). */
  readonly elitePosts: number;
  /** The share (whole percent, 0 to 100) of a Floor's patrol loops that hold a patrol. */
  readonly patrolFill: number;
  /** The Soldiers each Warband gains of its first Troop per human beyond the first (0 or more; the fraction is a seeded chance). */
  readonly perPlayerSoldiers: number;
  /** A Bubble's Attack Slots by the number of Bubbles in use, 1 to MAX_TEAM_SIZE (whole, >= 1); the Floor's `slots` are built from it. */
  readonly attackSlots: readonly number[];
  /** Each tier's multiple of a Troop's HP (positive), one per tier. */
  readonly tierHp: readonly number[];
  /**
   * Each tier's Halls wanted on its Floors (whole, 2 to `floor.cols * floor.rows`), one per tier: what `floor.rooms` is for that tier's Floors
   * (`floorTuningOf`). Absent: every tier's Floors have `floor.rooms`.
   */
  readonly tierRooms?: readonly number[];
  /** Each tier's Warband templates, one per tier. */
  readonly warbands: readonly DelverTier[];
  /** The Delver's own Troops (docs/plans/delver-troops.md): Prefabs, each one Body and Weapon with its Variants. The Battles' `battle.troops` are never a Floor's. */
  readonly troops: readonly DelverPrefab[];
  /** How many Prefabs (whole, >= 1) each Floor fields, all different, picked from the Run seed; a Boss Floor's Boss's Prefab comes on top. */
  readonly prefabsPerFloor: number;
  /** A Soldier's Size follows its final HP: the smallest body (MIN_SIZE) at `sizeHp[0]` HP or less, the biggest (MAX_SIZE) at `sizeHp[1]` or more. */
  readonly sizeHp: readonly [number, number];
  /** The colour (0xRRGGBB) of a Soldier's team-coloured part by its skill (its AI difficulty); a difficulty not named wears Team 1's colour. Render-only. */
  readonly skillTints: Readonly<Record<string, number>>;
  /** The traitors' rules (docs/plans/delver.md, Stage 8a): Players on Team 1 who take over Warband Soldiers. */
  readonly traitor: TraitorTuning;
  readonly floor: DelverFloorTuning;
}

/** How a traitor takes over Warband Soldiers (docs/plans/delver.md, Stage 8a; `delver.traitor`). */
export interface TraitorTuning {
  /** How far (m, by walking) from every party Fighter a Soldier must be for a traitor to take it over (positive). */
  readonly minDistance: number;
  /** The seconds a traitor watches after its first fall (and at the Run's start and each Floor's) before it takes over a Soldier (>= 0). */
  readonly respawnSeconds: number;
  /** The seconds each earlier death adds to that wait (>= 0). */
  readonly respawnStep: number;
  /** The longest wait (seconds, >= respawnSeconds). */
  readonly respawnMax: number;
}

/** `delver.traitor` when Tuning Data names none. */
const DEFAULT_TRAITOR: TraitorTuning = { minDistance: 20, respawnSeconds: 8, respawnStep: 4, respawnMax: 30 };

/** `delver.traitor`, checked (absent: DEFAULT_TRAITOR). */
function parseTraitor(v: unknown): TraitorTuning {
  if (v === undefined) return DEFAULT_TRAITOR;
  const t = record(v, 'delver.traitor');
  const w = 'delver.traitor';
  const minDistance = positive(t, 'minDistance', w);
  const atLeast0 = (key: string): number => {
    const n = finiteNumber(t, key, w);
    if (n < 0) fail(`${w}.${key}`, 'a number >= 0', n);
    return n;
  };
  const respawnSeconds = atLeast0('respawnSeconds');
  const respawnStep = atLeast0('respawnStep');
  const respawnMax = atLeast0('respawnMax');
  if (respawnMax < respawnSeconds) fail(`${w}.respawnMax`, `at least respawnSeconds (${respawnSeconds})`, respawnMax);
  return { minDistance, respawnSeconds, respawnStep, respawnMax };
}

/**
 * The smallest Hall half-width: a pedestal 3 m from the centre plus the judge's 1 m margin, which also covers the Stairs' 2 m half
 * zone and a spawn 1.5 m out, each plus that margin. (The Floor generator's constants live in `sim/delver`, which tuning must not import.)
 */
const MIN_HALL_HALF = 4;

/** A level's rise (m): `LEVEL_RISE` of `sim/delver/plan.ts`, copied since tuning must not import the Simulation (a test keeps the two equal). A sloped Passage rises one level over its whole length. */
const LEVEL_RISE = 2;

/** The most great halls `great.count` may name. */
const MAX_GREAT = 4;

/** The highest Hall level `levels.max` may name. */
const MAX_LEVELS = 6;

/** The most Troops a Floor's Crowd may index: every Prefab's Variants, and each non-Boss Variant again for each distinct elite Relic set (`parseDelver` refuses more; the wire reads a Troop index below it). */
export const MAX_FLOOR_TROOPS = 256;

/** The most Prefabs `delver.troops` names. */
export const MAX_PREFABS = 32;

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

/** A record of whole weights, at least 0, with exactly `keys` and a sum of at least 1. */
function weights<K extends string>(raw: unknown, where: string, keys: readonly K[]): Record<K, number> {
  const r = record(raw, where);
  for (const k of Object.keys(r)) if (!keys.includes(k as K)) fail(`${where}.${k}`, `absent (the keys are exactly ${keys.join(', ')})`, r[k]);
  const out = {} as Record<K, number>;
  let sum = 0;
  for (const k of keys) {
    out[k] = whole(r, k, where, 0);
    sum += out[k];
  }
  if (sum < 1) fail(where, 'weights summing to at least 1', raw);
  return out;
}

function positive(obj: Record<string, unknown>, key: string, where: string): number {
  const v = finiteNumber(obj, key, where);
  if (v <= 0) fail(`${where}.${key}`, 'a positive number', v);
  return v;
}

/** `min` to MAX_ENEMY_RELICS names, each a Relic that exists. */
function relicList(raw: unknown, where: string, relicNames: readonly string[], min: number): string[] {
  const list = array(raw, where);
  if (list.length < min || list.length > MAX_ENEMY_RELICS) fail(where, `${min} to ${MAX_ENEMY_RELICS} Relics`, raw);
  return list.map((name, k) => {
    if (typeof name !== 'string' || !relicNames.includes(name)) fail(`${where}[${k}]`, `one of the Relics (${relicNames.join(', ')})`, name);
    return name;
  });
}

interface PoolOptions {
  /** An elite pool: each template names its Relics, and the pool may be empty. */
  readonly elite?: boolean;
  /** Soldiers kept back from `battle.squad.size` (the Boss's one). */
  readonly reserve?: number;
}

function parsePool(raw: unknown, path: string, battle: Pick<BattleTuning, 'squad'>, names: DelverNames, opts: PoolOptions = {}): WarbandTemplate[] {
  const list = array(raw, path);
  if (list.length === 0 && !opts.elite) fail(path, 'a non-empty array', raw);
  const room = battle.squad.size - (opts.reserve ?? 0);
  return list.map((item, i) => {
    const where = `${path}[${i}]`;
    const t = record(item, where);
    const rows = array(t.troops, `${where}.troops`);
    if (rows.length === 0) fail(`${where}.troops`, 'a non-empty array', t.troops);
    let total = 0;
    const troops = rows.map((r, k) => {
      const w = `${where}.troops[${k}]`;
      const row = record(r, w);
      const skill = row.skill;
      if (typeof skill !== 'string' || !names.difficulties.includes(skill)) fail(`${w}.skill`, `one of the AI difficulties (${names.difficulties.join(', ')})`, skill);
      const count = whole(row, 'count', w, 1);
      total += count;
      return { skill, count };
    });
    if (total > room) fail(`${where}.troops`, `1 to ${room} Soldiers in all (battle.squad.size ${battle.squad.size}${opts.reserve ? ` less the Boss's ${opts.reserve}` : ''})`, total);
    let relics: string[] = [];
    if (opts.elite) relics = relicList(t.relics, `${where}.relics`, names.relics, 1);
    // Parsed data names a plain template's Relics `[]`, so an empty list is accepted back; anything else is an elite's.
    else if (t.relics !== undefined && !(Array.isArray(t.relics) && t.relics.length === 0)) fail(`${where}.relics`, 'absent (only an elite template carries Relics)', t.relics);
    return { troops, hpScale: positive(t, 'hpScale', where), relics };
  });
}

function parseBoss(raw: unknown, where: string, battle: Pick<BattleTuning, 'squad'>, names: DelverNames, prefabs: readonly DelverPrefab[]): DelverBoss {
  const b = record(raw, where);
  const name = b.troop;
  let prefab = -1;
  let variant = -1;
  prefabs.forEach((p, i) =>
    p.variants.forEach((v, k) => {
      if (v.boss && v.name === name) [prefab, variant] = [i, k];
    }),
  );
  if (prefab < 0) fail(`${where}.troop`, `the name of a Boss Variant of delver.troops (${prefabs.flatMap((p) => p.variants.filter((v) => v.boss).map((v) => v.name)).join(', ')})`, name);
  return { troop: name as string, prefab, variant, guard: parsePool(b.guard, `${where}.guard`, battle, names, { reserve: 1 }) };
}

/** A colour, "#rrggbb" in the file (a number once parsed). */
function colour(v: unknown, where: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return parseInt(v.slice(1), 16);
  return fail(where, 'a colour "#rrggbb"', v);
}

/** A [min, max] pair of numbers, 0 <= min <= max. */
function pair(raw: unknown, where: string): [number, number] {
  const a = array(raw, where);
  if (a.length !== 2 || a.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || (a[0] as number) > (a[1] as number)) fail(where, '[min, max] with 0 <= min <= max', raw);
  return [a[0] as number, a[1] as number];
}

/** A soldier's Mods: Relic multipliers only, each positive. */
function soldierMods(raw: unknown, where: string): RelicEffects {
  const md = record(raw, where);
  for (const k of Object.keys(md)) if (!(RELIC_MULTIPLIERS as readonly string[]).includes(k)) fail(`${where}.${k}`, `absent (a soldier's Mods are only ${RELIC_MULTIPLIERS.join(', ')})`, md[k]);
  return Object.fromEntries(Object.keys(md).map((k) => [k, positive(md, k, where)])) as RelicEffects;
}

/** A chance from 0 to 1. */
function share(obj: Record<string, unknown>, key: string, where: string): number {
  const v = finiteNumber(obj, key, where);
  if (v < 0 || v > 1) fail(`${where}.${key}`, 'a number from 0 to 1', v);
  return v;
}

/** A non-empty string at `obj[key]`. */
function text(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v === '') fail(`${where}.${key}`, 'a non-empty string', v);
  return v;
}

/** One of `list` at `obj[key]` (or `fallback` when it is absent). */
function oneOf(obj: Record<string, unknown>, key: string, where: string, list: readonly string[], what: string, fallback?: string): string {
  const v = obj[key] === undefined ? fallback : obj[key];
  if (typeof v !== 'string' || !list.includes(v)) fail(`${where}.${key}`, `${what} (${list.join(', ')})`, v);
  return v;
}

/**
 * `delver.troops`: the Prefabs and their Variants. A Variant's Style, Mods and Crowd stats default to its Prefab's, and those to the
 * Battles' generic soldier's (`battle.crowd`, `battle.soldier.mods`) and the default Style (DEFAULT_STYLE).
 */
function parsePrefabs(raw: unknown, battle: Pick<BattleTuning, 'crowd' | 'soldier'>, names: DelverNames): DelverPrefab[] {
  const list = array(raw, 'delver.troops');
  if (list.length < 1 || list.length > MAX_PREFABS) fail('delver.troops', `1 to ${MAX_PREFABS} Prefabs`, raw);
  const prefabNames = new Set<string>();
  const variantNames = new Set<string>();
  const looks = new Set<string>();
  return list.map((item, i) => {
    const where = `delver.troops[${i}]`;
    const p = record(item, where);
    const name = text(p, 'name', where);
    if (prefabNames.has(name)) fail(`${where}.name`, 'a name no other Prefab has', name);
    prefabNames.add(name);
    const body = text(p, 'body', where);
    const weapon = oneOf(p, 'weapon', where, names.weapons, 'one of the Weapons');
    // A Prefab is its look: two with the same Body and Weapon would be one atlas, so they are one Prefab with more Variants.
    const look = `${body}\n${weapon}`;
    if (looks.has(look)) fail(where, `a Body and Weapon no other Prefab has (${body} with ${weapon})`, { body, weapon });
    looks.add(look);
    const base = {
      damage: p.damage === undefined ? battle.crowd.damage : pair(p.damage, `${where}.damage`),
      hitChance: p.hitChance === undefined ? battle.crowd.hitChance : share(p, 'hitChance', where),
      engageReach: p.engageReach === undefined ? battle.crowd.engageReach : positive(p, 'engageReach', where),
      mods: p.mods === undefined ? battle.soldier.mods : soldierMods(p.mods, `${where}.mods`),
      style: oneOf(p, 'style', where, names.styles, 'one of the AI Styles', DEFAULT_STYLE),
    };
    const variantList = array(p.variants, `${where}.variants`);
    if (variantList.length === 0) fail(`${where}.variants`, 'a non-empty array', p.variants);
    const variants = variantList.map((rawVariant, k): DelverVariant => {
      const w = `${where}.variants[${k}]`;
      const v = record(rawVariant, w);
      const difficulty = oneOf(v, 'difficulty', w, names.difficulties, 'one of the AI difficulties');
      if (v.boss !== undefined && v.boss !== true && v.boss !== false) fail(`${w}.boss`, 'true, or absent', v.boss);
      const boss = v.boss === true;
      if (boss && v.name === undefined) fail(`${w}.name`, 'a name (a tier names its Boss Variant)', v.name);
      const vname = v.name === undefined ? `${name} (${difficulty})` : text(v, 'name', w);
      if (variantNames.has(vname)) fail(`${w}.name`, 'a name no other Variant has', vname);
      variantNames.add(vname);
      return {
        name: vname,
        hp: positive(v, 'hp', w),
        difficulty,
        style: oneOf(v, 'style', w, names.styles, 'one of the AI Styles', base.style),
        relics: v.relics === undefined ? [] : relicList(v.relics, `${w}.relics`, names.relics, 0),
        mods: v.mods === undefined ? base.mods : soldierMods(v.mods, `${w}.mods`),
        damage: v.damage === undefined ? base.damage : pair(v.damage, `${w}.damage`),
        hitChance: v.hitChance === undefined ? base.hitChance : share(v, 'hitChance', w),
        engageReach: v.engageReach === undefined ? base.engageReach : positive(v, 'engageReach', w),
        ...(boss ? { boss: true as const } : {}),
      };
    });
    return { name, body, weapon, variants };
  });
}

/** Whether Prefab `p` fills template rows: it has a Variant that is not a Boss's. */
export const regularPrefab = (p: DelverPrefab): boolean => p.variants.some((v) => !v.boss);

/** The distinct Relic sets of every tier's elite templates, in the order first met (tier by tier, template by template), each as its key (`relics.join('\n')`). */
export function eliteRelicSets(delver: Pick<DelverTuning, 'warbands'>): string[] {
  return [...new Set(delver.warbands.flatMap((t) => (t.elite ?? []).map((e) => e.relics.join('\n'))))];
}

/** The number of Troops a Floor's Crowd indexes (`floorTroops`): every Variant, and every non-Boss Variant once more for each distinct elite Relic set. */
export function floorTroopCount(delver: Pick<DelverTuning, 'troops' | 'warbands'>): number {
  const all = delver.troops.reduce((n, p) => n + p.variants.length, 0);
  const plain = delver.troops.reduce((n, p) => n + p.variants.filter((v) => !v.boss).length, 0);
  return all + eliteRelicSets(delver).length * plain;
}

/**
 * Parse and validate `delver`; `fieldSize` is the Battle's field side (`battle.field.size`), which the lattice must fit, and `battle` the parsed
 * Battle Tuning, for the Troop names, `squad.size` and the Pool the Attack Slots must fit.
 */
export function parseDelver(raw: unknown, fieldSize: number, battle: Pick<BattleTuning, 'squad' | 'bubble' | 'crowd' | 'soldier'>, names: DelverNames): DelverTuning {
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
  const elitePosts = root.elitePosts === undefined ? 1 : whole(root, 'elitePosts', 'delver', 0);
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
  const troops = parsePrefabs(root.troops, battle, names);
  if (!troops.some(regularPrefab)) fail('delver.troops', "at least one Prefab with a Variant that is not a Boss's", root.troops);
  const prefabsPerFloor = whole(root, 'prefabsPerFloor', 'delver', 1);
  const sizeHp = pair(root.sizeHp, 'delver.sizeHp');
  if (sizeHp[0] <= 0 || sizeHp[1] <= sizeHp[0]) fail('delver.sizeHp', '[min, max] HP with 0 < min < max', root.sizeHp);
  const tintRaw = record(root.skillTints, 'delver.skillTints');
  const skillTints: Record<string, number> = {};
  for (const k of Object.keys(tintRaw)) {
    if (!names.difficulties.includes(k)) fail(`delver.skillTints.${k}`, `absent (the keys are AI difficulties: ${names.difficulties.join(', ')})`, tintRaw[k]);
    skillTints[k] = colour(tintRaw[k], `delver.skillTints.${k}`);
  }
  const tierList = array(root.warbands, 'delver.warbands');
  if (tierList.length !== tiers) fail('delver.warbands', `${tiers} tiers (one per tier)`, root.warbands);
  const warbands = tierList.map((item, i): DelverTier => {
    const where = `delver.warbands[${i}]`;
    const tier = record(item, where);
    const guard = parsePool(tier.guard, `${where}.guard`, battle, names);
    const patrol = parsePool(tier.patrol, `${where}.patrol`, battle, names);
    const elite = tier.elite === undefined ? [] : parsePool(tier.elite, `${where}.elite`, battle, names, { elite: true });
    return { guard, patrol, elite, ...(tier.boss === undefined ? {} : { boss: parseBoss(tier.boss, `${where}.boss`, battle, names, troops) }) };
  });
  // Every template row must be fillable on any Floor: each Prefab that fills rows has a non-Boss Variant of every skill a row names.
  const skills = [...new Set(warbands.flatMap((t) => [...t.guard, ...t.patrol, ...(t.elite ?? []), ...(t.boss?.guard ?? [])].flatMap((tp) => tp.troops.map((r) => r.skill))))];
  troops.forEach((p, i) => {
    if (!regularPrefab(p)) return;
    for (const skill of skills)
      if (!p.variants.some((v) => !v.boss && v.difficulty === skill))
        fail(`delver.troops[${i}].variants`, `a non-Boss Variant of every skill a template row names (${skills.join(', ')}); ${p.name} has none of ${skill}`, p.variants.map((v) => v.difficulty));
  });
  const floorTroops = floorTroopCount({ troops, warbands });
  if (floorTroops > MAX_FLOOR_TROOPS) fail('delver.troops', `at most ${MAX_FLOOR_TROOPS} Floor Troops (every Variant, and each non-Boss Variant again per distinct elite Relic set), got ${floorTroops}`, floorTroops);
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

  let tierRooms: number[] | undefined;
  if (root.tierRooms !== undefined) {
    const list = array(root.tierRooms, 'delver.tierRooms');
    if (list.length !== tiers) fail('delver.tierRooms', `${tiers} whole numbers (one per tier)`, root.tierRooms);
    tierRooms = list.map((n, i) => {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > cols * rows) fail(`delver.tierRooms[${i}]`, `a whole number 2 to cols * rows (${cols * rows})`, n);
      return n;
    });
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

  const lv = record(f.levels, `${w}.levels`);
  const lw = `${w}.levels`;
  const levelMax = whole(lv, 'max', lw, 0);
  if (levelMax > MAX_LEVELS) fail(`${lw}.max`, `a whole number 0 to ${MAX_LEVELS}`, levelMax);
  const levelMin = whole(lv, 'min', lw, 1);
  if (levelMin > levelMax + 1) fail(`${lw}.min`, `a whole number 1 to max + 1 (${levelMax + 1})`, levelMin);
  const changePercent = percent(lv, 'changePercent', lw);
  const galleryPercent = percent(lv, 'galleryPercent', lw);
  // A sloped Passage rises one level over its whole length, so it is never steeper than 1 in 2 (MAX_SLOPE).
  if (levelMax > 0 && minPassage < 2 * LEVEL_RISE) fail(`${w}.minPassage`, `at least 2 * LEVEL_RISE (${2 * LEVEL_RISE}) when levels.max is above 0, so a sloped Passage is never steeper than 1 in 2`, minPassage);

  const ga = record(f.galleries, `${w}.galleries`);
  const galleries = { wrapPercent: percent(ga, 'wrapPercent', `${w}.galleries`), uPercent: percent(ga, 'uPercent', `${w}.galleries`), stairPercent: percent(ga, 'stairPercent', `${w}.galleries`) };

  const fe = record(f.features, `${w}.features`);
  const fw = `${w}.features`;
  const deepList = array(fe.deepPercent, `${fw}.deepPercent`);
  if (deepList.length === 0) fail(`${fw}.deepPercent`, 'a non-empty array of percents (one per Run tier)', fe.deepPercent);
  const deepPercent = deepList.map((d, i) => {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 100) fail(`${fw}.deepPercent[${i}]`, 'a whole number 0 to 100', d);
    return d;
  });
  const features = { percent: percent(fe, 'percent', fw), weights: weights(fe.weights, `${fw}.weights`, ['split', 'pit'] as const), threePercent: percent(fe, 'threePercent', fw), deepPercent, daisPercent: percent(fe, 'daisPercent', fw) };
  // A split's main tier stands a level over its outer one and a pit's rim a level over its floor.
  if (features.percent > 0 && levelMax < 1) fail(`${fw}.percent`, '0 when levels.max is 0 (a split\'s main tier stands a level over its outer one, and a pit\'s rim a level over its floor)', features.percent);

  const turnPercent = percent(f, 'turnPercent', w);
  const gt = record(f.great, `${w}.great`);
  const gw = `${w}.great`;
  const greatCount = range(gt, 'count', gw, 0);
  if (greatCount[1] > MAX_GREAT) fail(`${gw}.count[1]`, `a whole number at most ${MAX_GREAT}`, greatCount[1]);
  // A Boss Floor picks G = count[0] + a pick of count[1] - count[0] + 1: with count[0] 0 it could pick 0 and the Boss Hall would never be a great hall.
  if (greatCount[1] > 0 && greatCount[0] < 1) fail(`${gw}.count[0]`, 'at least 1 when count[1] is above 0, so a Boss Floor always has its great Boss Hall', greatCount[0]);
  const greatHalf = range(gt, 'half', gw, 0);
  if (greatHalf[0] <= halfSize[1]) fail(`${gw}.half[0]`, `above halfSize[1] (${halfSize[1]}), so a great hall is larger than any Hall`, greatHalf[0]);
  // A great hall's long half may move one metre up to dodge an even-metre Wall and must keep `minPassage` from the cells beyond it (plan.ts).
  const greatMax = minGap / 2 + Math.min(Math.floor((minGap - minPassage) / 2), halfSize[1]);
  if (greatHalf[1] + 1 > greatMax) fail(`${gw}.half[1]`, `at most min(gaps) / 2 + min(floor((min(gaps) - minPassage) / 2), halfSize[1]) - 1 (${greatMax - 1}), so a great hall can always take its size and dodge an even-metre Wall`, greatHalf[1]);

  const sh = record(f.shapes, `${w}.shapes`);
  const shapes = { percent: percent(sh, 'percent', `${w}.shapes`), weights: weights(sh.weights, `${w}.shapes.weights`, ['L', 'T', 'cross', 'ring'] as const) };
  const pl = record(f.pillars, `${w}.pillars`);
  const pillars = { percent: percent(pl, 'percent', `${w}.pillars`), weights: weights(pl.weights, `${w}.pillars.weights`, ['colonnade', 'grid'] as const) };

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
    elitePosts,
    patrolFill,
    perPlayerSoldiers,
    attackSlots,
    tierHp,
    ...(tierRooms ? { tierRooms } : {}),
    warbands,
    troops,
    prefabsPerFloor,
    sizeHp,
    skillTints,
    traitor: parseTraitor(root.traitor),
    floor: { cols, rows, rooms, gaps, halfSize, minPassage, passage, farPercent, loops, rests, treasures, emptyPercent, patrols, follow, maxAttempts, levels: { max: levelMax, min: levelMin, changePercent, galleryPercent }, galleries, features, turnPercent, great: { count: greatCount, half: greatHalf }, shapes, pillars },
  };
}
