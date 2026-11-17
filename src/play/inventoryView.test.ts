import { describe, expect, it } from 'vitest';
import { canChangeInventory, commonItem, createMatch, holdInventory, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, stepMatch, type DelverPhase, type FighterState, type Inventory, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { inventoryLock, inventoryView, inventoryViewKey, type ItemView } from './inventoryView';

const tuning = loadTuningData();
const [W0, W1, W2] = Object.keys(tuning.weapons) as [string, string, string];
/** Common Items by name. */
const commons = (...names: string[]) => names.map(commonItem);

const newRun = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });

/** A Player's Fighter in a Run, holding `inv` (its Mods folded), Idle and on the ground. */
function fighter(inv: Partial<Inventory> = {}): FighterState {
  const f = newRun().duel.fighters[0]!;
  return holdInventory(f, { ...f.inventory!, weapons: commons(W0, W1), relics: commons('Whetstone', 'Iron Plate'), weapon: 0, equipped: [1], ...inv }, tuning);
}

/** A Run's phases as the screen gets them (`DelverContext`). */
const EXPLORING = { phase: 'Exploring' } as const;
const DESCENDING = { phase: 'Descending' } as const;

const items = (list: readonly { item: ItemView | null }[]): ItemView[] => list.flatMap((s) => (s.item ? [s.item] : []));

describe('the inventory view', () => {
  it('has a slot per size in the Tuning Data, filled in the order picked up, the rest empty', () => {
    const v = inventoryView(fighter(), tuning, EXPLORING)!;
    const sizes = tuning.dungeon.inventory;
    expect(v.weapons).toHaveLength(sizes.weapons);
    expect(v.relics).toHaveLength(sizes.relics);
    expect(v.weapons.map((s) => s.item?.name ?? null)).toEqual([W0, W1, null]);
    expect(v.relics.map((s) => s.item?.name ?? null)).toEqual(['Whetstone', 'Iron Plate', null, null, null, null]);
    expect(v.weapons.map((s) => s.ref)).toEqual([0, 1, 2].map((slot) => ({ kind: 'weapon', slot })));
    expect(v.relics[5]!.ref).toEqual({ kind: 'relic', slot: 5 });
    expect(v.relicsEquipped).toBe('1 / 3 equipped');
  });

  it('is null for a Fighter with no inventory (outside a Run)', () => {
    const { inventory: _gone, ...bare } = fighter();
    expect(inventoryView(bare, tuning, EXPLORING)).toBeNull();
    expect(inventoryView(undefined, tuning, EXPLORING)).toBeNull();
  });

  it('marks the Weapon wielded and the Relics equipped, and gives each item its icon and each Relic its effects in words', () => {
    const v = inventoryView(fighter(), tuning, EXPLORING)!;
    const [w0, w1] = items(v.weapons);
    const [whetstone, plate] = items(v.relics);
    expect([w0!.marked, w1!.marked]).toEqual([true, false]);
    expect([whetstone!.marked, plate!.marked]).toEqual([false, true]);
    expect(whetstone!.words).toBe('+10% damage');
    expect(plate!.words).toBe('-10% damage taken');
    expect(w0!.words).toBe('');
    for (const item of [w0!, w1!, whetstone!, plate!]) expect(item.icon).toContain('<svg');
  });

  it("shows the Fighter's numbers: damage and damage taken as factors, max HP, daggers held of daggers carried", () => {
    const v = inventoryView(fighter({ equipped: [0, 1] }), tuning, EXPLORING)!;
    expect(v.numbers).toEqual([
      { label: 'Damage', value: '×1.1' },
      { label: 'Damage taken', value: '×0.9' },
      { label: 'Max HP', value: String(Math.round(tuning.fighter.maxHp)) },
      { label: 'Daggers', value: `${tuning.dagger.count} / ${tuning.dagger.count}` },
    ]);
    const bare = inventoryView(fighter({ equipped: [] }), tuning, EXPLORING)!;
    expect(bare.numbers[0]!.value).toBe('×1');
    expect(bare.numbers[1]!.value).toBe('×1');
  });

  it('shows the numbers the equipped Relics give: more max HP and more daggers', () => {
    const hp = tuning.relics.find((r) => r.effects.maxHp)!;
    const dag = tuning.relics.find((r) => r.effects.daggers)!;
    const f = fighter({ relics: commons(hp.name, dag.name), equipped: [0, 1] });
    const v = inventoryView(f, tuning, EXPLORING)!;
    expect(v.numbers[2]!.value).toBe(String(Math.round(tuning.fighter.maxHp * (1 + hp.effects.maxHp!))));
    expect(v.numbers[3]!.value).toBe(`${f.daggers} / ${tuning.dagger.count + dag.effects.daggers!}`);
  });

  it('offers a carried Weapon to wield and to drop, the wielded Weapon to neither', () => {
    const [wielded, carried] = items(inventoryView(fighter(), tuning, EXPLORING)!.weapons);
    expect(wielded!.drop).toBeNull();
    expect(wielded!.equip).toBeNull();
    expect(carried!.equip).toEqual({ label: 'Wield', available: true, reason: null });
    expect(carried!.drop).toEqual({ label: 'Drop', available: true, reason: null });
  });

  it('never offers the wielded Weapon for a drop, whichever slot it is in', () => {
    for (const weapon of [0, 1, 2]) {
      for (const phase of [EXPLORING, DESCENDING]) {
        const v = inventoryView(fighter({ weapons: commons(W0, W1, W2), weapon }), tuning, phase)!;
        expect(v.weapons.map((s) => s.item!.drop === null)).toEqual([0, 1, 2].map((s) => s === weapon));
        expect(v.weapons[weapon]!.item!.marked).toBe(true);
      }
    }
  });

  it('a Relic toggles: Equip when off, Unequip when on, both droppable', () => {
    const [off, on] = items(inventoryView(fighter(), tuning, EXPLORING)!.relics);
    expect(off!.equip).toEqual({ label: 'Equip', available: true, reason: null });
    expect(on!.equip).toEqual({ label: 'Unequip', available: true, reason: null });
    expect(off!.drop!.available && on!.drop!.available).toBe(true);
  });

  it('a Relic cannot be equipped with every equipped slot taken, but one equipped can come off', () => {
    const v = inventoryView(fighter({ relics: commons('Whetstone', 'Iron Plate', 'Whetstone', 'Whetstone'), equipped: [0, 1, 2] }), tuning, EXPLORING)!;
    const [a, , , d] = items(v.relics);
    expect(d!.equip).toEqual({ label: 'Equip', available: false, reason: 'Relic slots full (3 / 3)' });
    expect(a!.equip!.available).toBe(true);
    expect(d!.drop!.available).toBe(true);
  });

  it('every action is available while Exploring, a Warband near or not', () => {
    const v = inventoryView(fighter({ weapons: commons(W0, W1, W2), relics: commons('Whetstone', 'Iron Plate') }), tuning, EXPLORING)!;
    expect(v.lock).toBeNull();
    const all = [...items(v.weapons), ...items(v.relics)];
    expect(all.length).toBe(5);
    for (const item of all) for (const action of [item.equip, item.drop]) if (action) expect(action).toMatchObject({ available: true, reason: null });
  });

  it('every action is unavailable while the party Descends, the Fighter has fallen, is mid-Action or is in the air', () => {
    const f = fighter();
    const airborne = { ...f, air: { vy: 1 } } as unknown as FighterState;
    expect(inventoryView(f, tuning, EXPLORING)!.lock).toBeNull();
    expect(inventoryView(f, tuning, DESCENDING)!.lock).toBe('Descending');
    expect(inventoryView({ ...f, hp: 0 }, tuning, EXPLORING)!.lock).toBe('You have fallen');
    expect(inventoryView({ ...f, action: { kind: 'Kick' } } as unknown as FighterState, tuning, EXPLORING)!.lock).toBe('Finish your move');
    const v = inventoryView(airborne, tuning, EXPLORING)!;
    expect(v.lock).toBe('Land first');
    for (const item of [...items(v.weapons), ...items(v.relics)]) for (const action of [item.equip, item.drop]) expect(action?.available ?? false).toBe(false);
  });

  it("is locked exactly when the Simulation would refuse: Exploring, the Fighter living, Idle and on the ground (`canChangeInventory`)", () => {
    const f = fighter();
    const states: [FighterState, DelverPhase | undefined][] = [
      [f, 'Exploring'],
      [f, 'Descending'],
      [f, undefined],
      [{ ...f, hp: 0 }, 'Exploring'],
      [{ ...f, benched: true }, 'Exploring'],
      [{ ...f, action: { kind: 'Block' } } as unknown as FighterState, 'Exploring'],
      [{ ...f, air: { vy: 0 } } as unknown as FighterState, 'Exploring'],
    ];
    for (const [state, phase] of states) {
      const accepts = phase === 'Exploring' && canChangeInventory(state) && inDuel(state);
      expect(inventoryLock(state, phase && { phase }) === null, JSON.stringify([phase, state.action, state.hp, state.benched])).toBe(accepts);
    }
  });
});

describe('what the view offers is what the Simulation acts on', () => {
  /** A Run for Player 0 with these items, stepped once. */
  function run(): MatchState {
    const m = newRun();
    const stocked = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? holdInventory(f, { ...f.inventory!, weapons: commons(W0, W1), relics: commons('Whetstone', 'Iron Plate'), weapon: 0, equipped: [] }, tuning) : f)) } };
    return stepMatch(stocked, stocked.duel.fighters.map(() => IDLE_INTENT), tuning);
  }
  const send = (m: MatchState, intent: Partial<typeof IDLE_INTENT>) => stepMatch(m, m.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, ...intent } : IDLE_INTENT)), tuning).duel.fighters[0]!;

  it('an action the view offers is acted on, while Exploring', () => {
    const m = run();
    expect(m.delver!.phase).toBe('Exploring');
    const v = inventoryView(m.duel.fighters[0], tuning, { phase: m.delver!.phase })!;
    const equipRelic = v.relics[0]!.item!.equip!;
    const wield = v.weapons[1]!.item!.equip!;
    const drop = v.relics[1]!.item!.drop!;
    expect([equipRelic.available, wield.available, drop.available]).toEqual([true, true, true]);
    expect(send(m, { equip: v.relics[0]!.ref }).inventory!.equipped).toEqual([0]);
    expect(send(m, { equip: v.weapons[1]!.ref }).inventory!.weapon).toBe(1);
    expect(send(m, { drop: v.relics[1]!.ref }).inventory!.relics.map((r) => r.name)).toEqual(['Whetstone']);
  });
});

describe('the key that says when to redraw', () => {
  const view = (f: FighterState, phase: DelverPhase | undefined = 'Exploring') => inventoryView(f, tuning, phase && { phase });

  it('is the same for the same view, and differs outside a Run', () => {
    expect(inventoryViewKey(view(fighter()))).toBe(inventoryViewKey(view(fighter())));
    expect(inventoryViewKey(null)).not.toBe(inventoryViewKey(view(fighter())));
    // Never the empty string the screen starts from (`shown`), or a closed-then-opened screen outside a Run would stay blank.
    expect(inventoryViewKey(null)).not.toBe('');
  });

  it('changes with the items, the marks, the availability and its reason, and the numbers', () => {
    const key = inventoryViewKey(view(fighter()));
    expect(inventoryViewKey(view(fighter({ weapons: commons(W0, W2) })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ weapon: 1 })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ equipped: [0] })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ relics: commons('Whetstone'), equipped: [] })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter(), 'Descending'))).not.toBe(key);
    expect(inventoryViewKey(view(fighter(), undefined))).not.toBe(inventoryViewKey(view(fighter(), 'Descending')));
    expect(inventoryViewKey(view({ ...fighter(), daggers: 1 }))).not.toBe(key);
  });

  it('leaves out the icons’ SVG text', () => {
    const v = view(fighter())!;
    const plain = { ...v, weapons: v.weapons.map((s) => (s.item ? { ...s, item: { ...s.item, icon: '<svg>other</svg>' } } : s)) };
    expect(inventoryViewKey(plain)).toBe(inventoryViewKey(v));
  });
});

describe('the inventory view for the second Player (Fighter 1)', () => {
  it('shows Fighter 1’s own Inventory, not Fighter 0’s', () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
    const [f0, f1] = m.duel.fighters as [FighterState, FighterState];
    const second = holdInventory(f1, { ...f1.inventory!, weapons: commons(W2), relics: commons('Iron Plate'), weapon: 0, equipped: [0] }, tuning);
    const v = inventoryView(second, tuning, EXPLORING)!;
    expect(v.weapons[0]!.item!.name).toBe(W2);
    expect(v.relics[0]!.item).toMatchObject({ name: 'Iron Plate', marked: true });
    expect(v.lock).toBeNull();
    expect(inventoryView(f0, tuning, EXPLORING)!.relics[0]!.item).toBeNull();
  });
});

describe('the inventory screen in a Delver Run', () => {
  it('is locked while Descending, whatever else is wrong', () => {
    expect(inventoryLock(fighter(), DESCENDING)).toBe('Descending');
    expect(inventoryLock({ ...fighter(), hp: 0 }, DESCENDING)).toBe('Descending');
  });

  it('anywhere while Exploring, the usual checks: free when Idle on the ground, else the reason', () => {
    const f = fighter();
    const at = { phase: 'Exploring' } as const;
    expect(inventoryLock(f, at)).toBeNull();
    expect(inventoryLock({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } }, at)).toBe('You have fallen');
    expect(inventoryLock({ ...f, air: { kind: 'Jump' } as unknown as FighterState['air'] }, at)).toBe('Land first');
  });

  it('gives each item its action the reason of the lock', () => {
    const v = inventoryView(fighter(), tuning, DESCENDING)!;
    expect(v.lock).toBe('Descending');
    expect(items(v.relics)[0]!.drop!.available).toBe(false);
    expect(items(v.relics)[0]!.drop!.reason).toBe('Descending');
    const at = inventoryView(fighter(), tuning, EXPLORING)!;
    expect(at.lock).toBeNull();
    expect(items(at.relics)[0]!.drop!.available).toBe(true);
  });
});

describe('the inventory view of a Consumable (Stage 10)', () => {
  const held = () => fighter({ relics: commons('Whetstone', 'Health Potion', 'Map', 'Resurrection Stone'), equipped: [0] });
  const consumables = (v: ReturnType<typeof inventoryView>) => items(v!.relics).filter((item) => item.use);

  it('sits in a Relic slot, unmarked, with a Use control and no Equip, its effect in words and its own icon', () => {
    const v = inventoryView({ ...held(), hp: 10 }, tuning, { ...EXPLORING, fallen: true })!;
    const [potion, map, stone] = consumables(v);
    expect([potion, map, stone].map((item) => item!.name)).toEqual(['Health Potion', 'Map', 'Resurrection Stone']);
    for (const item of [potion!, map!, stone!]) {
      expect(item.equip).toBeNull();
      expect(item.marked).toBe(false);
      expect(item.use).toEqual({ label: 'Use', available: true, reason: null });
      expect(item.drop!.available).toBe(true);
      expect(item.words).toMatch(/^Use once: /);
      expect(item.icon).toContain('<svg');
    }
    expect(potion!.words).toBe('Use once: heal to full HP');
    expect(items(v.relics)[0]!.use).toBeNull();
  });

  it('is usable mid-Action and in the air, where nothing can be equipped', () => {
    const busy = { ...held(), hp: 10, action: { kind: 'Kick' }, air: { vy: 1 } } as unknown as FighterState;
    const v = inventoryView(busy, tuning, { ...EXPLORING, fallen: true })!;
    expect(v.lock).not.toBeNull();
    for (const item of consumables(v)) expect(item.use!.available).toBe(true);
  });

  it('says why a use would be refused: full HP, the Floor mapped, nobody fallen, Descending, fallen', () => {
    const reasons = (f: FighterState, ctx: Parameters<typeof inventoryView>[2]) => consumables(inventoryView(f, tuning, ctx)).map((item) => item.use!.reason);
    expect(reasons(held(), { ...EXPLORING, mapped: true })).toEqual(['Already at full HP', 'Floor already mapped', 'Nobody has fallen']);
    expect(reasons(held(), DESCENDING)).toEqual(['Descending', 'Descending', 'Descending']);
    expect(reasons({ ...held(), hp: 0 }, { ...EXPLORING, fallen: true })).toEqual(['You have fallen', 'You have fallen', 'You have fallen']);
  });

  it('changes the view key when a use becomes available', () => {
    expect(inventoryViewKey(inventoryView(held(), tuning, EXPLORING))).not.toBe(inventoryViewKey(inventoryView({ ...held(), hp: 10 }, tuning, EXPLORING)));
  });
});
