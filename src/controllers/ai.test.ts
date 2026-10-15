import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData, type AiDifficulty, type TuningData } from '../tuning';
import { attack, createInitialState, createMatch, duelPlacements, hashValue, hold, TICK_RATE, wait, type Direction, type Intent, type Track } from '../sim';
import { createAiController, runControllers, runMatch, scriptedController } from './index';

const repo = loadTuningData();
/** The AI never starts Attacks of its own here, so it is free to defend. */
const passive: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0 } };

const DISTANCE = 1.3; // every Direction hits from here (see directions.test.ts)

/** Scripted Fighter 0 against an AI Fighter 1; returns the run plus every Intent the AI gave. */
function vsAi(tuning: TuningData, difficulty: AiDifficulty, a: Track, ticks: number, seed = 1) {
  const ai = createAiController(tuning, difficulty);
  const aiIntents: Intent[] = [];
  const recording = {
    intent: (s: Parameters<typeof ai.intent>[0], i: number) => {
      const intent = ai.intent(s, i);
      aiIntents.push(intent);
      return intent;
    },
  };
  const initial = createInitialState(tuning, seed, duelPlacements(DISTANCE));
  const run = runControllers(tuning, initial, [scriptedController(a), recording], ticks);
  return { run, aiIntents };
}

describe('AI Controller: Reaction Time', () => {
  for (const reactionTime of [0.1, 0.25, 0.5]) {
    it(`never reacts to a Wind-up before its Reaction Time (${reactionTime} s) elapses`, () => {
      const difficulty = { reactionTime, mistakeRate: 0, feintRate: 0 };
      const reactionTicks = Math.round(reactionTime * TICK_RATE);
      const ticks = 30 + reactionTicks + 30;
      const calm = vsAi(passive, difficulty, wait(ticks), ticks);
      const threatened = vsAi(passive, difficulty, [...wait(30), ...attack('Overhead')], ticks);

      // The first state (by Tick) in which Fighter 0's Wind-up is visible.
      const seen = threatened.run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Attack');
      expect(seen).toBe(31);
      // aiIntents[k] was chosen looking at states[k]. Up to Reaction Time later it acts exactly as if nothing happened...
      const before = seen + reactionTicks;
      expect(threatened.aiIntents.slice(0, before)).toEqual(calm.aiIntents.slice(0, before));
      // ...and then it reacts (raises a Block).
      expect(threatened.aiIntents[before]!.block).toBe(true);
      expect(calm.aiIntents[before]!.block).toBe(false);
    });
  }
});

describe('AI vs AI Match', { timeout: 30_000 }, () => {
  const play = (seed: number) =>
    runMatch(repo, createMatch(repo, { bestOf: 1, seed }), [createAiController(repo, 'Normal'), createAiController(repo, 'Normal')], 30_000);

  it('is deterministic for a given seed (same hash at every Tick, same result)', () => {
    const one = play(42);
    const two = play(42);
    expect(one.final.status.status).toBe('Over');
    expect(one.matches.length).toBe(two.matches.length);
    expect(one.matches.map((m) => hashValue(m))).toEqual(two.matches.map((m) => hashValue(m)));
  });

  it('plays out differently with a different seed', () => {
    expect(hashValue(play(42).final)).not.toBe(hashValue(play(43).final));
  });

  it('a Match of Hard against Easy is mostly won by Hard', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ais = [createAiController(repo, 'Hard'), createAiController(repo, 'Easy')];
      const { final } = runMatch(repo, createMatch(repo, { bestOf: 3, seed }), ais, 30_000);
      if (final.status.status === 'Over' && final.status.winner === 0) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(4);
  });
});

describe('AI Controller: mistake rate', () => {
  /** Hits landed on the AI across many Duels (one seed each) against the same string of Attacks. */
  function hitsAgainst(mistakeRate: number): number {
    const dirs: Direction[] = ['Overhead', 'Left', 'Right', 'Thrust', 'Left', 'Overhead'];
    const a: Track = dirs.flatMap((d) => [...wait(70), ...attack(d)]);
    let hits = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { run } = vsAi(passive, { reactionTime: 0.25, mistakeRate, feintRate: 0 }, a, 700, seed);
      hits += run.events.filter((e) => e.type === 'Hit' && e.defender === 1).length;
    }
    return hits;
  }

  it('a higher mistake rate yields measurably more successful hits against it over many Duels', () => {
    const none = hitsAgainst(0);
    const some = hitsAgainst(0.2);
    const many = hitsAgainst(0.6);
    expect(none).toBe(0);
    expect(some).toBeGreaterThan(none);
    expect(many).toBeGreaterThan(some * 1.5);
  }, 30_000);
});

describe('AI Controller: Blocking', () => {
  const perfect = { reactionTime: 0.25, mistakeRate: 0, feintRate: 0 };

  for (const direction of ['Overhead', 'Left', 'Right', 'Thrust'] as const satisfies readonly Direction[]) {
    it(`with zero mistake rate it Blocks a visible ${direction} Attack in the matching Direction`, () => {
      const { run } = vsAi(passive, perfect, [...wait(30), ...attack(direction)], 200);
      const blocks = run.events.filter((e) => e.type === 'Block');
      expect(blocks).toEqual([expect.objectContaining({ attacker: 0, defender: 1, direction })]);
      expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
      expect(run.final.fighters[1]!.hp).toBe(repo.fighter.maxHp);
    });
  }

  it('with zero mistake rate it Blocks a whole string of Attacks in varying Directions, even held Wind-ups', () => {
    const dirs: Direction[] = ['Thrust', 'Left', 'Overhead', 'Right', 'Right', 'Left', 'Thrust', 'Overhead'];
    const a: Track = dirs.flatMap((d, i) => [...wait(60), ...attack(d, 1 + ((i * 17) % 40))]);
    const { run } = vsAi(passive, perfect, a, 1400);
    expect(run.events.filter((e) => e.type === 'Block').map((e) => (e.type === 'Block' ? e.direction : null))).toEqual(dirs);
    expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });

  it('with zero mistake rate it is not fooled by an Attack Feint: it Blocks the Direction the Attack was Feinted into', () => {
    // Overhead Wind-up held long enough for the AI to raise an Overhead Block, then a Feint into Left, released at once.
    const a: Track = [...wait(30), ...hold(40, { attack: true, direction: 'Overhead' }), ...hold(1, { attack: true, direction: 'Left' })];
    const { run } = vsAi(passive, perfect, a, 200);
    expect(run.events.some((e) => e.type === 'Feint' && e.fighter === 0)).toBe(true);
    expect(run.events.filter((e) => e.type === 'Block')).toEqual([expect.objectContaining({ attacker: 0, defender: 1, direction: 'Left' })]);
    expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });

  it('turns to face an attacker who starts beside it, so its Block counts', () => {
    const ai = createAiController(passive, perfect);
    // The AI faces +z; the attacker stands to its side (+x), facing it.
    const placements = [
      { position: { x: 1.3, z: 0 }, facing: -Math.PI / 2 },
      { position: { x: 0, z: 0 }, facing: 0 },
    ];
    const initial = createInitialState(passive, 1, placements);
    const run = runControllers(passive, initial, [scriptedController([...wait(40), ...attack('Overhead')]), ai], 200);
    expect(run.events.some((e) => e.type === 'Block' && e.defender === 1)).toBe(true);
    expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });
});

describe('AI Controller: Feints', () => {
  /** The AI's own Attack Feints (Attack into another Direction) against an opponent who never attacks. */
  function aiFeints(feintRate: number) {
    // Endless HP, so the Duel never ends and the AI keeps attacking.
    const eager: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, aggression: 0.2 } };
    const ai = createAiController(eager, { reactionTime: 0.1, mistakeRate: 0, feintRate });
    const run = runControllers(eager, createInitialState(eager, 5, duelPlacements(1.2)), [scriptedController(wait(1)), ai], 1500);
    const attacks = run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Wind-up').length;
    const feints = run.events.filter((e) => e.type === 'Feint' && e.fighter === 1);
    return { attacks, feints };
  }

  it('with a feint rate it sometimes cancels its own Wind-up into another Direction', () => {
    const { feints } = aiFeints(0.5);
    expect(feints.length).toBeGreaterThan(0);
    for (const f of feints) {
      expect(f.type === 'Feint' && f.into.kind).toBe('Attack');
      expect(f.type === 'Feint' && f.into.direction !== f.from).toBe(true);
    }
  });

  it('with a feint rate of 0 it never Feints deliberately', () => {
    const { attacks, feints } = aiFeints(0);
    expect(attacks).toBeGreaterThan(3);
    expect(feints).toEqual([]);
  });
});

describe('AI Controller determinism', () => {
  it("draws its randomness from the Simulation's seeded generator in state, not a generator of its own", () => {
    // Reaction Time 0 and an opponent who never attacks: everything the AI needs is in the state it is shown.
    const eager: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0.3 } };
    const difficulty = { reactionTime: 0, mistakeRate: 0.5, feintRate: 0 };
    const ai = createAiController(eager, difficulty);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents[s.tick] = ai.intent(s, i)) };
    const run = runControllers(eager, createInitialState(eager, 7, duelPlacements(1.2)), [scriptedController(wait(1)), recording], 300);
    expect(intents.filter((i) => i.attack).length).toBeGreaterThan(3);
    // A fresh AI shown any one of those states decides exactly as the long-running one did.
    for (let t = 0; t < 300; t += 7) expect(createAiController(eager, difficulty).intent(run.states[t]!, 1), `Tick ${t}`).toEqual(intents[t]);
  });

  it('the Simulation advances its seeded generator every Tick', () => {
    const run = runControllers(repo, createInitialState(repo, 3, duelPlacements(2)), [scriptedController(wait(1)), scriptedController(wait(1))], 20);
    const seeds = run.states.map((s) => s.rng.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('ai.ts and controller.ts use no Math.random or wall-clock time (only the seeded generator)', () => {
    for (const file of ['ai.ts', 'controller.ts']) {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/Math\.random|\bDate\b|\bperformance\b|\bset(?:Timeout|Interval)\b/);
    }
  });
});

describe('AI Controller: teams', () => {
  const perfect = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };
  const reactionTicks = Math.round(0.1 * TICK_RATE);

  /** Fighters at the given ground positions (all facing +z) on the given teams; the AI drives Fighter 0, everyone else follows `others`. */
  function lineup(tuning: TuningData, positions: { x: number; z: number }[], teams: number[], others: Track, ticks: number) {
    const ai = createAiController(tuning, perfect);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const initial = createInitialState(tuning, 1, positions.map((position) => ({ position, facing: 0 })), [], teams);
    const run = runControllers(tuning, initial, [recording, ...positions.slice(1).map(() => scriptedController(others))], ticks);
    return { run, intents };
  }

  it('closes on its nearest enemy and ignores its teammates, however close', () => {
    // A teammate right beside it, an enemy 3 m to its right (+x), a farther enemy ahead (+z).
    const { intents } = lineup(repo, [{ x: 0, z: 0 }, { x: -0.8, z: 0 }, { x: 3, z: 0 }, { x: 0, z: 5 }], [0, 0, 1, 1], wait(60), 60);
    const acting = intents[reactionTicks + 1]!;
    expect(acting.face).toBeCloseTo(Math.PI / 2); // toward +x
    expect(acting.move.x).toBeCloseTo(1);
    expect(acting.attack).toBe(false);
  });

  it('stands idle once every enemy has fallen', () => {
    const { intents } = lineup(repo, [{ x: 0, z: 0 }, { x: 3, z: 0 }], [0, 0], wait(60), 60);
    expect(intents.every((i) => hashValue(i) === hashValue(intents[0]!))).toBe(true);
    expect(intents[reactionTicks + 1]!.move).toEqual({ x: 0, z: 0 });
  });

  it('turns to Block an enemy attacking from its side, not the enemy it was facing', () => {
    // Its nearest enemy (ahead) idles; a second enemy close on its right winds up an Overhead.
    const ai = createAiController(passive, perfect);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: 0, z: 1.2 }, facing: Math.PI },
      { position: { x: 1.3, z: 0 }, facing: -Math.PI / 2 },
    ];
    const initial = createInitialState(passive, 1, placements, [], [0, 1, 1]);
    const ticks = 30 + reactionTicks + 10;
    runControllers(passive, initial, [recording, scriptedController(wait(ticks)), scriptedController([...wait(30), ...attack('Overhead', 40)])], ticks);
    const blocking = intents.find((i) => i.block)!;
    expect(blocking).toBeDefined();
    expect(blocking.direction).toBe('Overhead');
    expect(blocking.face).toBeCloseTo(Math.PI / 2); // toward the attacker at +x
  });
});
