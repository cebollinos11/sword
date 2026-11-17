/**
 * `distanceTo` (docs/plans/delver.md, Stage 0): a destination field toward any point, equal entry for entry to the field `destinationFields`
 * builds for an Objective or a Base standing there, on the open field and on a map of several levels; fresh on every call; all -1 where no
 * node stands; and leading through an Enclosure's doorway.
 */
import { describe, expect, it } from 'vitest';
import { compileMap } from '../mapEditor/compile';
import { GROUND, withBrushes } from '../mapEditor/sample.testdata';
import type { EnclosureBrush } from '../mapEditor/source';
import { loadTuningData } from '../tuning';
import { battlefieldOf, battleMapOf, destinationFields, distanceTo, fieldDistance, groundOf } from '.';

const battle = loadTuningData().battle;

describe('distanceTo', () => {
  it('equals the Objective and Base fields on the open field', () => {
    const { field, fields } = battleMapOf(battle, 'battle:1');
    expect(fields.levels).toBeNull();
    const places = [...field.objectives, ...field.bases];
    expect(places.length).toBeGreaterThan(0);
    places.forEach((p, k) => expect(Array.from(distanceTo(fields, p.x, p.z))).toEqual(Array.from(fields.dist[k]!)));
  });

  it('equals them on a map of several levels', () => {
    const { field, fields } = battleMapOf(battle, 'battle:fort');
    expect(field.layered).toBe(true);
    const places = [
      ...field.objectives.map((o, k) => ({ ...o, s: field.objectiveSurfaces[k]! })),
      ...field.bases.map((b, k) => ({ ...b, s: field.baseSurfaces[k]! })),
    ];
    places.forEach((p, k) => expect(Array.from(distanceTo(fields, p.x, p.z, p.s))).toEqual(Array.from(fields.dist[k]!)));
  });

  // No shipped map is one level with blocks (the Fort is layered, as are the city, the ziggurat and the cavern), so the one-level path
  // with blocks has no shipped map to test on; the open field covers the one-level path without them.

  it('is fresh each call', () => {
    const { fields } = battleMapOf(battle, 'battle:fort');
    const a = distanceTo(fields, 0, 0);
    const b = distanceTo(fields, 0, 0);
    expect(b).not.toBe(a);
    expect(Array.from(b)).toEqual(Array.from(a));
    a.fill(7);
    expect(Array.from(distanceTo(fields, 0, 0))).toEqual(Array.from(b));
  });

  it('a point no node stands on gives all -1', () => {
    const { fields } = battleMapOf(battle, 'battle:fort');
    const L = fields.levels!;
    // A cell with no node at all (its centre inside a block).
    const c = Array.from({ length: fields.side * fields.side }, (_, i) => i).find((i) => L.start[i] === L.start[i + 1])!;
    expect(c).toBeDefined();
    const mid = (fields.side - 1) / 2;
    const out = distanceTo(fields, ((c % fields.side) - mid) * fields.cell, (Math.floor(c / fields.side) - mid) * fields.cell);
    expect(out.length).toBe(L.y.length);
    expect(out.every((v) => v === -1)).toBe(true);
  });

  it("reaches through an Enclosure's doorway", () => {
    const room = (id: string, rect: EnclosureBrush['rect'], doors: EnclosureBrush['doors']): EnclosureBrush => ({ kind: 'enclosure', id, rect, y: 0, doors });
    // West z -5 to 5, east z 0 to 20, sharing x = 0 from z 0 to 5; west's doorway of 4 m is centred at z = 0.
    const west = room('west', { x0: -10, z0: -5, x1: 0, z1: 5 }, { e: 4 });
    const east = room('east', { x0: 0, z0: 0, x1: 10, z1: 20 }, {});
    const map = compileMap(withBrushes([GROUND, west, east]), battle).map;
    const field = battlefieldOf({ ...battle, maps: { [map.name]: map } }, `battle:${map.name}`)!;
    const b = { ...battle, maps: { [map.name]: map } };
    const fields = destinationFields(b, field);
    expect(fields.levels).not.toBeNull();
    const s = groundOf(b, field, -5, 0, 0);
    const out = distanceTo(fields, -5, 0, s);
    const only = { ...fields, dist: [out] };
    expect(fieldDistance(only, 0, -5, 0, s)).toBe(0);
    const far = fieldDistance(only, 0, 5, 10, groundOf(b, field, 5, 10, 0));
    expect(far).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThan(Math.hypot(10, 10));
  });
});
