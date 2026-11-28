import { describe, expect, it } from 'vitest';
import { loadTuningData, RANDOM_PICK, type TuningData } from '../tuning';
import { attack, createInitialState, createMatch, DIRECTIONS, duelPlacements, hashValue, storedMods, wait, type SimState } from '../sim';
import { resolveTroop } from '../sim/delver';
import { createAiController } from './ai';
import { runControllers, scriptedController, type Controller } from './controller';
import { checkLineup, lineupAis, lineupMatch, lineupStyle, type Lineup } from './lineup';

const tuning = loadTuningData();
const vsAi = (style?: string): Lineup => [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Skilled', ...(style === undefined ? {} : { style }) } },
];

describe('Lineup: AI Styles', () => {
  it('accepts a Style of ai.styles, "random" or none, and refuses an unknown one', () => {
    for (const style of [undefined, 'Counter', RANDOM_PICK]) expect(() => checkLineup(tuning, vsAi(style), 1), String(style)).not.toThrow();
    expect(() => checkLineup(tuning, vsAi('Sneaky'), 1)).toThrow(/Unknown AI Style "Sneaky"/);
  });

  it('a random Style is a pure pick from the Match seed and the Fighter: the same on every peer, varying from Match to Match', () => {
    const styles = Object.keys(tuning.ai.styles);
    expect(lineupStyle(tuning, RANDOM_PICK, 9, 1)).toBe(lineupStyle(tuning, RANDOM_PICK, 9, 1));
    const picks = Array.from({ length: 24 }, (_, seed) => lineupStyle(tuning, RANDOM_PICK, seed, 1));
    for (const p of picks) expect(styles).toContain(p);
    expect(new Set(picks).size).toBeGreaterThan(2);
    expect(lineupStyle(tuning, undefined, 9, 1)).toBe('Balanced');
    expect(lineupStyle(tuning, 'Tricky', 9, 1)).toBe('Tricky');
  });

  it("lineupAis builds each AI with its Style, a random one picked from the Match's seed", () => {
    const run = runControllers(tuning, createInitialState(tuning, 3, duelPlacements(3)), [scriptedController([]), createAiController(tuning, 'Skilled')], 400);
    const intents = (ai: Controller) => run.states.map((s: SimState) => hashValue(ai.intent(s, 1)));
    const seed = 77;
    const picked = lineupStyle(tuning, RANDOM_PICK, seed, 1);
    expect(intents(lineupAis(tuning, vsAi(RANDOM_PICK), 'Duels', { seed })[1]!)).toEqual(intents(createAiController(tuning, 'Skilled', picked)));
    expect(intents(lineupAis(tuning, vsAi('Aggressive'))[1]!)).toEqual(intents(createAiController(tuning, 'Skilled', 'Aggressive')));
    expect(intents(lineupAis(tuning, vsAi())[1]!)).toEqual(intents(createAiController(tuning, 'Skilled')));
  });
});

describe('Lineup: a Delver Troop on an AI slot (docs/plans/enemy-behaviours.md, Stage 0)', () => {
  const uruk = { prefab: 'Uruk', variant: 'Uruk (Beginner)' };
  const vsTroop = (troop = uruk): Lineup => [
    { team: 0, pilot: { kind: 'Player', player: 0 } },
    // Its own difficulty, Style, Weapon and Size are ignored while it has a Troop.
    { team: 1, pilot: { kind: 'AI', difficulty: 'Expert', style: 'Counter' }, weapon: 'Dagger', size: { height: 1.4, thick: 1.4 }, troop },
  ];

  it("fields the Troop's Weapon, Size, Body, HP and Mods (resolveTroop), and only for its slot", () => {
    const t = resolveTroop(tuning, uruk);
    const options = lineupMatch(tuning, vsTroop(), ['Longsword'], { bestOf: 1 });
    expect(options.weapons).toEqual(['Longsword', 'Sledge Hammer']);
    expect(options.sizes).toEqual([undefined, t.size]);
    expect(options.troops).toEqual([null, { body: 'uruk', maxHp: t.maxHp, mods: t.mods }]);
    const match = createMatch(tuning, options);
    // Stored without the pace Mods at 1 (`storedMods`).
    expect(match.duel.fighters[1]).toMatchObject({ weapon: 'Sledge Hammer', hp: t.maxHp, maxHp: t.maxHp, size: t.size, mods: storedMods(t.mods) });
    expect(match.config.troops![1]!.body).toBe('uruk');
  });

  it('gives a Lineup without a Troop the options it always had (no `troops`)', () => {
    expect('troops' in lineupMatch(tuning, vsAi(), ['Longsword'], { bestOf: 1 })).toBe(false);
  });

  it("drives the Troop's slot with an AI of its Variant's difficulty and Style, not the Pilot's", () => {
    const seed = 99;
    const options = lineupMatch(tuning, vsTroop(), ['Longsword'], { bestOf: 1, seed });
    const state = createMatch(tuning, options).duel;
    const ais = lineupAis(tuning, vsTroop(), 'Duels', { seed });
    expect(ais[0]).toBeNull();
    const same: Controller[] = [scriptedController([]), createAiController(tuning, 'Beginner', 'Reckless', { quirks: ['Slow'] })];
    const ran = runControllers(tuning, state, [scriptedController([]), ais[1]!], 400).final;
    expect(hashValue(ran)).toBe(hashValue(runControllers(tuning, state, same, 400).final));
    expect(ran.tick).toBe(400);
  });

  it("plays a Style's minimum (`{ mul, min }`) on a Troop whose Variant has that Style (Lorekeeper, Chambermaster since Stage 6)", () => {
    // Chambermaster's chamberRate given a higher minimum: the Troop's AI (built by lineupAis from its Variant) is that Chambermaster's, and plays differently.
    const withMin = { ...tuning, ai: { ...tuning.ai, styles: { ...tuning.ai.styles, Chambermaster: { ...tuning.ai.styles.Chambermaster, chamberRate: { mul: 3, min: 0.5 } } } } };
    const lorekeeper = { prefab: 'Lorekeeper', variant: 'Lorekeeper (Skilled)' };
    const attacks = Array.from({ length: 40 }, (_, i) => [...wait(30), ...attack(DIRECTIONS[i % DIRECTIONS.length])]).flat();
    const play = (t: typeof tuning, ai?: Controller) => {
      const state = createMatch(t, lineupMatch(t, vsTroop(lorekeeper), ['Longsword'], { bestOf: 1, seed: 7 })).duel;
      return hashValue(runControllers(t, state, [scriptedController(attacks), ai ?? lineupAis(t, vsTroop(lorekeeper), 'Duels', { seed: 7 })[1]!], 1200).final);
    };
    expect(play(withMin)).toBe(play(withMin, createAiController(withMin, 'Skilled', { ...tuning.ai.styles.Chambermaster, chamberRate: { mul: 3, min: 0.5 } })));
    expect(play(withMin)).not.toBe(play(tuning));
  });

  it("plays its Variant's Quirks (Stage 4): their ai parts in its AI, their body parts in its Mods", () => {
    const heavy = { damage: 1.5 };
    const quirky: TuningData = {
      ...tuning,
      ai: { ...tuning.ai, quirks: { ...tuning.ai.quirks, Heavy: { body: heavy } } },
      delver: { ...tuning.delver, troops: tuning.delver.troops.map((p) => (p.name !== 'Uruk' ? p : { ...p, variants: p.variants.map((v) => (v.name === uruk.variant ? { ...v, quirks: ['Dumb', 'Heavy'] } : v)) })) },
    };
    const options = lineupMatch(quirky, vsTroop(), ['Longsword'], { bestOf: 1, seed: 5 });
    expect(options.troops![1]!.mods!.damage).toBeCloseTo(resolveTroop(tuning, uruk).mods.damage * 1.5, 12);
    const attacks = Array.from({ length: 30 }, (_, i) => [...wait(30), ...attack(DIRECTIONS[i % DIRECTIONS.length])]).flat();
    const play = (t: TuningData, ai: Controller) => hashValue(runControllers(t, createMatch(t, options).duel, [scriptedController(attacks), ai], 900).final);
    const troopAi = lineupAis(quirky, vsTroop(), 'Duels', { seed: 5 })[1]!;
    expect(play(quirky, troopAi)).toBe(play(quirky, createAiController(quirky, 'Beginner', 'Reckless', { quirks: ['Dumb', 'Heavy'] })));
    expect(play(quirky, lineupAis(quirky, vsTroop(), 'Duels', { seed: 5 })[1]!)).not.toBe(play(quirky, createAiController(quirky, 'Beginner', 'Reckless')));
  });

  it("a plain AI slot plays its Pilot's Quirks; checkLineup refuses an unknown one (naming the known ones), an empty list and a repeat", () => {
    const withQuirks = (quirks: string[]): Lineup => [vsAi()[0]!, { team: 1, pilot: { kind: 'AI', difficulty: 'Skilled', quirks } }];
    expect(() => checkLineup(tuning, withQuirks(['Dumb', 'Hopper']), 1)).not.toThrow();
    expect(() => checkLineup(tuning, withQuirks(['Clumsy']), 1)).toThrow(/Unknown AI Quirk "Clumsy" \(have: Dumb, Hopper, Slow, NoDaggers\)/);
    expect(() => checkLineup(tuning, withQuirks([]), 1)).toThrow(/names none/);
    expect(() => checkLineup(tuning, withQuirks(['Dumb', 'Dumb']), 1)).toThrow(/each Quirk once/);
    const attacks = Array.from({ length: 20 }, (_, i) => [...wait(30), ...attack(DIRECTIONS[i % DIRECTIONS.length])]).flat();
    const state = createInitialState(tuning, 3, duelPlacements(1.5));
    const play = (ai: Controller) => hashValue(runControllers(tuning, state, [scriptedController(attacks), ai], 600).final);
    expect(play(lineupAis(tuning, withQuirks(['Dumb']))[1]!)).toBe(play(createAiController(tuning, 'Skilled', 'Balanced', { quirks: ['Dumb'] })));
    expect(play(lineupAis(tuning, withQuirks(['Dumb']))[1]!)).not.toBe(play(createAiController(tuning, 'Skilled')));
  });

  it('refuses a Troop Tuning Data lacks (naming the known ones), on a Player slot, or outside Duels', () => {
    expect(() => checkLineup(tuning, vsTroop(), 1)).not.toThrow();
    expect(() => checkLineup(tuning, vsTroop({ prefab: 'Uruk', variant: 'Beginner' }), 1)).toThrow(/Unknown Variant "Beginner" of Troop Prefab "Uruk" \(have: /);
    expect(() => checkLineup(tuning, vsTroop({ prefab: 'Hobgoblin', variant: 'x' }), 1)).toThrow(/Unknown Troop Prefab "Hobgoblin" \(have: /);
    const player: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 }, troop: uruk }, { team: 1, pilot: { kind: 'AI', difficulty: 'Skilled' } }];
    expect(() => checkLineup(tuning, player, 1)).toThrow(/Only an AI slot fights as a Troop/);
    const run: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, { team: 0, pilot: { kind: 'AI', difficulty: 'Skilled' }, troop: uruk }, ...Array.from({ length: 4 }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } }))];
    expect(() => checkLineup(tuning, run, 1, 'Gauntlet')).toThrow(/Only Duels field a Delver Troop/);
  });
});
