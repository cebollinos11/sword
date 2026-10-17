import { describe, expect, it } from 'vitest';
import { duelPlacements, fighterPose, createInitialState, type Death, type SkeletonPose, type Vec3 } from '../sim';
import { loadTuningData, parseArena, weaponByName } from '../tuning';
import { ragdollPose } from './ragdoll';

const tuning = loadTuningData();
const fighter = createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!; // at +z, facing -z
const pose = fighterPose(fighter, tuning);
const weapon = weaponByName(tuning, fighter.weapon);
/** An Overhead from the opponent, standing at -z. */
const death: Death = { tick: 10, cause: 'Hit', blow: { point: pose.joints.chest, bladeSpeed: 10, direction: 'Overhead', from: { x: 0, z: -1 } } };

const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lowest = (p: SkeletonPose) => Math.min(...Object.values(p.joints).map((j) => j.y), p.blade.tip.y, p.blade.hilt.y);

describe('Death Ragdoll', () => {
  it('starts from the pose the Fighter fell in', () => {
    expect(ragdollPose(pose, death, 0, weapon, tuning)).toEqual(pose);
  });

  it('is deterministic', () => {
    expect(ragdollPose(pose, death, 1.3, weapon, tuning)).toEqual(ragdollPose(pose, death, 1.3, weapon, tuning));
  });

  it('collapses onto the floor, knocked away from the attacker, and lies still', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(lying.joints.head.y).toBeLessThan(0.3);
    expect(lying.joints.chest.y).toBeLessThan(0.3);
    expect(lowest(lying)).toBeGreaterThan(0);
    expect(lying.joints.head.z).toBeGreaterThan(pose.joints.head.z);
    expect(ragdollPose(pose, death, 10, weapon, tuning)).toEqual(ragdollPose(pose, death, 20, weapon, tuning));
  });

  it('keeps the bones whole', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    for (const [a, b] of [
      ['pelvis', 'chest'],
      ['leftHip', 'leftKnee'],
      ['rightElbow', 'rightHand'],
    ] as const)
      expect(d(lying.joints[a], lying.joints[b])).toBeCloseTo(d(pose.joints[a], pose.joints[b]), 1);
  });

  it('lets go of the Weapon, which keeps its length and falls on its own', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(d(lying.blade.hilt, lying.blade.tip)).toBeCloseTo(d(pose.blade.hilt, pose.blade.tip), 1);
    expect(d(lying.blade.hilt, lying.joints.rightHand)).toBeGreaterThan(0.15);
    expect(Math.max(lying.blade.hilt.y, lying.blade.tip.y)).toBeLessThan(0.2);
  });
});

describe('Death Ragdoll in a multilevel Arena', () => {
  /** A 2 m ledge whose edge (z = 1.3) is just behind a Fighter standing on it at z = 1, over a floor at 0. */
  const arena = parseArena(
    {
      name: 'ledge',
      walk: [
        { id: 'floor', points: [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]] },
        { id: 'ledge', points: [[-5, 2, -5], [5, 2, -5], [5, 2, 1.3], [-5, 2, 1.3]] },
      ],
    },
    'ledge',
  );
  const high = { ...tuning, arenas: { ...tuning.arenas, ledge: arena } };
  const onLedge = createInitialState(high, 1, [{ position: { x: 0, z: -1 }, facing: 0 }, { position: { x: 0, z: 1 }, facing: Math.PI, y: 2 }], [], [], 'ledge').fighters[1]!;
  const ledgePose = fighterPose(onLedge, high);
  const blow: Death = { ...death, blow: { ...death.blow!, point: ledgePose.joints.chest } };

  it('lies on the ledge it fell on when it stays on it, and drops to the floor below when knocked off', () => {
    expect(onLedge.y).toBe(2);
    const lying = ragdollPose(ledgePose, blow, 4, weapon, high, arena);
    // Knocked towards +z, over the edge: down on the floor, not floating at the ledge's height.
    expect(lying.joints.pelvis.z).toBeGreaterThan(1.3);
    expect(lying.joints.pelvis.y).toBeLessThan(0.5);
    expect(lowest(lying)).toBeGreaterThan(0);
    // Without the Arena it would stop at y 0 all the same, but standing on the ledge it never sinks below it.
    const slump: Death = { tick: 10, cause: 'Fall', blow: null };
    const safe = createInitialState(high, 1, [{ position: { x: 0, z: -2 }, facing: Math.PI, y: 2 }], [], [], 'ledge').fighters[0]!;
    const still = ragdollPose(fighterPose(safe, high), slump, 4, weapon, high, arena);
    expect(lowest(still)).toBeGreaterThan(2);
  });
});
