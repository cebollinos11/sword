import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, runDuel, type SimEvent } from '../sim';
import { CameraShake, shakeFor } from './cameraShake';

const tuning = loadTuningData();

/** The shake each Fighter's camera gets from a whole run, Tick by Tick. */
const shakesOf = (events: readonly SimEvent[]) => [0, 1, 2].map((me) => shakeFor(events, me));

const point = { x: 0, y: 1, z: 0 };

describe('shakeFor', () => {
  it('a Hit shakes the defender hard, the attacker lightly, and nobody else', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const [attacker, defender, bystander] = shakesOf(run.states.flatMap((s) => s.events));
    expect(defender).toHaveLength(1);
    expect(attacker).toHaveLength(1);
    expect(defender![0]!).toBeGreaterThan(attacker![0]!);
    expect(attacker![0]!).toBeGreaterThan(0);
    expect(bystander).toEqual([]);
  });

  it('a Heavy Blow shakes harder than a plain Hit, on both sides', () => {
    const plain = shakesOf(runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] }).states.flatMap((s) => s.events));
    const run = runDuel(tuning, { distance: 1.4, weapons: ['Sledge Hammer', 'Arming Sword'], a: attack('Overhead'), b: [] });
    const events = run.states.flatMap((s) => s.events);
    expect(events.find((e) => e.type === 'Hit')).toMatchObject({ heavy: true });
    const heavy = shakesOf(events);
    expect(heavy[1]![0]!).toBeGreaterThan(plain[1]![0]!);
    expect(heavy[0]![0]!).toBeGreaterThan(plain[0]![0]!);
    expect(heavy[1]![0]!).toBeLessThanOrEqual(1);
  });

  it("a Kick's Knockdown shakes the one knocked down; a Shove, and the Kicker, do not shake", () => {
    const kick = (outcome: 'Shove' | 'Knockdown'): SimEvent => ({ type: 'KickLanded', attacker: 0, defender: 1, outcome, zone: 'torso', point, damage: 5 });
    expect(shakeFor([kick('Knockdown')], 1)).toEqual([expect.any(Number)]);
    expect(shakeFor([kick('Knockdown')], 1)[0]!).toBeGreaterThan(0);
    expect(shakeFor([kick('Knockdown')], 0)).toEqual([]);
    expect(shakeFor([kick('Shove')], 1)).toEqual([]);
  });

  it('a Chamber shakes both Fighters lightly, the one Chambered more than the chamberer, and nobody else', () => {
    const chamber: SimEvent = { type: 'Chamber', chamberer: 1, attacker: 0, direction: 'Overhead', point };
    const [chambered, chamberer, bystander] = shakesOf([chamber]);
    expect(chambered).toEqual([expect.any(Number)]);
    expect(chamberer).toEqual([expect.any(Number)]);
    expect(chambered![0]!).toBeGreaterThan(chamberer![0]!);
    expect(chamberer![0]!).toBeGreaterThan(0);
    expect(bystander).toEqual([]);
    const hitTaken = shakeFor(runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] }).states.flatMap((s) => s.events), 1)[0]!;
    expect(chambered![0]!).toBeLessThan(hitTaken);
  });

  it('a Landing shakes only when it hurts, and only the one landing', () => {
    const land = (damage: number): SimEvent => ({ type: 'Land', fighter: 1, height: 4, damage });
    expect(shakeFor([land(12)], 1)[0]!).toBeGreaterThan(0);
    expect(shakeFor([land(12)], 0)).toEqual([]);
    expect(shakeFor([land(0)], 1)).toEqual([]);
  });

  it("the run's other events (its Attack phases, Steps and Stagger) do not shake", () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const quiet = run.states.flatMap((s) => s.events).filter((e) => e.type !== 'Hit');
    expect(quiet.length).toBeGreaterThan(0);
    for (const me of [0, 1]) expect(shakeFor(quiet, me)).toEqual([]);
  });
});

describe('CameraShake', () => {
  const hit: SimEvent[] = [{ type: 'Hit', attacker: 0, defender: 1, direction: 'Left', zone: 'torso', point, bladeSpeed: 6, head: true, heavy: false, damage: 10 }];
  const sway = (s: CameraShake) => {
    const o = s.offset(1);
    return Math.hypot(o.x, o.y, o.roll);
  };

  it('is still until something shakes it, then dies away to exactly nothing', () => {
    const s = new CameraShake();
    s.update(0.05);
    expect(s.offset(1)).toEqual({ x: 0, y: 0, roll: 0 });
    s.onTick(1, hit, 1);
    s.update(0.05);
    expect(sway(s)).toBeGreaterThan(0);
    for (let k = 0; k < 20; k++) s.update(0.05);
    expect(s.offset(1)).toEqual({ x: 0, y: 0, roll: 0 });
  });

  it('a strength of 0 turns it off, and the sway grows with the strength', () => {
    const s = new CameraShake();
    s.onTick(1, hit, 1);
    s.update(0.05);
    expect(s.offset(0)).toEqual({ x: 0, y: 0, roll: 0 });
    expect(s.offset(2).x).toBeCloseTo(2 * s.offset(1).x, 12);
  });

  it('shakes the same way every time (no randomness)', () => {
    const run = () => {
      const s = new CameraShake();
      s.onTick(1, hit, 1);
      const out = [];
      for (let k = 0; k < 8; k++) {
        s.update(1 / 60);
        out.push(s.offset(1));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('shakes each Tick once (a Rollback re-simulating it does not shake again), and a seek stops it', () => {
    const once = new CameraShake();
    once.onTick(1, hit, 1);
    const twice = new CameraShake();
    twice.onTick(1, hit, 1);
    twice.onTick(1, hit, 1);
    once.update(0.05);
    twice.update(0.05);
    expect(twice.offset(1)).toEqual(once.offset(1));
    twice.seek(1);
    expect(twice.offset(1)).toEqual({ x: 0, y: 0, roll: 0 });
  });
});
