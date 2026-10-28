import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { DROP_KEY, EQUIP_KEYS, INVENTORY_LIST_KEY, inventoryKey } from './inventoryKeys';
import { LocalController } from './local';

describe('inventory keys', () => {
  it('number keys equip a slot and select it', () => {
    expect(inventoryKey('Digit2', null)).toEqual({ equip: { kind: 'weapon', slot: 1 }, selected: { kind: 'weapon', slot: 1 } });
    expect(inventoryKey('Digit9', null)).toEqual({ equip: { kind: 'relic', slot: 5 }, selected: { kind: 'relic', slot: 5 } });
  });

  it('the drop key drops the selected item and ends the selection, or does nothing with none', () => {
    const sel = { kind: 'relic', slot: 2 } as const;
    expect(inventoryKey(DROP_KEY, sel)).toEqual({ drop: sel, selected: null });
    expect(inventoryKey(DROP_KEY, null)).toEqual({ selected: null });
  });

  it('other keys are not its', () => {
    for (const code of ['KeyW', 'KeyE', 'KeyQ', 'KeyF', 'KeyR', 'KeyC', 'Space', 'ControlLeft', 'Escape', 'Digit0', INVENTORY_LIST_KEY]) expect(inventoryKey(code, null)).toBeNull();
  });

  it('the keys cover the inventory sizes', () => {
    const { weapons, relics } = loadTuningData().dungeon.inventory;
    expect(Object.values(EQUIP_KEYS).filter((r) => r.kind === 'weapon')).toHaveLength(weapons);
    expect(Object.values(EQUIP_KEYS).filter((r) => r.kind === 'relic')).toHaveLength(relics);
  });

  it('the Local Controller sends equip and drop on one Tick each', () => {
    const local = new LocalController();
    local.keyDown('Digit5');
    expect(local.sample().equip).toEqual({ kind: 'relic', slot: 1 });
    expect(local.sample().equip).toBeUndefined();
    local.keyDown('KeyX');
    const intent = local.sample();
    expect(intent.drop).toEqual({ kind: 'relic', slot: 1 });
    expect(intent.equip).toBeUndefined();
    expect(local.sample().drop).toBeUndefined();
    local.keyDown('KeyX');
    expect(local.sample().drop).toBeUndefined();
    local.keyDown('Digit1');
    local.releaseAll();
    expect(local.sample().equip).toBeUndefined();
  });
});
