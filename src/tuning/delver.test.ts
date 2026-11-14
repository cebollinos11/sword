import { describe, expect, it } from 'vitest';
import { flatRooms } from '../sim/delver/flat.testdata';
import { DELVER_VERSION } from '../sim/delver/version';
import { loadTuningData, MAX_FLOOR_TROOPS, parseDelver, tuningDataHash } from './index';

/** The data as shipped; the tests below build on `tuning`, Stage 6's Floor values (`flatRooms`), which the 7a keys' checks and the bad-value cases are written against. */
const bundled = loadTuningData();
const tuning = flatRooms(bundled);
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
const raw = (source = tuning): Raw => {
  const d = JSON.parse(JSON.stringify(source.delver)) as Raw;
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
const GREAT = { count: [0, 0], half: [12, 16] };
const SHAPES = { percent: 0, weights: { L: 3, T: 2, cross: 2, ring: 2 } };
const PILLARS = { percent: 0, weights: { colonnade: 1, grid: 1 } };
const LEVELS = { max: 4, min: 2, changePercent: 35, galleryPercent: 40 };
const withFloor = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.floor = { ...d.floor, ...patch };
  return d;
};

describe('Delver Tuning Data (data/delver.json)', () => {
  it('the bundled delver parses to the file values', () => {
    const { warbands, ...keys } = bundled.delver;
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
      floor: { cols: 6, rows: 6, rooms: 20, gaps: [30, 32], halfSize: [7, 14], minPassage: 4, passage: 3, farPercent: 25, loops: [3, 5], rests: [1, 2], treasures: 1, emptyPercent: 30, patrols: 2, follow: 1.5, maxAttempts: 10, levels: { max: 4, min: 2, changePercent: 35, galleryPercent: 40 }, turnPercent: 30, great: { count: [1, 2], half: [18, 22] }, shapes: { percent: 0, weights: { L: 3, T: 2, cross: 2, ring: 2 } }, pillars: { percent: 0, weights: { colonnade: 1, grid: 1 } } },
    });
    expect(parse(raw(bundled))).toEqual(bundled.delver);
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
    ['levels missing', withFloor({ levels: undefined }), /^delver\.floor\.levels /],
    ['levels.max fractional', withFloor({ levels: { ...LEVELS, max: 1.5 } }), /^delver\.floor\.levels\.max /],
    ['levels.max negative', withFloor({ levels: { ...LEVELS, max: -1 } }), /^delver\.floor\.levels\.max /],
    ['levels.max 7', withFloor({ levels: { ...LEVELS, max: 7 } }), /^delver\.floor\.levels\.max /],
    ['levels.min 0', withFloor({ levels: { ...LEVELS, min: 0 } }), /^delver\.floor\.levels\.min /],
    ['levels.min above max + 1', withFloor({ levels: { ...LEVELS, min: 6 } }), /^delver\.floor\.levels\.min /],
    ['levels.changePercent 101', withFloor({ levels: { ...LEVELS, changePercent: 101 } }), /^delver\.floor\.levels\.changePercent /],
    ['levels.changePercent fractional', withFloor({ levels: { ...LEVELS, changePercent: 0.5 } }), /^delver\.floor\.levels\.changePercent /],
    ['levels.galleryPercent negative', withFloor({ levels: { ...LEVELS, galleryPercent: -1 } }), /^delver\.floor\.levels\.galleryPercent /],
    ['minPassage under 2 * LEVEL_RISE with levels', withFloor({ minPassage: 3 }), /^delver\.floor\.minPassage /],
    ['turnPercent missing', withFloor({ turnPercent: undefined }), /^delver\.floor\.turnPercent /],
    ['turnPercent above 100', withFloor({ turnPercent: 101 }), /^delver\.floor\.turnPercent /],
    ['turnPercent fractional', withFloor({ turnPercent: 0.5 }), /^delver\.floor\.turnPercent /],
    ['turnPercent negative', withFloor({ turnPercent: -1 }), /^delver\.floor\.turnPercent /],
    ['great missing', withFloor({ great: undefined }), /^delver\.floor\.great /],
    ['great.count not a pair', withFloor({ great: { ...GREAT, count: [1] } }), /^delver\.floor\.great\.count /],
    ['great.count negative', withFloor({ great: { ...GREAT, count: [-1, 1] } }), /^delver\.floor\.great\.count\[0\] /],
    ['great.count fractional', withFloor({ great: { ...GREAT, count: [0, 1.5] } }), /^delver\.floor\.great\.count\[1\] /],
    ['great.count descending', withFloor({ great: { ...GREAT, count: [2, 1] } }), /^delver\.floor\.great\.count\[1\] /],
    ['great.count[0] 0 with count[1] above 0', withFloor({ great: { ...GREAT, count: [0, 1] } }), /^delver\.floor\.great\.count\[0\] /],
    ['great.count above 4', withFloor({ great: { ...GREAT, count: [1, 5] } }), /^delver\.floor\.great\.count\[1\] /],
    ['great.half not a pair', withFloor({ great: { ...GREAT, half: [12] } }), /^delver\.floor\.great\.half /],
    ['great.half descending', withFloor({ great: { ...GREAT, half: [16, 12] } }), /^delver\.floor\.great\.half\[1\] /],
    ['great.half fractional', withFloor({ great: { ...GREAT, half: [12, 15.5] } }), /^delver\.floor\.great\.half\[1\] /],
    ['great.half[0] not above halfSize[1]', withFloor({ great: { ...GREAT, half: [11, 16] } }), /^delver\.floor\.great\.half\[0\] /],
    ['shapes missing', withFloor({ shapes: undefined }), /^delver\.floor\.shapes /],
    ['shapes.percent above 100', withFloor({ shapes: { ...SHAPES, percent: 101 } }), /^delver\.floor\.shapes\.percent /],
    ['shapes.percent fractional', withFloor({ shapes: { ...SHAPES, percent: 0.5 } }), /^delver\.floor\.shapes\.percent /],
    ['shapes.percent negative', withFloor({ shapes: { ...SHAPES, percent: -1 } }), /^delver\.floor\.shapes\.percent /],
    ['shapes.weights missing', withFloor({ shapes: { percent: 0 } }), /^delver\.floor\.shapes\.weights /],
    ['shapes.weights key missing', withFloor({ shapes: { percent: 0, weights: { L: 1, T: 1, cross: 1 } } }), /^delver\.floor\.shapes\.weights\.ring /],
    ['shapes.weights extra key', withFloor({ shapes: { percent: 0, weights: { ...SHAPES.weights, ringg: 1 } } }), /^delver\.floor\.shapes\.weights\.ringg /],
    ['shapes.weights negative', withFloor({ shapes: { percent: 0, weights: { ...SHAPES.weights, T: -1 } } }), /^delver\.floor\.shapes\.weights\.T /],
    ['shapes.weights fractional', withFloor({ shapes: { percent: 0, weights: { ...SHAPES.weights, L: 1.5 } } }), /^delver\.floor\.shapes\.weights\.L /],
    ['shapes.weights all 0', withFloor({ shapes: { percent: 0, weights: { L: 0, T: 0, cross: 0, ring: 0 } } }), /^delver\.floor\.shapes\.weights /],
    ['pillars missing', withFloor({ pillars: undefined }), /^delver\.floor\.pillars /],
    ['pillars.percent above 100', withFloor({ pillars: { ...PILLARS, percent: 101 } }), /^delver\.floor\.pillars\.percent /],
    ['pillars.percent fractional', withFloor({ pillars: { ...PILLARS, percent: 0.5 } }), /^delver\.floor\.pillars\.percent /],
    ['pillars.weights key missing', withFloor({ pillars: { percent: 0, weights: { colonnade: 1 } } }), /^delver\.floor\.pillars\.weights\.grid /],
    ['pillars.weights extra key', withFloor({ pillars: { percent: 0, weights: { colonnade: 1, grid: 1, row: 1 } } }), /^delver\.floor\.pillars\.weights\.row /],
    ['pillars.weights negative', withFloor({ pillars: { percent: 0, weights: { colonnade: -1, grid: 1 } } }), /^delver\.floor\.pillars\.weights\.colonnade /],
    ['pillars.weights all 0', withFloor({ pillars: { percent: 0, weights: { colonnade: 0, grid: 0 } } }), /^delver\.floor\.pillars\.weights /],
    ['great.half[1] too long for the gaps', withFloor({ great: { ...GREAT, half: [12, 20] } }), /^delver\.floor\.great\.half\[1\] /],
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

  it('a flat Floor (levels.max 0) takes a short Passage; levels.min may be max + 1', () => {
    const flat = { max: 0, min: 1, changePercent: 0, galleryPercent: 0 };
    expect(parse(withFloor({ minPassage: 3, levels: flat })).floor.levels).toEqual(flat);
    expect(parse(withFloor({ levels: { ...LEVELS, min: 5 } })).floor.levels.min).toBe(5);
    expect(tuning.delver.floor.levels).toEqual(LEVELS);
  });

  it('takes the 7a keys: a turnPercent, great halls, and the largest half the gaps allow', () => {
    const f = parse(withFloor({ turnPercent: 30, great: { count: [1, 2], half: [18, 22] }, cols: 6, gaps: [30, 32], halfSize: [7, 14] })).floor;
    expect([f.turnPercent, f.great]).toEqual([30, { count: [1, 2], half: [18, 22] }]);
    // min(gaps) 22, minPassage 4: 11 + min(9, 11) = 20, so a half of 19 passes and 20 does not.
    expect(parse(withFloor({ great: { ...GREAT, half: [12, 19] } })).floor.great.half).toEqual([12, 19]);
    expect(() => parse(withFloor({ great: { ...GREAT, half: [12, 20] } }))).toThrow(/great\.half\[1\]/);
    expect(parse(withFloor({ great: { count: [1, 4], half: [12, 16] } })).floor.great.count).toEqual([1, 4]);
    expect(tuning.delver.floor.turnPercent).toBe(0);
    expect(tuning.delver.floor.great).toEqual(GREAT);
  });

  it('takes the 7b keys: shapes and pillars, a percent and whole weights', () => {
    const f = parse(withFloor({ shapes: { percent: 50, weights: { L: 0, T: 0, cross: 0, ring: 1 } }, pillars: { percent: 100, weights: { colonnade: 0, grid: 2 } } })).floor;
    expect([f.shapes, f.pillars]).toEqual([{ percent: 50, weights: { L: 0, T: 0, cross: 0, ring: 1 } }, { percent: 100, weights: { colonnade: 0, grid: 2 } }]);
    expect([tuning.delver.floor.shapes, tuning.delver.floor.pillars]).toEqual([SHAPES, PILLARS]);
  });

  it('accepts a fractional follow', () => {
    expect(parse(withFloor({ follow: 1.25 })).floor.follow).toBe(1.25);
  });

  it('refuses a Tuning whose Floor Troops exceed MAX_FLOOR_TROOPS, and accepts one at it', () => {
    expect(MAX_FLOOR_TROOPS).toBe(64);
    const floorTroops = tuning.battle.troops.length + tuning.delver.warbands.reduce((n, t) => n + (t.boss ? 1 : 0) + (t.elite ?? []).reduce((m, e) => m + e.troops.length, 0), 0);
    const elite = (rows: number) => ({ hpScale: 1, relics: ['Vital Charm'], troops: Array.from({ length: rows }, () => ({ troop: tuning.battle.troops[0]!.name, count: 1 })) });
    const withElite = (rows: number): Raw => {
      const d = raw();
      const tiers = d.warbands as { elite: unknown[] }[];
      // Templates of one row each (a template holds at most a Squad's size of Soldiers).
      tiers[0]!.elite = [...tiers[0]!.elite, ...Array.from({ length: rows }, () => elite(1))];
      return d;
    };
    expect(() => parse(withElite(MAX_FLOOR_TROOPS - floorTroops))).not.toThrow();
    expect(() => parse(withElite(MAX_FLOOR_TROOPS - floorTroops + 1))).toThrow(/Floor Troops/);
  });

  it('is in the Tuning Data hash, with the Floor generator version', () => {
    const base = tuningDataHash(tuning);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, floorsPerTier: tuning.delver.floorsPerTier + 1 } })).not.toBe(base);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, tiers: tuning.delver.tiers + 1 } })).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION + 1)).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION)).toBe(base);
  });
});
