/**
 * Chain: holding attack during Recovery blends the pose straight toward the
 * next Attack's Wind-up instead of back to guard. The rules don't change:
 * Recovery, the Idle Tick after it and the next Wind-up last exactly as long.
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

/** The largest distance the sword hand moves in one Tick between states `from` and `to`. */
function largestHandJump(run: ScriptRun, from = 1, to = run.states.length - 1): number {
  let largest = 0;
  for (let i = from; i <= to; i++) largest = Math.max(largest, dist(hilt(run, i - 1), hilt(run, i)));
  return largest;
}

const overhead = attackTimings(tuning, 'arming-sword', 'Overhead');
/** An Overhead tapped on Tick 1, then attack pressed again in Left this many Ticks later (well into Recovery). */
const PRESS_AGAIN = overhead.releaseEnd + 6;
/** Attack is let go on this Tick in both runs below. */
const LET_GO = 160;
const chained: Track = [...attack('Overhead', 1), ...wait(PRESS_AGAIN - 1), ...hold(LET_GO - PRESS_AGAIN, { attack: true, direction: 'Left' })];
const run = solo(chained);
/** The first state in which the Overhead is over (Idle). */
const idleAt = run.states.findIndex((s, i) => i > 1 && s.fighters[0]!.action.kind === 'Idle');
/** The same two Attacks, but the second pressed only once the first is over: no Chain. */
const unchained = solo([...attack('Overhead', 1), ...wait(idleAt - 1), ...hold(LET_GO - idleAt, { attack: true, direction: 'Left' })]);

describe('Chain', () => {
  it('holding attack during Recovery Chains, showing the next Attack', () => {
    expect(fighter(run, PRESS_AGAIN + 1).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', chain: { direction: 'Left' } });
    expect(fighter(run, PRESS_AGAIN + 1).motion).toMatchObject({ name: 'Left', tick: 0 });
  });

  it('keeps every timing: Recovery, the Idle Tick and the next Wind-up last as long as without a Chain', () => {
    expect(idleAt).toBe(1 + overhead.end);
    for (let i = 0; i < run.states.length; i++) {
      const { chain: _chain, ...action } = fighter(run, i).action as { chain?: unknown };
      expect(action, `Tick ${i}`).toEqual(fighter(unchained, i).action);
    }
  });

  it('the blade cuts across instead of going back to guard', () => {
    const guard = hilt(unchained, idleAt);
    const nearest = (r: ScriptRun) => Math.min(...Array.from({ length: idleAt - PRESS_AGAIN }, (_, k) => dist(hilt(r, PRESS_AGAIN + 1 + k), guard)));
    expect(nearest(unchained)).toBeLessThan(0.01);
    expect(nearest(run)).toBeGreaterThan(0.1);
  });

  it('stays smooth, and ends exactly on the Wind-up’s held pose', () => {
    expect(largestHandJump(run)).toBeLessThan(largestHandJump(unchained) * 1.5);
    const left = attackTimings(tuning, 'arming-sword', 'Left');
    const heldAt = idleAt + 1 + left.windUpEnd;
    expect(fighter(run, heldAt).motion).toEqual({ name: 'Left', tick: left.windUpEnd });
    expect(fighter(run, heldAt - 1).motion.blend).toBeDefined();
    expect(dist(hilt(run, heldAt), hilt(unchained, heldAt))).toBeLessThan(1e-9);
  });

  it('letting go drops the Chain: the Recovery plays on, smoothly, and ends on time', () => {
    const dropped = solo([...attack('Overhead', 1), ...wait(PRESS_AGAIN - 1), ...hold(8, { attack: true, direction: 'Left' }), ...wait(60)]);
    expect(fighter(dropped, PRESS_AGAIN + 9).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', landed: false });
    expect(fighter(dropped, idleAt).action.kind).toBe('Idle');
    expect(fighter(dropped, idleAt + 1).action.kind).toBe('Idle');
    expect(largestHandJump(dropped)).toBeLessThan(largestHandJump(unchained) * 1.5);
  });
});
