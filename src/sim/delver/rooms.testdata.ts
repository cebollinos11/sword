/**
 * Tests only: the fixture drawn room (docs/plans/delver.md, Stage 7g), so the rooms' own pins never depend on the shipped room files. 22 x 18 m, doorways on
 * its n and s walls at the floor and on its e wall a level up, onto a ledge along the e wall reached by a Ramp; a lava pool by the w wall and a pillar in the NW.
 */
import type { TuningData } from '../../tuning';
import { parseRoom, type DrawnRoom } from '../../tuning/delverRooms';

export const FIXTURE_ROOM_RAW = {
  name: 'fixture',
  half: [11, 9],
  doorways: { n: 0, e: 1, s: 0 },
  centre: [1, 1],
  brushes: [
    { kind: 'platform', id: 'ledge', rect: { x0: 7, z0: -9, x1: 11, z1: 9 }, top: 2 },
    { kind: 'ramp', id: 'up', rect: { x0: 3, z0: -9, x1: 7, z1: -5 }, lo: 0, hi: 2, up: 'e', rails: [] },
    { kind: 'hole', id: 'pool', rect: { x0: -9, z0: -1, x1: -5, z1: 3 }, y: 0 },
    { kind: 'hazard', id: 'lava', rect: { x0: -9, z0: -1, x1: -5, z1: 3 }, y: -4, hazard: 'lava' },
    { kind: 'block', id: 'pillar', rect: { x0: -9, z0: 5, x1: -7, z1: 7 }, top: 8 },
  ],
} as const;

/** The fixture room, parsed against `halfSize` [7, 14] and a 3 m doorway (the shipped Floor's). */
export const FIXTURE_ROOM: DrawnRoom = parseRoom(FIXTURE_ROOM_RAW, [7, 14], 3);

/** `tuning` with the fixture as its one drawn room (and `weights.room` unchanged). */
export function withFixtureRoom(tuning: TuningData, rooms: readonly DrawnRoom[] = [FIXTURE_ROOM]): TuningData {
  return { ...tuning, delver: { ...tuning.delver, floor: { ...tuning.delver.floor, drawnRooms: rooms } } };
}
