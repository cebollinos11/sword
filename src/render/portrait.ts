/**
 * The Lobby's portrait of you: your Fighter drawn live, in your Body, Weapon and Size, standing in its idle loop, at the
 * game's own low resolution (as many screen pixels to a drawn pixel as the Arena behind the menu). A small Duel of its
 * own is stepped with idle Intents for the animation and only your Fighter is drawn, in a studio light like the
 * thumbnails' (`src/thumbs`). Render-only: nothing here touches a Match being played.
 *
 * One view lives for the page: the Lobby redraws its DOM on every change, so each redraw hands the same canvas to the
 * new portrait (`attach`). It draws only while that canvas is in the page.
 */
import * as THREE from 'three';
import { createMatch, IDLE_INTENT, stepMatch, TICK_SECONDS, type MatchState } from '../sim';
import { sizedTuning, weaponByName, type Size, type TuningData } from '../tuning';
import { isBody, type Body } from './bodyModel';
import { drawnPose, FighterView } from './fighterView';
import { PS1_LINES } from './stage';

/** What the portrait shows. */
export interface PortraitLook {
  readonly body: string;
  readonly weapon: string;
  readonly size?: Size;
  /** Your Team's colour. */
  readonly colour: number;
}

/** Start the idle loop over after this long, so the little Duel never runs into anything a long one might (s). */
const LOOP_SECONDS = 120;
/** At most this many Ticks caught up in one frame (after the tab was hidden, say). */
const MAX_CATCH_UP = 8;

export class PortraitView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  private view: FighterView | null = null;
  private drawn: { body: Body; colour: number } | null = null;
  private look: PortraitLook | null = null;
  private match: MatchState | null = null;
  private prev: MatchState | null = null;
  private matchKey = '';
  private carry = 0;
  private last = 0;
  private running = false;
  private shown = { w: 0, h: 0, lines: 0 };

  /** Throws where WebGL is not to be had: the Lobby then keeps the picture. */
  constructor(private readonly tuning: TuningData) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'portrait-3d';
    this.canvas.style.imageRendering = 'pixelated';
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3226, 1.4));
    const key = new THREE.DirectionalLight(0xffe8cc, 2.2);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 1.6);
    rim.position.set(-4, 3, -5);
    this.scene.add(key, rim);
  }

  /** Show the portrait in `container` (in place of whatever canvas it held), with `look`; it draws until taken out of the page. */
  attach(container: HTMLElement, look: PortraitLook): void {
    this.look = look;
    if (this.canvas.parentElement !== container) container.prepend(this.canvas);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.canvas.isConnected || !this.look) {
      this.running = false;
      return;
    }
    requestAnimationFrame(this.frame);
    this.step(now);
    this.draw();
  };

  /** The little Duel: a fresh one for a new Weapon or Size, stepped with idle Intents at the Tick rate. */
  private step(now: number): void {
    const look = this.look!;
    const weapons = Object.keys(this.tuning.weapons);
    const weapon = this.tuning.weapons[look.weapon] ? look.weapon : weapons[0]!;
    const key = JSON.stringify([weapon, look.size ?? null]);
    if (key !== this.matchKey || !this.match || this.match.duel.tick * TICK_SECONDS > LOOP_SECONDS) {
      this.match = createMatch(this.tuning, { bestOf: 1, weapons: [weapon, weapons[0]!], sizes: [look.size] });
      this.prev = this.match;
      this.matchKey = key;
      this.carry = 0;
    }
    this.carry += Math.min((now - this.last) / 1000, MAX_CATCH_UP * TICK_SECONDS);
    this.last = now;
    while (this.carry >= TICK_SECONDS) {
      this.prev = this.match;
      this.match = stepMatch(this.match, [IDLE_INTENT, IDLE_INTENT], this.tuning);
      this.carry -= TICK_SECONDS;
    }
  }

  private draw(): void {
    const look = this.look!;
    const match = this.match!;
    const body: Body = isBody(look.body) ? look.body : 'skeleton';
    if (!this.view || this.drawn?.body !== body || this.drawn.colour !== look.colour) {
      if (this.view) {
        this.scene.remove(this.view.root);
        this.view.dispose();
      }
      this.view = new FighterView(look.colour, this.tuning, body);
      this.drawn = { body, colour: look.colour };
      this.scene.add(this.view.root);
    }
    const f = match.duel.fighters[0]!;
    const pose = drawnPose(this.prev!.duel, match.duel, 0, this.carry / TICK_SECONDS, this.tuning);
    this.view.update(pose, weaponByName(sizedTuning(this.tuning, f.size), f.weapon), f.size);

    this.fit();
    // Full length from the front, a little to your right (as the thumbnails): further back for a taller Fighter.
    const height = f.size?.height ?? 1;
    const yaw = f.facing + 0.45;
    const target = new THREE.Vector3(f.position.x, f.y + 0.92 * height, f.position.z);
    const back = 4.6 * Math.max(1, height * 1.12);
    this.camera.position.set(target.x + Math.sin(yaw) * back, target.y + 0.35, target.z + Math.cos(yaw) * back);
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }

  /** Match the canvas to its box, drawn at the game's resolution: PS1_LINES to the window's height. */
  private fit(): void {
    const box = this.canvas.parentElement!;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const lines = PS1_LINES / (window.innerHeight || h || 1);
    if (w === this.shown.w && h === this.shown.h && lines === this.shown.lines) return;
    this.shown = { w, h, lines };
    this.renderer.setPixelRatio(lines);
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
}
