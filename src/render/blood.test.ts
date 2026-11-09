import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, runDuel, createInitialState, duelPlacements } from '../sim';
import { bloodSpurts } from './blood';

const tuning = loadTuningData();

describe('bloodSpurts', () => {
  it('a Hit sprays from the wound, away from the attacker', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const hit = run.states.flatMap((s) => s.events).find((e) => e.type === 'Hit')!;
    const spurts = run.states.flatMap((s) => bloodSpurts(s));
    expect(spurts).toHaveLength(1);
    const [s] = spurts;
    expect(s!.point).toEqual(hit.point);
    expect(Math.hypot(s!.dir.x, s!.dir.z)).toBeCloseTo(1);
    // Fighter 0 attacks fighter 1 from the other side: the spray points from 0 towards 1.
    const f = run.states.at(-1)!.fighters;
    const away = { x: f[1]!.position.x - f[0]!.position.x, z: f[1]!.position.z - f[0]!.position.z };
    expect(s!.dir.x * away.x + s!.dir.z * away.z).toBeGreaterThan(0);
  });

  it('a Heavy Blow sprays at full strength', () => {
    const run = runDuel(tuning, { distance: 1.4, weapons: ['Sledge Hammer', 'Arming Sword'], a: attack('Overhead'), b: [] });
    expect(run.states.flatMap((s) => bloodSpurts(s)).map((s) => s.strength)).toEqual([1]);
  });

  it('a Block, a Chamber or no event sprays nothing', () => {
    const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;
    const point = { x: 0, y: 1.4, z: 0.6 };
    expect(bloodSpurts({ fighters, events: [{ type: 'Chamber', chamberer: 1, attacker: 0, direction: 'Overhead', point }] })).toEqual([]);
    expect(bloodSpurts({ fighters, events: [] })).toEqual([]);
  });
});
