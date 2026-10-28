/**
 * A Dungeon Run's Halls as the Simulation plays them (docs/plans/dungeon.md): who stands in each Team 1 slot of a Hall
 * (`hallRoster`), where its exit Doors' zones and a Rest Hall's fire are, and whose standing counts at a Door. Pure
 * functions of Tuning Data, the Run's config and the Hall, so every peer agrees with nothing sent.
 */
import { MAX_ENCOUNTER_ENEMIES, RANDOM_PICK, type ArenaGeometry, type ArenaPoint, type TuningData } from '../tuning';
import { insideZone } from './arena';
import { parseGeneratedName } from './arenaGen/named';
import { FLOOR_ROWS, floorGraph, hallEncounter, hallSlot, runPick, runSeed, type Hall } from './dungeon';
import { inDuel } from './duel';
import type { MatchConfig } from './match';
import type { FighterState } from './state';

/** A Hall of a Dungeon: its Floor (1-based), its row (0 the entrance, 4 the Boss) and its index in the row. */
export interface HallRef {
  readonly floor: number;
  readonly row: number;
  readonly index: number;
}

/** One enemy of a Hall, resolved: its `"random"` picks made and its max HP scaled. */
export interface HallEnemy {
  readonly difficulty: string;
  readonly weapon: string;
  /** A Body name, `"random"` when no Bodies were given to pick from, or absent (the usual random Body). Render-only. */
  readonly body?: string;
  /** Its AI Style (Tuning Data `ai.styles`), or absent (the default Style). The Simulation never reads it. */
  readonly style?: string;
  readonly maxHp: number;
}

/** `runPick` salts of an enemy's `"random"` picks (apart from the Floor graph's own, `src/sim/dungeon.ts`). */
const PICK_SALT = { weapon: 40, body: 41, style: 42 } as const;

/** A Hall's identity as one string (`floor:row:index`), e.g. to tell when a Controller's Hall changed. */
export const hallKey = (h: HallRef): string => `${h.floor}:${h.row}:${h.index}`;

/** The Kit a Run's Hall Arenas are built from: its first Arena's (a Random Map), else Tuning Data's first Kit. */
export function runKit(tuning: Pick<TuningData, 'kits'>, arena: string): string {
  return parseGeneratedName(arena)?.kit ?? Object.keys(tuning.kits)[0]!;
}

/** Hall `at` of the Run whose first Arena is `arena` (its seed the Run seed), as `floorGraph` builds it. Throws on a Hall the Dungeon lacks. */
export function hallOf(tuning: TuningData, arena: string, at: HallRef): Hall {
  const hall = floorGraph(tuning.dungeon, runSeed(arena), at.floor, runKit(tuning, arena))[at.row]?.[at.index];
  if (!hall) throw new RangeError(`Floor ${at.floor} has no Hall ${at.index} in row ${at.row}`);
  return hall;
}

/**
 * Where a dev-mode Run starts (`MatchOptions.start`, docs/plans/dungeon.md): a Floor (1-based) and a row (0-based, as
 * HallRef), and the Hall's index in the row, or absent for the Hall the lowest-index exits lead to.
 */
export interface RunStart {
  readonly floor: number;
  readonly row: number;
  readonly index?: number;
}

/**
 * The Halls a Run walks from its first to `start`, both included: each Floor before `start`'s through every row's
 * lowest-index exit (a Boss's leads to the next Floor's entrance), then within `start`'s Floor the route that takes the
 * lowest-index exit it can and still reaches the Hall asked for. Throws on a Hall the Dungeon lacks.
 */
export function runPathTo(tuning: TuningData, arena: string, start: RunStart): HallRef[] {
  const { floor, row, index } = start;
  const floors = tuning.dungeon.floors.length;
  if (!Number.isInteger(floor) || floor < 1 || floor > floors) throw new RangeError(`A Run's Floors are 1 to ${floors}, got ${floor}`);
  if (!Number.isInteger(row) || row < 0 || row >= FLOOR_ROWS) throw new RangeError(`A Floor's rows are 0 to ${FLOOR_ROWS - 1}, got ${row}`);
  const graph = (f: number) => floorGraph(tuning.dungeon, runSeed(arena), f, runKit(tuning, arena));
  const path: HallRef[] = [];
  for (let f = 1; f < floor; f++) {
    const g = graph(f);
    for (let r = 0, i = 0; r < FLOOR_ROWS; i = g[r]![i]!.exits[0] ?? 0, r++) path.push({ floor: f, row: r, index: i });
  }
  const g = graph(floor);
  const route = (r: number, i: number): number[] | null => {
    if (r === row) return index === undefined || i === index ? [i] : null;
    for (const j of g[r]![i]!.exits) {
      const rest = route(r + 1, j);
      if (rest) return [i, ...rest];
    }
    return null;
  };
  const found = route(0, 0);
  if (!found) throw new RangeError(`Floor ${floor} has no Hall ${index} in row ${row}`);
  return [...path, ...found.map((i, r) => ({ floor, row: r, index: i }))];
}

/**
 * An enemy's max HP: `fighter.maxHp × hpScale × (1 + perPlayerHp × (humans − 1)) × (1 + depthHp × row)`, `row` 0-based
 * (the entrance unscaled, the Boss's row 4 the most): the plan's `depthHp × (row − 1)` with rows counted from 1.
 */
export function enemyMaxHp(tuning: TuningData, hpScale: number, humans: number, row: number): number {
  const { perPlayerHp, depthHp } = tuning.dungeon;
  return tuning.fighter.maxHp * hpScale * (1 + perPlayerHp * (humans - 1)) * (1 + depthHp * row);
}

/**
 * Hall `at`'s enemy for each Team 1 slot, in slot order (MAX_ENCOUNTER_ENEMIES of them), from its Encounter (`hallEncounter`),
 * or null for a slot it leaves empty (Benched; every slot of a Treasure or Rest Hall). A `"random"` Weapon is picked from the
 * roster, a `"random"` Style from `ai.styles`, and a `"random"` Body from `bodies` when given, by `runPick` on the Run seed
 * (`config.arena`, the Run's first Arena), the Hall and the slot. An enemy with a `minTeam` larger than Team 0
 * (`config.teams`; absent: as large as it gets) leaves its slot empty. Throws on a Hall the Dungeon lacks.
 */
export function hallRoster(
  tuning: TuningData,
  config: Pick<MatchConfig, 'arena' | 'humans'> & Partial<Pick<MatchConfig, 'teams'>>,
  at: HallRef,
  bodies?: readonly string[],
): (HallEnemy | null)[] {
  const seed = runSeed(config.arena);
  const encounter = hallEncounter(tuning.dungeon, seed, at.floor, at.row, at.index);
  const weapons = Object.keys(tuning.weapons);
  const styles = Object.keys(tuning.ai.styles);
  const own = config.teams ? config.teams.filter((t) => t === 0).length : MAX_ENCOUNTER_ENEMIES;
  return Array.from({ length: MAX_ENCOUNTER_ENEMIES }, (_, k) => {
    const e = encounter?.enemies[k];
    if (!e || (e.minTeam ?? 0) > own) return null;
    const slot = hallSlot(at.row, at.index) * MAX_ENCOUNTER_ENEMIES + k;
    const weapon = e.weapon === RANDOM_PICK ? weapons[runPick(seed, at.floor, slot, PICK_SALT.weapon, weapons.length)]! : e.weapon;
    const body = e.body === RANDOM_PICK && bodies && bodies.length > 0 ? bodies[runPick(seed, at.floor, slot, PICK_SALT.body, bodies.length)]! : e.body;
    const style = e.style === RANDOM_PICK ? styles[runPick(seed, at.floor, slot, PICK_SALT.style, styles.length)]! : e.style;
    return {
      difficulty: e.difficulty,
      weapon,
      ...(body === undefined ? {} : { body }),
      ...(style === undefined ? {} : { style }),
      maxHp: enemyMaxHp(tuning, e.hpScale, config.humans, at.row),
    };
  });
}

/**
 * The Fighters the human Players drive in a Run (`config.players`; absent, as for a Match made before it existed: the
 * first `humans` Fighters of Team 0). Only they count at a Door and take a Rest Hall's fire; AI allies never do.
 */
export function runPlayers(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>): readonly number[] {
  return config.players ?? config.teams.flatMap((t, i) => (t === 0 ? [i] : [])).slice(0, config.humans);
}

/**
 * The Fighters whose standing decides a Door: every living Player's (a fallen Player need not stand there), and only
 * when no Player lives, the living AI allies (else a party of AI allies could never leave a Hall).
 */
export function doorCounters(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, fighters: readonly FighterState[]): number[] {
  const players = runPlayers(config).filter((i) => fighters[i] && inDuel(fighters[i]));
  if (players.length > 0) return players;
  return fighters.flatMap((f, i) => (f.team === 0 && inDuel(f) ? [i] : []));
}

/** How far above a zone's ground (m) a Fighter still stands in it: a hop inside the zone does not step out of it. */
export const ZONE_HEIGHT = 2;

/** Whether a Fighter at (position, y) stands in `zone` (a convex polygon on the ground): inside it from above, within ZONE_HEIGHT over it. */
function standsIn(zone: readonly ArenaPoint[], f: Pick<FighterState, 'position' | 'y'>): boolean {
  const ground = zone[0]?.y ?? 0;
  return f.y > ground - 0.5 && f.y < ground + ZONE_HEIGHT && insideZone(zone, f.position.x, f.position.z);
}

/** The Arena Door of a Hall's exit `exit` (0-based, as `Hall.exits`): exit k is Door k + 1, Door 0 being the entrance. */
export const exitDoor = (exit: number): number => exit + 1;

/** Whether the Fighter stands in the zone of the Hall Arena's exit `exit` (0-based); false for an exit the Arena lacks. */
export function inExitZone(arena: ArenaGeometry, exit: number, f: Pick<FighterState, 'position' | 'y'>): boolean {
  const door = arena.doors[exitDoor(exit)];
  return door !== undefined && standsIn(door.zone, f);
}

/** How far (m, across the ground) from a Rest Hall's fire a Fighter takes it. */
export const REST_FIRE_RADIUS = 1.5;

/**
 * Where a Rest Hall's fire burns: at the middle of its Arena's Team 1 spawns (which a Rest Hall leaves empty), on the
 * ground of the first. The judge (ADR 0014) checks every Door reaches those spawns by walking, with no deadly ground
 * near them, which the Arena's own centre (a pillar top, a pit) does not promise.
 */
export function restFire(arena: ArenaGeometry): ArenaPoint {
  const spawns = arena.spawns.filter((s) => s.team === 1);
  if (spawns.length === 0) return { x: 0, y: 0, z: 0 };
  const mean = (k: 'x' | 'z') => spawns.reduce((sum, s) => sum + s.position[k], 0) / spawns.length;
  return { x: mean('x'), y: spawns[0]!.position.y, z: mean('z') };
}

/** Whether the Fighter stands at the Rest Hall Arena's fire: within REST_FIRE_RADIUS across the ground, within ZONE_HEIGHT over it. */
export function atRestFire(arena: ArenaGeometry, f: Pick<FighterState, 'position' | 'y'>): boolean {
  const fire = restFire(arena);
  return f.y > fire.y - 0.5 && f.y < fire.y + ZONE_HEIGHT && Math.hypot(f.position.x - fire.x, f.position.z - fire.z) <= REST_FIRE_RADIUS;
}
