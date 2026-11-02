/**
 * The Battle Format (docs/plans/big-battle.md, Stage 1): two armies of Soldiers on a Battlefield (`battle:<seed>`),
 * the Crowd stepped after the Fighters each Tick, ending in a Rout. The Match's Fighters (the Players', none for an
 * AI-vs-AI war) stand at their Team's spawn behind its army; in this Stage the Crowd ignores them and they it.
 */
import type { TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { crowdAlive, stepCrowd } from './crowd';
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
 * One Tick of a Battle in progress (the Battle branch of `stepMatch`): the Fighters' Duel stepped (it carries the Crowd
 * through), then the Crowd; a new Rout is reported, and `routTicks` after it the Battle is over, won by the other Team
 * (the Duel ends with it, as a Run's last Boss ends its Hall's).
 */
export function stepBattle(match: MatchState, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const events: MatchEvent[] = [];
  let duel = step(match.duel, intents, tuning);
  const before = duel.crowd!;
  const crowd = stepCrowd(before, duel.tick, tuning.battle);
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
