import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, exitDoor, inExitZone, insideZone, withGeneratedArena } from '../sim';
import type { ArenaGeometry } from '../tuning';
import { exitDoorSpot, exitDoorSpots, exitDoorWalk, SPOT_ARRIVED } from './doorSpot';

const tuning = loadTuningData();
const RADIUS = tuning.fighter.radius;

/** The Hall Arenas of a few seeds, each with 1 to 3 exits (`gen:greybox:<seed>:d<exits + 1>`). */
const ARENAS = [1, 2, 3, 4, 5, 6].flatMap((seed) => [2, 3, 4].map((d) => `gen:greybox:${seed}:d${d}`));
/** A soak of Hall Arenas: every Door of seeds 1 to 60, 1 to 3 exits each. */
const SOAK = Array.from({ length: 60 }, (_, k) => k + 1).flatMap((seed) => [2, 3, 4].map((d) => `gen:greybox:${seed}:d${d}`));

/** A Hall Arena stub with an entrance and one exit Door whose zone is the polygon `corners` (at the ground), facing `facing`. */
function stub(corners: readonly [number, number][], facing = 0): ArenaGeometry {
  const door = { zone: corners.map(([x, z]) => ({ x, y: 0, z })), facing, spawns: [] };
  return { name: 'stub', walk: [], walls: [], spawns: [], doors: [{ ...door, zone: [] }, door] };
}

describe('exit door spots', () => {
  it('are four, each inside the zone with its body clear of the others', () => {
    for (const name of ARENAS) {
      const arena = arenaOf(withGeneratedArena(tuning, name).tuning, name);
      for (let exit = 0; exit < arena.doors.length - 1; exit++) {
        const spots = exitDoorSpots(arena, exit, RADIUS);
        expect(spots, `${name} exit ${exit}`).toHaveLength(4);
        for (const [i, a] of spots.entries()) {
          expect(inExitZone(arena, exit, { position: { x: a.x, z: a.z }, y: a.y }), `${name} exit ${exit} spot ${i}`).toBe(true);
          for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z), `${name} exit ${exit}`).toBeGreaterThanOrEqual(2 * RADIUS);
        }
      }
    }
  });

  it('lie inside the zone of every Door of a soak of Hall Arenas (seeds 1 to 60), or no Fighter standing at one could ever count', () => {
    let spots = 0;
    for (const name of SOAK) {
      const arena = arenaOf(withGeneratedArena(tuning, name).tuning, name);
      for (let exit = 0; exit < arena.doors.length - 1; exit++)
        for (const [i, a] of exitDoorSpots(arena, exit, RADIUS).entries()) {
          spots++;
          expect(inExitZone(arena, exit, { position: { x: a.x, z: a.z }, y: a.y }), `${name} exit ${exit} spot ${i}`).toBe(true);
        }
    }
    expect(spots).toBeGreaterThan(1000);
  });

  it('stay inside a zone that is not aligned with its Door (a diamond: its corners are outside the box of its extents)', () => {
    // A square rotated 45 degrees to the Door's facing, 1.5 m from its middle to each corner.
    const arena = stub([[0, 1.5], [1.5, 0], [0, -1.5], [-1.5, 0]]);
    const spots = exitDoorSpots(arena, 0, RADIUS);
    expect(spots).toHaveLength(4);
    for (const [i, a] of spots.entries()) {
      for (const [dx, dz] of [[0, 0], [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]] as const)
        expect(insideZone(arena.doors[1]!.zone, a.x + dx, a.z + dz), `spot ${i} body (${dx}, ${dz})`).toBe(true);
    }
  });

  it('keep the nearer pair first and left before right in a zone narrower than a Fighter (no swapped columns), inside it', () => {
    // 0.5 m across, 3 m deep, the Door facing +z: right is +x.
    const arena = stub([[-0.25, -1.5], [-0.25, 1.5], [0.25, 1.5], [0.25, -1.5]]);
    const [nearLeft, nearRight, farLeft, farRight] = exitDoorSpots(arena, 0, RADIUS);
    for (const a of [nearLeft!, nearRight!, farLeft!, farRight!]) expect(insideZone(arena.doors[1]!.zone, a.x, a.z)).toBe(true);
    expect(nearLeft!.x).toBeLessThanOrEqual(nearRight!.x);
    expect(farLeft!.x).toBeLessThanOrEqual(farRight!.x);
    expect(nearLeft!.z).toBeGreaterThanOrEqual(farLeft!.z);
    // And a zone shallower than a Fighter swaps no rows.
    const flat = stub([[-1.5, -0.2], [-1.5, 0.2], [1.5, 0.2], [1.5, -0.2]]);
    const [n1, , f1] = exitDoorSpots(flat, 0, RADIUS);
    expect(n1!.z).toBeGreaterThanOrEqual(f1!.z);
    for (const a of exitDoorSpots(flat, 0, RADIUS)) expect(insideZone(flat.doors[1]!.zone, a.x, a.z)).toBe(true);
  });

  it('leave a lane up the middle of the zone, wide enough to pass the spots on either side (so the last one in is not boxed out)', () => {
    for (const name of ARENAS) {
      const arena = arenaOf(withGeneratedArena(tuning, name).tuning, name);
      for (let exit = 0; exit < arena.doors.length - 1; exit++) {
        const door = arena.doors[exitDoor(exit)]!;
        const spots = exitDoorSpots(arena, exit, RADIUS);
        // Across the zone (the Door's right): the spots on one side against those on the other.
        const right = { x: Math.cos(door.facing), z: -Math.sin(door.facing) };
        const mid = { x: door.zone.reduce((s, p) => s + p.x, 0) / door.zone.length, z: door.zone.reduce((s, p) => s + p.z, 0) / door.zone.length };
        const across = spots.map((s) => (s.x - mid.x) * right.x + (s.z - mid.z) * right.z);
        const left = Math.max(...across.filter((a) => a < 0));
        const rightmost = Math.min(...across.filter((a) => a > 0));
        expect(across.filter((a) => a === 0), `${name} exit ${exit}`).toEqual([]);
        expect(rightmost - left - 2 * RADIUS, `${name} exit ${exit}`).toBeGreaterThanOrEqual(2 * RADIUS);
      }
    }
  });

  describe('a Fighter takes', () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 3, arena: 'gen:greybox:4242', teams: [0, 0, 0, 1, 1, 1, 1], humans: 1, players: [0] });
    const arena = arenaOf(tuning, m.arena);
    const spots = exitDoorSpots(arena, 0, RADIUS);
    // Only the teams matter here, and a Run's line-up lists Team 0 first, so interleave them by hand.
    const state = (at: readonly { x: number; z: number }[] = []) => ({
      fighters: [0, 0, 1, 0, 1, 0].map((team, i) => ({ ...m.duel.fighters[i]!, team, position: at[i] ?? { x: -50, z: -50 + i * 5 } })),
    });

    it("the spot of its rank among its team's Fighters before it", () => {
      // Fighters 0, 1, 3 and 5 are Team 0 (slots 0 to 3); Fighters 2 and 4 are Team 1 (slots 0 and 1).
      for (const [fighter, slot] of [[0, 0], [1, 1], [3, 2], [5, 3], [2, 0], [4, 1]] as const) {
        expect(exitDoorSpot(arena, 0, state(), fighter, RADIUS)).toEqual({ at: spots[slot], crowded: false });
      }
    });

    it('past the fourth, the first spot again', () => {
      const many = { fighters: Array.from({ length: 5 }, (_, i) => ({ ...m.duel.fighters[0]!, team: 0, position: { x: -50, z: -50 + i * 5 } })) };
      expect(exitDoorSpot(arena, 0, many, 4, RADIUS).at).toEqual(spots[0]);
    });

    it("the free spot nearest its own when another Fighter stands on that one, and is crowded when every spot is taken", () => {
      const onOwn = state([{ x: -50, z: -50 }, { x: spots[0]!.x, z: spots[0]!.z }]);
      const redirected = exitDoorSpot(arena, 0, onOwn, 0, RADIUS);
      expect(redirected.crowded).toBe(false);
      expect(redirected.at).not.toEqual(spots[0]);
      expect(spots).toContainEqual(redirected.at);
      // Every spot has a Fighter on it:
      const full = state([{ x: -50, z: -50 }, ...spots.map((s) => ({ x: s.x, z: s.z }))]);
      expect(exitDoorSpot(arena, 0, full, 0, RADIUS).crowded).toBe(true);
    });
  });
  describe('walking to a spot', () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 3, arena: 'gen:greybox:4242', teams: [0, 0, 0, 1, 1, 1, 1], humans: 1, players: [0] });
    const arena = arenaOf(tuning, m.arena);
    const spots = exitDoorSpots(arena, 0, RADIUS);
    // Fighter 0 at `p`, the rest of its team far away.
    const at = (p: { x: number; z: number }) => ({ fighters: m.duel.fighters.map((f, i) => ({ ...f, position: i === 0 ? p : { x: -50, z: -50 + i * 5 } })) });

    it('goes on past the zone edge (no stop) until inside, then stops at its spot', () => {
      expect(exitDoorWalk(arena, 0, at({ x: 0, z: 0 }), 0, RADIUS)).toMatchObject({ to: spots[0], stop: 0 });
      expect(exitDoorWalk(arena, 0, at({ x: spots[0]!.x, z: spots[0]!.z }), 0, RADIUS)).toMatchObject({ to: spots[0], stop: SPOT_ARRIVED });
    });

    it('shoves on past the others only near the spot', () => {
      expect(exitDoorWalk(arena, 0, at({ x: 0, z: 0 }), 0, RADIUS).shove).toBe(false);
      expect(exitDoorWalk(arena, 0, at({ x: spots[0]!.x, z: spots[0]!.z + 4 }), 0, RADIUS).shove).toBe(true);
    });
  });
});
