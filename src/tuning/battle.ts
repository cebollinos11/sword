/**
 * The Battle as Tuning Data (data/battle.json, hashed): docs/plans/big-battle.md. The army size, the Battlefield's size
 * and terrain, where the armies deploy, how the Crowd steps, moves and fights, and when a Team routs. Distances in metres,
 * speeds in m/s, HP in a Fighter's units, times in seconds.
 */
import { parseArena, type WalkSurface, type WallSegment } from './arena';
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
  /** Soldiers wide a rank of Squads is (a whole number): a rank holds `floor(perRank / squad.column.wide)` Squads, side by side. */
  readonly perRank: number;
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

/**
 * Soldiers on several levels (docs/plans/battle-objectives.md, Stage 4a; ADR 0022): how a Soldier crosses between a Battle map's Walk
 * Surfaces. It walks onto ground within `stepUp` of its feet and drops off an open ledge onto ground at most `drop` below, and never
 * jumps; bodies whose feet are `height` or more apart are on different levels.
 */
export interface LevelsTuning {
  /** The most a Soldier steps up (m): never more than a Fighter (`fall.stepUp`). */
  readonly stepUp: number;
  /** The deepest a Soldier drops off a ledge (m): no deeper than a Fighter's drop Link takes. */
  readonly drop: number;
  /** A Soldier's height (m): a Wall that high over its feet stops it, and bodies whose feet are this far apart or more are on different levels (they neither push, see nor fight each other). */
  readonly height: number;
  /** A Soldier more than this (m) above or below a Player's Fighter is never promoted into its Bubble, however near across the ground. */
  readonly promote: number;
}

export interface RoutTuning {
  /** A Team routs once its living Soldiers fall below this share of `armySize` (0 to 1). */
  readonly threshold: number;
  /** How long a routed Team flees before the Battle ends (s). */
  readonly seconds: number;
}

/**
 * Squads and Formations (docs/plans/battle-objectives.md, Stage 1): a fixed group of a Battle's Soldiers that moves in a Formation
 * round an anchor. The Formation is chosen by the situation: column on the march, line in contact, loose when broken up or falling back.
 */
export interface SquadTuning {
  /** Soldiers in a Squad at deployment (a whole number): an army fields `floor(armySize / size)` Squads, the remainder folded one each into the last. */
  readonly size: number;
  /** Between neighbouring places in a Formation (m), files and ranks alike. */
  readonly spacing: number;
  /** The most (radians a second) a Squad's anchor turns, so it wheels and does not flip. */
  readonly turnRate: number;
  /** A Soldier out of place walks up to this many times its walk speed to catch up (at least 1). */
  readonly catchUp: number;
  /** A Squad's anchor walks at this share of `crowd.walkSpeed` (more than 0, at most 1), so its Soldiers keep up. */
  readonly speed: number;
  /** The anchor waits while the Squad's Soldiers in the Crowd are further than this (m) behind it. */
  readonly lag: number;
  /** A Squad's brain steps this often (s), each Squad on its own Tick (staggered like the Crowd): 0.5 is 2 Hz. */
  readonly brainSeconds: number;
  /** A Squad down to this share of its strength (0 to 1) falls back toward its Base and merges into another Squad. */
  readonly moraleThreshold: number;
  /** A Squad down to this share of its strength (0 to 1) fights loose, not in column. */
  readonly looseBelow: number;
  /** An enemy Soldier this close (m) to a Squad's Soldiers puts it in line, facing them: it is in contact. */
  readonly engage: number;
  /** A falling-back Squad within this distance (m) of its Base merges into another Squad of its Team that close to it and with room. */
  readonly mergeRange: number;
  /** A merged Squad never holds more than this many living Soldiers (a whole number, at least `size`). */
  readonly mergeMax: number;
  /** A Team's Base is this far (m) from the centre along z, on its own side, behind its deployment: where a Squad falls back to. */
  readonly baseDistance: number;
  /** The column: this many places wide (a whole number), as deep as the Squad needs. */
  readonly column: { readonly wide: number };
  /** The line: this many places wide (a whole number); the first rank is the front rank that fights. */
  readonly line: { readonly wide: number };
  /** The loose Formation: places on a spiral, this many times the `spacing` apart (above 1 a looser crowd, below 1 a tighter one). */
  readonly loose: { readonly spread: number };
  /**
   * Narrow passes (docs/plans/battle-objectives.md, Stage 3b): a Formation narrows to as many files as fit the clearance ahead (from
   * its anchor to `ahead` m past it), keeping `room` m between its outer files and the nearest wall, so a line becomes a column through
   * a gate and opens out beyond it. Nothing narrows on the open field (no walls).
   */
  readonly narrow: { readonly room: number; readonly ahead: number };
}

/** One Objective of a map (docs/plans/battle-objectives.md, Stage 2a): where it is, what it is worth to a Commander, who owns it at the start. */
export interface ObjectiveSite {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** What it is worth to a Commander (more than 0); 1 is an ordinary Objective. */
  readonly weight: number;
  /** Its Owner at the start: -1 for none, else a Team (a Home Objective). */
  readonly owner: number;
  /** Whether a Team's Squads may respawn here while it owns the Objective and no enemy is on it. */
  readonly spawn: boolean;
  /** Set: it stands on the highest ground within this many metres of (x, z) along the line across the armies (same z), "on the hill when the seed makes one"; never off that line, so neither army is nearer. */
  readonly hill?: number;
}

/** The Objectives (docs/plans/battle-objectives.md, Stage 2a, ADR 0021): the capture circle, how fast it is taken, and the open field's five. */
export interface ObjectivesTuning {
  /** Every Objective's circle (m). */
  readonly radius: number;
  /** How many Soldiers a Player's full Fighter counts as on an Objective. Other full Fighters count as 1. */
  readonly playerCount: number;
  /** Capture steps this often (s), on the Crowd's clock (rounded to whole Ticks). */
  readonly captureSeconds: number;
  /** Progress (of the -1 to +1 range) a second for each Soldier more inside than the other Team has... */
  readonly rate: number;
  /** ...but never faster than this a second. */
  readonly maxRate: number;
  /** The open field's Objectives, in the order a Battle numbers them. */
  readonly openField: readonly ObjectiveSite[];
}

/** Tickets and the end of a Battle (docs/plans/battle-objectives.md, Stage 2a). */
export interface TicketsTuning {
  /** A Team starts with this many Tickets for each Soldier of its army (derived from `armySize`, not a Lobby option). */
  readonly perSoldier: number;
  /** A second, a Team that owns more Objectives drains the enemy by this many Tickets for each Objective it owns more. */
  readonly drain: number;
  /** At this many seconds the Battle is decided by Tickets, then Objectives, then a coin flip. */
  readonly limitSeconds: number;
  /** A Squad wiped out (or merged away) respawns whole this many seconds later, while its Team has Tickets. */
  readonly respawnSeconds: number;
}

/** A Commander (docs/plans/battle-objectives.md, Stage 2a, ADR 0021): how a Team scores Objectives and gives Squads Orders. */
export interface CommanderTuning {
  /** It re-plans this often (s). */
  readonly planSeconds: number;
  /** An Order holds at least this long (s) unless the Squad breaks. */
  readonly holdSeconds: number;
  /** Value added to the Objective a Squad is already ordered to, so Orders do not flip-flop. */
  readonly stick: number;
  /** Each Squad already sent to an Objective makes the next worth this much of the one before (0 to 1). */
  readonly falloff: number;
  /** Value lost for each metre of path to an Objective. */
  readonly distance: number;
  /** Enemy Soldiers within this many metres of an Objective are its threat. */
  readonly threatRadius: number;
  /** Value lost for each Squad's worth of enemy Soldiers the Objective holds more than the Team's. */
  readonly danger: number;
  /** An Objective nobody owns is worth its weight times this. */
  readonly attack: number;
  /** An Objective the enemy owns is worth its weight times this. */
  readonly retake: number;
  /** An Objective the Team owns, no enemy near, is worth its weight times this. */
  readonly garrison: number;
  /** An Objective the Team owns with a threat on it is worth its weight times this, up to the threat of one Squad's worth of Soldiers. */
  readonly defend: number;
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
  /**
   * How much Soldiers' Sizes vary: the spread (standard deviation) of each part of a Soldier's Size, height and thickness apart, on a bell
   * curve round the standard body (1), cut to MIN_SIZE to MAX_SIZE. 0 (the default): every Soldier is the standard body.
   */
  readonly sizeSpread: number;
}

/**
 * A Troop (a Soldier Type): one kind of Soldier an army fields, mixed through both armies by `weight`. Its stats replace the
 * Crowd's own (`battle.crowd.hp`, `damage`, `hitChance`, `engageReach`) for its Soldiers, and a promoted one fights with its
 * Weapon, AI difficulty and Mods. Every Troop plays the Battle's Style (`battle.soldier.style`). A Battle that names no Troops
 * fields one, the generic soldier (`battle.soldier` and `battle.crowd`).
 */
export interface TroopTuning {
  /** Its name, for people. */
  readonly name: string;
  /** Its share of each army: its weight over the sum of every Troop's (more than 0). */
  readonly weight: number;
  /** The Body models it is drawn as (names from the Body roster, `src/render/bodyModel.ts`), one picked per Soldier. Render-only. */
  readonly bodies: readonly string[];
  /** The Weapon it wields (a name from the Weapon roster). */
  readonly weapon: string;
  /** The AI difficulty a promoted Soldier of it plays (a name from `ai.difficulties`). */
  readonly difficulty: string;
  /** Its HP, in a Fighter's units. */
  readonly hp: number;
  /** A Crowd blow's damage, uniform in [min, max]. */
  readonly damage: readonly [number, number];
  /** The chance a Crowd step engaged lands a blow. */
  readonly hitChance: number;
  /** How near (m) an enemy Soldier must be for it to engage in the Crowd. */
  readonly engageReach: number;
  /** A promoted Soldier's Mods, as `battle.soldier.mods` (which it defaults to). */
  readonly mods: RelicEffects;
}

/** The most Bodies a Troop names. */
export const MAX_TROOP_BODIES = 16;

/** The most Troops a Battle names (each Body and Weapon of them is baked into its own impostor atlas). */
export const MAX_TROOPS = 8;

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

/** A solid block of a Battle map's walls or towers (docs/plans/battle-objectives.md, Stage 3a): from above an axis-aligned box, solid from the ground to `top`. */
export interface WallBlock {
  readonly id: string;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly top: number;
}

/**
 * A hand-built Battle map (docs/plans/battle-objectives.md, Stage 3a; ADR 0022), `data/battlemaps/<name>.json`, exported by
 * `art/build_battle_<name>.py` from its Collision helpers: its floor (Walk Surfaces), its solid blocks (a Wall stands on each of their
 * sides, and Soldiers keep out of them), any other Walls, its Objectives, each Team's Base, where the armies deploy, and how big an army
 * it holds. Fought as the Battlefield `battle:<name>`. Static, like an Arena.
 */
export interface BattleMapTuning {
  readonly name: string;
  readonly walk: readonly WalkSurface[];
  readonly walls: readonly WallSegment[];
  /** Block k is the half turn of block `length - 1 - k`, so Team 1's Soldiers are pushed out of them as Team 0's are, turned (`pushOutOfBlocks`). */
  readonly blocks: readonly WallBlock[];
  /** In the order a Battle numbers them; Objective k is the half turn of Objective `length - 1 - k`, as on the open field. */
  readonly objectives: readonly ObjectiveSite[];
  /** Each Team's Base: [Team 0, Team 1]. */
  readonly bases: readonly [{ readonly x: number; readonly z: number }, { readonly x: number; readonly z: number }];
  /** How far from the centre (m, along z) each army's front rank deploys, as `deploy.front` on the open field. */
  readonly front: number;
  /** The army size a Battle on it has unless the Lobby picks another, and the most it may (whole numbers): set from the budget gate. */
  readonly armySize: { readonly standard: number; readonly max: number };
  /**
   * The Tickets a Team starts with for each Soldier of its army on this map, replacing `tickets.perSoldier` (`applyBattleKnobs`): a map whose
   * walls and levels slow the killing lasts longer on the same Tickets, so it may start with fewer. Absent: the Battle's own.
   */
  readonly ticketsPerSoldier?: number;
}

export interface BattleTuning {
  /** Soldiers in each army (a whole number, at least 1). */
  readonly armySize: number;
  readonly field: BattlefieldTuning;
  readonly deploy: DeployTuning;
  readonly crowd: CrowdTuning;
  readonly squad: SquadTuning;
  readonly objectives: ObjectivesTuning;
  readonly tickets: TicketsTuning;
  readonly commander: CommanderTuning;
  readonly rout: RoutTuning;
  readonly soldier: SoldierTuning;
  /** The Troops both armies field, mixed by weight (at least one; `TroopTuning`). */
  readonly troops: readonly TroopTuning[];
  readonly bubble: BubbleTuning;
  readonly slots: SlotsTuning;
  readonly ring: RingTuning;
  readonly takeover: TakeoverTuning;
  readonly levels: LevelsTuning;
  /** The hand-built Battle maps, by name (`data/battlemaps/<name>.json`; none in a Battle written by hand). The open field is not one. */
  readonly maps: Readonly<Record<string, BattleMapTuning>>;
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

/** An Objective's site, inside the `size` m field. */
function parseSite(raw: unknown, where: string, size: number): ObjectiveSite {
  const o = record(raw, where);
  const owner = o.owner;
  if (owner !== -1 && owner !== 0 && owner !== 1) throw new TuningDataError(`${where}.owner must be -1 (none), 0 or 1, got ${JSON.stringify(owner)}`);
  const { x, z } = fieldPoint([o.x, o.z], where, size);
  if (typeof o.spawn !== 'boolean') throw new TuningDataError(`${where}.spawn must be true or false, got ${JSON.stringify(o.spawn)}`);
  const site = { id: nonEmptyString(o, 'id', where), x, z, weight: positiveNumber(o, 'weight', where), owner, spawn: o.spawn };
  return o.hill === undefined ? site : { ...site, hill: positiveNumber(o, 'hill', where) };
}

/** Throws unless a map holds 1 to MAX_OBJECTIVES Objectives, each with its own id. */
function checkSites(sites: readonly ObjectiveSite[], where: string): void {
  if (sites.length < 1 || sites.length > MAX_OBJECTIVES) throw new TuningDataError(`${where} must hold 1 to ${MAX_OBJECTIVES} Objectives, got ${sites.length}`);
  if (new Set(sites.map((o) => o.id)).size !== sites.length) throw new TuningDataError(`${where}: every Objective needs its own id`);
}

/** A point written [x, z] (or { x, z }, as parsed) strictly inside the `size` m field, or on its edge with `edge`. */
function fieldPoint(v: unknown, where: string, size: number, edge = false): { x: number; z: number } {
  const [x, z] = Array.isArray(v) ? v : [record(v, where).x, record(v, where).z];
  const inside = (c: unknown): c is number => typeof c === 'number' && Number.isFinite(c) && (edge ? Math.abs(c) <= size / 2 : Math.abs(c) < size / 2);
  if (!inside(x) || !inside(z)) throw new TuningDataError(`${where}: (x, z) must lie inside the ${size} m field, got (${JSON.stringify(x)}, ${JSON.stringify(z)})`);
  return { x, z };
}

/**
 * A Battle map (`BattleMapTuning`), checked against the Battle's field and army layout: its floor reaches every side of the field's square,
 * its blocks stand inside it, its Objectives and Bases lie inside it, and its armies deploy inside it at its most. Accepts its own output.
 */
function parseBattleMap(raw: unknown, where: string, b: Pick<BattleTuning, 'field' | 'deploy' | 'squad'>): BattleMapTuning {
  const m = record(raw, where);
  const size = b.field.size;
  const arena = parseArena({ name: m.name, walk: m.walk, walls: m.walls ?? [] }, where);
  const xs = arena.walk.flatMap((w) => w.points.map((p) => p.x));
  const zs = arena.walk.flatMap((w) => w.points.map((p) => p.z));
  if (Math.min(...xs) !== -size / 2 || Math.max(...xs) !== size / 2 || Math.min(...zs) !== -size / 2 || Math.max(...zs) !== size / 2)
    throw new TuningDataError(`${where}.walk must reach every side of the ${size} m field`);
  const blocks = array(m.blocks ?? [], `${where}.blocks`).map((raw, i): WallBlock => {
    const at = `${where}.blocks[${i}]`;
    const o = record(raw, at);
    const lo = fieldPoint('minX' in o ? { x: o.minX, z: o.minZ } : o.min, `${at}.min`, size, true);
    const hi = fieldPoint('maxX' in o ? { x: o.maxX, z: o.maxZ } : o.max, `${at}.max`, size, true);
    if (hi.x <= lo.x || hi.z <= lo.z) throw new TuningDataError(`${at}: max must lie beyond min on both axes`);
    return { id: nonEmptyString(o, 'id', at), minX: lo.x, minZ: lo.z, maxX: hi.x, maxZ: hi.z, top: positiveNumber(o, 'top', at) };
  });
  const objectives = array(m.objectives, `${where}.objectives`).map((raw, i) => parseSite(raw, `${where}.objectives[${i}]`, size));
  checkSites(objectives, `${where}.objectives`);
  const bases = array(m.bases, `${where}.bases`);
  if (bases.length !== 2) throw new TuningDataError(`${where}.bases must hold Team 0's Base and Team 1's`);
  const front = positiveNumber(m, 'front', where);
  // Nothing a Squad heads for or deploys at may stand in a wall: its destination field would start inside it.
  const solid = (x: number, z: number) => blocks.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  objectives.forEach((o, i) => {
    if (solid(o.x, o.z)) throw new TuningDataError(`${where}.objectives[${i}] (${o.id}) stands inside a block`);
  });
  bases.forEach((p, i) => {
    const at = fieldPoint(p, `${where}.bases[${i}]`, size);
    if (solid(at.x, at.z)) throw new TuningDataError(`${where}.bases[${i}] stands inside a block`);
  });
  if (blocks.some((b) => b.minZ < -front && b.maxZ > -front)) throw new TuningDataError(`${where}.front: Team 0's front rank (z = ${-front}) runs through a block`);
  const army = record(m.armySize, `${where}.armySize`);
  const armySize = { standard: wholeNumber(army, 'standard', `${where}.armySize`), max: wholeNumber(army, 'max', `${where}.armySize`) };
  if (armySize.standard > armySize.max) throw new TuningDataError(`${where}.armySize.standard (${armySize.standard}) must be at most its max (${armySize.max})`);
  const fits = maxArmySize({ ...b, deploy: { ...b.deploy, front } });
  if (armySize.max > fits) throw new TuningDataError(`${where}.armySize.max (${armySize.max}) must deploy inside the field from front ${front} (at most ${fits})`);
  return {
    name: arena.name,
    walk: arena.walk,
    walls: arena.walls,
    blocks,
    objectives,
    bases: [fieldPoint(bases[0], `${where}.bases[0]`, size), fieldPoint(bases[1], `${where}.bases[1]`, size)],
    front,
    armySize,
    ...(m.ticketsPerSoldier === undefined ? {} : { ticketsPerSoldier: positiveNumber(m, 'ticketsPerSoldier', where) }),
  };
}

/**
 * The Troops of `raw` (`battle.troops`), each field it leaves out the generic soldier's (`soldier`, `crowd`): `body` or `bodies` (one or
 * more), `weapon`, `difficulty`, `hp`, `damage`, `hitChance`, `engageReach` and `mods`. Absent: the one generic soldier.
 */
function parseTroops(raw: unknown, soldier: SoldierTuning, crowd: CrowdTuning, weapons?: readonly string[], difficulties?: readonly string[]): TroopTuning[] {
  const generic: TroopTuning = {
    name: 'Soldier',
    weight: 1,
    bodies: [soldier.body],
    weapon: soldier.weapon,
    difficulty: soldier.difficulty,
    hp: crowd.hp,
    damage: crowd.damage,
    hitChance: crowd.hitChance,
    engageReach: crowd.engageReach,
    mods: soldier.mods,
  };
  if (raw === undefined) return [generic];
  const list = array(raw, 'battle.troops');
  if (list.length < 1 || list.length > MAX_TROOPS) throw new TuningDataError(`battle.troops must name 1 to ${MAX_TROOPS} Troops, got ${list.length}`);
  const names = new Set<string>();
  return list.map((item, i) => {
    const where = `battle.troops[${i}]`;
    const t = record(item, where);
    const name = nonEmptyString(t, 'name', where);
    if (names.has(name)) throw new TuningDataError(`${where}.name "${name}" is named twice`);
    names.add(name);
    let bodies = generic.bodies;
    if (t.bodies !== undefined) {
      const raw = array(t.bodies, `${where}.bodies`);
      if (raw.length < 1 || raw.length > MAX_TROOP_BODIES || raw.some((v) => typeof v !== 'string' || v.length === 0)) throw new TuningDataError(`${where}.bodies must be 1 to ${MAX_TROOP_BODIES} Body names, got ${JSON.stringify(t.bodies)}`);
      bodies = raw as string[];
    } else if (t.body !== undefined) bodies = [nonEmptyString(t, 'body', where)];
    const weapon = t.weapon === undefined ? generic.weapon : nonEmptyString(t, 'weapon', where);
    if (weapons && !weapons.includes(weapon)) throw new TuningDataError(`${where}.weapon "${weapon}" is not a Weapon (${weapons.join(', ')})`);
    const difficulty = t.difficulty === undefined ? generic.difficulty : nonEmptyString(t, 'difficulty', where);
    if (difficulties && !difficulties.includes(difficulty)) throw new TuningDataError(`${where}.difficulty "${difficulty}" is not an AI difficulty (${difficulties.join(', ')})`);
    let damage = generic.damage;
    if (t.damage !== undefined) {
      const dmg = array(t.damage, `${where}.damage`);
      if (dmg.length !== 2 || dmg.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || (dmg[0] as number) > (dmg[1] as number))
        throw new TuningDataError(`${where}.damage must be [min, max] with 0 <= min <= max, got ${JSON.stringify(t.damage)}`);
      damage = [dmg[0] as number, dmg[1] as number];
    }
    let mods = generic.mods;
    if (t.mods !== undefined) {
      const md = record(t.mods, `${where}.mods`);
      for (const k of Object.keys(md)) if (!(RELIC_MULTIPLIERS as readonly string[]).includes(k)) throw new TuningDataError(`${where}.mods.${k}: a soldier's Mods are only ${RELIC_MULTIPLIERS.join(', ')}`);
      mods = Object.fromEntries(Object.keys(md).map((k) => [k, positiveNumber(md, k, `${where}.mods`)])) as RelicEffects;
    }
    return {
      name,
      weight: t.weight === undefined ? 1 : positiveNumber(t, 'weight', where),
      bodies,
      weapon,
      difficulty,
      hp: t.hp === undefined ? generic.hp : positiveNumber(t, 'hp', where),
      damage,
      hitChance: t.hitChance === undefined ? generic.hitChance : share(t, 'hitChance', where),
      engageReach: t.engageReach === undefined ? generic.engageReach : positiveNumber(t, 'engageReach', where),
      mods,
    };
  });
}

/** The furthest any Troop engages from (m): the Crowd's spatial hash is sized for it. */
export const maxEngageReach = (b: Pick<BattleTuning, 'troops' | 'crowd'>): number => Math.max(b.crowd.engageReach, ...b.troops.map((t) => t.engageReach));

/** Validate the raw Battle Tuning Data (with the Weapon roster's names, to check the soldier's Weapon, when given). Accepts its own output. */
export function parseBattle(raw: unknown, weapons?: readonly string[], difficulties?: readonly string[], styleKeys?: readonly string[]): BattleTuning {
  const b = record(raw, 'battle');
  const f = record(b.field, 'battle.field');
  const d = record(b.deploy, 'battle.deploy');
  const c = record(b.crowd, 'battle.crowd');
  const r = record(b.rout, 'battle.rout');
  const ob = record(b.objectives, 'battle.objectives');
  const tk2 = record(b.tickets, 'battle.tickets');
  const cm = record(b.commander, 'battle.commander');
  const s = record(b.soldier, 'battle.soldier');
  const u = record(b.bubble, 'battle.bubble');
  const sl = record(b.slots, 'battle.slots');
  const rg = record(b.ring, 'battle.ring');
  const tk = record(b.takeover, 'battle.takeover');
  const lv = record(b.levels, 'battle.levels');
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
  };
  const sq = record(b.squad, 'battle.squad');
  const column = record(sq.column, 'battle.squad.column');
  const line = record(sq.line, 'battle.squad.line');
  const loose = record(sq.loose, 'battle.squad.loose');
  const narrow = record(sq.narrow, 'battle.squad.narrow');
  const squad: SquadTuning = {
    size: wholeNumber(sq, 'size', 'battle.squad'),
    spacing: positiveNumber(sq, 'spacing', 'battle.squad'),
    turnRate: positiveNumber(sq, 'turnRate', 'battle.squad'),
    catchUp: positiveNumber(sq, 'catchUp', 'battle.squad'),
    speed: positiveNumber(sq, 'speed', 'battle.squad'),
    lag: positiveNumber(sq, 'lag', 'battle.squad'),
    brainSeconds: positiveNumber(sq, 'brainSeconds', 'battle.squad'),
    moraleThreshold: share(sq, 'moraleThreshold', 'battle.squad'),
    looseBelow: share(sq, 'looseBelow', 'battle.squad'),
    engage: positiveNumber(sq, 'engage', 'battle.squad'),
    mergeRange: positiveNumber(sq, 'mergeRange', 'battle.squad'),
    mergeMax: wholeNumber(sq, 'mergeMax', 'battle.squad'),
    baseDistance: positiveNumber(sq, 'baseDistance', 'battle.squad'),
    column: { wide: wholeNumber(column, 'wide', 'battle.squad.column') },
    line: { wide: wholeNumber(line, 'wide', 'battle.squad.line') },
    loose: { spread: positiveNumber(loose, 'spread', 'battle.squad.loose') },
    narrow: { room: positiveNumber(narrow, 'room', 'battle.squad.narrow'), ahead: positiveNumber(narrow, 'ahead', 'battle.squad.narrow') },
  };
  if (squad.catchUp < 1) throw new TuningDataError(`battle.squad.catchUp must be at least 1, got ${squad.catchUp}`);
  if (squad.speed > 1) throw new TuningDataError(`battle.squad.speed must be at most 1, got ${squad.speed}`);
  if (squad.mergeMax < squad.size) throw new TuningDataError(`battle.squad.mergeMax (${squad.mergeMax}) must be at least battle.squad.size (${squad.size})`);
  if (squad.baseDistance >= field.size / 2) throw new TuningDataError(`battle.squad.baseDistance (${squad.baseDistance}) must lie inside the ${field.size} m field`);
  const armySize = wholeNumber(b, 'armySize', 'battle');
  // A Squad's places and count must fit what a resync accepts (MAX_PLACES in net/messages.ts).
  if (squad.mergeMax > MAX_SQUAD_PLACES || Math.max(...squadSizes(armySize, squad.size)) > MAX_SQUAD_PLACES) throw new TuningDataError(`battle.squad: a Squad holds at most ${MAX_SQUAD_PLACES} Soldiers (mergeMax ${squad.mergeMax}, army ${armySize} in Squads of ${squad.size})`);
  if (!deployFits({ armySize, field, deploy, squad })) {
    const layout = deployLayout({ armySize, deploy, squad });
    throw new TuningDataError(`battle.deploy: an army of ${armySize} (${layout.width} m wide, its last rank ${layout.depth} m out) must fit inside the ${field.size} m field`);
  }
  const objectives: ObjectivesTuning = {
    radius: positiveNumber(ob, 'radius', 'battle.objectives'),
    playerCount: wholeNumber(ob, 'playerCount', 'battle.objectives'),
    captureSeconds: positiveNumber(ob, 'captureSeconds', 'battle.objectives'),
    rate: positiveNumber(ob, 'rate', 'battle.objectives'),
    maxRate: positiveNumber(ob, 'maxRate', 'battle.objectives'),
    openField: array(ob.openField, 'battle.objectives.openField').map((raw, i) => parseSite(raw, `battle.objectives.openField[${i}]`, field.size)),
  };
  checkSites(objectives.openField, 'battle.objectives.openField');
  if (objectives.maxRate < objectives.rate) throw new TuningDataError(`battle.objectives.maxRate (${objectives.maxRate}) must be at least battle.objectives.rate (${objectives.rate})`);
  const tickets: TicketsTuning = {
    perSoldier: positiveNumber(tk2, 'perSoldier', 'battle.tickets'),
    drain: nonNegativeNumber(tk2, 'drain', 'battle.tickets'),
    limitSeconds: positiveNumber(tk2, 'limitSeconds', 'battle.tickets'),
    respawnSeconds: nonNegativeNumber(tk2, 'respawnSeconds', 'battle.tickets'),
  };
  const commander: CommanderTuning = {
    planSeconds: positiveNumber(cm, 'planSeconds', 'battle.commander'),
    holdSeconds: nonNegativeNumber(cm, 'holdSeconds', 'battle.commander'),
    stick: nonNegativeNumber(cm, 'stick', 'battle.commander'),
    falloff: share(cm, 'falloff', 'battle.commander'),
    distance: nonNegativeNumber(cm, 'distance', 'battle.commander'),
    threatRadius: positiveNumber(cm, 'threatRadius', 'battle.commander'),
    danger: nonNegativeNumber(cm, 'danger', 'battle.commander'),
    attack: nonNegativeNumber(cm, 'attack', 'battle.commander'),
    retake: nonNegativeNumber(cm, 'retake', 'battle.commander'),
    garrison: nonNegativeNumber(cm, 'garrison', 'battle.commander'),
    defend: nonNegativeNumber(cm, 'defend', 'battle.commander'),
  };
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
  const soldier: SoldierTuning = {
    body: nonEmptyString(s, 'body', 'battle.soldier'),
    weapon,
    colours: [colour(colours[0], 'battle.soldier.colours[0]'), colour(colours[1], 'battle.soldier.colours[1]')],
    difficulty,
    style,
    mods,
    sizeSpread: s.sizeSpread === undefined ? 0 : nonNegativeNumber(s, 'sizeSpread', 'battle.soldier'),
  };
  const troops = parseTroops(b.troops, soldier, crowd, weapons, difficulties);
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
  const maps: Record<string, BattleMapTuning> = {};
  for (const [key, raw] of Object.entries(record(b.maps ?? {}, 'battle.maps'))) {
    const map = parseBattleMap(raw, `battle.maps.${key}`, { field, deploy, squad });
    if (map.name !== key || !/^[a-z][a-z0-9]*$/.test(key)) throw new TuningDataError(`battle.maps.${key}: a map's name is lower-case letters and digits, and its key (got "${map.name}")`);
    maps[key] = map;
  }
  if (ring.radius < bubble.hold || ring.radius >= bubble.promote) throw new TuningDataError(`battle.ring.radius (${ring.radius}) must be at least battle.bubble.hold (${bubble.hold}) and less than battle.bubble.promote (${bubble.promote})`);
  return {
    armySize,
    field,
    deploy,
    crowd,
    squad,
    objectives,
    tickets,
    commander,
    rout: { threshold: share(r, 'threshold', 'battle.rout'), seconds: positiveNumber(r, 'seconds', 'battle.rout') },
    soldier,
    troops,
    bubble,
    slots,
    ring,
    takeover: { seconds: nonNegativeNumber(tk, 'seconds', 'battle.takeover') },
    levels: {
      stepUp: positiveNumber(lv, 'stepUp', 'battle.levels'),
      drop: positiveNumber(lv, 'drop', 'battle.levels'),
      height: positiveNumber(lv, 'height', 'battle.levels'),
      promote: positiveNumber(lv, 'promote', 'battle.levels'),
    },
    maps,
  };
}

/**
 * A Battle's options, picked in the Lobby (the host's, sent to every guest with the Lobby): each one absent keeps Tuning
 * Data as it is. `applyBattleKnobs` folds them into the Battle before it starts, so the Simulation and the Tuning Data hash
 * every peer compares see the same armies.
 */
export interface BattleKnobs {
  /** The map (docs/plans/battle-objectives.md, Stage 3a): a key of `battle.maps`, or absent (or any other name) for the open field. */
  readonly map?: string;
  /** Soldiers in each army (replaces `armySize`, or the map's standard; held to what fits the field and to the map's most, see `armySizeCap`). */
  readonly armySize?: number;
  /** Multiplies the chance a Soldier lands a blow each Crowd step (so the Crowd fights slower below 1; the product is held to 1). */
  readonly hitRate?: number;
}

/** Every numeric Battle knob's key (the map is a name). */
export const BATTLE_KNOB_KEYS: readonly Exclude<keyof BattleKnobs, 'map'>[] = ['armySize', 'hitRate'];

/** The longest map name a Battle knob carries. */
export const MAX_MAP_NAME = 32;

/** Battle knobs read back from storage: each of BATTLE_KNOB_KEYS that is a finite number and a short `map` name (any other key dropped), or null for none. */
export function parseBattleKnobs(raw: unknown): BattleKnobs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const knobs = Object.fromEntries(
    Object.entries(raw).filter(
      ([k, v]) => ((BATTLE_KNOB_KEYS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v)) || (k === 'map' && typeof v === 'string' && v.length > 0 && v.length <= MAX_MAP_NAME),
    ),
  ) as BattleKnobs;
  return Object.keys(knobs).length > 0 ? knobs : null;
}

/** The most Soldiers a Squad may ever hold: the wire's limit on a Soldier's place and a Squad's count. */
export const MAX_SQUAD_PLACES = 64;

/** The most Objectives a map holds: the wire's limit on a Battle's Objective state (a Squad's destination also counts the two Bases). */
export const MAX_OBJECTIVES = 12;

/** A Team's Tickets at the start of a Battle: `tickets.perSoldier` for each Soldier of the army. */
export const startingTickets = (b: Pick<BattleTuning, 'armySize' | 'tickets'>): number => b.tickets.perSoldier * b.armySize;

/** The sizes of an army's Squads: `floor(armySize / squad.size)` of them (at least 1), the remainder folded one each into the last. */
export function squadSizes(armySize: number, size: number): number[] {
  const squads = Math.max(1, Math.floor(armySize / size));
  const base = Math.floor(armySize / squads);
  const extra = armySize - base * squads;
  return Array.from({ length: squads }, (_, q) => base + (q >= squads - extra ? 1 : 0));
}

/** How an army's Squads stand at deployment: in ranks of `perRank` Squads side by side, each Squad in column. */
export interface DeployLayout {
  readonly sizes: readonly number[];
  /** Squads in a full rank. */
  readonly perRank: number;
  /** Ranks of Squads. */
  readonly ranks: number;
  /** Rows in a Squad's column at the nominal size (the first stands at `deploy.front`), and in the deepest one. */
  readonly rows: number;
  readonly deepest: number;
  /** How wide the widest rank is (m), and how far from the centre (m) the last Soldier stands. */
  readonly width: number;
  readonly depth: number;
}

/** The layout of an army's Squads at deployment (see `DeployLayout`): pure, from the Tuning Data alone. */
export function deployLayout(b: Pick<BattleTuning, 'armySize' | 'deploy' | 'squad'>): DeployLayout {
  const { deploy, squad } = b;
  const sizes = squadSizes(b.armySize, squad.size);
  const perRank = Math.max(1, Math.floor(deploy.perRank / squad.column.wide));
  const ranks = Math.ceil(sizes.length / perRank);
  const deepest = Math.ceil(Math.max(...sizes) / squad.column.wide);
  return {
    sizes,
    perRank,
    ranks,
    rows: Math.ceil(squad.size / squad.column.wide),
    deepest,
    width: Math.min(perRank, sizes.length) * squad.column.wide * squad.spacing,
    depth: deploy.front + ranks * deepest * squad.spacing,
  };
}

/** Whether an army deploys inside the field: its last rank short of the middle, its widest rank inside the sides. */
function deployFits(b: Pick<BattleTuning, 'armySize' | 'field' | 'deploy' | 'squad'>): boolean {
  const layout = deployLayout(b);
  return layout.depth < b.field.size / 2 && layout.width < b.field.size;
}

/** The most Soldiers an army can be and still deploy inside the field (its last rank short of the middle), as `parseBattle` checks. */
export function maxArmySize(b: Pick<BattleTuning, 'field' | 'deploy' | 'squad'>): number {
  let army = 1;
  while (deployFits({ ...b, armySize: army + 1 })) army++;
  return army;
}

/** The Battle map `knobs` pick, or null for the open field. */
export const battleMapPicked = (b: Pick<BattleTuning, 'maps'>, knobs: BattleKnobs | undefined): BattleMapTuning | null => (knobs?.map !== undefined && Object.hasOwn(b.maps, knobs.map) ? b.maps[knobs.map]! : null);

/** The most Soldiers an army may be on `map` (null: the open field): what deploys inside the field, and no more than the map's `armySize.max`. */
export const armySizeCap = (b: BattleTuning, map: BattleMapTuning | null): number => (map ? Math.min(map.armySize.max, maxArmySize({ ...b, deploy: { ...b.deploy, front: map.front } })) : maxArmySize(b));

/** The army size a Battle on `map` (null: the open field) has when the Lobby picks none: Tuning Data's `armySize`, or the map's standard. */
export const standardArmySize = (b: BattleTuning, map: BattleMapTuning | null): number => (map ? map.armySize.standard : b.armySize);

/**
 * The Battle with the Lobby's knobs applied; `b` itself when none change anything. Out-of-range values are held to their range: the army
 * to the map's cap (`armySizeCap`), its standard (`standardArmySize`) when the knobs name none.
 */
export function applyBattleKnobs(b: BattleTuning, knobs: BattleKnobs | undefined): BattleTuning {
  if (!knobs) return b;
  const map = battleMapPicked(b, knobs);
  const { armySize = standardArmySize(b, map), hitRate = 1 } = knobs;
  const army = Math.min(armySizeCap(b, map), Math.max(1, Math.round(armySize)));
  const hitChance = Math.min(1, b.crowd.hitChance * (hitRate > 0 ? hitRate : 1));
  const perSoldier = map?.ticketsPerSoldier ?? b.tickets.perSoldier;
  if (army === b.armySize && hitChance === b.crowd.hitChance && perSoldier === b.tickets.perSoldier) return b;
  // Every Troop's hit chance scales by the same knob.
  const rate = hitRate > 0 ? hitRate : 1;
  const troops = b.troops.map((t) => ({ ...t, hitChance: Math.min(1, t.hitChance * rate) }));
  return { ...b, armySize: army, crowd: { ...b.crowd, hitChance }, troops, tickets: { ...b.tickets, perSoldier } };
}
