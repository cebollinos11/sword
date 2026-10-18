import { describe, expect, it } from 'vitest';
import { embedAt, embedPosition } from './daggerView';

describe('a dagger embedded in a Fighter', () => {
  it('stays at the same spot on the body as the Fighter moves and turns', () => {
    const at = { position: { x: 2, z: 3 }, y: 0, facing: 0.7 };
    const point = { x: 2.1, y: 1.2, z: 3.25 };
    const embed = embedAt(1, point, at);
    const back = embedPosition(embed, at);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
    expect(back.z).toBeCloseTo(point.z, 9);
    // Walk 1 m along x and turn a quarter circle: it keeps its distance from the feet and its height.
    const moved = embedPosition(embed, { position: { x: 3, z: 3 }, y: 0, facing: 0.7 + Math.PI / 2 });
    expect(Math.hypot(moved.x - 3, moved.z - 3)).toBeCloseTo(Math.hypot(point.x - 2, point.z - 3), 9);
    expect(moved.y).toBeCloseTo(1.2, 9);
  });
});
