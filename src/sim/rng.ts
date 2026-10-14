/**
 * Seeded random generator held in Simulation state (ADR 0001).
 * mulberry32: the whole generator state is one uint32, so it snapshots
 * and hashes trivially. Never use Math.random inside the Simulation.
 */
export interface RngState {
  readonly seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** Returns a float in [0, 1) and the advanced generator state. */
export function nextFloat(rng: RngState): [value: number, next: RngState] {
  const s = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { seed: s }];
}
