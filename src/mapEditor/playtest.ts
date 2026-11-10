/**
 * Play-testing a draft (docs/plans/map-editor.md, Stage 4), the pure part: the draft compiled and put in a copy of the Tuning Data, as
 * `withArena` (`src/editor/arenaLab.ts`) puts a Generated Arena in one, so the existing Battle routes run on it with no save and no reload.
 * No DOM, no three.js, no clock.
 *
 * The copy is what keeps the caches honest. The Battlefield is cached per Battle Tuning Data (and the map it was built from), the destination
 * fields per Battlefield and the Fighters' navmesh per Arena and Tuning Data, so a draft in a copy of its own (a new `battle`, a new compiled
 * map) is built from scratch, never answered with the last draft's field of the same name.
 */
import { applyBattleKnobs, type BattleKnobs, type BattleMapTuning, type TuningData } from '../tuning';
import { GENERATED_BATTLE_MAPS } from '../render/battleModels';
import { compileMap, type CompileWarning } from './compile';
import type { MapSource } from './source';

/** A draft ready to play: the Tuning Data holding its compiled map under `map`, with the Lobby's armies folded in for it. */
export interface Draft {
  readonly tuning: TuningData;
  /** The map's name in `tuning.battle.maps` (the source's). */
  readonly map: string;
  readonly compiled: BattleMapTuning;
  readonly warnings: readonly CompileWarning[];
}

/**
 * The draft `source` compiled and placed in a copy of `base` (a new `battle`, so nothing built for another draft is reused), its armies as the
 * Lobby would size them for the map (`applyBattleKnobs`: the map's standard unless `knobs` name another size). Throws the compiler's
 * `MapCompileError`, or the game's own refusal of the armies, as Save and the Lobby do. The name of a map a generator builds (the Fort, the
 * Ziggurat, the City, the Cavern) is refused: Save would write over it. (A map made in the editor may be play-tested under its own name: the
 * play-test draws the draft's model, `setDraftBattleModel`, over the one saved.)
 */
export function draftTuning(source: MapSource, base: TuningData, knobs: Omit<BattleKnobs, 'map'> = {}): Draft {
  if (GENERATED_BATTLE_MAPS.includes(source.name)) throw new Error(`"${source.name}" is a shipped map (it has a model of its own): rename the draft to play-test it`);
  const { map, warnings } = compileMap(source, base.battle);
  const maps = { ...base.battle.maps, [source.name]: map };
  const battle = applyBattleKnobs({ ...base.battle, maps }, { ...knobs, map: source.name });
  return { tuning: { ...base, battle }, map: source.name, compiled: map, warnings };
}
