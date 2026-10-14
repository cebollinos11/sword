/**
 * The Editor route (/sword/#/editor): author Tuning Data against the real
 * Simulation code. This first version loops one Motion on a lone Fighter,
 * draws its Blade Sweep as a trail, exposes every Pose Key as Tweakpane
 * fields (live), and saves the Motion back to `data/motions/<name>.json`.
 *
 * Extension points for later tickets: the Motion list is whatever Tuning Data
 * holds (new Motion files appear automatically); `EditorSession` is the one
 * source of truth for the working Tuning Data, so gizmos, timelines and a Duel
 * sandbox should read/write it rather than keep their own copies.
 */
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane, type FolderApi } from 'tweakpane';
import { motionPose, TICK_RATE, TICK_SECONDS, type BladeTransform, type Placement } from '../sim';
import {
  EASES,
  motionFileName,
  parseMotion,
  serializeMotion,
  TuningDataError,
  type Motion,
  type TuningData,
} from '../tuning';
import { FIGHTER_COLOURS, FighterView, lerpPose } from '../render/fighterView';
import { Stage } from '../render/stage';
import { saveJsonFile } from './save';
import { BladeSweepTrail } from './trail';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
/** An editable copy of a Motion; validated with parseMotion before it is used. */
export type MotionDraft = Mutable<Motion>;

const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };
/** Pause at the end of each loop so the final pose and the whole trail are readable. */
const LOOP_HOLD_SECONDS = 0.4;

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
      d = structuredClone(this.tuning.motions[name]!) as MotionDraft;
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
}

export function startEditor(container: HTMLElement, loaded: TuningData): void {
  const session = new EditorSession(loaded);
  const stage = new Stage(container, loaded);
  stage.camera.position.set(3.2, 1.7, 1.6);
  const controls = new OrbitControls(stage.camera, stage.canvas);
  controls.target.set(0, 1.2, 0.3);
  controls.update();

  const fighter = new FighterView(FIGHTER_COLOURS[0]!, loaded);
  const trail = new BladeSweepTrail();
  stage.scene.add(fighter.root, trail.root);

  const ui = { motion: session.motionNames()[0]!, playing: true, speed: 1, tick: 0, status: 'Ready' };
  const pane = new Pane({ title: 'Motion Editor' });
  pane.element.parentElement!.style.width = '340px';
  pane.element.parentElement!.style.maxHeight = 'calc(100vh - 16px)';
  pane.element.parentElement!.style.overflowY = 'auto';
  // Let validation messages in the status monitor wrap instead of scrolling sideways.
  const style = document.createElement('style');
  style.textContent = '.tp-mllv_i { white-space: pre-wrap !important; }';
  document.head.appendChild(style);

  let motionFolder: FolderApi | undefined;

  const rebuildTrail = () => {
    const motion = session.tuning.motions[ui.motion]!;
    const ticks = Math.round(motion.duration * TICK_RATE);
    const blades: BladeTransform[] = [];
    for (let t = 0; t <= ticks; t++) blades.push(motionPose(session.tuning, ui.motion, t, ORIGIN).blade);
    const { windUpEnd, releaseEnd } = motion.markers;
    trail.set(blades, (t) =>
      windUpEnd !== undefined && releaseEnd !== undefined ? t / TICK_RATE >= windUpEnd && t / TICK_RATE <= releaseEnd : false,
    );
  };

  const applyEdit = () => {
    try {
      session.commit(ui.motion);
      ui.status = 'OK (unsaved changes)';
      rebuildTrail();
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    pane.refresh();
  };

  const save = async () => {
    let motion: Motion;
    try {
      motion = session.commit(ui.motion);
    } catch (e) {
      ui.status = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      pane.refresh();
      return;
    }
    const file = motionFileName(motion.name);
    try {
      const result = await saveJsonFile(file, serializeMotion(motion));
      ui.status =
        result === 'written'
          ? `Saved ${file}`
          : result === 'downloaded'
            ? `Downloaded ${file}: move it into data/motions/`
            : 'Save cancelled';
    } catch (e) {
      ui.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    pane.refresh();
  };

  const buildMotionFolder = () => {
    if (motionFolder) pane.remove(motionFolder);
    motionFolder = pane.addFolder({ title: `Motion: ${ui.motion}` });
    buildMotionFields(motionFolder, session.draft(ui.motion));
    motionFolder.on('change', applyEdit);
    ui.tick = 0;
    rebuildTrail();
  };

  const motionOptions = Object.fromEntries(session.motionNames().map((n) => [n, n]));
  pane.addBinding(ui, 'motion', { options: motionOptions }).on('change', buildMotionFolder);
  pane.addBinding(ui, 'playing');
  pane.addBinding(ui, 'speed', { min: 0.05, max: 2, step: 0.05 });
  pane.addBinding(ui, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) });
  pane.addButton({ title: 'Save Motion to data/motions/' }).on('click', () => void save());
  pane.addBinding(ui, 'status', { readonly: true, multiline: true, rows: 3 });
  buildMotionFolder();

  // Preview loop: Editor-only wall clock driving whole Ticks of the Motion.
  let accumulator = 0;
  let last = performance.now();
  function frame(now: number): void {
    const motion = session.tuning.motions[ui.motion]!;
    const loopTicks = Math.round((motion.duration + LOOP_HOLD_SECONDS) * TICK_RATE);
    if (ui.playing) accumulator += Math.min((now - last) / 1000, 0.25) * ui.speed;
    last = now;
    while (accumulator >= TICK_SECONDS) {
      ui.tick = (ui.tick + 1) % loopTicks;
      accumulator -= TICK_SECONDS;
    }
    const alpha = accumulator / TICK_SECONDS;
    const a = motionPose(session.tuning, ui.motion, ui.tick, ORIGIN);
    const b = motionPose(session.tuning, ui.motion, ui.tick + 1 < loopTicks ? ui.tick + 1 : ui.tick, ORIGIN);
    fighter.update(lerpPose(a, b, alpha));
    controls.update();
    stage.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const POS = { x: { step: 0.01 }, y: { step: 0.01 }, z: { step: 0.01 } };
const ROT = { x: { step: 1 }, y: { step: 1 }, z: { step: 1 } };
const easeOptions = Object.fromEntries(EASES.map((e) => [e, e]));

/** Tweakpane fields for every value of a Motion draft. Edits mutate the draft in place. */
function buildMotionFields(folder: FolderApi, d: MotionDraft): void {
  folder.addBinding(d, 'duration', { min: 0.05, step: 0.01 });
  folder.addBinding(d, 'loop');
  const markerNames = Object.keys(d.markers);
  if (markerNames.length > 0) {
    const markers = folder.addFolder({ title: 'Markers (s)' });
    for (const m of markerNames) markers.addBinding(d.markers, m, { min: 0, step: 0.01 });
  }
  d.poseKeys.forEach((k, i) => {
    const f = folder.addFolder({ title: `Pose Key ${i}`, expanded: i === 0 });
    f.addBinding(k, 'time', { min: 0, step: 0.01 });
    f.addBinding(k, 'ease', { options: easeOptions });
    if (k.rightHand) {
      f.addBinding(k.rightHand, 'position', { label: 'sword hand', ...POS });
      f.addBinding(k.rightHand, 'rotation', { label: 'sword rot°', ...ROT });
    }
    if (k.leftHand) f.addBinding(k.leftHand, 'position', { label: 'left hand', ...POS });
    if (k.torso) {
      f.addBinding(k.torso, 'twist', { label: 'torso twist°', step: 1 });
      f.addBinding(k.torso, 'lean', { label: 'torso lean°', step: 1 });
    }
    if (k.hip) f.addBinding(k, 'hip', POS);
    if (k.leftFoot) {
      f.addBinding(k.leftFoot, 'x', { label: 'left foot x', step: 0.01 });
      f.addBinding(k.leftFoot, 'z', { label: 'left foot z', step: 0.01 });
    }
    if (k.rightFoot) {
      f.addBinding(k.rightFoot, 'x', { label: 'right foot x', step: 0.01 });
      f.addBinding(k.rightFoot, 'z', { label: 'right foot z', step: 0.01 });
    }
  });
}
