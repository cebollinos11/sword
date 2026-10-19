/**
 * Placeholder sounds, synthesised with WebAudio (no binary assets):
 *  - Swing: a band-passed noise whoosh sweeping upwards;
 *  - Block: a metallic clang of inharmonic partials over a low thud, with a beating ring and a scrape, scaled by the blow's strength;
 *  - Hit: a low thump with a dull noise burst, scaled by the Hit's strength;
 *  - Land: a deep thud on wooden boards, scaled by the height of the drop;
 *  - Throw: a short, high whoosh (a dagger leaving the hand);
 *  - Clink: a quiet, high ting (a dagger Blocked);
 *  - Thunk: a dry knock (a dagger stuck in wood);
 *  - WallStrike: a dull knock with a short, damped ring (a blade stopped by a Wall).
 * Browser-only; never imported by the Simulation.
 */
import type { Direction } from '../sim';
import type { BlockCue, ClinkCue, HitCue, LandCue, SoundCue, SwingCue, ThrowCue, ThunkCue, WallStrikeCue } from './cues';
import type { SoundPlayer } from './listener';

const MASTER_GAIN = 0.5;

/** Small per-Direction pitch shift so the four swings are distinguishable. */
const SWING_PITCH: Record<Direction, number> = { Overhead: 1, Left: 1.12, Right: 0.92, Thrust: 1.35 };

export class WebAudioPlayer implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /**
   * Browsers keep audio suspended until a user gesture. Resume on the first
   * pointer or key press on `target` (and create the context lazily).
   */
  unlockOn(target: EventTarget): void {
    const unlock = () => void this.context()?.resume();
    for (const type of ['pointerdown', 'keydown'] as const) target.addEventListener(type, unlock, { passive: true });
  }

  play(cue: SoundCue): void {
    const ctx = this.context();
    if (!ctx || ctx.state !== 'running') return;
    switch (cue.sound) {
      case 'Swing':
        return this.swing(ctx, cue);
      case 'Block':
        return this.block(ctx, cue);
      case 'Hit':
        return this.hit(ctx, cue);
      case 'Land':
        return this.land(ctx, cue);
      case 'Throw':
        return this.throwDagger(ctx, cue);
      case 'Clink':
        return this.clink(ctx, cue);
      case 'Thunk':
        return this.thunk(ctx, cue);
      case 'WallStrike':
        return this.wallStrike(ctx, cue);
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === 'undefined') return null;
    const ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(ctx.destination);
    // One second of white noise, reused by every noise-based sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    return ctx;
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  /** An envelope: silent → `peak` in `attack` s → exponential decay to silence by `end` s. */
  private envelope(ctx: AudioContext, peak: number, attack: number, end: number): GainNode {
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + end);
    g.connect(this.master!);
    return g;
  }

  private swing(ctx: AudioContext, cue: SwingCue): void {
    const t = ctx.currentTime;
    const pitch = SWING_PITCH[cue.direction];
    const duration = 0.22;
    const src = this.noiseSource(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(350 * pitch, t);
    band.frequency.exponentialRampToValueAtTime(2200 * pitch, t + duration * 0.7);
    band.frequency.exponentialRampToValueAtTime(900 * pitch, t + duration);
    src.connect(band).connect(this.envelope(ctx, 0.7, duration * 0.6, duration));
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  private block(ctx: AudioContext, cue: BlockCue): void {
    const t = ctx.currentTime;
    const s = cue.strength;
    // No two clangs alike: each blow detunes the steel a little.
    const pitch = 0.94 + Math.random() * 0.12;
    // A harder blow rings longer.
    const duration = 0.35 + 0.55 * s;
    const out = this.envelope(ctx, 0.2 + 0.25 * s, 0.003, duration);
    for (const [freq, level] of [
      [1180, 1],
      [1870, 0.7],
      [2630, 0.5],
      [3410, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * pitch;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }
    // Two partials a few hertz apart beat against each other: the shimmer of a ringing blade.
    for (const freq of [742, 747]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * pitch;
      osc.connect(this.envelope(ctx, 0.12 * s, 0.01, duration * 1.4));
      osc.start(t);
      osc.stop(t + duration * 1.4 + 0.02);
    }
    // The weight of the blow through the arms: a short, low thud.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(150, t);
    body.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    body.connect(this.envelope(ctx, 0.75 * s, 0.002, 0.16));
    body.start(t);
    body.stop(t + 0.18);
    // A sharp click for the moment of impact.
    const click = this.noiseSource(ctx);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3000;
    click.connect(high).connect(this.envelope(ctx, 0.35 + 0.35 * s, 0.002, 0.05));
    click.start(t);
    click.stop(t + 0.07);
    // Steel grinding on steel as the blades slide apart.
    const scrape = this.noiseSource(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 6;
    band.frequency.setValueAtTime(5200 * pitch, t);
    band.frequency.exponentialRampToValueAtTime(2600 * pitch, t + 0.16);
    scrape.connect(band).connect(this.envelope(ctx, 0.25 * s, 0.01, 0.18));
    scrape.start(t);
    scrape.stop(t + 0.2);
  }

  private throwDagger(ctx: AudioContext, _cue: ThrowCue): void {
    const t = ctx.currentTime;
    const duration = 0.14;
    const src = this.noiseSource(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 4;
    band.frequency.setValueAtTime(1800, t);
    band.frequency.exponentialRampToValueAtTime(5200, t + duration);
    src.connect(band).connect(this.envelope(ctx, 0.45, duration * 0.4, duration));
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  private clink(ctx: AudioContext, _cue: ClinkCue): void {
    const t = ctx.currentTime;
    const duration = 0.22;
    const out = this.envelope(ctx, 0.2, 0.002, duration);
    for (const [freq, level] of [
      [2400, 1],
      [3650, 0.5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }
  }

  private thunk(ctx: AudioContext, _cue: ThunkCue): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    osc.connect(this.envelope(ctx, 0.5, 0.002, 0.11));
    osc.start(t);
    osc.stop(t + 0.12);
  }

  private wallStrike(ctx: AudioContext, cue: WallStrikeCue): void {
    const t = ctx.currentTime;
    const s = cue.strength;
    // The knock of the blow on stone or wood.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    osc.connect(this.envelope(ctx, 0.7 * s, 0.002, 0.14));
    osc.start(t);
    osc.stop(t + 0.16);
    // The blade answering: a short, damped ring.
    for (const [freq, level] of [
      [940, 1],
      [1530, 0.5],
    ] as const) {
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      ring.connect(g).connect(this.envelope(ctx, 0.18 * s, 0.003, 0.18));
      ring.start(t);
      ring.stop(t + 0.2);
    }
  }

  private land(ctx: AudioContext, cue: LandCue): void {
    const t = ctx.currentTime;
    const s = cue.strength;
    // A deep thud: the body on the boards.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    osc.connect(this.envelope(ctx, 0.8 * s, 0.006, 0.3));
    osc.start(t);
    osc.stop(t + 0.32);
    // The wood answering: a short, dark knock.
    const knock = this.noiseSource(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.value = 260 + 220 * s;
    knock.connect(band).connect(this.envelope(ctx, 0.7 * s, 0.003, 0.16));
    knock.start(t);
    knock.stop(t + 0.18);
  }

  private hit(ctx: AudioContext, cue: HitCue): void {
    const t = ctx.currentTime;
    const s = cue.strength;
    // Low thump with a falling pitch.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cue.zone === 'head' ? 170 : 130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    osc.connect(this.envelope(ctx, 0.9 * s, 0.004, 0.22));
    osc.start(t);
    osc.stop(t + 0.25);
    // Dull, muffled noise burst: the cut.
    const burst = this.noiseSource(ctx);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900 + 1400 * s;
    burst.connect(low).connect(this.envelope(ctx, 0.6 * s, 0.003, 0.12));
    burst.start(t);
    burst.stop(t + 0.14);
  }
}
