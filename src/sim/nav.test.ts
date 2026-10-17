import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { corners, findPath, navMesh, navPolygon, steer, type NavPoint } from './nav';

const tuning = loadTuningData();
const library = tuning.arenas.library!;
const id = (name: string) => library.walk.findIndex((s) => s.id === `WALK_${name}`);
const surfaces = (path: readonly number[]) => path.map((l) => library.walk[navMesh(library, tuning).links[l]!.to]!.id.slice(5));

describe('Navmesh', () => {
  it('joins Walk Surfaces that share an edge both ways, through their shared stretch', () => {
    const { links } = navMesh(library, tuning);
    const between = (a: string, b: string) => links.filter((l) => l.from === id(a) && l.to === id(b) && l.drop === 0);
    expect(between('bridge', 'ramp_grand')).toHaveLength(1);
    expect(between('ramp_grand', 'bridge')).toHaveLength(1);
    const up = between('ramp_grand', 'gallery')[0]!;
    // The grand ramp's head (x -1.5..1.5 at z 8), kept clear of its ends.
    for (const p of [up.left, up.right]) {
      expect(p.z).toBeCloseTo(8, 9);
      expect(Math.abs(p.x)).toBeLessThan(1.5 - tuning.fighter.radius);
    }
    // A ramp's side is not a way onto the floor beside it (heights differ, and a Wall stands there).
    expect(links.some((l) => l.from === id('ramp_west') && l.to === id('floor_centre'))).toBe(false);
  });

  it('drops off open ledges onto the floor below, but not where railed or too deep', () => {
    const { links } = navMesh(library, tuning);
    const drops = links.filter((l) => l.drop > 0);
    expect(drops.some((l) => l.from === id('bridge') && l.to === id('floor_centre'))).toBe(true);
    expect(drops.some((l) => l.from === id('mezz_south') && l.to === id('floor_alcove'))).toBe(true);
    for (const l of drops) expect(l.drop).toBeCloseTo(3, 6); // the gallery's 6 m drop is never taken
    expect(drops.some((l) => l.from === id('gallery'))).toBe(false);
    // The bridge's drops are only at its two gaps in the rail (x -6..-4.5 south, 4.5..6 north).
    for (const l of drops.filter((d) => d.from === id('bridge'))) {
      const x = (l.left.x + l.right.x) / 2;
      expect(Math.abs(x)).toBeGreaterThan(4.5);
      expect(Math.abs(x)).toBeLessThan(6);
    }
  });

  it('finds the way from the ground floor up to the gallery: a ramp, the mezzanine, the bridge, the grand ramp', () => {
    const from: NavPoint = { x: 0, y: 0, z: -4 };
    const to: NavPoint = { x: 6, y: 6, z: 10 };
    const path = findPath(library, tuning, from, to)!;
    const names = surfaces(path);
    expect(names.at(-1)).toBe('gallery');
    expect(names.slice(-3)).toEqual(['bridge', 'ramp_grand', 'gallery']);
    expect(names).toContain('floor_alcove');
    expect(names.some((n) => n === 'ramp_west' || n === 'ramp_east')).toBe(true);
    // The first corner to walk to is the alcove's mouth, not straight at the gallery.
    const next = steer(library, tuning, path, from, to);
    expect(next.z).toBeLessThan(-6);
  });

  it('takes a drop down when it is the short way, and walks within one surface straight', () => {
    const path = findPath(library, tuning, { x: -5, y: 3, z: 0 }, { x: -5, y: 0, z: -4 })!;
    expect(surfaces(path)).toEqual(['floor_centre']);
    expect(findPath(library, tuning, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toEqual([]);
    expect(findPath(library, tuning, { x: 50, y: 0, z: 0 }, { x: 5, y: 0, z: 5 })).toBeNull();
  });

  it('breaks ties the same way every time (the twin ramps cost the same)', () => {
    const from: NavPoint = { x: 0, y: 0, z: -7.5 };
    const to: NavPoint = { x: 0, y: 3, z: 0 };
    const a = findPath(library, tuning, from, to)!;
    expect(findPath(library, tuning, from, to)).toEqual(a);
    expect(surfaces(a)[0]).toBe('ramp_east'); // the lower id of the two
  });

  it('pulls the string around a corner', () => {
    // An L of two squares: (0..4, 0..4) and (4..8, 0..2) at the same height.
    const ell: TuningData = {
      ...tuning,
      arenas: {
        ...tuning.arenas,
        ell: parseArena(
          {
            name: 'ell',
            walk: [
              { id: 'a', points: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]] },
              { id: 'b', points: [[4, 0, 0], [8, 0, 0], [8, 0, 2], [4, 0, 2]] },
            ],
          },
          'ell',
        ),
      },
    };
    const arena = ell.arenas.ell!;
    expect(navPolygon(arena, ell, { x: 1, y: 0, z: 3.5 })).toBe(0);
    const path = findPath(arena, ell, { x: 1, y: 0, z: 3.5 }, { x: 7, y: 0, z: 1 })!;
    expect(path).toHaveLength(1);
    const cs = corners(arena, ell, path, { x: 1, z: 3.5 }, { x: 7, z: 1 });
    // Round the portal's upper end (z 2, kept clear), crossing it square, then straight to the goal.
    expect(cs.at(-1)).toEqual({ x: 7, z: 1 });
    expect(cs.length).toBeGreaterThan(1);
    for (const c of cs.slice(0, -1)) {
      expect(c.z).toBeLessThan(2);
      expect(Math.abs(c.x - 4)).toBeLessThanOrEqual(ell.fighter.radius + 0.15 + 1e-9);
    }
  });
});
