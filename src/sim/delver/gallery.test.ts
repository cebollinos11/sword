import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { createMatch } from '../match';
import { delverFloor } from './generate';
import { galleryFloorTuning, setPieceOf } from './plan';
import { floorArenaName, floorOf, parseFloorArena } from './world';

const tuning = loadTuningData();

describe('the Set Piece Gallery (dev): one Floor with every set piece, one after another', () => {
  const g = galleryFloorTuning(tuning.delver.floor);
  const wanted = ['cross', 'uphill', 'spiral', ...tuning.delver.floor.drawnRooms.map((r) => r.name)];

  it('wants every set piece and every drawn room once, in order, on a path of neighbouring cells', () => {
    const { path, pieces } = g.gallery!;
    expect(pieces.flatMap((p) => (p ? [p.room ?? p.kind] : []))).toEqual(wanted);
    expect(path.length).toBe(g.rooms);
    expect(pieces[0]).toBeNull();
    expect(pieces[1]).toBeNull();
    expect(pieces[pieces.length - 1]).toBeNull();
    for (let k = 1; k < path.length; k++) {
      const [a, b] = [path[k - 1]!, path[k]!];
      expect(Math.abs((a % g.cols) - (b % g.cols)) + Math.abs(Math.floor(a / g.cols) - Math.floor(b / g.cols))).toBe(1);
    }
    expect(galleryFloorTuning(tuning.delver.floor)).toBe(g);
  });

  it.each([1, 2, 3, 4, 5, 6])('seed %i deals a Floor that passes the judge, each set piece in its Hall, the Entrance first and the Stairs last', (seed) => {
    const f = delverFloor(tuning, seed, 1, { gallery: true });
    expect(f.judgement.reasons).toEqual([]);
    const { plan } = f;
    expect(plan.gallery).toBe(true);
    expect(plan.entrance).toBe(0);
    expect(plan.stairs).toBe(plan.halls.length - 1);
    expect(plan.halls[plan.stairs]!.kind).toBe('Stairs');
    expect(plan.passages.filter((p) => p.loop)).toEqual([]);
    const got = plan.halls.flatMap((h) => {
      const sp = setPieceOf(h);
      return sp === 'room' && h.feature?.kind === 'room' ? [h.feature.name] : sp ? [sp] : [];
    });
    expect(got).toEqual(wanted);
    // The set pieces hold Warbands; the plain Halls are Empty.
    for (const h of plan.halls) if (setPieceOf(h)) expect(h.kind).toBe('Fight');
  });

  it("is named apart from a Run's Floor, and built from its name alone", () => {
    const name = floorArenaName(9, 1, true);
    expect(name).toBe('battle:delver1g9');
    expect(parseFloorArena(name)).toEqual({ seed: 9, floor: 1, gallery: true });
    expect(parseFloorArena(floorArenaName(9, 1))).toEqual({ seed: 9, floor: 1, gallery: false });
    expect(floorOf(tuning, name)!.plan.gallery).toBe(true);
    expect(floorOf(tuning, floorArenaName(9, 1))!.plan.gallery).toBeUndefined();
  });

  it('a gallery Run is that one Floor', () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0], humans: 1, players: [0], delverGallery: true });
    expect(m.arena).toMatch(/^battle:delver1g\d+$/);
    expect(m.delver!.floors).toBe(1);
    expect(() => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, arena: 'gen:greybox:4242', teams: [0], delverGallery: true, delverStart: 2 })).toThrow(/Set Piece Gallery/);
  });
});
