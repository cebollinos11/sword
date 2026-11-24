import { describe, expect, it } from 'vitest';
import { commonItem, createMatch } from './sim';
import { loadTuningData } from './tuning';
import { devAutopilot, devDelverFloor, devDelverStart, devMode, devRunRelics } from './devMode';

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

describe('devRunRelics: a Run starts holding chosen Relics only in dev mode', () => {
  const tuning = loadTuningData();
  const options = { format: 'Gauntlet' as const, bestOf: 1, arena: 'gen:greybox:4242', teams: [0, 1, 1, 1, 1] };
  const names = tuning.relics.slice(0, 5).map((r) => r.name);

  it('reads the names, in order', () => {
    expect(devRunRelics('?dev=1&relics=Whetstone,Iron%20Plate', '')).toEqual({ relics: ['Whetstone', 'Iron Plate'] });
    expect(devRunRelics('?relics=Whetstone', '#/play?dev=1')).toEqual({ relics: ['Whetstone'] });
    expect(devRunRelics('?dev=1', '')).toEqual({});
  });

  it('is ignored without dev=1', () => {
    expect(devRunRelics('?relics=Whetstone', '')).toEqual({});
    expect(createMatch(tuning, { ...options, ...devRunRelics('?relics=Whetstone', '') })).toEqual(createMatch(tuning, options));
  });

  it('gives each Player the inventory and the matching mods', () => {
    const f = createMatch(tuning, { ...options, ...devDelverStart('?dev=1&delverStart=2', ''), relics: names }).duel.fighters[0]!;
    const { equippedRelics } = tuning.dungeon.inventory;
    expect(f.inventory!.relics).toEqual(names.map(commonItem));
    expect(f.inventory!.equipped).toEqual(names.slice(0, equippedRelics).map((_, k) => k));
    const plain = createMatch(tuning, options).duel.fighters[0]!;
    expect(f.mods).not.toEqual(plain.mods);
    expect(f.mods).toEqual(createMatch(tuning, { ...options, relics: names.slice(0, equippedRelics) }).duel.fighters[0]!.mods);
  });

  it('throws on an unknown Relic', () => {
    expect(() => createMatch(tuning, { ...options, relics: ['Nope'] })).toThrow(/Unknown Relic "Nope"/);
  });
});

describe('devAutopilot: the Player Seat on the Delver pilot, only in dev mode', () => {
  it('is on with autopilot=1, in the search or after the route', () => {
    expect(devAutopilot('?dev=1&autopilot=1', '')).toBe(true);
    expect(devAutopilot('', '#/play?dev=1&autopilot=1')).toBe(true);
  });

  it('is off outside dev mode, without the parameter, or with anything but 1', () => {
    expect(devAutopilot('?autopilot=1', '')).toBe(false);
    expect(devAutopilot('?dev=1', '')).toBe(false);
    expect(devAutopilot('?dev=1&autopilot=0', '')).toBe(false);
    expect(devAutopilot('?dev=1&autopilot=2,1', '')).toBe(false);
  });
});

describe('devDelverFloor: the Map Editor opens a generated Delver Floor, only in dev mode', () => {
  it('reads the seed and the Floor, in the search or after the route', () => {
    expect(devDelverFloor('?dev=1&delverSeed=7&delverFloor=1', '')).toEqual({ seed: 7, floor: 1 });
    expect(devDelverFloor('', '#/mapeditor?dev=1&delverSeed=0&delverFloor=3')).toEqual({ seed: 0, floor: 3 });
    expect(devDelverFloor('?delverSeed=4294967295', '#/mapeditor?dev=1&delverFloor=9')).toEqual({ seed: 4294967295, floor: 9 });
  });

  it('reads a set piece to deal every Hall for (Stage 7f), and leaves out any other value', () => {
    for (const piece of ['cross', 'uphill', 'spiral'] as const) expect(devDelverFloor(`?dev=1&delverSeed=7&delverFloor=1&delverPiece=${piece}`, '')).toEqual({ seed: 7, floor: 1, piece });
    expect(devDelverFloor('', '#/mapeditor?dev=1&delverSeed=7&delverFloor=1&delverPiece=moat')).toEqual({ seed: 7, floor: 1 });
    expect(devDelverFloor('?dev=1&delverPiece=spiral', '')).toBeNull();
  });

  it('refuses a bad or missing value', () => {
    for (const bad of ['delverSeed=-1&delverFloor=1', 'delverSeed=1.5&delverFloor=1', 'delverSeed=abc&delverFloor=1', 'delverSeed=4294967296&delverFloor=1',
      'delverSeed=1&delverFloor=0', 'delverSeed=1&delverFloor=1.5', 'delverSeed=1&delverFloor=x', 'delverSeed=1', 'delverFloor=1', '']) {
      expect(devDelverFloor(`?dev=1&${bad}`, '')).toBeNull();
    }
  });

  it('is null without dev=1', () => {
    expect(devDelverFloor('?delverSeed=7&delverFloor=1', '')).toBeNull();
    expect(devDelverFloor('?dev=0&delverSeed=7&delverFloor=1', '')).toBeNull();
  });
});

describe('devDelverStart: a Delver Run starts on a chosen Floor only in dev mode', () => {
  it('reads delverStart as a whole number from 1', () => {
    expect(devDelverStart('?dev=1&delverStart=3', '')).toEqual({ delverStart: 3 });
    expect(devDelverStart('', '#/play?dev=1&delverStart=9')).toEqual({ delverStart: 9 });
  });

  it('is nothing without dev=1, or with a bad value', () => {
    for (const q of ['?delverStart=3', '?dev=0&delverStart=3', '?dev=1', '?dev=1&delverStart=0', '?dev=1&delverStart=x', '?dev=1&delverStart=-2', '?dev=1&delverStart=2.5'])
      expect(devDelverStart(q, ''), q).toEqual({});
  });

  it('outside dev mode a Delver Run built with it starts on Floor 1', () => {
    const tuning = loadTuningData();
    const options = { format: 'Gauntlet' as const, bestOf: 1, arena: 'gen:greybox:4242', teams: [0, 1, 1, 1, 1] };
    expect(createMatch(tuning, { ...options, ...devDelverStart('?delverStart=3', '') })).toEqual(createMatch(tuning, options));
    expect(createMatch(tuning, { ...options, ...devDelverStart('?dev=1&delverStart=3', '') }).delver).toMatchObject({ floor: 3 });
  });
});
