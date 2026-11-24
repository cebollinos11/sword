import { describe, expect, it } from 'vitest';
import { FIXTURE_ROOM, FIXTURE_ROOM_RAW } from '../sim/delver/rooms.testdata';
import { brushFootprint, framedRoom, frameSide, parseRoom, ROOM_FRAMES, roomFloorAt, serializeRoom } from './delverRooms';
import { loadTuningData } from './index';
import { checkRoom } from '../mapEditor/roomCheck';

const HALF = [7, 14] as const;
const parse = (raw: unknown) => parseRoom(raw, HALF, 3);
const base = FIXTURE_ROOM_RAW as unknown as Record<string, unknown>;
const brushes = FIXTURE_ROOM_RAW.brushes as unknown as Record<string, unknown>[];
const withBrush = (i: number, patch: Record<string, unknown>) => ({ ...base, brushes: brushes.map((b, k) => (k === i ? { ...b, ...patch } : b)) });

describe('parseRoom (docs/plans/delver.md, Stage 7g)', () => {
  it('parses the fixture, with all four kinds, its top and its doorways', () => {
    expect(FIXTURE_ROOM.name).toBe('fixture');
    expect(FIXTURE_ROOM.kinds).toEqual(['Fight', 'Empty', 'Stairs', 'Boss']);
    expect(FIXTURE_ROOM.top).toBe(8);
    expect(FIXTURE_ROOM.doorways).toEqual({ n: 0, e: 1, s: 0 });
    expect(parse(serializeRoom(FIXTURE_ROOM))).toEqual(FIXTURE_ROOM);
  });

  it.each([
    ['a bad name', { ...base, name: 'a b' }, /name/],
    ['a half outside halfSize', { ...base, half: [15, 9] }, /half\[0\].*halfSize/],
    ['no doorway', { ...base, doorways: {} }, /at least one wall/],
    ['a doorway level above 3', { ...base, doorways: { n: 4 } }, /doorways\.n.*0 to 3/],
    ['a doorway whose floor is not at its level', { ...base, doorways: { n: 1, e: 1, s: 0 } }, /doorways\.n.*level \(2 m\)/],
    ['an Entrance kind', { ...base, kinds: ['Entrance'] }, /kinds\[0\]/],
    ['an Enclosure', { ...base, brushes: [...brushes, { kind: 'enclosure', id: 'x', rect: { x0: -1, z0: -1, x1: 1, z1: 1 }, y: 0, doors: {} }] }, /kind.*platform/],
    ['a Brush outside the room', withBrush(4, { rect: { x0: -13, z0: 5, x1: -7, z1: 7 } }), /inside the room/],
    ['an edge an odd number of metres from a wall', withBrush(4, { rect: { x0: -8, z0: 5, x1: -7, z1: 7 } }), /even number of metres/],
    ['a Ramp steeper than MAX_SLOPE', withBrush(1, { hi: 4 }), /steeper/],
    ['a half-metre height', withBrush(0, { top: 2.5 }), /whole metre/],
    ['a Hole in the floor with no lava under it', { ...base, brushes: brushes.filter((b) => b.id !== 'lava') }, /lava pool/],
    ['water', withBrush(3, { hazard: 'water' }), /lava only/],
    ['a duplicate id', withBrush(4, { id: 'ledge' }), /already "ledge"/],
    ['a centre near a Brush', { ...base, centre: [2, -3] }, /centre.*up is nearer/],
    ['a centre near a wall', { ...base, centre: [-1, -7] }, /centre.*from every wall/],
  ])('refuses %s', (_name, raw, reason) => {
    expect(() => parse(raw)).toThrow(reason);
  });

  it('keeps whole metres and odd world edges in all 8 frames (with walls on odd metres)', () => {
    for (const f of ROOM_FRAMES) {
      const r = framedRoom(FIXTURE_ROOM, f);
      const [hw, hd] = r.half;
      expect(new Set(Object.keys(r.doorways)).size).toBe(3);
      for (const b of r.brushes) {
        const q = brushFootprint(b);
        // A centre at an even world metre with odd walls: each edge's distance from its wall is even.
        for (const x of [q.x0, q.x1]) expect((((x - hw) % 2) + 2) % 2).toBe(0);
        for (const z of [q.z0, q.z1]) expect((((z - hd) % 2) + 2) % 2).toBe(0);
        expect(Math.abs(q.x0) <= hw && Math.abs(q.x1) <= hw && Math.abs(q.z0) <= hd && Math.abs(q.z1) <= hd).toBe(true);
      }
      // The e doorway's floor follows the ledge into its frame.
      const e = frameSide('e', f);
      expect(r.doorways[e]).toBe(1);
      // The room stays valid in its frame.
      expect(() => parse({ ...serializeRoom(r), half: [...r.half] })).not.toThrow();
    }
    // The 8 frames are all different.
    expect(new Set(ROOM_FRAMES.map((f) => JSON.stringify(framedRoom(FIXTURE_ROOM, f).brushes))).size).toBe(8);
  });

  it('reads its floor heights', () => {
    expect(roomFloorAt(FIXTURE_ROOM, 0, 0)).toBe(0);
    expect(roomFloorAt(FIXTURE_ROOM, 9, 0)).toBe(2);
    expect(roomFloorAt(FIXTURE_ROOM, 5, -7)).toBe(1);
    expect(roomFloorAt(FIXTURE_ROOM, -7, 1)).toBeNull();
    expect(roomFloorAt(FIXTURE_ROOM, -8, 6)).toBeNull();
  });
});

describe('the shipped room files (data/delver/rooms/)', () => {
  it('each parses, named after its file, and passes Check room\'s checks but the AI walk (its stub compiles, walk-checks and builds a navmesh in both frames)', () => {
    const t = loadTuningData();
    expect(t.delver.floor.drawnRooms.length).toBeGreaterThan(0);
    for (const room of t.delver.floor.drawnRooms) {
      expect(parseRoom(serializeRoom(room), t.delver.floor.halfSize, t.delver.floor.passage)).toEqual(room);
      const c = checkRoom(serializeRoom(room), t, { walk: false });
      expect(c.issues, room.name).toEqual([]);
    }
  });

  it('a room file in the wrong file is refused', () => {
    expect(() => loadTuningData({ roomFiles: { '../../data/delver/rooms/other.json': FIXTURE_ROOM_RAW } })).toThrow(/must live in <its name>\.json/);
    expect(loadTuningData({ roomFiles: { '../../data/delver/rooms/fixture.json': FIXTURE_ROOM_RAW } }).delver.floor.drawnRooms.map((r) => r.name)).toContain('fixture');
  });
});
