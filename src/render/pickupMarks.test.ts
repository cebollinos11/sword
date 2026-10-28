import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { PickupMarks } from './pickupMarks';
import type { PickupView } from './pickupView';

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
});
