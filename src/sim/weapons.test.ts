/**
 * Weapons in the Simulation: the Off-hand Grip and the reach pull-in (Skeleton
 * solve), Head and shaft Hits, Blocks on the whole Weapon, Block Impact
 * scaling, Motion overrides and determinism with mismatched Weapons.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type Motion, type OffHandGrip, type TuningData } from '../tuning';
import { advanceBlockImpact } from './actions';
import {
  attack,
  createInitialState,
  duelPlacements,
  fighterPose,
  hashState,
  hitZoneCapsules,
  hold,
  mirrorDirection,
  motionPose,
  restore,
  runDuel,
  runScript,
  scriptIntents,
  snapshot,
  step,
  TICK_RATE,
  type BlockEvent,
  type Direction,
  type HitEvent,
  type Placement,
  type ScriptRun,
} from './index';
import { restTargets } from './motion';
import { offHandSpot, solveSkeleton } from './skeleton';
import { sweepContact } from './sweep';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './vec';

const tuning = loadTuningData();
const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };
const PLACED: Placement = { position: { x: 1.5, z: -2 }, facing: 2.1 };
const TWO_HANDED = ['Longsword', 'Halberd'];
const reach = tuning.skeleton.upperArm + tuning.skeleton.forearm;
const dist = (a: Vec3, b: Vec3) => length(sub(a, b));

/** The Off-hand Grip spot of a solved Weapon, from its world-space hilt, tip and edge. */
function gripSpot(blade: { hilt: Vec3; tip: Vec3; edge: Vec3 }, grip: OffHandGrip): Vec3 {
  const axis = normalize(sub(blade.tip, blade.hilt));
  return add(sub(blade.hilt, scale(axis, grip.along)), scale(blade.edge, grip.radial)); // around = 0 in the roster
}

const events = <T extends HitEvent | BlockEvent>(run: ScriptRun, type: T['type']): T[] =>
  run.states.flatMap((s) => s.events).filter((e): e is T => e.type === type);

describe('Off-hand Grip (Skeleton solve)', () => {
  it('a two-handed Weapon puts the off hand on its Off-hand Grip at every Pose Key of every Motion', () => {
    for (const weapon of TWO_HANDED) {
      const grip = tuning.weapons[weapon]!.offHandGrip!;
      for (const motion of Object.values(tuning.motions)) {
        for (const key of motion.poseKeys) {
          for (const at of [ORIGIN, PLACED]) {
            const pose = motionPose(tuning, motion.name, key.time * TICK_RATE, at, weapon);
            expect(dist(pose.joints.leftHand, gripSpot(pose.blade, grip)), `${weapon} ${motion.name} @${key.time}`).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it('the Halberd holds its hands far apart on the shaft', () => {
    const pose = motionPose(tuning, 'Idle', 0, ORIGIN, 'Halberd');
    expect(dist(pose.joints.leftHand, pose.joints.rightHand)).toBeCloseTo(tuning.weapons.Halberd!.offHandGrip!.along, 6);
  });

  it('when the spot is out of reach, the whole Weapon moves toward the off shoulder until both hands hold it, its orientation unchanged', () => {
    const halberd = tuning.weapons.Halberd!;
    const rest = restTargets(tuning.skeleton);
    // Sword hand well out to the right, Weapon pointing forward: the grip spot, 0.6 m behind, is beyond the left arm.
    const targets = { ...rest, rightHand: { position: { x: 0.35, y: 1.25, z: 0.35 }, rotation: { x: 0, y: 0, z: 0 } } };
    const twoHanded = solveSkeleton(targets, tuning.skeleton, halberd, ORIGIN);
    const oneHanded = solveSkeleton(targets, tuning.skeleton, tuning.weapons['Arming Sword']!, ORIGIN);
    const shoulder = twoHanded.joints.leftShoulder;
    const wanted = gripSpot(oneHanded.blade, halberd.offHandGrip!); // where the spot would be, unmoved
    expect(dist(shoulder, wanted)).toBeGreaterThan(reach);

    // Both hands are on the Weapon, the off hand just within reach (the smallest move).
    expect(dist(twoHanded.joints.leftHand, gripSpot(twoHanded.blade, halberd.offHandGrip!))).toBeLessThan(1e-6);
    expect(dist(twoHanded.joints.leftHand, shoulder)).toBeCloseTo(reach, 6);
    // Moved straight toward the off shoulder, by exactly how far the spot was out of reach.
    const moved = sub(twoHanded.blade.hilt, oneHanded.blade.hilt);
    expect(length(moved)).toBeCloseTo(dist(shoulder, wanted) - reach, 6);
    expect(dot(normalize(moved), normalize(sub(shoulder, wanted)))).toBeCloseTo(1, 6);
    // Same orientation: the blade direction and edge are unchanged.
    const axis = (b: typeof oneHanded.blade) => normalize(sub(b.tip, b.hilt));
    expect(dist(axis(twoHanded.blade), axis(oneHanded.blade))).toBeLessThan(1e-9);
    expect(dist(twoHanded.blade.edge, oneHanded.blade.edge)).toBeLessThan(1e-9);
  });

  it('places the off hand `radial` off the axis, `around` degrees from the edge', () => {
    const grip: OffHandGrip = { along: 0.14, around: 90, radial: 0.04 };
    const longsword = { ...tuning.weapons.Longsword!, offHandGrip: grip };
    const pose = solveSkeleton(restTargets(tuning.skeleton), tuning.skeleton, longsword, ORIGIN);
    const axis = normalize(sub(pose.blade.tip, pose.blade.hilt));
    const offset = sub(pose.joints.leftHand, sub(pose.blade.hilt, scale(axis, grip.along)));
    expect(length(offset)).toBeCloseTo(0.04, 6);
    expect(dot(offset, axis)).toBeCloseTo(0, 6);
    expect(dot(offset, pose.blade.edge)).toBeCloseTo(0, 6); // 90° from the edge
    // and the local-frame helper agrees with the solve's convention
    const local = offHandSpot({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: -1, z: 0 }, grip);
    expect(dist(local, add({ x: 0, y: 0, z: -0.14 }, scale(cross({ x: 0, y: 0, z: 1 }, { x: 0, y: -1, z: 0 }), 0.04)))).toBeLessThan(1e-9);
  });

  it('a one-handed Weapon leaves the off hand on its Pose Keys', () => {
    const targets = { ...restTargets(tuning.skeleton), leftHand: { position: { x: -0.3, y: 1.0, z: 0.2 } } };
    const pose = solveSkeleton(targets, tuning.skeleton, tuning.weapons['Arming Sword']!, ORIGIN);
    // Fighter-local x is the Fighter's right; facing +z at the origin, world x = -local x.
    expect(dist(pose.joints.leftHand, { x: 0.3, y: 1.0, z: 0.2 })).toBeLessThan(1e-9);
  });

  it('the off-hand forearm is a hittable limb where it is drawn, even crossing the body', () => {
    // A Right Block with a Longsword: the off hand reaches across to the sword's grip, in front of the body.
    const pose = motionPose(tuning, 'BlockRight', TICK_RATE, ORIGIN, 'Longsword');
    expect(Math.sign(pose.joints.leftHand.x - pose.joints.chest.x)).toBe(Math.sign(pose.joints.rightShoulder.x - pose.joints.chest.x));
    const zones = hitZoneCapsules(pose, tuning);
    const forearm = zones.find((z) => z.a === pose.joints.leftElbow && z.b === pose.joints.leftHand)!;
    expect(forearm.zone).toBe('limbs');
    // A short blade sweeping onto the off forearm, from straight out from the spine, meets the forearm first.
    const mid = add(forearm.a, scale(sub(forearm.b, forearm.a), 0.3)); // nearer the elbow, clear of the sword hand beside the off hand
    const spine = sub(pose.joints.chest, pose.joints.pelvis);
    const onSpine = add(pose.joints.pelvis, scale(spine, Math.min(1, Math.max(0, dot(sub(mid, pose.joints.pelvis), spine) / dot(spine, spine)))));
    const out = normalize(sub(mid, onSpine));
    const across = normalize(cross(out, normalize(sub(forearm.b, forearm.a))));
    const blade = (at: Vec3) => ({ hilt: sub(at, scale(across, 0.03)), tip: add(at, scale(across, 0.03)), edge: scale(out, -1) });
    const contact = sweepContact(blade(add(mid, scale(out, 0.5))), blade(mid), zones, 3);
    expect(contact?.capsule).toBe(forearm);
  });
});

describe('Head and shaft', () => {
  /** A Halberd Overhead from `distance`: its first Hit. */
  const halberdHit = (t: TuningData, distance: number) =>
    events<HitEvent>(runDuel(t, { distance, weapons: ['Halberd', 'Arming Sword'], a: attack('Overhead'), b: [] }), 'Hit')[0]!;
  const fullShaft = withWeapon(tuning, { shaftDamage: 1 }, 'Halberd');

  it('a Halberd Hit with the Head deals full damage', () => {
    const hit = halberdHit(tuning, 1.6);
    expect(hit.head).toBe(true);
    expect(hit.damage).toBeCloseTo(halberdHit(fullShaft, 1.6).damage, 9);
  });

  it('the same Hit landed with the shaft behind the Head deals damage × shaftDamage', () => {
    const hit = halberdHit(tuning, 1.1);
    expect(hit.head).toBe(false);
    const full = halberdHit(fullShaft, 1.1);
    expect(hit.point).toEqual(full.point);
    expect(hit.damage).toBeCloseTo(full.damage * tuning.weapons.Halberd!.shaftDamage, 9);
  });

  it('a sword is all Head', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    expect(events<HitEvent>(run, 'Hit').map((h) => h.head)).toEqual([true]);
  });

  it('samples a long blade densely enough to find a Hit near its hilt', () => {
    // At close range only the Halberd's shaft, near the hands, reaches the body.
    expect(halberdHit(tuning, 0.7)).toMatchObject({ head: false });
  });
});

describe('Blocks on the whole Weapon', () => {
  const blocked = (weapon: string, d: Direction) => {
    const run = runDuel(tuning, { distance: 1.3, weapons: ['Arming Sword', weapon], a: attack(d), b: hold(150, { block: true, direction: mirrorDirection(d) }) });
    const block = events<BlockEvent>(run, 'Block')[0];
    const at = run.states.find((s) => block && s.events.includes(block));
    return { run, block, defender: at?.fighters[1] };
  };

  it("an Attack meeting a Halberd's shaft between the hands is Blocked, and the Block lands there", () => {
    const { block, defender } = blocked('Halberd', 'Overhead');
    expect(block).toBeDefined();
    const pose = fighterPose(defender!, tuning);
    const axis = normalize(sub(pose.blade.tip, pose.blade.hilt));
    // Along the shaft from the sword hand: behind it (toward the off hand), not past the off hand.
    const along = dot(sub(block!.point, pose.blade.hilt), axis);
    expect(along).toBeLessThan(0);
    expect(along).toBeGreaterThan(-tuning.weapons.Halberd!.offHandGrip!.along);
    const offAxis = length(sub(sub(block!.point, pose.blade.hilt), scale(axis, along)));
    expect(offAxis).toBeLessThanOrEqual(tuning.block.bladeRadius + 1e-9);
    expect(events<HitEvent>(blocked('Halberd', 'Overhead').run, 'Hit')).toEqual([]);
  });
});

describe('Block Impact scaling', () => {
  /** The defender's Block Impact strength, and its sword hand's give one Tick after the Block, for an Overhead stopped by an Overhead Block. */
  function impact(t: TuningData) {
    const run = runDuel(t, { distance: 1.3, weapons: ['Halberd', 'Longsword'], a: attack('Overhead'), b: hold(150, { block: true, direction: 'Overhead' }) });
    const i = run.states.findIndex((s) => s.events.some((e) => e.type === 'Block'));
    const defender = run.states[i]!.fighters[1]!;
    const later = { ...defender, blockImpact: advanceBlockImpact(advanceBlockImpact(defender.blockImpact!, t)!, t)! };
    const { blockImpact: _none, ...still } = later;
    const give = dist(fighterPose(later, t).joints.rightHand, fighterPose(still, t).joints.rightHand);
    return { strength: defender.blockImpact!.strength, give };
  }
  const base = impact(tuning);

  it("scales with the attacker's Weapon's `dealt` and the defender's Weapon's `taken`", () => {
    const halberd = tuning.weapons.Halberd!.blockImpact;
    const longsword = tuning.weapons.Longsword!.blockImpact;
    const dealt = impact(withWeapon(tuning, { blockImpact: { ...halberd, dealt: halberd.dealt * 2 } }, 'Halberd'));
    const taken = impact(withWeapon(tuning, { blockImpact: { ...longsword, taken: longsword.taken / 2 } }, 'Longsword'));
    expect(dealt.strength).toBeCloseTo(base.strength * 2, 9);
    expect(taken.strength).toBeCloseTo(base.strength / 2, 9);
    expect(base.give).toBeGreaterThan(0.005);
    expect(dealt.give).toBeGreaterThan(base.give * 1.5);
    expect(taken.give).toBeLessThan(base.give * 0.75);
  });

  it('a heavy two-handed blow shakes a Block more than an Arming Sword blow, and a two-hander absorbs more', () => {
    const strength = (weapons: string[]) =>
      runDuel(tuning, { distance: 1.3, weapons, a: attack('Overhead'), b: hold(150, { block: true, direction: 'Overhead' }) })
        .states.find((s) => s.fighters[1]!.blockImpact)!.fighters[1]!.blockImpact!.strength;
    const swordOnSword = strength(['Arming Sword', 'Arming Sword']);
    expect(strength(['Halberd', 'Arming Sword'])).toBeGreaterThan(swordOnSword);
    expect(strength(['Arming Sword', 'Longsword'])).toBeLessThan(swordOnSword);
  });
});

describe('Motion overrides', () => {
  /** `tuning` where the Longsword overrides the Overhead with a slower Wind-up. */
  function withOverride(): TuningData {
    const overhead = tuning.motions.Overhead!;
    const slow: Motion = { ...overhead, markers: { ...overhead.markers, windUpEnd: overhead.markers.windUpEnd! + 0.1 } };
    return { ...tuning, motionOverrides: { Longsword: { Overhead: slow } } };
  }
  const releaseTick = (t: TuningData, weapon: string) =>
    runDuel(t, { distance: 3, weapons: [weapon, 'Arming Sword'], a: attack('Overhead'), b: [] }).events.find(
      (e) => e.type === 'AttackPhase' && e.phase === 'Release',
    )!.tick;

  it('a Fighter whose Weapon overrides a Motion plays the override; one without plays the default', () => {
    const t = withOverride();
    expect(releaseTick(t, 'Longsword')).toBe(releaseTick(tuning, 'Longsword') + 6);
    expect(releaseTick(t, 'Halberd')).toBe(releaseTick(tuning, 'Halberd'));
    expect(motionPose(t, 'Overhead', 30, ORIGIN, 'Halberd')).toEqual(motionPose(tuning, 'Overhead', 30, ORIGIN, 'Halberd'));
  });
});

describe('Mismatched Weapons', () => {
  const tracks = [
    [...attack('Overhead'), ...hold(40, { block: true, direction: 'Left' }), ...attack('Right')],
    [...hold(60, { block: true, direction: 'Overhead' }), ...attack('Thrust'), ...attack('Left')],
  ];
  const start = (weapons: string[]) => createInitialState(tuning, 9, duelPlacements(1.4), weapons);

  it('an Arming Sword vs Halberd Duel is deterministic: snapshot, restore and re-simulate give the same hash', () => {
    const straight = runScript(tuning, start(['Arming Sword', 'Halberd']), tracks, 260);
    const again = runScript(tuning, start(['Arming Sword', 'Halberd']), tracks, 260);
    expect(hashState(again.final)).toBe(hashState(straight.final));
    const intents = scriptIntents(tracks, 260);
    let s = restore(snapshot(straight.states[120]!));
    for (let k = 120; k < 260; k++) s = step(s, intents[k]!, tuning);
    expect(hashState(s)).toBe(hashState(straight.final));
  });

  it('the Weapon choice is part of the state and its hash', () => {
    expect(start(['Arming Sword', 'Halberd']).fighters.map((f) => f.weapon)).toEqual(['Arming Sword', 'Halberd']);
    expect(hashState(start(['Arming Sword', 'Halberd']))).not.toBe(hashState(start(['Arming Sword', 'Longsword'])));
    expect(() => start(['Arming Sword', 'Pike'])).toThrow(/Pike/);
  });
});
