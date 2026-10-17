/**
 * The Editor's working Tuning Data. Kept free of three.js/DOM so it can be
 * unit-tested; every Editor view (fields, gizmos, timeline, sandbox) edits
 * Motions through `draft()` and makes them live with `commit()`, and Weapons
 * through `draftWeapon()` / `commitWeapon()`.
 *
 * A Motion is either a default Motion (`data/motions/<file>`) or a Weapon's
 * Motion override of it (`data/motions/<Weapon file stem>/<file>`): the Motion
 * APIs take the override's Weapon name as `override`, and leave it out for the default.
 */
import {
  checkMotionOverride,
  motionFileName,
  parseMotion,
  parseTuningData,
  parseWeapon,
  serializeMotion,
  serializeWeapon,
  TuningDataError,
  weaponFileName,
  type Motion,
  type OffHandGrip,
  type TuningData,
  type WeaponTuning,
} from '../tuning';

/** Deeply writable (optional channels included). */
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
/** An editable copy of a Motion; validated with parseMotion before it is used. */
export type MotionDraft = Mutable<Motion>;
/**
 * An editable copy of a Weapon; validated with parseWeapon before it is used. It always holds an
 * Off-hand Grip to edit, which a one-handed Weapon drops when committed.
 */
export type WeaponDraft = Mutable<WeaponTuning> & { offHandGrip: Mutable<OffHandGrip> };

/** The Tuning Data sections the Editor's number panels edit, each saved to `data/<section>.json`. Weapons have their own files. */
export const TUNING_SECTIONS = ['hitZones', 'ai', 'gait', 'block', 'fall', 'camera'] as const;
export type TuningSection = (typeof TUNING_SECTIONS)[number];
/** An editable copy of one Tuning Data section; validated with parseTuningData before it is used. */
export type SectionDraft<S extends TuningSection> = Mutable<TuningData[S]>;

/** A file to write back to the repo: its name (for the save dialog), its repo path, and its text. */
export interface RepoFile {
  readonly fileName: string;
  readonly path: string;
  readonly text: string;
}

/** The repo path of a default Motion, or of `override`'s Motion override. */
export function motionPath(name: string, override?: string): string {
  const folder = override === undefined ? '' : `${weaponFileName(override).replace(/\.json$/, '')}/`;
  return `data/motions/${folder}${motionFileName(name)}`;
}

/** Tuning Data in the raw shape `parseTuningData` reads (rosters as lists). */
function rawTuning(t: TuningData): Record<string, unknown> {
  return {
    ...t,
    weapons: Object.values(t.weapons),
    motions: Object.values(t.motions),
    motionOverrides: Object.fromEntries(Object.entries(t.motionOverrides).map(([w, m]) => [w, Object.values(m)])),
  };
}

const draftKey = (name: string, override?: string) => `${override ?? ''}/${name}`;

/** The Editor's working Tuning Data: validated drafts replace the loaded Motions and Weapons live. */
export class EditorSession {
  private readonly drafts = new Map<string, MotionDraft>();
  private readonly sectionDrafts = new Map<TuningSection, unknown>();
  private readonly weaponDrafts = new Map<string, WeaponDraft>();
  tuning: TuningData;

  constructor(loaded: TuningData) {
    this.tuning = loaded;
  }

  /** The default Motions' names (Overhead first). */
  motionNames(): string[] {
    return Object.keys(this.tuning.motions).sort((a, b) => (a === 'Overhead' ? -1 : b === 'Overhead' ? 1 : a.localeCompare(b)));
  }

  /** The Weapon roster's names, in file order (the default Weapon first). */
  weaponNames(): string[] {
    return Object.keys(this.tuning.weapons);
  }

  /** Whether `weapon` has its own override of the Motion `name`. */
  hasOverride(weapon: string, name: string): boolean {
    return this.tuning.motionOverrides[weapon]?.[name] !== undefined;
  }

  /** The live Motion `name` (the default, or `override`'s override of it). */
  private liveMotion(name: string, override?: string): Motion | undefined {
    return override === undefined ? this.tuning.motions[name] : this.tuning.motionOverrides[override]?.[name];
  }

  /** A mutable copy of a Motion (the default, or `override`'s override of it); the same object until committed. */
  draft(name: string, override?: string): MotionDraft {
    const key = draftKey(name, override);
    let d = this.drafts.get(key);
    if (!d) {
      const live = this.liveMotion(name, override);
      if (!live) throw new TuningDataError(override === undefined ? `Unknown Motion "${name}"` : `${override} has no override of "${name}"`);
      d = structuredClone(live) as MotionDraft;
      this.drafts.set(key, d);
    }
    return d;
  }

  /** Validate a draft and, if valid, make it live. Throws TuningDataError otherwise. */
  commit(name: string, override?: string): Motion {
    const motion = parseMotion(this.draft(name, override));
    if (motion.name !== name) throw new TuningDataError(`Renaming Motions is not supported here (was "${name}")`);
    if (override === undefined) {
      this.tuning = { ...this.tuning, motions: { ...this.tuning.motions, [name]: motion } };
    } else {
      checkMotionOverride(this.tuning.motions, override, motion);
      const own = { ...this.tuning.motionOverrides[override], [name]: motion };
      this.tuning = { ...this.tuning, motionOverrides: { ...this.tuning.motionOverrides, [override]: own } };
    }
    return motion;
  }

  /**
   * The repo file for a Motion: commits the draft (so an invalid draft throws
   * TuningDataError and is never written) and serializes the validated Motion.
   */
  motionFile(name: string, override?: string): RepoFile & { motion: Motion } {
    const motion = this.commit(name, override);
    return { fileName: motionFileName(motion.name), path: motionPath(motion.name, override), text: serializeMotion(motion), motion };
  }

  /** Give `weapon` its own override of the Motion `name`: a copy of the live default, live at once. */
  createOverride(weapon: string, name: string): Motion {
    if (!this.tuning.weapons[weapon]) throw new TuningDataError(`Unknown Weapon "${weapon}"`);
    if (this.hasOverride(weapon, name)) throw new TuningDataError(`${weapon} already overrides "${name}"`);
    const base = this.tuning.motions[name];
    if (!base) throw new TuningDataError(`Unknown Motion "${name}"`);
    this.drafts.delete(draftKey(name, weapon));
    const own = { ...this.tuning.motionOverrides[weapon], [name]: base };
    this.tuning = { ...this.tuning, motionOverrides: { ...this.tuning.motionOverrides, [weapon]: own } };
    return base;
  }

  /** Drop `weapon`'s override of `name`: the Weapon plays the default again. Returns the repo path to delete. */
  removeOverride(weapon: string, name: string): string {
    if (!this.hasOverride(weapon, name)) throw new TuningDataError(`${weapon} has no override of "${name}"`);
    this.drafts.delete(draftKey(name, weapon));
    const { [name]: _removed, ...rest } = this.tuning.motionOverrides[weapon]!;
    const { [weapon]: _all, ...others } = this.tuning.motionOverrides;
    this.tuning = { ...this.tuning, motionOverrides: Object.keys(rest).length > 0 ? { ...others, [weapon]: rest } : others };
    return motionPath(name, weapon);
  }

  /** A mutable copy of a Weapon; the same object until committed or saved. */
  draftWeapon(name: string): WeaponDraft {
    let d = this.weaponDrafts.get(name);
    if (!d) {
      const live = this.tuning.weapons[name];
      if (!live) throw new TuningDataError(`Unknown Weapon "${name}"`);
      const copy = structuredClone(live) as Mutable<WeaponTuning>;
      d = { ...copy, offHandGrip: copy.offHandGrip ?? { along: Math.min(0.14, live.gripLength), around: 0, radial: 0 } };
      this.weaponDrafts.set(name, d);
    }
    return d;
  }

  /**
   * Validate a Weapon draft and, if valid, make it live. Throws TuningDataError (naming the path,
   * e.g. `weapons/Halberd.head ...`) otherwise; the live data is unchanged.
   */
  commitWeapon(name: string): WeaponTuning {
    const { offHandGrip, ...rest } = this.draftWeapon(name);
    const weapon = parseWeapon(rest.grip === 'twoHanded' ? { ...rest, offHandGrip } : rest, `weapons/${name}`);
    if (weapon.name !== name) throw new TuningDataError(`Renaming Weapons is not supported here (was "${name}")`);
    this.tuning = { ...this.tuning, weapons: { ...this.tuning.weapons, [name]: weapon } };
    return weapon;
  }

  /** The repo file for a Weapon: commits the draft (an invalid draft throws and is never written) and serializes it. */
  weaponFile(name: string): RepoFile {
    const weapon = this.commitWeapon(name);
    const fileName = weaponFileName(weapon.name);
    return { fileName, path: `data/weapons/${fileName}`, text: serializeWeapon(weapon) };
  }

  /** A mutable copy of a Tuning Data section (Hit Zones, AI, Gait, Block, Camera); the same object until committed or saved. */
  draftSection<S extends TuningSection>(section: S): SectionDraft<S> {
    let d = this.sectionDrafts.get(section) as SectionDraft<S> | undefined;
    if (!d) {
      d = structuredClone(this.tuning[section]) as SectionDraft<S>;
      this.sectionDrafts.set(section, d);
    }
    return d;
  }

  /**
   * Validate a section draft with the full Tuning Data rules and, if valid, make it live.
   * Throws TuningDataError (naming the path, e.g. `gait.stepDuration ...`) otherwise; the live data is unchanged.
   */
  commitSection<S extends TuningSection>(section: S): TuningData[S] {
    const next = parseTuningData({ ...rawTuning(this.tuning), [section]: this.draftSection(section) });
    this.tuning = { ...this.tuning, [section]: next[section] };
    return next[section];
  }

  /** The repo file for a section: commits the draft (an invalid draft throws and is never written) and serializes it. */
  sectionFile(section: TuningSection): RepoFile {
    const value = this.commitSection(section);
    const fileName = `${section}.json`;
    return { fileName, path: `data/${fileName}`, text: `${JSON.stringify(value, null, 2)}\n` };
  }
}
