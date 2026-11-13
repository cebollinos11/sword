import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createMatch } from '../sim';
import { BOSS } from '../sim/warband';
import { floorOf } from '../sim/delver';
import { loadTuningData, type TuningData } from '../tuning';
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
    expect(gate.position.y).toBe(0);
    marks.update(view('open'));
    marks.animate(0.3);
    expect(gate.visible).toBe(true);
    expect(gate.position.y).toBeLessThan(0);
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
