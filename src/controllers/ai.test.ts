import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData, type AiDifficulty, type TuningData } from '../tuning';
import { attack, createInitialState, createMatch, duelPlacements, hashValue, TICK_RATE, wait, type Direction, type Intent, type Track } from '../sim';
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
      const difficulty = { reactionTime, mistakeRate: 0 };
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
      const { run } = vsAi(passive, { reactionTime: 0.25, mistakeRate }, a, 700, seed);
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
  });
});

describe('AI Controller: Blocking', () => {
  const perfect = { reactionTime: 0.25, mistakeRate: 0 };

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

describe('AI Controller determinism', () => {
  it('ai.ts and controller.ts use no Math.random or wall-clock time (only the seeded generator)', () => {
    for (const file of ['ai.ts', 'controller.ts']) {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/Math\.random|\bDate\b|\bperformance\b|\bset(?:Timeout|Interval)\b/);
    }
  });
});
