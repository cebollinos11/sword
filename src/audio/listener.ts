import type { CrowdState, MatchState, SimEvent, SimState, Vec3 } from '../sim';
import type { TuningData } from '../tuning';
import { crowdCues, crowdFighting, matchCues, soundCues, type SoundCue } from './cues';
import type { Ears } from './spatial';

/** Something that can make a sound for a cue (WebAudio in the browser, a recorder in tests). */
export interface SoundPlayer {
  play(cue: SoundCue): void;
  /** How fast time runs (1 = real time, below 1 = slow motion): sounds deepen and stretch to match. Optional. */
  setSpeed?(speed: number): void;
  /** Where the Player hears from, for sounds placed in the world (null: every sound as if at the ears). Optional. */
  setEars?(ears: Ears | null): void;
  /** Where a Battle's Crowd is fighting this Tick (`crowdFighting`), for its din; empty outside a Battle. Optional. */
  setCrowd?(fighting: readonly Vec3[]): void;
}

/**
 * Listens to the Simulation's events, Tick by Tick, and plays their sounds.
 * Any loop that drives a Simulation (game, Match, Editor sandbox) calls
 * `onTick(tick, state.events, state)` after each step, or `onMatchTick(match)` for a Match
 * (including its first state, whose events start the first Duel).
 *
 * Each Tick sounds at most once: Ticks at or before the last one played are
 * ignored, so rollback re-simulation does not replay sounds (a corrected
 * re-simulated Tick stays silent). Call `seek(tick)` when the loop jumps
 * (scrub, restart, a fresh Duel numbered from 0).
 */
export class SimAudio {
  muted = false;
  private lastTick = -Infinity;
  /** The Crowd as of the last Tick played, to hear its blows and falls against (undefined after a seek, or outside a Battle). */
  private lastCrowd: CrowdState | undefined;

  /**
   * `tuning`: the Tuning Data the Simulation runs on, so the sounds tell the Weapons apart by their look (a flail's whirl and blows);
   * without it every Weapon sounds as a plain blade. A loop whose Tuning Data changes (the Editor) passes its own to `onTick`.
   */
  constructor(
    private readonly player: SoundPlayer,
    private readonly tuning?: TuningData,
  ) {}

  /** Plays one Tick. `state` (the state it produced) lets the sounds follow the Weapons and the floor; `tuning` overrides the constructor's. */
  onTick(tick: number, events: readonly SimEvent[], state?: SimState, tuning: TuningData | undefined = this.tuning): void {
    if (!this.reach(tick)) return;
    this.play(soundCues(events, state, tuning));
  }

  /** For a loop driving a Match: the Match Tick keeps counting across Duels, the Duel's own Tick does not. */
  onMatchTick(match: MatchState): void {
    if (!this.reach(match.tick)) return;
    const own = matchCues(match.events);
    const won = own.filter((c) => c.sound === 'MatchEnd');
    let cues = soundCues(match.duel.events, match.duel, this.tuning);
    // A Match won this Tick plays its fanfare instead of the Duel's gong.
    if (won.length > 0) cues = cues.filter((c) => c.sound !== 'DuelEnd');
    this.play([...own.filter((c) => c.sound !== 'MatchEnd'), ...cues, ...won]);
    this.hearCrowd(match.duel.crowd);
  }

  /** A Battle's Crowd this Tick: its blows and falls since the last Tick played, and where it fights now. */
  private hearCrowd(crowd: CrowdState | undefined): void {
    if (!crowd && !this.lastCrowd) return;
    this.play(crowdCues(this.lastCrowd, crowd));
    this.player.setCrowd?.(this.muted ? [] : crowdFighting(crowd));
    this.lastCrowd = crowd;
  }

  /** Plays a sound that comes from outside the Simulation's events (e.g. a Renderer-only effect), unless muted. */
  playCue(cue: SoundCue): void {
    this.play([cue]);
  }

  /** The loop jumped to `tick`; Ticks after it will sound. */
  seek(tick: number): void {
    this.lastTick = tick;
    this.lastCrowd = undefined;
  }

  /** How fast time runs (1 = real time, below 1 = slow motion, e.g. the Final Blow Shot). */
  setSpeed(speed: number): void {
    this.player.setSpeed?.(speed);
  }

  /** Where the Player hears from: the loop sets it each frame (the Fighter's position, the camera's right); null hears every sound as if at the ears. */
  setEars(ears: Ears | null): void {
    this.player.setEars?.(ears);
  }

  /** Whether `tick` is new (not yet played); if so it becomes the last one played. */
  private reach(tick: number): boolean {
    if (tick <= this.lastTick) return false;
    this.lastTick = tick;
    return true;
  }

  private play(cues: readonly SoundCue[]): void {
    if (this.muted) return;
    for (const cue of cues) this.player.play(cue);
  }
}
