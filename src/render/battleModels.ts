/**
 * Which hand-built Battle maps ship a model (`public/models/arenas/battle_<map>.glb`). Any other map (a draft in the Map Editor,
 * docs/plans/map-editor.md) has none: the renderer draws it from its Walk Surfaces and Walls rather than ask for a file that is not there.
 * Render-only.
 *
 * Two kinds ship one: the maps a Python generator builds (`art/build_battle_<map>.py` exports the model beside the map file), and the maps
 * made in the Map Editor (Stage 5): its Save writes the Map Source, the compiled map and the model together, so a map whose
 * `data/battlemaps/<map>.source.json` ships has its model too (a test holds both lists to the files).
 */

/** The maps built by a generator in `art/`. */
export const GENERATED_BATTLE_MAPS: readonly string[] = ['fort', 'ziggurat', 'city', 'cavern'];

/** The Map Sources that ship, by path (only their names are read here: nothing is loaded). */
const sources = import.meta.glob('../../data/battlemaps/*.source.json');

/** The maps made in the Map Editor that ship: one per `data/battlemaps/<map>.source.json`. */
export const EDITOR_BATTLE_MAPS: readonly string[] = Object.keys(sources)
  .map((path) => /([a-z][a-z0-9]*)\.source\.json$/.exec(path)?.[1])
  .filter((m): m is string => m !== undefined)
  .sort();

export const MODELLED_BATTLE_MAPS: readonly string[] = [...GENERATED_BATTLE_MAPS, ...EDITOR_BATTLE_MAPS.filter((m) => !GENERATED_BATTLE_MAPS.includes(m))];

export const hasBattleModel = (map: string): boolean => MODELLED_BATTLE_MAPS.includes(map);
