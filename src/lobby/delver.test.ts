/**
 * The Delver setting (docs/plans/delver.md, Stage 2 follow-up): a Gauntlet on generated Floors, chosen by the host in the Lobby and synced to guests.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { isDelver, join, lobbyLineup, moveMember, newLobby, runTuning, seatOf, setDelver, setFormat, updateSettings, type LobbySettings, type LobbyState } from './lobby';
import { checkLineup, lineupMatch } from '../controllers';
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

  describe("a Delver Run's traitors (Stage 8a)", () => {
    const guest = (id: number) => ({ id, name: `G${id}`, weapon, body: 'monk', size: { height: 1.2, thick: 1 }, ready: true });
    const room = join(join(setDelver(gauntlet, true), guest(1))!, guest(2))!;

    it('sit on Team 1 in a Delver Lobby only, and go back to Team 0 when the Halls are picked', () => {
      expect(seatOf(room, 1)!.team).toBe(0);
      const traitor = moveMember(room, 2, { team: 1, index: 0 });
      expect(seatOf(traitor, 2)).toEqual({ team: 1, index: 0 });
      expect(moveMember(setDelver(room, false), 2, { team: 1, index: 0 })).toEqual(setDelver(room, false));
      expect(seatOf(setDelver(traitor, false), 2)!.team).toBe(0);
      expect(seatOf(setFormat(traitor, 'Duels', 'gen:greybox:6'), 2)!.team).toBe(1);
    });

    it("put the traitors first among the Lineup's Team 1 slots, then the Floors; the Match options name them as traitors", () => {
      const traitor = moveMember(room, 2, { team: 1, index: 2 });
      const { lineup, weapons } = lobbyLineup(traitor);
      expect(lineup.map((s) => [s.team, s.pilot.kind])).toEqual([[0, 'Player'], [0, 'Player'], [1, 'Player'], [1, 'AI'], [1, 'AI'], [1, 'AI']]);
      expect(() => checkLineup(tuning, lineup, 3, 'Gauntlet', true)).not.toThrow();
      expect(() => checkLineup(tuning, lineup, 3, 'Gauntlet')).toThrow();
      const options = lineupMatch(tuning, lineup, weapons, { bestOf: 1, format: 'Gauntlet', delver: true });
      expect(options).toMatchObject({ humans: 2, players: [0, 1], traitors: [{ size: { height: 1.2, thick: 1 } }] });
      // A traitor after a Floor slot is refused.
      expect(() => checkLineup(tuning, [lineup[0]!, lineup[1]!, lineup[3]!, lineup[2]!, lineup[4]!, lineup[5]!], 3, 'Gauntlet', true)).toThrow();
      // Without traitors the options are as they were.
      expect('traitors' in lineupMatch(tuning, lobbyLineup(room).lineup, weapons, { bestOf: 1, format: 'Gauntlet', delver: true })).toBe(false);
    });
  });
});
