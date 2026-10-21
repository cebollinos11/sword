import { describe, expect, it } from 'vitest';
import { createInitialState, fighterPose, IDLE_INTENT, step, type Intent, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import { loadTuningData, weaponByName } from '../tuning';
import { drawnPose } from './fighterView';
import { sheathedBlade } from './sheathed';

const tuning = loadTuningData();
const WEAPONS = Object.keys(tuning.weapons);

const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dir = (b: { hilt: Vec3; tip: Vec3 }): Vec3 => {
  const l = d(b.hilt, b.tip);
  return { x: (b.tip.x - b.hilt.x) / l, y: (b.tip.y - b.hilt.y) / l, z: (b.tip.z - b.hilt.z) / l };
};
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 180) / Math.PI;
const tick = (s: SimState, intent: Partial<Intent> = {}) => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);

/** Press sheathe and run until `sheathed` flips: the pose (the Weapon still as the hand holds it) on the swap Tick. */
function atSwap(s: SimState, intent: Partial<Intent> = {}): { state: SimState; pose: SkeletonPose } {
  const was = s.fighters[0]!.sheathed;
  s = tick(s, { ...intent, sheathe: true });
  for (let i = 0; i < 200 && s.fighters[0]!.sheathed === was; i++) s = tick(s, intent);
  expect(s.fighters[0]!.sheathed).toBe(!was);
  return { state: s, pose: fighterPose(s.fighters[0]!, tuning) };
}

/** Run a Sheathe through to the Sheathed Idle. */
function sheathed(weapon: string): SimState {
  let s = atSwap(createInitialState(tuning, 1, undefined, [weapon])).state;
  for (let i = 0; i < 200 && s.fighters[0]!.action.kind !== 'Idle'; i++) s = tick(s);
  return s;
}

describe('the sheathed Weapon', () => {
  it.each(WEAPONS)('%s: the hand meets the slot at the Sheathe swap, so the Weapon changes over without a jump', (name) => {
    const { pose } = atSwap(createInitialState(tuning, 1, undefined, [name]));
    const slot = sheathedBlade(pose, weaponByName(tuning, name));
    expect(d(pose.blade.hilt, slot.hilt)).toBeLessThan(0.06);
    expect(angle(dir(pose.blade), dir(slot))).toBeLessThan(20);
  });

  it.each(WEAPONS)('%s: the hand takes it out of the slot at the Draw swap', (name) => {
    const { pose } = atSwap(sheathed(name));
    const slot = sheathedBlade(pose, weaponByName(tuning, name));
    expect(d(pose.blade.hilt, slot.hilt)).toBeLessThan(0.06);
    expect(angle(dir(pose.blade), dir(slot))).toBeLessThan(20);
  });

  it.each(WEAPONS)('%s: rides the body where its slot says, clear of the arms and inside its reach', (name) => {
    const weapon = weaponByName(tuning, name);
    const s = sheathed(name);
    const pose = fighterPose(s.fighters[0]!, tuning);
    const slot = sheathedBlade(pose, weapon);
    const { pelvis, chest, leftHip, rightShoulder } = pose.joints;
    expect(d(slot.hilt, slot.tip)).toBeCloseTo(weapon.length, 9);
    if (weapon.sheathe.slot === 'hip') {
      // On the left hip, its blade hanging down and back.
      expect(d(slot.hilt, leftHip)).toBeLessThan(0.2);
      expect(slot.tip.y).toBeLessThan(pelvis.y - 0.3);
    } else {
      // Its grip by the right shoulder, behind the back.
      expect(d(slot.hilt, rightShoulder)).toBeLessThan(0.25);
      const forward = s.fighters[0]!.facing;
      const behind = (p: Vec3) => (p.x - chest.x) * Math.sin(forward) + (p.z - chest.z) * Math.cos(forward);
      expect(behind(slot.hilt)).toBeLessThan(-0.05);
      expect(behind(slot.tip)).toBeLessThan(-0.05);
    }
  });

  it('follows the body as it moves and turns', () => {
    const s = sheathed('Arming Sword');
    const weapon = weaponByName(tuning, 'Arming Sword');
    const pose = fighterPose(s.fighters[0]!, tuning);
    const here = sheathedBlade(pose, weapon);
    const map = (f: (v: Vec3) => Vec3): SkeletonPose => ({ ...pose, joints: Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, f(v)])) as SkeletonPose['joints'] });
    const moved = sheathedBlade(map((v) => ({ x: v.x + 2, y: v.y + 1, z: v.z })), weapon);
    expect(moved.hilt.x - here.hilt.x).toBeCloseTo(2, 9);
    expect(moved.tip.y - here.tip.y).toBeCloseTo(1, 9);
    // Turned half round about the origin.
    const turned = sheathedBlade(map((v) => ({ x: -v.x, y: v.y, z: -v.z })), weapon);
    expect(turned.hilt.x).toBeCloseTo(-here.hilt.x, 9);
    expect(turned.tip.z).toBeCloseTo(-here.tip.z, 9);
    expect(turned.edge.y).toBeCloseTo(here.edge.y, 9);
  });

  it('is drawn in its slot while Sheathed and in the hand otherwise, switching at the swap', () => {
    const drawn = createInitialState(tuning, 1, undefined, ['Longsword']);
    expect(drawnPose(drawn, drawn, 0, 1, tuning).blade).toEqual(fighterPose(drawn.fighters[0]!, tuning).blade);
    const { state } = atSwap(drawn);
    const pose = fighterPose(state.fighters[0]!, tuning);
    expect(drawnPose(state, state, 0, 1, tuning).blade).toEqual(sheathedBlade(pose, weaponByName(tuning, 'Longsword')));
  });
});
