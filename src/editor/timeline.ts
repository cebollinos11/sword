/**
 * The Motion timeline: a strip under the 3D view with the Motion's Pose Keys
 * as diamonds, its markers (the Release window tinted red), each segment's
 * easing curve and the playhead. Click a key to select it, drag it to retime
 * it, double-click the track to add a Pose Key, drag elsewhere to scrub.
 * It only draws and reports gestures; edits go through `motionEdit`.
 */
import { ease } from '../sim';
import type { Motion } from '../tuning';

export interface TimelineCallbacks {
  select(index: number | null): void;
  /** A selected key dragged to a new time; return its (possibly new) index. */
  retime(index: number, time: number): number;
  scrub(time: number): void;
  add(time: number): void;
}

const HEIGHT = 120;
const PAD = 24;
const KEY_Y = 34;
const CURVE_TOP = 52;
const CURVE_BOTTOM = HEIGHT - 22;
const HIT_RADIUS = 9;

export class Timeline {
  readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private motion: Motion | undefined;
  private selected: number | null = null;
  private time = 0;
  private drag: { kind: 'key'; index: number } | { kind: 'scrub' } | undefined;

  constructor(private readonly cb: TimelineCallbacks) {
    Object.assign(this.element.style, {
      position: 'fixed',
      left: '8px',
      right: '360px',
      bottom: '8px',
      height: `${HEIGHT}px`,
      background: 'rgba(28, 28, 30, 0.88)',
      borderRadius: '6px',
      userSelect: 'none',
    });
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.element.title = 'Click a Pose Key to select it, drag it to retime it, double-click to add a Pose Key, drag elsewhere to scrub';
    this.element.appendChild(this.canvas);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('dblclick', (e) => this.motion && this.cb.add(this.xToTime(this.localX(e))));
    new ResizeObserver(() => this.draw()).observe(this.element);
  }

  update(motion: Motion, selected: number | null, time: number): void {
    this.motion = motion;
    this.selected = selected;
    this.time = time;
    this.draw();
  }

  private get width(): number {
    return this.canvas.clientWidth;
  }

  private timeToX(t: number): number {
    const d = this.motion?.duration ?? 1;
    return PAD + (t / d) * (this.width - 2 * PAD);
  }

  private xToTime(x: number): number {
    const d = this.motion?.duration ?? 1;
    return Math.min(Math.max(((x - PAD) / (this.width - 2 * PAD)) * d, 0), d);
  }

  private localX(e: MouseEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private keyAt(x: number, y: number): number | null {
    if (!this.motion || Math.abs(y - KEY_Y) > HIT_RADIUS + 4) return null;
    let best: number | null = null;
    let bestD = HIT_RADIUS;
    this.motion.poseKeys.forEach((k, i) => {
      const d = Math.abs(this.timeToX(k.time) - x);
      // Prefer the selected key when several sit on top of each other.
      if (d < bestD || (d === bestD && i === this.selected)) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  private down(e: PointerEvent): void {
    if (!this.motion) return;
    this.canvas.setPointerCapture(e.pointerId);
    const x = this.localX(e);
    const y = e.clientY - this.canvas.getBoundingClientRect().top;
    const k = this.keyAt(x, y);
    if (k !== null) {
      this.cb.select(k);
      this.drag = { kind: 'key', index: k };
    } else {
      this.cb.select(null);
      this.drag = { kind: 'scrub' };
      this.cb.scrub(this.xToTime(x));
    }
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const t = this.xToTime(this.localX(e));
    if (this.drag.kind === 'key') this.drag.index = this.cb.retime(this.drag.index, t);
    else this.cb.scrub(t);
  }

  private up(e: PointerEvent): void {
    this.drag = undefined;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const g = this.canvas.getContext('2d');
    const m = this.motion;
    if (!g || !m) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';

    // Release window (between the windUpEnd and releaseEnd markers).
    const { windUpEnd, releaseEnd } = m.markers;
    if (windUpEnd !== undefined && releaseEnd !== undefined) {
      g.fillStyle = 'rgba(255, 59, 48, 0.25)';
      g.fillRect(this.timeToX(windUpEnd), 8, this.timeToX(releaseEnd) - this.timeToX(windUpEnd), h - 16);
    }

    // Time ruler: a tick every 0.1 s, labelled every 0.5 s.
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1;
    for (let i = 0; i * 0.1 <= m.duration + 1e-9; i++) {
      const x = Math.round(this.timeToX(i * 0.1)) + 0.5;
      g.beginPath();
      g.moveTo(x, h - 16);
      g.lineTo(x, i % 5 === 0 ? h - 8 : h - 12);
      g.stroke();
      if (i % 5 === 0) g.fillText(`${(i * 0.1).toFixed(1)}s`, x + 3, h - 9);
    }

    // Markers.
    g.textAlign = 'left';
    for (const [name, t] of Object.entries(m.markers)) {
      const x = Math.round(this.timeToX(t)) + 0.5;
      g.strokeStyle = 'rgba(255, 159, 10, 0.9)';
      g.beginPath();
      g.moveTo(x, 8);
      g.lineTo(x, h - 16);
      g.stroke();
      g.fillStyle = 'rgba(255, 159, 10, 0.95)';
      g.fillText(name, x + 3, 14);
    }

    // Easing curve of each segment, drawn from the earlier key to the later key (whose ease it is).
    g.strokeStyle = 'rgba(100, 210, 255, 0.9)';
    g.lineWidth = 1.5;
    for (let i = 1; i < m.poseKeys.length; i++) {
      const a = m.poseKeys[i - 1]!;
      const b = m.poseKeys[i]!;
      const x0 = this.timeToX(a.time);
      const x1 = this.timeToX(b.time);
      g.beginPath();
      const steps = Math.max(2, Math.ceil(x1 - x0));
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const y = CURVE_BOTTOM - ease(b.ease, u) * (CURVE_BOTTOM - CURVE_TOP);
        if (s === 0) g.moveTo(x0 + u * (x1 - x0), y);
        else g.lineTo(x0 + u * (x1 - x0), y);
      }
      g.stroke();
      if (x1 - x0 > 50) {
        g.fillStyle = 'rgba(100, 210, 255, 0.7)';
        g.textAlign = 'center';
        g.fillText(b.ease, (x0 + x1) / 2, CURVE_BOTTOM + 8);
        g.textAlign = 'left';
      }
    }

    // Pose Keys.
    m.poseKeys.forEach((k, i) => {
      const x = this.timeToX(k.time);
      const r = i === this.selected ? 8 : 6;
      g.fillStyle = i === this.selected ? '#30d158' : '#ffd60a';
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.beginPath();
      g.moveTo(x, KEY_Y - r);
      g.lineTo(x + r, KEY_Y);
      g.lineTo(x, KEY_Y + r);
      g.lineTo(x - r, KEY_Y);
      g.closePath();
      g.fill();
      g.stroke();
    });

    // Playhead.
    const px = Math.round(this.timeToX(Math.min(this.time, m.duration))) + 0.5;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, 4);
    g.lineTo(px, h - 4);
    g.stroke();

  }
}
