import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { createInitialState, hold, runScript, walk, type Placement, type ScriptRun, type Track } from './index';

const repo = loadTuningData();

/**
 * A floor (x, z -10..10 at 0) with three blocks to drop from, all with open ledges:
 *   - ledge:  x -1..1,  z 4..6   at 1   (a soft Landing)
 *   - tower:  x 2..4,   z -1..1  at 2.5 (a hard one)
 *   - spire:  x -6..-4, z -1..1  at 10  (a fatal one)
 */
const tuning: TuningData = {
  ...repo,
  arenas: {
    ...repo.arenas,
    drops: parseArena(
      {
        name: 'drops',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
          { id: 'WALK_ledge', points: [[-1, 1, 4], [1, 1, 4], [1, 1, 6], [-1, 1, 6]] },
          { id: 'WALK_tower', points: [[2, 2.5, -1], [4, 2.5, -1], [4, 2.5, 1], [2, 2.5, 1]] },
          { id: 'WALK_spire', points: [[-6, 10, -1], [-4, 10, -1], [-4, 10, 1], [-6, 10, 1]] },
        ],
        walls: [],
      },
      'drops',
    ),
  },
};
const fall = tuning.fall;

function run(placement: Placement, track: Track, ticks: number): ScriptRun {
  return runScript(tuning, createInitialState(tuning, 1, [placement], [], [], 'drops'), [track], ticks);
}

/** Walk east off the block a Fighter stands in the middle of. */
const walkOff = (x: number, z: number, y: number) => run({ position: { x, z }, facing: Math.PI / 2, y }, walk(40, { x: 1, z: 0 }), 240);

const landing = (r: ScriptRun) => r.events.find((e) => e.type === 'Land')!;

describe('Falling and Landing', () => {
  it('a drop within the safe height lands softly: no damage, and the Fall ends in Idle', () => {
    const r = walkOff(0, 5, 1);
    const land = landing(r);
    expect(land).toMatchObject({ fighter: 0, damage: 0 });
    expect(land.type === 'Land' && land.height).toBeCloseTo(1, 9);
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.hp).toBe(repo.fighter.maxHp);
    expect(after.action.kind).toBe('Idle');
    expect(r.events.some((e) => e.type === 'Stagger')).toBe(false);
  });

  it('a deeper drop hurts by the metre beyond the safe height, and Staggers the Fighter (Landed)', () => {
    const r = walkOff(3, 0, 2.5);
    const land = landing(r);
    const expected = (2.5 - fall.safeHeight) * fall.damagePerMetre;
    expect(land.type === 'Land' && land.damage).toBeCloseTo(expected, 9);
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.hp).toBeCloseTo(repo.fighter.maxHp - expected, 9);
    expect(after.action).toEqual({ kind: 'Stagger', cause: 'Landed' });
    expect(after.motion.name).toBe('Land');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Landed', tick: land.tick }));
  });

  it('damage grows linearly with the drop', () => {
    const damage = (h: number) => Math.max(0, h - fall.safeHeight) * fall.damagePerMetre;
    const r = walkOff(3, 0, 2.5);
    const land = landing(r);
    expect(land.type === 'Land' && land.damage).toBeCloseTo(damage(land.type === 'Land' ? land.height : 0), 9);
    expect(damage(fall.safeHeight + 2) - damage(fall.safeHeight + 1)).toBeCloseTo(fall.damagePerMetre, 9);
  });

  it('a fatal fall fells the Fighter, with cause Fall and no blow', () => {
    const r = walkOff(-5, 0, 10);
    const land = landing(r);
    const after = r.states[land.tick]!;
    expect(after.fighters[0]!.hp).toBe(0);
    expect(after.fighters[0]!.death).toEqual({ tick: land.tick, cause: 'Fall', blow: null });
    expect(after.duel.status).toBe('Over');
  });

  it('walking off a ledge Falls only after the fall delay', () => {
    const r = walkOff(3, 0, 2.5);
    const off = r.states.findIndex((s) => s.fighters[0]!.air);
    const fell = r.states.findIndex((s) => s.fighters[0]!.action.kind === 'Fall');
    expect(off).toBeGreaterThan(0);
    expect(fell - off).toBe(secondsToTicks(fall.fallDelay));
  });

  it('a Jump rises about jumpSpeed² / 2·gravity, Falls all the way, and lands where it took off', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, hold(1, { jump: true }), 120);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'Jump', fighter: 0, tick: 1 }));
    const apex = Math.max(...r.states.map((s) => s.fighters[0]!.y));
    expect(apex).toBeCloseTo(fall.jumpSpeed ** 2 / (2 * fall.gravity), 1);
    const land = landing(r);
    for (let t = 1; t < land.tick; t++) expect(r.states[t]!.fighters[0]!.action.kind, `Tick ${t}`).toBe('Fall');
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.y).toBe(0);
    expect(after.action.kind).toBe('Idle');
    expect(land.type === 'Land' && land.damage).toBe(0);
  });

  it('a Jump carries the walk with it', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true, move: { x: 0, z: 1 } } }, ...walk(119, { x: 0, z: 1 })], 120);
    const land = landing(r);
    const z = r.states[land.tick]!.fighters[0]!.position.z;
    const airborne = land.tick - 1;
    expect(z).toBeCloseTo((repo.fighter.walkSpeed * airborne) / 60, 1);
  });

  it('a jumper can Attack in the air, but cannot Jump again', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true } }, { ticks: 20, intent: { attack: true, direction: 'Overhead', jump: true } }], 21);
    expect(r.states[5]!.fighters[0]!.action.kind).toBe('Attack');
    expect(r.states[5]!.fighters[0]!.air).toBeDefined();
    expect(r.events.filter((e) => e.type === 'Jump')).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'AttackPhase')).toBe(true);
  });

  it('a jumper can Block in the air', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true } }, { ticks: 10, intent: { block: true, direction: 'Overhead' } }], 11);
    expect(r.states[5]!.fighters[0]!.action.kind).toBe('Block');
    expect(r.states[5]!.fighters[0]!.air).toBeDefined();
  });

  it('a Fighter can Jump out of an Attack, which carries on in the air', () => {
    const r = run(
      { position: { x: 0, z: 0 }, facing: 0 },
      [{ ticks: 3, intent: { attack: true, direction: 'Overhead' } }, { ticks: 1, intent: { attack: true, direction: 'Overhead', jump: true } }, { ticks: 5, intent: {} }],
      9,
    );
    const jumped = r.events.find((e) => e.type === 'Jump')!;
    expect(r.states[jumped.tick]!.fighters[0]!.action.kind).toBe('Attack');
    expect(r.states[jumped.tick]!.fighters[0]!.air).toBeDefined();
  });

  it('a Fighter that walked off a ledge still cannot Attack in the air', () => {
    const r = run({ position: { x: 3.9, z: 0 }, facing: Math.PI / 2, y: 2.5 }, [...walk(10, { x: 1, z: 0 }), { ticks: 30, intent: { attack: true, direction: 'Overhead', move: { x: 1, z: 0 } } }], 40);
    const off = r.states.findIndex((s) => s.fighters[0]!.air);
    expect(off).toBeGreaterThan(0);
    for (let t = off; t < r.states.length; t++) {
      const f = r.states[t]!.fighters[0]!;
      if (f.air) expect(f.action.kind, `Tick ${t}`).not.toBe('Attack');
    }
  });
});
