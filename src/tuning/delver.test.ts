import { describe, expect, it } from 'vitest';
import { DELVER_VERSION } from '../sim/delver/version';
import { loadTuningData, parseDelver, tuningDataHash } from './index';

const tuning = loadTuningData();
const FIELD = tuning.battle.field.size;
type Raw = { tiers: unknown; floorsPerTier: unknown; flowCell: unknown; floor: Record<string, unknown> };
const raw = (): Raw => JSON.parse(JSON.stringify(tuning.delver)) as Raw;
const withFloor = (patch: Record<string, unknown>): Raw => {
  const d = raw();
  d.floor = { ...d.floor, ...patch };
  return d;
};

describe('Delver Tuning Data (data/delver.json)', () => {
  it('the bundled delver parses to the file values', () => {
    expect(tuning.delver).toEqual({
      tiers: 3,
      floorsPerTier: 3,
      flowCell: 2,
      floor: { cols: 7, rows: 6, rooms: 22, gaps: [22, 24, 26, 28], halfSize: [5, 11], minPassage: 4, passage: 3, farPercent: 25, loops: [3, 5], rests: [1, 2], treasures: 1, emptyPercent: 30, patrols: 2, follow: 1.5, maxAttempts: 10 },
    });
    expect(parseDelver(raw(), FIELD)).toEqual(tuning.delver);
  });

  const bad: [string, Raw, RegExp][] = [
    ['tiers 0', { ...raw(), tiers: 0 }, /^delver\.tiers /],
    ['tiers fractional', { ...raw(), tiers: 1.5 }, /^delver\.tiers /],
    ['floorsPerTier 0', { ...raw(), floorsPerTier: 0 }, /^delver\.floorsPerTier /],
    ['floorsPerTier fractional', { ...raw(), floorsPerTier: 1.5 }, /^delver\.floorsPerTier /],
    ['flowCell not positive', { ...raw(), flowCell: 0 }, /^delver\.flowCell /],
    ['flowCell not 2 (the Floor rule is written for a 2 m cell)', { ...raw(), flowCell: 4 }, /^delver\.flowCell /],
    ['flowCell missing', { ...raw(), flowCell: undefined }, /^delver\.flowCell /],
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
  ];
  it.each(bad)('refuses %s, naming its path', (_name, data, path) => {
    expect(() => parseDelver(data, FIELD)).toThrow(path);
  });

  it('accepts a fractional follow', () => {
    expect(parseDelver(withFloor({ follow: 1.25 }), FIELD).floor.follow).toBe(1.25);
  });

  it('is in the Tuning Data hash, with the Floor generator version', () => {
    const base = tuningDataHash(tuning);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, floorsPerTier: tuning.delver.floorsPerTier + 1 } })).not.toBe(base);
    expect(tuningDataHash({ ...tuning, delver: { ...tuning.delver, tiers: tuning.delver.tiers + 1 } })).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION + 1)).not.toBe(base);
    expect(tuningDataHash(tuning, undefined, DELVER_VERSION)).toBe(base);
  });
});
