/**
 * docs/plans/map-editor.md, Stage 3: the Lobby reads a Battle map's card from its file. A map saved from the Map Editor, read back as the
 * game reads `data/battlemaps/` (`loadTuningData`), appears in the Lobby's map picker with its card, and a Battle starts on it through the
 * Lobby's own path (its settings, `runTuning`, `battleNameFor`), with no code change. The four shipped maps keep their files and cards.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseBattleMap } from '../tuning';
import { battleNameFor, createMatch, stepMatch } from '../sim';
import { newLobby, runTuning, setFormat, updateSettings, type NewLobbyOptions } from '../lobby/lobby';
import { battleCard, battleMapCard, battleMapChoice, battleMaps, BATTLE_MAPS, withBattleMap } from '../play/lobbyView';
import { EDITED, EDITED_CARD, editedFiles, withEditedMap } from './lobby.testdata';

const base = loadTuningData();
const options: NewLobbyOptions = { host: { name: 'Host', weapon: 'Arming Sword', body: 'male' }, settings: { arena: 'circle', bestOf: 1 }, online: false, ai: { difficulty: 'Normal', weapon: 'Arming Sword' } };

describe('a Battle map saved from the Map Editor', () => {
  const tuning = withEditedMap(base);

  it('is read by the same rules as the bundled maps, its card with it', () => {
    const map = tuning.battle.maps[EDITED]!;
    expect(map.lobby).toEqual(EDITED_CARD);
    expect(map.objectives.find((o) => o.id === 'C')).toEqual({ id: 'C', x: 28, z: 0, weight: 1, owner: -1, spawn: false, y: 4 });
    // The bundled maps are all still there, unchanged.
    for (const [name, m] of Object.entries(base.battle.maps)) expect(tuning.battle.maps[name]).toEqual(m);
    // A file must live in <its name>.json, as a bundled one must.
    const { map: file } = editedFiles(base);
    expect(() => loadTuningData({ battleMapFiles: { '../../data/battlemaps/other.json': JSON.parse(file.text) } })).toThrow(/must live in <its name>\.json/);
  });

  it("appears in the Lobby's map picker with its card, after the shipped maps", () => {
    expect(battleMaps(tuning).map((m) => m.id)).toEqual(['open', 'fort', 'ziggurat', 'city', 'cavern', EDITED]);
    expect(battleMapChoice(tuning, { map: EDITED })).toEqual({ id: EDITED, ...EDITED_CARD });
    expect(battleCard(tuning, { map: EDITED }).note).toContain(`meet ${EDITED_CARD.where} and fight over five Objectives.`);
    // Its army size row offers its own standard, as a shipped map's does.
    expect(runTuning(tuning, updateSettings(setFormat(newLobby(options), 'Battle', 'gen:x:1'), { battle: withBattleMap(undefined, EDITED) }).settings).battle.armySize).toBe(144);
  });

  it('starts a Battle on it through the Lobby, with no code change', () => {
    const lobby = updateSettings(setFormat(newLobby(options), 'Battle', 'gen:x:1'), { battle: withBattleMap(undefined, EDITED) });
    const t = runTuning(tuning, lobby.settings);
    const arena = battleNameFor(lobby.settings.battle?.map, 7);
    expect(arena).toBe(`battle:${EDITED}`);
    let m = createMatch(t, { format: 'Battle', bestOf: 1, seed: 7, arena });
    expect(m.duel.crowd!.x.length).toBe(2 * 144);
    for (let i = 0; i < 600; i++) m = stepMatch(m, [], t);
    expect(m.status.status).toBe('InProgress');
    expect(m.tick).toBe(600);
  });

  it('falls back part by part: no card gives its name and a plain picture', () => {
    const s = editedFiles(base);
    const raw = JSON.parse(s.map.text) as Record<string, unknown>;
    const { lobby: _card, ...bare } = raw;
    const plain = loadTuningData({ battleMapFiles: { [`../../${s.map.path}`]: { ...bare, lobby: { blurb: 'Only a blurb' } } } });
    expect(battleMapChoice(plain, { map: EDITED })).toMatchObject({ label: 'Lavakeep', where: 'on Lavakeep,', blurb: 'Only a blurb' });
    expect(battleMapCard(EDITED, undefined)).toEqual({ id: EDITED, label: 'Lavakeep', where: 'on Lavakeep,', blurb: 'A hand-built Battle map', art: expect.stringMatching(/^linear-gradient/) });
    // The Battle card counts the map's own Objectives.
    const three = loadTuningData({ battleMapFiles: { [`../../${s.map.path}`]: { ...raw, objectives: (raw.objectives as unknown[]).slice(0, 3) } } });
    expect(battleCard(three, { map: EDITED }).note).toContain('fight over three Objectives.');
    expect(battleCard(base).note).toContain('fight over five Objectives.');
  });
});

describe('the shipped maps', () => {
  it('keep their cards: no file carries a lobby, so the Lobby shows its own entries', () => {
    for (const name of ['fort', 'ziggurat', 'city', 'cavern']) expect(base.battle.maps[name]).not.toHaveProperty('lobby');
    expect(battleMaps(base)).toEqual(BATTLE_MAPS);
  });

  it("let a file's card win over the Lobby's entry", () => {
    const fort = base.battle.maps.fort!;
    const carded = { ...base, battle: { ...base.battle, maps: { ...base.battle.maps, fort: parseBattleMap({ ...fort, lobby: { label: 'Old fort' } }, 'fort', base.battle) } } };
    expect(battleMapChoice(carded, { map: 'fort' })).toEqual({ ...BATTLE_MAPS[1]!, label: 'Old fort' });
  });
});
