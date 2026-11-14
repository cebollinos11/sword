import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createMatch } from '../sim';
import { BOSS } from '../sim/warband';
import { floorOf } from '../sim/delver';
import { loadTuningData, type TuningData } from '../tuning';
import { pedestalRings, StairsStandIn } from './delverStandIns';
import { DelverMarks, fireStates, gateState, type DelverMarksView } from './delverMarks';

describe('the Delver Floor’s fires as the local Player sees them', () => {
  it('burns each fire until the viewer is among those who took its heal, then embers, in fire order', () => {
    const used = [
      { revived: true, healed: [0, 2] },
      { revived: false, healed: [] },
      { revived: true, healed: [1] },
    ];
    expect(fireStates(used, 0)).toEqual(['embers', 'lit', 'lit']);
    expect(fireStates(used, 1)).toEqual(['lit', 'lit', 'embers']);
    expect(fireStates(used, -1)).toEqual(['lit', 'lit', 'lit']);
    expect(fireStates([], 0)).toEqual([]);
  });
});

describe('the Boss Hall’s gate', () => {
  const base = loadTuningData();
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 2, floorsPerTier: 1, postFill: 0, patrolFill: 0 } };
  const boss = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0] });
  const plan = floorOf(tuning, boss.arena)!.plan;
  const crowd = boss.duel.crowd!;
  const q = crowd.warbands!.rank.indexOf(BOSS);
  const view = (gate: 'none' | 'closed' | 'open'): DelverMarksView => ({ plan, restUsed: [], me: 0, fireRadius: tuning.delver.fireRadius, gate });
  const barsOf = (marks: DelverMarks) => marks.root.getObjectByName('gate') as THREE.Group | undefined;

  it('reads shut before the Boss Warband is wiped and open after, and none on a Floor without a Boss Hall', () => {
    expect(q).toBeGreaterThanOrEqual(0);
    expect(gateState(plan, crowd, [])).toBe('closed');
    expect(gateState(plan, crowd, [q])).toBe('open');
    const plain = floorOf({ ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((t) => ({ ...t, boss: undefined })) } }, boss.arena)!.plan;
    expect(gateState(plain, crowd, [])).toBe('none');
  });

  it('stands its bars while shut, and sinks them once open', () => {
    const marks = new DelverMarks();
    marks.update(view('closed'));
    const gate = barsOf(marks)!;
    expect(gate.children.length).toBeGreaterThan(8);
    expect(gate.visible).toBe(true);
    expect(gate.position.y).toBe(plan.markers.stairs.y);
    marks.update(view('open'));
    marks.animate(0.3);
    expect(gate.visible).toBe(true);
    expect(gate.position.y).toBeLessThan(plan.markers.stairs.y);
    marks.animate(5);
    expect(gate.visible).toBe(false);
  });

  it('is sunk from the start on a Floor entered with the gate open, and drawn not at all with none', () => {
    const open = new DelverMarks();
    open.update(view('open'));
    expect(barsOf(open)!.visible).toBe(false);
    const none = new DelverMarks();
    none.update(view('none'));
    expect(barsOf(none)).toBeUndefined();
  });

  it('draws the bars round the Stairs square', () => {
    const marks = new DelverMarks();
    marks.update(view('closed'));
    const { zone } = plan.markers.stairs;
    for (const bar of barsOf(marks)!.children) {
      expect(bar.position.x).toBeGreaterThanOrEqual(zone.x0 - 0.5);
      expect(bar.position.x).toBeLessThanOrEqual(zone.x1 + 0.5);
      expect(bar.position.z).toBeGreaterThanOrEqual(zone.z0 - 0.5);
      expect(bar.position.z).toBeLessThanOrEqual(zone.z1 + 0.5);
    }
  });
});

describe('the Delver stand-ins', () => {
  it('builds the Stairs pit, glows while they count and dulls while the gate is shut, and disposes what it made', () => {
    const stairs = new StairsStandIn({ x0: 0, x1: 4, z0: 0, z1: 4 });
    expect(stairs.root.position.toArray()).toEqual([2, 0, 2]);
    expect(stairs.root.children.length).toBeGreaterThanOrEqual(4);
    const glow = (stairs.root.children[stairs.root.children.length - 1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    stairs.setOpen(true);
    const open = glow.color.getHex();
    stairs.setOpen(false);
    expect(glow.color.getHex()).not.toBe(open);
    stairs.dispose();
  });

  it('puts a ring on the ground at each pedestal', () => {
    const rings = pedestalRings([{ x: 1, z: 2 }, { x: 4, z: 2 }]);
    expect(rings.meshes.map((m) => [m.position.x, m.position.z])).toEqual([[1, 2], [4, 2]]);
    for (const r of rings.owned) r.dispose();
  });
});

describe('the Delver marks on a levelled Floor', () => {
  const base = loadTuningData();
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 2, floorsPerTier: 1, postFill: 0, patrolFill: 0 } };
  const flat = floorOf(tuning, createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0] }).arena)!.plan;
  const at4 = <T extends { y: number }>(p: T): T => ({ ...p, y: 4 });
  const plan = { ...flat, markers: { ...flat.markers, stairs: at4(flat.markers.stairs), fires: flat.markers.fires.map(at4), pedestals: flat.markers.pedestals.map(at4) } };
  const view: DelverMarksView = { plan, restUsed: [], me: 0, fireRadius: tuning.delver.fireRadius, gate: 'closed' };

  it('stands the Stairs stand-in, the gate, each fire and its ring, and the pedestal rings at their marker’s y', () => {
    expect(plan.markers.fires.length).toBeGreaterThan(0);
    const marks = new DelverMarks();
    marks.update(view);
    expect(marks.root.getObjectByName('gate')!.position.y).toBe(4);
    const ys = marks.root.children.map((c) => c.position.y);
    expect(ys.every((y) => y >= 4)).toBe(true);
    for (const at of plan.markers.fires) {
      const near = marks.root.children.filter((c) => c.position.x === at.x && c.position.z === at.z);
      expect(near.length).toBe(2);
      for (const c of near) expect(c.position.y).toBeGreaterThanOrEqual(4);
      expect(near.every((c) => c.position.y < 4.1)).toBe(true);
    }
    marks.update({ ...view, gate: 'open' });
    marks.animate(0.3);
    expect(marks.root.getObjectByName('gate')!.position.y).toBeLessThan(4);
    marks.animate(5);
    expect(marks.root.getObjectByName('gate')!.visible).toBe(false);
  });

  it('puts the stand-ins at the height given', () => {
    const stairs = new StairsStandIn({ x0: 0, x1: 4, z0: 0, z1: 4 }, 4);
    expect(stairs.root.position.toArray()).toEqual([2, 4, 2]);
    stairs.dispose();
    const rings = pedestalRings([{ x: 1, y: 2, z: 2 }]);
    expect(rings.meshes[0]!.position.y).toBeGreaterThan(2);
    expect(rings.meshes[0]!.position.y).toBeLessThan(2.1);
    for (const r of rings.owned) r.dispose();
  });
});
