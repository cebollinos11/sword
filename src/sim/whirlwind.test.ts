import { describe, expect, it } from 'vitest';
import { canWhirlwind, loadTuningData } from '../tuning';
import {
  attack,
  createInitialState,
  hashState,
  IDLE_INTENT,
  restore,
  runDuel,
  snapshot,
  step,
  wait,
  whirlwindDirection,
  whirlwindHoldMotion,
  whirlwindTimings,
  type Direction,
  type FighterState,
  type Intent,
  type SimEvent,
  type SimState,
  type WhirlwindAction,
} from './index';

const tuning = loadTuningData();
const t = whirlwindTimings(tuning);
const SWORD = Object.keys(tuning.weapons)[0]!;

const fresh = (weapon = SWORD): SimState => createInitialState(tuning, 1, undefined, [weapon]);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const me = (s: SimState): FighterState => s.fighters[0]!;
const spin = (s: SimState): WhirlwindAction => {
  const a = me(s).action;
  if (a.kind !== 'Whirlwind') throw new Error(`expected a Whirlwind, got ${a.kind}`);
  return a;
};
const G: Partial<Intent> = { whirlwind: true, direction: 'Right' };
const whirlEvents = (s: SimState): SimEvent[] => s.events.filter((e) => e.type === 'WhirlwindPhase' || e.type === 'WhirlwindArmed');

/** Press G on Tick S (the first Tick returned) and hold it `n` more Ticks, returning the state after each Tick. */
function held(n: number, intent: Partial<Intent> = G): SimState[] {
  const out = [tick(fresh(), intent)];
  for (let i = 0; i < n; i++) out.push(tick(out.at(-1)!, intent));
  return out;
}

describe('Whirlwind timings', () => {
  it('are 60, 18, 90 and 30 Ticks by default', () => {
    expect(t).toEqual({ armTicks: 60, turnTicks: 18, spinTicks: 90, recoveryTicks: 30 });
  });
});

describe('Whirlwind hold', () => {
  it('arms on exactly Tick S + armTicks: the event and the flag, and not a Tick sooner', () => {
    const states = held(t.armTicks); // states[i] is Tick S + i
    for (let i = 0; i < t.armTicks; i++) {
      expect(spin(states[i]!).armed, `Tick S+${i}`).toBe(false);
      expect(states[i]!.events.some((e) => e.type === 'WhirlwindArmed'), `Tick S+${i}`).toBe(false);
    }
    expect(spin(states[t.armTicks]!)).toMatchObject({ phase: 'Wind-up', armed: true, ticks: t.armTicks });
    expect(states[t.armTicks]!.events.filter((e) => e.type === 'WhirlwindArmed')).toEqual([{ type: 'WhirlwindArmed', fighter: 0 }]);
    // Once only, however long it is held on.
    const more = ticks(states.at(-1)!, 20, G);
    expect(more.events.some((e) => e.type === 'WhirlwindArmed')).toBe(false);
    expect(spin(more).armed).toBe(true);
  });

  it('starting emits a Wind-up phase event and plays the hold Motion of its side', () => {
    const s = tick(fresh(), G);
    expect(whirlEvents(s)).toEqual([{ type: 'WhirlwindPhase', fighter: 0, phase: 'Wind-up' }]);
    expect(spin(s)).toEqual({ kind: 'Whirlwind', phase: 'Wind-up', direction: 'Right', ticks: 0, armed: false, turn: 0 });
    expect(me(s).motion.name).toBe('WhirlwindHoldRight');
    expect(me(tick(fresh(), { whirlwind: true, direction: 'Left' })).motion.name).toBe('WhirlwindHoldLeft');
  });

  it('letting go on Tick S + armTicks - 1 cancels: Idle, a Cancelled event, no Spin', () => {
    const states = held(t.armTicks - 2); // Tick S .. S + armTicks - 2, still unarmed
    expect(spin(states.at(-1)!).armed).toBe(false);
    const s = tick(states.at(-1)!, {}); // Tick S + armTicks - 1, let go
    expect(me(s).action.kind).toBe('Idle');
    expect(whirlEvents(s)).toEqual([{ type: 'WhirlwindPhase', fighter: 0, phase: 'Cancelled' }]);
    const later = ticks(s, t.spinTicks + 5);
    expect(me(later).action.kind).toBe('Idle');
    expect(whirlEvents(later)).toEqual([]);
  });

  it('letting go on Tick S + armTicks spins', () => {
    const states = held(t.armTicks);
    const s = tick(states.at(-1)!, {});
    expect(spin(s)).toMatchObject({ phase: 'Spin', ticks: 0, turn: 0, armed: true });
  });

  it('an armed release spins for spinTicks (turn 0..4, turnTicks each), recovers for recoveryTicks, then is Idle, with the phase events in order', () => {
    let s = held(t.armTicks).at(-1)!;
    const events: SimEvent[] = [];
    const spinTurns: number[] = [];
    const recoveryTurns: number[] = [];
    s = tick(s, {}); // first Spin Tick
    events.push(...whirlEvents(s));
    let guard = 0;
    while (me(s).action.kind === 'Whirlwind') {
      const a = spin(s);
      (a.phase === 'Spin' ? spinTurns : recoveryTurns).push(a.turn);
      s = tick(s, {});
      events.push(...whirlEvents(s));
      if (++guard > 1000) throw new Error('never ended');
    }
    expect(spinTurns).toHaveLength(t.spinTicks);
    expect([...new Set(spinTurns)]).toEqual([0, 1, 2, 3, 4]);
    for (let turn = 0; turn < tuning.whirlwind.turns; turn++) expect(spinTurns.filter((x) => x === turn)).toHaveLength(t.turnTicks);
    expect(spinTurns).toEqual([...spinTurns].sort((a, b) => a - b));
    // Recovery starts on the Tick after the last Spin Tick and keeps the last turn.
    expect(recoveryTurns).toHaveLength(t.recoveryTicks);
    expect(new Set(recoveryTurns)).toEqual(new Set([tuning.whirlwind.turns - 1]));
    expect(events).toEqual([
      { type: 'WhirlwindPhase', fighter: 0, phase: 'Spin' },
      { type: 'WhirlwindPhase', fighter: 0, phase: 'Recovery' },
    ]);
    expect(me(s).action.kind).toBe('Idle');
    expect(me(s).motion.name).toBe('Idle');
  });

  it('holds the coiled pose through the Spin and plays Idle in Recovery', () => {
    const lastTick = Math.round(tuning.motions.WhirlwindHoldRight!.duration * 60);
    const states = held(t.armTicks);
    const playing = (s: SimState) => ({ name: me(s).motion.name, tick: me(s).motion.tick });
    expect(playing(states[5]!)).toEqual({ name: 'WhirlwindHoldRight', tick: 5 });
    expect(playing(states.at(-1)!)).toEqual({ name: 'WhirlwindHoldRight', tick: lastTick });
    const spinning = tick(states.at(-1)!, {});
    expect(playing(spinning)).toEqual({ name: 'WhirlwindHoldRight', tick: lastTick });
    expect(me(ticks(spinning, t.spinTicks)).motion.name).toBe('Idle');
  });
});

describe('Whirlwind hold walk', () => {
  it('moves at holdWalkFactor of the plain walk', () => {
    const move = { x: 1, z: 0 };
    const plain = ticks(tick(fresh()), 10, { move });
    const dPlain = (me(tick(plain, { move })).position.x - me(plain).position.x);
    const held1 = ticks(tick(fresh(), G), 10, { ...G, move });
    const dHeld = me(tick(held1, { ...G, move })).position.x - me(held1).position.x;
    expect(dPlain).toBeGreaterThan(0);
    expect(dHeld / dPlain).toBeCloseTo(tuning.whirlwind.holdWalkFactor, 6);
  });

  it('cannot walk in the Spin but still turns, and walks normally in Recovery', () => {
    const move = { x: 1, z: 0 };
    let s = tick(held(t.armTicks).at(-1)!, { move }); // Spin begins
    expect(spin(s).phase).toBe('Spin');
    const x0 = me(s).position.x;
    s = tick(s, { move, face: 1 });
    expect(me(s).position.x).toBe(x0);
    expect(me(s).facing).not.toBe(0);
    s = ticks(s, t.spinTicks, { move });
    expect(spin(s).phase).toBe('Recovery');
    const x1 = me(s).position.x;
    expect(me(tick(s, { move })).position.x).toBeGreaterThan(x1);
  });
});

describe('Whirlwind is committed', () => {
  const others: [string, Partial<Intent>][] = [
    ['attack', { attack: true, direction: 'Overhead' }],
    ['block', { block: true, direction: 'Left' }],
    ['kick', { kick: true }],
    ['throw', { throw: true, throwHeld: true }],
    ['sheathe', { sheathe: true }],
    ['a changed Direction', { direction: 'Left' }],
  ];
  for (const [name, extra] of others) {
    it(`${name} during the hold changes nothing`, () => {
      const base = held(10);
      const withExtra = ticks(base[0]!, 10, { ...G, ...extra });
      expect(spin(withExtra)).toEqual(spin(base.at(-1)!));
      expect(me(withExtra).action).toEqual(me(base.at(-1)!).action);
      expect(me(withExtra).sheathed).toBe(false);
      expect(whirlEvents(withExtra)).toEqual([]);
    });
  }

  it('a button other than G pressed on the Tick the hold ends starts nothing; the armed Spin goes on', () => {
    const s = tick(held(t.armTicks).at(-1)!, { attack: true, kick: true, block: true });
    expect(spin(s).phase).toBe('Spin');
    expect(spin(tick(s, { attack: true })).ticks).toBe(1);
  });
});

describe('Whirlwind Direction', () => {
  it('keeps Left and Right and gives Right for Overhead and Thrust', () => {
    const want: Record<Direction, string> = { Left: 'Left', Right: 'Right', Overhead: 'Right', Thrust: 'Right' };
    for (const d of Object.keys(want) as Direction[]) {
      expect(whirlwindDirection(d)).toBe(want[d]);
      const s = tick(fresh(), { whirlwind: true, direction: d });
      expect(spin(s).direction).toBe(want[d]);
      expect(me(s).motion.name).toBe(whirlwindHoldMotion(spin(s).direction));
    }
  });

  it('is fixed when the hold starts', () => {
    const s = ticks(tick(fresh(), { whirlwind: true, direction: 'Left' }), 5, { whirlwind: true, direction: 'Right' });
    expect(spin(s).direction).toBe('Left');
  });
});

describe('Whirlwind availability', () => {
  it('cannot start Sheathed (and does not Draw)', () => {
    let s = fresh();
    s = tick(s, { sheathe: true });
    for (let i = 0; i < 200 && me(s).action.kind !== 'Idle'; i++) s = tick(s);
    expect(me(s).sheathed).toBe(true);
    s = ticks(s, 5, G);
    expect(me(s).action.kind).toBe('Idle');
    expect(me(s).sheathed).toBe(true);
  });

  it('cannot start with the Flail, and every other Weapon can', () => {
    expect(tuning.whirlwind.unavailableWeapons).toEqual(['Flail']);
    expect(canWhirlwind(tuning, 'Flail')).toBe(false);
    const s = ticks(fresh('Flail'), 5, G);
    expect(me(s).action.kind).toBe('Idle');
    expect(whirlEvents(s)).toEqual([]);
    for (const weapon of Object.keys(tuning.weapons)) {
      if (weapon === 'Flail') continue;
      expect(canWhirlwind(tuning, weapon), weapon).toBe(true);
      expect(me(tick(fresh(weapon), G)).action.kind, weapon).toBe('Whirlwind');
    }
  });

  it('is refused when a hold Motion is missing', () => {
    const { WhirlwindHoldLeft: _left, ...motions } = tuning.motions;
    expect(canWhirlwind({ ...tuning, motions }, SWORD)).toBe(false);
  });

  it('starts crouched', () => {
    const s = ticks(fresh(), 20, { crouch: true });
    expect(me(s).crouch).toBeGreaterThan(0.5);
    const w = tick(s, { crouch: true, ...G });
    expect(spin(w).phase).toBe('Wind-up');
  });

  it('starts in a Jump, in the air, and carries on there', () => {
    const jumped = tick(fresh(), { jump: true, jumpHeld: true, ...G });
    expect(me(jumped).air?.jumped).toBe(true);
    expect(spin(jumped).phase).toBe('Wind-up');
    const later = ticks(jumped, 3, G);
    expect(spin(later).ticks).toBe(3);
  });

  it('cannot start after walking off the ground (not a Jump)', () => {
    const s = fresh();
    const falling: SimState = { ...s, fighters: [{ ...me(s), air: { ...(me(tick(fresh(), { jump: true })).air!), jumped: false } }] };
    expect(me(tick(falling, G)).action.kind).not.toBe('Whirlwind');
  });
});

describe('Whirlwind and Hits', () => {
  it('a blade Hit on a holder Staggers it out of the Whirlwind', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: [{ ticks: 60, intent: G }], ticks: 120 });
    const hit = run.events.find((e) => e.type === 'Hit');
    expect(hit).toBeDefined();
    const holder = run.final.fighters[1]!;
    expect(holder.hp).toBeLessThan(100);
    expect(run.events.some((e) => e.type === 'Stagger' && e.fighter === 1)).toBe(true);
    // The Stagger ended the hold: it never armed, Spun or Cancelled, and nothing but the starting Wind-up was announced.
    expect(run.events.filter((e) => e.type === 'WhirlwindArmed' || (e.type === 'WhirlwindPhase' && e.phase !== 'Wind-up'))).toEqual([]);
    expect(holder.action.kind).toBe('Idle');
  });
});

describe('Whirlwind Rollback', () => {
  it('a snapshot taken mid-hold restores to the same hashes stepping forward', () => {
    const intents: Partial<Intent>[] = [];
    for (let i = 0; i < 220; i++) intents.push(i < 75 ? { ...G, move: { x: 0.5, z: 0.5 } } : i < 80 ? { ...G, face: 0.3 } : {});
    let live = fresh();
    for (let i = 0; i < 40; i++) live = tick(live, intents[i]);
    expect(spin(live).phase).toBe('Wind-up');
    const snap = snapshot(live);
    let replay = restore(snap);
    expect(hashState(replay)).toBe(hashState(live));
    for (let i = 40; i < 220; i++) {
      live = tick(live, intents[i]);
      replay = tick(replay, intents[i]);
      expect(hashState(replay), `Tick ${i}`).toBe(hashState(live));
    }
    expect(me(live).action.kind).toBe('Idle');
  });
});

describe('Intents without the Whirlwind', () => {
  it('a Duel where nobody presses G hashes the same whether Intents omit whirlwind or send false', () => {
    const script = (extra: Partial<Intent>) => ({ distance: 1.3, a: [...attack('Overhead'), ...wait(30)].map((s) => ({ ...s, intent: { ...s.intent, ...extra } })), b: [{ ticks: 60, intent: { move: { x: 0, z: 1 }, ...extra } }], ticks: 150 });
    const omitted = runDuel(tuning, script({}));
    const sentFalse = runDuel(tuning, script({ whirlwind: false }));
    expect(hashState(sentFalse.final)).toBe(hashState(omitted.final));
    expect(sentFalse.events).toEqual(omitted.events);
  });
});
