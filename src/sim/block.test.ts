import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel, secondsToTicks, wait, type HitEvent, type ScriptRun, type Track } from './index';

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
    expect(blocks).toEqual([{ type: 'Block', attacker: 0, defender: 1, direction: 'Overhead', perfect: false, point: expect.any(Object), bladeSpeed: expect.any(Number), tick: expect.any(Number) }]);
    const t = blocks[0]!.tick;
    expect(run.states[t]!.fighters[0]!.action).toMatchObject({ kind: 'Stagger' });
    expect(run.states[t]!.fighters[1]!.action).toMatchObject({ kind: 'Block', direction: 'Overhead' });
    expect(eventsOf(run, 'Stagger')).toEqual([{ type: 'Stagger', fighter: 0, cause: 'Blocked', tick: t }]);
  });

  it('a blocked attacker holds its upper body where the Block caught it for the whole recoil', () => {
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 120) });
    const t = eventsOf(run, 'Block')[0]!.tick;
    const hold = run.states[t]!.fighters[0]!.motion.hold;
    expect(hold).toBeDefined();
    let k = t;
    while (run.states[k]!.fighters[0]!.action.kind === 'Stagger') {
      expect(run.states[k]!.fighters[0]!.motion.hold).toEqual(hold);
      k++;
    }
    expect(k).toBeGreaterThan(t);
    expect(run.states[k]!.fighters[0]!.motion.hold).toBeUndefined();
  });

  it('a Block in a different Direction does not stop the Attack: it lands', () => {
    for (const direction of ['Left', 'Right', 'Thrust'] as const) {
      const run = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block(direction, 120) });
      expect(eventsOf(run, 'Block')).toEqual([]);
      expect(hitsOf(run)).toHaveLength(1);
      expect(run.final.fighters[1]!.hp).toBeLessThan(100);
    }
  });

  it("a Right Attack arrives on the defender's left, so a Left Block stops it (and vice versa); the same-named Block does not", () => {
    for (const [attackDir, blockDir] of [['Right', 'Left'], ['Left', 'Right']] as const) {
      const blocked = runDuel(tuning, { placements: placements(1.3), a: attack(attackDir), b: block(blockDir, 120) });
      expect(eventsOf(blocked, 'Block')).toEqual([expect.objectContaining({ attacker: 0, defender: 1, direction: attackDir })]);
      expect(blocked.final.fighters[1]!.hp).toBe(100);
      const sameName = runDuel(tuning, { placements: placements(1.3), a: attack(attackDir), b: block(attackDir, 120) });
      expect(eventsOf(sameName, 'Block')).toEqual([]);
      expect(sameName.final.fighters[1]!.hp).toBeLessThan(100);
    }
  });

  it('how roughly the defender must face the attacker is Tuning Data (block.facingHalfAngle)', () => {
    // Fighter 1 is turned 75 degrees away from facing Fighter 0.
    const turned = placements(1.3, Math.PI - (75 * Math.PI) / 180);
    const narrow = runDuel(tuning, { placements: turned, a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(narrow, 'Block')).toEqual([]);
    const wide: typeof tuning = { ...tuning, block: { ...tuning.block, facingHalfAngle: 90 } };
    const widened = runDuel(wide, { placements: turned, a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(widened, 'Block')).toEqual([expect.objectContaining({ attacker: 0, defender: 1 })]);
  });

  it('a Block in the matching Direction while facing away from the attacker does not stop the Attack', () => {
    const run = runDuel(tuning, { placements: placements(1.3, 0), a: attack('Overhead'), b: block('Overhead', 120) });
    expect(eventsOf(run, 'Block')).toEqual([]);
    expect(hitsOf(run)).toHaveLength(1);
    expect(run.final.fighters[1]!.hp).toBeLessThan(100);
  });

  it('a Block lands where the blades meet, before the Attack would reach the body', () => {
    // A hair-thin blade leaves only the body to stop the Attack, as before blades had a collider.
    const bodyOnly = { ...tuning, block: { ...tuning.block, bladeRadius: 1e-6 } };
    for (const [attackDir, blockDir] of [['Overhead', 'Overhead'], ['Left', 'Right']] as const) {
      const at = (t: typeof tuning) => eventsOf(runDuel(t, { placements: placements(1.3), a: attack(attackDir), b: block(blockDir, 120) }), 'Block')[0]!.tick;
      expect(at(tuning)).toBeLessThan(at(bodyOnly));
    }
  });

  it('an Attack that only reaches the Blocking blade, never the body, is still Blocked', () => {
    // Out of reach of the body: unblocked, the Attack whiffs.
    expect(eventsOf(runDuel(tuning, { placements: placements(1.7), a: attack('Left'), b: wait(120) }), 'Hit')).toEqual([]);
    const run = runDuel(tuning, { placements: placements(1.7), a: attack('Left'), b: block('Right', 120) });
    expect(eventsOf(run, 'Block')).toEqual([expect.objectContaining({ attacker: 0, defender: 1, direction: 'Left' })]);
  });

  it('a blade that is not Blocking that Attack does not stop it (the Block rule still decides, ADR 0002)', () => {
    // The wrong Block's blade is no obstacle: the Attack lands on the body.
    const run = runDuel(tuning, { placements: placements(1.3), a: attack('Left'), b: block('Left', 120) });
    expect(eventsOf(run, 'Block')).toEqual([]);
    expect(hitsOf(run)).toHaveLength(1);
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
    // Counted outside Hitstop, which freezes the Fighter in its first recoil pose.
    const staggerTicks = (run: ScriptRun, fighter: number) => run.states.filter((s) => s.fighters[fighter]!.action.kind === 'Stagger' && !s.fighters[fighter]!.hitstop).length;
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
    expect(run.states[t + 60]!.fighters[1]!.action).toMatchObject({ kind: 'Block', direction: 'Thrust' });
  });

  it("a Blocked blow knocks the defender's sword hand back, bounces it forward past the Block, and settles (Block Impact)", () => {
    // A slow, long ring so the bounce is plain to measure, whatever the shipped defaults.
    const ringing = { ...tuning, block: { ...tuning.block, impactFrequency: 5, impactDuration: 0.45 } };
    const run = runDuel(ringing, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 200) });
    const t = eventsOf(run, 'Block')[0]!.tick;
    const settle = secondsToTicks(ringing.block.impactDuration);
    const held = run.states[t + settle + 5]!.fighters[1]!;
    expect(held.blockImpact).toBeUndefined();
    // How far the blade's hilt sits from where the held Block puts it, toward (+) or away from (-) the attacker at -z.
    const forward = (k: number) => held.blade.hilt.z - run.states[k]!.fighters[1]!.blade.hilt.z;
    const ticks = Array.from({ length: settle }, (_, i) => t + 1 + i);
    expect(run.states[t + 1]!.fighters[1]!.blockImpact).toMatchObject({ direction: 'Overhead', tick: 1 });
    expect(Math.min(...ticks.map(forward))).toBeLessThan(-0.03); // knocked back...
    expect(Math.max(...ticks.map(forward))).toBeGreaterThan(0.01); // ...and bounces past the Block
    expect(Math.abs(forward(t + settle - 1))).toBeLessThan(0.02); // ...ringing down to it
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

describe('Block correction window', () => {
  const window = secondsToTicks(tuning.block.correctionWindow);
  const dirOf = (run: ScriptRun, t: number) => (run.states[t]!.fighters[1]!.action as { direction?: string }).direction;

  it('a Direction change just after the Block went up re-aims it, blending from where the blade was', () => {
    const track = [...block('Overhead', 3), ...block('Thrust', 60)];
    const run = runDuel(tuning, { placements: placements(3), a: wait(80), b: track });
    expect(dirOf(run, 2)).toBe('Overhead');
    expect(dirOf(run, 5)).toBe('Thrust');
    const m = run.states[5]!.fighters[1]!.motion;
    expect(m.name).toBe('BlockThrust');
    expect(m.blend).toBeDefined();
  });

  it('a Direction change after the window has run out is ignored', () => {
    const track = [...block('Overhead', window + 3), ...block('Thrust', 40)];
    const run = runDuel(tuning, { placements: placements(3), a: wait(80), b: track });
    expect(dirOf(run, window + 10)).toBe('Overhead');
  });
});

describe('Perfect Block and Hitstop', () => {
  /** The Tick the Overhead from 1.3 m lands on a Block held from the start. */
  const contact = eventsOf(runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 120) }), 'Block')[0]!.tick;
  /** Fighter 1 raises its Overhead Block `early` Ticks before the blow lands. */
  const lateBlock = (early: number) => runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: [...wait(contact - early), ...block('Overhead', 120)] });

  it('a Block raised just before the blow lands is Perfect: the attacker is Parried, and recoils longer without walking', () => {
    const run = lateBlock(2);
    const [b] = eventsOf(run, 'Block');
    expect(b).toMatchObject({ perfect: true, attacker: 0, defender: 1 });
    expect(eventsOf(run, 'Stagger')).toEqual([expect.objectContaining({ fighter: 0, cause: 'Parried' })]);
    const recoil = (r: ScriptRun) => r.states.filter((s) => s.fighters[0]!.action.kind === 'Stagger').length;
    const held = runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 120) });
    const extra = secondsToTicks(tuning.block.perfectRecoil) + secondsToTicks(tuning.block.perfectHitstop) - secondsToTicks(tuning.block.hitstop);
    expect(recoil(run)).toBe(recoil(held) + extra);
  });

  it('a Block raised earlier than the Perfect window is an ordinary Block', () => {
    const run = lateBlock(secondsToTicks(tuning.block.perfectWindow) + 2);
    expect(eventsOf(run, 'Block')).toEqual([expect.objectContaining({ perfect: false })]);
    expect(eventsOf(run, 'Stagger')).toEqual([expect.objectContaining({ cause: 'Blocked' })]);
  });

  it('a Block freezes both Fighters for the Hitstop, longer for a Perfect Block; the Block Impact rings on through it', () => {
    for (const [run, seconds] of [
      [runDuel(tuning, { placements: placements(1.3), a: attack('Overhead'), b: block('Overhead', 120) }), tuning.block.hitstop],
      [lateBlock(2), tuning.block.perfectHitstop],
    ] as const) {
      const t = eventsOf(run, 'Block')[0]!.tick;
      const ticks = secondsToTicks(seconds);
      expect(ticks).toBeGreaterThan(0);
      for (const i of [0, 1]) {
        const at = run.states[t]!.fighters[i]!;
        expect(at.hitstop).toBe(ticks);
        for (let k = 1; k <= ticks; k++) {
          const f = run.states[t + k]!.fighters[i]!;
          expect(f.motion).toEqual(at.motion);
          expect(f.action).toEqual(at.action);
          expect(f.position).toEqual(at.position);
        }
        expect(run.states[t + ticks]!.fighters[i]!.hitstop).toBeUndefined();
      }
      // Then the attacker's recoil plays on (the defender's Block Motion may already be held at its end).
      expect(run.states[t + ticks + 1]!.fighters[0]!.motion).not.toEqual(run.states[t]!.fighters[0]!.motion);
      expect(run.states[t + ticks]!.fighters[1]!.blockImpact!.tick).toBe(ticks);
    }
  });
});
