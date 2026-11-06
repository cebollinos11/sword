import { describe, expect, it } from 'vitest';
import { loadTuningData, type AudioTuning } from '../tuning';
import { placement, UNPLACED, type Ears } from './spatial';

const hearing: AudioTuning = loadTuningData().audio;
/** At the origin, chest high, facing +z with +x to its right. */
const ears: Ears = { position: { x: 0, y: 1.2, z: 0 }, right: { x: 1, z: 0 } };
const at = (x: number, z: number, y = 1.2) => ({ x, y, z });

describe('placement', () => {
  it('a sound with no place, or with no ears to hear it, plays as it always did', () => {
    expect(placement(undefined, ears, hearing)).toEqual(UNPLACED);
    expect(placement(at(10, 0), null, hearing)).toEqual(UNPLACED);
  });

  it('within `near` a sound plays at full level, unmuffled and no wetter', () => {
    const p = placement(at(0, hearing.near * 0.9), ears, hearing);
    expect(p.gain).toBe(1);
    expect(p.cutoff).toBeNull();
    expect(p.wet).toBe(0);
  });

  it('further off it is quieter, more muffled and wetter, and silent at `far`', () => {
    const near = placement(at(0, hearing.near + 5), ears, hearing);
    const mid = placement(at(0, (hearing.near + hearing.far) / 2), ears, hearing);
    const far = placement(at(0, hearing.far), ears, hearing);
    expect(near.gain).toBeGreaterThan(mid.gain);
    expect(mid.gain).toBeGreaterThan(0);
    expect(far.gain).toBe(0);
    expect(near.cutoff!).toBeGreaterThan(mid.cutoff!);
    expect(far.cutoff).toBeCloseTo(hearing.muffle);
    expect(mid.wet).toBeGreaterThan(near.wet);
    expect(far.wet).toBeCloseTo(hearing.farWet);
    expect(placement(at(0, hearing.far * 2), ears, hearing).gain).toBe(0);
  });

  it('pans to the side it comes from, by the ears’ right, and straight ahead or behind is centred', () => {
    expect(placement(at(8, 0), ears, hearing).pan).toBeCloseTo(hearing.pan);
    expect(placement(at(-8, 0), ears, hearing).pan).toBeCloseTo(-hearing.pan);
    expect(placement(at(0, 8), ears, hearing).pan).toBeCloseTo(0);
    expect(placement(at(0, -8), ears, hearing).pan).toBeCloseTo(0);
    // Turned to face -x (right is +z): what was ahead is now on the left.
    const turned: Ears = { ...ears, right: { x: 0, z: 1 } };
    expect(placement(at(0, -8), turned, hearing).pan).toBeCloseTo(-hearing.pan);
  });

  it("a sound at the ears (one's own blow) is centred, not thrown to one side", () => {
    expect(placement(at(0.2, 0), ears, hearing).pan).toBeLessThan(0.1 * hearing.pan + 1e-9);
    expect(placement(at(0, 0), ears, hearing).pan).toBe(0);
  });
});
