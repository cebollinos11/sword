import { defaultWeaponName, weaponByName, type TuningData } from '../tuning';
import { advanceBlockImpact, IDLE_MOTION, IDLE_ACTION, updateAction } from './actions';
import { resolveChambers } from './chamber';
import { resolveBodies } from './collision';
import { findContacts, resolveContacts } from './combat';
import { TICK_SECONDS } from './constants';
import { DUEL_FIGHTING, updateDuel } from './duel';
import type { SimEvent } from './events';
import { IDLE_INTENT, type Intent } from './intent';
import { initialGait, updateGait } from './gait';
import { followMotion } from './motion';
import { fighterPose, motionPose } from './pose';
import { createRng, nextFloat } from './rng';
import type { Placement } from './skeleton';
import type { DeathBlow, FighterState, SimState } from './state';

/** A lone Fighter at the Arena centre, facing +z. */
export const CENTRE_PLACEMENT: Placement = { position: { x: 0, z: 0 }, facing: 0 };

/**
 * Two Fighters facing each other across the Arena centre, `distance` metres
 * apart along z: Fighter 0 at -z facing +z, Fighter 1 at +z facing -z.
 */
export function duelPlacements(distance: number): Placement[] {
  return [
    { position: { x: 0, z: -distance / 2 }, facing: 0 },
    { position: { x: 0, z: distance / 2 }, facing: Math.PI },
  ];
}

/** Fighter i's team when none is given: alternating, so two Fighters are always opponents. */
export const defaultTeam = (i: number): number => i % 2;

/**
 * The two teams in facing lines across the Arena centre, `distance` metres
 * apart along z: team 0 at -z facing +z, team 1 at +z facing -z. Teammates
 * stand side by side `spacing` metres apart, centred on the z axis, in
 * Fighter order. `teams[i]` is Fighter i's team. One Fighter a side stands
 * exactly where `duelPlacements` puts it.
 */
export function teamPlacements(teams: readonly number[], distance: number, spacing: number): Placement[] {
  const size = [0, 1].map((t) => teams.filter((team) => team === t).length);
  const seen = [0, 0];
  return teams.map((team) => {
    const k = seen[team]!++;
    const x = (k - (size[team]! - 1) / 2) * spacing;
    // Team 1 faces the other way, so mirror x to keep line order left-to-right from each team's view.
    return team === 0 ? { position: { x, z: -distance / 2 }, facing: 0 } : { position: { x: 0 - x, z: distance / 2 }, facing: Math.PI };
  });
}

/**
 * Build the state at Tick 0: an Idle Fighter with full HP at each placement (default: one at the centre),
 * Fighter i wielding `weapons[i]` (a Weapon name; default: the default Weapon) on team `teams[i]`
 * (default: `defaultTeam(i)`). Throws on an unknown Weapon.
 */
export function createInitialState(
  tuning: TuningData,
  seed: number,
  placements: readonly Placement[] = [CENTRE_PLACEMENT],
  weapons: readonly string[] = [],
  teams: readonly number[] = [],
): SimState {
  return {
    tick: 0,
    rng: createRng(seed),
    fighters: placements.map(({ position, facing }, i) => {
      const weapon = weaponByName(tuning, weapons[i] ?? defaultWeaponName(tuning)).name;
      return {
        position: { x: position.x, z: position.z },
        facing,
        pitch: 0,
        team: teams[i] ?? defaultTeam(i),
        hp: tuning.fighter.maxHp,
        weapon,
        action: IDLE_ACTION,
        motion: IDLE_MOTION,
        blade: motionPose(tuning, IDLE_MOTION.name, IDLE_MOTION.tick, { position, facing }, weapon).blade,
        gait: initialGait(tuning, weapon, IDLE_MOTION, { position, facing }),
      };
    }),
    duel: DUEL_FIGHTING,
    events: [],
  };
}

/** Share of `fighter.walkSpeed` a blocked attacker keeps while it recoils (its Stagger is `Blocked`). */
const RECOIL_WALK_FACTOR = 0.5;

/** A Staggered Fighter cannot act, except that a blocked attacker can still shuffle through its recoil. */
const locked = (f: FighterState): boolean => f.action.kind === 'Stagger' && f.action.cause !== 'Blocked';

/** Where the Fighter's movement Intent takes it this Tick, before collision. A Staggered Fighter cannot act, so it cannot walk (but a recoiling one walks slowly). */
function walk(f: FighterState, intent: Intent, tuning: TuningData): FighterState['position'] {
  if (locked(f)) return f.position;
  let { x: mx, z: mz } = intent.move;
  const len = Math.hypot(mx, mz);
  if (len === 0) return f.position;
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const speed = f.action.kind === 'Stagger' ? RECOIL_WALK_FACTOR : 1;
  const d = tuning.fighter.walkSpeed * TICK_SECONDS * speed;
  return { x: f.position.x + mx * d, z: f.position.z + mz * d };
}

/** Wrap a yaw into (-π, π]. */
function wrapYaw(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
}

/**
 * The Fighter's facing after this Tick: it turns toward `intent.face` the
 * shorter way round, at most `fighter.turnSpeed` degrees per second, and lands
 * exactly on it. A Staggered Fighter cannot act, so it cannot turn either.
 */
function turn(f: FighterState, intent: Intent, tuning: TuningData): number {
  const face = intent.face ?? null; // tolerate Intents built before `face` existed
  if (face === null || f.action.kind === 'Stagger') return f.facing;
  const maxStep = (tuning.fighter.turnSpeed * Math.PI * TICK_SECONDS) / 180;
  const delta = wrapYaw(face - f.facing);
  if (Math.abs(delta) <= maxStep) return wrapYaw(face);
  return wrapYaw(f.facing + Math.sign(delta) * maxStep);
}

/**
 * The Fighter's pitch after this Tick: it tilts toward `intent.pitch` (held within
 * `fighter.lookPitchMax`) at `fighter.turnSpeed`, like turning. A Staggered Fighter cannot act, so it keeps its pitch.
 */
function tilt(f: FighterState, intent: Intent, tuning: TuningData): number {
  if (intent.pitch === undefined || f.action.kind === 'Stagger') return f.pitch;
  const max = (tuning.fighter.lookPitchMax * Math.PI) / 180;
  const target = Math.min(max, Math.max(-max, intent.pitch));
  const maxStep = (tuning.fighter.turnSpeed * Math.PI * TICK_SECONDS) / 180;
  const delta = target - f.pitch;
  if (Math.abs(delta) <= maxStep) return target;
  return f.pitch + Math.sign(delta) * maxStep;
}

function stepFighter(f: FighterState, index: number, intent: Intent, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  const { action, motion } = updateAction(f, intent, { fighter: index, tuning, emit });
  // The Block Impact rings down whatever the Fighter does next, so letting go of the Block never snaps the hand still.
  const { blockImpact, ...rest } = f;
  const impact = blockImpact && advanceBlockImpact(blockImpact, tuning);
  const next = { ...rest, position: walk(f, intent, tuning), facing: turn(f, intent, tuning), pitch: tilt(f, intent, tuning), action, motion: followMotion(tuning, f.weapon, f.motion, motion) };
  return impact ? { ...next, blockImpact: impact } : next;
}

/**
 * Living Fighter capsules push each other apart and stay inside the Arena (the fallen lie where they fell), the Gait
 * steps the feet after the bodies' final moves (ADR 0003), then each Skeleton
 * is solved at its final position. Motion is simulation: the Skeleton is
 * solved by IK inside the Tick (ADR 0001). `before` is last Tick's Fighters.
 */
function settleBodies(before: readonly FighterState[], fighters: readonly FighterState[], tuning: TuningData, emit: (e: SimEvent) => void): FighterState[] {
  const living = fighters.flatMap((f, i) => (f.death ? [] : [i]));
  const resolved = resolveBodies(
    living.map((i) => fighters[i]!.position),
    tuning,
  );
  const positions = new Map(living.map((i, k) => [i, resolved[k]!]));
  return fighters.map((f, i) => {
    if (f.death) return f;
    const position = positions.get(i)!;
    const moved = { ...f, position };
    const settled = { ...moved, gait: updateGait(before[i]!, moved, i, tuning, emit) };
    return { ...settled, blade: fighterPose(settled, tuning).blade };
  });
}

/** The last Hit this Tick on Fighter `defender`, as the blow that felled it. */
function fellingBlow(events: readonly SimEvent[], defender: number, fighters: readonly FighterState[]): DeathBlow | null {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k]!;
    if (e.type !== 'Hit' || e.defender !== defender) continue;
    const { x, z } = fighters[e.attacker]!.position;
    return { point: e.point, bladeSpeed: e.bladeSpeed, direction: e.direction, from: { x, z } };
  }
  return null;
}

/**
 * Advance the Simulation by exactly one Tick. Pure: never mutates `state`.
 * `intents[i]` drives `state.fighters[i]`; a missing Intent means Idle.
 *
 * Order within a Tick: Actions and movement → Chambers → Blade Sweeps against Hit Zones
 * → damage → Deaths → Duel end. A Fighter falls (Death) on the Tick its HP reaches zero, even with
 * its team still fighting. Once the Duel is over, Intents are ignored and no
 * more hits land (a Match, #14, starts the next Duel).
 */
export function step(state: SimState, intents: readonly Intent[], tuning: TuningData): SimState {
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => void events.push(e);
  const fighting = state.duel.status === 'Fighting';
  const tick = state.tick + 1;

  let fighters = settleBodies(
    state.fighters,
    state.fighters.map((f, i) => (f.death ? f : stepFighter(f, i, (fighting && intents[i]) || IDLE_INTENT, tuning, emit))),
    tuning,
    emit,
  );
  if (fighting) fighters = resolveChambers(state.fighters, fighters, tuning, emit);
  if (fighting) fighters = resolveContacts(fighters, findContacts(state.fighters, fighters, tuning), tuning, emit);
  if (fighting) fighters = fighters.map((f, i) => (f.hp > 0 || f.death ? f : { ...f, death: { tick, blow: fellingBlow(events, i, fighters) } }));
  const duel = updateDuel(state.duel, fighters, tick, emit);

  // The seeded generator advances every Tick, so whatever draws from it (the AI Controller) sees a fresh value each Tick.
  return { tick, rng: nextFloat(state.rng)[1], fighters, duel, events };
}
