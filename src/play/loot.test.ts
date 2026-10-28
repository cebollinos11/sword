import { describe, expect, it } from 'vitest';
import { createMatch, type MatchState, type Pickup } from '../sim';
import { loadTuningData } from '../tuning';
import { pickupLabel, pickupMarks, relicWords, visiblePickups } from './loot';

const tuning = loadTuningData();

const pickup = (id: number, owner: number | null, item = 'Whetstone', taken = false): Pickup => ({ id, owner, kind: 'relic', item, at: { x: 1, y: 0, z: 2 }, taken });

const withPickups = (pickups: Pickup[]): MatchState => {
  const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 3, arena: 'gen:greybox:4242', teams: [0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
  return { ...m, run: { ...m.run!, pickups } };
};

describe('loot presentation text', () => {
  it("a pickup is labelled with its item's name", () => {
    expect(pickupLabel(pickup(0, 0, 'Iron Plate'))).toBe('Iron Plate');
  });

  it('a pickup is visible to its owner only, a shared one to everyone, a taken one to none', () => {
    const m = withPickups([pickup(0, 0), pickup(1, 1), pickup(2, null), pickup(3, 0, 'Whetstone', true)]);
    expect(visiblePickups(m, 0).map((p) => p.id)).toEqual([0, 2]);
    expect(visiblePickups(m, 1).map((p) => p.id)).toEqual([1, 2]);
    expect(pickupMarks(m, 0).map((p) => [p.id, p.text])).toEqual([[0, 'Whetstone'], [2, 'Whetstone']]);
    expect(pickupMarks(m, 0)[0]!.at.y).toBeGreaterThan(0);
  });

  it("every Relic's effects read in words", () => {
    expect(relicWords({ damage: 1.1 })).toBe('+10% damage');
    expect(relicWords({ damageTaken: 0.9 })).toBe('-10% damage taken');
    expect(relicWords({ damage: 1.3, damageTaken: 1.25 })).toBe('+30% damage, +25% damage taken');
    expect(relicWords({ maxHp: 0.2 })).toBe('+20% max HP');
    expect(relicWords({ daggers: 1 })).toBe('+1 dagger');
    expect(relicWords({ healOnKill: 10 })).toBe('heal 10 HP on a kill');
    for (const r of tuning.relics) expect(relicWords(r.effects), r.name).not.toBe('');
  });
});
