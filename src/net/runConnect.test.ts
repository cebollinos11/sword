/**
 * Who may join a Run online: a guest whose Dungeon Tuning Data differs from the host's, or one on an older protocol, is turned away at
 * connect, by the Run session and by a Room in Gauntlet alike.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, type TuningData } from '../tuning';
import { IDLE_INTENT } from '../sim';
import { GuestLobby, HostLobby } from '../lobby';
import { createMemoryTransportPair } from './memoryTransport';
import { createRollbackSession } from './session';
import { PROTOCOL_VERSION } from './messages';
import { MATCH, NAME, NET, runLineup, TICK_MS, WEAPON } from './coopHarness';

/** A message as an older build would send it: its `protocol` (on a Room channel's `join`) set to `protocol`. */
function rewriteProtocol(m: unknown, protocol: number): unknown {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return o.type === 'join' && 'protocol' in o ? { ...o, protocol } : o;
  };
  return walk(m);
}

describe('joining a Run online', () => {
  it('a guest with a different dungeon.json is refused at connect', () => {
    const tuning = loadTuningData();
    const other: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, restHeal: 0.25 } };
    const pair = createMemoryTransportPair(NET);
    const host = createRollbackSession({ role: 'host', guests: [pair.a], tuning, match: MATCH, lineup: runLineup(2), weapon: WEAPON });
    const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning: other, weapon: WEAPON });
    const events: { type: string; reason?: string }[] = [];
    guest.onEvent((e) => events.push(e as { type: string }));
    for (let i = 0; i < 60 && guest.status !== 'Refused'; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
      guest.tick(IDLE_INTENT);
    }
    expect(guest.status).toBe('Refused');
    expect(events).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
  });

  it('a guest on the old protocol is refused, by the Run session and by the Lobby', () => {
    const tuning = loadTuningData();
    const pair = createMemoryTransportPair(NET);
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup: runLineup(2), weapon: WEAPON });
    const heard: unknown[] = [];
    pair.b.onMessage((m) => heard.push(m));
    pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION - 1, tuningHash: tuningDataHash(tuning), weapon: WEAPON });
    for (let i = 0; i < 20; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
    }
    expect(heard).toContainEqual(expect.objectContaining({ type: 'refuse', reason: 'ProtocolMismatch' }));
    expect(heard).not.toContainEqual(expect.objectContaining({ type: 'hello', match: expect.anything() }));

    // A Room in Gauntlet turns away a guest on the old protocol before it joins.
    const lobby = new HostLobby(tuning, {
      host: { name: 'Ana', weapon: WEAPON, body: 'monk' },
      settings: { arena: NAME, bestOf: 3, format: 'Gauntlet' },
      online: true,
      ai: { difficulty: 'Normal', weapon: WEAPON },
    });
    const link = createMemoryTransportPair(NET);
    lobby.addGuest(link.a);
    const guest = new GuestLobby(link.b, tuning, { name: 'Bo', weapon: WEAPON, body: 'snake' });
    // The guest's join goes out as an older build would send it.
    let now = 0;
    const realSend = link.b.send.bind(link.b);
    link.b.send = (m: unknown) => realSend(rewriteProtocol(m, PROTOCOL_VERSION - 1));
    for (let i = 0; i < 120; i++) {
      now += TICK_MS;
      link.advance(TICK_MS);
      lobby.pump(now);
      guest.pump(now);
    }
    expect(guest.status).toBe('Closed');
    expect(guest.failure).toMatch(/version/);
    expect(lobby.state.members).toHaveLength(1);
  });
});
