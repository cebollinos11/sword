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

/**
 * Build the state at Tick 0: an Idle Fighter with full HP at each placement (default: one at the centre),
 * Fighter i wielding `weapons[i]` (a Weapon name; default: the default Weapon). Throws on an unknown Weapon.
 */
export function createInitialState(
  tuning: TuningData,
  seed: number,
  placements: readonly Placement[] = [CENTRE_PLACEMENT],
  weapons: readonly string[] = [],
): SimState {
  return {
    tick: 0,
    rng: createRng(seed),
    fighters: placements.map(({ position, facing }, i) => {
      const weapon = weaponByName(tuning, weapons[i] ?? defaultWeaponName(tuning)).name;
      return {
        position: { x: position.x, z: position.z },
        facing,
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

/** Where the Fighter's movement Intent takes it this Tick, before collision. A Staggered Fighter cannot act, so it cannot walk. */
function walk(f: FighterState, intent: Intent, tuning: TuningData): FighterState['position'] {
  if (f.action.kind === 'Stagger') return f.position;
  let { x: mx, z: mz } = intent.move;
  const len = Math.hypot(mx, mz);
  if (len === 0) return f.position;
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const d = tuning.fighter.walkSpeed * TICK_SECONDS;
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

function stepFighter(f: FighterState, index: number, intent: Intent, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  const { action, motion } = updateAction(f, intent, { fighter: index, tuning, emit });
  // The Block Impact rings down whatever the Fighter does next, so letting go of the Block never snaps the hand still.
  const { blockImpact, ...rest } = f;
  const impact = blockImpact && advanceBlockImpact(blockImpact, tuning);
  const next = { ...rest, position: walk(f, intent, tuning), facing: turn(f, intent, tuning), action, motion: followMotion(tuning, f.weapon, f.motion, motion) };
  return impact ? { ...next, blockImpact: impact } : next;
}

/**
 * Fighter capsules push each other apart and stay inside the Arena, the Gait
 * steps the feet after the bodies' final moves (ADR 0003), then each Skeleton
 * is solved at its final position. Motion is simulation: the Skeleton is
 * solved by IK inside the Tick (ADR 0001). `before` is last Tick's Fighters.
 */
function settleBodies(before: readonly FighterState[], fighters: readonly FighterState[], tuning: TuningData, emit: (e: SimEvent) => void): FighterState[] {
  const positions = resolveBodies(
    fighters.map((f) => f.position),
    tuning,
  );
  return fighters.map((f, i) => {
    if (f.death) return f;
    const position = positions[i]!;
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
 * → damage → Duel end. Once the Duel is over, Intents are ignored and no
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
  const duel = updateDuel(state.duel, fighters, tick, emit);
  if (fighting && duel.status === 'Over') fighters = fighters.map((f, i) => (f.hp > 0 ? f : { ...f, death: { tick, blow: fellingBlow(events, i, fighters) } }));

  // The seeded generator advances every Tick, so whatever draws from it (the AI Controller) sees a fresh value each Tick.
  return { tick, rng: nextFloat(state.rng)[1], fighters, duel, events };
}
