import { describe, expect, it } from 'vitest';
import { createMatch } from './sim';
import { loadTuningData } from './tuning';
import { devAutopilot, devMode, devRunStart } from './devMode';

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
    // As every other dev option is read: after the route wins.
    expect(devMode('?dev=1', '#/editor/sandbox?dev=0')).toBe(false);
    expect(devMode('?dev=0', '#/editor/sandbox?dev=1')).toBe(true);
  });
});

describe('devRunStart: a Run starts at a chosen Floor and row only in dev mode', () => {
  it('reads floor, row and hall (each from 1) into a start Hall (row and index from 0)', () => {
    expect(devRunStart('?dev=1&floor=2&row=5', '')).toEqual({ start: { floor: 2, row: 4 } });
    expect(devRunStart('?dev=1&floor=1&row=3&hall=2', '')).toEqual({ start: { floor: 1, row: 2, index: 1 } });
    expect(devRunStart('?dev=1&floor=3', '')).toEqual({ start: { floor: 3, row: 0 } });
    expect(devRunStart('?floor=2', '#/play?dev=1&row=2')).toEqual({ start: { floor: 2, row: 1 } });
  });

  it('is ignored outside dev mode, and without a Floor', () => {
    expect(devRunStart('?floor=2&row=5', '')).toEqual({});
    expect(devRunStart('?dev=0&floor=2&row=5', '')).toEqual({});
    expect(devRunStart('?dev=1', '')).toEqual({});
    expect(devRunStart('?dev=1&floor=x&row=5', '')).toEqual({});
  });

  it('outside dev mode a Run built with it starts at its first Hall', () => {
    const tuning = loadTuningData();
    const options = { format: 'Gauntlet' as const, bestOf: 1, arena: 'gen:greybox:4242', teams: [0, 1, 1, 1, 1] };
    expect(createMatch(tuning, { ...options, ...devRunStart('?floor=2&row=5', '') })).toEqual(createMatch(tuning, options));
    expect(createMatch(tuning, { ...options, ...devRunStart('?dev=1&floor=2&row=5', '') }).run).toMatchObject({ floor: 2, row: 4 });
  });
});

describe('devAutopilot: the Player Seat on an AI, only in dev mode', () => {
  it('reads the Door to take in each row (from 1) into exits (from 0)', () => {
    expect(devAutopilot('?dev=1&autopilot=1', '')).toEqual([0]);
    expect(devAutopilot('?dev=1&autopilot=2,1,3', '')).toEqual([1, 0, 2]);
    expect(devAutopilot('', '#/play?dev=1&autopilot=2')).toEqual([1]);
  });

  it('is ignored outside dev mode, without the parameter, or with anything but Doors from 1', () => {
    expect(devAutopilot('?autopilot=1', '')).toBeNull();
    expect(devAutopilot('?dev=1', '')).toBeNull();
    expect(devAutopilot('?dev=1&autopilot=0', '')).toBeNull();
    expect(devAutopilot('?dev=1&autopilot=yes', '')).toBeNull();
  });
});
