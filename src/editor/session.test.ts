import { describe, expect, it } from 'vitest';
import { loadTuningData, parseMotion, TuningDataError } from '../tuning';
import { addPoseKey, retimePoseKey, setChannel } from './motionEdit';
import { EditorSession } from './session';

const tuning = loadTuningData();

describe('EditorSession', () => {
  it('lists every Motion, Attacks, Blocks, Idle and Stagger alike', () => {
    expect(new EditorSession(tuning).motionNames()).toEqual([
      'Overhead',
      'BlockLeft',
      'BlockOverhead',
      'BlockRight',
      'BlockThrust',
      'Idle',
      'Left',
      'Right',
      'Stagger',
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
