/**
 * The Flail (docs/plans/flail.md): a two-handed Weapon with no Thrust. Every place an Intent's Direction becomes an
 * Attack's Direction maps it through `attackDirection`, so a Thrust press with a Flail is an Overhead, and holding
 * Thrust through that Overhead's Wind-up is no Feint (a naive mapping in `startAttack` alone would restart the
 * Wind-up every Tick). Blocks are untouched: a Flail Blocks all four Directions.
 */
import { describe, expect, it } from 'vitest';
import { attackDirection, loadTuningData, spinUpChargeTicks, spinUpSpeed, withWeapon, type TuningData } from '../tuning';
import {
  attack,
  attackTimings,
  createInitialState,
  hashState,
  hold,
  mirrorDirection,
  restore,
  runDuel,
  runScript,
  scriptIntents,
  snapshot,
  step,
  wait,
  type FighterState,
  type ScriptRun,
  type Track,
} from './index';

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
    expect(fighter(run, 1).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up', landed: false, charge: 0 });
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
    expect(fighter(run, recoveryAt + 1).action).toEqual({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up', landed: false, charge: 0 });
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

/** The Attack's charge on Fighter `i` after `k` Ticks (undefined when it is not Attacking, or carries none). */
const chargeOf = (run: ScriptRun, k: number, i = 0): number | undefined => {
  const a = run.states[k]!.fighters[i]!.action;
  return a.kind === 'Attack' ? a.charge : undefined;
};
/** The Flail with no Spin-up: the same swing, its Blade Speed unscaled. */
const unspun: TuningData = withWeapon(tuning, { spinUp: undefined }, FLAIL);
const FULL = spinUpChargeTicks(tuning.weapons[FLAIL]!);
/** Where the ball (the Head) meets the body for each Direction (Stage 1 measured these). */
const FAR = { Overhead: 2.2, Left: 1.9, Right: 1.9 } as const;
const FLAIL_DIRECTIONS = ['Overhead', 'Left', 'Right'] as const;

/** How far Fighter 1 moved (m) along the ground from where the Duel placed it to its last Tick. */
const moved = (run: ScriptRun): number => {
  const [from, to] = [run.states[0]!.fighters[1]!.position, run.final.fighters[1]!.position];
  return Math.hypot(to.x - from.x, to.z - from.z);
};
/** The Flail attacks in `d`, attack held `holdTicks`, from `distance` at an idle (or Blocking) Arming Sword. */
const swingAt = (t: TuningData, d: (typeof FLAIL_DIRECTIONS)[number], holdTicks: number, distance: number = FAR[d], block = false) =>
  runDuel(t, {
    placements: placements(distance),
    weapons: [FLAIL, 'Arming Sword'],
    a: attack(d, holdTicks),
    b: block ? hold(holdTicks + 150, { block: true, direction: mirrorDirection(d) }) : wait(1),
    ticks: holdTicks + 150,
  });
const firstOf = (run: ScriptRun, type: 'Hit' | 'Block') => {
  const e = run.events.find((x) => x.type === type);
  if (!e || (e.type !== 'Hit' && e.type !== 'Block')) throw new Error(`no ${type}`);
  return e;
};
/** The charge the Attack Released with (its last Wind-up Tick's, kept frozen from there). */
const releasedCharge = (run: ScriptRun): number => {
  const k = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Attack' && (s.fighters[0]!.action as { phase: string }).phase === 'Release');
  expect(k, 'a Release').toBeGreaterThan(0);
  return chargeOf(run, k)!;
};

describe('the Spin-up', () => {
  it('the charge grows by one each Wind-up Tick from zero, caps at full, and is kept frozen through Release and Recovery', () => {
    const held = FULL + 40;
    const run = solo([...attack('Left', held), ...wait(200)]);
    for (let k = 1; k <= held; k++) expect(chargeOf(run, k), `Tick ${k}`).toBe(Math.min(k - 1, FULL));
    const after = run.states.slice(held + 1).map((s) => s.fighters[0]!.action);
    expect(after.some((a) => a.kind === 'Attack' && a.phase === 'Release')).toBe(true);
    expect(after.some((a) => a.kind === 'Attack' && a.phase === 'Recovery')).toBe(true);
    for (const a of after) if (a.kind === 'Attack') expect(a.charge).toBe(FULL);
  });

  it('Hits for `from`, the midpoint and `to` times the unspun damage at zero, half and full charge', () => {
    const { from, to } = tuning.weapons[FLAIL]!.spinUp!;
    // Zero charge: the charge never gets anywhere when full takes for ever. Half and full: held that long.
    const never = withWeapon(tuning, { spinUp: { seconds: 1e9, from, to } }, FLAIL);
    for (const d of FLAIL_DIRECTIONS) {
      const cases: [TuningData, number, number][] = [
        [never, 1, from],
        [tuning, FULL / 2 + 1, (from + to) / 2],
        [tuning, FULL + 30, to],
      ];
      for (const [t, holdTicks, factor] of cases) {
        const spun = swingAt(t, d, holdTicks);
        const plain = swingAt(unspun, d, holdTicks);
        const [hit, base] = [firstOf(spun, 'Hit'), firstOf(plain, 'Hit')];
        expect(hit.tick, `${d} ×${factor}`).toBe(base.tick);
        expect(hit.type === 'Hit' && hit.head, `${d} ×${factor}`).toBe(true);
        expect(hit.bladeSpeed / base.bladeSpeed, `${d} ×${factor}`).toBeCloseTo(factor, 6);
        expect(hit.type === 'Hit' && base.type === 'Hit' && hit.damage / base.damage, `${d} ×${factor}`).toBeCloseTo(factor, 6);
      }
    }
    expect(releasedCharge(swingAt(tuning, 'Left', FULL / 2 + 1))).toBe(FULL / 2);
  });

  it('a full charge is a Heavy Blow in every Direction and a quick Release never is', () => {
    // Every distance the ball (not the shaft) meets an idle body at, per Direction (from 1.3 m in, only the shaft does).
    const heads = { Overhead: [2.1, 2.2], Left: [1.7, 1.8, 1.9, 2.0, 2.1], Right: [1.9, 2.0, 2.1] } as const;
    for (const d of FLAIL_DIRECTIONS) {
      for (const distance of heads[d]) {
        const quick = firstOf(swingAt(tuning, d, 1, distance), 'Hit');
        expect(quick, `${d} tapped from ${distance} m`).toMatchObject({ head: true, heavy: false });
        const full = firstOf(swingAt(tuning, d, FULL + 10, distance), 'Hit');
        expect(full, `${d} full from ${distance} m`).toMatchObject({ head: true, heavy: true });
      }
    }
  });

  it('a full-charge Hit knocks the victim down and slides it; Blocked, it pushes the defender back and the Block holds', () => {
    const flail = tuning.weapons[FLAIL]!;
    // Light enough that the Hit leaves the victim standing to be pushed.
    const light = withWeapon(tuning, { damage: 10 }, FLAIL);
    const hitRun = swingAt(light, 'Left', FULL + 10);
    const hit = firstOf(hitRun, 'Hit');
    expect(hit).toMatchObject({ heavy: true });
    expect(hitRun.states[hit.tick]!.fighters[1]!.action.kind).toBe('Knockdown');
    expect(moved(hitRun)).toBeCloseTo(flail.heavyBlow.knockdownSlide, 1);

    // A Block is Heavy only where the ball meets the Blocking blade: from about 2.2 m for a Left (closer, the shaft does).
    const blockRun = swingAt(tuning, 'Left', FULL + 10, 2.2, true);
    const block = firstOf(blockRun, 'Block');
    expect(block).toMatchObject({ heavy: true });
    expect(blockRun.states[block.tick]!.fighters[1]!.action.kind).toBe('Block');
    expect(blockRun.events.filter((e) => e.type === 'Hit')).toEqual([]);
    expect(moved(blockRun)).toBeCloseTo(flail.heavyBlow.blockSlide, 2);

    const quickBlock = swingAt(tuning, 'Left', 1, 2.2, true);
    expect(firstOf(quickBlock, 'Block')).toMatchObject({ heavy: false });
    expect(moved(quickBlock)).toBeLessThan(1e-9);
  });

  it('an Attack Feint keeps the charge; a Block Feint drops it with the Attack', () => {
    const run = solo([...hold(50, { attack: true, direction: 'Overhead' }), ...hold(30, { attack: true, direction: 'Left' })]);
    expect(run.events.filter((e) => e.type === 'Feint')).toHaveLength(1);
    expect(chargeOf(run, 50)).toBe(49);
    // The Feint Tick carries the charge into the new Wind-up and, a Wind-up Tick like any other, adds one; it goes on building.
    expect(fighter(run, 51).action).toMatchObject({ direction: 'Left', phase: 'Wind-up', charge: 50 });
    expect(chargeOf(run, 60)).toBe(59);
    // A Feint every Tick still builds the charge one a Tick.
    const flicking = solo(Array.from({ length: 60 }, (_, k) => hold(1, { attack: true, direction: k % 2 === 0 ? 'Left' : 'Right' })).flat());
    expect(flicking.events.filter((e) => e.type === 'Feint')).toHaveLength(59);
    expect(chargeOf(flicking, 60)).toBe(59);

    const blocked = solo([...hold(50, { attack: true, direction: 'Overhead' }), ...hold(10, { attack: true, block: true }), ...wait(30), ...hold(5, { attack: true, direction: 'Left' })]);
    expect(fighter(blocked, 51).action).toEqual({ kind: 'Block', direction: 'Overhead', age: 0 });
    const again = blocked.states.findIndex((s, k) => k > 60 && s.fighters[0]!.action.kind === 'Attack');
    expect(chargeOf(blocked, again)).toBe(0);
  });

  it('a Stagger drops the charge: the next Attack starts from zero', () => {
    const run = runDuel(tuning, {
      placements: placements(1.2),
      weapons: [FLAIL, 'Arming Sword'],
      a: hold(150, { attack: true, direction: 'Left' }),
      b: [...wait(40), ...attack('Overhead')],
    });
    const staggered = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Stagger');
    expect(staggered).toBeGreaterThan(40);
    expect(chargeOf(run, staggered - 1)).toBeGreaterThan(30);
    const again = run.states.findIndex((s, k) => k > staggered && s.fighters[0]!.action.kind === 'Attack');
    expect(again).toBeGreaterThan(staggered);
    expect(chargeOf(run, again)).toBe(0);
  });

  it('a Chain and a Whiff Chain start from zero, however long the swing before was spun', () => {
    // Attack held `held` Ticks (past the held pose): Release from the next Tick, Recovery once its playhead reaches releaseEnd.
    const recoveryAt = (held: number) => held + overhead.releaseEnd - overhead.windUpEnd;
    // Chain: attack held again from inside Recovery until the next Attack starts.
    const held = FULL + 5;
    const r = recoveryAt(held);
    const chain = solo([...attack('Overhead', held), ...wait(r + 2 - held), ...hold(overhead.end + 10, { attack: true, direction: 'Left' })]);
    expect(fighter(chain, r + 4).action).toMatchObject({ phase: 'Recovery', charge: FULL, chain: { direction: 'Left' } });
    const next = chain.states.findIndex((s, k) => k > r && s.fighters[0]!.action.kind === 'Attack' && (s.fighters[0]!.action as { phase: string }).phase === 'Wind-up');
    expect(next, 'the Chained Attack').toBeGreaterThan(r);
    expect(fighter(chain, next).action).toMatchObject({ direction: 'Left', charge: 0 });
    // Whiff Chain: pressed again late in Release and held into Recovery.
    const whiff = solo([...attack('Overhead', held), ...wait(r - 3 - held), ...hold(80, { attack: true, direction: 'Right' })]);
    expect(fighter(whiff, r).action).toMatchObject({ phase: 'Recovery', charge: FULL, whiffChain: 'Right' });
    expect(fighter(whiff, r + 1).action).toEqual({ kind: 'Attack', direction: 'Right', phase: 'Wind-up', landed: false, charge: 0 });
  });

  it('no other Weapon’s states carry a charge, and a recorded Longsword Match hashes as it did before the Spin-up', () => {
    for (const weapon of Object.keys(tuning.weapons).filter((w) => w !== FLAIL)) {
      const run = solo([...attack('Left', 60), ...wait(60)], weapon);
      for (const s of run.states) expect('charge' in s.fighters[0]!.action, weapon).toBe(false);
    }
    const run = runDuel(tuning, {
      distance: 1.4,
      weapons: ['Longsword', 'Longsword'],
      a: [...attack('Left', 40), ...wait(60), ...attack('Overhead', 5), ...hold(30, { attack: true, direction: 'Right' })],
      b: [...wait(20), ...hold(60, { block: true, direction: 'Right' }), ...attack('Thrust')],
    });
    expect(run.events.filter((e) => e.type === 'Hit' || e.type === 'Block')).toHaveLength(2);
    // Recorded on the code before the Spin-up.
    expect(hashState(run.final)).toBe('3d3fe12b');
  });

  it('a state saved mid-spin restores and re-simulates to the same hash (Rollback)', () => {
    const tracks: Track[] = [[...attack('Left', FULL + 20), ...wait(40)], [...wait(30), ...hold(150, { block: true, direction: 'Right' })]];
    const initial = createInitialState(tuning, 3, placements(2.2), [FLAIL, 'Arming Sword']);
    const straight = runScript(tuning, initial, tracks, 220);
    const mid = straight.states[60]!;
    expect((mid.fighters[0] as FighterState).action).toMatchObject({ kind: 'Attack', phase: 'Wind-up', charge: 59 });
    const replayed = scriptIntents(tracks, 220).slice(60).reduce((s, i) => step(s, i, tuning), restore(snapshot(mid)));
    expect(straight.events.some((e) => e.type === 'Block' && e.heavy)).toBe(true);
    expect(hashState(replayed)).toBe(hashState(straight.final));
    expect(spinUpSpeed(tuning.weapons[FLAIL]!, 59)).toBeGreaterThan(spinUpSpeed(tuning.weapons[FLAIL]!, 0));
  });
});
