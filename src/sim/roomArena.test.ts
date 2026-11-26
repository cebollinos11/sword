import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { arenaOf, createMatch, IDLE_INTENT, isArenaName, navMesh, stepMatch } from './index';
import { duelRooms, roomArenaName, roomArenaOf } from './roomArena';

const tuning = loadTuningData();
const rooms = duelRooms(tuning);

/** `tuning` with drawn room `name` no longer offered as a Duel map. */
const unflagged = (name: string): TuningData => ({
  ...tuning,
  delver: { ...tuning.delver, floor: { ...tuning.delver.floor, drawnRooms: tuning.delver.floor.drawnRooms.map((r) => (r.name === name ? { ...r, duel: undefined } : r)) } },
});

describe('drawn rooms as Duel maps', () => {
  it('offers every drawn room flagged duel', () => {
    expect(rooms.map((r) => r.name)).toEqual(['bastion', 'brink', 'chasm', 'colonnade', 'colosseum', 'crucible']);
  });

  for (const room of rooms) {
    const name = roomArenaName(room.name);
    describe(name, () => {
      it('builds closed, with every jump Link, and the same Arena each time', () => {
        const built = roomArenaOf(tuning, name)!;
        expect(built.arena.name).toBe(name);
        expect(built.arena.jumpLinks).toBeUndefined();
        expect(arenaOf(tuning, name)).toBe(built.arena);
        const enclosures = built.source.brushes.filter((b) => b.kind === 'enclosure');
        expect(enclosures).toHaveLength(1);
        expect(enclosures[0]!.kind === 'enclosure' && Object.keys(enclosures[0]!.doors)).toEqual([]);
        expect(isArenaName(tuning, name)).toBe(true);
        expect(() => navMesh(built.arena, tuning)).not.toThrow();
      });

      it('spawns four a Team on safe ground inside the room, the Teams apart', () => {
        const { arena, source } = roomArenaOf(tuning, name)!;
        const rect = source.brushes.find((b) => b.kind === 'enclosure')!.rect;
        expect(arena.spawns).toHaveLength(8);
        for (const team of [0, 1]) for (let slot = 0; slot < 4; slot++) expect(arena.spawns.some((s) => s.team === team && s.slot === slot)).toBe(true);
        for (const s of arena.spawns) {
          const { x, y, z } = s.position;
          expect(x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1).toBe(true);
          expect(groundBelow(arena, x, z, y + 1e-6)?.y).toBeCloseTo(y);
          expect(deadlyGround(arena, x, z, y)).toBeNull();
        }
        const near = Math.min(...arena.spawns.filter((a) => a.team === 0).flatMap((a) => arena.spawns.filter((b) => b.team === 1).map((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z))));
        expect(near).toBeGreaterThanOrEqual(6);
      });
    });
  }

  it('refuses a room not flagged duel, and names that are not a room', () => {
    const t = unflagged('crucible');
    expect(isArenaName(t, 'room:crucible')).toBe(false);
    expect(() => arenaOf(t, 'room:crucible')).toThrow(/Unknown Arena/);
    expect(isArenaName(tuning, 'room:nosuch')).toBe(false);
    expect(isArenaName(tuning, 'room:')).toBe(false);
  });

  it('plays a Duel in a room, starting at its spawns', () => {
    const name = roomArenaName('crucible');
    let m = createMatch(tuning, { arena: name, bestOf: 3 });
    const spawn = arenaOf(tuning, name).spawns.find((p) => p.team === 0 && p.slot === 0)!;
    expect(m.duel.fighters[0]!.position).toEqual({ x: spawn.position.x, z: spawn.position.z });
    for (let i = 0; i < 300; i++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m.arena).toBe(name);
    for (const f of m.duel.fighters) {
      expect(f.hp).toBeGreaterThan(0);
      expect(deadlyGround(arenaOf(tuning, name), f.position.x, f.position.z, f.y)).toBeNull();
    }
  });
});
