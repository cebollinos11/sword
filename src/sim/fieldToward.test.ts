import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { groundOf } from './battlefield';
import { distanceTo, FIELDS_KEPT, fieldDistance, fieldToward, oneField, steerToward } from './destinations';
import { floorArenaName, floorOf } from './delver/world';

const tuning = loadTuningData();
const floor = floorOf(tuning, floorArenaName(7, 1))!;
const { fields, plan, field, battle } = floor;
const cell = battle.crowd.flowCell;

const hall = (k: number) => ({ x: plan.halls[k]!.cx, z: plan.halls[k]!.cz });
const ground = (x: number, z: number) => groundOf(battle, field, x, z, 0);
/** The field's corner, asked on the Walk Surface of Hall 0's floor: out in the abyss, where that surface has no node (node -1). */
const ABYSS = { x: -battle.field.size / 2 + 1, z: -battle.field.size / 2 + 1, s: ground(hall(0).x, hall(0).z) };
/** `n` points whose nodes are all different (one cell apart along the field's edge, on no particular Walk Surface). */
const distinctNodes = (n: number) => Array.from({ length: n }, (_, k) => ({ x: ABYSS.x + k * cell, z: ABYSS.z + cell }));

describe('fieldToward', () => {
  it('equals distanceTo, entry for entry, at a Hall centre, a Passage and a point in the abyss', () => {
    const passage = plan.passages[0]!;
    const points: { x: number; z: number }[] = [hall(0), hall(plan.stairs), { x: (passage.rect.x0 + passage.rect.x1) / 2, z: (passage.rect.z0 + passage.rect.z1) / 2 }, ABYSS];
    for (const p of points) {
      const s = p === ABYSS ? ABYSS.s : ground(p.x, p.z);
      expect(Array.from(fieldToward(fields, p.x, p.z, s))).toEqual(Array.from(distanceTo(fields, p.x, p.z, s)));
    }
  });

  it('is all -1 for a point in the abyss', () => {
    const f = fieldToward(fields, ABYSS.x, ABYSS.z, ABYSS.s);
    expect(f.every((v) => v === -1)).toBe(true);
    expect(fieldToward(fields, ABYSS.x, ABYSS.z, ABYSS.s)).toBe(f);
  });

  it('is the same object for two points in one node, another for another node', () => {
    const c = hall(0);
    const s = ground(c.x, c.z);
    const a = fieldToward(fields, c.x, c.z, s);
    expect(fieldToward(fields, c.x + cell * 0.2, c.z - cell * 0.2, s)).toBe(a);
    expect(fieldToward(fields, c.x + cell, c.z, s)).not.toBe(a);
  });

  it('rebuilds the least recently used field after FIELDS_KEPT other nodes, a new object but equal', () => {
    const c = hall(1);
    const s = ground(c.x, c.z);
    const first = fieldToward(fields, c.x, c.z, s);
    const before = Array.from(first);
    for (const p of distinctNodes(FIELDS_KEPT + 1)) fieldToward(fields, p.x, p.z);
    const again = fieldToward(fields, c.x, c.z, s);
    expect(again).not.toBe(first);
    expect(Array.from(again)).toEqual(before);
  });

  it('keeps a field that is used again, evicting the oldest instead', () => {
    const c = hall(2);
    const s = ground(c.x, c.z);
    const first = fieldToward(fields, c.x, c.z, s);
    for (const p of distinctNodes(FIELDS_KEPT + 1)) {
      fieldToward(fields, p.x, p.z);
      fieldToward(fields, c.x, c.z, s);
    }
    expect(fieldToward(fields, c.x, c.z, s)).toBe(first);
  });

  it('oneField reads as the one destination d = 0 to fieldDistance and steerToward', () => {
    const goal = hall(plan.stairs);
    const gs = ground(goal.x, goal.z);
    const start = hall(plan.entrance);
    const ss = ground(start.x, start.z);
    const one = oneField(fields, fieldToward(fields, goal.x, goal.z, gs));
    expect(one.dist).toHaveLength(1);
    expect(one.objectives).toBe(0);
    expect(fieldDistance(one, 0, goal.x, goal.z, gs)).toBe(0);
    const d = fieldDistance(one, 0, start.x, start.z, ss);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(fieldDistance({ ...fields, dist: [distanceTo(fields, goal.x, goal.z, gs)], objectives: 0 }, 0, start.x, start.z, ss), 9);
    // One step along the field's descent from the Entrance is nearer the goal.
    const heading = steerToward(one, 0, start.x, start.z, goal.x, goal.z, 1, ss, gs);
    const nx = start.x + Math.sin(heading) * cell;
    const nz = start.z + Math.cos(heading) * cell;
    const near = fieldDistance(one, 0, nx, nz, ground(nx, nz));
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThan(d);
  });
});
