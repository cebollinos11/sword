import { describe, expect, it } from 'vitest';
import { parseBrokerUrl, parseRoomInput, randomRoomCode, ROOM_CODE_LENGTH, roomLink, roomPeerId } from './room';

const PAGE = 'https://cebollinos11.github.io/sword/?x=1#/editor';

describe('Room codes', () => {
  it('a new Room code is 6 characters with no look-alikes (0/O, 1/I)', () => {
    let i = 0;
    const values = [0, 0.999, 0.5, 0.25, 0.75, 0.1];
    const code = randomRoomCode(() => values[i++ % values.length]!);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(code).toBe('A9SJ2D');
    expect(randomRoomCode(() => 0)).toBe('AAAAAA');
    expect(randomRoomCode(() => 0.9999)).toBe('999999');
  });

  it('a code typed by hand is accepted in any case, with spaces or a dash', () => {
    expect(parseRoomInput('abc234')).toEqual({ code: 'ABC234' });
    expect(parseRoomInput('  ABC-234 ')).toEqual({ code: 'ABC234' });
    expect(parseRoomInput('abc 234')).toEqual({ code: 'ABC234' });
  });

  it('rejects something that is not a Room code', () => {
    expect(parseRoomInput('')).toBeNull();
    expect(parseRoomInput('ABC23')).toBeNull();
    expect(parseRoomInput('ABC2345')).toBeNull();
    expect(parseRoomInput('ABC0I1')).toBeNull();
    expect(parseRoomInput('https://example.com/sword/')).toBeNull();
  });

  it('the shareable link opens the game on the Room, and joining by that link finds the code', () => {
    const link = roomLink(PAGE, 'ABC234');
    expect(link).toBe('https://cebollinos11.github.io/sword/#/room/ABC234');
    expect(parseRoomInput(link)).toEqual({ code: 'ABC234' });
    expect(parseRoomInput('#/room/abc234')).toEqual({ code: 'ABC234' });
  });

  it('a link made on a custom broker carries it, so the guest joins through the same broker', () => {
    const broker = 'https://peer.example.com:9000/myapp?key=k1';
    const link = roomLink(PAGE, 'ABC234', broker);
    expect(link.startsWith('https://cebollinos11.github.io/sword/#/room/ABC234?broker=')).toBe(true);
    expect(parseRoomInput(link)).toEqual({ code: 'ABC234', broker });
  });

  it('Room peer IDs are namespaced so they do not clash with other apps on the public broker', () => {
    expect(roomPeerId('ABC234')).toBe('sword-room-ABC234');
  });
});

describe('Broker URL', () => {
  it('blank means the public PeerJS broker', () => {
    expect(parseBrokerUrl('')).toBeNull();
    expect(parseBrokerUrl('   ')).toBeNull();
  });

  it('a full URL gives host, port, path, TLS and key', () => {
    expect(parseBrokerUrl('https://peer.example.com:9000/myapp?key=k1')).toEqual({
      host: 'peer.example.com',
      port: 9000,
      path: '/myapp',
      secure: true,
      key: 'k1',
    });
  });

  it('defaults the port from the scheme, the path to / and the key to peerjs', () => {
    expect(parseBrokerUrl('http://localhost')).toEqual({ host: 'localhost', port: 80, path: '/', secure: false, key: 'peerjs' });
    expect(parseBrokerUrl('wss://peer.example.com')).toEqual({ host: 'peer.example.com', port: 443, path: '/', secure: true, key: 'peerjs' });
  });

  it('a bare host:port means http', () => {
    expect(parseBrokerUrl('localhost:9000')).toMatchObject({ host: 'localhost', port: 9000, secure: false });
  });

  it('rejects an unusable URL with a readable message', () => {
    expect(() => parseBrokerUrl('ftp://x')).toThrow(/Broker URL/);
    expect(() => parseBrokerUrl('http://')).toThrow(/Broker URL/);
  });
});
