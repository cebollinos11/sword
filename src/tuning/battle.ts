/**
 * The Battle as Tuning Data (data/battle.json, hashed): docs/plans/big-battle.md. The army size, the Battlefield's size
 * and terrain, where the armies deploy, how the Crowd steps, moves and fights, and when a Team routs. Distances in metres,
 * speeds in m/s, HP in a Fighter's units, times in seconds.
 */
import { array, nonNegativeNumber, positiveNumber, record, TuningDataError } from './validate';

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

export interface BattleTuning {
  /** Soldiers in each army (a whole number, at least 1). */
  readonly armySize: number;
  readonly field: BattlefieldTuning;
  readonly deploy: DeployTuning;
  readonly crowd: CrowdTuning;
  readonly rout: RoutTuning;
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

/** Validate the raw Battle Tuning Data. Accepts its own output. */
export function parseBattle(raw: unknown): BattleTuning {
  const b = record(raw, 'battle');
  const f = record(b.field, 'battle.field');
  const d = record(b.deploy, 'battle.deploy');
  const c = record(b.crowd, 'battle.crowd');
  const r = record(b.rout, 'battle.rout');
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
  return {
    armySize,
    field,
    deploy,
    crowd,
    rout: { threshold: share(r, 'threshold', 'battle.rout'), seconds: positiveNumber(r, 'seconds', 'battle.rout') },
  };
}
