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

/**
 * Dev mode only: `relics=a,b,c` (names as in `data/relics.json` or `data/consumables.json`) starts every Player's Fighter with those
 * Relics and Consumables, the Relics equipped in order and the rest carried (`MatchOptions.relics`). The option to add to a Run's: none without `dev=1`
 * or a `relics`. The sim throws on an unknown name.
 */
export function devRunRelics(search: string = location.search, hash: string = location.hash): { relics?: string[] } {
  if (!devMode(search, hash)) return {};
  const raw = query(search, hash).get('relics');
  return raw === null || raw === '' ? {} : { relics: raw.split(',').map((n) => n.trim()) };
}

/**
 * Dev mode only: `autopilot=1` puts the local Player's Fighter in a Skirmish Run on the Delver pilot (src/controllers/delverPilot.ts; a
 * traitor's Seat on the traitor pilot), the local Intents ignored. For checking a Run in a browser that cannot be played by hand (headless).
 * False without `dev=1` or for any other value.
 */
export function devAutopilot(search: string = location.search, hash: string = location.hash): boolean {
  return devMode(search, hash) && query(search, hash).get('autopilot') === '1';
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

/** Dev mode only: `aiwalk=1` in the Map Editor walks the AI over the map it opens (with `delverSeed`, the Floor) once it is checked. */
export function devAiWalk(search: string = location.search, hash: string = location.hash): boolean {
  return devMode(search, hash) && query(search, hash).get('aiwalk') === '1';
}

/**
 * Dev mode only (docs/plans/delver.md, Stage 4): `delverStart=F` (a whole number from 1) starts a solo Run on Floor F instead of Floor 1
 * (`MatchOptions.delverStart`; the sim refuses one past the last Floor). Nothing without `dev=1` or with a bad value.
 */
export function devDelverStart(search: string = location.search, hash: string = location.hash): { delverStart?: number } {
  if (!devMode(search, hash)) return {};
  const floor = whole(query(search, hash), 'delverStart', 1);
  return floor === null ? {} : { delverStart: floor };
}

/**
 * Dev mode only (docs/plans/delver.md, Stage 5): `immortal=1` keeps every living Team 0 Fighter of a solo Delver Run at its max HP after each
 * Tick (`playerVsAi`'s `immortal`), so a playtest or a screenshot Run reaches the later Floors, the Boss Floors and the Victory on the shipped
 * Tuning. The Simulation's rules and the Tuning are untouched. False without `dev=1`.
 */
export function devImmortal(search: string = location.search, hash: string = location.hash): boolean {
  return devMode(search, hash) && query(search, hash).get('immortal') === '1';
}

/**
 * Dev mode only: `speed=N` (1 to 16) runs a solo Match's Ticks N times as fast per frame, for a headless playtest whose frames are slow
 * (the game loop only; the Simulation's rules are untouched, and a Delver Run's fade between Floors still plays at 1×). 1 without `dev=1`.
 */
export function devSpeed(search: string = location.search, hash: string = location.hash): number {
  if (!devMode(search, hash)) return 1;
  const n = whole(query(search, hash), 'speed', 1);
  return n === null ? 1 : Math.min(16, n);
}
