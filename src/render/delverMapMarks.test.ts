import { describe, expect, it } from 'vitest';
import { markLabel } from './delverMapMarks';
import { canLetter, textPixels } from './parchment';

describe('markLabel', () => {
  it('writes each special Hall by name, faded when spent, looted or sealed', () => {
    expect(markLabel({ type: 'stairs', x: 0, z: 0, open: true })).toEqual({ text: 'Exit', faded: false });
    expect(markLabel({ type: 'stairs', x: 0, z: 0, open: false })).toEqual({ text: 'Exit (sealed)', faded: true });
    expect(markLabel({ type: 'boss', x: 0, z: 0 })).toEqual({ text: 'Boss Room', faded: false });
    expect(markLabel({ type: 'fire', x: 0, z: 0, spent: false })).toEqual({ text: 'Campfire', faded: false });
    expect(markLabel({ type: 'fire', x: 0, z: 0, spent: true })).toEqual({ text: 'Campfire', faded: true });
    expect(markLabel({ type: 'treasure', x: 0, z: 0, lying: true })).toEqual({ text: 'Treasure Room', faded: false });
    expect(markLabel({ type: 'treasure', x: 0, z: 0, lying: false })).toEqual({ text: 'Treasure Room', faded: true });
  });
});

describe('the maps\' bitmap font', () => {
  it('can letter every label, a pixel between glyphs', () => {
    for (const text of ['Exit', 'Exit (sealed)', 'Boss Room', 'Campfire', 'Treasure Room', 'Nothing explored yet']) expect(canLetter(text), text).toBe(true);
    expect(textPixels('Exit').width).toBe(3 + 1 + 3 + 1 + 3 + 1 + 3);
    expect(textPixels('I').dots).toHaveLength(9);
  });
});
