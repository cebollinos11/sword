/**
 * docs/plans/delver.md, Stage 0: can a Run's Floor be one continuous Arena (about 20 rooms and passages, `delverSpike.testdata.ts`) with a
 * Crowd of Soldiers on it? This measures it and prints the numbers for the plan's Result, and asserts only structure (the source compiles
 * the same twice, passes the walk check, has 20 rooms and 23 passages, `distanceTo` is repeatable, a replay hashes the same, every scenario
 * ran 6,000 Ticks) and one loose time bound, so a regression to minutes fails but a slow machine does not.
 *
 *  - Build: `compileMap`, `walkCheck`, `battlefieldOf`, `destinationFields`, a `distanceTo` per room centre, a moving `distanceTo`, `navMesh`
 *    (each the median of 5 runs after a warm-up, the caches defeated by a fresh copy of the Tuning Data's objects each run).
 *  - Doorways: the same at `crowd.flowCell` 2, and how many room-centre fields reach room 0 at 4 and at 2.
 *  - Ticks: T0 (the open field), T1 (the Floor, a Run-sized Bubble) and T2 (the Floor, a full Pool), 6,000 Ticks each, the armies moved into
 *    rooms by `relocate`; T1 is then replayed from its Intents and must hash the same.
 */
import { describe, expect, it } from 'vitest';
import { createBattlePilot, poolControllers, type Controller } from '../controllers';
import { applyBattleKnobs, loadTuningData, type BattleTuning, type TuningData } from '../tuning';
import {
  battlefieldOf,
  createMatch,
  destinationFields,
  distanceTo,
  fieldDistance,
  groundOf,
  hashValue,
  navMesh,
  stepMatch,
  TICK_SECONDS,
  walkCheck,
  type Battlefield,
  type DestinationFields,
  type Intent,
  type MatchState,
} from '../sim';
import { compileMap, mapFileText } from './compile';
import { delverSpikeSource, SPIKE_ROOMS } from './delverSpike.testdata';
import { parseMapSource } from './source';

const base = loadTuningData();
const NAME = 'delverspike';
const ARENA = `battle:${NAME}`;
const TICKS = Math.round(100 / TICK_SECONDS);
const TICK_BUDGET_MS = 8;
const FRAME_MS = 1000 / 60;
const RUNS = 5;

const source = delverSpikeSource();
const compiled = compileMap(source, base.battle).map;

/** The Battle Tuning with the Floor folded in and army size 50 (100 Soldiers), as a fresh object (so no cache of an earlier one is hit). */
const floorBattle = (flowCell = base.battle.crowd.flowCell): BattleTuning => {
  const b = applyBattleKnobs({ ...base.battle, maps: { ...base.battle.maps, [NAME]: compiled } }, { map: NAME, armySize: 50 });
  return { ...b, crowd: { ...b.crowd, flowCell } };
};
/** Tuning Data with `battle`, fresh. */
const tuningOf = (battle: BattleTuning): TuningData => ({ ...base, battle });

/** The median (ms) of RUNS runs of `build` after one warm-up, `prepare` making each run's input untimed. */
function median<T>(prepare: () => T, build: (input: T) => unknown): number {
  build(prepare());
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const input = prepare();
    const t0 = performance.now();
    build(input);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[RUNS >> 1]!;
}

const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2));
const report = (lines: string[]) => process.stderr.write(`\n${lines.join('\n')}\n`);
const nodeCount = (f: DestinationFields) => (f.levels ? f.levels.y.length : f.side * f.side);

/** A fresh Battlefield and its Battle Tuning for the Floor. */
function freshField(flowCell?: number) {
  const battle = floorBattle(flowCell);
  const field = battlefieldOf(battle, ARENA)!;
  return { battle, field };
}

/** Where each room's centre stands (x, z, and its floor's Walk Surface). */
const centres = (battle: BattleTuning, field: Battlefield) => SPIKE_ROOMS.map((r) => ({ x: r.cx, z: r.cz, s: groundOf(battle, field, r.cx, r.cz, 0) }));

/** The Build timings at `flowCell` (steps 3 to 5), and how many room-centre fields reach room 0's centre. */
function buildAt(flowCell: number) {
  const bf = median(() => floorBattle(flowCell), (b) => battlefieldOf(b, ARENA));
  const df = median(
    () => freshField(flowCell),
    ({ battle, field }) => destinationFields(battle, field),
  );
  const { battle, field } = freshField(flowCell);
  const fields = destinationFields(battle, field);
  const posts = centres(battle, field);
  const dt = median(
    () => fields,
    (f) => posts.forEach((p) => distanceTo(f, p.x, p.z, p.s)),
  );
  const room0 = posts[0]!;
  const reach = posts.map((p) => fieldDistance({ ...fields, dist: [distanceTo(fields, p.x, p.z, p.s)] }, 0, room0.x, room0.z, room0.s));
  const reaching = reach.filter((d) => d >= 0).length;
  return { bf, df, dt, reaching, reach, nodes: nodeCount(fields), layered: field.layered };
}

describe('the Delver spike Floor', () => {
  it('parses, compiles twice to the same map file, passes the walk check and has 20 rooms and 23 passages', () => {
    expect(parseMapSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(mapFileText(compileMap(delverSpikeSource(), base.battle).map)).toBe(mapFileText(compiled));
    const { field } = freshField();
    expect(walkCheck(field.arena, base.battle.levels)).toBeNull();
    expect(source.brushes.filter((b) => b.kind === 'enclosure' && b.id.startsWith('room'))).toHaveLength(20);
    expect(source.brushes.filter((b) => b.kind === 'enclosure' && b.id.startsWith('pass'))).toHaveLength(23);
    expect(SPIKE_ROOMS).toHaveLength(20);
  });

  it('builds the Floor: compile, walk check, Battlefield, destination fields, a field per room, a moving field, navmesh', () => {
    const compile = median(() => delverSpikeSource(), (s) => compileMap(s, base.battle));
    const { field } = freshField();
    const walk = median(() => field.arena, (a) => walkCheck(a, base.battle.levels));
    const at4 = buildAt(base.battle.crowd.flowCell);
    const { battle: b0, field: f0 } = freshField();
    const fields = destinationFields(b0, f0);
    const posts = centres(b0, f0);
    expect(Array.from(distanceTo(fields, posts[3]!.x, posts[3]!.z, posts[3]!.s))).toEqual(Array.from(distanceTo(fields, posts[3]!.x, posts[3]!.z, posts[3]!.s)));

    // A walk from room 0's centre east along row 0 (through pass0 into room 1 and on), a point every metre: 100 of them.
    const steps = Array.from({ length: 100 }, (_, k) => ({ x: SPIKE_ROOMS[0]!.cx + k, z: SPIKE_ROOMS[0]!.cz }));
    const surfaces = steps.map((p) => groundOf(b0, f0, p.x, p.z, 0));
    const each: number[] = [];
    for (let rep = 0; rep < RUNS + 1; rep++) {
      const ms = steps.map((p, k) => {
        const t0 = performance.now();
        distanceTo(fields, p.x, p.z, surfaces[k]!);
        return performance.now() - t0;
      });
      if (rep > 0) each.push(...ms);
    }
    const movingMean = each.reduce((s, v) => s + v, 0) / each.length;
    const movingMax = Math.max(...each);

    let mesh = navMesh(freshField().field.arena, tuningOf(floorBattle()));
    const nav = median(
      () => ({ arena: freshField().field.arena, tuning: tuningOf(floorBattle()) }),
      ({ arena, tuning }) => {
        mesh = navMesh(arena, tuning);
      },
    );
    const ready = compile + at4.bf + at4.df + at4.dt + nav;
    report([
      `Delver spike Floor, build (median of ${RUNS} after a warm-up, flowCell ${base.battle.crowd.flowCell}):`,
      `  (1) compileMap (parse and walkCheck included)  ${fmt(compile)} ms`,
      `  (2) walkCheck alone                            ${fmt(walk)} ms`,
      `  (3) battlefieldOf                              ${fmt(at4.bf)} ms`,
      `  (4) destinationFields (10 Objectives, 2 Bases) ${fmt(at4.df)} ms`,
      `  (5) distanceTo x 20 room centres               ${fmt(at4.dt)} ms (${fmt(at4.dt / 20)} ms per field)`,
      `  (6) distanceTo x ${steps.length} moving (1 m apart)         mean ${fmt(movingMean)} ms, max ${fmt(movingMax)} ms`,
      `  (7) navMesh                                    ${fmt(nav)} ms (${mesh.out.length} polygons, ${mesh.links.length} links)`,
      `  nodes ${at4.nodes} (layered ${at4.layered}), ${f0.arena.walk.length} Walk Surfaces, ${f0.arena.walls.length} Walls`,
      `  Floor ready (1+3+4+5+7): ${fmt(ready)} ms`,
    ]);
    expect(ready).toBeLessThan(10_000);
  }, 600_000);

  it('measures the doorways: steps 3 to 5 at flowCell 4 and 2, and how many room-centre fields reach room 0', () => {
    const lines = [`Delver spike Floor, doorways (3 m doorways and passages):`];
    for (const cell of [4, 2]) {
      const r = buildAt(cell);
      const lost = r.reach.flatMap((d, k) => (d < 0 ? [`room${k}`] : []));
      lines.push(
        `  flowCell ${cell}: battlefieldOf ${fmt(r.bf)} ms, destinationFields ${fmt(r.df)} ms, 20 distanceTo ${fmt(r.dt)} ms (${fmt(r.dt / 20)} ms each), ${r.nodes} nodes; ` +
          `${r.reaching} of 20 room-centre fields reach room 0's centre${lost.length ? ` (not: ${lost.join(', ')})` : ''}`,
      );
    }
    report(lines);
  }, 600_000);
});

/**
 * `match` with the armies in rooms (a pure function): Team 1's four Squads (the enemies) at rooms 1, 2, 5 and 6, around the Player, Team 0's at 13, 14, 18 and 19, in Squad
 * order. An anchor goes to its room's centre, heading 0 for Team 0 and π for Team 1 (`aim` the same, `speed` 0); Soldier p of a Squad goes
 * to anchor + (((p mod 4) - 1.5) 1.5, (⌊p / 4⌋ - (rows - 1) / 2) 1.5) with velocity 0 and the Squad's heading. Every `surface` is the floor
 * `groundOf` finds (never the roof). The Player's Fighter goes to 5 m south of room 1's centre (among Team 1's Squads), its planted feet carried with it. Nothing else changes: the
 * Commander re-plans from there (a Soldier's `target` and `engage` are still the creation's: none).
 */
export function relocate(match: MatchState, tuning: TuningData, field: Battlefield): MatchState {
  const battle = tuning.battle;
  const crowd = match.duel.crowd!;
  const rooms = [[13, 14, 18, 19], [1, 2, 5, 6]];
  const sq = crowd.squads;
  const next = {
    x: [...sq.x],
    z: [...sq.z],
    heading: [...sq.heading],
    aim: [...sq.aim],
    speed: [...sq.speed],
    surface: [...sq.surface],
  };
  const taken = [0, 0];
  const room = sq.team.map((t) => SPIKE_ROOMS[rooms[t]![taken[t]!++]!]!);
  room.forEach((r, q) => {
    const turn = sq.team[q] === 0 ? 0 : Math.PI;
    next.x[q] = r.cx;
    next.z[q] = r.cz;
    next.heading[q] = turn;
    next.aim[q] = turn;
    next.speed[q] = 0;
    next.surface[q] = groundOf(battle, field, r.cx, r.cz, 0);
  });
  const size = sq.team.map((_, q) => crowd.squad.filter((s) => s === q).length);
  const x = [...crowd.x];
  const z = [...crowd.z];
  const vx = [...crowd.vx];
  const vz = [...crowd.vz];
  const heading = [...crowd.heading];
  const surface = [...crowd.surface];
  crowd.squad.forEach((q, i) => {
    if (q < 0) return;
    const p = crowd.place[i]!;
    const rows = Math.ceil(size[q]! / 4);
    x[i] = next.x[q]! + ((p % 4) - 1.5) * 1.5;
    z[i] = next.z[q]! + (Math.floor(p / 4) - (rows - 1) / 2) * 1.5;
    vx[i] = 0;
    vz[i] = 0;
    heading[i] = next.heading[q]!;
    surface[i] = groundOf(battle, field, x[i]!, z[i]!, 0);
  });
  const home = { cx: SPIKE_ROOMS[1]!.cx, cz: SPIKE_ROOMS[1]!.cz - 5 };
  const fighters = match.duel.fighters.map((f, k) => {
    if (k !== 0) return f;
    const dx = home.cx - f.position.x;
    const dz = home.cz - f.position.z;
    const shift = (foot: typeof f.gait.left) => ({
      ...foot,
      planted: { x: foot.planted.x + dx, z: foot.planted.z + dz },
      y: 0,
      step: foot.step ? { ...foot.step, target: { x: foot.step.target.x + dx, z: foot.step.target.z + dz }, y: 0 } : null,
    });
    return { ...f, position: { x: home.cx, z: home.cz }, y: 0, gait: { left: shift(f.gait.left), right: shift(f.gait.right) } };
  });
  return {
    ...match,
    duel: { ...match.duel, fighters, crowd: { ...crowd, x, z, vx, vz, heading, surface, squads: { ...sq, ...next } } },
  };
}

interface Scenario {
  readonly label: string;
  readonly tuning: TuningData;
  readonly arena: (seed: number) => string;
  readonly floor: boolean;
}

interface Played {
  readonly costs: number[];
  readonly bound: number[];
  readonly battles: { seed: number; intents: Intent[][]; final: string; ticks: number; winner: number | null; taken: number; foes: number }[];
}

const start = (s: Scenario, seed: number): MatchState => {
  const m = createMatch(s.tuning, { format: 'Battle', bestOf: 1, seed, teams: [0], arena: s.arena(seed) });
  return s.floor ? relocate(m, s.tuning, battlefieldOf(s.tuning.battle, s.arena(seed))!) : m;
};

/** 6,000 Ticks of Battles (a fresh one at the next seed if one ends), timing the controllers' Intents plus `stepMatch`. */
function play(s: Scenario): Played {
  const out: Played = { costs: [], bound: [], battles: [] };
  for (let seed = 1; out.costs.length < TICKS; seed++) {
    const controllers: Controller[] = poolControllers(s.tuning, [createBattlePilot(s.tuning, 'Hard')]);
    let m = start(s, seed);
    const b = { seed, intents: [] as Intent[][], final: '', ticks: 0, winner: null as number | null, taken: 0, foes: 0 };
    while (m.status.status === 'InProgress' && out.costs.length < TICKS) {
      const at = m;
      const t0 = performance.now();
      const intents = controllers.map((c, i) => c.intent(at.duel, i));
      m = stepMatch(at, intents, s.tuning);
      out.costs.push(performance.now() - t0);
      out.bound.push(m.duel.fighters.filter((f) => f.soldier).length);
      b.intents.push(intents);
    }
    b.final = hashValue(m);
    b.ticks = m.tick;
    const c = m.duel.crowd!;
    b.taken = c.players[0]!.taken;
    b.foes = c.alive.filter((a, i) => a === 1 && c.team[i] === 1).length;
    b.winner = m.status.status === 'Over' ? m.status.winner : null;
    out.battles.push(b);
  }
  return out;
}

function describePlay(label: string, p: Played): string[] {
  const sorted = [...p.costs].sort((a, b) => a - b);
  const mean = p.costs.reduce((s, v) => s + v, 0) / p.costs.length;
  const byBound = [[0, 3], [4, 7], [8, 11], [12, 15]].map(([lo, hi]) => {
    const at = p.costs.filter((_, k) => p.bound[k]! >= lo! && p.bound[k]! <= hi!);
    return `${lo}-${hi}: ${at.length ? fmt(at.reduce((s, v) => s + v, 0) / at.length) : '-'} ms (${at.length} Ticks)`;
  });
  return [
    `${label}: ${p.costs.length} Ticks in ${p.battles.length} Battle(s) (${p.battles.map((b) => `seed ${b.seed}: ${b.ticks} Ticks, ${b.winner === null ? 'unfinished' : `Team ${b.winner} won`}`).join('; ')})`,
    `  Tick mean ${fmt(mean)} ms, p50 ${fmt(sorted[sorted.length >> 1]!)} ms, p99 ${fmt(sorted[Math.floor(sorted.length * 0.99)]!)} ms, max ${fmt(sorted[sorted.length - 1]!)} ms; ` +
      `${p.costs.filter((c) => c > TICK_BUDGET_MS).length} over ${TICK_BUDGET_MS} ms, ${p.costs.filter((c) => c > FRAME_MS).length} over a frame (${fmt(FRAME_MS)} ms)`,
    `  Player's falls (takeovers) at the end: ${p.battles.map((b) => b.taken).join(', ')}; Team 1's living Soldiers at the end: ${p.battles.map((b) => b.foes).join(', ')}`,
    `  most slots bound at once ${Math.max(...p.bound)}; mean Tick by bound slots  ${byBound.join(' | ')}`,
  ];
}

const open: Scenario = { label: 'T0 open field', tuning: tuningOf(applyBattleKnobs(base.battle, { armySize: 50 })), arena: (seed) => `battle:${seed}`, floor: false };
const floor = (label: string, enemies?: number): Scenario => {
  const b = floorBattle();
  const battle = enemies === undefined ? b : { ...b, slots: { ...b.slots, enemies, allies: 3 } };
  return { label, tuning: tuningOf(battle), arena: () => ARENA, floor: true };
};

describe('the Delver spike Floor, Ticks', () => {
  it('T0: the open field, 100 Soldiers, the baseline', () => {
    const p = play(open);
    report(describePlay('T0 open field (battle:<seed>, armySize 50)', p));
    expect(p.costs).toHaveLength(TICKS);
  }, 600_000);

  it('T1: the Floor, a Run-sized Bubble (4 enemies, 3 allies); its replay hashes the same', () => {
    const s = floor('T1');
    const p = play(s);
    const lines = describePlay('T1 Floor, default slots (4 enemies, 3 allies)', p);
    for (const b of p.battles) {
      let m = start(s, b.seed);
      for (const intents of b.intents) m = stepMatch(m, intents, s.tuning);
      expect(hashValue(m), `seed ${b.seed}, the end`).toBe(b.final);
    }
    lines.push(`  replay from a fresh createMatch and relocate: ${p.battles.length} Battle(s), final hashes match`);
    report(lines);
    expect(p.costs).toHaveLength(TICKS);
  }, 600_000);

  it('T2: the Floor, a full Pool (12 enemies, 3 allies)', () => {
    const p = play(floor('T2', 12));
    report(describePlay('T2 Floor, full Pool (12 enemies, 3 allies)', p));
    expect(p.costs).toHaveLength(TICKS);
  }, 600_000);
});
