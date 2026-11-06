import { afterEach, describe, expect, it } from 'vitest';
import { getMasterVolume, masterVolumeGain, onMasterVolume, setMasterVolume } from './volume';

afterEach(() => setMasterVolume(1));

describe('master volume', () => {
  it('starts full, and is clamped to 0..1 (nonsense is full)', () => {
    expect(getMasterVolume()).toBe(1);
    setMasterVolume(1.5);
    expect(getMasterVolume()).toBe(1);
    setMasterVolume(-0.2);
    expect(getMasterVolume()).toBe(0);
    setMasterVolume(Number.NaN);
    expect(getMasterVolume()).toBe(1);
  });

  it('plays at the square of the slider, so its middle sounds like half', () => {
    expect(masterVolumeGain(0)).toBe(0);
    expect(masterVolumeGain(0.5)).toBe(0.25);
    expect(masterVolumeGain(1)).toBe(1);
  });

  it('tells its listeners the new gain at once, until they unsubscribe', () => {
    const heard: number[] = [];
    const off = onMasterVolume((g) => heard.push(g));
    setMasterVolume(0.5);
    off();
    setMasterVolume(0.8);
    expect(heard).toEqual([0.25]);
  });
});
