/**
 * The Throwing Dagger in flight (ADR 0008): launched from the thrower's left hand, it flies an arc under gravity, one
 * semi-implicit Euler step per Tick, and stops at a Wall, a Walk Surface or after `dagger.maxTicks`. Pure functions of
 * their inputs, so both peers (and a Rollback re-simulation) see the same dagger.
 */
import type { ArenaGeometry, TuningData } from '../tuning';
import { groundBelow, surfaceHeight, surfacesAt, wallCrossing } from './arena';
import { TICK_SECONDS } from './constants';
import type { Emit } from './events';
import { fighterPose } from './pose';
import type { DaggerState, FighterState } from './state';
import { add, length, normalize, scale, sub, type Vec3 } from './vec';

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
 * The dagger Fighter `index` throws now: at its solved left hand, aimed along its `facing` and `pitch` plus
 * `dagger.loft`. The thrower's own velocity is not added.
 */
export function launchDagger(f: FighterState, index: number, tuning: TuningData): DaggerState {
  const elevation = f.pitch + tuning.dagger.loft * DEG;
  const speed = tuning.dagger.speed;
  const horizontal = Math.cos(elevation) * speed;
  return {
    owner: index,
    team: f.team,
    thrownAt: f.action.kind === 'Throw' ? f.action.startTick : 0,
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

/** Fly the dagger one Tick: gravity, then a move, swept in short samples; the result is the sweep, and `ended` with it if it stuck or ran out. */
function fly(d: DaggerState, arena: ArenaGeometry, tuning: TuningData, emit: Emit): { next: DaggerState; sweep: DaggerSweep } {
  const velocity = { x: d.velocity.x, y: d.velocity.y - tuning.dagger.gravity * TICK_SECONDS, z: d.velocity.z };
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
 * Advance every dagger in flight by one Tick, in order: the survivors, and every dagger's sweep (the segment it
 * covered, cut short where it stuck) for the Fighters' contacts. A dagger that stuck emits `DaggerStuck`; one
 * that ran out of Ticks just drops out.
 */
export function advanceDaggers(daggers: readonly DaggerState[], arena: ArenaGeometry, tuning: TuningData, emit: Emit): { daggers: DaggerState[]; sweeps: DaggerSweep[] } {
  const flown = daggers.map((d) => fly(d, arena, tuning, emit));
  return { daggers: flown.filter((f) => !f.sweep.ended).map((f) => f.next), sweeps: flown.map((f) => f.sweep) };
}
