import { describe, expect, it } from 'vitest';
import { MAX_TEAM_SIZE } from '../sim';
import { applyDungeonKnobs, dungeonDifficultyLadder, loadTuningData, MAX_ENCOUNTER_ENEMIES, parseDungeon, parseRunKnobs, tuningDataHash, type TuningData } from './index';

const tuning = loadTuningData();
const WEAPONS = Object.keys(tuning.weapons);
const DIFFICULTIES = Object.keys(tuning.ai.difficulties);
const STYLES = Object.keys(tuning.ai.styles);
type RawFloor = Record<string, unknown> & { encounters: Record<string, unknown>; weights: Record<string, unknown> };
const raw = () => JSON.parse(JSON.stringify(tuning.dungeon)) as Record<string, unknown> & { floors: RawFloor[]; inventory: Record<string, unknown> };
const RELICS = tuning.relics.map((r) => r.name);
const parse = (d: unknown) => parseDungeon(d, WEAPONS, DIFFICULTIES, STYLES, RELICS);
/** The repo's Dungeon with its first Floor changed by `patch`. */
const withFloor = (patch: Record<string, unknown>) => {
  const d = raw();
  d.floors[0] = { ...d.floors[0]!, ...patch };
  return d;
};
const easy = (more: Record<string, unknown> = {}) => ({ difficulty: 'Easy', weapon: 'random', ...more });
const fight = (enemies: unknown[]) => withFloor({ encounters: { ...raw().floors[0]!.encounters, Fight: [{ enemies }] } });

describe('Dungeon Tuning Data (data/dungeon.json)', () => {
  it('loads the repo file: 3 Floors, each with its rows, weights, pools and Boss, and the Run numbers', () => {
    const d = tuning.dungeon;
    expect(d.floors.length).toBe(3);
    for (const f of d.floors) {
      expect(f.rows.length).toBe(3);
      expect(f.encounters.Fight.length).toBeGreaterThan(0);
      expect(f.boss.enemies.length).toBeGreaterThan(0);
    }
    expect(d.floors[2]!.boss.enemies[0]).toEqual({ difficulty: 'Expert', style: 'random', weapon: 'Sledge Hammer', body: 'wraith', hpScale: 3 });
    expect([d.doorSeconds, d.hallFadeSeconds, d.revive, d.restHeal, d.perPlayerHp, d.depthHp]).toEqual([1.5, 1, 0.25, 0.5, 0.5, 0.1]);
    expect(d.inventory).toEqual({ weapons: 3, relics: 6, equippedRelics: 3 });
    expect(d.loot).toEqual({ weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 1, Boss: 2 }, pedestals: 3 });
    // Parsing its own output gives it back (the Editor reparses loaded Tuning Data).
    expect(parse(d)).toEqual(d);
    expect(MAX_ENCOUNTER_ENEMIES).toBe(MAX_TEAM_SIZE);
  });

  it('fills defaults: hpScale 1, missing weights 0, a missing Elite pool empty', () => {
    const d = parse(withFloor({ weights: { Fight: 1 }, encounters: { Fight: [{ enemies: [easy()] }] } }));
    expect(d.floors[0]!.weights).toEqual({ Fight: 1, Elite: 0, Treasure: 0 });
    expect(d.floors[0]!.encounters).toEqual({ Fight: [{ enemies: [{ difficulty: 'Easy', weapon: 'random', hpScale: 1 }] }], Elite: [] });
  });

  it('refuses an unknown difficulty, Weapon or Style, and takes "random" for a Weapon or Style', () => {
    expect(() => parse(fight([easy({ difficulty: 'Legendary' })]))).toThrow(/floors\[0\]\.encounters\.Fight\[0\]\.enemies\[0\]\.difficulty/);
    expect(() => parse(fight([easy({ weapon: 'Spoon' })]))).toThrow(/floors\[0\]\.encounters\.Fight\[0\]\.enemies\[0\]\.weapon/);
    expect(() => parse(fight([easy({ style: 'Sneaky' })]))).toThrow(/enemies\[0\]\.style/);
    expect(parse(fight([easy({ style: 'random' }), easy({ weapon: WEAPONS[0], style: 'Counter' })])).floors[0]!.encounters.Fight[0]!.enemies.map((e) => [e.weapon, e.style])).toEqual([
      ['random', 'random'],
      [WEAPONS[0], 'Counter'],
    ]);
    const boss = withFloor({ boss: { enemies: [easy({ difficulty: 'Legendary' })] } });
    expect(() => parse(boss)).toThrow(/floors\[0\]\.boss\.enemies\[0\]\.difficulty/);
  });

  it('refuses 0 or more than 4 enemies, a bad minTeam, hpScale or relics', () => {
    expect(() => parse(fight([]))).toThrow(/1 to 4 enemies/);
    expect(() => parse(fight(Array(5).fill(easy())))).toThrow(/1 to 4 enemies/);
    for (const minTeam of [0, 1.5, 5]) expect(() => parse(fight([easy({ minTeam })]))).toThrow(/minTeam/);
    expect(() => parse(fight([easy({ hpScale: 0 })]))).toThrow(/hpScale/);
    for (const relics of [[], 2, 'Whetstone', ['Whetstone', 'Whetstone', 'Whetstone'], [7]]) expect(() => parse(fight([easy({ relics })]))).toThrow(/relics/);
    expect(parse(fight([easy({ relics: ['Whetstone', 'Whetstone'] })])).floors[0]!.encounters.Fight[0]!.enemies[0]!.relics).toEqual(['Whetstone', 'Whetstone']);
  });

  it('refuses an Encounter naming a Relic that does not exist', () => {
    expect(() => parse(fight([easy({ relics: ['Excalibur'] })]))).toThrow(/unknown Relic "Excalibur"/);
  });

  it('refuses an unknown Hall kind, in the weights or the pools', () => {
    for (const kind of ['Rest', 'Boss', 'Shop']) {
      expect(() => parse(withFloor({ weights: { Fight: 1, [kind]: 1 } }))).toThrow(/weights/);
      expect(() => parse(withFloor({ encounters: { Fight: [{ enemies: [easy()] }], [kind]: [{ enemies: [easy()] }] } }))).toThrow(/encounters/);
    }
  });

  it('refuses empty pools: no Fight Encounters, an empty Elite pool, or Elites weighted with no pool', () => {
    expect(() => parse(withFloor({ encounters: { Fight: [] } }))).toThrow(/encounters\.Fight/);
    expect(() => parse(withFloor({ encounters: {} }))).toThrow(/encounters\.Fight/);
    expect(() => parse(withFloor({ encounters: { Fight: [{ enemies: [easy()] }], Elite: [] } }))).toThrow(/encounters\.Elite/);
    expect(() => parse(withFloor({ weights: { Fight: 1, Elite: 1 }, encounters: { Fight: [{ enemies: [easy()] }] } }))).toThrow(/Elite/);
  });

  it('refuses rows other than three widths of 2 to 3, and bad weights', () => {
    for (const rows of [[2, 3], [2, 3, 2, 2], [1, 2, 3], [2, 4, 2], [2, 2.5, 2], 'wide']) expect(() => parse(withFloor({ rows }))).toThrow(/rows/);
    expect(() => parse(withFloor({ weights: { Fight: 0, Treasure: 1 } }))).toThrow(/weights\.Fight/);
    expect(() => parse(withFloor({ weights: { Fight: 1, Treasure: -1 } }))).toThrow(/weights\.Treasure/);
  });

  it('refuses no Floors, a missing Boss, and bad Run numbers', () => {
    expect(() => parse({ ...raw(), floors: [] })).toThrow(/at least one Floor/);
    expect(() => parse(withFloor({ boss: undefined }))).toThrow(/boss/);
    expect(() => parse({ ...raw(), doorSeconds: 0 })).toThrow(/doorSeconds/);
    expect(() => parse({ ...raw(), hallFadeSeconds: -1 })).toThrow(/hallFadeSeconds/);
    expect(() => parse({ ...raw(), revive: 0 })).toThrow(/revive/);
    expect(() => parse({ ...raw(), revive: 1.5 })).toThrow(/revive/);
    expect(() => parse({ ...raw(), restHeal: 1.5 })).toThrow(/restHeal/);
    expect(() => parse({ ...raw(), perPlayerHp: -0.1 })).toThrow(/perPlayerHp/);
    expect(() => parse({ ...raw(), depthHp: -0.1 })).toThrow(/depthHp/);
    expect(() => parse({ ...raw(), inventory: { weapons: 0, relics: 6, equippedRelics: 3 } })).toThrow(/inventory\.weapons/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 2, equippedRelics: 3 } })).toThrow(/equippedRelics/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 6.5, equippedRelics: 3 } })).toThrow(/inventory\.relics/);
  });

  it('refuses a missing or bad loot: weights, drops per kind and pedestals', () => {
    const loot = (patch: object) => ({ ...raw(), loot: { weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 0, Boss: 2 }, pedestals: 3, ...patch } });
    expect(() => parse({ ...raw(), loot: undefined })).toThrow(/dungeon\.loot/);
    expect(() => parse(loot({ weights: { Relic: 0, Weapon: 0 } }))).toThrow(/weights/);
    expect(() => parse(loot({ weights: { Relic: -1, Weapon: 1 } }))).toThrow(/weights\.Relic/);
    expect(() => parse(loot({ weights: { Relic: 1 } }))).toThrow(/weights\.Weapon/);
    expect(parse(loot({ weights: { Relic: 0, Weapon: 2 } })).loot.weights).toEqual({ Relic: 0, Weapon: 2 });
    expect(() => parse(loot({ drops: { Fight: 5, Elite: 0, Boss: 2 } }))).toThrow(/drops\.Fight/);
    expect(() => parse(loot({ drops: { Fight: 1, Elite: 0.5, Boss: 2 } }))).toThrow(/drops\.Elite/);
    expect(() => parse(loot({ drops: { Fight: 1, Elite: 0 } }))).toThrow(/drops\.Boss/);
    expect(() => parse(loot({ pedestals: 0 }))).toThrow(/pedestals/);
    expect(() => parse(loot({ pedestals: 5 }))).toThrow(/pedestals/);
  });

  it('is in the Tuning Data hash: any change to it changes the hash', () => {
    const base = tuningDataHash(tuning);
    const d = tuning.dungeon;
    const changed = (dungeon: TuningData['dungeon']) => tuningDataHash({ ...tuning, dungeon });
    expect(changed({ ...d, doorSeconds: d.doorSeconds + 0.5 })).not.toBe(base);
    expect(changed({ ...d, floors: d.floors.slice(1) })).not.toBe(base);
    const [first, ...rest] = d.floors;
    expect(changed({ ...d, floors: [{ ...first!, rows: [3, 3, 3] }, ...rest] })).not.toBe(base);
    expect(changed({ ...d, floors: [{ ...first!, boss: { enemies: [{ ...first!.boss.enemies[0]!, difficulty: 'Hard' }] } }, ...rest] })).not.toBe(base);
  });
});

describe('Run knobs on a Dungeon (applyDungeonKnobs)', () => {
  const d = tuning.dungeon;
  const everyEnemy = (g: TuningData['dungeon']) => g.floors.flatMap((f) => [...f.encounters.Fight, ...f.encounters.Elite, f.boss].flatMap((e) => e.enemies));

  it('gives the Dungeon itself back when no knob changes anything', () => {
    expect(applyDungeonKnobs(d, undefined)).toBe(d);
    expect(applyDungeonKnobs(d, {})).toBe(d);
    expect(applyDungeonKnobs(d, { difficulty: 0, enemyHp: 1, maxEnemies: 4 })).toBe(d);
  });

  it('steps every enemy of every Encounter along the ladder, held at either end', () => {
    const ladder = dungeonDifficultyLadder(d);
    expect(ladder).toEqual(['Beginner', 'Skilled', 'Expert']);
    const up = everyEnemy(applyDungeonKnobs(d, { difficulty: 1 }));
    expect(up.map((e) => e.difficulty)).toEqual(everyEnemy(d).map((e) => ladder[Math.min(ladder.indexOf(e.difficulty) + 1, 2)]));
    expect(everyEnemy(applyDungeonKnobs(d, { difficulty: -5 })).every((e) => e.difficulty === 'Beginner')).toBe(true);
  });

  it('scales every enemy HP, keeps the first maxEnemies of each Encounter, and replaces restHeal and perPlayerHp', () => {
    const g = applyDungeonKnobs(d, { enemyHp: 2, maxEnemies: 1, rest: 0.2, perPlayerHp: 0.25 });
    expect(everyEnemy(g).map((e) => e.hpScale)).toEqual(applyDungeonKnobs(d, { maxEnemies: 1 }).floors.flatMap((f) => [...f.encounters.Fight, ...f.encounters.Elite, f.boss].map((e) => e.enemies[0]!.hpScale * 2)));
    for (const f of g.floors) for (const e of [...f.encounters.Fight, ...f.encounters.Elite, f.boss]) expect(e.enemies.length).toBe(1);
    expect(g.floors[2]!.boss.enemies[0]!.body).toBe('wraith');
    expect([g.restHeal, g.perPlayerHp]).toEqual([0.2, 0.25]);
    expect(applyDungeonKnobs(d, { maxEnemies: 9, rest: 3 }).restHeal).toBe(1);
  });

  it('reads stored knobs keeping only today\'s keys: v1\'s `heal` (a heal between Floors) never sets the Rest Hall heal', () => {
    expect(parseRunKnobs({ heal: 0, rest: 0.3, difficulty: -1, junk: 2, enemyHp: 'x', maxEnemies: Infinity })).toEqual({ rest: 0.3, difficulty: -1 });
    expect(parseRunKnobs({ heal: 0 })).toBeNull();
    for (const raw of [null, 3, 'rest', [0.5]]) expect(parseRunKnobs(raw)).toBeNull();
    expect(applyDungeonKnobs(d, parseRunKnobs({ heal: 0 }) ?? undefined).restHeal).toBe(d.restHeal);
  });
});
