import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { deadlyGround } from './arena';
import { navMesh } from './nav';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from './index';

const tuning = loadTuningData();
const ship = tuning.arenas.ship!;

/** A 1 v 1 Match on the ship with Fighter 0 placed at (x, z), on the main deck unless `y` says otherwise. */
function matchAt(x: number, z: number, y = 0): MatchState {
  const m = createMatch(tuning, { bestOf: 1, arena: 'ship' });
  const fighters = m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x, z }, y } : f));
  return { ...m, duel: { ...m.duel, fighters } };
}

/** Steps the Match with Fighter 0 walking `move` (world space; jumping on the first Tick if `jump`) and Fighter 1 idle. */
function walkFor(m: MatchState, move: { x: number; z: number }, ticks: number, jump = false): MatchState {
  for (let t = 0; t < ticks && m.duel.duel.status === 'Fighting'; t++) {
    const intent: Intent = { ...IDLE_INTENT, move, ...(jump && t === 20 && { jump: true }) };
    m = stepMatch(m, [intent, IDLE_INTENT], tuning);
  }
  return m;
}

describe('The pirate ship Arena', () => {
  it('starts both teams on the main deck, on solid ground', () => {
    const m = createMatch(tuning, { bestOf: 1, arena: 'ship', teams: [0, 1, 0, 1, 0, 1] });
    for (const f of m.duel.fighters) {
      expect(f.y).toBe(0);
      expect(deadlyGround(ship, f.position.x, f.position.z, f.y)).toBeNull();
    }
  });

  it('a Fighter who walks to the end of the plank and off it drowns', () => {
    const m = walkFor(matchAt(-2, 0.5), { x: -1, z: 0 }, 60 * 5);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Water');
    expect(f.position.x).toBeLessThan(-6.2);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('the rail stops a Fighter walking into it', () => {
    const f = walkFor(matchAt(2, -1), { x: 1, z: 0 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.position.x).toBeLessThan(3);
  });

  it('a Fighter who takes a running jump over the rail drowns', () => {
    const f = walkFor(matchAt(1.4, -1), { x: 1, z: 0 }, 60 * 5, true).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Water');
    expect(f.position.x).toBeGreaterThan(3);
  });

  it('a Fighter walks up the stairs onto the quarterdeck', () => {
    const f = walkFor(matchAt(2.4, -1.5), { x: 0, z: -1 }, 60 * 3).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(1.5);
  });

  it('gives the AI no way into the sea', () => {
    const sea = ship.walk.findIndex((s) => s.water);
    expect(navMesh(ship, tuning).links.filter((l) => l.to === sea)).toEqual([]);
  });
});

describe('Water Walk Surfaces', () => {
  it('parse from `"water": true` and refuse lava and water together', () => {
    const surface = (extra: object) => ({ name: 'pond', walk: [{ id: 'WALK_a', ...extra, points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] }] });
    expect(parseArena(surface({ water: true }), 'pond').walk[0]!.water).toBe(true);
    expect(() => parseArena(surface({ water: 1 }), 'pond')).toThrow(/water/);
    expect(() => parseArena(surface({ water: true, lava: true }), 'pond')).toThrow(/both/);
  });
});
