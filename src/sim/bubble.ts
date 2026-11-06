/**
 * The Bubble and the Fighter Pool (docs/plans/big-battle.md, Stages 3 and 4; ADR 0020): in a Battle, `SimState.fighters` is a
 * fixed Pool of `battle.bubble.poolSize` slots. The Players' Fighters hold the first (`players` of them); every other slot
 * is unbound (Benched: out of play, not dead) or bound to a Soldier (`FighterState.soldier`, and the Soldier's `crowd.slot`).
 *
 * `stepBubbles` runs at the start of each Battle Tick, before the Fighters step, and decides everything from Simulation
 * positions only, so every peer promotes alike and a Rollback re-simulates it like any other step (ADR 0019's "choices by
 * walking"). In order:
 *  - taking over an ally (Stage 5): a Player's Fighter that fell kills its Soldier if it had taken one over.
 *    `takeover.pickSeconds` after its fall the Soldier it will take over is chosen (`BattlePlayer.next`): the living ally
 *    Soldier nearest one of its Team's spawns (`takeoverSpawns`), in the Crowd or a promoted ally. `takeover.seconds` after
 *    its fall the Player takes it over (or, if it is gone by then, the one nearest a spawn then; a promoted ally keeps its
 *    Fighter as it stands): it becomes the Player's Fighter in the Player's slot, with the generic
 *    soldier's Weapon and `takeover.hp` HP (and max HP), whatever the Soldier had. The fallen Fighter lies on: the Player's own chosen Fighter in a free Pool
 *    slot to the Battle's end (`BattlePlayer.corpse`), a Soldier it had taken over in the Crowd. With no living ally left
 *    the Player is out: its Fighter just lies there;
 *  - a promoted Fighter that fell kills its Soldier (where it fell, facing its way, 0 HP), and `corpseSeconds` after its
 *    fall its slot frees, the Soldier lying in the Crowd;
 *  - Demotion: a promoted Fighter further than `demote` from every Player's Fighter in play, Idle on the ground, at least
 *    `minPromotedSeconds` after its Promotion, writes its position, heading and HP back to its Soldier and frees its slot;
 *  - Attack Slots: a promoted enemy holding one (`SoldierRole` `Attack`) that a promoted ally engages (one within
 *    `slots.engaged`, nearer it than any Player; each ally engages one enemy at most) lets it go (`Waiting`). Then each Bubble fills its free Attack Slots (at
 *    most `slots.enemies` held at once), nearest its Player first, from its waiting enemies within `promote`: a `Waiting`
 *    Fighter no ally engages takes one back where it stands, and a living Soldier of a Team that has not routed is promoted
 *    into a free Pool slot. A `Waiting` Fighter left with no slot and no ally on it demotes as soon as its Action allows,
 *    wherever it is (it waits at the ring as a Soldier);
 *  - allies: an ally whose Bubble has no enemy full Fighter left demotes as soon as its Action allows; each Bubble with an
 *    Attack Slot held promotes its Player's allied Soldiers within `promote`, nearest the slot-holding enemies first, up to
 *    `slots.allies` (`Ally`).
 * A promoted enemy counts in the Bubble of its nearest enemy Player, an ally in its nearest Team-mate's (the lower slot on
 * a tie). Overlapping Bubbles share the Pool: while several are in use, each holds fewer Attack Slots and ally slots
 * (`slots.shared`, Stage 6), so their Players and slots always fit it. Past its share (more Bubbles came into use, or a Fighter
 * came nearer another Bubble's Player), a Bubble's slot-holders farthest from its Player let their Attack Slots go, and its
 * farthest allies demote as soon as they may. A Player who left an online Battle (`BattlePlayer.away`) has no Bubble: an AI
 * drives its Fighter as an ally of its Team, and it takes over no Soldier when it falls. A promoted Fighter starts at guard
 * where its Soldier stands, facing its heading, with its Team and HP, the generic soldier's Weapon (`battle.soldier`), and a
 * Soldier's max HP. On a hand-built map (docs/plans/battle-objectives.md, Stage 4a) a Soldier more than `levels.promote` above or below a
 * Player's Fighter is never promoted into its Bubble (Promotion goes by the distance across the ground, so nobody is promoted through a
 * floor), and a Demotion stands its Soldier on the Walk Surface its Fighter stood on. Pure.
 */
import { bubbleSlots, type Size, type TuningData } from '../tuning';
import { arenaOf } from './arena';
import { battlefieldHeight, battlefieldOf, groundOf, soldierHeight } from './battlefield';
import { secondsToTicks } from './constants';
import { soldierSize, troopOf, type BattlePlayer, type CrowdState } from './crowd';
import type { Battlefield, MapPoint } from './battlefield';
import { inDuel } from './duel';
import { foldMods, isNoMods } from './mods';
import type { FighterState, SimState, SoldierRole } from './state';
import { standingFighter } from './step';

/** Whether two Sizes are the same body (absent: the standard one). */
const sameSize = (a: Size | undefined, b: Size | undefined): boolean => (a?.height ?? 1) === (b?.height ?? 1) && (a?.thick ?? 1) === (b?.thick ?? 1);

/** Whether a Pool slot is bound to a Soldier. */
export const isBound = (f: FighterState): boolean => f.soldier !== undefined;

/**
 * Whether Fighter `k` of a Battle, if in play, is a Player's with a Bubble: not bound to a Soldier, and its Player still plays (not
 * `BattlePlayer.away`). A Player's Fighter an AI took over fights on as an ally of its Team, as a promoted Soldier does.
 */
export const bubblePlayer = (duel: SimState, k: number): boolean => duel.fighters[k]?.soldier === undefined && !duel.crowd?.players[k]?.away;

/** An unbound Pool slot: Benched (0 HP, out of play) at the field's centre, wielding the generic soldier's Weapon. */
export function unboundSlot(tuning: TuningData, arena: string): FighterState {
  const geometry = arenaOf(tuning, arena);
  const y = battlefieldOf(tuning.battle, arena)?.heights;
  return { ...standingFighter(tuning, geometry, { position: { x: 0, z: 0 }, y: y ? battlefieldHeight(y, 0, 0) : 0, facing: 0 }, tuning.battle.soldier.weapon, 1), hp: 0, benched: true };
}

/** A Bubble: where its Player's Fighter stands (its feet's height too), and its Team. */
interface Centre {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly team: number;
}

/** Each Bubble: each Player's Fighter (the first `players` slots) still in the fight, but a Player's who left (`BattlePlayer.away`). */
function bubbleCentres(fighters: readonly FighterState[], players: number, crowd: CrowdState): Centre[] {
  return fighters.slice(0, players).flatMap((f, k) => (inDuel(f) && !crowd.players[k]?.away ? [{ x: f.position.x, z: f.position.z, y: f.y, team: f.team }] : []));
}

/** Whether a promoted Fighter's Action lets it demote: Idle (standing or walking) on the ground. */
const demotable = (f: FighterState): boolean => f.action.kind === 'Idle' && !f.air;

/** The Bubble (an index into `centres`) nearest (x, z) whose Player is of Team `team` (`ally`) or of the other Team, or -1 with none. */
function nearestCentre(centres: readonly Centre[], x: number, z: number, team: number, ally: boolean): number {
  let best = -1;
  let bestD = Infinity;
  centres.forEach((c, i) => {
    if ((c.team === team) !== ally) return;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** Whether Soldier `s` can be taken over by a Player of Team `team`: a living ally in the Crowd, or a promoted ally (`Ally`) still in the fight; never a Player's. */
function canTakeOver(fighters: readonly FighterState[], crowd: CrowdState, players: number, team: number, s: number): boolean {
  if (s < 0 || s >= crowd.x.length || !crowd.alive[s] || crowd.team[s] !== team) return false;
  const k = crowd.slot[s]!;
  return k < 0 || (k >= players && fighters[k]!.soldier?.role === 'Ally' && inDuel(fighters[k]!));
}

/**
 * Where a fallen Player of Team `team` comes back near: the spawn Objectives its Team owns with no enemy Soldier in their circle,
 * and its Base. A Squad respawns at the same places.
 */
export function takeoverSpawns(crowd: CrowdState, field: Battlefield, team: number): MapPoint[] {
  const out: MapPoint[] = [];
  field.objectives.forEach((site, k) => {
    if (!site.spawn || crowd.objectives.owner[k] !== team) return;
    for (let s = 0; s < crowd.x.length; s++)
      if (crowd.alive[s] && crowd.team[s] !== team && (crowd.x[s]! - site.x) ** 2 + (crowd.z[s]! - site.z) ** 2 <= site.radius * site.radius) return;
    out.push({ x: site.x, z: site.z });
  });
  out.push(field.bases[team as 0 | 1]!);
  return out;
}

/**
 * The living ally Soldier a fallen Player of Team `team` takes over: the one nearest any of `spawns` (`takeoverSpawns`), in the
 * Crowd or a promoted ally (never a Player's), the lowest index on a tie; -1 if there is none.
 */
function nearestAlly(fighters: readonly FighterState[], crowd: CrowdState, players: number, team: number, spawns: readonly MapPoint[]): number {
  let best = -1;
  let bestD = Infinity;
  for (let s = 0; s < crowd.x.length; s++) {
    if (!canTakeOver(fighters, crowd, players, team, s)) continue;
    const k = crowd.slot[s]!;
    const at = k >= 0 ? fighters[k]!.position : { x: crowd.x[s]!, z: crowd.z[s]! };
    let d = Infinity;
    for (const p of spawns) d = Math.min(d, (at.x - p.x) ** 2 + (at.z - p.z) ** 2);
    if (d < bestD) [best, bestD] = [s, d];
  }
  return best;
}

/**
 * The Soldier fallen Player `p` will take over: the one chosen at `takeover.pickSeconds` (`BattlePlayer.next`) while it can
 * still be, else the one `stepBubbles` would pick now; -1 if there is none (or `p` is no fallen Player). For the view, which
 * flies to it before the takeover.
 */
export function takeoverTarget(duel: SimState, p: number, tuning: TuningData): number {
  const crowd = duel.crowd;
  const f = duel.fighters[p];
  const record = crowd?.players[p];
  if (!crowd || !f?.death || !record || record.away) return -1;
  const players = crowd.players.length;
  if (record.next !== undefined && canTakeOver(duel.fighters, crowd, players, f.team, record.next)) return record.next;
  return nearestAlly(duel.fighters, crowd, players, f.team, takeoverSpawns(crowd, battlefieldOf(tuning.battle, duel.arena)!, f.team));
}

/**
 * The Bubbles' step for the Tick `tick` (the one about to be stepped: `duel.tick + 1`), with the first `players` slots the
 * Players' Fighters. A state without a Crowd is returned as it is.
 */
export function stepBubbles(duel: SimState, players: number, tick: number, tuning: TuningData): SimState {
  const before = duel.crowd;
  if (!before) return duel;
  const { bubble, slots } = tuning.battle;
  const minTicks = secondsToTicks(bubble.minPromotedSeconds);
  const corpseTicks = secondsToTicks(bubble.corpseSeconds);
  const field = battlefieldOf(tuning.battle, duel.arena)!;

  let fighters: FighterState[] | null = null;
  let crowd: { -readonly [K in keyof CrowdState]: CrowdState[K] extends readonly number[] ? number[] : CrowdState[K] extends readonly BattlePlayer[] ? BattlePlayer[] : CrowdState[K] } | null = null;
  const edit = () => {
    fighters ??= duel.fighters.slice();
    crowd ??= {
      ...before,
      x: before.x.slice(),
      z: before.z.slice(),
      surface: before.surface.slice(),
      vx: before.vx.slice(),
      vz: before.vz.slice(),
      heading: before.heading.slice(),
      hp: before.hp.slice(),
      team: before.team as number[],
      sizeHeight: before.sizeHeight as number[],
      sizeThick: before.sizeThick as number[],
      troop: before.troop as number[],
      look: before.look as number[],
      target: before.target.slice(),
      engage: before.engage.slice(),
      alive: before.alive.slice(),
      slot: before.slot.slice(),
      squad: before.squad.slice(),
      place: before.place.slice(),
      tickets: before.tickets.slice(),
      players: before.players.slice(),
    };
    return { fighters, crowd };
  };
  /** The Pool and the Crowd as they stand so far in this step. */
  const pool = (): readonly FighterState[] => fighters ?? duel.fighters;
  const soldiers = (): CrowdState => crowd ?? before;
  /** Soldier `s` takes Fighter `f`'s place (on a hand-built map, on the Walk Surface under its feet), heading and HP, standing, engaged with no one. */
  const writeBack = (c: NonNullable<typeof crowd>, s: number, f: FighterState) => {
    c.x[s] = f.position.x;
    c.z[s] = f.position.z;
    const on = groundOf(tuning.battle, field, f.position.x, f.position.z, f.y);
    if (on >= 0) c.surface[s] = on;
    c.heading[s] = f.facing;
    c.hp[s] = f.hp;
    c.vx[s] = 0;
    c.vz[s] = 0;
    c.target[s] = -1;
    c.engage[s] = 0;
  };

  let unbound: FighterState | null = null;
  const free = () => (unbound ??= unboundSlot(tuning, duel.arena));
  /** Slot `k`'s Fighter goes back to the Crowd: its Soldier takes its place, heading and HP, and the slot is unbound. */
  const demote = (k: number) => {
    const e = edit();
    const f = e.fighters[k]!;
    writeBack(e.crowd, f.soldier!.index, f);
    e.crowd.slot[f.soldier!.index] = -1;
    e.fighters[k] = free();
  };
  const demotesNow = (f: FighterState) => tick - f.soldier!.since >= minTicks && demotable(f);
  /** The first unbound (Benched) slot after the Players', or -1. A Player's corpse is neither bound nor Benched: never free. */
  const openSlot = () => {
    const p = pool();
    for (let k = players; k < p.length; k++) if (p[k]!.benched && !isBound(p[k]!)) return k;
    return -1;
  };
  /**
   * Soldier `s` as a full Fighter at guard where it stands, facing its heading, with its Team and HP and its Troop's Weapon, in
   * its own Size (`soldierSize`), or in `size` (a Player taking it over keeps the Player's own: absent for the standard body).
   */
  const fighterOf = (c: NonNullable<typeof crowd>, s: number, size?: Size | null): FighterState => {
    const at = { x: c.x[s]!, z: c.z[s]! };
    const geometry = arenaOf(tuning, duel.arena);
    const f = standingFighter(tuning, geometry, { position: at, y: soldierHeight(field, c.surface[s]!, at.x, at.z), facing: c.heading[s]! }, troopOf(tuning.battle, c, s).weapon, c.team[s]!, size === undefined ? soldierSize(c, s) : (size ?? undefined));
    return { ...f, hp: c.hp[s]!, maxHp: troopOf(tuning.battle, c, s).hp };
  };
  /** Fighter `f` (a promoted ally a Player takes over) re-made at guard where it stands, with its HP, in a body of `size`. */
  const resized = (f: FighterState, size: Size | undefined): FighterState => {
    const made = standingFighter(tuning, arenaOf(tuning, duel.arena), { position: f.position, y: f.y, facing: f.facing }, f.weapon, f.team, size);
    return { ...made, hp: f.hp, maxHp: f.maxHp };
  };
  /** A promoted Soldier's Mods (its Troop's), when they change anything: one record per Troop. */
  const troopMods = tuning.battle.troops.map((t) => {
    const folded = foldMods([{ effects: t.mods }]);
    return isNoMods(folded) ? {} : { mods: folded };
  });
  const modded = (c: CrowdState, s: number) => troopMods[c.troop[s] ?? 0] ?? troopMods[0]!;

  // Taking over an ally: a Player's fallen Fighter kills its Soldier, and later the Player plays on as the nearest living ally.
  const takeoverTicks = secondsToTicks(tuning.battle.takeover.seconds);
  const pickTicks = secondsToTicks(tuning.battle.takeover.pickSeconds);
  const takeoverHp = tuning.battle.takeover.hp;
  for (let p = 0; p < players; p++) {
    const f = duel.fighters[p]!;
    const record = before.players[p];
    if (!f.death || !record) continue;
    if (record.soldier >= 0 && soldiers().alive[record.soldier]) {
      const e = edit();
      writeBack(e.crowd, record.soldier, f);
      e.crowd.hp[record.soldier] = 0;
      e.crowd.alive[record.soldier] = 0;
    }
    // A Player who left takes over no one: an AI drives its Fighter, and it just lies there.
    if (record.away || tick - f.death.tick < pickTicks) continue;
    const chosen = record.next !== undefined && canTakeOver(pool(), soldiers(), players, f.team, record.next) ? record.next : -1;
    if (tick - f.death.tick < takeoverTicks) {
      // The Soldier to take over is chosen (and the view flies to it): kept while it can still be taken, chosen again if not.
      if (chosen >= 0) continue;
      const pick = nearestAlly(pool(), soldiers(), players, f.team, takeoverSpawns(soldiers(), field, f.team));
      if (pick < 0 || pick === record.next) continue;
      const e = edit();
      e.crowd.players[p] = { ...record, next: pick };
      continue;
    }
    const s = chosen >= 0 ? chosen : nearestAlly(pool(), soldiers(), players, f.team, takeoverSpawns(soldiers(), field, f.team));
    if (s < 0) continue;
    const e = edit();
    const k = e.crowd.slot[s]!;
    // The Player keeps its own Size (its fallen Fighter's), whatever the Soldier's.
    const own = f.size ?? null;
    if (k >= 0) {
      // A promoted ally: its Fighter, as it stands, becomes the Player's; its slot frees. One of another Size stands at guard where it was, re-made in the Player's.
      const { soldier: _binding, mods: _mods, ...ally } = e.fighters[k]!;
      e.fighters[p] = sameSize(ally.size, f.size) ? ally : resized(ally, f.size);
      e.fighters[k] = free();
    } else e.fighters[p] = fighterOf(e.crowd, s, own);
    // The Player comes back fresh: `takeover.hp`, whatever the Soldier had left.
    e.fighters[p] = { ...e.fighters[p]!, hp: takeoverHp, maxHp: takeoverHp };
    // The Soldier is the Player's body now: its impostor (once it falls) is drawn in the Player's Size too.
    e.crowd.sizeHeight = e.crowd.sizeHeight.slice();
    e.crowd.sizeThick = e.crowd.sizeThick.slice();
    e.crowd.sizeHeight[s] = f.size?.height ?? 1;
    e.crowd.sizeThick[s] = f.size?.thick ?? 1;
    e.crowd.slot[s] = p;
    // A taken-over Soldier leaves its Squad (a free agent, as Players are): the Squad goes on one short.
    e.crowd.squad[s] = -1;
    let corpse = record.corpse;
    if (record.soldier >= 0) e.crowd.slot[record.soldier] = -1;
    else {
      corpse = openSlot();
      if (corpse >= 0) e.fighters[corpse] = f;
    }
    const { next: _next, ...rest } = record;
    e.crowd.players[p] = { ...rest, soldier: s, taken: record.taken + 1, corpse } satisfies BattlePlayer;
  }

  const centres = bubbleCentres(pool(), players, soldiers());
  // Each Bubble's slots, shrunk while several are in use so they share the Pool.
  const budget = bubbleSlots(slots, centres.length);
  const farFromAll = (f: FighterState) => centres.every((c) => Math.hypot(f.position.x - c.x, f.position.z - c.z) > bubble.demote);

  for (let k = players; k < duel.fighters.length; k++) {
    const f = duel.fighters[k]!;
    const s = f.soldier?.index;
    if (s === undefined) continue;
    if (f.death) {
      if (before.alive[s]) {
        const e = edit();
        writeBack(e.crowd, s, f);
        e.crowd.hp[s] = 0;
        e.crowd.alive[s] = 0;
      }
      if (tick - f.death.tick >= corpseTicks) {
        const e = edit();
        e.crowd.slot[s] = -1;
        e.fighters[k] = free();
      }
    } else if (demotesNow(f) && farFromAll(f)) demote(k);
  }

  if (centres.length > 0) {
    /** The promoted Fighters still fighting (bound, not fallen), as slots. */
    const promoted = (): number[] => {
      const out: number[] = [];
      pool().forEach((f, k) => {
        if (k >= players && isBound(f) && inDuel(f)) out.push(k);
      });
      return out;
    };
    const roleOf = (k: number): SoldierRole => pool()[k]!.soldier!.role;
    /** The Bubble a promoted Fighter counts in: an enemy's nearest enemy Player's, an ally's nearest Team-mate's. */
    const bubbleOf = (k: number) => {
      const f = pool()[k]!;
      return nearestCentre(centres, f.position.x, f.position.z, f.team, f.soldier!.role === 'Ally');
    };
    /**
     * The promoted enemies a promoted ally engages, one enemy to an ally: an ally within `slots.engaged` of an enemy, nearer
     * it than any Player's Fighter, pairs with it. Pairs are made closest first, but an enemy already Waiting before one
     * still holding a slot, so a pair holds while it lasts (then the lower slots). Decided once a step, from where they stand.
     */
    const engaged = new Set<number>();
    {
      const pairs: { k: number; a: number; d: number; held: number }[] = [];
      const live = promoted();
      for (const k of live) {
        const f = pool()[k]!;
        if (roleOf(k) === 'Ally') continue;
        let player = Infinity;
        for (const c of centres) if (c.team !== f.team) player = Math.min(player, Math.hypot(c.x - f.position.x, c.z - f.position.z));
        for (const a of live) {
          const g = pool()[a]!;
          if (roleOf(a) !== 'Ally' || g.team === f.team) continue;
          const d = Math.hypot(g.position.x - f.position.x, g.position.z - f.position.z);
          if (d <= slots.engaged && d < player) pairs.push({ k, a, d, held: roleOf(k) === 'Waiting' ? 0 : 1 });
        }
      }
      pairs.sort((p, q) => p.held - q.held || p.d - q.d || p.k - q.k || p.a - q.a);
      const busy = new Set<number>();
      for (const { k, a } of pairs) {
        if (engaged.has(k) || busy.has(a)) continue;
        engaged.add(k);
        busy.add(a);
      }
    }
    const engagedByAlly = (k: number) => engaged.has(k);
    /** Slot `k`'s Fighter takes `role`. */
    const assign = (k: number, role: SoldierRole) => {
      const e = edit();
      const f = e.fighters[k]!;
      e.fighters[k] = { ...f, soldier: { ...f.soldier!, role } };
    };
    /** Soldier `s` takes slot `k` as a Fighter at guard, holding `role`. */
    const promote = (s: number, k: number, role: SoldierRole) => {
      const e = edit();
      e.fighters[k] = { ...fighterOf(e.crowd, s), ...modded(e.crowd, s), soldier: { index: s, since: tick, role } };
      e.crowd.slot[s] = k;
    };
    /**
     * Whether Soldier `s` may promote into Bubble `b`, as an ally of its Player or an enemy: in the Crowd, living, its Team not
     * routed, within `promote` of the Player's Fighter and no nearer another Bubble of that kind; on a hand-built map, no more than
     * `levels.promote` above or below it (never through a floor).
     */
    const promotable = (s: number, b: number, ally: boolean) => {
      const c = soldiers();
      const centre = centres[b]!;
      if (!c.alive[s] || c.slot[s]! >= 0 || c.rout?.team === c.team[s] || (c.team[s] === centre.team) !== ally) return false;
      if (Math.hypot(c.x[s]! - centre.x, c.z[s]! - centre.z) > bubble.promote) return false;
      if (field.heights.walk && Math.abs(soldierHeight(field, c.surface[s]!, c.x[s]!, c.z[s]!) - centre.y) > tuning.battle.levels.promote) return false;
      return nearestCentre(centres, c.x[s]!, c.z[s]!, c.team[s]!, ally) === b;
    };

    // A slot-holding enemy a promoted ally engages lets its Attack Slot go.
    for (const k of promoted()) if (roleOf(k) === 'Attack' && engagedByAlly(k)) assign(k, 'Waiting');
    /** A Bubble's promoted Fighters of `role`, nearest its Player first (the lower slot on a tie). */
    const nearestIn = (b: number, role: SoldierRole) => {
      const c = centres[b]!;
      const away = (k: number) => Math.hypot(pool()[k]!.position.x - c.x, pool()[k]!.position.z - c.z);
      return promoted()
        .filter((k) => roleOf(k) === role && bubbleOf(k) === b)
        .sort((p, q) => away(p) - away(q) || p - q);
    };
    // No Bubble holds more than its share (as when more Bubbles come into use, or a slot-holder comes nearer another Bubble's Player):
    // the slot-holders farthest from its Player let their Attack Slots go.
    centres.forEach((_, b) => {
      for (const k of nearestIn(b, 'Attack').slice(budget.enemies)) assign(k, 'Waiting');
    });

    // Each Bubble fills its free Attack Slots, nearest its Player first: a Waiting Fighter no ally engages, or a Soldier.
    centres.forEach((c, b) => {
      const mine = promoted().filter((k) => roleOf(k) !== 'Ally' && bubbleOf(k) === b);
      let open = budget.enemies - mine.filter((k) => roleOf(k) === 'Attack').length;
      if (open <= 0) return;
      const near: { k: number; s: number; d: number }[] = [];
      for (const k of mine) {
        const f = pool()[k]!;
        const d = Math.hypot(f.position.x - c.x, f.position.z - c.z);
        if (roleOf(k) === 'Waiting' && d <= bubble.promote && !engagedByAlly(k)) near.push({ k, s: f.soldier!.index, d });
      }
      const c0 = soldiers();
      for (let s = 0; s < c0.x.length; s++) if (promotable(s, b, false)) near.push({ k: -1, s, d: Math.hypot(c0.x[s]! - c.x, c0.z[s]! - c.z) });
      // Nearest first; on a tie a Fighter already promoted, then the lower Soldier.
      near.sort((p, q) => p.d - q.d || (p.k < 0 ? 1 : 0) - (q.k < 0 ? 1 : 0) || p.s - q.s);
      for (const n of near) {
        if (open <= 0) break;
        if (n.k >= 0) assign(n.k, 'Attack');
        else {
          const k = openSlot();
          if (k < 0) continue;
          promote(n.s, k, 'Attack');
        }
        open--;
      }
    });

    // A Waiting Fighter with no slot and no ally on it goes back to the Crowd as soon as it may, to wait at the ring.
    for (const k of promoted()) if (roleOf(k) === 'Waiting' && demotesNow(pool()[k]!) && !engagedByAlly(k)) demote(k);

    // Allies: one with no enemy full Fighter left in its Bubble goes back to the Crowd as soon as it may; while an enemy holds
    // an Attack Slot, each Bubble promotes its Player's allied Soldiers, nearest the slot-holders first.
    const enemiesIn = (b: number, roles: readonly SoldierRole[]) => promoted().filter((k) => roles.includes(roleOf(k)) && bubbleOf(k) === b);
    for (const k of promoted()) if (roleOf(k) === 'Ally' && demotesNow(pool()[k]!) && enemiesIn(bubbleOf(k), ['Attack', 'Waiting']).length === 0) demote(k);
    // An ally past its Bubble's share (the farthest from its Player) goes back to the Crowd as soon as it may.
    centres.forEach((_, b) => {
      for (const k of nearestIn(b, 'Ally').slice(budget.allies)) if (demotesNow(pool()[k]!)) demote(k);
    });
    centres.forEach((_, b) => {
      const holders = enemiesIn(b, ['Attack']).map((k) => pool()[k]!.position);
      let open = budget.allies - promoted().filter((k) => roleOf(k) === 'Ally' && bubbleOf(k) === b).length;
      if (holders.length === 0 || open <= 0) return;
      const c0 = soldiers();
      const near: { s: number; d: number }[] = [];
      for (let s = 0; s < c0.x.length; s++) if (promotable(s, b, true)) near.push({ s, d: Math.min(...holders.map((p) => Math.hypot(c0.x[s]! - p.x, c0.z[s]! - p.z))) });
      near.sort((p, q) => p.d - q.d || p.s - q.s);
      for (const n of near) {
        const k = openSlot();
        if (open <= 0 || k < 0) break;
        promote(n.s, k, 'Ally');
        open--;
      }
    });
  }

  if (!fighters) return duel;
  return { ...duel, fighters, crowd: crowd! };
}
