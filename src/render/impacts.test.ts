import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel, createInitialState, duelPlacements } from '../sim';
import { impactBursts } from './impacts';

const tuning = loadTuningData();

describe('impactBursts', () => {
  it('a Hit bursts where the blade connected', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const hit = run.states.flatMap((s) => s.events).find((e) => e.type === 'Hit')!;
    const bursts = run.states.flatMap((s) => impactBursts(s, tuning));
    expect(bursts).toEqual([{ kind: 'Hit', point: hit.point, strength: expect.any(Number) }]);
    expect(bursts[0]!.strength).toBeGreaterThan(0);
    expect(bursts[0]!.strength).toBeLessThanOrEqual(1);
  });

  it('a Block bursts where the blades meet, up by the blades rather than at the body', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    const bursts = run.states.flatMap((s) => impactBursts(s, tuning));
    expect(bursts.map((b) => b.kind)).toEqual(['Block']);
    expect(bursts[0]!.point.y).toBeGreaterThan(1);
  });

  it('a Heavy Blow bursts bigger than a plain Hit', () => {
    const run = runDuel(tuning, { distance: 1.4, weapons: ['Sledge Hammer', 'Arming Sword'], a: attack('Overhead'), b: [] });
    expect(run.states.flatMap((s) => impactBursts(s, tuning)).map((b) => b.kind)).toEqual(['Heavy']);
  });
});

describe('impactBursts for daggers', () => {
  const point = { x: 0.2, y: 1.1, z: 3 };
  const fighters = createInitialState(tuning, 1, duelPlacements(3)).fighters;

  it('a dagger Hit bursts like a Hit at the contact point, and a Blocked dagger bursts like a lighter Block', () => {
    const hit = impactBursts({ fighters, events: [{ type: 'DaggerHit', thrower: 0, defender: 1, zone: 'torso', point, damage: 5 }] }, tuning);
    const block = impactBursts({ fighters, events: [{ type: 'DaggerBlocked', thrower: 0, defender: 1, point }] }, tuning);
    expect(hit).toEqual([{ kind: 'Hit', point, strength: expect.any(Number) }]);
    expect(block).toEqual([{ kind: 'Block', point, strength: expect.any(Number) }]);
    for (const b of [...hit, ...block]) {
      expect(b.strength).toBeGreaterThan(0);
      expect(b.strength).toBeLessThanOrEqual(1);
    }
    expect(block[0]!.strength).toBeLessThan(1);
  });

  it('a dagger stuck in a wall makes no burst', () => {
    expect(impactBursts({ fighters, events: [{ type: 'DaggerStuck', point, direction: { x: 0, y: 0, z: 1 } }] }, tuning)).toEqual([]);
  });
});
