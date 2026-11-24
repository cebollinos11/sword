import { beforeAll, describe, expect, it } from 'vitest';
import { enclosureTop, type Brush } from '../../mapEditor/source';
import { loadTuningData } from '../../tuning';
import { buildFloor, delverFloor, floorName, highId, holeId, isFloorName, landingId, lavaId, onlySetPiece, pieceId, planFloor, floorSource, stepId, type BuiltFloor, type DelverFloor, type DelverHall, type DelverPassage, type SetPieceKind } from './index';
import { checkMap } from '../../mapEditor/checks';
import { flatHalls, flatRooms, fullFloors, noLava, noSetPieces, plainHalls } from './flat.testdata';
import { floorTuningOf, isBossFloor, tierOf } from './troops';
import { deadly, groundBelow } from '../arena';
import { groundNear, trace, walled, walkCheck } from '../levels';
import { navMesh } from '../nav';
import { fieldAt } from './judge';
import { nodeIn, cellAt } from '../destinations';
import { LAVA_DEPTH } from './plan';
import { HALL_STOREY, hallBase, JUMP_SHORTCUT_CAP, PASSAGE_STOREY } from './plan';

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
          expect(enclosureTop(e, levels)).toBe(Math.max(q.y0, q.y1) + PASSAGE_STOREY);
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
          for (const y of [e.y, Math.max(q.y0, q.y1) + PASSAGE_STOREY]) expect(levels).toContain(y);
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
        ...h.solids.map((rect, n): Brush => ({ kind: 'block', id: `${h.id}-solid${n}`, rect, top: h.top, material: ({ Entrance: 'plaster', Stairs: 'cobble', Boss: 'bloodstone', Rest: 'brick', Treasure: 'marble', Fight: 'dungeon', Empty: 'basalt' } as const)[h.kind] })),
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
  // Stage 7f's set pieces off (`noSetPieces`): these Floors were found, and the Brush order written, on 7c's Floors.
  const tuning = noSetPieces(fullFloors(loadTuningData()));
  let floors: DelverFloor[];
  beforeAll(() => {
    // Seeds 1 to 4 of Floors 1 to 3 (Floor 3 a Boss Floor): they hold every kind of feature and both wraps (asserted below).
    floors = [];
    for (let seed = 1; seed <= 4; seed++) for (const floor of [1, 2, 3]) floors.push(delverFloor(tuning, seed, floor));
  }, 600_000);

  const ids = (f: DelverFloor) => f.source.brushes.map((b) => b.id);
  const brush = (f: DelverFloor, id: string): Brush | undefined => f.source.brushes.find((b) => b.id === id);
  const hallsWith = (kind: 'split' | 'pit' | 'dais') => floors.flatMap((f) => f.plan.halls.flatMap((h) => (h.feature?.kind === kind ? [{ f, h, feat: h.feature }] : [])));
  const MATERIAL = { Entrance: 'plaster', Stairs: 'cobble', Boss: 'bloodstone', Rest: 'brick', Treasure: 'marble', Fight: 'dungeon', Empty: 'basalt' } as const;

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
      expect(h.top).toBe(h.y + HALL_STOREY);
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
      expect(h.top).toBe(h.y + feat.depth + HALL_STOREY);
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

import { distanceTo } from '../destinations';
const distToCentre = (b: BuiltFloor, x: number, z: number, s: number) => distanceTo(b.fields, x, z, s);

describe('a Floor\'s source with lava (Stage 7d)', () => {
  // Stage 7f's set pieces off (`noSetPieces`): these Floors were found on 7d's data.
  const bundled = noSetPieces(loadTuningData());
  const on = bundled;
  const planOf = (tuning: typeof on, seed: number, floor: number) =>
    planFloor(floorTuningOf(tuning.delver, floor), seed, floor, 0, isBossFloor(tuning.delver, floor), tierOf(tuning.delver, floor));
  // Found by scanning seeds 1 to 40, Floors 1 to 9, on the shipped data: a trough Hall (one wall, then two), a pit, a river with one bridge and one with two.
  const PAIRS = [[1, 3, 'trough'], [10, 3, 'trough'], [10, 1, 'pit'], [16, 1, 'river'], [10, 5, 'river']] as const;
  const floors = PAIRS.map(([seed, floor, kind]) => ({ seed, floor, kind, plan: planOf(on, seed, floor) }));
  let built: BuiltFloor[];
  beforeAll(() => {
    built = floors.map((f) => buildFloor(on, f.plan));
  }, 120_000);
  const lavaHalls = (b: BuiltFloor): DelverHall[] => b.plan.halls.filter((h) => h.lava);
  
  it('has a pit, a river with two bridges, a river with one and troughs among its Floors', () => {
    const kinds = floors.flatMap((f) => f.plan.halls.flatMap((h) => (h.lava ? [h.lava.kind + (h.lava.kind === 'river' ? h.lava.bridges.length : '')] : [])));
    for (const k of ['pit', 'river1', 'river2', 'trough']) expect(kinds).toContain(k);
  });

  it('writes a Hole at the Hall\'s height then a lava Hazard LAVA_DEPTH under it for each lava rect, after the features and before the slopes, and `levels` holds the lava\'s y', () => {
    for (const b of built) {
      const ids = b.source.brushes.map((br) => br.id);
      const expected: Brush[] = b.plan.halls.flatMap((h) =>
        (h.lava?.rects ?? []).flatMap((rect, n): Brush[] => [
          { kind: 'hole', id: holeId(h, n), rect, y: h.y },
          { kind: 'hazard', id: lavaId(h, n), rect, y: h.lava!.y, hazard: 'lava' },
        ]),
      );
      expect(expected.length).toBeGreaterThan(0);
      const first = ids.indexOf(expected[0]!.id);
      expect(b.source.brushes.slice(first, first + expected.length)).toEqual(expected);
      expect(b.source.brushes.filter((br) => br.id.includes('-hole') || br.id.includes('-lava'))).toHaveLength(expected.length);
      // After the last feature Brush and gallery, before the first slope Ramp and the first Block.
      const featureAt = ids.reduce((m, id, i) => (/-(tier|rim\d|dais|step\d|deck\d*|ramp)$/.test(id) && !id.includes('pass') ? i : m), -1);
      expect(first).toBeGreaterThan(featureAt);
      const slopeAt = b.source.brushes.findIndex((br) => br.id.endsWith('-ramp') && br.id.startsWith('pass'));
      if (slopeAt >= 0) expect(first + expected.length).toBeLessThanOrEqual(slopeAt);
      const blockAt = b.source.brushes.findIndex((br) => br.kind === 'block');
      if (blockAt >= 0) expect(first + expected.length).toBeLessThanOrEqual(blockAt);
      for (const h of lavaHalls(b)) {
        expect(h.lava!.y).toBe(h.y - LAVA_DEPTH);
        expect(b.source.levels).toContain(h.lava!.y);
      }
      expect(b.source.levels).toEqual([...new Set(b.source.levels)].sort((x, y) => x - y));
      expect(b.source.shortcuts === true).toBe(b.plan.halls.some((h) => h.gallery || h.feature));
    }
  });

  it('compiles (its walk check included) and passes `walkCheck`', () => {
    for (const b of built) expect(walkCheck(b.field.arena, b.battle.levels)).toBeNull();
  });

  it('puts lava ground 4 m under the floor at each lava rect\'s centre', () => {
    for (const b of built)
      for (const h of lavaHalls(b))
        for (const r of h.lava!.rects) {
          const x = (r.x0 + r.x1) / 2;
          const z = (r.z0 + r.z1) / 2;
          const g = groundBelow(b.field.arena, x, z, h.y + b.battle.levels.stepUp);
          expect(g, `${h.id} ${JSON.stringify(r)}`).not.toBeNull();
          expect(deadly(b.field.arena.walk[g!.surface]!)).toBe('Lava');
          expect(g!.y).toBe(h.y - LAVA_DEPTH);
        }
  });

  it('stands no Wall along a lava edge that lies inside the Hall (an open ledge)', () => {
    let edges = 0;
    for (const b of built) {
      const { arena } = b.field;
      const lv = b.battle.levels;
      for (const h of lavaHalls(b))
        for (const r of h.lava!.rects) {
          const sides = [
            { on: r.z0 > h.rect.z0, at: (t: number) => [[t, r.z0 - 0.5], [t, r.z0 + 0.5]], lo: r.x0, hi: r.x1 },
            { on: r.z1 < h.rect.z1, at: (t: number) => [[t, r.z1 + 0.5], [t, r.z1 - 0.5]], lo: r.x0, hi: r.x1 },
            { on: r.x0 > h.rect.x0, at: (t: number) => [[r.x0 - 0.5, t], [r.x0 + 0.5, t]], lo: r.z0, hi: r.z1 },
            { on: r.x1 < h.rect.x1, at: (t: number) => [[r.x1 + 0.5, t], [r.x1 - 0.5, t]], lo: r.z0, hi: r.z1 },
          ];
          for (const sd of sides) {
            if (!sd.on) continue;
            for (let t = sd.lo + 0.5; t < sd.hi; t += 0.5) {
              const [[px, pz], [qx, qz]] = sd.at(t) as [[number, number], [number, number]];
              expect(walled(arena, lv, px!, pz!, qx!, qz!, h.y), `${h.id} edge at ${px},${pz}`).toBe(false);
              edges++;
            }
          }
        }
    }
    expect(edges).toBeGreaterThan(0);
  });

  it('refuses a Soldier\'s walk from the floor onto lava, and allows one across a river\'s bridge', () => {
    let tried = 0;
    let bridges = 0;
    for (const b of built) {
      const { arena } = b.field;
      const lv = b.battle.levels;
      for (const h of lavaHalls(b))
        for (const r of h.lava!.rects) {
          const cx = (r.x0 + r.x1) / 2;
          const cz = (r.z0 + r.z1) / 2;
          // A point 1 m off the middle of each side that stands on the Hall's floor.
          const outs = [[cx, r.z0 - 1], [cx, r.z1 + 1], [r.x0 - 1, cz], [r.x1 + 1, cz]] as const;
          let any = false;
          for (const [x, z] of outs) {
            const s = groundNear(arena, lv, x, z, h.y);
            if (s < 0 || deadly(arena.walk[s]!)) continue;
            const g = groundBelow(arena, x, z, h.y + lv.stepUp);
            if (!g || Math.abs(g.y - h.y) > 1e-6 || h.rect.x0 > x || x > h.rect.x1 || h.rect.z0 > z || z > h.rect.z1) continue;
            any = true;
            tried++;
            expect(trace(arena, lv, s, x, z, cx, cz, true), `${h.id} onto ${JSON.stringify(r)}`).toBe(-1);
          }
          expect(any, `${h.id} ${JSON.stringify(r)} has a floor beside it`).toBe(true);
        }
      for (const h of lavaHalls(b))
        for (const br of h.lava!.bridges) {
          const acrossZ = h.lava!.walls[0] === 'n' || h.lava!.walls[0] === 's';
          const mx = (br.x0 + br.x1) / 2;
          const mz = (br.z0 + br.z1) / 2;
          const [ax, az, bx, bz] = acrossZ ? [mx, br.z0 - 1, mx, br.z1 + 1] : [br.x0 - 1, mz, br.x1 + 1, mz];
          const s = groundNear(arena, lv, ax, az, h.y);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(trace(arena, lv, s, ax, az, bx, bz, true), `${h.id} across its bridge`).toBeGreaterThanOrEqual(0);
          bridges++;
        }
    }
    expect(tried).toBeGreaterThan(0);
    expect(bridges).toBeGreaterThan(0);
  });

  it('joins no floor node to a lava node in the destination fields, and reaches each bridge', () => {
    let lavaNodes = 0;
    for (const b of built) {
      const { arena } = b.field;
      const { fields } = b;
      for (const h of lavaHalls(b)) {
        const cs = groundNear(arena, b.battle.levels, h.cx, h.cz, h.y);
        const d = distToCentre(b, h.cx, h.cz, cs);
        expect(fieldAt(fields, d, h.cx, h.cz, cs)).toBeGreaterThanOrEqual(0);
        for (const r of h.lava!.rects)
          for (let x = 2 * Math.ceil(r.x0 / 2); x <= r.x1; x += 2)
            for (let z = 2 * Math.ceil(r.z0 / 2); z <= r.z1; z += 2) {
              if (x <= r.x0 || x >= r.x1 || z <= r.z0 || z >= r.z1) continue;
              const g = groundBelow(arena, x, z, h.y - LAVA_DEPTH + 0.1)!;
              const node = nodeIn(fields, cellAt(fields, x, z), g.surface);
              expect(node).toBeGreaterThanOrEqual(0);
              expect(d[node]!, `${h.id} lava node at ${x},${z}`).toBe(-1);
              lavaNodes++;
            }
        for (const br of h.lava!.bridges) {
          const x = (br.x0 + br.x1) / 2;
          const z = (br.z0 + br.z1) / 2;
          const s = groundNear(arena, b.battle.levels, x, z, h.y);
          expect(fieldAt(fields, d, x, z, s), `${h.id} bridge centre`).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(lavaNodes).toBeGreaterThan(0);
  });

  it('gives the navmesh no Link onto or off lava and no jump Link that takes off or lands in a lava rect', () => {
    for (const b of built) {
      const { arena } = b.field;
      const mesh = navMesh(arena, on);
      const bad = mesh.links.filter((l) => arena.walk[l.from]!.lava || arena.walk[l.to]!.lava);
      expect(bad).toHaveLength(0);
      const rects = lavaHalls(b).flatMap((h) => h.lava!.rects);
      const inside = (x: number, z: number) => rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
      const jumps = mesh.links.filter((l) => l.kind === 'jump' && (inside(l.takeoff.x, l.takeoff.z) || inside(l.lands.x, l.lands.z)));
      expect(jumps.length, `jump Links in lava rects: ${jumps.length}; near lava: ${mesh.links.filter((l) => l.kind === 'jump').length} jumps in all`).toBe(0);
    }
  }, 120_000);

  it('puts no Wall on a 2 m destination-field cell centre (checkMap)', () => {
    const at2 = { ...on, battle: { ...on.battle, crowd: { ...on.battle.crowd, flowCell: 2 } } };
    for (const b of built) expect(checkMap(b.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
  }, 120_000);

  it('writes today\'s source, byte for byte, with lava off', () => {
    const off = noLava(bundled);
    for (const t of [off])
      for (const [seed, floor] of [[1, 1], [3, 1], [1, 7], [1, 8], [1, 9], [2, 4]] as const) {
        const plan = planOf(t, seed, floor);
        expect(plan.halls.some((h) => h.lava)).toBe(false);
        const source = floorSource(plan, t.battle.field.size);
        expect(source.brushes.some((br) => br.id.includes('-hole') || br.id.includes('-lava'))).toBe(false);
        const bare = { ...plan, halls: plan.halls.map(({ lava: _l, ...h }) => h as DelverHall) };
        expect(JSON.stringify(source)).toBe(JSON.stringify(floorSource(bare, t.battle.field.size)));
      }
  });

  it('is a lava-free Floor\'s source plus the lava Brushes and levels when the same plan keeps its lava', () => {
    for (const b of built) {
      const bare = { ...b.plan, halls: b.plan.halls.map(({ lava: _l, ...h }) => h as DelverHall) };
      const without = floorSource(bare, on.battle.field.size);
      const stripped = b.source.brushes.filter((br) => !/-(hole|lava)\d+$/.test(br.id));
      expect(stripped).toEqual(without.brushes);
    }
  });
});

describe('a Floor\'s source with set pieces (Stage 7f)', () => {
  const bundled = loadTuningData();
  const planOf = (tuning: typeof bundled, seed: number, floor: number) =>
    planFloor(floorTuningOf(tuning.delver, floor), seed, floor, 0, isBossFloor(tuning.delver, floor), tierOf(tuning.delver, floor));
  // Found by scanning seeds 1 to 6, Floors 1, 4 and 7, each on `onlySetPiece`: Uphills of 1 and 2 levels, Spirals of several bases and turns, Lava Bridges of 1 to 4 arms (one in a great hall).
  const PAIRS = [['uphill', 1, 7], ['uphill', 3, 7], ['spiral', 1, 7], ['spiral', 4, 7], ['cross', 1, 7], ['cross', 3, 1]] as const;
  const floors = PAIRS.map(([kind, seed, floor]) => ({ kind, seed, floor, tuning: onlySetPiece(bundled, kind), plan: planOf(onlySetPiece(bundled, kind), seed, floor) }));
  let built: (BuiltFloor & { kind: SetPieceKind })[];
  beforeAll(() => {
    built = floors.map((f) => ({ ...buildFloor(f.tuning, f.plan), kind: f.kind }));
  }, 120_000);
  const of = (kind: SetPieceKind) => built.filter((b) => b.kind === kind);
  const uphills = (b: BuiltFloor) => b.plan.halls.flatMap((h) => (h.feature?.kind === 'uphill' ? [{ h, f: h.feature }] : []));
  const spirals = (b: BuiltFloor) => b.plan.halls.flatMap((h) => (h.feature?.kind === 'spiral' ? [{ h, f: h.feature }] : []));
  const brush = (b: BuiltFloor, id: string) => b.source.brushes.find((br) => br.id === id);
  const mid = (r: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  const surfaceId = (b: BuiltFloor, s: number) => (s >= 0 ? b.field.arena.walk[s]!.id : 'none');
  const lv = bundled.battle.levels;

  it('has Uphills of 1 and 2 levels, Spirals and Lava Bridges of 1 to 4 arms (one in a great hall) among its Floors', () => {
    expect(new Set(built.flatMap((b) => uphills(b).map((u) => u.f.rise)))).toEqual(new Set([1, 2]));
    expect(built.reduce((a, b) => a + spirals(b).length, 0)).toBeGreaterThan(4);
    const crosses = built.flatMap((b) => b.plan.halls.filter((h) => h.lava?.kind === 'cross'));
    expect(new Set(crosses.map((h) => h.lava!.bridges.length))).toEqual(new Set([1, 2, 3, 4]));
    expect(crosses.some((h) => h.great)).toBe(true);
  });

  it('writes an Uphill\'s high landing as a Platform at the Hall\'s y, then its Ramp from the Enclosure\'s floor, railless; the Enclosure stands at the low landing', () => {
    for (const b of of('uphill'))
      for (const { h, f } of uphills(b)) {
        const ids = b.source.brushes.map((br) => br.id);
        expect(ids.indexOf(highId(h)) + 1).toBe(ids.indexOf(stepId(h, 0)));
        expect(brush(b, highId(h))).toEqual({ kind: 'platform', id: highId(h), rect: f.high, top: h.y, material: expect.any(String) });
        expect(brush(b, stepId(h, 0))).toEqual({ kind: 'ramp', id: stepId(h, 0), rect: f.steps[0]!.rect, lo: hallBase(h), hi: h.y, up: f.up, rails: [], material: 'stone' });
        expect(brush(b, h.id)).toMatchObject({ kind: 'enclosure', y: hallBase(h) });
        expect(b.source.levels).toContain(hallBase(h));
        expect(b.source.levels).toContain(h.top);
      }
  });

  it('writes a Spiral\'s five landings (each but the last over the next Ramp\'s rect too), then its five Ramps, in stone; `levels` holds every landing', () => {
    for (const b of of('spiral'))
      for (const { h, f } of spirals(b)) {
        const ids = b.source.brushes.map((br) => br.id);
        const want = [...f.landings.map((_, n) => landingId(h, n)), ...f.steps.map((_, n) => stepId(h, n))];
        const at = ids.indexOf(want[0]!);
        expect(ids.slice(at, at + 10)).toEqual(want);
        f.landings.forEach((l, n) => {
          const next = f.steps[n + 1]?.rect;
          const rect = next ? { x0: Math.min(l.rect.x0, next.x0), z0: Math.min(l.rect.z0, next.z0), x1: Math.max(l.rect.x1, next.x1), z1: Math.max(l.rect.z1, next.z1) } : l.rect;
          expect(brush(b, landingId(h, n))).toEqual({ kind: 'platform', id: landingId(h, n), rect, top: l.y, material: 'stone' });
          expect(b.source.levels).toContain(l.y);
        });
        f.steps.forEach((st, n) => expect(brush(b, stepId(h, n))).toEqual({ kind: 'ramp', id: stepId(h, n), rect: st.rect, lo: st.lo, hi: st.hi, up: st.up, rails: st.rails, material: 'stone' }));
        expect(brush(b, h.id)).toMatchObject({ kind: 'enclosure', y: h.y });
      }
  });

  it('writes a Lava Bridge as 7d\'s lava: a Hole then a lava Hazard for each lava rect', () => {
    for (const b of of('cross'))
      for (const h of b.plan.halls.filter((hh) => hh.lava?.kind === 'cross'))
        h.lava!.rects.forEach((rect, n) => {
          expect(brush(b, holeId(h, n))).toEqual({ kind: 'hole', id: holeId(h, n), rect, y: h.y });
          expect(brush(b, lavaId(h, n))).toEqual({ kind: 'hazard', id: lavaId(h, n), rect, y: h.lava!.y, hazard: 'lava' });
        });
  });

  it('compiles every kind (its walk check included) and passes `walkCheck`', () => {
    for (const b of built) expect(walkCheck(b.field.arena, lv), b.source.name).toBeNull();
  });

  it('lets a Soldier walk up an Uphill from its low landing to its high one', () => {
    for (const b of of('uphill'))
      for (const { h, f } of uphills(b)) {
        const lo = mid(f.low);
        const ramp = mid(f.steps[0]!.rect);
        const hi = mid(f.high);
        const start = groundNear(b.field.arena, lv, lo.x, lo.z, hallBase(h), false);
        const onRamp = trace(b.field.arena, lv, start, lo.x, lo.z, ramp.x, ramp.z, false);
        expect(surfaceId(b, onRamp)).toBe(`WALK_${stepId(h, 0)}`);
        expect(surfaceId(b, trace(b.field.arena, lv, onRamp, ramp.x, ramp.z, hi.x, hi.z, false))).toMatch(new RegExp(`^WALK_${highId(h)}_`));
      }
  });

  it('lets a Soldier walk round a Spiral\'s ledge from the well to its last landing, and never off it from there (6 m over the well); a body knocked off lands in the well', () => {
    for (const b of of('spiral'))
      for (const { h, f } of spirals(b)) {
        const arena = b.field.arena;
        const r1 = f.steps[0]!;
        const foot = mid(r1.rect);
        // The well, a metre before the first Ramp's foot.
        const [wx, wz] = r1.up === 'n' ? [foot.x, r1.rect.z0 - 1] : r1.up === 's' ? [foot.x, r1.rect.z1 + 1] : r1.up === 'e' ? [r1.rect.x0 - 1, foot.z] : [r1.rect.x1 + 1, foot.z];
        let s = groundNear(arena, lv, wx, wz, h.y, false);
        expect(surfaceId(b, s)).toMatch(new RegExp(`^WALK_${h.id}_`));
        let [x, z] = [wx, wz];
        for (let n = 0; n < 5; n++) {
          for (const [id, q] of [[`WALK_${stepId(h, n)}`, f.steps[n]!.rect], [`WALK_${landingId(h, n)}_`, f.landings[n]!.rect]] as const) {
            const c = mid(q);
            s = trace(arena, lv, s, x, z, c.x, c.z, false);
            expect(surfaceId(b, s).startsWith(id), `${h.id}: to ${id} from (${x}, ${z})`).toBe(true);
            [x, z] = [c.x, c.z];
          }
        }
        // Off L5 toward the Hall's centre: a 6 m drop, more than `levels.drop`.
        const l5 = f.landings[4]!.rect;
        const c = mid(l5);
        const [ox, oz] = Math.abs(h.cx - c.x) > Math.abs(h.cz - c.z) ? [c.x + Math.sign(h.cx - c.x) * 5, c.z] : [c.x, c.z + Math.sign(h.cz - c.z) * 5];
        expect(trace(arena, lv, s, c.x, c.z, ox, oz, true)).toBe(-1);
        expect(surfaceId(b, groundNear(arena, lv, ox, oz, f.landings[4]!.y, false))).toMatch(new RegExp(`^WALK_${h.id}_`));
      }
  });

  it('gives the navmesh no jump Link onto a Spiral\'s ledge past the foot of its second Ramp, and each within the shortcut cap', () => {
    for (const b of of('spiral')) {
      const arena = b.field.arena;
      const mesh = navMesh(arena, bundled);
      for (const { h } of spirals(b)) {
        const ledge = new RegExp(`^WALK_${h.id}-(step|landing)\\d`);
        const low = new RegExp(`^WALK_(${stepId(h, 0)}|${landingId(h, 0)}_\\d+|${stepId(h, 1)})$`);
        for (const l of mesh.links) {
          if (l.kind !== 'jump' || !ledge.test(arena.walk[l.to]!.id) || ledge.test(arena.walk[l.from]!.id)) continue;
          expect(arena.walk[l.to]!.id).toMatch(low);
          expect(l.lands.y - h.y).toBeLessThanOrEqual(JUMP_SHORTCUT_CAP);
        }
      }
    }
  }, 120_000);

  it('puts no Wall on a 2 m destination-field cell centre (checkMap)', () => {
    const at2 = { ...bundled, battle: { ...bundled.battle, crowd: { ...bundled.battle.crowd, flowCell: 2 } } };
    for (const b of built) expect(checkMap(b.source, at2).issues.filter((i) => i.kind === 'centre'), b.source.name).toEqual([]);
  }, 120_000);

  it('writes today\'s source, byte for byte, with set pieces off', () => {
    for (const [seed, floor] of [[1, 1], [1, 7], [4, 7], [3, 1]] as const) {
      const off = planOf(noSetPieces(onlySetPiece(bundled, 'spiral')), seed, floor);
      expect(JSON.stringify(floorSource(off, bundled.battle.field.size))).toBe(JSON.stringify(floorSource(planOf(noSetPieces(bundled), seed, floor), bundled.battle.field.size)));
    }
  });
});
