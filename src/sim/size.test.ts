import { describe, expect, it } from 'vitest';
import { clampSize, loadTuningData, sizedTuning, storedSize } from '../tuning';
import { attack, createInitialState, createMatch, fighterPose, hashState, IDLE_INTENT, runDuel, step, type SimState } from './index';
import { hitZoneCapsules } from './hitZones';

const tuning = loadTuningData();
const duel = (...sizes: ({ height: number; thick: number } | undefined)[]): SimState =>
  createInitialState(tuning, 1, [{ position: { x: 0, z: -1 }, facing: 0 }, { position: { x: 0, z: 1 }, facing: Math.PI }], [], [], undefined, sizes);

describe('Size', () => {
  it('clamps to 0.5..1.5 in 0.05 steps and stores nothing for the standard body', () => {
    expect(clampSize({ height: 3, thick: 0.1 })).toEqual({ height: 1.5, thick: 0.5 });
    expect(clampSize({ height: 1.03, thick: 0.97 })).toEqual({ height: 1.05, thick: 0.95 });
    expect(storedSize({ height: 1, thick: 1 })).toBeUndefined();
  });

  it('leaves a standard Fighter exactly as it was', () => {
    expect(hashState(duel({ height: 1, thick: 1 }, undefined))).toBe(hashState(createInitialState(tuning, 1, [{ position: { x: 0, z: -1 }, facing: 0 }, { position: { x: 0, z: 1 }, facing: Math.PI }])));
    expect(duel().fighters[0]!.size).toBeUndefined();
  });

  it('stretches the Skeleton with height and widens it with thickness', () => {
    const s = duel({ height: 1.5, thick: 0.5 }, undefined);
    const tall = fighterPose(s.fighters[0]!, tuning);
    const std = fighterPose(s.fighters[1]!, tuning);
    expect(tall.joints.head.y / std.joints.head.y).toBeCloseTo(1.5, 1);
    const width = (p: typeof tall) => p.joints.rightShoulder.x - p.joints.leftShoulder.x;
    expect(Math.abs(width(tall) / width(std))).toBeCloseTo(0.5, 1);
  });

  it('makes a Fighter exactly as tall and armed as its height says, whatever its thickness', () => {
    const slim = fighterPose(duel({ height: 0.5, thick: 0.5 }).fighters[0]!, tuning);
    const wide = fighterPose(duel({ height: 0.5, thick: 1.5 }).fighters[0]!, tuning);
    expect(wide.joints.head.y).toBeCloseTo(slim.joints.head.y, 9);
    expect(wide.blade.tip.y).toBeCloseTo(slim.blade.tip.y, 9);
  });

  it('scales the Weapon with height and the Hit Zones with thickness', () => {
    const big = sizedTuning(tuning, { height: 1.5, thick: 1.5 });
    const w = Object.keys(tuning.weapons)[0]!;
    expect(big.weapons[w]!.length).toBeCloseTo(tuning.weapons[w]!.length * 1.5);
    expect(big.hitZones.torso.radius).toBeCloseTo(tuning.hitZones.torso.radius * 1.5);
    expect(big.fighter.radius).toBeCloseTo(tuning.fighter.radius * 1.5);
    expect(big.fighter.height).toBeCloseTo(tuning.fighter.height * 1.5);
    expect(sizedTuning(tuning, { height: 1.5, thick: 1.5 })).toBe(big);
    expect(hitZoneCapsules(fighterPose(duel({ height: 1.5, thick: 1.5 }).fighters[0]!, tuning), big)[0]!.radius).toBeGreaterThan(0);
  });

  it('keeps wider Fighters further apart', () => {
    let s = duel({ height: 1, thick: 1.5 }, { height: 1, thick: 1.5 });
    s = { ...s, fighters: s.fighters.map((f, i) => ({ ...f, position: { x: i * 0.1, z: 0 } })) };
    for (let i = 0; i < 30; i++) s = step(s, [IDLE_INTENT, IDLE_INTENT], tuning);
    const [a, b] = s.fighters;
    expect(Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z)).toBeGreaterThanOrEqual(2 * tuning.fighter.radius * 1.5 - 1e-6);
  });

  it('is part of the Match setup and survives into later Duels', () => {
    const m = createMatch(tuning, { bestOf: 3, sizes: [{ height: 1.5, thick: 1.2 }, undefined] });
    expect(m.config.sizes).toEqual([{ height: 1.5, thick: 1.2 }, { height: 1, thick: 1 }]);
    expect(m.duel.fighters[0]!.size).toEqual({ height: 1.5, thick: 1.2 });
    expect(m.duel.fighters[1]!.size).toBeUndefined();
    expect(createMatch(tuning, { bestOf: 3 }).config.sizes).toBeUndefined();
  });
});

describe('Size in a fight', () => {
  const Reach = (sizes: ({ height: number; thick: number } | undefined)[], distance: number) => runDuel(tuning, { distance, a: attack('Overhead'), sizes });
  const hit = (distance: number, sizes: ({ height: number; thick: number } | undefined)[]) => Reach(sizes, distance).events.some((e) => e.type === 'Hit');

  it('lets a taller Fighter hit from further away than a standard one, and a shorter one only from closer', () => {
    // Just past a standard Fighter's reach.
    let far = 1.3;
    while (hit(far, [undefined, undefined])) far += 0.05;
    expect(hit(far, [{ height: 1.5, thick: 1 }, undefined])).toBe(true);
    expect(hit(far - 0.05, [{ height: 0.5, thick: 1 }, undefined])).toBe(false);
  });

  it('keeps the Fighter fighting normally with a stat-neutral build', () => {
    const run = Reach([{ height: 1.5, thick: 1.5 }, undefined], 1.8);
    const hits = run.events.filter((e) => e.type === 'Hit');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(run.final.fighters[1]!.maxHp).toBe(tuning.fighter.maxHp);
  });
});
