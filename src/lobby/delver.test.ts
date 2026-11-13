/**
 * The Delver setting (docs/plans/delver.md, Stage 2 follow-up): a Gauntlet on generated Floors, chosen by the host in the Lobby and synced to guests.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { isDelver, newLobby, runTuning, setDelver, setFormat, updateSettings, type LobbySettings, type LobbyState } from './lobby';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;
const lobby = (settings: LobbySettings): LobbyState => newLobby({ host: { name: 'Host', weapon, body: 'monk' }, settings, online: true, ai: { difficulty: 'Normal', weapon } });
const message = (state: LobbyState) => ({ type: 'lobby', state: JSON.parse(JSON.stringify(state)) as LobbyState, you: 1, ack: 0 });

describe('the Delver setting', () => {
  const gauntlet = lobby({ arena: 'gen:greybox:5', bestOf: 3, format: 'Gauntlet' });

  it('is absent by default, and set or cleared by the host (the key goes away rather than reading false)', () => {
    expect(isDelver(gauntlet)).toBe(false);
    expect('delver' in gauntlet.settings).toBe(false);
    const on = setDelver(gauntlet, true);
    expect(on.settings.delver).toBe(true);
    expect(isDelver(on)).toBe(true);
    expect(setDelver(on, true)).toBe(on);
    const off = setDelver(on, false);
    expect('delver' in off.settings).toBe(false);
    expect(setDelver(gauntlet, false)).toBe(gauntlet);
    expect(off.settings).toEqual(gauntlet.settings);
  });

  it('means something in a Gauntlet only: any other Format ignores it, and it comes back with the Gauntlet', () => {
    const duels = lobby({ arena: 'library', bestOf: 3, delver: true });
    expect(isDelver(duels)).toBe(false);
    expect(runTuning(tuning, duels.settings)).toBe(tuning);
    const back = setFormat(setDelver(gauntlet, true), 'Duels', 'gen:greybox:6');
    expect(isDelver(back)).toBe(false);
    expect(isDelver(setFormat(back, 'Gauntlet', 'gen:greybox:6'))).toBe(true);
  });

  it("is kept when the Map or the Run's knobs change", () => {
    const on = setDelver(gauntlet, true);
    expect(updateSettings(on, { arena: 'gen:greybox:9' }).settings.delver).toBe(true);
    expect(updateSettings(on, { run: { difficulty: 1 } }).settings.delver).toBe(true);
  });

  it('crosses the Room channel: true or absent passes, anything else is ignored as a broken peer', () => {
    for (const state of [gauntlet, setDelver(gauntlet, true), lobby({ arena: 'library', bestOf: 3, delver: true })]) {
      expect(parseLobbyMessage(message(state)), JSON.stringify(state.settings)).toEqual(message(state));
    }
    for (const delver of [false, 1, 'yes', null, {}, []]) {
      const bad = message(gauntlet);
      (bad.state.settings as { delver?: unknown }).delver = delver;
      expect(parseLobbyMessage(bad), JSON.stringify(delver)).toBeNull();
    }
  });
});
