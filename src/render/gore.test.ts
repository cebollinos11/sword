import { afterEach, describe, expect, it } from 'vitest';
import { goreEnabled, setGoreEnabled } from './gore';

afterEach(() => setGoreEnabled(true));

describe('blood & gore setting', () => {
  it('starts on, and can be turned off and on again', () => {
    expect(goreEnabled()).toBe(true);
    setGoreEnabled(false);
    expect(goreEnabled()).toBe(false);
    setGoreEnabled(true);
    expect(goreEnabled()).toBe(true);
  });
});
