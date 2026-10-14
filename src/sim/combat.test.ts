import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import {
  attack,
  createInitialState,
  duelPlacements,
  hashState,
  restore,
  runDuel,
  runScript,
  scriptIntents,
  snapshot,
  step,
  wait,
  walk,
  type HitEvent,
  type ScriptRun,
  type Track,
} from './index';

const tuning = loadTuningData();

const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead (offset `x` sideways), facing back. */
const facingOff = (d: number, x = 0) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x, z: d }, facing: Math.PI },
];

/** The repo Tuning Data with the Overhead Motion's phase markers moved (same swing, different phases). */
function withOverheadMarkers(markers: { windUpEnd: number; releaseEnd: number }): TuningData {
  const overhead = tuning.motions.Overhead!;
  return { ...tuning, motions: { ...tuning.motions, Overhead: { ...overhead, markers } } };
}

describe('Overhead Attack', () => {
  it('an Overhead Release from in range hits the opponent and reduces HP', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead') });
    const hits = hitsOf(run);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 0, defender: 1, direction: 'Overhead' });
    expect(['head', 'torso']).toContain(hits[0]!.zone);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
    expect(run.final.fighters[1]!.hp).toBeCloseTo(100 - hits[0]!.damage, 9);
    expect(run.final.fighters[0]!.hp).toBe(100);
  });

  it('goes Wind-up → Release → Recovery → Idle', () => {
    const run = runDuel(tuning, { distance: 5, a: attack('Overhead') });
    const phases = run.events.flatMap((e) => (e.type === 'AttackPhase' ? [e.phase] : []));
    expect(phases).toEqual(['Wind-up', 'Release', 'Recovery']);
    expect(run.final.fighters[0]!.action).toEqual({ kind: 'Idle' });
  });

  it('holds the Wind-up for as long as attack is held, then Releases', () => {
    const run = runDuel(tuning, { distance: 5, a: attack('Overhead', 90) });
    const action = (t: number) => run.states[t]!.fighters[0]!.action;
    expect(action(85)).toMatchObject({ kind: 'Attack', phase: 'Wind-up' });
    const release = run.events.find((e) => e.type === 'AttackPhase' && e.phase === 'Release')!;
    expect(release.tick).toBe(91); // attack let go on Tick 91
  });

  it('a Fighter out of range is never hit', () => {
    const swings: Track = Array.from({ length: 4 }, () => [...attack('Overhead', 30), ...wait(60)]).flat();
    for (const distance of [1.8, 2.5, 4]) {
      const run = runDuel(tuning, { distance, a: swings });
      expect(hitsOf(run)).toEqual([]);
      expect(run.final.fighters[1]!.hp).toBe(100);
    }
  });

  it('the blade does no damage during Wind-up or Recovery', () => {
    // The same swing that hits from 1.2 m is harmless when its phase markers put the downswing
    // in Wind-up (Release only once the blade is back near Idle) or in Recovery (releaseEnd
    // right after windUpEnd).
    const inRange = { placements: facingOff(1.2), a: attack('Overhead') };
    expect(hitsOf(runDuel(tuning, inRange))).toHaveLength(1);

    const downswingInWindUp = withOverheadMarkers({ windUpEnd: 1.0, releaseEnd: 1.08 });
    const downswingInRecovery = withOverheadMarkers({ windUpEnd: 0.35, releaseEnd: 0.37 });
    for (const t of [downswingInWindUp, downswingInRecovery]) {
      const run = runDuel(t, inRange);
      expect(hitsOf(run)).toEqual([]);
      expect(run.final.fighters[1]!.hp).toBe(100);
    }
  });

  it('a head hit deals more damage than a limb hit at equal Blade Speed', () => {
    const head = hitsOf(runDuel(tuning, { placements: facingOff(1.2, 0), a: attack('Overhead') }))[0]!;
    const limb = hitsOf(runDuel(tuning, { placements: facingOff(1.2, 0.3), a: attack('Overhead') }))[0]!;
    expect(head.zone).toBe('head');
    expect(limb.zone).toBe('limbs');
    expect(Math.abs(head.bladeSpeed - limb.bladeSpeed) / head.bladeSpeed).toBeLessThan(0.05);
    expect(head.damage / head.bladeSpeed).toBeGreaterThan(limb.damage / limb.bladeSpeed);
    expect(head.damage).toBeGreaterThan(limb.damage);
  });

  it('a faster blade at contact deals more damage on the same Hit Zone', () => {
    const torsoHits = [0.9, 1.4]
      .map((d) => hitsOf(runDuel(tuning, { placements: facingOff(d, -0.2), a: attack('Overhead') }))[0]!)
      .sort((p, q) => p.bladeSpeed - q.bladeSpeed);
    expect(torsoHits.map((h) => h.zone)).toEqual(['torso', 'torso']);
    expect(torsoHits[1]!.bladeSpeed).toBeGreaterThan(torsoHits[0]!.bladeSpeed);
    expect(torsoHits[1]!.damage).toBeGreaterThan(torsoHits[0]!.damage);
  });

  it('holding Wind-up longer gives no damage bonus', () => {
    const quick = hitsOf(runDuel(tuning, { distance: 1.2, a: attack('Overhead', 1) }));
    const held = hitsOf(runDuel(tuning, { distance: 1.2, a: attack('Overhead', 120) }));
    expect(quick).toHaveLength(1);
    expect(held).toHaveLength(1);
    expect(held[0]!.tick).toBeGreaterThan(quick[0]!.tick + 90);
    expect(held[0]!.damage).toBe(quick[0]!.damage);
    expect(held[0]!.bladeSpeed).toBe(quick[0]!.bladeSpeed);
    expect(held[0]!.zone).toBe(quick[0]!.zone);
  });
});

describe('Combat determinism', () => {
  it('snapshot mid-Attack → restore → replay gives the same hits and hash', () => {
    const tracks: Track[] = [[...wait(5), ...attack('Overhead', 30)], walk(20, { x: 0, z: -0.5 })];
    const straight = runScript(tuning, createInitialState(tuning, 3, duelPlacements(1.6)), tracks, 120);
    const mid = straight.states[30]!; // in the Wind-up
    const intents = scriptIntents(tracks, 120).slice(30);
    const replayed = intents.reduce((s, i) => step(s, i, tuning), restore(snapshot(mid)));
    expect(hitsOf(straight).length).toBeGreaterThan(0);
    expect(hashState(replayed)).toBe(hashState(straight.final));
  });
});

describe('Duel end', () => {
  const swings: Track = Array.from({ length: 8 }, () => [...attack('Overhead'), ...wait(80)]).flat();

  it('the Duel ends when HP reaches zero, with the other Fighter the winner', () => {
    const run = runDuel(tuning, { distance: 1.2, a: swings });
    const end = run.events.filter((e) => e.type === 'DuelEnd');
    expect(end).toEqual([{ type: 'DuelEnd', winner: 0, tick: expect.any(Number) }]);
    expect(run.states[end[0]!.tick]!.fighters[1]!.hp).toBe(0);
    expect(run.states[end[0]!.tick - 1]!.fighters[1]!.hp).toBeGreaterThan(0);
    expect(run.final.duel).toEqual({ status: 'Over', winner: 0, tick: end[0]!.tick });
  });

  it('nothing more happens once the Duel is over: Intents are ignored and HP stays at zero', () => {
    const run = runDuel(tuning, { distance: 1.2, a: swings });
    const endTick = run.events.find((e) => e.type === 'DuelEnd')!.tick;
    const after = run.events.filter((e) => e.tick > endTick && e.type !== 'AttackPhase');
    expect(after).toEqual([]);
    expect(run.events.some((e) => e.tick > endTick + 100 && e.type === 'AttackPhase' && e.phase === 'Wind-up')).toBe(false);
    expect(run.final.fighters[1]!.hp).toBe(0);
  });

  it('the Duel goes on while both Fighters have HP', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead') });
    expect(run.final.duel).toEqual({ status: 'Fighting' });
  });
});
