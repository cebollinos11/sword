import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData, type AiDifficulty, type TuningData } from '../tuning';
import { attack, IDLE_INTENT, createInitialState, createMatch, DIRECTIONS, duelPlacements, groundBelow, hashValue, jumpArc, hold, TICK_RATE, wait, walk, type Direction, type Intent, type Track } from '../sim';
import { JUMP_SPOTS } from '../sim/jumpSpots.testdata';
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

describe('AI Controller in the multilevel library', () => {
  const repo = loadTuningData();
  const inLibrary = (placements: { x: number; y: number; z: number; facing: number }[], teams: number[]) =>
    createInitialState(repo, 1, placements.map(({ x, y, z, facing }) => ({ position: { x, z }, y, facing })), [], teams, 'library');

  it('finds its way from the ground floor up to an enemy on the gallery, and engages it there', () => {
    const initial = inLibrary([{ x: -4.5, y: 0, z: -4.5, facing: Math.PI / 2 }, { x: 5, y: 6, z: 10.5, facing: Math.PI }], [0, 1]);
    const run = runControllers(repo, initial, [createAiController(repo, 'Normal'), scriptedController(wait(1))], TICK_RATE * 60);
    const engaged = run.events.find((e) => e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Wind-up');
    expect(engaged, 'the AI never attacked').toBeDefined();
    const at = run.states[engaged!.tick]!.fighters[0]!;
    // On the gallery (it may leap in with a jumping Attack), within the reach it steps in and swings from.
    expect(Math.abs(at.y - 6)).toBeLessThan(0.5);
    expect(Math.hypot(at.position.x - 5, at.position.z - 10.5)).toBeLessThan(repo.ai.attackRange + 1.4);
    // It walked there: no fall on the way.
    expect(run.events.some((e) => e.type === 'Land' && e.fighter === 0 && e.tick <= engaged!.tick)).toBe(false);
  });

  it('backing off at an open ledge, it strafes along it rather than stepping off', () => {
    // On the bridge with its back to a gap in the rail (x -6..-4.5 on its south side), an enemy too close in front.
    const initial = inLibrary([{ x: -5.25, y: 3, z: -1.15, facing: 0 }, { x: -5.25, y: 3, z: -0.45, facing: Math.PI }], [0, 1]);
    const run = runControllers(repo, initial, [createAiController(repo, 'Normal'), scriptedController(wait(1))], 180);
    for (const s of run.states) {
      expect(s.fighters[0]!.air, `Tick ${s.tick}`).toBeUndefined();
      expect(s.fighters[0]!.y).toBe(3);
    }
  });

  it('keeps its route in its memory: a restored Controller walks on the same way', () => {
    const initial = inLibrary([{ x: -4.5, y: 0, z: -4.5, facing: Math.PI / 2 }, { x: 5, y: 6, z: 10.5, facing: Math.PI }], [0, 1]);
    const ai = createAiController(repo, 'Normal');
    const half = runControllers(repo, initial, [ai, scriptedController(wait(1))], 200);
    const saved = ai.save!();
    expect((saved as { route: unknown }).route).not.toBeNull();
    const restored = createAiController(repo, 'Normal');
    restored.load!(saved);
    const a = runControllers(repo, half.final, [ai, scriptedController(wait(1))], 200);
    const b = runControllers(repo, half.final, [restored, scriptedController(wait(1))], 200);
    expect(hashValue(b.final)).toBe(hashValue(a.final));
  });
});

describe('AI Controller: Kick', () => {
  const perfect = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };
  const reactionTicks = Math.round(0.1 * TICK_RATE);
  const eager: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 1 } };
  const shy: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 0 } };

  /** Fighter 0 (AI) at the origin facing +z, Fighter 1 `gap` m ahead; the AI's Intents and states are recorded. */
  function duel(tuning: TuningData, other: Track, ticks: number, gap = 0.95, seed = 1) {
    const ai = createAiController(tuning, perfect);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const initial = createInitialState(tuning, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: gap }, facing: Math.PI }]);
    const run = runControllers(tuning, initial, [recording, scriptedController(other)], ticks);
    return { run, intents };
  }

  it('Kicks an approaching dummy: it walks in range, is knocked down', () => {
    // Fighter 1 walks towards the AI (-z) from beyond its Kick range.
    const r = duel(eager, walk(200, { x: 0, z: -1 }), 120, 2);
    const pressed = r.intents.findIndex((i) => i.kick);
    expect(pressed).toBeGreaterThan(0);
    const landed = r.run.events.find((e) => e.type === 'KickLanded');
    expect(landed, 'the Kick never landed').toBeDefined();
    expect(r.run.final.fighters[1]!.action.kind).toBe('Knockdown');
  });

  it('does not Kick a dummy that stands still', () => {
    const r = duel(eager, wait(120), 120, 0.95);
    expect(r.intents.some((i) => i.kick)).toBe(false);
  });

  it('does not Kick when kickRate is 0, nor an opponent lying in a Knockdown', () => {
    expect(duel(shy, walk(200, { x: 0, z: -1 }), 120, 2).intents.some((i) => i.kick)).toBe(false);
    const down = duel(eager, walk(200, { x: 0, z: -1 }), 160, 2);
    const knocked = down.run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Knockdown');
    expect(knocked).toBeGreaterThan(0);
    // Once it is down (and sliding, then lying) the AI presses no Kick again while it lies there.
    const lying = down.run.states.findIndex((s, k) => k > knocked && s.fighters[1]!.action.kind === 'Knockdown' && s.fighters[0]!.action.kind === 'Idle');
    for (let k = lying + reactionTicks; k < down.intents.length && down.run.states[k]!.fighters[1]!.action.kind === 'Knockdown'; k++) expect(down.intents[k]!.kick).toBe(false);
  });

  it('stands still against a Kick Wind-up (where it would otherwise back off)', () => {
    const noKick: TuningData = { ...passive, ai: { ...passive.ai, kickRate: 0 } };
    const ticks = 80;
    const calm = duel(noKick, wait(ticks), ticks, 0.8);
    const threatened = duel(noKick, hold(1, { kick: true }), ticks, 0.8);
    const seen = threatened.run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Kick');
    expect(seen).toBeGreaterThan(0);
    // Too close, it backs off a calm opponent...
    expect(calm.intents[reactionTicks + 1]!.move).not.toEqual({ x: 0, z: 0 });
    // ...but holds still, without Attacking or Blocking, while the Kick is a Wind-up or in Release.
    const live = threatened.run.states.findIndex((s, k) => k > seen && s.fighters[1]!.action.kind === 'Kick' && s.fighters[1]!.action.phase === 'Recovery');
    expect(live).toBeGreaterThan(seen);
    for (let k = seen + reactionTicks; k < live + reactionTicks - 1; k++) {
      expect(threatened.intents[k]!.move, `Tick ${k}`).toEqual({ x: 0, z: 0 });
      expect(threatened.intents[k]!.attack || threatened.intents[k]!.block).toBe(false);
    }
  });

  it('Blocks only if a blade threatens too', () => {
    const { intents } = duel({ ...passive, ai: { ...passive.ai, kickRate: 0 } }, [...wait(30), ...hold(1, { kick: true })], 80, 0.95);
    expect(intents.some((i) => i.block)).toBe(false);
    const both = duel(passive, [...wait(30), ...attack('Overhead', 40)], 80, 1.0);
    expect(both.intents.some((i) => i.block)).toBe(true);
  });

  it('is deterministic: the same seed gives the same Intents, and a restored Controller agrees', () => {
    const tuning: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 0.3 } };
    const a = duel(tuning, walk(200, { x: 0, z: -1 }), 150, 2, 7);
    const b = duel(tuning, walk(200, { x: 0, z: -1 }), 150, 2, 7);
    expect(a.intents.map((i) => hashValue(i))).toEqual(b.intents.map((i) => hashValue(i)));
    expect(hashValue(a.run.final)).toBe(hashValue(b.run.final));
    const c = duel(tuning, walk(200, { x: 0, z: -1 }), 150, 2, 8);
    expect(hashValue(c.run.final)).not.toBe(hashValue(a.run.final));
  });
});

describe('AI Controller: repertoire', () => {
  const sharp = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };

  it('with duckRate 1 it Crouches under a Left or Right swing instead of Blocking it, and is not hit', () => {
    for (const direction of ['Left', 'Right'] as const) {
      const { run, aiIntents } = vsAi(passive, { ...sharp, duckRate: 1 }, [...wait(30), ...attack(direction)], 150);
      expect(aiIntents.some((i) => i.crouch), direction).toBe(true);
      expect(aiIntents.some((i) => i.block), direction).toBe(false);
      expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1), direction).toBe(false);
    }
  });

  it('still Blocks an Overhead or a Thrust whatever its duckRate (a Crouch would take them to the head)', () => {
    for (const direction of ['Overhead', 'Thrust'] as const) {
      const { run } = vsAi(passive, { ...sharp, duckRate: 1 }, [...wait(30), ...attack(direction)], 150);
      expect(run.events.filter((e) => e.type === 'Block'), direction).toEqual([expect.objectContaining({ defender: 1, direction })]);
    }
  });

  it('with chamberRate 1 it Chambers an Attack released as soon as it can be, timed off the Wind-up it saw', () => {
    for (const direction of DIRECTIONS) {
      const { run } = vsAi(passive, { ...sharp, chamberRate: 1 }, [...wait(30), ...attack(direction)], 150);
      expect(run.events.filter((e) => e.type === 'Chamber'), direction).toEqual([expect.objectContaining({ chamberer: 1, attacker: 0 })]);
      expect(run.events.some((e) => e.type === 'Hit' && e.defender === 1), direction).toBe(false);
    }
  });

  it('a Chamber that misses its timing (the Wind-up is held) falls back to a Block', () => {
    const { run } = vsAi(passive, { ...sharp, chamberRate: 1 }, [...wait(30), ...attack('Overhead', 40)], 200);
    expect(run.events.some((e) => e.type === 'Chamber')).toBe(false);
    expect(run.events.filter((e) => e.type === 'Block')).toEqual([expect.objectContaining({ defender: 1, direction: 'Overhead' })]);
  });

  it('with a jumpAttackRate it leaps in from beyond its reach with an Overhead that lands', () => {
    const eager: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0 } };
    const ai = createAiController(eager, { ...sharp, footwork: 0.5, aggression: 0, jumpAttackRate: 0.05 });
    const run = runControllers(eager, createInitialState(eager, 3, duelPlacements(3.5)), [scriptedController(wait(1)), ai], 600);
    const jump = run.events.find((e) => e.type === 'Jump' && e.fighter === 1);
    expect(jump, 'it never jumped').toBeDefined();
    expect(run.states[jump!.tick]!.fighters[1]!.action).toMatchObject({ kind: 'Attack', direction: 'Overhead' });
    expect(run.events.some((e) => e.type === 'Hit' && e.attacker === 1 && e.tick > jump!.tick && e.tick < jump!.tick + 60)).toBe(true);
  });

  it('with chainRate 1 it Chains a second Attack while its target is still in reach', () => {
    const eager: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0, aggression: 0.2 } };
    const ai = createAiController(eager, { ...sharp, chainRate: 1 });
    const run = runControllers(eager, createInitialState(eager, 5, duelPlacements(1.2)), [scriptedController(wait(1)), ai], 400);
    expect(run.states.some((s) => s.fighters[1]!.action.kind === 'Attack' && (s.fighters[1]!.action as { chain?: unknown }).chain !== undefined)).toBe(true);
  });

  it('attacks around a Block it sees raised: never into the Direction that Block stops', () => {
    const eager: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0, aggression: 0.2 } };
    const ai = createAiController(eager, sharp);
    const run = runControllers(eager, createInitialState(eager, 9, duelPlacements(1.2)), [scriptedController(hold(900, { block: true, direction: 'Left' })), ai], 900);
    const swings = run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Wind-up');
    expect(swings.length).toBeGreaterThan(3);
    // A Left Block meets a Right Attack.
    for (const e of swings) expect(e.type === 'AttackPhase' && e.direction).not.toBe('Right');
    expect(run.events.some((e) => e.type === 'Block')).toBe(false);
  });
});

describe('AI Controller: Throwing Dagger', () => {
  const sharp = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };
  /** Throws every chance it gets; never attacks or kicks. */
  const thrower: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 0, throwRate: 1 } };
  /** Never throws of its own. */
  const catcher: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 0, throwRate: 0 } };

  /** The AI is Fighter 0 at the origin facing +z; Fighter 1 `gap` m ahead. */
  function duel(tuning: TuningData, difficulty: AiDifficulty, other: ReturnType<typeof scriptedController>, ticks: number, gap = 5, seed = 1) {
    const ai = createAiController(tuning, difficulty);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const initial = createInitialState(tuning, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: gap }, facing: Math.PI }]);
    return { run: runControllers(tuning, initial, [recording, other], ticks), intents };
  }

  it('throws at a target walking away out of its reach, and hits it', () => {
    const { run, intents } = duel(thrower, sharp, scriptedController(walk(400, { x: 0, z: 1 })), 200);
    expect(intents.some((i) => i.throw)).toBe(true);
    expect(run.events.some((e) => e.type === 'DaggerHit' && e.defender === 1)).toBe(true);
  });

  it('never throws more than the daggers it carries', () => {
    const { run } = duel(thrower, sharp, scriptedController(walk(900, { x: 0, z: 1 })), 800, 3);
    expect(run.events.filter((e) => e.type === 'DaggerThrown' && e.thrower === 0)).toHaveLength(repo.dagger.count);
    expect(run.final.fighters[0]!.daggers).toBe(0);
  });

  it('never throws at a target in melee reach, standing still, or coming closer', () => {
    expect(duel(thrower, sharp, scriptedController(wait(150)), 150, 1).intents.some((i) => i.throw)).toBe(false);
    expect(duel(thrower, sharp, scriptedController(wait(150)), 150, 6).intents.some((i) => i.throw)).toBe(false);
    expect(duel(thrower, sharp, scriptedController(walk(100, { x: 0, z: -1 })), 100, 6).intents.some((i) => i.throw)).toBe(false);
  });

  it('never throws beyond its throwRange, nor when throwRate is 0', () => {
    const far = duel(thrower, sharp, scriptedController(walk(100, { x: 0, z: 1 })), 100, thrower.ai.throwRange + 1);
    expect(far.intents.some((i) => i.throw)).toBe(false);
    expect(duel(catcher, sharp, scriptedController(walk(200, { x: 0, z: 1 })), 200).intents.some((i) => i.throw)).toBe(false);
  });

  it('a throw is deterministic: the same hash at the end of two runs', () => {
    const a = duel(thrower, { ...sharp, mistakeRate: 0.3 }, scriptedController(walk(400, { x: 0, z: 1 })), 240, 5, 7);
    const b = duel(thrower, { ...sharp, mistakeRate: 0.3 }, scriptedController(walk(400, { x: 0, z: 1 })), 240, 5, 7);
    expect(hashValue(a.run.final)).toBe(hashValue(b.run.final));
  });

  /** Fighter 0 (scripted) throws at the AI, Fighter 1, `gap` m away, on Tick 10; it stands 0.2 m to the right so the dagger flies at the AI. */
  function thrownAt(difficulty: AiDifficulty, seed = 1, gap = 8, block?: Track) {
    const ai = createAiController(catcher, difficulty);
    const initial = createInitialState(catcher, seed, [{ position: { x: -0.2, z: 0 }, facing: 0 }, { position: { x: 0, z: gap }, facing: Math.PI }]);
    return runControllers(catcher, initial, [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)]), block ? scriptedController(block) : ai], 200);
  }

  it('turns and Blocks a throw it sees in time', () => {
    const run = thrownAt(sharp);
    expect(run.events.filter((e) => e.type === 'DaggerBlocked' && e.defender === 1)).toHaveLength(1);
    expect(run.events.some((e) => e.type === 'DaggerHit')).toBe(false);
  });

  it('an unthreatened target is hit by the same throw (so the Block was the AI)', () => {
    const run = thrownAt(sharp, 1, 8, wait(200));
    expect(run.events.some((e) => e.type === 'DaggerHit' && e.defender === 1)).toBe(true);
  });

  it('Blocks a throw even when it had its back turned', () => {
    const ai = createAiController(catcher, sharp);
    const initial = createInitialState(catcher, 1, [{ position: { x: -0.2, z: 0 }, facing: 0 }, { position: { x: 0, z: 8 }, facing: 0 }]);
    const run = runControllers(catcher, initial, [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)]), ai], 200);
    expect(run.events.some((e) => e.type === 'DaggerBlocked' && e.defender === 1)).toBe(true);
  });

  it('lets go of a Block held from before the throw and raises it again, so the dagger is Blocked', () => {
    const ai = createAiController(catcher, sharp);
    const initial = createInitialState(catcher, 1, [{ position: { x: -0.2, z: 0 }, facing: 0 }, { position: { x: 0, z: 8 }, facing: Math.PI }]);
    // Fighter 0's own track is long enough; the AI is helped into a Block first by a wrapper that holds one until the throw is seen.
    const early = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (s.tick < 14 ? { ...IDLE_INTENT, block: true, direction: 'Overhead' as Direction, face: Math.PI } : ai.intent(s, i)) };
    const run = runControllers(catcher, initial, [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)]), early], 200);
    expect(run.events.some((e) => e.type === 'DaggerBlocked' && e.defender === 1)).toBe(true);
    expect(run.events.some((e) => e.type === 'DaggerHit')).toBe(false);
  });

  it('with a mistake rate of 1 it never reacts, so a throw hits it', () => {
    const run = thrownAt({ reactionTime: 0.1, mistakeRate: 1, feintRate: 0 });
    expect(run.events.some((e) => e.type === 'DaggerHit' && e.defender === 1)).toBe(true);
  });

  it('a higher mistake rate lets more throws through over many Duels', () => {
    const hits = (mistakeRate: number) => {
      let n = 0;
      for (let seed = 1; seed <= 20; seed++) n += thrownAt({ reactionTime: 0.1, mistakeRate, feintRate: 0 }, seed).events.filter((e) => e.type === 'DaggerHit').length;
      return n;
    };
    expect(hits(0)).toBe(0);
    expect(hits(0.5)).toBeGreaterThan(0);
    expect(hits(0.5)).toBeLessThan(20);
  });
});

describe('AI Controller: jump Links', { timeout: 60_000 }, () => {
  /** An AI (Fighter 0) at `me` and an idle enemy (Fighter 1) at `it`, in `arena`; each `[x, y, z]`. */
  const standoff = (arena: string, me: [number, number, number], it: [number, number, number], seed = 1) =>
    createInitialState(repo, seed, [me, it].map(([x, y, z]) => ({ position: { x, z }, y, facing: 0 })), [], [0, 1], arena);
  const surfaceOf = (arena: string, f: { position: { x: number; z: number }; y: number }) => {
    const a = repo.arenas[arena]!;
    return a.walk[groundBelow(a, f.position.x, f.position.z, f.y + 1e-6)?.surface ?? -1]?.id;
  };
  const chase = (difficulty: string, arena: string, me: [number, number, number], it: [number, number, number], seconds: number, seed = 1) =>
    runControllers(repo, standoff(arena, me, it, seed), [createAiController(repo, difficulty), scriptedController(wait(1))], TICK_RATE * seconds);

  it('a Normal AI on the summit plateau Jumps onto the containers to reach an enemy standing on them', () => {
    const run = chase('Normal', 'summit', [0, 2, -8], [3, 2.5, -4.1], 15);
    const on = run.states.findIndex((s) => surfaceOf('summit', s.fighters[0]!) === 'WALK_containers_top');
    expect(on, 'it never got onto the containers').toBeGreaterThan(0);
    expect(run.events.some((e) => e.type === 'Jump' && e.fighter === 0)).toBe(true);
    expect(run.states.every((s) => !s.fighters[0]!.death)).toBe(true);
  });

  it('a Hard AI on the chamber ring Jumps across onto a catwalk to reach an enemy on it', () => {
    const run = chase('Hard', 'chamber', [2, 0, 4], [0, 0, 12.5], 15);
    const on = run.states.findIndex((s) => surfaceOf('chamber', s.fighters[0]!) === 'WALK_catwalk0');
    expect(on, 'it never got onto the catwalk').toBeGreaterThan(0);
    expect(run.states.every((s) => !s.fighters[0]!.death)).toBe(true);
  });

  it('an Easy AI only taps: it never holds Jump for a jump Link, so it never gets onto the catwalk', () => {
    const run = chase('Easy', 'chamber', [2, 0, 4], [0, 0, 12.5], 15);
    expect(run.states.some((s) => surfaceOf('chamber', s.fighters[0]!) === 'WALK_catwalk0')).toBe(false);
    expect(run.states.every((s) => !s.fighters[0]!.death)).toBe(true);
  });

  it('without `jumpNav` (the plain AI) it takes no jump Links', () => {
    const run = runControllers(repo, standoff('summit', [0, 2, -8], [3, 2.5, -4.1]), [createAiController(repo, { reactionTime: 0.2, mistakeRate: 0, feintRate: 0 }), scriptedController(wait(1))], TICK_RATE * 10);
    expect(run.events.some((e) => e.type === 'Jump' && e.fighter === 0)).toBe(false);
  });

  it('is deterministic: the same seed gives the same Ticks', () => {
    const a = chase('Normal', 'summit', [0, 2, -8], [3, 2.5, -4.1], 8, 5);
    const b = chase('Normal', 'summit', [0, 2, -8], [3, 2.5, -4.1], 8, 5);
    expect(a.states.map((s) => hashValue(s))).toEqual(b.states.map((s) => hashValue(s)));
  });

  it('keeps its jump in its memory: restored mid-run-up, it decides exactly as it would have', () => {
    const initial = standoff('summit', [0, 2, -8], [3, 2.5, -4.1]);
    const ai = createAiController(repo, 'Normal');
    // Run a Tick at a time until it is lining up a jump Link.
    let s = initial;
    let saved: unknown = null;
    for (let t = 0; t < TICK_RATE * 10 && saved === null; t++) {
      s = runControllers(repo, s, [ai, scriptedController(wait(1))], 1).final;
      const memory = ai.save!() as { jumpRun: { stage: string } | null };
      if (memory.jumpRun && memory.jumpRun.stage !== 'Fly') saved = memory;
    }
    expect(saved, 'it never lined up a Jump').not.toBeNull();
    const restored = createAiController(repo, 'Normal');
    restored.load!(saved);
    const a = runControllers(repo, s, [ai, scriptedController(wait(1))], 120);
    const b = runControllers(repo, s, [restored, scriptedController(wait(1))], 120);
    expect(hashValue(b.final)).toBe(hashValue(a.final));
  });
});

describe('AI Controller: follows onto every held-Jump spot', { timeout: 120_000 }, () => {
  /** A Hard (or Normal) AI 0.8 m back from where the spot's Jump takes off, an idle enemy where that Jump lands: the Tick the AI stands on the same Walk Surface, or -1. */
  function follow(difficulty: string, s: (typeof JUMP_SPOTS)[number], seconds = 20): number {
    const arena = repo.arenas[s.arena]!;
    const y = groundBelow(arena, s.x, s.z, s.y + repo.fall.stepUp)!.y;
    const lands = jumpArc(arena, repo, { at: { x: s.x, z: s.z }, y, heading: s.move, holdTicks: s.hold }).lands!;
    const lid = groundBelow(arena, lands.x, lands.z, lands.y + 1e-6)!.surface;
    const start = { x: s.x - s.move.x * 0.8, z: s.z - s.move.z * 0.8 };
    const initial = createInitialState(repo, 1, [{ position: start, y, facing: 0 }, { position: lands, y: lands.y, facing: Math.PI }], [], [0, 1], s.arena);
    const run = runControllers(repo, initial, [createAiController(repo, difficulty), scriptedController(wait(1))], TICK_RATE * seconds);
    expect(run.states.every((st) => !st.fighters[0]!.death), `${s.spot}: the AI died`).toBe(true);
    return run.states.findIndex((st) => {
      const f = st.fighters[0]!;
      return !f.air && groundBelow(arena, f.position.x, f.position.z, f.y + 1e-6)?.surface === lid;
    });
  }

  it('a Hard AI follows an enemy onto each of them, on every Arena (and a Normal one onto those held no longer than its jumpNav)', () => {
    const report: string[] = [];
    for (const s of JUMP_SPOTS) {
      const hard = follow('Hard', s);
      const normal = follow('Normal', s);
      report.push(`${s.arena} ${s.spot}: Hard ${hard < 0 ? 'no' : `${(hard / TICK_RATE).toFixed(1)} s`}, Normal ${normal < 0 ? 'no' : `${(normal / TICK_RATE).toFixed(1)} s`}`);
      expect(hard, `Hard onto ${s.arena} ${s.spot}`).toBeGreaterThan(0);
    }
    console.log(report.join('\n'));
  });
});
