import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT } from '../sim';
import { describeReport, frameArena, labArena, withArena } from './arenaLab';

const tuning = loadTuningData();

describe('withArena', () => {
  it('fights in the Arena given, leaving the Tuning Data it copies untouched', () => {
    const { arena } = generateArena(GREYBOX_KIT, 3, DEFAULT_GEN_PARAMS, tuning);
    const lab = withArena(tuning, arena);
    expect(lab.arena.editor).toBe('gen:greybox:3');
    expect(lab.arenas['gen:greybox:3']).toBe(arena);
    expect(lab.arenas.circle).toBe(tuning.arenas.circle);
    expect(tuning.arenas['gen:greybox:3']).toBeUndefined();
    expect(tuning.arena.editor).not.toBe('gen:greybox:3');
  });
});

describe('frameArena: the orbit camera over the whole footprint', () => {
  const arena = parseArena(
    {
      name: 'gen:test',
      walk: [
        { id: 'floor', points: [[0, 0, 0], [12, 0, 0], [12, 0, 6], [0, 0, 6]] },
        { id: 'abyss', abyss: true, points: [[-50, -10, -50], [50, -10, -50], [50, -10, 50], [-50, -10, 50]] },
      ],
    },
    'test',
  );
  const { target, position } = frameArena(arena, 60);

  it('looks at the middle of the floors (the Abyss left out)', () => {
    expect(target.x).toBe(6);
    expect(target.z).toBe(3);
  });

  it('stands above, far enough back to see the whole footprint', () => {
    const d = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
    // A 12 m footprint seen through a 60° view needs at least 6 / tan(30°) ≈ 10.4 m.
    expect(d).toBeGreaterThan(10.4);
    expect(d).toBeLessThan(30);
    expect(position.y).toBeGreaterThan(target.y + 4);
  });
});

describe('labArena: a Generated Arena judged with the clock running', () => {
  it('times the navmesh build, and keeps the same Arena as generateArena', () => {
    const lab = labArena(5, DEFAULT_GEN_PARAMS, tuning);
    expect(lab.arena).toEqual(generateArena(GREYBOX_KIT, 5, DEFAULT_GEN_PARAMS, tuning).arena);
    expect(lab.report.stats.buildMs).toEqual(expect.any(Number));
  });

  it('comes with the Tuning Data to fight in it (judged with it, so its navmesh is already built)', () => {
    const lab = labArena(5, DEFAULT_GEN_PARAMS, tuning);
    expect(lab.tuning.arena.editor).toBe(lab.arena.name);
    expect(lab.tuning.arenas[lab.arena.name]).toBe(lab.arena);
  });
});

describe('describeReport', () => {
  const stats = { walkSurfaces: 30, links: { walk: 50, drop: 12, jump: 9, shortcut: 3 }, buildMs: 104.4, longestSpawnPath: 21.3, openFloor: 0.52 };

  it('gives the verdict, attempts, counts and build time', () => {
    const text = describeReport({ attempts: 2, report: { ok: true, reasons: [], stats } });
    expect(text).toContain('PASS');
    expect(text).toContain('2 attempts');
    expect(text).toContain('30 Walk Surfaces');
    expect(text).toContain('walk 50 · drop 12 · jump 9 · shortcut 3');
    expect(text).toContain('104 ms');
  });

  it('lists the reasons of a failing Arena', () => {
    const text = describeReport({ attempts: 20, report: { ok: false, reasons: ['team 0 spawn 1 has deadly ground within 3 m'], stats: { ...stats, buildMs: null } } });
    expect(text).toContain('FAIL');
    expect(text).toContain('team 0 spawn 1 has deadly ground within 3 m');
    expect(text).toContain('not timed');
  });
});

describe('labArena: the Kit dropdown', () => {
  it('generates from the Kit named, out of the Tuning Data', () => {
    const lab = labArena(5, DEFAULT_GEN_PARAMS, tuning, 'greybox');
    expect(lab.layout.kit).toBe('greybox');
    expect(lab.arena).toEqual(generateArena(tuning.kits.greybox!, 5, DEFAULT_GEN_PARAMS, tuning).arena);
  });

  it('refuses a Kit the Tuning Data does not hold', () => {
    expect(() => labArena(5, DEFAULT_GEN_PARAMS, tuning, 'marble')).toThrow(/no Kit "marble"/);
  });
});
