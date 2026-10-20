import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, hashValue } from '../sim';
import { LocalController } from '../controllers';
import { LIVE_SCRUB_CHUNK, liveScrubMax, matchSandbox, playerVsAiSession } from './sandboxSession';
import { compareReplay, recordingSandbox, recordReplay } from './replay';
import { withArena } from './arenaLab';

const tuning = loadTuningData();
const options = { opponent: 'Normal', bestOf: 3, seed: 4 };

/** A scripted stand-in for the human: raw input fed to a real Local Controller just before given Ticks are decided. */
type Input = (local: LocalController) => void;
type InputScript = Readonly<Record<number, Input>>;

const swing: InputScript = {
  220: (l) => {
    l.mouseMove(-20, 0); // gesture: Left
    l.buttonDown('attack');
  },
  222: (l) => l.buttonUp('attack'),
  300: (l) => l.keyDown('KeyW'),
  330: (l) => l.keyUp('KeyW'),
};

function play(session: ReturnType<typeof playerVsAiSession>, local: LocalController, script: InputScript, until: number): void {
  while (session.cursor < until && !session.over) {
    script[session.cursor]?.(local);
    session.advance();
  }
}

describe('Sandbox session: Player vs AI (live)', () => {
  it('is not precomputed: the frontier grows one Tick per Tick played', () => {
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, options);
    expect(session.frontier).toBe(0);
    play(session, local, {}, 50);
    expect(session.frontier).toBe(50);
    expect(session.state.duel.fighters).toHaveLength(2);
  });

  it('the player drives Fighter 0', () => {
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, options);
    play(session, local, { 10: (l) => l.buttonDown('attack') }, 12);
    expect(session.state.duel.fighters[0]!.action).toMatchObject({ kind: 'Attack', direction: 'Overhead', phase: 'Wind-up' });
  });

  it('scrubbing back and playing differently branches, with the AI restored to that Tick', () => {
    // First take: the player stands still for 400 Ticks.
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, options);
    play(session, local, {}, 400);
    const firstTake = session.history.map((s) => hashValue(s));

    // Scrub back to 200 and retake: this time the player swings and walks in.
    session.seek(200);
    play(session, local, swing, 221);
    expect(session.frontier).toBe(221); // the old future is dropped at the first different Intent
    expect(hashValue(session.history[221])).not.toBe(firstTake[221]);
    play(session, local, swing, 600);
    expect(session.divergence).toBeNull();

    // The same input from a fresh start (fresh AI) gives exactly the retaken Match.
    const freshLocal = new LocalController();
    const fresh = playerVsAiSession(tuning, freshLocal, options);
    play(fresh, freshLocal, swing, 600);
    expect(session.history.map((s) => hashValue(s))).toEqual(fresh.history.map((s) => hashValue(s)));
    expect(session.history.slice(0, 201).map((s) => hashValue(s))).toEqual(firstTake.slice(0, 201));
  });

  it('playing the same Intents again after a scrub keeps the recorded future', () => {
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, options);
    play(session, local, {}, 300);
    session.seek(100);
    play(session, local, {}, 150);
    expect(session.frontier).toBe(300);
    expect(session.divergence).toBeNull();
  });
});

describe('Player vs AI golden replay', () => {
  it('a recorded live run, branch included, replays identically without the player or the AI', () => {
    const local = new LocalController();
    const recorder = recordingSandbox(matchSandbox(tuning));
    const session = playerVsAiSession(tuning, local, options, recorder);
    play(session, local, {}, 400);
    session.seek(200);
    play(session, local, swing, 600);
    const replay = recordReplay(tuning, session.history, recorder.intentsOf(session.history));
    expect(replay.ticks).toBe(600);
    expect(compareReplay(replay, tuning).identical).toBe(true);
  });
});

describe('liveScrubMax: the scrub slider range of a live run', () => {
  it('rounds the frontier up to whole chunks, so the slider is rebuilt only now and then', () => {
    expect(LIVE_SCRUB_CHUNK).toBe(600);
    expect(liveScrubMax(0)).toBe(600);
    expect(liveScrubMax(599)).toBe(600);
    expect(liveScrubMax(600)).toBe(600);
    expect(liveScrubMax(601)).toBe(1200);
  });
});

describe('Sandbox session: Player vs a test opponent', () => {
  it('a Wall opponent Blocks the player and is never hit', () => {
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, { ...options, opponent: 'Wall' });
    // Walk up to the Wall, then swing Left.
    play(session, local, { 150: (l) => l.keyDown('KeyW'), 360: (l) => l.keyUp('KeyW'), 380: swing[220]!, 382: swing[222]! }, 500);
    const events = session.history.flatMap((m) => m.duel.events);
    expect(events.some((e) => e.type === 'Block' && e.defender === 1)).toBe(true);
    expect(events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });

  it('a Dummy opponent never Blocks', () => {
    const local = new LocalController();
    const session = playerVsAiSession(tuning, local, { ...options, opponent: 'Dummy' });
    play(session, local, swing, 400);
    expect(session.history.some((m) => m.duel.events.some((e) => e.type === 'Block'))).toBe(false);
  });
});

describe('Sandbox session: Player vs AI on a Generated Arena (the Arena Lab)', () => {
  it('runs 600 Ticks there with no divergence, and replays them identically', () => {
    const { arena } = generateArena(GREYBOX_KIT, 7, DEFAULT_GEN_PARAMS, tuning);
    const lab = withArena(tuning, arena);
    const local = new LocalController();
    const recorder = recordingSandbox(matchSandbox(lab));
    const session = playerVsAiSession(lab, local, { ...options, opponent: 'Hard' }, recorder);
    expect(session.state.duel.arena).toBe(arena.name);
    play(session, local, swing, 600);
    expect(session.frontier).toBe(600);
    // Scrub back and play the same again: the recorded future is kept.
    session.seek(300);
    play(session, local, swing, 600);
    expect(session.divergence).toBeNull();
    expect(session.frontier).toBe(600);
    const replay = recordReplay(lab, session.history, recorder.intentsOf(session.history));
    expect(compareReplay(replay, lab).identical).toBe(true);
  });
});
