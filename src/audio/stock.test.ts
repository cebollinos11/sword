import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SoundCue } from './cues';
import { STOCK_CLIPS, stockFile, stockFor, type StockClip } from './stock';

const publicFile = (file: string) => resolve(__dirname, '../../public', file);

describe('stockFor', () => {
  it('a heavier blunt Weapon swings with a lower whoosh, and a blade with a swish of its own', () => {
    const swing = (weight: number, blunt = false): SoundCue => ({ sound: 'Swing', fighter: 0, direction: 'Left', weight, ...(blunt ? { blunt: true as const } : {}) });
    expect(stockFor(swing(0, true))?.variant).toBe(2);
    expect(stockFor(swing(0.5, true))?.variant).toBe(1);
    expect(stockFor(swing(1, true))?.variant).toBe(0);
    for (let i = 0; i < 50; i++) expect(stockFor(swing(0.5))!.variant).toBeGreaterThanOrEqual(3);
    expect(stockFor(swing(1))!.rate).toBeLessThan(stockFor(swing(0))!.rate);
  });

  it('a blunt Weapon never rings steel: its Block, Chamber and Wall strike knock, and its Hit thumps', () => {
    const point = { x: 0, y: 1, z: 0 };
    expect(stockFor({ sound: 'Block', defender: 1, strength: 1, weight: 0.5 })?.clip).toBe('clang');
    expect(stockFor({ sound: 'Block', defender: 1, strength: 1, weight: 0.5, blunt: true })?.clip).toBe('blunt-hit');
    expect(stockFor({ sound: 'Chamber', chamberer: 1 })?.clip).toBe('parry');
    expect(stockFor({ sound: 'Chamber', chamberer: 1, blunt: true })?.clip).toBe('blunt-hit');
    expect(stockFor({ sound: 'WallStrike', strength: 1, surface: 'stone', at: point })?.clip).toBe('armor');
    expect(stockFor({ sound: 'WallStrike', strength: 1, surface: 'stone', at: point, blunt: true })?.clip).toBe('blunt-hit');
    const hit = (by: 'Edge' | 'Ball' | 'Dagger', blunt = false): SoundCue => ({ sound: 'Hit', defender: 1, zone: 'torso', strength: 1, by, ...(blunt ? { blunt: true as const } : {}) });
    expect(stockFor(hit('Edge'))?.clip).toBe('hit');
    expect(stockFor(hit('Ball'))?.clip).toBe('hit');
    expect(stockFor(hit('Dagger'))?.clip).toBe('hit');
    expect(stockFor(hit('Edge', true))?.clip).toBe('heavy-hit');
  });

  it('an equip or a pickup plays the equip sound', () => {
    expect(stockFor({ sound: 'Equip', fighter: 0 })?.clip).toBe('equip');
  });

  it('a harder Hit plays louder, and a blade cuts where a shaft or a Kick thumps', () => {
    const hit = (by: 'Edge' | 'Shaft' | 'Kick' | 'Dagger', strength: number): SoundCue => ({ sound: 'Hit', defender: 1, zone: 'torso', strength, by });
    expect(stockFor(hit('Edge', 1))!.level).toBeGreaterThan(stockFor(hit('Edge', 0.2))!.level);
    expect(stockFor(hit('Edge', 1))?.clip).toBe('hit');
    expect(stockFor(hit('Shaft', 1))?.clip).toBe('heavy-hit');
    expect(stockFor(hit('Kick', 1))?.clip).toBe('heavy-hit');
  });

  it("a strong Hit's blood splatters with the long clip, a light one's with the short, louder the stronger", () => {
    const splat = (strength: number) => stockFor({ sound: 'Splatter', point: { x: 0, y: 0, z: 0 }, strength })!;
    expect(splat(1)).toMatchObject({ clip: 'splatter', variant: 0 });
    expect(splat(0.3)).toMatchObject({ clip: 'splatter', variant: 1 });
    expect(splat(1).level).toBeGreaterThan(splat(0.3).level);
  });

  it('cues with no fitting clip stay synthesised', () => {
    expect(stockFor({ sound: 'Feint', fighter: 0 })).toBeNull();
    expect(stockFor({ sound: 'Sheathe', fighter: 0, weight: 0 })).toBeNull();
    expect(stockFor({ sound: 'Draw', fighter: 0, weight: 0 })).toBeNull();
    expect(stockFor({ sound: 'DuelStart', duelNumber: 1 })).toBeNull();
    expect(stockFor({ sound: 'Death', fighter: 0, cause: 'Water' })).toBeNull();
  });
});

describe('stock clips', () => {
  it('every variant of every clip set is in public/ and credited', () => {
    const credits = readFileSync(publicFile('sfx/CREDITS.md'), 'utf8');
    for (const [clip, set] of Object.entries(STOCK_CLIPS) as [StockClip, { count: number }][]) {
      for (let n = 0; n < set.count; n++) expect(existsSync(publicFile(stockFile(clip, n))), stockFile(clip, n)).toBe(true);
      expect(credits).toContain(`\`${clip}-`);
    }
  });
});
