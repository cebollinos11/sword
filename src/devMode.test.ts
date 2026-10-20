import { describe, expect, it } from 'vitest';
import { devMode } from './devMode';

describe('devMode: developer options are offered only with ?dev=1', () => {
  it('reads the dev flag from the query string', () => {
    expect(devMode('?dev=1', '')).toBe(true);
    expect(devMode('?seed=3&dev=1', '')).toBe(true);
    expect(devMode('?dev=0', '')).toBe(false);
    expect(devMode('', '')).toBe(false);
  });

  it('reads it after the route too (#/editor/sandbox?dev=1)', () => {
    expect(devMode('', '#/editor/sandbox?dev=1')).toBe(true);
    expect(devMode('', '#/editor/sandbox')).toBe(false);
  });
});
