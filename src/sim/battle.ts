/**
 * The Battle Format (docs/plans/big-battle.md): two armies of Soldiers on a Battlefield (`battle:<seed>`), ending in a
 * Rout. Its Fighters are a fixed Fighter Pool: the Players' (none for an AI-vs-AI war), at their Team's spawn behind its
 * army, then slots the Bubbles bind to Soldiers near them (`stepBubbles`). Each Tick: the Bubbles, the Fighters, then
 * the Crowd, which keeps out of the full Fighters' reach and never fights them.
 */
import type { TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { stepBubbles } from './bubble';
import { crowdAlive, stepCrowd, type CrowdFighter } from './crowd';
import { inDuel } from './duel';
import type { Intent } from './intent';
import type { MatchEvent, MatchState } from './match';
import { step } from './step';

/** A Team routed: its Soldiers fell below `battle.rout.threshold` of the army and flee toward their edge. */
export interface RoutEvent {
  readonly type: 'Rout';
  readonly team: number;
}

/** A Battle ended, `battle.rout.seconds` after a Rout: `winner` is the Team that did not rout; `alive` each Team's living Soldiers. */
export interface BattleEndEvent {
  readonly type: 'BattleEnd';
  readonly winner: number;
  readonly alive: readonly number[];
}

/** Ticks a routed Team flees before the Battle ends (`battle.rout.seconds`, at least 1). */
export const routTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.battle.rout.seconds));

/**
 * One Tick of a Battle in progress (the Battle branch of `stepMatch`): the Bubbles promote and demote (`stepBubbles`, the
 * Players' Fighters being the Match's `teams`), the Fighters' Duel is stepped (it carries the Crowd through), then the
 * Crowd; a new Rout is reported, and `routTicks` after it the Battle is over, won by the other Team (the Duel ends with
 * it, as a Run's last Boss ends its Hall's).
 */
export function stepBattle(match: MatchState, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const events: MatchEvent[] = [];
  let duel = step(stepBubbles(match.duel, match.config.teams.length, match.duel.tick + 1, tuning), intents, tuning);
  const before = duel.crowd!;
  const fighters: CrowdFighter[] = duel.fighters.flatMap((f) => (inDuel(f) ? [{ x: f.position.x, z: f.position.z, team: f.team }] : []));
  const crowd = stepCrowd(before, duel.tick, tuning.battle, fighters);
  duel = { ...duel, crowd };
  if (!before.rout && crowd.rout) events.push({ type: 'Rout', team: crowd.rout.team });
  let { status, score } = match;
  if (crowd.rout && duel.tick >= crowd.rout.tick + routTicks(tuning)) {
    const winner = 1 - crowd.rout.team;
    status = { status: 'Over', winner, tick };
    score = score.map((s, i) => (i === winner ? s + 1 : s));
    events.push({ type: 'BattleEnd', winner, alive: crowdAlive(crowd) });
    if (duel.duel.status === 'Fighting') duel = { ...duel, duel: { status: 'Over', winner, tick: duel.tick }, events: [...duel.events, { type: 'DuelEnd', winner }] };
  }
  return { ...match, tick, score, duel, status, events };
}
