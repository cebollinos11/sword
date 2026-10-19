import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { hold, runDuel, wait, type HitEvent, type ScriptRun } from './index';

const repo = loadTuningData();

/**
 * Feints are Direction-agnostic. So the tests don't depend on which Attack
 * Motions exist in the repo, every Direction gets an Attack Motion here
 * (a copy of Overhead under that Direction's name, unless the repo has one).
 */
const tuning: TuningData = {
  ...repo,
  motions: {
    ...Object.fromEntries(['Left', 'Right', 'Thrust'].map((name) => [name, { ...repo.motions.Overhead!, name }])),
    ...repo.motions,
  },
};

const eventsOf = (run: ScriptRun, type: string) => run.events.filter((e) => e.type === type);
const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead, facing back. */
const placements = (d: number) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: d }, facing: Math.PI },
];
const FAR = placements(5);

describe('Feint', () => {
  it('changing Direction while holding a Wind-up cancels it and starts the new Attack’s Wind-up', () => {
    const run = runDuel(tuning, {
      placements: FAR,
      a: [...hold(30, { attack: true, direction: 'Overhead' }), ...hold(10, { attack: true, direction: 'Left' })],
      b: wait(1),
    });
    expect(run.states[30]!.fighters[0]!.action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up' });
    expect(run.states[31]!.fighters[0]!.action).toEqual({ kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false });
    expect(run.states[31]!.fighters[0]!.motion).toMatchObject({ name: 'Left', tick: 0 });
    expect(run.states[31]!.events).toEqual([
      { type: 'Feint', fighter: 0, from: 'Overhead', into: { kind: 'Attack', direction: 'Left' } },
      { type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Wind-up' },
    ]);
  });

  it('pressing block during a Wind-up cancels it into a Block in the Intent’s Direction', () => {
    const run = runDuel(tuning, {
      placements: FAR,
      a: [...hold(10, { attack: true, direction: 'Overhead' }), ...hold(20, { attack: true, block: true, direction: 'Right' })],
      b: wait(1),
    });
    expect(run.states[10]!.fighters[0]!.action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up' });
    expect(run.states[11]!.fighters[0]!.action).toMatchObject({ kind: 'Block', direction: 'Right' });
    expect(run.states[11]!.fighters[0]!.motion).toMatchObject({ name: 'BlockRight', tick: 0 });
    expect(run.states[11]!.events).toEqual([{ type: 'Feint', fighter: 0, from: 'Overhead', into: { kind: 'Block', direction: 'Right' } }]);
    // The cancelled Attack never swings.
    expect(run.events.filter((e) => e.type === 'AttackPhase' && e.phase === 'Release')).toEqual([]);
  });

  it('a Block Feint stops an incoming Attack like any Block', () => {
    // Fighter 1 starts an Overhead, sees Fighter 0's Overhead coming, and Feints into an Overhead Block.
    const run = runDuel(tuning, {
      placements: placements(1.3),
      a: [...wait(10), ...hold(1, { attack: true }), ...wait(1)],
      b: [...hold(10, { attack: true }), ...hold(100, { attack: true, block: true })],
    });
    expect(hitsOf(run)).toEqual([]);
    expect(eventsOf(run, 'Block')).toEqual([{ type: 'Block', attacker: 0, defender: 1, direction: 'Overhead', perfect: false, point: expect.any(Object), bladeSpeed: expect.any(Number), tick: expect.any(Number) }]);
  });

  it('an Attack Feint gets past a Block in the original Direction', () => {
    const run = runDuel(tuning, {
      placements: placements(1.3),
      a: [...hold(15, { attack: true, direction: 'Overhead' }), ...hold(1, { attack: true, direction: 'Left' }), ...wait(1)],
      b: hold(200, { block: true, direction: 'Overhead' }),
    });
    expect(eventsOf(run, 'Feint')).toHaveLength(1);
    expect(eventsOf(run, 'Block')).toEqual([]);
    expect(hitsOf(run)).toEqual([expect.objectContaining({ attacker: 0, defender: 1, direction: 'Left' })]);
  });

  it('Release and Recovery are committed: changing Direction or pressing block does not cancel them', () => {
    const run = runDuel(tuning, {
      placements: FAR,
      a: [...hold(1, { attack: true, direction: 'Overhead' }), ...wait(25), ...hold(34, { attack: true, block: true, direction: 'Left' }), ...wait(1)],
      b: wait(1),
    });
    expect(eventsOf(run, 'Feint')).toEqual([]);
    const phases = run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 0).map((e) => (e as { phase: string }).phase);
    expect(phases.slice(0, 3)).toEqual(['Wind-up', 'Release', 'Recovery']);
  });

  it('a Wind-up whose attack was already let go (a buffered Release) ignores a Direction change', () => {
    const run = runDuel(tuning, {
      placements: FAR,
      a: [...hold(1, { attack: true, direction: 'Overhead' }), ...hold(10, { direction: 'Left' })],
      b: wait(1),
    });
    expect(eventsOf(run, 'Feint')).toEqual([]);
    expect(run.events.filter((e) => e.type === 'AttackPhase' && e.phase === 'Release')).toEqual([
      expect.objectContaining({ fighter: 0, direction: 'Overhead' }),
    ]);
  });

  it('holding a Wind-up in the same Direction is not a Feint', () => {
    const run = runDuel(tuning, { placements: FAR, a: hold(60, { attack: true, direction: 'Thrust' }), b: wait(1) });
    expect(eventsOf(run, 'Feint')).toEqual([]);
    expect(run.states[60]!.fighters[0]!.action).toMatchObject({ kind: 'Attack', direction: 'Thrust', phase: 'Wind-up' });
  });
});
