/**
 * A Gauntlet Room (docs/plans/gauntlet.md, Stage 4): the online Lobby's Gauntlet rules, its message, and the view's
 * choices for it, synced over the memory transport with latency and jitter.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { TICK_RATE } from '../sim';
import { FLOOR_DIFFICULTY } from '../controllers';
import { createMemoryTransportPair } from '../net';
import { formatRefusal, offeredFormats, randomBlurb, shownTeams, waitingTag } from '../play/lobbyView';
import { formatProblem, join, lobbyLineup, newLobby, seatOf, setFormat, startMatch, type LobbySettings, type LobbyState, type NewLobbyOptions } from './lobby';
import { parseLobbyMessage } from './messages';
import { GuestLobby, HostLobby } from './sync';

const tuning = loadTuningData();
const [first, second] = Object.keys(tuning.weapons) as [string, string];
const STEP = 1000 / TICK_RATE;
const RUN = 'gen:greybox:640492';
const FRESH = 'gen:greybox:777';

const options = (settings: LobbySettings): NewLobbyOptions => ({
  host: { name: 'Ana', weapon: first, body: 'monk' },
  settings,
  online: true,
  ai: { difficulty: 'Normal', weapon: first },
});
const guest = (id: number) => ({ id, name: `Guest ${id}`, weapon: second, body: 'snake', ready: false });

/** A Room over memory links with latency and jitter: the host's Lobby and a GuestLobby per guest who connects. */
function room(settings: LobbySettings) {
  const host = new HostLobby(tuning, options(settings));
  let now = 0;
  const links: ReturnType<typeof createMemoryTransportPair>[] = [];
  const guests: GuestLobby[] = [];
  const connect = (name: string) => {
    const link = createMemoryTransportPair({ latencyMs: 40, jitterMs: 20, seed: 3 + links.length });
    links.push(link);
    host.addGuest(link.a);
    const g = new GuestLobby(link.b, tuning, { name, weapon: second, body: 'snake' });
    guests.push(g);
    return g;
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += STEP) {
      now += STEP;
      for (const l of links) l.advance(STEP);
      host.pump(now);
      for (const g of guests) g.pump(now);
    }
  };
  return { host, guests, connect, run };
}

describe('a Gauntlet Room', () => {
  it('a new Room in Gauntlet opens two Open Seats beside the host, and guests join only there', () => {
    let s = newLobby(options({ arena: RUN, bestOf: 3, format: 'Gauntlet' }));
    expect(s.teams[0]).toEqual([{ kind: 'Player', member: 0 }, { kind: 'Open' }, { kind: 'Open' }]);
    s = join(s, guest(1))!;
    s = join(s, guest(2))!;
    expect([seatOf(s, 1), seatOf(s, 2)]).toEqual([
      { team: 0, index: 1 },
      { team: 0, index: 2 },
    ]);
    // Team 1's Open Seat (kept for Duels) takes nobody in a Gauntlet: a fourth is turned away.
    expect(join(s, guest(3))).toBeNull();
    const { lineup, members } = lobbyLineup(s);
    expect(members).toEqual([0, 1, 2]);
    expect(lineup.map((x) => (x.pilot.kind === 'Player' ? `P${x.pilot.player}` : x.pilot.difficulty))).toEqual(['P0', 'P1', 'P2', FLOOR_DIFFICULTY, FLOOR_DIFFICULTY, FLOOR_DIFFICULTY]);
    // A new Room in Duels is as before.
    expect(newLobby(options({ arena: 'library', bestOf: 3 })).teams).toEqual([
      [{ kind: 'Player', member: 0 }, { kind: 'Open' }, { kind: 'Closed' }],
      [{ kind: 'Open' }, { kind: 'Open' }, { kind: 'Closed' }],
    ]);
  });

  it('switching a Room of three to Gauntlet moves every Player to Team 0; four are refused, with the reason shown', () => {
    let s = newLobby(options({ arena: 'library', bestOf: 3 }));
    s = join(s, guest(1))!; // opposite the host
    s = join(s, guest(2))!; // opposite too
    expect([seatOf(s, 1)?.team, seatOf(s, 2)?.team]).toEqual([1, 1]);
    expect(formatRefusal(s, true)).toBeNull();
    const g = setFormat(s, 'Gauntlet', FRESH);
    expect(g.settings).toEqual({ arena: FRESH, bestOf: 3, format: 'Gauntlet' });
    for (const id of [0, 1, 2]) expect(seatOf(g, id)?.team).toBe(0);
    expect(shownTeams(g)).toEqual([0]);
    expect(randomBlurb(g, null, true)).toBe('Run seed 777 · pick again to reroll');

    // A fourth Player: Team 0 holds three, so the switch is refused, and the Lobby says why.
    s = join(s, guest(3))!;
    expect(s.members).toHaveLength(4);
    expect(setFormat(s, 'Gauntlet', FRESH)).toBe(s);
    expect(formatRefusal(s, true)).toBe(formatProblem(s, 'Gauntlet'));
    expect(formatRefusal(s, true)).toMatch(/at most 3 players, all on Team 0; this Lobby has 4/);
    expect(offeredFormats(true)).toContain('Gauntlet');
  });

  it('a guest who joins mid-Run waits for the next Run', () => {
    let s: LobbyState = newLobby(options({ arena: RUN, bestOf: 3, format: 'Gauntlet' }));
    s = startMatch(join(s, guest(1))!);
    s = join(s, guest(2))!;
    expect(s.inMatch).toEqual([0, 1]);
    expect(seatOf(s, 2)?.team).toBe(0);
    expect(waitingTag(s)).toBe('Next Run');
    expect(startMatch(s).inMatch).toEqual([0, 1, 2]);
  });

  it('syncs to every guest: the Format, the Players on Team 0, and a switch the host makes', () => {
    const r = room({ arena: 'library', bestOf: 3 });
    const [bo, cy] = [r.connect('Bo'), r.connect('Cy')];
    r.run(2000);
    expect(r.host.state.members).toHaveLength(3);
    r.host.edit((s) => setFormat(s, 'Gauntlet', RUN));
    r.run(2000);
    for (const g of [bo, cy]) {
      expect(g.status).toBe('Open');
      expect(JSON.stringify(g.state)).toBe(JSON.stringify(r.host.state));
      expect(g.state!.settings.format).toBe('Gauntlet');
      for (const id of [0, 1, 2]) expect(seatOf(g.state!, id)?.team).toBe(0);
      expect(randomBlurb(g.state!, null, false)).toBe('Run seed 640492');
    }
    // A guest asking for a Team 1 Seat stays on Team 0.
    bo.moveMe({ team: 1, index: 0 });
    r.run(2000);
    expect(seatOf(r.host.state, bo.me!)?.team).toBe(0);
  });

  it('a new Gauntlet Room fills its two Seats beside the host over the link, and turns a fourth player away', () => {
    const r = room({ arena: RUN, bestOf: 3, format: 'Gauntlet' });
    const gs = [r.connect('Bo'), r.connect('Cy'), r.connect('Di')];
    r.run(3000);
    expect(r.host.state.members.map((m) => m.name)).toEqual(['Ana', 'Bo', 'Cy']);
    expect(gs.slice(0, 2).every((g) => g.status === 'Open' && seatOf(g.state!, g.me!)?.team === 0)).toBe(true);
    expect(gs[2]!.status).toBe('Closed');
    expect(gs[2]!.failure).toMatch(/full/);
  });
});

describe('the Lobby message in a Gauntlet', () => {
  const lobby = (settings: object, extra: object = {}) => ({
    type: 'lobby',
    you: 1,
    ack: 0,
    state: { ...newLobby(options({ arena: RUN, bestOf: 3 })), settings, ...extra },
  });

  it('carries the Format; a Duels Lobby without one is as before', () => {
    for (const m of [lobby({ arena: RUN, bestOf: 3, format: 'Gauntlet' }), lobby({ arena: RUN, bestOf: 3, format: 'Gauntlet' }, { matchArena: 'gen:greybox:5' }), lobby({ arena: 'library', bestOf: 3, format: 'Duels' }), lobby({ arena: 'library', bestOf: 3 })]) {
      expect(parseLobbyMessage(m), JSON.stringify(m.state.settings)).toEqual(m);
    }
  });

  it('refuses a Format it does not know, and a Gauntlet on a hand-made Map', () => {
    for (const m of [
      lobby({ arena: RUN, bestOf: 3, format: 'Survival' }),
      lobby({ arena: RUN, bestOf: 3, format: 1 }),
      lobby({ arena: RUN, bestOf: 3, format: null }),
      lobby({ arena: 'library', bestOf: 3, format: 'Gauntlet' }),
      lobby({ arena: RUN, bestOf: 3, format: 'Gauntlet' }, { matchArena: 'library' }),
    ]) {
      expect(parseLobbyMessage(m), JSON.stringify(m.state.settings)).toBeNull();
    }
  });
});
