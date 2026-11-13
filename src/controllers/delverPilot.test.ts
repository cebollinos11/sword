import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, IDLE_INTENT, inStairs, secondsToTicks, type MatchState } from '../sim';
import { floorOf } from '../sim/delver';
import type { Controller } from './controller';
import { runMatch } from './controller';
import { createAiController } from './ai';
import { createDelverPilot } from './delverPilot';
import { lineupAis, type Lineup } from './lineup';

const base = loadTuningData();
/** A short Run: one tier of three Floors, with Warbands (the Tuning Data's own). */
const warbanded: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
/** The same on an empty Floor (`postFill` and `patrolFill` 0: still a Crowd, of no Soldiers), for the cases that need no enemy. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };
const ARENA = 'gen:greybox:4242';

const LINEUP: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, ...[0, 1, 2, 3].map(() => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } }))];

/** A solo Delver Run: the Player (Fighter 0), then the four Team 1 slots. */
const start = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 1, 1, 1, 1], humans: 1, players: [0] });
const controllers = (pilot: Controller): Controller[] => lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true }).map((c) => c ?? pilot);

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

  it('fights a promoted enemy within promote with its AI, and walks its route again once none is near', () => {
    const m = createMatch(warbanded, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 1, 1, 1, 1], humans: 1, players: [0] });
    const at = m.duel.fighters[0]!;
    const withEnemy = (dx: number, y = 0) => ({ ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 3 ? { ...f, benched: undefined, hp: f.maxHp, position: { x: at.position.x + dx, z: at.position.z }, y: at.y + y, soldier: { index: 0, since: 0, role: 'Attack' as const } } : f)) });
    const { promote } = warbanded.battle.bubble;
    const route = createDelverPilot(warbanded).intent(m.duel, 0);
    const own = createAiController(warbanded, 'Hard');
    const near = withEnemy(promote - 1);
    expect(createDelverPilot(warbanded).intent(near, 0)).toEqual(own.intent(near, 0));
    expect(createDelverPilot(warbanded).intent(near, 0)).not.toEqual(route);
    expect(createDelverPilot(warbanded).intent(withEnemy(promote + 2), 0)).toEqual(route);
    expect(createDelverPilot(warbanded).intent(withEnemy(promote - 1, warbanded.battle.levels.height + 1), 0)).toEqual(route);
  });

  it('marks a fire reached while it fights a promoted enemy near it', () => {
    const m = createMatch(warbanded, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 1, 1, 1, 1], humans: 1, players: [0] });
    const fire = floorOf(warbanded, m.arena)!.plan.markers.fires[0]!;
    const at = m.duel.fighters[0]!;
    // Standing on the first fire with a promoted enemy beside it: the pilot fights, and the fire counts.
    const duel = {
      ...m.duel,
      fighters: m.duel.fighters.map((f, i) =>
        i === 0
          ? { ...f, position: { x: fire.x, z: fire.z } }
          : i === 3
            ? { ...f, benched: undefined, hp: f.maxHp, position: { x: fire.x + 1, z: fire.z }, y: at.y, soldier: { index: 0, since: 0, role: 'Attack' as const } }
            : f,
      ),
    };
    const pilot = createDelverPilot(warbanded);
    pilot.intent(duel, 0);
    expect((pilot.save!() as { reached: number[] }).reached).toContain(0);
  });
});
