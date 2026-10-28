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
 * In Gauntlet format (docs/plans/dungeon.md) the Match is a Run instead: it walks
 * a Dungeon, each Duel a Hall on its own Generated Arena against the Hall's
 * Encounter (`hallDuel`), HP carrying over. A Hall's Duel goes on once its
 * Encounter falls (the Hall is Cleared), until every living Player has stood in
 * one exit Door's zone for `dungeon.doorSeconds`; after `dungeon.hallFadeSeconds`
 * the Hall behind it starts. The Run ends when Team 0 is wiped out or the last
 * Floor's Boss falls.
 *
 * Like SimState, MatchState is plain JSON-like data and `stepMatch` is pure,
 * so a whole Match hashes (`hashValue`) and snapshots (`snapshot`) exactly
 * for Rollback.
 */
import { defaultWeaponName, weaponByName, type HallKind, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import type { Intent } from './intent';
import type { FighterState, HallPhase, SimState } from './state';
import { arenaOf } from './arena';
import { isArenaName, nextArenaName } from './arenaGen/named';
import { FLOOR_ROWS, type Hall } from './dungeon';
import { inDuel } from './duel';
import { atRestFire, doorCounters, hallOf, hallRoster, inExitZone, runPlayers, type HallRef } from './hall';
import { createRng } from './rng';
import type { Placement } from './skeleton';
import { createInitialState, step, teamPlacements } from './step';

/** The most Fighters a team may field. */
export const MAX_TEAM_SIZE = 4;

/** How a Match is played: Duels (best-of-N, the default) or Gauntlet (a Run through a Dungeon). */
export type MatchFormat = 'Duels' | 'Gauntlet';
export const MATCH_FORMATS: readonly MatchFormat[] = ['Duels', 'Gauntlet'];

export interface MatchConfig {
  /** Duels (default) or Gauntlet: a Run, where `bestOf` is ignored and `teams` is Team 0's 1 to MAX_TEAM_SIZE Fighters followed by MAX_TEAM_SIZE Team 1 slots. */
  readonly format: MatchFormat;
  /** N: the Match is best of this many Duels. A positive integer. */
  readonly bestOf: number;
  /** Starting distance between the two teams' lines at the start of every Duel (metres). */
  readonly distance: number;
  /** Starting distance between teammates side by side in a line (metres). */
  readonly spacing: number;
  /** Ticks between a Duel ending and the next one starting (at least 1). A Run never reads it (its Halls change after `dungeon.hallFadeSeconds`). */
  readonly interDuelTicks: number;
  /** Each Fighter's Weapon (a Tuning Data Weapon name), kept across Duels. */
  readonly weapons: readonly string[];
  /** Each Fighter's team (0 or 1); its length is the number of Fighters. */
  readonly teams: readonly number[];
  /** Ticks after the Match ends before a fresh Match (same config, score 0–0) starts, or null for none (the default). */
  readonly rematchTicks: number | null;
  /**
   * The Arena the first Match's Duels are fought in (a Tuning Data Arena name, or a Generated Arena's `gen:<kit>:<seed>`;
   * default `arena.match`); each Rematch moves to the next (`MatchState.arena`). Fighters start at its spawns when it
   * has one for each, else in two facing lines (`distance`, `spacing`). A Run is never fought in it: its seed is the Run
   * seed and its Kit the Halls' (`runSeed`, `runKit`).
   */
  readonly arena: string;
  /**
   * How many human Players the Lineup fields (default 1; `lineupMatch` fills it for a Gauntlet, and Duels never read it).
   * A Run scales its enemies' max HP with it, so it is fixed for the Run: an AI Takeover never changes it. 1 to Team 0's size in a Run.
   */
  readonly humans: number;
  /**
   * In a Run, the Fighters the human Players drive (Team 0 indices, ascending, `humans` of them; `lineupMatch` fills it,
   * default the first `humans` of Team 0): only their standing counts at a Door, and only they take a Rest Hall's fire.
   * Absent in Duels.
   */
  readonly players?: readonly number[];
}

export interface MatchOptions extends Partial<MatchConfig> {
  readonly bestOf: number;
  /** Seeds the Simulation's generator; it carries over from Duel to Duel. */
  readonly seed?: number;
}

/** `winner` is a team (0 or 1). */
export type MatchStatus = { readonly status: 'InProgress' } | { readonly status: 'Over'; readonly winner: number; readonly tick: number };

/** A new Duel of the Match began (Fighters reset); in a Run, a new Hall. */
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

/** A Run ended: Team 0 was wiped out, `winner` 1, or the last Floor's Boss fell, `winner` 0. */
export interface RunEndEvent {
  readonly type: 'RunEnd';
  readonly winner: number;
  /** Floors Team 0 cleared (their Boss beaten). */
  readonly cleared: number;
  readonly floors: number;
  /** Halls Team 0 cleared, Bosses included. */
  readonly halls: number;
}

/** A Run's Hall was cleared: no Team 1 Fighter is left in its Duel (on its first Tick, for a Hall with no Encounter). */
export interface HallClearedEvent {
  readonly type: 'HallCleared';
  readonly floor: number;
  readonly row: number;
  readonly index: number;
  readonly kind: HallKind;
}

/** The party took exit `exit` (0-based, as `Hall.exits`; Arena Door `exit + 1`): Hall `to` starts after the fade (`nextDuelTick`). */
export interface DoorTakenEvent {
  readonly type: 'DoorTaken';
  readonly exit: number;
  readonly to: HallRef;
}

/** Player Fighter `fighter` took a Rest Hall's fire, healing `healed` HP. */
export interface RestedEvent {
  readonly type: 'Rested';
  readonly fighter: number;
  readonly healed: number;
}

/** Match-level events of one Match Tick. Duel events stay on `duel.events`. */
export type MatchEvent = DuelStartEvent | MatchEndEvent | RunEndEvent | HallClearedEvent | DoorTakenEvent | RestedEvent;

/** A Gauntlet Run's progress (`MatchState.run`): where in the Dungeon the party stands, and how long it has gathered at each Door. */
export interface RunState {
  /** The Floor of the current Hall (1-based). */
  readonly floor: number;
  /** Floors in the Dungeon (Tuning Data `dungeon.floors`); beating the last one's Boss wins the Run. */
  readonly floors: number;
  /** The current Hall's row (0-based: 0 the entrance, FLOOR_ROWS − 1 the Boss). */
  readonly row: number;
  /** The current Hall's index in its row (0-based, as `floorGraph`). */
  readonly hall: number;
  /** Every Hall the party has entered, in order, the current one last (for the map and results). */
  readonly path: readonly HallRef[];
  /** The current Hall's phase, as its Duel's `hall.phase`. */
  readonly phase: HallPhase;
  /**
   * Per exit Door of the current Hall (`Hall.exits` order), the Ticks in a row every Fighter whose standing counts
   * (`doorCounters`) has stood in its zone, back to 0 when one is out of it. The first to reach `dungeon.doorSeconds` is
   * taken (`takenExit`); they stay as they are while `Leaving`.
   */
  readonly doorTicks: readonly number[];
  /** The Player Fighters that took this Hall's Rest fire (ascending; a Rest Hall heals each Player once). */
  readonly rested: readonly number[];
  /** The Match Tick the Run started on. */
  readonly startTick: number;
}

export interface MatchState {
  readonly config: MatchConfig;
  /** 1-based number of this Match, counting rematches (see `rematchTicks`). */
  readonly matchNumber: number;
  /**
   * The Arena this Match's Duels are fought in, every one of them: `config.arena` for the first Match, and at each
   * Rematch the next (`nextArenaName`: a Random Map's next seed, a hand-made Arena itself), which every peer builds.
   * In a Run, the current Hall's (`Hall.arena`).
   */
  readonly arena: string;
  /** Match Ticks since the first Match started, carried across rematches (Duel ticks restart at 0 each Duel). */
  readonly tick: number;
  /** 1-based number of the current Duel, draws included; in a Run, of the current Hall. */
  readonly duelNumber: number;
  /** Duels won by each team (team 0, team 1); in a Run, Team 0's Halls cleared. */
  readonly score: readonly number[];
  /** The current Duel. */
  readonly duel: SimState;
  /**
   * The Match Tick on which the next Duel starts, or null while a Duel is being fought (or the Match is over). In a Run,
   * the Tick the next Hall starts, set while `Leaving`.
   */
  readonly nextDuelTick: number | null;
  readonly status: MatchStatus;
  readonly events: readonly MatchEvent[];
  /** The Run, in Gauntlet format; null in Duels. */
  readonly run: RunState | null;
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

/** Throws unless `teams` is a Run's: Team 0's 1 to MAX_TEAM_SIZE Fighters, then exactly MAX_TEAM_SIZE Team 1 slots. */
export function checkRunTeams(teams: readonly number[]): void {
  checkTeams(teams);
  const own = teams.indexOf(1);
  if (teams.length - own !== MAX_TEAM_SIZE || teams.slice(own).some((t) => t !== 1))
    throw new RangeError(`A Run's teams must be Team 0's Fighters followed by ${MAX_TEAM_SIZE} Team 1 slots, got [${teams.join(', ')}]`);
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
  return createInitialState(tuning, seed, startPlacements(tuning, config, arena), config.weapons, config.teams, arena);
}

function freshDuel(tuning: TuningData, config: MatchConfig, arena: string, rng: SimState['rng']): SimState {
  return { ...initialDuel(tuning, config, arena, 0), rng };
}

/**
 * A Run's Duel in Hall `at` (`hall` its node of the Floor graph), on the Hall's Arena, replacing `freshDuel`: every Fighter
 * at the Arena's spawns (Team 0 at its entrance Door's), drawn, daggers refilled. Team 0 keeps its HP from `previous` (the
 * Hall before; null for the Run's first: full HP), a fallen one back at `dungeon.revive` of its max HP, and all of it at
 * full HP after a Boss (`healed`). Each Team 1 slot holds the Hall's Encounter's enemy for it, with its Weapon and scaled
 * max HP (`hallRoster`), or is Benched when there is none for it (every slot of a Treasure or Rest Hall).
 */
export function hallDuel(tuning: TuningData, config: MatchConfig, at: HallRef, hall: Hall, previous: SimState | null, healed: boolean, rng: SimState['rng']): SimState {
  const roster = hallRoster(tuning, config, at);
  let slot = 0;
  const enemies = config.teams.map((team) => (team === 1 ? roster[slot++] ?? null : null));
  const weapons = config.weapons.map((w, i) => enemies[i]?.weapon ?? w);
  const base = createInitialState(tuning, 0, startPlacements(tuning, config, hall.arena), weapons, config.teams, hall.arena);
  const { revive } = tuning.dungeon;
  const fighters = base.fighters.map((f, i) => {
    if (f.team === 1) {
      const enemy = enemies[i];
      return enemy ? { ...f, hp: enemy.maxHp, maxHp: enemy.maxHp } : { ...f, hp: 0, benched: true as const };
    }
    const before = previous?.fighters[i];
    if (!before || healed) return f;
    return { ...f, hp: inDuel(before) ? Math.min(f.maxHp, before.hp) : revive * f.maxHp };
  });
  return { ...base, rng, fighters, hall: { ...at, kind: hall.kind, phase: 'Fighting' } };
}

/** The Run on entering Hall `at` (`hall` its node), `path` the Halls entered before it. */
function enterHall(run: Pick<RunState, 'floors' | 'startTick'>, at: HallRef, hall: Hall, path: readonly HallRef[]): RunState {
  return {
    floor: at.floor,
    floors: run.floors,
    row: at.row,
    hall: at.index,
    path: [...path, at],
    phase: 'Fighting',
    doorTicks: hall.exits.map(() => 0),
    rested: [],
    startTick: run.startTick,
  };
}

/** The Run's current Hall. */
export const runHall = (run: RunState): HallRef => ({ floor: run.floor, row: run.row, index: run.hall });

/** Ticks every Fighter whose standing counts must stand in a Door's zone to take it (`dungeon.doorSeconds`, at least 1). */
export const doorTicksNeeded = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.dungeon.doorSeconds));

/** The exit (0-based, as `Hall.exits`) the party took, while `Leaving`: the first whose `doorTicks` reached `doorTicksNeeded`; else null. */
export function takenExit(run: RunState, tuning: TuningData): number | null {
  if (run.phase !== 'Leaving') return null;
  const need = doorTicksNeeded(tuning);
  const exit = run.doorTicks.findIndex((t) => t >= need);
  return exit < 0 ? null : exit;
}

/** The Hall behind exit `exit` of the Run's current Hall: one of the next row's, or after a Boss row 0 of the next Floor; null for none. */
export function hallBehind(tuning: TuningData, config: Pick<MatchConfig, 'arena'>, run: RunState, exit: number): HallRef | null {
  const target = hallOf(tuning, config.arena, runHall(run)).exits[exit];
  if (target === undefined) return null;
  return run.row === FLOOR_ROWS - 1 ? { floor: run.floor + 1, row: 0, index: target } : { floor: run.floor, row: run.row + 1, index: target };
}

/**
 * Halls and Floors Team 0 has cleared so far: every Hall entered but the current one while it is still being fought, and
 * every Floor before the current one, plus the current one once its Boss is beaten.
 */
export function runCleared(run: RunState): { readonly halls: number; readonly floors: number } {
  const done = run.phase !== 'Fighting';
  return { halls: run.path.length - (done ? 0 : 1), floors: run.floor - 1 + (done && run.row === FLOOR_ROWS - 1 ? 1 : 0) };
}

/** A Run's first Arena name, checked: it is never built (its seed is the Run seed, its Kit the Halls'). */
function runArena(tuning: TuningData, name: string): string {
  if (!isArenaName(tuning, name)) throw new Error(`Unknown Arena "${name}" (have: ${Object.keys(tuning.arenas).join(', ')})`);
  return name;
}

/** A Match at Tick 0: Duel 1 (or a Run's first Hall) about to be fought, score 0–0. Throws on an unknown Weapon name or an invalid lineup. */
export function createMatch(tuning: TuningData, options: MatchOptions): MatchState {
  const format = options.format ?? 'Duels';
  if (!MATCH_FORMATS.includes(format)) throw new RangeError(`format must be one of ${MATCH_FORMATS.join(', ')}, got ${String(format)}`);
  const gauntlet = format === 'Gauntlet';
  const teams = options.teams ?? [0, 1];
  if (gauntlet) checkRunTeams(teams);
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
    rematchTicks: options.rematchTicks ?? null,
    arena: gauntlet ? runArena(tuning, options.arena ?? tuning.arena.match) : arenaOf(tuning, options.arena ?? tuning.arena.match).name,
    humans,
    ...(gauntlet ? { players: [...(options.players ?? runPlayers({ teams, humans }))] } : {}),
  };
  if (!Number.isInteger(config.humans) || config.humans < 0) throw new RangeError(`humans must be an integer >= 0, got ${config.humans}`);
  if (gauntlet) {
    const own = teams.filter((t) => t === 0).length;
    if (config.humans < 1 || config.humans > own) throw new RangeError(`A Run fields 1 to ${own} humans (Team 0's size), got ${config.humans}`);
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
  const first: HallRef = { floor: 1, row: 0, index: 0 };
  const hall = gauntlet ? hallOf(tuning, config.arena, first) : null;
  const duel = hall ? hallDuel(tuning, config, first, hall, null, false, createRng(seed)) : initialDuel(tuning, config, config.arena, seed);
  return {
    config,
    matchNumber: 1,
    arena: duel.arena,
    tick: 0,
    duelNumber: 1,
    score: [0, 0],
    duel,
    nextDuelTick: null,
    status: { status: 'InProgress' },
    events: [{ type: 'DuelStart', duelNumber: 1 }],
    run: hall ? enterHall({ floors: tuning.dungeon.floors.length, startTick: 0 }, first, hall, []) : null,
  };
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
  if (match.run && over.status === 'InProgress') return stepRun(match, match.run, intents, tuning, tick);

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

  // A Run that is over steps here too: its Duel is over, so it stands still.
  const duel = step(match.duel, intents, tuning);
  let { score, status, nextDuelTick } = match;
  if (!match.run && match.duel.duel.status === 'Fighting' && duel.duel.status === 'Over') {
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

/**
 * One Tick of a Run in progress (the Dungeon branch of `stepMatch`): once the fade is over, the next Hall's Duel; else the
 * Hall's Duel stepped, then a wipe of Team 0 is a Defeat, a Hall whose Encounter has fallen is Cleared (the last Boss's:
 * a Victory), and in a Cleared Hall the Rest fire heals and each exit Door counts the Ticks the party stands in its zone.
 */
function stepRun(match: MatchState, run: RunState, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const { config } = match;
  const events: MatchEvent[] = [];

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    // The fade is over: the Hall behind the Door taken (its Arena warmed ahead by the game, so this Tick only reads it).
    const at = hallBehind(tuning, config, run, takenExit(run, tuning)!)!;
    const hall = hallOf(tuning, config.arena, at);
    const duel = hallDuel(tuning, config, at, hall, match.duel, at.floor > run.floor, match.duel.rng);
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    return { ...match, tick, arena: hall.arena, duelNumber, duel, nextDuelTick: null, events, run: enterHall(run, at, hall, run.path) };
  }

  let duel = step(match.duel, intents, tuning);
  let { score, status, nextDuelTick } = match;
  let next = run;
  const end = (winner: number) => {
    status = { status: 'Over', winner, tick };
    const cleared = runCleared(next);
    events.push({ type: 'RunEnd', winner, cleared: cleared.floors, floors: next.floors, halls: cleared.halls });
  };

  if (duel.duel.status === 'Over') {
    // Team 0 is wiped out (a Hall's Duel ends on nothing else): a Defeat, in any phase.
    end(1);
    return { ...match, tick, duel, nextDuelTick: null, status, events };
  }

  if (next.phase === 'Fighting' && !duel.fighters.some((f) => f.team === 1 && inDuel(f))) {
    // The Encounter has fallen (or there was none): the Hall is Cleared, and its Duel goes on.
    next = { ...next, phase: 'Cleared' };
    score = score.map((s, i) => (i === 0 ? s + 1 : s));
    events.push({ type: 'HallCleared', floor: next.floor, row: next.row, index: next.hall, kind: duel.hall!.kind });
    if (next.row === FLOOR_ROWS - 1 && next.floor === next.floors) {
      // The last Boss fell: the Run is won, and its Duel ends as a Duel's end would leave it.
      duel = { ...duel, duel: { status: 'Over', winner: 0, tick: duel.tick }, events: [...duel.events, { type: 'DuelEnd', winner: 0 }] };
      end(0);
    }
  }

  if (next.phase !== 'Fighting' && status.status === 'InProgress') {
    const arena = arenaOf(tuning, duel.arena);
    if (duel.hall!.kind === 'Rest') {
      // Each Player's Fighter standing at the fire heals once in this Hall.
      const rested = next.rested;
      const healing = runPlayers(config).filter((i) => !rested.includes(i) && inDuel(duel.fighters[i]!) && atRestFire(arena, duel.fighters[i]!));
      if (healing.length > 0) {
        const fighters = duel.fighters.map((f, i): FighterState => {
          if (!healing.includes(i)) return f;
          const hp = Math.min(f.maxHp, f.hp + tuning.dungeon.restHeal * f.maxHp);
          events.push({ type: 'Rested', fighter: i, healed: hp - f.hp });
          return { ...f, hp };
        });
        duel = { ...duel, fighters };
        next = { ...next, rested: [...rested, ...healing].sort((a, b) => a - b) };
      }
    }
    if (next.phase === 'Cleared') {
      // Each exit Door counts while every Fighter whose standing counts is in its zone; the first to doorSeconds is taken.
      const counting = doorCounters(config, duel.fighters);
      const fighters = duel.fighters;
      const doorTicks = next.doorTicks.map((t, exit) => (counting.length > 0 && counting.every((i) => inExitZone(arena, exit, fighters[i]!)) ? t + 1 : 0));
      next = { ...next, doorTicks };
      const exit = doorTicks.findIndex((t) => t >= doorTicksNeeded(tuning));
      if (exit >= 0) {
        next = { ...next, phase: 'Leaving' };
        nextDuelTick = tick + Math.max(1, secondsToTicks(tuning.dungeon.hallFadeSeconds));
        events.push({ type: 'DoorTaken', exit, to: hallBehind(tuning, config, next, exit)! });
      }
    }
  }

  if (duel.hall!.phase !== next.phase) duel = { ...duel, hall: { ...duel.hall!, phase: next.phase } };
  return { ...match, tick, score, duel, nextDuelTick, status, events, run: next };
}
