import { afterEach, describe, expect, it } from 'vitest';
import { damageNumbersEnabled, setDamageNumbersEnabled } from './damageNumbers';

afterEach(() => setDamageNumbersEnabled(true));

describe('damage numbers setting', () => {
  it('starts on, and can be turned off and on again', () => {
    expect(damageNumbersEnabled()).toBe(true);
    setDamageNumbersEnabled(false);
    expect(damageNumbersEnabled()).toBe(false);
    setDamageNumbersEnabled(true);
    expect(damageNumbersEnabled()).toBe(true);
  });
});
