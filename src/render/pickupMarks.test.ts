import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { PickupMarks } from './pickupMarks';
import { CRATE_HEIGHT, PEDESTAL_HEIGHT, type PickupView } from './pickupView';

const tuning = loadTuningData();
const view = (id: number, form: PickupView['form'], over: Partial<PickupView> = {}): PickupView => ({ id, at: { x: id, y: 0, z: 0 }, form, pedestal: false, shown: true, label: false, distance: 1, ...over });

describe('the pickup marks', () => {
  it('draw a Weapon as its model and a Relic as a sprite, and drop a pickup that is gone', () => {
    const marks = new PickupMarks(tuning);
    const [weapon] = Object.keys(tuning.weapons);
    const relic = { kind: 'relic', relic: tuning.relics[0]!.name } as const;
    marks.update([view(0, { kind: 'weapon', weapon: weapon! }, { pedestal: true }), view(1, relic)], 0.1);
    const [a, b] = marks.root.children;
    expect(a!.visible && b!.visible).toBe(true);
    marks.update([view(1, relic), view(0, { kind: 'weapon', weapon: weapon! }, { shown: false })], 0.1);
    expect(a!.visible).toBe(true);
    expect(b!.visible).toBe(false);
    marks.dispose();
  });

  it('free the pooled Weapon models too when disposed, each geometry and material once', () => {
    const disposed = new Map<object, number>();
    const spy = (proto: { dispose(): void }) =>
      vi.spyOn(proto, 'dispose').mockImplementation(function (this: object) {
        disposed.set(this, (disposed.get(this) ?? 0) + 1);
      });
    const spies = [spy(THREE.BufferGeometry.prototype), spy(THREE.Material.prototype)];
    try {
      const marks = new PickupMarks(tuning);
      const names = Object.keys(tuning.weapons);
      marks.update(names.slice(0, 2).map((weapon, i) => view(i, { kind: 'weapon', weapon })), 0.1);
      const owned = new Set<object>();
      marks.root.traverse((o) => {
        const m = o as THREE.Mesh;
        // (A sprite's geometry is three.js's own, shared.)
        if (m.geometry && !(o instanceof THREE.Sprite)) owned.add(m.geometry);
        for (const material of [m.material].flat()) if (material) owned.add(material);
      });
      marks.dispose();
      expect(owned.size).toBeGreaterThan(10);
      for (const thing of owned) expect(disposed.get(thing), thing.constructor.name).toBe(1);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('a pedestal on a crate', () => {
  const relic = { kind: 'relic', relic: tuning.relics[0]!.name } as const;
  const parts = (marks: PickupMarks) => {
    const root = marks.root.children[0] as THREE.Group;
    const [pedestal, , sprite] = root.children as [THREE.Mesh, THREE.Mesh, THREE.Sprite];
    return { pedestal, sprite };
  };

  it('draws no cylinder and raises the item to the crate’s top, where a Hall-graph pedestal keeps its cylinder', () => {
    const crate = new PickupMarks(tuning);
    crate.update([view(0, relic, { pedestal: true, crate: true })], 0.1);
    expect(parts(crate).pedestal.visible).toBe(false);
    expect(parts(crate).sprite.position.y).toBeGreaterThan(CRATE_HEIGHT);
    const stand = new PickupMarks(tuning);
    stand.update([view(0, relic, { pedestal: true })], 0.1);
    expect(parts(stand).pedestal.visible).toBe(true);
    expect(parts(stand).sprite.position.y).toBeGreaterThan(PEDESTAL_HEIGHT);
    expect(parts(stand).sprite.position.y).toBeLessThan(CRATE_HEIGHT);
    crate.dispose();
    stand.dispose();
  });
});

