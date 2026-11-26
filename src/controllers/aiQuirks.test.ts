/**
 * Quirks (docs/plans/enemy-behaviours.md, Stage 4): how their `ai` parts change a Skill (after the Style, before a walk-only override), and
 * Dumb (`defendRate` 0) against a scripted attacker, thrower and kicker. Hopper's counts are in aiQuirks.slow.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type AiDifficulty, type AiQuirk, type TuningData } from '../tuning';
import { createInitialState, duelPlacements, hashValue, hold, IDLE_INTENT, TICK_RATE, wait, type Direction, type Intent, type SimState } from '../sim';
import { aiDifficulty, createAiController, runControllers, scriptedController, type Controller } from './index';
import { controllerSkill, quirkSkill, skillOf } from './ai';
import { isAiMemory } from '../net/messages';

const repo = loadTuningData();
const endless: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
const quirk = (name: string): AiQuirk => repo.ai.quirks[name]!;
const TIERS = ['Beginner', 'Skilled', 'Expert'] as const;

describe('a Quirk changes the Skill after the Style', () => {
  it('no Quirk (or one with no ai part) leaves the Skill as it is, object and all', () => {
    for (const tier of TIERS) {
      const s = skillOf(repo, aiDifficulty(repo, tier), repo.ai.styles.Aggressive);
      expect(quirkSkill(s, [])).toBe(s);
      expect(quirkSkill(s, [{ body: { damage: 1.1 } }])).toBe(s);
      expect(s.defendRate).toBe(1);
    }
  });

  it('Hopper: each chance is clamp(max(min, v × mul), 0, 1), and jumpNav is at least 10 (Beginner 0 → 10, Skilled 20, Expert 30 unchanged)', () => {
    const navs: number[] = [];
    for (const tier of TIERS) {
      const base = skillOf(repo, aiDifficulty(repo, tier));
      const h = quirkSkill(base, [quirk('Hopper')]);
      const want = (v: number, mul: number, min: number) => Math.min(1, Math.max(0, min, v * mul));
      expect(h.jumpAttackRate, tier).toBe(want(base.jumpAttackRate, 4, 0.002));
      expect(h.jumpStep, tier).toBe(want(base.jumpStep, 3, 0.3));
      expect(h.jumpEscapeRate, tier).toBe(want(base.jumpEscapeRate, 2, 0.1));
      expect(h.landingPunish, tier).toBe(want(base.landingPunish, 1.5, 0.2));
      expect({ ...h, jumpAttackRate: 0, jumpStep: 0, jumpEscapeRate: 0, landingPunish: 0, jumpNav: 0 }).toEqual({ ...base, jumpAttackRate: 0, jumpStep: 0, jumpEscapeRate: 0, landingPunish: 0, jumpNav: 0 });
      navs.push(h.jumpNav);
    }
    expect(navs).toEqual([10, 20, 30]);
  });

  it('Dumb sets defendRate 0 and nothing else', () => {
    const base = skillOf(repo, aiDifficulty(repo, 'Expert'));
    expect(quirkSkill(base, [quirk('Dumb')])).toEqual({ ...base, defendRate: 0 });
  });

  it('a Quirk wins over the Style: applied after it, a number sets the setting whatever the Style made it', () => {
    const style = { chamberRate: { mul: 3, min: 0.06 } };
    const set: AiQuirk = { ai: { chamberRate: 0 } };
    expect(quirkSkill(skillOf(repo, aiDifficulty(repo, 'Expert'), style), [set]).chamberRate).toBe(0);
    // In order: a later Quirk applies to what the earlier made.
    const lift: AiQuirk = { ai: { chamberRate: { min: 0.5 } } };
    expect(quirkSkill(skillOf(repo, aiDifficulty(repo, 'Expert'), style), [set, lift]).chamberRate).toBe(0.5);
  });

  it('a walk-only AI keeps jumpNav -1 with Hopper: the walk override comes after the Quirks', () => {
    for (const tier of TIERS) {
      expect(controllerSkill(repo, aiDifficulty(repo, tier), undefined, [quirk('Hopper')], true).jumpNav, tier).toBe(-1);
      expect(controllerSkill(repo, aiDifficulty(repo, tier), undefined, [quirk('Hopper')], false).jumpNav, tier).toBeGreaterThanOrEqual(10);
    }
    // Without Quirks, walking is what `{ ...skill, jumpNav: -1 }` as a difficulty gave before.
    const expert = aiDifficulty(repo, 'Expert');
    expect(controllerSkill(repo, expert, undefined, [], true)).toEqual(skillOf(repo, { ...expert, jumpNav: -1 }));
  });

  it('createAiController refuses a Quirk Tuning Data lacks, naming the known ones', () => {
    expect(() => createAiController(repo, 'Expert', 'Balanced', { quirks: ['Clumsy'] })).toThrow(/Unknown AI Quirk "Clumsy" \(have: Dumb, Hopper/);
  });
});

/** Every 46 Ticks an Attack (Overhead, Left, Right, Thrust in turn), always facing Fighter 1 and walking in beyond 1.2 m. */
const DIRS: readonly Direction[] = ['Overhead', 'Left', 'Right', 'Thrust'];
const attacker: Controller = {
  intent(state: SimState, i: number): Intent {
    const me = state.fighters[i]!;
    const it = state.fighters[1 - i]!;
    const dx = it.position.x - me.position.x;
    const dz = it.position.z - me.position.z;
    const d = Math.hypot(dx, dz);
    return { ...IDLE_INTENT, face: Math.atan2(dx, dz), move: d > 1.2 && me.action.kind === 'Idle' ? { x: dx / d, z: dz / d } : { x: 0, z: 0 }, attack: state.tick % 46 === 0, direction: DIRS[Math.floor(state.tick / 46) % 4]! };
  },
};

describe('Dumb: it does not defend', () => {
  /** An Expert that stands its ground and never starts anything (no spacing, no backing off, no offence): only its defence shows. */
  const still: AiDifficulty = { ...aiDifficulty(repo, 'Expert'), aggression: 0, punish: 0, preempt: 0, landingPunish: 0, kickRate: 0, throwRate: 0, caution: 0, footwork: 0, idleLife: 0, jumpStep: 0 };
  const TICKS = TICK_RATE * 25;
  const against = (difficulty: AiDifficulty | string, quirks: readonly string[], seed: number) => {
    const ai = createAiController(endless, difficulty, 'Balanced', { quirks });
    const kinds = new Set<string>();
    const recording: Controller = {
      intent: (s, i) => {
        const intent = ai.intent(s, i);
        const plan = (ai.save() as { defencePlan: { kind: string } | null }).defencePlan;
        if (plan) kinds.add(plan.kind);
        return intent;
      },
    };
    const run = runControllers(endless, createInitialState(endless, seed, duelPlacements(1.3)), [attacker, recording], TICKS);
    const count = (f: (e: (typeof run.events)[number]) => boolean) => run.events.filter(f).length;
    return {
      kinds,
      // The attacker's Releases, but one still on its way at the end.
      releases: count((e) => e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Release' && e.tick < TICKS - 30),
      hits: count((e) => e.type === 'Hit' && e.attacker === 0),
      defended: count((e) => (e.type === 'Block' && e.attacker === 0) || (e.type === 'Chamber' && e.chamberer === 1)),
      crouched: run.states.filter((s) => s.fighters[1]!.crouch > 0.5).length,
      attacks: count((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Wind-up'),
    };
  };

  it('a Dumb Expert standing its ground takes every blade Hit of a scripted attacker; the same Expert without it defends nearly all', () => {
    for (const seed of [1, 2, 3]) {
      const dumb = against(still, ['Dumb'], seed);
      expect(dumb.releases, `seed ${seed}`).toBeGreaterThan(10);
      expect(dumb.hits, `seed ${seed} ${JSON.stringify(dumb)}`).toBeGreaterThanOrEqual(dumb.releases);
      expect([dumb.defended, dumb.crouched], `seed ${seed}`).toEqual([0, 0]);
      expect([...dumb.kinds], `seed ${seed}`).toEqual(['None']);
      const plain = against(still, [], seed);
      expect(plain.hits, `seed ${seed} ${JSON.stringify(plain)}`).toBeLessThanOrEqual(2);
      expect(plain.defended, `seed ${seed}`).toBeGreaterThan(3);
    }
  });

  it('a Dumb Expert still attacks as an Expert: as many Attacks as without the Quirk, and against a target that never attacks it plays exactly the same', () => {
    let dumb = 0;
    let plain = 0;
    for (const seed of [1, 2, 3]) {
      const d = against('Expert', ['Dumb'], seed);
      expect(d.defended, `seed ${seed}`).toBe(0);
      dumb += d.attacks;
      plain += against('Expert', [], seed).attacks;
    }
    expect(dumb).toBeGreaterThanOrEqual(plain);
    // Nothing to defend: not a single draw differs.
    const dummy = scriptedController(wait(1));
    const play = (quirks: readonly string[]) => runControllers(endless, createInitialState(endless, 4, duelPlacements(2.5)), [dummy, createAiController(endless, 'Expert', 'Balanced', { quirks })], TICK_RATE * 10);
    const a = play([]);
    const b = play(['Dumb']);
    expect(hashValue(b.states.at(-1))).toBe(hashValue(a.states.at(-1)));
    expect(a.events.filter((e) => e.type === 'Hit' && e.attacker === 1).length).toBeGreaterThan(0);
  });

  it('it does not Block a dagger thrown at it (the throw roll), where the same AI does', () => {
    const catcher: TuningData = { ...repo, ai: { ...repo.ai, aggression: 0, kickRate: 0, throwRate: 0 } };
    const run = (quirks: readonly string[]) => {
      const ai = createAiController(catcher, { ...aiDifficulty(catcher, 'Expert'), mistakeRate: 0 }, 'Balanced', { quirks });
      const initial = createInitialState(catcher, 1, duelPlacements(6));
      return runControllers(catcher, initial, [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)]), ai], 200);
    };
    const blocked = (r: ReturnType<typeof run>) => r.events.some((e) => e.type === 'DaggerBlocked' || (e.type === 'Block' && e.defender === 1));
    const hit = (r: ReturnType<typeof run>) => r.events.some((e) => e.type === 'DaggerHit');
    expect([blocked(run([])), hit(run([]))]).toEqual([true, false]);
    expect([blocked(run(['Dumb'])), hit(run(['Dumb']))]).toEqual([false, true]);
  });

  it('a Kick coming: it rolls once per Kick (kickRead) and, Dumb, does not stand still for it; the memory passes the resync validator', () => {
    const run = (quirks: readonly string[]) => {
      const ai = createAiController(endless, 'Expert', 'Balanced', { quirks });
      const reads: unknown[] = [];
      const recording: Controller = {
        intent: (s, i) => {
          const intent = ai.intent(s, i);
          const m = ai.save();
          expect(isAiMemory(m)).toBe(true);
          reads.push((m as { kickRead?: unknown }).kickRead);
          return intent;
        },
      };
      runControllers(endless, createInitialState(endless, 1, duelPlacements(1.0)), [scriptedController([...wait(40), ...hold(1, { kick: true }), ...wait(120)]), recording], 160);
      return reads;
    };
    expect(run([]).every((r) => r === undefined)).toBe(true);
    const dumb = run(['Dumb']);
    expect(dumb).toContainEqual({ kicker: 0, defend: false });
    expect(dumb.at(-1)).toBeUndefined();
  });
});
