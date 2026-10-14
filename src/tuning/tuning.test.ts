import { describe, expect, it } from 'vitest';
import { loadTuningData, motionFileName, parseMotion, parseTuningData, serializeMotion, TuningDataError } from './index';

/** A minimal valid raw Tuning Data set (independent of the repo files). */
function goodRaw() {
  return {
    fighter: { maxHp: 100, walkSpeed: 2, radius: 0.3, height: 1.8, turnSpeed: 360 },
    arena: { radius: 8 },
    weapon: { length: 0.9, damage: 30, speed: 10 },
    hitZones: {
      head: { multiplier: 1.5, radius: 0.11 },
      torso: { multiplier: 1, radius: 0.15 },
      limbs: { multiplier: 0.6, radius: 0.06 },
    },
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
      difficulties: { Normal: { reactionTime: 0.25, mistakeRate: 0.2 } },
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
    expect(() => parseTuningData({ ...good, skeleton: { ...good.skeleton, forearm: -1 } })).toThrow(/skeleton\.forearm/);
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
    expect(() => parseTuningData(withDifficulty({ reactionTime: 0.2, mistakeRate: 1.5 }))).toThrow(/ai\.difficulties\.Normal\.mistakeRate/);
    expect(() => parseTuningData(withDifficulty({ reactionTime: -0.1, mistakeRate: 0 }))).toThrow(/ai\.difficulties\.Normal\.reactionTime/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, difficulties: {} } })).toThrow(/ai\.difficulties/);
    expect(() => parseTuningData({ ...good, ai: { ...good.ai, aggression: 2 } })).toThrow(/ai\.aggression/);
    expect(parseTuningData(withDifficulty({ reactionTime: 0, mistakeRate: 0 })).ai.difficulties.Normal).toEqual({ reactionTime: 0, mistakeRate: 0 });
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
