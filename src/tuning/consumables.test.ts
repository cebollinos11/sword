import { describe, expect, it } from 'vitest';
import { loadTuningData, parseConsumables, parseTuningData } from './index';

describe('Consumables Tuning Data (data/consumables.json)', () => {
  const tuning = loadTuningData();

  it('loads the repo file, and parsing its own output gives it back', () => {
    expect(tuning.consumables).toEqual([
      { name: 'Health Potion', icon: 'potion', effect: 'healFull' },
      { name: 'Map', icon: 'map', effect: 'revealFloor' },
      { name: 'Resurrection Stone', icon: 'stone', effect: 'reviveFallen' },
    ]);
    expect(parseConsumables(tuning.consumables, tuning.relics.map((r) => r.name))).toEqual(tuning.consumables);
  });

  it('refuses an unknown effect, a missing name or icon, a duplicate, and a Relic\'s name', () => {
    const one = (patch: object) => [{ name: 'Elixir', icon: 'potion', effect: 'healFull', ...patch }];
    expect(() => parseConsumables(one({ effect: 'fly' }))).toThrow(/consumables\[0\]\.effect/);
    expect(() => parseConsumables(one({ effect: undefined }))).toThrow(/effect/);
    expect(() => parseConsumables(one({ name: '' }))).toThrow(/name/);
    expect(() => parseConsumables(one({ icon: undefined }))).toThrow(/icon/);
    expect(() => parseConsumables([...one({}), ...one({})])).toThrow(/duplicate Consumable "Elixir"/);
    expect(() => parseConsumables(one({ name: 'Whetstone' }), ['Whetstone'])).toThrow(/Relic's name/);
    expect(() => parseConsumables({})).toThrow(/consumables/);
  });

  it('is optional in raw Tuning Data (none), and refuses one named like a Relic there', () => {
    // Loaded Tuning Data as raw input, as the Editor reparses it.
    const { consumables: _c, ...rest } = tuning;
    const raw = { ...rest, weapons: Object.values(tuning.weapons), motions: Object.values(tuning.motions), motionOverrides: {} };
    expect(parseTuningData(raw).consumables).toEqual([]);
    expect(() => parseTuningData({ ...raw, consumables: [{ name: tuning.relics[0]!.name, icon: 'map', effect: 'revealFloor' }] })).toThrow(/Relic's name/);
  });
});
