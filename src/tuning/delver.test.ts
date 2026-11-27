import { describe, expect, it } from 'vitest';
import { flatRooms } from '../sim/delver/flat.testdata';
import { DELVER_VERSION } from '../sim/delver/version';
import { floorTroopCount, loadTuningData, MAX_FLOOR_TROOPS, parseDelver, tuningDataHash } from './index';

/** The data as shipped; the tests below build on `tuning`, Stage 6's Floor values (`flatRooms`), which the 7a keys' checks and the bad-value cases are written against. */
const bundled = loadTuningData();
const tuning = flatRooms(bundled);
const FIELD = tuning.battle.field.size;
const NAMES = {
  weapons: Object.keys(tuning.weapons),
  difficulties: Object.keys(tuning.ai.difficulties),
  styles: Object.keys(tuning.ai.styles),
  quirks: Object.keys(tuning.ai.quirks),
  relics: tuning.relics.map((r) => r.name),
};
const parse = (data: unknown) => parseDelver(data, FIELD, tuning.battle, NAMES);
type Raw = { tiers: unknown; floorsPerTier: unknown; flowCell: unknown; fireRadius: unknown; floor: Record<string, unknown>; [key: string]: unknown };
/** The file's values as raw data (the parsed form reads back as it is). */
const raw = (source = tuning): Raw => JSON.parse(JSON.stringify(source.delver)) as Raw;
const withKey = (patch: Record<string, unknown>): Raw => ({ ...raw(), ...patch });
/** The raw data with tier 1's guard pool replaced. */
const withGuard = (guard: unknown): Raw => {
  const d = raw();
  d.warbands = (d.warbands as Record<string, unknown>[]).map((t, i) => (i === 0 ? { ...t, guard } : t));
  return d;
};
const levy = (count: unknown) => ({ troops: [{ skill: 'Beginner', count }], hpScale: 1 });
/** The raw data with tier 3's `elite` or `boss` patched (the `boss.troop` or `boss.guard` by `bossTroop` and `bossGuard`). */
const withTier = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.warbands = (d.warbands as Record<string, unknown>[]).map((t, i) => (i === 2 ? { ...t, ...patch } : t));
  return d;
};
const bossOf = (): { troop: string; guard: unknown } => (raw().warbands as { boss: { troop: string; guard: unknown } }[])[2]!.boss;
const withBossGuard = (guard: unknown): Raw => withTier({ boss: { ...bossOf(), guard } });
/** The raw data with Prefab `i` patched (`variants` patched by `variant`, Variant `k`). */
const withPrefab = (i: number, patch: Record<string, unknown>, k = -1, variant: Record<string, unknown> = {}): Raw => {
  const d = raw();
  d.troops = (d.troops as Record<string, unknown>[]).map((p, j) =>
    j !== i ? p : { ...p, ...patch, ...(k < 0 ? {} : { variants: (p.variants as Record<string, unknown>[]).map((v, m) => (m === k ? { ...v, ...variant } : v)) }) },
  );
  return d;
};
const eliteOf = (): Record<string, unknown>[] => (raw().warbands as { elite: Record<string, unknown>[] }[])[2]!.elite;
const GREAT = { count: [0, 0], half: [12, 16] };
const SHAPES = { percent: 0, weights: { L: 3, T: 2, cross: 2, ring: 2 } };
const PILLARS = { percent: 0, weights: { colonnade: 1, grid: 1 } };
const GALLERIES = { wrapPercent: 0, uPercent: 30, stairPercent: 0 };
const FEATURES = { percent: 0, weights: { split: 1, pit: 1 }, threePercent: 40, deepPercent: [25, 40, 55], daisPercent: 0 };
const LAVA = { percent: [25, 35, 50], weights: { pit: 2, river: 2, trough: 3 }, twoPercent: 40 };
const LEVELS = { max: 4, min: 2, changePercent: 35, galleryPercent: 40 };
const SET_PIECES = { percent: [15, 20, 25], weights: { cross: 1, uphill: 1, spiral: 1, room: 0 } };
const withFloor = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.floor = { ...d.floor, ...patch };
  return d;
};

describe('Delver Tuning Data (data/delver.json)', () => {
  it('the bundled delver parses to the file values', () => {
    const { warbands, troops, prefabsPerFloor, sizeHp, skillTints, ...keys } = bundled.delver;
    type Row = [string, number] | [string, number, string];
    const template = (...rows: Row[]) => ({ troops: rows.map(([skill, count, rarity]) => ({ skill, count, ...(rarity ? { rarity } : {}) })), hpScale: 1, relics: [] as string[] });
    const elite = (relics: string[], hpScale: number, ...rows: Row[]) => ({ ...template(...rows), hpScale, relics });
    expect(warbands.map(({ guard, patrol }) => ({ guard, patrol }))).toEqual([
      {
        guard: [template(['Beginner', 1]), template(['Beginner', 2]), template(['Beginner', 2], ['Skilled', 1])],
        patrol: [template(['Beginner', 2]), template(['Beginner', 3]), template(['Beginner', 3], ['Skilled', 1]), template(['Beginner', 3], ['Skilled', 2])],
      },
      {
        guard: [template(['Skilled', 1], ['Expert', 1]), template(['Beginner', 2], ['Skilled', 1]), template(['Beginner', 1], ['Skilled', 1], ['Expert', 1])],
        patrol: [template(['Beginner', 3], ['Expert', 1]), template(['Skilled', 2], ['Beginner', 2]), template(['Beginner', 3], ['Skilled', 1], ['Expert', 1])],
      },
      {
        guard: [template(['Expert', 1]), template(['Expert', 1], ['Beginner', 1]), template(['Expert', 3]), template(['Expert', 1], ['Skilled', 2])],
        patrol: [template(['Expert', 2], ['Beginner', 2]), template(['Expert', 1], ['Skilled', 2], ['Beginner', 2]), template(['Expert', 3])],
      },
    ]);
    expect(prefabsPerFloor).toBe(4);
    expect(sizeHp).toEqual([20, 150]);
    // The heavy Prefabs (Bruiser, Uruk, Ork, Tin Man) join from tier 2 on; the Goblin, the weakest, leaves after tier 2.
    expect(troops.filter((p) => p.minTier !== 1).map((p) => [p.name, p.minTier])).toEqual([['Bruiser', 2], ['Uruk', 2], ['Ork', 2], ['Tin Man', 2]]);
    expect(troops.filter((p) => p.maxTier !== 3).map((p) => [p.name, p.maxTier])).toEqual([['Goblin', 2]]);
    expect(troops.map((p) => `${p.name}: ${p.rarity}`)).toEqual([
      'Sellsword: uncommon', 'Bruiser: uncommon', 'Cutthroat: uncommon', 'Acolyte: uncommon', 'Fencer: uncommon', 'Halberdier: uncommon', 'Flagellant: uncommon',
      'Lorekeeper: uncommon', 'Squire: uncommon', 'Revenant: rare', 'Uruk: rare', 'Goblin: common', 'Ork: common', 'Ranger: uncommon', 'Tin Man: rare',
    ]);
    // The elites' leaders are of an uncommon (tier 1) or a rare (tiers 2 and 3) Prefab.
    expect(warbands.map((t) => (t.elite ?? []).map((e) => e.troops.map((r) => r.rarity ?? '-').join(' ')))).toEqual([['uncommon -'], ['rare -', 'rare -'], ['rare -']]);
    expect(skillTints).toEqual({ Easy: 0x8e8e8e, Beginner: 0x8e8e8e, Normal: 0xb3261e, Skilled: 0xb3261e, Hard: 0x1c1c1c, Expert: 0x1c1c1c });
    expect(troops.map((p) => [p.name, p.body, p.weapon])).toEqual([
      ['Sellsword', 'female', 'Arming Sword'],
      ['Bruiser', 'brawler', 'Sledge Hammer'],
      ['Cutthroat', 'snake', 'Dagger'],
      ['Acolyte', 'monk', 'Quarterstaff'],
      ['Fencer', 'duelist', 'Longsword'],
      ['Halberdier', 'asturian', 'Halberd'],
      ['Flagellant', 'templar', 'Flail'],
      ['Lorekeeper', 'librarian', 'Quarterstaff'],
      ['Squire', 'prince', 'Arming Sword'],
      ['Revenant', 'wraith', 'Longsword'],
      ['Uruk', 'uruk', 'Sledge Hammer'],
      ['Goblin', 'goblin', 'Arming Sword'],
      ['Ork', 'uruk', 'Arming Sword'],
      ['Ranger', 'ranger', 'Longsword'],
      ['Tin Man', 'tinman', 'Halberd'],
    ]);
    // A Variant left unnamed is named for its Prefab and skill, and takes its Prefab's Style and Mods, else the generic soldier's.
    expect(troops[1]!.variants[0]).toEqual({ name: 'Bruiser (Beginner)', hp: 60, difficulty: 'Beginner', style: 'Reckless', quirks: ['Dumb'], relics: [], mods: { damage: 0.6 }, damage: tuning.battle.crowd.damage, hitChance: tuning.battle.crowd.hitChance, engageReach: tuning.battle.crowd.engageReach });
    // The roster pass (docs/plans/enemy-behaviours.md, Stage 6): each Prefab's plain Variants' Style and Quirks; the Bosses keep their own Style and no Quirks.
    expect(troops.map((p) => [p.name, p.variants.filter((v) => !v.boss).map((v) => [v.style, ...(v.quirks ?? [])].join(' + '))])).toEqual([
      ['Sellsword', ['Balanced', 'Balanced', 'Balanced']],
      ['Bruiser', ['Reckless + Dumb', 'Reckless', 'Reckless']],
      ['Cutthroat', ['Skirmisher', 'Skirmisher', 'Skirmisher']],
      ['Acolyte', ['Defensive', 'Defensive', 'Defensive']],
      ['Fencer', ['Counter', 'Counter', 'Counter']],
      ['Halberdier', ['Balanced', 'Balanced', 'Balanced']],
      ['Flagellant', ['Aggressive', 'Aggressive', 'Aggressive']],
      ['Lorekeeper', ['Chambermaster', 'Chambermaster', 'Chambermaster']],
      ['Squire', ['Defensive', 'Defensive + Hopper', 'Defensive + Hopper']],
      ['Revenant', ['Pack Hunter', 'Pack Hunter', 'Pack Hunter']],
      ['Uruk', ['Reckless + Slow', 'Reckless + Slow', 'Reckless + Slow']],
      ['Goblin', ['Tricky + Dumb', 'Tricky', 'Tricky']],
      ['Ork', ['Aggressive + Dumb', 'Aggressive', 'Aggressive']],
      ['Ranger', ['Skirmisher', 'Skirmisher', 'Skirmisher']],
      ['Tin Man', ['Defensive + Slow', 'Defensive + Slow', 'Defensive + Slow']],
    ]);
    expect(troops[0]!.variants[0]!.mods).toBe(tuning.battle.soldier.mods);
    expect(troops[5]!.variants[2]!.engageReach).toBe(2.2);
    expect(troops[2]!.variants[2]!.relics).toEqual(['Honed Daggers']);
    expect(keys).toEqual({
      tiers: 3,
      floorsPerTier: 3,
      flowCell: 2,
      fireRadius: 3,
      descendSeconds: 4,
      sight: 16,
      leash: 45,
      forgetSeconds: 8,
      chaseSpeed: 1,
      closeIn: 4,
      arrive: 3,
      elitePosts: 1,
      postFill: 75,
      patrolFill: 100,
      perPlayerSoldiers: 1,
      attackSlots: [4, 3, 3, 3],
      tierHp: [0.6, 1, 1.5],
      tierRooms: [7, 10, 20],
      traitor: { minDistance: 20, respawnSeconds: 8, respawnStep: 4, respawnMax: 30 },
      floor: { cols: 6, rows: 6, rooms: 20, gaps: [30, 32], halfSize: [7, 14], minPassage: 4, passage: 3, farPercent: 25, loops: [3, 5], rests: [1, 2], treasures: 1, emptyPercent: 30, patrols: 2, follow: 1.5, maxAttempts: 10, levels: { max: 4, min: 2, changePercent: 35, galleryPercent: 40 }, galleries: { wrapPercent: 40, uPercent: 30, stairPercent: 60 }, features: { percent: 80, weights: { split: 1, pit: 1 }, threePercent: 40, deepPercent: [25, 40, 55], daisPercent: 60 }, turnPercent: 30, great: { count: [1, 2], half: [18, 22] }, shapes: { percent: 50, weights: { L: 3, T: 2, cross: 2, ring: 2 } }, pillars: { percent: 40, weights: { colonnade: 1, grid: 1 } }, lava: { percent: [20, 55, 70], weights: { pit: 2, river: 2, trough: 3 }, twoPercent: 40 }, setPieces: { percent: [60, 60, 50], weights: { cross: 1, uphill: 1, spiral: 1, room: 1 } }, drawnRooms: expect.any(Array) },
    });
    expect(parse(raw(bundled))).toEqual(bundled.delver);
    expect(warbands.map((t) => t.elite)).toEqual([
      [elite(['Whetstone'], 1.5, ['Skilled', 1, 'uncommon'], ['Beginner', 2])],
      [elite(['Whetstone'], 1.5, ['Expert', 1, 'rare'], ['Skilled', 1]), elite(['Heavy Gauntlet', 'Glass Cannon'], 2, ['Expert', 1, 'rare'], ['Beginner', 2])],
      [elite(['Heavy Gauntlet', 'Glass Cannon'], 2, ['Expert', 2, 'rare'], ['Skilled', 1])],
    ]);
    const boss = (i: number) => warbands[i]!.boss!;
    expect(warbands.map((t) => t.boss?.troop)).toEqual(['Warden', 'Duelist', 'Wraith Lord']);
    const variantOf = (b: (typeof warbands)[number]['boss']) => troops[b!.prefab]!.variants[b!.variant]!;
    expect(variantOf(boss(0))).toEqual({ name: 'Warden', boss: true, hp: 250, difficulty: 'Skilled', style: 'Aggressive', relics: [], mods: {}, damage: tuning.battle.crowd.damage, hitChance: tuning.battle.crowd.hitChance, engageReach: tuning.battle.crowd.engageReach });
    expect(troops[boss(0).prefab]!.body).toBe('uruk');
    expect(troops[boss(1).prefab]!.name).toBe('Fencer');
    expect(variantOf(boss(1))).toMatchObject({ name: 'Duelist', hp: 250, difficulty: 'Expert', style: 'Counter', relics: [] });
    expect(variantOf(boss(2))).toMatchObject({ name: 'Wraith Lord', hp: 300, difficulty: 'Expert', style: 'Aggressive', relics: ['Heavy Gauntlet'] });
    expect(troops[boss(2).prefab]!.body).toBe('wraith');
    expect(boss(0).guard).toEqual([template(['Beginner', 2])]);
    expect(boss(1).guard).toEqual([template(['Expert', 1], ['Skilled', 1])]);
    expect(boss(2).guard).toEqual([template(['Expert', 2], ['Skilled', 1])]);
  });

  const bad: [string, Raw, RegExp][] = [
    ['traitor minDistance 0', { ...raw(), traitor: { minDistance: 0, respawnSeconds: 8, respawnStep: 4, respawnMax: 30 } }, /^delver\.traitor\.minDistance /],
    ['traitor respawnStep negative', { ...raw(), traitor: { minDistance: 20, respawnSeconds: 8, respawnStep: -1, respawnMax: 30 } }, /^delver\.traitor\.respawnStep /],
    ['traitor respawnMax under respawnSeconds', { ...raw(), traitor: { minDistance: 20, respawnSeconds: 8, respawnStep: 4, respawnMax: 5 } }, /^delver\.traitor\.respawnMax /],
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
    ['descendSeconds negative', { ...raw(), descendSeconds: -1 }, /^delver\.descendSeconds /],
    ['descendSeconds missing', { ...raw(), descendSeconds: undefined }, /^delver\.descendSeconds /],
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
    ['lava missing', withFloor({ lava: undefined }), /^delver\.floor\.lava /],
    ['lava.percent not a list', withFloor({ lava: { ...LAVA, percent: 25 } }), /^delver\.floor\.lava\.percent /],
    ['lava.percent empty', withFloor({ lava: { ...LAVA, percent: [] } }), /^delver\.floor\.lava\.percent /],
    ['lava.percent entry above 100', withFloor({ lava: { ...LAVA, percent: [25, 101] } }), /^delver\.floor\.lava\.percent\[1\] /],
    ['lava.percent entry negative', withFloor({ lava: { ...LAVA, percent: [-1] } }), /^delver\.floor\.lava\.percent\[0\] /],
    ['lava.percent entry fractional', withFloor({ lava: { ...LAVA, percent: [0.5] } }), /^delver\.floor\.lava\.percent\[0\] /],
    ['lava.weights missing', withFloor({ lava: { percent: [0], twoPercent: 40 } }), /^delver\.floor\.lava\.weights /],
    ['lava.weights key missing', withFloor({ lava: { ...LAVA, weights: { pit: 1, river: 1 } } }), /^delver\.floor\.lava\.weights\.trough /],
    ['lava.weights extra key', withFloor({ lava: { ...LAVA, weights: { ...LAVA.weights, moat: 1 } } }), /^delver\.floor\.lava\.weights\.moat /],
    ['lava.weights negative', withFloor({ lava: { ...LAVA, weights: { ...LAVA.weights, pit: -1 } } }), /^delver\.floor\.lava\.weights\.pit /],
    ['lava.weights fractional', withFloor({ lava: { ...LAVA, weights: { ...LAVA.weights, river: 1.5 } } }), /^delver\.floor\.lava\.weights\.river /],
    ['lava.weights all 0', withFloor({ lava: { ...LAVA, weights: { pit: 0, river: 0, trough: 0 } } }), /^delver\.floor\.lava\.weights /],
    ['lava.twoPercent missing', withFloor({ lava: { percent: [0], weights: LAVA.weights } }), /^delver\.floor\.lava\.twoPercent /],
    ['lava.twoPercent above 100', withFloor({ lava: { ...LAVA, twoPercent: 101 } }), /^delver\.floor\.lava\.twoPercent /],
    ['lava.twoPercent fractional', withFloor({ lava: { ...LAVA, twoPercent: 0.5 } }), /^delver\.floor\.lava\.twoPercent /],
    ['lava.twoPercent negative', withFloor({ lava: { ...LAVA, twoPercent: -1 } }), /^delver\.floor\.lava\.twoPercent /],
    ['setPieces missing', withFloor({ setPieces: undefined }), /^delver\.floor\.setPieces /],
    ['setPieces.percent not a list', withFloor({ setPieces: { ...SET_PIECES, percent: 10 } }), /^delver\.floor\.setPieces\.percent /],
    ['setPieces.percent empty', withFloor({ setPieces: { ...SET_PIECES, percent: [] } }), /^delver\.floor\.setPieces\.percent /],
    ['setPieces.percent entry above 100', withFloor({ setPieces: { ...SET_PIECES, percent: [10, 101] } }), /^delver\.floor\.setPieces\.percent\[1\] /],
    ['setPieces.percent entry negative', withFloor({ setPieces: { ...SET_PIECES, percent: [-1] } }), /^delver\.floor\.setPieces\.percent\[0\] /],
    ['setPieces.percent entry fractional', withFloor({ setPieces: { ...SET_PIECES, percent: [0.5] } }), /^delver\.floor\.setPieces\.percent\[0\] /],
    ['setPieces.weights missing', withFloor({ setPieces: { percent: [0] } }), /^delver\.floor\.setPieces\.weights /],
    ['setPieces.weights key missing', withFloor({ setPieces: { ...SET_PIECES, weights: { cross: 1, uphill: 1, room: 0 } } }), /^delver\.floor\.setPieces\.weights\.spiral /],
    ['setPieces.weights extra key', withFloor({ setPieces: { ...SET_PIECES, weights: { ...SET_PIECES.weights, maze: 1 } } }), /^delver\.floor\.setPieces\.weights\.maze /],
    ['setPieces.weights negative', withFloor({ setPieces: { ...SET_PIECES, weights: { ...SET_PIECES.weights, cross: -1 } } }), /^delver\.floor\.setPieces\.weights\.cross /],
    ['setPieces.weights fractional', withFloor({ setPieces: { ...SET_PIECES, weights: { ...SET_PIECES.weights, uphill: 1.5 } } }), /^delver\.floor\.setPieces\.weights\.uphill /],
    ['setPieces.weights.room missing (Stage 7g)', withFloor({ setPieces: { ...SET_PIECES, weights: { cross: 1, uphill: 1, spiral: 1 } } }), /^delver\.floor\.setPieces\.weights\.room /],
    ['setPieces.weights.room above 0 with no room file', withFloor({ setPieces: { ...SET_PIECES, weights: { cross: 1, uphill: 1, spiral: 1, room: 1 } } }), /^delver\.floor\.setPieces\.weights\.room .*room file/],
    ['a bad drawn room', withFloor({ drawnRooms: [{ name: 'x' }] }), /^delver\.drawnRooms\[0\] \(x\)\.half/],
    ['setPieces.weights all 0', withFloor({ setPieces: { ...SET_PIECES, weights: { cross: 0, uphill: 0, spiral: 0, room: 0 } } }), /^delver\.floor\.setPieces\.weights /],
    ['a Spiral with levels.max under 3', withFloor({ setPieces: { percent: [10], weights: SET_PIECES.weights }, levels: { max: 2, min: 2, changePercent: 35, galleryPercent: 40 } }), /^delver\.floor\.setPieces\.weights\.spiral .*levels\.max/],
    ['an Uphill with levels.max 0', withFloor({ setPieces: { percent: [10], weights: { cross: 1, uphill: 1, spiral: 0, room: 0 } }, features: { ...FEATURES, percent: 0 }, levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 } }), /^delver\.floor\.setPieces\.weights\.uphill .*levels\.max/],
    ['features missing', withFloor({ features: undefined }), /^delver\.floor\.features /],
    ['features.percent above 100', withFloor({ features: { ...FEATURES, percent: 101 } }), /^delver\.floor\.features\.percent /],
    ['features.percent fractional', withFloor({ features: { ...FEATURES, percent: 0.5 } }), /^delver\.floor\.features\.percent /],
    ['features.percent negative', withFloor({ features: { ...FEATURES, percent: -1 } }), /^delver\.floor\.features\.percent /],
    ['features.percent above 0 with levels.max 0', withFloor({ features: { ...FEATURES, percent: 50 }, levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 } }), /^delver\.floor\.features\.percent .*levels\.max/],
    ['features.weights missing', withFloor({ features: { percent: 0, threePercent: 40, deepPercent: [25], daisPercent: 0 } }), /^delver\.floor\.features\.weights /],
    ['features.weights key missing', withFloor({ features: { ...FEATURES, weights: { split: 1 } } }), /^delver\.floor\.features\.weights\.pit /],
    ['features.weights typo', withFloor({ features: { ...FEATURES, weights: { split: 1, pitt: 1 } } }), /^delver\.floor\.features\.weights\.pitt /],
    ['features.weights negative', withFloor({ features: { ...FEATURES, weights: { split: -1, pit: 1 } } }), /^delver\.floor\.features\.weights\.split /],
    ['features.weights fractional', withFloor({ features: { ...FEATURES, weights: { split: 1.5, pit: 1 } } }), /^delver\.floor\.features\.weights\.split /],
    ['features.weights all 0', withFloor({ features: { ...FEATURES, weights: { split: 0, pit: 0 } } }), /^delver\.floor\.features\.weights /],
    ['features.threePercent above 100', withFloor({ features: { ...FEATURES, threePercent: 101 } }), /^delver\.floor\.features\.threePercent /],
    ['features.threePercent fractional', withFloor({ features: { ...FEATURES, threePercent: 0.5 } }), /^delver\.floor\.features\.threePercent /],
    ['features.threePercent negative', withFloor({ features: { ...FEATURES, threePercent: -1 } }), /^delver\.floor\.features\.threePercent /],
    ['features.deepPercent not a list', withFloor({ features: { ...FEATURES, deepPercent: 25 } }), /^delver\.floor\.features\.deepPercent /],
    ['features.deepPercent empty', withFloor({ features: { ...FEATURES, deepPercent: [] } }), /^delver\.floor\.features\.deepPercent /],
    ['features.deepPercent entry above 100', withFloor({ features: { ...FEATURES, deepPercent: [25, 101] } }), /^delver\.floor\.features\.deepPercent\[1\] /],
    ['features.deepPercent entry fractional', withFloor({ features: { ...FEATURES, deepPercent: [0.5] } }), /^delver\.floor\.features\.deepPercent\[0\] /],
    ['features.daisPercent missing', withFloor({ features: { percent: 0, weights: { split: 1, pit: 1 }, threePercent: 40, deepPercent: [25] } }), /^delver\.floor\.features\.daisPercent /],
    ['features.daisPercent above 100', withFloor({ features: { ...FEATURES, daisPercent: 101 } }), /^delver\.floor\.features\.daisPercent /],
    ['features.daisPercent fractional', withFloor({ features: { ...FEATURES, daisPercent: 0.5 } }), /^delver\.floor\.features\.daisPercent /],
    ['features.daisPercent negative', withFloor({ features: { ...FEATURES, daisPercent: -1 } }), /^delver\.floor\.features\.daisPercent /],
    ['features.deepPercent entry negative', withFloor({ features: { ...FEATURES, deepPercent: [-1] } }), /^delver\.floor\.features\.deepPercent\[0\] /],
    ['galleries missing', withFloor({ galleries: undefined }), /^delver\.floor\.galleries /],
    ['galleries.wrapPercent missing', withFloor({ galleries: { uPercent: 30, stairPercent: 0 } }), /^delver\.floor\.galleries\.wrapPercent /],
    ['galleries.wrapPercent above 100', withFloor({ galleries: { ...GALLERIES, wrapPercent: 101 } }), /^delver\.floor\.galleries\.wrapPercent /],
    ['galleries.wrapPercent fractional', withFloor({ galleries: { ...GALLERIES, wrapPercent: 0.5 } }), /^delver\.floor\.galleries\.wrapPercent /],
    ['galleries.wrapPercent negative', withFloor({ galleries: { ...GALLERIES, wrapPercent: -1 } }), /^delver\.floor\.galleries\.wrapPercent /],
    ['galleries.uPercent above 100', withFloor({ galleries: { ...GALLERIES, uPercent: 101 } }), /^delver\.floor\.galleries\.uPercent /],
    ['galleries.uPercent fractional', withFloor({ galleries: { ...GALLERIES, uPercent: 0.5 } }), /^delver\.floor\.galleries\.uPercent /],
    ['galleries.uPercent negative', withFloor({ galleries: { ...GALLERIES, uPercent: -1 } }), /^delver\.floor\.galleries\.uPercent /],
    ['galleries.stairPercent above 100', withFloor({ galleries: { ...GALLERIES, stairPercent: 101 } }), /^delver\.floor\.galleries\.stairPercent /],
    ['galleries.stairPercent fractional', withFloor({ galleries: { ...GALLERIES, stairPercent: 0.5 } }), /^delver\.floor\.galleries\.stairPercent /],
    ['galleries.stairPercent negative', withFloor({ galleries: { ...GALLERIES, stairPercent: -1 } }), /^delver\.floor\.galleries\.stairPercent /],
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
    ['tierRooms too short', withKey({ tierRooms: [7, 10] }), /^delver\.tierRooms /],
    ['tierRooms below 2', withKey({ tierRooms: [1, 10, 20] }), /^delver\.tierRooms\[0\] /],
    ['tierRooms above cols * rows', withKey({ tierRooms: [7, 43, 20] }), /^delver\.tierRooms\[1\] /],
    ['tierRooms fractional', withKey({ tierRooms: [7, 10, 20.5] }), /^delver\.tierRooms\[2\] /],
    ['warbands too short', withKey({ warbands: (raw().warbands as unknown[]).slice(0, 2) }), /^delver\.warbands /],
    ['guard pool empty', withGuard([]), /^delver\.warbands\[0\]\.guard /],
    ['patrol pool empty', withKey({ warbands: (raw().warbands as Record<string, unknown>[]).map((t, i) => (i === 2 ? { ...t, patrol: [] } : t)) }), /^delver\.warbands\[2\]\.patrol /],
    ['template without Troops', withGuard([{ troops: [], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops /],
    ['unknown skill', withGuard([{ troops: [{ skill: 'Godlike', count: 1 }], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.skill /],
    ['a row naming a Troop rather than a skill', withGuard([{ troops: [{ troop: 'Levy', count: 1 }], hpScale: 1 }]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.skill /],
    ['count 0', withGuard([levy(0)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.count /],
    ['count fractional', withGuard([levy(1.5)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.count /],
    ['template above squad.size', withGuard([levy(tuning.battle.squad.size + 1)]), /^delver\.warbands\[0\]\.guard\[0\]\.troops /],
    ['hpScale 0', withGuard([{ ...levy(3), hpScale: 0 }]), /^delver\.warbands\[0\]\.guard\[0\]\.hpScale /],
    ['elitePosts negative', withKey({ elitePosts: -1 }), /^delver\.elitePosts /],
    ['elitePosts fractional', withKey({ elitePosts: 1.5 }), /^delver\.elitePosts /],
    ['elite template without relics', withTier({ elite: [{ troops: [{ skill: 'Beginner', count: 1 }], hpScale: 1 }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics /],
    ['elite template with an unknown Relic', withTier({ elite: [{ ...eliteOf()[0]!, relics: ['Nope'] }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics\[0\] /],
    ['elite template with too many Relics', withTier({ elite: [{ ...eliteOf()[0]!, relics: ['Whetstone', 'Whetstone', 'Whetstone'] }] }), /^delver\.warbands\[2\]\.elite\[0\]\.relics /],
    ['relics key on a guard template', withGuard([{ ...levy(1), relics: ['Whetstone'] }]), /^delver\.warbands\[0\]\.guard\[0\]\.relics /],
    ['relics key on a patrol template', withTier({ patrol: [{ ...levy(1), relics: ['Whetstone'] }] }), /^delver\.warbands\[2\]\.patrol\[0\]\.relics /],
    ['boss naming no Variant', withTier({ boss: { ...bossOf(), troop: 'Dragon' } }), /^delver\.warbands\[2\]\.boss\.troop /],
    ['boss naming a Variant that is not a Boss\'s', withTier({ boss: { ...bossOf(), troop: 'Uruk (Beginner)' } }), /^delver\.warbands\[2\]\.boss\.troop /],
    ['troops empty', withKey({ troops: [] }), /^delver\.troops /],
    ['troops missing', withKey({ troops: undefined }), /^delver\.troops /],
    ['Prefab name empty', withPrefab(0, { name: '' }), /^delver\.troops\[0\]\.name /],
    ['Prefab named twice', withPrefab(1, { name: 'Sellsword' }), /^delver\.troops\[1\]\.name /],
    ['Prefab body empty', withPrefab(0, { body: '' }), /^delver\.troops\[0\]\.body /],
    ['Prefab weapon unknown', withPrefab(0, { weapon: 'Banana' }), /^delver\.troops\[0\]\.weapon /],
    ['two Prefabs of one look', withPrefab(1, { body: 'female', weapon: 'Arming Sword' }), /^delver\.troops\[1\] /],
    ['Prefab style unknown', withPrefab(0, { style: 'Sleepy' }), /^delver\.troops\[0\]\.style /],
    ['Prefab mods not a multiplier', withPrefab(0, { mods: { maxHp: 2 } }), /^delver\.troops\[0\]\.mods\.maxHp /],
    ['Prefab hitChance above 1', withPrefab(0, { hitChance: 2 }), /^delver\.troops\[0\]\.hitChance /],
    ['Prefab without Variants', withPrefab(0, { variants: [] }), /^delver\.troops\[0\]\.variants /],
    ['Variant hp 0', withPrefab(0, {}, 0, { hp: 0 }), /^delver\.troops\[0\]\.variants\[0\]\.hp /],
    ['Variant difficulty unknown', withPrefab(0, {}, 0, { difficulty: 'Godlike' }), /^delver\.troops\[0\]\.variants\[0\]\.difficulty /],
    ['Variant style unknown', withPrefab(0, {}, 0, { style: 'random' }), /^delver\.troops\[0\]\.variants\[0\]\.style /],
    ['Prefab Quirk unknown', withPrefab(0, { quirks: ['Sleepy'] }), /^delver\.troops\[0\]\.quirks\[0\] .*one of the Quirks \(Dumb, Hopper/],
    ['Prefab Quirks not a list', withPrefab(0, { quirks: 'Dumb' }), /^delver\.troops\[0\]\.quirks /],
    ['Variant Quirk unknown', withPrefab(0, {}, 0, { quirks: ['Dumb', 'Clumsy'] }), /^delver\.troops\[0\]\.variants\[0\]\.quirks\[1\] .*one of the Quirks \(Dumb, Hopper, Slow/],
    ['Variant Quirk twice', withPrefab(0, {}, 0, { quirks: ['Dumb', 'Dumb'] }), /^delver\.troops\[0\]\.variants\[0\]\.quirks\[1\] /],
    ['Variant relic unknown', withPrefab(0, {}, 0, { relics: ['Nope'] }), /^delver\.troops\[0\]\.variants\[0\]\.relics\[0\] /],
    ['Variant with too many Relics', withPrefab(0, {}, 0, { relics: ['Whetstone', 'Whetstone', 'Whetstone'] }), /^delver\.troops\[0\]\.variants\[0\]\.relics /],
    ['Variant damage reversed', withPrefab(0, {}, 0, { damage: [5, 2] }), /^delver\.troops\[0\]\.variants\[0\]\.damage /],
    ['Variant boss not true', withPrefab(0, {}, 0, { boss: 'yes' }), /^delver\.troops\[0\]\.variants\[0\]\.boss /],
    ['Variant named twice', withPrefab(0, {}, 0, { name: 'Warden' }), /^delver\.troops\[\d+\]\.variants\[\d+\]\.name /],
    ['Prefab missing a skill the templates name', withPrefab(0, {}, 2, { difficulty: 'Skilled', name: 'Sellsword (Skilled again)' }), /^delver\.troops\[0\]\.variants .*Expert/],
    ['no Prefab fills rows', withKey({ troops: [{ name: 'Lone', body: 'uruk', weapon: 'Sledge Hammer', variants: [{ name: 'Warden', boss: true, difficulty: 'Skilled', hp: 250 }] }] }), /^delver\.troops /],
    ['prefabsPerFloor 0', withKey({ prefabsPerFloor: 0 }), /^delver\.prefabsPerFloor /],
    ['prefabsPerFloor fractional', withKey({ prefabsPerFloor: 1.5 }), /^delver\.prefabsPerFloor /],
    ['sizeHp reversed', withKey({ sizeHp: [150, 30] }), /^delver\.sizeHp /],
    ['sizeHp equal', withKey({ sizeHp: [30, 30] }), /^delver\.sizeHp /],
    ['sizeHp from 0', withKey({ sizeHp: [0, 30] }), /^delver\.sizeHp /],
    ['skillTints of no difficulty', withKey({ skillTints: { Godlike: '#ffffff' } }), /^delver\.skillTints\.Godlike /],
    ['skillTints not a colour', withKey({ skillTints: { Expert: 'black' } }), /^delver\.skillTints\.Expert /],
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

  it("takes Quirks on a Prefab and a Variant: a Variant's list replaces its Prefab's ([] drops them), and defaults to it; none parses as before", () => {
    const parsed = parse(withPrefab(1, { quirks: ['Dumb'] }, 1, { quirks: ['Hopper', 'Dumb'] }));
    const [beginner, skilled, expert] = parsed.troops[1]!.variants;
    expect([beginner!.quirks, skilled!.quirks, expert!.quirks]).toEqual([['Dumb'], ['Hopper', 'Dumb'], ['Dumb']]);
    expect(parse(withPrefab(1, { quirks: ['Dumb'] }, 0, { quirks: [] })).troops[1]!.variants[0]).not.toHaveProperty('quirks');
    // A Variant without Quirks has no key: in the bundled data only the roster pass's (Stage 6) have one, and the Warden's [] drops the Uruk's Slow.
    expect(parse(raw()).troops.flatMap((p) => p.variants).filter((v) => 'quirks' in v).map((v) => v.name)).toEqual(['Bruiser (Beginner)', 'Squire (Skilled)', 'Squire (Expert)', 'Uruk (Beginner)', 'Uruk (Skilled)', 'Uruk (Expert)', 'Goblin (Beginner)', 'Ork (Beginner)', 'Tin Man (Beginner)', 'Tin Man (Skilled)', 'Tin Man (Expert)']);
  });

  it('takes its own parsed form back in', () => {
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

  it('takes the 7c galleries keys: three whole percents', () => {
    const g = { wrapPercent: 40, uPercent: 30, stairPercent: 60 };
    expect(parse(withFloor({ galleries: g })).floor.galleries).toEqual(g);
    expect(parse(withFloor({ galleries: { wrapPercent: 0, uPercent: 100, stairPercent: 100 } })).floor.galleries).toEqual({ wrapPercent: 0, uPercent: 100, stairPercent: 100 });
    expect(tuning.delver.floor.galleries).toEqual(GALLERIES);
    // The shipped values (Stage 7c's switch).
    expect(bundled.delver.floor.galleries).toEqual({ wrapPercent: 40, uPercent: 30, stairPercent: 60 });
  });

  it('takes the 7c features keys: a percent, whole weights, a percent for three tiers and one per Run tier for deep pits', () => {
    const fe = { percent: 50, weights: { split: 0, pit: 3 }, threePercent: 100, deepPercent: [0, 100], daisPercent: 60 };
    expect(parse(withFloor({ features: fe })).floor.features).toEqual(fe);
    expect(parse(withFloor({ features: { ...FEATURES, percent: 100, deepPercent: [10] } })).floor.features.deepPercent).toEqual([10]);
    // With levels.max 0 a feature has nowhere to stand a level over another, but percent 0 asks for none.
    expect(parse(withFloor({ levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 } })).floor.features).toEqual(FEATURES);
    expect(tuning.delver.floor.features).toEqual(FEATURES);
    expect(bundled.delver.floor.features).toEqual({ percent: 80, weights: { split: 1, pit: 1 }, threePercent: 40, deepPercent: [25, 40, 55], daisPercent: 60 });
  });

  it('takes the 7d lava keys: a percent per Run tier, whole weights and a percent', () => {
    expect(parse(withFloor({ lava: LAVA })).floor.lava).toEqual(LAVA);
    expect(parse(withFloor({ lava: { percent: [0, 100], weights: { pit: 0, river: 0, trough: 1 }, twoPercent: 100 } })).floor.lava).toEqual({ percent: [0, 100], weights: { pit: 0, river: 0, trough: 1 }, twoPercent: 100 });
    expect(parse(withFloor({ lava: { ...LAVA, percent: [10] } })).floor.lava.percent).toEqual([10]);
    // The shipped values (Stage 7d's switch): tuned so about 1 in 6, 1 in 4 and 1 in 3 of the Halls that may hold lava do, on tiers 1, 2 and 3.
    expect(bundled.delver.floor.lava).toEqual({ percent: [20, 55, 70], weights: { pit: 2, river: 2, trough: 3 }, twoPercent: 40 });
  });

  it('takes the 7f set-piece keys: a percent per Run tier and whole weights; a Spiral needs 3 levels and an Uphill 1', () => {
    expect(parse(withFloor({ setPieces: SET_PIECES })).floor.setPieces).toEqual(SET_PIECES);
    expect(parse(withFloor({ setPieces: { percent: [0, 100], weights: { cross: 0, uphill: 0, spiral: 1, room: 0 } } })).floor.setPieces).toEqual({ percent: [0, 100], weights: { cross: 0, uphill: 0, spiral: 1, room: 0 } });
    // A Lava Bridge alone needs no level; and with percent 0 nothing is asked for at all.
    const flat = { levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 }, features: { ...FEATURES, percent: 0 } };
    expect(parse(withFloor({ ...flat, setPieces: { percent: [10], weights: { cross: 1, uphill: 0, spiral: 0, room: 0 } } })).floor.setPieces.percent).toEqual([10]);
    expect(parse(withFloor({ ...flat, setPieces: { ...SET_PIECES, percent: [0] } })).floor.setPieces.weights).toEqual(SET_PIECES.weights);
    // The shipped values (Stage 7f's switch): about 1 Hall in 10 on every tier.
    // Stage 7g: the drawn rooms weighted as each 7f set piece is, once a room file has shipped.
    expect(bundled.delver.floor.setPieces).toEqual({ percent: [60, 60, 50], weights: { cross: 1, uphill: 1, spiral: 1, room: 1 } });
  });

  it('accepts a fractional follow', () => {
    expect(parse(withFloor({ follow: 1.25 })).floor.follow).toBe(1.25);
  });

  it('reads a Prefab\'s minTier (absent: 1), and refuses one outside 1 to tiers', () => {
    const parsed = parse(withPrefab(0, { minTier: 3 }));
    expect(parsed.troops[0]!.minTier).toBe(3);
    expect(parse(withPrefab(0, { minTier: undefined })).troops[0]!.minTier).toBe(1);
    expect(parse(parsed as unknown as Raw).troops[0]!.minTier).toBe(3);
    expect(() => parse(withPrefab(0, { minTier: 0 }))).toThrow(/delver\.troops\[0\]\.minTier/);
    expect(() => parse(withPrefab(0, { minTier: 4 }))).toThrow(/delver\.troops\[0\]\.minTier must be a tier from 1 to 3/);
    expect(() => parse(withPrefab(0, { minTier: 1.5 }))).toThrow(/minTier/);
  });

  it('reads a Prefab\'s maxTier (absent: tiers), and refuses one below its minTier or above tiers', () => {
    const parsed = parse(withPrefab(0, { maxTier: 2 }));
    expect(parsed.troops[0]!.maxTier).toBe(2);
    expect(parse(withPrefab(0, { maxTier: undefined })).troops[0]!.maxTier).toBe(3);
    expect(parse(parsed as unknown as Raw).troops[0]!.maxTier).toBe(2);
    expect(parse(withPrefab(0, { minTier: 2, maxTier: 2 })).troops[0]!).toMatchObject({ minTier: 2, maxTier: 2 });
    expect(() => parse(withPrefab(0, { minTier: 2, maxTier: 1 }))).toThrow(/delver\.troops\[0\]\.maxTier must be a tier from its minTier \(2\) to 3/);
    expect(() => parse(withPrefab(0, { maxTier: 4 }))).toThrow(/delver\.troops\[0\]\.maxTier/);
    expect(() => parse(withPrefab(0, { maxTier: 0 }))).toThrow(/delver\.troops\[0\]\.maxTier/);
  });

  it('refuses a tier every Prefab has left by its maxTier', () => {
    const d = raw();
    d.troops = (d.troops as Record<string, unknown>[]).map((p) => ({ ...p, minTier: 1, maxTier: 2 }));
    expect(() => parse(d)).toThrow(/a maxTier of 3 or more \(for tier 3\)/);
  });

  it('reads a Prefab\'s rarity (absent: common), and refuses one not a Troop Rarity', () => {
    expect(parse(withPrefab(0, { rarity: 'rare' })).troops[0]!.rarity).toBe('rare');
    expect(parse(withPrefab(0, { rarity: undefined })).troops[0]!.rarity).toBe('common');
    expect(() => parse(withPrefab(0, { rarity: 'Legendary' }))).toThrow(/delver\.troops\[0\]\.rarity must be a Troop Rarity \(common, uncommon, rare\)/);
  });

  it('reads a template row\'s rarity (absent: none), and refuses a bad one or one its tier fields no Prefab of', () => {
    const row = (rarity: unknown) => withGuard([{ troops: [{ skill: 'Beginner', count: 2, rarity }], hpScale: 1 }]);
    const d = raw();
    d.troops = (d.troops as Record<string, unknown>[]).map((p, i) => ({ ...p, rarity: i === 0 ? 'rare' : 'common' }));
    // Tier 1 asks for one rare row (its guard) and no other: its elite's uncommon leader is dropped.
    d.warbands = (d.warbands as Record<string, unknown>[]).map((t, i) => (i === 0 ? { ...t, elite: [], guard: [{ troops: [{ skill: 'Beginner', count: 2, rarity: 'rare' }], hpScale: 1 }] } : t));
    const parsed = parse(d);
    expect(parsed.warbands[0]!.guard[0]!.troops[0]).toEqual({ skill: 'Beginner', count: 2, rarity: 'rare' });
    expect(parse(parsed as unknown as Raw).warbands[0]!.guard[0]!.troops[0]!.rarity).toBe('rare');
    expect(parse(withGuard([levy(1)])).warbands[0]!.guard[0]!.troops[0]).toEqual({ skill: 'Beginner', count: 1 });
    expect(() => parse(row('epic'))).toThrow(/delver\.warbands\[0\]\.guard\[0\]\.troops\[0\]\.rarity must be a Troop Rarity/);
    // Only Prefab 0 is rare: a tier that no longer fields it may not ask for a rare row.
    d.troops = (d.troops as Record<string, unknown>[]).map((p, i) => (i === 0 ? { ...p, minTier: 2 } : p));
    expect(() => parse(d)).toThrow(/rows of rarity rare only when tier 1 fields a Prefab of it/);
  });

  it('refuses a tier no Prefab may field', () => {
    const d = raw();
    d.troops = (d.troops as Record<string, unknown>[]).map((p) => ({ ...p, minTier: 2, maxTier: undefined }));
    expect(() => parse(d)).toThrow(/a minTier of 1 or less and a maxTier of 1 or more \(for tier 1\)/);
  });

  it('accepts a Prefab whose Variants are only a Boss\'s (it fills no row), and a tint left out', () => {
    const d = raw();
    const tints = { ...(d.skillTints as Record<string, unknown>) };
    delete tints.Expert;
    d.skillTints = tints;
    d.troops = [...(d.troops as unknown[]), { name: 'Dragon', body: 'uruk', weapon: 'Flail', variants: [{ name: 'Dragon Lord', boss: true, difficulty: 'Expert', hp: 400 }] }];
    const parsed = parse(d);
    expect(parsed.troops.at(-1)!.variants[0]).toMatchObject({ name: 'Dragon Lord', boss: true, style: 'Balanced', relics: [] });
    expect(parsed.skillTints.Expert).toBeUndefined();
  });

  it('refuses a Tuning whose Floor Troops exceed MAX_FLOOR_TROOPS, and accepts one at it', () => {
    expect(MAX_FLOOR_TROOPS).toBe(256);
    // Each new elite Relic set adds every non-Boss Variant again.
    const plain = tuning.delver.troops.reduce((n, p) => n + p.variants.filter((v) => !v.boss).length, 0);
    const names = tuning.relics.map((r) => r.name);
    // Distinct Relic sets: each Relic alone, then each pair.
    const combos = [...names.map((r) => [r]), ...names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b]))];
    const withSets = (sets: number): Raw => {
      const d = raw();
      const tiers = d.warbands as { elite: unknown[] }[];
      tiers[0]!.elite = combos.slice(0, sets).map((relics) => ({ hpScale: 1, relics, troops: [{ skill: 'Beginner', count: 1 }] }));
      return d;
    };
    let prev = floorTroopCount(parse(withSets(1)));
    for (let sets = 2; sets <= combos.length; sets++) {
      let count: number;
      try {
        count = floorTroopCount(parse(withSets(sets)));
      } catch (e) {
        expect(String(e)).toMatch(/Floor Troops/);
        expect(prev).toBeLessThanOrEqual(MAX_FLOOR_TROOPS);
        expect(prev + plain).toBeGreaterThan(MAX_FLOOR_TROOPS);
        return;
      }
      expect(count).toBeLessThanOrEqual(MAX_FLOOR_TROOPS);
      prev = count;
    }
    throw new Error('never past MAX_FLOOR_TROOPS');
  });

  it('is in the Tuning Data hash, with the Floor generator version', () => {
    const base = tuningDataHash(tuning);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, floorsPerTier: tuning.delver.floorsPerTier + 1 } })).not.toBe(base);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, tiers: tuning.delver.tiers + 1 } })).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION + 1)).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION)).toBe(base);
  });
});
