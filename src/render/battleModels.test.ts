import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_BATTLE_MAPS, GENERATED_BATTLE_MAPS, hasBattleModel, MODELLED_BATTLE_MAPS } from './battleModels';

describe('the Battle maps that ship a model', () => {
  it('are exactly the battle_<map>.glb files in public/models/arenas, so a map with none is drawn from its Walk Surfaces and Walls (and none asks for a missing file)', () => {
    const dir = fileURLToPath(new URL('../../public/models/arenas/', import.meta.url));
    const shipped = readdirSync(dir)
      .map((f) => /^battle_([a-z][a-z0-9]*)\.glb$/.exec(f)?.[1])
      .filter((m): m is string => m !== undefined)
      .sort();
    expect([...MODELLED_BATTLE_MAPS].sort()).toEqual(shipped);
    expect(hasBattleModel('fort')).toBe(true);
    expect(hasBattleModel('sample')).toBe(false);
  });

  it('are the maps a generator in art/ builds and the maps the Map Editor saved into data/battlemaps/ (Stage 5: Save writes the model with them)', () => {
    const names = (url: string, re: RegExp) =>
      readdirSync(fileURLToPath(new URL(url, import.meta.url)))
        .map((f) => re.exec(f)?.[1])
        .filter((m): m is string => m !== undefined)
        .sort();
    expect([...GENERATED_BATTLE_MAPS].sort()).toEqual(names('../../art/', /^build_battle_([a-z][a-z0-9]*)\.py$/));
    expect(EDITOR_BATTLE_MAPS).toEqual(names('../../data/battlemaps/', /^([a-z][a-z0-9]*)\.source\.json$/));
    expect([...MODELLED_BATTLE_MAPS].sort()).toEqual([...new Set([...GENERATED_BATTLE_MAPS, ...EDITOR_BATTLE_MAPS])].sort());
  });
});
