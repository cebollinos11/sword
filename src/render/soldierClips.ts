/**
 * The generic soldier's clips for its impostor atlas (docs/plans/big-battle.md, Stage 2), recorded from the real
 * Simulation, so a Soldier looks like what it does once it is a full Fighter: Idle; walking forward under the Gait (one
 * loop: two steps of each foot apart); one Overhead swing from its start back to Idle; the Stagger of being struck,
 * until Idle again; and the fall of being struck down, its Death Ragdoll (as `drawnPose` draws it). Each frame's pose is
 * moved to the Fighter's own frame: standing at the origin on the ground, facing +z. No WebGL: pure functions of Tuning Data.
 */
import { createInitialState, CENTRE_PLACEMENT, duelPlacements, IDLE_INTENT, step, TICK_SECONDS, type FighterState, type Intent, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import type { TuningData } from '../tuning';
import { drawnPose } from './fighterView';
import { CLIP_FRAMES, IMPOSTOR_CLIPS, type ClipSeconds, type ImpostorClip } from './impostor';

export interface SoldierClips {
  /** Each clip's poses, `CLIP_FRAMES` of them, in the Fighter's own frame. */
  readonly poses: Readonly<Record<ImpostorClip, readonly SkeletonPose[]>>;
  /** Each clip's length (s); the walk's is one loop at `walkSpeed`. */
  readonly seconds: ClipSeconds;
  /** How far (m) one loop of the walk carries the Fighter. */
  readonly walkLoop: number;
}

/** Ticks a recording waits for an Action to end before giving up. */
const LIMIT = 600;
/** Ticks of walking before its loop is recorded, so the Gait has settled into its stride. */
const WALK_WARMUP = 60;
/** How long (s) the fall is recorded: the Ragdoll has come to rest by then. */
const DEATH_SECONDS = 1.4;
/** The distance (m) between the soldier and the one who strikes it: well inside the Weapon's reach. */
const STRIKE_DISTANCE = 1.3;

/** A pose moved into Fighter `f`'s own frame: its feet's ground point at the origin, facing +z. */
export function localPose(pose: SkeletonPose, f: Pick<FighterState, 'position' | 'y' | 'facing'>): SkeletonPose {
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const local = (v: Vec3): Vec3 => {
    const dx = v.x - f.position.x;
    const dz = v.z - f.position.z;
    return { x: dx * c - dz * s, y: v.y - f.y, z: dx * s + dz * c };
  };
  const joints = {} as Record<keyof SkeletonPose['joints'], Vec3>;
  for (const name of Object.keys(pose.joints) as (keyof SkeletonPose['joints'])[]) joints[name] = local(pose.joints[name]);
  return {
    joints,
    blade: {
      hilt: local(pose.blade.hilt),
      tip: local(pose.blade.tip),
      edge: rotate(pose.blade.edge, c, s),
    },
  };
}

/** A direction (not a point) turned into the Fighter's frame. */
const rotate = (v: Vec3, c: number, s: number): Vec3 => ({
  x: v.x * c - v.z * s,
  y: v.y,
  z: v.x * s + v.z * c,
});

/** Run `initial` with Fighter i driven by `intents(tick)[i]`, every state kept, until `done` holds (or LIMIT Ticks). */
function record(tuning: TuningData, initial: SimState, intents: (tick: number) => Intent[], done: (s: SimState, tick: number) => boolean): SimState[] {
  const states = [initial];
  let s = initial;
  for (let t = 0; t < LIMIT && !done(s, t); t++) {
    s = step(s, intents(t), tuning);
    states.push(s);
  }
  return states;
}

/** `count` poses of Fighter 0 evenly over states[from] to states[to] (excluded), each in the Fighter's own frame at that Tick. */
function sample(states: readonly SimState[], from: number, to: number, count: number, tuning: TuningData): SkeletonPose[] {
  return Array.from({ length: count }, (_, k) => {
    const at = Math.min(states.length - 1, from + Math.floor(((to - from) * k) / count));
    const state = states[at]!;
    return localPose(drawnPose(states[Math.max(0, at - 1)]!, state, 0, 1, tuning), state.fighters[0]!);
  });
}

const idleFor = (n: number): Intent[] => Array.from({ length: n }, () => IDLE_INTENT);

/** The soldier's clips, wielding `weapon`, recorded from the Simulation (the Crowd walks at `tuning.battle.crowd.walkSpeed`). */
export function soldierClips(tuning: TuningData, weapon: string): SoldierClips {
  const idleMotion = tuning.motions.Idle!;
  const alone = createInitialState(tuning, 1, [CENTRE_PLACEMENT], [weapon]);

  // Idle: one loop of its Motion.
  const idleTicks = Math.max(1, Math.round(idleMotion.duration / TICK_SECONDS));
  const idle = record(
    tuning,
    alone,
    () => idleFor(1),
    (_, t) => t >= idleTicks,
  );

  // Walking forward: from a left foot's Step, after the warm-up, to the next but one.
  const forward: Intent = { ...IDLE_INTENT, move: { x: 0, z: 1 }, face: 0 };
  let lefts: number[] = [];
  const walk = record(
    tuning,
    alone,
    () => [forward],
    (s, t) => {
      if (t > WALK_WARMUP && s.events.some((e) => e.type === 'Step' && e.fighter === 0 && e.foot === 'left')) lefts.push(t);
      return lefts.length >= 3;
    },
  );
  if (lefts.length < 3) throw new Error('soldierClips: the walk never settled into steps');
  // The state after Tick t is states[t]; a loop is two strides of the left foot (one of each foot in between).
  lefts = lefts.slice(0, 3);
  const walkFrom = lefts[0]!;
  const walkTo = lefts[2]!;
  const walkLoop = walk[walkTo]!.fighters[0]!.position.z - walk[walkFrom]!.fighters[0]!.position.z;

  // One Overhead swing, from the press until it is Idle again.
  const swing = record(
    tuning,
    alone,
    (t) => [t === 0 ? { ...IDLE_INTENT, attack: true, direction: 'Overhead' } : IDLE_INTENT],
    (s, t) => t > 1 && s.fighters[0]!.action.kind === 'Idle',
  );

  // Struck by an Overhead it does not Block: its Stagger until it is Idle again.
  const pair = createInitialState(tuning, 1, duelPlacements(STRIKE_DISTANCE), [weapon, weapon]);
  const strike = (t: number): Intent[] => [IDLE_INTENT, t === 0 ? { ...IDLE_INTENT, attack: true, direction: 'Overhead' } : IDLE_INTENT];
  let staggered = false;
  const struck = record(tuning, pair, strike, (s) => {
    const stagger = s.fighters[0]!.action.kind === 'Stagger';
    staggered ||= stagger;
    return staggered && !stagger;
  });
  const hitAt = struck.findIndex((s) => s.fighters[0]!.action.kind === 'Stagger');
  if (hitAt < 0) throw new Error('soldierClips: the strike never Staggered the soldier');
  const recovered = struck.findIndex((s, k) => k > hitAt && s.fighters[0]!.action.kind !== 'Stagger');
  const staggerTo = recovered < 0 ? struck.length - 1 : recovered;

  // Struck down from 1 HP: its fall, as its Death Ragdoll, for DEATH_SECONDS.
  const weak: SimState = {
    ...pair,
    fighters: pair.fighters.map((f, i) => (i === 0 ? { ...f, hp: 1 } : f)),
  };
  const deathTicks = Math.round(DEATH_SECONDS / TICK_SECONDS);
  const fell = record(tuning, weak, strike, (s) => Boolean(s.fighters[0]!.death) && s.tick >= s.fighters[0]!.death!.tick + deathTicks);
  const diedAt = fell.findIndex((s) => Boolean(s.fighters[0]!.death));
  if (diedAt < 0) throw new Error('soldierClips: the strike never felled the soldier');

  const poses: Record<ImpostorClip, SkeletonPose[]> = {
    idle: sample(idle, 0, idleTicks, CLIP_FRAMES.idle, tuning),
    walk: sample(walk, walkFrom, walkTo, CLIP_FRAMES.walk, tuning),
    swing: sample(swing, 1, swing.length - 1, CLIP_FRAMES.swing, tuning),
    stagger: sample(struck, hitAt, staggerTo, CLIP_FRAMES.stagger, tuning),
    death: sample(fell, diedAt, fell.length, CLIP_FRAMES.death, tuning),
  };
  const seconds: Record<ImpostorClip, number> = {
    idle: idleTicks * TICK_SECONDS,
    walk: walkLoop / tuning.battle.crowd.walkSpeed,
    swing: (swing.length - 2) * TICK_SECONDS,
    stagger: (staggerTo - hitAt) * TICK_SECONDS,
    death: (fell.length - diedAt) * TICK_SECONDS,
  };
  for (const clip of IMPOSTOR_CLIPS) if (!(seconds[clip] > 0)) throw new Error(`soldierClips: the ${clip} clip is empty`);
  return { poses, seconds, walkLoop };
}
