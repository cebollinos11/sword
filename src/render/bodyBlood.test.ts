import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, duelPlacements, fighterPose, hold, runDuel, type SimState, type Vec3 } from '../sim';
import { boneAt, BodyBlood, bodyBloodUniforms, bodySplashes, MAX_WOUNDS, restFrames, setBodyBlood, woundRadius } from './bodyBlood';
import { boneFrames, boneScale } from './bodyRig';
import * as THREE from 'three';

const tuning = loadTuningData();

/** Where a point kept in a bone's frame is in the world, on a body posed with `joints`. */
function inWorld(joints: Parameters<typeof boneFrames>[0], bone: ReturnType<typeof boneAt>['bone'], at: Vec3, size = { height: 1, thick: 1 }): THREE.Vector3 {
  const f = boneFrames(joints)[bone];
  return new THREE.Vector3(at.x, at.y, at.z).multiply(boneScale(bone, size.height, size.thick, new THREE.Vector3())).applyQuaternion(f.rotation).add(f.origin);
}

describe('bodySplashes', () => {
  it('a Hit bloodies the defender where it landed', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const state = run.states.find((s) => s.events.some((e) => e.type === 'Hit'))!;
    const hit = state.events.find((e) => e.type === 'Hit')!;
    const splashes = run.states.flatMap((s) => bodySplashes(s, tuning));
    expect(splashes).toHaveLength(1);
    expect(splashes[0]!.fighter).toBe(1);
    // Kept in the bone's frame, it is back at the contact in the pose it was struck in.
    const back = inWorld(fighterPose(state.fighters[1]!, tuning).joints, splashes[0]!.bone, splashes[0]!.at);
    expect(back.distanceTo(new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z))).toBeLessThan(1e-6);
  });

  it('a Block bloodies nothing', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    expect(run.states.flatMap((s) => bodySplashes(s, tuning))).toEqual([]);
  });

  it('a Throwing Dagger bloodies too, a Hit without damage does not', () => {
    const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;
    const point = { x: 0, y: 1.2, z: 0.3 };
    expect(bodySplashes({ fighters, events: [{ type: 'DaggerHit', thrower: 0, defender: 1, zone: 'torso', point, damage: 4 }] }, tuning)).toHaveLength(1);
    expect(bodySplashes({ fighters, events: [{ type: 'Hit', attacker: 0, defender: 1, direction: 'Overhead', zone: 'torso', point, bladeSpeed: 5, head: true, heavy: false, damage: 0 }] }, tuning)).toEqual([]);
  });
});

describe('boneAt', () => {
  const f = createInitialState(tuning, 1, duelPlacements(1.3)).fighters[1]!;
  const joints = fighterPose(f, tuning).joints;

  it('finds the bone a point is on', () => {
    const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    expect(boneAt(joints, mid(joints.leftKnee, joints.leftAnkle)).bone).toBe('shin_L');
    expect(boneAt(joints, mid(joints.rightShoulder, joints.rightElbow)).bone).toBe('upperArm_R');
    expect(boneAt(joints, { ...joints.head, y: joints.head.y + 0.05 }).bone).toBe('head');
    expect(boneAt(joints, mid(joints.pelvis, joints.chest)).bone).toBe('spine');
    // The top of a shoulder is the trunk's, not the arm's (which hangs from it, turned another way).
    expect(boneAt(joints, { ...joints.leftShoulder, y: joints.leftShoulder.y + 0.06 }).bone).toBe('spine');
  });

  it('keeps the point in the standard body, whatever the Size', () => {
    const size = { height: 1.3, thick: 0.7 };
    const point = { x: joints.chest.x + 0.1, y: joints.chest.y - 0.2, z: joints.chest.z + 0.08 };
    const { bone, at } = boneAt(joints, point, size);
    expect(inWorld(joints, bone, at, size).distanceTo(new THREE.Vector3(point.x, point.y, point.z))).toBeLessThan(1e-6);
  });
});

describe('BodyBlood', () => {
  const base = createInitialState(tuning, 1, duelPlacements(1.3));
  const chest = fighterPose(base.fighters[1]!, tuning).joints.chest;
  const hitAt = (tick: number, damage = 10, point: Vec3 = { x: chest.x, y: chest.y - 0.15, z: chest.z - 0.1 }): SimState => ({
    ...base,
    tick,
    events: [{ type: 'Hit', attacker: 0, defender: 1, direction: 'Overhead', zone: 'torso', point, bladeSpeed: 5, head: true, heavy: false, damage }],
  });

  it('keeps the blood through the Duel, merging Hits on the same spot', () => {
    const b = new BodyBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(20, hitAt(20));
    expect(b.marksOf(1)).toHaveLength(1);
    expect(b.marksOf(1)[0]!.strength).toBeGreaterThan(10 / 15);
    expect(b.marksOf(0)).toHaveLength(0);
    // Somewhere else on the body: another mark.
    b.onTick(30, hitAt(30, 10, { x: chest.x, y: 0.3, z: chest.z }));
    expect(b.marksOf(1)).toHaveLength(2);
  });

  it('a new Duel washes every body', () => {
    const b = new BodyBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(11, { ...base, tick: 50, events: [] });
    expect(b.marksOf(1)).toHaveLength(1);
    b.onTick(12, { ...base, tick: 0, events: [] });
    expect(b.marksOf(1)).toHaveLength(0);
  });

  it('a rewind washes off only what was laid after it', () => {
    const b = new BodyBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(30, hitAt(30, 10, { x: chest.x, y: 0.3, z: chest.z }));
    b.seek(20);
    expect(b.marksOf(1)).toHaveLength(1);
    expect(b.marksOf(1)[0]!.tick).toBe(10);
    // Replaying from the rewind is not a new Duel.
    b.onTick(21, { ...base, tick: 15, events: [] });
    expect(b.marksOf(1)).toHaveLength(1);
  });

  it('a benched Fighter is washed', () => {
    const b = new BodyBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(11, { ...base, tick: 11, fighters: base.fighters.map((f, i) => (i === 1 ? { ...f, benched: true } : f)), events: [] });
    expect(b.marksOf(1)).toHaveLength(0);
  });

  it(`holds at most ${MAX_WOUNDS} marks on a body`, () => {
    const b = new BodyBlood(tuning);
    for (let k = 0; k < 40; k++) b.onTick(10 + k, hitAt(10 + k, 10, { x: chest.x + ((k % 5) - 2) * 0.1, y: k * 0.045, z: chest.z }));
    expect(b.marksOf(1)).toHaveLength(MAX_WOUNDS);
  });
});

describe('setBodyBlood', () => {
  it('lays each mark as a line from inside the body out through where the Hit landed', () => {
    const f = createInitialState(tuning, 1, duelPlacements(1.3)).fighters[1]!;
    const joints = fighterPose(f, tuning).joints;
    const point = { x: joints.chest.x + 0.05, y: joints.chest.y - 0.2, z: joints.chest.z - 0.12 };
    const mark = { tick: 1, ...boneAt(joints, point), strength: 1, look: 0.5 };
    const u = bodyBloodUniforms();
    setBodyBlood(u, [mark], boneFrames(joints));
    expect(u.uBloodCount.value).toBe(1);
    const [a, b] = [u.uBloodA.value[0]!, u.uBloodB.value[0]!];
    const [from, to, hit] = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z), new THREE.Vector3(point.x, point.y, point.z)];
    // The contact is on the line, between its ends.
    expect(from.distanceTo(hit) + hit.distanceTo(to)).toBeCloseTo(from.distanceTo(to), 6);
    expect(a.w).toBeCloseTo(woundRadius(mark));
    expect(b.w).toBe(0.5);
    // On a model the same mark is laid in the rest pose, the same way out from its bone.
    setBodyBlood(u, [mark], restFrames(tuning.skeleton));
    expect(new THREE.Vector3(a.x, a.y, a.z).distanceTo(new THREE.Vector3(b.x, b.y, b.z))).toBeCloseTo(from.distanceTo(to), 6);
    setBodyBlood(u, [], boneFrames(joints));
    expect(u.uBloodCount.value).toBe(0);
  });
});
