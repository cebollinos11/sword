import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, DIRECTIONS, duelPlacements, hold, mirrorDirection, wait, type Track } from '../sim';
import { dummyController, runControllers, scriptedController, wallController } from './index';

const tuning = loadTuningData();
const DISTANCE = 1.3; // every Direction hits from here (see directions.test.ts)

function vs(opponent: ReturnType<typeof dummyController>, a: Track, ticks: number, placements = duelPlacements(DISTANCE)) {
  return runControllers(tuning, createInitialState(tuning, 1, placements), [scriptedController(a), opponent], ticks);
}

describe('Test opponent: Dummy', () => {
  it('never moves, attacks or blocks, so every Attack lands', () => {
    const a: Track = DIRECTIONS.flatMap((d) => [...wait(70), ...attack(d)]);
    const run = vs(dummyController(), a, a.reduce((n, s) => n + s.ticks, 0) + 100);
    const start = run.states[0]!.fighters[1]!.position;
    expect(run.events.filter((e) => e.type === 'Hit' && e.defender === 1)).toHaveLength(DIRECTIONS.length);
    expect(run.events.some((e) => e.type === 'Block')).toBe(false);
    expect(run.states.every((s) => s.fighters[1]!.action.kind !== 'Attack' && s.fighters[1]!.action.kind !== 'Block')).toBe(true);
    expect(run.states.every((s) => s.fighters[1]!.position.x === start.x)).toBe(true);
  });
});

describe('Test opponent: Wall', () => {
  for (const direction of DIRECTIONS) {
    it(`Blocks an instant ${direction} Attack (no Reaction Time)`, () => {
      const run = vs(wallController(), [...wait(30), ...attack(direction)], 200);
      expect(run.events.filter((e) => e.type === 'Block')).toEqual([expect.objectContaining({ defender: 1, direction })]);
      expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
    });
  }

  it('Blocks a whole string of Attacks in varying Directions and is never hit', () => {
    const dirs = [...DIRECTIONS, ...DIRECTIONS].reverse();
    const a: Track = dirs.flatMap((d, i) => [...wait(60), ...attack(d, 1 + ((i * 17) % 40))]);
    const run = vs(wallController(), a, a.reduce((n, s) => n + s.ticks, 0) + 100);
    expect(run.events.filter((e) => e.type === 'Block').map((e) => (e.type === 'Block' ? e.direction : null))).toEqual(dirs);
    expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });

  it('follows an Attack Feint into the new Direction', () => {
    const a: Track = [...wait(30), ...hold(40, { attack: true, direction: 'Overhead' }), ...hold(1, { attack: true, direction: 'Left' })];
    const run = vs(wallController(), a, 200);
    expect(run.events.filter((e) => e.type === 'Block')).toEqual([expect.objectContaining({ defender: 1, direction: 'Left' })]);
  });

  it('holds a Block the whole time, in the Direction meeting the visible Attack', () => {
    const run = vs(wallController(), [...wait(30), ...hold(20, { attack: true, direction: 'Right' })], 50);
    const wall = run.final.fighters[1]!.action;
    expect(wall).toMatchObject({ kind: 'Block', direction: mirrorDirection('Right') });
  });

  it('turns to face an attacker who starts beside it, without walking', () => {
    const placements = [
      { position: { x: 1.3, z: 0 }, facing: -Math.PI / 2 },
      { position: { x: 0, z: 0 }, facing: 0 },
    ];
    const run = vs(wallController(), [...wait(40), ...attack('Overhead')], 200, placements);
    expect(run.events.some((e) => e.type === 'Block' && e.defender === 1)).toBe(true);
    expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });
});
