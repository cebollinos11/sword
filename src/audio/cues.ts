/**
 * Which placeholder sound each Simulation event triggers. Audio lives outside
 * the Simulation and only listens to its events (ADR 0001); this mapping is
 * pure, so it is tested headlessly.
 */
import type { Direction, SimEvent } from '../sim';
import type { HitZone } from '../tuning';

/** The swing sound: an Attack entered Release. */
export interface SwingCue {
  readonly sound: 'Swing';
  readonly fighter: number;
  readonly direction: Direction;
}

/** An Attack was Blocked by rule. */
export interface BlockCue {
  readonly sound: 'Block';
  readonly defender: number;
}

/** A Blade Sweep landed a Hit. `strength` is 0..1, from the damage dealt. */
export interface HitCue {
  readonly sound: 'Hit';
  readonly defender: number;
  readonly zone: HitZone;
  readonly strength: number;
}

export type SoundCue = SwingCue | BlockCue | HitCue;

/** Damage at which a Hit sound plays at full strength (about a head hit with repo Tuning Data). */
const FULL_STRENGTH_DAMAGE = 45;

/** The sounds triggered by one Tick's events, in event order. */
export function soundCues(events: readonly SimEvent[]): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'AttackPhase':
        if (e.phase === 'Release') cues.push({ sound: 'Swing', fighter: e.fighter, direction: e.direction });
        break;
      case 'Block':
        cues.push({ sound: 'Block', defender: e.defender });
        break;
      case 'Hit':
        cues.push({ sound: 'Hit', defender: e.defender, zone: e.zone, strength: Math.min(1, Math.max(0.2, e.damage / FULL_STRENGTH_DAMAGE)) });
        break;
    }
  }
  return cues;
}
