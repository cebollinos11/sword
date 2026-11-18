import { afterEach, describe, expect, it } from 'vitest';
import { dustEnabled, setDustEnabled } from './dustfall';

afterEach(() => setDustEnabled(true));

describe('dust & embers setting', () => {
  it('starts on, and can be turned off and on again', () => {
    expect(dustEnabled()).toBe(true);
    setDustEnabled(false);
    expect(dustEnabled()).toBe(false);
    setDustEnabled(true);
    expect(dustEnabled()).toBe(true);
  });
});
