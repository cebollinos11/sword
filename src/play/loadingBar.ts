/**
 * A loading overlay: a title, a progress bar and a line saying what is being loaded. Used wherever the game stops to load
 * or bake something (the Battle's impostor atlases, the Body models at start-up), so a wait never looks like a freeze.
 * Pure DOM; it carries its own styles.
 */
const CSS = `
.loading-bar { position: absolute; inset: 0; z-index: 60; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: #0d0a14; color: #f3e6c8; font-family: var(--font-body); pointer-events: auto; transition: opacity 0.25s steps(4, end); }
.loading-bar.done { opacity: 0; pointer-events: none; }
.loading-bar .loading-title { font-family: var(--font-display); font-size: 16px; letter-spacing: 0.08em; text-transform: uppercase; }
.loading-bar .loading-track { width: min(360px, 70vw); height: 14px; background: #000; border: 2px solid #f3e6c8; overflow: hidden; }
.loading-bar .loading-fill { width: 0%; height: 100%; background: repeating-linear-gradient(90deg, #f2b632 0 6px, #0d0a14 6px 8px); transition: width 0.15s steps(4, end); }
.loading-bar .loading-detail { font-size: 18px; opacity: 0.7; min-height: 1.2em; }
`;

let injected = false;

export class LoadingBar {
  readonly root = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly detail = document.createElement('div');

  constructor(container: HTMLElement, title: string) {
    if (!injected) {
      injected = true;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.append(style);
    }
    this.root.className = 'loading-bar';
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    const heading = document.createElement('div');
    heading.className = 'loading-title';
    heading.textContent = title;
    const track = document.createElement('div');
    track.className = 'loading-track';
    this.fill.className = 'loading-fill';
    track.append(this.fill);
    this.detail.className = 'loading-detail';
    this.root.append(heading, track, this.detail);
    container.append(this.root);
    this.set(0);
  }

  /** Show `fraction` (0 to 1) of the bar, and optionally what is being loaded now. */
  set(fraction: number, detail?: string): void {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.fill.style.width = `${pct}%`;
    this.root.setAttribute('aria-valuenow', String(pct));
    if (detail !== undefined) this.detail.textContent = detail;
  }

  /** Fill the bar, fade it out and remove it. */
  finish(): void {
    this.set(1);
    this.root.classList.add('done');
    setTimeout(() => this.root.remove(), 300);
  }

  /** Take it away at once (the thing it covered was abandoned). */
  dispose(): void {
    this.root.remove();
  }
}

/** Resolves on the next animation frame (so the browser can paint the bar between steps of heavy work). */
export const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
