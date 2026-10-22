/**
 * Swing trails: a fading ribbon behind each Fighter's blade while its Blade Sweep is live (Release), so a swing's arc
 * stays readable in play. Render-only, like impacts: it samples the drawn poses each frame and never touches the
 * Simulation; which Ticks trail is pure, so it is tested headlessly.
 */
import * as THREE from 'three';
import type { BladeTransform, SimState } from '../sim';

/** How long a sample stays on screen, seconds (of effect time, so slow-motion stretches it). */
const LIFE = 0.16;
/** Where along the blade, hilt (0) to tip (1), the ribbon's inner edge runs: the hand and grip leave no trail. */
const INNER = 0.35;
/** Opacity of the newest sample at the tip; the inner edge is fainter. */
const TIP_ALPHA = 0.7;
const INNER_ALPHA = 0.15;
const COLOUR = new THREE.Color(0xf4f8ff);

/**
 * Fighter `i`'s blade trails between Tick `prev` and `curr`: it is Attacking and in Release at `curr`, or was at `prev`
 * (so the last stretch of the Release, up to its end pose, still trails). The follow-through in Recovery cannot hit and leaves none.
 */
export function trailing(prev: Pick<SimState, 'fighters'>, curr: Pick<SimState, 'fighters'>, i: number): boolean {
  const now = curr.fighters[i]?.action;
  if (now?.kind !== 'Attack') return false;
  const before = prev.fighters[i]?.action;
  return now.phase === 'Release' || (before?.kind === 'Attack' && before.phase === 'Release');
}

interface Sample {
  readonly at: number;
  /** Samples of one swing join up; a new swing starts a new stroke. */
  readonly stroke: number;
  readonly inner: THREE.Vector3;
  readonly tip: THREE.Vector3;
}

/** One Fighter's ribbon. */
class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private samples: Sample[] = [];
  private stroke = 0;
  private wasLive = false;

  constructor(material: THREE.MeshBasicMaterial) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
  }

  update(blade: BladeTransform, live: boolean, clock: number): void {
    if (live && !this.wasLive) this.stroke++;
    this.wasLive = live;
    const last = this.samples[this.samples.length - 1];
    if (live && !(last && last.stroke === this.stroke && last.at === clock)) {
      const hilt = new THREE.Vector3(blade.hilt.x, blade.hilt.y, blade.hilt.z);
      const tip = new THREE.Vector3(blade.tip.x, blade.tip.y, blade.tip.z);
      this.samples.push({ at: clock, stroke: this.stroke, inner: hilt.lerp(tip, INNER), tip });
    }
    if (this.samples.length === 0 && !this.mesh.visible) return;
    this.samples = this.samples.filter((s) => clock - s.at < LIFE);
    this.rebuild(clock);
  }

  clear(): void {
    this.samples = [];
    this.wasLive = false;
    this.rebuild(0);
  }

  private rebuild(clock: number): void {
    const pos: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    this.samples.forEach((s, k) => {
      const fade = 1 - (clock - s.at) / LIFE;
      pos.push(s.inner.x, s.inner.y, s.inner.z, s.tip.x, s.tip.y, s.tip.z);
      col.push(COLOUR.r, COLOUR.g, COLOUR.b, INNER_ALPHA * fade, COLOUR.r, COLOUR.g, COLOUR.b, TIP_ALPHA * fade * fade);
      if (k > 0 && this.samples[k - 1]!.stroke === s.stroke) {
        const a = (k - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(index);
    this.mesh.visible = index.length > 0;
  }
}

/** Every Fighter's swing trail in a scene. Call `update` before each draw with the drawn blades and the effect time that passed. */
export class SwingTrails {
  private readonly root = new THREE.Group();
  private readonly trails: Trail[] = [];
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  /** Effect time, seconds. */
  private clock = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** One blade per Fighter; a Fighter not drawn (undefined) leaves no trail. */
  update(prev: SimState, curr: SimState, blades: readonly (BladeTransform | undefined)[], seconds: number): void {
    this.clock += Math.min(0.1, Math.max(0, seconds));
    blades.forEach((blade, i) => {
      let trail = this.trails[i];
      if (!blade) {
        trail?.clear();
        return;
      }
      if (!trail) {
        trail = new Trail(this.material);
        this.trails[i] = trail;
        this.root.add(trail.mesh);
      }
      trail.update(blade, trailing(prev, curr, i), this.clock);
    });
    // A smaller Match than the last one: the missing Fighters leave no trail.
    for (let i = blades.length; i < this.trails.length; i++) this.trails[i]!.clear();
  }
}
