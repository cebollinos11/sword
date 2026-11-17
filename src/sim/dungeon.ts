/**
 * A Run's seed and its pure picks (docs/plans/delver.md): every Floor, Warband, drop and traitor pick is made from these, so every peer
 * agrees with nothing sent.
 */
import { hashValue } from './hash';
import { parseGeneratedName } from './arenaGen/named';

/** The Run seed: the seed of the Run's first Arena when it is a Generated Arena (the Lobby's Random Map), else a hash of its name. */
export function runSeed(arena: string): number {
  return parseGeneratedName(arena)?.seed ?? parseInt(hashValue(arena), 16);
}

/** murmur3's 32-bit finaliser: spreads nearby inputs over the whole range. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A pure pick of one of `count` choices for (Run seed, Floor, slot); `salt` keeps independent picks for the same slot apart. */
export function runPick(seed: number, floor: number, slot: number, salt: number, count: number): number {
  const h = mix32(mix32(mix32(seed ^ Math.imul(floor, 0x9e3779b9)) ^ Math.imul(slot + 1, 0x85ebca6b)) ^ Math.imul(salt + 1, 0xc2b2ae35));
  return h % count;
}
