import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { jumpArc } from './jumpArc';
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
    // The gallery's 6 m drop is never taken; every drop is off a 3 m level, or off a reading table (0.8 m).
    const tables = [id('table0_top'), id('table1_top')];
    for (const l of drops) expect(l.drop).toBeCloseTo(tables.includes(l.from) ? 0.8 : 3, 6);
    for (const t of tables) expect(drops.some((l) => l.from === t)).toBe(true);
    expect(links.some((l) => tables.includes(l.to) && l.kind !== 'jump')).toBe(false); // the AI only gets onto a table by jumping
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

  it('walks across a shared edge on either side of a Wall that stands across its middle, but not through the Wall', () => {
    // Two floors sharing x = 0 (z 0..8), and a 1 m crate straddling the edge at z 3.5..4.5.
    const arena = parseArena(
      {
        name: 'crate',
        walk: [
          { id: 'WALK_a', points: [[-4, 0, 0], [0, 0, 0], [0, 0, 8], [-4, 0, 8]] },
          { id: 'WALK_b', points: [[0, 0, 0], [4, 0, 0], [4, 0, 8], [0, 0, 8]] },
        ],
        walls: [
          { id: 'WALL_s', a: [-0.5, 3.5], b: [0.5, 3.5], bottom: 0, top: 1 },
          { id: 'WALL_e', a: [0.5, 3.5], b: [0.5, 4.5], bottom: 0, top: 1 },
          { id: 'WALL_n', a: [0.5, 4.5], b: [-0.5, 4.5], bottom: 0, top: 1 },
          { id: 'WALL_w', a: [-0.5, 4.5], b: [-0.5, 3.5], bottom: 0, top: 1 },
        ],
      },
      'crate',
    );
    const t: TuningData = { ...tuning, arenas: { ...tuning.arenas, crate: arena } };
    const across = navMesh(arena, t).links.filter((l) => l.kind === 'walk' && l.from === 0 && l.to === 1);
    // One portal on each side of the crate, neither reaching into it.
    expect(across).toHaveLength(2);
    const [south, north] = [...across].sort((a, b) => a.left.z + a.right.z - b.left.z - b.right.z);
    expect(Math.max(south!.left.z, south!.right.z)).toBeLessThan(3.5);
    expect(Math.min(north!.left.z, north!.right.z)).toBeGreaterThan(4.5);
    expect(findPath(arena, t, { x: -2, y: 0, z: 6 }, { x: 2, y: 0, z: 6 })).toHaveLength(1);
  });

  it('joins the train\'s flatcar deck to its left bevel, past the waste drums standing on the edge', () => {
    const train = tuning.arenas.train!;
    const at = (name: string) => train.walk.findIndex((s) => s.id === `WALK_${name}`);
    const { links } = navMesh(train, tuning);
    expect(links.some((l) => l.kind === 'walk' && l.from === at('flat_deck') && l.to === at('flat_deck_bevel_l'))).toBe(true);
    expect(links.some((l) => l.kind === 'walk' && l.from === at('flat_deck_bevel_l') && l.to === at('flat_deck'))).toBe(true);
  });
});

describe('Jump Links', () => {
  /** A floor (x -10..10, z -10..20) at 0 and whatever else is given, as a fresh Arena (never cached before). */
  function world(walk: unknown[], walls: unknown[] = []): { arena: ReturnType<typeof parseArena>; t: TuningData } {
    const arena = parseArena({ name: 'j', walk: [{ id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 20], [-10, 0, 20]] }, ...walk], walls }, 'j');
    return { arena, t: { ...tuning, arenas: { ...tuning.arenas, j: arena } } };
  }
  /** A lid of height `h` over a 6 × 4 block (x -3..3, z 3..7), walled up to its top. */
  const block = (h: number) => ({
    walk: [{ id: 'WALK_lid', points: [[-3, h, 3], [3, h, 3], [3, h, 7], [-3, h, 7]] }],
    walls: [
      { id: 'WALL_s', a: [-3, 3], b: [3, 3], bottom: 0, top: h },
      { id: 'WALL_e', a: [3, 3], b: [3, 7], bottom: 0, top: h },
      { id: 'WALL_n', a: [3, 7], b: [-3, 7], bottom: 0, top: h },
      { id: 'WALL_w', a: [-3, 7], b: [-3, 3], bottom: 0, top: h },
    ],
  });
  const jumps = (arena: ReturnType<typeof parseArena>, t: TuningData, from: number, to: number) => navMesh(arena, t).links.filter((l) => l.kind === 'jump' && l.from === from && l.to === to);

  it('a 1 m block gets a jump Link up with a tap or a short hold', () => {
    const { walk, walls } = block(1);
    const { arena, t } = world(walk, walls);
    const up = jumps(arena, t, 0, 1);
    expect(up.length).toBeGreaterThan(0);
    for (const l of up) if (l.kind === 'jump') expect(l.holdTicks).toBeLessThanOrEqual(10);
    // The path from the floor onto the lid takes it.
    const path = findPath(arena, t, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 5 })!;
    expect(path.map((id) => navMesh(arena, t).links[id]!.kind)).toEqual(['jump']);
  });

  it('a 3.5 m block gets a jump Link up with a long hold', () => {
    const { walk, walls } = block(3.5);
    const { arena, t } = world(walk, walls);
    const up = jumps(arena, t, 0, 1);
    expect(up.length).toBeGreaterThan(0);
    for (const l of up) if (l.kind === 'jump') expect(l.holdTicks).toBeGreaterThanOrEqual(20);
  });

  it('a 4.6 m block is out of reach: no jump Link', () => {
    const { walk, walls } = block(4.6);
    const { arena, t } = world(walk, walls);
    expect(jumps(arena, t, 0, 1)).toEqual([]);
    expect(findPath(arena, t, { x: 0, y: 0, z: 0 }, { x: 0, y: 4.6, z: 5 })).toBeNull();
  });

  it('two floors with a 3 m gap get a jump Link across, both ways', () => {
    // The gap drops to ground far below (a Death by Fall): a body in the air only ever moves over ground.
    const arena = parseArena(
      {
        name: 'gap',
        walk: [
          { id: 'WALK_a', points: [[-5, 0, -10], [5, 0, -10], [5, 0, 0], [-5, 0, 0]] },
          { id: 'WALK_b', points: [[-5, 0, 3], [5, 0, 3], [5, 0, 13], [-5, 0, 13]] },
          { id: 'WALK_pit', points: [[-5, -10, 0], [5, -10, 0], [5, -10, 3], [-5, -10, 3]] },
        ],
      },
      'gap',
    );
    const t = { ...tuning, arenas: { ...tuning.arenas, gap: arena } };
    expect(jumps(arena, t, 0, 1).length).toBeGreaterThan(0);
    expect(jumps(arena, t, 1, 0).length).toBeGreaterThan(0);
    const path = findPath(arena, t, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 6 })!;
    expect(path).toHaveLength(1);
    const l = navMesh(arena, t).links[path[0]!]!;
    expect(l.kind).toBe('jump');
    if (l.kind !== 'jump') return;
    // The jump it takes lands across, and so does every slightly-off version of it.
    expect(jumpArc(arena, t, { at: l.takeoff, y: 0, heading: l.heading, holdTicks: l.holdTicks }).surface).toBe(1);
  });

  it('a gap over Lava that only the exact best Jump clears gets no jump Link', () => {
    const lava = parseArena(
      {
        name: 'lava',
        walk: [
          { id: 'WALK_a', points: [[-5, 0, -10], [5, 0, -10], [5, 0, 0], [-5, 0, 0]] },
          { id: 'WALK_b', points: [[-5, 0, 4.2], [5, 0, 4.2], [5, 0, 13], [-5, 0, 13]] },
          { id: 'WALK_lava', lava: true, points: [[-5, -1, 0], [5, -1, 0], [5, -1, 4.2], [-5, -1, 4.2]] },
        ],
      },
      'lava',
    );
    const t = { ...tuning, arenas: { ...tuning.arenas, lava } };
    // The best Jump (full, from the very edge) just makes it...
    expect(jumpArc(lava, t, { at: { x: 0, z: -0.02 }, y: 0, heading: { x: 0, z: 1 }, holdTicks: 30 }).surface).toBe(1);
    // ...but not from a little further back, so it is no Link.
    expect(jumps(lava, t, 0, 1)).toEqual([]);
    expect(findPath(lava, t, { x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 6 })).toBeNull();
  });

  it('a block under a ceiling too low to jump onto it gets no jump Link', () => {
    const { walk, walls } = block(1);
    const { arena, t } = world([...walk, { id: 'WALK_ceiling', points: [[-10, 2.3, -10], [10, 2.3, -10], [10, 2.3, 20], [-10, 2.3, 20]] }], walls);
    expect(jumps(arena, t, 0, 1)).toEqual([]);
    expect(jumps(arena, t, 0, 2)).toEqual([]);
  });

  it('builds the same Links in the same order every time', () => {
    const fresh = () => parseArena(JSON.parse(JSON.stringify(library)), 'library');
    const a = fresh();
    const b = fresh();
    const t = (arena: ReturnType<typeof parseArena>) => ({ ...tuning, arenas: { ...tuning.arenas, library: arena } });
    expect(navMesh(a, t(a)).links).toEqual(navMesh(b, t(b)).links);
  });

  it('can leave jump Links out of a path, or those held too long', () => {
    const { walk, walls } = block(3.5);
    const { arena, t } = world(walk, walls);
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 0, y: 3.5, z: 5 };
    expect(findPath(arena, t, from, to)).not.toBeNull();
    expect(findPath(arena, t, from, to, { jumps: false })).toBeNull();
    expect(findPath(arena, t, from, to, { maxJumpHold: 10 })).toBeNull();
  });
});
