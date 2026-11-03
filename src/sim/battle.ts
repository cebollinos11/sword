/**
 * The Battle Format (docs/plans/big-battle.md): two armies of Soldiers on a Battlefield (`battle:<seed>`), ending in a
 * Rout. Its Fighters are a fixed Fighter Pool: the Players' (none for an AI-vs-AI war), at their Team's spawn behind its
 * army, then slots the Bubbles bind to Soldiers near them (`stepBubbles`). Each Tick: the Bubbles, the Fighters, then
 * the Crowd, which keeps out of the full Fighters' reach and never fights them.
 */
import type { TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { stepBubbles } from './bubble';
import { crowdAlive, stepCrowd, type BattlePlayer, type CrowdFighter, type CrowdState } from './crowd';
import { inDuel } from './duel';
import type { Intent } from './intent';
import type { MatchEvent, MatchState } from './match';
import type { SimEvent } from './events';
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

/** Less than this (m) moved over a Tick is standing, to the Crowd (`CrowdFighter`). */
const TRAVEL_EPSILON = 1e-4;

/** Ticks a routed Team flees before the Battle ends (`battle.rout.seconds`, at least 1). */
export const routTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.battle.rout.seconds));

/**
 * The Players' records with this Tick's kills counted: a Fighter that fell to a Hit, Kick or Throwing Dagger of a Player's
 * Fighter (one of the first `players` slots) on another Team is that Player's kill, while it plays (not once it has left).
 */
function countKills(records: readonly BattlePlayer[], events: readonly SimEvent[], teams: readonly number[], players: number): readonly BattlePlayer[] {
  let out: BattlePlayer[] | null = null;
  for (const e of events) {
    if (e.type !== 'Death') continue;
    let by = -1;
    for (const b of events) {
      if ((b.type === 'Hit' || b.type === 'KickLanded') && b.defender === e.fighter) by = b.attacker;
      else if (b.type === 'DaggerHit' && b.defender === e.fighter) by = b.thrower;
    }
    if (by < 0 || by >= players || teams[by] === teams[e.fighter] || !records[by] || records[by]!.away) continue;
    out ??= records.slice();
    out[by] = { ...out[by]!, kills: out[by]!.kills + 1 };
  }
  return out ?? records;
}

/**
 * One Tick of a Battle in progress (the Battle branch of `stepMatch`): the Bubbles promote and demote (`stepBubbles`, the
 * Players' Fighters being the Match's `teams`), the Fighters' Duel is stepped (it carries the Crowd through), then the
 * Crowd; a new Rout is reported, and `routTicks` after it the Battle is over, won by the other Team (the Duel ends with
 * it, as a Run's last Boss ends its Hall's).
 */
export function stepBattle(match: MatchState, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const events: MatchEvent[] = [];
  const players = match.config.teams.length;
  const bubbled = stepBubbles(match.duel, players, match.duel.tick + 1, tuning);
  let duel = step(bubbled, intents, tuning);
  const before = duel.crowd!;
  // Each full Fighter's way of travel over this Tick (the same Fighter: the Bubbles stepped before it), and each Player's ring ahead (none for one who left).
  const fighters: CrowdFighter[] = duel.fighters.flatMap((f, k) => {
    if (!inDuel(f)) return [];
    const was = bubbled.fighters[k]!.position;
    const ox = f.position.x - was.x;
    const oz = f.position.z - was.z;
    const d = Math.hypot(ox, oz);
    const moving = d > TRAVEL_EPSILON;
    const dx = moving ? ox / d : 0;
    const dz = moving ? oz / d : 0;
    return [{ x: f.position.x, z: f.position.z, team: f.team, dx, dz, ...(k < players && !before.players[k]?.away ? { ahead: moving ? Math.atan2(dx, dz) : f.facing } : {}) }];
  });
  const stepped: CrowdState = stepCrowd(before, duel.tick, tuning.battle, fighters);
  const tally = countKills(stepped.players, duel.events, duel.fighters.map((f) => f.team), players);
  const crowd = tally === stepped.players ? stepped : { ...stepped, players: tally };
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
