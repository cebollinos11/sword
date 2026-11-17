import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { JOINT_NAMES, type SkeletonPose } from '../sim';
import { loadTuningData } from '../tuning';
import { FighterView } from './fighterView';
import { rarityTint } from './rarityColours';
import { STEEL_EMISSIVE } from './steel';

const tuning = loadTuningData();
const origin = { x: 0, y: 0, z: 0 };
const pose: SkeletonPose = {
  joints: Object.fromEntries(JOINT_NAMES.map((j) => [j, origin])) as SkeletonPose['joints'],
  blade: { hilt: { x: -0.5, y: 0, z: 0 }, tip: { x: 0.5, y: 0, z: 0 }, edge: { x: 0, y: 1, z: 0 } },
};
const weaponOf = (look: string) => Object.values(tuning.weapons).find((w) => w.look === look)!;

/** The emissive colours of the view's materials with `colour` (steel: 0xeef2f6, wood: 0x7a5230). */
function emissives(view: FighterView, colour: number): number[] {
  const found = new Set<number>();
  view.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m?.color?.getHex() === colour) found.add(m.emissive.getHex());
  });
  return [...found];
}
const STEEL = 0xeef2f6;
const WOOD = 0x7a5230;

describe('a Fighter view’s Rarity tint', () => {
  it('tints the steel and back, leaving the wood for a sword', () => {
    const view = new FighterView(0xffffff, tuning, 'skeleton');
    view.update(pose, weaponOf('sword'));
    expect(emissives(view, STEEL)).toEqual([STEEL_EMISSIVE]);
    view.setRarity('Legendary');
    expect(emissives(view, STEEL)).toEqual([rarityTint(STEEL_EMISSIVE, 'Legendary')]);
    expect(rarityTint(STEEL_EMISSIVE, 'Legendary')).not.toBe(STEEL_EMISSIVE);
    expect(emissives(view, WOOD)).toEqual([0]);
    view.setRarity('Common');
    expect(emissives(view, STEEL)).toEqual([STEEL_EMISSIVE]);
    view.dispose();
  });

  it('tints the wood only while the staff is drawn', () => {
    const view = new FighterView(0xffffff, tuning, 'skeleton');
    view.setRarity('Rare');
    view.update(pose, weaponOf('staff'));
    expect(emissives(view, WOOD)).toEqual([rarityTint(0, 'Rare')]);
    view.update(pose, weaponOf('sword'));
    expect(emissives(view, WOOD)).toEqual([0]);
    view.dispose();
  });

  it('is its own: two views do not share a tint', () => {
    const a = new FighterView(0xffffff, tuning, 'skeleton');
    const b = new FighterView(0xffffff, tuning, 'skeleton');
    a.setRarity('Rare');
    expect(emissives(a, STEEL)).toEqual([rarityTint(STEEL_EMISSIVE, 'Rare')]);
    expect(emissives(b, STEEL)).toEqual([STEEL_EMISSIVE]);
    a.dispose();
    b.dispose();
  });
});
