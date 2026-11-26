/**
 * The Hopper Quirk (docs/plans/enemy-behaviours.md, Stage 4): Duels of a Hopper against a Balanced AI of the same tier, on the
 * Editor's flat Arena, counting its jumping Attacks against the same AI without the Quirk; and its hops, caught 1 v 2 (a hop
 * needs a pincer or a blocked walk, so a 1 v 1 has none). Counts over a fixed set of seeds, not exact sequences.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createInitialState, duelPlacements, step, TICK_RATE, type SimState } from '../sim';
import { createAiController, type AiController } from './index';
import { controllerIntents } from './controller';

const repo = loadTuningData();
/** Nobody dies, so every run lasts its whole length and the counts are over the same time. */
const endless: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Fighter 0's Jumps over every seed: those with an Attack in the air (jumping Attacks) and those without (hops). */
function jumps(tier: string, quirks: readonly string[], pincer: boolean, seconds: number): { leaps: number; hops: number } {
  let leaps = 0;
  let hops = 0;
  for (const seed of SEEDS) {
    const ais: AiController[] = [createAiController(endless, tier, 'Balanced', { quirks }), createAiController(endless, tier, 'Balanced')];
    if (pincer) ais.push(createAiController(endless, tier, 'Balanced'));
    const spots = [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: -2, z: 1 }, facing: Math.PI },
      { position: { x: 2, z: 1 }, facing: Math.PI },
    ];
    let s: SimState = pincer ? createInitialState(endless, seed, spots, [], [0, 1, 1]) : createInitialState(endless, seed, duelPlacements(2.5));
    let up = false;
    let swung = false;
    for (let t = 0; t < TICK_RATE * seconds; t++) {
      const was = s.fighters[0]!;
      s = step(s, controllerIntents(s, ais), endless);
      const f = s.fighters[0]!;
      if (f.air?.jumped && !was.air) [up, swung] = [true, false];
      if (up && f.action.kind === 'Attack') swung = true;
      if (up && !f.air) {
        up = false;
        if (swung) leaps++;
        else hops++;
      }
    }
  }
  return { leaps, hops };
}

describe('Hopper, against the same AI without it', () => {
  const tiers = ['Beginner', 'Skilled', 'Expert'] as const;
  const leaps = Object.fromEntries(tiers.map((t) => [t, [jumps(t, [], false, 60).leaps, jumps(t, ['Hopper'], false, 60).leaps]]));
  const hops = Object.fromEntries(tiers.map((t) => [t, [jumps(t, [], true, 30).hops, jumps(t, ['Hopper'], true, 30).hops]]));

  it('jumping Attacks, 1 v 1: at least twice as many at Beginner and Skilled, and no fewer at Expert', () => {
    console.log('Hopper leaps [without, with]', JSON.stringify(leaps));
    for (const t of ['Beginner', 'Skilled'] as const) expect(leaps[t]![1], `${t} ${leaps[t]}`).toBeGreaterThanOrEqual(2 * Math.max(1, leaps[t]![0]!));
    // An Expert stands in the leap band (just beyond reach) only a few hundred Ticks a minute, so the counts are small.
    expect(leaps.Expert![1], `Expert ${leaps.Expert}`).toBeGreaterThanOrEqual(leaps.Expert![0]!);
  });

  it('hops, caught 1 v 2: at least 1.5× as many at every tier (an Expert jumpStep of 0.5 can at most double, and a hop needs a moment for it)', () => {
    console.log('Hopper hops [without, with]', JSON.stringify(hops));
    for (const t of tiers) expect(hops[t]![1], `${t} ${hops[t]}`).toBeGreaterThanOrEqual(1.5 * hops[t]![0]!);
  });
});
