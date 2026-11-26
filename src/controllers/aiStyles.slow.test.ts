/**
 * The data-only Styles (docs/plans/enemy-behaviours.md, Stage 2): Duels of each against a Balanced AI of the same tier, on
 * the Editor's flat Arena, counting its signature move. Counts over a fixed set of seeds, not exact sequences.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createInitialState, duelPlacements, step, TICK_RATE, type Action, type SimState } from '../sim';
import { createAiController, type AiController } from './index';
import { controllerIntents } from './controller';

const repo = loadTuningData();
/** Nobody dies, so every Duel runs its whole length and the counts are over the same time. */
const endless: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const TICKS = TICK_RATE * 60;

interface Counts {
  /** Chambers it planned (one per enemy Attack it chose to Chamber). */
  readonly planned: number;
  /** Of those, the ones that landed (a Chamber event of its own while that plan stood). */
  readonly landed: number;
  /** Chambers of its own, planned or not. */
  readonly chambers: number;
  /** Chains it started (attack held through a Recovery, or a Whiff Chain). */
  readonly chains: number;
  /** Recoveries it went into: each is a chance to Chain. */
  readonly recoveries: number;
}

const chaining = (a: Action): boolean => a.kind === 'Attack' && (a.chain !== undefined || a.whiffChain !== undefined);

/** Fighter 0 plays `style`, Fighter 1 a Balanced AI of the same tier; Fighter 0's counts over every seed. */
function duel(tier: string, style: string, seeds = SEEDS): Counts {
  let planned = 0;
  let landed = 0;
  let chambers = 0;
  let chains = 0;
  let recoveries = 0;
  for (const seed of seeds) {
    const ais: AiController[] = [createAiController(endless, tier, style), createAiController(endless, tier, 'Balanced')];
    const plans = new Set<string>();
    const hits = new Set<string>();
    let s: SimState = createInitialState(endless, seed, duelPlacements(2.5));
    for (let t = 0; t < TICKS; t++) {
      const before = s.fighters[0]!.action;
      s = step(s, controllerIntents(s, ais), endless);
      const plan = (ais[0]!.save() as { defencePlan: { kind: string; attacker: number; attackStart: number } | null }).defencePlan;
      const key = plan?.kind === 'Chamber' ? `${plan.attacker}:${plan.attackStart}` : null;
      if (key !== null) plans.add(key);
      for (const e of s.events) {
        if (e.type !== 'Chamber' || e.chamberer !== 0) continue;
        chambers++;
        if (key !== null) hits.add(key);
      }
      const now = s.fighters[0]!.action;
      if (chaining(now) && !chaining(before)) chains++;
      if (now.kind === 'Attack' && now.phase === 'Recovery' && !(before.kind === 'Attack' && before.phase === 'Recovery')) recoveries++;
    }
    planned += plans.size;
    landed += hits.size;
  }
  return { planned, landed, chambers, chains, recoveries };
}

describe('the data-only Styles, against a Balanced AI of the same tier', () => {
  const balanced = { Beginner: duel('Beginner', 'Balanced'), Skilled: duel('Skilled', 'Balanced'), Expert: duel('Expert', 'Balanced') };

  it('a Chambermaster Chambers at least twice as often as Balanced at Skilled and Expert', () => {
    for (const tier of ['Skilled', 'Expert'] as const) {
      const cm = duel(tier, 'Chambermaster');
      expect(cm.chambers, `${tier} ${JSON.stringify(cm)} vs ${JSON.stringify(balanced[tier])}`).toBeGreaterThanOrEqual(2 * balanced[tier].chambers);
    }
  });

  it('a Beginner Chambermaster plans no Chamber: its Reaction Time outlasts every Wind-up (settled with the user)', () => {
    expect(duel('Beginner', 'Chambermaster', SEEDS.slice(0, 4)).planned).toBe(0);
  });

  it('a Skilled Chambermaster lands fewer of its Chambers than an Expert, which lands most of them (the Chamber timing error)', () => {
    const skilled = duel('Skilled', 'Chambermaster');
    const expert = duel('Expert', 'Chambermaster');
    const rate = (c: Counts) => c.landed / c.planned;
    expect(rate(expert), JSON.stringify(expert)).toBeGreaterThan(0.75);
    expect(rate(skilled), `${JSON.stringify(skilled)} vs ${JSON.stringify(expert)}`).toBeLessThan(rate(expert));
  });

  it('a Reckless AI Chains at least twice as often as Balanced at Beginner and Skilled, and on nearly every Recovery at Expert', () => {
    for (const tier of ['Beginner', 'Skilled'] as const) {
      const r = duel(tier, 'Reckless');
      expect(r.chains, `${tier} ${JSON.stringify(r)} vs ${JSON.stringify(balanced[tier])}`).toBeGreaterThanOrEqual(2 * balanced[tier].chains);
    }
    // An Expert Balanced already Chains on about half its Recoveries (chainRate 0.45, more under Pressure), so twice that is
    // more Recoveries than there are: a Blocked Attack recoils and has none. Reckless takes nearly all of them.
    const r = duel('Expert', 'Reckless');
    const b = balanced.Expert;
    expect(r.chains / r.recoveries, `${JSON.stringify(r)} vs ${JSON.stringify(b)}`).toBeGreaterThan(0.85);
    expect(r.chains / r.recoveries).toBeGreaterThan(1.4 * (b.chains / b.recoveries));
  });
});
