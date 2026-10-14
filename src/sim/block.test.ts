import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel, wait, type HitEvent, type ScriptRun, type Track } from './index';

const tuning = loadTuningData();

const hitsOf = (run: ScriptRun) => run.events.filter((e): e is HitEvent & { tick: number } => e.type === 'Hit');
const eventsOf = (run: ScriptRun, type: string) => run.events.filter((e) => e.type === type);

/** Fighter 0 at the origin facing +z; Fighter 1 `d` metres ahead, facing `facing` (π = back towards Fighter 0). */
const placements = (d: number, facing = Math.PI) => [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: d }, facing },
];

const block = (direction: 'Overhead' | 'Left' | 'Right' | 'Thrust', ticks: number): Track => hold(ticks, { block: true, direction });

describe('Block', () => {
  it('a Block in the matching Direction, facing the attacker, stops the Attack: no damage, the attacker Staggers', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 120) });
    expect(hitsOf(run)).toEqual([]);
    expect(run.final.fighters[1]!.hp).toBe(100);
    const blocks = eventsOf(run, 'Block');
    expect(blocks).toEqual([{ type: 'Block', attacker: 0, defender: 1, direction: 'Overhead', tick: expect.any(Number) }]);
    const t = blocks[0]!.tick;
    expect(run.states[t]!.fighters[0]!.action).toMatchObject({ kind: 'Stagger' });
    expect(run.states[t]!.fighters[1]!.action).toEqual({ kind: 'Block', direction: 'Overhead' });
    expect(eventsOf(run, 'Stagger')).toEqual([{ type: 'Stagger', fighter: 0, cause: 'Blocked', tick: t }]);
  });

  it('a Block in a different Direction does not stop the Attack: it lands', () => {
    for (const direction of ['Left', 'Right', 'Thrust'] as const) {
      const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block(direction, 120) });
      expect(eventsOf(run, 'Block')).toEqual([]);
      expect(hitsOf(run)).toHaveLength(1);
      expect(run.final.fighters[1]!.hp).toBeLessThan(100);
    }
  });

  it('how roughly the defender must face the attacker is Tuning Data (block.facingHalfAngle)', () => {
    // Fighter 1 is turned 75 degrees away from facing Fighter 0.
    const turned = placements(1.3, Math.PI - (75 * Math.PI) / 180);
    const narrow = runDuel(tuning, { placements: turned, a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(narrow, 'Block')).toEqual([]);
    const wide: typeof tuning = { ...tuning, block: { facingHalfAngle: 90 } };
    const widened = runDuel(wide, { placements: turned, a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(widened, 'Block')).toEqual([expect.objectContaining({ attacker: 0, defender: 1 })]);
  });

  it('a Block in the matching Direction while facing away from the attacker does not stop the Attack', () => {
    const run = runDuel(tuning, { placements: placements(1.3, 0), a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(run, 'Block')).toEqual([]);
    expect(hitsOf(run)).toHaveLength(1);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it('a Block only counts while it is held', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: [...block('Overhead', 5), ...wait(115)] });
    expect(eventsOf(run, 'Block')).toEqual([]);
    expect(hitsOf(run)).toHaveLength(1);
  });
});

describe('Stagger', () => {
  it("a hit during the victim's Wind-up interrupts it and Staggers the victim", () => {
    // Fighter 1 starts an Overhead a little later and is still winding up when Fighter 0's lands.
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: [...wait(8), ...attack('Overhead', 30)] });
    const hits = hitsOf(run);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 0, defender: 1 });
    const t = hits[0]!.tick;
    expect(run.states[t - 1]!.fighters[1]!.action).toMatchObject({ kind: 'Attack', phase: 'Wind-up' });
    expect(run.states[t]!.fighters[1]!.action).toEqual({ kind: 'Stagger', cause: 'Hit' });
    expect(eventsOf(run, 'Stagger')).toEqual([{ type: 'Stagger', fighter: 1, cause: 'Hit', tick: t }]);
    // The interrupted Attack never Releases, so Fighter 0 is never hit back.
    const releases = run.events.filter((e) => e.type === 'AttackPhase' && e.fighter === 1 && e.phase === 'Release');
    expect(releases).toEqual([]);
    expect(run.final.fighters[0]!.hp).toBe(100);
    // Stagger is short: the victim is Idle again afterwards.
    expect(run.final.fighters[1]!.action).toEqual({ kind: 'Idle' });
  });

  it("a Blocked attacker's recoil is a shorter Stagger than a hit Stagger", () => {
    const staggerTicks = (run: ScriptRun, fighter: number) => run.states.filter((s) => s.fighters[fighter]!.action.kind === 'Stagger').length;
    const blocked = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 200) });
    const hit = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: wait(1) });
    expect(eventsOf(blocked, 'Stagger')).toEqual([expect.objectContaining({ fighter: 0, cause: 'Blocked' })]);
    expect(eventsOf(hit, 'Stagger')).toEqual([expect.objectContaining({ fighter: 1, cause: 'Hit' })]);
    const recoil = staggerTicks(blocked, 0);
    expect(recoil).toBeGreaterThan(0);
    expect(recoil).toBeLessThan(staggerTicks(hit, 1));
  });

  it('a Staggered Fighter ignores its Intents until the Stagger ends', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Thrust', 200) });
    const t = hitsOf(run)[0]!.tick;
    expect(run.states[t + 5]!.fighters[1]!.action).toEqual({ kind: 'Stagger', cause: 'Hit' });
    // Still holding block once the Stagger ends: the Block goes back up.
    expect(run.states[t + 60]!.fighters[1]!.action).toEqual({ kind: 'Block', direction: 'Thrust' });
  });
});

describe('Trade', () => {
  it('two Attacks landing on the same Tick damage both Fighters, and both Stagger', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: attack('Overhead') });
    const hits = hitsOf(run);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.tick).toBe(hits[1]!.tick);
    expect(hits.map((h) => [h.attacker, h.defender]).sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
    const t = hits[0]!.tick;
    for (const i of [0, 1]) {
      const damage = hits.find((h) => h.defender === i)!.damage;
      expect(damage).toBeGreaterThan(0);
      expect(run.final.fighters[i]!.hp).toBeCloseTo(100 - damage, 9);
      expect(run.states[t]!.fighters[i]!.action).toEqual({ kind: 'Stagger', cause: 'Hit' });
    }
  });
});
