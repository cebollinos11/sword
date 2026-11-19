/**
 * Whirlwind feedback: the whirl trail (a fan swept back behind the spinning blade) and the armed flash (a glint and a floor ring when the
 * Wind-up's hold becomes armed). Render-only, and pure functions of Simulation state, the drawn Tick and the drawn pose with no history kept
 * between frames, so a scrub, a Rollback or a replay draws the same (ADR 0026). They never change an outcome.
 */
import * as THREE from 'three';
import { spinSign, whirlwindTimings, type BladeTransform, type SimState, type Vec3 } from '../sim';
import type { TuningData } from '../tuning';

/** How far back the fan reaches: 10 Ticks of turning at the default tuning. */
export const TRAIL_ARC = (200 * Math.PI) / 180;
/** Ticks the fifth turn's trail takes to fade once the Recovery begins. */
export const TRAIL_FADE_TICKS = 6;
/** Slices of the fan. */
export const TRAIL_SEGMENTS = 24;
/** Where along the blade, hilt (0) to tip (1), the fan's inner edge runs: the hand and grip leave no trail (as the swing trail's). */
export const TRAIL_INNER = 0.35;
const TIP_ALPHA = 0.75;
const INNER_ALPHA = 0.15;
const COLOUR = new THREE.Color(0xf4f8ff);

/** Ticks the arming flash lasts (0.2 s). */
export const FLASH_TICKS = 12;
/** The steady glint kept while the hold stays armed, so an armed hold reads apart from one still charging. */
export const ARMED_GLOW = 0.3;
const GLINT_COLOUR = 0xfff1c0;
const RING_NEAR = 0.3;
const RING_FAR = 1.6;

/** What a whirl trail looks like at one drawn moment: how far back it reaches (radians), how strong it is, and which way the body turns. */
export interface WhirlTrail {
  readonly arc: number;
  readonly opacity: number;
  readonly sign: 1 | -1;
}

/**
 * Fighter `i`'s whirl trail at drawn Tick `prev.tick + alpha`, or null. In the Spin it grows with the turning drawn so far (the Spin's entering
 * Tick only moves out of the coil) up to `TRAIL_ARC`; in the first Ticks of the Recovery it holds that arc and fades as the body stops.
 * The Wind-up, later Recovery and a Fighter that is not in a Whirlwind or is dead have none.
 */
export function whirlTrail(prev: SimState, curr: SimState, i: number, alpha: number, tuning: TuningData): WhirlTrail | null {
  const f = curr.fighters[i];
  const a = f?.action;
  if (!f || f.death || a?.kind !== 'Whirlwind') return null;
  const sign = spinSign(a.direction);
  if (a.phase === 'Spin') {
    // Drawn between the last Tick and this one; a loop paused on one state (prev = curr) draws that state itself.
    const spun = Math.max(0, a.ticks - (prev.tick === curr.tick ? 0 : 1) + alpha);
    const arc = Math.min(TRAIL_ARC, (spun * 2 * Math.PI) / whirlwindTimings(tuning).turnTicks);
    return arc > 0 ? { arc, opacity: 1, sign } : null;
  }
  if (a.phase === 'Recovery' && a.ticks < TRAIL_FADE_TICKS) return { arc: TRAIL_ARC, opacity: 1 - (a.ticks + alpha) / TRAIL_FADE_TICKS, sign };
  return null;
}

/**
 * The fan for a drawn `blade`: for each slice k (0..`TRAIL_SEGMENTS`) the blade's inner point and tip turned back, about the vertical line
 * through `pivot` (the Fighter's position), by the share `k / TRAIL_SEGMENTS` of the arc, the way it came. Heights are kept; `alpha[k]` fades
 * to nothing at the far end. Slice 0 is the blade as drawn.
 */
export function trailFan(blade: BladeTransform, pivot: { x: number; z: number }, trail: WhirlTrail): { inner: Vec3[]; tip: Vec3[]; alpha: number[] } {
  const { hilt, tip } = blade;
  const inner0 = { x: hilt.x + (tip.x - hilt.x) * TRAIL_INNER, y: hilt.y + (tip.y - hilt.y) * TRAIL_INNER, z: hilt.z + (tip.z - hilt.z) * TRAIL_INNER };
  const turn = (p: Vec3, delta: number): Vec3 => {
    const dx = p.x - pivot.x;
    const dz = p.z - pivot.z;
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    return { x: pivot.x + dx * c + dz * s, y: p.y, z: pivot.z - dx * s + dz * c };
  };
  const inner: Vec3[] = [];
  const tips: Vec3[] = [];
  const alpha: number[] = [];
  for (let k = 0; k <= TRAIL_SEGMENTS; k++) {
    const delta = -trail.sign * ((trail.arc * k) / TRAIL_SEGMENTS);
    inner.push(k === 0 ? inner0 : turn(inner0, delta));
    tips.push(k === 0 ? { x: tip.x, y: tip.y, z: tip.z } : turn(tip, delta));
    alpha.push(trail.opacity * (1 - k / TRAIL_SEGMENTS) ** 2);
  }
  return { inner, tip: tips, alpha };
}

/**
 * Fighter `i`'s armed flash at drawn Tick `prev.tick + alpha`, or null: only while its Whirlwind Wind-up is armed. `flash` is 1 on the arming Tick
 * and falls to 0 over `FLASH_TICKS`; `glow` is the steady glint that stays while the hold stays armed.
 */
export function armedFlash(_prev: SimState, curr: SimState, i: number, alpha: number, tuning: TuningData): { flash: number; glow: number } | null {
  const f = curr.fighters[i];
  const a = f?.action;
  if (!f || f.death || a?.kind !== 'Whirlwind' || a.phase !== 'Wind-up' || !a.armed) return null;
  const since = a.ticks - whirlwindTimings(tuning).armTicks + alpha;
  return { flash: since < FLASH_TICKS ? Math.max(0, 1 - since / FLASH_TICKS) : 0, glow: ARMED_GLOW };
}

/** A small white radial gradient (opaque centre, clear edge), built in code so it needs no DOM. */
function glintTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const v = Math.max(0, 1 - r);
      const o = (y * n + x) * 4;
      data.fill(255, o, o + 3);
      data[o + 3] = Math.round(255 * v * v);
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface FighterEffects {
  readonly fan: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly glint: THREE.Sprite;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

/** Every Fighter's whirl trail and armed flash in a scene. Call `update` before each draw with the drawn Ticks and blades. */
export class WhirlwindEffects {
  private readonly root = new THREE.Group();
  private readonly effects: FighterEffects[] = [];
  private readonly texture = glintTexture();

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** One blade per Fighter; a Fighter not drawn (undefined, or past the end) shows nothing. */
  update(prev: SimState, curr: SimState, alpha: number, blades: readonly (BladeTransform | undefined)[], tuning: TuningData): void {
    blades.forEach((blade, i) => {
      const trail = blade ? whirlTrail(prev, curr, i, alpha, tuning) : null;
      const flash = blade ? armedFlash(prev, curr, i, alpha, tuning) : null;
      if (!trail && !flash && !this.effects[i]) return;
      const fx = this.effects[i] ?? this.make(i);
      const now = curr.fighters[i];
      const was = prev.fighters[i] ?? now;
      const pivot = now && was ? { x: was.position.x + (now.position.x - was.position.x) * alpha, z: was.position.z + (now.position.z - was.position.z) * alpha } : { x: 0, z: 0 };
      const y = now && was ? was.y + (now.y - was.y) * alpha : 0;
      this.setFan(fx, blade, pivot, trail);
      fx.glint.visible = !!blade && !!flash;
      fx.ring.visible = !!flash && flash.flash > 0;
      if (blade && flash) {
        fx.glint.position.set(blade.tip.x, blade.tip.y, blade.tip.z);
        const size = 0.25 + 0.6 * flash.flash;
        fx.glint.scale.set(size, size, 1);
        fx.glint.material.opacity = Math.max(flash.flash, flash.glow);
      }
      if (flash && flash.flash > 0) {
        fx.ring.position.set(pivot.x, y + 0.02, pivot.z);
        fx.ring.scale.setScalar(RING_FAR + (RING_NEAR - RING_FAR) * flash.flash);
        fx.ring.material.opacity = 0.8 * flash.flash;
      }
    });
    for (let i = blades.length; i < this.effects.length; i++) {
      const fx = this.effects[i];
      if (fx) fx.fan.visible = fx.glint.visible = fx.ring.visible = false;
    }
  }

  dispose(): void {
    for (const fx of this.effects) {
      if (!fx) continue;
      fx.fan.geometry.dispose();
      fx.fan.material.dispose();
      fx.glint.material.dispose();
      fx.ring.geometry.dispose();
      fx.ring.material.dispose();
    }
    this.texture.dispose();
    this.scene.remove(this.root);
  }

  private make(i: number): FighterEffects {
    const fan = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    fan.frustumCulled = false;
    fan.visible = false;
    const glint = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, color: GLINT_COLOUR, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    glint.visible = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GLINT_COLOUR, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.visible = false;
    this.root.add(fan, glint, ring);
    return (this.effects[i] = { fan, glint, ring });
  }

  private setFan(fx: FighterEffects, blade: BladeTransform | undefined, pivot: { x: number; z: number }, trail: WhirlTrail | null): void {
    if (!blade || !trail) {
      fx.fan.visible = false;
      return;
    }
    const { inner, tip, alpha } = trailFan(blade, pivot, trail);
    const pos: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    for (let k = 0; k <= TRAIL_SEGMENTS; k++) {
      const a = alpha[k]!;
      pos.push(inner[k]!.x, inner[k]!.y, inner[k]!.z, tip[k]!.x, tip[k]!.y, tip[k]!.z);
      col.push(COLOUR.r, COLOUR.g, COLOUR.b, INNER_ALPHA * a, COLOUR.r, COLOUR.g, COLOUR.b, TIP_ALPHA * a);
      if (k > 0) {
        const j = (k - 1) * 2;
        index.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    }
    const g = fx.fan.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(index);
    fx.fan.visible = true;
  }
}
