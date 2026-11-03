import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { checkLineup } from '../controllers';
import {
  canSetSeat,
  endMatch,
  formatProblem,
  isBattle,
  join,
  lobbyFormats,
  leave,
  lobbyLineup,
  moveMember,
  newLobby,
  nextMatchArena,
  seatOf,
  setFormat,
  setSeat,
  startMatch,
  startProblem,
  teamSize,
  MAX_PLAYERS,
  updateMember,
  updateSettings,
  type NewLobbyOptions,
} from './lobby';
import { MATCH_FORMATS } from '../sim';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;
const other = Object.keys(tuning.weapons)[1] ?? weapon;
const options = (online: boolean): NewLobbyOptions => ({
  host: { name: 'Host', weapon, body: 'monk' },
  settings: { arena: 'circle', bestOf: 3 },
  online,
  ai: { difficulty: 'Normal', weapon: other },
});
const guest = { id: 1, name: 'Guest', weapon: other, body: 'snake', ready: false };

describe('Lobby', () => {
  it('a Skirmish starts as you against one AI', () => {
    const s = newLobby(options(false));
    const { lineup, weapons } = lobbyLineup(s);
    expect(lineup).toEqual([
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' }, weapon: other },
    ]);
    expect(weapons).toEqual([weapon]);
    expect(() => checkLineup(tuning, lineup, 1)).not.toThrow();
  });

  it("an AI Seat's Style goes into the Lineup (none: the default), and a lobby message carries it", () => {
    const at = { team: 1, index: 0 };
    for (const style of ['Counter', 'random']) {
      const s = setSeat(newLobby(options(false)), at, { kind: 'AI', difficulty: 'Skilled', weapon: other, style });
      expect(lobbyLineup(s).lineup[1]).toEqual({ team: 1, pilot: { kind: 'AI', difficulty: 'Skilled', style }, weapon: other });
      expect(() => checkLineup(tuning, lobbyLineup(s).lineup, 1)).not.toThrow();
      const m = { type: 'lobby', you: 0, ack: 0, state: s };
      expect(parseLobbyMessage(m)).toEqual(m);
      const bad = setSeat(s, at, { kind: 'AI', difficulty: 'Skilled', weapon: other, style: 7 as unknown as string });
      expect(parseLobbyMessage({ ...m, state: bad })).toBeNull();
    }
    expect(lobbyLineup(newLobby(options(false))).lineup[1]!.pilot).not.toHaveProperty('style');
  });

  it('a guest joins the Open Seat opposite the host, and the Lineup fields both Players', () => {
    const s = join(newLobby(options(true)), guest)!;
    expect(seatOf(s, 1)).toEqual({ team: 1, index: 0 });
    const { lineup, weapons, names } = lobbyLineup(s);
    expect(() => checkLineup(tuning, lineup, 2)).not.toThrow();
    expect(weapons).toEqual([weapon, other]);
    expect(names).toEqual(['Host', 'Guest']);
  });

  it('turns a guest away when no Seat is Open', () => {
    expect(join(newLobby(options(false)), guest)).toBeNull();
  });

  it('opens no more human Seats than a Room holds', () => {
    let s = newLobby(options(true));
    expect(MAX_PLAYERS).toBe(4);
    // The host and three Open Seats: room for four.
    expect(s.teams.flat().filter((x) => x.kind === 'Open')).toHaveLength(3);
    expect(canSetSeat(s, { team: 0, index: 2 }, 'Open')).toBe(false);
    s = setSeat(s, { team: 1, index: 0 }, { kind: 'Closed' });
    expect(canSetSeat(s, { team: 0, index: 2 }, 'Open')).toBe(true);
    expect(canSetSeat(s, { team: 0, index: 0 }, 'Closed')).toBe(false);
  });

  it('guests join the team fielding fewer Fighters: four make 2 v 2, and a fifth is turned away', () => {
    let s = newLobby(options(true));
    for (let id = 1; id <= 3; id++) s = join(s, { ...guest, id, name: `Guest ${id}` })!;
    expect([1, 2, 3].map((id) => seatOf(s, id)?.team)).toEqual([1, 1, 0]); // ties go opposite the host
    expect(join(s, { ...guest, id: 4 })).toBeNull();
    const { lineup, names } = lobbyLineup(s);
    expect(() => checkLineup(tuning, lineup, 4)).not.toThrow();
    expect(lineup.map((x) => x.team)).toEqual([0, 0, 1, 1]);
    expect(names).toEqual(['Host', 'Guest 1', 'Guest 2', 'Guest 3']);
  });

  it('moving swaps Seats: the AI takes your old one', () => {
    const s = moveMember(newLobby(options(false)), 0, { team: 1, index: 0 });
    expect(seatOf(s, 0)).toEqual({ team: 1, index: 0 });
    expect(s.teams[0]![0]).toEqual({ kind: 'AI', difficulty: 'Normal', weapon: other });
  });

  it('cannot take another Player Seat', () => {
    const s = join(newLobby(options(true)), guest)!;
    expect(moveMember(s, 1, { team: 0, index: 0 })).toBe(s);
  });

  it('a guest leaving opens their Seat again', () => {
    const s = leave(join(newLobby(options(true)), guest)!, 1);
    expect(s.members).toHaveLength(1);
    expect(s.teams[1]![0]).toEqual({ kind: 'Open' });
  });

  it('needs a Fighter on each team, and ready guests for a start from the Lobby', () => {
    const s = join(newLobby(options(true)), guest)!;
    expect(startProblem(s, true)).toMatch(/Guest/);
    expect(startProblem(s, false)).toBeNull();
    expect(startProblem(updateMember(s, 1, { ready: true }), true)).toBeNull();
    expect(startProblem(newLobby(options(true)), false)).toMatch(/Team 2/);
  });

  it('a start bumps the generation, records who plays and resets ready', () => {
    const s = startMatch(updateMember(join(newLobby(options(true)), guest)!, 1, { ready: true }));
    expect(s.generation).toBe(1);
    expect(s.playing).toBe(true);
    expect(s.inMatch).toEqual([0, 1]);
    expect(s.members[1]!.ready).toBe(false);
    const again = startMatch(s);
    expect(again.generation).toBe(2);
    expect(endMatch(again).playing).toBe(false);
  });

  it('leaves the state untouched when a Member update changes nothing', () => {
    const s = newLobby(options(true));
    expect(updateMember(s, 0, { name: 'Host' })).toBe(s);
  });
});

describe('The Arena of each Match', () => {
  const random = (seed: number) => updateSettings(newLobby(options(false)), { arena: `gen:greybox:${seed}` });

  it('plays the first Match on the Map setting, and each Match after on the next seed', () => {
    let s = random(12);
    expect(nextMatchArena(s)).toBe('gen:greybox:12');
    s = startMatch(s);
    expect(s.matchArena).toBe('gen:greybox:12');
    s = startMatch(endMatch(s));
    expect(s.matchArena).toBe('gen:greybox:381979');
    expect(s.settings.arena).toBe('gen:greybox:12');
    // A restart from the in-game menu is a new Match too.
    expect(startMatch(s).matchArena).toBe('gen:greybox:763946');
  });

  it('follows on from the Arena last played (online, a Rematch may have moved on)', () => {
    const s = startMatch(random(12));
    expect(startMatch(s, 'gen:greybox:381979').matchArena).toBe('gen:greybox:763946');
  });

  it('starts over from the Map setting when it changes, so a seed typed in replays that map', () => {
    let s = startMatch(startMatch(random(12)));
    // Typing in the first seed again replays it.
    expect(nextMatchArena(updateSettings(s, { arena: 'gen:greybox:12' }))).toBe('gen:greybox:12');
    s = updateSettings(s, { arena: 'gen:greybox:5' });
    expect(s.matchArena).toBeNull();
    expect(nextMatchArena(s)).toBe('gen:greybox:5');
    expect(startMatch(s).matchArena).toBe('gen:greybox:5');
    // The Match length changing keeps the run going.
    expect(updateSettings(startMatch(s), { bestOf: 5 }).matchArena).toBe('gen:greybox:5');
  });

  it('plays a hand-made Map on itself every Match', () => {
    let s = startMatch(newLobby(options(false)));
    s = startMatch(endMatch(s));
    expect(s.matchArena).toBe('circle');
  });
});

describe('A Battle in the Lobby', () => {
  it("is offered offline and online, beside the wire's Duels and Gauntlet", () => {
    expect(lobbyFormats()).toEqual([...MATCH_FORMATS, 'Battle']);
    expect(MATCH_FORMATS).not.toContain('Battle');
  });

  it('starts with the host alone, whatever the Seats hold', () => {
    const s = setFormat(newLobby(options(false)), 'Battle', 'gen:greybox:1');
    expect(isBattle(s)).toBe(true);
    expect(startProblem(setSeat(s, { team: 1, index: 0 }, { kind: 'Closed' }), true)).toBeNull();
  });

  it("takes any Players, each on the Team they sit in, and fields no AI (the armies are the Battle's)", () => {
    let s = join(newLobby(options(true)), guest)!;
    expect(formatProblem(s, 'Battle')).toBeNull();
    s = setFormat(s, 'Battle', 'gen:greybox:1');
    expect(isBattle(s)).toBe(true);
    expect(lobbyLineup(s).lineup).toEqual([
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'Player', player: 1 } },
    ]);
    // An AI Seat (a Duel's) fields nobody, and does not count in the Team's size.
    const ai = setSeat(s, { team: 1, index: 1 }, { kind: 'AI', difficulty: 'Normal', weapon: other });
    expect(lobbyLineup(ai).lineup).toHaveLength(2);
    expect(teamSize(ai, 1)).toBe(1);
    expect(() => checkLineup(tuning, lobbyLineup(ai).lineup, 2, 'Battle')).not.toThrow();
    // Both Players on one Team is a Lineup too: the other army fights without a Player.
    const together = moveMember(s, 1, { team: 0, index: 1 });
    expect(lobbyLineup(together).lineup.map((l) => l.team)).toEqual([0, 0]);
    expect(() => checkLineup(tuning, lobbyLineup(together).lineup, 2, 'Battle')).not.toThrow();
    // A guest still has to be ready, as for any online Match, but no Team need field a Player.
    expect(startProblem(s, true)).toMatch(/Guest/);
    expect(startProblem(updateMember(s, 1, { ready: true }), true)).toBeNull();
    expect(startProblem(moveMember(together, 0, { team: 1, index: 0 }), false)).toBeNull();
  });

  it('is on the wire: a Lobby message carrying it, on whatever Map the Lobby holds, is accepted', () => {
    const s = setFormat(join(newLobby(options(true)), guest)!, 'Battle', 'gen:greybox:1');
    const m = { type: 'lobby', you: 0, ack: 0, state: s };
    expect(parseLobbyMessage(m)).toEqual(m);
    const hand = { ...m, state: { ...s, settings: { ...s.settings, arena: 'circle' } } };
    expect(parseLobbyMessage(hand)).toEqual(hand);
    const started = { ...m, state: startMatch(s) };
    expect(parseLobbyMessage(started)).toEqual(started);
    // A Format it does not know is still refused, and a Gauntlet is still on a Random Map only.
    expect(parseLobbyMessage({ ...m, state: { ...s, settings: { ...s.settings, format: 'Siege' } } })).toBeNull();
    expect(parseLobbyMessage({ ...m, state: { ...s, settings: { ...s.settings, arena: 'circle', format: 'Gauntlet' } } })).toBeNull();
  });
});
