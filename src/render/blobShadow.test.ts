import { describe, expect, it } from 'vitest';
import { createInitialState, duelPlacements, fighterPose, type SkeletonPose } from '../sim';
import { loadTuningData, parseArena } from '../tuning';
import { blobPlacement } from './blobShadow';

const tuning = loadTuningData();

/** `pose` moved up by `dy` metres, as if mid-Jump. */
const raised = (pose: SkeletonPose, dy: number): SkeletonPose => ({
  ...pose,
  joints: Object.fromEntries(Object.entries(pose.joints).map(([k, p]) => [k, { ...p, y: p.y + dy }])) as SkeletonPose['joints'],
});

describe('blobPlacement', () => {
  const arena = parseArena(
    {
      name: 'steps',
      walk: [
        { id: 'floor', points: [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]] },
        { id: 'ledge', points: [[-5, 2, -5], [5, 2, -5], [5, 2, -3], [-5, 2, -3]] },
        // A ramp rising towards +x, from x = 6 to x = 10.
        { id: 'ramp', points: [[6, 0, -5], [10, 2, -5], [10, 2, 5], [6, 0, 5]] },
      ],
    },
    'steps',
  );
  const world = { ...tuning, arenas: { ...tuning.arenas, steps: arena } };
  const standing = (x: number, z: number, y = 0) =>
    fighterPose(createInitialState(world, 1, [{ position: { x, z }, facing: 0, y }], [], [], 'steps').fighters[0]!, world);

  it('lies flat on the ground under a standing Fighter, at full size and darkness', () => {
    const pose = standing(1, 1);
    const at = blobPlacement(pose, arena)!;
    expect(at.position.x).toBeCloseTo(pose.joints.pelvis.x);
    expect(at.position.z).toBeCloseTo(pose.joints.pelvis.z);
    expect(at.position.y).toBeGreaterThan(0);
    expect(at.position.y).toBeLessThan(0.05);
    expect(at.normal).toEqual({ x: -0, y: 1, z: -0 });
    expect(at.opacity).toBeGreaterThan(0.4);
  });

  it('shrinks and fades as the Fighter rises, and is gone high enough up', () => {
    const pose = standing(1, 1);
    const ground = blobPlacement(pose, arena)!;
    const jump = blobPlacement(raised(pose, 1), arena)!;
    expect(jump.position.y).toBeCloseTo(ground.position.y);
    expect(jump.radius).toBeLessThan(ground.radius);
    expect(jump.opacity).toBeLessThan(ground.opacity);
    expect(blobPlacement(raised(pose, 3), arena)).toBeNull();
  });

  it('lies on the highest ground under the Fighter: a ledge it stands on, not the floor below', () => {
    const at = blobPlacement(standing(0, -4, 2), arena)!;
    expect(at.position.y).toBeCloseTo(2, 1);
    expect(at.opacity).toBeGreaterThan(0.4);
  });

  it('tilts to a ramp', () => {
    const at = blobPlacement(standing(8, 0, 1), arena)!;
    expect(at.normal.x).toBeLessThan(-0.3);
    expect(at.normal.y).toBeGreaterThan(0.8);
    expect(Math.hypot(at.normal.x, at.normal.y, at.normal.z)).toBeCloseTo(1);
  });

  it('casts nothing off the Arena', () => {
    expect(blobPlacement(standing(20, 20), arena)).toBeNull();
  });
});

it('every Fighter of a Duel on the default Arena casts a shadow at the start', () => {
  const state = createInitialState(tuning, 1, duelPlacements(3));
  const arena = tuning.arenas[state.arena]!;
  for (const f of state.fighters) expect(blobPlacement(fighterPose(f, tuning), arena)).not.toBeNull();
});
