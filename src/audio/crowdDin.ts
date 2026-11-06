/**
 * The din of a Battle's Crowd: how loud, from which side and how far off its fighting sounds, from where its Soldiers
 * are engaged (`crowdFighting`) and the ears. Each fighting Soldier counts by how loud it is heard (the Crowd's own
 * Hearing, which carries over the whole field), so a big fight far off is a low, muffled roar and a small one close
 * by is loud. Pure, so it is tested headlessly; the WebAudio player plays the bed and the clashes from it.
 */
import type { Vec3 } from '../sim';
import type { CrowdHearing } from '../tuning';
import { placement, type Ears } from './spatial';

export interface Din {
  /** 0 (no fighting heard) … 1: rises with the fighting heard and levels off (`full`). */
  readonly level: number;
  /** -1 left … 1 right: where the fighting is heard from, on balance (a fight all round is centred). */
  readonly pan: number;
  /** The low-pass cutoff (Hz) of the fighting as heard on balance, null for none (all of it close by). */
  readonly cutoff: number | null;
  /** The extra reverb send of the fighting on balance. */
  readonly wet: number;
  /** Running totals of each fighting Soldier's heard level, for picking where a clash comes from (`pickFighting`). */
  readonly totals: readonly number[];
}

export const SILENT_DIN: Din = { level: 0, pan: 0, cutoff: null, wet: 0, totals: [] };

/** The top of hearing: a cutoff of this is none. */
const OPEN = 20000;

export function crowdDin(fighting: readonly Vec3[], ears: Ears | null, hearing: CrowdHearing): Din {
  if (fighting.length === 0) return SILENT_DIN;
  let heard = 0;
  let pan = 0;
  let logCutoff = 0;
  let wet = 0;
  const totals: number[] = [];
  for (const at of fighting) {
    const p = placement(at, ears, hearing, true);
    heard += p.gain;
    pan += p.gain * p.pan;
    logCutoff += p.gain * Math.log(p.cutoff ?? OPEN);
    wet += p.gain * p.wet;
    totals.push(heard);
  }
  if (heard <= 0) return SILENT_DIN;
  const cutoff = Math.exp(logCutoff / heard);
  return {
    level: 1 - Math.exp(-heard / hearing.full),
    pan: pan / heard,
    cutoff: cutoff >= OPEN * 0.999 ? null : cutoff,
    wet: wet / heard,
    totals,
  };
}

/** The fighting Soldier (index into what `crowdDin` was given) a clash comes from, louder ones likelier; `r` is uniform in [0, 1). */
export function pickFighting(din: Din, r: number): number {
  const { totals } = din;
  if (totals.length === 0) return -1;
  const want = r * totals[totals.length - 1]!;
  let lo = 0;
  let hi = totals.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (totals[mid]! > want) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
