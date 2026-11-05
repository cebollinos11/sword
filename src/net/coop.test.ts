/**
 * Dungeon Stage 4, co-op online: two and four Players walk, loot and equip through a Run's Halls over the memory transport
 * (40 ms ± 20 latency), with no teleport. Each peer drives its own Player with the dev autopilot (Hard, with loot), fed its own
 * (possibly predicted) state; what it sends is ordinary Intents, recorded as sent, so the very same Run steps offline.
 *
 * Every peer's Tick function is wrapped to note what the Match each Tick leaves (`trace`: the last version simulated of a Tick is the
 * true one once that Tick is confirmed), so the tests compare the peers Tick by Tick (Hall changes, Door gathering, pickups,
 * Inventories) and not only by checksum. Enemies are one-hit (as gauntlet.test.ts does); the Ticks are capped.
 *
 * `COOP_LONG=1 npx vitest run src/net/coop.test.ts` adds a longer variant (four Players, Halls 1 to 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, inExitZone, stepMatch, type MatchState } from '../sim';
import { CHECKSUM_INTERVAL, ROLLBACK_WINDOW, type SessionEvent } from './session';
import { peerTuning, hallsIn, type Step, startRun, offline, expectChecksums, hallStarts, disagreements, handOver, reachHall3 } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

describe('co-op Runs over the memory transport: walking, looting and equipping, no teleport', () => {
  it('2 Players reach Hall 3: checksums, Hall changes, Door gathering, pickups and Inventories agree on every peer and offline', () => reachHall3(2), 300_000);
});

describe('co-op Runs across a resync and an AI Takeover', () => {
  it('a guest forced to diverge mid-Hall, with pickups lying and an Inventory changed, resyncs to the host and stays in step with no Desync after', () => {
    const relic = loadTuningData().relics[0]!.name;
    // On the guest only: some way into the first Cleared Hall (its drops lying) its own Fighter gains a Relic and one of the pickups reads taken.
    let driftAt: number | null = null;
    const drift: Step = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (hallsIn(next) !== 1 || next.run?.phase !== 'Cleared') return next;
      driftAt ??= next.tick + 40;
      if (next.tick !== driftAt) return next;
      const fighters = next.duel.fighters.map((f, i) => (i === 1 && f.inventory ? { ...f, inventory: { ...f.inventory, relics: [...f.inventory.relics, relic] } } : f));
      const pickups = next.run!.pickups.map((p, i) => (i === 0 ? { ...p, taken: true } : p));
      return { ...next, duel: { ...next.duel, fighters }, run: { ...next.run!, pickups } };
    };
    const r = startRun({ players: 2, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    let hall2: number | null = null;
    r.until(
      () => hall2 !== null && r.confirmed() >= hall2 + 150,
      () => {
        if (hall2 === null && hallsIn(r.host.session.state) >= 2) hall2 = r.host.session.currentTick;
      },
    );
    expect(hall2, 'reached Hall 2').not.toBeNull();
    expect(driftAt, 'the guest diverged').not.toBeNull();

    const upTo = r.confirmed();
    const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
    const desync = guest.events.find((e) => e.type === 'Desync') as Extract<SessionEvent, { type: 'Desync' }> | undefined;
    const resynced = guest.events.find((e) => e.type === 'Resynced') as Extract<SessionEvent, { type: 'Resynced' }> | undefined;
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced).toBeDefined();
    expect(guest.events.filter((e) => e.type === 'Desync')).toHaveLength(1);
    expect(guest.events.indexOf(resynced!)).toBeGreaterThan(guest.events.indexOf(desync!));
    expect(r.host.events.filter((e) => e.type === 'Desync')).toEqual([]);

    // Its Match did differ: the Relic it did not take, and a pickup the host still had lying...
    const [mine, theirs] = [guest.trace.get(driftAt!)!, expected.trace.get(driftAt!)!];
    expect(mine.fighters[1]!.inventory!.relics.length).toBe(theirs.fighters[1]!.inventory!.relics.length + 1);
    expect(theirs.run.pickups[0]!.taken).toBe(false);
    // ...in a Hall that stood Cleared with pickups lying, when the host's state came.
    const sent = expected.trace.get(resynced!.tick)!;
    expect(sent.run.phase).toBe('Cleared');
    expect(hallsIn(sent)).toBe(1);
    expect(sent.run.pickups.filter((p) => !p.taken).length).toBeGreaterThan(0);
    expect(resynced!.tick).toBeGreaterThan(driftAt!);

    // From the resync on, the guest is the host's and the offline Run's, through the Hall change into Hall 2.
    expect(disagreements([r.host], expected.trace, upTo)).toEqual([]);
    expect(disagreements([guest], expected.trace, upTo, resynced!.tick)).toEqual([]);
    expect(expectChecksums('host', r.host, expected.hashes)).toBeGreaterThan(30);
    expect(expectChecksums('guest', guest, expected.hashes, resynced!.tick)).toBeGreaterThan(20);
    const start2 = hallStarts(expected.trace, upTo)[0]!;
    expect(start2).toBeGreaterThan(resynced!.tick);
    expect(expectChecksums('guest in Hall 2', guest, expected.hashes, start2)).toBeGreaterThan(3);
    expect(guest.session.stats.resyncs).toBe(1);
  }, 300_000);

  it('an AI Takeover mid-Hall while the party gathers: every peer agrees on the Takeover Tick, the Fighter keeps its Inventory and Mods, the others take the Door, the Run goes on in step', () => {
    const r = startRun({ players: 3 });
    const leaver = r.guests[1]!; // Player 2
    const arenaOfHost = () => arenaOf(r.host.tuning, r.host.session.state!.arena);
    let hall2: number | null = null;
    const leftIn: { s: MatchState | null } = { s: null };
    r.until(
      () => hall2 !== null && r.confirmed() >= hall2 + 200,
      (peer) => {
        const s = r.host.session.state;
        if (peer !== r.host || !s) return;
        if (hall2 === null && hallsIn(s) >= 2) hall2 = s.tick;
        // The Cleared Hall, the party gathering at exit 0 (some of the others there, nobody yet the whole party), and the leaver, with a Relic on, still walking: its tab closes.
        const zone = (i: number) => inExitZone(arenaOfHost(), 0, s.duel.fighters[i]!);
        const gathering = s.run!.phase === 'Cleared' && (zone(0) || zone(1)) && !zone(2) && Math.max(...s.run!.doorTicks) === 0;
        if (!leaver.gone && hallsIn(s) <= 2 && gathering && s.duel.fighters[2]!.inventory!.equipped.length > 0) {
          leaver.session.close();
          leaver.gone = true;
          leftIn.s = s;
        }
      },
    );
    expect(leaver.gone, 'the guest left').toBe(true);
    expect(hall2, 'reached Hall 2').not.toBeNull();

    // Every peer still playing hears of it, with the same Takeover Tick.
    const left = r.host.events.find((e) => e.type === 'PlayerLeft') as Extract<SessionEvent, { type: 'PlayerLeft' }>;
    expect(left).toMatchObject({ type: 'PlayerLeft', player: 2 });
    expect(r.guests[0]!.events).toContainEqual(left);
    const takeover = { player: 2, from: left.tick };
    // The host's Tick is ahead of the confirmed one: the Takeover Tick may lie in the past of the state it closed in, which it rolled back over.
    expect(takeover.from).toBeGreaterThan(leftIn.s!.tick - ROLLBACK_WINDOW - 1);

    const upTo = r.confirmed();
    const tuning = peerTuning();
    const expected = offline(tuning, r.lineup, r.peers, upTo, [takeover]);
    const remaining = [r.host, r.guests[0]!];
    for (const p of remaining) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes), `peer ${p.player}`).toBeGreaterThan(30);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.status).toBe('Running');
    }
    expect(disagreements(remaining, expected.trace, upTo)).toEqual([]);

    // Mid-Hall: the Hall was Cleared and the party gathering when the Takeover Tick came, and no Door had been taken in it.
    const at = expected.trace.get(takeover.from)!;
    const hall = hallsIn(at);
    expect(at.run.phase).toBe('Cleared');
    expect(expected.trace.get(takeover.from - 1)!.run.away).toBeUndefined();
    // From that Tick on the Fighter is marked away, on every peer, and its Inventory and Mods stay as they were through the Hall change.
    const before = expected.trace.get(takeover.from - 1)!.fighters[2]!;
    expect(before.inventory!.equipped.length).toBeGreaterThan(0);
    for (const p of remaining) {
      for (let t = takeover.from; t <= upTo; t++) {
        const m = p.trace.get(t)!;
        expect(m.run.away, `peer ${p.player} @${t}`).toEqual([2]);
        const f = m.fighters[2]!;
        if (f.inventory !== before.inventory || f.mods !== before.mods) {
          expect(f.inventory, `peer ${p.player} @${t}`).toEqual(before.inventory);
          expect(f.mods, `peer ${p.player} @${t}`).toEqual(before.mods);
        }
      }
    }

    // The Door is taken by the remaining Players alone: after the Takeover Tick, waiting on Fighters 0 and 1 only, into the next Hall.
    const door = expected.events.find((e) => e.event.type === 'DoorTaken' && e.tick > takeover.from);
    expect(door, 'the Door was taken after the Takeover').toBeDefined();
    const taken = expected.trace.get(door!.tick)!;
    expect(hallsIn(taken)).toBe(hall);
    expect(taken.counting).toEqual([0, 1]);
    expect(taken.countingEveryone).toEqual([0, 1, 2]);
    const starts = hallStarts(expected.trace, upTo);
    expect(starts.find((t) => t > door!.tick)).toBeDefined();
    for (const p of remaining) expect(hallStarts(p.trace, upTo)).toEqual(starts);
    expect(hallsIn(expected.state)).toBeGreaterThan(hall);
    expect(expectChecksums('after the Door', remaining[1]!, expected.hashes, door!.tick)).toBeGreaterThan(5);
    expect(expected.state.run!.away).toEqual([2]);
  }, 300_000);
});

describe.skipIf(!process.env.COOP_LONG)('co-op Runs: the long variant (COOP_LONG=1)', () => {
  it('four Players on the autopilot play Halls 1 to 5 with loot, a hand-over and no Desync', () => {
    const r = startRun({ players: 4, intent: handOver(1) });
    let hall5: number | null = null;
    r.until(
      () => hall5 !== null && r.confirmed() >= hall5 + 120,
      (peer) => {
        if (hall5 === null && peer === r.host && hallsIn(peer.session.state) >= 5) hall5 = peer.session.currentTick;
      },
      40_000,
    );
    const at = r.host.session.state!;
    expect(hall5, `reached Hall 5 (Hall ${hallsIn(at)}, ${at.run!.phase}, Tick ${at.tick})`).not.toBeNull();
    const upTo = r.confirmed();
    const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
    for (const p of r.peers) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes)).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    }
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);
  }, 1_800_000);
});
