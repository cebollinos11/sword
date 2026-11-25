import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { FighterState } from '../sim';
import { FIRST_PERSON_BLEND_SECONDS, firstPersonBlocked, FirstPersonView, placeFirstPersonCamera } from './firstPerson';

const fighter = (action: unknown, extra: Partial<FighterState> = {}) => ({ action, ...extra }) as unknown as FighterState;

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('firstPersonBlocked', () => {
  it('steps out for a Whirlwind, a Knockdown, a hard Landing and a Death', () => {
    expect(firstPersonBlocked(fighter({ kind: 'Whirlwind', phase: 'Spin' }))).toBe(true);
    expect(firstPersonBlocked(fighter({ kind: 'Whirlwind', phase: 'Wind-up' }))).toBe(true);
    expect(firstPersonBlocked(fighter({ kind: 'Knockdown', phase: 'Down' }))).toBe(true);
    expect(firstPersonBlocked(fighter({ kind: 'Stagger', cause: 'Landed' }))).toBe(true);
    expect(firstPersonBlocked(fighter({ kind: 'Idle' }, { death: {} as FighterState['death'] }))).toBe(true);
    expect(firstPersonBlocked(undefined)).toBe(true);
  });

  it('stays in for fighting as usual: guard, Attacks, Blocks, a hit Stagger, a Kick, a Jump', () => {
    for (const a of [{ kind: 'Idle' }, { kind: 'Attack' }, { kind: 'Block' }, { kind: 'Stagger', cause: 'Hit' }, { kind: 'Kick' }, { kind: 'Fall' }]) {
      expect(firstPersonBlocked(fighter(a))).toBe(false);
    }
  });
});

describe('FirstPersonView', () => {
  it('starts in third person, and remembers the choice', () => {
    const storage = memory();
    const view = new FirstPersonView(storage);
    expect(view.enabled).toBe(false);
    view.toggle();
    expect(new FirstPersonView(storage).enabled).toBe(true);
  });

  it('swings in over the blend time, and back out while blocked', () => {
    const view = new FirstPersonView(memory());
    view.toggle();
    view.update(FIRST_PERSON_BLEND_SECONDS / 2, false);
    expect(view.blend).toBeCloseTo(0.5);
    expect(view.hidesBody).toBe(false);
    view.update(FIRST_PERSON_BLEND_SECONDS, false);
    expect(view.blend).toBe(1);
    expect(view.hidesBody).toBe(true);
    view.update(FIRST_PERSON_BLEND_SECONDS, true);
    expect(view.blend).toBe(0);
    view.update(FIRST_PERSON_BLEND_SECONDS, false);
    expect(view.blend).toBe(1);
  });

  it('leaves the third-person camera alone at blend 0, and puts it at the eye at blend 1', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 5, 5);
    const view = new FirstPersonView(memory());
    view.apply(camera, { x: 0, y: 1.7, z: 0 }, 0, 0);
    expect(camera.position.toArray()).toEqual([5, 5, 5]);
    view.toggle();
    view.update(1, false);
    view.apply(camera, { x: 0, y: 1.7, z: 0 }, 0, 0);
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeCloseTo(1.7);
    expect(camera.position.z).toBeGreaterThan(0);
  });
});

describe('placeFirstPersonCamera', () => {
  it('looks along the aim: yaw 0 is +z, + pitch looks up', () => {
    const camera = new THREE.PerspectiveCamera();
    const dir = new THREE.Vector3();
    placeFirstPersonCamera(camera, { x: 0, y: 1.7, z: 0 }, 0, 0);
    camera.getWorldDirection(dir);
    expect(dir.z).toBeCloseTo(1);
    placeFirstPersonCamera(camera, { x: 0, y: 1.7, z: 0 }, Math.PI / 2, 0.5);
    camera.getWorldDirection(dir);
    expect(dir.x).toBeCloseTo(Math.cos(0.5));
    expect(dir.y).toBeCloseTo(Math.sin(0.5));
  });
});
