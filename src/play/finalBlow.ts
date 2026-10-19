import { TICK_RATE, type MatchState, type SimState } from '../sim';
import type { CameraTuning } from '../tuning';
import type { CameraTarget } from '../render/thirdPersonCamera';

/** A killer standing further than this (m) from its victim is left out of the framing. */
const FRAME_BOTH_WITHIN = 4;

/** What the Final Blow Shot draws this frame: two recorded Duel states to interpolate between, and where the camera orbits. */
export interface ShotFrame {
  readonly from: SimState;
  readonly to: SimState;
  readonly alpha: number;
  /** The recorded Match states the shot reached since the last frame, oldest first: their events sound and burst now. */
  readonly reached: readonly MatchState[];
  /** The point the camera orbits, and the yaw it looks along (0 = +z). */
  readonly centre: CameraTarget;
  readonly yaw: number;
}

interface Playing {
  /** The Match Tick the shot starts on, and the one it ends on. */
  readonly start: number;
  readonly end: number;
  /** The Match Tick drawn, fractional. */
  tick: number;
  /** The last whole Match Tick whose events were handed out. */
  reached: number;
  readonly centre: CameraTarget;
  /** Yaw when the shot began; it spins on from there. */
  readonly yaw: number;
  /** Wall seconds since the shot began. */
  seconds: number;
}

/**
 * The Final Blow Shot: when the last Fighter of a Team falls, the view cuts to
 * a camera orbiting the fallen Fighter, a moment before the blow, and plays the
 * blow and the fall at `finalBlowSpeed` while the camera spins slowly. Render
 * only: it replays Match states the game loop recorded, while the Match runs on
 * (into the pause between Duels, `match.interDuelSeconds`), and never feeds back.
 *
 * The game loop `record`s every Match state it shows; while `active`, it draws
 * the `frame` the shot returns instead of the live Match, and the shot ends on
 * its own (or when the live Match moves on to another Duel).
 */
export class FinalBlowShot {
  /** Recent Match states of the current Duel, by Match Tick. */
  private readonly history = new Map<number, MatchState>();
  private duelKey = '';
  /** The Duels (by key) whose shot has started, so each plays once. */
  private shot = '';
  private playing: Playing | null = null;
  private last: ShotFrame | null = null;

  constructor(private readonly setup: CameraTuning) {}

  get active(): boolean {
    return this.playing !== null;
  }

  /** The Match Tick the playing shot started on (its events already sounded live); null if none is playing. */
  get startTick(): number | null {
    return this.playing?.start ?? null;
  }

  /**
   * Record the Match state of a new Tick. If it is the first to show its Duel over,
   * the shot starts, framed from the side of the line from killer to victim nearest `viewYaw`.
   * Returns whether a shot is playing.
   */
  record(match: MatchState, viewYaw: number): boolean {
    const key = `${match.matchNumber}:${match.duelNumber}`;
    if (key !== this.duelKey) {
      this.duelKey = key;
      this.history.clear();
      this.playing = null;
    }
    this.history.set(match.tick, match);
    const duel = match.duel.duel;
    // A Rollback undid the Duel's end: so does the shot.
    if (duel.status === 'Fighting' && this.playing) {
      this.playing = null;
      this.shot = '';
    }
    if (duel.status === 'Over' && this.shot !== key) {
      this.shot = key;
      this.begin(match, duel.tick, viewYaw);
    }
    this.prune();
    return this.active;
  }

  /** Advance the shot by `seconds` of wall time; null once it has ended (or if none is playing). */
  frame(seconds: number): ShotFrame | null {
    const p = this.playing;
    if (!p) return null;
    p.seconds += seconds;
    // Never past the newest Tick recorded (the live Match runs ahead of the shot, but only just at its start).
    const newest = Math.max(...this.history.keys());
    p.tick = Math.min(p.tick + seconds * this.setup.finalBlowSpeed * TICK_RATE, newest);
    if (p.tick >= p.end) {
      this.playing = null;
      return null;
    }
    const i = Math.floor(p.tick);
    const from = this.history.get(i);
    // A Tick a Rollback skipped: hold the last frame drawn.
    if (!from) return this.last;
    const to = this.history.get(i + 1) ?? from;
    const reached: MatchState[] = [];
    for (; p.reached < i; p.reached++) {
      const m = this.history.get(p.reached + 1);
      if (m) reached.push(m);
    }
    this.last = {
      from: from.duel,
      to: to.duel,
      alpha: p.tick - i,
      reached,
      centre: p.centre,
      yaw: p.yaw + p.seconds * this.setup.finalBlowSpin,
    };
    return this.last;
  }

  /** Stop any shot (e.g. the Match was left). */
  stop(): void {
    this.playing = null;
    this.history.clear();
    this.duelKey = '';
    this.shot = '';
  }

  private begin(match: MatchState, overDuelTick: number, viewYaw: number): void {
    const over = match.tick - (match.duel.tick - overDuelTick);
    const recorded = Math.min(...this.history.keys());
    const start = Math.max(recorded, over - Math.round(this.setup.finalBlowLead * TICK_RATE));
    const end = over + Math.round(this.setup.finalBlowTail * TICK_RATE);
    const at = this.history.get(over) ?? match;
    const victim = at.duel.fighters.find((f) => f.death?.tick === overDuelTick) ?? at.duel.fighters.find((f) => f.death);
    if (!victim) return;
    const v = { x: victim.position.x, z: victim.position.z };
    const from = victim.death?.blow?.from;
    const both = from && Math.hypot(from.x - v.x, from.z - v.z) < FRAME_BOTH_WITHIN;
    const centre = both ? { x: (v.x + from.x) / 2, y: victim.y, z: (v.z + from.z) / 2 } : { x: v.x, y: victim.y, z: v.z };
    // Look across the line from killer to victim (or along the victim's facing if there is no killer), from its nearer side.
    const line = both ? Math.atan2(v.x - from.x, v.z - from.z) : victim.facing;
    const sides = [line + Math.PI / 2, line - Math.PI / 2];
    const yaw = sides.reduce((a, b) => (angleBetween(b, viewYaw) < angleBetween(a, viewYaw) ? b : a));
    this.playing = { start, end, tick: start, reached: start, centre, yaw, seconds: 0 };
    this.last = null;
  }

  /** Keep only what a shot could still need: the lead before the newest Tick, or everything since the playing shot's start. */
  private prune(): void {
    const newest = Math.max(...this.history.keys());
    const keepFrom = this.playing ? Math.floor(this.playing.tick) : newest - Math.round(this.setup.finalBlowLead * TICK_RATE) - 1;
    for (const tick of this.history.keys()) if (tick < keepFrom) this.history.delete(tick);
  }
}

/** The angle between two yaws, radians in [0, π]. */
function angleBetween(a: number, b: number): number {
  return Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
}
