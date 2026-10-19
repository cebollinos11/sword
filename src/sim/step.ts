import { defaultWeaponName, weaponByName, type ArenaGeometry, type TuningData } from '../tuning';
import { advanceBlockImpact, fall, IDLE_MOTION, IDLE_ACTION, updateAction } from './actions';
import { advanceSlide } from './slide';
import { resolveChambers } from './chamber';
import { advanceDaggers, launchDagger } from './dagger';
import { arenaOf, blockedAt, deadlyGround, groundBelow } from './arena';
import { resolveBodies } from './collision';
import { findContacts, findDaggerContacts, resolveContacts, resolveDaggers, staggerFighter } from './combat';
import { secondsToTicks, TICK_SECONDS } from './constants';
import { DUEL_FIGHTING, updateDuel } from './duel';
import type { SimEvent } from './events';
import { IDLE_INTENT, type Intent } from './intent';
import { initialGait, updateGait } from './gait';
import { followMotion } from './motion';
import { bladeAndLeg, fighterPose, motionPose } from './pose';
import { createRng, nextFloat } from './rng';
import type { Placement } from './skeleton';
import type { Airborne, Death, DeathBlow, FighterState, SimState, Vec2 } from './state';

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
        weapon,
        action: IDLE_ACTION,
        motion: IDLE_MOTION,
        ...bladeAndLeg(motionPose(tuning, IDLE_MOTION.name, IDLE_MOTION.tick, { position, facing, y }, weapon)),
        daggers: tuning.dagger.count,
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
  const speed = slowFactor(f, tuning) * (f.action.kind === 'Stagger' ? RECOIL_WALK_FACTOR : 1) * (f.action.kind === 'Throw' ? tuning.dagger.throwWalkFactor : 1) * (1 + (tuning.fighter.crouchWalkFactor - 1) * f.crouch);
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
 * An airborne Fighter's flight this Tick: gravity pulls it down (a held Jump's boost pushes back up), and it steers its
 * horizontal velocity toward where its Intent walks at no more than `fall.airControl` (m/s²).
 */
function fly(f: FighterState, air: Airborne, intent: Intent, tuning: TuningData): Pick<FighterState, 'position' | 'y' | 'air'> {
  let { x: mx, z: mz } = locked(f) ? { x: 0, z: 0 } : intent.move;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const topSpeed = tuning.fighter.walkSpeed * slowFactor(f, tuning);
  let dvx = mx * topSpeed - air.vx;
  let dvz = mz * topSpeed - air.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = tuning.fall.airControl * TICK_SECONDS;
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvz *= maxDv / dv;
  }
  const vx = air.vx + dvx;
  const vz = air.vz + dvz;
  // A Jump held past `fall.jumpBoostDelay` keeps pushing up while its boost lasts (so a tap stays a hop); letting go ends it for good.
  const held = air.boost !== undefined && intent.jumpHeld === true;
  const pushing = held && air.ticks >= secondsToTicks(tuning.fall.jumpBoostDelay);
  const vy = air.vy + ((pushing ? tuning.fall.jumpBoost : 0) - tuning.fall.gravity) * TICK_SECONDS;
  const y = f.y + vy * TICK_SECONDS;
  const { boost: _boost, ...rest } = air;
  const boost = pushing ? air.boost! - 1 : held ? air.boost! : 0;
  return {
    position: { x: f.position.x + vx * TICK_SECONDS, z: f.position.z + vz * TICK_SECONDS },
    y,
    air: { ...rest, vx, vz, vy, peakY: Math.max(air.peakY, y), ticks: air.ticks + 1, ...(boost > 0 ? { boost } : {}) },
  };
}

/** Whether the Fighter jumps this Tick: Jump pressed while standing on the ground, Idle, Blocking or Attacking. */
const jumps = (f: FighterState, intent: Intent): boolean =>
  intent.jump === true && !f.air && (f.action.kind === 'Idle' || f.action.kind === 'Block' || f.action.kind === 'Attack');

/**
 * One Fighter's Action and movement this Tick, before bodies collide. A Jump leaps
 * off the ground with the walk it had (an Idle Fighter Falls, one Attacking or Blocking keeps
 * at it, and a jumper can Attack or Block mid-air); a Fighter that walked off a ledge and has been
 * airborne for `fall.fallDelay` (or more) Falls, whatever it was doing, unless it is Staggered.
 */
function stepFighter(f: FighterState, index: number, tick: number, intent: Intent, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  let air = f.air;
  let update = updateAction(f, intent, { fighter: index, tick, tuning, emit });
  if (jumps(f, intent)) {
    const to = walk(f, intent, tuning);
    air = { vx: (to.x - f.position.x) / TICK_SECONDS, vz: (to.z - f.position.z) / TICK_SECONDS, vy: tuning.fall.jumpSpeed, peakY: f.y, ticks: 0, jumped: true, launchY: f.y };
    const boost = secondsToTicks(tuning.fall.jumpBoostTime);
    if (boost > 0 && tuning.fall.jumpBoost > 0) air = { ...air, boost };
    // An Attack or Block carries on in the air; only an Idle Fighter takes the Fall pose.
    if (update.action.kind === 'Idle') update = fall();
    emit({ type: 'Jump', fighter: index });
  } else if (air && !air.jumped && air.ticks + 1 >= secondsToTicks(tuning.fall.fallDelay) && update.action.kind !== 'Fall' && update.action.kind !== 'Stagger' && update.action.kind !== 'Knockdown') {
    update = fall();
  }
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
    motion: followMotion(tuning, f.weapon, f.motion, update.motion, update.blendTicks),
  };
  // The Slow counts down every Tick, in Stagger and in the air too; it is stripped, never stored, at zero.
  return { ...next, ...(impact ? { blockImpact: impact } : {}), ...(sliding?.next ? { slide: sliding.next } : {}), ...(slow && slow.ticks > 1 ? { slow: { ticks: slow.ticks - 1 } } : {}) };
}

/**
 * A Fighter that just landed (last Tick `prev` was airborne): a drop (from the top of its arc, capped for a Jump)
 * within `fall.safeHeight` lands softly and a Fall ends in Idle; a deeper one deals
 * `fall.damagePerMetre` per metre beyond it (only while the Duel is being fought) and
 * Staggers it (cause `Landed`). A Fighter already Staggered by something else keeps that Stagger.
 */
function land(prev: FighterState, f: FighterState, index: number, fighting: boolean, tuning: TuningData, emit: (e: SimEvent) => void): FighterState {
  // A Jump's drop counts from no higher than a plain Jump's top above where it left, so a boosted Jump lands softly on level ground.
  const { peakY, launchY } = prev.air!;
  const { jumpSpeed, gravity } = tuning.fall;
  const top = launchY === undefined ? peakY : Math.min(peakY, launchY + (jumpSpeed * jumpSpeed) / (2 * gravity));
  const height = Math.max(0, top - f.y);
  const hard = height > tuning.fall.safeHeight;
  const damage = hard && fighting ? (height - tuning.fall.safeHeight) * tuning.fall.damagePerMetre : 0;
  emit({ type: 'Land', fighter: index, height, damage });
  // A Fighter lying down takes the damage but stays down: it is not Staggered upright.
  if (hard && f.action.kind === 'Knockdown') return { ...f, hp: Math.max(0, f.hp - damage) };
  if (hard) return staggerFighter({ ...f, hp: Math.max(0, f.hp - damage) }, index, 'Landed', tuning, emit);
  if (f.action.kind !== 'Fall') return f;
  return { ...f, action: IDLE_ACTION, motion: followMotion(tuning, f.weapon, f.motion, IDLE_MOTION) };
}

/**
 * Put a Fighter whose body has settled (`f`; last Tick `prev`) on the ground, or in the air:
 *   - Standing, it follows the Walk Surface under it up a step (`fall.stepUp`) or down one
 *     (`fall.snapDown`), so ramps walk both ways. Where there is no ground within a step, or
 *     ground higher than a step blocks the body (`blockedAt`), or it is off the Arena, it slides along whichever axis has ground,
 *     or stays put. Deeper ground below is a ledge: it goes airborne at the speed it walked off at.
 *   - Airborne, it lands once its feet reach the ground under them.
 */
function settleGround(prev: FighterState, f: FighterState, arena: ArenaGeometry, tuning: TuningData): FighterState {
  const { stepUp, snapDown } = tuning.fall;
  const reach = Math.max(prev.y, f.y) + stepUp;
  const under = (p: Vec2) => (blockedAt(arena, p.x, p.z, f.y, tuning) ? null : groundBelow(arena, p.x, p.z, reach));
  let position = f.position;
  let g = under(position);
  if (!g) {
    // Nothing to stand on within a step: blocked, so slide along whichever axis still has ground.
    const tries: Vec2[] = [{ x: position.x, z: prev.position.z }, { x: prev.position.x, z: position.z }, prev.position];
    for (const p of tries) {
      g = under(p);
      if (g) {
        position = p;
        break;
      }
    }
    if (!g) return { ...f, position: prev.position };
  }
  const { air, ...rest } = f;
  if (air) {
    if (f.y > g.y) return position === f.position ? f : { ...f, position, air: { ...air, vx: 0, vz: 0 } };
    return { ...rest, position, y: g.y };
  }
  if (g.y >= f.y - snapDown) return { ...rest, position, y: g.y };
  const vx = (position.x - prev.position.x) / TICK_SECONDS;
  const vz = (position.z - prev.position.z) / TICK_SECONDS;
  return { ...rest, position, air: { vx, vz, vy: 0, peakY: f.y, ticks: 0, jumped: false } };
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
  const living = fighters.flatMap((f, i) => (f.death ? [] : [i]));
  const resolved = resolveBodies(
    living.map((i) => fighters[i]!),
    arena,
    tuning,
  );
  const positions = new Map(living.map((i, k) => [i, resolved[k]!]));
  return fighters.map((f, i) => {
    if (f.death) return f;
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
 * Order within a Tick: Actions and movement → Chambers → Blade Sweeps against Hit Zones
 * → damage → Deaths (a Fighter standing on lava or water dies of it, whatever its HP) → Duel end. A Fighter falls (Death) on the Tick its HP reaches zero, even with
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
    state.fighters.map((f, i) => (f.death ? f : stepFighter(f, i, tick, (fighting && intents[i]) || IDLE_INTENT, tuning, emit))),
    tuning,
    arena,
    fighting,
    emit,
  );
  // Daggers already in flight move first; one thrown this Tick leaves the solved left hand and first moves next Tick.
  const flight = advanceDaggers(state.daggers, arena, tuning, emit);
  const thrown = events.flatMap((e) => (e.type === 'DaggerThrown' ? [launchDagger(fighters[e.thrower]!, e.thrower, tuning)] : []));
  let flying = flight.daggers;
  if (fighting) fighters = resolveChambers(state.fighters, fighters, tuning, emit);
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
      const cause = f.death || f.air ? null : deadlyGround(arena, f.position.x, f.position.z, f.y);
      return cause ? { ...f, hp: 0, death: { tick, cause, blow: null } } : f;
    });
  if (fighting) fighters = fighters.map((f, i) => (f.hp > 0 || f.death ? f : { ...f, death: felled(events, i, fighters, tick, tuning) }));
  fighters.forEach((f, i) => {
    if (f.death?.tick === tick) emit({ type: 'Death', fighter: i, cause: f.death.cause });
  });
  const duel = updateDuel(state.duel, fighters, tick, emit);

  // The seeded generator advances every Tick, so whatever draws from it (the AI Controller) sees a fresh value each Tick.
  return { tick, arena: state.arena, rng: nextFloat(state.rng)[1], fighters, daggers, duel, events };
}
