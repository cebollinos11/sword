import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel, createInitialState, duelPlacements } from '../sim';
import { dustPuffs, impactBursts } from './impacts';

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

describe('impactBursts for a Chamber', () => {
  const point = { x: 0.1, y: 1.4, z: 0.6 };
  const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;

  it('a Chamber bursts at full strength where the blades met', () => {
    const bursts = impactBursts({ fighters, events: [{ type: 'Chamber', chamberer: 1, attacker: 0, direction: 'Overhead', point }] }, tuning);
    expect(bursts).toEqual([{ kind: 'Chamber', point, strength: 1 }]);
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

describe('dustPuffs', () => {
  const fighters = createInitialState(tuning, 1, duelPlacements(3)).fighters;
  const feet = { x: fighters[0]!.position.x, y: fighters[0]!.y, z: fighters[0]!.position.z };

  it('a Jump and a Landing kick up dust at the Fighter\'s feet, a bigger drop a bigger puff', () => {
    const jump = dustPuffs(1, { fighters, events: [{ type: 'Jump', fighter: 0 }] });
    const small = dustPuffs(1, { fighters, events: [{ type: 'Land', fighter: 0, height: 0.2, damage: 0 }] });
    const big = dustPuffs(1, { fighters, events: [{ type: 'Land', fighter: 0, height: 3, damage: 0 }] });
    expect(jump).toEqual([{ kind: 'Jump', point: feet, strength: expect.any(Number) }]);
    expect(big[0]!.strength).toBeGreaterThan(small[0]!.strength);
    expect(big[0]!.strength).toBeLessThanOrEqual(1);
  });

  it('a Fighter hitting the floor and a Kick landing puff at the victim, not the attacker', () => {
    const down = dustPuffs(1, { fighters, events: [{ type: 'KnockdownPhase', fighter: 1, phase: 'Down' }] });
    expect(down).toEqual([{ kind: 'Down', point: { x: fighters[1]!.position.x, y: fighters[1]!.y, z: fighters[1]!.position.z }, strength: 1 }]);
    const kick = dustPuffs(1, { fighters, events: [{ type: 'KickLanded', attacker: 0, defender: 1, outcome: 'Shove', zone: 'torso', point: feet, damage: 0 }] });
    expect(kick.map((p) => p.kind)).toEqual(['Shove']);
    expect(kick[0]!.point.z).toBe(fighters[1]!.position.z);
  });

  it('a Fighter being pushed along the floor scuffs it every few Ticks', () => {
    const sliding = fighters.map((f, i) => (i === 1 ? { ...f, slide: { vx: 0, vz: 3, ticks: 10 } } : f));
    expect(dustPuffs(3, { fighters: sliding, events: [] }).map((p) => p.kind)).toEqual(['Scuff']);
    expect(dustPuffs(4, { fighters: sliding, events: [] })).toEqual([]);
  });
});
