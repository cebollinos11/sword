/**
 * A Delver Run (docs/plans/delver.md, Stage 2): the Gauntlet Format's Run on generated Floors, one Duel a Floor. Team 0 spawns at the
 * Floor's Entrance and the Floor is `floorArenaName(runSeed(config.arena), floor)`, built from that name alone (`floorOf`), so every peer
 * deals the same Floor with nothing sent. `floorDuel` makes a Floor's Duel (Team 0's HP, Inventory and Mods carried, the fallen revived, then
 * the Fighter Pool's unbound slots and the Floor's Crowd of Warbands), `enterFloor` the Run's state on it, and `stepDelver` steps it: the fade
 * to the next Floor, the Bubbles, the Duel and the Crowd under the Floor's Tuning Data (`arenaTuning`), and a wipe of Team 0, a Defeat. This
 * file imports `match.ts` for types only.
 */
import type { TuningData } from '../tuning';
import { arenaOf } from './arena';
import { secondsToTicks } from './constants';
import { crowdFighters } from './battle';
import { stepBubbles, unboundSlot, type BossHold } from './bubble';
import { treasurePickups, warbandDrops } from './delverLoot';
import { stepCrowd, type CrowdState } from './crowd';
import { battleMapOf } from './destinations';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { deployWarbands, warbandHomes } from './delver/warbands';
import { BOSS, warbandBrain } from './warband';
import type { FloorPlan } from './delver/plan';
import { runSeed } from './dungeon';
import { inDuel } from './duel';
import { doorCounters, doorTicksNeeded, presentPlayers, runPlayers, standsWithin, ZONE_HEIGHT } from './hall';
import { holdInventory, startingInventory, useInventory, withStartingRelics, wieldedWeapon } from './inventory';
import type { Intent } from './intent';
import type { MatchConfig, MatchEvent, MatchState } from './match';
import { NO_MODS, setMods } from './mods';
import { placeDrop, takePickups, type Pickup } from './pickups';
import type { Placement } from './skeleton';
import type { FighterState, SimDelver, DelverPhase, SimState } from './state';
import { createInitialState, standingFighter, step } from './step';

/** One fire of the current Floor (`plan.markers.fires` order): whether its revive is spent (only by reviving someone), and which Players took its heal. */
export interface RestUse {
  readonly revived: boolean;
  /** Fighter indices, ascending. */
  readonly healed: readonly number[];
}

/** A Delver Run's progress (`MatchState.delver`, docs/plans/delver.md). Becomes `RunState` in Stage 8. */
export interface DelverRun {
  /** The Floor (1-based). */
  readonly floor: number;
  /** `delver.tiers × delver.floorsPerTier`, fixed at the start. */
  readonly floors: number;
  readonly phase: DelverPhase;
  /** Ticks in a row every counted Fighter stood in the Stairs zone; 0 when one is out; kept while Descending. */
  readonly stairsTicks: number;
  /** One per fire of the Floor. */
  readonly restUsed: readonly RestUse[];
  /** The Warbands (Squad indices of the Floor's Crowd) whose wipe was seen on this Floor, ascending; `[]` on each new Floor. */
  readonly wiped: readonly number[];
  /** The items lying on the Floor: its Treasure Halls' pedestals from its start, a wiped Warband's drops and inventory drops; only the new Floor's pedestals on each new Floor. */
  readonly pickups: readonly Pickup[];
  /** The Match Tick the Run started on. */
  readonly startTick: number;
  /** The Players an AI Takeover has taken (ascending), as `RunState.away`; absent while nobody has left. Mirrored on `SimDelver.away`. */
  readonly away?: readonly number[];
}

/** The facing (radians; 0 faces +z) into a Passage on each side of a Hall, in the order the Entrance's first doorway is looked for. */
const SIDE_FACING = [
  ['n', 0],
  ['e', Math.PI / 2],
  ['s', Math.PI],
  ['w', -Math.PI / 2],
] as const;

/** The facing of the Floor's Entrance Hall's first doorway (n, e, s, w): the way Team 0 looks as the Floor starts. */
function entranceFacing(plan: FloorPlan): number {
  const { doors } = plan.halls[plan.entrance]!;
  for (const [side, facing] of SIDE_FACING) if ((doors[side] ?? 0) > 0) return facing;
  return 0;
}

/**
 * A Delver Run's Duel on Floor `floor`: the party (`config.teams`, all Team 0) in slots 0 to k - 1, the k-th at the Entrance's k-th spawn facing
 * into its Passage, then the Fighter Pool's other slots unbound (`bubble.poolSize` in all), and the Floor's Crowd of Warbands deployed at its posts
 * and loops (`deployWarbands`, sized by `config.humans`). Team 0 keeps its HP, Inventory and Mods from `previous` (the Floor before; null for the first:
 * full HP, a Player holding `startingInventory` and the dev `relics`), a fallen Fighter back at `dungeon.revive` of its max HP: taking the Stairs
 * revives the fallen, and nobody is healed. Pure.
 */
export function floorDuel(tuning: TuningData, config: MatchConfig, floor: number, previous: SimState | null, rng: SimState['rng'], relics: readonly string[] = []): SimState {
  const arena = floorArenaName(runSeed(config.arena), floor);
  const t = arenaTuning(tuning, arena);
  const floorBuilt = floorOf(tuning, arena)!;
  const { plan } = floorBuilt;
  const { spawns } = plan.markers;
  const facing = entranceFacing(plan);
  const placements = config.teams.map((_, k): Placement => {
    const spawn = spawns[k]!;
    return { position: { x: spawn.x, z: spawn.z }, y: 0, facing };
  });
  const players = runPlayers(config);
  const inventories = config.teams.map((_, i) => {
    const held = previous?.fighters[i]?.inventory;
    return held ?? (players.includes(i) ? withStartingRelics(startingInventory(config.weapons[i]!), relics, tuning) : undefined);
  });
  const weapons = config.weapons.map((w, i) => (inventories[i] ? wieldedWeapon(inventories[i]!) : w));
  const base = createInitialState(t, 0, placements, weapons, config.teams, arena, config.sizes);
  const { revive } = tuning.dungeon;
  const fighters = base.fighters.map((f, i) => {
    const before = previous?.fighters[i];
    const inventory = inventories[i];
    const armed = inventory ? holdInventory(f, inventory, tuning) : setMods(f, NO_MODS, tuning.fighter.maxHp);
    if (!before) return { ...armed, hp: armed.maxHp };
    return { ...armed, hp: inDuel(before) ? Math.min(armed.maxHp, before.hp) : revive * armed.maxHp };
  });
  const away = previous?.delver?.away;
  const pool = t.battle.bubble.poolSize - fighters.length;
  const unbound = unboundSlot(t, arena);
  const crowd = deployWarbands(t, plan, floorBuilt.field, runSeed(config.arena), floor, config.humans);
  return { ...base, rng, fighters: [...fighters, ...new Array<FighterState>(pool).fill(unbound)], crowd, delver: { floor, phase: 'Exploring', pickups: [], ...(away === undefined ? {} : { away }) } };
}

/**
 * The Run on entering Floor `floor` (`plan` its plan): Exploring, nothing counted, one unspent fire per fire of the Floor, no Warband wiped, and
 * `pickups` lying (the Floor's pedestals, `treasurePickups`; whatever lay on the Floor before is gone).
 */
export function enterFloor(run: Pick<DelverRun, 'floors' | 'startTick' | 'away'>, floor: number, plan: FloorPlan, pickups: readonly Pickup[]): DelverRun {
  return {
    floor,
    floors: run.floors,
    phase: 'Exploring',
    stairsTicks: 0,
    restUsed: plan.markers.fires.map(() => ({ revived: false, healed: [] })),
    wiped: [],
    pickups,
    startTick: run.startTick,
    ...(run.away === undefined ? {} : { away: run.away }),
  };
}

/** Whether the Fighter stands in the plan's Stairs zone: inside its rect, edges included, y within (-0.5, ZONE_HEIGHT). */
export function inStairs(plan: FloorPlan, f: Pick<FighterState, 'position' | 'y'>): boolean {
  const { x0, x1, z0, z1 } = plan.markers.stairs.zone;
  const { x, z } = f.position;
  return f.y > -0.5 && f.y < ZONE_HEIGHT && x >= x0 && x <= x1 && z >= z0 && z <= z1;
}

/** The index of the first fire (`plan.markers.fires` order) the Fighter stands within `radius` of (ground y 0), or -1. */
export function fireAt(plan: FloorPlan, f: Pick<FighterState, 'position' | 'y'>, radius: number): number {
  return plan.markers.fires.findIndex((fire) => standsWithin({ x: fire.x, y: 0, z: fire.z }, radius, f));
}

/** Where the j-th Fighter a fire revives stands round it (m): the corners of a 3 m square, so none lands on another. */
const REVIVE_DX = [-1.5, 1.5, -1.5, 1.5];
const REVIVE_DZ = [-1.5, -1.5, 1.5, 1.5];

/** The Run mirrored for the Controllers (`SimState.delver`): the pickups are the very array the Run holds. */
function mirrored(run: DelverRun): SimDelver {
  return { floor: run.floor, phase: run.phase, pickups: run.pickups, ...(run.away === undefined ? {} : { away: run.away }) };
}

/** `duel` with the Run's mirror (`SimState.delver`) set to `run`'s, as the Floor's entry leaves it. */
export function withMirror(duel: SimState, run: DelverRun): SimState {
  return { ...duel, delver: mirrored(run) };
}

/** The Run on entering Floor `floor` with its Duel: the plan's pedestals for each present Player, and the Duel's mirror set. */
function startFloor(tuning: TuningData, config: MatchConfig, run: Pick<DelverRun, 'floors' | 'startTick' | 'away'>, floor: number, duel: SimState): { run: DelverRun; duel: SimState } {
  const plan = floorOf(tuning, duel.arena)!.plan;
  const entered = enterFloor(run, floor, plan, treasurePickups(arenaTuning(tuning, duel.arena), config, plan, runSeed(config.arena), floor, run.away));
  return { run: entered, duel: withMirror(duel, entered) };
}

/** The Floor's Run and Duel at its start, for `createMatch` (Floor 1, nobody away). */
export function firstFloor(tuning: TuningData, config: MatchConfig, floors: number, duel: SimState): { run: DelverRun; duel: SimState } {
  return startFloor(tuning, config, { floors, startTick: 0 }, 1, duel);
}

/**
 * The Bubbles' Boss rule for a Floor (docs/plans/delver.md, Stage 4), or undefined when the Floor has no Boss Warband: `soldier` is the lowest Crowd
 * index whose Squad is the Warband of rank BOSS, and `hold` is whether some present Player's Fighter (in the Duel, hp above 0) stands inside the Boss
 * Hall's `rect` (edges included, flat) while that Hall is the Boss Hall. Pure: derived each Tick, never state.
 */
export function bossHold(plan: FloorPlan, crowd: CrowdState, fighters: readonly FighterState[], config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, away?: readonly number[]): BossHold | undefined {
  const q = crowd.warbands?.rank.indexOf(BOSS) ?? -1;
  if (q < 0) return undefined;
  const hall = plan.halls[plan.stairs]!;
  const { x0, x1, z0, z1 } = hall.rect;
  const hold =
    hall.kind === 'Boss' &&
    presentPlayers(config, away).some((i) => {
      const f = fighters[i]!;
      return inDuel(f) && f.hp > 0 && f.position.x >= x0 && f.position.x <= x1 && f.position.z >= z0 && f.position.z <= z1;
    });
  return { soldier: crowd.squad.indexOf(q), hold };
}

/**
 * One Tick of a Delver Run in progress (the Delver branch of `stepMatch`): once the fade is over, the next Floor's Duel; else the Floor's Duel
 * stepped under the Floor's Tuning Data, and a wipe of Team 0 is a Defeat in any phase.
 */
export function stepDelver(match: MatchState, run: DelverRun, intents: readonly Intent[], tuning: TuningData, tick: number): MatchState {
  const { config } = match;
  const events: MatchEvent[] = [];

  if (match.nextDuelTick !== null && tick >= match.nextDuelTick) {
    // The fade is over: the next Floor (its Arena warmed ahead by the game, so this Tick only reads it).
    const floor = run.floor + 1;
    const duel = floorDuel(tuning, config, floor, match.duel, match.duel.rng);
    const duelNumber = match.duelNumber + 1;
    events.push({ type: 'DuelStart', duelNumber });
    const started = startFloor(tuning, config, run, floor, duel);
    return { ...match, tick, arena: duel.arena, duelNumber, duel: started.duel, nextDuelTick: null, events, delver: started.run };
  }

  // The Floor as a Battle steps: the Bubbles promote and demote (every party Fighter has one), the Fighters' Duel, then the Crowd under its Warband
  // brain. No kill count and no Tickets: a Floor has neither.
  const t0 = arenaTuning(tuning, match.duel.arena);
  const k = config.teams.length;
  const bubbled = stepBubbles(match.duel, k, match.duel.tick + 1, t0, intents, bossHold(floorOf(tuning, match.duel.arena)!.plan, match.duel.crowd!, match.duel.fighters, config, run.away));
  let duel = step(bubbled, intents, t0);
  const map = battleMapOf(t0.battle, duel.arena);
  const homes = warbandHomes(floorOf(tuning, duel.arena)!.plan);
  duel = { ...duel, crowd: stepCrowd(duel.crowd!, duel.tick, t0.battle, crowdFighters(duel, bubbled, k, () => false, map.field.layered), map, warbandBrain(homes, tuning.delver)) };
  let { score, nextDuelTick, status } = match;
  let next = run;

  if (duel.duel.status === 'Over') {
    // Team 0 is wiped out (a Floor's Duel ends on nothing else): a Defeat, in any phase.
    events.push({ type: 'RunEnd', winner: 1, cleared: score[0]!, floors: run.floors, halls: 0 });
    return { ...match, tick, duel, nextDuelTick: null, status: { status: 'Over', winner: 1, tick }, events };
  }

  if (next.phase === 'Exploring') {
    const plan = floorOf(tuning, duel.arena)!.plan;
    const t = arenaTuning(tuning, duel.arena);
    const { fireRadius } = tuning.delver;

    // A Warband wiped: no Soldier of its Squad is alive now. Its drops lie where its last Soldier fell (the lowest-index one alive before this Tick, else its
    // lowest), for each present Player, from the next free id, and the Warband is `wiped`. Before the Tick's taking, so a Player on the spot takes it this Tick.
    const crowd = duel.crowd!;
    const before = match.duel.crowd!;
    for (let q = 0; q < crowd.warbands!.rank.length; q++) {
      if (next.wiped.includes(q)) continue;
      const members = crowd.squad.flatMap((squad, s) => (squad === q ? [s] : []));
      if (members.length === 0 || members.some((s) => crowd.alive[s] === 1)) continue;
      const last = members.find((s) => before.alive[s] === 1) ?? members[0]!;
      const fall = { x: crowd.x[last]!, z: crowd.z[last]! };
      const drops = warbandDrops(t, config, plan, crowd, q, fall, runSeed(config.arena), next.floor, next.pickups.length, next.away);
      next = { ...next, wiped: [...next.wiped, q].sort((a, b) => a - b), pickups: [...next.pickups, ...drops] };
      events.push({ type: 'WarbandWiped', warband: q, rank: crowd.warbands!.rank[q]!, at: { x: fall.x, y: 0, z: fall.z } });
    }

    // The Inventory: a Player's Fighter changes what it holds only at a fire (refused elsewhere); what it drops is the pickups'. Taking needs no fire.
    duel = {
      ...duel,
      fighters: duel.fighters.map((f, i) => {
        if (!f.inventory || !(intents[i]?.equip || intents[i]?.drop) || fireAt(plan, f, fireRadius) < 0) return f;
        const used = useInventory(f, intents[i]!, t);
        if (used.dropped) {
          const drop = { fighter: i, ...used.dropped, at: { x: f.position.x, y: f.y, z: f.position.z } };
          next = placeDrop(next, drop);
          events.push({ type: 'ItemDropped', ...drop });
        }
        return used.fighter;
      }),
    };
    const took = takePickups(next.pickups, duel.fighters, config, t, next.away);
    if (took.taken.length > 0 || took.pickups.some((p, k) => p !== next.pickups[k])) {
      next = { ...next, pickups: took.pickups };
      duel = { ...duel, fighters: took.fighters };
      for (const x of took.taken) events.push({ type: 'ItemTaken', ...x });
    }

    // The fires, in plan order: the first Player to arrive while a Team 0 Fighter has fallen revives every fallen one (once per fire; a Player passing with nobody fallen spends nothing), then each Player at it heals once.
    const arena = arenaOf(t, duel.arena);
    plan.markers.fires.forEach((fire, k) => {
      const point = { x: fire.x, y: 0, z: fire.z };
      const present = (i: number) => {
        const f = duel.fighters[i]!;
        return inDuel(f) && f.hp > 0 && standsWithin(point, fireRadius, f);
      };
      const use = next.restUsed[k]!;
      let revived = use.revived;
      if (!revived && duel.fighters.some((f) => f.team === 0 && f.death !== undefined) && presentPlayers(config, next.away).some(present)) {
        revived = true;
        let j = 0;
        duel = {
          ...duel,
          fighters: duel.fighters.map((f, i): FighterState => {
            if (f.team !== 0 || f.death === undefined) return f;
            const at = { x: point.x + REVIVE_DX[j % 4]!, z: point.z + REVIVE_DZ[j % 4]! };
            j++;
            const weapon = f.inventory ? wieldedWeapon(f.inventory) : f.weapon;
            const fresh = standingFighter(t, arena, { position: at, y: 0, facing: f.facing }, weapon, 0, f.size);
            const armed = f.inventory ? holdInventory(fresh, f.inventory, t) : setMods(fresh, NO_MODS, t.fighter.maxHp);
            events.push({ type: 'Revived', fighter: i, fire: k });
            return { ...armed, hp: tuning.dungeon.revive * armed.maxHp };
          }),
        };
      }
      const healing = presentPlayers(config, next.away).filter((i) => !use.healed.includes(i) && present(i));
      if (healing.length > 0) {
        duel = {
          ...duel,
          fighters: duel.fighters.map((f, i): FighterState => {
            if (!healing.includes(i)) return f;
            const hp = Math.min(f.maxHp, f.hp + tuning.dungeon.restHeal * f.maxHp);
            events.push({ type: 'Rested', fighter: i, healed: hp - f.hp });
            return { ...f, hp };
          }),
        };
      }
      if (revived !== use.revived || healing.length > 0) {
        next = {
          ...next,
          restUsed: next.restUsed.map((u, n) => (n === k ? { revived, healed: [...u.healed, ...healing].sort((a, b) => a - b) } : u)),
        };
      }
    });

    // The Stairs: they count while every Fighter whose standing counts (`doorCounters`) is in the zone; at `doorSeconds` the party takes them.
    const counting = doorCounters(config, duel.fighters, next.away);
    const fighters = duel.fighters;
    const stairsTicks = counting.length > 0 && counting.every((i) => inStairs(plan, fighters[i]!)) ? next.stairsTicks + 1 : 0;
    next = { ...next, stairsTicks };
    if (stairsTicks >= doorTicksNeeded(tuning)) {
      if (next.floor === next.floors) {
        // The last Stairs: the Run is won, and its Duel ends as a Duel's end would leave it.
        status = { status: 'Over', winner: 0, tick };
        duel = { ...duel, duel: { status: 'Over', winner: 0, tick: duel.tick }, events: [...duel.events, { type: 'DuelEnd', winner: 0 }] };
        score = score.map((s, i) => (i === 0 ? s + 1 : s));
        events.push({ type: 'RunEnd', winner: 0, cleared: score[0]!, floors: next.floors, halls: 0 });
        nextDuelTick = null;
      } else {
        next = { ...next, phase: 'Descending' };
        nextDuelTick = tick + Math.max(1, secondsToTicks(tuning.dungeon.hallFadeSeconds));
        score = score.map((s, i) => (i === 0 ? s + 1 : s));
        events.push({ type: 'StairsTaken', floor: next.floor });
      }
    }
  }

  // The Controllers see the Floor's phase and who has left.
  const view = mirrored(next);
  if (duel.delver?.phase !== view.phase || duel.delver?.away?.join() !== view.away?.join() || duel.delver?.pickups !== view.pickups) duel = { ...duel, delver: view };
  return { ...match, tick, score, duel, nextDuelTick, status, events, delver: next };
}

