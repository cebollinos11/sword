import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { findPath, navMesh } from './nav';
import { createInitialState, createMatch, IDLE_INTENT, step, stepMatch, type Intent, type MatchState, type SimState } from './index';

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
    const m = walkFor(matchAt(3, 18), { x: 1, z: 0 }, 60 * 4);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
    expect(f.y).toBeCloseTo(-8);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('a Fighter who walks off the flatcar falls to its death too', () => {
    const f = walkFor(matchAt(1, 37, -1.2), { x: 1, z: 0 }, 60 * 4).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
  });

  it('a Fighter walks the plank from one freight car to the other', () => {
    const f = walkFor(matchAt(0, 2), { x: 0, z: -1 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.position.z).toBeLessThan(-0.45);
  });

  it('a Fighter steps down onto a roof bevel, lower towards the lip', () => {
    const f = walkFor(matchAt(4.4, 18), { x: 1, z: 0 }, 9).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.position.x).toBeGreaterThan(4.6);
    expect(f.y).toBeLessThan(0);
    expect(f.y).toBeGreaterThan(-0.4);
  });

  it('a Fighter walks back up off a bevel onto the roof', () => {
    const f = walkFor(matchAt(4.9, 18, -0.24), { x: -1, z: 0 }, 60).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
  });

  it('a Fighter who walks into the gap beside the plank falls to its death', () => {
    const f = walkFor(matchAt(1.1, 2), { x: 0, z: -1 }, 60 * 4).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Fall');
  });

  it('a Fighter walks down onto the flatcar unhurt, and back up', () => {
    let m = walkFor(matchAt(-0.1, 29), { x: 0, z: 1 }, 60 * 3);
    let f = m.duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(-1.2);
    expect(f.hp).toBe(tuning.fighter.maxHp);
    m = walkFor(m, { x: 0, z: -1 }, 60 * 3);
    f = m.duel.fighters[0]!;
    expect(f.y).toBe(0);
    expect(f.position.z).toBeLessThan(30.45);
  });

  it('a Fighter walks up onto the passenger car and its clerestory', () => {
    let f = walkFor(matchAt(0, -28), { x: 0, z: -1 }, 60 * 5).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(0.9);
    f = walkFor(matchAt(-2, -45, 0.6), { x: 1, z: 0 }, 30).duel.fighters[0]!;
    expect(f.y).toBeCloseTo(0.9);
  });

  it('the bulkhead stops a Fighter at the flatcar front', () => {
    const f = walkFor(matchAt(-1, 57, -1.2), { x: 0, z: 1 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.position.z).toBeLessThan(58.2);
  });

  it('gives the AI a path from end to end, and none down to the ground', () => {
    const path = findPath(train, tuning, { x: 0, z: 45, y: -1.2 }, { x: 0, z: -65, y: 0.6 });
    expect(path).not.toBeNull();
    const ground = train.walk.findIndex((s) => s.id === 'WALK_ground');
    expect(navMesh(train, tuning).links.filter((l) => l.to === ground)).toEqual([]);
  });
});

type Move = { x: number; z: number };

/** The id of the Walk Surface Fighter 0 stands on. */
function standingOn(s: SimState): string | undefined {
  const f = s.fighters[0]!;
  const g = groundBelow(train, f.position.x, f.position.z, f.y + 1e-6);
  return g && Math.abs(g.y - f.y) < 1e-6 ? train.walk[g.surface]!.id : undefined;
}

/**
 * Fighter 0 alone on the train at (x, y, z), Jumps walking along `move`, holding Jump for `hold` Ticks (0 is a tap),
 * keeps walking until it lands, then stands still for a moment.
 */
function jumpFrom(s: SimState | [number, number, number], move: Move, hold: number): SimState {
  if (Array.isArray(s)) {
    const [x, y, z] = s;
    s = createInitialState(tuning, 1, [{ position: { x, z }, facing: Math.atan2(move.x, move.z), y }], [], [], 'train');
  }
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
  const pts = train.walk.find((w) => w.id === id)!.points;
  return pts.reduce((best, p) => (Math.hypot(p.x - x, p.z - z) > Math.hypot(best.x - x, best.z - z) ? p : best));
}

describe('The flatcar cargo and the locomotive can be jumped onto and walked on', () => {
  const tops = [
    { name: 'the crate stack, from the deck with a held Jump', top: 'WALK_crates_top', y: 0.6, from: [2.25, -1.2, 40.9], move: { x: 0, z: 1 }, hold: 15, off: { x: -1, z: 0 } },
    { name: 'the power cell, from the deck with a held Jump', top: 'WALK_cell_top', y: 0.25, from: [2.1, -1.2, 51.5], move: { x: 0, z: 1 }, hold: 15, off: { x: -1, z: 0 } },
    { name: 'the waste drums, from the deck with a tap', top: 'WALK_barrels_top', y: -0.3, from: [-2.4, -1.2, 47.4], move: { x: 0, z: 1 }, hold: 0, off: { x: 1, z: 0 } },
  ] as const;

  for (const { name, top, y, from, move, hold, off } of tops) {
    describe(name, () => {
      const landed = jumpFrom([...from], move, hold);

      it('the Jump ends standing on top', () => {
        const f = landed.fighters[0]!;
        expect(f.air).toBeUndefined();
        expect(f.death).toBeUndefined();
        expect(f.y).toBeCloseTo(y, 6);
        expect(standingOn(landed)).toBe(top);
      });

      it('walking along the top keeps the Fighter up there', () => {
        // Most of the way to the far corner, across the top.
        const f = landed.fighters[0]!;
        const c = farCorner(top, f.position.x, f.position.z);
        const d = Math.hypot(c.x - f.position.x, c.z - f.position.z);
        const states = walkAlong(landed, { x: (c.x - f.position.x) / d, z: (c.z - f.position.z) / d }, Math.floor(((0.7 * d) / tuning.fighter.walkSpeed) * 60));
        expect(states.length).toBeGreaterThan(5);
        for (const s of states) {
          expect(s.fighters[0]!.y).toBeCloseTo(y, 6);
          expect(standingOn(s)).toBe(top);
        }
        const end = states.at(-1)!.fighters[0]!.position;
        expect(Math.hypot(end.x - f.position.x, end.z - f.position.z)).toBeGreaterThan(0.6 * d);
      });

      it('walking off the edge comes back down to the deck', () => {
        const s = walkAlong(walkAlong(landed, off, 30).at(-1)!, { x: 0, z: 0 }, 60).at(-1)!;
        const f = s.fighters[0]!;
        expect(f.air).toBeUndefined();
        expect(f.death).toBeUndefined();
        expect(f.y).toBeCloseTo(-1.2, 6);
        expect(standingOn(s)).toBe('WALK_flat_deck');
      });
    });
  }

  describe('the locomotive, from the deck over the bulkhead with a held Jump', () => {
    // Beside the fin, so the Fighter can walk forward up there.
    const landed = jumpFrom([-2.1, -1.2, 57.0], { x: 0, z: 1 }, 30);

    it('the Jump ends standing on its roof', () => {
      const f = landed.fighters[0]!;
      expect(f.air).toBeUndefined();
      expect(f.death).toBeUndefined();
      expect(f.y).toBeCloseTo(0.5, 6);
      expect(standingOn(landed)).toBe('WALK_loco');
    });

    it('walking forward beside the fin keeps the Fighter on the roof, up to a heat sink', () => {
      const f = landed.fighters[0]!;
      const states = walkAlong(landed, { x: 0, z: 1 }, 60 * 3);
      for (const s of states) {
        expect(s.fighters[0]!.y).toBeCloseTo(0.5, 6);
        expect(standingOn(s)).toBe('WALK_loco');
      }
      const end = states.at(-1)!.fighters[0]!.position;
      expect(end.z).toBeGreaterThan(f.position.z + 1);
      expect(end.z).toBeLessThan(66.57 - tuning.fighter.radius + 1e-6);
    });

    it('a held Jump back clears the gap onto the flatcar', () => {
      const s = jumpFrom(landed, { x: 0, z: -1 }, 30);
      const f = s.fighters[0]!;
      expect(f.air).toBeUndefined();
      expect(f.death).toBeUndefined();
      expect(f.y).toBeCloseTo(-1.2, 6);
      expect(standingOn(s)).toBe('WALK_flat_deck');
    });

    it('walking off the side is a Death by Fall', () => {
      const s = walkAlong(landed, { x: -1, z: 0 }, 60 * 4).at(-1)!;
      expect(s.fighters[0]!.death?.cause).toBe('Fall');
    });
  });
});
