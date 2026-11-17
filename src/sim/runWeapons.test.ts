/**
 * A Run's Weapons (Tuning Data `dungeon.leftOutWeapons`): a Weapon drop comes from the roster without the left-out ones, so none of the
 * Flail, the Quarterstaff and the Dagger turns up as loot in a Run.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, runWeapons, type TuningData } from '../tuning';
import { pickItemAt } from './pickups';

const tuning = loadTuningData();

/** Every Weapon a Run's loot picks over the first few Run seeds, Floors and pick slots, where the loot holds only Weapons. */
function weaponDrops(t: TuningData): Set<string> {
  const weaponsOnly: TuningData = { ...t, dungeon: { ...t.dungeon, loot: { ...t.dungeon.loot, weights: { Relic: 0, Weapon: 1 } } } };
  const drops = new Set<string>();
  for (let seed = 1; seed <= 4; seed++)
    for (let floor = 1; floor <= 9; floor++)
      for (let slot = 0; slot < 64; slot++) drops.add(pickItemAt(weaponsOnly, seed, floor, slot, []).item);
  return drops;
}

describe("a Run's Weapons", () => {
  it('are the roster without the Flail, the Quarterstaff and the Dagger, in file order', () => {
    expect(tuning.dungeon.leftOutWeapons).toEqual(['Flail', 'Quarterstaff', 'Dagger']);
    expect(runWeapons(tuning)).toEqual(Object.keys(tuning.weapons).filter((w) => w !== 'Flail' && w !== 'Quarterstaff' && w !== 'Dagger'));
  });

  it('never drop the Flail, the Quarterstaff or the Dagger as loot; every other Weapon turns up', () => {
    const drops = weaponDrops(tuning);
    for (const w of ['Flail', 'Quarterstaff', 'Dagger']) expect(drops.has(w), w).toBe(false);
    expect([...drops].sort()).toEqual(runWeapons(tuning).sort());
  });

  it('would, without the list (so the test above can fail)', () => {
    const drops = weaponDrops({ ...tuning, dungeon: { ...tuning.dungeon, leftOutWeapons: [] } });
    for (const w of ['Flail', 'Quarterstaff', 'Dagger']) expect(drops.has(w), w).toBe(true);
  });
});
