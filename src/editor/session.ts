/**
 * The Editor's working Tuning Data. Kept free of three.js/DOM so it can be
 * unit-tested; every Editor view (fields, gizmos, timeline, sandbox) edits
 * Motions through `draft()` and makes them live with `commit()`.
 */
import { motionFileName, parseMotion, serializeMotion, TuningDataError, type Motion, type TuningData } from '../tuning';

/** Deeply writable (optional channels included). */
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
/** An editable copy of a Motion; validated with parseMotion before it is used. */
export type MotionDraft = Mutable<Motion>;

/** The Editor's working Tuning Data: validated drafts replace the loaded Motions live. */
export class EditorSession {
  private readonly drafts = new Map<string, MotionDraft>();
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
}
