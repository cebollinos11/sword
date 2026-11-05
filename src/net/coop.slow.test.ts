/**
 * Dungeon Stage 4, co-op online: the four-Player case of `coop.test.ts`, its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, it, vi } from 'vitest';
import { reachHall3 } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

describe('co-op Runs over the memory transport: walking, looting and equipping, no teleport', () => {
  it('4 Players reach Hall 3: checksums, Hall changes, Door gathering, pickups and Inventories agree on every peer and offline', () => reachHall3(4), 300_000);
});
