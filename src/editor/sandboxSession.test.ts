import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, createMatch, duelPlacements, hashValue, IDLE_INTENT, wait, type Intent, type SimState } from '../sim';
import { createAiController, scriptedController, type Controller } from '../controllers';
import { createSandboxSession, duelSandbox, matchSandbox } from './sandboxSession';

const tuning = loadTuningData();

const aiVsAi = (bestOf = 3, seed = 7) =>
  createSandboxSession(matchSandbox(tuning), createMatch(tuning, { bestOf, seed }), [
    createAiController(tuning, 'Hard'),
    createAiController(tuning, 'Normal'),
  ]);

/** Play the session forward until it is over (or maxTicks), returning the hash at every index. */
function playToEnd(session: ReturnType<typeof aiVsAi>, maxTicks = 20_000): string[] {
  while (!session.over && session.cursor < maxTicks) session.advance();
  return session.history.map((s) => hashValue(s));
}

describe('Sandbox session: AI vs AI Match', () => {
  it('scrubbing back and resuming reproduces the same outcome, Tick for Tick', () => {
    const session = aiVsAi(1);
    const original = playToEnd(session);
    expect(session.state.status.status).toBe('Over');
    const end = session.cursor;

    for (const back of [0, 37, Math.floor(end / 2), end - 5]) {
      session.seek(back);
      expect(session.cursor).toBe(back);
      expect(hashValue(session.state)).toBe(original[back]);
      const resumed = playToEnd(session);
      expect(session.cursor).toBe(end);
      expect(resumed).toEqual(original);
      expect(session.divergence).toBeNull();
    }
  }, 30_000);

  it('matches a fresh, uninterrupted run with fresh Controllers', () => {
    const interrupted = aiVsAi(1, 3);
    for (let t = 0; t < 400; t++) interrupted.advance();
    interrupted.seek(120);
    const a = playToEnd(interrupted);
    const b = playToEnd(aiVsAi(1, 3));
    expect(a).toEqual(b);
  });

  it('keeps the computed future while scrubbing, so scrubbing forward again is free', () => {
    const session = aiVsAi(1, 5);
    for (let t = 0; t < 300; t++) session.advance();
    session.seek(100);
    expect(session.frontier).toBe(300);
    session.seek(250);
    expect(session.cursor).toBe(250);
    expect(() => session.seek(301)).toThrow(RangeError);
  });

  it('steps back one Tick', () => {
    const session = aiVsAi(1, 5);
    session.advance();
    session.advance();
    const atOne = hashValue(session.history[1]);
    session.stepBack();
    expect(session.cursor).toBe(1);
    expect(hashValue(session.state)).toBe(atOne);
    session.seek(0);
    session.stepBack();
    expect(session.cursor).toBe(0);
  });
});

describe('Sandbox session: scripted Duel', () => {
  it('scrub back and resume gives the same states as the first pass', () => {
    const a = [...wait(10), ...attack('Overhead')];
    const b = [...wait(60), ...attack('Left')];
    const initial = createInitialState(tuning, 1, duelPlacements(1.3));
    const session = createSandboxSession(duelSandbox(tuning), initial, [scriptedController(a), scriptedController(b)]);
    for (let t = 0; t < 150; t++) session.advance();
    const first = session.history.map((s) => hashValue(s));
    session.seek(40);
    for (let t = 40; t < 150; t++) session.advance();
    expect(session.history.map((s) => hashValue(s))).toEqual(first);
    expect(session.recentEvents(150, 50).some((e) => e.type === 'Hit')).toBe(true);
  });
});

describe('Sandbox session: a branch (different Intents after a scrub)', () => {
  it('drops the old future and continues from the new Intents', () => {
    // Stand-in for a Local Controller: a player who attacks only on the second try.
    let tryAgain = false;
    const player: Controller = {
      intent: (s: SimState) => (tryAgain && s.tick >= 20 && s.tick < 22 ? { ...IDLE_INTENT, attack: true } : IDLE_INTENT),
    };
    const initial = createInitialState(tuning, 1, duelPlacements(1.3));
    const session = createSandboxSession(duelSandbox(tuning), initial, [player, createAiController(tuning, 'Normal')]);
    for (let t = 0; t < 100; t++) session.advance();
    const passive = session.history.map((s) => hashValue(s));

    session.seek(10);
    tryAgain = true;
    for (let t = 10; t < 20; t++) session.advance();
    expect(session.frontier).toBe(100); // same Intents so far: the future is kept
    session.advance(); // Tick 20: the player now attacks
    expect(session.frontier).toBe(21);
    expect(session.state.fighters[0]!.action.kind).toBe('Attack');
    expect(hashValue(session.state)).not.toBe(passive[21]);
    expect(session.divergence).toBeNull(); // a branch, not a determinism failure
  });

  it('reports a determinism failure when the same Intents give a different state', () => {
    let calls = 0;
    const flaky = duelSandbox(tuning);
    const sandbox = { ...flaky, step: (s: SimState, intents: readonly Intent[]) => ({ ...flaky.step(s, intents), ...(calls++ === 150 ? { rng: { seed: 0 } } : {}) }) };
    const session = createSandboxSession(sandbox, createInitialState(tuning, 1, duelPlacements(2)), []);
    for (let t = 0; t < 100; t++) session.advance();
    session.seek(0);
    for (let t = 0; t < 100; t++) session.advance();
    expect(session.divergence).toBe(51);
  });
});

describe('AI Controller save/load', () => {
  it('a Controller loaded from a save gives the same Intents as the original from there on', () => {
    const match = createMatch(tuning, { bestOf: 1, seed: 11 });
    const original = createAiController(tuning, 'Easy');
    const other = createAiController(tuning, 'Easy');
    const session = createSandboxSession(matchSandbox(tuning), match, [original, other]);
    for (let t = 0; t < 200; t++) session.advance();
    const saved = original.save!();
    const copy = createAiController(tuning, 'Easy');
    copy.load!(saved);
    const duel = session.state.duel;
    expect(copy.intent(duel, 0)).toEqual(original.intent(duel, 0));
  });
});
