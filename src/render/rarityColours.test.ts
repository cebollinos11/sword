import type { FighterState } from '../sim';
import { describe, expect, it } from 'vitest';
import { RARITY_COLOUR, rarityClass, rarityCss, rarityTint, wieldedRarity } from './rarityColours';

describe('the Rarity colours', () => {
  it('Common has none, Rare is blue and Legendary orange', () => {
    expect(RARITY_COLOUR).toEqual({ Common: null, Rare: 0x4a9eff, Legendary: 0xff8a1f });
  });

  it('reads as #rrggbb, null for Common', () => {
    expect(rarityCss('Common')).toBeNull();
    expect(rarityCss('Rare')).toBe('#4a9eff');
    expect(rarityCss('Legendary')).toBe('#ff8a1f');
  });

  it('is a class for Rare and Legendary, none for Common', () => {
    expect(rarityClass('Common')).toBe('');
    expect(rarityClass('Rare')).toBe('rarity-rare');
    expect(rarityClass('Legendary')).toBe('rarity-legendary');
  });
});

describe('the Rarity tint', () => {
  const base = 0x9aa2ac;
  const channel = (c: number, shift: number) => (c >> shift) & 255;

  it('leaves Common as the base', () => {
    expect(rarityTint(base, 'Common')).toBe(base);
  });

  it('moves Rare and Legendary 55% toward their colour, to distinct colours', () => {
    const rare = rarityTint(base, 'Rare');
    const legendary = rarityTint(base, 'Legendary');
    expect(rare).not.toBe(legendary);
    expect(channel(rare, 16)).toBe(Math.round(0x9a + (0x4a - 0x9a) * 0.55));
    for (const [tint, r] of [[rare, 'Rare'], [legendary, 'Legendary']] as const) {
      for (const shift of [16, 8, 0]) {
        const lo = Math.min(channel(base, shift), channel(RARITY_COLOUR[r]!, shift));
        const hi = Math.max(channel(base, shift), channel(RARITY_COLOUR[r]!, shift));
        expect(channel(tint, shift)).toBeGreaterThanOrEqual(lo);
        expect(channel(tint, shift)).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('tints black wood to a fraction of the colour', () => {
    expect(rarityTint(0, 'Legendary')).toBe((Math.round(0xff * 0.55) << 16) | (Math.round(0x8a * 0.55) << 8) | Math.round(0x1f * 0.55));
  });
});

describe('the wielded Rarity', () => {
  it('is Common without an inventory', () => {
    expect(wieldedRarity({})).toBe('Common');
  });

  it('is the wielded Item’s Rarity', () => {
    const inventory = {
      weapons: [{ name: 'a', rarity: 'Rare' }, { name: 'b', rarity: 'Legendary' }],
      weapon: 1,
    } as unknown as FighterState['inventory'];
    expect(wieldedRarity({ inventory })).toBe('Legendary');
    expect(wieldedRarity({ inventory: { ...inventory!, weapon: 0 } })).toBe('Rare');
  });
});
