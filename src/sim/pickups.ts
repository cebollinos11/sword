/**
 * A Run's pickups (docs/plans/delver.md, Stage 4): the items lying on the current Floor, `RunState.pickups`. A wiped Warband's drops lie where
 * its last Soldier fell, a Treasure Hall's pedestals stand from the Floor's start (a few a Player; taking one closes the rest for that Player),
 * and an inventory `drop` lays a shared one (`delverLoot.ts` picks and places them). A Player's Fighter takes one by standing on it with room in
 * its inventory. What each holds is a pure pick of (Run seed, Floor, slot), so every peer agrees with nothing sent. They are plain data, hashed
 * and snapshotted with the Run, and gone when the Floor changes. The AI allies never take loot: only `runPlayers`' Fighters do.
 */
import { runWeapons, type TuningData } from '../tuning';
import { runPick } from './dungeon';
import { inDuel } from './duel';
import { presentPlayers, standsWithin } from './party';
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
 * One item lying on a Floor: `kind` and `item` (the Weapon, Relic or Consumable name) as `Dropped`. `owner` is the Player Fighter (a Team 0 index) whose it
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

/** How near (m, across the ground) a Fighter must stand to a pickup to take it: under half the 1.12 m between two spots a Floor lays its pickups on, so each is its own. */
export const PICKUP_RADIUS = 0.5;

/** `runPick` salts of a pickup's item. */
const SALT = { kind: 50, relic: 51, weapon: 52, consumable: 53 } as const;

/** Whether the Player Fighter `player` sees (and may take) the pickup: its own and every shared one, not yet taken. The one rule presentation draws pickups by. */
export const pickupVisibleTo = (p: Pick<Pickup, 'owner' | 'taken'>, player: number): boolean => !p.taken && (p.owner === null || p.owner === player);

/** Whether a Fighter stands on `at`: within PICKUP_RADIUS across the ground, within ZONE_HEIGHT over it. */
const standsOn = (at: PickupAt, f: Pick<FighterState, 'position' | 'y'>): boolean => standsWithin(at, PICKUP_RADIUS, f);

/**
 * The item for pick slot `slot` of Floor `floor` (the caller's one number for a source, a Player and a k: `delverLoot.ts`'s `lootSlot`): a Relic,
 * a Consumable or a Weapon by `dungeon.loot.weights` (that order along the pick, so a Tuning Data without a Consumable weight picks as before
 * Consumables were), then a name, both by `runPick` on (Run seed, Floor, slot). Names in `avoid` (the items already picked for this Player's set)
 * are skipped while others remain. A kind with no names (no Relics, say) is never picked while another has some.
 */
export function pickItemAt(tuning: TuningData, seed: number, floor: number, slot: number, avoid: readonly Dropped[]): Dropped {
  const { Relic, Weapon, Consumable } = tuning.dungeon.loot.weights;
  const pools: readonly (readonly [Dropped['kind'], number, readonly string[]])[] = [
    ['relic', Relic, tuning.relics.map((r) => r.name)],
    ['consumable', Consumable, (tuning.consumables ?? []).map((c) => c.name)],
    ['weapon', Weapon, runWeapons(tuning)],
  ];
  const live = pools.filter(([, weight, names]) => weight > 0 && names.length > 0);
  // Every weighted kind empty: whichever kind has names, Weapons last (the roster is never empty).
  const choices = live.length > 0 ? live : pools.filter(([, , names]) => names.length > 0);
  const total = live.length > 0 ? live.reduce((sum, [, weight]) => sum + weight, 0) : 0;
  const u = (runPick(seed, floor, slot, SALT.kind, 0x1_0000_0000) / 0x1_0000_0000) * total;
  let pick = choices[choices.length - 1]!;
  let edge = 0;
  for (const choice of choices) {
    edge += choice[1];
    if (u < edge) {
      pick = choice;
      break;
    }
  }
  const [kind, , names] = pick;
  const fresh = names.filter((n) => !avoid.some((a) => a.kind === kind && a.item === n));
  const from = fresh.length > 0 ? fresh : names;
  return { kind, item: from[runPick(seed, floor, slot, SALT[kind], from.length)]! };
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
 * One Tick of taking: a Player's Fighter (`presentPlayers` less those `away`, never an AI ally or a taken-over Fighter, which keeps its inventory but takes no more) that is alive and standing on a
 * pickup it owns or a shared one takes it if it has room (`addItem`): the item joins its inventory, the pickup (and its `group`) is `taken`. Pickups
 * are visited by `id`, the Players ascending, so two on one shared pickup go to the lower Fighter; a full inventory leaves it lying. A dropper's
 * `by` ends once it stands off its drop. Pure; the same pickups and Fighters when nothing happens.
 */
export function takePickups(
  pickups: readonly Pickup[],
  fighters: readonly FighterState[],
  config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>,
  tuning: TuningData,
  away?: readonly number[],
): { readonly pickups: readonly Pickup[]; readonly fighters: readonly FighterState[]; readonly taken: readonly Taken[] } {
  if (pickups.length === 0) return { pickups, fighters, taken: [] };
  const players = presentPlayers(config, away).filter((i) => fighters[i]?.inventory !== undefined && inDuel(fighters[i]!) && fighters[i]!.hp > 0);
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

/** An item a Fighter dropped from its inventory: who, what (a Weapon or Relic by name) and where (its feet). */
export interface DroppedItem extends Dropped {
  readonly fighter: number;
  readonly at: PickupAt;
}

/**
 * THE drop seam: the one place an item a Fighter dropped (Intent `drop`, accepted by `stepDelver`)
 * becomes something in the world: a shared pickup (`owner: null`, any Player may take it) at `drop.at` in `RunState.pickups`, which the dropper
 * cannot take back until it has stepped off it. The drop has left the inventory already (and is reported as an `ItemDropped` event). Pure.
 */
export function placeDrop<R extends { readonly pickups: readonly Pickup[] }>(run: R, drop: DroppedItem): R {
  return { ...run, pickups: [...run.pickups, droppedPickup(run.pickups.length, drop)] };
}
