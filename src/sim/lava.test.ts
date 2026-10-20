import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { navMesh } from './nav';
import { createInitialState, createMatch, IDLE_INTENT, step, stepMatch, type Intent, type MatchState, type SimState } from './index';

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

type Move = { x: number; z: number };

/** The id of the Walk Surface Fighter 0 stands on. */
function standingOn(s: SimState): string | undefined {
  const f = s.fighters[0]!;
  const g = groundBelow(chamber, f.position.x, f.position.z, f.y + 1e-6);
  return g && Math.abs(g.y - f.y) < 1e-6 ? chamber.walk[g.surface]!.id : undefined;
}

/**
 * Fighter 0 alone in the chamber at (x, y, z) (or carrying on from `s`), Jumps walking along `move`, holding Jump for
 * `hold` Ticks, keeps walking until it lands, then stands still for a moment.
 */
function jumpFrom(s: SimState | [number, number, number], move: Move, hold: number): SimState {
  if (Array.isArray(s)) {
    const [x, y, z] = s;
    s = createInitialState(tuning, 1, [{ position: { x, z }, facing: Math.atan2(move.x, move.z), y }], [], [], 'chamber');
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

describe('The catwalks can be jumped onto from the ring and walked on', () => {
  for (const { name, top, d } of [
    { name: 'the catwalk to the +z door', top: 'WALK_catwalk0', d: 1 },
    { name: 'the catwalk to the -z door', top: 'WALK_catwalk1', d: -1 },
  ] as const) {
    describe(name, () => {
      const out = { x: 0, z: d };
      const landed = jumpFrom([0, 0, 7.2 * d], out, 30);

      it("a held Jump from the ring's edge crosses the gap and ends standing on it", () => {
        const f = landed.fighters[0]!;
        expect(f.air).toBeUndefined();
        expect(f.death).toBeUndefined();
        expect(f.y).toBe(0);
        expect(standingOn(landed)).toBe(top);
        expect(Math.abs(f.position.z)).toBeGreaterThan(11);
        expect(Math.abs(f.position.z)).toBeLessThan(13);
      });

      it('walking along it to the door keeps the Fighter on it, stopped by the shaft wall', () => {
        const states = walkAlong(landed, out, 60 * 2);
        for (const s of states) {
          expect(s.fighters[0]!.y).toBe(0);
          expect(standingOn(s)).toBe(top);
        }
        const end = states.at(-1)!.fighters[0]!.position;
        expect(Math.abs(end.z)).toBeGreaterThan(14);
        expect(Math.abs(end.z)).toBeLessThan(15);
      });

      it('the side rails keep the Fighter on it', () => {
        const f = walkAlong(landed, { x: 1, z: 0 }, 60).at(-1)!.fighters[0]!;
        expect(f.death).toBeUndefined();
        expect(f.y).toBe(0);
        expect(Math.abs(f.position.x)).toBeLessThan(0.95);
      });

      it('walking off its open end falls into the lava', () => {
        const f = walkAlong(landed, { x: 0, z: -d }, 60 * 3).at(-1)!.fighters[0]!;
        expect(f.death?.cause).toBe('Lava');
      });

      it('a held Jump back from its end crosses onto the ring', () => {
        const atEnd = walkAlong(landed, { x: 0, z: -d }, Math.floor(((Math.abs(landed.fighters[0]!.position.z) - 11.4) / tuning.fighter.walkSpeed) * 60)).at(-1)!;
        expect(standingOn(atEnd)).toBe(top);
        const f = jumpFrom(atEnd, { x: 0, z: -d }, 30).fighters[0]!;
        expect(f.death).toBeUndefined();
        expect(f.y).toBe(0);
        expect(Math.abs(f.position.z)).toBeLessThan(7.5);
      });
    });
  }

  it('gives the AI no way onto a catwalk', () => {
    const catwalks = chamber.walk.flatMap((w, i) => (w.id.startsWith('WALK_catwalk') ? [i] : []));
    expect(catwalks).toHaveLength(2);
    expect(navMesh(chamber, tuning).links.filter((l) => catwalks.includes(l.to))).toEqual([]);
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
