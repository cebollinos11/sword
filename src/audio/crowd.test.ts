import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createCrowd, type CrowdState } from '../sim';
import { crowdCues, crowdFighting } from './cues';
import { crowdDin, pickFighting, SILENT_DIN } from './crowdDin';
import type { Ears } from './spatial';

const tuning = loadTuningData();
const hearing = tuning.audio.crowd;
const crowd = createCrowd(tuning.battle, 3);
/** The Crowd with Soldier `i`'s entries changed. */
const edit = (c: CrowdState, i: number, change: Partial<Record<'hp' | 'alive' | 'slot' | 'target', number>>): CrowdState => {
  const next = { ...c } as Record<string, unknown>;
  for (const [k, v] of Object.entries(change)) {
    const xs = (c[k as keyof CrowdState] as readonly number[]).slice();
    xs[i] = v;
    next[k] = xs;
  }
  return next as unknown as CrowdState;
};
const ears: Ears = { position: { x: 0, y: 1.2, z: 0 }, right: { x: 1, z: 0 } };

describe('crowdCues', () => {
  it('a Soldier in the Crowd losing HP is a blow, and one falling there is a cry, each where it stands', () => {
    const hurt = edit(crowd, 4, { hp: crowd.hp[4]! - 10 });
    const fell = edit(hurt, 9, { hp: 0, alive: 0 });
    expect(crowdCues(crowd, fell)).toEqual([
      { sound: 'CrowdBlow', at: { x: crowd.x[4], y: 0, z: crowd.z[4] }, flat: true },
      { sound: 'CrowdFall', at: { x: crowd.x[9], y: 0, z: crowd.z[9] }, flat: true },
    ]);
  });

  it('nothing without a Crowd heard before (a seek, a Duel), and nothing for promoted Soldiers or respawns', () => {
    const hurt = edit(crowd, 4, { hp: 1 });
    expect(crowdCues(undefined, hurt)).toEqual([]);
    expect(crowdCues(crowd, undefined)).toEqual([]);
    const promoted = edit(crowd, 4, { slot: 2 });
    expect(crowdCues(promoted, edit(promoted, 4, { hp: 0, alive: 0 }))).toEqual([]);
    const dead = edit(crowd, 4, { hp: 0, alive: 0 });
    expect(crowdCues(dead, crowd)).toEqual([]);
  });
});

describe('crowdFighting', () => {
  it('is where the living, engaged Soldiers in the Crowd stand', () => {
    const engaged = edit(edit(crowd, 1, { target: 50 }), 2, { target: 51 });
    expect(crowdFighting(engaged)).toEqual([
      { x: crowd.x[1], y: 0, z: crowd.z[1] },
      { x: crowd.x[2], y: 0, z: crowd.z[2] },
    ]);
    expect(crowdFighting(edit(engaged, 2, { slot: 0 }))).toHaveLength(1);
    expect(crowdFighting(edit(engaged, 2, { alive: 0 }))).toHaveLength(1);
    expect(crowdFighting(undefined)).toEqual([]);
  });
});

describe('crowdDin', () => {
  const at = (x: number, z: number) => ({ x, y: 0, z });
  const many = (n: number, x: number, z: number) => Array.from({ length: n }, () => at(x, z));

  it('is silent with nobody fighting, or all of it beyond hearing', () => {
    expect(crowdDin([], ears, hearing)).toEqual(SILENT_DIN);
    expect(crowdDin(many(50, hearing.far * 2, 0), ears, hearing)).toEqual(SILENT_DIN);
  });

  it('swells with more fighting, levelling off below full', () => {
    const few = crowdDin(many(3, 0, 10), ears, hearing).level;
    const lots = crowdDin(many(100, 0, 10), ears, hearing).level;
    expect(few).toBeGreaterThan(0);
    expect(lots).toBeGreaterThan(few);
    expect(lots).toBeLessThan(1);
  });

  it('a far fight is quieter and more muffled than the same fight close by, and it carries far past a Fighter’s sounds', () => {
    const close = crowdDin(many(40, 0, 5), ears, hearing);
    const far = crowdDin(many(40, 0, 100), ears, hearing);
    expect(far.level).toBeGreaterThan(0);
    expect(far.level).toBeLessThan(close.level);
    expect(close.cutoff).toBeNull();
    expect(far.cutoff!).toBeLessThan(5000);
    expect(far.wet).toBeGreaterThan(close.wet);
    expect(100).toBeGreaterThan(tuning.audio.far);
  });

  it('comes from the side the fighting is on, and a fight all round is centred', () => {
    expect(crowdDin(many(20, 30, 0), ears, hearing).pan).toBeGreaterThan(0.5);
    expect(crowdDin(many(20, -30, 0), ears, hearing).pan).toBeLessThan(-0.5);
    expect(crowdDin([...many(20, 30, 0), ...many(20, -30, 0)], ears, hearing).pan).toBeCloseTo(0);
  });

  it('picks a clash from a fighting Soldier, louder-heard ones likelier, never one beyond hearing', () => {
    const din = crowdDin([at(0, 5), at(hearing.far * 2, 0), at(0, 120)], ears, hearing);
    const picks = Array.from({ length: 200 }, (_, k) => pickFighting(din, k / 200));
    expect(picks).not.toContain(1);
    expect(picks.filter((i) => i === 0).length).toBeGreaterThan(picks.filter((i) => i === 2).length);
    expect(pickFighting(SILENT_DIN, 0.5)).toBe(-1);
  });
});
