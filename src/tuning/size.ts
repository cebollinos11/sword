/**
 * Size: how tall and how thick a Fighter is, as multipliers on the standard body (1 is the standard). Height stretches the Skeleton's
 * bones, the Weapon and the Fighter's collision height; thickness widens the body, its Hit Zones and its collision radius. Stats (HP,
 * speed, Jump, damage) are untouched. A Fighter's Size is fixed for the Match.
 */
import type { TuningData } from './index';

export interface Size {
  readonly height: number;
  readonly thick: number;
}

export const MIN_SIZE = 0.5;
export const MAX_SIZE = 1.5;
/** Sizes are multiples of this, so they cross the wire and hash exactly. */
export const SIZE_STEP = 0.05;

export const STANDARD_SIZE: Size = { height: 1, thick: 1 };

const snap = (v: number): number => {
  const n = Number.isFinite(v) ? v : 1;
  const stepped = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)) / SIZE_STEP);
  return Math.round(stepped * SIZE_STEP * 100) / 100;
};

/** A Size clamped to the allowed range and snapped to the step. */
export const clampSize = (s: Size): Size => ({ height: snap(s.height), thick: snap(s.thick) });

export const isStandardSize = (s: Size | undefined): boolean => s === undefined || (s.height === 1 && s.thick === 1);

/** The Size to store on a Fighter: clamped, and absent for the standard one (so a standard Fighter's state is unchanged). */
export const storedSize = (s: Size | undefined): Size | undefined => {
  if (s === undefined) return undefined;
  const c = clampSize(s);
  return isStandardSize(c) ? undefined : c;
};

const cache = new WeakMap<TuningData, Map<string, TuningData>>();

/**
 * `tuning` as a Fighter of Size `size` lives in it: the bones, collision, Hit Zones and Weapon scaled, and `tuning.size` set so Motions are
 * scaled to fit. The standard Size gives `tuning` itself. Memoised per Tuning Data and Size.
 */
export function sizedTuning(tuning: TuningData, size: Size | undefined): TuningData {
  if (isStandardSize(size) || tuning.size) return tuning;
  const { height: h, thick: t } = size!;
  let bySize = cache.get(tuning);
  if (!bySize) cache.set(tuning, (bySize = new Map()));
  const key = `${h}x${t}`;
  let sized = bySize.get(key);
  if (!sized) bySize.set(key, (sized = build(tuning, h, t)));
  return sized;
}

function build(tuning: TuningData, h: number, t: number): TuningData {
  const s = tuning.skeleton;
  const f = tuning.fighter;
  const weapons = Object.fromEntries(
    Object.entries(tuning.weapons).map(([name, w]) => [
      name,
      {
        ...w,
        length: w.length * h,
        gripLength: w.gripLength * h,
        head: w.head * h,
        ...(w.offHandGrip && { offHandGrip: { ...w.offHandGrip, along: w.offHandGrip.along * h, radial: w.offHandGrip.radial * h } }),
        sheathe: { ...w.sheathe, offset: { x: w.sheathe.offset.x * t, y: w.sheathe.offset.y * h, z: w.sheathe.offset.z * h } },
      },
    ]),
  );
  const hitZones = Object.fromEntries(Object.entries(tuning.hitZones).map(([zone, z]) => [zone, { ...z, radius: z.radius * t }])) as unknown as TuningData['hitZones'];
  return {
    ...tuning,
    size: { height: h, thick: t, skeleton: s },
    skeleton: {
      pelvisHeight: s.pelvisHeight * h,
      hipWidth: s.hipWidth * t,
      thigh: s.thigh * h,
      shin: s.shin * h,
      ankleHeight: s.ankleHeight * h,
      spine: s.spine * h,
      shoulderWidth: s.shoulderWidth * t,
      neck: s.neck * h,
      headRadius: s.headRadius * h,
      upperArm: s.upperArm * h,
      forearm: s.forearm * h,
    },
    fighter: { ...f, radius: f.radius * t, height: f.height * h, crouchDepth: f.crouchDepth * h, lookHipShift: f.lookHipShift * h },
    weapons,
    hitZones,
  };
}

/** Whether `v` is a valid Size as it crosses the wire: both parts numbers in range and on the step. */
export function isSize(v: unknown): v is Size {
  if (typeof v !== 'object' || v === null) return false;
  const { height, thick } = v as Record<string, unknown>;
  if (typeof height !== 'number' || typeof thick !== 'number') return false;
  const c = clampSize({ height, thick });
  return c.height === height && c.thick === thick;
}
