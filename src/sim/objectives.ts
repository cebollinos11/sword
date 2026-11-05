/**
 * Objectives and Tickets (docs/plans/battle-objectives.md, Stage 2a; ADR 0021): what a Battle's armies fight over. The map places the
 * Objectives (`Battlefield.objectives`, static); what changes lives in `CrowdState.objectives` and `CrowdState.tickets`, plain data,
 * hashed, snapshotted and rolled back with the Crowd.
 *
 * - **Capture**: an Objective is a circle with a progress from -1 (Team 1's) to +1 (Team 0's). Every `objectives.captureSeconds` the
 *   living Soldiers and full Fighters of each Team inside it are counted (a Player's Fighter counts `objectives.playerCount`), and
 *   the progress moves toward the Team with more inside, `objectives.rate` for each more, at most `objectives.maxRate`, a second.
 *   At ±1 the Objective is owned by that Team. While both Teams are inside, the Owner keeps it until outnumbered: the Owner changes
 *   only when the progress crosses 0 against it (the Objective goes unowned) or reaches the other Team's end.
 * - **Tickets**: each Team starts with `tickets.perSoldier` for each Soldier of its army. A death of a Soldier or Fighter costs 1.
 *   Every second a Team that owns more Objectives than the enemy drains the enemy by `tickets.drain` for each Objective more, so it
 *   is linear: owning all of them gives no bonus. A Team with none left no longer respawns Squads, and routs as before once its
 *   living Soldiers fall below `rout.threshold`.
 * - **The limit**: at `tickets.limitSeconds` the Team with more Tickets wins, on a tie the one that owns more Objectives, then the
 *   Crowd's own generator flips a coin. The loser routs, so the Battle ends as it always did.
 * Pure.
 */
import type { BattleTuning } from '../tuning';
import { TICK_RATE, secondsToTicks } from './constants';
import type { MapObjective } from './battlefield';

/** The Objectives' state, entry k being map Objective k. */
export interface ObjectiveState {
  /** -1 (Team 1's end) to +1 (Team 0's end). */
  readonly progress: readonly number[];
  /** The Owner: -1 for none, else a Team. */
  readonly owner: readonly number[];
}

/** The Objectives at the start of a Battle: each Home Objective at its Owner's end, the others at 0. */
export function createObjectives(objectives: readonly MapObjective[]): ObjectiveState {
  return {
    progress: objectives.map((o) => (o.owner === 0 ? 1 : o.owner === 1 ? -1 : 0)),
    owner: objectives.map((o) => o.owner),
  };
}

/** Ticks between capture steps. */
export const captureTicks = (battle: BattleTuning): number => Math.max(1, secondsToTicks(battle.objectives.captureSeconds));

/** Ticks between a Commander's plans. */
export const planTicks = (battle: BattleTuning): number => Math.max(1, secondsToTicks(battle.commander.planSeconds));

/** The Battle's limit, in Ticks. */
export const limitTicks = (battle: BattleTuning): number => secondsToTicks(battle.tickets.limitSeconds);

/** Ticks between a respawn being due and the Squad that was wiped out. */
export const respawnTicks = (battle: BattleTuning): number => secondsToTicks(battle.tickets.respawnSeconds);

/** How many Objectives Team `team` owns. */
export function owned(objectives: ObjectiveState, team: number): number {
  let n = 0;
  for (const o of objectives.owner) if (o === team) n++;
  return n;
}

/**
 * The Objectives one capture step on. `inside[team][k]`: the Soldiers (and Fighters, a Player's counting more) of `team` inside
 * Objective k. Returns the same object when nothing changed.
 */
export function stepObjectives(state: ObjectiveState, inside: readonly [readonly number[], readonly number[]], battle: BattleTuning): ObjectiveState {
  const dt = captureTicks(battle) / TICK_RATE;
  const { rate, maxRate } = battle.objectives;
  let progress: number[] | null = null;
  let owner: number[] | null = null;
  for (let k = 0; k < state.progress.length; k++) {
    const diff = inside[0][k]! - inside[1][k]!;
    if (diff === 0) continue;
    const p = Math.max(-1, Math.min(1, state.progress[k]! + Math.sign(diff) * Math.min(maxRate, rate * Math.abs(diff)) * dt));
    let o = state.owner[k]!;
    if (p >= 1) o = 0;
    else if (p <= -1) o = 1;
    else if ((o === 0 && p <= 0) || (o === 1 && p >= 0)) o = -1;
    if (p === state.progress[k] && o === state.owner[k]) continue;
    progress ??= state.progress.slice();
    owner ??= state.owner.slice();
    progress[k] = p;
    owner[k] = o;
  }
  return progress ? { progress, owner: owner! } : state;
}

/** The Tickets after one second's drain: each Team loses `tickets.drain` for each Objective the other owns more of (never below 0). */
export function drainTickets(tickets: readonly number[], objectives: ObjectiveState, battle: BattleTuning): readonly number[] {
  const a = owned(objectives, 0);
  const b = owned(objectives, 1);
  if (a === b) return tickets;
  const { drain } = battle.tickets;
  return [Math.max(0, tickets[0]! - (b > a ? (b - a) * drain : 0)), Math.max(0, tickets[1]! - (a > b ? (a - b) * drain : 0))];
}

/** Whether the second ends on `tick`: the Tickets drain then. */
export const drainDue = (tick: number): boolean => tick % TICK_RATE === 0;

/** Which Team loses at the limit: fewer Tickets, then fewer Objectives; on a tie, `coin` (a draw from 0 to 1) picks (below a half, Team 0). */
export function limitLoser(tickets: readonly number[], objectives: ObjectiveState, coin: () => number): number {
  if (tickets[0] !== tickets[1]) return tickets[0]! < tickets[1]! ? 0 : 1;
  const a = owned(objectives, 0);
  const b = owned(objectives, 1);
  if (a !== b) return a < b ? 0 : 1;
  return coin() < 0.5 ? 0 : 1;
}
