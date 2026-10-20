/**
 * Heavy Blows: a Head contact at or above a Weapon's `heavyBlow.speed` × its reference Blade Speed knocks the
 * defender down and pushes it away; Blocked, it pushes the defender back and the Block holds.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { attack, hold, mirrorDirection, runDuel, type BlockEvent, type Direction, type HitEvent, type ScriptRun } from './index';

const tuning = loadTuningData();

const events = <T extends HitEvent | BlockEvent>(run: ScriptRun, type: T['type']): T[] =>
  run.states.flatMap((s) => s.events).filter((e): e is T => e.type === type);

/** How far Fighter 1 moved (m) along the ground from where the Duel placed it to its last Tick. */
const moved = (run: ScriptRun): number => {
  const [from, to] = [run.states[0]!.fighters[1]!.position, run.final.fighters[1]!.position];
  return Math.hypot(to.x - from.x, to.z - from.z);
};

/** `weapon` attacks in `d` from `distance` at an unarmoured, idle Arming Sword. */
const swing = (t: TuningData, weapon: string, d: Direction, distance: number) =>
  runDuel(t, { distance, weapons: [weapon, 'Arming Sword'], a: attack(d), b: [] });

/** The same, into a Block held in the matching Direction. */
const blocked = (t: TuningData, weapon: string, d: Direction, distance: number) =>
  runDuel(t, { distance, weapons: [weapon, 'Arming Sword'], a: attack(d), b: hold(150, { block: true, direction: mirrorDirection(d) }) });

describe('Heavy Hit', () => {
  it('a Sledge Hammer Head Hit at or above its Heavy Blow speed knocks the defender down and pushes it away by `knockdownSlide`', () => {
    const run = swing(tuning, 'Sledge Hammer', 'Overhead', 1.5);
    const [hit] = events<HitEvent>(run, 'Hit');
    const hammer = tuning.weapons['Sledge Hammer']!;
    expect(hit).toMatchObject({ head: true, heavy: true });
    expect(hit!.bladeSpeed).toBeGreaterThanOrEqual(hammer.heavyBlow.speed * hammer.speed);
    const at = run.states.findIndex((s) => s.events.includes(hit!));
    expect(run.states[at]!.fighters[1]!.action.kind).toBe('Knockdown');
    expect(moved(run)).toBeCloseTo(hammer.heavyBlow.knockdownSlide, 1);
  });

  it('the Halberd has a Heavy Blow too', () => {
    // At full damage its Head hit at this speed fells the defender outright, leaving nothing to push.
    const run = swing(withWeapon(tuning, { damage: 20 }, 'Halberd'), 'Halberd', 'Left', 1.7);
    expect(events<HitEvent>(run, 'Hit')[0]).toMatchObject({ head: true, heavy: true });
    expect(moved(run)).toBeCloseTo(tuning.weapons.Halberd!.heavyBlow.knockdownSlide, 1);
  });

  it('the same Hit below the Heavy Blow speed only Staggers', () => {
    const hammer = tuning.weapons['Sledge Hammer']!;
    const slower = withWeapon(tuning, { heavyBlow: { ...hammer.heavyBlow, speed: 3 } }, 'Sledge Hammer');
    const run = swing(slower, 'Sledge Hammer', 'Overhead', 1.5);
    const [hit] = events<HitEvent>(run, 'Hit');
    expect(hit).toMatchObject({ head: true, heavy: false });
    expect(run.states.find((s) => s.events.includes(hit!))!.fighters[1]!.action.kind).toBe('Stagger');
    expect(moved(run)).toBeLessThan(0.05);
  });

  it('a fast Hit with the shaft behind the Head is never a Heavy Blow', () => {
    const run = swing(tuning, 'Halberd', 'Right', 1.5);
    const [hit] = events<HitEvent>(run, 'Hit');
    const halberd = tuning.weapons.Halberd!;
    expect(hit!.head).toBe(false);
    expect(hit!.bladeSpeed).toBeGreaterThanOrEqual(halberd.heavyBlow.speed * halberd.speed);
    expect(hit!.heavy).toBe(false);
  });

  it('a Weapon without a Heavy Blow never knocks down, however fast', () => {
    for (const d of ['Overhead', 'Left', 'Right'] as Direction[]) {
      for (const distance of [1.2, 1.5]) expect(events<HitEvent>(swing(tuning, 'Longsword', d, distance), 'Hit').every((h) => !h.heavy)).toBe(true);
    }
  });
});

describe('Heavy Blow Blocked', () => {
  it('pushes the defender back by `blockSlide`, its Block holding, and the attacker recoils as from any Block', () => {
    const run = blocked(tuning, 'Sledge Hammer', 'Overhead', 1.7);
    const [block] = events<BlockEvent>(run, 'Block');
    expect(block).toMatchObject({ heavy: true });
    const at = run.states.find((s) => s.events.includes(block!))!;
    expect(at.fighters[1]!.action.kind).toBe('Block');
    expect(at.fighters[0]!.action.kind).toBe('Stagger');
    expect(events<HitEvent>(run, 'Hit')).toEqual([]);
    expect(moved(run)).toBeCloseTo(tuning.weapons['Sledge Hammer']!.heavyBlow.blockSlide, 2);
  });

  it('a slower Blocked blow does not push', () => {
    const run = blocked(tuning, 'Sledge Hammer', 'Overhead', 1.3);
    expect(events<BlockEvent>(run, 'Block')[0]).toMatchObject({ heavy: false });
    expect(moved(run)).toBeLessThan(1e-9);
  });
});
