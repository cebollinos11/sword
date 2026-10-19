/**
 * The game's sounds, synthesised with WebAudio. Every synthesised sound is layered from a
 * few primitives (enveloped tones, filtered noise, and the inharmonic ring of struck metal) and
 * varies a little in pitch and colour each time it plays, so repeated blows never sound canned:
 *  - Swing: a whoosh, deeper and longer for a heavier Weapon, panned across the swing's path;
 *  - Block: steel on steel: a sharp crack, then a ringing, beating clang;
 *  - Hit: a thud with a cut for a blade's edge, a blunt whack for a shaft, a punch for a Kick;
 *  - Chamber: a double clash and a blade sliding along a blade;
 *  - Feint, Kick, Jump: a flick, a snap and a push of air;
 *  - Knockdown, BodyFall, Land: bodies and feet on the Arena's floor (wood, stone, metal, snow);
 *  - Death: a deep, final boom and a body falling; a hiss in Lava; a splash in Water;
 *  - Throw, Clink, Thunk: a spinning dagger, a dagger turned aside, a dagger stuck;
 *  - WallStrike: a blade knocking on a Wall and ringing;
 *  - DuelStart, DuelEnd, MatchEnd: blades drawn and war drums, a gong, a fanfare.
 * Where a recorded stock clip fits a cue (see `stockFor`), that plays instead once it has loaded.
 * Everything passes through a small room reverb and a compressor. In slow motion (`setSpeed`)
 * sounds deepen and stretch, and the room grows. Browser-only; never imported by the Simulation.
 */
import type { Direction } from '../sim';
import type {
  BlockCue,
  BodyFallCue,
  DeathCue,
  DuelStartCue,
  HitCue,
  LandCue,
  SoundCue,
  Surface,
  SwingCue,
  ThunkCue,
  WallStrikeCue,
} from './cues';
import type { SoundPlayer } from './listener';
import { STOCK_CLIPS, stockFile, stockFor, type StockClip, type StockPlay } from './stock';

const MASTER_GAIN = 0.55;
/** Seconds the gong or fanfare waits after the blow that ended the Duel, so the Death boom is heard first. */
const ENDING_DELAY = 0.55;
/** Seconds of the room's reverb tail. */
const ROOM_SECONDS = 1.8;

/** Per-Direction pitch, so the four swings are distinguishable. */
const SWING_PITCH: Record<Direction, number> = { Overhead: 1, Left: 1.1, Right: 0.93, Thrust: 1.3 };
/** Where (-1 left … 1 right) a swing starts and ends in the stereo field. */
const SWING_PAN: Record<Direction, readonly [number, number]> = { Overhead: [0, 0], Left: [-0.6, 0.6], Right: [0.6, -0.6], Thrust: [0, 0] };

/** Partials of a struck metal bar (frequency ratio, level, decay seconds): inharmonic, the high ones dying first. */
const STEEL: readonly (readonly [number, number, number])[] = [
  [1, 1, 0.9],
  [2.76, 0.6, 0.55],
  [5.4, 0.4, 0.3],
  [8.93, 0.25, 0.16],
];
/** Partials of a gong. */
const GONG: readonly (readonly [number, number, number])[] = [
  [1, 1, 3.2],
  [1.47, 0.7, 2.6],
  [1.98, 0.55, 2.2],
  [2.44, 0.4, 1.7],
  [2.99, 0.3, 1.3],
  [3.68, 0.2, 0.9],
];

/** A random factor within ±`amount` of 1. */
const vary = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** An enveloped oscillator. Times are seconds after the sound starts. */
interface ToneSpec {
  readonly type?: OscillatorType;
  readonly freq: number;
  /** Glide to this frequency by the end. */
  readonly to?: number;
  /** Seconds to glide over (default: the whole duration). */
  readonly glide?: number;
  readonly at?: number;
  readonly dur: number;
  readonly peak: number;
  readonly attack?: number;
}

/** An enveloped burst of filtered noise. */
interface HissSpec {
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly to?: number;
  readonly q?: number;
  readonly at?: number;
  readonly dur: number;
  readonly peak: number;
  readonly attack?: number;
  /** Flutter the level this many times a second (a spinning dagger, a sizzle). */
  readonly flutter?: number;
}

/** The ring of struck metal: `partials` over `base` Hz, each decaying on its own. */
interface RingSpec {
  readonly base: number;
  readonly partials: readonly (readonly [number, number, number])[];
  readonly at?: number;
  readonly peak: number;
  /** Scale every partial's decay. */
  readonly decay?: number;
  readonly attack?: number;
}

export class WebAudioPlayer implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private dry: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Loaded stock clips by file, and the variant of each clip set played last (so it is not played twice running). */
  private readonly clips = new Map<string, AudioBuffer>();
  private readonly lastVariant = new Map<StockClip, number>();
  /** How much longer (≥ 1) and deeper (≤ 1) sounds play in slow motion, and how much more of the room is heard. */
  private stretch = 1;
  private deepen = 1;
  private roomBoost = 1;

  /**
   * Browsers keep audio suspended until a user gesture. Resume on the first
   * pointer or key press on `target` (and create the context lazily).
   */
  unlockOn(target: EventTarget): void {
    const unlock = () => void this.context()?.resume();
    for (const type of ['pointerdown', 'keydown'] as const) target.addEventListener(type, unlock, { passive: true });
  }

  setSpeed(speed: number): void {
    const slow = Math.min(4, Math.max(1, 1 / Math.max(speed, 0.01)));
    this.stretch = slow ** 0.6;
    this.deepen = slow ** -0.35;
    this.roomBoost = 1 + (slow - 1) * 0.6;
  }

  play(cue: SoundCue): void {
    const ctx = this.context();
    if (!ctx || ctx.state !== 'running') return;
    const stock = stockFor(cue);
    if (stock && this.clip(cue, stock)) return;
    switch (cue.sound) {
      case 'Swing':
        return this.swing(cue);
      case 'Block':
        return this.block(cue);
      case 'Hit':
        return this.hit(cue);
      case 'Chamber':
        return this.chamber();
      case 'Feint':
        return this.feint();
      case 'Kick':
        return this.kick();
      case 'Knockdown':
        return this.knockdown();
      case 'BodyFall':
        return this.bodyFall(cue);
      case 'Jump':
        return this.jump(cue.surface);
      case 'Land':
        return this.land(cue);
      case 'Death':
        return this.death(cue);
      case 'Throw':
        return this.throwDagger();
      case 'Clink':
        return this.clink();
      case 'Thunk':
        return this.thunk(cue);
      case 'WallStrike':
        return this.wallStrike(cue);
      case 'DuelStart':
        return this.duelStart(cue);
      case 'DuelEnd':
        return this.gong(ENDING_DELAY, 1);
      case 'MatchEnd':
        return this.fanfare(ENDING_DELAY);
    }
  }

  // --- The graph ---------------------------------------------------------------------------

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === 'undefined') return null;
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    comp.connect(master).connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(comp);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx);
    this.reverb.connect(comp);
    // Three seconds of white noise, read from a random offset by every noise-based sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.loadClips(ctx);
    return ctx;
  }

  /** Fetch every stock clip once (a few hundred kB); until one arrives its cues are synthesised. */
  private loadClips(ctx: AudioContext): void {
    for (const [clip, set] of Object.entries(STOCK_CLIPS) as [StockClip, (typeof STOCK_CLIPS)[StockClip]][]) {
      for (let n = 0; n < set.count; n++) {
        const file = stockFile(clip, n);
        fetch(`${import.meta.env.BASE_URL}${file}`)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${file}: ${res.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .then((buffer) => this.clips.set(file, buffer))
          .catch((err) => console.warn('Stock sound not loaded:', err));
      }
    }
  }

  /** Plays a stock clip for `cue`; false when it has not loaded (the cue is then synthesised). */
  private clip(cue: SoundCue, s: StockPlay): boolean {
    const ctx = this.ctx!;
    const set = STOCK_CLIPS[s.clip];
    let variant = s.variant;
    if (variant === undefined) {
      const last = this.lastVariant.get(s.clip);
      variant = Math.floor(Math.random() * (set.count - (last === undefined || set.count < 2 ? 0 : 1)));
      if (last !== undefined && set.count >= 2 && variant >= last) variant++;
    }
    const buffer = this.clips.get(stockFile(s.clip, variant));
    if (!buffer) return false;
    this.lastVariant.set(s.clip, variant);
    const rate = s.rate * vary(0.04) * this.deepen;
    const pan = cue.sound === 'Swing' ? SWING_PAN[cue.direction] : 0;
    const out = this.bus(s.wet, s.level * set.level, pan, buffer.duration / rate / this.stretch);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(out);
    src.start(ctx.currentTime + s.at * this.stretch);
    return true;
  }

  /**
   * Where one sound's layers go: straight out, and `wet` of it into the room. `pan` places it
   * (-1 left … 1 right), or sweeps it from the first to the second over `panDur` seconds.
   */
  private bus(wet: number, level = 1, pan: number | readonly [number, number] = 0, panDur = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = level;
    let out: AudioNode = g;
    const [from, to] = typeof pan === 'number' ? [pan, pan] : pan;
    if (from !== 0 || to !== 0) {
      const p = ctx.createStereoPanner();
      const t = ctx.currentTime;
      p.pan.setValueAtTime(from, t);
      p.pan.linearRampToValueAtTime(to, t + panDur * this.stretch);
      g.connect(p);
      out = p;
    }
    out.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = Math.min(1, wet * this.roomBoost);
    out.connect(send).connect(this.reverb!);
    return g;
  }

  /** A gain enveloped from silence to `peak` in `attack` s, then decaying to silence by `dur` s. */
  private envelope(dest: AudioNode, at: number, dur: number, peak: number, attack: number): GainNode {
    const g = this.ctx!.createGain();
    const t = this.ctx!.currentTime + at * this.stretch;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack * this.stretch);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * this.stretch);
    g.connect(dest);
    return g;
  }

  private tone(dest: AudioNode, s: ToneSpec): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (s.at ?? 0) * this.stretch;
    const osc = ctx.createOscillator();
    osc.type = s.type ?? 'sine';
    osc.frequency.setValueAtTime(s.freq * this.deepen, t);
    if (s.to !== undefined) osc.frequency.exponentialRampToValueAtTime(s.to * this.deepen, t + (s.glide ?? s.dur) * this.stretch);
    osc.connect(this.envelope(dest, s.at ?? 0, s.dur, s.peak, s.attack ?? 0.003));
    osc.start(t);
    osc.stop(t + s.dur * this.stretch + 0.05);
  }

  private hiss(dest: AudioNode, s: HissSpec): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (s.at ?? 0) * this.stretch;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = s.filter;
    f.Q.value = s.q ?? 1;
    f.frequency.setValueAtTime(s.freq * this.deepen, t);
    if (s.to !== undefined) f.frequency.exponentialRampToValueAtTime(s.to * this.deepen, t + s.dur * this.stretch);
    let node: AudioNode = src.connect(f);
    if (s.flutter) {
      // Amplitude flutter: a square-ish LFO swinging the level between about 0.2 and 1.
      const am = ctx.createGain();
      am.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = s.flutter / this.stretch;
      const depth = ctx.createGain();
      depth.gain.value = 0.4;
      lfo.connect(depth).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + s.dur * this.stretch + 0.05);
      node = node.connect(am);
    }
    node.connect(this.envelope(dest, s.at ?? 0, s.dur, s.peak, s.attack ?? 0.003));
    src.start(t, Math.random() * 2);
    src.stop(t + s.dur * this.stretch + 0.05);
  }

  private ring(dest: AudioNode, s: RingSpec): void {
    for (const [ratio, level, decay] of s.partials) {
      // Each partial a touch out of tune with the next blow's, and doubled slightly detuned so it beats like real steel.
      const freq = s.base * ratio * vary(0.01);
      const dur = decay * (s.decay ?? 1);
      this.tone(dest, { type: 'sine', freq, at: s.at, dur, peak: s.peak * level, attack: s.attack ?? 0.002 });
      this.tone(dest, { type: 'sine', freq: freq * 1.007, at: s.at, dur: dur * 0.8, peak: s.peak * level * 0.5, attack: s.attack ?? 0.002 });
    }
  }

  // --- Blades ------------------------------------------------------------------------------

  private swing(cue: SwingCue): void {
    const w = cue.weight;
    const pitch = SWING_PITCH[cue.direction] * (1 - 0.35 * w) * vary(0.06);
    const dur = (cue.direction === 'Thrust' ? 0.16 : 0.22) + 0.14 * w;
    const out = this.bus(0.12, 1.7, SWING_PAN[cue.direction], dur);
    // The body of the whoosh: broad, rising as the blade speeds up and falling away.
    this.hiss(out, { filter: 'bandpass', freq: 300 * pitch, to: 1500 * pitch, q: 1.6, dur, peak: 0.55 + 0.2 * w, attack: dur * 0.55 });
    // The edge cutting air: a narrow whistle, stronger on a light blade.
    this.hiss(out, { filter: 'bandpass', freq: 1400 * pitch, to: 3800 * pitch, q: 9, dur: dur * 0.9, peak: 0.35 * (1 - 0.6 * w), attack: dur * 0.6 });
    // A heavy Weapon pushes a low rush of air.
    if (w > 0.3) this.hiss(out, { filter: 'lowpass', freq: 260, to: 520, q: 0.8, dur: dur * 1.1, peak: 0.5 * w, attack: dur * 0.5 });
  }

  private block(cue: BlockCue): void {
    const s = cue.strength;
    const out = this.bus(0.35, 0.55 + 0.45 * s);
    const base = (760 - 200 * cue.weight) * vary(0.08);
    // The crack of contact.
    this.hiss(out, { filter: 'highpass', freq: 3500, q: 0.7, dur: 0.035, peak: 0.9, attack: 0.001 });
    this.hiss(out, { filter: 'bandpass', freq: 2200 * vary(0.1), q: 2, dur: 0.07, peak: 0.6, attack: 0.001 });
    // The steel ringing on: two blades, not quite the same note.
    this.ring(out, { base, partials: STEEL, peak: 0.22, decay: 0.6 + 0.6 * s });
    this.ring(out, { base: base * 1.31 * vary(0.03), partials: STEEL, peak: 0.12, decay: 0.5 + 0.4 * s });
    // The weight of the blow through the arms.
    this.tone(out, { freq: 190, to: 80, dur: 0.1, peak: 0.45 * s });
  }

  private hit(cue: HitCue): void {
    const s = cue.strength;
    const out = this.bus(0.18, 0.9 + 0.5 * s);
    const p = vary(0.08);
    switch (cue.by) {
      case 'Edge':
      case 'Dagger': {
        const small = cue.by === 'Dagger' ? 0.75 : 1;
        // The cut: a wet, tearing slice.
        this.hiss(out, { filter: 'bandpass', freq: 3800 * p, to: 900 * p, q: 1.4, dur: 0.12 * small, peak: 0.8 * small, attack: 0.002 });
        this.hiss(out, { filter: 'bandpass', freq: 650 * p, q: 2.2, at: 0.01, dur: 0.16, peak: 0.55 * s, attack: 0.004, flutter: 38 });
        // The body taking it.
        this.tone(out, { freq: (cue.zone === 'head' ? 160 : 120) * p, to: 42, dur: 0.24, peak: 0.95 * s, attack: 0.003 });
        break;
      }
      case 'Shaft':
        // A blunt, wooden whack.
        this.hiss(out, { filter: 'bandpass', freq: 900 * p, q: 3, dur: 0.06, peak: 0.8, attack: 0.001 });
        this.tone(out, { type: 'triangle', freq: 230 * p, to: 90, dur: 0.12, peak: 0.6 * s });
        this.tone(out, { freq: 110 * p, to: 45, dur: 0.22, peak: 0.85 * s });
        break;
      case 'Kick':
        // A punch to the body: a slap of cloth and a deep thump.
        this.hiss(out, { filter: 'highpass', freq: 1600, q: 0.7, dur: 0.045, peak: 0.6, attack: 0.001 });
        this.hiss(out, { filter: 'lowpass', freq: 500, q: 1, dur: 0.14, peak: 0.8, attack: 0.002 });
        this.tone(out, { freq: 95 * p, to: 38, dur: 0.26, peak: 1, attack: 0.002 });
        break;
    }
    // A blow to the head cracks.
    if (cue.zone === 'head') this.hiss(out, { filter: 'bandpass', freq: 1800 * p, q: 5, dur: 0.05, peak: 0.6 * s, attack: 0.001 });
    // A heavy blow lands with a sub-bass punch.
    if (s > 0.55) this.tone(out, { freq: 58, to: 32, dur: 0.35, peak: 0.9 * (s - 0.4), attack: 0.004 });
  }

  private chamber(): void {
    const out = this.bus(0.45, 1);
    const base = 980 * vary(0.06);
    // Two clashes, a heartbeat apart: the counter meeting the blow and turning it.
    this.hiss(out, { filter: 'highpass', freq: 3500, q: 0.7, dur: 0.035, peak: 0.9, attack: 0.001 });
    this.ring(out, { base, partials: STEEL, peak: 0.2, decay: 1.1 });
    this.hiss(out, { filter: 'highpass', freq: 4200, q: 0.7, at: 0.07, dur: 0.03, peak: 0.6, attack: 0.001 });
    this.ring(out, { base: base * 1.5, partials: STEEL, at: 0.07, peak: 0.16, decay: 1.3 });
    // The blade sliding along the other's edge.
    this.hiss(out, { filter: 'bandpass', freq: 2800, to: 7500, q: 7, at: 0.05, dur: 0.38, peak: 0.45, attack: 0.08, flutter: 55 });
  }

  private feint(): void {
    const out = this.bus(0.05, 1);
    this.hiss(out, { filter: 'bandpass', freq: 900 * vary(0.1), to: 500, q: 1.5, dur: 0.09, peak: 0.6, attack: 0.02 });
  }

  private wallStrike(cue: WallStrikeCue): void {
    const s = cue.strength;
    const out = this.bus(0.3, 0.5 + 0.5 * s);
    this.knock(out, cue.surface, s);
    // The blade answering: a short, damped ring.
    this.ring(out, { base: 880 * vary(0.06), partials: STEEL, peak: 0.12 * s, decay: 0.35 });
  }

  // --- Bodies and feet ---------------------------------------------------------------------

  private kick(): void {
    const out = this.bus(0.08, 1.2);
    this.hiss(out, { filter: 'bandpass', freq: 240 * vary(0.08), to: 750, q: 1.3, dur: 0.17, peak: 0.6, attack: 0.09 });
    this.hiss(out, { filter: 'highpass', freq: 2500, q: 0.7, dur: 0.07, peak: 0.15, attack: 0.03 });
  }

  private knockdown(): void {
    const out = this.bus(0.2, 1);
    // Driven off the feet: a heavy shove and a scuff.
    this.tone(out, { freq: 75, to: 36, dur: 0.35, peak: 0.8, attack: 0.004 });
    this.hiss(out, { filter: 'bandpass', freq: 1200, to: 400, q: 0.9, at: 0.05, dur: 0.3, peak: 0.25, attack: 0.03 });
  }

  private bodyFall(cue: BodyFallCue): void {
    const out = this.bus(0.25, 1);
    this.tone(out, { freq: 85 * vary(0.08), to: 34, dur: 0.38, peak: 0.95, attack: 0.005 });
    this.knock(out, cue.surface, 0.9);
    // Limbs and kit settling a moment later.
    this.knock(out, cue.surface, 0.35, 0.11);
  }

  private jump(surface: Surface): void {
    const out = this.bus(0.05, 0.6);
    this.footfall(out, surface, 0.6);
    this.hiss(out, { filter: 'bandpass', freq: 500, to: 1100, q: 1, dur: 0.18, peak: 0.3, attack: 0.05 });
  }

  private land(cue: LandCue): void {
    const s = cue.strength;
    const out = this.bus(0.2, 0.5 + 0.5 * s);
    this.footfall(out, cue.surface, 1);
    this.tone(out, { freq: 95 * vary(0.08), to: 36, dur: 0.22 + 0.15 * s, peak: 0.9 * s, attack: 0.005 });
    this.knock(out, cue.surface, s);
  }

  /** A foot coming down on `surface`. */
  private footfall(out: AudioNode, surface: Surface, level: number): void {
    const p = vary(0.15);
    switch (surface) {
      case 'wood':
        this.hiss(out, { filter: 'bandpass', freq: 520 * p, q: 2.5, dur: 0.06, peak: 0.9 * level, attack: 0.002 });
        this.tone(out, { freq: 150 * p, to: 90, dur: 0.07, peak: 0.6 * level });
        break;
      case 'stone':
        this.hiss(out, { filter: 'highpass', freq: 2400 * p, q: 0.8, dur: 0.04, peak: 0.6 * level, attack: 0.001 });
        this.tone(out, { freq: 110 * p, to: 70, dur: 0.06, peak: 0.6 * level });
        break;
      case 'metal':
        this.hiss(out, { filter: 'bandpass', freq: 1600 * p, q: 3, dur: 0.04, peak: 0.6 * level, attack: 0.001 });
        this.ring(out, { base: 340 * p, partials: STEEL, peak: 0.12 * level, decay: 0.18 });
        break;
      case 'snow':
        // A crunch: a few tiny grains of compacting snow.
        for (let i = 0; i < 5; i++) {
          this.hiss(out, { filter: 'bandpass', freq: (1800 + Math.random() * 2200) * p, q: 2, at: i * 0.016 + Math.random() * 0.01, dur: 0.03, peak: 0.6 * level, attack: 0.002 });
        }
        this.hiss(out, { filter: 'lowpass', freq: 700, q: 0.7, dur: 0.1, peak: 0.4 * level, attack: 0.005 });
        break;
    }
  }

  /** Something heavy striking `surface`: a knock in the floor's or Wall's own voice. */
  private knock(out: AudioNode, surface: Surface, s: number, at = 0): void {
    const p = vary(0.08);
    switch (surface) {
      case 'wood':
        this.tone(out, { type: 'triangle', freq: 210 * p, to: 95, at, dur: 0.14, peak: 0.6 * s });
        this.hiss(out, { filter: 'bandpass', freq: 300 * p, q: 3, at, dur: 0.16, peak: 0.7 * s, attack: 0.003 });
        break;
      case 'stone':
        this.tone(out, { freq: 160 * p, to: 65, at, dur: 0.12, peak: 0.6 * s });
        this.hiss(out, { filter: 'bandpass', freq: 1700 * p, q: 1.2, at, dur: 0.07, peak: 0.45 * s, attack: 0.002 });
        break;
      case 'metal':
        this.hiss(out, { filter: 'bandpass', freq: 1200 * p, q: 2, at, dur: 0.05, peak: 0.6 * s, attack: 0.001 });
        this.ring(out, { base: 190 * p, partials: STEEL, at, peak: 0.2 * s, decay: 0.5 });
        break;
      case 'snow':
        this.hiss(out, { filter: 'lowpass', freq: 600 * p, q: 0.8, at, dur: 0.18, peak: 0.7 * s, attack: 0.006 });
        break;
    }
  }

  private death(cue: DeathCue): void {
    switch (cue.cause) {
      case 'Hit':
      case 'Fall': {
        const out = this.bus(0.5, 1);
        // The final blow: a deep boom that the room carries, and a thin ringing in the ears.
        this.tone(out, { freq: 62, to: 28, dur: 1.4, peak: 1, attack: 0.008 });
        this.hiss(out, { filter: 'lowpass', freq: 900, to: 120, q: 0.9, dur: 0.9, peak: 0.6, attack: 0.01 });
        this.tone(out, { freq: 3150, dur: 1.8, peak: 0.035, attack: 0.25 });
        // The body crumpling a moment later.
        this.tone(out, { freq: 80, to: 32, at: 0.45, dur: 0.4, peak: 0.8, attack: 0.006 });
        this.hiss(out, { filter: 'bandpass', freq: 380, q: 1.5, at: 0.45, dur: 0.22, peak: 0.6, attack: 0.004 });
        break;
      }
      case 'Lava': {
        const out = this.bus(0.3, 1);
        // A whoomp of flame and a long, crackling hiss.
        this.hiss(out, { filter: 'lowpass', freq: 200, to: 1800, q: 1, dur: 0.6, peak: 0.9, attack: 0.05 });
        this.hiss(out, { filter: 'highpass', freq: 3000, to: 5500, q: 0.7, at: 0.05, dur: 1.6, peak: 0.55, attack: 0.04, flutter: 23 });
        this.tone(out, { freq: 55, to: 35, dur: 1.2, peak: 0.6, attack: 0.05 });
        for (let i = 0; i < 6; i++) {
          this.hiss(out, { filter: 'highpass', freq: 5000, q: 1, at: 0.1 + Math.random() * 1.1, dur: 0.02, peak: 0.6, attack: 0.001 });
        }
        break;
      }
      case 'Water': {
        const out = this.bus(0.3, 1);
        // The splash, then bubbles rising.
        this.hiss(out, { filter: 'bandpass', freq: 2600, to: 450, q: 0.9, dur: 0.7, peak: 1, attack: 0.006 });
        this.tone(out, { freq: 90, to: 40, dur: 0.4, peak: 0.7, attack: 0.004 });
        for (let i = 0; i < 9; i++) {
          const f = 300 + Math.random() * 600;
          this.tone(out, { freq: f, to: f * 2.2, at: 0.25 + Math.random() * 0.9, dur: 0.06, peak: 0.18, attack: 0.004 });
        }
        break;
      }
    }
  }

  // --- Daggers ------------------------------------------------------------------------------

  private throwDagger(): void {
    const out = this.bus(0.08, 1.2);
    // A whoosh fluttering with the dagger's spin.
    this.hiss(out, { filter: 'bandpass', freq: 1700 * vary(0.08), to: 4800, q: 4, dur: 0.22, peak: 0.6, attack: 0.05, flutter: 26 });
  }

  private clink(): void {
    const out = this.bus(0.3, 0.6);
    this.hiss(out, { filter: 'highpass', freq: 5000, q: 0.7, dur: 0.025, peak: 0.6, attack: 0.001 });
    this.ring(out, { base: 2100 * vary(0.06), partials: STEEL.slice(0, 3), peak: 0.15, decay: 0.35 });
  }

  private thunk(cue: ThunkCue): void {
    const out = this.bus(0.15, 0.6);
    if (cue.surface === 'snow') {
      this.hiss(out, { filter: 'lowpass', freq: 900, q: 0.7, dur: 0.1, peak: 0.6, attack: 0.003 });
      return;
    }
    this.tone(out, { freq: 240 * vary(0.08), to: 110, dur: 0.1, peak: 0.6 });
    this.hiss(out, { filter: 'bandpass', freq: 750, q: 3, dur: 0.06, peak: 0.6, attack: 0.001 });
    // The dagger quivering where it stuck.
    this.ring(out, { base: cue.surface === 'metal' ? 1400 : 520, partials: STEEL.slice(0, 2), peak: 0.06, decay: 0.3 });
  }

  // --- The Match ----------------------------------------------------------------------------

  private duelStart(cue: DuelStartCue): void {
    const out = this.bus(0.35, 0.9);
    // Blades drawn: a rising scrape and a shimmer of steel.
    this.hiss(out, { filter: 'bandpass', freq: 1800, to: 7000, q: 6, dur: 0.5, peak: 0.45, attack: 0.25 });
    this.ring(out, { base: 1500, partials: STEEL, at: 0.42, peak: 0.08, decay: 1.4, attack: 0.01 });
    // War drums: one beat per Duel so far, up to three.
    const beats = Math.min(3, Math.max(1, cue.duelNumber));
    for (let i = 0; i < beats; i++) this.drum(out, 0.55 + i * 0.22, i === beats - 1 ? 1 : 0.7);
  }

  private drum(out: AudioNode, at: number, level: number): void {
    this.tone(out, { freq: 82, to: 46, at, dur: 0.55, peak: 0.95 * level, attack: 0.004 });
    this.hiss(out, { filter: 'lowpass', freq: 400, q: 0.8, at, dur: 0.12, peak: 0.6 * level, attack: 0.002 });
    this.hiss(out, { filter: 'bandpass', freq: 1800, q: 1.5, at, dur: 0.03, peak: 0.25 * level, attack: 0.001 });
  }

  private gong(at: number, level: number): void {
    const out = this.bus(0.5, level);
    // The mallet, then the gong blooming and ringing out.
    this.tone(out, { freq: 70, to: 50, at, dur: 0.4, peak: 0.6, attack: 0.004 });
    this.ring(out, { base: 98 * vary(0.03), partials: GONG, at, peak: 0.3, attack: 0.03 });
  }

  private fanfare(at: number): void {
    const out = this.bus(0.4, 0.8);
    this.gong(at, 0.9);
    // A rising call of horns, then the chord held.
    for (const [i, freq] of [261.6, 329.6, 392.0].entries()) this.horn(out, freq, at + 0.15 + i * 0.22, 0.22);
    const held = at + 0.82;
    for (const freq of [261.6, 329.6, 392.0, 523.3]) this.horn(out, freq, held, 1.5);
    for (let i = 0; i < 3; i++) this.drum(out, held + i * 0.12, 0.6 + 0.2 * i);
    // A last flourish of steel.
    this.ring(out, { base: pick([1320, 1480]), partials: STEEL, at: held, peak: 0.07, decay: 1.6 });
  }

  /** A brassy note: detuned saws through a lowpass that opens as it's blown. */
  private horn(out: AudioNode, freq: number, at: number, dur: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at * this.stretch;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.08 * this.stretch);
    f.frequency.exponentialRampToValueAtTime(1300, t + dur * this.stretch);
    f.connect(this.envelope(out, at, dur, 0.09, 0.04));
    for (const detune of [-7, 0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * this.deepen;
      osc.detune.value = detune;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur * this.stretch + 0.05);
    }
  }
}

/** The room every sound plays in: a stereo tail of decaying, darkening noise. */
function roomImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * ROOM_SECONDS);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const k = i / length;
      // Later reflections are softer and duller: a one-pole lowpass that closes as the tail goes on.
      const white = Math.random() * 2 - 1;
      smooth += (white - smooth) * (0.9 - 0.75 * k);
      data[i] = smooth * (1 - k) ** 3.2 * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  return ir;
}
