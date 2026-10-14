import { describe, expect, it } from 'vitest';
import type { Placement, Vec3 } from '../sim';
import { handGizmoAxes, handRotationFromGizmo, localToWorld, torsoFromGizmo, torsoGizmoAxes, worldToLocal } from './gizmoMath';

const AT_ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };
const TURNED: Placement = { position: { x: 1, z: -2 }, facing: 1.1 };

function expectVec(a: Vec3, b: Vec3, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
}

describe('gizmo frames', () => {
  it('maps Fighter-local targets to the world and back', () => {
    // Facing 0: the Fighter's right (local +x) is world -x, forward is +z.
    expectVec(localToWorld({ x: 0.2, y: 1, z: 0.3 }, AT_ORIGIN), { x: -0.2, y: 1, z: 0.3 });
    // Facing pi/2 (forward = world +x) at (1, 0, -2): the right is world +z.
    expectVec(localToWorld({ x: 1, y: 0, z: 0 }, { position: { x: 1, z: -2 }, facing: Math.PI / 2 }), { x: 1, y: 0, z: -1 });
    const p = { x: 0.3, y: 1.4, z: -0.2 };
    expectVec(worldToLocal(localToWorld(p, TURNED), TURNED), p);
  });

  it('turns a sword hand rotation into gizmo axes and back to the same angles', () => {
    for (const rot of [
      { x: -60, y: 0, z: 0 },
      { x: 30, y: 40, z: -20 },
      { x: 10, y: -120, z: 75 },
    ]) {
      const axes = handGizmoAxes(rot, TURNED);
      expectVec(handRotationFromGizmo(axes.forward, axes.up, TURNED, rot), rot, 4);
    }
    // Zero points the blade forward, edge down (gizmo up = blade's back = world up).
    const zero = handGizmoAxes({ x: 0, y: 0, z: 0 }, AT_ORIGIN);
    expectVec(zero.forward, { x: 0, y: 0, z: 1 });
    expectVec(zero.up, { x: 0, y: 1, z: 0 });
    // Pitch -90 points the blade up.
    expectVec(handGizmoAxes({ x: -90, y: 0, z: 0 }, AT_ORIGIN).forward, { x: 0, y: 1, z: 0 });
  });

  it('keeps the angle solution nearest the authored one, so Pose Keys still interpolate the same way', () => {
    // The Overhead wind-up holds the blade back over the head at pitch -150.
    const overhead = { x: -150, y: 0, z: 0 };
    const axes = handGizmoAxes(overhead, AT_ORIGIN);
    expectVec(handRotationFromGizmo(axes.forward, axes.up, AT_ORIGIN, overhead), overhead, 4);
    const wound = { x: 20, y: 350, z: -370 };
    const a2 = handGizmoAxes(wound, AT_ORIGIN);
    expectVec(handRotationFromGizmo(a2.forward, a2.up, AT_ORIGIN, wound), wound, 4);
  });

  it('turns a torso twist/lean into gizmo axes and back', () => {
    for (const torso of [
      { twist: 0, lean: 0 },
      { twist: 15, lean: -10 },
      { twist: -40, lean: 25 },
    ]) {
      const axes = torsoGizmoAxes(torso, TURNED);
      const back = torsoFromGizmo(axes.forward, TURNED, torso);
      expect(back.twist).toBeCloseTo(torso.twist, 4);
      expect(back.lean).toBeCloseTo(torso.lean, 4);
    }
    // Positive lean tips the chest forward (the spine's forward axis points down a little).
    expect(torsoGizmoAxes({ twist: 0, lean: 20 }, AT_ORIGIN).forward.y).toBeLessThan(0);
  });
});
