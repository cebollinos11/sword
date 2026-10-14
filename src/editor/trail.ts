import * as THREE from 'three';
import type { BladeTransform } from '../sim';

const LIVE = new THREE.Color(0xff3b30); // Release: the only phase where the Blade Sweep is live
const SAFE = new THREE.Color(0xffffff);

/**
 * The Blade Sweep drawn as a ribbon: one quad per Tick between consecutive
 * hilt→tip segments, red where `isLive(tick)` and white elsewhere, plus a
 * line along the tip path.
 */
export class BladeSweepTrail {
  readonly root = new THREE.Group();
  private ribbon?: THREE.Mesh;
  private tipLine?: THREE.Line;
  private readonly ribbonMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });

  set(blades: readonly BladeTransform[], isLive: (tick: number) => boolean): void {
    this.clear();
    if (blades.length < 2) return;
    const pos: number[] = [];
    const col: number[] = [];
    const tipPos: number[] = [];
    const tipCol: number[] = [];
    const index: number[] = [];
    blades.forEach((b, i) => {
      const c = isLive(i) ? LIVE : SAFE;
      pos.push(b.hilt.x, b.hilt.y, b.hilt.z, b.tip.x, b.tip.y, b.tip.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      tipPos.push(b.tip.x, b.tip.y, b.tip.z);
      tipCol.push(c.r, c.g, c.b);
      if (i > 0) {
        const a = (i - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    this.ribbon = new THREE.Mesh(g, this.ribbonMaterial);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(tipPos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(tipCol, 3));
    this.tipLine = new THREE.Line(lg, this.lineMaterial);
    this.root.add(this.ribbon, this.tipLine);
  }

  private clear(): void {
    for (const o of [this.ribbon, this.tipLine]) {
      if (!o) continue;
      this.root.remove(o);
      o.geometry.dispose();
    }
    this.ribbon = undefined;
    this.tipLine = undefined;
  }
}
