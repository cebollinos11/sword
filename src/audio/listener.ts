import type { MatchState, SimEvent } from '../sim';
import { soundCues, type SoundCue } from './cues';

/** Something that can make a sound for a cue (WebAudio in the browser, a recorder in tests). */
export interface SoundPlayer {
  play(cue: SoundCue): void;
}

/**
 * Listens to the Simulation's events, Tick by Tick, and plays their sounds.
 * Any loop that drives a Simulation (game, Match, Editor sandbox) calls
 * `onTick(tick, state.events)` after each step, or `onMatchTick(match)` for a Match.
 *
 * Each Tick sounds at most once: Ticks at or before the last one played are
 * ignored, so rollback re-simulation does not replay sounds (a corrected
 * re-simulated Tick stays silent; fine for placeholders). Call `seek(tick)`
 * when the loop jumps (scrub, restart, a fresh Duel numbered from 0).
 */
export class SimAudio {
  muted = false;
  private lastTick = -Infinity;

  constructor(private readonly player: SoundPlayer) {}

  onTick(tick: number, events: readonly SimEvent[]): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    if (this.muted) return;
    for (const cue of soundCues(events)) this.player.play(cue);
  }

  /** For a loop driving a Match: the Match Tick keeps counting across Duels, the Duel's own Tick does not. */
  onMatchTick(match: MatchState): void {
    this.onTick(match.tick, match.duel.events);
  }

  /** The loop jumped to `tick`; Ticks after it will sound. */
  seek(tick: number): void {
    this.lastTick = tick;
  }
}
