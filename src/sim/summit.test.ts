import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { navMesh } from './nav';
import { createInitialState, createMatch, IDLE_INTENT, step, stepMatch, type Intent, type MatchState, type SimState } from './index';

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

type Move = { x: number; z: number };

/** The id of the Walk Surface Fighter 0 stands on. */
function standingOn(s: SimState): string | undefined {
  const f = s.fighters[0]!;
  const g = groundBelow(summit, f.position.x, f.position.z, f.y + 1e-6);
  return g && Math.abs(g.y - f.y) < 1e-6 ? summit.walk[g.surface]!.id : undefined;
}

/**
 * Fighter 0 alone on the summit at (x, y, z), Jumps walking along `move`, holding Jump for `hold` Ticks (0 is a tap),
 * keeps walking until it lands, then stands still for a moment.
 */
function jumpFrom(x: number, y: number, z: number, move: Move, hold: number): SimState {
  let s = createInitialState(tuning, 1, [{ position: { x, z }, facing: Math.atan2(move.x, move.z), y }], [], [], 'summit');
  let rose = false;
  for (let t = 0; t < 300; t++) {
    s = step(s, [{ ...IDLE_INTENT, move, jump: t === 0, jumpHeld: t < hold }], tuning);
    if (s.fighters[0]!.air) rose = true;
    else if (rose) break;
  }
  for (let t = 0; t < 10; t++) s = step(s, [IDLE_INTENT], tuning);
  return s;
}

/** Steps Fighter 0 walking `move` for `ticks` Ticks; every state along the way. */
function walkAlong(s: SimState, move: Move, ticks: number): SimState[] {
  const states = [s];
  for (let t = 0; t < ticks; t++) states.push((s = step(s, [{ ...IDLE_INTENT, move }], tuning)));
  return states;
}

/** The corner of Walk Surface `id` farthest from (x, z), from above. */
function farCorner(id: string, x: number, z: number): Move {
  const pts = summit.walk.find((w) => w.id === id)!.points;
  return pts.reduce((best, p) => (Math.hypot(p.x - x, p.z - z) > Math.hypot(best.x - x, best.z - z) ? p : best));
}

describe('The summit wreck can be jumped onto and walked on', () => {
  const lids = [
    { name: 'the hull, from the plateau with a held Jump', lid: 'WALK_hull_top', y: 3.45, from: [-1.8, 2, -7.0], move: { x: 0, z: -1 }, hold: 15, off: { x: 0, z: 1 }, floor: 2 },
    { name: 'the nacelle, from the shelf with a held Jump', lid: 'WALK_nacelle_top', y: 1.3, from: [-3.5, 0, 3.7], move: { x: -1, z: 0 }, hold: 15, off: { x: 1, z: 0 }, floor: 0 },
    { name: 'the containers, from the plateau with a tap', lid: 'WALK_containers_top', y: 2.5, from: [3.0, 2, -5.6], move: { x: 0, z: 1 }, hold: 0, off: { x: 0, z: -1 }, floor: 2 },
    { name: 'the dish, from the shelf with a held Jump', lid: 'WALK_dish_top', y: 1.1, from: [3.8, 0, 4.0], move: { x: 0, z: 1 }, hold: 15, off: { x: 0, z: -1 }, floor: 0 },
    { name: 'the crate by the back crag, with a tap', lid: 'WALK_crate1_top', y: 0.9, from: [-2.6, 0, 5.2], move: { x: 0, z: 1 }, hold: 0, off: { x: 0, z: -1 }, floor: 0 },
    { name: 'the crate in the nook, with a tap', lid: 'WALK_crate0_top', y: 0.8, from: [-3.4, 0, -3.2], move: { x: 0, z: -1 }, hold: 0, off: { x: 0, z: 1 }, floor: 0 },
  ] as const;

  for (const { name, lid, y, from, move, hold, off, floor } of lids) {
    describe(name, () => {
      const landed = jumpFrom(from[0], from[1], from[2], move, hold);

      it('the Jump ends standing on top', () => {
        const f = landed.fighters[0]!;
        expect(f.air).toBeUndefined();
        expect(f.death).toBeUndefined();
        expect(f.y).toBeCloseTo(y, 6);
        expect(standingOn(landed)).toBe(lid);
      });

      it('walking along the top keeps the Fighter up there', () => {
        // Most of the way to the far corner, across the top.
        const f = landed.fighters[0]!;
        const c = farCorner(lid, f.position.x, f.position.z);
        const d = Math.hypot(c.x - f.position.x, c.z - f.position.z);
        const states = walkAlong(landed, { x: (c.x - f.position.x) / d, z: (c.z - f.position.z) / d }, Math.floor(((0.7 * d) / tuning.fighter.walkSpeed) * 60));
        expect(states.length).toBeGreaterThan(10);
        for (const s of states) {
          expect(s.fighters[0]!.y).toBeCloseTo(y, 6);
          expect(standingOn(s)).toBe(lid);
        }
        const end = states.at(-1)!.fighters[0]!.position;
        expect(Math.hypot(end.x - f.position.x, end.z - f.position.z)).toBeGreaterThan(0.6 * d);
      });

      it('walking off the edge comes back down', () => {
        const f = walkAlong(walkAlong(landed, off, 60).at(-1)!, { x: 0, z: 0 }, 60).at(-1)!.fighters[0]!;
        expect(f.air).toBeUndefined();
        expect(f.death).toBeUndefined();
        expect(f.y).toBe(floor);
      });
    });
  }
});
