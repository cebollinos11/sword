import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, IDLE_INTENT, inStairs, secondsToTicks, type MatchState } from '../sim';
import { floorOf } from '../sim/delver';
import type { Controller } from './controller';
import { runMatch } from './controller';
import { createDelverPilot } from './delverPilot';
import { createHallAi } from './hallAi';

const base = loadTuningData();
/** A short Run: one tier of three Floors. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
const ARENA = 'gen:greybox:4242';

/** A solo Delver Run: the Player (Fighter 0), then the four Team 1 slots. */
const start = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 1, 1, 1, 1], humans: 1, players: [0] });
const controllers = (pilot: Controller): Controller[] => [pilot, ...[0, 1, 2, 3].map((k) => createHallAi(tuning, k, ARENA))];

describe('the Delver pilot', { timeout: 60_000 }, () => {
  it('visits the nearest fire first, then each other fire, then the Stairs, and the Run descends', () => {
    const m0 = start();
    const { fires, stairs } = floorOf(tuning, m0.arena)!.plan.markers;
    const spawn = m0.duel.fighters[0]!.position;
    const dist = (p: { x: number; z: number }, q: { x: number; z: number }): number => Math.hypot(p.x - q.x, p.z - q.z);
    const nearest = fires.map((f, k) => ({ k, d: dist(f, spawn) })).sort((a, b) => a.d - b.d || a.k - b.k)[0]!.k;

    const run = runMatch(tuning, m0, controllers(createDelverPilot(tuning)), secondsToTicks(180));
    const order: number[] = [];
    let stairsAt = -1;
    for (const m of run.matches) {
      m.delver!.restUsed.forEach((u, k) => {
        if (u.healed.includes(0) && !order.includes(k)) order.push(k);
      });
      if (stairsAt < 0 && m.events.some((e) => e.type === 'StairsTaken')) stairsAt = m.tick;
    }
    expect(fires.length).toBeGreaterThan(1);
    expect(order[0]).toBe(nearest);
    expect([...order].sort()).toEqual(fires.map((_, k) => k));
    expect(stairsAt).toBeGreaterThan(0);
    const taken = run.matches.find((m) => m.tick === stairsAt)!;
    expect(inStairs(floorOf(tuning, taken.arena)!.plan, taken.duel.fighters[0]!)).toBe(true);
    expect(stairs.zone.x1).toBeGreaterThan(stairs.zone.x0);
    expect(run.final.delver!.floor).toBe(2);
  });

  it('round-trips its memory through save and load', () => {
    const pilot = createDelverPilot(tuning);
    const cs = controllers(pilot);
    const run = runMatch(tuning, start(), cs, secondsToTicks(30));
    const saved = structuredClone(pilot.save!());
    const fresh = createDelverPilot(tuning);
    fresh.load!(saved);
    expect(fresh.save!()).toEqual(saved);
    expect(fresh.intent(run.final.duel, 0)).toEqual(pilot.intent(run.final.duel, 0));
  });

  it('stands while the Run is Descending, and when its Fighter has fallen', () => {
    const m = start();
    const pilot = createDelverPilot(tuning);
    expect(pilot.intent(m.duel, 0)).not.toEqual(IDLE_INTENT);
    expect(pilot.intent({ ...m.duel, delver: { floor: 1, phase: 'Descending' } }, 0)).toEqual(IDLE_INTENT);
    const fallen = { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: 0, death: { tick: 0, cause: 'Fall' as const, blow: null } } : f)) };
    expect(pilot.intent(fallen, 0)).toEqual(IDLE_INTENT);
  });
});
