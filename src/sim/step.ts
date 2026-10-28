import { defaultWeaponName, weaponByName, type ArenaGeometry, type TuningData } from '../tuning';
import { advanceBlockImpact, fall, IDLE_MOTION, IDLE_ACTION, idleMotionFor, LAND_SOFT_MOTION, updateAction, type ActionUpdate } from './actions';
import { advanceSlide } from './slide';
import { resolveChambers } from './chamber';
import { advanceDaggers, launchDagger } from './dagger';
import { arenaOf, deadlyGround, groundBelow } from './arena';
import { flyBody, landing, settleGround, takeOff } from './air';
import { resolveBodies } from './collision';
import { findContacts, findDaggerContacts, resolveContacts, resolveDaggers, staggerFighter } from './combat';
import { secondsToTicks, TICK_SECONDS } from './constants';
import { DUEL_FIGHTING, inDuel, updateDuel } from './duel';
import type { SimEvent } from './events';
import { IDLE_INTENT, type Intent } from './intent';
import { initialGait, updateGait } from './gait';
import { followMotion } from './motion';
import { bladeAndLeg, fighterPose, motionPose } from './pose';
import { createRng, nextFloat } from './rng';
import type { Placement } from './skeleton';
import type { Airborne, Death, DeathBlow, FighterState, MotionPlayback, SimState } from './state';

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
 * (default: `defaultTeam(i)`), in the Arena named `arena` (default: the Editor's, Tuning Data `arena.editor`).
 * Throws on an unknown Weapon or Arena.
 */
export function createInitialState(
  tuning: TuningData,
  seed: number,
  placements: readonly Placement[] = [CENTRE_PLACEMENT],
  weapons: readonly string[] = [],
  teams: readonly number[] = [],
  arena: string = tuning.arena.editor,
): SimState {
  const geometry = arenaOf(tuning, arena);
  return {
    tick: 0,
    arena,
    rng: createRng(seed),
    fighters: placements.map(({ position, facing, y: placedY = 0 }, i) => {
      // A placement stands on the ground under it, within a step of where it is placed.
      const y = groundBelow(geometry, position.x, position.z, placedY + tuning.fall.stepUp)?.y ?? placedY;
      const weapon = weaponByName(tuning, weapons[i] ?? defaultWeaponName(tuning)).name;
      return {
        position: { x: position.x, z: position.z },
        y,
        facing,
        pitch: 0,
        crouch: 0,
        team: teams[i] ?? defaultTeam(i),
        hp: tuning.fighter.maxHp,
        maxHp: tuning.fighter.maxHp,
        weapon,
        action: IDLE_ACTION,
        motion: IDLE_MOTION,
        ...bladeAndLeg(motionPose(tuning, IDLE_MOTION.name, IDLE_MOTION.tick, { position, facing, y }, weapon)),
        daggers: tuning.dagger.count,
        sheathed: false,
        gait: initialGait(tuning, weapon, IDLE_MOTION, { position, facing, y }),
      };
    }),
    daggers: [],
    duel: DUEL_FIGHTING,
    events: [],
  };
}

/** Share of `fighter.walkSpeed` a blocked attacker keeps while it recoils (its Stagger is `Blocked`). */
const RECOIL_WALK_FACTOR = 0.5;

/** A Staggered Fighter cannot act, except that a blocked attacker can still shuffle through its recoil. A kicking or knocked-down Fighter is committed: it cannot walk (it can still turn). */
const locked = (f: FighterState): boolean => (f.action.kind === 'Stagger' && f.action.cause !== 'Blocked') || f.action.kind === 'Kick' || f.action.kind === 'Knockdown';

/** The share of its speed a Fighter keeps while a dagger Hit's Slow lasts (1 when it is not slowed). It multiplies with crouch and recoil. */
const slowFactor = (f: FighterState, tuning: TuningData): number => (f.slow ? tuning.dagger.slowFactor : 1);

/** Whether the Fighter walks at its Sheathed speed: Sheathed and not in the middle of a Sheathe or Draw, which walk at the drawn speed. */
const sheathedPace = (f: FighterState): boolean => f.sheathed && f.action.kind !== 'Sheathe' && f.action.kind !== 'Draw';

/**
 * Where the Fighter's movement Intent takes it this Tick, before collision. A Staggered Fighter cannot act, so it cannot walk (but a recoiling one walks slowly).
 * A Sheathed Fighter walks `fighter.sheathedWalkFactor` faster, unless `drawnPace` (the walk a Jump takes off with, which is always the drawn one: ADR 0017).
 */
function walk(f: FighterState, intent: Intent, tuning: TuningData, drawnPace = false): FighterState['position'] {
  if (locked(f)) return f.position;
  let { x: mx, z: mz } = intent.move;
  const len = Math.hypot(mx, mz);
  if (len === 0) return f.position;
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const speed = slowFactor(f, tuning) * (sheathedPace(f) && !drawnPace ? tuning.fighter.sheathedWalkFactor : 1) * (f.action.kind === 'Stagger' ? RECOIL_WALK_FACTOR : 1) * (f.action.kind === 'Throw' ? tuning.dagger.throwWalkFactor : 1) * (1 + (tuning.fighter.crouchWalkFactor - 1) * f.crouch);
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
 * exactly on it. A Staggered Fighter cannot act, so it cannot turn either,
 * and a Fighter in Knockdown lies (or gets up) facing the way it fell.
 */
function turn(f: FighterState, intent: Intent, tuning: TuningData): number {
  const face = intent.face ?? null; // tolerate Intents built before `face` existed
  if (face === null || f.action.kind === 'Stagger' || f.action.kind === 'Knockdown') return f.facing;
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
  if (intent.pitch === undefined || f.action.kind === 'Stagger' || f.action.kind === 'Knockdown') return f.pitch;
  const max = (tuning.fighter.lookPitchMax * Math.PI) / 180;
  const target = Math.min(max, Math.max(-max, intent.pitch));
  const maxStep = (tuning.fighter.turnSpeed * Math.PI * TICK_SECONDS) / 180;
  const delta = target - f.pitch;
  if (Math.abs(delta) <= maxStep) return target;
  return f.pitch + Math.sign(delta) * maxStep;
}

/** The Fighter's crouch amount after this Tick: it moves toward 1 while Intent `crouch` is held, else toward 0, at `fighter.crouchSpeed`. A Staggered Fighter cannot act, so it holds its crouch. */
function duck(f: FighterState, intent: Intent, tuning: TuningData): number {
  if (f.action.kind === 'Stagger' || f.action.kind === 'Knockdown') return f.crouch;
  const target = intent.crouch === true ? 1 : 0;
  const step = tuning.fighter.crouchSpeed * TICK_SECONDS;
  return Math.abs(target - f.crouch) <= step ? target : f.crouch + Math.sign(target - f.crouch) * step;
}

/**
 * An airborne Fighter's flight this Tick (`flyBody`): it steers toward where its Intent walks, at its walk speed
 * (slowed by a dagger Hit), unless it is locked.
 */
function fly(f: FighterState, air: Airborne, intent: Intent, tuning: TuningData): Pick<FighterState, 'position' | 'y' | 'air'> {
  const move = locked(f) ? { x: 0, z: 0 } : intent.move;
  return flyBody(f, air, move, intent.jumpHeld === true, tuning.fighter.walkSpeed * slowFactor(f, tuning), tuning);
}

/** What a ledge Fall does not replace: a Fall already, a forced Action (Stagger, Knockdown), or a Sheathe or Draw, which carries on in the air. */
const keepsOnFalling = (update: ActionUpdate): boolean => ['Fall', 'Stagger', 'Knockdown', 'Sheathe', 'Draw'].includes(update.action.kind);

/** A playback of the Idle Motion as the Fighter's own Idle plays it (the Sheathed Idle while `sheathed`); any other Motion as it is. */
const idleAs = (m: MotionPlayback, sheathed: boolean): MotionPlayback => (m.name === IDLE_MOTION.name ? { ...m, name: idleMotionFor({ sheathed }) } : m);

/** Whether the Fighter jumps this Tick: Jump pressed while standing on the ground, Idle, Blocking or Attacking. */
const jumps = (f: FighterState, intent: Intent): boolean =>
  intent.jump === true && !f.air && (f.action.kind === 'Idle' || f.action.kind === 'Block' || f.action.kind === 'Attack');

/**
 * One Fighter's Action and movement this Tick, before bodies collide. A Jump leaps
 * off the ground with the walk it had, at its drawn speed even when Sheathed (an Idle Fighter Falls, one Attacking or Blocking keeps
 * at it, and a jumper can Attack or Block mid-air); a Fighter that walked off a ledge and has been
 * airborne for `fall.fallDelay` (or more) Falls, whatever it was doing, unless it is Staggered.
 */
function stepFighter(f: FighterState, index: number, tick: number, intent: Intent, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  let air = f.air;
  let update = updateAction(f, intent, { fighter: index, tick, tuning, emit });
  if (jumps(f, intent)) {
    air = takeOff(f.position, walk(f, intent, tuning, true), f.y, tuning);
    // An Attack or Block carries on in the air; only an Idle Fighter takes the Fall pose.
    if (update.action.kind === 'Idle') update = fall();
    emit({ type: 'Jump', fighter: index });
  } else if (air && !air.jumped && air.ticks + 1 >= secondsToTicks(tuning.fall.fallDelay) && !keepsOnFalling(update)) {
    update = fall();
  }
  const sheathed = update.sheathed ?? f.sheathed;
  // The dagger leaves the hand on the first Tick of Release: one fewer to throw.
  const released = update.action.kind === 'Throw' && update.action.phase === 'Release' && !(f.action.kind === 'Throw' && f.action.phase === 'Release');
  if (released) emit({ type: 'DaggerThrown', thrower: index });
  // The Block Impact rings down whatever the Fighter does next, so letting go of the Block never snaps the hand still.
  const { blockImpact, air: _air, slide: _slide, slow, ...rest } = f;
  const impact = blockImpact && advanceBlockImpact(blockImpact, tuning);
  // A Slide carries a grounded Fighter along on top of its walk; once airborne its speed lives in `air` instead.
  const sliding = !air && f.slide ? advanceSlide(f.slide) : undefined;
  const walked = air ? undefined : walk(f, intent, tuning);
  const moved = air
    ? fly(f, air, intent, tuning)
    : { position: sliding ? { x: walked!.x + sliding.delta.x, z: walked!.z + sliding.delta.z } : walked!, y: f.y };
  const next = {
    ...rest,
    ...moved,
    facing: turn(f, intent, tuning),
    pitch: tilt(f, intent, tuning),
    crouch: duck(f, intent, tuning),
    action: update.action,
    daggers: released ? f.daggers - 1 : f.daggers,
    sheathed,
    motion: followMotion(tuning, f.weapon, f.motion, idleAs(update.motion, sheathed), update.blendTicks),
  };
  // The Slow counts down every Tick, in Stagger and in the air too; it is stripped, never stored, at zero.
  return { ...next, ...(impact ? { blockImpact: impact } : {}), ...(sliding?.next ? { slide: sliding.next } : {}), ...(slow && slow.ticks > 1 ? { slow: { ticks: slow.ticks - 1 } } : {}) };
}

/**
 * A Fighter that just landed (last Tick `prev` was airborne), counted by `landing`: only a Fighter in Knockdown takes fall
 * damage (`fall.knockdownDamageFactor` times it from the real top of its arc, only while the Duel is being fought) and stays
 * down; a Jump lands unhurt, and one that walked or was pushed off a ledge lands unhurt but, beyond `fall.safeHeight`, Staggers
 * (cause `Landed`). A soft Landing ends a Fall in Idle, playing `LandSoft` (a Sheathed Fighter goes straight to its Sheathed Idle).
 * A Fighter already Staggered by something else keeps that Stagger.
 */
function land(prev: FighterState, f: FighterState, index: number, fighting: boolean, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  const { drop, damage: fallDamage, hard } = landing(prev.air!, f.y, f.action.kind === 'Knockdown', tuning);
  const damage = fighting ? fallDamage : 0;
  emit({ type: 'Land', fighter: index, height: drop, damage });
  // A Fighter lying down takes the damage but stays down: it is not Staggered upright.
  if (f.action.kind === 'Knockdown') return { ...f, hp: Math.max(0, f.hp - damage) };
  if (hard) return staggerFighter({ ...f, hp: Math.max(0, f.hp - damage) }, index, 'Landed', tuning, emit);
  if (f.action.kind !== 'Fall') return f;
  const soft = f.sheathed ? idleAs(IDLE_MOTION, true) : { name: LAND_SOFT_MOTION, tick: 0 };
  return { ...f, action: IDLE_ACTION, motion: followMotion(tuning, f.weapon, f.motion, soft) };
}

/**
 * Living Fighter capsules push each other apart and stay inside the Arena (the fallen lie where they fell), the Gait
 * steps the feet after the bodies' final moves (ADR 0003), then each Skeleton
 * is solved at its final position. Motion is simulation: the Skeleton is
 * solved by IK inside the Tick (ADR 0001). `before` is last Tick's Fighters.
 */
function settleBodies(
  before: readonly FighterState[],
  fighters: readonly FighterState[],
  tuning: TuningData,
  arena: ArenaGeometry,
  fighting: boolean,
  emit: (e: SimEvent) => void,
): FighterState[] {
  const living = fighters.flatMap((f, i) => (inDuel(f) ? [i] : []));
  const resolved = resolveBodies(
    living.map((i) => fighters[i]!),
    arena,
    tuning,
  );
  const positions = new Map(living.map((i, k) => [i, resolved[k]!]));
  return fighters.map((f, i) => {
    if (!inDuel(f)) return f;
    const grounded = settleGround(before[i]!, { ...f, position: positions.get(i)! }, arena, tuning);
    const moved = before[i]!.air && !grounded.air ? land(before[i]!, grounded, i, fighting, tuning, emit) : grounded;
    const settled = { ...moved, gait: updateGait(before[i]!, moved, i, tuning, arena, emit) };
    return { ...settled, ...bladeAndLeg(fighterPose(settled, tuning)) };
  });
}

/** How Fighter `i` fell this Tick: to the last Hit on it, or else to a hard Landing. */
function felled(events: readonly SimEvent[], i: number, fighters: readonly FighterState[], tick: number, tuning: TuningData): Death {
  const blow = fellingBlow(events, i, fighters, tuning);
  const fall = !blow && events.some((e) => e.type === 'Land' && e.fighter === i && e.damage > 0);
  return { tick, cause: fall ? 'Fall' : 'Hit', blow };
}

/** The last Hit this Tick on Fighter `defender` (a blade's or a dagger's), as the blow that felled it. A dagger drives the body at its launch speed, along a Thrust. */
function fellingBlow(events: readonly SimEvent[], defender: number, fighters: readonly FighterState[], tuning: TuningData): DeathBlow | null {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k]!;
    if (e.type === 'DaggerHit' && e.defender === defender) {
      const { x, z } = fighters[e.thrower]!.position;
      return { point: e.point, bladeSpeed: tuning.dagger.speed, direction: 'Thrust', from: { x, z } };
    }
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
 * Order within a Tick: Actions and movement → Chambers pressed (pending) → Blade Sweeps (a pending Chamber lands where the blades meet) against Hit Zones
 * → damage → Deaths (a Fighter standing on lava, water or an abyss dies of it, whatever its HP) → Duel end. A Fighter falls (Death) on the Tick its HP reaches zero, even with
 * its team still fighting. Once the Duel is over, Intents are ignored and no
 * more hits land (a Match, #14, starts the next Duel).
 */
export function step(state: SimState, intents: readonly Intent[], tuning: TuningData): SimState {
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => void events.push(e);
  const fighting = state.duel.status === 'Fighting';
  const tick = state.tick + 1;

  const arena = arenaOf(tuning, state.arena);
  let fighters = settleBodies(
    state.fighters,
    state.fighters.map((f, i) => (!inDuel(f) ? f : stepFighter(f, i, tick, (fighting && intents[i]) || IDLE_INTENT, tuning, emit))),
    tuning,
    arena,
    fighting,
    emit,
  );
  // Daggers already in flight move first; one thrown this Tick leaves the solved left hand and first moves next Tick.
  const flight = advanceDaggers(state.daggers, fighters, arena, tuning, emit);
  const thrown = events.flatMap((e) => (e.type === 'DaggerThrown' ? [launchDagger(fighters[e.thrower]!, e.thrower, tick, tuning)] : []));
  let flying = flight.daggers;
  if (fighting) fighters = resolveChambers(state.fighters, fighters, tuning);
  if (fighting) fighters = resolveContacts(fighters, findContacts(state.fighters, fighters, arena, tuning), intents, tuning, emit);
  if (fighting) {
    // Daggers land after blade and Kick contacts, against the post-contact Fighters; one that hit or was Blocked is spent.
    const resolved = resolveDaggers(fighters, findDaggerContacts(flight.sweeps, fighters, tuning), flight.sweeps, tick, tuning, emit);
    fighters = resolved.fighters;
    // `flight.daggers` holds a survivor for each sweep that did not end, in order.
    let survivor = 0;
    flying = flight.sweeps.flatMap((sweep, k) => {
      const next = sweep.ended ? undefined : flight.daggers[survivor++];
      return next && !resolved.spent.has(k) ? [next] : [];
    });
  }
  const daggers = [...flying, ...thrown];
  if (fighting)
    fighters = fighters.map((f) => {
      const cause = !inDuel(f) || f.air ? null : deadlyGround(arena, f.position.x, f.position.z, f.y);
      return cause ? { ...f, hp: 0, death: { tick, cause, blow: null } } : f;
    });
  if (fighting) fighters = fighters.map((f, i) => (f.hp > 0 || !inDuel(f) ? f : { ...f, death: felled(events, i, fighters, tick, tuning) }));
  fighters.forEach((f, i) => {
    if (f.death?.tick === tick) emit({ type: 'Death', fighter: i, cause: f.death.cause });
  });
  const duel = updateDuel(state.duel, fighters, tick, emit, state.hall !== undefined);

  // The seeded generator advances every Tick, so whatever draws from it (the AI Controller) sees a fresh value each Tick.
  return { tick, arena: state.arena, rng: nextFloat(state.rng)[1], fighters, daggers, duel, events, ...(state.hall === undefined ? {} : { hall: state.hall }) };
}
