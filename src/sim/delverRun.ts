/**
 * A Delver Run (docs/plans/delver.md, Stage 2): the Gauntlet Format's Run on generated Floors, one Duel a Floor. Team 0 spawns at the
 * Floor's Entrance and the Floor is `floorArenaName(runSeed(config.arena), floor)`, built from that name alone (`floorOf`), so every peer
 * deals the same Floor with nothing sent. `floorDuel` makes a Floor's Duel (Team 0's HP, Inventory and Mods carried, the fallen revived,
 * Team 1's slots Benched), `enterFloor` the Run's state on it, and `stepDelver` steps it: the fade to the next Floor, the Duel under the
 * Floor's Tuning Data (`arenaTuning`), and a wipe of Team 0, a Defeat. This file imports `match.ts` for types only.
 */
import type { TuningData } from '../tuning';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import type { FloorPlan } from './delver/plan';
import { runSeed } from './dungeon';
import { inDuel } from './duel';
import { runPlayers } from './hall';
import { holdInventory, startingInventory, withStartingRelics, wieldedWeapon } from './inventory';
import type { Intent } from './intent';
import type { MatchConfig, MatchEvent, MatchState } from './match';
import { NO_MODS, setMods } from './mods';
import type { Pickup } from './pickups';
import type { Placement } from './skeleton';
import type { SimDelver, DelverPhase, SimState } from './state';
import { createInitialState, step } from './step';

/** One fire of the current Floor (`plan.markers.fires` order): whether its revive is spent, and which Players took its heal. */
export interface RestUse {
  readonly revived: boolean;
  /** Fighter indices, ascending. */
  readonly healed: readonly number[];
}

/** A Delver Run's progress (`MatchState.delver`, docs/plans/delver.md). Becomes `RunState` in Stage 8. */
export interface DelverRun {
  /** The Floor (1-based). */
  readonly floor: number;
  /** `delver.tiers × delver.floorsPerTier`, fixed at the start. */
  readonly floors: number;
  readonly phase: DelverPhase;
  /** Ticks in a row every counted Fighter stood in the Stairs zone; 0 when one is out; kept while Descending. */
  readonly stairsTicks: number;
  /** One per fire of the Floor. */
  readonly restUsed: readonly RestUse[];
  /** The items lying on the Floor (inventory drops; Stage 4 adds loot); empty again on each new Floor. */
  readonly pickups: readonly Pickup[];
  /** The Match Tick the Run started on. */
  readonly startTick: number;
  /** The Players an AI Takeover has taken (ascending), as `RunState.away`; absent while nobody has left. Mirrored on `SimDelver.away`. */
  readonly away?: readonly number[];
}

/** The facing (radians; 0 faces +z) into a Passage on each side of a Hall, in the order the Entrance's first doorway is looked for. */
const SIDE_FACING = [
  ['n', 0],
  ['e', Math.PI / 2],
  ['s', Math.PI],
  ['w', -Math.PI / 2],
] as const;

/** The facing of the Floor's Entrance Hall's first doorway (n, e, s, w): the way Team 0 looks as the Floor starts. */
function entranceFacing(plan: FloorPlan): number {
  const { doors } = plan.halls[plan.entrance]!;
  for (const [side, facing] of SIDE_FACING) if ((doors[side] ?? 0) > 0) return facing;
  return 0;
}

/**
 * A Delver Run's Duel on Floor `floor`: Team 0's k-th Fighter at the Entrance's k-th spawn, facing into its Passage, and Team 1's four slots Benched
 * at the Stairs zone's centre (Stage 3 fills them). Team 0 keeps its HP, Inventory and Mods from `previous` (the Floor before; null for the first:
 * full HP, a Player holding `startingInventory` and the dev `relics`), a fallen Fighter back at `dungeon.revive` of its max HP: taking the Stairs
 * revives the fallen, and nobody is healed. Pure.
 */
export function floorDuel(tuning: TuningData, config: MatchConfig, floor: number, previous: SimState | null, rng: SimState['rng'], relics: readonly string[] = []): SimState {
  const arena = floorArenaName(runSeed(config.arena), floor);
  const t = arenaTuning(tuning, arena);
  const { plan } = floorOf(tuning, arena)!;
  const { spawns } = plan.markers;
  const { zone } = plan.markers.stairs;
  const centre = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
  const facing = entranceFacing(plan);
  let rank = 0;
  const placements = config.teams.map((team): Placement => {
    if (team !== 0) return { position: centre, y: 0, facing: 0 };
    const spawn = spawns[rank++]!;
    return { position: { x: spawn.x, z: spawn.z }, y: 0, facing };
  });
  const players = runPlayers(config);
  const inventories = config.teams.map((team, i) => {
    if (team !== 0) return undefined;
    const held = previous?.fighters[i]?.inventory;
    return held ?? (players.includes(i) ? withStartingRelics(startingInventory(config.weapons[i]!), relics, tuning) : undefined);
  });
  const weapons = config.weapons.map((w, i) => (inventories[i] ? wieldedWeapon(inventories[i]!) : w));
  const base = createInitialState(t, 0, placements, weapons, config.teams, arena, config.sizes);
  const { revive } = tuning.dungeon;
  const fighters = base.fighters.map((f, i) => {
    if (f.team === 1) return { ...f, hp: 0, benched: true as const };
    const before = previous?.fighters[i];
    const inventory = inventories[i];
    const armed = inventory ? holdInventory(f, inventory, tuning) : setMods(f, NO_MODS, tuning.fighter.maxHp);
    if (!before) return { ...armed, hp: armed.maxHp };
    return { ...armed, hp: inDuel(before) ? Math.min(armed.maxHp, before.hp) : revive * armed.maxHp };
  });
  const away = previous?.delver?.away;
  return { ...base, rng, fighters, delver: { floor, phase: 'Exploring', ...(away === undefined ? {} : { away }) } };
}

/** The Run on entering Floor `floor` (`plan` its plan): Exploring, nothing counted, one unspent fire per fire of the Floor, no pickups. */
export function enterFloor(run: Pick<DelverRun, 'floors' | 'startTick' | 'away'>, floor: number, plan: FloorPlan): DelverRun {
  return {
    floor,
    floors: run.floors,
    phase: 'Exploring',
    stairsTicks: 0,
    restUsed: plan.markers.fires.map(() => ({ revived: false, healed: [] })),
    pickups: [],
    startTick: run.startTick,
    ...(run.away === undefined ? {} : { away: run.away }),
  };
}

/** The Run mirrored for the Controllers (`SimState.delver`). */
function mirrored(run: DelverRun): SimDelver {
  return { floor: run.floor, phase: run.phase, ...(run.away === undefined ? {} : { away: run.away }) };
}

/**
 * One Tick of a Delver Run in progress (the Delver branch of `stepMatch`): once the fade is over, the next Floor's Duel; else the Floor's Duel
 * stepped under the Floor's Tuning Data, and a wipe of Team 0 is a Defeat in any phase.
 */
export function stepDelver(match: MatchState, run: DelverRun, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const { config } = match;
  const events: MatchEvent[] = [];

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    // The fade is over: the next Floor (its Arena warmed ahead by the game, so this Tick only reads it).
    const floor = run.floor + 1;
    const duel = floorDuel(tuning, config, floor, match.duel, match.duel.rng);
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    return { ...match, tick, arena: duel.arena, duelNumber, duel, nextDuelTick: null, events, delver: enterFloor(run, floor, floorOf(tuning, duel.arena)!.plan) };
  }

  let duel = step(match.duel, intents, arenaTuning(tuning, match.duel.arena));
  const { score, nextDuelTick } = match;
  const next = run;

  if (duel.duel.status === 'Over') {
    // Team 0 is wiped out (a Floor's Duel ends on nothing else): a Defeat, in any phase.
    events.push({ type: 'RunEnd', winner: 1, cleared: run.floor - 1, floors: run.floors, halls: 0 });
    return { ...match, tick, duel, nextDuelTick: null, status: { status: 'Over', winner: 1, tick }, events };
  }

  // The Exploring rules (Inventory at a fire, the fires' revive and heal, the Stairs) go here (Stage 2, task 2): while `next.phase` is 'Exploring'.

  // The Controllers see the Floor's phase and who has left.
  const view = mirrored(next);
  if (duel.delver?.phase !== view.phase || duel.delver?.away !== view.away) duel = { ...duel, delver: view };
  return { ...match, tick, score, duel, nextDuelTick, events, delver: next };
}

