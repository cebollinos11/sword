/**
 * Tempo: a Weapon plays the shared Attack Motions at its own pace, each phase
 * (Wind-up, Release, Recovery) stretched by its own multiplier (ADR 0016).
 *
 * Nothing about the Motion moves: its Pose Keys and markers stay as authored.
 * Instead playback time is warped, piece by piece between the `windUpEnd` and
 * `releaseEnd` markers, so the pose at each marker is the authored one at any
 * Tempo. Played time is what the simulation counts in Ticks; authored time is
 * where the Motion is sampled.
 *
 * Both warps are written so that a multiplier of 1 contributes exactly 0: at
 * the unit Tempo they return their input bit for bit, and every Tick count
 * matches the authored Motion's.
 */
import type { Motion, TuningData, WeaponTempo } from '../tuning';
import { DIRECTIONS } from './intent';

/** The phase boundaries a Tempo stretches between, in authored seconds. */
interface Phases {
  readonly windUpEnd: number;
  readonly releaseEnd: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The Tempo `weapon` plays Motion `name` at: its own for an Attack Motion (named after its Direction), none for any other (or an unknown Weapon, which plays the defaults). */
export function motionTempo(tuning: TuningData, weapon: string, name: string): WeaponTempo | undefined {
  return (DIRECTIONS as readonly string[]).includes(name) ? tuning.weapons[weapon]?.tempo : undefined;
}

function phases(motion: Motion): Phases | undefined {
  const { windUpEnd, releaseEnd } = motion.markers;
  return windUpEnd === undefined || releaseEnd === undefined || motion.loop ? undefined : { windUpEnd, releaseEnd };
}

/** Seconds of play by which `motion`, at `tempo`, reaches authored second `authored`. */
export function playedSeconds(motion: Motion, tempo: WeaponTempo, authored: number): number {
  const p = phases(motion);
  if (!p) return authored;
  return (
    authored +
    (tempo.windUp - 1) * clamp(authored, 0, p.windUpEnd) +
    (tempo.release - 1) * clamp(authored - p.windUpEnd, 0, p.releaseEnd - p.windUpEnd) +
    (tempo.recovery - 1) * Math.max(authored - p.releaseEnd, 0)
  );
}

/** The authored second of `motion` shown `played` seconds into playing it at `tempo` (the inverse of `playedSeconds`). */
export function authoredSeconds(motion: Motion, tempo: WeaponTempo, played: number): number {
  const p = phases(motion);
  if (!p) return played;
  const windUpEnd = playedSeconds(motion, tempo, p.windUpEnd);
  const releaseEnd = playedSeconds(motion, tempo, p.releaseEnd);
  return (
    played -
    (1 - 1 / tempo.windUp) * clamp(played, 0, windUpEnd) -
    (1 - 1 / tempo.release) * clamp(played - windUpEnd, 0, releaseEnd - windUpEnd) -
    (1 - 1 / tempo.recovery) * Math.max(played - releaseEnd, 0)
  );
}
