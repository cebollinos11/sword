import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type AiDifficulty, type TuningData } from '../tuning';
import { attack, createInitialState, wait, whirlwindTimings, type Intent, type SimState, type Track } from '../sim';
import { aiDifficulty, aiStyle, createAiController, runControllers, scriptedController } from './index';
import { skillOf } from './ai';

const repo = loadTuningData();
const timings = whirlwindTimings(repo);
/** Everything that could distract it from the Whirlwind is off, and its feel knobs too. */
const calm = (extra: Partial<AiDifficulty> = {}): AiDifficulty => ({
  ...aiDifficulty(repo, 'Expert'),
  aggression: 0,
  kickRate: 0,
  throwRate: 0,
  rhythm: 0,
  reactionJitter: 0,
  humanMistakes: 0,
  idleLife: 0,
  jumpStep: 0,
  whirlwindRate: 1,
  ...extra,
});
const reaction = Math.round(aiDifficulty(repo, 'Expert').reactionTime * 60);
const still: Track = wait(1);

/** The AI is Fighter 0 (team 0) at the origin facing +z; the enemies (team 1) are scripted still, the others as `teams` says. */
function play(tuning: TuningData, difficulty: AiDifficulty, others: readonly { x: number; z: number; team: number }[], ticks: number, arena?: string, weapons: readonly string[] = [], track: Track = still) {
  const ai = createAiController(tuning, difficulty);
  const intents: Intent[] = [];
  const recording = {
    intent: (s: SimState, i: number) => {
      const intent = ai.intent(s, i);
      intents.push(intent);
      return intent;
    },
    save: ai.save,
    load: ai.load,
  };
  const placements = [{ position: { x: 0, z: 0 }, facing: 0 }, ...others.map((o) => ({ position: { x: o.x, z: o.z }, facing: Math.atan2(-o.x, -o.z) }))];
  const initial = createInitialState(tuning, 1, placements, weapons, [0, ...others.map((o) => o.team)], arena);
  const run = runControllers(tuning, initial, [recording, ...others.map(() => scriptedController(track))], ticks);
  return { run, intents, ai };
}

const two = [{ x: -0.6, z: 1.1, team: 1 }, { x: 0.6, z: 1.1, team: 1 }];
const begins = (intents: readonly Intent[]) => intents.some((i) => i.whirlwind);

describe('AI Whirlwind: knobs', () => {
  it('Skilled 0.03/0.7, Expert 0.05/0.9, and none for Beginner, Easy, Normal and Hard', () => {
    const s = skillOf(repo, aiDifficulty(repo, 'Skilled'));
    const e = skillOf(repo, aiDifficulty(repo, 'Expert'));
    expect([s.whirlwindRate, s.whirlwindRead]).toEqual([0.03, 0.7]);
    expect([e.whirlwindRate, e.whirlwindRead]).toEqual([0.05, 0.9]);
    for (const tier of ['Beginner', 'Easy', 'Normal', 'Hard']) {
      const k = skillOf(repo, aiDifficulty(repo, tier));
      expect([k.whirlwindRate, k.whirlwindRead], tier).toEqual([0, 0]);
    }
  });

  it('Aggressive plays 1.6 and Defensive 0.4 of the rate', () => {
    const skilled = aiDifficulty(repo, 'Skilled');
    expect(skillOf(repo, skilled, aiStyle(repo, 'Aggressive')).whirlwindRate).toBeCloseTo(0.03 * 1.6);
    expect(skillOf(repo, skilled, aiStyle(repo, 'Defensive')).whirlwindRate).toBeCloseTo(0.03 * 0.4);
    expect(skillOf(repo, aiDifficulty(repo, 'Normal'), aiStyle(repo, 'Aggressive')).whirlwindRate).toBe(0);
  });
});

describe('AI Whirlwind: using it', () => {
  it('against two still enemies in reach it holds G until armed, lets go and Spins, never crouching or jumping', () => {
    const { run, intents } = play(repo, calm(), two, 200);
    const first = intents.findIndex((i) => i.whirlwind);
    expect(first).toBeGreaterThanOrEqual(0);
    let held = 0;
    while (intents[first + held]?.whirlwind) held++;
    expect(held).toBe(timings.armTicks + 1);
    expect(run.events.some((e) => e.type === 'WhirlwindPhase' && e.fighter === 0 && e.phase === 'Spin')).toBe(true);
    let spinning = 0;
    run.states.forEach((s, k) => {
      const a = s.fighters[0]!.action;
      if (a.kind !== 'Whirlwind' || a.phase === 'Recovery') return;
      if (a.phase === 'Spin') spinning++;
      const i = intents[k];
      if (!i) return;
      expect([i.crouch, i.jump, i.attack, i.block, i.kick, i.throw].map(Boolean), `Tick ${k}`).toEqual([false, false, false, false, false, false]);
    });
    expect(spinning).toBe(timings.spinTicks);
  });

  it('against one standing enemy it does not start', () => {
    expect(begins(play(repo, calm(), [{ x: 0, z: 1.1, team: 1 }], 150).intents)).toBe(false);
  });

  it('against one Staggered or in a Knockdown in reach it does', () => {
    // A second enemy, out of the AI's reach + 1.5, hits the first down (a blow between teammates Staggers too).
    const ai = createAiController(repo, calm());
    const intents: Intent[] = [];
    const recording = { intent: (s: SimState, i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const initial = createInitialState(repo, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 1.5 }, facing: Math.PI }, { position: { x: 0, z: 3.1 }, facing: Math.PI }], [], [0, 1, 1]);
    const run = runControllers(repo, initial, [recording, scriptedController(still), scriptedController(attack('Overhead'))], 150);
    expect(run.states.some((s) => ['Knockdown', 'Stagger'].includes(s.fighters[1]!.action.kind))).toBe(true);
    expect(begins(intents)).toBe(true);
  });
});

describe('AI Whirlwind: when it will not', () => {
  it('an ally within its reach + 1 stops it', () => {
    expect(begins(play(repo, calm(), [...two, { x: 1.2, z: 0.3, team: 0 }], 150).intents)).toBe(false);
    // ...and the same ally further off does not.
    expect(begins(play(repo, calm(), [...two, { x: 0, z: -4, team: 0 }], 150).intents)).toBe(true);
  });

  it('an ally off to the side of the drive path, far from the AI but near the path ahead, stops it', () => {
    const stays = calm({ footwork: 0, pressure: 0, caution: 0 });
    // The drive runs from the AI toward its focus (the enemy at x -0.6, z 1.1, the lower index). An ally 3 m along it and 1.8 m aside
    // stands 3.5 m from the AI (beyond reach + 1) but within reach + 1 of the path; at 3.2 m aside it is clear of both.
    const toward = { x: -0.6 / Math.hypot(0.6, 1.1), z: 1.1 / Math.hypot(0.6, 1.1) };
    const aside = { x: toward.z, z: -toward.x };
    const ally = (side: number) => ({ x: 3 * toward.x + side * aside.x, z: 3 * toward.z + side * aside.z, team: 0 });
    expect(begins(play(repo, stays, [...two, ally(3.2)], 150).intents)).toBe(true);
    expect(begins(play(repo, stays, [...two, ally(1.8)], 150).intents)).toBe(false);
  });

  // A floor ending at z 2 (the Abyss beyond), running 8 m to the south.
  const ledge = parseArena(
    {
      name: 'whirlLedge',
      walk: [
        { id: 'WALK_floor', points: [[-6, 0, -8], [6, 0, -8], [6, 0, 2], [-6, 0, 2]] },
        { id: 'WALK_abyss', abyss: true, points: [[-20, -8, -20], [20, -8, -20], [20, -8, 20], [-20, -8, 20]] },
      ],
      walls: [],
    },
    'whirlLedge',
  );
  const onLedge: TuningData = { ...repo, arenas: { ...repo.arenas, whirlLedge: ledge } };

  it('a drive path over an Abyss edge stops it, while the same setup turned toward safe ground starts', () => {
    // It keeps to its spot (no footwork), so the setup is what the test says it is.
    const stays = calm({ footwork: 0, pressure: 0, caution: 0 });
    expect(begins(play(onLedge, stays, two, 150, 'whirlLedge').intents)).toBe(false);
    const behind = two.map((o) => ({ ...o, z: -o.z }));
    expect(begins(play(onLedge, stays, behind, 150, 'whirlLedge').intents)).toBe(true);
  });

  it('a Flail AI never sends whirlwind', () => {
    const { intents } = play(repo, calm(), two, 200, undefined, ['Flail', 'Flail', 'Flail']);
    expect(intents.some((i) => i.whirlwind)).toBe(false);
  });

  it('with whirlwindRate 0 its Intents are those of the same AI without the key (no new draw)', () => {
    const { whirlwindRate: _r, whirlwindRead: _d, ...without } = calm();
    const attacks: Track = [...wait(40), ...attack('Overhead'), ...wait(60), ...attack('Left'), ...wait(60)];
    const off = play(repo, { ...without, aggression: 0.03, kickRate: 0.1, throwRate: 0.05, whirlwindRate: 0, whirlwindRead: 0 }, two, 500, undefined, [], attacks);
    const absent = play(repo, { ...without, aggression: 0.03, kickRate: 0.1, throwRate: 0.05 }, two, 500, undefined, [], attacks);
    expect(off.intents).toEqual(absent.intents);
    expect(begins(off.intents)).toBe(false);
  });
});

describe('AI Whirlwind: steering the Spin', () => {
  /** Plays to the second Tick of a Spin, and returns what its AI sends when the others are seen at `others` (all one Tick later, held there for its Reaction Time). */
  function steer(placed: readonly { x: number; z: number; team: number }[], later: readonly { x: number; z: number }[]): { face: number | null | undefined; heading: number } {
    const { run, ai } = play(repo, calm(), placed, 200);
    const k = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Whirlwind' && s.fighters[0]!.action.phase === 'Spin');
    expect(k).toBeGreaterThan(0);
    const at = run.states[k + 1]!;
    const self = at.fighters[0]!;
    const heading = (self.action as { heading?: number }).heading!;
    let intent: Intent = ai.intent({ ...at, tick: at.tick }, 0);
    for (let n = 1; n <= reaction + 1; n++) {
      const moved: SimState = { ...at, tick: at.tick + n, fighters: at.fighters.map((f, i) => (i === 0 ? f : { ...f, position: { x: later[i - 1]!.x, z: later[i - 1]!.z } })) };
      intent = ai.intent(moved, 0);
    }
    return { face: intent.face, heading };
  }

  it('toward enemies off to one side', () => {
    const { face, heading } = steer(two, [{ x: 3, z: 0.3 }, { x: 3.5, z: -0.3 }]);
    expect(heading).toBeCloseTo(0, 0);
    expect(face!).toBeCloseTo(Math.PI / 2, 1);
  });

  it('away from an ally ahead of it', () => {
    const { face } = steer([...two, { x: 0, z: -5, team: 0 }], [{ x: 0, z: 4.5 }, { x: 0, z: 4.6 }, { x: 0, z: 1.5 }]);
    expect(Math.cos(face!)).toBeLessThan(0);
  });

  it('with nothing near it keeps its heading', () => {
    const { face, heading } = steer(two, [{ x: 0, z: 40 }, { x: 1, z: 40 }]);
    expect(face!).toBeCloseTo(heading, 6);
  });
});
