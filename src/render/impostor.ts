/**
 * How a Soldier is drawn as an impostor (docs/plans/big-battle.md, Stage 2): pure functions, no WebGL. The atlas's
 * layout (which cell holds which clip, frame and direction), which direction cell a camera sees a Soldier from, which
 * clip and frame its state shows, and where it stands between Crowd steps. Everything here is derived from the Crowd's
 * state and the Tick (and, for a Stagger or a fall, from when the renderer saw it happen): the Crowd holds nothing for drawing's sake.
 */
import { TICK_SECONDS, type CrowdState } from '../sim';

/** The clips baked into the atlas, from the generic soldier's own Motions: Idle, walking under the Gait, one swing, a Stagger and its fall. */
export const IMPOSTOR_CLIPS = ['idle', 'walk', 'swing', 'stagger', 'death'] as const;
export type ImpostorClip = (typeof IMPOSTOR_CLIPS)[number];

/** Frames baked per clip, evenly over its length. */
export const CLIP_FRAMES: Readonly<Record<ImpostorClip, number>> = {
  idle: 4,
  walk: 8,
  swing: 10,
  stagger: 6,
  death: 8,
};

/** The directions each frame is baked from, evenly round the Soldier (direction 0 sees its front). */
export const IMPOSTOR_DIRECTIONS = 8;

/** Where each clip's frames sit in the atlas: square cells of `cell` pixels, `columns` across and `rows` up, filled from the bottom-left. */
export interface AtlasLayout {
  /** A cell's side (px). */
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  /** The atlas's size (px). */
  readonly width: number;
  readonly height: number;
  readonly directions: number;
  readonly frames: Readonly<Record<ImpostorClip, number>>;
  /** Each clip's first frame among all the frames (its cells start at `first * directions`). */
  readonly first: Readonly<Record<ImpostorClip, number>>;
}

/**
 * The atlas's layout for `frames` per clip from `directions` directions, in cells of `cell` px: about as many columns as
 * rows (so neither side is long), the cell halved until the atlas fits in `maxSize` px.
 */
export function atlasLayout(cell: number, maxSize: number, frames: Readonly<Record<ImpostorClip, number>> = CLIP_FRAMES, directions = IMPOSTOR_DIRECTIONS): AtlasLayout {
  const first = {} as Record<ImpostorClip, number>;
  let total = 0;
  for (const clip of IMPOSTOR_CLIPS) {
    first[clip] = total;
    total += frames[clip];
  }
  const cells = total * directions;
  const columns = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / columns);
  let side = cell;
  while (side > 1 && Math.max(columns, rows) * side > maxSize) side = Math.floor(side / 2);
  return {
    cell: side,
    columns,
    rows,
    width: columns * side,
    height: rows * side,
    directions,
    frames,
    first,
  };
}

/** The cell holding `clip`'s `frame` seen from `direction`: its column and row (row 0 at the bottom). */
export function atlasCell(layout: AtlasLayout, clip: ImpostorClip, frame: number, direction: number): { readonly column: number; readonly row: number } {
  const index = (layout.first[clip] + frame) * layout.directions + direction;
  return {
    column: index % layout.columns,
    row: Math.floor(index / layout.columns),
  };
}

/** Wrap an angle into [0, 2π). */
const turn = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/**
 * The direction cell a camera sees a Soldier from: its bearing from the Soldier (`viewYaw`, the yaw from the Soldier to
 * the camera, 0 toward +z) relative to the Soldier's `heading`, to the nearest of `directions`. 0 is its front, counting
 * the way yaw turns (from +z toward +x).
 */
export function directionCell(heading: number, viewYaw: number, directions = IMPOSTOR_DIRECTIONS): number {
  const step = (2 * Math.PI) / directions;
  return Math.round(turn(viewYaw - heading) / step) % directions;
}

/** The yaw from (x, z) toward (toX, toZ): 0 toward +z, as a Soldier's heading. */
export const yawTo = (x: number, z: number, toX: number, toZ: number): number => Math.atan2(toX - x, toZ - z);

/** Each baked clip's length (s) when played: a looping clip's one loop, a once-only clip's whole run. */
export type ClipSeconds = Readonly<Record<ImpostorClip, number>>;

/** What a Soldier is doing, as far as drawing it goes: from its state, and from when the renderer saw it struck or fall. */
export interface SoldierLook {
  readonly alive: boolean;
  /** Engaged with an enemy Soldier (it trades blows: the swing, looping). */
  readonly engaged: boolean;
  /** Its speed over its last step (m/s). */
  readonly speed: number;
  /** Seconds since it was last seen struck, or null if never. */
  readonly sinceHit: number | null;
  /** Seconds since it was seen to fall, or null if it was already down when first seen (it shows its last fallen frame). */
  readonly sinceDeath: number | null;
}

/** Below this speed (m/s) a Soldier stands rather than walks: a crowd's push apart is smaller than a step. */
export const WALK_SPEED_MIN = 0.4;

/** A Soldier's own offset (0 to 1) into a looping clip, so a rank never moves in step. The golden ratio spreads neighbours apart. */
const phaseOf = (index: number): number => (index * 0.6180339887) % 1;

/**
 * The clip and frame to draw a Soldier with at `time` (s of Battle time): fallen, its fall (played once, then its last
 * frame held); struck within a Stagger's length, the Stagger; engaged, its swing; walking, the walk; else Idle. Looping
 * clips run on Battle time from the Soldier's own offset.
 */
export function soldierFrame(
  look: SoldierLook,
  time: number,
  index: number,
  seconds: ClipSeconds,
  frames: Readonly<Record<ImpostorClip, number>> = CLIP_FRAMES,
): { readonly clip: ImpostorClip; readonly frame: number } {
  const once = (clip: ImpostorClip, since: number) => ({
    clip,
    frame: Math.min(frames[clip] - 1, Math.max(0, Math.floor((since / seconds[clip]) * frames[clip]))),
  });
  const loop = (clip: ImpostorClip) => {
    const phase = (time / seconds[clip] + phaseOf(index)) % 1;
    return {
      clip,
      frame: Math.min(frames[clip] - 1, Math.floor(phase * frames[clip])),
    };
  };
  if (!look.alive) return look.sinceDeath === null ? { clip: 'death', frame: frames.death - 1 } : once('death', look.sinceDeath);
  if (look.sinceHit !== null && look.sinceHit < seconds.stagger) return once('stagger', look.sinceHit);
  if (look.engaged) return loop('swing');
  if (look.speed >= WALK_SPEED_MIN) return loop('walk');
  return loop('idle');
}

/** The Tick (at or before `tick`) on which Soldier `i` last stepped (`crowdDue`): its place in its army, modulo `stagger`. */
export function lastStepTick(i: number, tick: number, stagger: number, armySize: number): number {
  const k = (i % armySize) % stagger;
  return tick - ((((tick - k) % stagger) + stagger) % stagger);
}

/**
 * Where Soldier `i` is drawn at `at` (Ticks, fractional, from the Crowd of Tick `tick` on): a Soldier moves only on its
 * own steps, so it is drawn one step behind, gliding from where its last step began (its position less its velocity
 * over the step) to where that step ended, over the `stagger` Ticks until its next one. Written into `out` ([x, z]).
 */
export function soldierAt(crowd: CrowdState, i: number, tick: number, at: number, stagger: number, armySize: number, out: [number, number]): [number, number] {
  const u = Math.min(1, Math.max(0, (at - lastStepTick(i, tick, stagger, armySize)) / stagger));
  const back = (1 - u) * stagger * TICK_SECONDS;
  out[0] = crowd.x[i]! - crowd.vx[i]! * back;
  out[1] = crowd.z[i]! - crowd.vz[i]! * back;
  return out;
}
