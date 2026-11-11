/**
 * The drowned catacombs: a Duel Arena authored in the Map Editor (`docs/plans/map-editor/catacombs.source.json`) and exported with
 * `compileArena` to `data/arenas/catacombs.json`. The shipped Arena is the export of the shipped source, the Fighters can walk it, and a
 * Duel is fought on it.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMatch, stepMatch, arenaOf, groundBelow } from '../sim';
import { walkCheck } from '../sim/levels';
import { loadTuningData } from '../tuning';
import { arenaFileText, compileArena } from './arenaExport';
import { parseMapSource } from './source';

const tuning = loadTuningData();
const source = parseMapSource(JSON.parse(fs.readFileSync('docs/plans/map-editor/catacombs.source.json', 'utf8')));
const { arena, warnings } = compileArena(source, tuning.battle);

describe('the drowned catacombs', () => {
  it('compiles with no warnings, and the shipped Arena is the export of the shipped source', () => {
    expect(warnings).toEqual([]);
    expect(fs.readFileSync('data/arenas/catacombs.json', 'utf8')).toBe(arenaFileText(arena));
    expect(tuning.arenas.catacombs).toEqual(arena);
  });

  it('is one high nave with a flooded pit three levels down, and a roof out of reach', () => {
    const ys = new Set(arena.walk.filter((w) => !w.roof).map((w) => w.points[0]!.y));
    expect([...ys].sort((a, b) => a - b)).toEqual(expect.arrayContaining([-8, -3, 0]));
    expect(arena.walk.some((w) => w.water)).toBe(true);
    expect(arena.walk.some((w) => w.roof && w.points[0]!.y === 10)).toBe(true);
    expect(walkCheck(arena, tuning.battle.levels)).toBeNull();
  });

  it('stands each Team four spawns on the floor, facing each other, and is its own half turn', () => {
    for (const team of [0, 1] as const) {
      const spawns = arena.spawns.filter((s) => s.team === team);
      expect(spawns.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
      for (const s of spawns) expect(groundBelow(arena, s.position.x, s.position.z, 1)?.y).toBeCloseTo(s.position.y, 6);
    }
    for (const s of arena.spawns.filter((s) => s.team === 0)) {
      const twin = arena.spawns.find((t) => t.team === 1 && t.slot === s.slot)!;
      expect(twin.position.x).toBeCloseTo(-s.position.x, 6);
      expect(twin.position.z).toBeCloseTo(-s.position.z, 6);
    }
  });

  it('is fought on: a Duel starts there and steps', () => {
    let m = createMatch(tuning, { format: 'Duels', bestOf: 1, seed: 3, arena: 'catacombs' });
    expect(arenaOf(tuning, m.arena).name).toBe('catacombs');
    for (let i = 0; i < 300; i++) m = stepMatch(m, [], tuning);
    expect(m.tick).toBeGreaterThan(0);
  });
});
