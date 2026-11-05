import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { DROP_KEY, EQUIP_KEYS, INVENTORY_LIST_KEY, inventoryClick, inventoryKey } from './inventoryKeys';
import { LocalController } from './local';

describe('inventory keys', () => {
  it('number keys equip a slot and select it', () => {
    expect(inventoryKey('Digit2', null)).toEqual({ equip: { kind: 'weapon', slot: 1 }, selected: { kind: 'weapon', slot: 1 } });
    expect(inventoryKey('Digit9', null)).toEqual({ equip: { kind: 'relic', slot: 5 }, selected: { kind: 'relic', slot: 5 } });
  });

  it('a number key held with Shift selects the slot without equipping it', () => {
    expect(inventoryKey('Digit1', null, true)).toEqual({ selected: { kind: 'weapon', slot: 0 } });
    expect(inventoryKey('Digit9', { kind: 'weapon', slot: 0 }, true)).toEqual({ selected: { kind: 'relic', slot: 5 } });
    expect(inventoryKey(DROP_KEY, null, true)).toEqual({ selected: null });
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

  it('the Local Controller drops a carried Weapon: Shift and a number select it, X drops it, nothing is equipped', () => {
    const local = new LocalController();
    local.keyDown('Digit1', true);
    expect(local.sample().equip).toBeUndefined();
    local.keyDown('KeyX');
    const intent = local.sample();
    expect(intent.drop).toEqual({ kind: 'weapon', slot: 0 });
    expect(intent.equip).toBeUndefined();
  });

  it('a click on an item asks what the key for it would: equip selects the item, drop ends the selection', () => {
    const ref = { kind: 'relic', slot: 4 } as const;
    expect(inventoryClick(ref, 'equip')).toEqual(inventoryKey('Digit8', null));
    expect(inventoryClick(ref, 'drop')).toEqual(inventoryKey(DROP_KEY, ref));
  });

  it("the Local Controller sends a click's equip and drop on one Tick each, however many frames come between Ticks", () => {
    const local = new LocalController();
    local.inventoryClick({ kind: 'weapon', slot: 2 }, 'equip');
    expect(local.sample().equip).toEqual({ kind: 'weapon', slot: 2 });
    expect(local.sample().equip).toBeUndefined();
    local.inventoryClick({ kind: 'relic', slot: 3 }, 'drop');
    const intent = local.sample();
    expect(intent.drop).toEqual({ kind: 'relic', slot: 3 });
    expect(intent.equip).toBeUndefined();
    expect(local.sample().drop).toBeUndefined();
    // Two clicks inside one Tick (a double click on a slow frame): the Simulation gets one equip, the later.
    local.inventoryClick({ kind: 'relic', slot: 0 }, 'equip');
    local.inventoryClick({ kind: 'relic', slot: 1 }, 'equip');
    expect(local.sample().equip).toEqual({ kind: 'relic', slot: 1 });
    expect(local.sample().equip).toBeUndefined();
  });

  it('a click selects the item like its key does, so X drops the item last clicked', () => {
    const local = new LocalController();
    local.inventoryClick({ kind: 'relic', slot: 2 }, 'equip');
    local.sample();
    local.keyDown('KeyX');
    expect(local.sample().drop).toEqual({ kind: 'relic', slot: 2 });
  });
});
