import { beforeAll, describe, expect, it } from 'vitest';
import { enclosureTop, type Brush } from '../../mapEditor/source';
import { loadTuningData } from '../../tuning';
import { buildFloor, delverFloor, floorName, isFloorName, pieceId, planFloor, floorSource, type DelverFloor, type DelverPassage } from './index';
import { checkMap } from '../../mapEditor/checks';
import { flatHalls, flatRooms, fullFloors, plainHalls } from './flat.testdata';
import { HALL_STOREY, hallBase } from './plan';

describe('isFloorName', () => {
  it('is true for the names floorName makes', () => {
    for (const [seed, floor] of [[0, 1], [1, 9], [4294967295, 3], [123456, 12]] as const) expect(isFloorName(floorName(seed, floor))).toBe(true);
  });

  it('is false for other names', () => {
    for (const name of ['delverspike', 'delver0s1', 'delver1', 'fort', '', 'delver1s', 'xdelver1s1', 'delver1s1x']) expect(isFloorName(name)).toBe(false);
  });
});

describe('a Floor\'s source with turning Passages (Stage 7a)', () => {
  const tuning = fullFloors(loadTuningData());
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

  it('writes only `pass<n>` Passage Brushes on Stage 6\'s lattice (`flatRooms`), whose Floors are all straight', () => {
    const bundled = flatRooms(loadTuningData());
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

describe('a Floor\'s source with shaped and pillared Halls (Stage 7b)', () => {
  const tuning = fullFloors(loadTuningData());
  let floors: DelverFloor[];
  beforeAll(() => {
    floors = [1, 2, 3, 4, 5, 6].map((seed) => delverFloor(tuning, seed, 1 + (seed % 3)));
  }, 300_000);

  const blocksOf = (f: DelverFloor) => f.source.brushes.filter((b) => b.kind === 'block');

  it('writes each Hall\'s solids then its pillars as Blocks to its ceiling, after the slopes, in Hall order', () => {
    let solids = 0;
    let pillars = 0;
    for (const f of floors) {
      const expected: Brush[] = f.plan.halls.flatMap((h): Brush[] => [
        ...h.solids.map((rect, n): Brush => ({ kind: 'block', id: `${h.id}-solid${n}`, rect, top: h.top, material: ({ Entrance: 'plaster', Stairs: 'cobble', Boss: 'bloodstone', Rest: 'brick', Treasure: 'tile', Fight: 'dungeon', Empty: 'basalt' } as const)[h.kind] })),
        ...h.pillars.map((rect, n): Brush => ({ kind: 'block', id: `${h.id}-pillar${n}`, rect, top: h.top, material: 'stone' })),
      ]);
      solids += f.plan.halls.reduce((n, h) => n + h.solids.length, 0);
      pillars += f.plan.halls.reduce((n, h) => n + h.pillars.length, 0);
      expect(blocksOf(f)).toEqual(expected);
      // The Blocks are the source's last Brushes, after every slope's Ramp.
      const brushes = f.source.brushes;
      expect(brushes.slice(brushes.length - expected.length)).toEqual(expected);
      expect(brushes.slice(0, brushes.length - expected.length).some((b) => b.kind === 'block')).toBe(false);
    }
    expect(solids).toBeGreaterThan(0);
    expect(pillars).toBeGreaterThan(0);
  });

  it('compiles (its walk check included) and builds', () => {
    for (const f of floors) expect(() => buildFloor(tuning, f.plan)).not.toThrow();
  }, 300_000);

  it('moves Team 0\'s front rank off any Block it would cross, and keeps 52 otherwise', () => {
    for (const f of floors) {
      const front = f.source.front;
      expect(blocksOf(f).some((b) => b.kind === 'block' && b.rect.z0 < -front && b.rect.z1 > -front)).toBe(false);
      if (!blocksOf(f).some((b) => b.kind === 'block' && b.rect.z0 < -52 && b.rect.z1 > -52)) expect(front).toBe(52);
    }
  });

  it('writes no Block, and the same bytes as the bundled data\'s, with the 7b knobs off (`plainHalls`)', () => {
    const bundled = fullFloors(loadTuningData());
    const plain = plainHalls(bundled);
    for (const [seed, floor] of [[1, 1], [2, 2], [3, 3]] as const) {
      const a = floorSource(planFloor(plain.delver.floor, seed, floor, 0, floor === 3), plain.battle.field.size);
      expect(a.brushes.some((br) => br.kind === 'block')).toBe(false);
      expect(a.front).toBe(52);
    }
  });

  it('puts no Wall on a 2 m destination-field cell centre', () => {
    const at2 = { ...tuning, battle: { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: 2 } } };
    for (const f of floors.slice(0, 4)) expect(checkMap(f.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
  }, 120_000);
});

describe('a Floor\'s source with vertical features and wrapped galleries (Stage 7c)', () => {
  const tuning = fullFloors(loadTuningData());
  let floors: DelverFloor[];
  beforeAll(() => {
    // Seeds 1 to 4 of Floors 1 to 3 (Floor 3 a Boss Floor): they hold every kind of feature and both wraps (asserted below).
    floors = [];
    for (let seed = 1; seed <= 4; seed++) for (const floor of [1, 2, 3]) floors.push(delverFloor(tuning, seed, floor));
  }, 600_000);

  const ids = (f: DelverFloor) => f.source.brushes.map((b) => b.id);
  const brush = (f: DelverFloor, id: string): Brush | undefined => f.source.brushes.find((b) => b.id === id);
  const hallsWith = (kind: 'split' | 'pit' | 'dais') => floors.flatMap((f) => f.plan.halls.flatMap((h) => (h.feature?.kind === kind ? [{ f, h, feat: h.feature }] : [])));
  const MATERIAL = { Entrance: 'plaster', Stairs: 'cobble', Boss: 'bloodstone', Rest: 'brick', Treasure: 'tile', Fight: 'dungeon', Empty: 'basalt' } as const;

  it('has every kind of feature and both wraps among its Floors', () => {
    expect(hallsWith('split').some(({ feat }) => feat.kind === 'split' && feat.tiers.length === 2)).toBe(true);
    expect(hallsWith('split').some(({ feat }) => feat.kind === 'split' && feat.tiers.length === 3)).toBe(true);
    expect(hallsWith('pit').some(({ feat }) => feat.kind === 'pit' && feat.depth === 2)).toBe(true);
    expect(hallsWith('dais').some(({ h }) => h.kind === 'Boss')).toBe(true);
    expect(hallsWith('dais').some(({ h }) => h.kind === 'Treasure')).toBe(true);
    const walls = floors.flatMap((f) => f.plan.halls.flatMap((h) => (h.gallery?.wrap ? [h.gallery.wrap.walls.length] : [])));
    expect(walls).toContain(1);
    expect(walls).toContain(2);
  });

  it('writes a split\'s main tier as a Platform at the Hall\'s height, then its steps as stone Ramps, in the Hall\'s material', () => {
    const splits = hallsWith('split');
    expect(splits.length).toBeGreaterThan(0);
    for (const { f, h, feat } of splits) {
      if (feat.kind !== 'split') continue;
      const main = feat.tiers.find((t) => t.level === h.level)!;
      expect(brush(f, `${h.id}-tier`)).toEqual({ kind: 'platform', id: `${h.id}-tier`, rect: main.rect, top: h.y, material: MATERIAL[h.kind] });
      expect(feat.steps.length).toBe(feat.tiers.length - 1);
      feat.steps.forEach((st, n) => expect(brush(f, `${h.id}-step${n}`)).toEqual({ kind: 'ramp', id: `${h.id}-step${n}`, rect: st.rect, lo: st.lo, hi: st.hi, up: st.up, rails: st.rails, material: 'stone' }));
      expect(brush(f, `${h.id}-step${feat.steps.length}`)).toBeUndefined();
      // Its Enclosure stands at its lowest tier, under the main tier's height, and the roof is the Hall's.
      const e = brush(f, h.id);
      expect(e?.kind).toBe('enclosure');
      if (e?.kind !== 'enclosure') continue;
      expect(e.y).toBe(hallBase(h));
      expect(e.y).toBe(h.y - 2);
      expect(enclosureTop(e, f.source.levels!)).toBe(h.top);
      expect(h.top).toBe(h.y + 4);
      expect(e.doors).toEqual(h.doors);
      for (const t of feat.tiers) expect(f.source.levels).toContain(t.y);
    }
  });

  it('writes a pit\'s four rims as Platforms at the rim\'s height, then its two steps; its Enclosure stands at the pit floor', () => {
    const pits = hallsWith('pit');
    expect(pits.length).toBeGreaterThan(0);
    for (const { f, h, feat } of pits) {
      if (feat.kind !== 'pit') continue;
      expect(feat.rims.length).toBe(4);
      feat.rims.forEach((rect, n) => expect(brush(f, `${h.id}-rim${n}`)).toEqual({ kind: 'platform', id: `${h.id}-rim${n}`, rect, top: h.y + feat.depth, material: MATERIAL[h.kind] }));
      expect(feat.steps.length).toBe(2);
      feat.steps.forEach((st, n) => expect(brush(f, `${h.id}-step${n}`)).toEqual({ kind: 'ramp', id: `${h.id}-step${n}`, rect: st.rect, lo: h.y, hi: h.y + feat.depth, up: st.up, rails: st.rails, material: 'stone' }));
      const e = brush(f, h.id);
      expect(e?.kind === 'enclosure' && e.y).toBe(h.y);
      expect(hallBase(h)).toBe(h.y);
      expect(h.top).toBe(h.y + feat.depth + 4);
      expect(f.source.levels).toContain(h.y + feat.depth);
      expect(Object.keys(h.doors)).toEqual([]);
    }
  });

  it('writes a dais as a stone Platform one metre over the floor, then its one step', () => {
    const daises = hallsWith('dais');
    expect(daises.length).toBeGreaterThan(0);
    for (const { f, h, feat } of daises) {
      if (feat.kind !== 'dais') continue;
      expect(brush(f, `${h.id}-dais`)).toEqual({ kind: 'platform', id: `${h.id}-dais`, rect: feat.rect, top: h.y + 1, material: 'stone' });
      expect(feat.steps.length).toBe(1);
      const st = feat.steps[0]!;
      expect(brush(f, `${h.id}-step0`)).toEqual({ kind: 'ramp', id: `${h.id}-step0`, rect: st.rect, lo: h.y, hi: h.y + 1, up: st.up, rails: st.rails, material: 'stone' });
      const e = brush(f, h.id);
      expect(e?.kind === 'enclosure' && e.y).toBe(h.y);
      expect(f.source.levels).toContain(h.y + 1);
    }
  });

  it('puts every Hall\'s feature Brushes together in Hall order, after the galleries and before the slopes and Blocks', () => {
    for (const f of floors) {
      const expected = f.plan.halls.flatMap((h) => {
        const ft = h.feature;
        if (!ft) return [];
        const first = ft.kind === 'split' ? [`${h.id}-tier`] : ft.kind === 'pit' ? ft.rims.map((_, n) => `${h.id}-rim${n}`) : [`${h.id}-dais`];
        return [...first, ...ft.steps.map((_, n) => `${h.id}-step${n}`)];
      });
      const all = ids(f);
      if (expected.length === 0) continue;
      const at = all.indexOf(expected[0]!);
      expect(all.slice(at, at + expected.length)).toEqual(expected);
      // Before: abyss, Halls, Passages, galleries; after: slopes then Blocks.
      const kinds = f.source.brushes.map((b) => b.kind);
      const lastGallery = Math.max(...kinds.map((k, i) => (k === 'deck' ? i : -1)), ...ids(f).map((id, i) => (/^hall\d+-ramp$/.test(id) ? i : -1)));
      expect(at).toBeGreaterThan(lastGallery);
      const firstSlope = all.findIndex((id) => /^pass\d+(-\d+)?-ramp$/.test(id));
      if (firstSlope >= 0) expect(firstSlope).toBeGreaterThanOrEqual(at + expected.length);
      const firstBlock = kinds.indexOf('block');
      if (firstBlock >= 0) expect(firstBlock).toBeGreaterThan(at + expected.length - 1);
      expect(all.slice(0, 1)).toEqual(['abyss']);
    }
  });

  it('writes a wrapped gallery\'s Decks after its first, then its Ramp, at its y in wood', () => {
    let wraps = 0;
    for (const f of floors) {
      for (const h of f.plan.halls) {
        const g = h.gallery;
        if (!g) continue;
        const all = ids(f);
        const at = all.indexOf(`${h.id}-deck`);
        expect(at).toBeGreaterThan(0);
        const decks = g.wrap?.decks ?? [];
        expect(all.slice(at, at + decks.length + 2)).toEqual([`${h.id}-deck`, ...decks.map((_, n) => `${h.id}-deck${n + 1}`), `${h.id}-ramp`]);
        expect(brush(f, `${h.id}-deck`)).toEqual({ kind: 'deck', id: `${h.id}-deck`, rect: g.deck, y: g.y, material: 'wood' });
        decks.forEach((rect, n) => expect(brush(f, `${h.id}-deck${n + 1}`)).toEqual({ kind: 'deck', id: `${h.id}-deck${n + 1}`, rect, y: g.y, material: 'wood' }));
        expect(brush(f, `${h.id}-deck${decks.length + 1}`)).toBeUndefined();
        if (g.wrap) wraps++;
      }
    }
    expect(wraps).toBeGreaterThan(0);
  });

  it('keeps `levels` ascending and unique with every height, and asks for shortcuts exactly when there is a gallery or a feature', () => {
    for (const f of floors) {
      const levels = f.source.levels!;
      expect(levels).toEqual([...new Set(levels)].sort((a, b) => a - b));
      for (const h of f.plan.halls) {
        for (const y of [hallBase(h), h.y, h.top]) expect(levels).toContain(y);
        const ft = h.feature;
        if (ft?.kind === 'split') for (const t of ft.tiers) expect(levels).toContain(t.y);
        if (ft?.kind === 'pit') expect(levels).toContain(ft.rim);
        if (ft?.kind === 'dais') expect(levels).toContain(ft.y);
        if (h.gallery) expect(levels).toContain(h.gallery.y);
      }
      expect(f.source.shortcuts).toBe(f.plan.halls.some((h) => h.gallery || h.feature) ? true : undefined);
    }
  });

  it('is byte for byte the old source with the 7c knobs off (`flatHalls`): no feature Brush, no wrap Deck', () => {
    const flat = flatHalls(loadTuningData());
    for (const [seed, floor] of [[1, 1], [2, 2], [3, 3]] as const) {
      const plan = planFloor(flat.delver.floor, seed, floor, 0, floor === 3);
      const source = floorSource(plan, flat.battle.field.size);
      expect(plan.halls.some((h) => h.feature || h.gallery?.wrap)).toBe(false);
      expect(source.brushes.some((b) => /-(tier|rim\d|dais|step\d|deck\d)$/.test(b.id))).toBe(false);
      expect(source.brushes.map((b) => b.kind)).not.toContain('platform');
    }
  });

  it('compiles (its walk check included) and puts no Wall on a 2 m destination-field cell centre', () => {
    const at2 = { ...tuning, battle: { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: 2 } } };
    for (const f of floors.slice(0, 6)) {
      expect(() => buildFloor(tuning, f.plan)).not.toThrow();
      expect(checkMap(f.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
    }
  }, 300_000);
});
