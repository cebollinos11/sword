/**
 * Stock sounds: recorded clips from free game projects (`public/sfx/`, credited in its
 * `CREDITS.md`), played for the cues they fit in place of the synthesised sound. A cue with no
 * clip here, or whose clip has not loaded yet, is synthesised as before. This mapping is pure,
 * so it is tested headlessly.
 */
import type { SoundCue } from './cues';

/** Each clip set: how many variants (`<clip>-<n>.mp3`, n from 0) and how loud it plays. */
export const STOCK_CLIPS = {
  // 0..2 the low, mid and high whooshes (a blunt Weapon's, by weight); 3.. the blade swings.
  swing: { count: 12, level: 0.9 },
  // Steel on steel: a blade's Block.
  clang: { count: 6, level: 0.9 },
  // A blade in flesh: 0..8 knife blows, 9..12 sword slices.
  hit: { count: 13, level: 1.1 },
  // A blunt blow in flesh (staff, hammer, any shaft, a Kick).
  'heavy-hit': { count: 6, level: 1.2 },
  parry: { count: 2, level: 1 },
  // Wood and iron knocking: a blunt Weapon's Block, Chamber and Wall strike, in place of any steel.
  'blunt-hit': { count: 7, level: 1 },
  // A pickup or an equip in the inventory.
  equip: { count: 1, level: 0.9 },
  thud: { count: 3, level: 1 },
  death: { count: 5, level: 0.9 },
  lava: { count: 1, level: 0.9 },
  armor: { count: 5, level: 0.8 },
  'arrow-hit': { count: 5, level: 0.8 },
  victory: { count: 1, level: 0.9 },
  shout: { count: 6, level: 0.8 },
  splatter: { count: 2, level: 0.8 },
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

/** The first variant of the `swing` set that is a blade's (those before it are the three whooshes a blunt Weapon uses). */
const BLADE_SWING_FIRST = 3;

/** A spray this strong (0..1) or stronger splatters with the long clip. */
export const SPLATTER_HEAVY = 0.6;

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

/** What a Soldier's blow in the Crowd may sound like. */
export const CROWD_BLOW_CLIPS: readonly StockClip[] = ['clang', 'armor', 'hit', 'hit'];

const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** The clip a cue plays, or null when it stays synthesised. */
export function stockFor(cue: SoundCue): StockPlay | null {
  switch (cue.sound) {
    case 'Swing': {
      const thrust = cue.direction === 'Thrust' ? 1.15 : 1;
      // A blunt Weapon's whoosh is Lugaru's low, mid or high one (the heavier the Weapon, the lower), never a blade's swish.
      if (cue.blunt) return play('swing', 1, { variant: cue.weight > 0.6 ? 0 : cue.weight > 0.25 ? 1 : 2, rate: thrust, wet: 0.12 });
      // A blade's: any of the swishes, pitched lower the heavier the Weapon.
      return play('swing', 1, { variant: BLADE_SWING_FIRST + Math.floor(Math.random() * (STOCK_CLIPS.swing.count - BLADE_SWING_FIRST)), rate: thrust * (1.05 - 0.2 * cue.weight), wet: 0.12 });
    }
    case 'Block':
      if (cue.blunt) return play('blunt-hit', 0.55 + 0.45 * cue.strength, { rate: 1.05 - 0.2 * cue.weight, wet: 0.3 });
      return play('clang', 0.55 + 0.45 * cue.strength, { rate: 1.1 - 0.2 * cue.weight, wet: 0.35 });
    case 'Hit':
      // A blunt Weapon (a staff or hammer anywhere, a shaft) and a Kick thump; a blade cuts.
      if (cue.blunt || cue.by === 'Shaft' || cue.by === 'Kick') return play('heavy-hit', 0.6 + 0.4 * cue.strength, { wet: 0.18 });
      switch (cue.by) {
        case 'Edge':
          return play('hit', 0.6 + 0.4 * cue.strength, { wet: 0.18 });
        case 'Ball':
          // A flail's spiked ball cuts, deep: the blade blow pitched down and louder (the synth adds the spikes' crunch and the chain).
          return play('hit', 0.8 + 0.4 * cue.strength, { rate: 0.8, wet: 0.22 });
        case 'Dagger':
          return play('hit', 0.45 + 0.3 * cue.strength, { rate: 1.15, wet: 0.18 });
      }
      return null;
    case 'Chamber':
      return play(cue.blunt ? 'blunt-hit' : 'parry', 1, { wet: 0.45 });
    case 'Equip':
      return play('equip', 1, { wet: 0.1 });
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
      return play(cue.blunt ? 'blunt-hit' : 'armor', 0.5 + 0.5 * cue.strength, { wet: 0.3 });
    case 'Splatter':
      // The long, wet one for a strong Hit's spray, the short one for a light Hit's; each a little different in pitch.
      return play('splatter', 0.6 + 0.4 * cue.strength, { variant: cue.strength >= SPLATTER_HEAVY ? 0 : 1, rate: 0.9 + Math.random() * 0.2, wet: 0.2 });
    case 'MatchEnd':
      return play('victory', 1, { at: ENDING_DELAY, wet: 0.4 });
    case 'CrowdBlow':
      // A Soldier's blow rings off steel or lands in a body, a little different every time.
      return play(pickOf(CROWD_BLOW_CLIPS), 0.7, { rate: 0.88 + Math.random() * 0.24, wet: 0.3 });
    case 'WhirlwindCry':
      // Letting go into the Spin: one of the Crowd's war cries, any of them, a touch louder than the din's.
      return play('shout', 1.1, { rate: 0.95 + Math.random() * 0.1, wet: 0.3 });
    case 'CrowdFall':
      // The cry of a falling Soldier, pitched a little so a Crowd of them are not all one man.
      return play('death', 0.75, { rate: 0.88 + Math.random() * 0.24, wet: 0.5 });
    default:
      return null;
  }
}

/** The file one variant of a clip set is served from, under the site's base path. */
export function stockFile(clip: StockClip, variant: number): string {
  return `sfx/${clip}-${variant}.mp3`;
}
