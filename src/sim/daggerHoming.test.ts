import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry, type TuningData } from '../tuning';
import { createInitialState, IDLE_INTENT, step, type DaggerState, type Placement, type SimState } from './index';
import type { SimEvent } from './events';

const base = loadTuningData();
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = {
  name: 'homing',
  walk: [{ id: 'floor', points: [corner(-60, -60), corner(-60, 60), corner(60, 60), corner(60, -60)] }],
  walls: [],
  spawns: [],
};
const tuning: TuningData = { ...base, arenas: { ...base.arenas, homing: flat } };
const noHoming: TuningData = { ...tuning, dagger: { ...tuning.dagger, homingTurn: 0 } };
const DEG = Math.PI / 180;

/** Thrower (Fighter 0) at the origin facing +z, and Fighter 1 `distance` away at `bearing` degrees off +z (toward +x). */
function pair(distance: number, bearing: number, teams = [0, 1]): SimState {
  const placements: Placement[] = [
    { position: { x: 0, z: 0 }, facing: 0 },
    { position: { x: Math.sin(bearing * DEG) * distance, z: Math.cos(bearing * DEG) * distance }, facing: Math.PI },
  ];
  return createInitialState(tuning, 1, placements, [], teams, 'homing');
}

/** A dagger at chest height in front of the thrower, flying straight along +z. */
const dart = (s: SimState): SimState => {
  const d: DaggerState = { owner: 0, team: s.fighters[0]!.team, thrownAt: 0, position: { x: 0, y: 1.3, z: 0.5 }, velocity: { x: 0, y: 0, z: tuning.dagger.speed }, ticks: 0 };
  return { ...s, daggers: [d] };
};

/** Fly the dagger out under `t`, collecting its path and every event. */
function flyOut(s: SimState, t: TuningData): { path: DaggerState[]; events: SimEvent[] } {
  const path: DaggerState[] = [];
  const events: SimEvent[] = [];
  for (let n = 0; n < 400 && s.daggers.length > 0; n++) {
    path.push(s.daggers[0]!);
    s = step(s, s.fighters.map(() => IDLE_INTENT), t);
    events.push(...s.events);
  }
  return { path, events };
}

const hit = (events: SimEvent[]) => events.some((e) => e.type === 'DaggerHit');

describe('Dagger Homing', () => {
  it('turns onto an enemy a little off its line that it would otherwise miss', () => {
    const s = dart(pair(10, 12));
    expect(hit(flyOut(s, noHoming).events)).toBe(false);
    expect(hit(flyOut(s, tuning).events)).toBe(true);
  });

  it('turns by at most homingTurn degrees a second, keeping its speed', () => {
    const { path } = flyOut(dart(pair(10, 20)), { ...tuning, dagger: { ...tuning.dagger, gravity: 0 } });
    const maxTurn = tuning.dagger.homingTurn / 60 + 1e-9;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!.velocity;
      const b = path[k]!.velocity;
      const la = Math.hypot(a.x, a.y, a.z);
      const lb = Math.hypot(b.x, b.y, b.z);
      expect(lb).toBeCloseTo(la, 9);
      const angle = Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb))) / DEG;
      expect(angle).toBeLessThanOrEqual(maxTurn);
    }
  });

  it('ignores an enemy outside its cone, so it never turns hard onto one beside it', () => {
    const s = dart(pair(4, 90));
    expect(flyOut(s, tuning).path).toEqual(flyOut(s, noHoming).path);
  });

  it('ignores an enemy beyond homingRange', () => {
    const s = dart(pair(tuning.dagger.homingRange + 5, 5));
    const homed = flyOut(s, tuning).path.slice(0, 5);
    expect(homed).toEqual(flyOut(s, noHoming).path.slice(0, 5));
  });

  it('does not home on a teammate', () => {
    const s = dart(pair(10, 12, [0, 0]));
    expect(flyOut(s, tuning).path).toEqual(flyOut(s, noHoming).path);
  });
});
