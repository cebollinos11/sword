/**
 * What the Map Editor's play-test draws over a Battle being watched (docs/plans/map-editor.md, Stage 4): each Objective's Owner and progress (a ring
 * on the ground in the Owner's colour and a post that rises with the capture, and a line of text each) and the **stuck heat map**: the cells where
 * Soldiers stood out of their place for longer than a few seconds (`StuckMeter`), yellow to red. Render-only: it reads the Match, never writes it.
 */
import * as THREE from 'three';
import type { SpectateOverlay } from '../../play/battleSpectator';
import { battleMapOf, soldierHeight, TICK_SECONDS, type Heightfield, type MatchState } from '../../sim';
import type { BattleTuning } from '../../tuning';
import type { Stage } from '../../render/stage';
import { HEAT_CELL, StuckMeter, STUCK_AFTER } from '../stuck';

const TEAM_COLOURS = [0xe0c040, 0x4080e0];
const NO_OWNER = 0x9aa0a8;
/** How tall (m) an Objective's post is when its capture is complete. */
const POST = 8;
/** Soldier-seconds in one cell that read as fully red. */
const HOT = 20;
/** Frames between the heat map being drawn again, and the text. */
const HEAT_EVERY = 30;
const TEXT_EVERY = 6;

export class SpectateOverlays implements SpectateOverlay {
  private readonly root = new THREE.Group();
  private readonly panel: HTMLElement;
  private readonly text: HTMLElement;
  private meter: StuckMeter | null = null;
  private rings: THREE.Mesh[] = [];
  private posts: THREE.Mesh[] = [];
  private heat: THREE.Mesh | null = null;
  private scene: THREE.Scene | null = null;
  private ids: string[] = [];
  private frames = 0;
  showHeat = true;
  showOwners = true;

  constructor(
    parent: HTMLElement,
    private readonly battle: BattleTuning,
  ) {
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:absolute;left:8px;bottom:8px;padding:6px 10px;background:rgba(15,15,20,.8);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10';
    const toggles = document.createElement('div');
    for (const [label, key] of [['Objectives', 'showOwners'], ['stuck heat map', 'showHeat']] as const) {
      const l = document.createElement('label');
      l.style.marginRight = '10px';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.onchange = () => {
        this[key] = box.checked;
        this.apply();
      };
      l.append(box, ` ${label}`);
      toggles.appendChild(l);
    }
    this.text = document.createElement('pre');
    this.text.style.margin = '4px 0 0';
    this.panel.append(toggles, this.text);
    parent.appendChild(this.panel);
  }

  start(match: MatchState, stage: Stage, hf: Heightfield): void {
    this.clear();
    this.scene = stage.scene;
    const field = battleMapOf(this.battle, match.arena).field;
    this.meter = new StuckMeter(this.battle, match.arena);
    this.ids = field.objectives.map((o) => o.id);
    field.objectives.forEach((o, k) => {
      const y = soldierHeight(field, field.objectiveSurfaces[k]!, o.x, o.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.radius - 0.4, o.radius, 48), new THREE.MeshBasicMaterial({ color: NO_OWNER, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(o.x, y + 0.2, o.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 8), new THREE.MeshBasicMaterial({ color: NO_OWNER }));
      post.position.set(o.x, y, o.z);
      this.rings.push(ring);
      this.posts.push(post);
      this.root.add(ring, post);
    });
    this.scene.add(this.root);
    this.heatMesh(hf);
    this.update(match);
    this.apply();
  }

  tick(match: MatchState): void {
    this.meter?.observe(match);
  }

  frame(match: MatchState, _stage: Stage, hf: Heightfield): void {
    if (!this.meter) return;
    this.frames++;
    this.update(match);
    if (this.frames % HEAT_EVERY === 0) this.heatMesh(hf);
  }

  private apply(): void {
    this.rings.forEach((r) => (r.visible = this.showOwners));
    this.posts.forEach((p) => (p.visible = this.showOwners));
    if (this.heat) this.heat.visible = this.showHeat;
  }

  /** The rings and posts follow the Owners and progress; the text says them. */
  private update(match: MatchState): void {
    const crowd = match.duel.crowd;
    if (!crowd) return;
    const o = crowd.objectives;
    this.rings.forEach((ring, k) => {
      const colour = o.owner[k]! >= 0 ? TEAM_COLOURS[o.owner[k]!]! : NO_OWNER;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(colour);
      const post = this.posts[k]!;
      const p = o.progress[k]!;
      (post.material as THREE.MeshBasicMaterial).color.setHex(p > 0 ? TEAM_COLOURS[0]! : p < 0 ? TEAM_COLOURS[1]! : NO_OWNER);
      const height = Math.max(0.05, Math.abs(p) * POST);
      post.scale.y = height;
      post.position.y = ring.position.y - 0.2 + height / 2;
    });
    if (this.frames % TEXT_EVERY !== 0) return;
    const m = this.meter!;
    const lines = this.ids.map((id, k) => {
      const owner = o.owner[k]! >= 0 ? `Team ${o.owner[k]}` : 'no one';
      const p = o.progress[k]!;
      return `${id}  held by ${owner.padEnd(7)} capture ${p >= 0 ? '+' : ''}${p.toFixed(2)}`;
    });
    const hot = m.hottest();
    lines.push(`Tickets ${crowd.tickets[0]!.toFixed(0)} / ${crowd.tickets[1]!.toFixed(0)}  ·  ${(match.duel.tick * TICK_SECONDS).toFixed(0)} s`);
    lines.push(`stuck > ${STUCK_AFTER} s: ${m.stuckSeconds.toFixed(1)} Soldier-s, longest ${m.longest.toFixed(1)} s${hot ? `, hottest (${hot.x.toFixed(0)}, ${hot.z.toFixed(0)})` : ''}`);
    this.text.textContent = lines.join('\n');
  }

  /** The heat map as one mesh of quads, a cell each where Soldiers have been stuck. */
  private heatMesh(hf: Heightfield): void {
    const m = this.meter;
    if (!m) return;
    if (this.heat) {
      this.root.remove(this.heat);
      this.heat.geometry.dispose();
      (this.heat.material as THREE.Material).dispose();
      this.heat = null;
    }
    const half = hf.size / 2;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < m.heat.length; k++) {
      const seconds = m.heat[k]!;
      if (seconds <= 0) continue;
      const x0 = -half + (k % m.side) * HEAT_CELL;
      const z0 = -half + Math.floor(k / m.side) * HEAT_CELL;
      const y = m.heatY[k]! + 0.35;
      c.setHSL((1 - Math.min(1, seconds / HOT)) * 0.16, 1, 0.5);
      for (const [dx, dz] of [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]] as const) {
        pos.push(x0 + dx * HEAT_CELL, y, z0 + dz * HEAT_CELL);
        col.push(c.r, c.g, c.b);
      }
    }
    if (pos.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.heat = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }));
    this.heat.name = 'stuck-heat';
    this.heat.visible = this.showHeat;
    this.root.add(this.heat);
  }

  private clear(): void {
    this.scene?.remove(this.root);
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    this.root.clear();
    this.rings = [];
    this.posts = [];
    this.heat = null;
    this.frames = 0;
  }

  dispose(): void {
    this.clear();
    this.panel.remove();
  }
}
