import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { attack, createInitialState, createMatch, duelPlacements, hold, wait, walk, type SimState, IDLE_INTENT, MAX_TEAM_SIZE, NO_MODS, runDuel, stepMatch, throwTimings, type Intent, type MatchState } from '../sim';
import { aiDifficulty, createAiController, FLOOR_DIFFICULTY, lineupAis, lineupMatch, runControllers, scriptedController, type Controller, type Lineup } from '../controllers';
import { parseNetMessage, PROTOCOL_VERSION } from './messages';

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

const resync = (state: unknown, ai: unknown[] = [null, null]) => ({ type: 'resync', tick: 40, state, ai, streams: [{ player: 0, from: 38, intents: [IDLE_INTENT, IDLE_INTENT, IDLE_INTENT] }] });
/** An Intents message carrying one Player's stream. */
const intents = (list: unknown[], extra: object = {}) => ({ type: 'intents', tick: 3, streams: [{ player: 1, from: 1, intents: list }], acks: [2, 0], ...extra });

describe('Peer message validation', () => {
  it('accepts well-formed messages of every type', () => {
    const valid = [
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234' },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', match: { bestOf: 3, distance: 2, interDuelTicks: 60, seed: 9 } },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 'Halberd', match: { bestOf: 3, weapons: ['Halberd', 'Longsword'] } },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 'Halberd', match: { bestOf: 3 }, weapons: ['Halberd', 'Longsword', 'Halberd'], player: 2 },
      { type: 'refuse', reason: 'TuningDataMismatch', tuningHash: 'abcd1234' },
      intents([IDLE_INTENT, { ...IDLE_INTENT, move: { x: 1, z: 0 }, direction: 'Left', attack: true, face: 1.5 }, { ...IDLE_INTENT, kick: true, crouch: false }]),
      { type: 'intents', tick: 9, streams: [{ player: 0, from: 5, intents: [IDLE_INTENT] }, { player: 2, from: 4, intents: [] }], acks: [9, 7, 6, 0], dropped: [{ player: 3, tick: 8 }] },
      { type: 'intents', tick: 0, streams: [], acks: [] },
      { type: 'checksum', tick: 30, hash: 'abcd1234' },
      { type: 'resyncRequest', tick: 30 },
      { type: 'ping', sent: 12.5 },
      { type: 'pong', sent: 12.5 },
      { type: 'pong', sent: 12.5, lag: 3.2 },
      resync(matchState()),
      resync(kickingMatchState()),
      resync(throwingMatchState()),
    ];
    for (const m of valid) expect(parseNetMessage(m), JSON.stringify(m).slice(0, 80)).toEqual(m);
  });

  it('refuses a hello whose Match options are malformed', () => {
    for (const match of [{}, { bestOf: 0 }, { bestOf: 2.5 }, { bestOf: 3, distance: 'far' }, { bestOf: 3, interDuelTicks: 0 }, { bestOf: 3, seed: 'x' }, { bestOf: 3, weapons: [] }, { bestOf: 3, weapons: [1, 2] }]) {
      expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match })).toBeNull();
    }
    expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 7 })).toBeNull();
  });

  it('refuses a hello naming a Player or picks beyond four Players', () => {
    const hello = { type: 'hello', protocol: 1, tuningHash: 'abcd1234' };
    for (const extra of [{ player: 4 }, { player: -1 }, { player: 1.5 }, { weapons: [] }, { weapons: ['a', 'b', 'c', 'd', 'e'] }, { weapons: [1, 2] }]) {
      expect(parseNetMessage({ ...hello, ...extra }), JSON.stringify(extra)).toBeNull();
    }
  });

  it('refuses malformed Intents streams, acks and dropped Players', () => {
    for (const extra of [
      { streams: [{ player: 4, from: 1, intents: [] }] },
      { streams: [{ player: 1, from: -1, intents: [] }] },
      { streams: [{ player: 1, from: 1, intents: [] }, { player: 1, from: 2, intents: [] }] },
      { streams: null },
      { acks: [1, 2, 3, 4, 5] },
      { acks: [-1] },
      { acks: undefined },
      { tick: 'now' },
      { dropped: [{ player: 1, tick: 0 }] },
      { dropped: [{ player: 9, tick: 3 }] },
      { dropped: {} },
    ]) {
      expect(parseNetMessage({ ...intents([IDLE_INTENT]), ...extra }), JSON.stringify(extra)).toBeNull();
    }
  });

  it('refuses an Intent whose kick is not a boolean', () => {
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, kick: 'yes' }]))).toBeNull();
  });

  it('carries the Kick Action and the kicking leg through a resync', () => {
    const state = kickingMatchState();
    expect(state.duel.fighters[0]!.action.kind).toBe('Kick');
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
  });

  it('refuses an Intent whose throw is not a boolean', () => {
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, throw: 1 }]))).toBeNull();
  });

  it('refuses an Intent whose sheathe is not a boolean, and accepts one that Sheathes', () => {
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, sheathe: 'yes' }]))).toBeNull();
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, sheathe: true }]))).toEqual(intents([{ ...IDLE_INTENT, sheathe: true }]));
  });

  it('carries the Throw Action and the dagger count through a resync', () => {
    const state = throwingMatchState();
    expect(state.duel.fighters[0]!.action.kind).toBe('Throw');
    expect(state.duel.fighters[0]!.daggers).toBe(tuning.dagger.count - 1);
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
  });

  it('carries a Sheathe, and then a Sheathed Fighter, through a resync', () => {
    let m = createMatch(tuning, { bestOf: 3, distance: 1.3, seed: 3 });
    for (let t = 0; t < 10; t++) m = stepMatch(m, [{ ...IDLE_INTENT, sheathe: t === 0 }, IDLE_INTENT], tuning);
    const sheathing = JSON.parse(JSON.stringify(m)) as MatchState;
    expect(sheathing.duel.fighters[0]!.action.kind).toBe('Sheathe');
    expect(parseNetMessage(resync(sheathing))).toEqual(resync(sheathing));
    for (let t = 0; t < 120; t++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    const sheathed = JSON.parse(JSON.stringify(m)) as MatchState;
    expect(sheathed.duel.fighters[0]!.sheathed).toBe(true);
    expect(parseNetMessage(resync(sheathed))).toEqual(resync(sheathed));
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

  it("carries a blade Hit's Stagger and the side it came from through a resync, and refuses a malformed one", () => {
    const state = matchState();
    const staggered = (action: unknown) => ({ ...state, duel: { ...state.duel, fighters: [{ ...state.duel.fighters[0]!, action }, ...state.duel.fighters.slice(1)] } });
    for (const good of [
      { kind: 'Stagger', cause: 'Hit', from: 'Left' },
      { kind: 'Stagger', cause: 'Hit', from: 'Thrust' },
      { kind: 'Stagger', cause: 'Hit' },
      { kind: 'Stagger', cause: 'Blocked' },
    ]) expect(parseNetMessage(resync(staggered(good)))).toEqual(resync(staggered(good)));
    for (const bad of [
      { kind: 'Stagger', cause: 'Hit', from: 'Sideways' },
      { kind: 'Stagger', cause: 'Hit', from: null },
      { kind: 'Stagger', cause: 'Blocked', from: 'Left' },
    ]) expect(parseNetMessage(resync(staggered(bad)))).toBeNull();
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

  it("carries a Death's cut through a resync, and refuses a malformed one", () => {
    // A real cutting Death (a killing Overhead), on Fighter 1 of a real Match state.
    const felled = runDuel(withWeapon(tuning, { damage: 10_000 }), { distance: 1.3, a: attack('Overhead'), b: [] }).final.fighters[1]!;
    const m = matchState();
    const state = JSON.parse(JSON.stringify({ ...m, duel: { ...m.duel, fighters: [m.duel.fighters[0], { ...m.duel.fighters[1]!, hp: 0, death: felled.death }] } })) as MatchState;
    const death = state.duel.fighters[1]!.death!;
    expect(death.blow!.cut).toBeDefined();
    expect(parseNetMessage(resync(state))).toEqual(resync(state));
    const cut = death.blow!.cut!;
    const withCut = (c: unknown) => ({ ...state, duel: { ...state.duel, fighters: [state.duel.fighters[0], { ...state.duel.fighters[1]!, death: { ...death, blow: { ...death.blow, cut: c } } }] } });
    for (const bad of [
      null,
      {},
      { ...cut, hilt: undefined },
      { ...cut, tip: { x: 0, y: 'up', z: 0 } },
      { ...cut, tip: cut.hilt },
      { ...cut, travel: { x: 0, y: 0, z: 0 } },
      { ...cut, travel: { x: 2, y: 0, z: 0 } },
    ]) expect(parseNetMessage(resync(withCut(bad)))).toBeNull();
    const thrust = { ...state, duel: { ...state.duel, fighters: [state.duel.fighters[0], { ...state.duel.fighters[1]!, death: { ...death, blow: { ...death.blow, direction: 'Thrust' } } }] } };
    expect(parseNetMessage(resync(thrust))).toBeNull();
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
      { ...good, arena: undefined },
      { ...good, arena: '' },
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
      withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false, charge: -1 } }),
      withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false, charge: 2.5 } }),
      withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false, charge: '90' } }),
      withFighter({ ...fighter, action: { kind: 'Stagger', cause: 'Tired' } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Twirl', landed: false } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Release' } }),
      withFighter({ ...fighter, action: { kind: 'Kick', phase: 'Recovery', landed: false, whiff: -1 } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Twirl', startTick: 3 } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Release' } }),
      withFighter({ ...fighter, action: { kind: 'Throw', phase: 'Release', startTick: -1 } }),
      withFighter({ ...fighter, daggers: undefined }),
      withFighter({ ...fighter, sheathed: undefined }),
      withFighter({ ...fighter, sheathed: 'yes' }),
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
    // A spinning Flail's Attack carries its Spin-up charge, a whole number of Ticks.
    const spinning = withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Left', phase: 'Wind-up', landed: false, charge: 40 } });
    expect(parseNetMessage(resync(spinning))).toEqual(resync(spinning));
    expect(parseNetMessage({ ...resync(good), streams: [{ player: 0, from: 1, intents: [{}] }] })).toBeNull();
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

describe('Peer message validation: AI Styles and the Stage 1 AI memory (docs/plans/ai-behaviour.md)', () => {
  const withStyle = (style: unknown) => ({
    type: 'hello',
    protocol: 1,
    tuningHash: 'abcd1234',
    match: { bestOf: 3, seed: 4 },
    lineup: [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Expert', style }, weapon: 'Halberd' },
    ],
    weapons: ['Halberd'],
    player: 0,
  });

  it("a hello's Lineup carries each AI's Style, a string (Tuning Data judges it)", () => {
    for (const style of ['Counter', 'random']) expect(parseNetMessage(withStyle(style))).toEqual(withStyle(style));
    for (const style of [3, null, { name: 'Counter' }]) expect(parseNetMessage(withStyle(style)), JSON.stringify(style)).toBeNull();
  });

  /** An Expert's memory after it broke a held Wind-up (its plans carry the new rolls), as the host would send it. */
  function expertMemory(): Record<string, unknown> {
    const ai = createAiController(tuning, { ...aiDifficulty(tuning, 'Expert'), holdBreak: 1, whiffCheck: 1, punishFits: 1, lowSwingRead: 1 }, 'Defensive');
    let m = createMatch(tuning, { bestOf: 1, seed: 3, distance: 1.3 });
    for (let t = 0; t < 120; t++) m = stepMatch(m, [{ ...IDLE_INTENT, attack: t >= 10, direction: 'Overhead' }, ai.intent(m.duel, 1)], tuning);
    return JSON.parse(JSON.stringify(ai.save!()));
  }

  it('accepts a real Expert memory with its hold-break roll, and refuses malformed new fields', () => {
    const good = expertMemory();
    expect((good.defencePlan as { holdBreak?: unknown }).holdBreak).toEqual({ go: true, at: expect.any(Number) });
    expect(parseNetMessage(resync(matchState(), [null, good]))).toEqual(resync(matchState(), [null, good]));
    const plan = good.defencePlan as Record<string, unknown>;
    const seen = good.seen as { tick: number; fighters: Record<string, unknown>[] }[];
    for (const bad of [
      { ...good, defencePlan: { ...plan, holdBreak: { go: 'yes', at: 3 } } },
      { ...good, defencePlan: { ...plan, reads: 1 } },
      { ...good, seen: seen.map((o) => ({ ...o, fighters: o.fighters.map((f) => ({ ...f, pitch: 'down' })) })) },
    ]) {
      expect(parseNetMessage(resync(matchState(), [null, bad]))).toBeNull();
    }
  });

  it("accepts a real team-playing Expert's memory (AI Stage 2) and refuses malformed team rolls", () => {
    const ai = createAiController(tuning, { ...aiDifficulty(tuning, 'Expert'), teamwork: 1 });
    const ally = createAiController(tuning, { ...aiDifficulty(tuning, 'Expert'), teamwork: 1 });
    let m = createMatch(tuning, { bestOf: 1, seed: 3, teams: [1, 0, 0] });
    for (let t = 0; t < 150; t++) m = stepMatch(m, [IDLE_INTENT, ai.intent(m.duel, 1), ally.intent(m.duel, 2)], tuning);
    const good = JSON.parse(JSON.stringify(ai.save!())) as Record<string, unknown>;
    expect((good.strafe as { flank: unknown }).flank).toBe(true);
    expect(parseNetMessage(resync(matchState(), [null, good]))).toEqual(resync(matchState(), [null, good]));
    const { lineHold: _lineHold, ...noLineHold } = good;
    for (const bad of [
      { ...good, strafe: { ...(good.strafe as object), flank: 'yes' } },
      { ...good, focus: { ...(good.focus as object), spread: 1 } },
      { ...good, turn: 'maybe' },
      noLineHold,
    ]) {
      expect(parseNetMessage(resync(matchState(), [null, bad]))).toBeNull();
    }
  });
});

describe('Peer message validation: the Stage 3 AI memory (docs/plans/ai-behaviour.md)', () => {
  /** An Expert with every feel knob on, against an attacker, as the host would send its memory: a beat, a late notice, its strafe's idle life. */
  function feelMemory(): Record<string, unknown> {
    const ai = createAiController(tuning, { ...aiDifficulty(tuning, 'Expert'), rhythm: 1, reactionJitter: 1, humanMistakes: 1, idleLife: 1, jumpStep: 1 });
    let m = createMatch(tuning, { bestOf: 1, seed: 3, distance: 1.8 });
    for (let t = 0; t < 900; t++) {
      m = stepMatch(m, [{ ...IDLE_INTENT, attack: t % 60 >= 40, direction: 'Left' }, ai.intent(m.duel, 1)], tuning);
      const memory = ai.save!() as { beat: { timed: boolean } | null; jitter: unknown };
      if (t > 100 && memory.beat?.timed && memory.jitter) break;
    }
    return JSON.parse(JSON.stringify(ai.save!()));
  }

  it('accepts a real feel memory (a beat, a jitter, idle life, a shaken Tick) and refuses malformed new fields', () => {
    const good = feelMemory();
    expect(good.beat).toEqual(expect.objectContaining({ timed: true }));
    expect(good.jitter).toEqual(expect.objectContaining({ from: expect.any(Number) }));
    expect(parseNetMessage(resync(matchState(), [null, good]))).toEqual(resync(matchState(), [null, good]));
    const { shaken: _shaken, ...noShaken } = good;
    const strafe = good.strafe as Record<string, unknown>;
    const { spacing: _spacing, ...noSpacing } = strafe;
    for (const bad of [
      { ...good, beat: { ...(good.beat as object), need: 'soon' } },
      { ...good, beat: { timed: true } },
      { ...good, jitter: { ...(good.jitter as object), from: -1 } },
      { ...good, jitter: { from: 3, until: 'later', at: 2 } },
      { ...good, strafe: { ...strafe, hop: 'yes' } },
      { ...good, strafe: { ...strafe, still: 0 } },
      { ...good, strafe: noSpacing },
      { ...good, attackPlan: { direction: 'Left', holdUntil: -1, reFeintRolled: false, chainRolled: false, chain: null, chainHeld: false, whiff: false, team: false, double: 'twice' } },
      { ...good, defencePlan: { attacker: 0, attackStart: 3, kind: 'Block', direction: 'Right', pressAt: -1, raiseAt: 'late' } },
      noShaken,
    ]) {
      expect(parseNetMessage(resync(matchState(), [null, bad])), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
  });
});

describe('Peer message validation: the Flail AI memory (docs/plans/flail.md, Stage 4)', () => {
  /** Fighter 0 (`weapons[0]`) holds an Overhead Wind-up from Tick 10 and Fighter 1, an Expert AI (`weapons[1]`), watches it from 1.9 m. */
  function memoryFacing(weapons: [string, string], until: (memory: Record<string, any>) => boolean): Record<string, unknown> {
    const ai = createAiController(tuning, 'Expert');
    let m = createMatch(tuning, { bestOf: 1, seed: 1, distance: 1.9, weapons });
    for (let t = 0; t < 400; t++) {
      m = stepMatch(m, [{ ...IDLE_INTENT, attack: t >= 10, direction: 'Overhead' }, ai.intent(m.duel, 1)], tuning);
      if (until(ai.save!() as Record<string, any>)) break;
    }
    return JSON.parse(JSON.stringify(ai.save!()));
  }

  it("accepts an AI's memory as it steps back from a spin it reads (a Back plan), and refuses a Defence kind it does not know", () => {
    const good = memoryFacing(['Flail', 'Arming Sword'], (mem) => mem.defencePlan?.kind === 'Back');
    expect(good.defencePlan).toEqual(expect.objectContaining({ kind: 'Back', spinRead: true }));
    expect(parseNetMessage(resync(matchState(), [null, good]))).toEqual(resync(matchState(), [null, good]));
    const plan = good.defencePlan as Record<string, unknown>;
    for (const bad of [{ ...good, defencePlan: { ...plan, kind: 'Flee' } }, { ...good, defencePlan: { ...plan, spinRead: 'yes' } }]) {
      expect(parseNetMessage(resync(matchState(), [null, bad])), JSON.stringify(bad.defencePlan)).toBeNull();
    }
  });

  it("accepts a spinning Flail AI's memory (its aim and deadline), and refuses malformed ones", () => {
    const ai = createAiController(tuning, 'Expert');
    let m = createMatch(tuning, { bestOf: 1, seed: 1, distance: 2.8, weapons: ['Arming Sword', 'Flail'] });
    for (let t = 0; t < 200 && (ai.save!() as { attackPlan: { spin?: number } | null }).attackPlan?.spin === undefined; t++) m = stepMatch(m, [IDLE_INTENT, ai.intent(m.duel, 1)], tuning);
    const good = JSON.parse(JSON.stringify(ai.save!())) as Record<string, unknown>;
    const plan = good.attackPlan as Record<string, unknown>;
    expect(plan).toEqual(expect.objectContaining({ spin: expect.any(Number), spinUntil: expect.any(Number) }));
    expect(parseNetMessage(resync(matchState(), [null, good]))).toEqual(resync(matchState(), [null, good]));
    const { spin: _spin, ...noSpin } = plan;
    for (const bad of [{ ...plan, spin: 'full' }, { ...plan, spin: 1.5 }, { ...plan, spin: 0 }, { ...plan, spin: -5 }, { ...plan, spinUntil: null }, noSpin]) {
      expect(parseNetMessage(resync(matchState(), [null, { ...good, attackPlan: bad }])), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('Peer message validation: the AI memory load() reads (docs/plans/flail.md, Stage 6)', () => {
  type Memory = Record<string, any>;
  /**
   * The memory of `ai` (Fighter `slot` of `initial`, the other Fighters played by `others`) on the first Tick `until` holds,
   * as JSON (as a resync carries it). `drive` stands in for the AI's own Intent (its memory is still the AI's).
   */
  function memoryWhen(t: TuningData, initial: SimState, ai: Controller, others: Controller[], slot: number, until: (m: Memory) => boolean, ticks = 600, drive?: (i: Intent) => Intent): Memory {
    const self: Controller = { intent: (s, i) => (drive ?? ((x: Intent) => x))(ai.intent(s, i)) };
    const controllers = [...others];
    controllers.splice(slot, 0, self);
    let s = initial;
    for (let k = 0; k < ticks; k++) {
      s = runControllers(t, s, controllers, 1).final;
      const m = ai.save!() as Memory;
      if (until(m)) return JSON.parse(JSON.stringify(m)) as Memory;
    }
    throw new Error('the memory never held what was looked for');
  }
  const accepted = (m: Memory) => parseNetMessage(resync(matchState(), [null, m]));
  const refuses = (bads: Memory[]) => {
    for (const bad of bads) expect(accepted(bad), JSON.stringify(bad).slice(0, 160)).toBeNull();
  };
  const sharp = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };
  const omit = (o: Memory, key: string): Memory => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

  it("a leaping Attack's holdJumpUntil", () => {
    const eager: TuningData = { ...tuning, fighter: { ...tuning.fighter, maxHp: 1e9 }, ai: { ...tuning.ai, kickRate: 0 } };
    const ai = createAiController(eager, { ...sharp, footwork: 0.5, aggression: 0, jumpAttackRate: 0.05 });
    const good = memoryWhen(eager, createInitialState(eager, 3, duelPlacements(3.5)), ai, [scriptedController(wait(1))], 1, (m) => (m.attackPlan?.holdJumpUntil ?? -1) >= 0);
    expect(accepted(good)).not.toBeNull();
    const plan = good.attackPlan as Memory;
    refuses([{ ...good, attackPlan: { ...plan, holdJumpUntil: '9' } }, { ...good, attackPlan: { ...plan, holdJumpUntil: 1.5 } }, { ...good, attackPlan: omit(plan, 'holdJumpUntil') }]);
  });

  it("a throw it means to meet (throwPlan)", () => {
    const catcher: TuningData = { ...tuning, ai: { ...tuning.ai, aggression: 0, kickRate: 0, throwRate: 0 } };
    const initial = createInitialState(catcher, 1, [{ position: { x: -0.2, z: 0 }, facing: 0 }, { position: { x: 0, z: 8 }, facing: Math.PI }]);
    const good = memoryWhen(catcher, initial, createAiController(catcher, sharp), [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)])], 1, (m) => m.throwPlan !== null, 200);
    expect(accepted(good)).not.toBeNull();
    const plan = good.throwPlan as Memory;
    refuses([
      { ...good, throwPlan: { ...plan, thrower: -1 } },
      { ...good, throwPlan: { ...plan, startTick: 'now' } },
      { ...good, throwPlan: omit(plan, 'react') },
      { ...good, throwPlan: 'yes' },
    ]);
  });

  it("its own throw's aimError", () => {
    const thrower: TuningData = { ...tuning, ai: { ...tuning.ai, aggression: 0, kickRate: 0, throwRate: 0.5 } };
    const initial = createInitialState(thrower, 7, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 5 }, facing: Math.PI }]);
    const ai = createAiController(thrower, { ...sharp, mistakeRate: 0.3, throwRate: 0.5 });
    const good = memoryWhen(thrower, initial, ai, [scriptedController(walk(400, { x: 0, z: 1 }))], 0, (m) => m.aimError !== 0, 240);
    expect(accepted(good)).not.toBeNull();
    refuses([{ ...good, aimError: null }, { ...good, aimError: '0.1' }, omit(good, 'aimError')]);
  });

  /** A Normal AI on the summit plateau chasing an enemy up on the containers (it takes a jump Link). */
  const summit = () => createInitialState(tuning, 1, [[0, 2, -8], [3, 2.5, -4.1]].map(([x, y, z]) => ({ position: { x: x!, z: z! }, y: y!, facing: 0 })), [], [0, 1], 'summit');

  it('a jump Link it is carrying out (jumpRun)', () => {
    const good = memoryWhen(tuning, summit(), createAiController(tuning, 'Normal'), [scriptedController(wait(1))], 0, (m) => m.jumpRun !== null, 600);
    expect(accepted(good)).not.toBeNull();
    const run = good.jumpRun as Memory;
    refuses([
      { ...good, jumpRun: { ...run, stage: 'Swim' } },
      { ...good, jumpRun: { ...run, link: -1 } },
      { ...good, jumpRun: { ...run, deadline: 1.5 } },
      { ...good, jumpRun: { ...run, flew: 'never' } },
      { ...good, jumpRun: omit(run, 'escape') },
    ]);
  });

  it('a jump Link it gave up on (failedJumps)', () => {
    // Held where it stands, it never gets airborne and gives the Link up at its deadline.
    const good = memoryWhen(tuning, summit(), createAiController(tuning, 'Normal'), [scriptedController(wait(1))], 0, (m) => m.failedJumps.length > 0, 1200, () => IDLE_INTENT);
    expect(accepted(good)).not.toBeNull();
    const [gave] = good.failedJumps as Memory[];
    refuses([
      { ...good, failedJumps: null },
      { ...good, failedJumps: gave },
      { ...good, failedJumps: [{ ...gave, at: 'then' }] },
      { ...good, failedJumps: [{ ...gave, link: 1.5 }] },
      omit(good, 'failedJumps'),
    ]);
  });

  it("an enemy's Landing it rolled to meet (landing), and what it saw of it in the air", () => {
    const tough: TuningData = { ...tuning, fighter: { ...tuning.fighter, maxHp: 1e9 }, ai: { ...tuning.ai, kickRate: 0, throwRate: 0 } };
    const toward = { x: 0, z: -1 };
    const jumper = scriptedController([...wait(40), { ticks: 1, intent: { ...IDLE_INTENT, move: toward, jump: true } }, { ticks: 30, intent: { ...IDLE_INTENT, move: toward } }, ...wait(60)]);
    const initial = createInitialState(tough, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 4 }, facing: Math.PI }]);
    const ai = createAiController(tough, { ...aiDifficulty(tuning, 'Hard'), throwRate: 0, kickRate: 0 });
    const good = memoryWhen(tough, initial, ai, [jumper], 0, (m) => m.landing !== null, 130);
    expect(accepted(good)).not.toBeNull();
    const landing = good.landing as Memory;
    refuses([
      { ...good, landing: { ...landing, fighter: -1 } },
      { ...good, landing: { ...landing, airStart: 'up' } },
      { ...good, landing: omit(landing, 'go') },
      omit(good, 'landing'),
    ]);
    // The Sightings it keeps: the airborne one's airStart, and every Sighting's rise, facing and sheathed.
    const seen = good.seen as Memory[];
    const at = seen.findIndex((o) => o.fighters[1].airStart !== null);
    expect(at).toBeGreaterThanOrEqual(0);
    const withSighting = (change: (f: Memory) => Memory): Memory => ({
      ...good,
      seen: seen.map((o, k) => (k === at ? { ...o, fighters: o.fighters.map((f: Memory, i: number) => (i === 1 ? change(f) : f)) } : o)),
    });
    refuses([
      withSighting((f) => ({ ...f, airStart: 'up' })),
      withSighting((f) => omit(f, 'airStart')),
      withSighting((f) => ({ ...f, rise: null })),
      withSighting((f) => ({ ...f, facing: 'north' })),
      withSighting((f) => omit(f, 'sheathed')),
      withSighting((f) => ({ ...f, size: 'huge' })),
    ]);
  });
});

describe('Peer message validation: a Gauntlet Run (docs/plans/delver.md)', () => {
  const RUN = 'gen:greybox:4242';
  const lineup: Lineup = [
    { team: 0, pilot: { kind: 'Player', player: 0 } },
    { team: 0, pilot: { kind: 'Player', player: 1 } },
    ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
  ];
  const hello = (match: unknown) => ({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match, lineup, weapons: ['Halberd', 'Halberd'], player: 1 });

  /** A real Run 40 Ticks in, with its Pool AIs' memory, as the host would send it in a resync. */
  function runResync(): { state: MatchState; ai: unknown[] } {
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], { bestOf: 1, arena: RUN, seed: 3, format: 'Gauntlet' }));
    for (let t = 0; t < 40; t++) m = stepMatch(m, m.duel.fighters.map((_, i) => ais[i]?.intent(m.duel, i) ?? IDLE_INTENT), tuning);
    return JSON.parse(JSON.stringify({ state: m, ai: ais.map((a) => a?.save?.() ?? null) })) as { state: MatchState; ai: unknown[] };
  }

  it("accepts a Run's start message: the Format and its humans in the Match options", () => {
    for (const match of [
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 2 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 4 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet' },
      // An all-AI party with traitors (docs/plans/delver.md, Stage 8a).
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 0 },
      { bestOf: 3, arena: 'library', format: 'Duels' },
      { bestOf: 3, arena: 'library' },
    ]) {
      expect(parseNetMessage(hello(match)), JSON.stringify(match)).toEqual(hello(match));
    }
  });

  it('refuses a Format it does not know, a Gauntlet on a hand-made Map, and humans a Run cannot field', () => {
    for (const match of [
      { bestOf: 1, arena: RUN, format: 'Survival' },
      { bestOf: 1, arena: RUN, format: 7 },
      { bestOf: 1, arena: RUN, format: null },
      { bestOf: 1, arena: 'library', format: 'Gauntlet' },
      { bestOf: 1, format: 'Gauntlet' },
      { bestOf: 1, arena: 'gen:greybox:x', format: 'Gauntlet' },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 5 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 1.5 },
    ]) {
      expect(parseNetMessage(hello(match)), JSON.stringify(match)).toBeNull();
    }
  });

  it("carries a Run through a resync: its progress, its Floor and the Pool AIs' memory", () => {
    const { state, ai } = runResync();
    expect(state.delver).toMatchObject({ floor: 1, phase: 'Exploring' });
    expect(state.config.players).toEqual([0, 1]);
    expect(parseNetMessage(resync(state, ai))).toEqual(resync(state, ai));
    // A Duels state carries no Run.
    const duels = matchState();
    expect(parseNetMessage(resync({ ...duels, delver: state.delver }))).toBeNull();
    expect(parseNetMessage(resync({ ...duels, duel: { ...duels.duel, delver: state.duel.delver } }))).toBeNull();
    // No retired Hall, nor the retired `delver` flag: a stray key would be hashed, a lasting desync.
    const hall = { floor: 1, row: 0, index: 0, kind: 'Fight', phase: 'Fighting' };
    expect(parseNetMessage(resync({ ...state, duel: { ...state.duel, hall } } as never, ai))).toBeNull();
    expect(parseNetMessage(resync({ ...state, config: { ...state.config, delver: true } } as never, ai))).toBeNull();
  });

  it('accepts a Fighter with Mods, and one without', () => {
    const state = matchState();
    const armed = { ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 0 ? { ...f, mods: { ...NO_MODS, damage: 1.1, daggers: 1 } } : f)) } };
    expect(parseNetMessage(resync(armed))).not.toBeNull();
    expect(parseNetMessage(resync(state))).not.toBeNull();
  });

  it('accepts a Fighter with an inventory, and refuses a malformed one', () => {
    const { state, ai } = runResync();
    const inventory = { weapons: ['Halberd', 'Longsword'], relics: ['Whetstone', 'Iron Plate', 'Vital Charm'], weapon: 1, equipped: [0, 2] };
    const stocked = { ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 0 ? { ...f, inventory } : f)) } };
    expect(parseNetMessage(resync(stocked, ai))).toEqual(resync(stocked, ai));
  });

  it('accepts an Intent that equips, drops, uses a Consumable or chooses a Troop, refuses malformed ones, and the protocol is 34', () => {
    expect(PROTOCOL_VERSION).toBe(35);
    for (const extra of [{ equip: { kind: 'weapon', slot: 2 } }, { drop: { kind: 'relic', slot: 0 } }, { equip: { kind: 'relic', slot: 5 }, drop: { kind: 'weapon', slot: 1 } }, { troop: 2 }, { troop: -1 }, { use: { kind: 'relic', slot: 3 } }]) {
      const m = intents([{ ...IDLE_INTENT, ...extra }]);
      expect(parseNetMessage(m), JSON.stringify(extra)).toEqual(m);
    }
    for (const bad of [
      { equip: 'sword' },
      { equip: null },
      { equip: { kind: 'sword', slot: 0 } },
      { equip: { kind: 'weapon' } },
      { equip: { kind: 'weapon', slot: -1 } },
      { equip: { kind: 'weapon', slot: 1.5 } },
      { equip: { kind: 'weapon', slot: 'a' } },
      { equip: { kind: 'weapon', slot: 99 } },
      { use: { kind: 'potion', slot: 0 } },
      { equip: { kind: 'weapon', slot: Number.NaN } },
      { drop: true },
      { drop: { kind: 'relic', slot: null } },
      { drop: [] },
      { troop: 1.5 },
      { troop: 'Brute' },
      { troop: null },
    ]) {
      expect(parseNetMessage(intents([{ ...IDLE_INTENT, ...bad }])), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts a Duels state with the new fields absent, as before', () => {
    const duels = matchState() as unknown as Record<string, unknown> & MatchState;
    const { run: _run, ...noRun } = duels;
    const { format: _format, humans: _humans, ...config } = duels.config;
    const fighters = duels.duel.fighters.map(({ maxHp: _maxHp, ...f }) => f);
    const old = { ...noRun, config, duel: { ...duels.duel, fighters } };
    expect(parseNetMessage(resync(old))).toEqual(resync(old));
  });
});

describe("Peer message validation: a Run's Players, Inventories, pickups and Mods in a resync", () => {
  const RUN = 'gen:greybox:4242';
  /** A real Run 10 Ticks in: Fighters 0 and 2 human, 1 an AI ally, as a host sends it (with its AIs' memory). */
  function ally(): { state: MatchState; ai: unknown[] } {
    const lineup: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 0, pilot: { kind: 'AI', difficulty: 'Expert' }, weapon: 'Halberd' },
      { team: 0, pilot: { kind: 'Player', player: 1 } },
      ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
    ];
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], { bestOf: 1, arena: RUN, seed: 3, format: 'Gauntlet' }));
    for (let t = 0; t < 10; t++) m = stepMatch(m, m.duel.fighters.map((_, i) => ais[i]?.intent(m.duel, i) ?? IDLE_INTENT), tuning);
    return JSON.parse(JSON.stringify({ state: m, ai: ais.map((a) => a?.save?.() ?? null) })) as { state: MatchState; ai: unknown[] };
  }
  const { state, ai } = ally();
  const ok = (s: unknown, why: string) => expect(parseNetMessage(resync(s, ai)), why).not.toBeNull();
  const refused = (s: unknown, why: string) => expect(parseNetMessage(resync(s, ai)), why).toBeNull();
  const withFighters = (s: MatchState, edit: (f: any, i: number) => any) => ({ ...s, duel: { ...s.duel, fighters: s.duel.fighters.map(edit) } });
  /** `s` with these pickups lying, on the Run and its Duel's mirror alike. */
  const withPickups = (s: MatchState, pickups: unknown[]) => ({ ...s, delver: { ...s.delver, pickups }, duel: { ...s.duel, delver: { ...s.duel.delver, pickups } } });
  const at = { x: 0, y: 0, z: 0 };
  const pickup = (id: number, more: object) => ({ id, kind: 'relic', item: 'Whetstone', at, taken: false, owner: null, ...more });

  it('accepts the Run as it is', () => {
    expect(state.config.players).toEqual([0, 2]);
    ok(state, 'the Run');
  });

  it('refuses a pickup whose owner or dropper is not a Player Fighter of the Run, and a pedestal group that is not its own first', () => {
    ok(withPickups(state, [pickup(0, { owner: 2 }), pickup(1, { by: 0 })]), 'owned by Player 2, dropped by Player 0');
    refused(withPickups(state, [pickup(0, { owner: 1 })]), 'owned by an AI ally');
    refused(withPickups(state, [pickup(0, { by: 1 })]), 'dropped by an AI ally');
    refused(withPickups(state, [pickup(0, { owner: 2, by: 0 })]), 'a dropper on an owned pickup');
    ok(withPickups(state, [pickup(0, { owner: 0, group: 0 }), pickup(1, { owner: 0, group: 0 })]), 'a pedestal group');
    refused(withPickups(state, [pickup(0, { owner: 0, group: 0 }), pickup(1, { owner: 2, group: 0 })]), "another owner's group");
    refused(withPickups(state, [pickup(0, { owner: 0, group: 1 }), pickup(1, { owner: 0, group: 1 })]), 'a group whose first comes later');
    refused(withPickups(state, [pickup(0, { group: 0 })]), 'a shared pedestal');
  });

  it('refuses an inventory on a Fighter that is not a Player of the Run, and in Duels', () => {
    const inventory = state.duel.fighters[0]!.inventory!;
    expect(inventory).toBeDefined();
    refused(withFighters(state, (f, k) => (k === 1 ? { ...f, inventory } : f)), 'an AI ally');
    refused(withFighters(state, (f, k) => (k === 4 ? { ...f, inventory } : f)), 'a Pool slot');
    expect(parseNetMessage(resync(withFighters(matchState(), (f, k) => (k === 0 ? { ...f, inventory } : f)))), 'a Duels Fighter').toBeNull();
  });

  it('refuses a Run whose players are not Team 0 Fighters', () => {
    refused({ ...state, config: { ...state.config, players: [0, 5] } }, 'a Pool slot as a Player');
    refused({ ...state, config: { ...state.config, players: [0, 9] } }, 'a Player past the Fighters');
  });

  it('refuses a Mods number that is not finite', () => {
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) refused(withFighters(state, (f, i) => (i === 0 ? { ...f, mods: { ...NO_MODS, damage: bad } } : f)), String(bad));
  });

  it('accepts the last slot of an Intent equip or drop and refuses the one after: the Tuning Data cap (99) is the most a peer can hold', () => {
    const m = intents([{ ...IDLE_INTENT, equip: { kind: 'relic', slot: 98 }, drop: { kind: 'weapon', slot: 98 } }]);
    expect(parseNetMessage(m)).toEqual(m);
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, drop: { kind: 'weapon', slot: 99 } }]))).toBeNull();
  });
});
