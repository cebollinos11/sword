/**
 * Placeholder sounds, synthesised with WebAudio (no binary assets):
 *  - Swing: a band-passed noise whoosh sweeping upwards;
 *  - Block: a metallic clang of inharmonic partials;
 *  - Hit: a low thump with a dull noise burst, scaled by the Hit's strength.
 * Browser-only; never imported by the Simulation.
 */
import type { Direction } from '../sim';
import type { BlockCue, HitCue, SoundCue, SwingCue } from './cues';
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

  private block(ctx: AudioContext, _cue: BlockCue): void {
    const t = ctx.currentTime;
    const duration = 0.45;
    const out = this.envelope(ctx, 0.35, 0.003, duration);
    for (const [freq, level] of [
      [1180, 1],
      [1870, 0.7],
      [2630, 0.5],
      [3410, 0.35],
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
    // A sharp click for the moment of impact.
    const click = this.noiseSource(ctx);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3000;
    click.connect(high).connect(this.envelope(ctx, 0.5, 0.002, 0.05));
    click.start(t);
    click.stop(t + 0.07);
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
