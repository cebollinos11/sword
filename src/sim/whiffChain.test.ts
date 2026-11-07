/**
 * Whiff Chain: an Attack that landed nothing, with attack pressed again during
 * its Release and still held as Release ends, skips its Recovery. The next
 * Attack starts on the Tick after Release ends, blending from the end of the
 * swing straight to its held Wind-up pose.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, fighterPose, hold, runDuel, wait, type ScriptRun, type Track } from './index';
import { attackTimings } from './actions';

const tuning = loadTuningData();
const solo = (a: Track) => runDuel(tuning, { placements: [{ position: { x: 0, z: 0 }, facing: 0 }], a });
const fighter = (run: ScriptRun, i: number) => run.states[i]!.fighters[0]!;
const hilt = (run: ScriptRun, i: number) => fighterPose(fighter(run, i), tuning).blade.hilt;
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function largestHandJump(run: ScriptRun, from = 1, to = run.states.length - 1): number {
  let largest = 0;
  for (let i = from; i <= to; i++) largest = Math.max(largest, dist(hilt(run, i - 1), hilt(run, i)));
  return largest;
}

const overhead = attackTimings(tuning, 'arming-sword', 'Overhead');
const left = attackTimings(tuning, 'arming-sword', 'Left');
// An Overhead tapped on Tick 0: state i shows the Motion's Tick i - 1, so Release ends (Recovery begins) in state 1 + releaseEnd.
const RECOVERY_AT = 1 + overhead.releaseEnd;
/** A Tick inside the Overhead's Release, when attack is pressed again. */
const PRESS = overhead.releaseEnd - 2;
const LET_GO = 160;
const pressedInRelease: Track = [...attack('Overhead', 1), ...wait(PRESS - 1), ...hold(LET_GO - PRESS, { attack: true, direction: 'Left' })];
const run = solo(pressedInRelease);
/** The same Left Attack pressed from guard, for comparison. */
const fresh = solo([...hold(LET_GO, { attack: true, direction: 'Left' })]);

describe('Whiff Chain', () => {
  it('the press lands inside Release', () => {
    expect(fighter(run, PRESS + 1).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Release' });
  });

  it('queues as Release ends, then starts the next Attack at once, skipping Recovery', () => {
    expect(fighter(run, RECOVERY_AT).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', whiffChain: 'Left' });
    expect(fighter(run, RECOVERY_AT + 1).action).toEqual({ kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false });
    expect(fighter(run, RECOVERY_AT + 1).motion).toMatchObject({ name: 'Left', tick: 0 });
    expect(fighter(run, RECOVERY_AT + 1).motion.blend).toBeDefined();
  });

  it('blends smoothly to the held Wind-up pose, reaching it on the usual Wind-up Tick', () => {
    const heldAt = RECOVERY_AT + 1 + left.windUpEnd;
    expect(fighter(run, heldAt).motion).toEqual({ name: 'Left', tick: left.windUpEnd });
    expect(fighter(run, heldAt - 1).motion.blend).toBeDefined();
    expect(dist(hilt(run, heldAt), hilt(fresh, 1 + left.windUpEnd))).toBeLessThan(1e-9);
    expect(largestHandJump(run, RECOVERY_AT, heldAt)).toBeLessThan(largestHandJump(fresh) * 1.5);
  });

  it('the chained Attack holds and Releases like any other', () => {
    expect(fighter(run, LET_GO).action).toMatchObject({ kind: 'Attack', direction: 'Left', phase: 'Wind-up' });
    expect(fighter(run, LET_GO + 2).action).toMatchObject({ kind: 'Attack', direction: 'Left', phase: 'Release' });
  });

  it('chains again off a second whiff', () => {
    const secondStart = RECOVERY_AT + 1;
    const secondRelease = secondStart + left.windUpEnd + 1;
    const secondPress = secondRelease + 1; // state index; its Intent is on Tick secondPress - 1
    const twice = solo([
      ...attack('Overhead', 1),
      ...wait(PRESS - 1),
      ...hold(secondStart - PRESS, { attack: true, direction: 'Left' }),
      ...wait(secondPress - 1 - secondStart),
      ...hold(60, { attack: true, direction: 'Thrust' }),
    ]);
    expect(fighter(twice, secondRelease).action).toMatchObject({ direction: 'Left', phase: 'Release' });
    const secondRecovery = secondStart + left.releaseEnd;
    expect(fighter(twice, secondRecovery).action).toMatchObject({ direction: 'Left', phase: 'Recovery', whiffChain: 'Thrust' });
    expect(fighter(twice, secondRecovery + 1).action).toMatchObject({ direction: 'Thrust', phase: 'Wind-up' });
  });

  it('a press only in Recovery is the old Chain: Recovery plays out in full', () => {
    const late = solo([...attack('Overhead', 1), ...wait(RECOVERY_AT - 1), ...hold(60, { attack: true, direction: 'Left' })]);
    expect(fighter(late, RECOVERY_AT).action).not.toHaveProperty('whiffChain');
    expect(fighter(late, RECOVERY_AT + 1).action).toMatchObject({ direction: 'Overhead', phase: 'Recovery', chain: { direction: 'Left' } });
    expect(fighter(late, 1 + overhead.end).action.kind).toBe('Idle');
  });

  it('a tap let go before Release ends does not chain', () => {
    const tap = solo([...attack('Overhead', 1), ...wait(PRESS - 1), ...hold(1, { attack: true, direction: 'Left' }), ...wait(60)]);
    expect(fighter(tap, RECOVERY_AT).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', landed: false });
    expect(fighter(tap, 1 + overhead.end).action.kind).toBe('Idle');
  });

  it('letting go on the first Tick of Recovery drops it: the Recovery plays on and ends on time', () => {
    const dropped = solo([...attack('Overhead', 1), ...wait(PRESS - 1), ...hold(RECOVERY_AT - PRESS, { attack: true, direction: 'Left' }), ...wait(60)]);
    expect(fighter(dropped, RECOVERY_AT).action).toMatchObject({ whiffChain: 'Left' });
    expect(fighter(dropped, RECOVERY_AT + 1).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', landed: false });
    expect(fighter(dropped, 1 + overhead.end).action.kind).toBe('Idle');
  });

  it('an Attack that lands does not skip its Recovery: the old Chain still works', () => {
    const duel = runDuel(tuning, { distance: 1.4, a: pressedInRelease, ticks: LET_GO });
    const a = (i: number) => duel.states[i]!.fighters[0]!.action;
    const landed = duel.states.some((s) => s.fighters[0]!.action.kind === 'Attack' && s.fighters[0]!.action.direction === 'Overhead' && s.fighters[0]!.action.landed);
    expect(landed).toBe(true);
    const nextStart = duel.states.findIndex((_, i) => i > 1 && a(i).kind === 'Attack' && (a(i) as { direction: string }).direction === 'Left');
    expect(nextStart).toBeGreaterThan(0);
    expect(a(nextStart - 1).kind).toBe('Idle');
  });
});
