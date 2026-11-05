import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { arenaOf } from '../sim';
import { loadTuningData } from '../tuning';
import type { DoorMarkView } from '../play/doorMarks';
import { DoorMarks, fallbackGate, type DoorGate } from './doorMarks';

describe('DoorMarks', () => {
  const tuning = loadTuningData();
  const arena = arenaOf(tuning, 'gen:greybox:12:d3');
  const hall = (index: number, phase: 'Fighting' | 'Cleared' = 'Fighting') => ({ floor: 1, row: 1, index, kind: 'Fight' as const, phase });
  const mark = (exit: number, over: Partial<DoorMarkView> = {}): DoorMarkView => ({ exit, icon: 'Fight', label: '', count: '', gate: 'closed', ...over });
  const marks = (over: Partial<DoorMarkView> = {}) => [mark(0, over), mark(1, over)];

  /** Every geometry and material under `root`, with a count of how many of them have been disposed. */
  function watch(root: THREE.Object3D) {
    const all = new Set<THREE.BufferGeometry | THREE.Material>();
    const disposed = new Set<unknown>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      // A Sprite's geometry is three.js' one shared quad, never ours to free.
      for (const r of [o instanceof THREE.Sprite ? undefined : m.geometry, ...[m.material].flat()]) if (r) all.add(r);
    });
    for (const r of all) r.addEventListener('dispose', () => disposed.add(r));
    return { made: all.size, disposed: () => disposed.size };
  }

  it('draws an icon sprite and a gate per exit Door, and nothing for the entrance', () => {
    expect(arena.doors.length).toBeGreaterThan(2);
    const gates: number[] = [];
    const gate = (): DoorGate => ({ object: new THREE.Group(), setOpen: () => undefined, dispose: () => undefined });
    const marksOf = new DoorMarks((door) => (gates.push(arena.doors.indexOf(door)), gate()));
    marksOf.update(arena, hall(0), marks());
    expect(gates).toEqual([1, 2]);
    expect(marksOf.root.children.filter((c) => c instanceof THREE.Sprite || c.children.some((k) => k instanceof THREE.Sprite))).toHaveLength(2);
    marksOf.update(arena, undefined, []);
    expect(marksOf.root.children).toHaveLength(0);
  });

  it('opens the gate with the Hall, without rebuilding', () => {
    const open: boolean[] = [];
    const marksOf = new DoorMarks(() => ({ object: new THREE.Group(), setOpen: (o) => open.push(o), dispose: () => undefined }));
    marksOf.update(arena, hall(0), marks());
    const first = marksOf.root.children[0];
    marksOf.update(arena, hall(0, 'Cleared'), marks({ gate: 'open', count: '1 / 2' }));
    expect(marksOf.root.children[0]).toBe(first);
    expect(open.at(-1)).toBe(true);
    expect(open.at(-2)).toBe(true);
  });

  it('disposes every geometry, material and texture it made when the Hall changes or ends', () => {
    const marksOf = new DoorMarks();
    marksOf.update(arena, hall(0), marks({ label: 'Floor 2' }));
    const first = watch(marksOf.root);
    expect(first.made).toBeGreaterThan(4);
    marksOf.update(arena, hall(1), marks());
    expect(first.disposed()).toBe(first.made);
    const second = watch(marksOf.root);
    marksOf.update(arena, undefined, []);
    expect(second.disposed()).toBe(second.made);
    expect(marksOf.root.children).toHaveLength(0);
  });

  it('keeps the marks while only the counts and the gate change', () => {
    const marksOf = new DoorMarks();
    marksOf.update(arena, hall(0), marks());
    const watched = watch(marksOf.root);
    marksOf.update(arena, hall(0, 'Cleared'), marks({ gate: 'open', count: '2 / 2' }));
    expect(watched.disposed()).toBe(0);
  });

  it('draws the fallback gate in a light, warm iron the dark Walls do not hide, and frees all of it', () => {
    const gate = fallbackGate(arena.doors[1]!);
    const watched = watch(gate.object);
    const colours: THREE.Color[] = [];
    gate.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) colours.push((m.material as THREE.MeshStandardMaterial).color);
    });
    expect(colours.length).toBeGreaterThan(3);
    for (const c of colours) {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.l).toBeGreaterThan(0.5);
      expect(c.r).toBeGreaterThan(c.b);
    }
    gate.dispose();
    expect(watched.disposed()).toBe(watched.made);
  });
});
