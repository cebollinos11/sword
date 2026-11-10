import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, duelPlacements, fighterPose, hold, runDuel, type SimState } from '../sim';
import { alongBlade, BladeBlood, bladeSplashes, MAX_MARKS } from './bladeBlood';

const tuning = loadTuningData();

describe('bladeSplashes', () => {
  it("a Hit bloodies the attacker's Weapon where it connected", () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const at = run.states.findIndex((s) => s.events.some((e) => e.type === 'Hit'));
    const state = run.states[at]!;
    const hit = state.events.find((e) => e.type === 'Hit')!;
    const splashes = run.states.flatMap((s) => bladeSplashes(s, tuning));
    expect(splashes).toHaveLength(1);
    expect(splashes[0]!.fighter).toBe(0);
    expect(splashes[0]!.t).toBeCloseTo(alongBlade(fighterPose(state.fighters[0]!, tuning).blade, hit.point));
    // Out on the blade, not at the hand.
    expect(splashes[0]!.t).toBeGreaterThan(0.3);
  });

  it('a Block bloodies nothing', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    expect(run.states.flatMap((s) => bladeSplashes(s, tuning))).toEqual([]);
  });

  it("a shaft Hit leaves the Weapon's striking parts clean", () => {
    const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;
    const hit = { type: 'Hit', attacker: 0, defender: 1, direction: 'Overhead', zone: 'torso', point: { x: 0, y: 1.2, z: 0.3 }, bladeSpeed: 5, heavy: false, damage: 10 } as const;
    expect(bladeSplashes({ fighters, events: [{ ...hit, head: false }] }, tuning)).toEqual([]);
    expect(bladeSplashes({ fighters, events: [{ ...hit, head: true }] }, tuning)).toHaveLength(1);
  });
});

describe('alongBlade', () => {
  const blade = { hilt: { x: 0, y: 0, z: 0 }, tip: { x: 0, y: 1, z: 0 }, edge: { x: 0, y: 0, z: 1 } };
  it('measures from the hand to the tip, clamped to the Weapon', () => {
    expect(alongBlade(blade, { x: 0.3, y: 0.7, z: 0 })).toBeCloseTo(0.7);
    expect(alongBlade(blade, { x: 0, y: 2, z: 0 })).toBe(1);
    expect(alongBlade(blade, { x: 0, y: -1, z: 0 })).toBe(0);
  });
});

describe('BladeBlood', () => {
  const base = createInitialState(tuning, 1, duelPlacements(1.3));
  const hitAt = (tick: number, damage = 10, point = { x: 0, y: 1.2, z: 0.3 }): SimState => ({
    ...base,
    tick,
    events: [{ type: 'Hit', attacker: 0, defender: 1, direction: 'Overhead', zone: 'torso', point, bladeSpeed: 5, head: true, heavy: false, damage }],
  });

  it('keeps the blood through the Duel, merging Hits on the same spot', () => {
    const b = new BladeBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(20, hitAt(20));
    expect(b.marksOf(0)).toHaveLength(1);
    expect(b.marksOf(0)[0]!.strength).toBeGreaterThan(10 / 15);
    expect(b.marksOf(1)).toHaveLength(0);
  });

  it('a new Duel washes every Weapon', () => {
    const b = new BladeBlood(tuning);
    b.onTick(10, hitAt(10));
    b.onTick(11, { ...base, tick: 50, events: [] });
    expect(b.marksOf(0)).toHaveLength(1);
    // The next Duel starts its time again.
    b.onTick(12, { ...base, tick: 0, events: [] });
    expect(b.marksOf(0)).toHaveLength(0);
  });

  it('a rewind washes off only what was laid after it', () => {
    const b = new BladeBlood(tuning);
    b.onTick(10, hitAt(10, 10, { x: 0, y: 0.8, z: 0.3 }));
    b.onTick(30, hitAt(30, 10, { x: 0, y: 2.5, z: 0.3 }));
    expect(b.marksOf(0).length).toBeGreaterThanOrEqual(1);
    b.seek(20);
    expect(b.marksOf(0).every((m) => m.tick <= 20)).toBe(true);
    expect(b.marksOf(0)).toHaveLength(1);
    // Replaying from the rewind is not a new Duel.
    b.onTick(21, { ...hitAt(21), tick: 15, events: [] });
    expect(b.marksOf(0)).toHaveLength(1);
  });

  it('another Weapon starts clean', () => {
    const b = new BladeBlood(tuning);
    b.onTick(10, hitAt(10));
    const other = Object.values(tuning.weapons).find((w) => w.name !== base.fighters[0]!.weapon)!.name;
    b.onTick(11, { ...base, tick: 11, fighters: base.fighters.map((f, i) => (i === 0 ? { ...f, weapon: other } : f)), events: [] });
    expect(b.marksOf(0)).toHaveLength(0);
  });

  it(`holds at most ${MAX_MARKS} marks on a Weapon`, () => {
    const b = new BladeBlood(tuning);
    for (let k = 0; k < 40; k++) b.onTick(10 + k, hitAt(10 + k, 10, { x: 0, y: k * 0.08, z: 0.3 }));
    expect(b.marksOf(0).length).toBeLessThanOrEqual(MAX_MARKS);
  });

  it('a very bloody Weapon drips below its blade, a dry one does not', () => {
    const b = new BladeBlood(tuning);
    for (let k = 0; k < 6; k++) b.onTick(10 + k, hitAt(10 + k, 30, { x: 0, y: 0.6 + k * 0.3, z: 0.3 }));
    const poses = [fighterPose(base.fighters[0]!, tuning)];
    const drips: { y: number; floor: number }[] = [];
    for (let k = 0; k < 200; k++) b.drip(poses, 0.05, (p, floor) => drips.push({ y: p.y, floor }));
    expect(drips.length).toBeGreaterThan(0);
    expect(drips.every((d) => d.y > d.floor)).toBe(true);
    // Long dry: no more drips.
    for (let k = 0; k < 2000; k++) b.drip(poses, 0.1, () => {});
    let late = 0;
    for (let k = 0; k < 200; k++) b.drip(poses, 0.05, () => late++);
    expect(late).toBe(0);
  });
});
