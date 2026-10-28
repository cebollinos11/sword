import { describe, expect, it } from 'vitest';
import { createMatch, IDLE_INTENT, stepMatch, TICK_RATE, type Intent, type MatchState } from '../sim';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { FinalBlowShot } from './finalBlow';

const base = loadTuningData();
// One Overhead decides a Duel (see the Match tests).
const tuning: TuningData = withWeapon(base, { damage: 10000 });
const camera = tuning.camera;

/** Fighter 0 taps Overheads from 1.3 m through a best-of-3; returns every Match Tick. */
function playMatch(): MatchState[] {
  let match = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: 1.3 });
  const states = [match];
  for (let t = 0; t < 5000 && match.status.status !== 'Over'; t++) {
    const tap: Intent = { ...IDLE_INTENT, attack: t % 2 === 0 };
    match = stepMatch(match, [tap, IDLE_INTENT], tuning);
    states.push(match);
  }
  return states;
}

/** The Match Tick each Duel ended on. */
function duelEnds(states: readonly MatchState[]): number[] {
  return states.filter((s, i) => i > 0 && s.duel.duel.status === 'Over' && states[i - 1]!.duel.duel.status === 'Fighting').map((s) => s.tick);
}

describe('Final Blow Shot', () => {
  const states = playMatch();
  const [firstEnd] = duelEnds(states);

  it('starts on the Tick the Duel ends, a lead before it, and plays slowed down', () => {
    const shot = new FinalBlowShot(camera);
    for (const s of states) {
      const playing = shot.record(s, 0);
      if (s.tick < firstEnd!) expect(playing).toBe(false);
      if (s.tick === firstEnd) break;
    }
    expect(shot.active).toBe(true);
    expect(shot.startTick).toBe(firstEnd! - Math.round(camera.finalBlowLead * TICK_RATE));
    const frame = shot.frame(1)!;
    // One wall second shows finalBlowSpeed seconds of the Duel (as far as recorded so far).
    expect(frame.to.tick - frame.from.tick).toBeLessThanOrEqual(1);
    expect(frame.from.duel.status).toBe('Fighting');
  });

  it('frames the fallen Fighter, and spins at finalBlowSpin', () => {
    const shot = new FinalBlowShot(camera);
    for (const s of states) {
      shot.record(s, 0);
      if (s.tick === firstEnd) break;
    }
    const a = shot.frame(0)!;
    const b = shot.frame(0.5)!;
    expect(b.yaw - a.yaw).toBeCloseTo(0.5 * camera.finalBlowSpin);
    const fallen = states.find((s) => s.tick === firstEnd)!.duel.fighters[1]!;
    expect(Math.hypot(a.centre.x - fallen.position.x, a.centre.z - fallen.position.z)).toBeLessThan(2);
  });

  it('hands out each Tick it replays once, in order, and ends after its tail', () => {
    const shot = new FinalBlowShot(camera);
    const reached: number[] = [];
    let ended = false;
    for (const s of states) {
      shot.record(s, 0);
      if (!shot.active) {
        if (s.tick > firstEnd!) ended = true;
        continue;
      }
      // Rendered at 60 fps while the live Match ticks at the same pace.
      const frame = shot.frame(1 / TICK_RATE);
      if (frame) reached.push(...frame.reached.map((m) => m.tick));
      if (s.tick > firstEnd! + 10 * TICK_RATE) break;
    }
    expect(ended).toBe(true);
    const start = firstEnd! - Math.round(camera.finalBlowLead * TICK_RATE);
    expect(reached[0]).toBe(start + 1);
    reached.forEach((t, i) => i > 0 && expect(t).toBe(reached[i - 1]! + 1));
    expect(reached.at(-1)).toBeLessThan(firstEnd! + Math.round(camera.finalBlowTail * TICK_RATE));
    expect(reached.at(-1)).toBeGreaterThan(firstEnd!);
  });

  it('plays once per Duel', () => {
    const shot = new FinalBlowShot(camera);
    let starts = 0;
    let was = false;
    for (const s of states) {
      const now = shot.record(s, 0);
      if (now && !was) starts++;
      was = now;
      shot.frame(1 / TICK_RATE);
      was = shot.active;
    }
    expect(starts).toBe(duelEnds(states).length);
  });

  it('plays on a Run’s Hall cleared (its Duel goes on), framing the last enemy to fall, once; a Rollback that undoes the clear cuts it', () => {
    let m = createMatch(base, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
    const idle = () => m.duel.fighters.map(() => IDLE_INTENT);
    const states: MatchState[] = [];
    for (let t = 0; t < 30; t++) states.push((m = stepMatch(m, idle(), base)));
    // Fell every enemy at once: the Hall is Cleared on the next Tick.
    const fighting = m;
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    for (let t = 0; t < 10 * TICK_RATE; t++) states.push((m = stepMatch(m, idle(), base)));
    const cleared = states.find((s) => s.run!.phase === 'Cleared')!;
    expect(cleared.duel.duel.status).toBe('Fighting');

    const shot = new FinalBlowShot(camera);
    let starts = 0;
    let was = false;
    for (const s of states) {
      const now = shot.record(s, 0);
      if (s.tick < cleared.tick) expect(now).toBe(false);
      if (now && !was) {
        starts++;
        expect(s.tick).toBe(cleared.tick);
        expect(shot.startTick).toBe(cleared.tick - Math.round(camera.finalBlowLead * TICK_RATE));
        const victim = cleared.duel.fighters.find((f) => f.team === 1 && !f.benched)!;
        const frame = shot.frame(0)!;
        expect(Math.hypot(frame.centre.x - victim.position.x, frame.centre.z - victim.position.z)).toBeLessThan(2);
      }
      shot.frame(1 / TICK_RATE);
      was = shot.active;
    }
    expect(starts).toBe(1);
    expect(shot.active).toBe(false);

    // A Rollback back to before the clear: the shot stops, and plays again when the clear comes back.
    const again = new FinalBlowShot(camera);
    for (const s of states.slice(0, 31)) again.record(s, 0);
    expect(again.record(cleared, 0)).toBe(true);
    expect(again.record({ ...fighting, tick: cleared.tick + 1 }, 0)).toBe(false);
    expect(again.record({ ...cleared, tick: cleared.tick + 2 }, 0)).toBe(true);
  });

  it('fits in the pause between Duels, so the next Duel never cuts it short', () => {
    const wall = (base.camera.finalBlowLead + base.camera.finalBlowTail) / base.camera.finalBlowSpeed;
    expect(wall).toBeLessThanOrEqual(base.match.interDuelSeconds);
  });
});
