import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, runDuel, runScript, wait, walk, type HitEvent, type ScriptRun, type SimState } from './index';

const tuning = loadTuningData();

/** Fighter radius 0.35 (fighter.json), so two capsules touch at 0.7 m. */
const CONTACT_DISTANCE = 0.7;

const gap = (s: SimState) => {
  const [a, b] = s.fighters;
  return Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z);
};

const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');

describe('Fighter collision', () => {
  it('two Fighters walking into each other stop when their capsules touch, never passing through', () => {
    // Fighter 0 at z=-1 walks +z, Fighter 1 at z=+1 walks -z, for 2 s (5 m each at 2.5 m/s).
    const run = runDuel(tuning, { distance: 2, a: walk(120, { x: 0, z: 1 }), b: walk(120, { x: 0, z: -1 }), ticks: 120 });
    for (const s of run.states) expect(gap(s)).toBeGreaterThanOrEqual(CONTACT_DISTANCE - 1e-9);
    expect(run.final.fighters[0]!.position.z).toBeLessThan(run.final.fighters[1]!.position.z);
    expect(gap(run.final)).toBeCloseTo(CONTACT_DISTANCE, 6);
  });

  it('a Fighter walking into a standing one pushes it along instead of passing through', () => {
    const run = runDuel(tuning, { distance: 2, a: walk(120, { x: 0, z: 1 }), b: wait(120), ticks: 120 });
    for (const s of run.states) expect(gap(s)).toBeGreaterThanOrEqual(CONTACT_DISTANCE - 1e-9);
    expect(run.final.fighters[0]!.position.z).toBeLessThan(run.final.fighters[1]!.position.z);
    expect(run.final.fighters[1]!.position.z).toBeGreaterThan(1);
  });

  it('a Fighter walking diagonally into another slides around it rather than through it', () => {
    const run = runDuel(tuning, { distance: 2, a: walk(120, { x: 0.05, z: 1 }), b: wait(120), ticks: 120 });
    for (const s of run.states) expect(gap(s)).toBeGreaterThanOrEqual(CONTACT_DISTANCE - 1e-9);
  });
});

describe('Moving into a swing', () => {
  it('stepping into an Overhead deals more damage than the same swing standing still', () => {
    // Standing: Fighter 1 is 1.3 m away. Stepping: it is 1.6 m away and Fighter 0
    // walks forward from Tick 30, mid-Release. Both hit the torso on the same Tick
    // of the same swing, so the only difference is the Fighter's own movement.
    const still = hitsOf(runDuel(tuning, { distance: 1.3, a: attack('Overhead') }));
    const stepping = hitsOf(
      runDuel(tuning, { distance: 1.6, a: [...attack('Overhead'), ...wait(29), ...walk(30, { x: 0, z: 1 })] }),
    );
    expect(still).toHaveLength(1);
    expect(stepping).toHaveLength(1);
    expect(stepping[0]!.zone).toBe('torso');
    expect(still[0]!.zone).toBe('torso');
    expect(stepping[0]!.tick).toBe(still[0]!.tick);
    expect(stepping[0]!.bladeSpeed).toBeGreaterThan(still[0]!.bladeSpeed + 1);
    expect(stepping[0]!.damage).toBeGreaterThan(still[0]!.damage + 1);
  });
});

/** Arena radius 8 and Fighter radius 0.35: a Fighter's centre stays within 7.65 m of the Arena centre. */
const MAX_CENTRE_R = 7.65;
const radius = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

describe('Arena boundary', () => {
  it('Fighters walking away from each other stop at the Arena edge', () => {
    const run = runDuel(tuning, { distance: 2, a: walk(400, { x: 0, z: -1 }), b: walk(400, { x: 1, z: 1 }), ticks: 400 });
    for (const s of run.states) for (const f of s.fighters) expect(radius(f.position)).toBeLessThanOrEqual(MAX_CENTRE_R + 1e-9);
    expect(radius(run.final.fighters[0]!.position)).toBeCloseTo(MAX_CENTRE_R, 6);
    expect(radius(run.final.fighters[1]!.position)).toBeCloseTo(MAX_CENTRE_R, 6);
  });

  it('a Fighter shoved into the Arena edge is pinned there; neither leaves the Arena nor overlaps', () => {
    // Fighter 1 stands still; Fighter 0 walks into it and keeps pushing it towards the edge (+z).
    const run = runDuel(tuning, { distance: 2, a: walk(600, { x: 0, z: 1 }), b: wait(600), ticks: 600 });
    for (const s of run.states) {
      for (const f of s.fighters) expect(radius(f.position)).toBeLessThanOrEqual(MAX_CENTRE_R + 1e-9);
      expect(gap(s)).toBeGreaterThanOrEqual(CONTACT_DISTANCE - 1e-9);
    }
    expect(run.final.fighters[1]!.position.z).toBeCloseTo(MAX_CENTRE_R, 6);
    expect(run.final.fighters[0]!.position.z).toBeCloseTo(MAX_CENTRE_R - CONTACT_DISTANCE, 6);
  });

  it('two Fighters starting on the same spot are pushed apart', () => {
    const initial = createInitialState(tuning, 1, [
      { position: { x: 0, z: 0 }, facing: 0 },
      { position: { x: 0, z: 0 }, facing: Math.PI },
    ]);
    const run = runScript(tuning, initial, [wait(1), wait(1)], 1);
    expect(gap(run.final)).toBeCloseTo(CONTACT_DISTANCE, 6);
  });
});
