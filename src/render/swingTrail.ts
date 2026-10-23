/**
 * Swing trails: a fading ribbon behind each Fighter's blade while its Blade Sweep is live (Release), so a swing's arc
 * stays readable in play. Render-only, like impacts: it samples the drawn poses each frame and never touches the
 * Simulation; which Ticks trail is pure, so it is tested headlessly.
 */
import * as THREE from 'three';
import type { BladeTransform, SimState, Vec3 } from '../sim';

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
  /** Samples of one stroke join up; a new stroke starts apart. */
  readonly stroke: number;
  readonly inner: THREE.Vector3;
  readonly tip: THREE.Vector3;
}

/** How a Ribbon looks: how long a sample lasts (s of effect time) and the newest sample's opacity at each edge. */
export interface RibbonStyle {
  readonly life: number;
  readonly tipAlpha: number;
  readonly innerAlpha: number;
  readonly colour: THREE.Color;
}

/** A blade's ribbon as a swing leaves it. */
const SWING_STYLE: RibbonStyle = { life: LIFE, tipAlpha: TIP_ALPHA, innerAlpha: INNER_ALPHA, colour: COLOUR };

/** The vertex-coloured, see-through material every Ribbon is drawn with. */
export const ribbonMaterial = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false });

/**
 * A fading ribbon swept by a moving edge (inner point to tip): each `update` while live adds the edge where it is now, and
 * samples older than the style's life drop off. Used for swing trails and for flying Throwing Daggers.
 */
export class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private samples: Sample[] = [];
  private stroke = 0;
  private wasLive = false;

  constructor(
    material: THREE.MeshBasicMaterial,
    private readonly style: RibbonStyle = SWING_STYLE,
  ) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
  }

  /** Whether nothing is left to draw. */
  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** `edge` is where the edge is now, or null when it leaves no trail (the old samples still fade). */
  update(edge: { inner: Vec3; tip: Vec3 } | null, clock: number): void {
    const live = edge !== null;
    if (live && !this.wasLive) this.stroke++;
    this.wasLive = live;
    const last = this.samples[this.samples.length - 1];
    if (edge && !(last && last.stroke === this.stroke && last.at === clock)) {
      const { inner, tip } = edge;
      this.samples.push({ at: clock, stroke: this.stroke, inner: new THREE.Vector3(inner.x, inner.y, inner.z), tip: new THREE.Vector3(tip.x, tip.y, tip.z) });
    }
    if (this.samples.length === 0 && !this.mesh.visible) return;
    this.samples = this.samples.filter((s) => clock - s.at < this.style.life);
    this.rebuild(clock);
  }

  clear(): void {
    this.samples = [];
    this.wasLive = false;
    this.rebuild(0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }

  private rebuild(clock: number): void {
    const { life, tipAlpha, innerAlpha, colour } = this.style;
    const pos: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    this.samples.forEach((s, k) => {
      const fade = 1 - (clock - s.at) / life;
      pos.push(s.inner.x, s.inner.y, s.inner.z, s.tip.x, s.tip.y, s.tip.z);
      col.push(colour.r, colour.g, colour.b, innerAlpha * fade, colour.r, colour.g, colour.b, tipAlpha * fade * fade);
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
  private readonly trails: Ribbon[] = [];
  private readonly material = ribbonMaterial();
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
        trail = new Ribbon(this.material);
        this.trails[i] = trail;
        this.root.add(trail.mesh);
      }
      const { hilt, tip } = blade;
      const inner = { x: hilt.x + (tip.x - hilt.x) * INNER, y: hilt.y + (tip.y - hilt.y) * INNER, z: hilt.z + (tip.z - hilt.z) * INNER };
      trail.update(trailing(prev, curr, i) ? { inner, tip } : null, this.clock);
    });
    // A smaller Match than the last one: the missing Fighters leave no trail.
    for (let i = blades.length; i < this.trails.length; i++) this.trails[i]!.clear();
  }
}
