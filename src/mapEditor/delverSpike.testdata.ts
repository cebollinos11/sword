/**
 * The spike Floor (docs/plans/delver.md, Stage 0): a hand-written Map Source laid out the way a Delver Floor would be, one continuous Arena
 * of 20 Enclosure rooms in a 5 by 4 grid, joined by 23 Enclosure passages (a spanning tree of 19 and four loops), on a 200 m field whose
 * rock between them is an abyss nobody walks to (the Map Compiler's walk check skips deadly ground). It is a Battle map, since that is what
 * `compileMap` takes: Objective D (Team 0's spawn) in room 0, E (Team 1's) in room 19, and eight neutral posts in rooms between. No Battle
 * is fought on it but in the spike's slow test, which times its builds and Ticks. Only whole and half metres are used, in fixed order.
 */
import { withBrushes } from './sample.testdata';
import type { Brush, Doors, MapSource, Rect, SourceObjective } from './source';

/** Columns and rows of rooms, and the metres between room centres. */
const COLS = 5;
const ROWS = 4;
const PITCH = 30;
/** A passage's width, and a room's doorway onto one (m). */
const PASSAGE = 3;

/** Room k's half-width along x and half-depth along z (m), k = row * 5 + column. */
const HW = [8, 6, 10, 7, 9, 7, 9, 6, 10, 8, 10, 8, 7, 9, 6, 6, 10, 9, 8, 7];
const HD = [7, 9, 6, 10, 8, 10, 6, 8, 7, 9, 6, 8, 10, 7, 9, 9, 7, 6, 10, 8];

/** Per room: its id, its centre and its rectangle. */
export const SPIKE_ROOMS: readonly { id: string; cx: number; cz: number; rect: Rect }[] = Array.from({ length: COLS * ROWS }, (_, k) => {
  const cx = -60 + PITCH * (k % COLS);
  const cz = -45 + PITCH * Math.floor(k / COLS);
  return { id: `room${k}`, cx, cz, rect: { x0: cx - HW[k]!, z0: cz - HD[k]!, x1: cx + HW[k]!, z1: cz + HD[k]! } };
});

/**
 * The passages' edges as [a, b] room pairs, in order: the 16 horizontal ones (b = a + 1) row by row, then verticals (b = a + 5): a
 * spanning tree, a serpentine; then four loops.
 */
export const SPIKE_PASSAGES: readonly (readonly [number, number])[] = [
  ...Array.from({ length: ROWS * (COLS - 1) }, (_, n): [number, number] => {
    const a = Math.floor(n / (COLS - 1)) * COLS + (n % (COLS - 1));
    return [a, a + 1];
  }),
  [0, 5],
  [9, 14],
  [10, 15],
  [2, 7],
  [6, 11],
  [12, 17],
  [13, 18],
];

/** The Spike Floor's Map Source. */
export function delverSpikeSource(): MapSource {
  const doors: Doors[] = SPIKE_ROOMS.map(() => ({}));
  const passages: Brush[] = SPIKE_PASSAGES.map(([a, b], n) => {
    const ra = SPIKE_ROOMS[a]!;
    const rb = SPIKE_ROOMS[b]!;
    const horizontal = b === a + 1;
    doors[a] = { ...doors[a], [horizontal ? 'e' : 'n']: PASSAGE };
    doors[b] = { ...doors[b], [horizontal ? 'w' : 's']: PASSAGE };
    const half = PASSAGE / 2;
    const rect: Rect = horizontal
      ? { x0: ra.rect.x1, z0: ra.cz - half, x1: rb.rect.x0, z1: ra.cz + half }
      : { x0: ra.cx - half, z0: ra.rect.z1, x1: ra.cx + half, z1: rb.rect.z0 };
    return { kind: 'enclosure', id: `pass${n}`, rect, y: 0, doors: horizontal ? { e: PASSAGE, w: PASSAGE } : { n: PASSAGE, s: PASSAGE } };
  });
  const rooms: Brush[] = SPIKE_ROOMS.map((r, k) => ({ kind: 'enclosure', id: r.id, rect: r.rect, y: 0, doors: doors[k]! }));
  const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: -8, hazard: 'abyss' };
  const post = (id: string, room: number, owner: -1 | 0 | 1, spawn: boolean): SourceObjective => ({ id, x: SPIKE_ROOMS[room]!.cx, z: SPIKE_ROOMS[room]!.cz, weight: 1, owner, spawn });
  const first = SPIKE_ROOMS[0]!;
  const last = SPIKE_ROOMS[COLS * ROWS - 1]!;
  return withBrushes([abyss, ...rooms, ...passages], [-8, 0, 4], {
    name: 'delverspike',
    objectives: [
      post('D', 0, 0, true),
      post('E', 19, 1, true),
      ...[2, 4, 7, 9, 10, 12, 15, 17].map((room, k) => post(String.fromCharCode(70 + k), room, -1, false)),
    ],
    bases: [
      { x: first.cx - 3, z: first.cz },
      { x: last.cx + 3, z: last.cz },
    ],
    front: 52,
    armySize: { standard: 50, max: 50 },
    ticketsPerSoldier: 100,
  });
}
