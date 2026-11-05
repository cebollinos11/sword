import { describe, expect, it } from 'vitest';
import { loadTuningData, parseMotion, parseTuningData, TuningDataError, weaponMotion } from '../tuning';
import { addPoseKey, retimePoseKey, setChannel } from './motionEdit';
import { EditorSession } from './session';

const tuning = loadTuningData();

describe('EditorSession', () => {
  it('lists every Motion, Attacks, Blocks, Idle, Stagger and Sheathe alike', () => {
    expect(new EditorSession(tuning).motionNames()).toEqual([
      'Overhead',
      'BlockLeft',
      'BlockOverhead',
      'BlockRight',
      'BlockThrust',
      'DrawBack',
      'DrawHip',
      'Fall',
      'GetUp',
      'Idle',
      'Kick',
      'Knockdown',
      'Land',
      'LandSoft',
      'Left',
      'Recoil',
      'Right',
      'SheatheBack',
      'SheathedIdle',
      'SheatheHip',
      'Stagger',
      'StaggerLeft',
      'StaggerOverhead',
      'StaggerRight',
      'StaggerThrust',
      'Throw',
      'Thrust',
    ]);
  });

  it('saves every repo Motion unchanged when nothing was edited', () => {
    const session = new EditorSession(tuning);
    for (const name of session.motionNames()) {
      const file = session.motionFile(name);
      expect(file.fileName).toBe(`${name.toLowerCase()}.json`);
      expect(parseMotion(JSON.parse(file.text))).toEqual(tuning.motions[name]);
    }
  });

  it('round-trips an edited Motion through the saved JSON and validation', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Left');
    const k = addPoseKey(d, 0.5, tuning.skeleton);
    d.poseKeys[k]!.ease = 'step';
    d.poseKeys[k]!.rightHand!.position.y = 1.62;
    setChannel(d, k, 'leftFoot', true, tuning.skeleton);
    const moved = retimePoseKey(d, k, 0.48);
    const file = session.motionFile('Left');
    const reloaded = parseMotion(JSON.parse(file.text));
    expect(reloaded).toEqual(session.tuning.motions.Left);
    expect(reloaded.poseKeys[moved]).toMatchObject({ time: 0.48, ease: 'step', rightHand: { position: { y: 1.62 } } });
    expect(reloaded.poseKeys[moved]!.leftFoot).toBeDefined();
    // The live Tuning Data now plays the edit.
    expect(session.tuning.motions.Left!.poseKeys).toHaveLength(tuning.motions.Left!.poseKeys.length + 1);
  });

  it('refuses to save a draft that fails validation, naming the problem', () => {
    const session = new EditorSession(tuning);
    session.draft('Thrust').duration = 0.2; // shorter than its Pose Keys
    expect(() => session.motionFile('Thrust')).toThrow(TuningDataError);
    expect(() => session.motionFile('Thrust')).toThrow(/^motions\/Thrust\..* must be within 0\.\.duration \(0\.2\)/);
    expect(session.tuning.motions.Thrust).toBe(tuning.motions.Thrust);
  });
});

describe('EditorSession Motion overrides', () => {
  it("creates a Weapon's override from the default in one step, edits it apart from the default, and saves it to its own folder", () => {
    const session = new EditorSession(tuning);
    expect(session.hasOverride('Halberd', 'Right')).toBe(false);
    session.createOverride('Halberd', 'Right');
    expect(session.hasOverride('Halberd', 'Right')).toBe(true);
    expect(weaponMotion(session.tuning, 'Halberd', 'Right')).toEqual(tuning.motions.Right);

    session.draft('Right', 'Halberd').duration = 1.4;
    const file = session.motionFile('Right', 'Halberd');
    expect(file.fileName).toBe('right.json');
    expect(file.path).toBe('data/motions/halberd/right.json');
    expect(weaponMotion(session.tuning, 'Halberd', 'Right')!.duration).toBe(1.4);
    // The default and every other Weapon are untouched.
    expect(session.tuning.motions.Right).toBe(tuning.motions.Right);
    expect(weaponMotion(session.tuning, 'Longsword', 'Right')).toBe(tuning.motions.Right);
    // The saved file reloads to the live override.
    const reloaded = parseTuningData({
      ...session.tuning,
      weapons: Object.values(session.tuning.weapons),
      motions: Object.values(session.tuning.motions),
      // The repo's own overrides, and this one saved alongside them.
      motionOverrides: {
        ...Object.fromEntries(Object.entries(tuning.motionOverrides).map(([w, own]) => [w, Object.values(own)])),
        Halberd: [...Object.values(tuning.motionOverrides.Halberd ?? {}), JSON.parse(file.text)],
      },
    });
    expect(reloaded.motionOverrides).toEqual(session.tuning.motionOverrides);
  });

  it('saves an unchanged override as the default it was copied from', () => {
    const session = new EditorSession(tuning);
    session.createOverride('Longsword', 'Overhead');
    expect(session.motionFile('Overhead', 'Longsword').text).toBe(session.motionFile('Overhead').text);
  });

  it('refuses to save an override that drops a marker its Action needs', () => {
    const session = new EditorSession(tuning);
    session.createOverride('Halberd', 'Right');
    delete session.draft('Right', 'Halberd').markers.windUpEnd;
    expect(() => session.motionFile('Right', 'Halberd')).toThrow(/^motionOverrides\/Halberd\/Right\.markers\.windUpEnd is required/);
  });

  it('removing an override falls back to the default', () => {
    const session = new EditorSession(tuning);
    session.createOverride('Halberd', 'Idle');
    session.draft('Idle', 'Halberd').duration = 3;
    session.commit('Idle', 'Halberd');
    expect(session.removeOverride('Halberd', 'Idle')).toBe('data/motions/halberd/idle.json');
    expect(session.hasOverride('Halberd', 'Idle')).toBe(false);
    expect(weaponMotion(session.tuning, 'Halberd', 'Idle')).toBe(tuning.motions.Idle);
    expect(session.tuning.motionOverrides).toEqual(tuning.motionOverrides);
    // A fresh override starts from the default again, not the dropped edit.
    session.createOverride('Halberd', 'Idle');
    expect(session.draft('Idle', 'Halberd').duration).toBe(tuning.motions.Idle!.duration);
  });
});
