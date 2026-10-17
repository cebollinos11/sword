/**
 * The sandbox's Action/phase overlay: a label floating over each Fighter's
 * head with its current Action (and phase) and HP, coloured like the Fighter.
 */
import * as THREE from 'three';
import type { Action, SimState } from '../sim';
import { FIGHTER_COLOURS } from '../render/fighterView';

export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'Attack':
      return `Attack ${a.direction} · ${a.phase}`;
    case 'Block':
      return `Block ${a.direction}`;
    case 'Kick':
      return `Kick · ${a.phase}`;
    case 'Knockdown':
      return `Knockdown · ${a.phase}${a.guard ? ` · guard ${a.guard}` : ''}`;
    case 'Stagger':
      return `Stagger (${a.cause})`;
    case 'Idle':
    case 'Fall':
      return a.kind;
  }
}

/** Height above the floor (m) the label is anchored at: just over a Fighter's head. */
const LABEL_HEIGHT = 2.05;

export class ActionLabels {
  private readonly labels: HTMLDivElement[];
  private readonly point = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    fighters = 2,
  ) {
    this.labels = Array.from({ length: fighters }, (_, i) => {
      const el = document.createElement('div');
      const colour = `#${(FIGHTER_COLOURS[i] ?? 0xffffff).toString(16).padStart(6, '0')}`;
      Object.assign(el.style, {
        position: 'fixed',
        transform: 'translate(-50%, -100%)',
        padding: '2px 6px',
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.6)',
        color: '#fff',
        borderLeft: `3px solid ${colour}`,
        font: '12px/1.3 system-ui, sans-serif',
        whiteSpace: 'pre',
        pointerEvents: 'none',
        zIndex: '5',
      });
      document.body.appendChild(el);
      return el;
    });
  }

  update(state: SimState, visible: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    this.labels.forEach((el, i) => {
      const f = state.fighters[i];
      if (!visible || !f) {
        el.style.display = 'none';
        return;
      }
      this.point.set(f.position.x, f.y + LABEL_HEIGHT, f.position.z).project(this.camera);
      const behind = this.point.z > 1;
      el.style.display = behind ? 'none' : 'block';
      el.style.left = `${rect.left + ((this.point.x + 1) / 2) * rect.width}px`;
      el.style.top = `${rect.top + ((1 - this.point.y) / 2) * rect.height}px`;
      el.textContent = `${describeAction(f.action)}\nHP ${f.hp.toFixed(1)}`;
    });
  }
}
