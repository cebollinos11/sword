import type { SimState } from './state';

/**
 * A Simulation state at one Tick, kept so it can be restored later (for Rollback, scrubbing, replays).
 *
 * States are immutable: a step never changes the state it is given, only builds the next one (sharing whatever did not change).
 * So a snapshot keeps the state itself rather than a copy, and restoring hands that same state back. Copying the whole state
 * on every Tick was about a third of an online Battle's CPU, a Rollback's re-simulated Ticks included. Works for any plain-data
 * state with a `tick`: a Duel's SimState (default) or a whole MatchState.
 *
 * In development and in the tests every snapshotted state is frozen, so code that changes a state it was given (the sim, an AI,
 * the session, the renderer) throws where it does it instead of quietly rewriting a snapshot and desyncing a Match later.
 * Code that steps its own state in place takes a real copy with `deepCopy`.
 */
export interface Snapshot<T extends { readonly tick: number } = SimState> {
  readonly tick: number;
  /** @internal */
  readonly data: T;
}

/** Deep copy of plain Simulation data (numbers, strings, arrays, objects), for state that is changed in place. */
export function deepCopy<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepCopy) as T;
  // A spread first, so the copy has the original's shape: built a key at a time, an object of many keys (a Battle's Crowd) turns into a
  // slow dictionary, and every Tick that reads it pays.
  const out = { ...(v as Record<string, unknown>) };
  for (const k of Object.keys(out)) out[k] = deepCopy(out[k]);
  return out as T;
}

/** Freeze every object and array reachable from `v`. What is frozen already was frozen with all it holds, so only new parts are walked. */
function deepFreeze(v: unknown): void {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v) || ArrayBuffer.isView(v)) return;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
}

/**
 * Whether snapshots freeze their state: in the dev server and the tests, never in a production build. `VITE_SNAPSHOT_FREEZE=0` turns it
 * off there too, to measure what a production build costs (`src/net/cpuProbe.slow.test.ts`).
 */
const FREEZE = import.meta.env.DEV && import.meta.env.VITE_SNAPSHOT_FREEZE !== '0';

/** Keep the state so it can be restored later. It must not be changed after this (in development, it cannot be). */
export function snapshot<T extends { readonly tick: number } = SimState>(state: T): Snapshot<T> {
  if (FREEZE) deepFreeze(state);
  return { tick: state.tick, data: state };
}

/** The state a snapshot kept. The snapshot stays reusable: steps build new states and never change this one. */
export function restore<T extends { readonly tick: number } = SimState>(snap: Snapshot<T>): T {
  return snap.data;
}
