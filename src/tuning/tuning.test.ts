import { describe, expect, it } from 'vitest';
import { loadTuningData, motionFileName, parseMotion, parseTuningData, serializeMotion, TuningDataError } from './index';

/** A minimal valid raw Tuning Data set (independent of the repo files). */
function goodRaw() {
  return {
    fighter: { maxHp: 100, walkSpeed: 2, radius: 0.3, height: 1.8, turnSpeed: 360, motionBlend: 0.15 },
    arena: { radius: 8 },
    weapon: { length: 0.9, damage: 30, speed: 10 },
    hitZones: {
      head: { multiplier: 1.5, radius: 0.11 },
      torso: { multiplier: 1, radius: 0.15 },
      limbs: { multiplier: 0.6, radius: 0.06 },
    },
    chamber: { windowSeconds: 0.15 },
    block: { facingHalfAngle: 60, impactDistance: 0.12, impactTilt: 15, impactLean: 5, impactFrequency: 4, impactDuration: 0.2 },
    match: { duelDistance: 2, interDuelSeconds: 2 },
    gait: { strideThreshold: 0.2, stepDuration: 0.1, stepHeight: 0.08, hipBob: 0.02, hipSway: 0.02 },
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
    expect(t.arena.radius).toBe(8);
    expect(t.weapon.length).toBeGreaterThan(0);
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
    expect(() => parseTuningData({ ...good, arena: { radius: -1 } })).toThrow(TuningDataError);
    expect(() => parseTuningData({ ...good, fighter: { ...good.fighter, walkSpeed: '2' } })).toThrow(/walkSpeed/);
    expect(() => parseTuningData({ ...good, fighter: undefined })).toThrow(/fighter/);
    expect(() => parseTuningData({ ...good, weapon: { length: 0, damage: 30, speed: 10 } })).toThrow(/weapon\.length/);
    expect(() => parseTuningData({ ...good, weapon: { length: 0.9, damage: 30 } })).toThrow(/weapon\.speed/);
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
    expect(() => parseTuningData({ ...good, match: { duelDistance: 0, interDuelSeconds: 2 } })).toThrow(/match\.duelDistance/);
    expect(() => parseTuningData({ ...good, match: { duelDistance: 2, interDuelSeconds: 0 } })).toThrow(/match\.interDuelSeconds/);
  });

  it('loads the Block facing rule and the Match pacing from data/block.json and data/match.json', () => {
    const t = loadTuningData();
    expect(t.block.facingHalfAngle).toBe(60);
    expect(t.match).toEqual({ duelDistance: 2, interDuelSeconds: 2 });
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
