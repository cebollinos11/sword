import { describe, expect, it } from 'vitest';
import { createMatch, doorTicksNeeded, IDLE_INTENT, stepMatch, TICK_RATE, type Intent, type MatchState } from '../sim';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { doorCutTicks, FinalBlowShot, shotIntent } from './finalBlow';

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

  it('plays again for a Team 0 wipe later in a Hall whose clear already had its shot', () => {
    let m = createMatch(base, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
    const idle = () => m.duel.fighters.map(() => IDLE_INTENT);
    const states: MatchState[] = [];
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    for (let t = 0; t < 6 * TICK_RATE; t++) states.push((m = stepMatch(m, idle(), base)));
    expect(m.run!.phase).toBe('Cleared');
    // The party falls (into lava, say) on the way to a Door: the Run is lost.
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 0 ? { ...f, hp: 0 } : f)) } };
    for (let t = 0; t < 2 * TICK_RATE; t++) states.push((m = stepMatch(m, idle(), base)));
    const wiped = states.find((s) => s.duel.duel.status === 'Over')!;
    // Every Fighter has fallen by now (a draw): Defeat all the same.
    expect(wiped.duelNumber).toBe(states[0]!.duelNumber);

    const shot = new FinalBlowShot(camera);
    const starts: number[] = [];
    let was = false;
    for (const s of states) {
      const now = shot.record(s, 0);
      if (now && !was) starts.push(s.tick);
      shot.frame(1 / TICK_RATE);
      was = shot.active;
    }
    expect(starts).toEqual([states.find((s) => s.run!.phase === 'Cleared')!.tick, wiped.tick]);
  });

  it('fits in the pause between Duels, so the next Duel never cuts it short', () => {
    const wall = (base.camera.finalBlowLead + base.camera.finalBlowTail) / base.camera.finalBlowSpeed;
    expect(wall).toBeLessThanOrEqual(base.match.interDuelSeconds);
  });
});

describe('Final Blow Shot in a Hall: the Player is held', () => {
  /** A Hall whose enemies fall on the first Tick, run on past its shot with `wish` as the Player's (Team 0 slot 0) Intent, filtered by the shot as the game loop does. */
  function hall(wish: Intent, seconds = 6, local = 0) {
    let m = createMatch(base, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, humans: local + 1, teams: local === 0 ? [0, 1, 1, 1, 1] : [0, 0, 1, 1, 1, 1] });
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    const shot = new FinalBlowShot(camera);
    const states: MatchState[] = [];
    const sent: Intent[] = [];
    const reached: number[] = [];
    const rest: number[] = [];
    // The Tick the Hall is Cleared on, the Player's wish not yet in play: the shot starts with it.
    m = stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), base);
    shot.record(m, 0, doorTicksNeeded(base));
    expect(shot.holdsInput).toBe(true);
    for (let t = 0; t < seconds * TICK_RATE; t++) {
      const intent = shotIntent(shot, wish);
      sent.push(intent);
      m = stepMatch(m, m.duel.fighters.map((_, i) => (i === local ? intent : IDLE_INTENT)), base);
      states.push(m);
      shot.record(m, 0, doorTicksNeeded(base));
      for (const r of shot.frame(1 / TICK_RATE)?.reached ?? []) reached.push(r.tick);
      if (!shot.active) for (const r of shot.takeRest()) rest.push(r.tick);
    }
    return { states, sent, reached, rest, shot };
  }

  const wish: Intent = { ...IDLE_INTENT, move: { x: 0, z: 1 }, attack: true, jump: true };

  it('sends no movement or action Intent while a Hall’s shot plays, and the Player’s own again after it', () => {
    const { sent } = hall(wish);
    const held = sent.filter((i) => i === IDLE_INTENT).length;
    expect(held).toBeGreaterThan(0);
    expect(sent.filter((i) => i === wish)).toHaveLength(sent.length - held);
    // The held Ticks are one run, from the clear; the Player's wish follows once the shot is over.
    expect(sent.lastIndexOf(IDLE_INTENT) - sent.indexOf(IDLE_INTENT) + 1).toBe(held);
    expect(sent.at(-1)).toBe(wish);
  });

  it('holds the local Player when it is Fighter 1, whose Intent the session sends like any other', () => {
    const { sent, states } = hall(wish, 6, 1);
    expect(sent.filter((i) => i === IDLE_INTENT).length).toBeGreaterThan(0);
    expect(sent.at(-1)).toBe(wish);
    // Held, Fighter 1 stays where it stood; once released it walks.
    const lastHeld = sent.lastIndexOf(IDLE_INTENT);
    const start = states[0]!.duel.fighters[1]!.position;
    expect(states[lastHeld]!.duel.fighters[1]!.position).toEqual(start);
    expect(states.at(-1)!.duel.fighters[1]!.position).not.toEqual(start);
  });

  it('keeps the Player where it stood while held: the Simulation sees the same as from a Player who does nothing', () => {
    const still = hall(IDLE_INTENT);
    const walking = hall(wish);
    const lastHeld = walking.sent.lastIndexOf(IDLE_INTENT);
    expect(lastHeld).toBeGreaterThan(0);
    for (let i = 0; i <= lastHeld; i++) expect(walking.states[i]!.duel.fighters[0]).toEqual(still.states[i]!.duel.fighters[0]);
  });

  it('lets no Tick of the running Hall go unheard: the shot’s replay and what follows it cover them all', () => {
    const { reached, rest, shot, states } = hall(IDLE_INTENT);
    const heard = [...reached, ...rest];
    // Every Tick from the shot's start to the newest the shot saw is handed out once, in order.
    for (let i = 1; i < heard.length; i++) expect(heard[i]).toBe(heard[i - 1]! + 1);
    // Past the replay's end: the Ticks it never reached are in the rest.
    expect(rest.length).toBeGreaterThan(0);
    expect(heard.at(-1)).toBeLessThanOrEqual(states.at(-1)!.tick);
    expect(heard.at(-1)).toBeGreaterThan(reached.at(-1)!);
    expect(shot.takeRest()).toEqual([]);
  });

  it('ends before a Door can be taken while it plays, leaving the Player a moment to step out', () => {
    const needed = doorTicksNeeded(base);
    expect(doorCutTicks(needed)).toBeLessThan(needed);
    expect(doorCutTicks(1)).toBe(1);
    let m = createMatch(base, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    const shot = new FinalBlowShot(camera);
    let s = m;
    while (s.run!.phase !== 'Cleared') shot.record((s = stepMatch(s, s.duel.fighters.map(() => IDLE_INTENT), base)), 0, needed);
    expect(shot.active).toBe(true);
    // The party has stood in a Door's zone for most of the time it needs: the shot is cut, once.
    const gathering = { ...s, tick: s.tick + 1, run: { ...s.run!, doorTicks: [doorCutTicks(needed), 0] } };
    expect(shot.record(gathering, 0, needed)).toBe(false);
    expect(shot.holdsInput).toBe(false);
    expect(shot.frame(1 / TICK_RATE)).toBeNull();
    expect(shot.record({ ...gathering, tick: gathering.tick + 1 }, 0, needed)).toBe(false);
  });

  it('sounds the Ticks that run between a Door cut inside record() and the frame that notices the shot ended', () => {
    const needed = doorTicksNeeded(base);
    let m = createMatch(base, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    const shot = new FinalBlowShot(camera);
    const heard: number[] = [];
    const step = (s: MatchState) => stepMatch(s, s.duel.fighters.map(() => IDLE_INTENT), base);
    while (m.run!.phase !== 'Cleared') shot.record((m = step(m)), 0, needed);
    for (let i = 0; i < 20; i++) {
      shot.record((m = step(m)), 0, needed);
      for (const r of shot.frame(1 / TICK_RATE)?.reached ?? []) heard.push(r.tick);
    }
    expect(heard.length).toBeGreaterThan(0);
    // The door cut ends the shot inside record(); the loop runs three more Ticks before the render step's frame() returns null.
    let s = { ...m, tick: m.tick + 1, run: { ...m.run!, doorTicks: [doorCutTicks(needed), 0] } };
    const cutAt = s.tick;
    expect(shot.record(s, 0, needed)).toBe(false);
    for (let i = 0; i < 3; i++) shot.record((s = { ...step(s), run: s.run! }), 0, needed);
    expect(shot.frame(1 / TICK_RATE)).toBeNull();
    const rest = shot.takeRest().map((r) => r.tick);
    // Exactly once, in order, from after the last Tick the replay reached to the newest Tick run.
    expect(rest[0]).toBe(heard.at(-1)! + 1);
    expect(rest.at(-1)).toBe(s.tick);
    expect(s.tick).toBeGreaterThan(cutAt);
    for (let i = 1; i < rest.length; i++) expect(rest[i]).toBe(rest[i - 1]! + 1);
    expect(shot.takeRest()).toEqual([]);
    // Nothing is collected once taken.
    shot.record(step(s), 0, needed);
    expect(shot.takeRest()).toEqual([]);
  });

  it('leaves a Duel’s end outside a Run as it was: the Player is not held, nothing is left over', () => {
    const shot = new FinalBlowShot(camera);
    const intent: Intent = { ...IDLE_INTENT, attack: true };
    for (const s of playMatch()) {
      shot.record(s, 0, doorTicksNeeded(tuning));
      expect(shot.holdsInput).toBe(false);
      expect(shotIntent(shot, intent)).toBe(intent);
      shot.frame(1 / TICK_RATE);
      expect(shot.takeRest()).toEqual([]);
    }
  });
});
