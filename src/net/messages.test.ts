import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, IDLE_INTENT, stepMatch, throwTimings, type MatchState } from '../sim';
import { createAiController } from '../controllers';
import { parseNetMessage } from './messages';

const tuning = loadTuningData();

/** A real, mid-Duel Match state, as a host would send it in a resync. */
function matchState(): MatchState {
  let m = createMatch(tuning, { bestOf: 3, distance: 1.3, seed: 3 });
  for (let t = 0; t < 40; t++) m = stepMatch(m, [{ ...IDLE_INTENT, attack: t === 0 }, IDLE_INTENT], tuning);
  return JSON.parse(JSON.stringify(m)) as MatchState;
}

/** A Match state caught mid-Kick (a Recovery that has whiffed for a few Ticks), as a host would send it. */
function kickingMatchState(): MatchState {
  let m = createMatch(tuning, { bestOf: 3, distance: 1.3, seed: 3 });
  for (let t = 0; t < 40; t++) m = stepMatch(m, [{ ...IDLE_INTENT, kick: t === 0 }, IDLE_INTENT], tuning);
  return JSON.parse(JSON.stringify(m)) as MatchState;
}

/** A Match state caught mid-Throw, with a dagger spent, as a host would send it. */
function throwingMatchState(): MatchState {
  let m = createMatch(tuning, { bestOf: 3, distance: 1.3, seed: 3 });
  // A few Ticks past Release: the dagger is in flight and the Throw is still on.
  const released = throwTimings(tuning, m.duel.fighters[0]!.weapon).windUpEnd + 4;
  for (let t = 0; t < released; t++) m = stepMatch(m, [{ ...IDLE_INTENT, throw: t === 0 }, IDLE_INTENT], tuning);
  return JSON.parse(JSON.stringify(m)) as MatchState;
}

const resync = (state: unknown, ai: unknown[] = [null, null]) => ({ type: 'resync', tick: 40, state, ai, intentsFrom: 38, intents: [IDLE_INTENT, IDLE_INTENT, IDLE_INTENT] });

describe('Peer message validation', () => {
  it('accepts well-formed messages of every type', () => {
    const valid = [
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234' },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', match: { bestOf: 3, distance: 2, interDuelTicks: 60, seed: 9 } },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 'Halberd', match: { bestOf: 3, weapons: ['Halberd', 'Longsword'] } },
      { type: 'refuse', reason: 'TuningDataMismatch', tuningHash: 'abcd1234' },
      { type: 'intents', from: 1, intents: [IDLE_INTENT, { ...IDLE_INTENT, move: { x: 1, z: 0 }, direction: 'Left', attack: true, face: 1.5 }, { ...IDLE_INTENT, kick: true, crouch: false }], ack: 0 },
      { type: 'checksum', tick: 30, hash: 'abcd1234' },
      { type: 'resyncRequest', tick: 30 },
      resync(matchState()),
      resync(kickingMatchState()),
      resync(throwingMatchState()),
    ];
    for (const m of valid) expect(parseNetMessage(m), JSON.stringify(m).slice(0, 80)).toEqual(m);
  });

  it('refuses a hello whose Match options are malformed', () => {
    for (const match of [{}, { bestOf: 0 }, { bestOf: 2.5 }, { bestOf: 3, distance: 'far' }, { bestOf: 3, interDuelTicks: 0 }, { bestOf: 3, seed: 'x' }, { bestOf: 3, weapons: ['Halberd'] }, { bestOf: 3, weapons: [1, 2] }]) {
      expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match })).toBeNull();
    }
    expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 7 })).toBeNull();
  });

  it('refuses an Intent whose kick is not a boolean', () => {
    expect(parseNetMessage({ type: 'intents', from: 0, intents: [{ ...IDLE_INTENT, kick: 'yes' }], ack: 0 })).toBeNull();
  });

  it('carries the Kick Action and the kicking leg through a resync', () => {
    const state = kickingMatchState();
    expect(state.duel.fighters[0]!.action.kind).toBe('Kick');
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
  });

  it('refuses an Intent whose throw is not a boolean', () => {
    expect(parseNetMessage({ type: 'intents', from: 0, intents: [{ ...IDLE_INTENT, throw: 1 }], ack: 0 })).toBeNull();
  });

  it('carries the Throw Action and the dagger count through a resync', () => {
    const state = throwingMatchState();
    expect(state.duel.fighters[0]!.action.kind).toBe('Throw');
    expect(state.duel.fighters[0]!.daggers).toBe(tuning.dagger.count - 1);
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
  });

  it('carries a dagger in flight through a resync, and refuses a malformed one', () => {
    const state = throwingMatchState();
    const [dagger] = state.duel.daggers;
    expect(dagger).toBeDefined();
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
    const withDaggers = (daggers: unknown) => resync({ ...state, duel: { ...state.duel, daggers } });
    for (const bad of [undefined, 'one', [{ ...dagger, owner: -1 }], [{ ...dagger, team: 2 }], [{ ...dagger, position: { x: 0 } }], [{ ...dagger, velocity: undefined }], [{ ...dagger, ticks: 1.5 }], [{ ...dagger, thrownAt: 'now' }]])
      expect(parseNetMessage(withDaggers(bad))).toBeNull();
  });

  it('carries a Knockdown through a resync, and refuses a malformed one', () => {
    const state = matchState();
    const down = (action: unknown) => ({ ...state, duel: { ...state.duel, fighters: [{ ...state.duel.fighters[0]!, action }, ...state.duel.fighters.slice(1)] } });
    for (const good of [
      { kind: 'Knockdown', phase: 'Falling', ticks: 0, guard: null },
      { kind: 'Knockdown', phase: 'Down', ticks: 12, guard: 'Left' },
      { kind: 'Knockdown', phase: 'Rising', ticks: 0, guard: 'Thrust' },
    ]) expect(parseNetMessage(resync(down(good)))).toEqual(resync(down(good)));
    for (const bad of [
      { kind: 'Knockdown', phase: 'Lying', ticks: 0, guard: null },
      { kind: 'Knockdown', phase: 'Down', ticks: -1, guard: null },
      { kind: 'Knockdown', phase: 'Down', ticks: 1, guard: 'Sideways' },
      { kind: 'Knockdown', phase: 'Down', ticks: 1 },
    ]) expect(parseNetMessage(resync(down(bad)))).toBeNull();
  });

  it('carries a Slide through a resync, and refuses a malformed one', () => {
    const state = matchState();
    const slide = (v: unknown) => ({ ...state, duel: { ...state.duel, fighters: [{ ...state.duel.fighters[0]!, slide: v }, ...state.duel.fighters.slice(1)] } });
    const sliding = slide({ vx: 1.5, vz: -2, ticks: 7 });
    expect(parseNetMessage(resync(sliding))).toEqual(resync(sliding));
    expect(parseNetMessage(resync(slide({ vx: 1.5, vz: -2 })))).toBeNull();
    expect(parseNetMessage(resync(slide({ vx: 'fast', vz: 0, ticks: 3 })))).toBeNull();
    expect(parseNetMessage(resync(slide({ vx: 0, vz: 0, ticks: -1 })))).toBeNull();
  });

  it('carries a Slow through a resync, and refuses a malformed one', () => {
    const state = matchState();
    const slow = (v: unknown) => ({ ...state, duel: { ...state.duel, fighters: [{ ...state.duel.fighters[0]!, slow: v }, ...state.duel.fighters.slice(1)] } });
    const slowed = slow({ ticks: 120 });
    expect(parseNetMessage(resync(slowed))).toEqual(resync(slowed));
    expect(parseNetMessage(resync(slow({})))).toBeNull();
    expect(parseNetMessage(resync(slow({ ticks: -1 })))).toBeNull();
    expect(parseNetMessage(resync(slow({ ticks: 'long' })))).toBeNull();
  });

  it('refuses a resync whose Match state is malformed', () => {
    const good = matchState();
    const fighter = good.duel.fighters[0]!;
    const withFighter = (f: unknown) => ({ ...good, duel: { ...good.duel, fighters: [f, good.duel.fighters[1]] } });
    const broken: unknown[] = [
      {},
      null,
      { ...good, tick: 'late' },
      { ...good, score: [1] },
      { ...good, config: { ...good.config, bestOf: -1 } },
      { ...good, config: { ...good.config, weapons: undefined } },
      { ...good, config: { ...good.config, weapons: ['Halberd'] } },
      { ...good, status: { status: 'Paused' } },
      { ...good, duel: { ...good.duel, fighters: [fighter] } },
      { ...good, duel: { ...good.duel, rng: {} } },
      { ...good, duel: { ...good.duel, duel: { status: 'Over' } } },
      withFighter({ ...fighter, hp: '100' }),
      withFighter({ ...fighter, weapon: undefined }),
      withFighter({ ...fighter, position: { x: 0 } }),
      withFighter({ ...fighter, action: { kind: 'Dance' } }),
      withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Overhead', phase: 'Twirl', landed: false } }),
      withFighter({ ...fighter, action: { kind: 'Stagger', cause: 'Tired' } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Twirl', landed: false } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Release' } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Recovery', landed: false, whiff: -1 } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Twirl', startTick: 3 } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Release' } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Release', startTick: -1 } }),
      withFighter({ ...fighter, daggers: undefined }),
      withFighter({ ...fighter, daggers: -1 }),
      withFighter({ ...fighter, daggers: 1.5 }),
      withFighter({ ...fighter, kickLeg: undefined }),
      withFighter({ ...fighter, kickLeg: { knee: { x: 0, y: 0, z: 0 } } }),
      withFighter({ ...fighter, motion: { name: 'Idle', tick: -1 } }),
      withFighter({ ...fighter, blade: { hilt: { x: 0, y: 0, z: 0 } } }),
      withFighter({ ...fighter, gait: undefined }),
      withFighter({ ...fighter, gait: { left: fighter.gait.left } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, left: { planted: { x: 0 }, step: null } } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, right: { planted: { x: 0, z: 0 }, step: { tick: -1, target: { x: 0, z: 0 } } } } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, right: { planted: { x: 0, z: 0 }, step: { tick: 2, target: 'there' } } } }),
    ];
    for (const state of broken) expect(parseNetMessage(resync(state)), JSON.stringify(state)?.slice(0, 120)).toBeNull();
    expect(parseNetMessage({ ...resync(good), intents: [{}] })).toBeNull();
  });
});

describe('Peer message validation: AI memory in a resync', () => {
  /** A real AI Controller's memory after watching 40 Ticks of a 1 v 2, as the host would send it. */
  function aiMemory(): unknown {
    const ai = createAiController(tuning, 'Normal');
    let m = createMatch(tuning, { bestOf: 1, teams: [0, 1, 1], seed: 3 });
    for (let t = 0; t < 40; t++) m = stepMatch(m, [{ ...IDLE_INTENT, attack: t === 0 }, ai.intent(m.duel, 1)], tuning);
    return JSON.parse(JSON.stringify(ai.save!()));
  }

  it('accepts a real AI memory, or null for a Player', () => {
    const m = resync(matchState(), [null, aiMemory()]);
    expect(parseNetMessage(m)).toEqual(m);
  });

  it('refuses malformed AI memory', () => {
    const good = aiMemory() as Record<string, unknown>;
    for (const bad of [42, {}, { ...good, lastTick: 'x' }, { ...good, seen: [{ tick: 1, fighters: [{}] }] }, { ...good, defencePlan: { attacker: 1 } }, { ...good, attackPlan: { direction: 'Overhead' } }, { ...good, tactic: { mode: 'Panic', until: 0 } }, { ...good, feintPlan: { from: 'Up' } }]) {
      expect(parseNetMessage(resync(matchState(), [null, bad])), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
    expect(parseNetMessage({ ...resync(matchState()), ai: undefined })).toBeNull();
  });
});
