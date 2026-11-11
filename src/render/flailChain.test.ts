/**
 * The Flail's drawn chain (docs/plans/flail.md, Stage 3): a pure function of the Simulation's states, the Motion playhead and alpha,
 * so the same Tick always draws the same chain (scrubbing, Rollback, the Final Blow Shot), the ball is on the simulated tip through
 * Release, it hangs straight down under gravity otherwise, and the whirl turns the way its Direction swings.
 */
import { describe, expect, it } from 'vitest';
import { attack, attackTimings, fighterPose, hold, runDuel, wait, type ScriptRun, type SimState, type Vec3 } from '../sim';
import { loadTuningData, sizedTuning, spinUpChargeTicks, weaponByName, whirlTurns, type Size } from '../tuning';
import { flailChainOf, rigidBall, shaftEnd, type FlailChain } from './flailChain';

const tuning = loadTuningData();
const FLAIL = 'Flail';
const flail = weaponByName(tuning, FLAIL);
const FULL = spinUpChargeTicks(flail);
const DIRECTIONS = ['Overhead', 'Left', 'Right'] as const;
const t = attackTimings(tuning, FLAIL, 'Overhead');

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const solo = (a: ReturnType<typeof attack>, size?: Size, weapon = FLAIL): ScriptRun =>
  runDuel(tuning, { placements: [{ position: { x: 0, z: 0 }, facing: 0 }], weapons: [weapon], a, ...(size ? { sizes: [size] } : {}) });
/** Fighter 0's drawn chain a share `alpha` of the way from Tick `k - 1` to Tick `k`. */
const chainAt = (run: ScriptRun, k: number, alpha = 1): FlailChain => flailChainOf(run.states[k - 1]!, run.states[k]!, 0, alpha, tuning)!;
const weaponOf = (s: SimState) => weaponByName(sizedTuning(tuning, s.fighters[0]!.size), FLAIL);
const actionAt = (run: ScriptRun, k: number) => run.states[k]!.fighters[0]!.action;

describe('flailChainOf', () => {
  it('is the same for the same Ticks and alpha, whatever was drawn before (scrubbing back and forth)', () => {
    const run = solo([...attack('Left', FULL + 30), ...wait(80)]);
    const forward = run.states.slice(1).map((_, k) => chainAt(run, k + 1, 0.37));
    const backward = run.states
      .slice(1)
      .map((_, k) => k + 1)
      .reverse()
      .map((k) => chainAt(run, k, 0.37))
      .reverse();
    expect(backward).toEqual(forward);
    // Each frame is a fresh value: drawing it again gives the same chain.
    expect(chainAt(run, 70, 0.5)).toEqual(chainAt(run, 70, 0.5));
  });

  it('is undefined for a Weapon of another look', () => {
    const run = solo([...attack('Left', 40), ...wait(10)], undefined, 'Halberd');
    expect(flailChainOf(run.states[20]!, run.states[21]!, 0, 0.5, tuning)).toBeUndefined();
  });

  it('puts the ball exactly on the simulated tip from the first few Ticks of Release through releaseEnd', () => {
    for (const d of DIRECTIONS) {
      const timings = attackTimings(tuning, FLAIL, d);
      for (const held of [1, FULL / 2, FULL + 20]) {
        const run = solo([...attack(d, held), ...wait(120)]);
        const release = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Attack' && (s.fighters[0]!.action as { phase: string }).phase === 'Release');
        expect(release, d).toBeGreaterThan(0);
        // On every Tick from the blend's end to the first Recovery Tick (whose pose is the end-of-Release one), and between them.
        // Release's Ticks play the Motion from windUpEnd + 1 to releaseEnd - 1; the next is Recovery's first.
        const last = release + (timings.releaseEnd - timings.windUpEnd - 1) - 1;
        for (let k = release + 2; k <= last + 1; k++) {
          for (const alpha of [0, 0.5, 1]) {
            if (k === release + 2 && alpha === 0) continue;
            const { ball } = chainAt(run, k, alpha);
            const tip = rigidBall(drawnBlade(run, k, alpha), weaponOf(run.states[k]!));
            expect(len(sub(ball, tip)), `${d} held ${held}, Tick ${k} α ${alpha}`).toBeLessThan(1e-9);
          }
        }
        // Into Release it moves off the whirl onto the tip, and the chain stays its length.
        const into = chainAt(run, release, 0.5);
        expect(len(sub(into.ball, shaftEnd(drawnBlade(run, release, 0.5), flail)))).toBeLessThan(chainLength() + 1e-6);
      }
    }
  });

  it('holds the ball on the contact point at a Hit, and in the victim while the Weapon is lodged', () => {
    const run = runDuel(tuning, {
      placements: [
        { position: { x: 0, z: 0 }, facing: 0 },
        { position: { x: 0, z: 2.2 }, facing: Math.PI },
      ],
      weapons: [FLAIL, 'Arming Sword'],
      a: attack('Overhead', FULL + 10),
      b: wait(1),
      ticks: FULL + 120,
    });
    const k = run.states.findIndex((s) => s.events.some((e) => e.type === 'Hit'));
    expect(k).toBeGreaterThan(0);
    const hit = run.states[k]!.events.find((e) => e.type === 'Hit')!;
    expect(hit.type === 'Hit' && hit.head).toBe(true);
    for (let j = k; j < run.states.length; j++) {
      const a = actionAt(run, j);
      if (a.kind !== 'Attack' || a.phase !== 'Release') break;
      const { ball } = chainAt(run, j, 0.5);
      expect(len(sub(ball, rigidBall(drawnBlade(run, j, 0.5), flail))), `Tick ${j}`).toBeLessThan(1e-9);
    }
    // The ball drawn on the Hit's Tick is the simulated one, which struck at the contact point part way through the Tick and is
    // drawn where the Tick's blade ends, in the victim (its Head's half-width plus the rest of that Tick's travel).
    const { ball } = chainAt(run, k, 1);
    expect(len(sub(ball, rigidBall(run.states[k]!.fighters[0]!.blade, flail)))).toBeLessThan(1e-9);
    expect(len(sub(ball, hit.type === 'Hit' ? hit.point : ball))).toBeLessThan(0.4);
  });

  it('hangs the ball straight down from the shaft’s end at Idle and in a Block, above the floor', () => {
    const run = solo([...wait(30), ...hold(60, { block: true, direction: 'Left' }), ...wait(30)]);
    for (const k of [10, 29, 45, 89, 110]) {
      const s = run.states[k]!;
      const chain = chainAt(run, k, 0.5);
      const end = shaftEnd(drawnBlade(run, k, 0.5), flail);
      const down = sub(chain.ball, end);
      expect(Math.hypot(down.x, down.z), `Tick ${k}`).toBeLessThan(1e-9);
      expect(down.y, `Tick ${k}`).toBeLessThan(0);
      expect(chain.ball.y - flail.head / 2, `Tick ${k}`).toBeGreaterThanOrEqual(s.fighters[0]!.y - 1e-9);
      // A hanging chain is straight: every link on the line from the shaft's end to the ball.
      for (const l of chain.links) expect(Math.hypot(l.x - end.x, l.z - end.z), `Tick ${k}`).toBeLessThan(1e-9);
    }
  });

  it('keeps a hanging ball out of the floor when the shaft’s end is low (a Knockdown)', () => {
    const run = runDuel(tuning, {
      placements: [
        { position: { x: 0, z: 0 }, facing: 0 },
        { position: { x: 0, z: 2.2 }, facing: Math.PI },
      ],
      weapons: ['Halberd', FLAIL],
      a: attack('Overhead', 5),
      b: wait(1),
      ticks: 200,
    });
    const down = run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Knockdown');
    expect(down).toBeGreaterThan(0);
    for (let k = down; k < run.states.length; k++) {
      const s = run.states[k]!;
      const chain = flailChainOf(run.states[k - 1]!, s, 1, 0.5, tuning)!;
      expect(chain.ball.y - flail.head / 2, `Tick ${k}`).toBeGreaterThanOrEqual(s.fighters[1]!.y - 1e-9);
    }
  });

  it('whirls the way each Direction swings: the ball turns about the shaft’s end in the sense of the Release', () => {
    for (const d of DIRECTIONS) {
      const run = solo([...attack(d, FULL + 40), ...wait(80)]);
      // The swing's sense: the tip's angular momentum about the chest through Release.
      const release = run.states.findIndex((s) => (s.fighters[0]!.action as { phase?: string }).phase === 'Release');
      const timings = attackTimings(tuning, FLAIL, d);
      let swing: Vec3 = { x: 0, y: 0, z: 0 };
      for (let k = release; k < release + timings.releaseEnd - timings.windUpEnd; k++) {
        const c = run.states[k]!.fighters[0]!;
        const r = sub(c.blade.tip, fighterPose(c, tuning).joints.chest);
        const v = sub(c.blade.tip, run.states[k - 1]!.fighters[0]!.blade.tip);
        const m = cross(r, v);
        swing = { x: swing.x + m.x, y: swing.y + m.y, z: swing.z + m.z };
      }
      // The whirl's: the ball's angular momentum about the shaft's end through the held Wind-up.
      let whirl: Vec3 = { x: 0, y: 0, z: 0 };
      for (let k = 40; k < FULL + 40; k++) {
        const end = shaftEnd(drawnBlade(run, k, 1), flail);
        const [a, b] = [chainAt(run, k, 1).ball, chainAt(run, k + 1, 1).ball];
        const m = cross(sub(a, end), sub(b, a));
        whirl = { x: whirl.x + m.x, y: whirl.y + m.y, z: whirl.z + m.z };
      }
      expect(dot(whirl, swing) / (len(whirl) * len(swing)), d).toBeGreaterThan(0.4);
    }
  });

  it('turns faster as the charge builds, and keeps turning at the top rate while held at full', () => {
    // The closed form: each Wind-up Tick adds one to the Tick and (to full) the charge; the turn it adds rises with the charge, then
    // holds at the top rate while only the Tick moves. Whatever Tick the Wind-up starts on.
    for (const start of [0, 37, 1000]) {
      const at = (k: number) => whirlTurns(flail, start + k, Math.min(k, FULL));
      const rate = (k: number) => at(k + 1) - at(k);
      for (let k = 1; k < FULL; k++) expect(rate(k)).toBeGreaterThan(rate(k - 1));
      for (let k = FULL; k < FULL + 200; k += 17) expect(rate(k)).toBeCloseTo(rate(FULL), 12);
      expect(rate(FULL)).toBeGreaterThan(rate(0) * 2);
    }
    // Between Ticks it lies between them.
    expect(whirlTurns(flail, 10.5, 10.5)).toBeGreaterThan(whirlTurns(flail, 10, 10));
    expect(whirlTurns(flail, 10.5, 10.5)).toBeLessThan(whirlTurns(flail, 11, 11));
    // Drawn: held at full charge the pose is still and the charge frozen, yet the ball goes on round.
    const run = solo([...attack('Right', FULL + 120), ...wait(10)]);
    const heldTicks = [FULL + 20, FULL + 30, FULL + 40, FULL + 50];
    const balls = heldTicks.map((k) => chainAt(run, k).ball);
    for (let j = 1; j < balls.length; j++) expect(len(sub(balls[j]!, balls[j - 1]!))).toBeGreaterThan(0.05);
    // Each Tick at full moves the ball as far round as the last (the same speed), a slow early Wind-up Tick less far.
    const step = (k: number) => len(sub(chainAt(run, k + 1).ball, chainAt(run, k).ball));
    expect(step(FULL + 60)).toBeCloseTo(step(FULL + 70), 3);
    expect(step(30)).toBeLessThan(step(FULL + 60));
  });

  it('keeps the whirl clear of the Fighter’s own head in every Direction, at every Size', () => {
    for (const size of [{ height: 0.6, thick: 0.6 }, undefined, { height: 1.4, thick: 1.4 }]) {
      for (const d of DIRECTIONS) {
        const run = solo([...attack(d, FULL + 60), ...wait(10)], size);
        const h = size?.height ?? 1;
        for (let k = 1; k < FULL + 60; k++) {
          const s = run.states[k]!;
          const head = fighterPose(s.fighters[0]!, tuning).joints.head;
          const { ball } = chainAt(run, k, 0.5);
          expect(len(sub(ball, head)), `${d} size ${h} Tick ${k}`).toBeGreaterThan(0.12 * h + weaponOf(s).head / 2 - 1e-9);
        }
      }
    }
  });

  it('moves the ball smoothly: no jump through a spin and its Release and Recovery, a Whiff Chain or a Chain', () => {
    const r = 1 + t.releaseEnd;
    const runs: [string, ScriptRun, number][] = [
      ...DIRECTIONS.map((d): [string, ScriptRun, number] => [`${d} spin`, solo([...attack(d, FULL + 30), ...wait(90)]), 0]),
      ['Whiff Chain', solo([...attack('Overhead', 40), ...wait(t.releaseEnd - t.windUpEnd - 4), ...hold(120, { attack: true, direction: 'Left' })]), 0],
      ['Chain', solo([...attack('Overhead', FULL), ...wait(r - 5), ...hold(200, { attack: true, direction: 'Left' })]), 0],
    ];
    for (const [name, run, i] of runs) {
      let last: { ball: Vec3; end: Vec3; rigid: Vec3 } | undefined;
      for (let k = 1; k < run.states.length; k++) {
        for (const alpha of [0.25, 0.5, 0.75, 1]) {
          const { ball } = flailChainOf(run.states[k - 1]!, run.states[k]!, i, alpha, tuning)!;
          const blade = drawnBladeOf(run, k, alpha, i);
          const now = { ball, end: shaftEnd(blade, flail), rigid: rigidBall(blade, flail) };
          // Never further than the Weapon itself moved (the shaft's end or the simulated ball), and a little for the whirl and the Release blend onto the tip: no pop.
          if (last) {
            const weapon = Math.max(len(sub(now.end, last.end)), len(sub(now.rigid, last.rigid)));
            expect(len(sub(ball, last.ball)), `${name}: Tick ${k} α ${alpha}`).toBeLessThan(weapon + 0.2);
          }
          last = now;
        }
      }
    }
  });

  it('a Chain whirls again from the start; the chain is always its own length or slack', () => {
    const r = 1 + t.releaseEnd;
    const run = solo([...attack('Overhead', FULL), ...wait(r - 5), ...hold(200, { attack: true, direction: 'Left' })]);
    for (let k = 1; k < run.states.length; k++) {
      const s = run.states[k]!;
      const w = weaponOf(s);
      const chain = chainAt(run, k, 0.5);
      const end = shaftEnd(drawnBlade(run, k, 0.5), w);
      expect(len(sub(chain.ball, end)), `Tick ${k}`).toBeLessThan((w.chain ?? 0) + w.head / 2 + 1e-6);
      expect(chain.links.length).toBeGreaterThan(0);
    }
  });
});

/** The drawn rigid blade (Ticks `k - 1` to `k` at `alpha`), as `drawnPose` draws it. */
const drawnBlade = (run: ScriptRun, k: number, alpha: number) => drawnBladeOf(run, k, alpha, 0);
function drawnBladeOf(run: ScriptRun, k: number, alpha: number, i: number) {
  const [a, b] = [run.states[k - 1]!.fighters[i]!.blade, run.states[k]!.fighters[i]!.blade];
  const l = (u: Vec3, v: Vec3): Vec3 => ({ x: u.x + (v.x - u.x) * alpha, y: u.y + (v.y - u.y) * alpha, z: u.z + (v.z - u.z) * alpha });
  return { hilt: l(a.hilt, b.hilt), tip: l(a.tip, b.tip), edge: l(a.edge, b.edge) };
}

const chainLength = () => (flail.chain ?? 0) + flail.head / 2;
