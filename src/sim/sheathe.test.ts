import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import {
  arenaOf,
  createInitialState,
  createMatch,
  duelPlacements,
  hashState,
  IDLE_INTENT,
  jumpArc,
  offHandFree,
  restore,
  sheatheTimings,
  SHEATHED_IDLE_MOTION,
  snapshot,
  step,
  type FighterState,
  type Intent,
  type SimEvent,
  type SimState,
} from './index';

const repo = loadTuningData();
/** The repo's Arena list plus a 1 m ledge (x, z -1..1) over a floor, to walk off. */
const tuning: TuningData = {
  ...repo,
  arenas: {
    ...repo.arenas,
    ledge: parseArena(
      {
        name: 'ledge',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
          { id: 'WALK_ledge', points: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
        ],
        walls: [],
      },
      'ledge',
    ),
    flat: parseArena({ name: 'flat', walk: [{ id: 'WALK_floor', points: [[-20, 0, -20], [20, 0, -20], [20, 0, 40], [-20, 0, 40]] }], walls: [] }, 'flat'),
  },
};

const SWORD = 'Arming Sword'; // hip slot, one-handed
const LONGSWORD = 'Longsword'; // back slot, two-handed

const fresh = (weapon = SWORD): SimState => createInitialState(tuning, 1, undefined, [weapon]);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const me = (s: SimState): FighterState => s.fighters[0]!;
const kind = (s: SimState) => me(s).action.kind;

/** Press sheathe and run until the Action it starts ends, collecting every event. */
function toggle(s: SimState, intent: Partial<Intent> = {}): { end: SimState; events: SimEvent[]; length: number } {
  s = tick(s, { ...intent, sheathe: true });
  const events: SimEvent[] = [...s.events];
  let length = 0;
  while (kind(s) === 'Sheathe' || kind(s) === 'Draw') {
    s = tick(s, intent);
    events.push(...s.events);
    if (++length > 1000) throw new Error('never ended');
  }
  return { end: s, events, length };
}

describe('Sheathe and Draw', () => {
  it('every Weapon has a sheathe slot: the Arming Sword on the hip, the others on the back', () => {
    expect(repo.weapons[SWORD]!.sheathe.slot).toBe('hip');
    for (const w of ['Longsword', 'Halberd', 'Sledge Hammer']) expect(repo.weapons[w]!.sheathe.slot).toBe('back');
  });

  it('a hip Sheathe takes 0.7 s and a back one 1.0 s; the Weapon swaps at the Motion’s swap marker', () => {
    for (const [weapon, end] of [[SWORD, 42], [LONGSWORD, 60]] as const) {
      for (const k of ['Sheathe', 'Draw'] as const) {
        const t = sheatheTimings(tuning, weapon, k);
        expect(t.end, `${weapon} ${k}`).toBe(end);
        expect(t.swap).toBeGreaterThan(0);
        expect(t.swap).toBeLessThan(t.end);
      }
    }
  });

  it('a Duel starts drawn, and so does every Fighter of a new Match', () => {
    expect(me(fresh()).sheathed).toBe(false);
    const match = createMatch(tuning, { bestOf: 3, seed: 1, weapons: [SWORD, LONGSWORD] });
    for (const f of match.duel.fighters) expect(f.sheathed).toBe(false);
  });

  for (const weapon of [SWORD, LONGSWORD]) {
    it(`toggles from Idle with the ${weapon}: Sheathed exactly at swap, then Sheathed Idle; a second press Draws back to Idle`, () => {
      const t = sheatheTimings(tuning, weapon, 'Sheathe');
      let s = tick(fresh(weapon), { sheathe: true });
      expect(kind(s)).toBe('Sheathe');
      s = ticks(s, t.swap - 1);
      expect(me(s).sheathed).toBe(false);
      s = tick(s);
      expect(me(s).sheathed).toBe(true);
      expect(s.events).toContainEqual({ type: 'Sheathed', fighter: 0 });
      s = ticks(s, t.end - t.swap - 1);
      expect(kind(s)).toBe('Sheathe');
      s = tick(s);
      expect(kind(s)).toBe('Idle');
      expect(me(s).motion.name).toBe(SHEATHED_IDLE_MOTION);

      // Sheathed Idle plays on: its playhead advances rather than restarting.
      const at = me(s).motion.tick;
      s = ticks(s, 5);
      expect(me(s).motion).toMatchObject({ name: SHEATHED_IDLE_MOTION, tick: at + 5 });

      const d = toggle(s);
      expect(d.length).toBe(sheatheTimings(tuning, weapon, 'Draw').end);
      expect(d.events.filter((e) => e.type === 'Drawn')).toEqual([{ type: 'Drawn', fighter: 0 }]);
      expect(me(d.end).sheathed).toBe(false);
      expect(kind(d.end)).toBe('Idle');
      expect(me(d.end).motion.name).toBe('Idle');
    });
  }

  it('can be started while walking, and the Fighter keeps walking through it', () => {
    let s = ticks(fresh(), 10, { move: { x: 0, z: 1 } });
    const before = me(s).position.z;
    s = tick(s, { move: { x: 0, z: 1 }, sheathe: true });
    expect(kind(s)).toBe('Sheathe');
    s = ticks(s, 10, { move: { x: 0, z: 1 } });
    expect(me(s).position.z).toBeGreaterThan(before + 0.3);
    const { end } = toggle(ticks(s, 100, { move: { x: 0, z: 1 } }));
    expect(me(end).sheathed).toBe(false);
  });

  it('can be started in a Jump, and lands still Sheathing', () => {
    let s = tick(fresh(), { jump: true });
    s = ticks(s, 3);
    expect(me(s).air?.jumped).toBe(true);
    s = tick(s, { sheathe: true });
    expect(kind(s)).toBe('Sheathe');
    expect(me(s).air).toBeDefined();
    while (me(s).air) s = tick(s);
    // A soft Landing does not end it.
    expect(kind(s)).toBe('Sheathe');
    while (kind(s) === 'Sheathe') s = tick(s);
    expect(me(s).sheathed).toBe(true);
  });

  it('cannot Jump, Kick, Throw, Attack or Block while it plays', () => {
    let s = ticks(tick(fresh(), { sheathe: true }), 2);
    for (const intent of [{ jump: true }, { kick: true }, { throw: true }, { attack: true }, { block: true }] satisfies Partial<Intent>[]) {
      s = tick(s, intent);
      expect(kind(s), JSON.stringify(intent)).toBe('Sheathe');
      expect(s.events.some((e) => e.type === 'Jump')).toBe(false);
    }
  });

  it('Attack or Block pressed while Sheathed starts a Draw, not an Attack or Block', () => {
    const sheathed = toggle(fresh()).end;
    for (const intent of [{ attack: true }, { block: true }] satisfies Partial<Intent>[]) {
      const s = tick(sheathed, intent);
      expect(kind(s), JSON.stringify(intent)).toBe('Draw');
      expect(s.events.some((e) => e.type === 'AttackPhase')).toBe(false);
    }
  });

  it('a Sheathed Fighter can still Kick and Throw', () => {
    const sheathed = toggle(fresh()).end;
    expect(kind(tick(sheathed, { kick: true }))).toBe('Kick');
    expect(kind(tick(sheathed, { throw: true }))).toBe('Throw');
  });

  it('carries on through a ledge Fall', () => {
    let s = createInitialState(tuning, 1, [{ position: { x: 0.85, z: 0 }, facing: Math.PI / 2, y: 1 }], [SWORD], [], 'ledge');
    const east = { move: { x: 1, z: 0 } };
    s = tick(s, { ...east, sheathe: true });
    let airborne = 0;
    while (me(s).air || airborne === 0) {
      s = tick(s, east);
      if (me(s).air) {
        airborne++;
        expect(kind(s)).toBe('Sheathe');
      }
      if (airborne === 0 && s.tick > 60) throw new Error('never walked off');
    }
    expect(airborne).toBeGreaterThan(tuning.fall.fallDelay * 60);
    while (kind(s) === 'Sheathe') s = tick(s, east);
    expect(me(s).sheathed).toBe(true);
  });

  describe('interrupted by a Hit', () => {
    // An Overhead from 1.3 m hits (see combat.test.ts); Fighter 1 attacks Fighter 0, who Sheathes.
    const duel = (weapon = SWORD): SimState => createInitialState(tuning, 1, duelPlacements(1.3), [weapon, SWORD]);
    const attack: Intent = { ...IDLE_INTENT, attack: true, direction: 'Overhead' };

    /** Run the duel with Fighter 1 tapping an Overhead on Tick 1 and Fighter 0 pressing sheathe on Tick `sheatheAt`, until the Hit lands. */
    function hitWhileSheathing(sheatheAt: number, sheathing = true): SimState {
      let s = duel();
      for (let i = 1; i < 400; i++) {
        const was = kind(s);
        s = step(s, [{ ...IDLE_INTENT, sheathe: i === sheatheAt }, i === 1 ? attack : IDLE_INTENT], tuning);
        if (s.events.some((e) => e.type === 'Hit' && e.defender === 0)) {
          expect(was).toBe(sheathing ? 'Sheathe' : 'Idle');
          return s;
        }
      }
      throw new Error('the Overhead never hit');
    }

    /** The Tick an Overhead tapped on Tick 1 hits a Fighter standing Idle. */
    const hitTick = hitWhileSheathing(-1, false).tick;
    const { swap } = sheatheTimings(tuning, SWORD, 'Sheathe');

    it('before swap leaves the Fighter drawn', () => {
      const s = hitWhileSheathing(hitTick - 5);
      expect(kind(s)).toBe('Stagger');
      expect(me(s).sheathed).toBe(false);
      expect(swap).toBeGreaterThan(5);
    });

    it('after swap leaves it Sheathed', () => {
      const s = hitWhileSheathing(hitTick - swap - 5);
      expect(kind(s)).toBe('Stagger');
      expect(me(s).sheathed).toBe(true);
      let after = s;
      while (kind(after) === 'Stagger') after = tick(after);
      expect(kind(after)).toBe('Idle');
      expect(me(after).motion.name).toBe(SHEATHED_IDLE_MOTION);
    });
  });

  it('a Knockdown while Sheathed holds no guard, however block is held', () => {
    const sheathed = toggle(fresh()).end;
    const down: SimState = { ...sheathed, fighters: [{ ...me(sheathed), action: { kind: 'Knockdown', phase: 'Falling', ticks: 0, guard: null }, motion: { name: 'Knockdown', tick: 0 } }] };
    const s = ticks(down, 5, { block: true, direction: 'Left' });
    const a = me(s).action;
    expect(a.kind === 'Knockdown' && a.guard).toBeNull();
    // Drawn, the same Knockdown guards.
    const drawn: SimState = { ...down, fighters: [{ ...me(down), sheathed: false }] };
    const g = me(ticks(drawn, 5, { block: true, direction: 'Left' })).action;
    expect(g.kind === 'Knockdown' && g.guard).toBe('Left');
  });

  it("a two-handed Weapon's off hand lets go over the Sheathe, stays free while Sheathed, and takes the grip back by the end of a Draw", () => {
    let s = tick(fresh(LONGSWORD), { sheathe: true });
    expect(offHandFree(me(s), tuning)).toBe(0);
    s = ticks(s, 20);
    expect(offHandFree(me(s), tuning)).toBe(1);
    s = toggle(s).end;
    expect(offHandFree(me(s), tuning)).toBe(1);
    s = tick(s, { sheathe: true });
    expect(offHandFree(me(s), tuning)).toBe(1);
    const { end } = sheatheTimings(tuning, LONGSWORD, 'Draw');
    s = ticks(s, end - 1);
    expect(kind(s)).toBe('Draw');
    expect(offHandFree(me(s), tuning)).toBeLessThan(1);
    s = tick(s);
    expect(offHandFree(me(s), tuning)).toBe(0);
  });

  it('is deterministic: two runs, and a run restored from a snapshot mid-Sheathe, give the same hash', () => {
    const script = (s: SimState, from = 0): SimState => {
      for (let i = from; i < 200; i++) s = tick(s, { move: { x: 0.3, z: 1 }, sheathe: i === 3 || i === 120, jump: i === 60 });
      return s;
    };
    const a = script(fresh(LONGSWORD));
    expect(hashState(script(fresh(LONGSWORD)))).toBe(hashState(a));
    let mid = fresh(LONGSWORD);
    for (let i = 0; i < 20; i++) mid = tick(mid, { move: { x: 0.3, z: 1 }, sheathe: i === 3 });
    expect(kind(mid)).toBe('Sheathe');
    expect(hashState(script(restore(snapshot(mid)), 20))).toBe(hashState(a));
  });

  describe('movement', () => {
    const FORWARD = { x: 0, z: 1 };
    const DRAWN = tuning.fighter.walkSpeed / 60;
    /** How far one more Tick of walking forward carries the Fighter. */
    const stride = (s: SimState, intent: Partial<Intent> = {}): number => me(tick(s, { move: FORWARD, ...intent })).position.z - me(s).position.z;
    /** A lone Fighter on open, flat ground, Sheathed or drawn, standing Idle. */
    const standing = (sheathed: boolean, at = { x: 0, z: -10 }): SimState => {
      const s = createInitialState(tuning, 1, [{ position: at, facing: 0 }], [SWORD], [], 'flat');
      return { ...s, fighters: [{ ...me(s), sheathed, motion: { name: sheathed ? SHEATHED_IDLE_MOTION : 'Idle', tick: 0 } }] };
    };

    it('a Sheathed Fighter walks at fighter.sheathedWalkFactor times the drawn speed', () => {
      expect(tuning.fighter.sheathedWalkFactor).toBeGreaterThan(1);
      expect(stride(toggle(fresh()).end)).toBeCloseTo(DRAWN * tuning.fighter.sheathedWalkFactor, 12);
      expect(stride(fresh())).toBeCloseTo(DRAWN, 12);
    });

    it('the Sheathed speed stacks with Crouch and Slow', () => {
      const sheathed = toggle(fresh()).end;
      const crouched = ticks(sheathed, 30, { crouch: true });
      expect(me(crouched).crouch).toBe(1);
      expect(stride(crouched, { crouch: true })).toBeCloseTo(DRAWN * tuning.fighter.sheathedWalkFactor * tuning.fighter.crouchWalkFactor, 12);
      const slowed: SimState = { ...sheathed, fighters: [{ ...me(sheathed), slow: { ticks: 30 } }] };
      expect(stride(slowed)).toBeCloseTo(DRAWN * tuning.fighter.sheathedWalkFactor * tuning.dagger.slowFactor, 12);
    });

    it('a Sheathe or a Draw walks at the drawn speed, even once Sheathed', () => {
      const sheathing = tick(fresh(), { sheathe: true });
      expect(stride(sheathing)).toBeCloseTo(DRAWN, 12);
      const { swap, end } = sheatheTimings(tuning, SWORD, 'Sheathe');
      const pastSwap = ticks(sheathing, swap + 1);
      expect(me(pastSwap).sheathed).toBe(true);
      expect(kind(pastSwap)).toBe('Sheathe');
      expect(stride(pastSwap)).toBeCloseTo(DRAWN, 12);
      expect(end).toBeGreaterThan(swap + 2);
      const drawing = tick(toggle(fresh()).end, { sheathe: true });
      expect(kind(drawing)).toBe('Draw');
      expect(me(drawing).sheathed).toBe(true);
      expect(stride(drawing)).toBeCloseTo(DRAWN, 12);
    });

    for (const hold of [0, 15, 30]) {
      it(`a Sheathed Jump held ${hold} Ticks, from a run, flies exactly the drawn arc (jumpArc) and lands Sheathed`, () => {
        /** Run 20 Ticks forward, then Jump holding it `hold` Ticks, walking on until it lands. */
        const run = (sheathed: boolean) => {
          let s = ticks(standing(sheathed), 20, { move: FORWARD });
          const from = me(s);
          const path: { x: number; z: number; y: number }[] = [];
          for (let i = 0; i < 300; i++) {
            s = tick(s, { move: FORWARD, jump: i === 0, jumpHeld: i < hold });
            path.push({ ...me(s).position, y: me(s).y });
            if (!me(s).air) break;
          }
          return { from, path, end: me(s) };
        };
        const sheathed = run(true);
        const drawn = run(false);
        // It ran faster before the Jump, but the Jump itself is the drawn one.
        expect(sheathed.from.position.z - drawn.from.position.z).toBeCloseTo(20 * DRAWN * (tuning.fighter.sheathedWalkFactor - 1), 9);
        const arc = jumpArc(arenaOf(tuning, 'flat'), tuning, { at: sheathed.from.position, y: 0, heading: FORWARD, holdTicks: hold });
        expect(sheathed.path).toHaveLength(arc.ticks);
        sheathed.path.forEach((p, i) => {
          expect(p.x, `Tick ${i}`).toBeCloseTo(arc.path[i]!.x, 9);
          expect(p.z, `Tick ${i}`).toBeCloseTo(arc.path[i]!.z, 9);
          expect(p.y, `Tick ${i}`).toBeCloseTo(arc.path[i]!.y, 9);
          expect(p.z - sheathed.from.position.z, `Tick ${i}`).toBeCloseTo(drawn.path[i]!.z - drawn.from.position.z, 9);
        });
        expect(sheathed.end.sheathed).toBe(true);
      });
    }
  });
});
