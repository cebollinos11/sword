import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, inDuel, MAX_TEAM_SIZE, runSeed, secondsToTicks, stepMatch, type FighterState, type MatchEvent, type MatchState } from '../sim';
import { floorArenaName, floorOf } from '../sim/delver';
import { controllerIntents, type Controller } from './controller';
import { createDelverPilot } from './delverPilot';
import { lineupAis, type Lineup } from './lineup';

/**
 * A solo Delver Run on empty Floors (docs/plans/delver.md, Stage 2): the Player on the Delver pilot, two Ally AIs and the Floors' four Hall AIs
 * walk three Floors to Victory. At each Floor's start the Player is put at half HP and ally 1 is felled, so the run must show a Rest heal, a
 * revive, and the party gathering at the Stairs on every Floor. Prints the Floors' build times and each Floor's numbers.
 */
const base = loadTuningData();
const SEED_NAME = 'gen:greybox:4242';
const FLOORS = 3;
/** A Floor's build may not take longer (ms): `delverFloor` is about 0.25 s here, 0.75 s on a laptop. */
const BUILD_MS = 2000;
/** The Run's budget (Ticks): 15 minutes. */
const RUN_TICKS = secondsToTicks(15 * 60);
/** How far (m) every ally must be from the Player when the Stairs are taken. */
const GATHERED = 8;

const LINEUP: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } })),
];

/** The Run's Tuning: one tier of three empty Floors (`postFill` and `patrolFill` 0: a Crowd of no Soldiers; Stage 2's walk needs no enemy). */
const runTuning = (): TuningData => ({ ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: FLOORS, postFill: 0, patrolFill: 0 } });

const edit = (m: MatchState, i: number, f: (x: FighterState) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((x, k) => (k === i ? f(x) : x)) } });
const felled = (m: MatchState) => (f: FighterState): FighterState => ({ ...f, hp: 0, death: { tick: m.duel.tick, cause: 'Fall', blow: null } });
const ground = (a: FighterState, b: FighterState): number => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
const seconds = (ticks: number): string => (ticks / secondsToTicks(1)).toFixed(1);
const percentile = (xs: readonly number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

interface FloorReport {
  start: number;
  end: number | null;
  rested: number[];
  revived: number[];
  distances: number[];
  /** The Player's HP as a fraction of max HP on the Floor's first Tick, after the edit. */
  startHp: number;
}

interface Played {
  final: MatchState;
  floors: FloorReport[];
  costs: number[];
}

/** Play a Run to its end (or RUN_TICKS), `onFloorStart` editing the state at each Floor's first Tick. */
function play(tuning: TuningData, onFloorStart: (m: MatchState, floor: number) => MatchState, stopAfterFloor = FLOORS): Played {
  let m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: SEED_NAME, delver: true, teams: LINEUP.map((s) => s.team), humans: 1, players: [0] });
  const controllers: Controller[] = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: SEED_NAME, delver: true }).map((c) => c ?? createDelverPilot(tuning));
  const floors: FloorReport[] = [];
  const costs: number[] = [];
  const begin = (match: MatchState): MatchState => {
    const edited = onFloorStart(match, match.delver!.floor);
    const p = edited.duel.fighters[0]!;
    floors.push({ start: edited.tick, end: null, rested: [], revived: [], distances: [], startHp: p.hp / p.maxHp });
    return edited;
  };
  m = begin(m);
  for (let t = 0; t < RUN_TICKS && m.status.status !== 'Over' && floors.length <= stopAfterFloor; t++) {
    const t0 = performance.now();
    const at = m;
    const next = stepMatch(at, controllerIntents(at.duel, controllers), tuning);
    costs.push(performance.now() - t0);
    const floor = floors[floors.length - 1]!;
    for (const e of next.events as readonly MatchEvent[]) {
      if (e.type === 'Rested' && e.fighter === 0 && e.healed > 0) floor.rested.push(e.healed);
      if (e.type === 'Revived') floor.revived.push(e.fighter);
      if (e.type === 'StairsTaken' || e.type === 'RunEnd') {
        floor.end = next.tick;
        const player = next.duel.fighters[0]!;
        floor.distances = [1, 2].map((i) => ground(next.duel.fighters[i]!, player));
      }
    }
    m = next.events.some((e) => e.type === 'DuelStart') ? begin(next) : next;
  }
  return { final: m, floors, costs };
}

describe('a solo Delver Run on empty Floors', { timeout: 20 * 60_000 }, () => {
  it('walks three Floors to Victory: rests, revives, and the party gathered at every Stairs', () => {
    const tuning = runTuning();
    const seed = runSeed(SEED_NAME);
    // A cold tuning object: each Floor is built here for the first time, then the Match reads them from the cache.
    const builds = Array.from({ length: FLOORS }, (_, k) => {
      const t0 = performance.now();
      floorOf(tuning, floorArenaName(seed, k + 1));
      return performance.now() - t0;
    });
    console.log(`Delver Run ${SEED_NAME} (Run seed ${seed}); Floor builds (ms): ${builds.map((b, k) => `F${k + 1} ${b.toFixed(0)}`).join(', ')}`);
    for (const b of builds) expect(b, `a Floor took ${b.toFixed(0)} ms to build (over ${BUILD_MS})`).toBeLessThan(BUILD_MS);

    const run = play(tuning, (m) => {
      const half = edit(m, 0, (f) => ({ ...f, hp: f.maxHp * 0.5 }));
      return edit(half, 1, felled(half));
    });
    const { floors, costs, final } = run;
    for (const [k, f] of floors.entries()) {
      console.log(
        `Floor ${k + 1}: ${f.end === null ? 'not finished' : `${seconds(f.end - f.start)} s to ${k + 1 === FLOORS ? 'the Victory' : 'the Stairs'}`}; Player at ${(f.startHp * 100).toFixed(0)}% HP; ` +
          `Rested ${JSON.stringify(f.rested.map((h) => Number(h.toFixed(1))))}; Revived fighters ${JSON.stringify(f.revived)}; ally distances to the Player at the Stairs ${f.distances.map((d) => `${d.toFixed(1)} m`).join(', ')}`,
      );
    }
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    console.log(`Match Tick cost over ${costs.length} Ticks: mean ${mean.toFixed(2)} ms, p99 ${percentile(costs, 0.99).toFixed(2)} ms, max ${Math.max(...costs).toFixed(2)} ms`);

    expect(floors, 'the Run did not reach every Floor').toHaveLength(FLOORS);
    for (const [k, f] of floors.entries()) {
      expect(f.rested.length, `Floor ${k + 1}: the Player was never Rested for more than 0`).toBeGreaterThan(0);
      expect(f.revived, `Floor ${k + 1}: ally 1 was never Revived`).toContain(1);
      expect(f.end, `Floor ${k + 1}: the Stairs were never taken`).not.toBeNull();
      for (const d of f.distances) expect(d, `Floor ${k + 1}: an ally was ${d.toFixed(1)} m from the Player at the Stairs (over ${GATHERED})`).toBeLessThanOrEqual(GATHERED);
    }
    expect(final.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(final.delver!.floor).toBe(FLOORS);
  });

  it('with the Player felled at Floor 1, the allies take the Stairs and the Player stands at the revive HP on Floor 2', () => {
    const tuning = runTuning();
    const run = play(tuning, (m, floor) => (floor === 1 ? edit(m, 0, felled(m)) : m), 2);
    const [one, two] = run.floors;
    console.log(`Player felled at Floor 1: the allies took the Stairs after ${seconds(one!.end! - one!.start)} s; Floor 2 began with the Player at ${(two!.startHp * 100).toFixed(0)}% HP`);
    expect(one!.end, 'the allies never took the Stairs').not.toBeNull();
    expect(two, 'the Run never reached Floor 2').toBeDefined();
    expect(two!.startHp).toBeCloseTo(tuning.dungeon.revive, 5);
    expect(inDuel(run.final.duel.fighters[0]!)).toBe(true);
  });
});
