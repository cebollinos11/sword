import type { SimState } from './state';

/** An opaque, independent copy of a Simulation state at one Tick. */
export interface Snapshot {
  readonly tick: number;
  /** @internal */
  readonly data: SimState;
}

/** Deep copy of plain Simulation data (state holds only numbers, strings, arrays, objects). */
function deepCopy<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepCopy) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = deepCopy((v as Record<string, unknown>)[k]);
  return out as T;
}

/** Capture the state so it can be restored later (for Rollback, scrubbing, replays). */
export function snapshot(state: SimState): Snapshot {
  return { tick: state.tick, data: deepCopy(state) };
}

/** Recreate a state from a snapshot. The snapshot stays reusable. */
export function restore(snap: Snapshot): SimState {
  return deepCopy(snap.data);
}
