import { describe, expect, it } from 'vitest';
import { lineupMatch } from '../controllers';
import { createMatch } from '../sim';
import { loadTuningData } from '../tuning';
import { join, lobbyLineup, newLobby, setSeat, updateMember } from './lobby';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;

describe('Size in the Lobby', () => {
  const lobby = (online = false) => newLobby({ host: { name: 'Host', weapon, body: 'monk', size: { height: 0.6, thick: 1.2 } }, settings: { arena: 'circle', bestOf: 3 }, online, ai: { difficulty: 'Normal', weapon } });

  it('carries a Member and an AI Seat Size into the Lineup and the Match', () => {
    const withAi = setSeat(lobby(), { team: 1, index: 0 }, { kind: 'AI', difficulty: 'Normal', weapon, size: { height: 1.4, thick: 0.9 } });
    const { lineup, weapons } = lobbyLineup(withAi);
    expect(lineup.map((s) => s.size)).toEqual([{ height: 0.6, thick: 1.2 }, { height: 1.4, thick: 0.9 }]);
    const match = createMatch(tuning, lineupMatch(tuning, lineup, weapons, { bestOf: 1 }));
    expect(match.duel.fighters.map((f) => f.size)).toEqual([{ height: 0.6, thick: 1.2 }, { height: 1.4, thick: 0.9 }]);
  });

  it('drops a standard Size and keeps the Lineup free of it', () => {
    const reset = updateMember(lobby(), 0, { size: { height: 1, thick: 1 } });
    expect(reset.members[0]!.size).toBeUndefined();
    expect(lobbyLineup(reset).lineup[0]!.size).toBeUndefined();
  });

  it('is checked on the wire', () => {
    const ok = { type: 'join', protocol: 1, tuningHash: 'x', name: 'a', weapon, body: 'monk', size: { height: 1.4, thick: 0.6 } };
    expect(parseLobbyMessage(ok)).not.toBeNull();
    expect(parseLobbyMessage({ ...ok, size: { height: 9, thick: 1 } })).toBeNull();
    expect(parseLobbyMessage({ ...ok, size: { height: 1.03, thick: 1 } })).toBeNull();
    expect(join(lobby(true), { id: 1, name: 'g', weapon, body: 'monk', size: { height: 1.4, thick: 1.4 }, ready: false })!.members[1]!.size).toEqual({ height: 1.4, thick: 1.4 });
  });
});
