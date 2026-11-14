import { beforeAll, describe, expect, it } from 'vitest';
import { enclosureTop, type Brush } from '../../mapEditor/source';
import { loadTuningData } from '../../tuning';
import { buildFloor, delverFloor, floorName, isFloorName, pieceId, planFloor, floorSource, type DelverFloor, type DelverPassage } from './index';
import { HALL_STOREY } from './plan';
import { rooms7a } from './flat.testdata';

describe('isFloorName', () => {
  it('is true for the names floorName makes', () => {
    for (const [seed, floor] of [[0, 1], [1, 9], [4294967295, 3], [123456, 12]] as const) expect(isFloorName(floorName(seed, floor))).toBe(true);
  });

  it('is false for other names', () => {
    for (const name of ['delverspike', 'delver0s1', 'delver1', 'fort', '', 'delver1s', 'xdelver1s1', 'delver1s1x']) expect(isFloorName(name)).toBe(false);
  });
});

describe('a Floor\'s source with turning Passages (Stage 7a)', () => {
  const tuning = rooms7a(loadTuningData());
  let floors: DelverFloor[];
  beforeAll(() => {
    floors = [1, 2, 3, 4, 5, 6].map((seed) => delverFloor(tuning, seed, 1));
  }, 120_000);

  const brush = (f: DelverFloor, id: string): Brush | undefined => f.source.brushes.find((b) => b.id === id);

  it('writes each piece of a turning Passage as an Enclosure with its id, height, roof and doors, and each sloped leg as a Ramp', () => {
    let turning = 0;
    let slopedLegs = 0;
    for (const f of floors) {
      const levels = f.source.levels!;
      for (const p of f.plan.passages) {
        if (p.pieces.length === 1) {
          expect(p.shape).toBe('straight');
          expect(brush(f, p.id)).toBeDefined();
          continue;
        }
        turning++;
        expect(brush(f, p.id)).toBeUndefined();
        p.pieces.forEach((q, k) => {
          const id = `${p.id}-${k}`;
          expect(pieceId(p, k)).toBe(id);
          const e = brush(f, id);
          expect(e?.kind).toBe('enclosure');
          if (e?.kind !== 'enclosure') return;
          const w = q.axis === 'x' ? q.rect.z1 - q.rect.z0 : q.rect.x1 - q.rect.x0;
          expect(e.rect).toEqual(q.rect);
          expect(e.y).toBe(Math.min(q.y0, q.y1));
          expect(enclosureTop(e, levels)).toBe(Math.max(q.y0, q.y1) + HALL_STOREY);
          expect(e.material).toBe('stone');
          expect(w).toBe(tuning.delver.floor.passage);
          if (q.y0 === q.y1) {
            expect(e.doors).toEqual({ [q.from]: w, [q.to]: w });
            expect(Object.keys(e.doors!)).toEqual([q.from, q.to]);
            expect(brush(f, `${id}-ramp`)).toBeUndefined();
          } else {
            slopedLegs++;
            expect(q.corner).toBe(false);
            expect(e.doors).toEqual({ [q.y0 < q.y1 ? q.from : q.to]: w });
            const r = brush(f, `${id}-ramp`);
            expect(r).toMatchObject({ kind: 'ramp', rect: q.rect, lo: Math.min(q.y0, q.y1), hi: Math.max(q.y0, q.y1), up: q.y1 > q.y0 ? q.to : q.from, rails: q.axis === 'x' ? ['n', 's'] : ['e', 'w'], material: 'stone' });
          }
          for (const y of [e.y, Math.max(q.y0, q.y1) + HALL_STOREY]) expect(levels).toContain(y);
        });
      }
    }
    expect(turning).toBeGreaterThan(0);
    expect(slopedLegs).toBeGreaterThan(0);
  });

  it('compiles (its walk check included) and builds', () => {
    for (const f of floors.slice(0, 3)) expect(() => buildFloor(tuning, f.plan)).not.toThrow();
  }, 120_000);

  it('writes only `pass<n>` Passage Brushes on the bundled Tuning, whose Floors are all straight', () => {
    const bundled = loadTuningData();
    for (const seed of [1, 2, 3]) {
      const plan = planFloor(bundled.delver.floor, seed, 1, 0, false);
      const source = floorSource(plan, bundled.battle.field.size);
      const passIds = source.brushes.map((b) => b.id).filter((id) => id.startsWith('pass'));
      const straight = (p: DelverPassage) => p.pieces.length === 1;
      expect(plan.passages.every(straight)).toBe(true);
      expect(passIds.every((id) => /^pass\d+(-ramp)?$/.test(id))).toBe(true);
      expect(passIds.filter((id) => !id.endsWith('-ramp'))).toEqual(plan.passages.map((p) => p.id));
    }
  });
});
