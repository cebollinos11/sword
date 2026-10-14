import { describe, expect, it } from 'vitest';
import aiJson from '../../data/ai.json';
import hitZonesJson from '../../data/hitZones.json';
import weaponJson from '../../data/weapon.json';
import { loadTuningData, parseTuningData, TuningDataError } from '../tuning';
import { EditorSession, TUNING_SECTIONS } from './session';

const tuning = loadTuningData();

/** Rebuild Tuning Data with one saved section file swapped in, as a reload from the repo would. */
function reloadWith(fileName: string, text: string) {
  const key = fileName.replace(/\.json$/, '');
  return parseTuningData({ ...tuning, [key]: JSON.parse(text), motions: Object.values(tuning.motions) });
}

describe('EditorSession Tuning Data sections (Weapon, Hit Zones, AI)', () => {
  it('saves an edited Weapon to weapon.json, and the saved file reloads to the live values', () => {
    const session = new EditorSession(tuning);
    const w = session.draftSection('weapon');
    w.length = 1.1;
    w.speed = 20;
    w.damage = 40;
    session.commitSection('weapon');
    expect(session.tuning.weapon).toEqual({ length: 1.1, speed: 20, damage: 40 });

    const file = session.sectionFile('weapon');
    expect(file.fileName).toBe('weapon.json');
    expect(reloadWith(file.fileName, file.text).weapon).toEqual({ length: 1.1, speed: 20, damage: 40 });
  });

  it('saves every section unchanged when nothing was edited', () => {
    const session = new EditorSession(tuning);
    const repo = { weapon: weaponJson, hitZones: hitZonesJson, ai: aiJson };
    for (const section of TUNING_SECTIONS) {
      const file = session.sectionFile(section);
      expect(file.fileName).toBe(`${section}.json`);
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

  it('refuses an invalid value, naming it, and keeps the live Tuning Data', () => {
    const session = new EditorSession(tuning);
    session.draftSection('ai').difficulties.Normal!.mistakeRate = 1.5;
    expect(() => session.commitSection('ai')).toThrow(TuningDataError);
    expect(() => session.sectionFile('ai')).toThrow(/^ai\.difficulties\.Normal\.mistakeRate must be between 0 and 1/);
    expect(session.tuning.ai).toBe(tuning.ai);

    session.draftSection('weapon').length = -0.2;
    expect(() => session.commitSection('weapon')).toThrow(/^weapon\.length/);
    expect(session.tuning.weapon).toBe(tuning.weapon);
  });

  it('a draft is independent of the loaded Tuning Data until committed', () => {
    const session = new EditorSession(tuning);
    session.draftSection('weapon').damage = 99;
    expect(session.tuning.weapon.damage).toBe(30);
    expect(tuning.weapon.damage).toBe(30);
    session.commitSection('weapon');
    expect(session.tuning.weapon.damage).toBe(99);
    expect(tuning.weapon.damage).toBe(30);
  });
});
