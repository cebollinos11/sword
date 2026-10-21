import { describe, expect, it } from 'vitest';
import {
  defaultWeaponName,
  loadTuningData,
  NO_HEAVY_BLOW,
  UNIT_TEMPO,
  parseTuningData,
  parseWeapon,
  serializeWeapon,
  tuningDataHash,
  TuningDataError,
  weaponFileName,
  weaponMotion,
  withWeapon,
  type TuningData,
} from './index';

const tuning = loadTuningData();

/** `tuning` as raw data with some fields replaced, for parseTuningData. */
const raw = (t: TuningData, patch: Record<string, unknown> = {}) => ({
  ...t,
  weapons: Object.values(t.weapons),
  motions: Object.values(t.motions),
  motionOverrides: Object.fromEntries(Object.entries(t.motionOverrides).map(([w, m]) => [w, Object.values(m)])),
  ...patch,
});

const halberd = (patch: Record<string, unknown>) => ({ ...tuning.weapons.Halberd!, ...patch });

describe('Weapon roster', () => {
  it('loads every Weapon from data/weapons/, the Arming Sword first (the default)', () => {
    expect(Object.keys(tuning.weapons)).toEqual(['Arming Sword', 'Halberd', 'Longsword', 'Sledge Hammer']);
    expect(defaultWeaponName(tuning)).toBe('Arming Sword');
    expect(tuning.weapons['Arming Sword']).toMatchObject({ grip: 'oneHanded', length: 0.9, damage: 30, speed: 25, gripLength: 0.12, head: 0.9, look: 'sword' });
    expect(tuning.weapons['Arming Sword']!.offHandGrip).toBeUndefined();
    expect(tuning.weapons.Longsword).toMatchObject({ grip: 'twoHanded', length: 1, damage: 40, speed: 22, gripLength: 0.28, offHandGrip: { along: 0.14 } });
    expect(tuning.weapons.Halberd).toMatchObject({ grip: 'twoHanded', length: 1.5, gripLength: 0.8, offHandGrip: { along: 0.6 }, head: 0.35, shaftDamage: 0.3, look: 'polearm' });
    expect(tuning.weapons['Sledge Hammer']).toMatchObject({ grip: 'twoHanded', look: 'hammer', heavyBlow: { speed: 1.15 } });
  });

  it('names each Weapon file after its Weapon', () => {
    expect(weaponFileName('Arming Sword')).toBe('arming-sword.json');
    expect(weaponFileName('Halberd')).toBe('halberd.json');
  });

  it('fills in the optional fields: a sword is all Head, full shaft damage, Block Impact ×1, drawn as a sword', () => {
    const sheathe = { slot: 'hip', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
    const w = parseWeapon({ name: 'Dagger', grip: 'oneHanded', length: 0.3, damage: 15, speed: 20, gripLength: 0.1, sheathe });
    expect(w).toMatchObject({ head: 0.3, shaftDamage: 1, blockImpact: { dealt: 1, taken: 1 }, heavyBlow: NO_HEAVY_BLOW, tempo: UNIT_TEMPO, look: 'sword' });
    expect(JSON.parse(serializeWeapon(w)).heavyBlow).toBeUndefined();
    expect(parseWeapon(JSON.parse(serializeWeapon(w)))).toEqual(w);
  });

  it('refuses invalid Weapons, naming the full path', () => {
    const { offHandGrip: _grip, ...noGrip } = tuning.weapons.Halberd!;
    expect(() => parseTuningData(raw(tuning, { weapons: [noGrip] }))).toThrow(/^weapons\/Halberd\.offHandGrip is required for a two-handed Weapon/);
    expect(() => parseWeapon(halberd({ offHandGrip: { along: 0.9, around: 0, radial: 0 } }))).toThrow(
      /^weapons\/Halberd\.offHandGrip\.along must be within 0\.\.gripLength \(0\.8\)/,
    );
    expect(() => parseWeapon(halberd({ head: 1.6 }))).toThrow(/^weapons\/Halberd\.head must be at most length \(1\.5\)/);
    expect(() => parseWeapon(halberd({ shaftDamage: 1.2 }))).toThrow(/^weapons\/Halberd\.shaftDamage must be between 0 and 1/);
    expect(() => parseWeapon(halberd({ shaftDamage: -0.1 }))).toThrow(/^weapons\/Halberd\.shaftDamage/);
    expect(() => parseWeapon({ ...tuning.weapons['Arming Sword']!, offHandGrip: { along: 0, around: 0, radial: 0 } })).toThrow(
      /^weapons\/Arming Sword\.offHandGrip is only for a two-handed Weapon/,
    );
    expect(() => parseWeapon(halberd({ grip: 'threeHanded' }))).toThrow(/^weapons\/Halberd\.grip must be one of oneHanded, twoHanded/);
    expect(() => parseWeapon(halberd({ look: 'axe' }))).toThrow(/^weapons\/Halberd\.look/);
    expect(() => parseWeapon(halberd({ blockImpact: { dealt: 0, taken: 1 } }))).toThrow(/^weapons\/Halberd\.blockImpact\.dealt/);
    const heavy = tuning.weapons.Halberd!.heavyBlow;
    expect(() => parseWeapon(halberd({ heavyBlow: { ...heavy, speed: -1 } }))).toThrow(/^weapons\/Halberd\.heavyBlow\.speed must be >= 0/);
    expect(() => parseWeapon(halberd({ heavyBlow: { ...heavy, blockSlideTicks: 2.5 } }))).toThrow(/^weapons\/Halberd\.heavyBlow\.blockSlideTicks must be a whole number/);
    expect(() => parseWeapon(halberd({ heavyBlow: { ...heavy, knockdownSlideTicks: 0 } }))).toThrow(/^weapons\/Halberd\.heavyBlow\.knockdownSlideTicks/);
    expect(() => parseWeapon(halberd({ tempo: { windUp: 0, release: 1, recovery: 1 } }))).toThrow(/^weapons\/Halberd\.tempo\.windUp/);
    expect(() => parseWeapon(halberd({ tempo: { windUp: 1, release: 1 } }))).toThrow(/^weapons\/Halberd\.tempo\.recovery/);
    const sheathe = tuning.weapons.Halberd!.sheathe;
    expect(() => parseWeapon(halberd({ sheathe: undefined }))).toThrow(/^weapons\/Halberd\.sheathe is required/);
    expect(() => parseWeapon(halberd({ sheathe: { ...sheathe, slot: 'belt' } }))).toThrow(/^weapons\/Halberd\.sheathe\.slot must be one of hip, back/);
    expect(() => parseWeapon(halberd({ sheathe: { ...sheathe, offset: { x: 0, y: 0 } } }))).toThrow(/^weapons\/Halberd\.sheathe\.offset\.z/);
    expect(() => parseWeapon(halberd({ sheathe: { ...sheathe, rotation: undefined } }))).toThrow(/^weapons\/Halberd\.sheathe\.rotation/);
    expect(parseWeapon(JSON.parse(serializeWeapon(tuning.weapons.Halberd!)))).toEqual(tuning.weapons.Halberd);
    expect(() => parseTuningData(raw(tuning, { weapons: [] }))).toThrow(TuningDataError);
    expect(() => parseTuningData(raw(tuning, { weapons: [tuning.weapons.Halberd, tuning.weapons.Halberd] }))).toThrow(/duplicate Weapon name "Halberd"/);
  });
});

describe('Motion overrides', () => {
  const overhead = tuning.motions.Overhead!;

  it('a Weapon plays its override of a Motion, every other Weapon the default', () => {
    const slow = { ...overhead, duration: overhead.duration + 0.2 };
    const t = parseTuningData(raw(tuning, { motionOverrides: { Halberd: [slow] } }));
    expect(weaponMotion(t, 'Halberd', 'Overhead')).toEqual(slow);
    expect(weaponMotion(t, 'Longsword', 'Overhead')).toBe(t.motions.Overhead);
    expect(weaponMotion(t, 'Halberd', 'Idle')).toBe(t.motions.Idle);
  });

  it('refuses an override missing a marker its Action needs, one with no default, and one for a Weapon not in the roster', () => {
    const { releaseEnd: _end, ...markers } = overhead.markers;
    expect(() => parseTuningData(raw(tuning, { motionOverrides: { Halberd: [{ ...overhead, markers }] } }))).toThrow(
      /^motionOverrides\/Halberd\/Overhead\.markers\.releaseEnd is required/,
    );
    expect(() => parseTuningData(raw(tuning, { motionOverrides: { Halberd: [{ ...overhead, name: 'Pirouette' }] } }))).toThrow(
      /no default Motion "Pirouette"/,
    );
    expect(() => parseTuningData(raw(tuning, { motionOverrides: { Pike: [overhead] } }))).toThrow(/no Weapon "Pike"/);
  });

  it('validates an override like any Motion', () => {
    expect(() => parseTuningData(raw(tuning, { motionOverrides: { Halberd: [{ ...overhead, duration: -1 }] } }))).toThrow(/motions\/Overhead\.duration/);
  });
});

describe('Tuning Data hash and the roster', () => {
  it('changes when any Weapon or Motion override changes', () => {
    const base = tuningDataHash(tuning);
    expect(tuningDataHash(withWeapon(tuning, { gripLength: 0.81 }, 'Halberd'))).not.toBe(base);
    expect(tuningDataHash(withWeapon(tuning, { offHandGrip: { along: 0.15, around: 0, radial: 0 } }, 'Longsword'))).not.toBe(base);
    expect(tuningDataHash(withWeapon(tuning, { look: 'polearm' }))).not.toBe(base);
    const overridden = { ...tuning, motionOverrides: { Halberd: { Overhead: tuning.motions.Overhead! } } };
    expect(tuningDataHash(overridden)).not.toBe(base);
    const retimed = { ...tuning, motionOverrides: { Halberd: { Overhead: { ...tuning.motions.Overhead!, duration: 2 } } } };
    expect(tuningDataHash(retimed)).not.toBe(tuningDataHash(overridden));
  });
});
