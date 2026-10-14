/**
 * Content hashing shared by the Simulation (state checksums) and Tuning Data
 * (the peer compatibility hash). Depends on nothing, so neither imports the other.
 */

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

/** FNV-1a 32-bit hash (8 hex chars) of the canonical form of any plain data (a SimState, a Match, Tuning Data, a pose...). */
export function hashValue(value: unknown): string {
  const s = canonical(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
