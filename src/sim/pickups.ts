/**
 * A Run's pickups (docs/plans/dungeon.md, "Loot and the inventory"): the items lying in the current Hall, `RunState.pickups`. A Hall's drops
 * come when it is cleared (one item a Player in a Fight Hall, two in a Boss Hall), a Treasure Hall's pedestals stand from its start (a few
 * a Player; taking one closes the rest for that Player), and an inventory `drop` lays a shared one. A Player's Fighter takes one by standing
 * on it with room in its inventory. What each holds is a pure pick of (Run seed, Floor, Hall, Player, k), so every peer agrees with nothing
 * sent, and where each lies is Team 1's spawn cell, ground the generator's judge guarantees every Door can walk to. They are plain data,
 * hashed and snapshotted with the Run, and gone when the Hall changes. The AI allies never take loot: only `runPlayers`' Fighters do.
 */
import type { TuningData } from '../tuning';
import { arenaOf } from './arena';
import { hallSlot, runPick, runSeed, type Hall } from './dungeon';
import { inDuel } from './duel';
import { hallRoster, restFire, runPlayers, ZONE_HEIGHT, type HallRef } from './hall';
import { addItem, type Dropped } from './inventory';
import type { MatchConfig } from './match';
import type { FighterState } from './state';

/** Where a pickup lies: `y` the ground under it. */
export interface PickupAt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One item lying in a Hall: `kind` and `item` (the Weapon or Relic name) as `Dropped`. `owner` is the Player Fighter (a Team 0 index) whose it
 * is, or null for a shared one (a drop, which any Player may take). `taken` pickups stay in the list, so an `id` (its index in it) is never reused.
 */
export interface Pickup extends Dropped {
  readonly id: number;
  readonly owner: number | null;
  readonly at: PickupAt;
  readonly taken: boolean;
  /** Pedestals only: the `id` of the first of an owner's pedestals, which they all share. Taking one marks the lot `taken`. */
  readonly group?: number;
  /** A drop only: the Fighter that dropped it. It may not take it back until it has stepped off it (else the drop would be undone on the same Tick). */
  readonly by?: number;
}

/** How near (m, across the ground) a Fighter must stand to a pickup to take it: under half the 1.12 m between Team 1's spawns, where Hall pickups lie, so each is its own. */
export const PICKUP_RADIUS = 0.5;

/** `runPick` salts of a pickup's item (apart from the Floor graph's and the Hall roster's). */
const SALT = { kind: 50, relic: 51, weapon: 52 } as const;

/** Whether the Player Fighter `player` sees (and may take) the pickup: its own and every shared one, not yet taken. The one rule presentation draws pickups by. */
export const pickupVisibleTo = (p: Pick<Pickup, 'owner' | 'taken'>, player: number): boolean => !p.taken && (p.owner === null || p.owner === player);

/** Whether a Fighter stands on `at`: within PICKUP_RADIUS across the ground, within ZONE_HEIGHT over it. */
function standsOn(at: PickupAt, f: Pick<FighterState, 'position' | 'y'>): boolean {
  return f.y > at.y - 0.5 && f.y < at.y + ZONE_HEIGHT && Math.hypot(f.position.x - at.x, f.position.z - at.z) <= PICKUP_RADIUS;
}

/** The ground a Hall's own pickups lie on: Team 1's spawns in slot order (a Hall Arena has four), else the Rest fire's spot. */
function pickupSpots(tuning: TuningData, hall: Hall): PickupAt[] {
  const arena = arenaOf(tuning, hall.arena);
  const spawns = arena.spawns.filter((s) => s.team === 1).sort((a, b) => a.slot - b.slot);
  return spawns.length > 0 ? spawns.map((s) => ({ x: s.position.x, y: s.position.y, z: s.position.z })) : [restFire(arena)];
}

/**
 * The item for slot `k` of `player`'s loot in Hall `at`: a Relic or a Weapon by `dungeon.loot.weights`, then a name from that list, both
 * by `runPick` on (Run seed, Floor, Hall, Player, k). Names in `avoid` (the items already picked for this Player's set) are skipped while
 * others remain. A Tuning Data with no Relics gives only Weapons.
 */
function pickItem(tuning: TuningData, seed: number, at: HallRef, player: number, k: number, avoid: readonly Dropped[]): Dropped {
  const slot = (hallSlot(at.row, at.index) * 8 + player) * 8 + k;
  const { Relic, Weapon } = tuning.dungeon.loot.weights;
  const relics = tuning.relics.map((r) => r.name);
  const weapons = Object.keys(tuning.weapons);
  const u = (runPick(seed, at.floor, slot, SALT.kind, 0x1_0000_0000) / 0x1_0000_0000) * (Relic + Weapon);
  const kind: Dropped['kind'] = relics.length > 0 && (u < Relic || weapons.length === 0) ? 'relic' : 'weapon';
  const names = kind === 'relic' ? relics : weapons;
  const fresh = names.filter((n) => !avoid.some((a) => a.kind === kind && a.item === n));
  const from = fresh.length > 0 ? fresh : names;
  return { kind, item: from[runPick(seed, at.floor, slot, kind === 'relic' ? SALT.relic : SALT.weapon, from.length)]! };
}

/**
 * The Relic an Elite Hall's Encounter carried, dropped on top of `loot.drops.Elite`: the first Relic of the lowest-slot enemy that fights
 * (`hallRoster`) and carries any, so with several carriers the pick is the same on every peer. None when no enemy carries one.
 */
function carriedRelics(tuning: TuningData, config: Pick<MatchConfig, 'arena' | 'teams' | 'humans'>, at: HallRef): readonly string[] {
  const carrier = hallRoster(tuning, config, at).find((e) => e?.relics !== undefined);
  return carrier ? [carrier.relics![0]!] : [];
}

/**
 * What a Hall drops for each Player when it is cleared (`HallCleared`), to append to the Hall's pickups from `firstId`: for each Player of
 * `runPlayers(config)`, ascending, `loot.drops` of the Hall's kind items (none for a Treasure or Rest Hall), each its own (`owner` the Player)
 * on Team 1's spawn k (wrapping), a Player's items different where they can be. An Elite Hall also drops, for each Player, the Relic an Elite
 * carried (`carriedRelics`) ahead of the picked ones: its count is `loot.drops.Elite` plus that one.
 */
export function hallDrops(tuning: TuningData, config: Pick<MatchConfig, 'arena' | 'teams' | 'humans' | 'players'>, at: HallRef, hall: Hall, firstId: number): Pickup[] {
  const count = hall.kind === 'Fight' || hall.kind === 'Elite' || hall.kind === 'Boss' ? tuning.dungeon.loot.drops[hall.kind] : 0;
  const carried = hall.kind === 'Elite' ? carriedRelics(tuning, config, at) : [];
  if (count + carried.length === 0) return [];
  const seed = runSeed(config.arena);
  const spots = pickupSpots(tuning, hall);
  const pickups: Pickup[] = [];
  for (const player of runPlayers(config)) {
    const items: Dropped[] = carried.map((item) => ({ kind: 'relic', item }));
    for (let k = 0; k < count; k++) items.push(pickItem(tuning, seed, at, player, k, items));
    for (const [k, item] of items.entries()) pickups.push({ id: firstId + pickups.length, owner: player, ...item, at: spots[k % spots.length]!, taken: false });
  }
  return pickups;
}

/**
 * A Hall's pickups at its start: a Treasure Hall's `loot.pedestals` pedestals for each Player, ascending, on Team 1's spawns (which it
 * leaves empty) in slot order, each Player's own copies on the same ground (a Player sees only theirs: `pickupVisibleTo`), different items
 * where they can be, all of a Player's in one `group`: taking one closes the others, for that Player only. No other Hall has any.
 */
export function startPickups(tuning: TuningData, config: Pick<MatchConfig, 'arena' | 'teams' | 'humans' | 'players'>, at: HallRef, hall: Hall): Pickup[] {
  if (hall.kind !== 'Treasure') return [];
  const seed = runSeed(config.arena);
  const spots = pickupSpots(tuning, hall);
  const pickups: Pickup[] = [];
  for (const player of runPlayers(config)) {
    const first = pickups.length;
    const items: Dropped[] = [];
    for (let k = 0; k < tuning.dungeon.loot.pedestals; k++) items.push(pickItem(tuning, seed, at, player, k, items));
    for (const [k, item] of items.entries()) pickups.push({ id: first + k, owner: player, ...item, at: spots[k % spots.length]!, taken: false, group: first });
  }
  return pickups;
}

/** A shared pickup for an item a Fighter dropped, at its feet, with id `id` (the next free one): the drop seam's work (`placeDrop`). */
export const droppedPickup = (id: number, drop: Dropped & { readonly fighter: number; readonly at: PickupAt }): Pickup => ({
  id,
  owner: null,
  kind: drop.kind,
  item: drop.item,
  at: { x: drop.at.x, y: drop.at.y, z: drop.at.z },
  taken: false,
  by: drop.fighter,
});

/** An item a Player's Fighter took up, from pickup `id`. */
export interface Taken extends Dropped {
  readonly fighter: number;
  readonly id: number;
}

const withoutBy = ({ by: _by, ...p }: Pickup): Pickup => p;

/**
 * One Tick of taking: a Player's Fighter (`runPlayers`, never an AI ally, which holds no inventory either) that is alive and standing on a
 * pickup it owns or a shared one takes it if it has room (`addItem`): the item joins its inventory, the pickup (and its `group`) is `taken`. Pickups
 * are visited by `id`, the Players ascending, so two on one shared pickup go to the lower Fighter; a full inventory leaves it lying. A dropper's
 * `by` ends once it stands off its drop. Pure; the same pickups and Fighters when nothing happens.
 */
export function takePickups(
  pickups: readonly Pickup[],
  fighters: readonly FighterState[],
  config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>,
  tuning: TuningData,
): { readonly pickups: readonly Pickup[]; readonly fighters: readonly FighterState[]; readonly taken: readonly Taken[] } {
  if (pickups.length === 0) return { pickups, fighters, taken: [] };
  const players = runPlayers(config).filter((i) => fighters[i]?.inventory !== undefined && inDuel(fighters[i]!) && fighters[i]!.hp > 0);
  let held = fighters;
  let next = pickups.map((p) => (p.by !== undefined && !(fighters[p.by] && standsOn(p.at, fighters[p.by]!)) ? withoutBy(p) : p));
  const taken: Taken[] = [];
  for (let id = 0; id < next.length; id++) {
    const p = next[id]!;
    if (p.taken) continue;
    for (const i of players) {
      const f = held[i]!;
      if ((p.owner !== null && p.owner !== i) || p.by === i || !standsOn(p.at, f)) continue;
      const inventory = addItem(f.inventory!, p, tuning.dungeon.inventory);
      if (!inventory) continue;
      held = held.map((g, k) => (k === i ? { ...g, inventory } : g));
      next = next.map((q) => (q.id === p.id || (p.group !== undefined && q.group === p.group) ? { ...q, taken: true } : q));
      taken.push({ fighter: i, id: p.id, kind: p.kind, item: p.item });
      break;
    }
  }
  return { pickups: next, fighters: held, taken };
}
