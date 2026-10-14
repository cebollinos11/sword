import type { SimState } from './state';

/** Canonical serialisation: object keys sorted, numbers bit-exact via their shortest round-trip form. */
function canonical(value: unknown): string {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '-0';
    return Number.isFinite(value) ? String(value) : `"${String(value)}"`;
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

/**
 * Hash of the full Simulation state (FNV-1a 32-bit over the canonical form),
 * as 8 hex chars. Used for determinism checks and peer checksums.
 */
export function hashState(state: SimState): string {
  const s = canonical(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
