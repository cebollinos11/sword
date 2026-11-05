/**
 * docs/plans/battle-objectives.md, Stage 4a: whole Battles on both level maps (the slow tier of `levels.test.ts`, run by `npm run test:slow`),
 * with every Soldier checked on every step, and Rollbacks across a level change.
 */
import { describe, expect, it } from 'vitest';
import { createBattlePilot, poolControllers, stepMatchWith } from '../controllers';
import { loadTuningData, type TuningData } from '../tuning';
import { battlefieldOf, battleMapOf, createMatch, hashValue, restore, snapshot, soldierHeight, stepCrowd, stepMatch, type CrowdState, type MatchState, type Snapshot } from '.';
import { joins, checkLevels } from './levelChecks.testdata';
import { withLevelMaps } from './levelMaps.testdata';

const base = loadTuningData();
const PLATFORM = 'battle:platform';
const BRIDGE = 'battle:bridge';
const onPlatform = withLevelMaps(base, 'platform');
const onBridge = withLevelMaps(base, 'bridge');

/**
 * A whole AI-v-AI Battle on `name` (to its end, or `cap` Ticks) with `checkLevels` on every Tick, and with `player` a Hard autopilot Player on
 * Team 0 whose Bubble never promotes a Soldier more than `levels.promote` above or below its Fighter. The Crowd step's own time is measured
 * beside it (run again from the same state, so it is only the measure).
 */
function war(t: TuningData, name: string, seed: number, cap: number, player: boolean) {
  const linked = joins(t, name);
  const field = battlefieldOf(t.battle, name)!;
  const map = battleMapOf(t.battle, name);
  const controllers = player ? poolControllers(t, [createBattlePilot(t, 'Hard')]) : [];
  let m = createMatch(t, { format: 'Battle', bestOf: 1, seed, arena: name, ...(player ? { teams: [0], weapons: ['Longsword'] } : {}) });
  let crossed = 0;
  let promoted = 0;
  const crowdMs: number[] = [];
  while (m.status.status === 'InProgress' && m.tick < cap) {
    const before = m;
    m = player ? stepMatchWith(m, controllers, t) : stepMatch(m, [], t);
    const c0 = performance.now();
    stepCrowd(before.duel.crowd!, m.tick, t.battle, [], map);
    crowdMs.push(performance.now() - c0);
    crossed += checkLevels(t, name, linked, before.duel.crowd!, m.duel.crowd!, m.tick);
    if (!player) continue;
    const c = m.duel.crowd!;
    const was = before.duel.crowd!;
    for (let i = 0; i < c.x.length; i++)
      if (was.slot[i]! < 0 && c.slot[i]! > 0 && c.players[0]!.soldier !== i) {
        promoted++;
        expect(Math.abs(soldierHeight(field, was.surface[i]!, was.x[i]!, was.z[i]!) - before.duel.fighters[0]!.y), `Soldier ${i} promoted at Tick ${m.tick}`).toBeLessThanOrEqual(t.battle.levels.promote);
      }
  }
  return { m, crossed, promoted, crowdMs };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('Battles on several levels', () => {
  for (const [t, name] of [
    [onBridge, BRIDGE],
    [onPlatform, PLATFORM],
  ] as const)
    it(`play a 200 v 200 Battle on ${name} to its end by Tickets, every Soldier on the right level on every Tick`, () => {
      const { m, crossed, crowdMs } = war(t, name, 1, 60_000, false);
      const c = m.duel.crowd!;
      process.stderr.write(`${name} seed 1: ${m.status.status} at ${(m.tick / 60).toFixed(0)} s, Tickets ${c.tickets.map((x) => x.toFixed(0)).join(' / ')}, onto another level ${crossed} times; Crowd step ${mean(crowdMs).toFixed(2)} ms mean\n`);
      expect(m.status.status).toBe('Over');
      expect(c.rout).not.toBeNull();
      expect(c.tickets.some((x) => x <= 0)).toBe(true);
      expect(crossed).toBeGreaterThan(100);
    }, 600_000);

  it('promote round a Player on autopilot on the bridge map only Soldiers of its own level, every Soldier on the right level on every Tick', () => {
    const { promoted, crossed } = war(onBridge, BRIDGE, 2, 9000, true);
    process.stderr.write(`bridge with a Player: ${promoted} Promotions, onto another level ${crossed} times\n`);
    expect(promoted).toBeGreaterThan(20);
  }, 600_000);

  it('give the same hash every Tick from the same seed, and land a Rollback on the same state across Soldiers changing level', () => {
    const t = onBridge;
    let a = createMatch(t, { format: 'Battle', bestOf: 1, seed: 3, arena: BRIDGE });
    let b = createMatch(t, { format: 'Battle', bestOf: 1, seed: 3, arena: BRIDGE });
    const arena = battlefieldOf(t.battle, BRIDGE)!.arena;
    const saved = new Map<number, Snapshot<MatchState>>();
    const hashes = new Map<number, string>();
    const states = new Map<number, CrowdState>();
    for (let tick = 1; tick <= 9000; tick++) {
      a = stepMatch(a, [], t);
      b = stepMatch(b, [], t);
      hashes.set(tick, hashValue(a));
      if (tick % 250 === 0) expect(hashes.get(tick), `Tick ${tick}`).toBe(hashValue(b));
      if (tick % 100 === 0) saved.set(tick, snapshot(a));
      if (tick % 100 === 0 || tick % 100 === 15) states.set(tick, a.duel.crowd!);
    }
    let across = 0;
    for (const [tick, s] of saved) {
      if (tick + 15 > 9000) continue;
      let r = restore(s);
      for (let k = 0; k < 15; k++) r = stepMatch(r, [], t);
      expect(hashValue(r), `from Tick ${tick}`).toBe(hashes.get(tick + 15));
      // A window in which some Soldier stepped onto or off a ramp, the top, the bridge or the tunnel.
      const [from, to] = [states.get(tick)!, states.get(tick + 15)!];
      if (from.surface.some((v, i) => v !== to.surface[i] && from.alive[i] && to.alive[i] && (!arena.walk[v]!.id.startsWith('ground') || !arena.walk[to.surface[i]!]!.id.startsWith('ground')))) across++;
    }
    process.stderr.write(`bridge: ${across} of ${saved.size - 1} Rollback windows had a Soldier change level\n`);
    expect(across).toBeGreaterThan(5);
  }, 300_000);
});
