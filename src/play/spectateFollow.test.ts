import { describe, expect, it } from 'vitest';
import { createMatch, type SimState } from '../sim';
import { loadTuningData } from '../tuning';
import { spectateTarget } from './spectateFollow';

const tuning = loadTuningData();

describe("a watching Delver Player's followed Fighter", () => {
  // Four in the party: Players 0, 1 and 2, then an AI ally (3).
  const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, 0, 0], humans: 3, players: [0, 1, 2] });
  const dead = (duel: SimState, ...ks: number[]): SimState => ({
    ...duel,
    fighters: duel.fighters.map((f, k) => (ks.includes(k) ? { ...f, death: { tick: 0 } as unknown as NonNullable<typeof f.death> } : f)),
  });

  it('picks a living Player other than itself, and keeps it while it lives', () => {
    const duel = dead(m.duel, 0);
    expect(spectateTarget(m.config, duel, 0, -1)).toBe(1);
    expect(spectateTarget(m.config, duel, 0, 2)).toBe(2);
  });

  it('moves on to the next living Player when the followed one falls', () => {
    expect(spectateTarget(m.config, dead(m.duel, 0, 1), 0, 1)).toBe(2);
    expect(spectateTarget(m.config, dead(m.duel, 0, 2), 0, 2)).toBe(1);
  });

  it('follows an AI ally only once no Player lives, and nobody once the party is down', () => {
    expect(spectateTarget(m.config, dead(m.duel, 0, 1, 2), 0, 2)).toBe(3);
    expect(spectateTarget(m.config, dead(m.duel, 0, 1, 2, 3), 0, 3)).toBe(-1);
  });
});
