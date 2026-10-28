import { describe, expect, it } from 'vitest';
import type { Pickup } from '../sim';
import { AIM_RANGE, LABEL_RANGE, pickupView, pickupViews, type PickupEye } from './pickupView';

const pickup = (id: number, x: number, over: Partial<Pickup> = {}): Pickup => ({ id, owner: 0, kind: 'relic', item: 'Whetstone', at: { x, y: 0, z: 0 }, taken: false, ...over });

/** An eye 3 m behind the Fighter at `x`, looking along +z at the Treasure's row (a pickup per metre along x). */
const eye = (x: number, over: Partial<PickupEye> = {}): PickupEye => ({ at: { x, y: 1.7, z: -3 }, dir: { x: 0, y: -0.2, z: 1 }, near: { x, y: 0, z: 0 }, ...over });

describe('how a pickup is drawn', () => {
  it('a Weapon is drawn as that Weapon, a Relic as its icon', () => {
    expect(pickupView(pickup(0, 0, { kind: 'weapon', item: 'Arming Sword' }), 0, eye(0)).form).toEqual({ kind: 'weapon', weapon: 'Arming Sword' });
    expect(pickupView(pickup(1, 0, { kind: 'relic', item: 'Iron Plate' }), 0, eye(0)).form).toEqual({ kind: 'relic', relic: 'Iron Plate' });
  });

  it('is shown to its owner and for a shared one, never once taken', () => {
    expect(pickupView(pickup(0, 0), 0, eye(0)).shown).toBe(true);
    expect(pickupView(pickup(0, 0), 1, eye(0)).shown).toBe(false);
    expect(pickupView(pickup(0, 0, { owner: null }), 1, eye(0)).shown).toBe(true);
    expect(pickupView(pickup(0, 0, { taken: true }), 0, eye(0)).shown).toBe(false);
  });

  it('stands on a pedestal when it is one of a Treasure Hall’s', () => {
    expect(pickupView(pickup(0, 0), 0, eye(0)).pedestal).toBe(false);
    expect(pickupView(pickup(0, 0, { group: 0 }), 0, eye(0)).pedestal).toBe(true);
  });

  it('shows its label when near, not when far, and never when hidden', () => {
    expect(pickupView(pickup(0, 0), 0, eye(0)).label).toBe(true);
    expect(pickupView(pickup(0, LABEL_RANGE + 1), 0, eye(0, { dir: { x: 0, y: 0, z: -1 } })).label).toBe(false);
    expect(pickupView(pickup(0, 0, { taken: true }), 0, eye(0)).label).toBe(false);
  });
});

describe('the Treasure labels', () => {
  const treasure = [0, 1, 2].map((i) => pickup(i, (i - 1) * 1.12, { group: 0 }));
  const labelled = (views: ReturnType<typeof pickupViews>) => views.filter((v) => v.label).map((v) => v.id);
  /** Looking from 3 m behind the middle pedestal at the one at `x`. */
  const towards = (x: number): PickupEye => {
    const d = { x, y: 0.6 - 1.7, z: 3 };
    const len = Math.hypot(d.x, d.y, d.z);
    return eye(0, { dir: { x: d.x / len, y: d.y / len, z: d.z / len } });
  };

  it('show for exactly one pedestal at a time: the nearest one', () => {
    expect(labelled(pickupViews(treasure, 0, eye(-1.1)))).toEqual([0]);
    expect(labelled(pickupViews(treasure, 0, eye(0.1)))).toEqual([1]);
    expect(labelled(pickupViews(treasure, 0, eye(1.0)))).toEqual([2]);
  });

  it('follow the one the camera points at, when it is in range', () => {
    expect(labelled(pickupViews(treasure, 0, towards(1.12)))).toEqual([2]);
    expect(labelled(pickupViews(treasure, 0, towards(-1.12)))).toEqual([0]);
  });

  it('are none when every pickup is far and none is aimed at', () => {
    const away = eye(0, { near: { x: 0, y: 0, z: AIM_RANGE + 20 }, dir: { x: 0, y: 0, z: -1 } });
    expect(labelled(pickupViews(treasure, 0, away))).toEqual([]);
  });

  it('skip pickups the viewer does not see', () => {
    const mixed = [pickup(0, 0, { owner: 1 }), pickup(1, 0.5, { owner: 0 })];
    expect(labelled(pickupViews(mixed, 0, eye(0)))).toEqual([1]);
  });
});
