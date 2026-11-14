/**
 * A Delver Run's loot (docs/plans/delver.md, Stage 4): what a wiped Warband drops where its last Soldier fell, and the pedestals a Treasure Hall holds
 * from the Floor's start. What each item is, is a pure pick of (Run seed, Floor, source, index, Player, k) (`lootSlot`, then `pickItemAt`), so every
 * peer agrees with nothing sent; where it lies is a pure function of the Floor's plan and the fall point (`dropSpots`). Each Player has its own
 * copies on the same ground (`pickupVisibleTo`), and the AI allies get none. Everything here is pure; the Run's step lays the results in its pickups.
 */
import type { ArenaGeometry, LevelsTuning, TuningData } from '../tuning';
import type { CrowdState } from './crowd';
import type { FloorPlan } from './delver/plan';
import { surfaceHeight } from './arena';
import { groundNear } from './levels';
import { tierOf } from './delver/troops';
import { presentPlayers } from './hall';
import type { Dropped } from './inventory';
import type { MatchConfig } from './match';
import { pickItemAt, type Pickup, type PickupAt } from './pickups';
import { BOSS, ELITE } from './warband';

/** The most items of one Player's set from one source (`lootSlot`'s k is below it). */
const MAX_SET = 16;
/** The most Players (`lootSlot`'s player is below it). */
const MAX_PLAYERS = 4;

/**
 * The pick slot of item `k` of `player`'s set from one source: `source` 0 is a Warband's drop (`index` the Warband q), 1 a Treasure Hall's pedestal
 * (`index` the Hall's ordinal). Injective over its range, so no two items share a pick. Throws on a `k` or `player` out of range.
 */
export function lootSlot(source: 0 | 1, index: number, player: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k >= MAX_SET) throw new RangeError(`k must be a whole number from 0 to ${MAX_SET - 1}, got ${k}`);
  if (!Number.isInteger(player) || player < 0 || player >= MAX_PLAYERS) throw new RangeError(`player must be a whole number from 0 to ${MAX_PLAYERS - 1}, got ${player}`);
  return ((index * MAX_PLAYERS + player) * MAX_SET + k) * 2 + source;
}

/**
 * What Warband q drops for one Player when it is wiped: the Relic it carried first (an elite template's first, or the Boss Troop's first, when it has
 * one), then `dungeon.loot.drops` of its rank (`Fight`, `Elite`, `Boss`) picked by `pickItemAt`, each avoiding the items so far. `tuning` is the
 * Floor's own (`arenaTuning`), so the tier's templates are `tuning.delver.warbands[tierOf - 1]`. Pure.
 */
export function warbandLoot(tuning: TuningData, crowd: CrowdState, q: number, player: number, seed: number, floor: number): Dropped[] {
  const warbands = crowd.warbands!;
  const rank = warbands.rank[q]!;
  const tier = tuning.delver.warbands[tierOf(tuning.delver, floor) - 1]!;
  const carried = rank === BOSS ? tier.boss?.troop.relics[0] : rank === ELITE ? tier.elite?.[warbands.encounter[q]!]?.relics[0] : undefined;
  const items: Dropped[] = carried === undefined ? [] : [{ kind: 'relic', item: carried }];
  const { drops } = tuning.dungeon.loot;
  const count = rank === BOSS ? drops.Boss : rank === ELITE ? drops.Elite : drops.Fight;
  for (let k = 0; k < count; k++) items.push(pickItemAt(tuning, seed, floor, lootSlot(0, q, player, k), items));
  return items;
}

/** How far (m) inside a Hall's or Passage's walls a drop lies. */
export const DROP_MARGIN = 0.75;
/** The metres between the candidate spots along a rect's longer side. */
export const DROP_GAP = 1.2;
/** Two spots nearer than this (m) are one: the candidate is skipped. */
const DROP_APART = 1.1;
/** The candidate spots tried before the found ones are reused in turn. */
const DROP_TRIES = 16;

interface Box {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** The square of the distance (ground) from (x, z) to the box, 0 inside it. */
const gap2 = (b: Box, x: number, z: number): number => {
  const dx = x - clamp(x, b.x0, b.x1);
  const dz = z - clamp(z, b.z0, b.z1);
  return dx * dx + dz * dz;
};
const holds = (b: Box, x: number, z: number): boolean => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

/** The Hall or Passage rect a fall point belongs to: the first Hall holding it, then the first Passage, else the nearest (Halls first, the lower index on a tie). */
function rectOf(plan: FloorPlan, x: number, z: number): Box {
  const rects = [...plan.halls.map((h) => h.rect), ...plan.passages.map((p) => p.rect)];
  const inside = rects.find((r) => holds(r, x, z));
  if (inside) return inside;
  let best = rects[0]!;
  for (const r of rects) if (gap2(r, x, z) < gap2(best, x, z)) best = r;
  return best;
}

/**
 * `count` spots near the fall point (x, z, at height y), where a wiped Warband's items lie. R is the Hall rect holding the point, else the Passage rect, else
 * the nearest of them; the spots are inside R shrunk by `DROP_MARGIN`, so none lies in a Wall or the abyss. The first is the point clamped in; the others
 * move along R's longer side by 0, +1.2, -1.2, +2.4, -2.4 m and so on (`DROP_GAP`), clamped, skipping a candidate within 1.1 m of one taken, so two never
 * share a spot. After 16 candidates the spots found are reused in turn. Each spot lies on the ground nearest under the fall's height `y` (`groundNear`
 * of the Floor's `arena`, never a roof; so a fall on a Deck lies on the Deck, one beside it on the floor), at `y` itself where there is none. Pure.
 */
export function dropSpots(plan: FloorPlan, arena: ArenaGeometry, lv: LevelsTuning, x: number, z: number, y: number, count: number): PickupAt[] {
  if (count <= 0) return [];
  const r = rectOf(plan, x, z);
  // A rect narrower than twice the margin shrinks to its middle line.
  const span = (lo: number, hi: number): [number, number] => (lo + DROP_MARGIN > hi - DROP_MARGIN ? [(lo + hi) / 2, (lo + hi) / 2] : [lo + DROP_MARGIN, hi - DROP_MARGIN]);
  const [x0, x1] = span(r.x0, r.x1);
  const [z0, z1] = span(r.z0, r.z1);
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const bx = clamp(x, x0, x1);
  const bz = clamp(z, z0, z1);
  const found: PickupAt[] = [];
  for (let j = 0; j < DROP_TRIES && found.length < count; j++) {
    const along = (j % 2 === 1 ? (j + 1) / 2 : -j / 2) * DROP_GAP;
    const sx = alongX ? clamp(bx + along, x0, x1) : bx;
    const sz = alongX ? bz : clamp(bz + along, z0, z1);
    const ground = groundNear(arena, lv, sx, sz, y, true);
    const spot: PickupAt = { x: sx, y: ground >= 0 ? surfaceHeight(arena, ground, sx, sz) : y, z: sz };
    if (found.every((s) => (s.x - spot.x) ** 2 + (s.z - spot.z) ** 2 >= DROP_APART * DROP_APART)) found.push(spot);
  }
  return Array.from({ length: count }, (_, k) => found[k % found.length]!);
}

/**
 * What wiped Warband q drops where its last Soldier fell (`fall`): for each present Player (`presentPlayers`, ascending; not an away Player, never an AI
 * ally) its `warbandLoot`, item k at `dropSpots` k, `owner` the Player, ids from `firstId` on. Every Player's k-th item lies on the same spot, and each
 * sees only its own. Pure.
 */
export function warbandDrops(
  tuning: TuningData,
  config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>,
  plan: FloorPlan,
  arena: ArenaGeometry,
  crowd: CrowdState,
  q: number,
  fall: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
  floor: number,
  firstId: number,
  away?: readonly number[],
): Pickup[] {
  const sets = presentPlayers(config, away).map((player) => ({ player, items: warbandLoot(tuning, crowd, q, player, seed, floor) }));
  const spots = dropSpots(plan, arena, tuning.battle.levels, fall.x, fall.z, fall.y, Math.max(0, ...sets.map((s) => s.items.length)));
  const pickups: Pickup[] = [];
  for (const { player, items } of sets)
    for (const [k, item] of items.entries()) pickups.push({ id: firstId + pickups.length, owner: player, ...item, at: spots[k]!, taken: false });
  return pickups;
}

/** The markers of one Treasure Hall's pedestals. */
const PEDESTALS = 3;

/**
 * The pedestals a Floor's Treasure Halls hold from its start: Halls in `plan.markers.pedestals` order (three markers each, the Hall's ordinal t), and for each
 * present Player `loot.pedestals` items, the k-th on the Hall's marker k mod 3 (`lootSlot` 1), in one `group` per (Hall, Player): the id of its first pickup.
 * Taking one closes the rest for that Player only. Pure.
 */
export function treasurePickups(tuning: TuningData, config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, plan: FloorPlan, seed: number, floor: number, away?: readonly number[]): Pickup[] {
  const pickups: Pickup[] = [];
  const { pedestals } = plan.markers;
  for (let t = 0; t * PEDESTALS < pedestals.length; t++) {
    const markers = pedestals.slice(t * PEDESTALS, (t + 1) * PEDESTALS);
    for (const player of presentPlayers(config, away)) {
      const group = pickups.length;
      const items: Dropped[] = [];
      for (let k = 0; k < tuning.dungeon.loot.pedestals; k++) items.push(pickItemAt(tuning, seed, floor, lootSlot(1, t, player, k), items));
      for (const [k, item] of items.entries()) {
        const m = markers[k % markers.length]!;
        pickups.push({ id: group + k, owner: player, ...item, at: { x: m.x, y: m.y, z: m.z }, taken: false, group });
      }
    }
  }
  return pickups;
}
