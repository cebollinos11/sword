import { describe, expect, it } from 'vitest';
import greyboxJson from '../../data/kits/greybox.json';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, hashValue } from '../sim';
import { HAND_WRITTEN_GREYBOX_KIT } from '../sim/arenaGen/greyboxKit.reference';
import { loadTuningData, parseKit, tuningDataHash, TuningDataError, type TuningData } from './index';

const tuning = loadTuningData();
/** A fresh, editable copy of the greybox Kit file. */
const raw = (): any => JSON.parse(JSON.stringify(greyboxJson));

describe('Kits as Tuning Data (data/kits/<name>.json)', () => {
  it('reads the greybox Kit file exactly as the hand-written TypeScript Kit was', () => {
    expect(parseKit(greyboxJson, 'data/kits/greybox.json')).toStrictEqual(HAND_WRITTEN_GREYBOX_KIT);
  });

  it('loads every Kit file into the Tuning Data, by name; GREYBOX_KIT is the greybox file', () => {
    expect(Object.keys(tuning.kits)).toEqual(['greybox']);
    expect(tuning.kits.greybox).toStrictEqual(HAND_WRITTEN_GREYBOX_KIT);
    expect(GREYBOX_KIT).toStrictEqual(HAND_WRITTEN_GREYBOX_KIT);
  });

  it('parses parsed Kits again (Tuning Data round trip)', () => {
    expect(parseKit(JSON.parse(JSON.stringify(GREYBOX_KIT)), 'again')).toStrictEqual(GREYBOX_KIT);
  });

  it('builds the same Generated Arenas from the file as from the hand-written Kit', () => {
    for (const seed of [1, 12, 31]) {
      const before = generateArena(HAND_WRITTEN_GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      const after = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      expect(hashValue(after.arena)).toBe(hashValue(before.arena));
      expect(after.layout).toEqual(before.layout);
    }
  });

  it('is part of the Tuning Data hash, so peers with different Kits refuse each other', () => {
    const kit = tuning.kits.greybox!;
    const changed: TuningData = { ...tuning, kits: { greybox: { ...kit, levelHeight: kit.levelHeight + 0.5 } } };
    expect(tuningDataHash(changed)).not.toBe(tuningDataHash(tuning));
  });

  describe('rejects a Kit that would break the assembler', () => {
    const rejects = (edit: (k: any) => void, message: RegExp) => {
      const k = raw();
      edit(k);
      expect(() => parseKit(k, 'kit')).toThrow(TuningDataError);
      expect(() => parseKit(k, 'kit')).toThrow(message);
    };

    it('a missing or unknown Piece, or one filed under another id', () => {
      rejects((k) => delete k.pieces.ramp, /kit\.pieces\.ramp/);
      rejects((k) => (k.pieces.stairs = k.pieces.floor), /unknown Piece "stairs"/);
      rejects((k) => (k.pieces.floor.id = 'crate'), /kit\.pieces\.floor\.id/);
    });

    it('a bad grid', () => {
      rejects((k) => (k.cell = 0), /kit\.cell/);
      rejects((k) => (k.maxLevels = 1.5), /kit\.maxLevels/);
      rejects((k) => (k.pieces.ramp.rows = 0), /kit\.pieces\.ramp\.rows/);
    });

    it('a Walk Surface that is not convex, or reaches out of its footprint', () => {
      rejects((k) => (k.pieces.floor.walk[0].points = [[0, 0, 0], [3, 0, 0], [1, 0, 1], [0, 0, 3]]), /not convex/);
      rejects((k) => (k.pieces.floor.walk[0].points[1] = [3.5, 0, 0]), /outside the Piece's footprint/);
      rejects((k) => (k.pieces.floor.walk[0].tile = 'yes'), /tile must be true or false/);
    });

    it('a Wall upside down or out of its footprint', () => {
      rejects((k) => (k.pieces.rail.walls[0].top = -1), /top must be above its bottom/);
      rejects((k) => (k.pieces.rail.walls[0].b = [4, 0]), /outside the Piece's footprint/);
    });

    it('a connector or skirt off the Piece, or on no side', () => {
      rejects((k) => (k.pieces.ramp.connectors[1].row = 2), /connectors\[1\]\.row/);
      rejects((k) => (k.pieces.floor.connectors[0].side = 4), /side must be 0, 1, 2 or 3/);
      rejects((k) => (k.pieces.ramp.skirts[1].max = -1), /max must be at least its min/);
    });
  });
});
