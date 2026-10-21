import { describe, expect, it } from 'vitest';
import { loadTuningData, weaponMotion, type TuningData } from '../tuning';
import { footPose } from './gait';
import { fighterPose } from './pose';
import { createInitialState, GET_UP_MOTION, hashValue, hitZoneCapsules, IDLE_INTENT, KNOCKDOWN_MOTION, secondsToTicks, step, type FighterState, type Intent, type KnockdownAction, type SimState } from './index';

const tuning: TuningData = loadTuningData();
const { kick } = tuning;
const weapon = Object.keys(tuning.weapons)[0]!;
const ticksOf = (name: string): number => secondsToTicks(weaponMotion(tuning, weapon, name)!.duration);

/** Kicker (Fighter 0) at the origin facing +z, a victim (Fighter 1) a little over a body-width in front, facing it. */
const GAP = 0.95;
const facing = (): SimState => createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: GAP }, facing: Math.PI }]);

const tick = (s: SimState, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...a }, { ...IDLE_INTENT, ...b }], tuning);
const run = (s: SimState, n: number, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, a, b);
  return s;
};
const landedAt = (s: SimState): boolean => s.events.some((e) => e.type === 'KickLanded');
const knockedAt = (s: SimState): boolean => s.events.some((e) => e.type === 'KickLanded' && e.outcome === 'Knockdown');
const down = (f: FighterState): KnockdownAction => {
  if (f.action.kind !== 'Knockdown') throw new Error(`Expected a Knockdown, got ${f.action.kind}`);
  return f.action;
};

/** Press kick; the victim walks away once the Kick is in Release (so it is still in reach when the leg arrives). Returns the state on the contact Tick. */
function knockedDown(s: SimState = facing()): SimState {
  const walkAway = (state: SimState): Partial<Intent> => {
    const a = state.fighters[0]!.action;
    return a.kind === 'Kick' && a.phase === 'Release' ? { move: { x: 0, z: -1 } } : {};
  };
  s = tick(s, { kick: true });
  for (let i = 0; i < 200 && !knockedAt(s); i++) s = tick(s, {}, walkAway(s));
  if (!knockedAt(s)) throw new Error('The victim was never knocked down');
  return s;
}

/** Run until the victim's Knockdown reaches `phase`. */
function until(s: SimState, phase: KnockdownAction['phase'], a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState {
  for (let i = 0; i < 400; i++) {
    const f = s.fighters[1]!;
    if (f.action.kind === 'Knockdown' && f.action.phase === phase) return s;
    s = tick(s, a, b);
  }
  throw new Error(`The victim never reached ${phase}`);
}

/**
 * Fighter 0 replaced by a fresh, Idle, crouched one at `atZ` on the ground, facing +z (so no stale blade sweeps across the teleport),
 * to swing at a Fighter lying down. A Fighter lying flat is a low target: only a crouched swing reaches it.
 */
function attackerAt(s: SimState, atZ: number, crouch = 1): SimState {
  const fresh = createInitialState(tuning, 1, [{ position: { x: 0, z: atZ }, facing: 0 }]).fighters[0]!;
  return { ...s, fighters: [{ ...fresh, team: s.fighters[0]!.team, crouch }, s.fighters[1]!] };
}

/** Where an attacker stands, on the victim's feet side, for a crouched Overhead swing to come down on the hips of the Fighter lying in `pose`. */
const swingFrom = (pose: ReturnType<typeof fighterPose>): number => pose.joints.pelvis.z - 1.1;
const SWING = { crouch: true, direction: 'Overhead' } as const;

describe('Knockdown', () => {
  it('a walking victim enters Knockdown, hurt and interrupted', () => {
    const at = knockedDown();
    const victim = at.fighters[1]!;
    expect(victim.hp).toBe(tuning.fighter.maxHp - kick.knockdownDamage);
    expect(down(victim)).toEqual({ kind: 'Knockdown', phase: 'Falling', ticks: 0, guard: null });
    expect(victim.motion.name).toBe(KNOCKDOWN_MOTION);
    expect(victim.blockImpact).toBeUndefined();
  });

  it('interrupts an Attack in its Wind-up, which never lands', () => {
    const wind = { attack: true, direction: 'Overhead' } as const;
    let s = tick(facing(), { kick: true }, wind);
    while (!landedAt(s)) s = tick(s, {}, { ...wind, move: { x: 0, z: -1 } });
    expect(down(s.fighters[1]!).phase).toBe('Falling');
    const later = run(s, 120, {}, { attack: false });
    expect(later.fighters[0]!.hp).toBe(tuning.fighter.maxHp);
  });

  it('drops a Block Impact the victim was still shaking', () => {
    const s = facing();
    const shaking = { ...s, fighters: [s.fighters[0]!, { ...s.fighters[1]!, blockImpact: { direction: 'Overhead' as const, strength: 1, tick: 0 } }] };
    expect(knockedDown(shaking).fighters[1]!.blockImpact).toBeUndefined();
  });

  it('takes the feet over from a walk without a snap: they close in on the Motion at a step\'s pace, carried with the body', () => {
    let s = knockedDown();
    const pace = tuning.gait.strideLength / secondsToTicks(tuning.gait.stepDuration);
    for (let i = 0; i < 40; i++) {
      const before = s.fighters[1]!;
      s = tick(s);
      const after = s.fighters[1]!;
      for (const foot of ['left', 'right'] as const) {
        const was = footPose(before.gait[foot], tuning).ground;
        const is = footPose(after.gait[foot], tuning).ground;
        const moved = Math.hypot(is.x - after.position.x - (was.x - before.position.x), is.z - after.position.z - (was.z - before.position.z));
        // Relative to the body, a foot moves no faster than the Motion moves it plus the step pace.
        expect(moved, `${foot} on Tick ${i}`).toBeLessThan(pace + 0.06);
      }
    }
  });

  it('raises a KnockdownPhase event when the body hits the floor and when it starts to get up', () => {
    const lying = until(knockedDown(), 'Down');
    expect(lying.events).toContainEqual({ type: 'KnockdownPhase', fighter: 1, phase: 'Down' });
    const rising = until(lying, 'Rising');
    expect(rising.events).toContainEqual({ type: 'KnockdownPhase', fighter: 1, phase: 'Rising' });
  });

  it('falls, lies for knockdownTicks, gets up and is Idle again', () => {
    let s = knockedDown();
    const phases: string[] = [];
    for (let i = 0; i < 400 && s.fighters[1]!.action.kind === 'Knockdown'; i++) {
      phases.push(down(s.fighters[1]!).phase);
      s = tick(s);
    }
    expect(s.fighters[1]!.action.kind).toBe('Idle');
    const count = (p: string) => phases.filter((x) => x === p).length;
    expect(count('Down')).toBe(kick.knockdownTicks);
    // In order, each phase once.
    expect([...new Set(phases)]).toEqual(['Falling', 'Down', 'Rising']);
    expect(phases.join()).toBe([...phases].sort((a, b) => ['Falling', 'Down', 'Rising'].indexOf(a) - ['Falling', 'Down', 'Rising'].indexOf(b)).join());
    // The Falling and Rising phases take as long as their Motions.
    expect(count('Falling')).toBe(ticksOf(KNOCKDOWN_MOTION));
    expect(count('Rising')).toBe(ticksOf(GET_UP_MOTION));
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.knockdownDamage);
  });

  it('lies flat on its back: every Hit Zone is near the floor, the head behind the pelvis', () => {
    const s = until(knockedDown(), 'Down');
    const victim = s.fighters[1]!;
    const pose = fighterPose(victim, tuning);
    for (const c of hitZoneCapsules(pose, tuning)) {
      expect(c.a.y - victim.y, c.zone).toBeLessThan(0.5);
      expect(c.b.y - victim.y, c.zone).toBeLessThan(0.5);
    }
    // The victim faces the kicker (-z); lying back, its head is on the far side (+z) of its pelvis.
    expect(pose.joints.head.z).toBeGreaterThan(pose.joints.pelvis.z + 0.5);
    // Both feet follow the Motion: the Gait takes no steps while it lies.
    const stepped = s.events.some((e) => e.type === 'Step' && e.fighter === 1);
    expect(stepped).toBe(false);
  });

  it('a blade hits the lying Hit Zones, and the lying Fighter is hurt but not Staggered up', () => {
    const lying = until(knockedDown(), 'Down');
    const victim = lying.fighters[1]!;
    const pose = fighterPose(victim, tuning);
    let s = attackerAt(lying, swingFrom(pose));
    let hit = false;
    s = tick(s, { ...SWING, attack: true });
    for (let i = 0; i < 90 && !hit; i++) {
      s = tick(s, { ...SWING, attack: false });
      hit = s.events.some((e) => e.type === 'Hit' && e.defender === 1);
    }
    expect(hit).toBe(true);
    expect(s.fighters[1]!.hp).toBeLessThan(victim.hp);
    expect(s.fighters[1]!.action.kind).toBe('Knockdown');
  });

  it('a downed guard Blocks a matching Attack, and the lying Fighter keeps its body down', () => {
    const lying = until(knockedDown(), 'Down');
    const victim = lying.fighters[1]!;
    let s = attackerAt(lying, swingFrom(fighterPose(victim, tuning)));
    s = tick(s, { ...SWING, attack: true }, { block: true, direction: 'Overhead' });
    expect(down(s.fighters[1]!).guard).toBe('Overhead');
    let blocked = false;
    for (let i = 0; i < 90 && !blocked; i++) {
      s = tick(s, { ...SWING, attack: false }, { block: true, direction: 'Overhead' });
      blocked = s.events.some((e) => e.type === 'Block' && e.defender === 1);
      expect(s.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
    }
    expect(blocked).toBe(true);
    expect(s.fighters[1]!.hp).toBe(victim.hp);
    expect(s.fighters[0]!.action).toMatchObject({ kind: 'Stagger', cause: 'Blocked' });
    expect(s.fighters[1]!.action.kind).toBe('Knockdown');
    expect(s.fighters[1]!.blockImpact).toBeDefined();
  });

  it('a guard in the wrong Direction does not Block', () => {
    const lying = until(knockedDown(), 'Down');
    let s = attackerAt(lying, swingFrom(fighterPose(lying.fighters[1]!, tuning)));
    s = tick(s, { ...SWING, attack: true }, { block: true, direction: 'Left' });
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      s = tick(s, { ...SWING, attack: false }, { block: true, direction: 'Left' });
      hit = s.events.some((e) => e.type === 'Hit' && e.defender === 1);
      expect(s.events.some((e) => e.type === 'Block')).toBe(false);
    }
    expect(hit).toBe(true);
  });

  it('the guard follows the held block button, and lets go with it', () => {
    let s = until(knockedDown(), 'Down');
    s = tick(s, {}, { block: true, direction: 'Thrust' });
    expect(down(s.fighters[1]!).guard).toBe('Thrust');
    s = tick(s, {}, { block: true, direction: 'Left' });
    expect(down(s.fighters[1]!).guard).toBe('Left');
    s = tick(s);
    expect(down(s.fighters[1]!).guard).toBeNull();
  });

  it('a downed Fighter does not turn, walk, attack, kick or jump', () => {
    const lying = until(knockedDown(), 'Down');
    // The Slide is over by now, so any movement would be the Fighter's own.
    expect(lying.fighters[1]!.slide).toBeUndefined();
    const before = lying.fighters[1]!;
    const s = run(lying, 20, {}, { move: { x: 1, z: 0 }, face: 0.5, attack: true, direction: 'Overhead', kick: true, jump: true, crouch: true, pitch: 0.3 });
    const after = s.fighters[1]!;
    expect(after.action.kind).toBe('Knockdown');
    expect(after.position).toEqual(before.position);
    expect(after.air).toBeUndefined();
    expect(after.y).toBe(before.y);
    expect(after.crouch).toBe(before.crouch);
    expect(after.pitch).toBe(before.pitch);
    expect(after.facing).toBe(before.facing);
  });

  it('a Kick on a Fighter already in Knockdown is a Shove: 1 hp, its Action untouched', () => {
    // Just fallen, the body is still upright enough to be in reach of the leg (a Kick passes over a body lying flat):
    // the victim starts to fall as the Kick reaches Release.
    let s = tick(facing(), { kick: true });
    while (!(s.fighters[0]!.action.kind === 'Kick' && s.fighters[0]!.action.phase === 'Release')) s = tick(s);
    const falling: FighterState = { ...s.fighters[1]!, action: { kind: 'Knockdown', phase: 'Falling', ticks: 0, guard: null }, motion: { name: KNOCKDOWN_MOTION, tick: 0 } };
    s = { ...s, fighters: [s.fighters[0]!, falling] };
    for (let i = 0; i < 100 && !landedAt(s); i++) s = tick(s, {}, { move: { x: 0, z: -1 } });
    expect(landedAt(s)).toBe(true);
    expect(s.events.find((e) => e.type === 'KickLanded')).toMatchObject({ outcome: 'Shove', damage: kick.shoveDamage });
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.shoveDamage);
    expect(down(s.fighters[1]!).phase).toBe('Falling');
  });

  it('a Fighter at the end of a Knockdown can be knocked down again', () => {
    const s = run(until(knockedDown(), 'Down'), kick.knockdownTicks + ticksOf(GET_UP_MOTION) + 2);
    expect(s.fighters[1]!.action.kind).toBe('Idle');
    expect(down(knockedDown(attackerAt(s, s.fighters[1]!.position.z - GAP, 0)).fighters[1]!).phase).toBe('Falling');
  });

  it('is deterministic', () => {
    const go = () => run(knockedDown(), 150, {}, { block: true, direction: 'Left', face: 1 });
    expect(hashValue(go())).toBe(hashValue(go()));
  });
});
