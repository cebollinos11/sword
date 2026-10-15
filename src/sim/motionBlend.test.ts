/**
 * Motion Blend: whenever a Fighter's Motion changes (Block → Idle, a Feint,
 * a Stagger, Recovery → Idle), the pose crossfades out of where the last Motion
 * left it instead of snapping (`fighter.motionBlend`, Tuning Data).
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attack, fighterPose, hold, runDuel, wait, type ScriptRun, type Track } from './index';

const tuning = loadTuningData();
/** The same Tuning Data with the Motion Blend effectively off (one Tick: an instant switch). */
const snapping: TuningData = { ...tuning, fighter: { ...tuning.fighter, motionBlend: 1 / 1000 } };

/** The largest distance the sword hand moves in one Tick, over the whole run. */
function largestHandJump(run: ScriptRun, t: TuningData, fighter = 0): number {
  let largest = 0;
  for (let i = 1; i < run.states.length; i++) {
    const a = fighterPose(run.states[i - 1]!.fighters[fighter]!, t).blade.hilt;
    const b = fighterPose(run.states[i]!.fighters[fighter]!, t).blade.hilt;
    largest = Math.max(largest, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return largest;
}

const solo = (a: Track, t: TuningData) => runDuel(t, { placements: [{ position: { x: 0, z: 0 }, facing: 0 }], a });

describe('Motion Blend', () => {
  it('letting go of a Block eases back to Idle instead of snapping', () => {
    const script: Track = [...hold(40, { block: true, direction: 'Left' }), ...wait(40)];
    const snap = largestHandJump(solo(script, snapping), snapping);
    const smooth = largestHandJump(solo(script, tuning), tuning);
    expect(snap).toBeGreaterThan(0.1);
    expect(smooth).toBeLessThan(snap / 3);
  });

  it('a Block Feint out of a Wind-up eases into the Block', () => {
    const script: Track = [...attack('Overhead', 15), ...hold(30, { block: true, direction: 'Right' }), ...wait(40)];
    const snap = largestHandJump(solo(script, snapping), snapping);
    const smooth = largestHandJump(solo(script, tuning), tuning);
    expect(smooth).toBeLessThan(snap / 2);
  });

  it('the blend ends: once it is over the Fighter plays its Motion exactly', () => {
    const run = solo([...hold(40, { block: true, direction: 'Left' }), ...wait(40)], tuning);
    expect(run.states[41]!.fighters[0]!.motion.blend).toBeDefined();
    expect(run.final.fighters[0]!.motion).toEqual({ name: 'Idle', tick: expect.any(Number) });
  });
});
