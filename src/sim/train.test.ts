import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { deadlyGround } from './arena';
import { findPath, navMesh } from './nav';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from './index';

const tuning = loadTuningData();
const train = tuning.arenas.train!;

/** A 1 v 1 Match on the train with Fighter 0 placed at (x, z), on the boxcar roofs' height unless `y` says otherwise. */
function matchAt(x: number, z: number, y = 0): MatchState {
  const m = createMatch(tuning, { bestOf: 1, arena: 'train' });
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

describe('The wasteland train Arena', () => {
  it('starts the teams on the two middle freight cars, facing across the gap', () => {
    const m = createMatch(tuning, { bestOf: 1, arena: 'train', teams: [0, 1, 0, 1, 0, 1] });
    for (const f of m.duel.fighters) {
      expect(f.y).toBe(0);
      expect(deadlyGround(train, f.position.x, f.position.z, f.y)).toBeNull();
      expect(Math.sign(f.position.z)).toBe(f.team === 0 ? 1 : -1);
    }
  });

  it('a Fighter who walks off the side falls to the ground and dies of it', () => {
    const m = walkFor(matchAt(1, 6), { x: 1, z: 0 }, 60 * 4);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
    expect(f.y).toBeCloseTo(-8);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('a Fighter who walks off the flatcar falls to its death too', () => {
    const f = walkFor(matchAt(1, 16, -1.2), { x: 1, z: 0 }, 60 * 4).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
  });

  it('a Fighter walks the plank from one freight car to the other', () => {
    const f = walkFor(matchAt(0, 2), { x: 0, z: -1 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.position.z).toBeLessThan(-0.45);
  });

  it('a Fighter steps down onto a roof bevel, lower towards the lip', () => {
    const f = walkFor(matchAt(1.0, 6), { x: 1, z: 0 }, 9).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.position.x).toBeGreaterThan(1.2);
    expect(f.y).toBeLessThan(0);
    expect(f.y).toBeGreaterThan(-0.4);
  });

  it('a Fighter walks back up off a bevel onto the roof', () => {
    const f = walkFor(matchAt(1.5, 6, -0.24), { x: -1, z: 0 }, 60).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
  });

  it('a Fighter who walks into the gap beside the plank falls to its death', () => {
    const f = walkFor(matchAt(1.1, 2), { x: 0, z: -1 }, 60 * 4).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
  });

  it('a Fighter walks down onto the flatcar unhurt, and back up', () => {
    let m = walkFor(matchAt(-0.1, 9), { x: 0, z: 1 }, 60 * 3);
    let f = m.duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(-1.2);
    expect(f.hp).toBe(tuning.fighter.maxHp);
    m = walkFor(m, { x: 0, z: -1 }, 60 * 3);
    f = m.duel.fighters[0]!;
    expect(f.y).toBe(0);
    expect(f.position.z).toBeLessThan(10.45);
  });

  it('a Fighter walks up onto the passenger car and its clerestory', () => {
    let f = walkFor(matchAt(0, -8), { x: 0, z: -1 }, 60 * 3).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(0.9);
    f = walkFor(matchAt(-1, -16, 0.6), { x: 1, z: 0 }, 30).duel.fighters[0]!;
    expect(f.y).toBeCloseTo(0.9);
  });

  it('the bulkhead stops a Fighter at the flatcar front', () => {
    const f = walkFor(matchAt(-1, 19, -1.2), { x: 0, z: 1 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.position.z).toBeLessThan(20.2);
  });

  it('gives the AI a path from end to end, and none down to the ground', () => {
    const path = findPath(train, tuning, { x: 0, z: 18, y: -1.2 }, { x: 0, z: -22, y: 0.6 });
    expect(path).not.toBeNull();
    const ground = train.walk.findIndex((s) => s.id === 'WALK_ground');
    expect(navMesh(train, tuning).links.filter((l) => l.to === ground)).toEqual([]);
  });
});
