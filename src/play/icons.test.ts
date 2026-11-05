import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { HALL_KINDS, hallIcon, iconTexture, relicIcon, weaponIcon } from './icons';

const tuning = loadTuningData();
const relicIds = tuning.relics.map((r) => r.icon);
const weapons = Object.keys(tuning.weapons);

const wellFormed = (svg: string) => {
  expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 32 32"[^>]*>/);
  expect(svg.endsWith('</svg>')).toBe(true);
  // Tags balance: every open tag is self-closed or closed, and nothing is left open.
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]!);
  }
  expect(stack).toEqual([]);
  expect(svg).not.toMatch(/<(script|image)|href/);
};

describe('icons', () => {
  it('draws every Hall kind distinctly', () => {
    const icons = HALL_KINDS.map(hallIcon);
    expect(HALL_KINDS).toEqual(['Fight', 'Elite', 'Treasure', 'Rest', 'Boss']);
    expect(new Set(icons).size).toBe(HALL_KINDS.length);
    icons.forEach(wellFormed);
  });

  it('draws every Relic icon id of data/relics.json, each its own, none the fallback', () => {
    expect(relicIds.length).toBeGreaterThan(0);
    const icons = relicIds.map(relicIcon);
    expect(new Set(icons).size).toBe(relicIds.length);
    for (const i of icons) expect(i).not.toBe(relicIcon('no-such-icon'));
    icons.forEach(wellFormed);
  });

  it('draws every Weapon of the roster, each its own', () => {
    const icons = weapons.map(weaponIcon);
    expect(new Set(icons).size).toBe(weapons.length);
    for (const i of icons) expect(i).not.toBe(weaponIcon('no-such-weapon'));
    icons.forEach(wellFormed);
  });

  it('falls back to one generic icon for an unknown id', () => {
    expect(relicIcon('nope')).toBe(relicIcon('other'));
    expect(weaponIcon('nope')).toBe(weaponIcon('other'));
    wellFormed(relicIcon('nope'));
    wellFormed(weaponIcon('nope'));
  });

  it('caches a texture by icon and size, and does not need a DOM', () => {
    const a = iconTexture(hallIcon('Boss'), 64);
    expect(iconTexture(hallIcon('Boss'), 64)).toBe(a);
    expect(iconTexture(hallIcon('Boss'), 32)).not.toBe(a);
    expect(iconTexture(hallIcon('Rest'), 64)).not.toBe(a);
  });
});
