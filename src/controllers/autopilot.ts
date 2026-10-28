/**
 * Dev mode only (`?dev=1&autopilot=...`, src/devMode.ts): the local Player's Fighter on an AI, so a Run can be checked in
 * the browser (headless, at a few frames a second) without a human fighting it. While its Hall is Fighting it is the AI
 * at `difficulty`. Once the Hall is cleared it takes the Rest fire if the Hall is a Rest Hall, then walks into the zone
 * of exit `doors[row]` (the list's last for later rows, the Hall's last exit if past it), so the Run takes that Door.
 * It is still a Player's Fighter for the Run (Doors count it), only its Intents come from here.
 *
 * With `loot` (`?loot=1`, src/devMode.ts) it also takes the loot lying in the Cleared Hall before leaving: it walks onto the nearest
 * pickup it sees and may take, equips what it carries (a Relic while it has a free Relic slot, else the newest Weapon), and with `'drop'`
 * once drops a carried item, steps off it and takes it up again (a drop cannot be retaken until the dropper stands off it). It reads the pickups
 * from the Match (`watch`, called by the driver each Tick), which a Controller's SimState does not carry.
 *
 * Its own memory (which Rest Halls it rested in, what it dropped) is not saved: it only ever drives a Run stepped locally, with no Rollback.
 */
import {
  addItem,
  arenaOf,
  atRestFire,
  hallKey,
  IDLE_INTENT,
  inDuel,
  inExitZone,
  PICKUP_RADIUS,
  pickupVisibleTo,
  restFire,
  type FighterState,
  type Intent,
  type InventoryRef,
  type MatchState,
  type SimState,
} from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import type { Controller } from './controller';
import { exitDoorSpawn } from './doorSpot';

/** What the autopilot does with loot: 'take' walks onto it and equips it, 'drop' also drops one item once and takes it again. */
export type AutopilotLoot = 'take' | 'drop';

/** The dev autopilot: a Controller that is also told the Match before each Tick (`watch`). */
export interface Autopilot extends Controller {
  watch(match: MatchState): void;
}

/** A drop in progress: the item and how many items the inventory held before (to see it leave), and whether its pickup has been seen. */
interface Dropping {
  readonly ref: InventoryRef;
  readonly item: string;
  readonly before: number;
  seen: boolean;
  away: boolean;
}

const itemCount = (f: FighterState): number => (f.inventory ? f.inventory.weapons.length + f.inventory.relics.length : 0);

class DevAutopilot implements Autopilot {
  private readonly rested = new Set<string>();
  private match: MatchState | null = null;
  private dropping: Dropping | null = null;
  private dropped = false;

  constructor(
    private readonly tuning: TuningData,
    private readonly ai: AiController,
    /** The exit (0-based) to take in each row of a Floor. */
    private readonly doors: readonly number[],
    private readonly loot: AutopilotLoot | null,
  ) {}

  watch(match: MatchState): void {
    this.match = match;
  }

  /** The inventory item to equip now, if any: the lowest Relic not equipped while a Relic slot is free, else the newest Weapon if another is wielded. */
  private equipWant(f: FighterState): InventoryRef | undefined {
    const inv = f.inventory!;
    if (inv.equipped.length < this.tuning.dungeon.inventory.equippedRelics) {
      const slot = inv.relics.findIndex((_, s) => !inv.equipped.includes(s));
      if (slot >= 0) return { kind: 'relic', slot };
    }
    const newest = inv.weapons.length - 1;
    return newest !== inv.weapon ? { kind: 'weapon', slot: newest } : undefined;
  }

  /** The item to drop once: a Relic carried unequipped, else a Weapon not wielded. */
  private dropWant(f: FighterState): InventoryRef | undefined {
    const inv = f.inventory!;
    const relic = inv.relics.findIndex((_, s) => !inv.equipped.includes(s));
    if (relic >= 0) return { kind: 'relic', slot: relic };
    const weapon = inv.weapons.findIndex((_, s) => s !== inv.weapon);
    return weapon >= 0 ? { kind: 'weapon', slot: weapon } : undefined;
  }

  /** What to do about loot in a Cleared Hall this Tick (walking to it, equipping, dropping), or null: nothing left, go on to the exit. */
  private lootIntent(state: SimState, fighter: number, self: FighterState): Intent | null {
    const run = this.match?.run;
    if (!run || !self.inventory || state.hall?.phase !== 'Cleared') return null;
    const walkTo = (at: { x: number; y: number; z: number }, stop: number) => this.ai.walkTo(state, fighter, at, stop);
    const drop = this.dropping;
    if (drop) {
      const lying = run.pickups.find((p) => !p.taken && p.owner === null && p.item === drop.item);
      if (lying) drop.seen = true;
      if (!lying) {
        if (drop.seen || itemCount(self) !== drop.before) {
          // Taken up again (or gone): done.
          this.dropping = null;
          this.dropped = true;
          return null;
        }
        // Refused so far (not Idle yet): ask again.
        return { ...walkTo({ x: self.position.x, y: self.y, z: self.position.z }, Infinity), drop: drop.ref };
      }
      const far = Math.hypot(lying.at.x - self.position.x, lying.at.z - self.position.z) > PICKUP_RADIUS + 0.2;
      if (far) drop.away = true;
      if (!drop.away) {
        // Step off it: onto another of the Hall's Team 1 spawn cells.
        const cells = arenaOf(this.tuning, state.arena).spawns.filter((c) => c.team === 1);
        const cell = cells.find((c) => Math.hypot(c.position.x - lying.at.x, c.position.z - lying.at.z) > PICKUP_RADIUS + 0.3) ?? cells[0];
        return cell ? walkTo(cell.position, 0.1) : null;
      }
      return walkTo(lying.at, 0.1);
    }
    const equip = this.equipWant(self);
    const sizes = this.tuning.dungeon.inventory;
    const here = run.pickups
      .filter((p) => pickupVisibleTo(p, fighter) && p.by !== fighter && addItem(self.inventory!, p, sizes))
      .sort((a, b) => Math.hypot(a.at.x - self.position.x, a.at.z - self.position.z) - Math.hypot(b.at.x - self.position.x, b.at.z - self.position.z) || a.id - b.id)[0];
    if (here) return { ...walkTo(here.at, 0.1), ...(equip && { equip }) };
    if (equip) return { ...IDLE_INTENT, equip, face: null };
    const ref = this.loot === 'drop' && !this.dropped ? this.dropWant(self) : undefined;
    if (!ref) return null;
    const item = ref.kind === 'weapon' ? self.inventory.weapons[ref.slot]! : self.inventory.relics[ref.slot]!;
    this.dropping = { ref, item, before: itemCount(self), seen: false, away: false };
    return { ...IDLE_INTENT, drop: ref, face: null };
  }

  intent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter]!;
    const hall = state.hall;
    if (!hall || hall.phase === 'Fighting' || !inDuel(self)) return this.ai.intent(state, fighter);
    const looting = this.loot ? this.lootIntent(state, fighter, self) : null;
    if (looting) return looting;
    const arena = arenaOf(this.tuning, state.arena);
    const key = hallKey(hall);
    if (hall.kind === 'Rest' && !this.rested.has(key)) {
      if (!atRestFire(arena, self)) return this.ai.walkTo(state, fighter, restFire(arena), 0);
      this.rested.add(key);
    }
    const exits = arena.doors.length - 1;
    if (exits <= 0) return this.ai.walkTo(state, fighter, { x: self.position.x, y: self.y, z: self.position.z }, Infinity);
    const exit = Math.min(this.doors[hall.row] ?? this.doors.at(-1) ?? 0, exits - 1);
    const spot = exitDoorSpawn(arena, exit, state, fighter).position;
    return this.ai.walkTo(state, fighter, spot, inExitZone(arena, exit, self) ? Infinity : 0);
  }

  save(): unknown {
    return this.ai.save();
  }

  load(saved: unknown): void {
    this.ai.load(saved);
  }
}

/** The dev autopilot for the local Player's slot: the AI at `difficulty`, taking exit `doors[row]` (0-based) out of each cleared Hall, and with `loot` taking and equipping what lies there. */
export function createAutopilot(tuning: TuningData, difficulty: string, doors: readonly number[], loot: AutopilotLoot | null = null): Autopilot {
  return new DevAutopilot(tuning, createAiController(tuning, difficulty), doors, loot);
}
