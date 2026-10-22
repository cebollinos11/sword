import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon } from '../tuning';
import { IDLE_INTENT, TICK_RATE } from '../sim';
import { createMemoryTransportPair, createRollbackSession, type MemoryTransportOptions, type RollbackSession } from '../net';
import { lobbyLineup, setSeat, updateSettings } from './lobby';
import { GuestLobby, HostLobby, LOBBY_TIMEOUT_MS } from './sync';

const tuning = loadTuningData();
const [first, second] = Object.keys(tuning.weapons) as [string, string];
const STEP = 1000 / TICK_RATE;

function room(net: MemoryTransportOptions = {}) {
  const host = new HostLobby(tuning, {
    host: { name: 'Ana', weapon: first, body: 'monk' },
    settings: { arena: 'circle', bestOf: 3 },
    online: true,
    ai: { difficulty: 'Normal', weapon: first },
  });
  let now = 0;
  const links: ReturnType<typeof createMemoryTransportPair>[] = [];
  const connect = (name: string, guestTuning = tuning) => {
    const link = createMemoryTransportPair(net);
    links.push(link);
    host.addGuest(link.a);
    return new GuestLobby(link.b, guestTuning, { name, weapon: second, body: 'snake' });
  };
  const guests: GuestLobby[] = [];
  const run = (ms: number, each?: () => void) => {
    for (let t = 0; t < ms; t += STEP) {
      now += STEP;
      for (const l of links) l.advance(STEP);
      host.pump(now);
      for (const g of guests) g.pump(now);
      each?.();
    }
  };
  return { host, guests, connect, run };
}

describe('Lobby sync', () => {
  it('a guest joins, picks, moves and readies, through a lossy link', () => {
    const r = room({ latencyMs: 40, jitterMs: 20, loss: 0.2, seed: 3 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(2000);
    expect(g.status).toBe('Open');
    expect(g.me).toBe(1);
    expect(r.host.state.members.map((m) => m.name)).toEqual(['Ana', 'Bo']);
    g.setMine({ weapon: first, ready: true });
    g.moveMe({ team: 0, index: 1 });
    r.run(3000);
    expect(r.host.state.members[1]).toMatchObject({ weapon: first, ready: true });
    expect(r.host.state.teams[0]![1]).toEqual({ kind: 'Player', member: 1 });
    // A swap: the Open Seat the guest took went to their old one.
    expect(r.host.state.teams[1]![0]).toEqual({ kind: 'Open' });
    expect(JSON.stringify(g.state)).toBe(JSON.stringify(r.host.state));
  });

  it('every player sees the Body each Member chose, through a lossy link', () => {
    const r = room({ latencyMs: 40, jitterMs: 20, loss: 0.2, seed: 5 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(2000);
    expect(g.state?.members.map((m) => m.body)).toEqual(['monk', 'snake']);
    g.setMine({ body: 'wraith' });
    r.host.setMine({ body: 'prince' });
    r.run(3000);
    expect(r.host.state.members.map((m) => m.body)).toEqual(['prince', 'wraith']);
    expect(lobbyLineup(g.state!).bodies).toEqual(['prince', 'wraith']);
  });

  it('the host’s changes reach the guest', () => {
    const r = room({ latencyMs: 30 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    r.host.edit((s) => updateSettings(s, { arena: 'library', bestOf: 5 }));
    r.run(500);
    expect(g.state!.settings).toEqual({ arena: 'library', bestOf: 5 });
  });

  it('a Random Map (gen:<kit>:<seed>) reaches the guest; a gen: name of a Kit it lacks does not', () => {
    const r = room({ latencyMs: 30 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    r.host.edit((s) => updateSettings(s, { arena: 'gen:greybox:1234' }));
    r.run(500);
    expect(g.state!.settings.arena).toBe('gen:greybox:1234');
    r.host.edit((s) => updateSettings(s, { arena: 'gen:marble:1' }));
    r.run(500);
    expect(g.state!.settings.arena).toBe('gen:greybox:1234');
  });

  it('each Match on a Random Map reaches the guest with the Arena it is played on: the next seed after the last played', () => {
    const r = room({ latencyMs: 30 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    r.host.edit((s) => updateSettings(s, { arena: 'gen:greybox:12' }));
    expect(r.host.start(false)).toBeNull();
    r.run(500);
    expect(g.state!.matchArena).toBe('gen:greybox:12');
    // A Rematch moved the Match on to the next seed; the host's restart follows on from there.
    expect(r.host.start(false, 'gen:greybox:381979')).toBeNull();
    r.run(500);
    expect(g.state!.matchArena).toBe('gen:greybox:763946');
    expect(g.state!.settings.arena).toBe('gen:greybox:12');
    // A broken host's Match Arena of a Kit the guest lacks, or not a name at all, is ignored.
    for (const matchArena of ['gen:marble:1', 7]) {
      r.host.edit((s) => ({ ...s, matchArena }) as typeof s);
      r.run(500);
      expect(g.state!.matchArena).toBe('gen:greybox:763946');
    }
  });

  it("each AI Seat's Style reaches the guest; a broken host's unknown Style is ignored", () => {
    const r = room({ latencyMs: 30 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    const at = { team: 1, index: 1 };
    r.host.edit((s) => setSeat(s, at, { kind: 'AI', difficulty: 'Expert', weapon: first, style: 'Tricky' }));
    r.run(500);
    expect(g.state!.teams[1]![1]).toEqual({ kind: 'AI', difficulty: 'Expert', weapon: first, style: 'Tricky' });
    r.host.edit((s) => setSeat(s, at, { kind: 'AI', difficulty: 'Expert', weapon: first, style: 'Sneaky' }));
    r.run(500);
    expect(g.state!.teams[1]![1]).toEqual({ kind: 'AI', difficulty: 'Expert', weapon: first, style: 'Tricky' });
  });

  it('takes three guests, turns away a fourth (the Room is full) and a guest with other Tuning Data', () => {
    const r = room();
    const bad = r.connect('Ed', withWeapon(tuning, { damage: 1 }));
    const ok = ['Bo', 'Cy', 'Di'].map((name) => r.connect(name));
    r.guests.push(bad, ...ok);
    r.run(2000);
    const late = r.connect('Fi');
    r.guests.push(late);
    r.run(2000);
    for (const g of ok) expect(g.status).toBe('Open');
    expect(late.status).toBe('Closed');
    expect(late.failure).toMatch(/full/);
    expect(bad.status).toBe('Closed');
    expect(bad.failure).toMatch(/game data/);
    expect(r.host.state.members.map((m) => m.name)).toEqual(['Ana', 'Bo', 'Cy', 'Di']);
  });

  it('a guest leaving opens their Seat, and the host notices', () => {
    const r = room();
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    g.close();
    r.run(100);
    expect(r.host.state.members).toHaveLength(1);
    expect(r.host.state.teams[1]![0]).toEqual({ kind: 'Open' });
  });

  it('a silent host times out', () => {
    const r = room();
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    // Only the guest's clock runs on: the host stops sending.
    let now = 1000;
    for (let t = 0; t <= LOBBY_TIMEOUT_MS + 100; t += 100) g.pump((now += 100));
    expect(g.status).toBe('Closed');
    expect(g.failure).toMatch(/Lost/);
  });

  it('restarts a Match with new settings over the same link', () => {
    const r = room({ latencyMs: 30, jitterMs: 10 });
    const g = r.connect('Bo');
    r.guests.push(g);
    r.run(1000);
    g.setMine({ ready: true });
    r.run(1000);

    let sessions: [RollbackSession, RollbackSession] | null = null;
    let started = 0;
    const startSessions = () => {
      const gen = r.host.state.generation;
      const { lineup } = lobbyLineup(r.host.state);
      const settings = r.host.state.settings;
      sessions?.forEach((s) => s.close());
      const h = createRollbackSession({
        role: 'host',
        transport: r.host.matchTransport(gen, 1)!,
        tuning,
        weapon: first,
        lineup,
        match: { bestOf: settings.bestOf, arena: settings.arena, seed: gen },
      });
      const gs = createRollbackSession({ role: 'guest', transport: g.matchTransport(g.state!.generation, 0)!, tuning, weapon: g.state!.members[1]!.weapon });
      sessions = [h, gs];
      started = gen;
    };
    const tick = () => {
      if (r.host.state.playing && r.host.state.generation !== started && g.state!.generation === r.host.state.generation) startSessions();
      sessions?.forEach((s) => s.tick(IDLE_INTENT));
    };

    expect(r.host.start(true)).toBeNull();
    r.run(1500, tick);
    expect(sessions![0].status).toBe('Running');
    expect(sessions![1].status).toBe('Running');
    expect(sessions![1].state!.config.arena).toBe('circle');

    r.host.edit((s) => updateSettings(s, { arena: 'library' }));
    expect(r.host.start(false)).toBeNull();
    r.run(1500, tick);
    expect(started).toBe(2);
    expect(sessions![0].status).toBe('Running');
    expect(sessions![1].status).toBe('Running');
    expect(sessions![1].state!.config.arena).toBe('library');
    expect(sessions![1].currentTick).toBeGreaterThan(30);
    expect(g.status).toBe('Open');

    // Back in the Lobby, the guest must ready again (its heartbeats do not restore the old flag).
    r.host.backToLobby();
    r.run(3000);
    expect(r.host.state.members[1]!.ready).toBe(false);
    expect(g.state!.members[1]!.ready).toBe(false);
    expect(r.host.start(true)).toMatch(/Bo/);
  });

  it('plays a four-Player Match over the Room links; a guest leaving the Room hands its Fighter to the AI', () => {
    const r = room({ latencyMs: 30, jitterMs: 10 });
    const gs = ['Bo', 'Cy', 'Di'].map((name) => r.connect(name));
    r.guests.push(...gs);
    r.run(1000);
    for (const g of gs) g.setMine({ ready: true });
    r.run(1000);
    expect(r.host.start(true)).toBeNull();
    r.run(500);

    const gen = r.host.state.generation;
    const { lineup, members } = lobbyLineup(r.host.state);
    expect(members).toEqual([0, 1, 2, 3]);
    const host = createRollbackSession({
      role: 'host',
      guests: members.slice(1).map((id) => r.host.matchTransport(gen, id)),
      tuning,
      weapon: first,
      lineup,
      match: { bestOf: 3, arena: 'circle', seed: gen },
    });
    const guests = gs.map((g) => createRollbackSession({ role: 'guest', transport: g.matchTransport(gen, 0)!, tuning, weapon: second }));
    expect(gs[0]!.matchTransport(gen, 2)).toBeNull(); // guests only talk to the host
    const sessions = [host, ...guests];
    const left: unknown[] = [];
    host.onEvent((e) => e.type === 'PlayerLeft' && left.push(e));
    r.run(1500, () => sessions.forEach((s) => s.status !== 'Disconnected' && s.tick(IDLE_INTENT)));
    expect(sessions.map((s) => s.status)).toEqual(['Running', 'Running', 'Running', 'Running']);
    expect(guests.map((s) => s.localPlayer)).toEqual([1, 2, 3]);

    gs[1]!.close(); // Cy leaves the Room
    r.run(1500, () => sessions.forEach((s) => s.status !== 'Disconnected' && s.tick(IDLE_INTENT)));
    expect(r.host.state.members.map((m) => m.name)).toEqual(['Ana', 'Bo', 'Di']);
    expect(left).toEqual([expect.objectContaining({ type: 'PlayerLeft', player: 2 })]);
    expect([host, guests[0]!, guests[2]!].map((s) => s.status)).toEqual(['Running', 'Running', 'Running']);
    expect(host.currentTick).toBeGreaterThan(100);
  });
});
