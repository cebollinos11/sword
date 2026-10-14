/**
 * Rooms: the shareable code/link through which two peers connect for a
 * Player vs Player Match. Pure helpers (no PeerJS, no DOM) so they can be
 * unit-tested: Room codes, links, peer IDs and the configurable broker URL.
 */

/** Room code letters: no 0/O or 1/I, so a code read aloud or retyped survives. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Prefix for the host's PeerJS ID on the broker, so Rooms don't clash with other apps. */
const PEER_ID_PREFIX = 'sword-room-';
/** The hash route of a Room link: `#/room/<code>[?broker=<url>]`. */
const ROOM_ROUTE = '#/room/';

/** What a Room code or link names: the code, plus the broker it lives on when that isn't the public one. */
export interface RoomAddress {
  readonly code: string;
  readonly broker?: string;
}

/** PeerJS connection options for a self-hosted broker (a subset of PeerJS's `PeerOptions`). */
export interface BrokerOptions {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly secure: boolean;
  readonly key: string;
}

export class BrokerUrlError extends Error {
  override name = 'BrokerUrlError';
}

/** A new random Room code. `random` returns values in [0, 1) (e.g. crypto-backed in the browser). */
export function randomRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.min(ROOM_CODE_ALPHABET.length - 1, Math.floor(random() * ROOM_CODE_ALPHABET.length));
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/** The host's PeerJS ID for a Room. */
export function roomPeerId(code: string): string {
  return PEER_ID_PREFIX + code;
}

/** The link that opens the game straight into joining this Room. */
export function roomLink(pageUrl: string, code: string, broker?: string): string {
  const url = new URL(pageUrl);
  const query = broker ? `?broker=${encodeURIComponent(broker)}` : '';
  return `${url.origin}${url.pathname}${ROOM_ROUTE}${code}${query}`;
}

function normaliseCode(text: string): string | null {
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return code;
}

/**
 * Read what a player typed or pasted to join: a bare Room code (any case,
 * spaces/dashes ignored) or a Room link (also just its `#/room/...` hash).
 * Returns null if it names no Room.
 */
export function parseRoomInput(text: string): RoomAddress | null {
  const trimmed = text.trim();
  const at = trimmed.indexOf(ROOM_ROUTE);
  if (at < 0) {
    const code = normaliseCode(trimmed);
    return code ? { code } : null;
  }
  const route = trimmed.slice(at + ROOM_ROUTE.length);
  const q = route.indexOf('?');
  const code = normaliseCode(q < 0 ? route : route.slice(0, q));
  if (!code) return null;
  const broker = q < 0 ? null : new URLSearchParams(route.slice(q + 1)).get('broker');
  return broker ? { code, broker } : { code };
}

/**
 * Parse a broker URL (a self-hosted PeerJS server), e.g.
 * `https://peer.example.com:9000/myapp?key=mykey`. Blank means the public
 * PeerJS broker (null). http/ws = plain, https/wss = TLS; no scheme = http.
 */
export function parseBrokerUrl(text: string): BrokerOptions | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BrokerUrlError(`Broker URL "${trimmed}" is not a valid URL`);
  }
  const scheme = url.protocol.replace(':', '');
  if (!['http', 'https', 'ws', 'wss'].includes(scheme)) {
    throw new BrokerUrlError(`Broker URL "${trimmed}" must start with http://, https://, ws:// or wss://`);
  }
  if (!url.hostname) throw new BrokerUrlError(`Broker URL "${trimmed}" has no host`);
  const secure = scheme === 'https' || scheme === 'wss';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path: url.pathname || '/',
    secure,
    key: url.searchParams.get('key') || 'peerjs',
  };
}
