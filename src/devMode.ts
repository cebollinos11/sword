import type { RunStart } from './sim';

/** The URL's query parameters: the search's, then those after the route (`#/editor/sandbox?dev=1`), which win. */
function query(search: string, hash: string): URLSearchParams {
  const params = new URLSearchParams(search);
  if (hash.includes('?')) for (const [k, v] of new URLSearchParams(hash.slice(hash.indexOf('?')))) params.set(k, v);
  return params;
}

/**
 * Developer options (the Editor link, the collider view, the Arena Lab, a deeper Run start) are only offered with `dev=1`
 * in the URL's query, before the route (`?dev=1#/...`) or after it (`#/editor/sandbox?dev=1`; there it wins, as `query` reads it).
 */
export function devMode(search: string = location.search, hash: string = location.hash): boolean {
  return query(search, hash).get('dev') === '1';
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
 * Dev mode only: `relics=a,b,c` (names as in `data/relics.json`, with or without `floor`/`row`) starts every Player's Fighter with those
 * Relics, equipped in order and the rest carried (`MatchOptions.relics`). The option to add to a Run's: none without `dev=1`
 * or a `relics`. The sim throws on an unknown name.
 */
export function devRunRelics(search: string = location.search, hash: string = location.hash): { relics?: string[] } {
  if (!devMode(search, hash)) return {};
  const raw = query(search, hash).get('relics');
  return raw === null || raw === '' ? {} : { relics: raw.split(',').map((n) => n.trim()) };
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

/**
 * Dev mode only, with `autopilot`: `loot=1` makes the autopilot walk onto the loot lying in a cleared Hall (its drops, a Treasure Hall's first
 * pedestal, a beaten Elite's Relic) and equip what it takes, `loot=drop` also drops one item once and takes it up again, so the dev check
 * shows every part of the loot. Returns the mode, or null (the autopilot leaves loot lying).
 */
export function devAutopilotLoot(search: string = location.search, hash: string = location.hash): 'take' | 'drop' | null {
  if (!devMode(search, hash)) return null;
  const raw = query(search, hash).get('loot');
  return raw === '1' ? 'take' : raw === 'drop' ? 'drop' : null;
}

/**
 * Dev mode only: a Battle's Player on a Battle autopilot (`?dev=1&battlePilot=Hard`, any AI difficulty), the local Intents
 * ignored, to play Battles through in a browser that is not drawing at speed. Null otherwise.
 */
export function devBattlePilot(search: string = location.search, hash: string = location.hash): string | null {
  if (!devMode(search, hash)) return null;
  return query(search, hash).get('battlePilot') || null;
}

/** A query parameter that is a whole number from `min` up to 4294967295 (digits only), else null. */
function whole(params: URLSearchParams, name: string, min: number): number | null {
  const raw = params.get(name);
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= 4294967295 ? n : null;
}

/**
 * Dev mode only (docs/plans/delver.md, Stage 1): `delverSeed=S&delverFloor=F` asks the Map Editor to open Floor F (from 1) of seed S
 * (from 0, up to 4294967295) as a generated Delver Floor. Both are needed, as whole numbers in digits; null without `dev=1`
 * or with either missing or bad.
 */
export function devDelverFloor(search: string = location.search, hash: string = location.hash): { seed: number; floor: number } | null {
  if (!devMode(search, hash)) return null;
  const params = query(search, hash);
  const seed = whole(params, 'delverSeed', 0);
  const floor = whole(params, 'delverFloor', 1);
  return seed === null || floor === null ? null : { seed, floor };
}

/**
 * Dev mode only (docs/plans/delver.md, Stage 2): `delver=1` starts a solo Gauntlet as a Delver Run on generated Floors, in place of
 * the Hall-graph Run. False without `dev=1`, and for any other value.
 */
export function devDelverRun(search: string = location.search, hash: string = location.hash): boolean {
  return devMode(search, hash) && query(search, hash).get('delver') === '1';
}
