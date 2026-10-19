/**
 * Which placeholder sound each Simulation event triggers. Audio lives outside
 * the Simulation and only listens to its events (ADR 0001); this mapping is
 * pure, so it is tested headlessly.
 */
import type { Direction, SimEvent, Vec3 } from '../sim';
import type { HitZone } from '../tuning';

/** The swing sound: an Attack entered Release. */
export interface SwingCue {
  readonly sound: 'Swing';
  readonly fighter: number;
  readonly direction: Direction;
}

/** An Attack was Blocked by rule. `strength` is 0..1, from the Blade Speed: a harder blow clangs louder and rings longer. */
export interface BlockCue {
  readonly sound: 'Block';
  readonly defender: number;
  readonly strength: number;
  /** A Perfect Block: the clang rings out with a bright, bell-like ting over it. */
  readonly perfect: boolean;
}

/** A Blade Sweep landed a Hit. `strength` is 0..1, from the damage dealt. */
export interface HitCue {
  readonly sound: 'Hit';
  readonly defender: number;
  readonly zone: HitZone;
  readonly strength: number;
}

/** A Fighter landed from a Jump or a fall: a thud on the boards. `strength` is 0..1, from the height it dropped. */
export interface LandCue {
  readonly sound: 'Land';
  readonly fighter: number;
  readonly strength: number;
}

/** A Throw entered Release: the dagger whooshes out of the hand. */
export interface ThrowCue {
  readonly sound: 'Throw';
  readonly fighter: number;
}

/** A thrown dagger was Blocked by rule: a light clink. */
export interface ClinkCue {
  readonly sound: 'Clink';
  readonly defender: number;
}

/** A thrown dagger stuck in a Wall or the floor at `point`: a short thunk. */
export interface ThunkCue {
  readonly sound: 'Thunk';
  readonly point: Vec3;
}

/** A blade stopped by an Arena Wall: a dull knock with a short ring. `strength` is 0..1, from the Blade Speed. */
export interface WallStrikeCue {
  readonly sound: 'WallStrike';
  readonly strength: number;
}

export type SoundCue = WallStrikeCue | SwingCue | BlockCue | HitCue | LandCue | ThrowCue | ClinkCue | ThunkCue;

/** Damage at which a Hit sound plays at full strength (about a head hit with repo Tuning Data). */
const FULL_STRENGTH_DAMAGE = 45;
/** A blade meeting a Wall at this Blade Speed (m/s) or faster knocks at full strength. */
const FULL_STRENGTH_WALL_SPEED = 10;
/** A blow Blocked at this Blade Speed (m/s) or faster clangs at full strength (about a Weapon's reference speed). */
const FULL_STRENGTH_BLOCK_SPEED = 20;
/** A Landing from this high (m) thuds at full strength; one from lower than LAND_QUIET makes no sound. */
const FULL_STRENGTH_DROP = 5;
const LAND_QUIET = 0.2;

/** The sounds triggered by one Tick's events, in event order. */
export function soundCues(events: readonly SimEvent[]): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'AttackPhase':
        if (e.phase === 'Release') cues.push({ sound: 'Swing', fighter: e.fighter, direction: e.direction });
        break;
      case 'Block':
        cues.push({ sound: 'Block', defender: e.defender, strength: Math.min(1, Math.max(0.3, e.bladeSpeed / FULL_STRENGTH_BLOCK_SPEED)), perfect: e.perfect });
        break;
      case 'WallStrike':
        cues.push({ sound: 'WallStrike', strength: Math.min(1, Math.max(0.25, e.bladeSpeed / FULL_STRENGTH_WALL_SPEED)) });
        break;
      case 'Hit':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: Math.min(1, Math.max(0.2, e.damage / FULL_STRENGTH_DAMAGE)) });
        break;
      case 'KickLanded':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: Math.min(1, Math.max(0.2, e.damage / FULL_STRENGTH_DAMAGE)) });
        break;
      case 'DaggerThrown':
        cues.push({ sound: 'Throw', fighter: e.thrower });
        break;
      case 'DaggerHit':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: Math.min(1, Math.max(0.2, e.damage / FULL_STRENGTH_DAMAGE)) });
        break;
      case 'DaggerBlocked':
        cues.push({ sound: 'Clink', defender: e.defender });
        break;
      case 'DaggerStuck':
        cues.push({ sound: 'Thunk', point: e.point });
        break;
      case 'Land':
        if (e.height >= LAND_QUIET) cues.push({ sound: 'Land', fighter: e.fighter, strength: Math.min(1, Math.max(0.15, e.height / FULL_STRENGTH_DROP)) });
        break;
    }
  }
  return cues;
}
