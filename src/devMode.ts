/**
 * Developer options (the Editor link, the collider view, the Arena Lab) are only offered with `dev=1` in the URL's
 * query, before the route (`?dev=1#/...`) or after it (`#/editor/sandbox?dev=1`).
 */
export function devMode(search: string = location.search, hash: string = location.hash): boolean {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  return new URLSearchParams(search).get('dev') === '1' || new URLSearchParams(query).get('dev') === '1';
}
