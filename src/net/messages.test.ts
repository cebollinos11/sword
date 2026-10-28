import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, doorTicksNeeded, exitDoor, floorGraph, holdInventory, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, NO_MODS, restFire, runSeed, secondsToTicks, stepMatch, throwTimings, type HallRef, type Intent, type Inventory, type MatchState } from '../sim';
import { aiDifficulty, createAiController, FLOOR_DIFFICULTY, lineupAis, lineupMatch, type Lineup } from '../controllers';
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

describe('Peer message validation: a Gauntlet Run (docs/plans/gauntlet.md, Stage 4)', () => {
  const RUN = 'gen:greybox:4242';
  const lineup: Lineup = [
    { team: 0, pilot: { kind: 'Player', player: 0 } },
    { team: 0, pilot: { kind: 'Player', player: 1 } },
    ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
  ];
  const hello = (match: unknown) => ({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match, lineup, weapons: ['Halberd', 'Halberd'], player: 1 });

  /** A real Run 40 Ticks in, with its Hall AIs' memory, as the host would send it in a resync. */
  function runResync(): { state: MatchState; ai: unknown[] } {
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], { bestOf: 1, arena: RUN, seed: 3, format: 'Gauntlet' }));
    for (let t = 0; t < 40; t++) m = stepMatch(m, lineup.map((s, i) => (s.pilot.kind === 'AI' ? ais[i]!.intent(m.duel, i) : IDLE_INTENT)), tuning);
    return JSON.parse(JSON.stringify({ state: m, ai: ais.map((a) => a?.save?.() ?? null) })) as { state: MatchState; ai: unknown[] };
  }

  it("accepts a Run's start message: the Format and its humans in the Match options", () => {
    for (const match of [
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 2 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 4 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet' },
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
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 0 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 5 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 1.5 },
    ]) {
      expect(parseNetMessage(hello(match)), JSON.stringify(match)).toBeNull();
    }
  });

  it("carries a Run through a resync: its progress, the Hall, each Fighter's max HP and Benched slots, and the Hall AIs' memory", () => {
    const { state, ai } = runResync();
    expect(state.run).toMatchObject({ floor: 1, floors: tuning.dungeon.floors.length, row: 0, hall: 0 });
    expect(state.duel.hall).toMatchObject({ floor: 1, row: 0, index: 0 });
    expect(state.config.players).toEqual([0, 1]);
    expect(state.duel.fighters.some((f) => f.benched)).toBe(true);
    expect(ai.slice(2).every((m) => m !== null && typeof m === 'object' && 'hall' in m)).toBe(true);
    const m = resync(state, ai);
    expect(parseNetMessage(m)).toEqual(m);
  });

  it('carries a Run\'s pickups through a resync: owned, shared, a pedestal group and a dropper', () => {
    const { state, ai } = runResync();
    const at = { x: 1, y: 0, z: 2 };
    const pickups = [
      { id: 0, owner: 0, kind: 'relic', item: 'Whetstone', at, taken: false, group: 0 },
      { id: 1, owner: 0, kind: 'weapon', item: 'Halberd', at, taken: true, group: 0 },
      { id: 2, owner: null, kind: 'weapon', item: 'Halberd', at, taken: false, by: 0 },
    ];
    const m = resync({ ...state, run: { ...state.run, pickups } }, ai);
    expect(parseNetMessage(m)).toEqual(m);
  });

  it('refuses a malformed Run, Hall, max HP, Benched flag or Hall AI memory', () => {
    const { state, ai } = runResync();
    const pickup = { id: 0, owner: 0, kind: 'relic', item: 'Whetstone', at: { x: 1, y: 0, z: 2 }, taken: false };
    const fighters = (patch: object) => ({ ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 4 ? { ...f, ...patch } : f)) } });
    const broken: unknown[] = [
      { ...state, run: null },
      { ...state, run: { ...state.run, floor: 0 } },
      { ...state, run: { ...state.run, floor: state.run!.floors + 1 } },
      { ...state, run: { ...state.run, row: 5 } },
      { ...state, run: { ...state.run, hall: -1 } },
      { ...state, run: { ...state.run, path: [] } },
      { ...state, run: { ...state.run, path: [{ floor: 1, row: 1, index: 0 }] } },
      { ...state, run: { ...state.run, phase: 'Resting' } },
      { ...state, run: { ...state.run, doorTicks: [-1] } },
      { ...state, run: { ...state.run, doorTicks: [0, 0, 0, 0] } },
      { ...state, run: { ...state.run, rested: ['me'] } },
      { ...state, run: { ...state.run, startTick: 'then' } },
      { ...state, run: { ...state.run, pickups: 'loot' } },
      { ...state, run: { ...state.run, pickups: undefined } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, id: 1 }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, owner: 9 }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, owner: undefined }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, kind: 'gold' }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, item: 7 }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, at: { x: 0, y: 0 } }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, taken: 'no' }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, group: 2 }] } },
      { ...state, run: { ...state.run, pickups: [{ ...pickup, by: -1 }] } },
      { ...state, run: { ...state.run, pickups: Array.from({ length: 300 }, (_, id) => ({ ...pickup, id })) } },
      { ...state, duel: { ...state.duel, hall: { ...state.duel.hall, row: 1 } } },
      { ...state, duel: { ...state.duel, hall: { ...state.duel.hall, phase: 'Cleared' } } },
      { ...state, duel: { ...state.duel, hall: { ...state.duel.hall, kind: 'Shop' } } },
      { ...state, duel: { ...state.duel, hall: undefined } },
      { ...state, config: { ...state.config, players: [1, 0] } },
      { ...state, config: { ...state.config, format: 'Survival' } },
      { ...state, config: { ...state.config, arena: 'library' } },
      { ...state, config: { ...state.config, humans: 5 } },
      { ...state, config: { ...state.config, rematchTicks: 300 } },
      fighters({ maxHp: 0 }),
      fighters({ maxHp: 'lots' }),
      fighters({ benched: false }),
      fighters({ mods: { damage: 1.1 } }),
      fighters({ mods: { ...NO_MODS, damage: Number.NaN } }),
      fighters({ mods: { ...NO_MODS, maxHp: -1 } }),
      fighters({ mods: 1.1 }),
      fighters({ inventory: 1 }),
      fighters({ inventory: { weapons: [], relics: [], weapon: 0, equipped: [] } }),
      fighters({ inventory: { weapons: ['Halberd'], relics: [], weapon: 1, equipped: [] } }),
      fighters({ inventory: { weapons: ['Halberd'], relics: ['Whetstone'], weapon: 0, equipped: [1] } }),
      fighters({ inventory: { weapons: ['Halberd'], relics: ['Whetstone', 'Iron Plate'], weapon: 0, equipped: [1, 0] } }),
      fighters({ inventory: { weapons: ['Halberd'], relics: ['Whetstone'], weapon: 0, equipped: [0, 0] } }),
      fighters({ inventory: { weapons: ['Halberd', 7], relics: [], weapon: 0, equipped: [] } }),
      fighters({ inventory: { weapons: ['Halberd'], relics: [], equipped: [] } }),
    ];
    for (const bad of broken) expect(parseNetMessage(resync(bad, ai)), JSON.stringify(bad).slice(0, 100)).toBeNull();
    for (const bad of [{ hall: 1, memory: null }, { hall: '0:0:0', memory: null }, { hall: '1:0:0', memory: { lastTick: 'x' } }, { hall: '1:0:0' }]) {
      expect(parseNetMessage(resync(state, [null, null, bad, ai[3], ai[4]])), JSON.stringify(bad)).toBeNull();
    }
    // A Duels state carries no Run.
    const duels = matchState();
    expect(parseNetMessage(resync({ ...duels, run: state.run }))).toBeNull();
    expect(parseNetMessage(resync({ ...duels, duel: { ...duels.duel, hall: state.duel.hall } }))).toBeNull();
  });

  it('accepts a Fighter with Mods, and one without', () => {
    const state = matchState();
    const armed = { ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 0 ? { ...f, mods: { ...NO_MODS, damage: 1.1, daggers: 1 } } : f)) } };
    expect(parseNetMessage(resync(armed))).not.toBeNull();
    expect(parseNetMessage(resync(state))).not.toBeNull();
  });

  it('accepts a Fighter with an inventory, and refuses a malformed one', () => {
    const { state } = runResync();
    const inventory = { weapons: ['Halberd', 'Longsword'], relics: ['Whetstone', 'Iron Plate', 'Vital Charm'], weapon: 1, equipped: [0, 2] };
    const stocked = { ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 0 ? { ...f, inventory } : f)) } };
    expect(parseNetMessage(resync(stocked))).toEqual(resync(stocked));
  });

  it('accepts an Intent that equips or drops, refuses malformed ones, and the protocol is 22', () => {
    expect(PROTOCOL_VERSION).toBe(22);
    for (const extra of [{ equip: { kind: 'weapon', slot: 2 } }, { drop: { kind: 'relic', slot: 0 } }, { equip: { kind: 'relic', slot: 5 }, drop: { kind: 'weapon', slot: 1 } }]) {
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
      { equip: { kind: 'weapon', slot: Number.NaN } },
      { drop: true },
      { drop: { kind: 'relic', slot: null } },
      { drop: [] },
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

describe('Peer message validation: resync of real Dungeon Run states (Stage 4 audit)', () => {
  const ARENA = 'gen:greybox:4242';
  const NEED = doorTicksNeeded(tuning);
  const FADE = secondsToTicks(tuning.dungeon.hallFadeSeconds);
  const [W0, W1] = Object.keys(tuning.weapons) as [string, string];

  /** A Run on ARENA: `own` Fighters on Team 0 (the `players` of them human), then the Team 1 slots. */
  const run = (options: object = {}, own = 2, players = [0, 1]): MatchState =>
    createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [...Array<number>(own).fill(0), ...Array<number>(MAX_TEAM_SIZE).fill(1)], humans: players.length, players, ...options });
  const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);
  /** One Tick, Fighter 0's Intent patched. */
  const tick = (m: MatchState, patch: Partial<Intent> = {}): MatchState => stepMatch(m, idle(m).map((i, k) => (k === 0 ? { ...i, ...patch } : i)), tuning);
  const placed = (m: MatchState, i: number, p: { x: number; y: number; z: number }): MatchState => ({
    ...m,
    duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: { x: p.x, z: p.z }, y: p.y } : f)) },
  });
  const withHp = (m: MatchState, hp: (f: MatchState['duel']['fighters'][number], i: number) => number): MatchState => ({
    ...m,
    duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (inDuel(f) ? { ...f, hp: hp(f, i) } : f)) },
  });
  /** Fell every enemy and step: the Hall is Cleared (a Treasure or Rest Hall is already). */
  const clear = (m: MatchState): MatchState => stepMatch(withHp(m, (f) => (f.team === 1 ? 0 : f.hp)), idle(m), tuning);
  /** Four spots inside exit `exit`'s zone (null: round the Rest fire). */
  function spots(m: MatchState, exit: number | null) {
    const arena = arenaOf(tuning, m.arena);
    if (exit === null) {
      const fire = restFire(arena);
      return [-0.6, 0.6].flatMap((dx) => [-0.6, 0.6].map((dz) => ({ x: fire.x + dx, y: fire.y, z: fire.z + dz })));
    }
    const zone = arena.doors[exitDoor(exit)]!.zone;
    const c = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    return [-0.6, 0.6].flatMap((dx) => [-0.6, 0.6].map((dz) => ({ x: c.x + dx, y: zone[0]!.y, z: c.z + dz })));
  }
  /** Hold `who` at exit `exit` for `ticks` Ticks, or until the next Hall starts; `seen` gets every 8th state. */
  function hold(m: MatchState, who: readonly number[], exit: number | null, ticks: number, seen?: (m: MatchState) => void): MatchState {
    const hall = m.duelNumber;
    for (let t = 0; t < ticks; t++) {
      who.forEach((i, n) => (m = placed(m, i, spots(m, exit)[n % 4]!)));
      m = stepMatch(m, idle(m), tuning);
      if (t % 8 === 0) seen?.(m);
      if (m.duelNumber !== hall) break;
    }
    return m;
  }
  /** The party leaves the Cleared Hall by exit 0. */
  const leave = (m: MatchState, seen?: (m: MatchState) => void): MatchState => hold(m, m.config.players!, 0, NEED + FADE + 5, seen);
  /** A Run starting in the first Hall of `kind` (Floors in order). */
  function startIn(kind: 'Treasure' | 'Elite' | 'Rest' | 'Boss', options: object = {}, own = 2, players = [0, 1]): MatchState {
    // An Elite is rare: try Run seeds until a Floor has one.
    for (let seed = 4242; seed < 4342; seed++) {
      const arena = `gen:greybox:${seed}`;
      for (let floor = 1; floor <= tuning.dungeon.floors.length; floor++) {
        const graph = floorGraph(tuning.dungeon, runSeed(arena), floor, 'greybox');
        for (const [row, halls] of graph.entries()) {
          const index = halls.findIndex((h) => h.kind === kind);
          if (index >= 0) return run({ ...options, arena, start: { floor, row, index } as HallRef }, own, players);
        }
      }
    }
    throw new Error(`no ${kind} Hall`);
  }
  const stocked = (m: MatchState, i: number, inv: Partial<Inventory>): MatchState => ({
    ...m,
    duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? holdInventory(f, { ...f.inventory!, ...inv }, tuning) : f)) },
  });

  /** Every state worth sending, labelled. */
  function states(): [string, MatchState][] {
    const out: [string, MatchState][] = [];
    const note = (label: string) => (m: MatchState) => void out.push([label, m]);

    // A Fight Hall: fighting, cleared with its drops, a drop taken by its owner.
    let m = run();
    note('fight, start')(m);
    m = clear(m);
    note('fight, cleared with drops')(m);
    expect(m.run!.pickups.length).toBeGreaterThan(0);
    m = tick(placed(m, 0, m.run!.pickups.find((p) => p.owner === 0)!.at));
    note('fight, a drop taken')(m);
    expect(m.run!.pickups.some((p) => p.taken)).toBe(true);

    // Equip and drop: a Relic equipped (its Mods), a Weapon swapped and a Relic dropped, a Weapon dropped: shared pickups with `by`.
    m = stocked(placed(m, 0, spots(m, 0)[0]!), 0, { weapons: [W0, W1], relics: ['Whetstone', 'Vital Charm', 'Iron Plate'], weapon: 0, equipped: [] });
    note('inventory, stocked')(m);
    m = tick(m, { equip: { kind: 'relic', slot: 1 } });
    note('relic equipped (Mods, max HP)')(m);
    m = tick(m, { equip: { kind: 'weapon', slot: 1 }, drop: { kind: 'relic', slot: 0 } });
    note('weapon swapped, relic dropped')(m);
    m = tick(m, { drop: { kind: 'weapon', slot: 0 } });
    note('weapon dropped')(m);
    expect(m.run!.pickups.filter((p) => p.owner === null && p.by === 0)).toHaveLength(2);

    // Leaving: the party at Door 0, through the fade, into the next Hall.
    m = leave(m, note('walking to the Door, leaving'));
    note('next Hall')(m);

    // A fallen Fighter, then revived in the next Hall.
    let f = tick(withHp(run(), (fighter, i) => (i === 1 ? 0 : fighter.hp)));
    note('a Player fallen')(f);
    expect(f.duel.fighters[1]!.death).toBeDefined();
    f = leave(clear(f));
    note('the fallen revived in the next Hall')(f);
    expect(f.duel.fighters[1]!.hp).toBeGreaterThan(0);

    // A Treasure Hall: pedestals, one taken (its group closed).
    let t = startIn('Treasure');
    note('treasure, pedestals')(t);
    expect(t.run!.pickups.every((p) => p.group !== undefined)).toBe(true);
    t = tick(placed(t, 0, t.run!.pickups.find((p) => p.owner === 0)!.at));
    note('treasure, one pedestal taken')(t);
    expect(t.run!.pickups.filter((p) => p.taken).length).toBeGreaterThan(0);
    leave(t, note('treasure, leaving'));

    // An Elite: its Relics' Mods on the enemy, and its drops.
    let e = startIn('Elite');
    note('elite, start')(e);
    expect(e.duel.fighters.some((x) => x.team === 1 && x.mods !== undefined)).toBe(true);
    e = clear(e);
    note('elite, cleared')(e);

    // A Rest Hall: the fire taken.
    let r = tick(startIn('Rest'));
    r = hold(r, [0, 1], null, 30);
    note('rest, fire taken')(r);
    expect(r.run!.rested.length).toBeGreaterThan(0);

    // A Boss, and the next Floor's entrance.
    let b = startIn('Boss');
    note('boss, start')(b);
    b = leave(clear(b), note('boss, leaving'));
    note('next Floor')(b);
    expect(b.run!.floor).toBe(2);

    // The last Floor's Boss: no Door behind it.
    let last = run({ start: { floor: tuning.dungeon.floors.length, row: 4, index: 0 } });
    note('last boss, start')(last);
    last = clear(last);
    note('last boss, cleared')(last);

    // An AI ally among the Fighters (0 and 2 human), Player 2 taking loot.
    let a = clear(run({}, 3, [0, 2]));
    a = tick(placed(a, 2, a.run!.pickups.find((p) => p.owner === 2)!.at));
    note('ally, Player 2 took a drop')(a);
    return out;
  }

  it('accepts every state of a Run as a resync, through JSON as a host sends it', () => {
    const all = states();
    expect(all.length).toBeGreaterThan(20);
    for (const [label, state] of all) {
      const m = resync(JSON.parse(JSON.stringify(state)));
      expect(parseNetMessage(m), label).toEqual(m);
    }
  });
  const labelled = (label: string): MatchState => JSON.parse(JSON.stringify(states().find(([l]) => l === label)![1])) as MatchState;
  const refused = (state: unknown, why: string) => expect(parseNetMessage(resync(state)), why).toBeNull();
  const withPickups = (state: MatchState, edit: (p: any[]) => any[]) => ({ ...state, run: { ...state.run, pickups: edit(state.run!.pickups as any[]) } });
  const withFighters = (state: MatchState, edit: (f: any, i: number) => any) => ({ ...state, duel: { ...state.duel, fighters: state.duel.fighters.map(edit) } });

  it('refuses a pickup whose owner or dropper is not a Player Fighter of the Run', () => {
    const ally = labelled('ally, Player 2 took a drop');
    expect(ally.config.players).toEqual([0, 2]);
    const own = ally.run!.pickups.find((p) => p.owner === 2)!;
    expect(parseNetMessage(resync(ally))).not.toBeNull();
    refused(withPickups(ally, (ps) => ps.map((p) => (p.id === own.id ? { ...p, owner: 1 } : p))), 'owned by an AI ally');
    refused(withPickups(ally, (ps) => ps.map((p) => (p.id === own.id ? { ...p, owner: 3 } : p))), 'owned by an enemy');
    refused(withPickups(ally, (ps) => [...ps, { id: ps.length, owner: null, kind: 'relic', item: 'Whetstone', at: own.at, taken: false, by: 1 }]), 'dropped by an AI ally');
    refused(withPickups(ally, (ps) => ps.map((p) => (p.id === own.id ? { ...p, by: 0 } : p))), 'a dropper on an owned pickup');
  });

  it('refuses a pedestal group that is not a real first pedestal of the same owner', () => {
    const treasure = labelled('treasure, pedestals');
    expect(treasure.run!.pickups.map((p) => p.group)).toEqual([0, 0, 0, 3, 3, 3]);
    refused(withPickups(treasure, (ps) => ps.map((p) => (p.id === 4 ? { ...p, group: 1 } : p))), 'a group that is not its own first');
    refused(withPickups(treasure, (ps) => ps.map((p) => (p.id === 4 ? { ...p, group: 0 } : p))), "another owner's group");
    refused(withPickups(treasure, (ps) => ps.map((p) => (p.id === 0 ? { ...p, group: undefined } : p))), 'a group whose first is not in it');
    refused(withPickups(treasure, (ps) => ps.map((p) => (p.id === 2 ? { ...p, owner: null } : p))), 'a shared pedestal');
    const fight = labelled('fight, cleared with drops');
    refused(withPickups(fight, (ps) => ps.map((p) => (p.id === 0 ? { ...p, group: 1 } : p))), 'a group whose first comes later');
  });

  it('refuses an inventory on a Fighter that is not a Player of the Run, and in Duels', () => {
    const ally = labelled('ally, Player 2 took a drop');
    const inventory = ally.duel.fighters[0]!.inventory!;
    expect(inventory).toBeDefined();
    for (const [i, who] of [[1, 'an AI ally'], [3, 'an enemy']] as const) refused(withFighters(ally, (f, k) => (k === i ? { ...f, inventory } : f)), who);
    refused(withFighters(matchState(), (f, k) => (k === 0 ? { ...f, inventory } : f)), 'a Duels Fighter');
  });

  it('refuses a Run whose players are not Team 0 Fighters, or whose rested are not Players', () => {
    const ally = labelled('ally, Player 2 took a drop');
    refused({ ...ally, config: { ...ally.config, players: [0, 3] } }, 'a Team 1 Fighter as a Player');
    refused({ ...ally, config: { ...ally.config, players: [0, 9] } }, 'a Player past the Fighters');
    refused({ ...ally, run: { ...ally.run, rested: [1] } }, 'an AI ally rested');
    const rest = labelled('rest, fire taken');
    expect(parseNetMessage(resync(rest))).not.toBeNull();
    refused({ ...rest, run: { ...rest.run, rested: [...rest.run!.rested, 2] } }, 'a Fighter that is not a Player rested');
  });

  it('refuses Door counts that no Hall can have: by its row and Floor, and any while Fighting', () => {
    const mid = labelled('fight, cleared with drops');
    expect(mid.run!.doorTicks.length).toBeGreaterThanOrEqual(1);
    refused({ ...mid, run: { ...mid.run, doorTicks: [] } }, 'a Hall with Doors and no counts');
    const boss = labelled('boss, start');
    expect(boss.run!.floor).toBeLessThan(boss.run!.floors);
    expect(boss.run!.doorTicks).toHaveLength(1);
    refused({ ...boss, run: { ...boss.run, doorTicks: [0, 0] } }, 'a Boss with two Doors');
    refused({ ...boss, run: { ...boss.run, doorTicks: [] } }, 'a Boss with a Floor below it and no Door');
    const last = labelled('last boss, start');
    expect(last.run!.doorTicks).toEqual([]);
    refused({ ...last, run: { ...last.run, doorTicks: [0] } }, "the last Floor's Boss with a Door");
    expect(boss.run!.phase).toBe('Fighting');
    refused({ ...boss, run: { ...boss.run, doorTicks: [3] } }, 'a count while Fighting');
  });

  it('refuses a Mods number that is not finite', () => {
    const elite = labelled('elite, start');
    const enemy = elite.duel.fighters.findIndex((f) => f.team === 1 && f.mods !== undefined);
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const state = withFighters(elite, (f, i) => (i === enemy ? { ...f, mods: { ...f.mods, damage: bad } } : f));
      expect(parseNetMessage({ ...resync(state) }), String(bad)).toBeNull();
    }
  });

  it('accepts the last slot of an Intent equip or drop and refuses the one after: the Tuning Data cap (99) is the most a peer can hold', () => {
    const m = intents([{ ...IDLE_INTENT, equip: { kind: 'relic', slot: 98 }, drop: { kind: 'weapon', slot: 98 } }]);
    expect(parseNetMessage(m)).toEqual(m);
    expect(parseNetMessage(intents([{ ...IDLE_INTENT, drop: { kind: 'weapon', slot: 99 } }]))).toBeNull();
  });
});
