import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attack, createMatch, hold, IDLE_INTENT, runDuel, stepMatch, type MatchState, type SimEvent } from '../sim';
import type { SoundCue } from './cues';
import { SimAudio } from './listener';

const tuning = loadTuningData();

/** A SoundPlayer that records what it was asked to play. */
function recorder() {
  const played: SoundCue['sound'][] = [];
  return { played, play: (cue: SoundCue) => played.push(cue.sound) };
}

const swingEvent: SimEvent = { type: 'AttackPhase', fighter: 0, direction: 'Overhead', phase: 'Release' };

describe('SimAudio', () => {
  it('plays the sounds of every Tick a loop steps through', () => {
    const player = recorder();
    const audio = new SimAudio(player);
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    for (const s of run.states) audio.onTick(s.tick, s.events);
    expect(player.played).toEqual(['Swing', 'Block']);
  });

  it('plays a Tick only once, even if it is simulated again (rollback re-simulation)', () => {
    const player = recorder();
    const audio = new SimAudio(player);
    audio.onTick(10, [swingEvent]);
    audio.onTick(8, []);
    audio.onTick(9, []);
    audio.onTick(10, [swingEvent]);
    audio.onTick(11, [swingEvent]);
    expect(player.played).toEqual(['Swing', 'Swing']);
  });

  it('after a seek (scrub, restart, new Duel), plays the Ticks that follow it', () => {
    const player = recorder();
    const audio = new SimAudio(player);
    audio.onTick(50, [swingEvent]);
    audio.seek(0);
    audio.onTick(1, [swingEvent]);
    expect(player.played).toEqual(['Swing', 'Swing']);
  });

  it('in a Match, plays the swings and Hits of every Duel, though each Duel counts its Ticks from 0', () => {
    const decisive: TuningData = { ...tuning, weapon: { ...tuning.weapon, damage: 10_000 } };
    const player = recorder();
    const audio = new SimAudio(player);
    let m: MatchState = createMatch(decisive, { bestOf: 3, distance: 1.3, interDuelTicks: 30 });
    // Fighter 0 taps attack (holding would freeze the Wind-up) until the Match is over: two Duels.
    while (m.status.status !== 'Over' && m.tick < 3000) {
      const intents = [m.tick % 2 === 0 ? { ...IDLE_INTENT, attack: true } : IDLE_INTENT];
      m = stepMatch(m, intents, decisive);
      audio.onMatchTick(m);
    }
    expect(m.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(player.played.filter((s) => s === 'Hit')).toHaveLength(2);
  });

  it('is silent while muted', () => {
    const player = recorder();
    const audio = new SimAudio(player);
    audio.muted = true;
    audio.onTick(1, [swingEvent]);
    expect(player.played).toEqual([]);
  });
});
