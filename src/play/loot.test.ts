import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { relicWords } from './loot';

const tuning = loadTuningData();

describe('loot presentation text', () => {
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
