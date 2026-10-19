/**
 * Which sound each Simulation event triggers. Audio lives outside the
 * Simulation and only listens to its events (ADR 0001); this mapping is
 * pure, so it is tested headlessly.
 *
 * Most sounds come from a Tick's events; a Duel starting and the Match
 * ending come from the Match's own events.
 */
import type { DeathCause, Direction, FighterState, MatchEvent, SimEvent, SimState, Vec3 } from '../sim';
import type { HitZone } from '../tuning';

/** What a floor is made of, for footsteps and landings. */
export type Surface = 'wood' | 'stone' | 'metal' | 'snow';

/** The swing sound: an Attack entered Release. `weight` is 0 (a light sword) to 1 (a polearm), from the Weapon's length. */
export interface SwingCue {
  readonly sound: 'Swing';
  readonly fighter: number;
  readonly direction: Direction;
  readonly weight: number;
}

/** An Attack was Blocked by rule: steel on steel. `strength` is 0..1, from the Blade Speed; `weight` is the attacker's Weapon's. */
export interface BlockCue {
  readonly sound: 'Block';
  readonly defender: number;
  readonly strength: number;
  readonly weight: number;
}

/**
 * Something wounded a Fighter. `strength` is 0..1, from the damage dealt. `by` is what landed: a blade's
 * cutting Head, the shaft behind it, a Kick or a Throwing Dagger.
 */
export interface HitCue {
  readonly sound: 'Hit';
  readonly defender: number;
  readonly zone: HitZone;
  readonly strength: number;
  readonly by: 'Edge' | 'Shaft' | 'Kick' | 'Dagger';
}

/** An Attack was Chambered: a ringing clash, the counter's blade sliding along the other's. */
export interface ChamberCue {
  readonly sound: 'Chamber';
  readonly chamberer: number;
}

/** A Feint: the Wind-up is pulled back, a quick flick of cloth. */
export interface FeintCue {
  readonly sound: 'Feint';
  readonly fighter: number;
}

/** A Kick entered Release: the leg snaps out. */
export interface KickCue {
  readonly sound: 'Kick';
  readonly fighter: number;
}

/** A Kick knocked a Fighter down: a heavy shove, before the body hits the floor (see BodyFallCue). */
export interface KnockdownCue {
  readonly sound: 'Knockdown';
  readonly fighter: number;
}

/** A body hit the floor: flat on its back in a Knockdown, or a fallen Fighter crumpling. */
export interface BodyFallCue {
  readonly sound: 'BodyFall';
  readonly fighter: number;
  readonly surface: Surface;
}

/** A Fighter jumped. */
export interface JumpCue {
  readonly sound: 'Jump';
  readonly fighter: number;
  readonly surface: Surface;
}

/** A foot came down at the end of a step (the Gait). */
export interface StepCue {
  readonly sound: 'Step';
  readonly fighter: number;
  readonly surface: Surface;
}

/** A Fighter landed from a Jump or a fall: a thud. `strength` is 0..1, from the height it dropped. */
export interface LandCue {
  readonly sound: 'Land';
  readonly fighter: number;
  readonly strength: number;
  readonly surface: Surface;
}

/** A Fighter fell (its Death): a deep, final blow, a hiss of Lava or a splash of Water. */
export interface DeathCue {
  readonly sound: 'Death';
  readonly fighter: number;
  readonly cause: DeathCause;
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
  readonly surface: Surface;
}

/** A blade stopped by an Arena Wall: a dull knock with a short ring. `strength` is 0..1, from the Blade Speed. */
export interface WallStrikeCue {
  readonly sound: 'WallStrike';
  readonly strength: number;
  readonly surface: Surface;
}

/** A Duel began: blades drawn and a drum. `duelNumber` is 1-based. */
export interface DuelStartCue {
  readonly sound: 'DuelStart';
  readonly duelNumber: number;
}

/** A Duel ended without ending the Match: a gong. `winner` is a team, or null for a draw. */
export interface DuelEndCue {
  readonly sound: 'DuelEnd';
  readonly winner: number | null;
}

/** The Match is won: a fanfare. */
export interface MatchEndCue {
  readonly sound: 'MatchEnd';
  readonly winner: number;
}

export type SoundCue =
  | SwingCue
  | BlockCue
  | HitCue
  | ChamberCue
  | FeintCue
  | KickCue
  | KnockdownCue
  | BodyFallCue
  | JumpCue
  | StepCue
  | LandCue
  | DeathCue
  | ThrowCue
  | ClinkCue
  | ThunkCue
  | WallStrikeCue
  | DuelStartCue
  | DuelEndCue
  | MatchEndCue;

/** Damage at which a Hit sound plays at full strength (about a head hit with repo Tuning Data). */
const FULL_STRENGTH_DAMAGE = 45;
/** A blade meeting a Wall at this Blade Speed (m/s) or faster knocks at full strength. */
const FULL_STRENGTH_WALL_SPEED = 10;
/** A Block at this Blade Speed (m/s) or faster clangs at full strength. */
const FULL_STRENGTH_BLOCK_SPEED = 12;
/** A Landing from this high (m) thuds at full strength; one from lower than LAND_QUIET makes no sound. */
const FULL_STRENGTH_DROP = 5;
const LAND_QUIET = 0.2;
/** Weapon lengths (m, sword hand to tip) at which a swing is lightest (0) and heaviest (1). */
const LIGHT_LENGTH = 0.9;
const HEAVY_LENGTH = 1.5;

/** The floor of each Arena (by Tuning Data name); any other is stone. */
const ARENA_SURFACE: Readonly<Record<string, Surface>> = {
  library: 'wood',
  ship: 'wood',
  chamber: 'metal',
  train: 'metal',
  summit: 'snow',
};

export function arenaSurface(arena: string | undefined): Surface {
  return (arena !== undefined && ARENA_SURFACE[arena]) || 'stone';
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const hitStrength = (damage: number) => clamp(damage / FULL_STRENGTH_DAMAGE, 0.2, 1);

/** 0 (light) to 1 (heavy), from how long the Fighter's Weapon is this Tick; 0.3 when unknown. */
function weaponWeight(fighter: FighterState | undefined): number {
  if (!fighter) return 0.3;
  const { hilt, tip } = fighter.blade;
  const length = Math.hypot(tip.x - hilt.x, tip.y - hilt.y, tip.z - hilt.z);
  return clamp((length - LIGHT_LENGTH) / (HEAVY_LENGTH - LIGHT_LENGTH), 0, 1);
}

/**
 * The sounds triggered by one Tick, in event order. `now` is the state the Tick produced: it gives
 * the Weapons and the floor (without it, a middling Weapon on stone).
 */
export function soundCues(events: readonly SimEvent[], now?: SimState): SoundCue[] {
  const cues: SoundCue[] = [];
  const surface = arenaSurface(now?.arena);
  const fighter = (i: number) => now?.fighters[i];
  for (const e of events) {
    switch (e.type) {
      case 'AttackPhase':
        if (e.phase === 'Release') cues.push({ sound: 'Swing', fighter: e.fighter, direction: e.direction, weight: weaponWeight(fighter(e.fighter)) });
        break;
      case 'Block':
        cues.push({
          sound: 'Block',
          defender: e.defender,
          strength: clamp(e.bladeSpeed / FULL_STRENGTH_BLOCK_SPEED, 0.3, 1),
          weight: weaponWeight(fighter(e.attacker)),
        });
        break;
      case 'WallStrike':
        cues.push({ sound: 'WallStrike', strength: clamp(e.bladeSpeed / FULL_STRENGTH_WALL_SPEED, 0.25, 1), surface });
        break;
      case 'Hit':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: hitStrength(e.damage), by: e.head ? 'Edge' : 'Shaft' });
        break;
      case 'Chamber':
        cues.push({ sound: 'Chamber', chamberer: e.chamberer });
        break;
      case 'Feint':
        cues.push({ sound: 'Feint', fighter: e.fighter });
        break;
      case 'KickPhase':
        if (e.phase === 'Release') cues.push({ sound: 'Kick', fighter: e.fighter });
        break;
      case 'KnockdownPhase':
        if (e.phase === 'Down') cues.push({ sound: 'BodyFall', fighter: e.fighter, surface });
        break;
      case 'Death':
        cues.push({ sound: 'Death', fighter: e.fighter, cause: e.cause });
        break;
      case 'KickLanded':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: hitStrength(e.damage), by: 'Kick' });
        if (e.outcome === 'Knockdown') cues.push({ sound: 'Knockdown', fighter: e.defender });
        break;
      case 'DaggerThrown':
        cues.push({ sound: 'Throw', fighter: e.thrower });
        break;
      case 'DaggerHit':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: hitStrength(e.damage), by: 'Dagger' });
        break;
      case 'DaggerBlocked':
        cues.push({ sound: 'Clink', defender: e.defender });
        break;
      case 'DaggerStuck':
        cues.push({ sound: 'Thunk', point: e.point, surface });
        break;
      case 'Jump':
        cues.push({ sound: 'Jump', fighter: e.fighter, surface });
        break;
      case 'Step':
        cues.push({ sound: 'Step', fighter: e.fighter, surface });
        break;
      case 'Land':
        if (e.height >= LAND_QUIET) cues.push({ sound: 'Land', fighter: e.fighter, strength: clamp(e.height / FULL_STRENGTH_DROP, 0.15, 1), surface });
        break;
      case 'DuelEnd':
        cues.push({ sound: 'DuelEnd', winner: e.winner });
        break;
    }
  }
  return cues;
}

/** The sounds of a Match's own events in one Match Tick: a Duel starting, the Match won. */
export function matchCues(events: readonly MatchEvent[]): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const e of events) {
    if (e.type === 'DuelStart') cues.push({ sound: 'DuelStart', duelNumber: e.duelNumber });
    else if (e.type === 'MatchEnd') cues.push({ sound: 'MatchEnd', winner: e.winner });
  }
  return cues;
}
