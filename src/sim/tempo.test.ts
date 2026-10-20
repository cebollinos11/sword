/**
 * Tempo: a Weapon's Attacks play the shared Attack Motions with each phase
 * stretched by its own multiplier, the Pose Keys left as authored (ADR 0016).
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, UNIT_TEMPO, withWeapon, type WeaponTempo } from '../tuning';
import { attackTimings } from './actions';
import { attack, authoredSeconds, hashValue, motionPose, playedSeconds, runDuel, secondsToTicks, TICK_RATE, type Placement } from './index';
import { DIRECTIONS } from './intent';

const tuning = loadTuningData();
const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };
const HAMMER = 'Sledge Hammer';
const overhead = tuning.motions.Overhead!;
const { windUpEnd, releaseEnd } = overhead.markers as { windUpEnd: number; releaseEnd: number };

const withTempo = (tempo: WeaponTempo) => withWeapon(tuning, { tempo }, HAMMER);
const SLOW: WeaponTempo = { windUp: 2, release: 1.5, recovery: 3 };
const slow = withTempo(SLOW);

describe('The unit Tempo', () => {
  it('is every Weapon in the roster today, so Attacks play as authored', () => {
    for (const w of Object.values(tuning.weapons)) expect(w.tempo).toEqual(UNIT_TEMPO);
  });

  it('leaves every time unchanged, bit for bit', () => {
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * overhead.duration * 1.2;
      expect(Object.is(playedSeconds(overhead, UNIT_TEMPO, t), t)).toBe(true);
      expect(Object.is(authoredSeconds(overhead, UNIT_TEMPO, t), t)).toBe(true);
    }
  });

  it('gives every Attack the Tick counts of its authored markers', () => {
    for (const weapon of Object.keys(tuning.weapons)) {
      for (const d of DIRECTIONS) {
        const m = tuning.motions[d]!;
        expect(attackTimings(tuning, weapon, d)).toEqual({
          windUpEnd: secondsToTicks(m.markers.windUpEnd!),
          releaseEnd: secondsToTicks(m.markers.releaseEnd!),
          end: secondsToTicks(m.duration),
        });
      }
    }
  });
});

describe('A Tempo', () => {
  it('stretches each phase of an Attack by its own multiplier', () => {
    const played = { windUpEnd: windUpEnd * 2, releaseEnd: windUpEnd * 2 + (releaseEnd - windUpEnd) * 1.5 };
    expect(attackTimings(slow, HAMMER, 'Overhead')).toEqual({
      windUpEnd: secondsToTicks(played.windUpEnd),
      releaseEnd: secondsToTicks(played.releaseEnd),
      end: secondsToTicks(played.releaseEnd + (overhead.duration - releaseEnd) * 3),
    });
    // Only the Weapon with the Tempo is slowed.
    expect(attackTimings(slow, 'Arming Sword', 'Overhead')).toEqual(attackTimings(tuning, 'Arming Sword', 'Overhead'));
  });

  it('maps played time back to the authored time it came from', () => {
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * overhead.duration;
      expect(authoredSeconds(overhead, SLOW, playedSeconds(overhead, SLOW, t))).toBeCloseTo(t, 12);
    }
  });

  it('shows the authored pose at each marker, however the Pose Keys fall', () => {
    for (const marker of [windUpEnd, releaseEnd, overhead.duration]) {
      const atTempo = motionPose(slow, 'Overhead', playedSeconds(overhead, SLOW, marker) * TICK_RATE, ORIGIN, HAMMER).blade;
      const authored = motionPose(tuning, 'Overhead', marker * TICK_RATE, ORIGIN, HAMMER).blade;
      for (const k of ['x', 'y', 'z'] as const) {
        expect(atTempo.hilt[k]).toBeCloseTo(authored.hilt[k], 9);
        expect(atTempo.tip[k]).toBeCloseTo(authored.tip[k], 9);
      }
    }
  });

  it('leaves every Motion but the Attacks alone', () => {
    for (const name of ['Idle', 'Kick', 'Throw', 'BlockOverhead', 'Stagger']) {
      const track = (t: typeof tuning) => Array.from({ length: 90 }, (_, tick) => motionPose(t, name, tick, ORIGIN, HAMMER).blade);
      expect(hashValue(track(slow))).toBe(hashValue(track(tuning)));
    }
  });

  it('times the simulated Attack: Release, Recovery and the return to Idle come when the stretched phases end', () => {
    const phases = (t: typeof tuning) => {
      const run = runDuel(t, { distance: 6, weapons: [HAMMER, 'Arming Sword'], a: attack('Overhead', 1), ticks: 400 });
      const at = (phase: string) => run.events.find((e) => e.type === 'AttackPhase' && e.fighter === 0 && e.phase === phase)!.tick;
      const idle = run.states.findIndex((s, i) => i > at('Recovery') && s.fighters[0]!.action.kind === 'Idle');
      return { release: at('Release'), recovery: at('Recovery'), idle };
    };
    const base = phases(tuning);
    const stretched = phases(slow);
    const before = attackTimings(tuning, HAMMER, 'Overhead');
    const after = attackTimings(slow, HAMMER, 'Overhead');
    expect(stretched.release - base.release).toBe(after.windUpEnd - before.windUpEnd);
    expect(stretched.recovery - base.recovery).toBe(after.releaseEnd - before.releaseEnd);
    expect(stretched.idle - base.idle).toBe(after.end - before.end);
  });
});
