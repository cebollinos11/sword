import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { deadlyGround } from './arena';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from './index';

const tuning = loadTuningData();
const chamber = tuning.arenas.chamber!;

/** A 1 v 1 Match in the chamber with Fighter 0 placed at (x, z) on the platform. */
function matchAt(x: number, z: number): MatchState {
  const m = createMatch(tuning, { bestOf: 1, arena: 'chamber' });
  const fighters = m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x, z } } : f));
  return { ...m, duel: { ...m.duel, fighters } };
}

/** Steps the Match with Fighter 0 walking `move` (world space) and Fighter 1 idle. */
function walkFor(m: MatchState, move: { x: number; z: number }, ticks: number): MatchState {
  const intent: Intent = { ...IDLE_INTENT, move };
  for (let t = 0; t < ticks && m.duel.duel.status === 'Fighting'; t++) m = stepMatch(m, [intent, IDLE_INTENT], tuning);
  return m;
}

describe('The carbon-freezing chamber Arena', () => {
  it('starts both teams on the platform, on solid ground', () => {
    const m = createMatch(tuning, { bestOf: 1, arena: 'chamber', teams: [0, 1, 0, 1, 0, 1] });
    for (const f of m.duel.fighters) {
      expect(f.y).toBe(0);
      expect(deadlyGround(chamber, f.position.x, f.position.z, f.y)).toBeNull();
    }
  });

  it('a Fighter who walks off the outer edge falls into the lava and dies of it', () => {
    const m = walkFor(matchAt(-6.5, 0), { x: -1, z: 0 }, 60 * 4);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Lava');
    expect(f.hp).toBe(0);
    expect(f.y).toBe(-4);
    expect(m.duel.events).toContainEqual({ type: 'Death', fighter: 0, cause: 'Lava' });
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('a Fighter who walks into the hole in the centre dies in the lava too', () => {
    const f = walkFor(matchAt(-3, 0), { x: 1, z: 0 }, 60 * 4).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Lava');
    expect(Math.hypot(f.position.x, f.position.z)).toBeLessThan(2);
  });

  it('a Fighter walking round the ring stays alive', () => {
    const f = walkFor(matchAt(-4.75, 0), { x: 0, z: 1 }, 60).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
  });
});

describe('Lava Walk Surfaces', () => {
  it('parse from `"lava": true` and refuse anything but a boolean', () => {
    const surface = (lava: unknown) => ({ name: 'pit', walk: [{ id: 'WALK_a', lava, points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] }] });
    expect(parseArena(surface(true), 'pit').walk[0]!.lava).toBe(true);
    expect(parseArena(surface(undefined), 'pit').walk[0]!.lava).toBeUndefined();
    expect(() => parseArena(surface('yes'), 'pit')).toThrow(/lava/);
  });
});
