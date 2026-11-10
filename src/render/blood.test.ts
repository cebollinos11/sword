import { describe, expect, it } from 'vitest';
import { loadTuningData, sizedTuning, withWeapon } from '../tuning';
import { attack, runDuel, createInitialState, duelPlacements, fighterPose } from '../sim';
import { bloodSpurts, RUN_SECONDS, SPLAT_SECONDS, stainShape, STUMP_BLEED_SECONDS, stumpDrops, stumpSpurts } from './blood';
import { severing } from './dismember';

const tuning = loadTuningData();

describe('bloodSpurts', () => {
  it('a Hit sprays from the wound, away from the attacker', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const hit = run.states.flatMap((s) => s.events).find((e) => e.type === 'Hit')!;
    const spurts = run.states.flatMap((s) => bloodSpurts(s));
    expect(spurts).toHaveLength(1);
    const [s] = spurts;
    expect(s!.point).toEqual(hit.point);
    expect(Math.hypot(s!.dir.x, s!.dir.z)).toBeCloseTo(1);
    // Fighter 0 attacks fighter 1 from the other side: the spray points from 0 towards 1.
    const f = run.states.at(-1)!.fighters;
    const away = { x: f[1]!.position.x - f[0]!.position.x, z: f[1]!.position.z - f[0]!.position.z };
    expect(s!.dir.x * away.x + s!.dir.z * away.z).toBeGreaterThan(0);
  });

  it('a Heavy Blow sprays at full strength', () => {
    const run = runDuel(tuning, { distance: 1.4, weapons: ['Sledge Hammer', 'Arming Sword'], a: attack('Overhead'), b: [] });
    expect(run.states.flatMap((s) => bloodSpurts(s)).map((s) => s.strength)).toEqual([1]);
  });

  it('a Block, a Chamber or no event sprays nothing', () => {
    const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;
    const point = { x: 0, y: 1.4, z: 0.6 };
    expect(bloodSpurts({ fighters, events: [{ type: 'Chamber', chamberer: 1, attacker: 0, direction: 'Overhead', point }] })).toEqual([]);
    expect(bloodSpurts({ fighters, events: [] })).toEqual([]);
  });
});

describe('stainShape', () => {
  it('a floor stain splats out from small, overshoots, and settles at its size', () => {
    expect(stainShape(false, 0, 1).width).toBeLessThan(0.5);
    const peak = Math.max(...Array.from({ length: 20 }, (_, k) => stainShape(false, (k / 20) * SPLAT_SECONDS, 1).width));
    expect(peak).toBeGreaterThan(1);
    expect(stainShape(false, SPLAT_SECONDS, 1)).toEqual({ width: 1, height: 1, drop: 0 });
    expect(stainShape(false, 10, 1)).toEqual({ width: 1, height: 1, drop: 0 });
  });

  it('a wall stain runs down, its top edge staying put, slowing as it goes', () => {
    expect(stainShape(true, 0, 0.8)).toEqual({ width: 1, height: 1, drop: 0 });
    const end = stainShape(true, RUN_SECONDS, 0.8);
    expect(end.height).toBeCloseTo(1.8);
    // Top edge: centre raised by half the height, minus the drop, stays at the laid half-size.
    for (const t of [0.2, 0.7, RUN_SECONDS]) {
      const s = stainShape(true, t, 0.8);
      expect(s.height / 2 - s.drop).toBeCloseTo(0.5);
    }
    const early = stainShape(true, RUN_SECONDS / 4, 0.8).height - 1;
    expect(early).toBeGreaterThan(0.8 / 2);
    expect(stainShape(true, 99, 0.8)).toEqual(end);
  });
});

describe('stumpSpurts', () => {
  const deadly = Object.keys(tuning.weapons).reduce((t, name) => withWeapon(t, { damage: 10_000 }, name), tuning);
  const kill = (weapon: string, direction: 'Left' | 'Right' | 'Overhead' | 'Thrust') =>
    runDuel(deadly, { placements: duelPlacements(1.3), weapons: [weapon, 'Arming Sword'], a: attack(direction), b: [] });

  it('a cutting kill sprays from both cut ends of every severed bone, on the Death’s Tick only, at full strength', () => {
    const run = kill('Arming Sword', 'Left');
    const at = run.states.findIndex((s) => s.fighters[1]!.death);
    const fallen = run.states[at]!.fighters[1]!;
    const severed = severing(fighterPose(fallen, deadly), fallen.death!.blow, sizedTuning(deadly, fallen.size));
    expect(severed.length).toBeGreaterThan(0);
    const spurts = stumpSpurts(run.states[at]!, deadly);
    expect(spurts).toHaveLength(2 * severed.length);
    severed.forEach((s, k) => {
      for (const side of [0, 1]) {
        const spurt = spurts[2 * k + side]!;
        expect(spurt.point).toEqual(s.at);
        expect(spurt.strength).toBe(1);
        expect(spurt.floorY).toBe(fallen.y);
        expect(Math.hypot(spurt.dir.x, spurt.dir.z)).toBeCloseTo(1);
        expect(Math.abs(spurt.rise!)).toBeLessThanOrEqual(1);
      }
      // The two ends of a cut spray away from each other: each out of its own piece, across the cut.
      const [a, b] = [spurts[2 * k]!, spurts[2 * k + 1]!];
      const out = (p: typeof a) => {
        const flat = Math.sqrt(1 - p.rise! ** 2);
        return { x: p.dir.x * flat, y: p.rise!, z: p.dir.z * flat };
      };
      const [u, v] = [out(a), out(b)];
      expect(u.x * v.x + u.y * v.y + u.z * v.z).toBeLessThan(0);
      // The end on the bone's first joint's side sprays toward its second joint.
      const pose = fighterPose(fallen, deadly);
      const [j0, j1] = [pose.joints[s.bone[0]], pose.joints[s.bone[1]]];
      const along = (j1.x - j0.x) * s.normal.x + (j1.y - j0.y) * s.normal.y + (j1.z - j0.z) * s.normal.z;
      const toward = Math.sign(along);
      const n = { x: s.normal.x * toward, y: s.normal.y * toward, z: s.normal.z * toward };
      expect(u.x * n.x + u.y * n.y + u.z * n.z).toBeGreaterThan(0);
      expect(v.x * n.x + v.y * n.y + v.z * n.z).toBeLessThan(0);
    });
    // Not before the Death, nor after it.
    expect(stumpSpurts(run.states[at - 1]!, deadly)).toEqual([]);
    expect(stumpSpurts(run.states[at + 1]!, deadly)).toEqual([]);
    expect(stumpSpurts(run.states[at]!, deadly)).toEqual(spurts);
  });

  it('a kill that does not cut sprays nothing from stumps: a Thrust, a Sledge Hammer, a Fall', () => {
    for (const [weapon, direction] of [['Arming Sword', 'Thrust'], ['Sledge Hammer', 'Overhead']] as const) {
      const run = kill(weapon, direction);
      expect(run.states.some((s) => s.fighters[1]!.death)).toBe(true);
      expect(run.states.flatMap((s) => stumpSpurts(s, deadly)), `${weapon} ${direction}`).toEqual([]);
    }
    const fighters = createInitialState(tuning, 1, duelPlacements(1.3)).fighters;
    expect(stumpSpurts({ tick: 0, fighters }, tuning)).toEqual([]);
    const fell = fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 7, cause: 'Fall' as const, blow: null } } : f));
    expect(stumpSpurts({ tick: 7, fighters: fell }, tuning)).toEqual([]);
  });
});

describe('stumpDrops', () => {
  it('drips from the Death for STUMP_BLEED_SECONDS, slowing, then stops', () => {
    expect(stumpDrops(0, STUMP_BLEED_SECONDS)).toBeGreaterThan(3);
    expect(stumpDrops(STUMP_BLEED_SECONDS, STUMP_BLEED_SECONDS + 5)).toBe(0);
    expect(stumpDrops(0, STUMP_BLEED_SECONDS / 2)).toBeGreaterThan(stumpDrops(STUMP_BLEED_SECONDS / 2, STUMP_BLEED_SECONDS));
  });

  it('is the same however the time is cut into frames, and nothing when time stands still or runs back', () => {
    const whole = stumpDrops(0, STUMP_BLEED_SECONDS);
    for (const frame of [1 / 144, 1 / 60, 1 / 23, 0.1]) {
      let total = 0;
      for (let t = 0; t < STUMP_BLEED_SECONDS + 1; t += frame) total += stumpDrops(t, t + frame);
      expect(total, `${frame}`).toBe(whole);
    }
    expect(stumpDrops(0.5, 0.5)).toBe(0);
    expect(stumpDrops(1, 0.2)).toBe(0);
    expect(stumpDrops(-1, 0)).toBe(0);
  });
});
