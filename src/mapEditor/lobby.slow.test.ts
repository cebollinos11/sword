/**
 * docs/plans/map-editor.md, Stage 3's Done (the slow tier, `npm run test:slow`): a map saved from the Map Editor, read back as the game reads
 * `data/battlemaps/` and picked in the Lobby, holds a whole AI-v-AI Battle to its end.
 */
import { expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { battleNameFor, createMatch, stepMatch } from '../sim';
import { newLobby, runTuning, setFormat, updateSettings } from '../lobby/lobby';
import { battleMaps, withBattleMap } from '../play/lobbyView';
import { EDITED, withEditedMap } from './lobby.testdata';

it('plays a whole AI Battle on a map saved from the Map Editor, picked in the Lobby', () => {
  const tuning = withEditedMap(loadTuningData());
  expect(battleMaps(tuning).map((m) => m.id)).toContain(EDITED);
  const lobby = newLobby({ host: { name: 'Host', weapon: 'Arming Sword', body: 'male' }, settings: { arena: 'circle', bestOf: 1 }, online: false, ai: { difficulty: 'Normal', weapon: 'Arming Sword' } });
  const settings = updateSettings(setFormat(lobby, 'Battle', 'gen:x:1'), { battle: withBattleMap(undefined, EDITED) }).settings;
  const t = runTuning(tuning, settings);
  const t0 = performance.now();
  let m = createMatch(t, { format: 'Battle', bestOf: 1, seed: 3, arena: battleNameFor(settings.battle?.map, 3) });
  while (m.status.status === 'InProgress' && m.tick < 90_000) m = stepMatch(m, [], t);
  const c = m.duel.crowd!;
  process.stderr.write(`${EDITED}: ${m.status.status} after ${(m.tick / 60).toFixed(0)} s of Battle (${((performance.now() - t0) / 1000).toFixed(1)} s to run), Tickets ${c.tickets.map((x) => x.toFixed(0)).join(' / ')}\n`);
  expect(m.status.status).toBe('Over');
}, 900_000);
