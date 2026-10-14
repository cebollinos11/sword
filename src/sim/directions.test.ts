import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import {
  attack,
  attackMotionName,
  attackTimings,
  DIRECTIONS,
  motionPose,
  runDuel,
  type Direction,
  type HitEvent,
  type ScriptRun,
  type Vec3,
} from './index';

const tuning = loadTuningData();

const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead, facing back. */
const facingOff = (d: number) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: d }, facing: Math.PI },
];

/** The blade tip of a Direction's held Wind-up pose, in the Fighter-local frame (x right, y up, z forward). */
function heldWindUpTip(direction: Direction): Vec3 {
  const { windUpEnd } = attackTimings(tuning, direction);
  const { tip } = motionPose(tuning, attackMotionName(direction), windUpEnd, { position: { x: 0, z: 0 }, facing: 0 }).blade;
  // At facing 0 the Fighter's right is world -x and forward is world +z.
  return { x: -tip.x, y: tip.y, z: tip.z };
}

describe('Attack Directions', () => {
  it.each(DIRECTIONS)('every Direction has an Attack Motion with Wind-up and Release markers (%s)', (direction) => {
    const t = attackTimings(tuning, direction);
    expect(t.windUpEnd).toBeGreaterThan(0);
    expect(t.releaseEnd).toBeGreaterThan(t.windUpEnd);
    expect(t.end).toBeGreaterThan(t.releaseEnd);
  });

  it.each(DIRECTIONS)('a %s Release from in range hits the opponent', (direction) => {
    const run = runDuel(tuning, { placements: facingOff(1.3), a: attack(direction) });
    const hits = hitsOf(run);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 0, defender: 1, direction });
    expect(run.final.fighters[1]!.hp).toBeCloseTo(100 - hits[0]!.damage, 9);
    expect(hits[0]!.damage).toBeGreaterThan(10);
  });

  it.each(DIRECTIONS)('a %s Attack goes Wind-up → Release → Recovery → Idle and misses out of range', (direction) => {
    const run = runDuel(tuning, { distance: 4, a: attack(direction, 30) });
    const phases = run.events.flatMap((e) => (e.type === 'AttackPhase' ? [[e.direction, e.phase]] : []));
    expect(phases).toEqual([
      [direction, 'Wind-up'],
      [direction, 'Release'],
      [direction, 'Recovery'],
    ]);
    expect(hitsOf(run)).toEqual([]);
    expect(run.final.fighters[0]!.action).toEqual({ kind: 'Idle' });
  });

  describe('held Wind-up poses read differently', () => {
    it('Right winds the blade up on the Fighter’s right, Left on the left', () => {
      expect(heldWindUpTip('Right').x).toBeGreaterThan(0.3);
      expect(heldWindUpTip('Left').x).toBeLessThan(-0.3);
    });

    it('Overhead raises the blade tip high above the head', () => {
      expect(heldWindUpTip('Overhead').y).toBeGreaterThan(2);
    });

    it('Thrust draws the blade back, tip pointing at the opponent', () => {
      const { hilt, tip } = motionPose(tuning, 'Thrust', attackTimings(tuning, 'Thrust').windUpEnd, {
        position: { x: 0, z: 0 },
        facing: 0,
      }).blade;
      expect(tip.z - hilt.z).toBeGreaterThan(0.7); // blade points forward
      expect(hilt.z).toBeLessThan(0.15); // hand pulled back
    });

    it('the four held blade tips are far apart from one another', () => {
      for (const [i, a] of DIRECTIONS.entries()) {
        for (const b of DIRECTIONS.slice(i + 1)) {
          const p = heldWindUpTip(a);
          const q = heldWindUpTip(b);
          expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), `${a} vs ${b}`).toBeGreaterThan(0.6);
        }
      }
    });
  });
});
