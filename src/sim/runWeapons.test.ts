/**
 * A Run's Weapons (Tuning Data `dungeon.leftOutWeapons`): a `"random"` enemy's Weapon and a Weapon drop come from the roster without
 * the left-out ones, so the Flail never turns up in a Run, and the draws for the rest are the ones they were before it joined.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, runWeapons, type TuningData } from '../tuning';
import { floorGraph, runSeed } from './dungeon';
import { hallRoster } from './hall';
import { hallDrops } from './pickups';

const tuning = loadTuningData();
/** Every Hall of the first few Run seeds: each `"random"` enemy's Weapon, and each Weapon dropped where a Hall drops only Weapons. */
function runPicks(t: TuningData): { enemies: Set<string>; drops: Set<string> } {
  const weaponsOnly: TuningData = { ...t, dungeon: { ...t.dungeon, loot: { ...t.dungeon.loot, weights: { Relic: 0, Weapon: 1 }, drops: { Fight: 3, Elite: 3, Boss: 3 } } } };
  const enemies = new Set<string>();
  const drops = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const arena = `gen:greybox:${seed}`;
    const config = { arena, humans: 2, players: [0, 1], teams: [0, 0, 1, 1, 1, 1] };
    for (let floor = 1; floor <= t.dungeon.floors.length; floor++) {
      floorGraph(t.dungeon, runSeed(arena), floor, 'greybox').forEach((row, r) =>
        row.forEach((hall, index) => {
          const at = { floor, row: r, index };
          for (const e of hallRoster(t, config, at)) if (e) enemies.add(e.weapon);
          for (const p of hallDrops(weaponsOnly, config, at, hall, 0)) if (p.kind === 'weapon') drops.add(p.item);
        }),
      );
    }
  }
  return { enemies, drops };
}

describe("a Run's Weapons", () => {
  it('are the roster without the Flail, in file order', () => {
    expect(tuning.dungeon.leftOutWeapons).toEqual(['Flail']);
    expect(runWeapons(tuning)).toEqual(Object.keys(tuning.weapons).filter((w) => w !== 'Flail'));
  });

  it('never give the Flail to a random enemy or drop it as loot; every other Weapon turns up', () => {
    const { enemies, drops } = runPicks(tuning);
    expect(enemies.has('Flail')).toBe(false);
    expect(drops.has('Flail')).toBe(false);
    expect([...drops].sort()).toEqual(runWeapons(tuning).sort());
  });

  it('would, without the list (so the test above can fail)', () => {
    const { enemies, drops } = runPicks({ ...tuning, dungeon: { ...tuning.dungeon, leftOutWeapons: [] } });
    expect(enemies.has('Flail') || drops.has('Flail')).toBe(true);
  });
});
