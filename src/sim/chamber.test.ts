import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attack, attackTimings, hold, mirrorDirection, runDuel, TICK_RATE, wait, type ChamberEvent, type Direction, type HitEvent, type ScriptRun } from './index';

const tuning = loadTuningData();

const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');
const eventsOf = (run: ScriptRun, type: string) => run.events.filter((e) => e.type === type);

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead, facing `facing` (π = back towards Fighter 0). */
const placements = (d: number, facing = Math.PI) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: d }, facing },
];

/**
 * Fighter 0 taps an Overhead on Tick 1, so its Wind-up plays to `windUpEnd`
 * and its Release starts on Tick windUpEnd + 2 (the first state whose Attack
 * is in Release). Fighter 1 presses attack on Tick `pressTick` (1-based state index).
 */
const releaseStart = (t: TuningData, direction: Direction = 'Overhead') => attackTimings(t, 'Arming Sword', direction).windUpEnd + 2;
const windowTicks = (t: TuningData) => Math.round(t.chamber.windowSeconds * TICK_RATE);

const counter = (pressTick: number, direction: Direction = 'Overhead') => [...wait(pressTick - 1), ...attack(direction)];

/** The Tick Fighter 0's `direction` Attack (pressed on Tick 1) lands on an idle Fighter 1 `d` metres ahead. */
const landsAt = (direction: Direction = 'Overhead', d = 1.3) => hitsOf(runDuel(tuning, { placements: placements(d), a: attack(direction), b: wait(1) }))[0]!.tick;

/** The single Chamber of `run` (Fighter 1 chambering Fighter 0's `direction` Attack), landing between `press` and `landsAt(direction)`. */
function chamberLanded(run: ScriptRun, press: number, direction: Direction = 'Overhead') {
  expect(eventsOf(run, 'Chamber')).toEqual([{ type: 'Chamber', chamberer: 1, attacker: 0, direction, point: expect.any(Object), tick: expect.any(Number) }]);
  const { tick } = eventsOf(run, 'Chamber')[0]!;
  expect(tick).toBeGreaterThanOrEqual(press);
  expect(tick).toBeLessThanOrEqual(landsAt(direction));
  return tick;
}

describe('Chamber', () => {
  it('sanity: the incoming Overhead enters Release on releaseStart', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: wait(1) });
    const r = releaseStart(tuning);
    expect(run.states[r - 1]!.fighters[0]!.action).toMatchObject({ phase: 'Wind-up' });
    expect(run.states[r]!.fighters[0]!.action).toMatchObject({ phase: 'Release' });
  });

  it("pressing attack in the incoming Attack's Direction on the first Tick of its Release chambers it: the incoming Attack is cancelled (its attacker Staggers, cause Chambered), and the chamberer's own Attack continues", () => {
    const r = releaseStart(tuning);
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(r) });
    const at = chamberLanded(run, r);
    expect(run.states[at]!.fighters[0]!.action).toEqual({ kind: 'Stagger', cause: 'Chambered' });
    expect(run.states[at]!.fighters[1]!.action).toMatchObject({ kind: 'Attack', direction: 'Overhead' });
    expect(eventsOf(run, 'Stagger')).toContainEqual({ type: 'Stagger', fighter: 0, cause: 'Chambered', tick: at });
    // The chambered Attack never lands; the chamberer's own Attack goes on to Release.
    expect(hitsOf(run).filter((h) => h.attacker === 0)).toEqual([]);
    expect(run.final.fighters[1]!.hp).toBe(100);
    const releases = run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Release');
    expect(releases).toHaveLength(1);
  });

  it('the last Tick of the Chamber window (Release Tick = window) still chambers', () => {
    const r = releaseStart(tuning);
    const last = r + windowTicks(tuning) - 1;
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(last) });
    chamberLanded(run, last);
    expect(run.final.fighters[1]!.hp).toBe(100);
  });

  it('pressing one Tick after the Chamber window closes does not chamber: the incoming Attack lands', () => {
    const late = releaseStart(tuning) + windowTicks(tuning);
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(late) });
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(hitsOf(run).filter((h) => h.attacker === 0)).toHaveLength(1);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it("pressing during the incoming Attack's Wind-up (one Tick before its Release) does not chamber", () => {
    const early = releaseStart(tuning) - 1;
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(early) });
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it('a Wind-up pressed before the window and still held into it does not chamber: only the press Tick counts', () => {
    const r = releaseStart(tuning);
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: [...wait(r - 6), ...attack('Overhead', 30)] });
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it('a Feint into the matching Direction inside the window chambers: a fresh Wind-up counts as starting an Attack', () => {
    const r = releaseStart(tuning);
    // Fighter 1 winds up Left before the window, then (still holding attack) switches to Overhead on Tick r.
    const b = [...wait(r - 6), ...hold(5, { attack: true, direction: 'Left' }), ...hold(1, { attack: true, direction: 'Overhead' })];
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b });
    expect(eventsOf(run, 'Feint')).toHaveLength(1);
    chamberLanded(run, r);
    expect(run.final.fighters[1]!.hp).toBe(100);
  });

  it('a mismatched Direction inside the window does not chamber: the incoming Attack lands', () => {
    for (const direction of ['Left', 'Right', 'Thrust'] as const) {
      const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(releaseStart(tuning), direction) });
      expect(eventsOf(run, 'Chamber')).toEqual([]);
      expect(hitsOf(run).filter((h) => h.attacker === 0)).toHaveLength(1);
    }
  });

  it('every Direction can be chambered by its mirrored Direction (Left meets Right, Overhead and Thrust meet themselves)', () => {
    for (const direction of ['Overhead', 'Left', 'Right', 'Thrust'] as const) {
      const r = releaseStart(tuning, direction);
      const run = runDuel(tuning, { placements: placements(1.3), a: attack(direction), b: counter(r, mirrorDirection(direction)) });
      chamberLanded(run, r, direction);
    }
  });

  it('a matching press inside the window while facing away from the attacker does not chamber', () => {
    const run = runDuel(tuning, { placements: placements(1.3, 0), a: attack('Overhead'), b: counter(releaseStart(tuning)) });
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it('a Chamber lands when the blades meet, not on the press: until then the incoming Attack is only marked, then it Staggers where its Blade Sweep reached the chamberer', () => {
    const r = releaseStart(tuning);
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: counter(r) });
    const at = chamberLanded(run, r);
    expect(at).toBeGreaterThan(r);
    expect(run.states[r]!.fighters[0]!.action).toMatchObject({ kind: 'Attack', phase: 'Release', chamberedBy: [1] });
    expect(run.states[at - 1]!.fighters[0]!.action).toMatchObject({ kind: 'Attack', phase: 'Release', chamberedBy: [1] });
    // The meeting point is at the chamberer, not halfway between the two Fighters.
    expect((eventsOf(run, 'Chamber')[0] as ChamberEvent).point.z).toBeGreaterThan(0.65);
  });

  it('out of reach there is no Chamber, however far: the incoming Attack whiffs and plays out, and the chamberer swings on', () => {
    for (const d of [4, 10, 30]) {
      const run = runDuel(tuning, { placements: placements(d), a: attack('Overhead'), b: counter(releaseStart(tuning)) });
      expect(eventsOf(run, 'Chamber'), `${d} m`).toEqual([]);
      expect(eventsOf(run, 'Stagger'), `${d} m`).toEqual([]);
      expect(run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Recovery'), `${d} m`).toHaveLength(1);
      expect(run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Release'), `${d} m`).toHaveLength(1);
    }
  });

  it('a pending Chamber is dropped when the chamberer Feints into another Direction before the blades meet: the incoming Attack lands', () => {
    const r = releaseStart(tuning);
    const b = [...wait(r - 1), ...hold(2, { attack: true, direction: 'Overhead' }), ...hold(20, { attack: true, direction: 'Left' })];
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b });
    expect(r + 2).toBeLessThan(landsAt());
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(hitsOf(run).filter((h) => h.attacker === 0)).toHaveLength(1);
  });

  it('the Chamber window comes from Tuning Data (chamber.windowSeconds, seconds)', () => {
    const r = releaseStart(tuning);
    const wide: TuningData = { ...tuning, chamber: { windowSeconds: 0.2 } }; // 12 Ticks
    const narrow: TuningData = { ...tuning, chamber: { windowSeconds: 0.05 } }; // 3 Ticks
    const press = r + 5; // 6th Tick of Release
    const withWide = runDuel(wide, { placements: placements(1.3), a: attack('Overhead'), b: counter(press) });
    const withNarrow = runDuel(narrow, { placements: placements(1.3), a: attack('Overhead'), b: counter(press) });
    expect(eventsOf(withWide, 'Chamber')).toHaveLength(1);
    expect(eventsOf(withNarrow, 'Chamber')).toEqual([]);
  });
});
