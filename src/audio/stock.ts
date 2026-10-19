/**
 * Stock sounds: recorded clips from free game projects (`public/sfx/`, credited in its
 * `CREDITS.md`), played for the cues they fit in place of the synthesised sound. A cue with no
 * clip here, or whose clip has not loaded yet, is synthesised as before. This mapping is pure,
 * so it is tested headlessly.
 */
import type { SoundCue } from './cues';

/** Each clip set: how many variants (`<clip>-<n>.mp3`, n from 0) and how loud it plays. */
export const STOCK_CLIPS = {
  swing: { count: 3, level: 0.9 },
  clang: { count: 4, level: 0.9 },
  hit: { count: 9, level: 1.1 },
  'heavy-hit': { count: 5, level: 1.2 },
  parry: { count: 1, level: 1 },
  thud: { count: 3, level: 1 },
  death: { count: 5, level: 0.9 },
  lava: { count: 1, level: 0.9 },
  armor: { count: 5, level: 0.8 },
  'arrow-hit': { count: 5, level: 0.8 },
  victory: { count: 1, level: 0.9 },
} as const;

export type StockClip = keyof typeof STOCK_CLIPS;

/** One clip to play for a cue. */
export interface StockPlay {
  readonly clip: StockClip;
  /** Which variant; any of them when absent. */
  readonly variant?: number;
  /** Loudness against the clip set's own level. */
  readonly level: number;
  /** Playback rate (pitch and speed), before slow motion. */
  readonly rate: number;
  /** Seconds after the cue it starts. */
  readonly at: number;
  /** Fraction of it sent into the room's reverb. */
  readonly wet: number;
}

/** Seconds the victory call waits after the blow that ended the Match, so the Death is heard first. */
const ENDING_DELAY = 0.55;

const play = (clip: StockClip, level: number, opts: Partial<Omit<StockPlay, 'clip' | 'level'>> = {}): StockPlay => ({
  clip,
  level,
  rate: 1,
  at: 0,
  wet: 0.2,
  ...opts,
});

/** The clip a cue plays, or null when it stays synthesised. */
export function stockFor(cue: SoundCue): StockPlay | null {
  switch (cue.sound) {
    case 'Swing':
      // Lugaru's low, mid and high whooshes: the heavier the Weapon, the lower.
      return play('swing', 1, { variant: cue.weight > 0.6 ? 0 : cue.weight > 0.25 ? 1 : 2, rate: cue.direction === 'Thrust' ? 1.15 : 1, wet: 0.12 });
    case 'Block':
      return play('clang', 0.55 + 0.45 * cue.strength, { rate: 1.1 - 0.2 * cue.weight, wet: 0.35 });
    case 'Hit':
      switch (cue.by) {
        case 'Edge':
          return play('hit', 0.6 + 0.4 * cue.strength, { wet: 0.18 });
        case 'Dagger':
          return play('hit', 0.45 + 0.3 * cue.strength, { rate: 1.15, wet: 0.18 });
        case 'Shaft':
        case 'Kick':
          return play('heavy-hit', 0.6 + 0.4 * cue.strength, { wet: 0.18 });
      }
      return null;
    case 'Chamber':
      return play('parry', 1, { wet: 0.45 });
    case 'BodyFall':
      return play('thud', 1, { variant: 0, wet: 0.25 });
    case 'Land':
      return play('thud', 0.5 + 0.5 * cue.strength, { variant: 1 + Math.floor(Math.random() * 2) });
    case 'Death':
      if (cue.cause === 'Lava') return play('lava', 1, { wet: 0.3 });
      if (cue.cause === 'Water') return null;
      return play('death', 1, { wet: 0.5 });
    case 'Clink':
      return play('armor', 0.6, { rate: 1.25, wet: 0.3 });
    case 'Thunk':
      return play('arrow-hit', 0.8, { wet: 0.15 });
    case 'WallStrike':
      return play('armor', 0.5 + 0.5 * cue.strength, { wet: 0.3 });
    case 'MatchEnd':
      return play('victory', 1, { at: ENDING_DELAY, wet: 0.4 });
    default:
      return null;
  }
}

/** The file one variant of a clip set is served from, under the site's base path. */
export function stockFile(clip: StockClip, variant: number): string {
  return `sfx/${clip}-${variant}.mp3`;
}
