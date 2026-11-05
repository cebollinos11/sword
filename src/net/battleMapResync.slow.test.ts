/**
 * A resync on every hand-built Battle map (`battle.maps`): a guest forced to diverge takes the host's state and plays on in step. The guest
 * checks a resynced Crowd against its own map's Objectives, not the open field's: a map with another number of them (the Ziggurat's 4
 * against the open field's 5) once had every resync refused, and the guest played on diverged for good (another Player's Fighter, name
 * tag and all, fighting somewhere they were not). See `battle.test.ts` for the harness; this is its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { stepMatch } from '../sim';
import { disagreements, expectChecksums, offline, startBattle, type Step } from './battleHarness';
import type { SessionEvent } from './session';

afterEach(() => vi.restoreAllMocks());

describe('a resync on a hand-built Battle map', () => {
  it.each(Object.keys(loadTuningData().battle.maps))('on %s: a guest forced to diverge resyncs to the host and stays in step', (map) => {
    // On the guest only, on Tick 300: a Soldier in the Crowd loses HP.
    const driftAt = 300;
    const drift: Step = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (next.tick !== driftAt) return next;
      const crowd = next.duel.crowd!;
      const s = crowd.alive.findIndex((a, i) => a === 1 && crowd.slot[i] === -1);
      return { ...next, duel: { ...next.duel, crowd: { ...crowd, hp: crowd.hp.map((h, i) => (i === s ? h - 7 : h)) } } };
    };
    const r = startBattle({ teams: [0, 1], map, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    r.until(() => r.confirmed() >= driftAt + 600);

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo, [], map);
    expect(guest.trace.get(driftAt)!.hash, 'the guest diverged').not.toBe(expected.trace.get(driftAt)!.hash);
    expect(guest.events.some((e) => e.type === 'Desync'), 'the drift was caught').toBe(true);
    const resynced = guest.events.find((e) => e.type === 'Resynced') as Extract<SessionEvent, { type: 'Resynced' }> | undefined;
    expect(resynced, 'the guest took the host state').toBeDefined();
    expect(disagreements([r.host], expected.trace, upTo)).toEqual([]);
    expect(disagreements([guest], expected.trace, upTo, resynced!.tick)).toEqual([]);
    expect(expectChecksums('guest', guest, expected.hashes, resynced!.tick)).toBeGreaterThan(10);
  }, 300_000);
});
