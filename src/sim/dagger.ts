/**
 * The Throwing Dagger in flight (ADR 0008): launched from the thrower's left hand, it flies an arc under gravity, one
 * semi-implicit Euler step per Tick, turning a little toward an enemy ahead of it (Homing), and stops at a Wall, a Walk Surface or after `dagger.maxTicks`. Pure functions of
 * their inputs, so both peers (and a Rollback re-simulation) see the same dagger.
 */
import { sizedTuning, type ArenaGeometry, type TuningData } from '../tuning';
import { groundBelow, surfaceHeight, surfacesAt, wallCrossing } from './arena';
import { TICK_SECONDS } from './constants';
import type { Emit } from './events';
import { fighterPose } from './pose';
import { inDuel } from './duel';
import type { DaggerState, FighterState } from './state';
import { add, dot, length, normalize, scale, sub, type Vec3 } from './vec';

/** A dagger's path samples are at most this far apart (m), so a thin Wall or a Walk Surface edge is never stepped over. */
const SAMPLE_SPACING = 0.1;

const DEG = Math.PI / 180;

/** A dagger's path this Tick, from where it was to where it got to (the point it stopped at, if it did). */
export interface DaggerSweep {
  readonly from: Vec3;
  readonly to: Vec3;
  /** True when the dagger stops here (stuck in a Wall or Walk Surface, or out of Ticks), so it is not in the survivors. */
  readonly ended: boolean;
  /** The dagger as it was when this Tick began. */
  readonly dagger: DaggerState;
}

/**
 * The dagger Fighter `index` throws now, on Tick `tick`: at its solved left hand, aimed along its `facing` and `pitch` plus
 * `dagger.loft`. The thrower's own velocity is not added.
 */
export function launchDagger(f: FighterState, index: number, tick: number, tuning: TuningData): DaggerState {
  const elevation = f.pitch + tuning.dagger.loft * DEG;
  const speed = tuning.dagger.speed;
  const horizontal = Math.cos(elevation) * speed;
  return {
    owner: index,
    team: f.team,
    thrownAt: tick,
    position: fighterPose(f, tuning).joints.leftHand,
    velocity: { x: Math.sin(f.facing) * horizontal, y: Math.sin(elevation) * speed, z: Math.cos(f.facing) * horizontal },
    ticks: 0,
  };
}

/**
 * Where the segment a→b first meets a Walk Surface (the point), or null. It meets one by passing down through
 * its plane inside its outline, or by running into raised ground sideways that a body could not walk onto
 * (higher than `fall.stepUp`, lower than `fighter.height`, as `blockedAt` counts it); taller ground has its own Walls.
 */
function groundCrossing(a: Vec3, b: Vec3, arena: ArenaGeometry, tuning: TuningData): Vec3 | null {
  for (const i of surfacesAt(arena, b.x, b.z)) {
    const h = surfaceHeight(arena, i, b.x, b.z);
    if (b.y >= h) continue;
    const ha = surfaceHeight(arena, i, a.x, a.z);
    if (a.y >= ha) {
      // Passed down through the plane: the point on it.
      const da = a.y - ha;
      const t = da / (da + (h - b.y));
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      return { x, y: surfaceHeight(arena, i, x, z), z };
    }
    const under = groundBelow(arena, a.x, a.z, a.y);
    if (under && h > under.y + tuning.fall.stepUp && h < under.y + tuning.fighter.height) return a;
  }
  return null;
}

/** Where a Homing dagger aims on a Fighter: its chest, this share of its standing height above its feet. */
const AIM_HEIGHT = 0.6;

/**
 * Homing: the velocity turned toward the nearest living enemy that lies within `dagger.homingCone` of the dagger's
 * heading and `dagger.homingRange` of it, by at most `dagger.homingTurn` degrees a second, at the same speed. A dagger
 * with no such enemy flies on unchanged, so it never turns hard onto a Fighter beside or behind it.
 */
function home(d: DaggerState, velocity: Vec3, fighters: readonly FighterState[], tuning: TuningData): Vec3 {
  const { homingCone, homingRange, homingTurn } = tuning.dagger;
  const speed = length(velocity);
  if (homingTurn <= 0 || speed === 0) return velocity;
  const heading = scale(velocity, 1 / speed);
  const cosCone = Math.cos(homingCone * DEG);
  let best: { distance: number; toward: Vec3 } | null = null;
  fighters.forEach((f, j) => {
    if (!inDuel(f) || f.hp <= 0 || f.team === d.team || j === d.owner) return;
    const offset = sub({ x: f.position.x, y: f.y + sizedTuning(tuning, f.size).fighter.height * AIM_HEIGHT, z: f.position.z }, d.position);
    const distance = length(offset);
    if (distance === 0 || distance > homingRange) return;
    const toward = scale(offset, 1 / distance);
    if (dot(heading, toward) < cosCone) return;
    if (!best || distance < best.distance) best = { distance, toward };
  });
  const found = best as { toward: Vec3 } | null;
  if (!found) return velocity;
  const cos = Math.min(1, dot(heading, found.toward));
  const angle = Math.acos(cos);
  const turn = homingTurn * DEG * TICK_SECONDS;
  if (angle <= turn) return scale(found.toward, speed);
  // Rotate the heading toward the target by `turn`, in the plane the two share.
  const side = normalize(sub(found.toward, scale(heading, cos)));
  return scale(add(scale(heading, Math.cos(turn)), scale(side, Math.sin(turn))), speed);
}

/** Fly the dagger one Tick: Homing, gravity, then a move, swept in short samples; the result is the sweep, and `ended` with it if it stuck or ran out. */
function fly(d: DaggerState, fighters: readonly FighterState[], arena: ArenaGeometry, tuning: TuningData, emit: Emit): { next: DaggerState; sweep: DaggerSweep } {
  const homed = home(d, d.velocity, fighters, tuning);
  const velocity = { x: homed.x, y: homed.y - tuning.dagger.gravity * TICK_SECONDS, z: homed.z };
  const target = add(d.position, scale(velocity, TICK_SECONDS));
  const samples = Math.max(1, Math.ceil(length(sub(target, d.position)) / SAMPLE_SPACING));
  let prev = d.position;
  for (let k = 1; k <= samples; k++) {
    const t = k / samples;
    const q: Vec3 = { x: d.position.x + (target.x - d.position.x) * t, y: d.position.y + (target.y - d.position.y) * t, z: d.position.z + (target.z - d.position.z) * t };
    const hit = wallCrossing(prev, q, arena)?.point ?? groundCrossing(prev, q, arena, tuning);
    if (hit) {
      emit({ type: 'DaggerStuck', point: hit, direction: normalize(velocity) });
      return { next: d, sweep: { from: d.position, to: hit, ended: true, dagger: d } };
    }
    prev = q;
  }
  const next: DaggerState = { ...d, position: target, velocity, ticks: d.ticks + 1 };
  return { next, sweep: { from: d.position, to: target, ended: next.ticks >= tuning.dagger.maxTicks, dagger: d } };
}

/**
 * Advance every dagger in flight by one Tick, in order, each Homing on `fighters`: the survivors, and every dagger's sweep (the segment it
 * covered, cut short where it stuck) for the Fighters' contacts. A dagger that stuck emits `DaggerStuck`; one
 * that ran out of Ticks just drops out.
 */
export function advanceDaggers(
  daggers: readonly DaggerState[],
  fighters: readonly FighterState[],
  arena: ArenaGeometry,
  tuning: TuningData,
  emit: Emit,
): { daggers: DaggerState[]; sweeps: DaggerSweep[] } {
  const flown = daggers.map((d) => fly(d, fighters, arena, tuning, emit));
  return { daggers: flown.filter((f) => !f.sweep.ended).map((f) => f.next), sweeps: flown.map((f) => f.sweep) };
}
