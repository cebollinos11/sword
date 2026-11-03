/**
 * The Battle as Tuning Data (data/battle.json, hashed): docs/plans/big-battle.md. The army size, the Battlefield's size
 * and terrain, where the armies deploy, how the Crowd steps, moves and fights, and when a Team routs. Distances in metres,
 * speeds in m/s, HP in a Fighter's units, times in seconds.
 */
import { RELIC_MULTIPLIERS, type RelicEffects } from './relics';
import { array, nonEmptyString, nonNegativeNumber, positiveNumber, record, TuningDataError } from './validate';

export interface BattlefieldTuning {
  /** The side of the square field (m), centred on the origin. */
  readonly size: number;
  /** The heightfield's grid cell (m): heights are sampled at its corners, and each cell is two Walk Surface triangles. Divides `size`. */
  readonly cell: number;
  /** How high the hills rise and fall (m) around 0: the most a sample may stand from 0. 0 is a flat field. */
  readonly hillHeight: number;
  /** About how far (m) from one hilltop to the next. */
  readonly hillLength: number;
}

export interface DeployTuning {
  /** How far from the field's centre (m, along z) each army's front rank stands: Team 0 at -z, Team 1 at +z. */
  readonly front: number;
  /** Soldiers in each rank (a whole number). */
  readonly perRank: number;
  /** Between neighbours in a rank (m). */
  readonly file: number;
  /** Between ranks (m). */
  readonly rank: number;
}

export interface CrowdTuning {
  /** A Soldier updates every `stagger` Ticks, 1/stagger of the Soldiers on each Tick (a whole number, at least 1). */
  readonly stagger: number;
  readonly walkSpeed: number;
  /** A Soldier's HP at the start (a Fighter's units). */
  readonly hp: number;
  /** The damage of one blow that lands: uniform between the two (min, max). */
  readonly damage: readonly [number, number];
  /** The chance an engaged Soldier lands a blow on each of its Crowd steps (0 to 1). */
  readonly hitChance: number;
  /** An enemy this close (m, centre to centre) is engaged: the Soldier stands and trades blows with it. */
  readonly engageReach: number;
  /** Soldiers closer than this (m, centre to centre) push apart. */
  readonly separation: number;
  /** The furthest (m) a Soldier sees an enemy to walk at; beyond it, it follows its Team's flow field. */
  readonly sight: number;
  /** The flow field's grid cell (m). */
  readonly flowCell: number;
}

export interface RoutTuning {
  /** A Team routs once its living Soldiers fall below this share of `armySize` (0 to 1). */
  readonly threshold: number;
  /** How long a routed Team flees before the Battle ends (s). */
  readonly seconds: number;
}

/** The generic soldier both armies field: one Body and Weapon, told apart by each Team's colour. */
export interface SoldierTuning {
  /** The Body model a Soldier is drawn as (a name from the Body roster, `src/render/bodyModel.ts`). Render-only. */
  readonly body: string;
  /** The Weapon it wields (a name from the Weapon roster). */
  readonly weapon: string;
  /** Each Team's colour (0xRRGGBB), on the Body's team-coloured part: [Team 0, Team 1]. Render-only. */
  readonly colours: readonly [number, number];
  /** The AI difficulty a promoted Soldier plays (a name from `ai.difficulties`). */
  readonly difficulty: string;
  /** How a promoted Soldier fights in a Battle: a Style (multipliers on that difficulty's chances, as `ai.styles`), for the Battle only, so no Duel changes. */
  readonly style: Readonly<Record<string, number>>;
  /**
   * A promoted Soldier's Mods, as a Relic's effects (multipliers only: `damage`, `damageTaken`, ...), so a soldier fights as a
   * soldier, not as a Duel's Fighter. A Player who takes a Soldier over drops them: it fights at its own strength.
   */
  readonly mods: RelicEffects;
}

/**
 * The Bubble round each Player's Fighter (docs/plans/big-battle.md, Stage 3): where Soldiers promote to full Fighters in
 * the Fighter Pool, and when they demote back to the Crowd.
 */
export interface BubbleTuning {
  /** Slots in a Battle's Fighter Pool, the Players' Fighters' included (a whole number). */
  readonly poolSize: number;
  /** A living Soldier this close (m, across the ground) to a Player's Fighter promotes, nearest first, while a slot is free. */
  readonly promote: number;
  /** A promoted Fighter further than this (m) from every Player's Fighter demotes, when its Action allows. More than `promote`. */
  readonly demote: number;
  /** A promoted Fighter never demotes sooner than this after its Promotion (s). */
  readonly minPromotedSeconds: number;
  /** A promoted Fighter that falls keeps its slot this long (s), so its Death Ragdoll plays, before it goes back to the Crowd as a fallen Soldier. */
  readonly corpseSeconds: number;
  /** A Soldier never steps closer than this (m) to an enemy full Fighter: it holds outside sword reach. */
  readonly hold: number;
}

/**
 * The Attack Slots and ally slots of each Bubble (docs/plans/big-battle.md, Stage 4): how many of a Player's enemies fight
 * them as full Fighters at once, and how many of their allies are promoted to fight beside them.
 */
export interface SlotsTuning {
  /** A Bubble's Attack Slots: at most this many promoted enemies fight its Player at once (a whole number, at least 1). */
  readonly enemies: number;
  /** A Bubble's ally slots: at most this many allied Soldiers promote, while an enemy holds an Attack Slot (a whole number, 0 or more). */
  readonly allies: number;
  /** A slot-holding enemy with a promoted ally this close (m), nearer it than any Player, may be engaged by that ally (one enemy to an ally) and lets its Attack Slot go. */
  readonly engaged: number;
  /**
   * Each Bubble's slots while several are in use (docs/plans/big-battle.md, Stage 6): entry n - 2 for n Bubbles (the last entry for more),
   * so the Bubbles share the Pool and it never overflows. Each entry is no larger than the one before (or `enemies` and `allies`), and
   * n Bubbles' Players and slots fit the Pool.
   */
  readonly shared: readonly BubbleSlots[];
}

/** One Bubble's Attack Slots and ally slots. */
export interface BubbleSlots {
  readonly enemies: number;
  readonly allies: number;
}

/** Each Bubble's slots while `bubbles` of them are in use: `slots.enemies` and `slots.allies` for one (or none), else `slots.shared`'s entry. */
export function bubbleSlots(slots: SlotsTuning, bubbles: number): BubbleSlots {
  if (bubbles <= 1 || slots.shared.length === 0) return slots;
  return slots.shared[Math.min(bubbles - 2, slots.shared.length - 1)]!;
}

/**
 * The waiting ring (docs/plans/big-battle.md, Stage 4): where a Bubble's waiting enemies stand, and how Soldiers keep out of
 * a full Fighter's way. Steering only, never collision.
 */
export interface RingTuning {
  /** The first ring's radius round a Player's Fighter (m): just outside sword reach, at least `bubble.hold`, less than `bubble.promote`. */
  readonly radius: number;
  /** Between neighbouring spots on a ring, and between one ring and the next out (m). */
  readonly spacing: number;
  /** A Soldier stands in a moving full Fighter's path when it is less than this (m) ahead of it... */
  readonly pathAhead: number;
  /** ...and less than this (m) to either side of its line: then, if they are on one Team, it steps aside. */
  readonly pathWidth: number;
  /** The most enemy Soldiers that wait on a Player's ring at once, the nearest it (a whole number, 0 or more); the others fight on in the Crowd. */
  readonly waiting: number;
}

/** Taking over an ally (docs/plans/big-battle.md, Stage 5): a Player whose Fighter falls plays on as the nearest living ally Soldier. */
export interface TakeoverTuning {
  /** How long after its Fighter falls (s) a Player takes over its ally, its fall played out first. */
  readonly seconds: number;
}

export interface BattleTuning {
  /** Soldiers in each army (a whole number, at least 1). */
  readonly armySize: number;
  readonly field: BattlefieldTuning;
  readonly deploy: DeployTuning;
  readonly crowd: CrowdTuning;
  readonly rout: RoutTuning;
  readonly soldier: SoldierTuning;
  readonly bubble: BubbleTuning;
  readonly slots: SlotsTuning;
  readonly ring: RingTuning;
  readonly takeover: TakeoverTuning;
}

function wholeNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = positiveNumber(obj, key, where);
  if (!Number.isInteger(v)) throw new TuningDataError(`${where}.${key} must be a whole number, got ${v}`);
  return v;
}

function share(obj: Record<string, unknown>, key: string, where: string): number {
  const v = nonNegativeNumber(obj, key, where);
  if (v > 1) throw new TuningDataError(`${where}.${key} must be at most 1, got ${v}`);
  return v;
}

/** A colour written "#rrggbb" (or already a number, as parsed), as 0xRRGGBB. */
function colour(v: unknown, where: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return parseInt(v.slice(1), 16);
  throw new TuningDataError(`${where} must be a colour "#rrggbb", got ${JSON.stringify(v)}`);
}

/** Validate the raw Battle Tuning Data (with the Weapon roster's names, to check the soldier's Weapon, when given). Accepts its own output. */
export function parseBattle(raw: unknown, weapons?: readonly string[], difficulties?: readonly string[], styleKeys?: readonly string[]): BattleTuning {
  const b = record(raw, 'battle');
  const f = record(b.field, 'battle.field');
  const d = record(b.deploy, 'battle.deploy');
  const c = record(b.crowd, 'battle.crowd');
  const r = record(b.rout, 'battle.rout');
  const s = record(b.soldier, 'battle.soldier');
  const u = record(b.bubble, 'battle.bubble');
  const sl = record(b.slots, 'battle.slots');
  const rg = record(b.ring, 'battle.ring');
  const tk = record(b.takeover, 'battle.takeover');
  const field: BattlefieldTuning = {
    size: positiveNumber(f, 'size', 'battle.field'),
    cell: positiveNumber(f, 'cell', 'battle.field'),
    hillHeight: nonNegativeNumber(f, 'hillHeight', 'battle.field'),
    hillLength: positiveNumber(f, 'hillLength', 'battle.field'),
  };
  if (!Number.isInteger(field.size / field.cell)) throw new TuningDataError(`battle.field.cell (${field.cell}) must divide battle.field.size (${field.size})`);
  const dmg = array(c.damage, 'battle.crowd.damage');
  if (dmg.length !== 2 || dmg.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || (dmg[0] as number) > (dmg[1] as number))
    throw new TuningDataError(`battle.crowd.damage must be [min, max] with 0 <= min <= max, got ${JSON.stringify(c.damage)}`);
  const crowd: CrowdTuning = {
    stagger: wholeNumber(c, 'stagger', 'battle.crowd'),
    walkSpeed: positiveNumber(c, 'walkSpeed', 'battle.crowd'),
    hp: positiveNumber(c, 'hp', 'battle.crowd'),
    damage: [dmg[0] as number, dmg[1] as number],
    hitChance: share(c, 'hitChance', 'battle.crowd'),
    engageReach: positiveNumber(c, 'engageReach', 'battle.crowd'),
    separation: positiveNumber(c, 'separation', 'battle.crowd'),
    sight: positiveNumber(c, 'sight', 'battle.crowd'),
    flowCell: positiveNumber(c, 'flowCell', 'battle.crowd'),
  };
  const deploy: DeployTuning = {
    front: positiveNumber(d, 'front', 'battle.deploy'),
    perRank: wholeNumber(d, 'perRank', 'battle.deploy'),
    file: positiveNumber(d, 'file', 'battle.deploy'),
    rank: positiveNumber(d, 'rank', 'battle.deploy'),
  };
  const armySize = wholeNumber(b, 'armySize', 'battle');
  const depth = deploy.front + (Math.ceil(armySize / deploy.perRank) - 1) * deploy.rank;
  const width = (Math.min(armySize, deploy.perRank) - 1) * deploy.file;
  if (depth >= field.size / 2 || width >= field.size) throw new TuningDataError(`battle.deploy: an army of ${armySize} (${width} m wide, its last rank ${depth} m out) must fit inside the ${field.size} m field`);
  const weapon = nonEmptyString(s, 'weapon', 'battle.soldier');
  if (weapons && !weapons.includes(weapon)) throw new TuningDataError(`battle.soldier.weapon "${weapon}" is not a Weapon (${weapons.join(', ')})`);
  const difficulty = nonEmptyString(s, 'difficulty', 'battle.soldier');
  if (difficulties && !difficulties.includes(difficulty)) throw new TuningDataError(`battle.soldier.difficulty "${difficulty}" is not an AI difficulty (${difficulties.join(', ')})`);
  const st = record(s.style, 'battle.soldier.style');
  for (const k of Object.keys(st)) if (styleKeys && !styleKeys.includes(k)) throw new TuningDataError(`battle.soldier.style.${k}: a Style scales only ${styleKeys.join(', ')}`);
  const style = Object.fromEntries(Object.keys(st).map((k) => [k, nonNegativeNumber(st, k, 'battle.soldier.style')]));
  const md = record(s.mods, 'battle.soldier.mods');
  for (const k of Object.keys(md)) if (!(RELIC_MULTIPLIERS as readonly string[]).includes(k)) throw new TuningDataError(`battle.soldier.mods.${k}: a soldier's Mods are only ${RELIC_MULTIPLIERS.join(', ')}`);
  const mods = Object.fromEntries(Object.keys(md).map((k) => [k, positiveNumber(md, k, 'battle.soldier.mods')])) as RelicEffects;
  const colours = array(s.colours, 'battle.soldier.colours');
  if (colours.length !== 2) throw new TuningDataError(`battle.soldier.colours must be [Team 0, Team 1], got ${JSON.stringify(s.colours)}`);
  const bubble: BubbleTuning = {
    poolSize: wholeNumber(u, 'poolSize', 'battle.bubble'),
    promote: positiveNumber(u, 'promote', 'battle.bubble'),
    demote: positiveNumber(u, 'demote', 'battle.bubble'),
    minPromotedSeconds: nonNegativeNumber(u, 'minPromotedSeconds', 'battle.bubble'),
    corpseSeconds: nonNegativeNumber(u, 'corpseSeconds', 'battle.bubble'),
    hold: positiveNumber(u, 'hold', 'battle.bubble'),
  };
  if (bubble.demote <= bubble.promote) throw new TuningDataError(`battle.bubble.demote (${bubble.demote}) must be more than battle.bubble.promote (${bubble.promote})`);
  if (bubble.hold >= bubble.promote) throw new TuningDataError(`battle.bubble.hold (${bubble.hold}) must be less than battle.bubble.promote (${bubble.promote})`);
  const allies = nonNegativeNumber(sl, 'allies', 'battle.slots');
  if (!Number.isInteger(allies)) throw new TuningDataError(`battle.slots.allies must be a whole number, got ${allies}`);
  const slots: SlotsTuning = { enemies: wholeNumber(sl, 'enemies', 'battle.slots'), allies, engaged: positiveNumber(sl, 'engaged', 'battle.slots'), shared: [] };
  if (slots.enemies + slots.allies >= bubble.poolSize) throw new TuningDataError(`battle.slots: ${slots.enemies} enemies and ${slots.allies} allies must leave room in the Pool of ${bubble.poolSize} for the Player`);
  array(sl.shared, 'battle.slots.shared').forEach((raw, i) => {
    const where = `battle.slots.shared[${i}]`;
    const e = record(raw, where);
    const entry: BubbleSlots = { enemies: wholeNumber(e, 'enemies', where), allies: nonNegativeNumber(e, 'allies', where) };
    if (!Number.isInteger(entry.allies)) throw new TuningDataError(`${where}.allies must be a whole number, got ${entry.allies}`);
    const before = i === 0 ? slots : slots.shared[i - 1]!;
    if (entry.enemies > before.enemies || entry.allies > before.allies) throw new TuningDataError(`${where}: a Bubble's slots never grow as more Bubbles are in use`);
    const bubbles = i + 2;
    if (bubbles * (1 + entry.enemies + entry.allies) > bubble.poolSize)
      throw new TuningDataError(`${where}: ${bubbles} Bubbles of a Player, ${entry.enemies} enemies and ${entry.allies} allies must fit the Pool of ${bubble.poolSize}`);
    (slots.shared as BubbleSlots[]).push(entry);
  });
  const ring: RingTuning = {
    radius: positiveNumber(rg, 'radius', 'battle.ring'),
    spacing: positiveNumber(rg, 'spacing', 'battle.ring'),
    pathAhead: positiveNumber(rg, 'pathAhead', 'battle.ring'),
    pathWidth: positiveNumber(rg, 'pathWidth', 'battle.ring'),
    waiting: nonNegativeNumber(rg, 'waiting', 'battle.ring'),
  };
  if (!Number.isInteger(ring.waiting)) throw new TuningDataError(`battle.ring.waiting must be a whole number, got ${ring.waiting}`);
  if (ring.radius < bubble.hold || ring.radius >= bubble.promote) throw new TuningDataError(`battle.ring.radius (${ring.radius}) must be at least battle.bubble.hold (${bubble.hold}) and less than battle.bubble.promote (${bubble.promote})`);
  return {
    armySize,
    field,
    deploy,
    crowd,
    rout: { threshold: share(r, 'threshold', 'battle.rout'), seconds: positiveNumber(r, 'seconds', 'battle.rout') },
    soldier: {
      body: nonEmptyString(s, 'body', 'battle.soldier'),
      weapon,
      colours: [colour(colours[0], 'battle.soldier.colours[0]'), colour(colours[1], 'battle.soldier.colours[1]')],
      difficulty,
      style,
      mods,
    },
    bubble,
    slots,
    ring,
    takeover: { seconds: nonNegativeNumber(tk, 'seconds', 'battle.takeover') },
  };
}

/**
 * A Battle's options, picked in the Lobby (the host's, sent to every guest with the Lobby): each one absent keeps Tuning
 * Data as it is. `applyBattleKnobs` folds them into the Battle before it starts, so the Simulation and the Tuning Data hash
 * every peer compares see the same armies.
 */
export interface BattleKnobs {
  /** Soldiers in each army (replaces `armySize`; held to what fits the field, see `maxArmySize`). */
  readonly armySize?: number;
  /** Multiplies the chance a Soldier lands a blow each Crowd step (so the Crowd fights slower below 1; the product is held to 1). */
  readonly hitRate?: number;
}

/** Every Battle knob's key. */
export const BATTLE_KNOB_KEYS: readonly (keyof BattleKnobs)[] = ['armySize', 'hitRate'];

/** Battle knobs read back from storage: each of BATTLE_KNOB_KEYS that is a finite number (any other key dropped), or null for none. */
export function parseBattleKnobs(raw: unknown): BattleKnobs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const knobs = Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => (BATTLE_KNOB_KEYS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v)),
  ) as BattleKnobs;
  return Object.keys(knobs).length > 0 ? knobs : null;
}

/** The most Soldiers an army can be and still deploy inside the field (its last rank short of the middle), as `parseBattle` checks. */
export function maxArmySize(b: Pick<BattleTuning, 'field' | 'deploy'>): number {
  const ranks = Math.floor((b.field.size / 2 - b.deploy.front - 1e-9) / b.deploy.rank);
  return Math.max(1, ranks + 1) * b.deploy.perRank;
}

/** The Battle with the Lobby's knobs applied; `b` itself when none change anything. Out-of-range values are held to their range. */
export function applyBattleKnobs(b: BattleTuning, knobs: BattleKnobs | undefined): BattleTuning {
  if (!knobs) return b;
  const { armySize = b.armySize, hitRate = 1 } = knobs;
  const army = Math.min(maxArmySize(b), Math.max(1, Math.round(armySize)));
  const hitChance = Math.min(1, b.crowd.hitChance * (hitRate > 0 ? hitRate : 1));
  if (army === b.armySize && hitChance === b.crowd.hitChance) return b;
  return { ...b, armySize: army, crowd: { ...b.crowd, hitChance } };
}
