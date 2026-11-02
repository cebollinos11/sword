/**
 * The swap between a Soldier's impostor and its full model at Promotion and Demotion (docs/plans/big-battle.md, Stage 3):
 * render only, read from the Fighter Pool's bindings frame by frame (so a Rollback that undoes one just swaps back). For
 * `SWAP_SECONDS` after a slot is bound, its full model fades in as its Soldier's impostor fades out (a dithered crossfade,
 * `dither.ts`); after a slot is freed, its model fades out from the pose it last showed as the impostor fades in. Each
 * swap raises a dust puff where the Soldier stands. Otherwise a bound slot is all model and its Soldier no impostor, and
 * an unbound slot nothing.
 */
import type { CrowdState, SimState, SoldierBinding } from '../sim';

/** How long a swap's crossfade lasts (s). */
export const SWAP_SECONDS = 0.35;

/** A swap seen this frame: a Soldier promoted into a slot, or demoted out of it (its Fighter's last place). */
export interface Swap {
  readonly kind: 'Promote' | 'Demote';
  readonly slot: number;
  readonly soldier: number;
  readonly at: { readonly x: number; readonly z: number };
}

interface Fading {
  readonly kind: Swap['kind'];
  readonly soldier: number;
  readonly start: number;
}

export class BubbleSwap {
  /** Each slot's binding as last seen. */
  private bound: (SoldierBinding | undefined)[] = [];
  /** Each slot's swap in progress. */
  private readonly fading = new Map<number, Fading>();
  private clock = 0;
  private lastTick = -1;

  /**
   * Note the bindings of `state` (`seconds` of wall time after the last call): the swaps that began, for their dust puffs.
   * A Tick earlier than the last one seen (a restart) forgets everything.
   */
  update(state: SimState, seconds: number): Swap[] {
    this.clock += Math.max(0, seconds);
    if (state.tick < this.lastTick - 60) {
      this.bound = [];
      this.fading.clear();
    }
    this.lastTick = state.tick;
    for (const [slot, f] of this.fading) if (this.share(f) >= 1) this.fading.delete(slot);
    const swaps: Swap[] = [];
    state.fighters.forEach((f, k) => {
      const was = this.bound[k];
      const now = f.soldier;
      if (was?.index === now?.index && was?.since === now?.since) return;
      if (was) {
        const at = state.crowd ? { x: state.crowd.x[was.index]!, z: state.crowd.z[was.index]! } : f.position;
        swaps.push({ kind: 'Demote', slot: k, soldier: was.index, at });
        this.fading.set(k, { kind: 'Demote', soldier: was.index, start: this.clock });
      }
      if (now) {
        swaps.push({ kind: 'Promote', slot: k, soldier: now.index, at: f.position });
        this.fading.set(k, { kind: 'Promote', soldier: now.index, start: this.clock });
      }
    });
    this.bound = state.fighters.map((f) => f.soldier);
    return swaps;
  }

  private share(f: Fading): number {
    const t = (this.clock - f.start) / SWAP_SECONDS;
    // Summed frame times land a hair short of the end: count that as over.
    return t >= 1 - 1e-9 ? 1 : Math.max(0, t);
  }

  /** How much of slot `k`'s full model shows (0 to 1): fading in after a Promotion, out after a Demotion; else all of a bound slot, none of an unbound one. */
  modelFade(k: number): number {
    const f = this.fading.get(k);
    if (f) return f.kind === 'Promote' ? this.share(f) : 1 - this.share(f);
    return this.bound[k] ? 1 : 0;
  }

  /** Each Soldier's impostor's share (0 to 1) into `out`: none while promoted, all otherwise, crossfading with its slot's model during a swap. */
  impostorFades(crowd: CrowdState, out: Float32Array): Float32Array {
    for (let i = 0; i < crowd.slot.length; i++) out[i] = crowd.slot[i]! >= 0 ? 0 : 1;
    for (const [k, f] of this.fading) out[f.soldier] = 1 - this.modelFade(k);
    return out;
  }
}
