/**
 * The Styles with new AI settings (docs/plans/enemy-behaviours.md, Stage 3): a Skirmisher (`throwStanding`, `kite`) and a
 * Pack Hunter (`gangUp`), on the Editor's flat Arena. (Showoff's `whirlwindAlone` is in aiWhirlwind.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createInitialState, duelPlacements, step, TICK_RATE, wait, type SimState } from '../sim';
import { aiDifficulty, createAiController, runControllers, scriptedController, type AiController } from './index';
import { skillOf } from './ai';
import { controllerIntents } from './controller';
import { isAiMemory } from '../net/messages';

const repo = loadTuningData();
/** Nobody dies, so every run lasts its whole length. */
const endless: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };

describe('Skirmisher: throws at a standing target, keeps out of reach, closes in without daggers', () => {
  /** An AI (Fighter 0) against a scripted enemy standing still 1.3 m off; `daggers` overrides its own. */
  const skirmish = (style: string, daggers?: number, seed = 1) => {
    const initial = createInitialState(endless, seed, duelPlacements(1.3));
    const fighters = daggers === undefined ? initial.fighters : initial.fighters.map((f, i) => (i === 1 ? { ...f, daggers } : f));
    const placed: SimState = { ...initial, fighters };
    // Fighter 1 is the AI here (Fighter 0 the still target), as vsAi in ai.test.ts.
    return runControllers(endless, placed, [scriptedController(wait(1)), createAiController(endless, 'Expert', style)], TICK_RATE * 20);
  };
  const thrown = (run: ReturnType<typeof skirmish>) => run.events.filter((e) => e.type === 'DaggerThrown' && e.thrower === 1).length;
  const apart = (s: SimState) => Math.hypot(s.fighters[0]!.position.x - s.fighters[1]!.position.x, s.fighters[0]!.position.z - s.fighters[1]!.position.z);

  it('the Style gives every tier its throws, standing throws and kiting', () => {
    for (const tier of ['Beginner', 'Skilled', 'Expert']) {
      const s = skillOf(repo, aiDifficulty(repo, tier), repo.ai.styles.Skirmisher);
      expect([s.throwRate >= 0.04, s.throwStanding, s.kite], tier).toEqual([true, 0.6, 0.7]);
    }
  });

  it('with daggers it throws them at a target standing still, where a Balanced AI throws none', () => {
    const run = skirmish('Skirmisher');
    expect(thrown(run)).toBeGreaterThanOrEqual(3);
    expect(thrown(skirmish('Balanced'))).toBe(0);
  });

  it('with daggers it keeps out of reach most of the time; out of them, it closes in and fights', () => {
    const reach = endless.ai.attackRange;
    const outShare = (run: ReturnType<typeof skirmish>) => run.states.slice(0, TICK_RATE * 8).filter((s) => s.fighters[1]!.daggers > 0 && apart(s) > reach + 0.3).length;
    const armed = skirmish('Skirmisher');
    const withDaggers = armed.states.slice(0, TICK_RATE * 8).filter((s) => s.fighters[1]!.daggers > 0).length;
    expect(withDaggers).toBeGreaterThan(TICK_RATE * 2);
    expect(outShare(armed) / withDaggers).toBeGreaterThan(0.6);
    // A Balanced AI stays in close.
    const balanced = skirmish('Balanced');
    expect(outShare(balanced) / TICK_RATE / 8).toBeLessThan(0.5);
    // With no daggers: it closes in and swings.
    const empty = skirmish('Skirmisher', 0);
    expect(thrown(empty)).toBe(0);
    const near = empty.states.filter((s) => apart(s) <= reach + 0.3).length;
    expect(near / empty.states.length).toBeGreaterThan(0.5);
    expect(empty.events.some((e) => e.type === 'AttackPhase' && e.fighter === 1)).toBe(true);
  });
});

describe('Pack Hunter: ganging up', () => {
  /**
   * Three AIs of `style` (Team 0) against two Balanced Expert AIs (Team 1), 2 m apart; the share of Ticks (after the first
   * second) on which all three of Team 0 are focused on the same enemy (with three on two, at least two always share one).
   */
  const pack = (style: string, seed: number) => {
    const placements = [
      { position: { x: -2, z: -1.5 }, facing: 0 },
      { position: { x: 0, z: -1.5 }, facing: 0 },
      { position: { x: 2, z: -1.5 }, facing: 0 },
      { position: { x: -1, z: 1.5 }, facing: Math.PI },
      { position: { x: 1, z: 1.5 }, facing: Math.PI },
    ];
    let s = createInitialState(endless, seed, placements, [], [0, 0, 0, 1, 1]);
    const ais: AiController[] = [0, 1, 2].map(() => createAiController(endless, 'Expert', style));
    ais.push(createAiController(endless, 'Expert'), createAiController(endless, 'Expert'));
    let shared = 0;
    const ticks = TICK_RATE * 10;
    for (let t = 0; t < ticks; t++) {
      s = step(s, controllerIntents(s, ais), endless);
      if (t < TICK_RATE) continue;
      const foci = ais.slice(0, 3).map((a) => (a.save() as { focus: { fighter: number } | null }).focus?.fighter ?? -1);
      if (foci.every((f) => f >= 0 && f === foci[0])) shared++;
    }
    return shared / (ticks - TICK_RATE);
  };

  it('the Style raises teamwork and gives every tier gangUp', () => {
    for (const tier of ['Beginner', 'Skilled', 'Expert']) {
      const s = skillOf(repo, aiDifficulty(repo, tier), repo.ai.styles['Pack Hunter']);
      expect([s.teamwork >= 0.8, s.gangUp], tier).toEqual([true, 0.8]);
    }
  });

  it('three Pack Hunters against two enemies all fight one most of the time; Balanced Experts spread out', () => {
    const seeds = [1, 2, 3];
    const hunters = seeds.map((seed) => pack('Pack Hunter', seed));
    const balanced = seeds.map((seed) => pack('Balanced', seed));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(hunters)).toBeGreaterThan(0.6);
    expect(mean(hunters)).toBeGreaterThan(mean(balanced) + 0.2);
  });
});

describe('the new memory (a kite, a gang) on the wire', () => {
  it('a kiting and a ganging AI save memory the resync validator accepts, and it refuses a bad flag', () => {
    const initial = createInitialState(endless, 1, duelPlacements(1.3));
    const skirmisher = createAiController(endless, 'Expert', 'Skirmisher');
    for (let t = 0; t < 30; t++) skirmisher.intent({ ...initial, tick: t }, 1);
    const kiting = JSON.parse(JSON.stringify(skirmisher.save())) as { tactic: { kite?: unknown } };
    expect(kiting.tactic.kite).toBe(true);
    expect(isAiMemory(kiting)).toBe(true);
    expect(isAiMemory({ ...kiting, tactic: { ...kiting.tactic, kite: false } })).toBe(false);

    const four = createInitialState(endless, 1, [{ x: -1, z: -1.5 }, { x: 1, z: -1.5 }, { x: -1, z: 1.5 }, { x: 1, z: 1.5 }].map((position) => ({ position, facing: 0 })), [], [0, 0, 1, 1]);
    const pack = createAiController(endless, 'Expert', 'Pack Hunter');
    for (let t = 0; t < 30; t++) pack.intent({ ...four, tick: t }, 0);
    const ganging = JSON.parse(JSON.stringify(pack.save())) as { focus: { gang?: unknown } };
    expect(ganging.focus.gang).toBe(true);
    expect(isAiMemory(ganging)).toBe(true);
    expect(isAiMemory({ ...ganging, focus: { ...ganging.focus, gang: 1 } })).toBe(false);
  });
});
