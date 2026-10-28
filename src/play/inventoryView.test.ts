import { describe, expect, it } from 'vitest';
import { canChangeInventory, createMatch, holdInventory, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, stepMatch, type FighterState, type HallPhase, type Inventory, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { inventoryHoldsInput, inventoryLock, inventoryView, inventoryViewKey, type ItemView } from './inventoryView';

const tuning = loadTuningData();
const [W0, W1, W2] = Object.keys(tuning.weapons) as [string, string, string];

const newRun = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });

/** A Player's Fighter in a Run, holding `inv` (its Mods folded), Idle and on the ground. */
function fighter(inv: Partial<Inventory> = {}): FighterState {
  const f = newRun().duel.fighters[0]!;
  return holdInventory(f, { ...f.inventory!, weapons: [W0, W1], relics: ['Whetstone', 'Iron Plate'], weapon: 0, equipped: [1], ...inv }, tuning);
}

const items = (list: readonly { item: ItemView | null }[]): ItemView[] => list.flatMap((s) => (s.item ? [s.item] : []));

describe('the inventory view', () => {
  it('has a slot per size in the Tuning Data, filled in the order picked up, the rest empty', () => {
    const v = inventoryView(fighter(), tuning, 'Cleared')!;
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
    expect(inventoryView(bare, tuning, 'Cleared')).toBeNull();
    expect(inventoryView(undefined, tuning, 'Cleared')).toBeNull();
  });

  it('marks the Weapon wielded and the Relics equipped, and gives each item its icon and each Relic its effects in words', () => {
    const v = inventoryView(fighter(), tuning, 'Cleared')!;
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
    const v = inventoryView(fighter({ equipped: [0, 1] }), tuning, 'Cleared')!;
    expect(v.numbers).toEqual([
      { label: 'Damage', value: '×1.1' },
      { label: 'Damage taken', value: '×0.9' },
      { label: 'Max HP', value: String(Math.round(tuning.fighter.maxHp)) },
      { label: 'Daggers', value: `${tuning.dagger.count} / ${tuning.dagger.count}` },
    ]);
    const bare = inventoryView(fighter({ equipped: [] }), tuning, 'Cleared')!;
    expect(bare.numbers[0]!.value).toBe('×1');
    expect(bare.numbers[1]!.value).toBe('×1');
  });

  it('shows the numbers the equipped Relics give: more max HP and more daggers', () => {
    const hp = tuning.relics.find((r) => r.effects.maxHp)!;
    const dag = tuning.relics.find((r) => r.effects.daggers)!;
    const f = fighter({ relics: [hp.name, dag.name], equipped: [0, 1] });
    const v = inventoryView(f, tuning, 'Cleared')!;
    expect(v.numbers[2]!.value).toBe(String(Math.round(tuning.fighter.maxHp * (1 + hp.effects.maxHp!))));
    expect(v.numbers[3]!.value).toBe(`${f.daggers} / ${tuning.dagger.count + dag.effects.daggers!}`);
  });

  it('offers a carried Weapon to wield and to drop, the wielded Weapon to neither', () => {
    const [wielded, carried] = items(inventoryView(fighter(), tuning, 'Cleared')!.weapons);
    expect(wielded!.drop).toBeNull();
    expect(wielded!.equip).toBeNull();
    expect(carried!.equip).toEqual({ label: 'Wield', available: true, reason: null });
    expect(carried!.drop).toEqual({ label: 'Drop', available: true, reason: null });
  });

  it('never offers the wielded Weapon for a drop, whichever slot it is in or phase the Hall is in', () => {
    for (const weapon of [0, 1, 2]) {
      for (const phase of ['Fighting', 'Cleared', 'Leaving'] as const) {
        const v = inventoryView(fighter({ weapons: [W0, W1, W2], weapon }), tuning, phase)!;
        expect(v.weapons.map((s) => s.item!.drop === null)).toEqual([0, 1, 2].map((s) => s === weapon));
        expect(v.weapons[weapon]!.item!.marked).toBe(true);
      }
    }
  });

  it('a Relic toggles: Equip when off, Unequip when on, both droppable', () => {
    const [off, on] = items(inventoryView(fighter(), tuning, 'Cleared')!.relics);
    expect(off!.equip).toEqual({ label: 'Equip', available: true, reason: null });
    expect(on!.equip).toEqual({ label: 'Unequip', available: true, reason: null });
    expect(off!.drop!.available && on!.drop!.available).toBe(true);
  });

  it('a Relic cannot be equipped with every equipped slot taken, but one equipped can come off', () => {
    const v = inventoryView(fighter({ relics: ['Whetstone', 'Iron Plate', 'Whetstone', 'Whetstone'], equipped: [0, 1, 2] }), tuning, 'Cleared')!;
    const [a, , , d] = items(v.relics);
    expect(d!.equip).toEqual({ label: 'Equip', available: false, reason: 'Relic slots full (3 / 3)' });
    expect(a!.equip!.available).toBe(true);
    expect(d!.drop!.available).toBe(true);
  });

  it('every action is unavailable while the Hall is Fighting, with the reason', () => {
    const v = inventoryView(fighter({ weapons: [W0, W1, W2], relics: ['Whetstone', 'Iron Plate'] }), tuning, 'Fighting')!;
    expect(v.lock).toBe('Enemies remain');
    const all = [...items(v.weapons), ...items(v.relics)];
    expect(all.length).toBe(5);
    for (const item of all) for (const action of [item.equip, item.drop]) if (action) expect(action).toMatchObject({ available: false, reason: 'Enemies remain' });
  });

  it('every action is unavailable while the party leaves, the Fighter has fallen, is mid-Action or is in the air', () => {
    const f = fighter();
    const airborne = { ...f, air: { vy: 1 } } as unknown as FighterState;
    expect(inventoryView(f, tuning, 'Cleared')!.lock).toBeNull();
    expect(inventoryView(f, tuning, 'Leaving')!.lock).toBe('Leaving the Hall');
    expect(inventoryView({ ...f, hp: 0 }, tuning, 'Cleared')!.lock).toBe('You have fallen');
    expect(inventoryView({ ...f, action: { kind: 'Kick' } } as unknown as FighterState, tuning, 'Cleared')!.lock).toBe('Finish your move');
    const v = inventoryView(airborne, tuning, 'Cleared')!;
    expect(v.lock).toBe('Land first');
    for (const item of [...items(v.weapons), ...items(v.relics)]) for (const action of [item.equip, item.drop]) expect(action?.available ?? false).toBe(false);
  });

  it("is locked exactly when the Simulation would refuse: the Hall Cleared and the Fighter living, Idle and on the ground (`canChangeInventory`)", () => {
    const f = fighter();
    const states: [FighterState, HallPhase | undefined][] = [
      [f, 'Cleared'],
      [f, 'Fighting'],
      [f, 'Leaving'],
      [f, undefined],
      [{ ...f, hp: 0 }, 'Cleared'],
      [{ ...f, benched: true }, 'Cleared'],
      [{ ...f, action: { kind: 'Block' } } as unknown as FighterState, 'Cleared'],
      [{ ...f, air: { vy: 0 } } as unknown as FighterState, 'Cleared'],
    ];
    for (const [state, phase] of states) {
      const accepts = phase === 'Cleared' && canChangeInventory(state) && inDuel(state);
      expect(inventoryLock(state, phase) === null, JSON.stringify([phase, state.action, state.hp, state.benched])).toBe(accepts);
    }
  });
});

describe('what the view offers is what the Simulation acts on', () => {
  /** A Run for Player 0 with these items, its Encounter beaten (`cleared`) or not, stepped once so the phase is current. */
  function run(cleared: boolean): MatchState {
    const m = newRun();
    const stocked = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? holdInventory(f, { ...f.inventory!, weapons: [W0, W1], relics: ['Whetstone', 'Iron Plate'], weapon: 0, equipped: [] }, tuning) : f)) } };
    const felled = { ...stocked, duel: { ...stocked.duel, fighters: stocked.duel.fighters.map((f) => (cleared && f.team === 1 ? { ...f, hp: 0 } : f)) } };
    return stepMatch(felled, felled.duel.fighters.map(() => IDLE_INTENT), tuning);
  }
  const send = (m: MatchState, intent: Partial<typeof IDLE_INTENT>) => stepMatch(m, m.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, ...intent } : IDLE_INTENT)), tuning).duel.fighters[0]!;

  it('an action the view offers is acted on, one it refuses is not (the Hall Fighting, then Cleared)', () => {
    for (const cleared of [true, false]) {
      const m = run(cleared);
      const v = inventoryView(m.duel.fighters[0], tuning, m.run!.phase)!;
      expect(m.run!.phase).toBe(cleared ? 'Cleared' : 'Fighting');
      const equipRelic = v.relics[0]!.item!.equip!;
      const wield = v.weapons[1]!.item!.equip!;
      const drop = v.relics[1]!.item!.drop!;
      expect([equipRelic.available, wield.available, drop.available]).toEqual([cleared, cleared, cleared]);
      expect(send(m, { equip: v.relics[0]!.ref }).inventory!.equipped).toEqual(cleared ? [0] : []);
      expect(send(m, { equip: v.weapons[1]!.ref }).inventory!.weapon).toBe(cleared ? 1 : 0);
      expect(send(m, { drop: v.relics[1]!.ref }).inventory!.relics).toEqual(cleared ? ['Whetstone'] : ['Whetstone', 'Iron Plate']);
    }
  });
});

describe('whether the open screen takes the Controller’s input', () => {
  it('leaves a Fighter in a fight its keys, and takes them once the Hall is Cleared or being left', () => {
    expect(inventoryHoldsInput('Fighting')).toBe(false);
    // A Duel (no Run) is a fight too.
    expect(inventoryHoldsInput(undefined)).toBe(false);
    expect(inventoryHoldsInput('Cleared')).toBe(true);
    expect(inventoryHoldsInput('Leaving')).toBe(true);
  });

  it('never holds the Fighter in a phase where the Simulation would refuse for enemies remaining', () => {
    for (const phase of [undefined, 'Fighting', 'Cleared', 'Leaving'] as const) {
      if (inventoryLock(fighter(), phase) === 'Enemies remain') expect(inventoryHoldsInput(phase)).toBe(false);
    }
  });
});

describe('the key that says when to redraw', () => {
  const view = (f: FighterState, phase: HallPhase | undefined = 'Cleared') => inventoryView(f, tuning, phase);

  it('is the same for the same view, and differs outside a Run', () => {
    expect(inventoryViewKey(view(fighter()))).toBe(inventoryViewKey(view(fighter())));
    expect(inventoryViewKey(null)).not.toBe(inventoryViewKey(view(fighter())));
    // Never the empty string the screen starts from (`shown`), or a closed-then-opened screen outside a Run would stay blank.
    expect(inventoryViewKey(null)).not.toBe('');
  });

  it('changes with the items, the marks, the availability and its reason, and the numbers', () => {
    const key = inventoryViewKey(view(fighter()));
    expect(inventoryViewKey(view(fighter({ weapons: [W0, W2] })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ weapon: 1 })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ equipped: [0] })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter({ relics: ['Whetstone'], equipped: [] })))).not.toBe(key);
    expect(inventoryViewKey(view(fighter(), 'Fighting'))).not.toBe(key);
    expect(inventoryViewKey(view(fighter(), 'Leaving'))).not.toBe(inventoryViewKey(view(fighter(), 'Fighting')));
    expect(inventoryViewKey(view({ ...fighter(), daggers: 1 }))).not.toBe(key);
  });

  it('leaves out the icons’ SVG text', () => {
    const v = view(fighter())!;
    const plain = { ...v, weapons: v.weapons.map((s) => (s.item ? { ...s, item: { ...s.item, icon: '<svg>other</svg>' } } : s)) };
    expect(inventoryViewKey(plain)).toBe(inventoryViewKey(v));
  });
});
