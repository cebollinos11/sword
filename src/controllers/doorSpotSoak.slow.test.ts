/** The exit Door spots over a soak of Hall Arenas: generating 180 Arenas takes longer than the fast tier allows, so it runs in `npm run test:slow`. */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, inExitZone, withGeneratedArena } from '../sim';
import { exitDoorSpots } from './doorSpot';

const tuning = loadTuningData();
const RADIUS = tuning.fighter.radius;

/** A soak of Hall Arenas: every Door of seeds 1 to 60, 1 to 3 exits each. */
const SOAK = Array.from({ length: 60 }, (_, k) => k + 1).flatMap((seed) => [2, 3, 4].map((d) => `gen:greybox:${seed}:d${d}`));

describe('exit door spots', () => {
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
  }, 300_000);
});
