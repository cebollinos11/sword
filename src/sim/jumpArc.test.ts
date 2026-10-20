import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { arenaOf, createInitialState, jumpArc, jumpArcFrom, runScript, type Track } from './index';


const repo = loadTuningData();
const FORWARD = { x: 0, z: 1 };

/** A big floor, plus (when `edge` is given) a 10 m wide block of height `h` whose near edge is `edge` m ahead (as in jumpReach.measure.test.ts). */
function arena(edge: number | null, h: number, walls: unknown[] = []): TuningData {
  const walk = [{ id: 'WALK_floor', points: [[-20, 0, -20], [20, 0, -20], [20, 0, 40], [-20, 0, 40]] }];
  if (edge !== null) walk.push({ id: 'WALK_block', points: [[-5, h, edge], [5, h, edge], [5, h, edge + 4], [-5, h, edge + 4]] });
  return { ...repo, arenas: { ...repo.arenas, t: parseArena({ name: 't', walk, walls }, 't') } };
}

/** The Simulation's Jump: on the first Tick while walking along `move`, holding Jump for `holdTicks`, and keep walking. */
function simJump(t: TuningData, holdTicks: number, ticks: number, at = { x: 0, z: 0 }, move = FORWARD, name = 't', y = 0) {
  const track: Track = [
    { ticks: 1, intent: { move, jump: true, jumpHeld: holdTicks > 0 } },
    { ticks: Math.max(0, holdTicks - 1), intent: { move, jumpHeld: true } },
    { ticks, intent: { move } },
  ];
  return runScript(t, createInitialState(t, 1, [{ position: at, facing: Math.atan2(move.x, move.z), y }], [], [], name), [track], ticks);
}

describe('jumpArc predicts a Jump exactly as the Simulation runs it', () => {
  for (const hold of [0, 10, 15, 20, 25, 30]) {
    it(`on level ground, held ${hold} Ticks: same landing Tick, place and apex`, () => {
      const t = arena(null, 0);
      const sim = simJump(t, hold, 200);
      const land = sim.events.find((e) => e.type === 'Land')!;
      const simApex = Math.max(...sim.states.map((s) => s.fighters[0]!.y));
      const at = sim.states[land.tick]!.fighters[0]!;
      const arc = jumpArc(arenaOf(t, 't'), t, { at: { x: 0, z: 0 }, y: 0, heading: FORWARD, holdTicks: hold });
      expect(arc.ticks).toBe(land.tick);
      expect(arc.lands).not.toBeNull();
      expect(arc.lands!.x).toBeCloseTo(at.position.x, 9);
      expect(arc.lands!.z).toBeCloseTo(at.position.z, 9);
      expect(arc.lands!.y).toBe(at.y);
      expect(Math.max(...arc.path.map((p) => p.y))).toBeCloseTo(simApex, 9);
      expect(arc.path).toHaveLength(arc.ticks);
      expect(arc.surface).toBe(0);
      expect(arc.drop).toBeCloseTo((land as { height: number }).height, 9);
      expect(arc.damage).toBe(0);
      expect(arc.deadly).toBe(false);
    });
  }

  // Heights and distances around the edge of the reach table in docs/jump-reach.md.
  for (const [h, edge] of [
    [1, 4.0],
    [1, 4.1],
    [3, 3.4],
    [3, 3.5],
    [4.25, 2.55],
    [4.25, 2.65],
    [4.5, 1.0],
  ] as const) {
    it(`a full Jump at a ${h} m ledge ${edge} m ahead lands on it exactly when the Simulation does`, () => {
      const t = arena(edge, h);
      const sim = simJump(t, 60, 130);
      const landTick = sim.events.find((e) => e.type === 'Land')!.tick;
      const end = sim.states[landTick]!.fighters[0]!;
      const onLedge = Math.abs(end.y - h) < 1e-6;
      const arc = jumpArc(arenaOf(t, 't'), t, { at: { x: 0, z: 0 }, y: 0, heading: FORWARD, holdTicks: 60 });
      expect(arc.ticks).toBe(landTick);
      expect(arc.surface === 1).toBe(onLedge);
      expect(arc.lands!.y).toBe(end.y);
      expect(arc.lands!.z).toBeCloseTo(end.position.z, 9);
    });
  }

  it('stops under a Walk Surface overhead (the library bridge), as the Simulation does', () => {
    const sim = simJump(repo, 30, 150, { x: -5, z: 0 }, { x: 0, z: 0 }, 'library');
    const arc = jumpArc(arenaOf(repo, 'library'), repo, { at: { x: -5, z: 0 }, y: 0, heading: { x: 0, z: 0 }, holdTicks: 30 });
    expect(Math.max(...arc.path.map((p) => p.y))).toBe(Math.max(...sim.states.map((s) => s.fighters[0]!.y)));
    expect(arc.ticks).toBe(sim.events.find((e) => e.type === 'Land')!.tick);
    expect(arc.lands!.y).toBe(0);
  });

  it('lands on the east mezzanine through the gap in its rail, as the Simulation does', () => {
    const sim = simJump(repo, 30, 130, { x: 7, z: -4.25 }, { x: 1, z: 0 }, 'library');
    const end = sim.states[sim.events.find((e) => e.type === 'Land')!.tick]!.fighters[0]!;
    const arc = jumpArc(arenaOf(repo, 'library'), repo, { at: { x: 7, z: -4.25 }, y: 0, heading: { x: 1, z: 0 }, holdTicks: 30 });
    expect(arc.lands!.y).toBe(3);
    expect(arc.lands!.x).toBeCloseTo(end.position.x, 9);
  });

  it('is stopped by a Wall, as the Simulation is', () => {
    const t = arena(null, 0, [{ id: 'WALL_w', a: [-5, 1.5], b: [5, 1.5], bottom: 0, top: 5 }]);
    const sim = simJump(t, 30, 150);
    const land = sim.events.find((e) => e.type === 'Land')!;
    const at = sim.states[land.tick]!.fighters[0]!;
    const arc = jumpArc(arenaOf(t, 't'), t, { at: { x: 0, z: 0 }, y: 0, heading: FORWARD, holdTicks: 30 });
    expect(arc.ticks).toBe(land.tick);
    expect(arc.lands!.z).toBeCloseTo(at.position.z, 9);
    expect(arc.lands!.z).toBeLessThan(1.5);
  });

  it('a Jump onto Lava is deadly', () => {
    const tuning = repo;
    const arc = jumpArc(arenaOf(tuning, 'chamber'), tuning, { at: { x: 0, z: 7.2 }, y: 0, heading: FORWARD, holdTicks: 0 });
    expect(arc.deadly).toBe(true);
  });

  it('from mid-flight, predicts the rest of an unboosted Jump as the Simulation runs it', () => {
    const t = arena(null, 0);
    const sim = simJump(t, 0, 200);
    const land = sim.events.find((e) => e.type === 'Land')!;
    const mid = sim.states[10]!.fighters[0]!;
    const arc = jumpArcFrom(arenaOf(t, 't'), t, { at: mid.position, y: mid.y, air: mid.air!, move: FORWARD });
    expect(arc.ticks).toBe(land.tick - 10);
    expect(arc.lands!.z).toBeCloseTo(sim.states[land.tick]!.fighters[0]!.position.z, 9);
  });
});
