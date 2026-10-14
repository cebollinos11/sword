/**
 * The Editor's working Tuning Data. Kept free of three.js/DOM so it can be
 * unit-tested; every Editor view (fields, gizmos, timeline, sandbox) edits
 * Motions through `draft()` and makes them live with `commit()`.
 */
import { motionFileName, parseMotion, parseTuningData, serializeMotion, TuningDataError, type Motion, type TuningData } from '../tuning';

/** Deeply writable (optional channels included). */
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
/** An editable copy of a Motion; validated with parseMotion before it is used. */
export type MotionDraft = Mutable<Motion>;

/** The Tuning Data sections the Editor's number panels edit, each saved to `data/<section>.json`. */
export const TUNING_SECTIONS = ['weapon', 'hitZones', 'ai'] as const;
export type TuningSection = (typeof TUNING_SECTIONS)[number];
/** An editable copy of one Tuning Data section; validated with parseTuningData before it is used. */
export type SectionDraft<S extends TuningSection> = Mutable<TuningData[S]>;

/** The Editor's working Tuning Data: validated drafts replace the loaded Motions live. */
export class EditorSession {
  private readonly drafts = new Map<string, MotionDraft>();
  private readonly sectionDrafts = new Map<TuningSection, unknown>();
  tuning: TuningData;

  constructor(loaded: TuningData) {
    this.tuning = loaded;
  }

  motionNames(): string[] {
    return Object.keys(this.tuning.motions).sort((a, b) => (a === 'Overhead' ? -1 : b === 'Overhead' ? 1 : a.localeCompare(b)));
  }

  draft(name: string): MotionDraft {
    let d = this.drafts.get(name);
    if (!d) {
      const live = this.tuning.motions[name];
      if (!live) throw new TuningDataError(`Unknown Motion "${name}"`);
      d = structuredClone(live) as MotionDraft;
      this.drafts.set(name, d);
    }
    return d;
  }

  /** Validate a draft and, if valid, make it live. Throws TuningDataError otherwise. */
  commit(name: string): Motion {
    const motion = parseMotion(this.draft(name));
    if (motion.name !== name) throw new TuningDataError(`Renaming Motions is not supported here (was "${name}")`);
    this.tuning = { ...this.tuning, motions: { ...this.tuning.motions, [name]: motion } };
    return motion;
  }

  /**
   * The repo file for a Motion: commits the draft (so an invalid draft throws
   * TuningDataError and is never written) and serializes the validated Motion.
   */
  motionFile(name: string): { fileName: string; text: string; motion: Motion } {
    const motion = this.commit(name);
    return { fileName: motionFileName(motion.name), text: serializeMotion(motion), motion };
  }

  /** A mutable copy of a Tuning Data section (Weapon, Hit Zones, AI); the same object until committed or saved. */
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
   * Throws TuningDataError (naming the path, e.g. `weapon.length ...`) otherwise; the live data is unchanged.
   */
  commitSection<S extends TuningSection>(section: S): TuningData[S] {
    const next = parseTuningData({ ...this.tuning, [section]: this.draftSection(section), motions: Object.values(this.tuning.motions) });
    this.tuning = { ...this.tuning, [section]: next[section] };
    return next[section];
  }

  /** The repo file for a section: commits the draft (an invalid draft throws and is never written) and serializes it. */
  sectionFile(section: TuningSection): { fileName: string; text: string } {
    const value = this.commitSection(section);
    return { fileName: `${section}.json`, text: `${JSON.stringify(value, null, 2)}
` };
  }
}
