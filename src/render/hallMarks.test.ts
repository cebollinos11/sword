import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { arenaOf, type SimHall } from '../sim';
import { loadTuningData } from '../tuning';
import { HallMarks } from './hallMarks';

const tuning = loadTuningData();
const rest: SimHall = { floor: 1, row: 3, index: 0, kind: 'Rest', phase: 'Cleared' };

describe('the Hall marks', () => {
  it('dispose every geometry and material of a Rest Hall’s when rebuilt, the shared door frame’s aside', () => {
    const marks = new HallMarks();
    marks.update(arenaOf(tuning, 'gen:greybox:1:d4'), rest, 'lit');
    const watched: (THREE.BufferGeometry | THREE.Material)[] = [];
    marks.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) watched.push(m.geometry);
      // The frame's Standard material is the marks' own and outlives a rebuild.
      if (m.material && !(m.material instanceof THREE.MeshStandardMaterial)) watched.push(m.material as THREE.Material);
    });
    const disposed = new Set<unknown>();
    for (const r of new Set(watched)) r.addEventListener('dispose', () => disposed.add(r));
    marks.update(arenaOf(tuning, 'gen:greybox:2:d4'), rest, 'lit');
    expect(disposed.size).toBe(new Set(watched).size);
    expect([...watched].some((r) => r instanceof THREE.MeshBasicMaterial)).toBe(true);
  });

  it('draw the fire lit, then as embers once the local Player has rested', () => {
    const marks = new HallMarks();
    marks.update(arenaOf(tuning, 'gen:greybox:1:d4'), rest, 'lit');
    expect(marks.root.getObjectByName('flames')!.visible).toBe(true);
    marks.update(arenaOf(tuning, 'gen:greybox:1:d4'), rest, 'embers');
    expect(marks.root.getObjectByName('flames')!.visible).toBe(false);
    expect(marks.root.getObjectByName('embers')!.visible).toBe(true);
  });
});
