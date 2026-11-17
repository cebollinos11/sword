/**
 * A Gauntlet's Lobby (docs/plans/delver.md): a Run on generated Floors, with its traitors on Team 1 (Stage 8a). Since Stage 9 there is no other Gauntlet.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { join, lobbyLineup, moveMember, newLobby, runTuning, seatOf, setFormat, setSeat, startProblem, type LobbySettings, type LobbyState } from './lobby';
import { playerVsAi } from '../play/driver';
import { checkLineup, lineupMatch } from '../controllers';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;
const lobby = (settings: LobbySettings): LobbyState => newLobby({ host: { name: 'Host', weapon, body: 'monk' }, settings, online: true, ai: { difficulty: 'Normal', weapon } });
const message = (state: LobbyState) => ({ type: 'lobby', state: JSON.parse(JSON.stringify(state)) as LobbyState, you: 1, ack: 0 });

describe('a Gauntlet Lobby (a Run on generated Floors)', () => {
  const gauntlet = lobby({ arena: 'gen:greybox:5', bestOf: 3, format: 'Gauntlet' });

  it('has no Dungeon choice and no Run knobs left in its settings, and plays Tuning Data as it is', () => {
    expect(gauntlet.settings).toEqual({ arena: 'gen:greybox:5', bestOf: 3, format: 'Gauntlet' });
    expect(runTuning(tuning, gauntlet.settings)).toBe(tuning);
    expect(parseLobbyMessage(message(gauntlet))).toEqual(message(gauntlet));
  });

  describe("a Delver Run's traitors (Stage 8a)", () => {
    const guest = (id: number) => ({ id, name: `G${id}`, weapon, body: 'monk', size: { height: 1.2, thick: 1 }, ready: true });
    const room = join(join(gauntlet, guest(1))!, guest(2))!;

    it('sit on Team 1 in a Gauntlet Lobby, stay there in Duels, and go back to Team 0 when the Gauntlet is picked again', () => {
      expect(seatOf(room, 1)!.team).toBe(0);
      const traitor = moveMember(room, 2, { team: 1, index: 0 });
      expect(seatOf(traitor, 2)).toEqual({ team: 1, index: 0 });
      const duels = setFormat(traitor, 'Duels', 'gen:greybox:6');
      expect(seatOf(duels, 2)!.team).toBe(1);
      expect(seatOf(setFormat(duels, 'Gauntlet', 'gen:greybox:6'), 2)!.team).toBe(0);
    });

    it("put the traitors first among the Lineup's Team 1 slots, then the Floors; the Match options name them as traitors", () => {
      const traitor = moveMember(room, 2, { team: 1, index: 2 });
      const { lineup, weapons } = lobbyLineup(traitor);
      expect(lineup.map((s) => [s.team, s.pilot.kind])).toEqual([[0, 'Player'], [0, 'Player'], [1, 'Player'], [1, 'AI'], [1, 'AI'], [1, 'AI']]);
      expect(() => checkLineup(tuning, lineup, 3, 'Gauntlet')).not.toThrow();
      expect(() => checkLineup(tuning, lineup, 3)).toThrow();
      const options = lineupMatch(tuning, lineup, weapons, { bestOf: 1, format: 'Gauntlet' });
      expect(options).toMatchObject({ humans: 2, players: [0, 1], traitors: [{ size: { height: 1.2, thick: 1 } }] });
      // A traitor after a Floor slot is refused.
      expect(() => checkLineup(tuning, [lineup[0]!, lineup[1]!, lineup[3]!, lineup[2]!, lineup[4]!, lineup[5]!], 3, 'Gauntlet')).toThrow();
      // Without traitors the options are as they were.
      expect('traitors' in lineupMatch(tuning, lobbyLineup(room).lineup, weapons, { bestOf: 1, format: 'Gauntlet' })).toBe(false);
    });

    it('cannot be played alone: the host as the only seated traitor may not start, and a Run against the AIs refuses it', () => {
      // (An AI ally keeps the party: the host alone in the Room, Team 0 not empty.)
      const alone = moveMember(setSeat(gauntlet, { team: 0, index: 1 }, { kind: 'AI', difficulty: 'Normal', weapon }), 0, { team: 1, index: 0 });
      expect(seatOf(alone, 0)).toEqual({ team: 1, index: 0 });
      expect(startProblem(alone, false)).toMatch(/traitor/);
      const { lineup } = lobbyLineup(alone);
      expect(() => playerVsAi(tuning, { lineup, weapon, format: 'Gauntlet', bestOf: 1, arena: 'gen:greybox:5' })).toThrow(/traitors/);
      // With a party to betray, the Lobby lets it start.
      expect(startProblem(moveMember(room, 2, { team: 1, index: 0 }), false)).toBeNull();
    });
  });
});
