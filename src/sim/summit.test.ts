import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { deadlyGround } from './arena';
import { navMesh } from './nav';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from './index';

const tuning = loadTuningData();
const summit = tuning.arenas.summit!;

/** A 1 v 1 Match on the summit with Fighter 0 placed at (x, z), on the shelf unless `y` says otherwise. */
function matchAt(x: number, z: number, y = 0): MatchState {
  const m = createMatch(tuning, { bestOf: 1, arena: 'summit' });
  const fighters = m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x, z }, y } : f));
  return { ...m, duel: { ...m.duel, fighters } };
}

/** Steps the Match with Fighter 0 walking `move` (world space) and Fighter 1 idle. */
function walkFor(m: MatchState, move: { x: number; z: number }, ticks: number): MatchState {
  for (let t = 0; t < ticks && m.duel.duel.status === 'Fighting'; t++) {
    const intent: Intent = { ...IDLE_INTENT, move };
    m = stepMatch(m, [intent, IDLE_INTENT], tuning);
  }
  return m;
}

describe('The snowy summit Arena', () => {
  it('starts both teams on the shelf, on solid ground', () => {
    const m = createMatch(tuning, { bestOf: 1, arena: 'summit', teams: [0, 1, 0, 1, 0, 1] });
    for (const f of m.duel.fighters) {
      expect(f.y).toBe(0);
      expect(deadlyGround(summit, f.position.x, f.position.z, f.y)).toBeNull();
    }
  });

  it('a Fighter who walks off the cliff edge falls to the valley and dies of it', () => {
    const m = walkFor(matchAt(4, 3), { x: 1, z: 0 }, 60 * 6);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
    expect(f.y).toBeCloseTo(-30);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('a Fighter walks out along the overlook without falling', () => {
    const f = walkFor(matchAt(5.5, 1.6), { x: 1, z: 0 }, 60).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.position.x).toBeGreaterThan(6.6);
  });

  it('a Fighter walks up the ramp onto the summit plateau', () => {
    const f = walkFor(matchAt(-5.8, 0), { x: 0, z: -1 }, 60 * 4).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(2);
  });

  it('a Fighter who walks off the plateau face lands hurt but alive', () => {
    const f = walkFor(matchAt(0, -6, 2), { x: 0, z: 1 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.hp).toBeLessThan(tuning.fighter.maxHp);
  });

  it('the crag stops a Fighter walking into it', () => {
    const f = walkFor(matchAt(-5, 3), { x: -1, z: 0 }, 60 * 2).duel.fighters[0]!;
    expect(f.position.x).toBeGreaterThan(-7);
  });

  it('gives the AI no way down into the valley', () => {
    const valley = summit.walk.findIndex((s) => s.id === 'WALK_valley');
    expect(navMesh(summit, tuning).links.filter((l) => l.to === valley)).toEqual([]);
  });
});
