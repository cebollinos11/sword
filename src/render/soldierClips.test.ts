import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { BODY_MODELS } from './bodyModel';
import { CLIP_FRAMES, IMPOSTOR_CLIPS } from './impostor';
import { CELL_METRES, FEET_METRES } from './impostorAtlas';
import { localPose, soldierClips } from './soldierClips';

const tuning = loadTuningData();
const clips = soldierClips(tuning, tuning.battle.soldier.weapon);

describe("the soldier's clips for its impostor atlas", () => {
  it('has every clip, its frames, and a length', () => {
    for (const clip of IMPOSTOR_CLIPS) {
      expect(clips.poses[clip]).toHaveLength(CLIP_FRAMES[clip]);
      expect(clips.seconds[clip]).toBeGreaterThan(0);
    }
    // One walk loop is two strides, played at the Crowd's walking speed.
    expect(clips.walkLoop).toBeGreaterThan(1);
    expect(clips.walkLoop).toBeLessThan(4);
    expect(clips.seconds.walk).toBeCloseTo(clips.walkLoop / tuning.battle.crowd.walkSpeed, 9);
  });

  it('stands at the origin facing +z, every pose inside a cell of the atlas', () => {
    for (const clip of IMPOSTOR_CLIPS)
      for (const pose of clips.poses[clip]) {
        const points = [...Object.values(pose.joints), pose.blade.hilt, pose.blade.tip];
        for (const p of points) {
          expect(Math.hypot(p.x, p.z)).toBeLessThan(CELL_METRES / 2);
          expect(p.y).toBeGreaterThan(-FEET_METRES);
          expect(p.y).toBeLessThan(CELL_METRES - FEET_METRES);
        }
        if (clip !== 'death') {
          // Upright, over its feet.
          expect(Math.hypot(pose.joints.pelvis.x, pose.joints.pelvis.z)).toBeLessThan(0.2);
          expect(pose.joints.head.y).toBeGreaterThan(1.3);
        }
      }
    // Facing +z: its left side on +x (the models' rest pose).
    const idle = clips.poses.idle[0]!;
    expect(idle.joints.leftShoulder.x).toBeGreaterThan(idle.joints.rightShoulder.x);
  });

  it('swings over its head, staggers, and ends its fall lying on the ground', () => {
    expect(Math.max(...clips.poses.swing.map((p) => p.blade.tip.y))).toBeGreaterThan(2);
    expect(Math.min(...clips.poses.swing.map((p) => p.blade.tip.y))).toBeLessThan(1);
    expect(clips.poses.stagger.some((p) => p.joints.pelvis.y < clips.poses.idle[0]!.joints.pelvis.y - 0.05)).toBe(true);
    const fallen = clips.poses.death[CLIP_FRAMES.death - 1]!;
    expect(fallen.joints.head.y).toBeLessThan(0.4);
    expect(clips.poses.death[0]!.joints.head.y).toBeGreaterThan(1.3);
  });

  it('localPose turns a pose into the Fighter’s own frame', () => {
    const pose = clips.poses.idle[0]!;
    // Placed at (3, 0.5, -2) facing +x, then brought back.
    const c = Math.cos(Math.PI / 2);
    const s = Math.sin(Math.PI / 2);
    const out = (v: { x: number; y: number; z: number }) => ({ x: 3 + v.x * c + v.z * s, y: v.y + 0.5, z: -2 - v.x * s + v.z * c });
    const placed = { joints: Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, out(v)])) as typeof pose.joints, blade: { hilt: out(pose.blade.hilt), tip: out(pose.blade.tip), edge: { x: pose.blade.edge.x * c + pose.blade.edge.z * s, y: pose.blade.edge.y, z: -pose.blade.edge.x * s + pose.blade.edge.z * c } } };
    const back = localPose(placed, { position: { x: 3, z: -2 }, y: 0.5, facing: Math.PI / 2 });
    for (const [name, v] of Object.entries(back.joints)) {
      const want = pose.joints[name as keyof typeof pose.joints];
      expect(v.x).toBeCloseTo(want.x, 9);
      expect(v.y).toBeCloseTo(want.y, 9);
      expect(v.z).toBeCloseTo(want.z, 9);
    }
    expect(back.blade.edge.x).toBeCloseTo(pose.blade.edge.x, 9);
    expect(back.blade.edge.z).toBeCloseTo(pose.blade.edge.z, 9);
  });
});

describe('the generic soldier in data/battle.json', () => {
  it('is drawn as a Body model, so it has a team-coloured part to tint', () => {
    expect((BODY_MODELS as readonly string[]).includes(tuning.battle.soldier.body)).toBe(true);
  });
});
