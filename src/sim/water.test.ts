import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { deadlyGround, groundBelow } from './arena';
import { navMesh } from './nav';
import { createInitialState, createMatch, IDLE_INTENT, step, stepMatch, type Intent, type MatchState, type SimState } from './index';

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
    const m = walkFor(matchAt(-6, 1.5), { x: -1, z: 0 }, 60 * 6);
    const f = m.duel.fighters[0]!;
    expect(f.death?.cause).toBe('Water');
    expect(f.position.x).toBeLessThan(-12.2);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 1 });
  });

  it('the rail stops a Fighter walking into it', () => {
    const f = walkFor(matchAt(6, -2), { x: 1, z: 0 }, 60 * 2).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(f.position.x).toBeLessThan(9);
  });

  it('a Fighter who takes a running jump over the rail drowns', () => {
    const f = walkFor(matchAt(7.4, -2), { x: 1, z: 0 }, 60 * 5, true).duel.fighters[0]!;
    expect(f.death?.cause).toBe('Water');
    expect(f.position.x).toBeGreaterThan(9);
  });

  it('a Fighter walks up the stairs onto the quarterdeck', () => {
    const f = walkFor(matchAt(7.2, -5.5), { x: 0, z: -1 }, 60 * 5).duel.fighters[0]!;
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(1.5);
  });

  it('gives the AI no way into the sea', () => {
    const sea = ship.walk.findIndex((s) => s.water);
    expect(navMesh(ship, tuning).links.filter((l) => l.to === sea)).toEqual([]);
  });
});

type Move = { x: number; z: number };

/** The id of the Walk Surface Fighter 0 stands on. */
function standingOn(s: SimState): string | undefined {
  const f = s.fighters[0]!;
  const g = groundBelow(ship, f.position.x, f.position.z, f.y + 1e-6);
  return g && Math.abs(g.y - f.y) < 1e-6 ? ship.walk[g.surface]!.id : undefined;
}

/**
 * Fighter 0 alone on the ship at (x, y, z), Jumps walking along `move`, holding Jump for `hold` Ticks (0 is a tap),
 * keeps walking until it lands, then stands still for a moment.
 */
function jumpFrom([x, y, z]: [number, number, number], move: Move, hold: number): SimState {
  let s = createInitialState(tuning, 1, [{ position: { x, z }, facing: Math.atan2(move.x, move.z), y }], [], [], 'ship');
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

describe('The crates on deck can be jumped onto and walked on', () => {
  const landed = jumpFrom([-5.65, 0, 17.2], { x: 0, z: 1 }, 0);

  it('a tap from the deck ends standing on the big crate', () => {
    const f = landed.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(1, 6);
    expect(standingOn(landed)).toBe('WALK_crate0_top');
  });

  it('walking across the top keeps the Fighter up there', () => {
    // It lands just past the near edge, so on across towards the far one.
    const states = walkAlong(landed, { x: 0, z: 1 }, 18);
    for (const s of states) {
      expect(s.fighters[0]!.y).toBeCloseTo(1, 6);
      expect(standingOn(s)).toBe('WALK_crate0_top');
    }
    expect(states.at(-1)!.fighters[0]!.position.z).toBeGreaterThan(landed.fighters[0]!.position.z + 0.6);
  });

  it('walking on steps down onto the small crate', () => {
    const f = landed.fighters[0]!;
    const [dx, dz] = [-5.25 - f.position.x, 19.15 - f.position.z];
    const d = Math.hypot(dx, dz);
    const s = walkAlong(walkAlong(landed, { x: dx / d, z: dz / d }, Math.round((d / tuning.fighter.walkSpeed) * 60)).at(-1)!, { x: 0, z: 0 }, 30).at(-1)!;
    expect(s.fighters[0]!.death).toBeUndefined();
    expect(s.fighters[0]!.y).toBeCloseTo(0.7, 6);
    expect(standingOn(s)).toBe('WALK_crate1_top');
  });

  it('walking off the inboard edge comes back down to the deck', () => {
    const s = walkAlong(walkAlong(landed, { x: 1, z: 0 }, 40).at(-1)!, { x: 0, z: 0 }, 60).at(-1)!;
    const f = s.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(standingOn(s)).toBe('WALK_deck');
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
