/**
 * Which hand-built Battle maps ship a model (`public/models/arenas/battle_<map>.glb`, exported by `art/build_battle_<map>.py`). Any other
 * map (one made in the Map Editor, docs/plans/map-editor.md) has none: the renderer draws it from its Walk Surfaces and Walls rather than
 * ask for a file that is not there. Stage 5 exports a model for such maps; a map that has one is added here then. Render-only.
 */
export const MODELLED_BATTLE_MAPS: readonly string[] = ['fort', 'ziggurat', 'city', 'cavern'];

export const hasBattleModel = (map: string): boolean => MODELLED_BATTLE_MAPS.includes(map);
