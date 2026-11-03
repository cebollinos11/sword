import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  createCrowd,
  createMatch,
  crowdAlive,
  crowdDue,
  groundBelow,
  hashValue,
  heightfield,
  IDLE_INTENT,
  parseBattleName,
  restore,
  routTicks,
  snapshot,
  stepCrowd,
  stepMatch,
  type CrowdState,
  type Intent,
  type MatchState,
} from '.';
import { secondsToTicks } from './constants';
import { createRng, nextFloat } from './rng';

const tuning = loadTuningData();
/** Two small armies that meet within a few seconds: fast enough to fight many Battles in a test. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
/** The same with a Fighter Pool only big enough for one Player: nothing promotes, so the Crowd fights alone (no AI drives a promoted Fighter here). */
const unpooled: TuningData = { ...small, battle: { ...small.battle, bubble: { ...small.battle.bubble, poolSize: 1 } } };

const battle = (t: TuningData, seed: number, teams: number[] = []) => createMatch(t, { format: 'Battle', bestOf: 1, seed, teams });

/** A Player Fighter's Intents: walking about and turning, so the Fighters' Duel changes too. */
const playerIntent = (tick: number): Intent => ({ ...IDLE_INTENT, move: { x: Math.sin(tick / 40), z: Math.cos(tick / 55) }, face: tick / 90 });

function run(match: MatchState, ticks: number, t: TuningData, each?: (m: MatchState) => void): MatchState {
  let m = match;
  for (let k = 0; k < ticks && m.status.status === 'InProgress'; k++) {
    m = stepMatch(m, m.config.teams.map(() => playerIntent(m.tick)), t);
    each?.(m);
  }
  return m;
}

function toEnd(match: MatchState, t: TuningData, each?: (m: MatchState) => void): MatchState {
  return run(match, 20_000, t, each);
}

/** The closest two living Soldiers (centre to centre). */
function closestPair(c: CrowdState): number {
  let best = Infinity;
  for (let i = 0; i < c.x.length; i++) {
    if (!c.alive[i]) continue;
    for (let j = i + 1; j < c.x.length; j++) if (c.alive[j]) best = Math.min(best, Math.hypot(c.x[i]! - c.x[j]!, c.z[i]! - c.z[j]!));
  }
  return best;
}

describe('the Battle Format', () => {
  it('deploys both armies on a Battlefield, with any Fighters at their spawns, and refuses what a Battle has not', () => {
    const m = battle(tuning, 7, [0]);
    expect(m.config.format).toBe('Battle');
    expect(m.arena).toBe('battle:7');
    expect(crowdAlive(m.duel.crowd!)).toEqual([tuning.battle.armySize, tuning.battle.armySize]);
    // The Player's Fighter, then the rest of the Fighter Pool, unbound (Benched).
    expect(m.duel.fighters).toHaveLength(tuning.battle.bubble.poolSize);
    expect(m.duel.fighters.slice(1).every((f) => f.benched && f.soldier === undefined)).toBe(true);
    const spawn = arenaOf(tuning, m.arena).spawns.find((s) => s.team === 0 && s.slot === 0)!;
    expect(m.duel.fighters[0]!.position).toEqual({ x: spawn.position.x, z: spawn.position.z });
    expect(battle(tuning, 7).duel.fighters.every((f) => f.benched)).toBe(true);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, arena: 'circle' })).toThrow(/Battlefield/);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, rematchTicks: 60 })).toThrow(/Rematch/);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, teams: [0, 0, 0, 0, 0] })).toThrow(/at most/);
  });

  it('leaves a Duel without a Crowd, so it hashes as it always did', () => {
    const duel = createMatch(tuning, { bestOf: 1 });
    expect('crowd' in duel.duel).toBe(false);
    expect('crowd' in stepMatch(duel, [IDLE_INTENT, IDLE_INTENT], tuning).duel).toBe(false);
  });

  it('gives an equal hashValue every Tick for the same seed and Intents', () => {
    let a = battle(small, 3, [0]);
    let b = battle(small, 3, [0]);
    for (let k = 0; k < 700; k++) {
      a = stepMatch(a, [playerIntent(a.tick)], small);
      b = stepMatch(b, [playerIntent(b.tick)], small);
      expect(hashValue(a), `Tick ${a.tick}`).toBe(hashValue(b));
    }
    // The armies met and fought within those Ticks.
    expect(crowdAlive(a.duel.crowd!).some((n) => n < small.battle.armySize)).toBe(true);
    expect(hashValue(battle(small, 4, [0]))).not.toBe(hashValue(battle(small, 3, [0])));
  });

  it('continues identically from a snapshot taken mid-battle, and a Rollback across the Rout re-simulates to the same state', () => {
    const full = toEnd(battle(unpooled, 5, [1]), unpooled);
    const routTick = full.duel.crowd!.rout!.tick;
    // Mid-battle, with Soldiers already fallen.
    const mid = run(battle(unpooled, 5, [1]), routTick - 120, unpooled);
    expect(crowdAlive(mid.duel.crowd!).some((n) => n < unpooled.battle.armySize)).toBe(true);
    const snap = snapshot(mid);
    const straight = run(mid, 240, unpooled);
    const again = run(restore(snap), 240, unpooled);
    expect(straight.duel.crowd!.rout).not.toBeNull();
    expect(hashValue(again)).toBe(hashValue(straight));
    // The snapshot stays reusable, and a Rollback to it lands on the same final state too.
    expect(hashValue(toEnd(restore(snap), unpooled))).toBe(hashValue(full));
  });

  it('routs a Team once it falls below the threshold, and ends with the other Team’s win after the rout duration', () => {
    const routEvents: { tick: number; team: number }[] = [];
    const ends: MatchState[] = [];
    let before: MatchState = battle(small, 9);
    const end = toEnd(before, small, (m) => {
      for (const e of m.events) if (e.type === 'Rout') routEvents.push({ tick: m.tick, team: e.team });
      if (m.events.some((e) => e.type === 'BattleEnd')) ends.push(m);
      if (routEvents.length === 0) before = m;
    });
    expect(routEvents).toHaveLength(1);
    const { team, tick } = routEvents[0]!;
    // It fell below the threshold on that very Tick, and not before.
    const left = crowdAlive(end.duel.crowd!);
    expect(crowdAlive(before.duel.crowd!)[team]!).toBeGreaterThanOrEqual(small.battle.rout.threshold * small.battle.armySize);
    expect(left[team]!).toBeLessThan(small.battle.rout.threshold * small.battle.armySize);
    expect(end.duel.crowd!.rout).toEqual({ team, tick });
    expect(ends).toHaveLength(1);
    expect(end.status).toEqual({ status: 'Over', winner: 1 - team, tick: tick + routTicks(small) });
    expect(end.score[1 - team]).toBe(1);
    expect(end.duel.duel).toMatchObject({ status: 'Over', winner: 1 - team });
    // Over: it stands still.
    expect(hashValue(stepMatch(end, [], small).duel.crowd)).toBe(hashValue(end.duel.crowd));
  });

  it('routs the Team a hand-made Crowd leaves below the threshold, and its Soldiers flee toward their own edge', () => {
    const b = small.battle;
    const c = createCrowd(b, 1);
    // Team 1 keeps only a fifth less one: below the threshold.
    const keep = Math.ceil(b.rout.threshold * b.armySize) - 1;
    const alive = c.alive.map((a, i) => (i >= b.armySize + keep ? 0 : a));
    const crowd: CrowdState = { ...c, alive, hp: c.hp.map((h, i) => (alive[i] ? h : 0)) };
    let next = stepCrowd(crowd, 1, b);
    expect(next.rout).toEqual({ team: 1, tick: 1 });
    for (let t = 2; t <= 2 + 3 * b.crowd.stagger; t++) next = stepCrowd(next, t, b);
    for (let i = b.armySize; i < b.armySize + keep; i++) expect(next.z[i]!).toBeGreaterThan(crowd.z[i]!);
  });

  it('updates every Soldier exactly once per stagger period', () => {
    const { stagger, } = tuning.battle.crowd;
    const n = 2 * tuning.battle.armySize;
    for (let start = 0; start < 3 * stagger; start++) {
      const count = new Array<number>(n).fill(0);
      for (let t = start; t < start + stagger; t++) for (let i = 0; i < n; i++) if (crowdDue(i, t, stagger, tuning.battle.armySize)) count[i]!++;
      expect(count.every((c) => c === 1)).toBe(true);
    }
    // And the step moves only those: a Soldier never moves except on its due Ticks, and once the Squads are marching (every brain has
    // set its anchor walking by Tick 2 × its period) every Soldier is walking after its place and moves on each of its due Ticks.
    let crowd = createCrowd(tuning.battle, 2);
    const marching = 2 * Math.max(stagger, secondsToTicks(tuning.battle.squad.brainSeconds));
    for (let t = 1; t <= marching + 2 * stagger; t++) {
      const next = stepCrowd(crowd, t, tuning.battle);
      for (let i = 0; i < n; i++) {
        const moved = next.x[i] !== crowd.x[i] || next.z[i] !== crowd.z[i];
        const due = crowdDue(i, t, stagger, tuning.battle.armySize);
        if (moved) expect(due, `Soldier ${i} moved on Tick ${t}, not its Tick`).toBe(true);
        else if (t > marching) expect(due, `Soldier ${i} stood on its Tick ${t}`).toBe(false);
      }
      crowd = next;
    }
  });

  it('keeps living Soldiers apart once the armies meet, and a full war stays within the Stage 0 budget', () => {
    let match = battle(tuning, 1);
    const { separation } = tuning.battle.crowd;
    let met = -1;
    let closest = Infinity;
    const times: number[] = [];
    // Time the Crowd step itself on the same states the war steps through.
    while (match.status.status === 'InProgress') {
      const t0 = performance.now();
      stepCrowd(match.duel.crowd!, match.duel.tick + 1, tuning.battle);
      times.push(performance.now() - t0);
      match = stepMatch(match, [], tuning);
      const c = match.duel.crowd!;
      if (met < 0 && c.target.some((t) => t >= 0)) met = match.tick;
      if (met >= 0 && match.tick % 30 === 0) closest = Math.min(closest, closestPair(c));
    }
    expect(met).toBeGreaterThan(0);
    // The tolerance: no two centres within an eighth of the separation. (A sixth until Stage 5's Crowd data: since then two
    // back-rank Soldiers squeeze to 0.12 m for a moment as the front stops at contact, then part.)
    expect(closest).toBeGreaterThan(separation / 8);
    const warm = times.slice(120).sort((a, b) => a - b);
    const mean = warm.reduce((s, v) => s + v, 0) / warm.length;
    const p99 = warm[Math.floor(warm.length * 0.99)]!;
    console.log(`Crowd step, 400 Soldiers, ${warm.length} Ticks: mean ${mean.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms; closest pair ${closest.toFixed(3)} m`);
    // The budget is about 1 ms a Tick on the target laptop; generous slack for a loaded test run.
    expect(mean).toBeLessThan(5);
  }, 60_000);

  it('gives equal armies about even odds over many seeds', () => {
    const wins = [0, 0];
    const seeds = 40;
    for (let seed = 1; seed <= seeds; seed++) {
      const end = toEnd(battle(small, seed), small);
      expect(end.status.status).toBe('Over');
      wins[(end.status as { winner: number }).winner]!++;
    }
    console.log(`Team 0 won ${wins[0]} of ${seeds} Battles`);
    // About 3σ of a fair coin either side of 20 (Stage 5's tuning may tighten it).
    expect(wins[0]).toBeGreaterThanOrEqual(10);
    expect(wins[0]).toBeLessThanOrEqual(30);
  }, 60_000);
});

describe('the Battlefield', () => {
  const field = tuning.battle.field;

  it('is the same heightfield for the same name, and another for another seed', () => {
    expect(parseBattleName('battle:42')).toBe(42);
    expect(parseBattleName('gen:greybox:42')).toBeNull();
    expect(() => parseBattleName('battle:04')).toThrow();
    expect(heightfield(field, 42)).toEqual(heightfield(field, 42));
    expect(hashValue(heightfield(field, 42))).not.toBe(hashValue(heightfield(field, 43)));
    const a = arenaOf(tuning, 'battle:42');
    expect(arenaOf(tuning, 'battle:42')).toBe(a);
    expect(hashValue(battlefieldOf({ ...tuning.battle }, 'battle:42')!.arena)).toBe(hashValue(a));
  });

  it('is gentle open ground: no Walls, Doors or deadly ground, within the hill height, with each Team spawning on its own side', () => {
    const { arena, heights } = battlefieldOf(tuning.battle, 'battle:5')!;
    expect(arena.walls).toEqual([]);
    expect(arena.doors).toEqual([]);
    expect(arena.walk.every((s) => !s.lava && !s.water && !s.abyss)).toBe(true);
    expect(heights.heights.every((h) => Math.abs(h) <= field.hillHeight + 1e-9)).toBe(true);
    expect(Math.max(...heights.heights) - Math.min(...heights.heights)).toBeGreaterThan(field.hillHeight / 2);
    for (const s of arena.spawns) expect(Math.sign(s.position.z)).toBe(s.team === 0 ? -1 : 1);
  });

  it('agrees with groundBelow everywhere on the field', () => {
    const name = 'battle:11';
    const arena = arenaOf(tuning, name);
    const hf = battlefieldOf(tuning.battle, name)!.heights;
    let rng = createRng(99);
    const draw = () => {
      const [v, next] = nextFloat(rng);
      rng = next;
      return v;
    };
    const half = field.size / 2;
    // Random points, and the grid's own corners and edges.
    const points = Array.from({ length: 400 }, () => [(draw() * 2 - 1) * (half - 0.01), (draw() * 2 - 1) * (half - 0.01)] as const);
    for (let k = -4; k <= 4; k++) points.push([k * field.cell, k * field.cell * 0.5], [k * field.cell, (k + 0.5) * field.cell]);
    for (const [x, z] of points) {
      const g = groundBelow(arena, x, z, 100);
      expect(g, `(${x}, ${z})`).not.toBeNull();
      expect(g!.y).toBeCloseTo(battlefieldHeight(hf, x, z), 9);
    }
  });
});
