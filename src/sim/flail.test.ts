/**
 * The Flail (docs/plans/flail.md): a two-handed Weapon with no Thrust. Every place an Intent's Direction becomes an
 * Attack's Direction maps it through `attackDirection`, so a Thrust press with a Flail is an Overhead, and holding
 * Thrust through that Overhead's Wind-up is no Feint (a naive mapping in `startAttack` alone would restart the
 * Wind-up every Tick). Blocks are untouched: a Flail Blocks all four Directions.
 */
import { describe, expect, it } from 'vitest';
import { attackDirection, loadTuningData } from '../tuning';
import { attack, attackTimings, hold, runDuel, wait, type ScriptRun, type Track } from './index';

const tuning = loadTuningData();
const FLAIL = 'Flail';

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead, facing back. */
const placements = (d: number) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: d }, facing: Math.PI },
];
const solo = (a: Track, weapon = FLAIL) => runDuel(tuning, { placements: [{ position: { x: 0, z: 0 }, facing: 0 }], weapons: [weapon], a });
const fighter = (run: ScriptRun, i: number) => run.states[i]!.fighters[0]!;
const eventsOf = (run: ScriptRun, type: string) => run.events.filter((e) => e.type === type);
const overhead = attackTimings(tuning, FLAIL, 'Overhead');

describe('the Flail has no Thrust', () => {
  it('is in the roster, attacking Overhead, Left and Right', () => {
    const flail = tuning.weapons[FLAIL]!;
    expect(flail.attacks).toEqual(['Overhead', 'Left', 'Right']);
    expect(attackDirection(flail, 'Thrust')).toBe('Overhead');
    for (const d of ['Overhead', 'Left', 'Right'] as const) expect(attackDirection(flail, d)).toBe(d);
  });

  it('holding Thrust through the Wind-up is one Overhead, never a Feint (no restart every Tick)', () => {
    const run = solo(hold(overhead.windUpEnd + 20, { attack: true, direction: 'Thrust' }));
    expect(eventsOf(run, 'Feint')).toEqual([]);
    expect(fighter(run, 1).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up', landed: false });
    expect(fighter(run, 1).motion).toMatchObject({ name: 'Overhead', tick: 0 });
    // The Wind-up plays on to its held pose and holds there.
    expect(fighter(run, overhead.windUpEnd + 10).motion).toMatchObject({ name: 'Overhead', tick: overhead.windUpEnd });
    expect(eventsOf(run, 'AttackPhase').filter((e) => e.type === 'AttackPhase' && e.phase === 'Wind-up')).toHaveLength(1);
  });

  it('a Thrust press starts an Overhead, which Releases as an Overhead', () => {
    const run = solo([...attack('Thrust'), ...wait(overhead.end + 5)]);
    expect(eventsOf(run, 'AttackPhase').map((e) => e.type === 'AttackPhase' && e.direction)).toEqual(['Overhead', 'Overhead', 'Overhead']);
  });

  it('Overhead to Left still Feints, and Thrust after Left Feints into an Overhead', () => {
    const run = solo([...hold(10, { attack: true, direction: 'Overhead' }), ...hold(10, { attack: true, direction: 'Left' }), ...hold(10, { attack: true, direction: 'Thrust' })]);
    expect(eventsOf(run, 'Feint')).toEqual([
      { type: 'Feint', fighter: 0, from: 'Overhead', into: { kind: 'Attack', direction: 'Left' }, tick: 11 },
      { type: 'Feint', fighter: 0, from: 'Left', into: { kind: 'Attack', direction: 'Overhead' }, tick: 21 },
    ]);
    expect(fighter(run, 30).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up' });
  });

  it('a Block Feint keeps the Intent’s Direction, Thrust included', () => {
    const run = solo([...hold(10, { attack: true, direction: 'Overhead' }), ...hold(10, { attack: true, block: true, direction: 'Thrust' })]);
    expect(eventsOf(run, 'Feint')).toEqual([{ type: 'Feint', fighter: 0, from: 'Overhead', into: { kind: 'Block', direction: 'Thrust' }, tick: 11 }]);
    expect(fighter(run, 15).action).toMatchObject({ kind: 'Block', direction: 'Thrust' });
  });

  it('a Chain held in Thrust shows and starts an Overhead', () => {
    // Tapped Overhead on Tick 0; attack held in Thrust from inside Recovery until well after the next Attack starts.
    const recoveryAt = 1 + overhead.releaseEnd;
    const run = solo([...attack('Overhead'), ...wait(recoveryAt + 2 - 1), ...hold(overhead.end + 10, { attack: true, direction: 'Thrust' })]);
    expect(fighter(run, recoveryAt + 4).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', chain: { direction: 'Overhead' } });
    expect(fighter(run, recoveryAt + 4).motion.name).toBe('Overhead');
    const starts = eventsOf(run, 'AttackPhase').filter((e) => e.type === 'AttackPhase' && e.phase === 'Wind-up');
    expect(starts.map((e) => e.type === 'AttackPhase' && e.direction)).toEqual(['Overhead', 'Overhead']);
    expect(eventsOf(run, 'Feint')).toEqual([]);
  });

  it('a Whiff Chain held in Thrust starts an Overhead', () => {
    const recoveryAt = 1 + overhead.releaseEnd;
    const press = overhead.releaseEnd - 2;
    const run = solo([...attack('Overhead'), ...wait(press - 1), ...hold(80, { attack: true, direction: 'Thrust' })]);
    expect(fighter(run, recoveryAt).action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Recovery', whiffChain: 'Overhead' });
    expect(fighter(run, recoveryAt + 1).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up', landed: false });
    expect(eventsOf(run, 'Feint')).toEqual([]);
  });

  it('Blocks a Thrust in the Thrust Direction', () => {
    const run = runDuel(tuning, {
      placements: placements(1.3),
      weapons: ['Arming Sword', FLAIL],
      a: attack('Thrust'),
      b: hold(120, { block: true, direction: 'Thrust' }),
    });
    expect(eventsOf(run, 'Block')).toHaveLength(1);
    expect(eventsOf(run, 'Hit')).toEqual([]);
  });

  it('cannot Chamber a Thrust: its Thrust press is an Overhead', () => {
    const release = attackTimings(tuning, 'Arming Sword', 'Thrust').windUpEnd + 2;
    const run = runDuel(tuning, {
      placements: placements(1.3),
      weapons: ['Arming Sword', FLAIL],
      a: attack('Thrust'),
      b: [...wait(release - 1), ...attack('Thrust')],
    });
    expect(eventsOf(run, 'Chamber')).toEqual([]);
    expect(run.states.some((s) => s.fighters[0]!.action.kind === 'Attack' && (s.fighters[0]!.action.chamberedBy ?? []).length > 0)).toBe(false);
  });

  it('each of its Attacks Hits with the ball at the end of its reach, with the shaft up close, and none is a Heavy Blow unspun', () => {
    const flail = tuning.weapons[FLAIL]!;
    const far = { Overhead: 2.2, Left: 1.9, Right: 1.9 } as const;
    for (const d of ['Overhead', 'Left', 'Right'] as const) {
      for (const [distance, head] of [[far[d], true], [1.3, false]] as const) {
        const run = runDuel(tuning, { placements: placements(distance), weapons: [FLAIL, 'Arming Sword'], a: attack(d), b: wait(1) });
        const hits = eventsOf(run, 'Hit');
        expect(hits, `${d} from ${distance} m`).toHaveLength(1);
        expect(hits[0], `${d} from ${distance} m`).toMatchObject({ attacker: 0, head, heavy: false });
        // The reference Blade Speed is about the speed the ball meets a body at, so a Head Hit deals about `damage`.
        if (head) expect(hits[0]!.type === 'Hit' && hits[0]!.damage / flail.damage, `${d} from ${distance} m`).toBeGreaterThan(0.85);
        if (head) expect(hits[0]!.type === 'Hit' && hits[0]!.damage / flail.damage, `${d} from ${distance} m`).toBeLessThan(1.25);
      }
    }
  });

  it('every other Weapon still Thrusts', () => {
    for (const weapon of Object.keys(tuning.weapons).filter((w) => w !== FLAIL)) {
      expect(tuning.weapons[weapon]!.attacks, weapon).toBeUndefined();
      const run = solo([...attack('Thrust'), ...wait(10)], weapon);
      expect(fighter(run, 1).action, weapon).toEqual({ kind: 'Attack', direction: 'Thrust', phase: 'Wind-up', landed: false });
    }
  });
});
