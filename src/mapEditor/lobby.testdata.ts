/**
 * docs/plans/map-editor.md, Stage 3's Done, shared by its fast and slow tests: a map made in the Map Editor's session (Stage 0's sample,
 * renamed, C dragged onto the bridge, a Lobby card set), its saved file read back by the same rules as the `data/battlemaps/` glob
 * (`loadTuningData`), as the game will read it once it is in that folder. Not a shipped map.
 */
import { loadTuningData, type TuningData } from '../tuning';
import { sampleSource } from './sample.testdata';
import { MapEditorSession, type MapFiles } from './session';

export const EDITED = 'lavakeep';

export const EDITED_CARD = { label: 'Lava keep', where: 'round a keep over a pit of lava,', blurb: 'A keep and a bridge over lava', art: 'linear-gradient(180deg, #2a2224, #ff6a1a 46%, #6a1d08)' };

/** The edited map's two files, as Save writes them. */
export function editedFiles(base: TuningData): MapFiles {
  const s = new MapEditorSession(sampleSource());
  s.setSettings({ name: EDITED });
  s.level = 4;
  s.moveMarker({ kind: 'objective', id: 'C' }, -12, 0);
  s.setLobby(EDITED_CARD);
  return s.files(base.battle);
}

/** The Tuning Data with the edited map's file in `data/battlemaps/`, as the bundle reads it. */
export function withEditedMap(base: TuningData): TuningData {
  const { map } = editedFiles(base);
  return loadTuningData({ battleMapFiles: { [`../../${map.path}`]: JSON.parse(map.text) } });
}
