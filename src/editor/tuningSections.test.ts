import { describe, expect, it } from 'vitest';
import aiJson from '../../data/ai.json';
import blockJson from '../../data/block.json';
import cameraJson from '../../data/camera.json';
import gaitJson from '../../data/gait.json';
import hitZonesJson from '../../data/hitZones.json';
import armingSwordJson from '../../data/weapons/arming-sword.json';
import halberdJson from '../../data/weapons/halberd.json';
import longswordJson from '../../data/weapons/longsword.json';
import { GAIT_FIELDS, loadTuningData, parseTuningData, parseWeapon, TuningDataError } from '../tuning';
import { EditorSession, TUNING_SECTIONS } from './session';

const tuning = loadTuningData();

/** Rebuild Tuning Data with one saved section file swapped in, as a reload from the repo would. */
function reloadWith(fileName: string, text: string) {
  const key = fileName.replace(/\.json$/, '');
  return parseTuningData({ ...tuning, [key]: JSON.parse(text), weapons: Object.values(tuning.weapons), motions: Object.values(tuning.motions), motionOverrides: {} });
}

describe('EditorSession Weapons', () => {
  it('saves an edited Weapon to its own file under data/weapons/, and the saved file reloads to the live values', () => {
    const session = new EditorSession(tuning);
    const w = session.draftWeapon('Longsword');
    w.length = 1.1;
    w.speed = 20;
    w.damage = 45;
    w.offHandGrip.along = 0.2;
    w.offHandGrip.radial = 0.02;
    w.blockImpact.dealt = 1.4;
    session.commitWeapon('Longsword');
    expect(session.tuning.weapons.Longsword).toMatchObject({ length: 1.1, speed: 20, damage: 45, offHandGrip: { along: 0.2, around: 0, radial: 0.02 } });
    expect(session.tuning.weapons['Arming Sword']).toBe(tuning.weapons['Arming Sword']);

    const file = session.weaponFile('Longsword');
    expect(file.fileName).toBe('longsword.json');
    expect(file.path).toBe('data/weapons/longsword.json');
    expect(parseWeapon(JSON.parse(file.text))).toEqual(session.tuning.weapons.Longsword);
  });

  it('saves every Weapon unchanged when nothing was edited', () => {
    const session = new EditorSession(tuning);
    const repo: Record<string, unknown> = { 'Arming Sword': armingSwordJson, Longsword: longswordJson, Halberd: halberdJson };
    expect(session.weaponNames()).toEqual(['Arming Sword', 'Halberd', 'Longsword']);
    for (const name of session.weaponNames()) expect(JSON.parse(session.weaponFile(name).text)).toEqual(repo[name]);
  });

  it('a one-handed Weapon drops the Off-hand Grip; turning it two-handed keeps the edited one', () => {
    const session = new EditorSession(tuning);
    const w = session.draftWeapon('Arming Sword');
    w.offHandGrip.along = 0.05;
    expect(session.commitWeapon('Arming Sword').offHandGrip).toBeUndefined();
    w.grip = 'twoHanded';
    expect(session.commitWeapon('Arming Sword').offHandGrip).toEqual({ along: 0.05, around: 0, radial: 0 });
  });

  it('refuses an invalid Weapon, naming the field, and keeps the live Tuning Data', () => {
    const session = new EditorSession(tuning);
    session.draftWeapon('Halberd').offHandGrip.along = 0.9; // beyond its gripLength (0.8)
    expect(() => session.commitWeapon('Halberd')).toThrow(TuningDataError);
    expect(() => session.commitWeapon('Halberd')).toThrow(/^weapons\/Halberd\.offHandGrip\.along must be within 0\.\.gripLength/);
    expect(session.tuning.weapons.Halberd).toBe(tuning.weapons.Halberd);
    session.draftWeapon('Halberd').offHandGrip.along = 0.6;
    session.draftWeapon('Halberd').head = 2;
    expect(() => session.weaponFile('Halberd')).toThrow(/^weapons\/Halberd\.head must be at most length/);
  });

  it('a Weapon draft is independent of the loaded Tuning Data until committed', () => {
    const session = new EditorSession(tuning);
    session.draftWeapon('Arming Sword').damage = 99;
    expect(session.tuning.weapons['Arming Sword']!.damage).toBe(30);
    session.commitWeapon('Arming Sword');
    expect(session.tuning.weapons['Arming Sword']!.damage).toBe(99);
    expect(tuning.weapons['Arming Sword']!.damage).toBe(30);
  });
});

describe('EditorSession Tuning Data sections (Hit Zones, AI, Gait, Block)', () => {
  it('saves every section unchanged when nothing was edited', () => {
    const session = new EditorSession(tuning);
    const repo = { hitZones: hitZonesJson, ai: aiJson, gait: gaitJson, block: blockJson, camera: cameraJson };
    expect(TUNING_SECTIONS).toContain('gait');
    for (const section of TUNING_SECTIONS) {
      const file = session.sectionFile(section);
      expect(file.fileName).toBe(`${section}.json`);
      expect(file.path).toBe(`data/${section}.json`);
      expect(JSON.parse(file.text)).toEqual(repo[section]);
    }
  });

  it('round-trips edited Hit Zone multipliers and AI difficulty parameters', () => {
    const session = new EditorSession(tuning);
    session.draftSection('hitZones').head.multiplier = 2;
    session.draftSection('hitZones').limbs.multiplier = 0.4;
    const hard = session.draftSection('ai').difficulties.Hard!;
    hard.reactionTime = 0.1;
    hard.mistakeRate = 0;
    hard.feintRate = 0.5;
    session.commitSection('hitZones');
    session.commitSection('ai');
    expect(session.tuning.hitZones.head.multiplier).toBe(2);
    expect(session.tuning.ai.difficulties.Hard).toEqual({ reactionTime: 0.1, mistakeRate: 0, feintRate: 0.5 });

    const zones = session.sectionFile('hitZones');
    const ai = session.sectionFile('ai');
    const reloaded = reloadWith(ai.fileName, ai.text);
    expect(reloaded.ai).toEqual(session.tuning.ai);
    expect(Object.keys(reloaded.ai.difficulties)).toEqual(['Easy', 'Normal', 'Hard']);
    expect(reloadWith(zones.fileName, zones.text).hitZones).toEqual({
      head: { multiplier: 2, radius: 0.12 },
      torso: { multiplier: 1, radius: 0.16 },
      limbs: { multiplier: 0.4, radius: 0.06 },
    });
  });

  it('saves an edited Gait to gait.json, and the saved file reloads to the live values', () => {
    const session = new EditorSession(tuning);
    const g = session.draftSection('gait');
    g.strideThreshold = 0.35;
    g.stepDuration = 0.12;
    g.stepHeight = 0.05;
    session.commitSection('gait');
    expect(session.tuning.gait.strideThreshold).toBe(0.35);
    expect(session.tuning.gait.stepDuration).toBe(0.12);
    expect(session.tuning.gait.stepHeight).toBe(0.05);

    const file = session.sectionFile('gait');
    expect(file.fileName).toBe('gait.json');
    const reloaded = reloadWith(file.fileName, file.text).gait;
    expect(reloaded).toEqual(session.tuning.gait);
    // every Gait value is saved, whatever fields the Gait has
    expect(Object.keys(JSON.parse(file.text)).sort()).toEqual(Object.keys(GAIT_FIELDS).sort());
  });

  it('refuses an invalid Gait value, naming it, and keeps the live Tuning Data', () => {
    const session = new EditorSession(tuning);
    session.draftSection('gait').stepDuration = 0;
    expect(() => session.commitSection('gait')).toThrow(TuningDataError);
    expect(() => session.sectionFile('gait')).toThrow(/^gait\.stepDuration/);
    expect(session.tuning.gait).toBe(tuning.gait);
  });

  it('refuses an invalid value, naming it, and keeps the live Tuning Data', () => {
    const session = new EditorSession(tuning);
    session.draftSection('ai').difficulties.Normal!.mistakeRate = 1.5;
    expect(() => session.commitSection('ai')).toThrow(TuningDataError);
    expect(() => session.sectionFile('ai')).toThrow(/^ai\.difficulties\.Normal\.mistakeRate must be between 0 and 1/);
    expect(session.tuning.ai).toBe(tuning.ai);
  });

  it('a section draft is independent of the loaded Tuning Data until committed', () => {
    const session = new EditorSession(tuning);
    session.draftSection('block').impactTilt = 40;
    expect(session.tuning.block.impactTilt).toBe(tuning.block.impactTilt);
    session.commitSection('block');
    expect(session.tuning.block.impactTilt).toBe(40);
    expect(tuning.block.impactTilt).toBe(15);
  });
});
