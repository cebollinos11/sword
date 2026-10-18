/**
 * Rooms over PeerJS (browser only; not unit-tested). The host registers a
 * Room's peer ID on the broker (the public PeerJS broker unless a broker URL
 * is configured) and stays registered while the Room lives, so guests can join
 * and rejoin; each guest connects to that ID and drops the broker once its data
 * channel is open (the WebRTC connection is direct). Each connection is a
 * Transport: the Room link the Lobby and every Match's Rollback session share.
 *
 * PeerJS is imported on demand, so Player vs AI never downloads it.
 */
import type { Peer, PeerJSOption } from 'peerjs';
import { createPeerTransport } from './peerTransport';
import { randomRoomCode, roomPeerId, type BrokerOptions } from './room';
import type { Transport } from './transport';

/** Something went wrong creating or joining a Room; `message` is meant for the player. */
export class RoomError extends Error {
  override name = 'RoomError';
}

export interface PendingRoom {
  /** Resolves with the Transport once the peers are connected; rejects with a RoomError. */
  readonly connected: Promise<Transport>;
  /** Give up waiting (closes everything). */
  cancel(): void;
}

/** A Room this browser hosts: it stays open on the broker, so guests can join (and rejoin) for as long as it lives. */
export interface HostedRoom {
  readonly code: string;
  /** Called with each guest whose connection opens (the Lobby decides whether they stay). */
  onGuest(handler: (transport: Transport) => void): void;
  /** Called once if the Room breaks for good (a RoomError for the player). */
  onError(handler: (error: RoomError) => void): void;
  /** Close the Room: the broker registration and every guest's connection. */
  cancel(): void;
}

/** How long a guest waits for the direct connection before giving up. */
const JOIN_TIMEOUT_MS = 20_000;
const CREATE_ATTEMPTS = 5;
/** Intents tolerate loss and reordering (the session resends unacknowledged ones), so don't wait on retransmits. */
const CONNECT_OPTIONS = { serialization: 'json', reliable: false } as const;

function peerOptions(broker: BrokerOptions | null): PeerJSOption {
  return broker ? { ...broker, debug: 1 } : { debug: 1 };
}

function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

function errorType(e: unknown): string {
  return typeof e === 'object' && e !== null && 'type' in e ? String((e as { type: unknown }).type) : '';
}

function brokerName(broker: BrokerOptions | null): string {
  return broker ? `the broker at ${broker.host}:${broker.port}` : 'the public PeerJS broker';
}

function describe(e: unknown, broker: BrokerOptions | null, code?: string): string {
  switch (errorType(e)) {
    case 'peer-unavailable':
      return `There is no Room ${code ?? ''} (check the code, or ask for a new link).`.replace('  ', ' ');
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
      return `Could not reach ${brokerName(broker)}.`;
    case 'invalid-key':
      return `The broker refused the key (check the broker URL's key).`;
    case 'browser-incompatible':
      return 'This browser does not support WebRTC data channels.';
    case 'webrtc':
    case 'negotiation-failed':
    case 'connection-closed':
      return 'Could not open a direct connection to the host (a firewall or network may be blocking WebRTC).';
    default:
      return `Connection error${e instanceof Error && e.message ? `: ${e.message}` : '.'}`;
  }
}

/** Resolve when the Peer is registered on the broker. */
function registered(peer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', reject);
  });
}

/** When the broker connection drops while we still need it, try to get it back. */
function keepRegistered(peer: Peer, needed: () => boolean): void {
  peer.on('disconnected', () => {
    if (needed() && !peer.destroyed) peer.reconnect();
  });
}

/** Create a Room: returns as soon as it is registered on the broker; guests then arrive through `onGuest`. */
export async function hostRoom(broker: BrokerOptions | null): Promise<HostedRoom> {
  const { Peer } = await import('peerjs');
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = randomRoomCode(cryptoRandom);
    const peer = new Peer(roomPeerId(code), peerOptions(broker));
    try {
      await registered(peer);
    } catch (e) {
      peer.destroy();
      if (errorType(e) === 'unavailable-id') continue;
      throw new RoomError(describe(e, broker));
    }
    let done = false;
    let guestHandler: ((t: Transport) => void) | null = null;
    let errorHandler: ((e: RoomError) => void) | null = null;
    const waiting: Transport[] = [];
    const guests = new Set<Transport>();
    keepRegistered(peer, () => !done);
    peer.on('connection', (conn) => {
      if (done) return;
      conn.on('open', () => {
        if (done) return conn.close();
        const transport = createPeerTransport(conn);
        guests.add(transport);
        transport.onClose(() => guests.delete(transport));
        if (guestHandler) guestHandler(transport);
        else waiting.push(transport);
      });
    });
    peer.on('error', (e) => {
      if (done) return;
      // A broker hiccup is retried by keepRegistered, and one guest's failed connection only loses that guest.
      if (['network', 'socket-closed', 'webrtc', 'negotiation-failed', 'connection-closed', 'peer-unavailable'].includes(errorType(e))) return;
      done = true;
      peer.destroy();
      errorHandler?.(new RoomError(describe(e, broker)));
    });
    return {
      code,
      onGuest(handler) {
        guestHandler = handler;
        for (const t of waiting.splice(0)) handler(t);
      },
      onError(handler) {
        errorHandler = handler;
      },
      cancel() {
        done = true;
        for (const t of [...guests]) t.close();
        peer.destroy();
      },
    };
  }
  throw new RoomError('Could not find a free Room code. Try again.');
}

/** Join the Room with this code. */
export function joinRoom(code: string, broker: BrokerOptions | null): PendingRoom {
  let peer: Peer | null = null;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connected = (async () => {
    const { Peer } = await import('peerjs');
    if (done) throw new RoomError('Cancelled.');
    const p = new Peer(peerOptions(broker));
    peer = p;
    try {
      await registered(p);
    } catch (e) {
      p.destroy();
      throw new RoomError(describe(e, broker, code));
    }
    return new Promise<Transport>((resolve, reject) => {
      const fail = (e: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        p.destroy();
        reject(e instanceof RoomError ? e : new RoomError(describe(e, broker, code)));
      };
      const conn = p.connect(roomPeerId(code), CONNECT_OPTIONS);
      timer = setTimeout(
        () => fail(new RoomError('Timed out connecting to the Room (a firewall or network may be blocking WebRTC).')),
        JOIN_TIMEOUT_MS,
      );
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        p.disconnect();
        resolve(createPeerTransport(conn, () => p.destroy()));
      });
      conn.on('error', fail);
      p.on('error', fail);
    });
  })();
  return {
    connected,
    cancel() {
      done = true;
      clearTimeout(timer);
      peer?.destroy();
    },
  };
}
