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
import { secondsToTicks } from './constants';
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

/**
 * How many Ticks later a Fighter's `windUp` Mod (`tempo.fighterWindUp`) ends the Wind-up of `motion` played at `tempo`: its Wind-up's Ticks
 * (`w`, at the Weapon's own Tempo) times the Mod less one, rounded, so the Wind-up lasts `w + shift` whole Ticks (at least one). The Release
 * and Recovery are not stretched: they play Tick for Tick as without the Mod, `shift` Ticks later, so the blade's speed, its Hits and the
 * Recovery's length are unchanged. 0 without the Mod (or for a Motion without phases, or one that loops).
 */
export function windUpShift(motion: Motion, tempo: WeaponTempo): number {
  const p = phases(motion);
  if (tempo.fighterWindUp === undefined || !p) return 0;
  const w = secondsToTicks(playedSeconds(motion, tempo, p.windUpEnd));
  return Math.max(1 - w, Math.round(w * (tempo.fighterWindUp - 1)));
}

/**
 * The playback Tick `motion` would be at without its Fighter's `windUp` Mod (`windUpShift`), `tick` Ticks in with it: within the stretched
 * Wind-up, its share of the Wind-up's own Ticks (a fraction of a Tick); after it, `shift` Ticks fewer. `tick` itself without the Mod.
 */
export function unshiftedTick(motion: Motion, tempo: WeaponTempo, tick: number): number {
  const shift = windUpShift(motion, tempo);
  if (shift === 0) return tick;
  const w = secondsToTicks(playedSeconds(motion, tempo, phases(motion)!.windUpEnd));
  return tick <= w + shift ? (tick * w) / (w + shift) : tick - shift;
}

/** Each Tuning Data's Wind-up-stretched copies, by the factor (a cache: a miss just builds the same copy again). */
const stretched = new WeakMap<TuningData, Map<number, TuningData>>();

/**
 * `tuning` with every Weapon's Attack Wind-up `windUp` times as long, in whole Ticks (`tempo.fighterWindUp`, `windUpShift`), its Release and
 * Recovery as they are (a Fighter's `windUp` Mod, the Slow Quirk's: docs/plans/enemy-behaviours.md, Stage 5). Only an Attack Motion plays at a
 * Tempo (`motionTempo`), so a Feint, a Chamber, a Throw, a Kick or a Whirlwind is untouched. At 1, `tuning` itself, so a Fighter without the
 * Mod plays bit for bit as before. The copy is made once per Tuning Data and factor, and shares every other part.
 */
export function windUpTuning(tuning: TuningData, windUp: number): TuningData {
  if (windUp === 1) return tuning;
  let byFactor = stretched.get(tuning);
  if (!byFactor) stretched.set(tuning, (byFactor = new Map()));
  let out = byFactor.get(windUp);
  if (!out) {
    const weapons = Object.fromEntries(Object.entries(tuning.weapons).map(([name, w]) => [name, { ...w, tempo: { ...w.tempo, fighterWindUp: (w.tempo.fighterWindUp ?? 1) * windUp } }]));
    byFactor.set(windUp, (out = { ...tuning, weapons }));
  }
  return out;
}
