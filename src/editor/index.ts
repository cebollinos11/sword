/**
 * The Editor route (/sword/#/editor): the Motion Editor. Author any Motion
 * (each Attack, each Block, Idle, Stagger) against the real Simulation code:
 * a timeline of its Pose Keys (select, retime, add, scrub, easing curves),
 * 3D gizmos on the selected Pose Key's hand/torso/hip/foot targets, fields
 * for every value, the Blade Sweep trail, a gameplay camera view (the Fighter
 * as its opponent sees it, to judge Wind-up readability), and Save back to
 * `data/motions/<name>.json` (File System Access API, download fallback).
 *
 * The previewed Fighter wields a Weapon picked from the roster, and plays that
 * Weapon's Motions: its Motion override where it has one (edited and saved to
 * `data/motions/<Weapon file stem>/<name>.json`), the shared default otherwise.
 * "Override for <Weapon>" copies the default into a new override; "Remove
 * override" drops it, so the Weapon plays the default again.
 *
 * `EditorSession` is the one source of truth for the working Tuning Data;
 * the timeline, gizmos, fields and the Duel sandbox all edit through it, and
 * the Pose Key operations live in `motionEdit.ts` (unit-tested).
 */
import type * as THREE from 'three';
import type { ButtonApi } from 'tweakpane';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane, type FolderApi } from 'tweakpane';
import { motionPose, motionTempo, playedSeconds, secondsToTicks, TICK_RATE, type BladeTransform, type Placement } from '../sim';
import { EASES, guardKey, POSE_KEY_CHANNELS, weaponByName, weaponMotion, type Motion, type PoseKeyChannel, type TuningData } from '../tuning';
import { FIGHTER_COLOURS, FighterView } from '../render/fighterView';
import { Stage } from '../render/stage';
import { placeThirdPersonCamera } from '../render/thirdPersonCamera';
import { GIZMO_LABELS, GIZMO_TARGETS, PoseGizmo, type GizmoTarget } from './gizmo';
import { addPoseKey, isLinked, linkChannel, removePoseKey, retimePoseKey, scaleMotion, setChannel } from './motionEdit';
import { saveJsonFile } from './save';
import { startSandbox } from './sandbox';
import { EditorSession, motionPath, type MotionDraft } from './session';
import { Timeline } from './timeline';
import { BladeSweepTrail } from './trail';

export { EditorSession, type MotionDraft } from './session';

const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };

/** How the Motion Editor looks at the previewed Fighter: the free orbit camera, or the gameplay camera of its opponent. */
type EditorView = 'orbit' | 'gameplay';
const VIEW_LABELS: Record<string, EditorView> = { 'orbit (edit)': 'orbit', "gameplay camera (opponent's view)": 'gameplay' };
/** Pause at the end of each loop so the final pose and the whole trail are readable. */
const LOOP_HOLD_SECONDS = 0.4;

const CHANNEL_LABELS: Record<PoseKeyChannel, string> = {
  rightHand: 'sword hand',
  leftHand: 'left hand',
  torso: 'torso',
  hip: 'hip',
  leftFoot: 'left foot',
  rightFoot: 'right foot',
  kickFoot: 'kick foot (right ankle)',
  body: 'body (tilt/drop)',
};

export function startEditor(container: HTMLElement, loaded: TuningData): void {
  if (location.hash.startsWith('#/editor/sandbox')) {
    startSandbox(container, loaded);
    return;
  }
  const session = new EditorSession(loaded);
  const stage = new Stage(container, loaded);
  stage.camera.position.set(3.2, 1.7, 1.6);
  const orbit = new OrbitControls(stage.camera, stage.canvas);
  orbit.target.set(0, 1.1, 0.3);
  orbit.update();

  const fighter = new FighterView(FIGHTER_COLOURS[0]!, loaded);
  const trail = new BladeSweepTrail();
  stage.scene.add(fighter.root, trail.root);

  // The gameplay camera view (story 40: is the Wind-up readable?): the previewed Fighter as its
  // opponent sees it in a Duel, from the third-person camera over the opponent's shoulder.
  const opponentPlacement: Placement = { position: { x: 0, z: loaded.match.duelDistance }, facing: Math.PI };
  const opponent = new FighterView(FIGHTER_COLOURS[1]!, loaded);
  opponent.root.visible = false;
  stage.scene.add(opponent.root);
  /** The orbit camera, kept while the gameplay camera view is on. */
  let orbitView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  const setView = (view: EditorView) => {
    const gameplay = view === 'gameplay';
    opponent.root.visible = gameplay;
    orbit.enabled = !gameplay;
    if (gameplay && !orbitView) {
      orbitView = { position: stage.camera.position.clone(), target: orbit.target.clone() };
    } else if (!gameplay && orbitView) {
      stage.camera.position.copy(orbitView.position);
      orbit.target.copy(orbitView.target);
      orbitView = null;
      orbit.update();
    }
  };

  const ui = {
    motion: session.motionNames()[0]!,
    weapon: session.weaponNames()[0]!,
    editing: '',
    playing: true,
    speed: 1,
    time: 0,
    tick: 0,
    gizmo: 'swordHand' as GizmoTarget,
    view: 'orbit' as EditorView,
    status: 'Timeline: click a Pose Key to edit it, drag it to retime, double-click to add one, drag elsewhere to scrub. Space plays.',
  };
  /** Index of the selected Pose Key in the current Motion's draft. */
  let selected: number | null = null;
  /** The Weapon whose override is being edited, or undefined while editing the shared default. */
  const override = (): string | undefined => (session.hasOverride(ui.weapon, ui.motion) ? ui.weapon : undefined);
  const draft = (): MotionDraft => session.draft(ui.motion, override());
  /** The Motion the previewed Weapon plays (its override, or the default). */
  const liveMotion = (): Motion => weaponMotion(session.tuning, ui.weapon, ui.motion)!;
  /** The previewed Weapon's guard: what channels linked to "idle" show. */
  const guard = () => guardKey(session.tuning, ui.weapon);

  const pane = new Pane({ title: 'Motion Editor' });
  pane.addButton({ title: 'Duel sandbox →' }).on('click', () => (location.hash = '#/editor/sandbox'));
  const paneBox = pane.element.parentElement!;
  paneBox.style.width = '340px';
  paneBox.style.maxHeight = 'calc(100vh - 16px)';
  paneBox.style.overflowY = 'auto';
  // Let validation messages in the status monitor wrap instead of scrolling sideways.
  const style = document.createElement('style');
  style.textContent = '.tp-mllv_i { white-space: pre-wrap !important; }';
  document.head.appendChild(style);

  let motionFolder: FolderApi | undefined;
  let keyFolder: FolderApi | undefined;

  /** Seconds of play by which the previewed Weapon, at its Tempo, reaches authored second `authored` of the Motion. */
  const played = (authored: number): number => {
    const tempo = motionTempo(session.tuning, ui.weapon, ui.motion);
    return tempo ? playedSeconds(liveMotion(), tempo, authored) : authored;
  };

  /** The blade on every Tick the previewed Weapon plays the Motion for, at its Tempo, so the trail spaces out as the sim does. */
  const rebuildTrail = () => {
    const motion = liveMotion();
    const ticks = secondsToTicks(played(motion.duration));
    const blades: BladeTransform[] = [];
    for (let t = 0; t <= ticks; t++) blades.push(motionPose(session.tuning, ui.motion, t, ORIGIN, ui.weapon).blade);
    const { windUpEnd, releaseEnd } = motion.markers;
    trail.set(blades, (t) =>
      windUpEnd !== undefined && releaseEnd !== undefined ? t / TICK_RATE >= played(windUpEnd) && t / TICK_RATE <= played(releaseEnd) : false,
    );
  };

  /** Validate the draft and make it live (preview, trail); show the error otherwise. */
  const applyEdit = () => {
    try {
      session.commit(ui.motion, override());
      ui.status = 'OK (unsaved changes)';
      rebuildTrail();
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    pane.refresh();
  };

  const save = async () => {
    let file: ReturnType<EditorSession['motionFile']>;
    try {
      file = session.motionFile(ui.motion, override());
    } catch (e) {
      ui.status = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      pane.refresh();
      return;
    }
    try {
      const result = await saveJsonFile(file.fileName, file.text);
      ui.status =
        result === 'written'
          ? `Saved ${file.fileName} (${file.path})`
          : result === 'downloaded'
            ? `Downloaded ${file.fileName}: move it to ${file.path}`
            : 'Save cancelled';
    } catch (e) {
      ui.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    pane.refresh();
  };

  // --- Gizmo and timeline -------------------------------------------------
  // The timeline is in authored seconds; the pose is looked up at the played time that shows it.
  const previewPose = () => motionPose(session.tuning, ui.motion, played(Math.min(ui.time, liveMotion().duration)) * TICK_RATE, ORIGIN, ui.weapon);

  const gizmo = new PoseGizmo(
    stage.camera,
    stage.canvas,
    loaded.skeleton,
    ORIGIN,
    (channelAdded) => {
      applyEdit();
      if (channelAdded) buildKeyFolder();
    },
    (t) => {
      ui.gizmo = t;
      pane.refresh();
    },
  );
  gizmo.controls.addEventListener('dragging-changed', (e) => (orbit.enabled = ui.view === 'orbit' && !(e.value as boolean)));
  stage.scene.add(gizmo.root);

  const select = (index: number | null) => {
    selected = index;
    const key = index === null ? undefined : draft().poseKeys[index];
    if (key) {
      ui.playing = false;
      ui.time = key.time;
      gizmo.setContext({ draft: draft(), key: index!, pose: previewPose(), guard: guard() });
    } else {
      selected = null;
      gizmo.setContext(undefined);
    }
    buildKeyFolder();
    pane.refresh();
  };

  const retime = (index: number, time: number): number => {
    const i = retimePoseKey(draft(), index, time);
    selected = i;
    ui.time = draft().poseKeys[i]!.time;
    gizmo.setContext({ draft: draft(), key: i, pose: previewPose(), guard: guard() });
    if (keyFolder) keyFolder.title = `Pose Key ${i}`;
    keyUi.time = ui.time;
    applyEdit();
    return i;
  };

  const addKey = (time: number) => {
    const i = addPoseKey(draft(), time, loaded.skeleton, guard());
    applyEdit();
    select(i);
  };

  const deleteKey = () => {
    if (selected === null) return;
    try {
      removePoseKey(draft(), selected);
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
      pane.refresh();
      return;
    }
    applyEdit();
    select(null);
  };

  const timeline = new Timeline({
    select,
    retime,
    scrub: (t) => {
      if (selected !== null) select(null);
      ui.playing = false;
      ui.time = t;
      pane.refresh();
    },
    add: addKey,
  });
  document.body.appendChild(timeline.element);

  // --- Fields -------------------------------------------------------------
  const keyUi = {
    time: 0,
    channels: Object.fromEntries(POSE_KEY_CHANNELS.map((c) => [c, false])) as Record<PoseKeyChannel, boolean>,
    linked: Object.fromEntries(POSE_KEY_CHANNELS.map((c) => [c, false])) as Record<PoseKeyChannel, boolean>,
  };

  const buildKeyFolder = () => {
    if (keyFolder) pane.remove(keyFolder);
    keyFolder = undefined;
    if (selected === null) return;
    const key = draft().poseKeys[selected];
    if (!key) return;
    const f = pane.addFolder({ title: `Pose Key ${selected}` });
    keyFolder = f;
    keyUi.time = key.time;
    f.addBinding(keyUi, 'time', { min: 0, max: draft().duration, step: 0.01, label: 'time (s)' }).on('change', (e) => {
      if (selected !== null && e.last !== false) retime(selected, e.value);
    });
    f.addBinding(key, 'ease', { options: Object.fromEntries(EASES.map((e) => [e, e])), label: 'ease (into key)' }).on('change', applyEdit);
    const channels = f.addFolder({ title: 'Channels set by this key' });
    for (const c of POSE_KEY_CHANNELS) {
      keyUi.channels[c] = key[c] !== undefined || isLinked(draft(), selected, c);
      channels.addBinding(keyUi.channels, c, { label: CHANNEL_LABELS[c] }).on('change', (e) => {
        if (selected === null) return;
        setChannel(draft(), selected, c, e.value, loaded.skeleton, guard());
        applyEdit();
        buildKeyFolder();
      });
    }
    // Linked channels follow the Idle's first Pose Key (each Weapon's own Idle): change an Idle and they move with it.
    const linked = f.addFolder({ title: 'Linked to Idle (guard)' });
    for (const c of POSE_KEY_CHANNELS) {
      if (guard()[c] === undefined || ui.motion === 'Idle') continue;
      keyUi.linked[c] = isLinked(draft(), selected, c);
      linked.addBinding(keyUi.linked, c, { label: CHANNEL_LABELS[c] }).on('change', (e) => {
        if (selected === null) return;
        linkChannel(draft(), selected, c, e.value, loaded.skeleton, guard());
        applyEdit();
        buildKeyFolder();
      });
    }
    buildChannelFields(f, key, applyEdit);
    f.addButton({ title: 'Delete Pose Key' }).on('click', deleteKey);
  };

  let overrideButton: ButtonApi | undefined;
  let removeButton: ButtonApi | undefined;
  const buildMotionFolder = () => {
    if (motionFolder) pane.remove(motionFolder);
    const own = override();
    ui.editing = own ? `${own}'s override (${motionPath(ui.motion, own)})` : 'the default Motion (shared by every Weapon without an override)';
    if (overrideButton) {
      overrideButton.title = `Override for ${ui.weapon}`;
      overrideButton.disabled = own !== undefined;
    }
    if (removeButton) removeButton.disabled = own === undefined;
    motionFolder = pane.addFolder({ title: own ? `Motion: ${ui.motion} (${own})` : `Motion: ${ui.motion}` });
    buildMotionFields(motionFolder, draft(), (seconds) => {
      try {
        scaleMotion(draft(), seconds);
      } catch (e) {
        ui.status = e instanceof Error ? e.message : String(e);
        pane.refresh();
        return;
      }
      applyEdit();
      buildMotionFolder();
    });
    motionFolder.on('change', applyEdit);
    ui.time = 0;
    select(null);
    rebuildTrail();
  };

  const motionOptions = Object.fromEntries(session.motionNames().map((n) => [n, n]));
  pane.addBinding(ui, 'motion', { options: motionOptions }).on('change', buildMotionFolder);
  pane.addBinding(ui, 'weapon', { label: 'Weapon', options: Object.fromEntries(session.weaponNames().map((n) => [n, n])) }).on('change', buildMotionFolder);
  pane.addBinding(ui, 'editing', { readonly: true, multiline: true, rows: 2 });
  overrideButton = pane.addButton({ title: `Override for ${ui.weapon}` });
  overrideButton.on('click', () => {
    try {
      session.createOverride(ui.weapon, ui.motion);
      ui.status = `${ui.weapon} now has its own ${ui.motion} (a copy of the default; unsaved)`;
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    buildMotionFolder();
    pane.refresh();
  });
  removeButton = pane.addButton({ title: 'Remove override' });
  removeButton.on('click', () => {
    try {
      const path = session.removeOverride(ui.weapon, ui.motion);
      ui.status = `${ui.weapon} plays the default ${ui.motion} again. Delete ${path} from the repo if it was saved.`;
    } catch (e) {
      ui.status = e instanceof Error ? e.message : String(e);
    }
    buildMotionFolder();
    pane.refresh();
  });
  pane.addBinding(ui, 'playing');
  pane.addBinding(ui, 'speed', { min: 0.05, max: 2, step: 0.05 });
  pane.addBinding(ui, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) });
  pane.addBinding(ui, 'view', { options: VIEW_LABELS }).on('change', (e) => setView(e.value));
  pane.addBinding(ui, 'gizmo', { options: Object.fromEntries(GIZMO_TARGETS.map((t) => [GIZMO_LABELS[t], t])) }).on('change', (e) =>
    gizmo.setTarget(e.value),
  );
  pane.addButton({ title: 'Add Pose Key at playhead' }).on('click', () => addKey(ui.time));
  pane.addButton({ title: 'Save Motion (default or override)' }).on('click', () => void save());
  pane.addBinding(ui, 'status', { readonly: true, multiline: true, rows: 3 });
  buildMotionFolder();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Delete') deleteKey();
    if (e.key === ' ') {
      ui.playing = !ui.playing;
      if (ui.playing) select(null);
      pane.refresh();
      e.preventDefault();
    }
  });

  // Preview loop: an Editor-only wall clock driving the Motion's time.
  let last = performance.now();
  function frame(now: number): void {
    const motion = liveMotion();
    const loopSeconds = motion.duration + LOOP_HOLD_SECONDS;
    if (ui.playing) {
      if (selected !== null) select(null);
      ui.time = (ui.time + Math.min((now - last) / 1000, 0.25) * ui.speed) % loopSeconds;
    }
    last = now;
    const tick = secondsToTicks(Math.min(ui.time, motion.duration));
    if (tick !== ui.tick) {
      ui.tick = tick;
      pane.refresh();
    }
    const pose = previewPose();
    fighter.update(pose, weaponByName(session.tuning, ui.weapon));
    gizmo.setPose(pose);
    timeline.update(draft(), selected, ui.time);
    if (ui.view === 'gameplay') {
      opponent.update(motionPose(session.tuning, 'Idle', secondsToTicks(ui.time), opponentPlacement), weaponByName(session.tuning, session.weaponNames()[0]!));
      placeThirdPersonCamera(stage.camera, session.tuning.camera, opponentPlacement.position, opponentPlacement.facing);
    } else {
      orbit.update();
    }
    stage.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const POS = { x: { step: 0.01 }, y: { step: 0.01 }, z: { step: 0.01 } };
const ROT = { x: { step: 1 }, y: { step: 1 }, z: { step: 1 } };

/** Motion-level fields: duration, loop, markers, and scaling the whole timeline to a new length. */
function buildMotionFields(folder: FolderApi, d: MotionDraft, onScale: (seconds: number) => void): void {
  folder.addBinding(d, 'duration', { min: 0.05, step: 0.01 });
  const scale = { seconds: d.duration };
  folder.addBinding(scale, 'seconds', { min: 0.05, step: 0.01, label: 'scale to (s)' });
  folder.addButton({ title: 'Scale timeline to that length' }).on('click', () => onScale(scale.seconds));
  folder.addBinding(d, 'loop');
  const markerNames = Object.keys(d.markers);
  if (markerNames.length > 0) {
    const markers = folder.addFolder({ title: 'Markers (s)' });
    for (const m of markerNames) markers.addBinding(d.markers, m, { min: 0, step: 0.01 });
  }
}

/** Fields for each channel a Pose Key sets. Edits mutate the draft in place. */
function buildChannelFields(f: FolderApi, k: MotionDraft['poseKeys'][number], onChange: () => void): void {
  const bind = (b: { on(ev: 'change', h: () => void): unknown }) => b.on('change', onChange);
  if (k.rightHand) {
    bind(f.addBinding(k.rightHand, 'position', { label: 'sword hand', ...POS }));
    bind(f.addBinding(k.rightHand, 'rotation', { label: 'sword rot°', ...ROT }));
  }
  if (k.leftHand) bind(f.addBinding(k.leftHand, 'position', { label: 'left hand', ...POS }));
  if (k.torso) {
    bind(f.addBinding(k.torso, 'twist', { label: 'torso twist°', step: 1 }));
    bind(f.addBinding(k.torso, 'lean', { label: 'torso lean°', step: 1 }));
  }
  if (k.hip) bind(f.addBinding(k, 'hip', POS));
  if (k.leftFoot) {
    bind(f.addBinding(k.leftFoot, 'x', { label: 'left foot x', step: 0.01 }));
    bind(f.addBinding(k.leftFoot, 'z', { label: 'left foot z', step: 0.01 }));
  }
  if (k.rightFoot) {
    bind(f.addBinding(k.rightFoot, 'x', { label: 'right foot x', step: 0.01 }));
    bind(f.addBinding(k.rightFoot, 'z', { label: 'right foot z', step: 0.01 }));
  }
  if (k.kickFoot) bind(f.addBinding(k, 'kickFoot', { label: 'kick foot', ...POS }));
  if (k.body) {
    bind(f.addBinding(k.body, 'tilt', { label: 'body tilt°', step: 1 }));
    bind(f.addBinding(k.body, 'drop', { label: 'body drop', step: 0.01 }));
  }
}
