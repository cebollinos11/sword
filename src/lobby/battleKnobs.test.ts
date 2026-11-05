import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, stepMatch } from '../sim';
import { newLobby, runTuning, setFormat, updateSettings, type NewLobbyOptions } from './lobby';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const options: NewLobbyOptions = { host: { name: 'Host', weapon: 'Arming Sword', body: 'male' }, settings: { arena: 'circle', bestOf: 1 }, online: true, ai: { difficulty: 'Normal', weapon: 'Arming Sword' } };
const battle = () => setFormat(newLobby(options), 'Battle', 'gen:x:1');

describe('Battle options in the Lobby', () => {
  it('fold into the Battle only, and only when they change something', () => {
    const s = battle();
    expect(runTuning(tuning, s.settings)).toBe(tuning);
    const picked = updateSettings(s, { battle: { armySize: 50, hitRate: 0.5 } }).settings;
    const t = runTuning(tuning, picked);
    expect(t.battle.armySize).toBe(50);
    expect(t.battle.crowd.hitChance).toBeCloseTo(tuning.battle.crowd.hitChance / 2);
    expect(runTuning(tuning, { ...picked, format: undefined })).toBe(tuning);
  });

  it('survive the wire, and a bad knob is refused', () => {
    const state = updateSettings(battle(), { battle: { armySize: 100, hitRate: 0.75 } });
    const m = { type: 'lobby', state, you: 0, ack: 0 };
    expect(parseLobbyMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(parseLobbyMessage({ ...m, state: { ...state, settings: { ...state.settings, battle: { armySize: 'lots' } } } })).toBeNull();
    expect(parseLobbyMessage({ ...m, state: { ...state, settings: { ...state.settings, battle: { bogus: 1 } } } })).toBeNull();
  });

  it('give a Battle that plays, at the largest size too', () => {
    const t = runTuning(tuning, updateSettings(battle(), { battle: { armySize: 300, hitRate: 0.25 } }).settings);
    let m = createMatch(t, { format: 'Battle', bestOf: 1, seed: 1 });
    expect(m.duel.crowd!.x.length).toBe(600);
    for (let i = 0; i < 120; i++) m = stepMatch(m, [], t);
    expect(m.tick).toBeGreaterThan(100);
  });
});
