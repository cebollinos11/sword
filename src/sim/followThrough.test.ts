import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { motionTargets } from './motion';
import { attack, attackTimings, DIRECTIONS, runDuel, wait, type ScriptRun } from './index';

const tuning = loadTuningData();

/** The shipped Tuning Data with every Attack Motion's follow-through (the Pose Keys between `releaseEnd` and the last) taken out. */
function withoutFollowThrough(t: TuningData): TuningData {
  const motions = { ...t.motions };
  for (const name of DIRECTIONS) {
    const m = motions[name]!;
    const last = m.poseKeys[m.poseKeys.length - 1]!;
    motions[name] = { ...m, poseKeys: m.poseKeys.filter((k) => k.time <= m.markers.releaseEnd! || k === last) };
  }
  return { ...t, motions };
}

const plain = withoutFollowThrough(tuning);
const hitsOf = (run: ScriptRun) => run.events.filter((e) => e.type === 'Hit' || e.type === 'Block' || e.type === 'WallStrike');

describe('Attack follow-through', () => {
  it('every Attack Motion has one, after Release and before the end, without moving its markers or length', () => {
    for (const name of DIRECTIONS) {
      const [m, p] = [tuning.motions[name]!, plain.motions[name]!];
      expect(m.poseKeys.length, name).toBe(p.poseKeys.length + 1);
      expect(m.duration, name).toBe(p.duration);
      expect(m.markers, name).toEqual(p.markers);
    }
  });

  it('leaves every Weapon\'s Wind-up and Release pose untouched, up to and including the last Tick the Blade Sweep is live', () => {
    for (const weapon of Object.keys(tuning.weapons))
      for (const direction of DIRECTIONS) {
        const { releaseEnd } = attackTimings(tuning, weapon, direction);
        expect(attackTimings(plain, weapon, direction), `${weapon} ${direction}`).toEqual(attackTimings(tuning, weapon, direction));
        // The Tick after releaseEnd is the first that differs: Recovery's own sweep from releaseEnd - 1 ends on the releaseEnd pose.
        for (let tick = 0; tick <= releaseEnd; tick++)
          expect(motionTargets(tuning, weapon, direction, tick), `${weapon} ${direction} tick ${tick}`).toEqual(motionTargets(plain, weapon, direction, tick));
        expect(motionTargets(tuning, weapon, direction, releaseEnd + 6)).not.toEqual(motionTargets(plain, weapon, direction, releaseEnd + 6));
      }
  });

  it('changes no Hit, Block or Wall Strike: every Weapon\'s Attack in every Direction lands as before', () => {
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: 0, z: 1.3 }, facing: Math.PI },
    ];
    for (const weapon of Object.keys(tuning.weapons))
      for (const direction of DIRECTIONS) {
        const script = { placements, weapons: [weapon, weapon], a: [...attack(direction), ...wait(20), ...attack(direction)], b: wait(200) };
        const run = runDuel(tuning, script);
        expect(hitsOf(run).length, `${weapon} ${direction}`).toBeGreaterThan(0);
        expect(hitsOf(run), `${weapon} ${direction}`).toEqual(hitsOf(runDuel(plain, script)));
      }
  });
});
