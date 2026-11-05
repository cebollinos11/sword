/**
 * docs/plans/big-battle.md, Stage 6: several Players' Bubbles share one Fighter Pool, each holding fewer slots while more are in use
 * (`battle.slots.shared`), and a Player who left (an AI Takeover, `takeOverFighter`) has no Bubble: its Fighter fights on as an ally.
 */
import { describe, expect, it } from 'vitest';
import { bubbleSlots, loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { bubblePlayer, createMatch, inDuel, stepBubbles, stepMatch, takeOverFighter, TICK_SECONDS, type MatchState, type SimState } from '.';

const tuning = loadTuningData();
/** Two armies of 80 close together, so the Bubbles soon fill. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 80, deploy: { ...tuning.battle.deploy, front: 10, perRank: 20 } } };
const lineupOf = (teams: readonly number[]): Lineup => teams.map((team, player) => ({ team, pilot: { kind: 'Player', player: player as 0 | 1 | 2 | 3 } }));

/** A Battle of `teams` Players on Battle autopilots (Hard), a Pool AI on every other slot. */
function battle(teams: readonly number[], seed = 3) {
  const lineup = lineupOf(teams);
  const options = { format: 'Battle', bestOf: 1, seed } as const;
  const pilots: Controller[] = teams.map(() => createBattlePilot(small, 'Hard'));
  const controllers = lineupAis(small, lineup, 'Battle', options).map((ai, k) => ai ?? pilots[k]!);
  const match = createMatch(small, lineupMatch(small, lineup, teams.map(() => 'Longsword'), options));
  return { match, step: (m: MatchState) => stepMatch(m, controllers.map((c, k) => c.intent(m.duel, k)), small) };
}

/** Each Bubble's promoted Fighters by role, as the Bubbles' step counts them: an enemy in its nearest enemy Player's Bubble, an ally in its nearest Team-mate's. */
function perBubble(duel: SimState, players: number, tick: number): { team: number; attack: number; ally: number; stuck: number }[] {
  const centres = duel.fighters.slice(0, players).flatMap((f, k) => (inDuel(f) && !duel.crowd!.players[k]!.away ? [{ x: f.position.x, z: f.position.z, team: f.team }] : []));
  const out = centres.map((c) => ({ team: c.team, attack: 0, ally: 0, stuck: 0 }));
  const minTicks = Math.round(small.battle.bubble.minPromotedSeconds / TICK_SECONDS);
  for (const f of duel.fighters) {
    if (!f.soldier || !inDuel(f) || f.soldier.role === 'Waiting') continue;
    const ally = f.soldier.role === 'Ally';
    let best = -1;
    let bestD = Infinity;
    centres.forEach((c, i) => {
      const d = Math.hypot(c.x - f.position.x, c.z - f.position.z);
      if ((c.team === f.team) === ally && d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) continue;
    out[best]![ally ? 'ally' : 'attack']++;
    // An ally that may not demote yet: mid-Action, in the air, or just promoted.
    if (ally && (f.action.kind !== 'Idle' || f.air || tick - f.soldier.since < minTicks)) out[best]!.stuck++;
  }
  return out;
}

describe('Several Bubbles share the Fighter Pool (Stage 6)', () => {
  it('four Bubbles in use each hold the shared slots, never more, and the Pool never overflows', () => {
    const players = 4;
    const b = battle([0, 1, 0, 1]);
    let m = b.match;
    const most = new Map<number, { attack: number; ally: number }>();
    let fullTicks = 0;
    for (let t = 0; t < 1500 && m.status.status === 'InProgress'; t++) {
      // The Bubbles' step, as `stepMatch` begins this Tick with it.
      const bubbled = stepBubbles(m.duel, players, m.duel.tick + 1, small);
      const counts = perBubble(bubbled, players, m.duel.tick + 1);
      const cap = bubbleSlots(small.battle.slots, counts.length);
      for (const c of counts) {
        expect(c.attack, `Tick ${m.tick}, ${counts.length} Bubbles`).toBeLessThanOrEqual(cap.enemies);
        // Allies past the share demote as soon as they may: only those that may not yet are left over.
        expect(c.ally, `Tick ${m.tick}, ${counts.length} Bubbles`).toBeLessThanOrEqual(cap.allies + c.stuck);
      }
      const seen = most.get(counts.length) ?? { attack: 0, ally: 0 };
      most.set(counts.length, { attack: Math.max(seen.attack, ...counts.map((c) => c.attack)), ally: Math.max(seen.ally, ...counts.map((c) => Math.min(c.ally, cap.allies))) });
      if (counts.length === 4 && counts.every((c) => c.attack === cap.enemies)) fullTicks++;
      expect(bubbled.fighters).toHaveLength(small.battle.bubble.poolSize);
      m = b.step(m);
    }
    // Four Bubbles were in use, each full at once for a while, at their shared slots (1 enemy, 1 ally) and no more.
    const shared = bubbleSlots(small.battle.slots, 4);
    expect(most.get(4)).toEqual({ attack: shared.enemies, ally: shared.allies });
    expect(fullTicks).toBeGreaterThan(30);
  }, 120_000);

  it('one Bubble alone holds its full slots, which two Bubbles in use shrink', () => {
    const one = battle([0]);
    const two = battle([0, 0]);
    const most = (b: ReturnType<typeof battle>, players: number) => {
      let m = b.match;
      let top = 0;
      for (let t = 0; t < 1200 && m.status.status === 'InProgress'; t++) {
        const counts = perBubble(stepBubbles(m.duel, players, m.duel.tick + 1, small), players, m.duel.tick + 1);
        if (counts.length === players) top = Math.max(top, ...counts.map((c) => c.attack));
        m = b.step(m);
      }
      return top;
    };
    expect(most(one, 1)).toBe(small.battle.slots.enemies);
    expect(most(two, 2)).toBe(bubbleSlots(small.battle.slots, 2).enemies);
  }, 120_000);
});

describe('A Player who left a Battle (an AI Takeover, Stage 6)', () => {
  /** Two Players, one a Team, into their armies' melee; at Tick `at` Player 1 leaves. */
  function leaving(at: number) {
    const b = battle([0, 1]);
    let m = b.match;
    for (let t = 1; t <= at; t++) m = b.step(m);
    const left = takeOverFighter(m, 1);
    return { b, before: m, left };
  }

  it('is marked away in its record, once (idempotent); a Duel, or a slot no Player holds, is unchanged', () => {
    const { before, left } = leaving(30);
    expect(left.duel.crowd!.players).toEqual([before.duel.crowd!.players[0], { ...before.duel.crowd!.players[1], away: true }]);
    expect(takeOverFighter(left, 1)).toBe(left);
    expect(takeOverFighter(before, 5)).toBe(before);
    const duel = createMatch(small, { bestOf: 1 });
    expect(takeOverFighter(duel, 1)).toBe(duel);
    // Its Fighter is no Bubble's Player any more: to the AI it is an ally of its Team, as a promoted Soldier is.
    expect(bubblePlayer(before.duel, 1)).toBe(true);
    expect(bubblePlayer(left.duel, 1)).toBe(false);
    expect(bubblePlayer(left.duel, 0)).toBe(true);
  });

  it('has no Bubble: nothing promotes as its enemy from then on, and its Fighter falling takes over no Soldier', () => {
    const { b, left } = leaving(500);
    // Its Bubble had enemies of its own when it left (Team 0 Soldiers holding Attack Slots round it).
    expect(left.duel.fighters.some((f) => f.team === 0 && f.soldier && f.soldier.role !== 'Ally')).toBe(true);
    let m = left;
    for (let t = 0; t < 600 && m.status.status === 'InProgress'; t++) {
      m = b.step(m);
      // Team 0 Soldiers promote only as Player 0's allies now.
      for (const f of m.duel.fighters) if (f.team === 0 && f.soldier && f.soldier.since > left.duel.tick) expect(f.soldier.role, `Tick ${m.tick}`).toBe('Ally');
    }
    // It falls: well after the takeover delay it still lies there, and took over no one.
    const fall = m.duel.tick;
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === 1 ? { ...f, hp: 0, death: { tick: fall, cause: 'Hit', blow: null } } : f)) } };
    const wait = Math.round(small.battle.takeover.seconds / TICK_SECONDS) + 30;
    for (let t = 0; t < wait && m.status.status === 'InProgress'; t++) m = b.step(m);
    expect(m.duel.crowd!.players[1]).toMatchObject({ soldier: -1, taken: 0, away: true });
    expect(m.duel.fighters[1]!.death?.tick).toBe(fall);
  }, 120_000);
});
