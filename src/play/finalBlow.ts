import { IDLE_INTENT, TICK_RATE, type Intent, type MatchState, type SimState } from '../sim';
import type { CameraTuning } from '../tuning';
import type { CameraTarget } from '../render/thirdPersonCamera';

/** A killer standing further than this (m) from its victim is left out of the framing. */
const FRAME_BOTH_WITHIN = 4;

/** A Hall's Final Blow Shot is cut this long (s) before the party could take a Door, so the Player sees the Door's count and can step out. */
const DOOR_WARNING_SECONDS = 0.5;

/** The Ticks a party must have gathered at a Door (`doorTicksNeeded`) for a playing Hall shot to be cut: `DOOR_WARNING_SECONDS` short of taking it. */
export function doorCutTicks(doorTicksNeeded: number): number {
  return Math.max(1, doorTicksNeeded - Math.round(DOOR_WARNING_SECONDS * TICK_RATE));
}

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
  /** What ended: a Hall's clear holds the Player (see `holdsInput`). */
  readonly what: Ending['what'];
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

/** What ended a Duel's fight: the Duel Tick of the blow, and the Team the fallen Fighter was on (null: either, a draw). */
interface Ending {
  /** What ended: the Duel over, or (in a Run, the Duel going on) the Hall cleared. Each plays its own shot. */
  readonly what: 'Over' | 'Cleared';
  readonly tick: number;
  readonly team: number | null;
}

/**
 * What the Match state shows ended, or null: the Duel over, or a Run's Hall cleared by felling its Encounter (its Duel
 * goes on, the party walking to a Door), the last enemy to fall framed. A Hall with no Encounter (Treasure, Rest) has none.
 */
function ending(match: MatchState): Ending | null {
  const duel = match.duel.duel;
  if (duel.status === 'Over') return { what: 'Over', tick: duel.tick, team: duel.winner === null ? null : 1 - duel.winner };
  if (!match.run || match.run.phase === 'Fighting') return null;
  const deaths = match.duel.fighters.flatMap((f) => (f.team === 1 && f.death ? [f.death.tick] : []));
  return deaths.length > 0 ? { what: 'Cleared', tick: Math.max(...deaths), team: 1 } : null;
}

/**
 * The Final Blow Shot: when the last Fighter of a Team falls (in a Run, the last enemy of a Hall), the view cuts to
 * a camera orbiting the fallen Fighter, a moment before the blow, and plays the
 * blow and the fall at `finalBlowSpeed` while the camera spins slowly. Render
 * only: it replays Match states the game loop recorded, while the Match runs on
 * (into the pause between Duels, `match.interDuelSeconds`), and never feeds back.
 *
 * In a Run the Hall goes on behind a Hall's shot, so the Player is held (`holdsInput`, `shotIntent`): the Local
 * Controller's Intent is replaced by `IDLE_INTENT` for as long as the shot plays, so nothing is walked into, taken or
 * left unseen. The Simulation is unchanged (the Controller decides what it sends). The shot is also cut short of a Door
 * being taken (`doorCutTicks`), for a Player already standing in one when the Hall cleared. The Ticks of the Hall the
 * replay never reached are handed out when it ends (`takeRest`), so their sounds are late, not lost.
 * A Duel's end outside a Run holds nothing and leaves nothing: the Duel is over.
 *
 * The game loop `record`s every Match state it shows; while `active`, it draws
 * the `frame` the shot returns instead of the live Match, and the shot ends on
 * its own (or when the live Match moves on to another Duel).
 */
export class FinalBlowShot {
  /** Recent Match states of the current Duel, by Match Tick. */
  private readonly history = new Map<number, MatchState>();
  private duelKey = '';
  /** The endings (by Duel key and what ended) whose shot has started, so each plays once: a Hall's clear and a later wipe in it are two. */
  private shot = '';
  private playing: Playing | null = null;
  private last: ShotFrame | null = null;
  /** The Hall's Ticks after the last the replay reached, once a Hall's shot has ended (`takeRest`). */
  private rest: MatchState[] = [];
  /** A Hall's shot has ended and its Ticks are not taken yet: `record` goes on adding the Hall's new Ticks to `rest`. */
  private collecting = false;

  constructor(private readonly setup: CameraTuning) {}

  get active(): boolean {
    return this.playing !== null;
  }

  /** Whether the Player's Intents are held (a Hall's shot is playing): send `shotIntent`, not the Local Controller's own. */
  get holdsInput(): boolean {
    return this.playing?.what === 'Cleared';
  }

  /** The Match Tick the playing shot started on (its events already sounded live); null if none is playing. */
  get startTick(): number | null {
    return this.playing?.start ?? null;
  }

  /**
   * Record the Match state of a new Tick. If it is the first to show its Duel over (or a Run's Hall cleared),
   * the shot starts, framed from the side of the line from killer to victim nearest `viewYaw`.
   * A Hall's shot is cut once the party has gathered `doorCutTicks(doorTicksNeeded)` at a Door.
   * Returns whether a shot is playing.
   */
  record(match: MatchState, viewYaw: number, doorTicksNeeded = Infinity): boolean {
    const key = `${match.matchNumber}:${match.duelNumber}`;
    if (key !== this.duelKey) {
      this.duelKey = key;
      this.history.clear();
      this.playing = null;
      this.collecting = false;
    }
    this.history.set(match.tick, match);
    // The loop runs on after a cut inside `record` until its next `frame` sees the shot over: those Ticks are due as well (once each, if a Rollback re-runs one).
    // (Their impacts and shake are not replayed, only their sounds.)
    if (this.collecting) this.rest = [...this.rest.filter((m) => m.tick < match.tick), match];
    const end = ending(match);
    // A Rollback undid the Duel's end (or the Hall's clear): so does the shot.
    if (!end && this.playing) {
      this.playing = null;
      this.collecting = false;
      this.rest = [];
      this.shot = '';
    }
    if (end && this.shot !== `${key}:${end.what}`) {
      this.shot = `${key}:${end.what}`;
      this.begin(match, end, viewYaw);
    }
    if (this.holdsInput && match.run && Math.max(0, ...match.run.doorTicks) >= doorCutTicks(doorTicksNeeded)) this.finish();
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
      this.finish();
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

  /**
   * The Hall's Ticks after the last the replay reached, up to the newest recorded, oldest first, once a Hall's shot has ended;
   * empty otherwise (and after it was taken). Their events are due: the Hall ran on behind the shot.
   */
  takeRest(): MatchState[] {
    const rest = this.rest;
    this.rest = [];
    this.collecting = false;
    return rest;
  }

  /** Stop any shot (e.g. the Match was left). */
  stop(): void {
    this.playing = null;
    this.rest = [];
    this.collecting = false;
    this.history.clear();
    this.duelKey = '';
    this.shot = '';
  }

  private begin(match: MatchState, end: Ending, viewYaw: number): void {
    const overDuelTick = end.tick;
    const over = match.tick - (match.duel.tick - overDuelTick);
    const recorded = Math.min(...this.history.keys());
    const start = Math.max(recorded, over - Math.round(this.setup.finalBlowLead * TICK_RATE));
    const last = over + Math.round(this.setup.finalBlowTail * TICK_RATE);
    const at = this.history.get(over) ?? match;
    const fallen = at.duel.fighters.filter((f) => f.death && (end.team === null || f.team === end.team));
    const victim = fallen.find((f) => f.death?.tick === overDuelTick) ?? fallen[0];
    if (!victim) return;
    const v = { x: victim.position.x, z: victim.position.z };
    const from = victim.death?.blow?.from;
    const both = from && Math.hypot(from.x - v.x, from.z - v.z) < FRAME_BOTH_WITHIN;
    const centre = both ? { x: (v.x + from.x) / 2, y: victim.y, z: (v.z + from.z) / 2 } : { x: v.x, y: victim.y, z: v.z };
    // Look across the line from killer to victim (or along the victim's facing if there is no killer), from its nearer side.
    const line = both ? Math.atan2(v.x - from.x, v.z - from.z) : victim.facing;
    const sides = [line + Math.PI / 2, line - Math.PI / 2];
    const yaw = sides.reduce((a, b) => (angleBetween(b, viewYaw) < angleBetween(a, viewYaw) ? b : a));
    this.playing = { what: end.what, start, end: last, tick: start, reached: start, centre, yaw, seconds: 0 };
    this.last = null;
  }

  /** End the playing shot; a Hall's keeps the Ticks its replay did not reach (`takeRest`). */
  private finish(): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.rest = [];
    if (p.what !== 'Cleared') return;
    this.collecting = true;
    const newest = Math.max(...this.history.keys());
    for (let tick = p.reached + 1; tick <= newest; tick++) {
      const m = this.history.get(tick);
      if (m) this.rest.push(m);
    }
  }

  /** Keep only what a shot could still need: the lead before the newest Tick, or everything since the playing shot's start. */
  private prune(): void {
    const newest = Math.max(...this.history.keys());
    const keepFrom = this.playing ? Math.floor(this.playing.tick) : newest - Math.round(this.setup.finalBlowLead * TICK_RATE) - 1;
    for (const tick of this.history.keys()) if (tick < keepFrom) this.history.delete(tick);
  }
}

/**
 * The Intent to send the Simulation for the local Player this Tick: its own, or `IDLE_INTENT` while a Hall's shot holds
 * it. Still render-side: only what the Controller sends changes. Sample the Local Controller either way, so a press during the shot is spent, not stored for after.
 */
export function shotIntent(shot: Pick<FinalBlowShot, 'holdsInput'>, intent: Intent): Intent {
  return shot.holdsInput ? IDLE_INTENT : intent;
}

/** The angle between two yaws, radians in [0, π]. */
function angleBetween(a: number, b: number): number {
  return Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
}
