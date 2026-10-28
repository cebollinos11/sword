import type { RunStart } from './sim';

/** The URL's query parameters: the search's, then those after the route (`#/editor/sandbox?dev=1`), which win. */
function query(search: string, hash: string): URLSearchParams {
  const params = new URLSearchParams(search);
  if (hash.includes('?')) for (const [k, v] of new URLSearchParams(hash.slice(hash.indexOf('?')))) params.set(k, v);
  return params;
}

/**
 * Developer options (the Editor link, the collider view, the Arena Lab, a deeper Run start) are only offered with `dev=1`
 * in the URL's query, before the route (`?dev=1#/...`) or after it (`#/editor/sandbox?dev=1`).
 */
export function devMode(search: string = location.search, hash: string = location.hash): boolean {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  return new URLSearchParams(search).get('dev') === '1' || new URLSearchParams(query).get('dev') === '1';
}

/** A query parameter that is a positive integer, else null. */
function count(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

/**
 * Dev mode only (docs/plans/dungeon.md: starting deeper in is for tuning, never a way to skip a Run): a Run starts at
 * `floor=F&row=R`, both counted from 1 (row 5 the Boss, default 1 the entrance), in the Hall the lowest-index exits lead
 * to, or Hall `hall=H` of the row (from 1). The Match options to add to a Gauntlet's (`MatchOptions.start`): none
 * without `dev=1` or a `floor`, so outside dev mode the option is ignored.
 */
export function devRunStart(search: string = location.search, hash: string = location.hash): { start?: RunStart } {
  if (!devMode(search, hash)) return {};
  const params = query(search, hash);
  const floor = count(params, 'floor');
  if (floor === null) return {};
  const row = (count(params, 'row') ?? 1) - 1;
  const hall = count(params, 'hall');
  return { start: { floor, row, ...(hall === null ? {} : { index: hall - 1 }) } };
}

/**
 * Dev mode only: `autopilot=D1,D2,...` puts the local Player's Fighter in a Skirmish Run on an AI that takes Door Dr
 * (from 1) out of each cleared Hall of row r (the list's last for later rows), src/controllers/autopilot.ts. For checking
 * a Run in a browser that cannot be played by hand (headless). Returns the exits (from 0), or null.
 */
export function devAutopilot(search: string = location.search, hash: string = location.hash): number[] | null {
  if (!devMode(search, hash)) return null;
  const raw = query(search, hash).get('autopilot');
  if (raw === null || !/^[1-9]\d*(,[1-9]\d*)*$/.test(raw)) return null;
  return raw.split(',').map((d) => Number(d) - 1);
}
