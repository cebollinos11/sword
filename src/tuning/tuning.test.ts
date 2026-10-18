import { describe, expect, it } from 'vitest';
import { loadTuningData, motionFileName, parseMotion, parseTuningData, serializeMotion, TuningDataError } from './index';

/** A minimal valid raw Tuning Data set (independent of the repo files). */
function goodRaw() {
  return {
    fighter: { maxHp: 100, walkSpeed: 2, radius: 0.3, height: 1.8, turnSpeed: 360, motionBlend: 0.15, lookPitchMax: 50, lookLean: 0.45, lookHipShift: 0.3, crouchDepth: 0.4, crouchSpeed: 6, crouchWalkFactor: 0.5 },
    arena: { match: 'flat', editor: 'flat' },
    arenas: [{ name: 'flat', radius: 8, walk: [{ id: 'WALK_floor', points: [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]] }] }],
    fall: { gravity: 14, jumpSpeed: 4.8, airControl: 4, fallDelay: 0.2, safeHeight: 1.6, damagePerMetre: 22, stepUp: 0.35, snapDown: 0.4 },
    weapons: [{ name: 'Sword', grip: 'oneHanded', length: 0.9, damage: 30, speed: 10, gripLength: 0.12 }],
    hitZones: {
      head: { multiplier: 1.5, radius: 0.11 },
      torso: { multiplier: 1, radius: 0.15 },
      limbs: { multiplier: 0.6, radius: 0.06 },
    },
    chamber: { windowSeconds: 0.15 },
    kick: { knockdownDamage: 5, shoveDamage: 1, knockdownSlide: 2.5, shoveSlide: 0.3, knockdownSlideTicks: 12, shoveSlideTicks: 6, knockdownTicks: 60, whiffRecovery: 24, legRadius: 0.08 },
    dagger: { count: 3, speed: 18, gravity: 9.8, loft: 4, radius: 0.04, maxTicks: 90, damage: 5, slowFactor: 0.6, slowTicks: 180, throwWalkFactor: 1, maxHoldTicks: 120, blockImpact: 0.3 },
    block: { facingHalfAngle: 60, bladeRadius: 0.05, impactDistance: 0.12, impactTilt: 15, impactLean: 5, impactFrequency: 4, impactDuration: 0.2, correctionWindow: 0.15 },
    match: { duelDistance: 2, interDuelSeconds: 2, lineSpacing: 1.5 },
    gait: { strideThreshold: 0.2, stepDuration: 0.1, stepHeight: 0.08, hipBob: 0.02, hipSway: 0.02 },
    camera: { back: 3, shoulder: 0.7, eyeHeight: 2, ahead: 2.5, lookHeight: 1.2, orbitDistance: 7, orbitHeight: 5 },
    skeleton: {
      pelvisHeight: 0.95,
      hipWidth: 0.2,
      thigh: 0.46,
      shin: 0.46,
      ankleHeight: 0.06,
      spine: 0.5,
      shoulderWidth: 0.4,
      neck: 0.1,
      headRadius: 0.11,
      upperArm: 0.3,
      forearm: 0.28,
    },
    ai: {
      attackRange: 1.4,
      retreatRange: 0.9,
      kickRange: 1,
      kickRate: 0.1,
      throwRange: 12,
      throwRate: 0.04,
      aggression: 0.05,
      difficulties: { Normal: { reactionTime: 0.25, mistakeRate: 0.2, feintRate: 0.1 } },
    },
    motions: [
      {
        name: 'Idle',
        duration: 1,
        loop: true,
        poseKeys: [{ time: 0, ease: 'linear', hip: { x: 0, y: 0.9, z: 0 } }],
      },
    ],
  };
}

describe('Tuning Data', () => {
  it('loads the repo data/ files', () => {
    const t = loadTuningData();
    expect(t.fighter.walkSpeed).toBe(2.5);
    expect(t.arenas.circle!.radius).toBe(8);
    expect(t.arenas[t.arena.match]).toBeDefined();
    expect(t.weapons['Arming Sword']!.length).toBeGreaterThan(0);
    expect(t.hitZones.head.multiplier).toBeGreaterThan(t.hitZones.limbs.multiplier);
    expect(t.chamber.windowSeconds).toBe(0.15);
    expect(Object.keys(t.motions)).toEqual(expect.arrayContaining(['Idle', 'Overhead']));
  });

  it('accepts a minimal valid set', () => {
    const t = parseTuningData(goodRaw());
    expect(t.motions.Idle?.poseKeys[0]?.hip).toEqual({ x: 0, y: 0.9, z: 0 });
  });

  it('rejects invalid data on load', () => {
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, arena: { match: 'nowhere', editor: 'flat' } })).toThrow(TuningDataError);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, walkSpeed: '2' } })).toThrow(/walkSpeed/);
    expect(() => parseTuningData({ ...good, fighter: undefined })).toThrow(/fighter/);
    const sword = good.weapons[0]!;
    expect(() => parseTuningData({ ...good, weapons: [{ ...sword, length: 0 }] })).toThrow(/^weapons\/Sword\.length/);
    expect(() => parseTuningData({ ...good, weapons: [{ ...sword, speed: undefined }] })).toThrow(/^weapons\/Sword\.speed/);
    expect(() => parseTuningData({ ...good, hitZones: { ...good.hitZones, head: { multiplier: 0, radius: 0.1 } } })).toThrow(
      /hitZones\.head\.multiplier/,
    );
    expect(() => parseTuningData({ ...good, hitZones: { head: good.hitZones.head, torso: good.hitZones.torso } })).toThrow(
      /hitZones\.limbs/,
    );
    expect(() => parseTuningData({ ...good, chamber: { windowSeconds: 0 } })).toThrow(/chamber\.windowSeconds/);
    expect(() => parseTuningData({ ...good, chamber: undefined })).toThrow(/chamber/);
    expect(() => parseTuningData({ ...good, skeleton: { ...good.skeleton, forearm: -1 } })).toThrow(/skeleton\.forearm/);
    expect(() => parseTuningData({ ...good, block: undefined })).toThrow(/block/);
    expect(() => parseTuningData({ ...good, block: { ...good.block, facingHalfAngle: 0 } })).toThrow(/block\.facingHalfAngle/);
    expect(() => parseTuningData({ ...good, block: { ...good.block, facingHalfAngle: 181 } })).toThrow(/block\.facingHalfAngle/);
    expect(() => parseTuningData({ ...good, match: undefined })).toThrow(/match/);
    expect(() => parseTuningData({ ...good, match: { duelDistance: 0, interDuelSeconds: 2, lineSpacing: 1.5 } })).toThrow(/match\.duelDistance/);
    expect(() => parseTuningData({ ...good, match: { duelDistance: 2, interDuelSeconds: 0, lineSpacing: 1.5 } })).toThrow(/match\.interDuelSeconds/);
  });

  it('loads the Dagger Tuning Data and its Throw Motion, and rejects bad Dagger data', () => {
    const t = loadTuningData();
    expect(t.dagger).toEqual({ count: 3, speed: 18, gravity: 9.8, loft: 4, radius: 0.04, maxTicks: 90, damage: 5, slowFactor: 0.6, slowTicks: 180, throwWalkFactor: 1, maxHoldTicks: 120, blockImpact: 0.3 });
    expect(t.motions.Throw!.markers.windUpEnd).toBeLessThan(t.motions.Throw!.markers.releaseEnd!);
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, dagger: undefined })).toThrow(/dagger/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, slowTicks: 2.5 } })).toThrow(/dagger\.slowTicks/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, maxTicks: 0 } })).toThrow(/dagger\.maxTicks/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, count: 1.5 } })).toThrow(/dagger\.count/);
    expect(() => parseTuningData({ ...good, dagger: { ...good.dagger, speed: 0 } })).toThrow(/dagger\.speed/);
  });

  it('loads the Kick Tuning Data and its Motion, and rejects bad Kick data', () => {
    const t = loadTuningData();
    expect(t.kick).toEqual({ knockdownDamage: 5, shoveDamage: 1, knockdownSlide: 2.5, shoveSlide: 0.3, knockdownSlideTicks: 12, shoveSlideTicks: 6, knockdownTicks: 60, whiffRecovery: 24, legRadius: 0.08 });
    expect(t.motions.Kick!.markers.windUpEnd).toBeLessThan(t.motions.Kick!.markers.releaseEnd!);
    const good = goodRaw();
    expect(() => parseTuningData({ ...good, kick: undefined })).toThrow(/kick/);
    expect(() => parseTuningData({ ...good, kick: { ...good.kick, whiffRecovery: 2.5 } })).toThrow(/kick\.whiffRecovery/);
    expect(() => parseTuningData({ ...good, kick: { ...good.kick, legRadius: 0 } })).toThrow(/kick\.legRadius/);
  });

  it('loads the Block facing rule and the Match pacing from data/block.json and data/match.json', () => {
    const t = loadTuningData();
    expect(t.block.facingHalfAngle).toBe(60);
    expect(t.match).toEqual({ duelDistance: 2, interDuelSeconds: 2, lineSpacing: 1.5 });
  });

  it('loads AI difficulty presets (Reaction Time, mistake rate) from data/ai.json', () => {
    const t = loadTuningData();
    expect(Object.keys(t.ai.difficulties)).toEqual(['Easy', 'Normal', 'Hard']);
    const { Easy, Hard } = t.ai.difficulties;
    expect(Hard!.reactionTime).toBeLessThan(Easy!.reactionTime);
    expect(Hard!.mistakeRate).toBeLessThan(Easy!.mistakeRate);
  });

  it('rejects invalid AI Tuning Data', () => {
    const good = goodRaw();
    const withDifficulty = (d: object) => ({ ...good, ai: { ...good.ai, difficulties: { Normal: d } } });
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 1.5, feintRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.mistakeRate/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: -0.1, mistakeRate: 0, feintRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.reactionTime/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.feintRate/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 0, feintRate: -0.1 }))).toThrow(/ai\.difficulties\.Normal\.feintRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, difficulties: {} } })).toThrow(/ai\.difficulties/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, aggression: 2 } })).toThrow(/ai\.aggression/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, kickRate: 2 } })).toThrow(/ai\.kickRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, kickRange: 0 } })).toThrow(/ai\.kickRange/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, throwRate: 2 } })).toThrow(/ai.throwRate/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, throwRange: 0 } })).toThrow(/ai.throwRange/);
    expect(parseTuningData(good).ai).toMatchObject({ kickRange: 1, kickRate: 0.1, throwRange: 12, throwRate: 0.04 });
    expect(parseTuningData(withDifficulty({ reactionTime: 0, mistakeRate: 0, feintRate: 1 })).ai.difficulties.Normal).toEqual({ reactionTime: 0, mistakeRate: 0, feintRate: 1 });
  });

  it('loads the Gait (stride threshold, step duration, step height, hip bob, hip sway) from data/gait.json', () => {
    const { gait } = loadTuningData();
    expect(gait.strideThreshold).toBeGreaterThan(0);
    expect(gait.stepDuration).toBeGreaterThan(0);
    expect(gait.stepHeight).toBeGreaterThan(0);
    // Small, non-zero hip movement by default.
    expect(gait.hipBob).toBeGreaterThan(0);
    expect(gait.hipBob).toBeLessThan(0.1);
    expect(gait.hipSway).toBeGreaterThan(0);
    expect(gait.hipSway).toBeLessThan(0.1);
  });

  it('rejects invalid Gait Tuning Data, naming the full path', () => {
    const good = goodRaw();
    const withGait = (g: object) => ({ ...good, gait: { ...good.gait, ...g } });
    expect(() => parseTuningData({ ...good, gait: undefined })).toThrow(/gait/);
    expect(() => parseTuningData(withGait({ strideThreshold: 'far' }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ strideThreshold: -0.1 }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ strideThreshold: 5 }))).toThrow(/gait\.strideThreshold/);
    expect(() => parseTuningData(withGait({ stepDuration: 0 }))).toThrow(/gait\.stepDuration/);
    expect(() => parseTuningData(withGait({ stepDuration: 10 }))).toThrow(/gait\.stepDuration/);
    expect(() => parseTuningData(withGait({ stepHeight: -0.01 }))).toThrow(/gait\.stepHeight/);
    expect(() => parseTuningData(withGait({ stepHeight: 2 }))).toThrow(/gait\.stepHeight/);
    expect(parseTuningData(withGait({ stepHeight: 0 })).gait.stepHeight).toBe(0);
    expect(() => parseTuningData(withGait({ hipBob: undefined }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ hipBob: -0.01 }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ hipBob: 1 }))).toThrow(/gait\.hipBob/);
    expect(() => parseTuningData(withGait({ hipSway: 'lots' }))).toThrow(/gait\.hipSway/);
    expect(() => parseTuningData(withGait({ hipSway: -0.01 }))).toThrow(/gait\.hipSway/);
    expect(() => parseTuningData(withGait({ hipSway: 1 }))).toThrow(/gait\.hipSway/);
    expect(parseTuningData(withGait({ hipBob: 0, hipSway: 0 })).gait).toMatchObject({ hipBob: 0, hipSway: 0 });
  });

  it('requires an Idle Motion and unique Motion names', () => {
    const good = goodRaw();
    const overhead = { ...good.motions[0]!, name: 'Overhead' };
    expect(() => parseTuningData({ ...good, motions: [overhead] })).toThrow(/Idle/);
    expect(() => parseTuningData({ ...good, motions: [good.motions[0], good.motions[0]] })).toThrow(/duplicate/i);
  });
});

describe('Motion validation', () => {
  const key = (time: number, extra: object = {}) => ({ time, ease: 'easeInOut', ...extra });
  const motion = (poseKeys: unknown[], extra: object = {}) => ({ name: 'Overhead', duration: 1, poseKeys, ...extra });

  it('keeps every Pose Key channel and named markers', () => {
    const m = parseMotion(
      motion(
        [
          key(0, {
            rightHand: { position: { x: 0.2, y: 1, z: 0.3 }, rotation: { x: -60, y: 0, z: 0 } },
            leftHand: { position: { x: -0.2, y: 0.9, z: 0 } },
            torso: { twist: 10, lean: -5 },
            hip: { x: 0, y: 0.9, z: 0 },
            leftFoot: { x: -0.1, z: 0.1 },
            rightFoot: { x: 0.1, z: -0.1 },
          }),
          key(1),
        ],
        { markers: { windUpEnd: 0.3, releaseEnd: 0.6 } },
      ),
    );
    expect(m.loop).toBe(false);
    expect(m.markers).toEqual({ windUpEnd: 0.3, releaseEnd: 0.6 });
    expect(m.poseKeys[0]?.torso).toEqual({ twist: 10, lean: -5 });
    expect(m.poseKeys[0]?.rightFoot).toEqual({ x: 0.1, z: -0.1 });
  });

  it('keeps the kickFoot and body channels, and serializes them back', () => {
    const m = parseMotion(motion([key(0, { kickFoot: { x: 0.1, y: 0.6, z: 0.5 }, body: { tilt: 90, drop: 0.1 } }), key(1)]));
    expect(m.poseKeys[0]?.kickFoot).toEqual({ x: 0.1, y: 0.6, z: 0.5 });
    expect(m.poseKeys[0]?.body).toEqual({ tilt: 90, drop: 0.1 });
    expect(m.poseKeys[1]).not.toHaveProperty('kickFoot');
    expect(parseMotion(JSON.parse(serializeMotion(m)))).toEqual(m);
  });

  it('rejects a malformed kickFoot or body with the full path', () => {
    expect(() => parseMotion(motion([key(0, { kickFoot: { x: 0, y: 'up', z: 0 } })]))).toThrow(/poseKeys\[0\]\.kickFoot\.y/);
    expect(() => parseMotion(motion([key(0, { body: { tilt: 90 } })]))).toThrow(/poseKeys\[0\]\.body/);
  });

  it('rejects an unknown easing curve, naming the Pose Key', () => {
    expect(() => parseMotion(motion([key(0, { ease: 'bouncy' })]))).toThrow(/Overhead\.poseKeys\[0\]\.ease/);
  });

  it('rejects Pose Keys out of time order or past the duration', () => {
    expect(() => parseMotion(motion([key(0.5), key(0.2)]))).toThrow(/time order/);
    expect(() => parseMotion(motion([key(0), key(1.5)]))).toThrow(/duration/);
    expect(() => parseMotion(motion([key(-0.1)]))).toThrow(/time/);
  });

  it('rejects non-numeric targets with the full path', () => {
    const bad = key(0, { rightHand: { position: { x: 0, y: 'high', z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
    expect(() => parseMotion(motion([bad]))).toThrow(/poseKeys\[0\]\.rightHand\.position\.y/);
  });

  it('rejects an empty Motion and markers outside the duration', () => {
    expect(() => parseMotion(motion([]))).toThrow(/at least one Pose Key/);
    expect(() => parseMotion(motion([key(0)], { markers: { windUpEnd: 2 } }))).toThrow(/markers\.windUpEnd/);
  });

  it('round-trips through its JSON file form', () => {
    const t = loadTuningData();
    const overhead = t.motions.Overhead!;
    expect(parseMotion(JSON.parse(serializeMotion(overhead)))).toEqual(overhead);
    expect(motionFileName('Overhead')).toBe('overhead.json');
  });
});
