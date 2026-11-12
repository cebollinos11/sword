/**
 * A Run's Weapons (Tuning Data `dungeon.leftOutWeapons`): a `"random"` enemy's Weapon and a Weapon drop come from the roster without
 * the left-out ones, so none of the Flail, the Quarterstaff and the Dagger turns up in a Run, and the draws for the rest are the ones they were before it joined.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, runWeapons, type TuningData } from '../tuning';
import { floorGraph, runSeed } from './dungeon';
import { hallRoster } from './hall';
import { hallDrops } from './pickups';

const tuning = loadTuningData();
/**
 * Every Hall of the first few Run seeds: each `"random"` enemy's Weapon, and (the first seed only: a drop builds its Hall's Arena)
 * each Weapon dropped where a Hall drops only Weapons, as many as it can.
 */
function runPicks(t: TuningData): { enemies: Set<string>; drops: Set<string> } {
  const weaponsOnly: TuningData = { ...t, dungeon: { ...t.dungeon, loot: { ...t.dungeon.loot, weights: { Relic: 0, Weapon: 1 }, drops: { Fight: 4, Elite: 4, Boss: 4 } } } };
  const enemies = new Set<string>();
  const drops = new Set<string>();
  for (let seed = 1; seed <= 4; seed++) {
    const arena = `gen:greybox:${seed}`;
    const config = { arena, humans: 2, players: [0, 1], teams: [0, 0, 1, 1, 1, 1] };
    for (let floor = 1; floor <= t.dungeon.floors.length; floor++) {
      floorGraph(t.dungeon, runSeed(arena), floor, 'greybox').forEach((row, r) =>
        row.forEach((hall, index) => {
          const at = { floor, row: r, index };
          for (const e of hallRoster(t, config, at)) if (e) enemies.add(e.weapon);
          if (seed === 1) for (const p of hallDrops(weaponsOnly, config, at, hall, 0)) if (p.kind === 'weapon') drops.add(p.item);
        }),
      );
    }
  }
  return { enemies, drops };
}

describe("a Run's Weapons", () => {
  it('are the roster without the Flail, the Quarterstaff and the Dagger, in file order', () => {
    expect(tuning.dungeon.leftOutWeapons).toEqual(['Flail', 'Quarterstaff', 'Dagger']);
    expect(runWeapons(tuning)).toEqual(Object.keys(tuning.weapons).filter((w) => w !== 'Flail' && w !== 'Quarterstaff' && w !== 'Dagger'));
  });

  it('never give the Flail, the Quarterstaff or the Dagger to a random enemy or drop them as loot; every other Weapon turns up', () => {
    const { enemies, drops } = runPicks(tuning);
    for (const w of ['Flail', 'Quarterstaff', 'Dagger']) {
      expect(enemies.has(w), w).toBe(false);
      expect(drops.has(w), w).toBe(false);
    }
    expect([...drops].sort()).toEqual(runWeapons(tuning).sort());
  });

  it('would, without the list (so the test above can fail)', () => {
    const { enemies, drops } = runPicks({ ...tuning, dungeon: { ...tuning.dungeon, leftOutWeapons: [] } });
    for (const w of ['Flail', 'Quarterstaff', 'Dagger']) expect(enemies.has(w) || drops.has(w), w).toBe(true);
  });
});
