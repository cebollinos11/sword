import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SoundCue } from './cues';
import { STOCK_CLIPS, stockFile, stockFor, type StockClip } from './stock';

const publicFile = (file: string) => resolve(__dirname, '../../public', file);

describe('stockFor', () => {
  it('a heavier Weapon swings with a lower whoosh', () => {
    const swing = (weight: number): SoundCue => ({ sound: 'Swing', fighter: 0, direction: 'Left', weight });
    expect(stockFor(swing(0))?.variant).toBe(2);
    expect(stockFor(swing(0.5))?.variant).toBe(1);
    expect(stockFor(swing(1))?.variant).toBe(0);
  });

  it('a harder Hit plays louder, and a blade cuts where a shaft or a Kick thumps', () => {
    const hit = (by: 'Edge' | 'Shaft' | 'Kick' | 'Dagger', strength: number): SoundCue => ({ sound: 'Hit', defender: 1, zone: 'torso', strength, by });
    expect(stockFor(hit('Edge', 1))!.level).toBeGreaterThan(stockFor(hit('Edge', 0.2))!.level);
    expect(stockFor(hit('Edge', 1))?.clip).toBe('hit');
    expect(stockFor(hit('Shaft', 1))?.clip).toBe('heavy-hit');
    expect(stockFor(hit('Kick', 1))?.clip).toBe('heavy-hit');
  });

  it('cues with no fitting clip stay synthesised', () => {
    expect(stockFor({ sound: 'Feint', fighter: 0 })).toBeNull();
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
