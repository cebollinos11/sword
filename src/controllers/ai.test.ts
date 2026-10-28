import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type AiDifficulty, type TuningData } from '../tuning';
import { attack, IDLE_INTENT, SHEATHED_IDLE_MOTION, createInitialState, createMatch, DIRECTIONS, duelPlacements, groundBelow, hashValue, jumpArc, hold, TICK_RATE, wait, walk, type Direction, type Intent, type SimState, type Track } from '../sim';
import { JUMP_SPOTS } from '../sim/jumpSpots.testdata';
import { aiDifficulty, aiStyle, createAiController, runControllers, runMatch, scriptedController } from './index';
import { skillOf, stepIsSafe } from './ai';

const repo = loadTuningData();
/** The AI never starts Attacks of its own here, so it is free to defend. */
const passive: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0 } };

/** The Stage 3 feel knobs off: tests of other knobs on the new tiers play them as they were before it. */
const NO_FEEL = { rhythm: 0, reactionJitter: 0, humanMistakes: 0, idleLife: 0, jumpStep: 0 };

const DISTANCE = 1.3; // every Direction hits from here (see directions.test.ts)
const defaultWeapon = Object.keys(repo.weapons)[0]!;
/** The chest height (m) the AI aims at, and how much further a Thrust reaches (ai.ts AIM_HEIGHT, THRUST_REACH). */
const AIM = 1.3;
const THRUST = 0.15;

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

  /** Whether `face` turns toward +x (rather than +z/-z). */
  const facesX = (face: number) => Math.sin(face) > 0.9;

  it('keeps fighting its enemy while another comes only a little nearer', () => {
    // Its enemy waits 2.5 m to its right (+x); a second enemy walks in from far ahead (+z) and stops 2 m away.
    const ai = createAiController(passive, perfect);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: 2.5, z: 0 }, facing: -Math.PI / 2 },
      { position: { x: 0, z: 6 }, facing: Math.PI },
    ];
    const initial = createInitialState(passive, 1, placements, [], [0, 1, 1]);
    const ticks = 240;
    const run = runControllers(passive, initial, [recording, scriptedController(wait(ticks)), scriptedController([...walk(ticks, { x: 0, z: -1 })])], ticks);
    // Ticks (after its Reaction Time) on which the walker is nearer than its first enemy, but by less than 1.5 m.
    const dist = (s: (typeof run.states)[number], k: number) => Math.hypot(s.fighters[k]!.position.x - s.fighters[0]!.position.x, s.fighters[k]!.position.z - s.fighters[0]!.position.z);
    const closer = [...intents.keys()].filter((t) => {
      const seen = run.states[t - reactionTicks];
      return seen && dist(seen, 2) < dist(seen, 1) && dist(seen, 2) > dist(seen, 1) - 1.4;
    });
    expect(closer.length).toBeGreaterThan(5);
    for (const t of closer) expect(facesX(intents[t]!.face!), `tick ${t}`).toBe(true);
  });

  it('turns on an enemy that attacks it from behind, and stays on it once the Attack is over', () => {
    // Its nearest enemy idles ahead (+z); a second enemy steps up behind it (-z), swings an Overhead at it, then backs off.
    const ai = createAiController(passive, perfect);
    const intents: Intent[] = [];
    const recording = { intent: (s: Parameters<typeof ai.intent>[0], i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: 0, z: 1.2 }, facing: Math.PI },
      { position: { x: 0, z: -1.3 }, facing: 0 },
    ];
    const initial = createInitialState(passive, 1, placements, [], [0, 1, 1]);
    const ticks = 200;
    const run = runControllers(passive, initial, [recording, scriptedController(wait(ticks)), scriptedController([...wait(20), ...attack('Overhead', 1), ...wait(60), ...walk(ticks, { x: 0, z: -1 })])], ticks);
    expect(run.events.some((e) => e.type === 'Block' && e.attacker === 2 && e.defender === 0)).toBe(true);
    // Once the Attack is over and it backs off, the one ahead is the nearer by far; it still faces the one behind (-z).
    const after = intents.slice(150, 200);
    expect(after.every((i) => Math.cos(i.face!) < -0.9)).toBe(true);
  });
});

describe('AI Controller in the multilevel library', () => {
  const repo = loadTuningData();
  const inLibrary = (placements: { x: number; y: number; z: number; facing: number }[], teams: number[]) =>
    createInitialState(repo, 1, placements.map(({ x, y, z, facing }) => ({ position: { x, z }, y, facing })), [], teams, 'library');

  const surfaceOf = (f: { position: { x: number; z: number }; y: number }) => library.walk[groundBelow(library, f.position.x, f.position.z, f.y + 1e-6)?.surface ?? -1]?.id;
  const library = repo.arenas.library!;

  it('finds its way from the ground floor up to an enemy on the gallery, Jumping onto the bridge, and engages it there', () => {
    const initial = inLibrary([{ x: -4.5, y: 0, z: -4.5, facing: Math.PI / 2 }, { x: 5, y: 6, z: 10.5, facing: Math.PI }], [0, 1]);
    const run = runControllers(repo, initial, [createAiController(repo, 'Normal'), scriptedController(wait(1))], TICK_RATE * 60);
    const engaged = run.events.find((e) => e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Wind-up');
    expect(engaged, 'the AI never attacked').toBeDefined();
    const at = run.states[engaged!.tick]!.fighters[0]!;
    // On the gallery (it may leap in with a jumping Attack), within the reach it steps in and swings from.
    expect(Math.abs(at.y - 6)).toBeLessThan(0.5);
    expect(Math.hypot(at.position.x - 5, at.position.z - 10.5)).toBeLessThan(repo.ai.attackRange + 1.4);
    // It Jumped up onto the bridge rather than walking round by a ramp, and landed unhurt.
    const before = run.states.slice(0, engaged!.tick).map((s) => surfaceOf(s.fighters[0]!));
    expect(before).toContain('WALK_bridge');
    expect(before.some((n) => n === 'WALK_ramp_west' || n === 'WALK_ramp_east')).toBe(false);
    expect(run.events.some((e) => e.type === 'Land' && e.fighter === 0 && e.damage > 0 && e.tick <= engaged!.tick)).toBe(false);
  });

  for (const difficulty of ['Easy', 'Normal', 'Hard']) {
    it(`${difficulty}: Jumps up onto the mezzanine to reach an enemy standing there, rather than walking round by the ramps`, () => {
      const initial = inLibrary([{ x: -5, y: 0, z: 4, facing: -Math.PI / 2 }, { x: -10.5, y: 3, z: 4, facing: Math.PI / 2 }], [0, 1]);
      const run = runControllers(repo, initial, [createAiController(repo, difficulty), scriptedController(wait(1))], TICK_RATE * 10);
      const up = run.states.findIndex((s) => !s.fighters[0]!.air && surfaceOf(s.fighters[0]!) === 'WALK_mezz_west');
      expect(up, 'it never got onto the mezzanine').toBeGreaterThan(0);
      // Walking round by the west ramp is over 20 m: some 6 s. The Jump takes well under half that.
      expect(up).toBeLessThan(TICK_RATE * 3);
      expect(run.states.slice(0, up).some((s) => surfaceOf(s.fighters[0]!) === 'WALK_ramp_west')).toBe(false);
    });
  }

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

describe('AI Controller: a step is safe', () => {
  // An L of floor: x -3..0 north of z 0, x 0..3 all along; the corner x < 0, z < 0 is open to the Abyss.
  const corner = parseArena(
    {
      name: 'corner',
      walk: [
        { id: 'WALK_west', points: [[-3, 0, 0], [0, 0, 0], [0, 0, 4], [-3, 0, 4]] },
        { id: 'WALK_east', points: [[0, 0, -4], [3, 0, -4], [3, 0, 0], [0, 0, 0]] },
        { id: 'WALK_east_north', points: [[0, 0, 0], [3, 0, 0], [3, 0, 4], [0, 0, 4]] },
        { id: 'WALK_abyss', abyss: true, points: [[-10, -8, -10], [10, -8, -10], [10, -8, 10], [-10, -8, 10]] },
      ],
      walls: [],
    },
    'corner',
  );
  const heading = (x: number, z: number) => ({ x: x / Math.hypot(x, z), z: z / Math.hypot(x, z) });

  it('is not, off a ledge into the Abyss', () => {
    expect(stepIsSafe(corner, repo, { x: -1.5, z: 0.3 }, 0, heading(0, -1))).toBe(false);
    expect(stepIsSafe(corner, repo, { x: -1.5, z: 0.3 }, 0, heading(0, 1))).toBe(true);
    expect(stepIsSafe(corner, repo, { x: 1.5, z: 0.3 }, 0, heading(0, -1))).toBe(true);
  });

  it('is not, cutting an open corner between the points it looks at (Generated Arena seed 31)', () => {
    // Just west of x 0 by the corner, heading a little east of south: every point ahead it looks at is floor,
    // but the straight walk there crosses the open corner first.
    expect(stepIsSafe(corner, repo, { x: -0.01, z: 0.1 }, 0, heading(0.04, -1))).toBe(false);
    // Clear of the corner, the same heading is safe.
    expect(stepIsSafe(corner, repo, { x: 0.3, z: 0.1 }, 0, heading(0.04, -1))).toBe(true);
  });

  // A platform 3 m up (z < 0), a ramp down from its edge (half a metre down a metre), and beside both a floor 0.5 m below.
  const ramp = parseArena(
    {
      name: 'ramp',
      walk: [
        { id: 'WALK_top', points: [[-1.5, 3, -4], [1.5, 3, -4], [1.5, 3, 0], [-1.5, 3, 0]] },
        { id: 'WALK_ramp', points: [[-1.5, 3, 0], [1.5, 3, 0], [1.5, 0, 6], [-1.5, 0, 6]] },
        { id: 'WALK_ledge', points: [[1.5, 2.5, -4], [4, 2.5, -4], [4, 2.5, 0], [1.5, 2.5, 0]] },
        { id: 'WALK_abyss', abyss: true, points: [[-10, -8, -10], [10, -8, -10], [10, -8, 10], [-10, -8, 10]] },
      ],
      walls: [],
    },
    'ramp',
  );

  it('is, walking down a ramp (the soak\'s seed 6: two Ally AIs on a ramp\'s top edge could not step aside down it)', () => {
    expect(stepIsSafe(ramp, repo, { x: 0, z: -0.1 }, 3, heading(0, 1))).toBe(true);
    expect(stepIsSafe(ramp, repo, { x: 0, z: 2 }, 2, heading(0, 1))).toBe(true);
    expect(stepIsSafe(ramp, repo, { x: 0.5, z: 2 }, 2, heading(-1, 1))).toBe(true);
    // ...but not off the platform's side, down the 0.5 m ledge.
    expect(stepIsSafe(ramp, repo, { x: 1.2, z: -2 }, 3, heading(1, 0))).toBe(false);
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

  it('starts no jump Link while it sees its enemy in the air: it waits to see where it lands (Generated Arena seed 12)', () => {
    // Two AIs on two levels each chasing the other's took the same Links at once, swapping levels again and again.
    const h = 2;
    const ledge = parseArena(
      {
        name: 'ledge',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
          { id: 'WALK_ledge', points: [[-3, h, -3], [3, h, -3], [3, h, 1], [-3, h, 1]] },
        ],
        walls: [
          { id: 'WALL_n', a: [3, 1], b: [-3, 1], bottom: 0, top: h },
          { id: 'WALL_e', a: [3, -3], b: [3, 1], bottom: 0, top: h },
          { id: 'WALL_w', a: [-3, 1], b: [-3, -3], bottom: 0, top: h },
          { id: 'WALL_s', a: [-3, -3], b: [3, -3], bottom: 0, top: h },
        ],
      },
      'ledge',
    );
    const tuning: TuningData = { ...repo, arenas: { ...repo.arenas, ledge }, ai: { ...repo.ai, kickRate: 0, throwRate: 0 } };
    const hard = aiDifficulty(repo, 'Hard');
    const reaction = Math.round(hard.reactionTime * TICK_RATE);
    // The enemy, up on the ledge, Jumps on the spot over and over.
    const hop: Track = [...hold(1, { jump: true, jumpHeld: true }), ...hold(20, { jumpHeld: true }), ...wait(90)];
    const initial = createInitialState(tuning, 1, [{ position: { x: 0, z: 4 }, facing: Math.PI }, { position: { x: 0, z: -1 }, y: h, facing: 0 }], [], [0, 1], 'ledge');
    const run = runControllers(tuning, initial, [createAiController(tuning, hard), scriptedController(Array.from({ length: 6 }, () => hop).flat())], TICK_RATE * 10);
    const jumps = run.events.filter((e) => e.type === 'Jump' && e.fighter === 0);
    expect(jumps.length, 'it never Jumped up').toBeGreaterThan(0);
    // Its Jump on Tick t was pressed looking at the enemy as it was Reaction Time before Tick t - 1.
    for (const j of jumps) expect(run.states[j.tick - 1 - reaction]!.fighters[1]!.air, `Jump on Tick ${j.tick}`).toBeUndefined();
    expect(run.states.at(-1)!.fighters[0]!.y).toBe(h);
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

describe('AI Controller: every Jump it makes is checked', { timeout: 120_000 }, () => {
  /** A floor and a ledge `h` high (x -3..3, z -3..1), walled up to its top; a Hard AI (jumpy) on the ledge, the enemy waiting on the floor in front of it. Its first Jump, and what came of it. */
  function leapDown(h: number, seed: number, enemyZ = 3.2) {
    const ledge = parseArena(
      {
        name: 'ledge',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
          { id: 'WALK_ledge', points: [[-3, h, -3], [3, h, -3], [3, h, 1], [-3, h, 1]] },
        ],
        walls: [
          { id: 'WALL_n', a: [3, 1], b: [-3, 1], bottom: 0, top: h },
          { id: 'WALL_e', a: [3, -3], b: [3, 1], bottom: 0, top: h },
          { id: 'WALL_w', a: [-3, 1], b: [-3, -3], bottom: 0, top: h },
          { id: 'WALL_s', a: [-3, -3], b: [3, -3], bottom: 0, top: h },
        ],
      },
      'ledge',
    );
    const tuning: TuningData = { ...repo, arenas: { ...repo.arenas, ledge }, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0, throwRate: 0 } };
    const leaper = { ...aiDifficulty(repo, 'Hard'), jumpAttackRate: 0.2, throwRate: 0 };
    const initial = createInitialState(tuning, seed, [{ position: { x: 0, z: -0.5 }, y: h, facing: 0 }, { position: { x: 0, z: enemyZ }, y: 0, facing: Math.PI }], [], [0, 1], 'ledge');
    const run = runControllers(tuning, initial, [createAiController(tuning, leaper), scriptedController(wait(1))], 300);
    const jump = run.events.find((e) => e.type === 'Jump' && e.fighter === 0);
    if (!jump) return null;
    return {
      from: run.states[jump.tick - 1]!.fighters[0]!.y,
      action: run.states[jump.tick]!.fighters[0]!.action,
      hit: run.events.some((e) => e.type === 'Hit' && e.attacker === 0 && e.tick > jump.tick && e.tick < jump.tick + 60),
      hurt: run.events.some((e) => e.type === 'Land' && e.fighter === 0 && e.damage > 0),
    };
  }

  it('from a raised ledge, a Hard AI leaps down at an enemy below with an Overhead that lands', () => {
    // The ledge's edge is at z 1: the enemy stands from just below it to beyond a Jump's reach.
    let leaps = 0;
    let hits = 0;
    for (const enemyZ of [2.2, 2.7, 3.2]) {
      for (let seed = 1; seed <= 4; seed++) {
        const leap = leapDown(0.7, seed, enemyZ);
        if (!leap || leap.from < 0.7 - 1e-9) continue; // it walked off, or dropped down first
        expect(leap.action).toMatchObject({ kind: 'Attack', direction: 'Overhead' });
        expect(leap.hurt).toBe(false);
        leaps++;
        if (leap.hit) hits++;
      }
    }
    expect(leaps, 'it hardly ever leapt down').toBeGreaterThanOrEqual(3);
    expect(hits, `only ${hits} of its ${leaps} jumping Attacks down landed`).toBe(leaps);
  });

  /** Two jumpy AIs (Hard, leaping and hopping back at every chance) fighting at `places` in `arena` for `ticks`: neither dies by Water or a Fall. */
  function soak(arena: string, places: [number, number, number][], seed: number, ticks = 600) {
    const tuning: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0 } };
    const jumpy = { ...aiDifficulty(repo, 'Hard'), jumpAttackRate: 0.3, caution: 1, kickRate: 0 };
    const initial = createInitialState(tuning, seed, places.map(([x, y, z], i) => ({ position: { x, z }, y, facing: i === 0 ? 0 : Math.PI })), [], [0, 1], arena);
    const run = runControllers(tuning, initial, [createAiController(tuning, jumpy), createAiController(tuning, jumpy)], ticks);
    const jumps = run.events.filter((e) => e.type === 'Jump').length;
    const deaths = run.events.filter((e) => e.type === 'Death');
    return { jumps, deaths };
  }

  it("never Jumps off the ship's rail into the sea", () => {
    let jumps = 0;
    for (const seed of [1, 2, 3]) {
      const r = soak('ship', [[2.4, 0, 3], [2.4, 0, 5.2]], seed);
      jumps += r.jumps;
      expect(r.deaths, `seed ${seed}`).toEqual([]);
    }
    expect(jumps, 'they never jumped: the soak proves nothing').toBeGreaterThan(5);
  });

  /** `walk` (with a Lava sheet 1 m down under all of it), the AI (Fighter 0, `ai`) at `me` and an idle enemy at `it`; whether the AI dies, and how often it Jumps. */
  function overLava(walk: unknown[], ai: AiDifficulty, me: [number, number, number], it: [number, number, number], ticks: number, hp = 1) {
    const arena = parseArena({ name: 'lava', walk: [...walk, { id: 'WALK_lava', lava: true, points: [[-10, -1, -10], [10, -1, -10], [10, -1, 10], [-10, -1, 10]] }] }, 'lava');
    const tuning: TuningData = { ...repo, arenas: { ...repo.arenas, lava: arena }, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0, throwRate: 0 } };
    const placed = createInitialState(tuning, 1, [me, it].map(([x, y, z], i) => ({ position: { x, z }, y, facing: i === 0 ? Math.atan2(it[0] - x, it[2] - z) : Math.atan2(x - it[0], z - it[2]) })), [], [0, 1], 'lava');
    const initial = { ...placed, fighters: placed.fighters.map((f, i) => (i === 0 ? { ...f, hp: hp * tuning.fighter.maxHp } : f)) };
    const run = runControllers(tuning, initial, [createAiController(tuning, ai), scriptedController(wait(1))], ticks);
    return { died: run.states.some((s) => s.fighters[0]!.death !== undefined), jumps: run.events.filter((e) => e.type === 'Jump' && e.fighter === 0).length };
  }

  it('Disengaging at the tip of a pier over Lava, it never hops back into the Lava', () => {
    // A 1.5 m-wide pier running out to z 0; the AI at its tip, low on HP (so it Disengages), its enemy in its face.
    const pier = [{ id: 'WALK_pier', points: [[-0.75, 0, -8], [0.75, 0, -8], [0.75, 0, 0], [-0.75, 0, 0]] }];
    // Low on HP, a caution this high makes every tactic it picks Disengage.
    const hopper = { ...aiDifficulty(repo, 'Hard'), aggression: 0, pressure: 0, caution: 3, jumpAttackRate: 1, kickRate: 0, throwRate: 0 };
    const r = overLava(pier, hopper, [0, 0, -0.5], [0, 0, -1.8], 600, 0.2);
    expect(r.died).toBe(false);
    expect(r.jumps).toBe(0);
  });

  it('never leaps at an enemy across a Lava pool with a jumping Attack that comes down in it', () => {
    // A floor around a pool (x -2..2, z 0..1.6); the AI on its south side, the enemy just across on the north.
    const ring = [
      { id: 'WALK_s', points: [[-6, 0, -6], [6, 0, -6], [6, 0, 0], [-6, 0, 0]] },
      { id: 'WALK_n', points: [[-6, 0, 1.6], [6, 0, 1.6], [6, 0, 8], [-6, 0, 8]] },
      { id: 'WALK_w', points: [[-6, 0, 0], [-2, 0, 0], [-2, 0, 1.6], [-6, 0, 1.6]] },
      { id: 'WALK_e', points: [[2, 0, 0], [6, 0, 0], [6, 0, 1.6], [2, 0, 1.6]] },
    ];
    const leaper = { ...aiDifficulty(repo, 'Hard'), jumpAttackRate: 1, kickRate: 0, throwRate: 0 };
    const r = overLava(ring, leaper, [0, 0, -0.3], [0, 0, 2.0], 300);
    expect(r.died).toBe(false);
  });

  it("never Jumps off the train's nose or sides", () => {
    let jumps = 0;
    for (const seed of [1, 2, 3]) {
      const r = soak('train', [[0.5, 0.5, 26.5], [0.5, 0.5, 31.3]], seed);
      jumps += r.jumps;
      expect(r.deaths, `seed ${seed}`).toEqual([]);
    }
    // On the narrow nose a jumping Attack seldom lands, so they seldom leap: the Lava scenarios above are what prove the check.
    expect(jumps, 'they never jumped: the soak proves nothing').toBeGreaterThanOrEqual(3);
  });
});

describe('AI Controller: Jumps in a fight', { timeout: 120_000 }, () => {
  const tough: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 }, ai: { ...repo.ai, kickRate: 0, throwRate: 0 } };

  /** Over seeds 1..10, how often the AI (at the centre) lands a Hit with an Attack Released as an enemy lands a Jump made toward it from 4 m (the Hit comes as its blade gets there, within the Release). */
  function punishes(difficulty: string): number {
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const toward = { x: 0, z: -1 };
      const jumper: Track = [...wait(40), { ticks: 1, intent: { ...IDLE_INTENT, move: toward, jump: true } }, { ticks: 30, intent: { ...IDLE_INTENT, move: toward } }, ...wait(60)];
      const initial = createInitialState(tough, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 4 }, facing: Math.PI }]);
      const run = runControllers(tough, initial, [createAiController(tough, { ...aiDifficulty(repo, difficulty), throwRate: 0, kickRate: 0 }), scriptedController(jumper)], 130);
      const land = run.events.find((e) => e.type === 'Land' && e.fighter === 1)!;
      expect(land, `seed ${seed}: the enemy never landed`).toBeDefined();
      if (run.events.some((e) => e.type === 'Hit' && e.attacker === 0 && e.tick >= land.tick - 2 && e.tick <= land.tick + 20)) hits++;
    }
    return hits;
  }

  it('a Hard AI punishes an enemy landing a Jump far more often than a Normal one; an Easy one does not try', () => {
    const hard = punishes('Hard');
    const normal = punishes('Normal');
    const easy = punishes('Easy');
    console.log(`landing punishes over 10 seeds: Hard ${hard}, Normal ${normal}, Easy ${easy}`);
    // Every Landing it rolls to meet, it hits: what it misses is its roll saying no, or being mid-Attack already as the enemy jumps.
    expect(hard).toBeGreaterThanOrEqual(8);
    expect(hard).toBeGreaterThan(normal);
    expect(easy).toBeLessThanOrEqual(1);
  });

  /** A floor with a 1 m lid (x -3..3, z 3..7) walled up to its top; the AI (low on HP, so it Disengages) just south of it, an idle enemy pressing it from further south. */
  function escape(difficulty: AiDifficulty, ticks = 600) {
    const lid = parseArena(
      {
        name: 'lid',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 20], [-10, 0, 20]] },
          { id: 'WALK_lid', points: [[-3, 1, 3], [3, 1, 3], [3, 1, 7], [-3, 1, 7]] },
        ],
        walls: [
          { id: 'WALL_s', a: [-3, 3], b: [3, 3], bottom: 0, top: 1 },
          { id: 'WALL_e', a: [3, 3], b: [3, 7], bottom: 0, top: 1 },
          { id: 'WALL_n', a: [3, 7], b: [-3, 7], bottom: 0, top: 1 },
          { id: 'WALL_w', a: [-3, 7], b: [-3, 3], bottom: 0, top: 1 },
        ],
      },
      'lid',
    );
    const tuning: TuningData = { ...tough, arenas: { ...tough.arenas, lid } };
    const placed = createInitialState(tuning, 3, [{ position: { x: 0, z: 2.1 }, facing: Math.PI }, { position: { x: 0, z: 0.9 }, facing: 0 }], [], [0, 1], 'lid');
    const initial = { ...placed, fighters: placed.fighters.map((f, i) => (i === 0 ? { ...f, hp: 0.2 * tuning.fighter.maxHp } : f)) };
    const run = runControllers(tuning, initial, [createAiController(tuning, difficulty), scriptedController(wait(1))], ticks);
    return run.states.some((s) => s.fighters[0]!.y === 1 && !s.fighters[0]!.air);
  }

  it('a Hard AI Disengaging next to a lid Jumps up onto it, away from its enemy; an Easy one does not', () => {
    const wary = { caution: 1, pressure: 0, aggression: 0, jumpAttackRate: 0, throwRate: 0, kickRate: 0 };
    expect(escape({ ...aiDifficulty(repo, 'Hard'), ...wary })).toBe(true);
    expect(escape({ ...aiDifficulty(repo, 'Easy'), ...wary })).toBe(false);
  });
});

describe('AI Controller: Sheathe and Draw', { timeout: 60_000 }, () => {
  /** Fighter 0 scripted by `a` against an AI Fighter 1, `distance` apart; `sheathed` starts the AI's own Fighter Sheathed (an AI Takeover). */
  function vsAiAt(difficulty: string, a: Track, ticks: number, opts: { distance: number; sheathed?: boolean; seed?: number }) {
    const ai = createAiController(repo, difficulty);
    const aiIntents: Intent[] = [];
    const recording = {
      intent: (s: Parameters<typeof ai.intent>[0], i: number) => {
        const intent = ai.intent(s, i);
        aiIntents.push(intent);
        return intent;
      },
    };
    let initial = createInitialState(repo, opts.seed ?? 1, duelPlacements(opts.distance));
    if (opts.sheathed) {
      initial = { ...initial, fighters: initial.fighters.map((f, i) => (i === 1 ? { ...f, sheathed: true, motion: { name: SHEATHED_IDLE_MOTION, tick: 0 } } : f)) };
    }
    const run = runControllers(repo, initial, [scriptedController(a), recording], ticks);
    return { run, aiIntents };
  }

  it('never presses sheathe, in a whole AI vs AI Match', () => {
    const pressed: Intent[] = [];
    const recording = (difficulty: string) => {
      const ai = createAiController(repo, difficulty);
      return {
        intent: (s: Parameters<typeof ai.intent>[0], i: number) => {
          const intent = ai.intent(s, i);
          if (intent.sheathe) pressed.push(intent);
          return intent;
        },
      };
    };
    const { final } = runMatch(repo, createMatch(repo, { bestOf: 1, seed: 7 }), [recording('Hard'), recording('Normal')], 30_000);
    expect(final.status.status).toBe('Over');
    expect(pressed).toEqual([]);
  });

  for (const difficulty of ['Easy', 'Normal', 'Hard']) {
    it(`taking over a Sheathed Fighter, a ${difficulty} AI Draws as it nears its enemy, presses nothing during the Draw, then fights`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const { run, aiIntents } = vsAiAt(difficulty, wait(900), 900, { distance: 5, sheathed: true, seed });
        const kinds = run.states.map((s) => s.fighters[1]!.action.kind);
        const drawStart = kinds.indexOf('Draw');
        // From 5 m it Draws within its Reaction Time and a few (fast, Sheathed) steps, not whenever it next rolls to attack.
        expect(drawStart, `seed ${seed}`).toBeGreaterThan(0);
        expect(drawStart, `seed ${seed}`).toBeLessThan(60);
        const drawEnd = kinds.indexOf('Idle', drawStart);
        expect(run.states[drawEnd]!.fighters[1]!.sheathed).toBe(false);
        // aiIntents[k] was chosen looking at states[k]: no attack, block or sheathe pressed while the Draw plays.
        expect(aiIntents.slice(drawStart, drawEnd).filter((i) => i.attack || i.block || i.sheathe)).toEqual([]);
        // Drawn, it fights: an Attack of its own lands on the dummy, and it stays drawn.
        expect(run.events.some((e) => e.type === 'Hit' && e.attacker === 1 && e.tick > drawEnd)).toBe(true);
        expect(run.states.at(-1)!.fighters[1]!.sheathed).toBe(false);
      }
    });
  }

  it('presses a Sheathed enemy: it closes and attacks within a second and a half, and never Feints at it', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { run } = vsAiAt('Hard', [...hold(1, { sheathe: true }), ...wait(400)], 400, { distance: 3.5, seed });
      expect(run.states[60]!.fighters[0]!.sheathed).toBe(true);
      const firstAttack = run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Attack');
      expect(firstAttack, `seed ${seed}`).toBeGreaterThan(0);
      expect(firstAttack, `seed ${seed}`).toBeLessThan(90);
      const firstHit = run.events.find((e) => e.type === 'Hit' && e.attacker === 1);
      expect(firstHit, `seed ${seed}`).toBeDefined();
      expect(run.events.filter((e) => e.type === 'Feint' && e.fighter === 1 && e.tick <= firstHit!.tick)).toEqual([]);
    }
  });

  it('presses an enemy who is in the middle of Sheathing, before the Weapon is away', () => {
    // An Arming Sword's hip Sheathe takes 0.7 s: from just outside swinging-in range its Attack is on the way before it ends.
    for (let seed = 1; seed <= 6; seed++) {
      const { run } = vsAiAt('Hard', [...hold(1, { sheathe: true }), ...wait(200)], 200, { distance: 2.5, seed });
      const sheathing = run.states.map((s) => s.fighters[0]!.action.kind).lastIndexOf('Sheathe');
      const firstAttack = run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Attack');
      expect(firstAttack, `seed ${seed}`).toBeGreaterThan(0);
      expect(firstAttack, `seed ${seed}`).toBeLessThanOrEqual(sheathing);
    }
  });
});

describe('AI Stage 1: new tiers and Styles (docs/plans/ai-behaviour.md)', () => {
  const ladder = [
    ['Easy', 'Beginner', 0.4],
    ['Normal', 'Skilled', 0.7],
    ['Hard', 'Expert', 0.9],
  ] as const;

  it('Beginner, Skilled and Expert play Easy, Normal and Hard with every new knob on, climbing the same ladder', () => {
    for (const [old, tier, knob] of ladder) {
      const { lowSwingRead, holdBreak, whiffCheck, punishFits, teamwork, rhythm: _r, reactionJitter: _j, humanMistakes: _h, idleLife: _i, jumpStep: _s, ...rest } = aiDifficulty(repo, tier);
      expect(rest, tier).toEqual(aiDifficulty(repo, old));
      expect([lowSwingRead, holdBreak, whiffCheck, punishFits, teamwork], tier).toEqual([knob, knob, knob, knob, knob]);
    }
  });

  it('Easy, Normal and Hard leave every new knob off', () => {
    for (const name of ['Easy', 'Normal', 'Hard']) {
      const skill = skillOf(repo, aiDifficulty(repo, name));
      expect([skill.lowSwingRead, skill.holdBreak, skill.whiffCheck, skill.punishFits, skill.teamwork], name).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('a Style scales the chances it names, clamped to 0..1, and never the Reaction Time or mistake rate', () => {
    const normal = aiDifficulty(repo, 'Normal');
    expect(skillOf(repo, normal, aiStyle(repo, 'Balanced'))).toEqual(skillOf(repo, normal));
    const style = { aggression: 2, footwork: 3, feintRate: 0, holdBreak: 5 };
    const scaled = skillOf(repo, normal, style);
    const plain = skillOf(repo, normal);
    expect(scaled.aggression).toBeCloseTo(plain.aggression * 2);
    expect(scaled.footwork).toBe(1); // 0.6 × 3, clamped
    expect(scaled.feintRate).toBe(0);
    expect(scaled.holdBreak).toBe(0); // off stays off: a Style never turns a new knob on
    expect([scaled.reactionTime, scaled.mistakeRate, scaled.jumpNav]).toEqual([plain.reactionTime, plain.mistakeRate, plain.jumpNav]);
    expect(skillOf(repo, aiDifficulty(repo, 'Skilled'), aiStyle(repo, 'Counter')).whiffCheck).toBeCloseTo(0.7 * 1.4);
  });

  it('every Style in Tuning Data plays differently from Balanced, and an unknown Style is refused', () => {
    const play = (style: string) => {
      const ais = [createAiController(repo, 'Skilled', style), createAiController(repo, 'Skilled', style)];
      return hashValue(runMatch(repo, createMatch(repo, { bestOf: 1, seed: 21 }), ais, 1500).final);
    };
    const balanced = play('Balanced');
    for (const style of Object.keys(repo.ai.styles).filter((s) => s !== 'Balanced')) expect(play(style), style).not.toBe(balanced);
    expect(() => createAiController(repo, 'Skilled', 'Sneaky')).toThrow(/Unknown AI Style/);
  }, 60_000);
});

describe('AI Stage 1: exploit fixes', { timeout: 60_000 }, () => {
  /** No attacking, Kicking, throwing, spacing or mistakes of its own: it stands where it is and defends. */
  const calm = { footwork: 0, pressure: 0, caution: 0, aggression: 0, kickRate: 0, throwRate: 0, mistakeRate: 0, feintRate: 0, chamberRate: 0, holdBreak: 0, whiffCheck: 0, punishFits: 0, ...NO_FEEL };
  const DEG = Math.PI / 180;
  const dist = (s: { fighters: readonly { position: { x: number; z: number } }[] }) => Math.hypot(s.fighters[0]!.position.x - s.fighters[1]!.position.x, s.fighters[0]!.position.z - s.fighters[1]!.position.z);

  it('ai.duckMaxPitch is derived from the Simulation: no Left or Right looking down less than it hits a Crouch, and a little more does', () => {
    // A Crouched dummy looking level, or at the attacker's chest as the AI aims (leaning back); every Weapon, in reach.
    const { crouchDepth, height } = repo.fighter;
    let highestHit = -Infinity;
    for (const weapon of Object.keys(repo.weapons)) {
      for (const gap of [1.0, 1.3]) {
        for (const look of [0, Math.atan2(AIM * (crouchDepth / height), gap)]) {
          for (const direction of ['Left', 'Right'] as const) {
            for (let deg = repo.ai.duckMaxPitch - 3; deg <= repo.ai.duckMaxPitch + 12; deg += 0.5) {
              const pitch = deg * DEG;
              const swing: Track = [...hold(30, { pitch }), ...hold(1, { attack: true, direction, pitch }), ...hold(80, { pitch })];
              const initial = createInitialState(repo, 1, duelPlacements(gap), [weapon, defaultWeapon]);
              const run = runControllers(repo, initial, [scriptedController(swing), scriptedController(hold(200, { crouch: true, pitch: look }))], 130);
              const hit = run.events.some((e) => e.type === 'Hit' && e.defender === 1);
              if (hit) highestHit = Math.max(highestHit, deg);
              if (deg >= repo.ai.duckMaxPitch) expect(hit, `${weapon} ${direction} from ${gap} m at ${deg}°, the dummy looking ${look}`).toBe(false);
            }
          }
        }
      }
    }
    // Not a guess: the threshold sits within 1° of the steepest look that still hits.
    expect(repo.ai.duckMaxPitch - highestHit).toBeLessThanOrEqual(1);
  });

  /** A Left or Right whose Wind-up is held 30 Ticks, looking `pitch` (radians) from the start, or only from `lowFrom` Ticks into the Wind-up. */
  const swing = (direction: Direction, pitch: number, lowFrom = 0): Track => [
    ...hold(30, { pitch: lowFrom > 0 ? 0 : pitch }),
    ...hold(lowFrom, { attack: true, direction, pitch: 0 }),
    ...hold(30 - lowFrom, { attack: true, direction, pitch }),
    ...hold(100, { pitch }),
  ];
  const easyDucker = { ...aiDifficulty(repo, 'Easy'), ...calm, duckRate: 1 };
  const reader = { ...aiDifficulty(repo, 'Beginner'), ...calm, duckRate: 1, lowSwingRead: 1 };
  const hitOn = (run: { events: readonly { type: string; defender?: number }[] }) => run.events.filter((e) => e.type === 'Hit' && e.defender === 1).length;

  it('lowSwingRead: a low-pitched Left or Right hits an Easy AI that Ducks it, while a Beginner reads the look and Blocks it', () => {
    for (const direction of ['Left', 'Right'] as const) {
      const ducked = vsAi(passive, easyDucker, swing(direction, -15 * DEG), 160);
      expect(ducked.aiIntents.some((i) => i.crouch), direction).toBe(true);
      expect(hitOn(ducked.run), direction).toBe(1);
      const read = vsAi(passive, reader, swing(direction, -15 * DEG), 160);
      expect(read.aiIntents.some((i) => i.crouch), direction).toBe(false);
      expect(read.run.events.filter((e) => e.type === 'Block'), direction).toEqual([expect.objectContaining({ defender: 1 })]);
      expect(hitOn(read.run), direction).toBe(0);
      // A level swing it still Ducks, unhurt.
      const level = vsAi(passive, reader, swing(direction, 0), 160);
      expect(level.aiIntents.some((i) => i.crouch), direction).toBe(true);
      expect(hitOn(level.run), direction).toBe(0);
    }
  });

  it('lowSwingRead: a look that drops mid-Wind-up turns its Duck into a Block', () => {
    for (const direction of ['Left', 'Right'] as const) {
      const read = vsAi(passive, reader, swing(direction, -15 * DEG, 12), 200);
      const firstCrouch = read.aiIntents.findIndex((i) => i.crouch);
      expect(firstCrouch, direction).toBeGreaterThan(0);
      expect(read.aiIntents.slice(firstCrouch).some((i) => i.block), direction).toBe(true);
      expect(hitOn(read.run), direction).toBe(0);
      expect(hitOn(vsAi(passive, easyDucker, swing(direction, -15 * DEG, 12), 200).run), direction).toBe(1);
    }
  });

  /** An Overhead Wind-up pressed on Tick 10 and held for `ticks`, standing (or walking after the AI, from Tick `chaseFrom`). */
  const held = (ticks: number, chaseFrom = Infinity): Track => [
    ...wait(10),
    ...hold(Math.min(ticks, chaseFrom), { attack: true, direction: 'Overhead' }),
    ...hold(Math.max(0, ticks - chaseFrom), { attack: true, direction: 'Overhead', move: { x: 0, z: 1 } }),
  ];
  const breaker = { ...aiDifficulty(repo, 'Skilled'), ...calm, holdBreak: 1 };
  const reach = repo.ai.attackRange;

  it('holdBreak: a held Wind-up no longer pins it: it backs out of reach keeping its Block, then baits from just outside', () => {
    const pinned = vsAi(passive, { ...breaker, holdBreak: 0 }, held(300), 300);
    expect(pinned.aiIntents.slice(60).every((i) => i.block)).toBe(true);
    expect(pinned.run.states.slice(60).every((s) => dist(s) < reach)).toBe(true);
    const free = vsAi(passive, breaker, held(300), 300);
    const out = free.run.states.findIndex((s, k) => k > 60 && dist(s) > reach + 0.1);
    expect(out, 'it never got out of reach').toBeGreaterThan(0);
    // Out there it lets its Block go (ready to punish), and it steps back in under its Block to bait the Release.
    expect(free.run.states.slice(out).some((s) => s.fighters[1]!.action.kind === 'Idle')).toBe(true);
    expect(free.run.states.slice(out).some((s) => dist(s) < reach && s.fighters[1]!.action.kind === 'Block')).toBe(true);
    expect(hitOn(free.run)).toBe(0);
  });

  it('holdBreak: an attacker walking after it while holding its Wind-up is Kicked down', () => {
    const chased = vsAi(passive, breaker, held(200, 60), 220);
    expect(chased.run.events.some((e) => e.type === 'KickLanded')).toBe(true);
    expect(chased.run.states.some((s) => s.fighters[0]!.action.kind === 'Knockdown')).toBe(true);
    expect(hitOn(chased.run)).toBe(0);
    const turtle = vsAi(passive, { ...breaker, holdBreak: 0 }, held(200, 60), 220);
    expect(turtle.run.events.some((e) => e.type === 'KickLanded')).toBe(false);
  });

  it('whiffCheck: a target backing out of reach makes it Feint into a Block rather than swing at air', () => {
    // It attacks the moment it can (aggression 1); the dummy backs off from the start, staying ahead of its walk.
    const swinger = (whiffCheck: number) => ({ reactionTime: 0.3, mistakeRate: 0, feintRate: 0, aggression: 1, kickRate: 0, throwRate: 0, whiffCheck });
    const backOff: Track = [...walk(60, { x: 0, z: -1 }), ...wait(200)];
    const releasesBeyond = (r: ReturnType<typeof vsAi>) => r.run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Release' && dist(r.run.states[e.tick]!) > reach + THRUST);
    const swung = vsAi(passive, swinger(0), backOff, 100);
    expect(releasesBeyond(swung)).not.toEqual([]);
    expect(swung.run.events.some((e) => e.type === 'Hit' && e.attacker === 1)).toBe(false);
    const checked = vsAi(passive, swinger(1), backOff, 100);
    expect(releasesBeyond(checked)).toEqual([]);
    expect(checked.run.events.some((e) => e.type === 'Feint' && e.fighter === 1 && e.into.kind === 'Block')).toBe(true);
    // A target it follows into reach is no whiff: it swings, and hits, as before.
    const follow: Track = [...wait(12), ...walk(30, { x: 0, z: -1 }), ...wait(200)];
    const close = vsAi(passive, { ...swinger(1), reactionTime: 0.1 }, follow, 60);
    expect(close.run.events.some((e) => e.type === 'Feint')).toBe(false);
    expect(close.run.events.some((e) => e.type === 'Hit' && e.attacker === 1)).toBe(true);
  });

  it('punishFits: a slow hammer does not punish a short opening, while a sword does', () => {
    // A Sledge Hammer at a slow Tempo winds up in twice the Ticks: longer than a Blocked recoil lasts.
    const hammer = repo.weapons['Sledge Hammer']!;
    const slow: TuningData = { ...passive, weapons: { ...passive.weapons, 'Sledge Hammer': { ...hammer, tempo: { ...hammer.tempo, windUp: 2 } } } };
    const punisher = (punishFits: number) => ({ reactionTime: 0.1, mistakeRate: 0, feintRate: 0, aggression: 1e-6, kickRate: 0, throwRate: 0, punish: 1, punishFits });
    /** Its Attacks (Wind-ups) once the scripted Overhead it Blocked has recoiled. */
    const punishes = (weapon: string, punishFits: number) => {
      const ai = createAiController(slow, punisher(punishFits));
      const run = runControllers(slow, createInitialState(slow, 1, duelPlacements(DISTANCE), [defaultWeapon, weapon]), [scriptedController([...wait(20), ...attack('Overhead')]), ai], 160);
      expect(run.events.some((e) => e.type === 'Block' && e.defender === 1), weapon).toBe(true);
      return run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Wind-up').length;
    };
    expect(punishes('Sledge Hammer', 0)).toBe(1);
    expect(punishes('Sledge Hammer', 1)).toBe(0);
    expect(punishes(defaultWeapon, 1)).toBe(1);
  });

  it('its memory round-trips through save() and load() as plain data, mid-hold-break: a restored Expert decides exactly as it would have', () => {
    const expert = { ...aiDifficulty(repo, 'Expert'), holdBreak: 1 };
    const ai = createAiController(repo, expert, 'Defensive');
    const initial = createInitialState(repo, 4, duelPlacements(DISTANCE));
    const script = scriptedController(held(400));
    let s = initial;
    let saved: unknown = null;
    for (let t = 0; t < 300 && saved === null; t++) {
      s = runControllers(repo, s, [script, ai], 1).final;
      const memory = ai.save!() as { defencePlan: { holdBreak?: { go: boolean } } | null };
      if (memory.defencePlan?.holdBreak?.go) saved = JSON.parse(JSON.stringify(memory));
    }
    expect(saved, 'it never broke the hold').not.toBeNull();
    const restored = createAiController(repo, expert, 'Defensive');
    restored.load!(saved);
    const a = runControllers(repo, s, [script, ai], 150);
    const b = runControllers(repo, s, [script, restored], 150);
    expect(b.states.map((x) => hashValue(x))).toEqual(a.states.map((x) => hashValue(x)));
  });
});

describe('AI Stage 2: team coordination (docs/plans/ai-behaviour.md)', { timeout: 120_000 }, () => {
  /** A team of two (Fighters 1 and 2) on a dummy (Fighter 0) that never acts, looking at the pair (+z), with endless HP. */
  const tough: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
  const pair = (teamwork: number) => ({ ...aiDifficulty(repo, 'Skilled'), teamwork, kickRate: 0, throwRate: 0 });
  function onDummy(teamwork: number, seed: number, ticks = 1200) {
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: -0.6, z: 3 }, facing: Math.PI },
      { position: { x: 0.6, z: 3 }, facing: Math.PI },
    ];
    const initial = createInitialState(tough, seed, placements, [], [1, 0, 0]);
    return runControllers(tough, initial, [scriptedController(hold(ticks, { face: 0 })), createAiController(tough, pair(teamwork)), createAiController(tough, pair(teamwork))], ticks);
  }
  type Run = ReturnType<typeof onDummy>;
  /** The angle (degrees) between Fighters 1 and 2 as seen from Fighter 0. */
  const apart = (s: Run['final']) => {
    const at = (k: number) => Math.atan2(s.fighters[k]!.position.x - s.fighters[0]!.position.x, s.fighters[k]!.position.z - s.fighters[0]!.position.z);
    const d = at(1) - at(2);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / DEG;
  };
  const DEG = Math.PI / 180;
  const windingUp = (s: Run['final'], k: number) => {
    const a = s.fighters[k]!.action;
    return a.kind === 'Attack' && a.phase === 'Wind-up';
  };

  it('Beginner, Skilled and Expert work as a team at 0.4 / 0.7 / 0.9; Easy, Normal and Hard do not, and no Style scales it', () => {
    expect(['Beginner', 'Skilled', 'Expert'].map((t) => skillOf(repo, aiDifficulty(repo, t)).teamwork)).toEqual([0.4, 0.7, 0.9]);
    expect(['Easy', 'Normal', 'Hard'].map((t) => skillOf(repo, aiDifficulty(repo, t)).teamwork)).toEqual([0, 0, 0]);
    for (const style of Object.keys(repo.ai.styles)) expect(skillOf(repo, aiDifficulty(repo, 'Skilled'), aiStyle(repo, style)).teamwork, style).toBe(0.7);
  });

  it('flank slots: in a 2 v 1 against a dummy, the two end up on opposite sides of it', () => {
    for (let seed = 1; seed <= 6; seed++) expect(apart(onDummy(1, seed).final), `seed ${seed}`).toBeGreaterThan(120);
    // Without teamwork they circle at random, and often end up side by side.
    expect(Math.min(...[1, 2, 3, 4, 5, 6].map((seed) => apart(onDummy(0, seed).final)))).toBeLessThan(60);
  });

  it('turns: only one of them is ever in Wind-up at a time while the target faces them both, and they still land blows', () => {
    let hits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const run = onDummy(1, seed);
      expect(run.states.filter((s) => windingUp(s, 1) && windingUp(s, 2)).length, `seed ${seed}`).toBe(0);
      hits += run.events.filter((e) => e.type === 'Hit' && e.defender === 0).length;
    }
    expect(hits).toBeGreaterThan(20);
    const alone = onDummy(0, 1);
    expect(alone.states.some((s) => windingUp(s, 1) && windingUp(s, 2))).toBe(true);
  });

  it('no friendly fire: a team of two never Staggers each other in seeded fights against a Skilled enemy', () => {
    const teammateHits = (teamwork: number) => {
      let n = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const start = createMatch(repo, { bestOf: 1, seed, arena: 'library', teams: [0, 0, 1] });
        const skilled = { ...aiDifficulty(repo, 'Skilled'), ...NO_FEEL };
        const ais = [createAiController(repo, { ...skilled, teamwork }), createAiController(repo, { ...skilled, teamwork }), createAiController(repo, { ...skilled, teamwork: 0 })];
        for (const m of runMatch(repo, start, ais, 4000).matches) n += m.duel.events.filter((e) => e.type === 'Hit' && e.defender !== 2 && e.attacker !== 2).length;
      }
      return n;
    };
    expect(teammateHits(1)).toBe(0);
    expect(teammateHits(0)).toBeGreaterThan(5);
  });

  /** Two AIs (Fighters 0 and 1) against two idle dummies, both nearest the first (Fighter 2); `hp` is its HP fraction. */
  function twoOnTwo(teamwork: number, hp = 1) {
    const placements = [
      { position: { x: -0.5, z: 0 }, facing: 0 },
      { position: { x: 0.5, z: 0 }, facing: 0 },
      { position: { x: 0, z: 3 }, facing: Math.PI },
      { position: { x: 3, z: 4.5 }, facing: Math.PI },
    ];
    const initial = createInitialState(tough, 1, placements, [], [0, 0, 1, 1]);
    const low = { ...initial, fighters: initial.fighters.map((f, i) => (i === 2 ? { ...f, hp: f.maxHp * hp } : f)) };
    const calm = { ...pair(teamwork), aggression: 0 };
    const ais = [createAiController(tough, calm), createAiController(tough, calm)];
    const run = runControllers(tough, low, [...ais, scriptedController(wait(300)), scriptedController(wait(300))], 300);
    // Each fights the enemy it focuses on, and has closed on it.
    const fights = ais.map((ai) => (ai.save!() as { focus: { fighter: number } }).focus.fighter);
    fights.forEach((j, k) => expect(Math.hypot(run.final.fighters[j]!.position.x - run.final.fighters[k]!.position.x, run.final.fighters[j]!.position.z - run.final.fighters[k]!.position.z)).toBeLessThan(2.5));
    return fights;
  }

  it("target spread: in a team fight it takes the enemy its ally leaves free, unless the shared one is low on HP", () => {
    expect(twoOnTwo(1)).toEqual([2, 3]);
    expect(twoOnTwo(0)).toEqual([2, 2]);
    expect(twoOnTwo(1, 0.2)).toEqual([2, 2]);
  });

  it('its team memory round-trips through save() and load() as plain data: restored mid-fight, the team decides exactly as it would have', () => {
    const expert = { ...aiDifficulty(repo, 'Expert'), teamwork: 1 };
    const placements = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: -0.6, z: 3 }, facing: Math.PI },
      { position: { x: 0.6, z: 3 }, facing: Math.PI },
    ];
    let s = createInitialState(repo, 5, placements, [], [1, 0, 0]);
    const dummy = scriptedController(hold(1000, { face: 0 }));
    const ais = [createAiController(repo, expert), createAiController(repo, expert)];
    s = runControllers(repo, s, [dummy, ...ais], 200).final;
    const saved = ais.map((ai) => JSON.parse(JSON.stringify(ai.save!())) as { strafe: { flank: boolean }; focus: { spread: boolean } });
    expect(saved.map((m) => m.strafe.flank)).toEqual([true, true]);
    const restored = saved.map((m) => {
      const ai = createAiController(repo, expert);
      ai.load!(m);
      return ai;
    });
    const a = runControllers(repo, s, [dummy, ...ais], 200);
    const b = runControllers(repo, s, [dummy, ...restored], 200);
    expect(b.states.map((x) => hashValue(x))).toEqual(a.states.map((x) => hashValue(x)));
  });
});

describe('AI Stage 3: feel (docs/plans/ai-behaviour.md)', { timeout: 300_000 }, () => {
  const DEG = Math.PI / 180;
  const tough: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
  const at = (s: { fighters: readonly { position: { x: number; z: number } }[] }, i: number, j: number) => Math.hypot(s.fighters[i]!.position.x - s.fighters[j]!.position.x, s.fighters[i]!.position.z - s.fighters[j]!.position.z);
  type Memory = {
    beat: { timed: boolean; need: number; done: number; double: boolean } | null;
    jitter: { from: number; until: number } | null;
    shaken: number;
    strafe: { spacing: number; still: boolean; pause: number; hop: boolean };
    seen: unknown[];
  };

  it('Beginner, Skilled and Expert have the feel knobs at 0.4 / 0.7 / 0.9 (jumpStep 0.2 / 0.35 / 0.5); Easy, Normal and Hard none; only Tricky and Defensive scale jumpStep', () => {
    const knobs = (tier: string, style = 'Balanced') => {
      const s = skillOf(repo, aiDifficulty(repo, tier), aiStyle(repo, style));
      return [s.rhythm, s.reactionJitter, s.humanMistakes, s.idleLife, s.jumpStep];
    };
    expect(knobs('Beginner')).toEqual([0.4, 0.4, 0.4, 0.4, 0.2]);
    expect(knobs('Skilled')).toEqual([0.7, 0.7, 0.7, 0.7, 0.35]);
    expect(knobs('Expert')).toEqual([0.9, 0.9, 0.9, 0.9, 0.5]);
    for (const tier of ['Easy', 'Normal', 'Hard']) for (const style of Object.keys(repo.ai.styles)) expect(knobs(tier, style), `${tier} ${style}`).toEqual([0, 0, 0, 0, 0]);
    for (const style of Object.keys(repo.ai.styles)) {
      const jumpStep = style === 'Tricky' ? 0.7 : style === 'Defensive' ? 0.175 : 0.35;
      expect(knobs('Skilled', style), style).toEqual([0.7, 0.7, 0.7, 0.7, jumpStep]);
    }
  });

  /** An AI (Fighter 1, `difficulty`) against a dummy (Fighter 0) that stands `gap` away looking at it, stepped a Tick at a time; its memory before each Tick. */
  function onDummy(difficulty: AiDifficulty, ticks: number, gap = 2, seed = 1) {
    const ai = createAiController(tough, difficulty);
    const dummy = scriptedController(hold(ticks, { face: 0 }));
    let s = createInitialState(tough, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: gap }, facing: Math.PI }]);
    const states = [s];
    const memory: Memory[] = [];
    for (let t = 0; t < ticks; t++) {
      memory.push(ai.save!() as Memory);
      s = runControllers(tough, s, [dummy, ai], 1).final;
      states.push(s);
    }
    return { states, memory };
  }
  const starts = (states: readonly SimState[], k: number) => states.flatMap((s, t) => (t > 0 && s.fighters[k]!.action.kind === 'Attack' && states[t - 1]!.fighters[k]!.action.kind !== 'Attack' ? [t] : []));

  it('rhythm: it starts no Attack from its spacing before its beat comes (the pace it needs spent), and a double threat Chains', () => {
    const skilled = { ...aiDifficulty(repo, 'Skilled'), rhythm: 1, kickRate: 0, throwRate: 0, feintRate: 0, chainRate: 0, jumpAttackRate: 0 };
    const { states, memory } = onDummy(skilled, 3000);
    let timed = 0;
    let doubles = 0;
    let chained = 0;
    for (const t of starts(states, 1)) {
      // The Intent pressed on Tick t - 1 (as memory[t - 1] had it before) started it.
      const beat = memory[t - 1]!.beat;
      if (!beat) continue;
      expect(beat.timed).toBe(true);
      // At most the pace of Pressure (2.5 times its aggression) spent on that Tick.
      expect(beat.done + 2.5 * skilled.aggression!, `Attack at ${t}`).toBeGreaterThanOrEqual(beat.need);
      timed++;
      if (!beat.double) continue;
      doubles++;
      let k = t;
      while (k < states.length && states[k]!.fighters[1]!.action.kind === 'Attack' && !(states[k]!.fighters[1]!.action as { chain?: unknown }).chain) k++;
      if (k < states.length && states[k]!.fighters[1]!.action.kind === 'Attack') chained++;
    }
    expect(timed, 'it never attacked on a beat').toBeGreaterThan(10);
    expect(doubles, 'no double threat').toBeGreaterThan(0);
    // chainRate 0: only a double threat Chains.
    expect(chained).toBe(doubles);
    // Without it there is no beat (a coin flip every Tick), and the beat keeps about the coin flip's pace.
    const without = onDummy({ ...skilled, rhythm: 0 }, 3000);
    expect(without.memory.every((m) => m.beat === null)).toBe(true);
    const pace = starts(states, 1).length / starts(without.states, 1).length;
    expect(pace).toBeGreaterThan(0.7);
    expect(pace).toBeLessThan(1.4);
  });

  it('reactionJitter: it notices an Attack 1 to half its Reaction Time (at most 6 Ticks) late, rolled per Attack, and keeps that much more of what it saw', () => {
    const reactionTime = 0.25;
    const reactionTicks = Math.round(reactionTime * TICK_RATE);
    const most = Math.min(6, Math.ceil(reactionTicks / 2));
    const lates: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const ai = createAiController(passive, { reactionTime, mistakeRate: 0, feintRate: 0, reactionJitter: 1 });
      const intents: Intent[] = [];
      const recording = { intent: (s: SimState, i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
      const run = runControllers(passive, createInitialState(passive, seed, duelPlacements(DISTANCE)), [scriptedController([...wait(30), ...attack('Overhead')]), recording], 120);
      expect((ai.save!() as Memory).seen.length).toBe(reactionTicks + most + 1);
      const seen = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Attack');
      lates.push(intents.findIndex((x) => x.block) - (seen + reactionTicks));
    }
    for (const late of lates) {
      expect(late).toBeGreaterThanOrEqual(1);
      expect(late).toBeLessThanOrEqual(most);
    }
    expect(new Set(lates).size, 'every Attack was as late').toBeGreaterThan(2);
    // Without it, its memory keeps Reaction Time's worth (the Reaction Time test shows it reacts right on time).
    const plain = createAiController(passive, { reactionTime, mistakeRate: 0, feintRate: 0 });
    runControllers(passive, createInitialState(passive, 1, duelPlacements(DISTANCE)), [scriptedController(wait(60)), plain], 60);
    expect((plain.save!() as Memory).seen.length).toBe(reactionTicks + 1);
  });

  /** Every Block it raises against a string of Attacks (at a mistake rate of 1): its Direction, the one that meets the Attack, and how many Ticks after Reaction Time it came. */
  function mistakes(humanMistakes: number) {
    const reactionTime = 0.25;
    const reactionTicks = Math.round(reactionTime * TICK_RATE);
    const dirs: Direction[] = ['Thrust', 'Left', 'Overhead', 'Right', 'Right', 'Left', 'Thrust', 'Overhead', 'Left', 'Thrust', 'Right', 'Overhead'];
    const out: { block: Direction; meets: Direction; late: number }[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const ai = createAiController(passive, { reactionTime, mistakeRate: 1, feintRate: 0, humanMistakes });
      const intents: Intent[] = [];
      const recording = { intent: (s: SimState, i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
      const a: Track = dirs.flatMap((d) => [...wait(80), ...attack(d, 30)]);
      const run = runControllers(tough, createInitialState(tough, seed, duelPlacements(DISTANCE)), [scriptedController(a), recording], dirs.length * 110);
      const begun = starts(run.states, 0);
      begun.forEach((t, n) => {
        const end = begun[n + 1] ?? intents.length;
        const k = intents.findIndex((x, i) => i >= t && i < end && x.block);
        const atk = run.states[t]!.fighters[0]!.action as { direction: Direction };
        if (k >= 0) out.push({ block: intents[k]!.direction, meets: atk.direction === 'Left' ? 'Right' : atk.direction === 'Right' ? 'Left' : atk.direction, late: k - (t + reactionTicks) });
      });
    }
    return out;
  }
  const opposite = (d: Direction): Direction => ({ Left: 'Right', Right: 'Left', Overhead: 'Thrust', Thrust: 'Overhead' })[d] as Direction;

  it('humanMistakes: a mistake is a late Block or one beside the right Direction, never its opposite; without it, a wrong Direction on time', () => {
    const human = mistakes(1);
    expect(human.length).toBeGreaterThan(30);
    for (const m of human) {
      if (m.block === m.meets) expect(m.late, 'a right Block, so a late one').toBeGreaterThanOrEqual(3);
      else {
        expect(m.block).not.toBe(opposite(m.meets));
        expect(m.late).toBe(0);
      }
    }
    expect(human.filter((m) => m.block === m.meets).length, 'no late Block').toBeGreaterThan(5);
    expect(human.filter((m) => m.block !== m.meets).length, 'no Block beside').toBeGreaterThan(5);
    const plain = mistakes(0);
    expect(plain.every((m) => m.block !== m.meets && m.late === 0)).toBe(true);
    expect(plain.some((m) => m.block === opposite(m.meets))).toBe(true);
  });

  it('humanMistakes: just after its own Attack it is shaken for a while (its lapses likelier)', () => {
    const skilled = { ...aiDifficulty(repo, 'Skilled'), humanMistakes: 1, kickRate: 0, throwRate: 0 };
    const { states, memory } = onDummy(skilled, 600);
    const recovery = states.findIndex((s) => s.fighters[1]!.action.kind === 'Attack' && (s.fighters[1]!.action as { phase: string }).phase === 'Recovery');
    expect(recovery).toBeGreaterThan(0);
    expect(memory[recovery + 1]!.shaken).toBeGreaterThan(recovery + 30);
    expect(onDummy({ ...skilled, humanMistakes: 0 }, 300).memory.every((m) => m.shaken === -1)).toBe(true);
  });

  it('idleLife: it varies its spacing, stops circling and pauses now and then, where without it it circles steadily', () => {
    const calm = { ...aiDifficulty(repo, 'Skilled'), aggression: 0, kickRate: 0, throwRate: 0, pressure: 0, caution: 0 };
    const life = (idleLife: number) => {
      let still = 0;
      const gaps: number[] = [];
      for (let seed = 1; seed <= 3; seed++) {
        const { states } = onDummy({ ...calm, idleLife }, 1500, 2, seed);
        for (let t = 300; t < states.length; t++) {
          if (at(states[t]!, 1, 1) === 0 && states[t]!.fighters[1]!.position.x === states[t - 1]!.fighters[1]!.position.x && states[t]!.fighters[1]!.position.z === states[t - 1]!.fighters[1]!.position.z) still++;
          gaps.push(at(states[t]!, 0, 1));
        }
      }
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      return { still, spread: Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) };
    };
    const on = life(1);
    const off = life(0);
    expect(on.still).toBeGreaterThan(off.still + 100);
    expect(on.spread).toBeGreaterThan(off.spread);
  });
  /** Fighters as (x, z) facing +z (0) or the AI-ish way; teams; Controllers; run for `ticks`. */
  const placed = (spots: [number, number][], teams: number[], seed = 1, tuning: TuningData = tough, arena?: string) =>
    createInitialState(tuning, seed, spots.map(([x, z]) => ({ position: { x, z }, facing: 0 })), [], teams, arena);
  const hops = (run: { events: readonly { type: string; fighter?: number }[] }, k: number) => run.events.filter((e) => e.type === 'Jump' && e.fighter === k).length;
  /** No attacking, Kicking, throwing or other Jumps of its own: only the hops show. */
  const hopper = (jumpStep: number, teamwork = 0) => ({ ...aiDifficulty(repo, 'Skilled'), aggression: 0, kickRate: 0, throwRate: 0, jumpAttackRate: 0, jumpEscapeRate: 0, caution: 0, pressure: 0, jumpStep, teamwork });

  it('jumpStep: in a 2 v 1 against a dummy, with its walk round blocked by a strip of Lava, it hops round to its flank slot, sooner than walking', () => {
    // Open ground with a Lava strip (x -0.9..-0.5, z 0.8..4) cut out of it, a Lava sheet 1 m below.
    const floor = (id: string, x0: number, x1: number, z0: number, z1: number) => ({ id, points: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]] });
    const walk = [floor('WALK_w', -8, -0.9, -8, 8), floor('WALK_e', -0.5, 8, -8, 8), floor('WALK_s', -0.9, -0.5, -8, 0.8), floor('WALK_n', -0.9, -0.5, 4, 8)];
    const arena = parseArena({ name: 'strip', walk: [...walk, { id: 'WALK_lava', lava: true, points: [[-10, -1, -10], [10, -1, -10], [10, -1, 10], [-10, -1, 10]] }] }, 'strip');
    const tuning: TuningData = { ...tough, arenas: { ...tough.arenas, strip: arena } };
    /** The angle (degrees) between Fighters 1 and 2 as seen from the dummy (Fighter 0). */
    const apart = (st: SimState) => {
      const b = (k: number) => Math.atan2(st.fighters[k]!.position.x - st.fighters[0]!.position.x, st.fighters[k]!.position.z - st.fighters[0]!.position.z);
      const d = b(1) - b(2);
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / DEG;
    };
    const flank = (jumpStep: number, seed: number) => {
      const ais = [createAiController(tuning, hopper(jumpStep, 1)), createAiController(tuning, hopper(jumpStep, 1))];
      // Fighter 1 takes the slot to the west (-x), across the strip.
      const run = runControllers(tuning, placed([[0, 0], [-0.15, 2], [0.15, 2.2]], [1, 0, 0], seed, tuning, 'strip'), [scriptedController(hold(900, { face: 0 })), ...ais], 900);
      expect(run.states.some((st) => st.fighters.some((f) => f.death !== undefined)), `seed ${seed}`).toBe(false);
      return { when: run.states.findIndex((st) => apart(st) > 120), hops: hops(run, 1) };
    };
    for (let seed = 1; seed <= 4; seed++) {
      const hopped = flank(1, seed);
      const walked = flank(0, seed);
      expect(hopped.hops, `seed ${seed}`).toBeGreaterThan(0);
      expect(walked.hops, `seed ${seed}`).toBe(0);
      expect(hopped.when, `seed ${seed}: never on opposite sides`).toBeGreaterThan(0);
      if (walked.when >= 0) expect(hopped.when, `seed ${seed}`).toBeLessThan(walked.when);
    }
    // On open ground, the walk round is not blocked, and it walks.
    const open = runControllers(tough, placed([[0, 0], [-0.15, 2], [0.15, 2.2]], [1, 0, 0]), [scriptedController(hold(600, { face: 0 })), createAiController(tough, hopper(1, 1)), createAiController(tough, hopper(1, 1))], 600);
    expect(hops(open, 1) + hops(open, 2)).toBe(0);
  });

  it('jumpStep: caught between two enemies, it hops out to have both in front of it', () => {
    /** The angle (degrees) between the two enemies as seen from the AI (Fighter 2). */
    const spread = (st: SimState) => {
      const b = (k: number) => Math.atan2(st.fighters[k]!.position.x - st.fighters[2]!.position.x, st.fighters[k]!.position.z - st.fighters[2]!.position.z);
      const d = b(0) - b(1);
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / DEG;
    };
    for (let seed = 1; seed <= 4; seed++) {
      const ai = createAiController(tough, hopper(1));
      const dummies = [scriptedController(hold(200, { face: Math.PI / 2 })), scriptedController(hold(200, { face: -Math.PI / 2 }))];
      const run = runControllers(tough, placed([[-1.2, 0], [1.2, 0], [0, 0]], [1, 1, 0], seed), [...dummies, ai], 200);
      const hop = run.states.findIndex((st) => st.fighters[2]!.air !== undefined);
      expect(hop, `seed ${seed}: it never hopped`).toBeGreaterThan(0);
      expect(hop, `seed ${seed}`).toBeLessThan(60);
      const landed = run.states.findIndex((st, t) => t > hop && st.fighters[2]!.air === undefined);
      expect(spread(run.states[landed]!), `seed ${seed}`).toBeLessThan(100);
    }
  });

  it('jumpStep: it never hops with an enemy Attack or Kick seen coming in reach, in seeded fights', () => {
    const reactionTicks = Math.round(aiDifficulty(repo, 'Skilled').reactionTime * TICK_RATE);
    const fighter = { ...aiDifficulty(repo, 'Skilled'), jumpAttackRate: 0, jumpEscapeRate: 0, jumpStep: 1 };
    let total = 0;
    for (const teams of [[0, 1], [0, 1, 1]]) {
      for (let seed = 1; seed <= 4; seed++) {
        const ais = teams.map(() => createAiController(tough, fighter));
        const run = runControllers(tough, placed(teams.map((_, k) => [k * 1.5 - 1, 2 * (k % 2)] as [number, number]), teams, seed), ais, 1500);
        run.states.forEach((st, t) => {
          if (t === 0) return;
          st.fighters.forEach((f, k) => {
            if (f.air === undefined || run.states[t - 1]!.fighters[k]!.air !== undefined) return;
            total++;
            // It pressed Jump on Tick t - 1, looking at Tick t - 1 - Reaction Time.
            const seen = run.states[t - 1 - reactionTicks]!;
            seen.fighters.forEach((e, j) => {
              if (e.team === f.team) return;
              const coming = (e.action.kind === 'Attack' || e.action.kind === 'Kick') && e.action.phase !== 'Recovery';
              expect(coming && at(seen, j, k) <= repo.ai.attackRange + 0.15, `teams ${teams} seed ${seed} Tick ${t}`).toBe(false);
            });
          });
        });
      }
    }
    expect(total, 'they never hopped: the soak proves nothing').toBeGreaterThan(10);
  });

  it('jumpStep: it never hops where jumpIsSafe says no: caught between two enemies on a pier over Lava, it does not hop off it', () => {
    const arena = parseArena({ name: 'pier', walk: [{ id: 'WALK_pier', points: [[-0.75, 0, -8], [0.75, 0, -8], [0.75, 0, 8], [-0.75, 0, 8]] }, { id: 'WALK_lava', lava: true, points: [[-10, -1, -10], [10, -1, -10], [10, -1, 10], [-10, -1, 10]] }] }, 'pier');
    const tuning: TuningData = { ...tough, arenas: { ...tough.arenas, pier: arena } };
    const run = (spots: [number, number][], t: TuningData, name?: string) => {
      const ai = createAiController(t, hopper(1));
      const dummies = [scriptedController(hold(300, { face: 0 })), scriptedController(hold(300, { face: Math.PI }))];
      return runControllers(t, placed(spots, [1, 1, 0], 1, t, name), [...dummies, ai], 300);
    };
    // Along the pier, enemies ahead and behind: the way out is sideways, into the Lava.
    const pier = run([[0, -1.2], [0, 1.2], [0, 0]], tuning, 'pier');
    expect(pier.states.some((st) => st.fighters[2]!.death !== undefined)).toBe(false);
    expect(hops(pier, 2)).toBe(0);
    // The same on open ground: it hops out.
    expect(hops(run([[0, -1.2], [0, 1.2], [0, 0]], tough), 2)).toBeGreaterThan(0);
  });

  it('its memory round-trips through save() and load() as plain data, mid-plan: a restored Expert with every feel knob on decides exactly as it would have', () => {
    const expert = { ...aiDifficulty(repo, 'Expert'), rhythm: 1, reactionJitter: 1, humanMistakes: 1, idleLife: 1, jumpStep: 1 };
    const ai = createAiController(repo, expert, 'Tricky');
    const script = scriptedController(Array.from({ length: 12 }, () => [...wait(40), ...attack('Left', 20)]).flat());
    let s = createInitialState(repo, 6, duelPlacements(1.8));
    let saved: unknown = null;
    for (let t = 0; t < 600 && saved === null; t++) {
      s = runControllers(repo, s, [script, ai], 1).final;
      const memory = ai.save!() as Memory;
      if (memory.jitter && s.tick < memory.jitter.until && memory.beat?.timed && memory.shaken > s.tick) saved = JSON.parse(JSON.stringify(memory));
    }
    expect(saved, 'it never had a beat, a late notice and a lapse at once').not.toBeNull();
    const restored = createAiController(repo, expert, 'Tricky');
    restored.load!(saved);
    const a = runControllers(repo, s, [script, ai], 200);
    const b = runControllers(repo, s, [script, restored], 200);
    expect(b.states.map((x) => hashValue(x))).toEqual(a.states.map((x) => hashValue(x)));
  });
});

