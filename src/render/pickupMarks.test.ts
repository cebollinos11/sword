import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { GLOW_LIGHTS, PickupMarks } from './pickupMarks';
import { RARITY_COLOUR, rarityTint } from './rarityColours';
import { STEEL_EMISSIVE } from './steel';
import { CRATE_HEIGHT, PEDESTAL_HEIGHT, type PickupView } from './pickupView';

const tuning = loadTuningData();
const view = (id: number, form: PickupView['form'], over: Partial<PickupView> = {}): PickupView => ({ id, at: { x: id, y: 0, z: 0 }, form, rarity: 'Common', glow: null, pedestal: false, shown: true, label: false, distance: 1, ...over });

/** The marks' slot groups (the glow lights are its other children). */
const slotsOf = (marks: PickupMarks): THREE.Object3D[] => marks.root.children.filter((c) => !(c instanceof THREE.Light));
const lightsOf = (marks: PickupMarks): THREE.PointLight[] => {
  const found: THREE.PointLight[] = [];
  marks.root.traverse((o) => o instanceof THREE.PointLight && found.push(o));
  return found;
};

describe('the pickup marks', () => {
  it('draw a Weapon as its model and a Relic as a sprite, and drop a pickup that is gone', () => {
    const marks = new PickupMarks(tuning);
    const [weapon] = Object.keys(tuning.weapons);
    const relic = { kind: 'relic', relic: tuning.relics[0]!.name } as const;
    marks.update([view(0, { kind: 'weapon', weapon: weapon! }, { pedestal: true }), view(1, relic)], 0.1);
    const [a, b] = slotsOf(marks);
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
    const root = slotsOf(marks)[0] as THREE.Group;
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


describe('a glowing pickup', () => {
  const [weapon] = Object.keys(tuning.weapons);
  const sword = { kind: 'weapon', weapon: weapon! } as const;
  const glowing = (id: number, rarity: 'Rare' | 'Legendary', distance = id): PickupView => view(id, sword, { rarity, glow: rarity, distance });
  const ringOf = (marks: PickupMarks, slot: number) => (slotsOf(marks)[slot] as THREE.Group).children[3] as THREE.Mesh;

  it('has a ring only when Rare or Legendary, in its colour', () => {
    const marks = new PickupMarks(tuning);
    marks.update([view(0, sword), glowing(1, 'Rare'), glowing(2, 'Legendary')], 0.1);
    expect(ringOf(marks, 0).visible).toBe(false);
    expect(ringOf(marks, 1).visible).toBe(true);
    expect(ringOf(marks, 2).visible).toBe(true);
    expect((ringOf(marks, 1).material as THREE.MeshBasicMaterial).color.getHex()).toBe(RARITY_COLOUR.Rare);
    expect((ringOf(marks, 2).material as THREE.MeshBasicMaterial).color.getHex()).toBe(RARITY_COLOUR.Legendary);
    marks.dispose();
  });

  it('keeps the scene at GLOW_LIGHTS lights however many pickups show, the nearest 4 lit in their colours', () => {
    const marks = new PickupMarks(tuning);
    expect(lightsOf(marks)).toHaveLength(GLOW_LIGHTS);
    // Listed far to near, so the order given is not the order lit.
    const six = [0, 1, 2, 3, 4, 5].map((i) => glowing(i, i % 2 ? 'Rare' : 'Legendary', 10 - i));
    marks.update(six, 0.1);
    const lights = lightsOf(marks);
    expect(lights).toHaveLength(GLOW_LIGHTS);
    expect(lights.every((l) => l.intensity > 0)).toBe(true);
    const nearest = six.slice(2).map((v) => RARITY_COLOUR[v.glow!]).sort();
    expect(lights.map((l) => l.color.getHex()).sort()).toEqual(nearest);
    expect(lights.map((l) => l.position.x).sort()).toEqual([2, 3, 4, 5]);
    marks.dispose();
  });

  it('leaves every light dark with no glowing pickup', () => {
    const marks = new PickupMarks(tuning);
    expect(lightsOf(marks).every((l) => l.intensity === 0)).toBe(true);
    marks.update([view(0, sword), glowing(1, 'Rare')], 0.1);
    expect(lightsOf(marks).filter((l) => l.intensity > 0)).toHaveLength(1);
    marks.update([view(0, sword)], 0.1);
    expect(lightsOf(marks)).toHaveLength(GLOW_LIGHTS);
    expect(lightsOf(marks).every((l) => l.intensity === 0)).toBe(true);
    marks.dispose();
  });

  it('tints a lying Weapon’s steel, and only that one’s', () => {
    const marks = new PickupMarks(tuning);
    marks.update([glowing(0, 'Legendary'), view(1, sword)], 0.1);
    const emissives = slotsOf(marks).map((slot) => {
      const found = new Set<number>();
      slot.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (m?.color?.getHex() === 0xeef2f6) found.add(m.emissive.getHex());
      });
      return [...found];
    });
    expect(emissives[0]).toEqual([rarityTint(STEEL_EMISSIVE, 'Legendary')]);
    expect(emissives[1]).toEqual([STEEL_EMISSIVE]);
    marks.dispose();
  });
});
