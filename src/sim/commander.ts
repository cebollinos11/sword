/**
 * The Commander (docs/plans/battle-objectives.md, Stage 2a; ADR 0021): one per Team, simulated, symmetric, and blind to Players as
 * people (they count only through the Soldiers near an Objective). Every `commander.planSeconds` it gives its Team's Squads their
 * Orders. Its memory (each Squad's Order, destination and the Tick it was given) is plain data in `SquadState`; the plan reads only the
 * state and the Tuning Data, and the Soldiers and Squads as they stood at the start of the Tick, so neither Commander thinks a step
 * ahead of the other. It sees the whole Battle.
 *
 * - **Value of an Objective** to a Team: its weight times `attack` (nobody's), `retake` (the enemy's), `garrison` (the Team's own, no
 *   enemy near) or, with enemy Soldiers within `threatRadius`, up to `defend` (the more of them, up to a Squad's worth, the nearer
 *   `defend`).
 * - **A Squad sent there** earns the value, less `falloff` for each Squad already sent (so Squads spread over the Objectives), less
 *   `distance` for each metre of the path from the Squad's anchor (the destination field's length), less `danger` for each Squad's worth
 *   of enemy Soldiers there beyond the Team's own there or already sent (the larger of the two), plus `stick` for the Objective it is already ordered to.
 * - **Greedy**: the best Squad-and-Objective pair across every free Squad is taken, again until none is free (the lower Squad, then the
 *   lower Objective, on a tie). An Order holds at least `holdSeconds` unless the Squad breaks (falls back or is wiped out): a held Squad
 *   keeps its Objective and counts as sent. There is no reserve.
 * - **Spawns**: an empty Squad is ordered to respawn at the spawn (its Base, or an Objective the Team owns that is marked a spawn and has
 *   no enemy in its circle) that is nearest the Objectives, by value.
 * Pure.
 */
import type { BattleTuning } from '../tuning';
import { fieldDistance, type BattleMap } from './destinations';
import { secondsToTicks } from './constants';
import type { CrowdFighter, CrowdState } from './crowd';
import { ATTACK, DEFEND, RESPAWN, type SquadState } from './squad';

/** A distance (m) standing for a place the field cannot reach: larger than any path, so it always loses. */
const UNREACHABLE = 1e6;

/** The Soldiers each Team has near each Objective: `circle` inside its circle and `threat` within `commander.threatRadius`, as `[team][objective]`. */
function nearby(crowd: CrowdState, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[]): { circle: number[][]; threat: number[][] } {
  const sites = map.field.objectives;
  const circle = [sites.map(() => 0), sites.map(() => 0)];
  const threat = [sites.map(() => 0), sites.map(() => 0)];
  const reach2 = battle.commander.threatRadius ** 2;
  for (let i = 0; i < crowd.x.length; i++) {
    if (!crowd.alive[i] || crowd.slot[i]! >= 0) continue;
    const t = crowd.team[i]!;
    for (let k = 0; k < sites.length; k++) {
      const d2 = (crowd.x[i]! - sites[k]!.x) ** 2 + (crowd.z[i]! - sites[k]!.z) ** 2;
      if (d2 <= reach2) threat[t]![k]!++;
      if (d2 <= sites[k]!.radius ** 2) circle[t]![k]!++;
    }
  }
  // The full Fighters in play (promoted Soldiers, whose Crowd entries are stale, and Players, who count as `objectives.playerCount` Soldiers): Players count only this way, never as people.
  for (const f of fighters) {
    const weight = f.ahead !== undefined ? battle.objectives.playerCount : 1;
    for (let k = 0; k < sites.length; k++) {
      const d2 = (f.x - sites[k]!.x) ** 2 + (f.z - sites[k]!.z) ** 2;
      if (d2 <= reach2) threat[f.team]![k]! += weight;
      if (d2 <= sites[k]!.radius ** 2) circle[f.team]![k]! += weight;
    }
  }
  return { circle, threat };
}

/**
 * The Squads with every Team's Orders re-planned on `tick` (the same object when nothing changes). Run on the Tick the plan is due
 * (`tick % planTicks === 0`) and once at deployment.
 */
export function planOrders(crowd: CrowdState, tick: number, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[] = []): SquadState {
  const old = crowd.squads;
  const m = old.team.length;
  const per = m / 2;
  const sites = map.field.objectives;
  const O = sites.length;
  const c = battle.commander;
  const hold = secondsToTicks(c.holdSeconds);
  const size = battle.squad.size;
  const { circle, threat } = nearby(crowd, battle, map, fighters);
  const order = old.order.slice();
  const target = old.target.slice();
  const since = old.since.slice();
  // The hold runs from when a Squad was sent to a place, not from a change of kind: capturing an Objective turns ATTACK into DEFEND without restarting it.
  const give = (q: number, kind: number, to: number) => {
    if (target[q] !== to || (order[q] === RESPAWN) !== (kind === RESPAWN)) since[q] = tick;
    order[q] = kind;
    target[q] = to;
  };

  for (const team of [0, 1]) {
    const foe = 1 - team;
    // What each Objective is worth to this Team now.
    const value = sites.map((site, k) => {
      const owner = crowd.objectives.owner[k]!;
      if (owner === -1) return site.weight * c.attack;
      if (owner === foe) return site.weight * c.retake;
      const pressed = Math.min(1, threat[foe]![k]! / size);
      return site.weight * (c.garrison + (c.defend - c.garrison) * pressed);
    });
    /** Squads sent to each Objective so far (the held ones first). */
    const sent = sites.map(() => 0);
    const free: number[] = [];
    const empty: number[] = [];
    for (let q = team * per; q < (team + 1) * per; q++) {
      if (old.living[q] === 0) empty.push(q);
      else if (old.fall[q]) continue;
      else if (old.order[q] !== RESPAWN && old.target[q]! < O && tick - old.since[q]! < hold) {
        sent[old.target[q]!]!++;
        // The Order holds, but its kind follows who owns the Objective now.
        give(q, crowd.objectives.owner[old.target[q]!] === team ? DEFEND : ATTACK, old.target[q]!);
      } else free.push(q);
    }

    // Greedy: the best pair across every free Squad, until none is free.
    while (free.length > 0) {
      let bestScore = -Infinity;
      let bestAt = -1;
      let bestK = -1;
      free.forEach((q, f) => {
        // Objectives in the Team's own order (reversed for Team 1), so a tie goes to the mirrored Objective for each: the half-turn mirror of the armies.
        for (let j = 0; j < O; j++) {
          const k = team === 0 ? j : O - 1 - j;
          const path = fieldDistance(map.fields, k, old.x[q]!, old.z[q]!);
          if (path < 0) continue;
          // Enemy Soldiers there beyond what the Team has there already or has on the way (a Squad standing there is in both counts).
          const outnumbered = Math.max(0, threat[foe]![k]! - Math.max(threat[team]![k]!, sent[k]! * size)) / size;
          const stays = old.order[q] !== RESPAWN && old.target[q] === k ? c.stick : 0;
          const score = value[k]! * c.falloff ** sent[k]! - c.distance * path - c.danger * outnumbered + stays;
          if (score > bestScore) [bestScore, bestAt, bestK] = [score, f, k];
        }
      });
      if (bestAt < 0) break;
      const q = free.splice(bestAt, 1)[0]!;
      sent[bestK]!++;
      give(q, crowd.objectives.owner[bestK] === team ? DEFEND : ATTACK, bestK);
    }
    // Free Squads the field cannot take anywhere wait where they stand.
    for (const q of free) give(q, RESPAWN, O + team);

    // Empty Squads respawn at the spawn nearest what the Team wants, by value.
    if (empty.length > 0) {
      const spawns: number[] = [O + team];
      sites.forEach((site, k) => {
        if (site.spawn && crowd.objectives.owner[k] === team && circle[foe]![k] === 0) spawns.push(k);
      });
      let best = O + team;
      let bestCost = Infinity;
      for (const s of spawns) {
        const at = s < O ? sites[s]! : map.field.bases[s - O]!;
        let cost = 0;
        let total = 0;
        for (let k = 0; k < O; k++) {
          const path = fieldDistance(map.fields, k, at.x, at.z);
          cost += value[k]! * (path < 0 ? UNREACHABLE : path);
          total += value[k]!;
        }
        cost /= total || 1;
        if (cost < bestCost) [best, bestCost] = [s, cost];
      }
      for (const q of empty) give(q, RESPAWN, best);
    }
  }
  const changed = order.some((v, q) => v !== old.order[q]) || target.some((v, q) => v !== old.target[q]) || since.some((v, q) => v !== old.since[q]);
  return changed ? { ...old, order, target, since } : old;
}
