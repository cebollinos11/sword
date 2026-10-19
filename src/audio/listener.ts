import type { MatchState, SimEvent, SimState } from '../sim';
import { matchCues, soundCues, type SoundCue } from './cues';

/** A Duel first heard within this many of its Ticks is heralded as starting. */
const HERALD_TICKS = 30;

/** Something that can make a sound for a cue (WebAudio in the browser, a recorder in tests). */
export interface SoundPlayer {
  play(cue: SoundCue): void;
  /** How fast time runs (1 = real time, below 1 = slow motion): sounds deepen and stretch to match. Optional. */
  setSpeed?(speed: number): void;
}

/**
 * Listens to the Simulation's events, Tick by Tick, and plays their sounds.
 * Any loop that drives a Simulation (game, Match, Editor sandbox) calls
 * `onTick(tick, state.events, state)` after each step, or `onMatchTick(match)` for a Match.
 *
 * Each Tick sounds at most once: Ticks at or before the last one played are
 * ignored, so rollback re-simulation does not replay sounds (a corrected
 * re-simulated Tick stays silent). Call `seek(tick)` when the loop jumps
 * (scrub, restart, a fresh Duel numbered from 0).
 */
export class SimAudio {
  muted = false;
  private lastTick = -Infinity;
  /** The state of the last Tick played, to hear what changed (a Kick snapping out, a Death); null after a jump. */
  private before: SimState | null = null;
  /** The Match and Duel last heard (`matchNumber`, `duelNumber`), to herald a Duel the loop joined at its start. */
  private duel = '';

  constructor(private readonly player: SoundPlayer) {}

  /** Plays one Tick. `state` (the state it produced) lets the sounds follow the Weapons, the floor and what changed. */
  onTick(tick: number, events: readonly SimEvent[], state?: SimState): void {
    if (!this.reach(tick)) return;
    this.play(state ? this.cues(events, state) : soundCues(events));
  }

  /** For a loop driving a Match: the Match Tick keeps counting across Duels, the Duel's own Tick does not. */
  onMatchTick(match: MatchState): void {
    if (!this.reach(match.tick)) return;
    const own = matchCues(match.events);
    // A Duel joined at its start without its DuelStart event (a Match's first Duel, an online Match's first Tick) is heralded all the same.
    const duel = `${match.matchNumber}:${match.duelNumber}`;
    if (duel !== this.duel && match.duel.tick <= HERALD_TICKS && !own.some((c) => c.sound === 'DuelStart')) {
      own.unshift({ sound: 'DuelStart', duelNumber: match.duelNumber });
    }
    this.duel = duel;
    const won = own.filter((c) => c.sound === 'MatchEnd');
    let cues = this.cues(match.duel.events, match.duel);
    // A Match won this Tick plays its fanfare instead of the Duel's gong.
    if (won.length > 0) cues = cues.filter((c) => c.sound !== 'DuelEnd');
    this.play([...own.filter((c) => c.sound !== 'MatchEnd'), ...cues, ...won]);
  }

  /** The loop jumped to `tick`; Ticks after it will sound. */
  seek(tick: number): void {
    this.lastTick = tick;
    this.before = null;
  }

  /** How fast time runs (1 = real time, below 1 = slow motion, e.g. the Final Blow Shot). */
  setSpeed(speed: number): void {
    this.player.setSpeed?.(speed);
  }

  /** Whether `tick` is new (not yet played); if so it becomes the last one played. */
  private reach(tick: number): boolean {
    if (tick <= this.lastTick) return false;
    this.lastTick = tick;
    return true;
  }

  private cues(events: readonly SimEvent[], state: SimState): SoundCue[] {
    // Only the very next Tick of the same Duel can be compared (a fresh Duel restarts its Ticks).
    const before = this.before && this.before.tick + 1 === state.tick ? this.before : null;
    this.before = state;
    return soundCues(events, state, before);
  }

  private play(cues: readonly SoundCue[]): void {
    if (this.muted) return;
    for (const cue of cues) this.player.play(cue);
  }
}
