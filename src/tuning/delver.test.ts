import { describe, expect, it } from 'vitest';
import { DELVER_VERSION } from '../sim/delver/version';
import { loadTuningData, parseDelver, tuningDataHash } from './index';

const tuning = loadTuningData();
const FIELD = tuning.battle.field.size;
const NAMES = {
  weapons: Object.keys(tuning.weapons),
  difficulties: Object.keys(tuning.ai.difficulties),
  styles: Object.keys(tuning.ai.styles),
  relics: tuning.relics.map((r) => r.name),
};
const parse = (data: unknown) => parseDelver(data, FIELD, tuning.battle, NAMES);
type Raw = { tiers: unknown; floorsPerTier: unknown; flowCell: unknown; fireRadius: unknown; floor: Record<string, unknown>; [key: string]: unknown };
/** The file's values as raw data: the Troop indices written back as names. */
const raw = (): Raw => {
  const d = JSON.parse(JSON.stringify(tuning.delver)) as Raw;
  const named = (pool: { troops: { troop: number; count: number }[]; hpScale: number }[]) =>
    pool.map((t) => ({ ...t, troops: t.troops.map((r) => ({ ...r, troop: tuning.battle.troops[r.troop]!.name })) }));
  d.warbands = (d.warbands as { guard: never[]; patrol: never[]; elite: never[]; boss?: { troop: { base: number }; guard: never[] } }[]).map((t) => ({
    guard: named(t.guard),
    patrol: named(t.patrol),
    elite: named(t.elite),
    ...(t.boss ? { boss: { troop: { ...t.boss.troop, base: tuning.battle.troops[t.boss.troop.base]!.name }, guard: named(t.boss.guard) } } : {}),
  }));
  return d;
};
const withKey = (patch: Record<string, unknown>): Raw => ({ ...raw(), ...patch });
/** The raw data with tier 1's guard pool replaced. */
const withGuard = (guard: unknown): Raw => {
  const d = raw();
  d.warbands = (d.warbands as Record<string, unknown>[]).map((t, i) => (i === 0 ? { ...t, guard } : t));
  return d;
};
const levy = (count: unknown) => ({ troops: [{ troop: 'Levy', count }], hpScale: 1 });
/** The raw data with tier 3's `elite` or `boss` patched (the `boss.troop` or `boss.guard` by `bossTroop` and `bossGuard`). */
const withTier = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.warbands = (d.warbands as Record<string, unknown>[]).map((t, i) => (i === 2 ? { ...t, ...patch } : t));
  return d;
};
const bossOf = (): { troop: Record<string, unknown>; guard: unknown } => (raw().warbands as { boss: { troop: Record<string, unknown>; guard: unknown } }[])[2]!.boss;
const withBossTroop = (patch: Record<string, unknown>): Raw => {
  const b = bossOf();
  return withTier({ boss: { ...b, troop: { ...b.troop, ...patch } } });
};
const withBossGuard = (guard: unknown): Raw => withTier({ boss: { ...bossOf(), guard } });
const eliteOf = (): Record<string, unknown>[] => (raw().warbands as { elite: Record<string, unknown>[] }[])[2]!.elite;
const withFloor = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.floor = { ...d.floor, ...patch };
  return d;
};

describe('Delver Tuning Data (data/delver.json)', () => {
  it('the bundled delver parses to the file values', () => {
    const { warbands, ...keys } = tuning.delver;
    const troop = (name: string) => tuning.battle.troops.findIndex((t) => t.name === name);
    const template = (...rows: [string, number][]) => ({ troops: rows.map(([name, count]) => ({ troop: troop(name), count })), hpScale: 1, relics: [] as string[] });
    const elite = (relics: string[], hpScale: number, ...rows: [string, number][]) => ({ ...template(...rows), hpScale, relics });
    expect(troop('Brute')).toBeGreaterThan(0);
    expect(warbands.map(({ guard, patrol }) => ({ guard, patrol }))).toEqual([
      {
        guard: [template(['Levy', 1]), template(['Levy', 2]), template(['Levy', 2], ['Halberdier', 1])],
        patrol: [template(['Levy', 2]), template(['Levy', 3]), template(['Levy', 3], ['Halberdier', 1]), template(['Levy', 3], ['Halberdier', 2])],
      },
      {
        guard: [template(['Halberdier', 1], ['Swordsman', 1]), template(['Levy', 2], ['Halberdier', 1]), template(['Levy', 1], ['Halberdier', 1], ['Swordsman', 1])],
        patrol: [template(['Levy', 3], ['Swordsman', 1]), template(['Halberdier', 2], ['Levy', 2]), template(['Levy', 3], ['Halberdier', 1], ['Swordsman', 1])],
      },
      {
        guard: [template(['Brute', 1]), template(['Swordsman', 1], ['Levy', 1]), template(['Swordsman', 2], ['Brute', 1]), template(['Brute', 1], ['Halberdier', 2])],
        patrol: [template(['Swordsman', 2], ['Levy', 2]), template(['Brute', 1], ['Halberdier', 2], ['Levy', 2]), template(['Swordsman', 2], ['Brute', 1])],
      },
    ]);
    expect(keys).toEqual({
      tiers: 3,
      floorsPerTier: 3,
      flowCell: 2,
      fireRadius: 3,
      sight: 16,
      leash: 45,
      forgetSeconds: 8,
      chaseSpeed: 1,
      closeIn: 4,
      arrive: 3,
      elitePosts: 1,
      postFill: 75,
      patrolFill: 100,
      perPlayerSoldiers: 1.5,
      attackSlots: [4, 3, 3, 3],
      tierHp: [1, 1.25, 1.5],
      floor: { cols: 7, rows: 6, rooms: 22, gaps: [22, 24, 26, 28], halfSize: [5, 11], minPassage: 4, passage: 3, farPercent: 25, loops: [3, 5], rests: [1, 2], treasures: 1, emptyPercent: 30, patrols: 2, follow: 1.5, maxAttempts: 10 },
    });
    expect(parse(raw())).toEqual(tuning.delver);
    expect(warbands.map((t) => t.elite)).toEqual([
      [elite(['Whetstone'], 1.5, ['Halberdier', 1], ['Levy', 2])],
      [elite(['Whetstone'], 1.5, ['Swordsman', 1], ['Halberdier', 1]), elite(['Heavy Gauntlet', 'Glass Cannon'], 2, ['Swordsman', 1], ['Levy', 2])],
      [elite(['Heavy Gauntlet', 'Glass Cannon'], 2, ['Swordsman', 1], ['Brute', 1], ['Halberdier', 1])],
    ]);
    const boss = (i: number) => warbands[i]!.boss!;
    expect(warbands.map((t) => t.boss?.troop.name)).toEqual(['Warden', 'Duelist', 'Wraith Lord']);
    expect(boss(0).troop).toEqual({ name: 'Warden', base: troop('Brute'), weapon: 'Sledge Hammer', body: 'monk', height: 1.3, width: 1.3, difficulty: 'Skilled', style: 'Aggressive', relics: [], hpScale: 2.5 });
    expect(boss(1).troop).toEqual({ name: 'Duelist', base: troop('Swordsman'), weapon: 'Arming Sword', body: 'prince', height: 1.1, width: 1.1, difficulty: 'Expert', style: 'Counter', relics: [], hpScale: 2.5 });
    expect(boss(2).troop).toEqual({ name: 'Wraith Lord', base: troop('Brute'), weapon: 'Sledge Hammer', body: 'wraith', height: 1.4, width: 1.4, difficulty: 'Expert', style: 'Aggressive', relics: ['Heavy Gauntlet'], hpScale: 3 });
    expect(boss(0).guard).toEqual([template(['Levy', 2])]);
    expect(boss(1).guard).toEqual([template(['Swordsman', 1], ['Halberdier', 1])]);
    expect(boss(2).guard).toEqual([template(['Swordsman', 1], ['Halberdier', 1], ['Brute', 1])]);
  });

  const bad: [string, Raw, RegExp][] = [
    ['tiers 0', { ...raw(), tiers: 0 }, /^delver\.tiers /],
    ['tiers fractional', { ...raw(), tiers: 1.5 }, /^delver\.tiers /],
    ['floorsPerTier 0', { ...raw(), floorsPerTier: 0 }, /^delver\.floorsPerTier /],
    ['floorsPerTier fractional', { ...raw(), floorsPerTier: 1.5 }, /^delver\.floorsPerTier /],
    ['flowCell not positive', { ...raw(), flowCell: 0 }, /^delver\.flowCell /],
    ['flowCell not 2 (the Floor rule is written for a 2 m cell)', { ...raw(), flowCell: 4 }, /^delver\.flowCell /],
    ['flowCell missing', { ...raw(), flowCell: undefined }, /^delver\.flowCell /],
    ['fireRadius 0', { ...raw(), fireRadius: 0 }, /^delver\.fireRadius /],
    ['fireRadius negative', { ...raw(), fireRadius: -1 }, /^delver\.fireRadius /],
    ['fireRadius missing', { ...raw(), fireRadius: undefined }, /^delver\.fireRadius /],
    ['cols fractional', withFloor({ cols: 7.5 }), /^delver\.floor\.cols /],
    ['cols below 2', withFloor({ cols: 1 }), /^delver\.floor\.cols /],
    ['rows below 2', withFloor({ rows: 1 }), /^delver\.floor\.rows /],
    ['rooms below 2', withFloor({ rooms: 1 }), /^delver\.floor\.rooms /],
    ['rooms above cols * rows', withFloor({ rooms: 43 }), /^delver\.floor\.rooms /],
    ['rooms fractional', withFloor({ rooms: 10.5 }), /^delver\.floor\.rooms /],
    ['gaps empty', withFloor({ gaps: [] }), /^delver\.floor\.gaps /],
    ['gap odd', withFloor({ gaps: [22, 24, 25, 28] }), /^delver\.floor\.gaps\[2\] /],
    ['gap not positive', withFloor({ gaps: [22, -24] }), /^delver\.floor\.gaps\[1\] /],
    ['halfSize not a pair', withFloor({ halfSize: [5] }), /^delver\.floor\.halfSize /],
    ['halfSize min below 1', withFloor({ halfSize: [0, 11] }), /^delver\.floor\.halfSize\[0\] /],
    ['halfSize min below 4 (a pedestal would leave its Hall)', withFloor({ halfSize: [3, 11] }), /^delver\.floor\.halfSize\[0\] /],
    ['halfSize descending', withFloor({ halfSize: [8, 5] }), /^delver\.floor\.halfSize\[1\] /],
    ['halfSize fractional', withFloor({ halfSize: [5, 10.5] }), /^delver\.floor\.halfSize\[1\] /],
    ['minPassage too long for the gaps', withFloor({ minPassage: 13 }), /^delver\.floor\.minPassage /],
    ['minPassage below 1', withFloor({ minPassage: 0 }), /^delver\.floor\.minPassage /],
    ['minPassage leaves no metre for a Hall to grow', withFloor({ minPassage: 11 }), /^delver\.floor\.minPassage /],
    ['passage not wider than flowCell', withFloor({ passage: 2 }), /^delver\.floor\.passage /],
    ['passage wider than the smallest Hall', withFloor({ passage: 11 }), /^delver\.floor\.passage /],
    ['cols overflow the field', withFloor({ cols: 8, rooms: 20 }), /^delver\.floor\.cols /],
    ['rows overflow the field', withFloor({ rows: 8, rooms: 20 }), /^delver\.floor\.rows /],
    ['farPercent above 100', withFloor({ farPercent: 101 }), /^delver\.floor\.farPercent /],
    ['loops descending', withFloor({ loops: [5, 3] }), /^delver\.floor\.loops\[1\] /],
    ['loops negative', withFloor({ loops: [-1, 3] }), /^delver\.floor\.loops\[0\] /],
    ['rests min 0', withFloor({ rests: [0, 2] }), /^delver\.floor\.rests\[0\] /],
    ['treasures negative', withFloor({ treasures: -1 }), /^delver\.floor\.treasures /],
    ['emptyPercent above 100', withFloor({ emptyPercent: 120 }), /^delver\.floor\.emptyPercent /],
    ['patrols fractional', withFloor({ patrols: 1.5 }), /^delver\.floor\.patrols /],
    ['follow below 1', withFloor({ follow: 0.9 }), /^delver\.floor\.follow /],
    ['maxAttempts 0', withFloor({ maxAttempts: 0 }), /^delver\.floor\.maxAttempts /],
    ...(['sight', 'leash', 'forgetSeconds', 'chaseSpeed', 'closeIn', 'arrive'] as const).flatMap((key): [string, Raw, RegExp][] => [
      [`${key} 0`, withKey({ [key]: 0 }), new RegExp(`^delver\\.${key} `)],
      [`${key} negative`, withKey({ [key]: -1 }), new RegExp(`^delver\\.${key} `)],
      [`${key} missing`, withKey({ [key]: undefined }), new RegExp(`^delver\\.${key} `)],
    ]),
    ...(['postFill', 'patrolFill'] as const).flatMap((key): [string, Raw, RegExp][] => [
      [`${key} above 100`, withKey({ [key]: 101 }), new RegExp(`^delver\\.${key} `)],
      [`${key} fractional`, withKey({ [key]: 50.5 }), new RegExp(`^delver\\.${key} `)],
      [`${key} negative`, withKey({ [key]: -1 }), new RegExp(`^delver\\.${key} `)],
    ]),
    ['perPlayerSoldiers negative', withKey({ perPlayerSoldiers: -0.5 }), /^delver\.perPlayerSoldiers /],
    ['perPlayerSoldiers missing', withKey({ perPlayerSoldiers: undefined }), /^delver\.perPlayerSoldiers /],
    ['attackSlots too short', withKey({ attackSlots: [4, 3, 3] }), /^delver\.attackSlots /],
    ['attackSlots too long', withKey({ attackSlots: [4, 3, 3, 3, 3] }), /^delver\.attackSlots /],
    ['attackSlots entry 0', withKey({ attackSlots: [4, 0, 3, 3] }), /^delver\.attackSlots\[1\] /],
    ['attackSlots entry fractional', withKey({ attackSlots: [4, 3, 2.5, 3] }), /^delver\.attackSlots\[2\] /],
    ['attackSlots one Bubble overflows the Pool', withKey({ attackSlots: [16, 3, 3, 3] }), /^delver\.attackSlots\[0\] /],
    ['attackSlots four Bubbles overflow the Pool', withKey({ attackSlots: [4, 3, 3, 4] }), /^delver\.attackSlots\[3\] /],
    ['tierHp too short', withKey({ tierHp: [1, 1.25] }), /^delver\.tierHp /],
    ['tierHp not positive', withKey({ tierHp: [1, 0, 1.5] }), /^delver\.tierHp\[1\] /],
    ['warbands too short', withKey({ warbands: (raw().warbands as unknown[]).slice(0, 2) }), /^delver\.warbands /],
    ['guard pool empty', withGuard([]), /^delver\.warbands\[0\]\.guard /],
    ['patrol pool empty', withKey({ warbands: (raw().warbands as Record<string, unknown>[]).map((t, i) => (i === 2 ? { ...t, patrol: [] } : t)) }), /^delver\.warbands\[2\]\.patrol /],
    ['template without Troops', withGuard([{ troops: [], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops /],
    ['unknown Troop', withGuard([{ troops: [{ troop: 'Dragon', count: 1 }], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.troop /],
    ['Troop index out of range', withGuard([{ troops: [{ troop: 99, count: 1 }], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.troop /],
    ['count 0', withGuard([levy(0)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.count /],
    ['count fractional', withGuard([levy(1.5)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.count /],
    ['template above squad.size', withGuard([levy(tuning.battle.squad.size + 1)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops /],
    ['hpScale 0', withGuard([{ ...levy(3), hpScale: 0 }]), /^delver\.warbands\[0\]\.guard\[0\]\.hpScale /],
    ['elitePosts negative', withKey({ elitePosts: -1 }), /^delver\.elitePosts /],
    ['elitePosts fractional', withKey({ elitePosts: 1.5 }), /^delver\.elitePosts /],
    ['elite template without relics', withTier({ elite: [{ troops: [{ troop: 'Levy', count: 1 }], hpScale: 1 }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics /],
    ['elite template with an unknown Relic', withTier({ elite: [{ ...eliteOf()[0]!, relics: ['Nope'] }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics\[0\] /],
    ['elite template with too many Relics', withTier({ elite: [{ ...eliteOf()[0]!, relics: ['Whetstone', 'Whetstone', 'Whetstone'] }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics /],
    ['relics key on a guard template', withGuard([{ ...levy(1), relics: ['Whetstone'] }]), /^delver\.warbands\[0\]\.guard\[0\]\.relics /],
    ['relics key on a patrol template', withTier({ patrol: [{ ...levy(1), relics: ['Whetstone'] }] }), /^delver\.warbands\[2\]\.patrol\[0\]\.relics /],
    ['boss base unknown', withBossTroop({ base: 'Dragon' }), /^delver\.warbands\[2\]\.boss\.troop\.base /],
    ['boss base index out of range', withBossTroop({ base: 99 }), /^delver\.warbands\[2\]\.boss\.troop\.base /],
    ['boss weapon unknown', withBossTroop({ weapon: 'Banana' }), /^delver\.warbands\[2\]\.boss\.troop\.weapon /],
    ['boss difficulty unknown', withBossTroop({ difficulty: 'Godlike' }), /^delver\.warbands\[2\]\.boss\.troop\.difficulty /],
    ['boss style unknown', withBossTroop({ style: 'Sleepy' }), /^delver\.warbands\[2\]\.boss\.troop\.style /],
    ['boss style random', withBossTroop({ style: 'random' }), /^delver\.warbands\[2\]\.boss\.troop\.style /],
    ['boss body empty', withBossTroop({ body: '' }), /^delver\.warbands\[2\]\.boss\.troop\.body /],
    ['boss name empty', withBossTroop({ name: '' }), /^delver\.warbands\[2\]\.boss\.troop\.name /],
    ['boss height too small', withBossTroop({ height: 0.1 }), /^delver\.warbands\[2\]\.boss\.troop\.height /],
    ['boss width too large', withBossTroop({ width: 9 }), /^delver\.warbands\[2\]\.boss\.troop\.width /],
    ['boss hpScale 0', withBossTroop({ hpScale: 0 }), /^delver\.warbands\[2\]\.boss\.troop\.hpScale /],
    ['boss relic unknown', withBossTroop({ relics: ['Nope'] }), /^delver\.warbands\[2\]\.boss\.troop\.relics\[0\] /],
    ['boss with too many Relics', withBossTroop({ relics: ['Whetstone', 'Whetstone', 'Whetstone'] }), /^delver\.warbands\[2\]\.boss\.troop\.relics /],
    ['boss guard empty', withBossGuard([]), /^delver\.warbands\[2\]\.boss\.guard /],
    ['boss guard plus the Boss above squad.size', withBossGuard([levy(tuning.battle.squad.size)]), /^delver\.warbands\[2\]\.boss\.guard\[0\]\.troops /],
    ['relics key on a boss guard template', withBossGuard([{ ...levy(1), relics: ['Whetstone'] }]), /^delver\.warbands\[2\]\.boss\.guard\[0\]\.relics /],
  ];
  it.each(bad)('refuses %s, naming its path', (_name, data, path) => {
    expect(() => parse(data)).toThrow(path);
  });

  it('accepts a template of exactly squad.size Soldiers and a fractional perPlayerSoldiers', () => {
    expect(parse(withGuard([levy(tuning.battle.squad.size)])).warbands[0]!.guard[0]!.troops[0]!.count).toBe(tuning.battle.squad.size);
    expect(parse(withKey({ perPlayerSoldiers: 0.25 })).perPlayerSoldiers).toBe(0.25);
  });

  it('takes its own parsed form back in (a Troop by index)', () => {
    expect(parse(JSON.parse(JSON.stringify(tuning.delver)))).toEqual(tuning.delver);
  });

  it('a tier without a boss or an elite pool parses (no Boss, no elites)', () => {
    const d = raw();
    d.warbands = (d.warbands as { boss?: unknown; elite?: unknown }[]).map(({ boss: _boss, elite: _elite, ...t }) => t);
    const parsed = parse(d);
    expect(parsed.warbands.map((t) => t.boss)).toEqual([undefined, undefined, undefined]);
    expect(parsed.warbands.map((t) => t.elite)).toEqual([[], [], []]);
    expect('boss' in parsed.warbands[0]!).toBe(false);
    expect(parse(withTier({ elite: [] })).warbands[2]!.elite).toEqual([]);
    expect(parse({ ...raw(), elitePosts: undefined }).elitePosts).toBe(1);
    expect(parse(withKey({ elitePosts: 0 })).elitePosts).toBe(0);
  });

  it('accepts a fractional follow', () => {
    expect(parse(withFloor({ follow: 1.25 })).floor.follow).toBe(1.25);
  });

  it('is in the Tuning Data hash, with the Floor generator version', () => {
    const base = tuningDataHash(tuning);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, floorsPerTier: tuning.delver.floorsPerTier + 1 } })).not.toBe(base);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, tiers: tuning.delver.tiers + 1 } })).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION + 1)).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION)).toBe(base);
  });
});
