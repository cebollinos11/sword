import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, IDLE_INTENT, stepMatch, throwTimings, type MatchState } from '../sim';
import { aiDifficulty, createAiController, FLOOR_DIFFICULTY, lineupAis, lineupMatch, type Lineup } from '../controllers';
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
});

describe('Peer message validation: a Gauntlet Run (docs/plans/gauntlet.md, Stage 4)', () => {
  const RUN = 'gen:greybox:4242';
  const lineup: Lineup = [
    { team: 0, pilot: { kind: 'Player', player: 0 } },
    { team: 0, pilot: { kind: 'Player', player: 1 } },
    ...Array.from({ length: 3 }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
  ];
  const hello = (match: unknown) => ({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match, lineup, weapons: ['Halberd', 'Halberd'], player: 1 });

  /** A real Run 40 Ticks in, with its Floor AIs' memory, as the host would send it in a resync. */
  function runResync(): { state: MatchState; ai: unknown[] } {
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], { bestOf: 1, arena: RUN, seed: 3, format: 'Gauntlet' }));
    for (let t = 0; t < 40; t++) m = stepMatch(m, lineup.map((s, i) => (s.pilot.kind === 'AI' ? ais[i]!.intent(m.duel, i) : IDLE_INTENT)), tuning);
    return JSON.parse(JSON.stringify({ state: m, ai: ais.map((a) => a?.save?.() ?? null) })) as { state: MatchState; ai: unknown[] };
  }

  it("accepts a Run's start message: the Format and its humans in the Match options", () => {
    for (const match of [
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 2 },
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
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 4 },
      { bestOf: 1, arena: RUN, format: 'Gauntlet', humans: 1.5 },
    ]) {
      expect(parseNetMessage(hello(match)), JSON.stringify(match)).toBeNull();
    }
  });

  it("carries a Run through a resync: its progress, the Floor, each Fighter's max HP and Benched slots, and the Floor AIs' memory", () => {
    const { state, ai } = runResync();
    expect(state.run).toMatchObject({ floor: 1, floors: tuning.gauntlet.floors.length });
    expect(state.duel.floor).toBe(1);
    expect(state.duel.fighters.some((f) => f.benched)).toBe(true);
    expect(ai.slice(2).every((m) => m !== null && typeof m === 'object' && 'floor' in m)).toBe(true);
    const m = resync(state, ai);
    expect(parseNetMessage(m)).toEqual(m);
  });

  it('refuses a malformed Run, Floor, max HP, Benched flag or Floor AI memory', () => {
    const { state, ai } = runResync();
    const fighters = (patch: object) => ({ ...state, duel: { ...state.duel, fighters: state.duel.fighters.map((f, i) => (i === 4 ? { ...f, ...patch } : f)) } });
    const broken: unknown[] = [
      { ...state, run: null },
      { ...state, run: { ...state.run, floor: 0 } },
      { ...state, run: { ...state.run, floor: state.run!.floors + 1 } },
      { ...state, run: { ...state.run, cleared: -1 } },
      { ...state, run: { ...state.run, startTick: 'then' } },
      { ...state, duel: { ...state.duel, floor: 2 } },
      { ...state, duel: { ...state.duel, floor: undefined } },
      { ...state, config: { ...state.config, format: 'Survival' } },
      { ...state, config: { ...state.config, arena: 'library' } },
      { ...state, config: { ...state.config, humans: 5 } },
      { ...state, config: { ...state.config, rematchTicks: 300 } },
      fighters({ maxHp: 0 }),
      fighters({ maxHp: 'lots' }),
      fighters({ benched: false }),
    ];
    for (const bad of broken) expect(parseNetMessage(resync(bad, ai)), JSON.stringify(bad).slice(0, 100)).toBeNull();
    for (const bad of [{ floor: 'one', memory: null }, { floor: 0, memory: null }, { floor: 1, memory: { lastTick: 'x' } }, { floor: 1 }]) {
      expect(parseNetMessage(resync(state, [null, null, bad, ai[3], ai[4]])), JSON.stringify(bad)).toBeNull();
    }
    // A Duels state carries no Run.
    const duels = matchState();
    expect(parseNetMessage(resync({ ...duels, run: state.run }))).toBeNull();
    expect(parseNetMessage(resync({ ...duels, duel: { ...duels.duel, floor: 1 } }))).toBeNull();
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
