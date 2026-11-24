/**
 * Match progression: a best-of-N sequence of Duels between two teams.
 *
 * Each Fighter is on team 0 or 1 (`teams`, default one Fighter a side), at
 * most MAX_TEAM_SIZE a side. A Match wraps the current Duel's SimState.
 * `stepMatch` steps that Duel; when the last Fighter of a team falls, the
 * Duel ends and the other team scores on the same Tick, the finished Duel stays
 * frozen for `interDuelTicks` (so its end can be seen), and then the next
 * Duel starts with every Fighter back at its starting position and full
 * HP. The Match ends once a team has won a majority of N Duels. A drawn
 * Duel scores for nobody and is simply replayed.
 *
 * In Gauntlet format (docs/plans/delver.md) the Match is a Run instead: one Duel a
 * Floor, each Floor a generated dungeon with its Warbands in the Crowd (`stepDelver`),
 * HP carrying over, until Team 0 is wiped out or the party takes the last Floor's Stairs.
 *
 * In Battle format (docs/plans/big-battle.md) the Match is one Battle: two armies of Soldiers (the Crowd, `SimState.crowd`)
 * on a Battlefield (`battle:<seed>`), stepped after its Fighters (`stepBattle`), until a Team routs and the other wins.
 * `teams` are only its Fighters (the Players'; none for an AI-vs-AI war), and `bestOf` is ignored.
 *
 * Like SimState, MatchState is plain JSON-like data and `stepMatch` is pure,
 * so a whole Match hashes (`hashValue`) and snapshots (`snapshot`) exactly
 * for Rollback.
 */
import { defaultWeaponName, isStandardSize, storedSize, weaponByName, type ConsumableEffect, type Size, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import type { Intent } from './intent';
import type { SimState } from './state';
import { arenaOf } from './arena';
import { isArenaName, nextArenaName } from './arenaGen/named';
import { runPlayers, stairsTicksNeeded } from './party';
import type { Dropped, Item } from './inventory';
import { placeDrop, type DroppedItem, type PickupAt } from './pickups';
import { createRng } from './rng';
import type { Placement } from './skeleton';
import { createInitialState, step, teamPlacements } from './step';
import { stepBattle, type BattleEndEvent, type RoutEvent } from './battle';
import { battleArenaName, battlefieldOf, battleMapName } from './battlefield';
import { createCrowd } from './crowd';
import { unboundSlot } from './bubble';
import { firstFloor, floorDuel, stepDelver, type RunState } from './delverRun';
import { arenaTuning } from './delver/world';
import { traitorLeaves, traitorOf } from './delverTraitors';

/** Ticks every counted Fighter must stand in a Floor's Stairs zone to take them: `party.ts`'s. */
export { stairsTicksNeeded };

/** The drop seam and the item it takes (they live in `pickups`; the Match's callers still find them here). */
export { placeDrop, type DroppedItem };

/** The most Fighters a team may field. */
export const MAX_TEAM_SIZE = 4;

/** How a Match is played: Duels (best-of-N, the default), Gauntlet (a Run down a Dungeon's Floors) or Battle (two armies, docs/plans/big-battle.md). */
export type MatchFormat = 'Duels' | 'Gauntlet' | 'Battle';
/** The Formats the Lobby offers, and the only ones online play accepts. A Battle is offline only for now (Stage 1). */
export const MATCH_FORMATS: readonly MatchFormat[] = ['Duels', 'Gauntlet'];
/** Every Format `createMatch` builds. */
const ALL_FORMATS: readonly MatchFormat[] = [...MATCH_FORMATS, 'Battle'];

export interface MatchConfig {
  /** Duels (default) or Gauntlet: a Run, where `bestOf` is ignored and `teams` is Team 0's 1 to MAX_TEAM_SIZE Fighters followed by MAX_TEAM_SIZE Team 1 slots. */
  readonly format: MatchFormat;
  /** N: the Match is best of this many Duels. A positive integer. */
  readonly bestOf: number;
  /** Starting distance between the two teams' lines at the start of every Duel (metres). */
  readonly distance: number;
  /** Starting distance between teammates side by side in a line (metres). */
  readonly spacing: number;
  /** Ticks between a Duel ending and the next one starting (at least 1). A Run never reads it (its Floors change after `dungeon.fadeSeconds`). */
  readonly interDuelTicks: number;
  /** Each Fighter's Weapon (a Tuning Data Weapon name), kept across Duels. */
  readonly weapons: readonly string[];
  /** Each Fighter's team (0 or 1); its length is the number of Fighters. */
  readonly teams: readonly number[];
  /** Each Fighter's Size (clamped to the allowed range), kept across Duels; absent when every Fighter is the standard body. A Run's enemies take their Floor's Size instead. */
  readonly sizes?: readonly Size[];
  /** Ticks after the Match ends before a fresh Match (same config, score 0–0) starts, or null for none (the default). */
  readonly rematchTicks: number | null;
  /**
   * The Arena the first Match's Duels are fought in (a Tuning Data Arena name, or a Generated Arena's `gen:<kit>:<seed>`;
   * default `arena.match`); each Rematch moves to the next (`MatchState.arena`). Fighters start at its spawns when it
   * has one for each, else in two facing lines (`distance`, `spacing`). A Run is never fought in it: its seed is the Run
   * seed (`runSeed`), and each Floor is generated.
   */
  readonly arena: string;
  /**
   * How many human Players the Lineup fields (default 1; `lineupMatch` fills it for a Gauntlet, and Duels never read it).
   * A Run scales its enemies' max HP with it, so it is fixed for the Run: an AI Takeover never changes it. 1 to Team 0's size in a Run.
   */
  readonly humans: number;
  /**
   * In a Run, the Fighters the human Players drive (Team 0 indices, ascending, `humans` of them; `lineupMatch` fills it,
   * default the first `humans` of Team 0): only their standing counts at the Stairs, and only they take a fire's heal.
   * Absent in Duels.
   */
  readonly players?: readonly number[];
  /**
   * Dev mode only (`devDelverStart`, solo): a Delver Run starts on this Floor (1 to `floors`) instead of Floor 1, as the Run's start Floor. Absent otherwise.
   * Refused outside a Gauntlet, and online.
   */
  readonly delverStart?: number;
  /**
   * Dev mode only (the main menu's Set Piece Gallery, solo): the Run is one Floor, the Set Piece Gallery's (`galleryFloorTuning`, Arena
   * `battle:delver1g<S>`): every set piece one after another. Absent otherwise. Refused outside a Gauntlet, with a start Floor, and online.
   */
  readonly delverGallery?: true;
  /**
   * A Delver Run's traitors (docs/plans/delver.md, Stage 8a): the Players on Team 1, one entry each with its own Size, in Lineup order. Traitor j
   * plays in Pool slot `teams.length + j` (`traitorSlot`), as the Warband Soldiers it takes over. Absent when there are none, so every other Match's
   * config is as it always was. Only a Gauntlet, at most MAX_TEAM_SIZE, and `humans` plus traitors at most MAX_TEAM_SIZE (the Players a Match fields).
   */
  readonly traitors?: readonly TraitorSeat[];
}

/** A traitor of a Delver Run (`MatchConfig.traitors`): its own Size (absent: the standard body), which it keeps in every Soldier it takes over. */
export interface TraitorSeat {
  readonly size?: Size;
}

export interface MatchOptions extends Partial<Omit<MatchConfig, 'sizes'>> {
  /** Each Fighter's Size (default: the standard body). */
  readonly sizes?: readonly (Size | undefined)[];
  readonly bestOf: number;
  /** Seeds the Simulation's generator; it carries over from Duel to Duel. */
  readonly seed?: number;
  /**
   * Dev mode only (`devRunRelics`): the Relics and Consumables (Tuning Data names) every Player's Fighter starts the Run holding, the Relics
   * equipped in order up to `dungeon.inventory.equippedRelics`, the rest carried. An unknown name, or more than `dungeon.inventory.relics`, throws.
   */
  readonly relics?: readonly string[];
}

/** `winner` is a team (0 or 1). */
export type MatchStatus = { readonly status: 'InProgress' } | { readonly status: 'Over'; readonly winner: number; readonly tick: number };

/** A new Duel of the Match began (Fighters reset); in a Run, a new Floor. */
export interface DuelStartEvent {
  readonly type: 'DuelStart';
  /** 1-based. */
  readonly duelNumber: number;
}

/** A team reached the winning number of Duels. */
export interface MatchEndEvent {
  readonly type: 'MatchEnd';
  readonly winner: number;
  readonly score: readonly number[];
}

/** A Run ended: Team 0 was wiped out, `winner` 1, or the party took the last Floor's Stairs, `winner` 0. */
export interface RunEndEvent {
  readonly type: 'RunEnd';
  readonly winner: number;
  readonly floors: number;
  /** The Bosses beaten (`bossesBeaten`). */
  readonly bosses: number;
  /** The Warbands beaten over every Floor (`RunState.beaten` and this Floor's `wiped`). */
  readonly warbands: number;
}

/** Player Fighter `fighter` took a fire's heal, healing `healed` HP. */
export interface RestedEvent {
  readonly type: 'Rested';
  readonly fighter: number;
  readonly healed: number;
}

/** Player Fighter `fighter` dropped `item` (a Weapon or Relic Item) from its inventory, at `at`: its feet. */
export interface ItemDroppedEvent extends DroppedItem {
  readonly type: 'ItemDropped';
}

/** Player Fighter `fighter` took up pickup `id` (of `delver.pickups`): the Weapon or Relic Item `item` is in its inventory now. */
export interface ItemTakenEvent extends Dropped {
  readonly type: 'ItemTaken';
  readonly fighter: number;
  readonly id: number;
}

/** A Delver Run's party took the Stairs of Floor `floor`: the next Floor starts after the fade (`nextDuelTick`). */
export interface StairsTakenEvent {
  readonly type: 'StairsTaken';
  readonly floor: number;
}

/**
 * Fire `fire` (0-based, `plan.markers.fires` order) of a Delver Floor brought Fighter `fighter` back from the fallen; `fire` is BOSS_REVIVE (-1) when a
 * beaten Boss did, STONE_REVIVE (-2) when a Resurrection Stone did (`delverRun.ts`).
 */
export interface RevivedEvent {
  readonly type: 'Revived';
  readonly fighter: number;
  readonly fire: number;
}

/** Player Fighter `fighter` used the Consumable `item`, whose effect was `effect`: it is gone from its inventory (docs/plans/delver.md, Stage 10). */
export interface ItemUsedEvent {
  readonly type: 'ItemUsed';
  readonly fighter: number;
  readonly item: Item;
  readonly effect: ConsumableEffect;
}

/** Warband `warband` (a Squad of the Floor's Crowd) of rank `rank` (PLAIN, ELITE or BOSS) was wiped, its last Soldier falling at `at`, where its items were laid. */
export interface WarbandWipedEvent {
  readonly type: 'WarbandWiped';
  readonly warband: number;
  readonly rank: number;
  readonly at: PickupAt;
}

/** A Delver Run's party wiped the Boss Warband of Floor `floor`: the gate is open, and unless it was the last tier's, the party is healed and the fallen revived. */
export interface BossBeatenEvent {
  readonly type: 'BossBeaten';
  readonly floor: number;
}

/** Match-level events of one Match Tick. Duel events stay on `duel.events`. */
export type MatchEvent = DuelStartEvent | MatchEndEvent | RunEndEvent | RestedEvent | ItemDroppedEvent | ItemTakenEvent | ItemUsedEvent | StairsTakenEvent | RevivedEvent | WarbandWipedEvent | BossBeatenEvent | RoutEvent | BattleEndEvent;

/**
 * THE Takeover seam: an AI has taken over Player Fighter `fighter` of a Run or a Battle (the Rollback session applies it on every peer at the Takeover
 * Tick, before that Tick's Intents). From now on the Fighter is an AI ally of the Run (`RunState.away`, mirrored on `SimDelver.away`): it
 * counts at no Stairs, takes no pickup, no fire and no Reveal, and keeps its inventory and Mods. `config.humans` stays (Warband sizes are fixed
 * for the Run). A traitor who leaves is marked so, and a Soldier it holds becomes an ordinary promoted enemy (`traitorLeaves`). Idempotent;
 * not a Run, or not one of the Run's Players (`config.players`) or traitors: unchanged (the session calls this inside its Rollback loops, where a throw would leave it half-simulated).
 * In a Battle (docs/plans/big-battle.md, Stage 6) the Player's record is marked away (`BattlePlayer.away`): its Fighter, an AI's from now on, is an ally of
 * its Team with no Bubble, and it takes over no Soldier when it falls. Pure.
 */
export function takeOverFighter(match: MatchState, fighter: number): MatchState {
  const crowd = match.duel.crowd;
  // A Floor's Crowd has no Player records (`players` is empty): a Delver Run falls through to its own branch below.
  if (crowd && !match.delver) {
    const record = crowd.players[fighter];
    if (!record || record.away) return match;
    const players = crowd.players.map((p, k) => (k === fighter ? { ...p, away: true as const } : p));
    return { ...match, duel: { ...match.duel, crowd: { ...crowd, players } } };
  }
  const { delver } = match;
  if (delver) {
    // A traitor (docs/plans/delver.md, Stage 8a): marked away, and a Soldier it holds becomes an ordinary promoted enemy.
    const j = traitorOf(match.config, fighter);
    if (j >= 0 && delver.traitors) {
      const left = traitorLeaves(match.duel, delver.traitors, match.config, j);
      if (left.records === delver.traitors) return match;
      return { ...match, delver: { ...delver, traitors: left.records }, duel: { ...left.duel, delver: { ...left.duel.delver!, traitors: left.records } } };
    }
    if (!runPlayers(match.config).includes(fighter) || delver.away?.includes(fighter)) return match;
    const away = [...(delver.away ?? []), fighter].sort((a, b) => a - b);
    return { ...match, delver: { ...delver, away }, duel: { ...match.duel, delver: { ...match.duel.delver!, away } } };
  }
  return match;
}

export interface MatchState {
  readonly config: MatchConfig;
  /** 1-based number of this Match, counting rematches (see `rematchTicks`). */
  readonly matchNumber: number;
  /**
   * The Arena this Match's Duels are fought in, every one of them: `config.arena` for the first Match, and at each
   * Rematch the next (`nextArenaName`: a Random Map's next seed, a hand-made Arena itself), which every peer builds.
   * In a Run, the current Floor's (`floorName`).
   */
  readonly arena: string;
  /** Match Ticks since the first Match started, carried across rematches (Duel ticks restart at 0 each Duel). */
  readonly tick: number;
  /** 1-based number of the current Duel, draws included; in a Run, of the current Floor. */
  readonly duelNumber: number;
  /** Duels won by each team (team 0, team 1); in a Run, Team 0's Floors behind it. */
  readonly score: readonly number[];
  /** The current Duel. */
  readonly duel: SimState;
  /**
   * The Match Tick on which the next Duel starts, or null while a Duel is being fought (or the Match is over). In a Run,
   * the Tick the next Floor starts, set while Descending.
   */
  readonly nextDuelTick: number | null;
  readonly status: MatchStatus;
  readonly events: readonly MatchEvent[];
  /** The Run's progress, in Gauntlet format (docs/plans/delver.md); absent otherwise, so every other Match hashes as it always did. */
  readonly delver?: RunState;
}

/** Duel wins needed to take a best-of-N Match: a strict majority. */
export function duelsToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Throws unless `teams` puts 1 to MAX_TEAM_SIZE Fighters on each of team 0 and team 1. */
export function checkTeams(teams: readonly number[]): void {
  if (!teams.every((t) => t === 0 || t === 1)) throw new RangeError(`Every Fighter's team must be 0 or 1, got [${teams.join(', ')}]`);
  for (const t of [0, 1]) {
    const size = teams.filter((team) => team === t).length;
    if (size < 1 || size > MAX_TEAM_SIZE) throw new RangeError(`Team ${t} must field 1 to ${MAX_TEAM_SIZE} Fighters, got ${size}`);
  }
}

/** Throws unless `teams` is a Gauntlet Lineup's: Team 0's 1 to MAX_TEAM_SIZE Fighters, then exactly MAX_TEAM_SIZE Team 1 slots (its traitors and the Floors'). */
export function checkRunTeams(teams: readonly number[]): void {
  checkTeams(teams);
  const own = teams.indexOf(1);
  if (teams.length - own !== MAX_TEAM_SIZE || teams.slice(own).some((t) => t !== 1))
    throw new RangeError(`A Run's teams must be Team 0's Fighters followed by ${MAX_TEAM_SIZE} Team 1 slots, got [${teams.join(', ')}]`);
}

/** Throws unless `teams` is a Delver Run's party: 1 to MAX_TEAM_SIZE Fighters, all Team 0 (the Floors' enemies are the Crowd's, not slots of `teams`). */
export function checkDelverTeams(teams: readonly number[]): void {
  if (teams.length < 1 || teams.length > MAX_TEAM_SIZE || teams.some((t) => t !== 0))
    throw new RangeError(`A Delver Run's teams must be 1 to ${MAX_TEAM_SIZE} Team 0 Fighters, got [${teams.join(', ')}]`);
}

/**
 * A Delver Run's party from the `teams` given: Team 0's Fighters alone, or followed by exactly MAX_TEAM_SIZE Team 1 slots (the Lobby's Gauntlet
 * Lineup still has them), which are dropped. The party's length is how many of `teams` (and of the Weapons and Sizes) are kept.
 */
function delverParty(teams: readonly number[]): readonly number[] {
  const own = teams.indexOf(1);
  if (own < 0) return teams;
  if (teams.length - own !== MAX_TEAM_SIZE || teams.slice(own).some((t) => t !== 1)) throw new RangeError(`A Delver Run's teams must be Team 0's Fighters alone, or followed by ${MAX_TEAM_SIZE} Team 1 slots, got [${teams.join(', ')}]`);
  return teams.slice(0, own);
}

/** Where each Fighter starts: team t's k-th Fighter at the Arena's spawn for (t, k), or (if any is missing) in two facing lines. */
function startPlacements(tuning: TuningData, config: MatchConfig, arena: string): Placement[] {
  const { spawns } = arenaOf(tuning, arena);
  const seen = [0, 0];
  const placed = config.teams.map((team) => {
    const slot = seen[team]!++;
    const s = spawns.find((p) => p.team === team && p.slot === slot);
    return s && { position: { x: s.position.x, z: s.position.z }, y: s.position.y, facing: s.facing };
  });
  return placed.every((p) => p !== undefined) ? placed : teamPlacements(config.teams, config.distance, config.spacing);
}

function initialDuel(tuning: TuningData, config: MatchConfig, arena: string, seed: number): SimState {
  return createInitialState(tuning, seed, startPlacements(tuning, config, arena), config.weapons, config.teams, arena, config.sizes);
}

function freshDuel(tuning: TuningData, config: MatchConfig, arena: string, rng: SimState['rng']): SimState {
  return { ...initialDuel(tuning, config, arena, 0), rng };
}

/** A Run's first Arena name, checked: it is never built (its seed is the Run seed). */
function runArena(tuning: TuningData, name: string): string {
  if (!isArenaName(tuning, name)) throw new Error(`Unknown Arena "${name}" (have: ${Object.keys(tuning.arenas).join(', ')})`);
  return name;
}

/** `{ sizes }` for the Fighters' Sizes (clamped; a missing one is the standard body), or nothing when all are standard (so a standard Match's config is unchanged). */
function sizesOf(count: number, given: readonly (Size | undefined)[] | undefined): { sizes?: Size[] } {
  const sizes = Array.from({ length: count }, (_, i) => storedSize(given?.[i]) ?? { height: 1, thick: 1 });
  return sizes.every((s) => isStandardSize(s)) ? {} : { sizes };
}

/** A Match at Tick 0: Duel 1 (or a Run's first Floor) about to be fought, score 0–0. Throws on an unknown Weapon name or an invalid lineup. */
export function createMatch(tuning: TuningData, options: MatchOptions): MatchState {
  const format = options.format ?? 'Duels';
  if (!ALL_FORMATS.includes(format)) throw new RangeError(`format must be one of ${ALL_FORMATS.join(', ')}, got ${String(format)}`);
  if (format === 'Battle') return createBattle(tuning, options);
  const gauntlet = format === 'Gauntlet';
  const given = options.teams ?? [0, 1];
  // A Run's `teams` is its party: Team 0's Fighters (any Team 1 slots after them are dropped).
  const teams = gauntlet ? delverParty(given) : given;
  if (gauntlet) checkDelverTeams(teams);
  else checkTeams(teams);
  const humans = options.humans ?? options.players?.length ?? 1;
  const config: MatchConfig = {
    format,
    bestOf: options.bestOf,
    distance: options.distance ?? tuning.match.duelDistance,
    spacing: options.spacing ?? tuning.match.lineSpacing,
    interDuelTicks: options.interDuelTicks ?? secondsToTicks(tuning.match.interDuelSeconds),
    weapons: teams.map((_, i) => weaponByName(tuning, options.weapons?.[i] ?? defaultWeaponName(tuning)).name),
    teams: [...teams],
    ...sizesOf(teams.length, options.sizes),
    rematchTicks: options.rematchTicks ?? null,
    arena: gauntlet ? runArena(tuning, options.arena ?? tuning.arena.match) : arenaOf(tuning, options.arena ?? tuning.arena.match).name,
    humans,
    ...(gauntlet ? { players: [...(options.players ?? runPlayers({ teams, humans }))] } : {}),
    ...(options.delverStart === undefined ? {} : { delverStart: options.delverStart }),
    ...(options.delverGallery ? { delverGallery: true as const } : {}),
    ...(options.traitors?.length ? { traitors: options.traitors.map((t) => (storedSize(t.size) ? { size: storedSize(t.size)! } : {})) } : {}),
  };
  if (!Number.isInteger(config.humans) || config.humans < 0) throw new RangeError(`humans must be an integer >= 0, got ${config.humans}`);
  if (gauntlet) {
    const own = teams.filter((t) => t === 0).length;
    // A Run with a traitor may field no human in its party (all AI allies).
    const fewest = config.traitors ? 0 : 1;
    if (config.humans < fewest || config.humans > own) throw new RangeError(`A Run fields ${fewest} to ${own} humans (Team 0's size), got ${config.humans}`);
    if (config.rematchTicks !== null) throw new RangeError('A Run has no Rematch: rematchTicks must be null');
    const players = config.players!;
    if (players.length !== config.humans || players.some((p, k) => !Number.isInteger(p) || teams[p] !== 0 || (k > 0 && p <= players[k - 1]!)))
      throw new RangeError(`A Run's players must be its ${config.humans} human(s)' Team 0 Fighters, ascending, got [${players.join(', ')}]`);
  }
  if (!Number.isInteger(config.bestOf) || config.bestOf < 1) throw new RangeError(`bestOf must be a positive integer, got ${config.bestOf}`);
  if (!Number.isInteger(config.interDuelTicks) || config.interDuelTicks < 1)
    throw new RangeError(`interDuelTicks must be an integer >= 1, got ${config.interDuelTicks}`);
  if (config.rematchTicks !== null && (!Number.isInteger(config.rematchTicks) || config.rematchTicks < 1))
    throw new RangeError(`rematchTicks must be null or an integer >= 1, got ${config.rematchTicks}`);
  const seed = options.seed ?? 1;
  if (options.relics?.length && !gauntlet) throw new RangeError('Only a Run starts with Relics');
  if (options.delverStart !== undefined && !gauntlet) throw new RangeError('Only a Run has a start Floor');
  if (options.delverGallery && (!gauntlet || options.delverStart !== undefined)) throw new RangeError('Only a Run from Floor 1 is the Set Piece Gallery');
  if (config.traitors) {
    if (!gauntlet) throw new RangeError('Only a Run has traitors');
    if (config.traitors.length > MAX_TEAM_SIZE || config.humans + config.traitors.length > MAX_TEAM_SIZE) throw new RangeError(`A Delver Run fields at most ${MAX_TEAM_SIZE} Players, its traitors among them, got ${config.humans} and ${config.traitors.length} traitor(s)`);
  }
  if (gauntlet) {
    // A Run: Floor 1 of the generated Dungeon (or the dev `delverStart` Floor), built here (behind the menu), Team 0 at its Entrance.
    // The Set Piece Gallery is one Floor.
    const floors = config.delverGallery ? 1 : tuning.delver.tiers * tuning.delver.floorsPerTier;
    const floor = config.delverStart ?? 1;
    if (!Number.isInteger(floor) || floor < 1 || floor > floors) throw new RangeError(`delverStart must be a Floor from 1 to ${floors}, got ${floor}`);
    const { run: delver, duel } = firstFloor(tuning, config, floors, floorDuel(tuning, config, floor, null, createRng(seed), options.relics), floor);
    return {
      config,
      matchNumber: 1,
      arena: duel.arena,
      tick: 0,
      duelNumber: floor,
      score: [floor - 1, 0],
      duel,
      nextDuelTick: null,
      status: { status: 'InProgress' },
      events: [{ type: 'DuelStart', duelNumber: floor }],
      delver,
    };
  }
  const duel = initialDuel(tuning, config, config.arena, seed);
  return { config, matchNumber: 1, arena: duel.arena, tick: 0, duelNumber: 1, score: [0, 0], duel, nextDuelTick: null, status: { status: 'InProgress' }, events: [{ type: 'DuelStart', duelNumber: 1 }] };
}

/**
 * A Battle at Tick 0: both armies deployed (`createCrowd`) on Battlefield `options.arena` (default `battle:<seed>`; a hand-built map's
 * `battle:<map>` takes an army no bigger than the map's `armySize.max`, folded in by `applyBattleKnobs`), its
 * Players' Fighters (`teams`: 0 to MAX_TEAM_SIZE a Team, default none) at their Team's spawns behind its army, then the rest
 * of the Fighter Pool (`battle.bubble.poolSize` slots in all) unbound. `teams` (and `weapons`) name only the Players' Fighters:
 * `checkTeams` and its MAX_TEAM_SIZE a side never apply to the Pool. Throws on a bad lineup, more Players than the Pool holds,
 * an Arena that is not a Battlefield, an army too big for its map, or a Rematch (a Battle has none).
 */
function createBattle(tuning: TuningData, options: MatchOptions): MatchState {
  const teams = options.teams ?? [];
  if (!teams.every((t) => t === 0 || t === 1)) throw new RangeError(`Every Fighter's team must be 0 or 1, got [${teams.join(', ')}]`);
  for (const t of [0, 1]) if (teams.filter((team) => team === t).length > MAX_TEAM_SIZE) throw new RangeError(`A Battle fields at most ${MAX_TEAM_SIZE} Fighters on Team ${t}`);
  if (options.rematchTicks != null) throw new RangeError('A Battle has no Rematch: rematchTicks must be null');
  if (options.delverStart !== undefined || options.delverGallery || options.relics?.length) throw new RangeError('Only a Run has a start Floor, the Set Piece Gallery or Relics');
  const seed = options.seed ?? 1;
  const arena = options.arena ?? battleArenaName(seed);
  if (!battlefieldOf(tuning.battle, arena)) throw new RangeError(`A Battle is fought on a Battlefield (battle:<seed> or a map of battle.maps), got "${arena}"`);
  const map = battleMapName(arena);
  if (map !== null && tuning.battle.armySize > tuning.battle.maps[map]!.armySize.max)
    throw new RangeError(`Battle map "${map}" holds armies of at most ${tuning.battle.maps[map]!.armySize.max}, got ${tuning.battle.armySize} (fold the map in with applyBattleKnobs)`);
  const config: MatchConfig = {
    format: 'Battle',
    bestOf: options.bestOf,
    distance: options.distance ?? tuning.match.duelDistance,
    spacing: options.spacing ?? tuning.match.lineSpacing,
    interDuelTicks: options.interDuelTicks ?? secondsToTicks(tuning.match.interDuelSeconds),
    weapons: teams.map((_, i) => weaponByName(tuning, options.weapons?.[i] ?? defaultWeaponName(tuning)).name),
    teams: [...teams],
    ...sizesOf(teams.length, options.sizes),
    rematchTicks: null,
    arena,
    humans: options.humans ?? teams.length,
  };
  const { poolSize } = tuning.battle.bubble;
  if (teams.length > poolSize) throw new RangeError(`A Battle's Fighter Pool holds ${poolSize} Fighters, got ${teams.length} Players`);
  const players = initialDuel(tuning, config, arena, seed);
  const unbound = unboundSlot(tuning, arena);
  const crowd = createCrowd(tuning.battle, seed, teams.length, arena);
  // Each Player comes back after a fall, to begin with, as the Troop that wields the Weapon it chose (none if no Troop does): `BattlePlayer.troop`.
  const chosen = crowd.players.map((record, i) => {
    const troop = tuning.battle.troops.findIndex((t) => t.weapon === config.weapons[i]);
    return troop < 0 ? record : { ...record, troop };
  });
  const duel = { ...players, fighters: [...players.fighters, ...new Array<typeof unbound>(poolSize - teams.length).fill(unbound)], crowd: { ...crowd, players: chosen } };
  return { config, matchNumber: 1, arena, tick: 0, duelNumber: 1, score: [0, 0], duel, nextDuelTick: null, status: { status: 'InProgress' }, events: [{ type: 'DuelStart', duelNumber: 1 }] };
}

/** The Fighters on `team`, by index. */
export function teamMembers(match: MatchState, team: number): number[] {
  return match.config.teams.flatMap((t, i) => (t === team ? [i] : []));
}

/**
 * Advance the Match by one Tick. Pure: never mutates `match`.
 * `intents[i]` drives Fighter i of the current Duel (ignored between Duels).
 */
export function stepMatch(match: MatchState, intents: readonly Intent[], tuning: TuningData): MatchState {
  const tick = match.tick + 1;
  const events: MatchEvent[] = [];

  const { status: over, config } = match;
  if (match.delver && over.status === 'InProgress') return stepDelver(match, match.delver, intents, tuning, tick);
  if (config.format === 'Battle' && over.status === 'InProgress') return stepBattle(match, intents, tuning, tick);

  if (over.status === 'Over' && config.rematchTicks !== null && tick >= over.tick + config.rematchTicks) {
    // A fresh Match: Duel 1, score 0–0, the generator carried on so it isn't a replay of the last one, on the next
    // Arena (a Random Map's next seed; the game builds it ahead, while the result shows, so this Tick only reads it).
    events.push({ type: 'DuelStart', duelNumber: 1 });
    const arena = nextArenaName(match.arena);
    return {
      ...match,
      matchNumber: match.matchNumber + 1,
      arena,
      tick,
      duelNumber: 1,
      score: [0, 0],
      duel: freshDuel(tuning, match.config, arena, match.duel.rng),
      nextDuelTick: null,
      status: { status: 'InProgress' },
      events,
    };
  }

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    return { ...match, tick, duelNumber, duel: freshDuel(tuning, match.config, match.arena, match.duel.rng), nextDuelTick: null, events };
  }

  // A Run that is over steps here too: its Duel is over, so it stands still (a Delver Run's under its Floor's Tuning Data).
  const duel = step(match.duel, intents, arenaTuning(tuning, match.duel.arena));
  let { score, status, nextDuelTick } = match;
  if (!match.delver && match.duel.duel.status === 'Fighting' && duel.duel.status === 'Over') {
    const { winner } = duel.duel;
    if (winner !== null) score = score.map((s, i) => (i === winner ? s + 1 : s));
    if (winner !== null && score[winner]! >= duelsToWin(match.config.bestOf)) {
      status = { status: 'Over', winner, tick };
      events.push({ type: 'MatchEnd', winner, score });
    } else {
      nextDuelTick = tick + match.config.interDuelTicks;
    }
  }
  return { ...match, tick, score, duel, nextDuelTick, status, events };
}
