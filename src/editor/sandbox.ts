/**
 * The Editor's Duel sandbox (/sword/#/editor/sandbox): a scripted two-Fighter
 * Duel run through the real Simulation, with play/pause, step-one-Tick,
 * scrubbing, slow motion and overlays (Hit Zones, Blade Sweep, Action/phase).
 * A dropdown picks the script (`SCRIPTS`): the Exchange (attacks, Blocks, Trade),
 * Movement, an AI vs AI Match (two AI Controllers, difficulty per Fighter
 * and seed in the "AI vs AI" folder), or Player vs AI (you play red with the
 * Local Controller and the game's third-person camera; "Player vs AI" folder).
 * The "Weapons" folder picks each Fighter's Weapon for every script. In dev (`?dev=1`), the "Generated Arena"
 * folder (the Arena Lab, arenaLab.ts) generates an Arena from a seed and fights every script in it instead of the circle.
 *
 * The run is stepped through a `SandboxSession` (sandboxSession.ts), which
 * keeps every Tick as a snapshot plus the Controllers' memory. Scripts are
 * computed up front so the scrub slider has a fixed range; scrubbing picks a
 * stored Tick, and resuming from there re-simulates (Controllers restored) and
 * checks each Tick against the stored one, shown as "determinism" in State.
 * Player vs AI is live instead: playback extends the frontier, the scrub
 * slider grows with it, and playing on after a scrub back retakes from that
 * Tick (the AI restored; the first different Intent of yours starts a branch).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import {
  attack,
  createInitialState,
  createMatch,
  duelPlacements,
  fighterPose,
  hitZoneCapsules,
  hold,
  TICK_SECONDS,
  DEFAULT_GEN_PARAMS,
  wait,
  walk,
  type Direction,
  type BladeTransform,
  type HitCapsule,
  type HitEvent,
  type Intent,
  type MatchState,
  type SimState,
  type Track,
} from '../sim';
import { weaponByName, type HitZone, type TuningData } from '../tuning';
import { drawnPose, FIGHTER_COLOURS, FighterView } from '../render/fighterView';
import { ImpactEffects } from '../render/impacts';
import { Stage } from '../render/stage';
import { BladeSweepTrail } from './trail';
import { createBrowserAudio } from '../audio';
import { createAiController, LocalController, scriptedController, TEST_OPPONENTS, type Controller } from '../controllers';
import { bindLocalInput } from '../play/input';
import { placeThirdPersonCamera } from '../render/thirdPersonCamera';
import {
  createSandboxSession,
  duelSandbox,
  liveScrubMax,
  matchSandbox,
  playerVsAiSession,
  type Sandbox,
  type SandboxSession,
} from './sandboxSession';
import { ActionLabels, describeAction } from './actionLabels';
import { EditorSession } from './session';
import { addTuningPanels } from './tuningPanel';
import { recordingSandbox, recordReplay } from './replay';
import { addReplayPanel } from './replayPanel';
import { describeReport, frameArena, labArena, withArena, type LabArena } from './arenaLab';
import { saveJsonFile } from './save';
import { devMode } from '../devMode';

/** What the sandbox plays: a session to scrub through, the Duel at each Tick, plus the Match around it for an AI vs AI run. */
interface SandboxRun {
  readonly session: SandboxSession<unknown>;
  /** Playback stops at this Tick (the precomputed length, or a live run's cap). */
  readonly ticks: number;
  readonly duel: (tick: number) => SimState;
  readonly match?: (tick: number) => MatchState;
  /** A live run (Player vs AI): driven by this Local Controller as Fighter 0, not precomputed. */
  readonly local?: LocalController;
  /** The Intents fed to the Simulation for every computed Tick (for golden replays). */
  readonly intents: () => Intent[][];
}

/**
 * Step a run up front (until `ticks` or its end) and rewind it to Tick 0.
 * (Player vs AI is live instead: see playerVsAiMatch.)
 */
function precompute<S extends object>(sandbox: Sandbox<S>, initial: S, controllers: readonly Controller[], ticks: number): SandboxRun {
  const recorder = recordingSandbox(sandbox);
  const session = createSandboxSession(recorder, initial, controllers);
  while (!session.over && session.frontier < ticks) session.advance();
  session.seek(0);
  return { session, ticks: session.frontier, duel: (t) => sandbox.duel(session.history[t]!), intents: () => recorder.intentsOf(session.history) };
}

/** Each Fighter's Weapon in every script (the Tweakpane "Weapons" folder edits these; blank = the default Weapon). */
const weaponPicks = { red: '', blue: '' };
const pickedWeapons = (): string[] => [weaponPicks.red, weaponPicks.blue];

/** Two scripted Tracks facing each other `distance` apart (like `runDuel`, but through a session). */
function scripted(tuning: TuningData, distance: number, a: Track, b: Track, ticks: number): SandboxRun {
  const initial = createInitialState(tuning, 1, duelPlacements(distance), pickedWeapons());
  return precompute(duelSandbox(tuning), initial, [scriptedController(a), scriptedController(b)], ticks);
}

/** Settings of the AI vs AI Match (the Tweakpane folder edits these). */
const aiMatch = { red: 'Hard', blue: 'Normal', seed: 1, bestOf: 3 };
/** Stop an AI vs AI Match that never ends (e.g. two perfect AIs) after this many Ticks. */
const AI_MATCH_MAX_TICKS = 60 * 60 * 5;

const block = (direction: Direction, ticks: number): Track => hold(ticks, { block: true, direction });

/**
 * The scripted Duel (Ticks with today's Tuning Data). Fighter 0 swings Overheads, Fighter 1:
 *  - Blocks Overhead: Fighter 0's Attack is Blocked and Fighter 0 Staggers (55);
 *  - Blocks Left: the wrong Direction, so the Attack lands and Fighter 1 Staggers (157);
 *  - swings back at the same moment: a Trade, both hit and Stagger (275);
 *  - shows the Right, Thrust and Overhead Block Motions; the Overhead one Blocks again (455);
 *  - is hit during its own Wind-up, which is interrupted; Fighter 0 wins (537).
 */
function scriptedDuel(tuning: TuningData): SandboxRun {
  const swing = attack('Overhead');
  const a: Track = [...wait(20), ...swing, ...wait(101), ...swing, ...wait(117), ...swing, ...wait(179), ...swing, ...wait(81), ...swing];
  const b: Track = [
    ...block('Overhead', 105),
    ...wait(5),
    ...block('Left', 100),
    ...wait(30),
    ...swing,
    ...wait(89),
    ...block('Right', 35),
    ...wait(5),
    ...block('Thrust', 35),
    ...wait(5),
    ...block('Overhead', 80),
    ...wait(20),
    ...attack('Overhead', 40),
  ];
  return scripted(tuning, 1.3, a, b, 660);
}

/**
 * Movement and collision: both Fighters walk in and collide, Fighter 0 shoves Fighter 1 back,
 * backs off, both strafe, Fighter 0 steps into an Overhead (more Blade Speed than standing),
 * then Fighter 1 retreats to the Arena edge and Fighter 0 pins it there.
 */
function movementDuel(tuning: TuningData): SandboxRun {
  const forward = { x: 0, z: 1 };
  const back = { x: 0, z: -1 };
  const right = { x: 1, z: 0 };
  const a: Track = [
    ...walk(90, forward),
    ...walk(40, back),
    ...walk(40, right),
    ...walk(18, forward),
    ...attack('Overhead'),
    ...wait(29),
    ...walk(30, forward),
    ...wait(80),
    ...walk(260, forward),
  ];
  const b: Track = [...walk(50, back), ...wait(80), ...walk(40, right), ...wait(138), ...walk(260, forward)];
  return scripted(tuning, 3, a, b, 600);
}

/**
 * AI vs AI: a best-of-N Match between two AI Controllers. The scrub index is
 * the Match Tick; the Duel shown at each is `match.duel` (each new Duel restarts
 * its own Tick), and events are tagged with the Match Tick. The AI Controllers'
 * memory (their generator lives outside SimState) is saved with every Tick, so
 * resuming after a scrub plays the same Match again.
 */
function aiVsAiMatch(tuning: TuningData): SandboxRun {
  const controllers = [createAiController(tuning, aiMatch.red), createAiController(tuning, aiMatch.blue)];
  const start = createMatch(tuning, { bestOf: aiMatch.bestOf, seed: aiMatch.seed, weapons: pickedWeapons(), arena: tuning.arena.editor });
  const run = precompute(matchSandbox(tuning), start, controllers, AI_MATCH_MAX_TICKS);
  return { ...run, match: (t) => run.session.history[t] as MatchState };
}

/** Settings of the Player vs AI Match (the Tweakpane folder edits these). */
const playerMatch = { ai: 'Normal', seed: 1, bestOf: 3 };
/** A live run keeps every Tick; stop playback after this many (30 minutes). */
const PLAYER_MATCH_MAX_TICKS = 60 * 60 * 30;
const PLAYER_VS_AI = 'Player vs AI';

/** Settings of the Arena Lab (the "Generated Arena" folder edits these). */
const lab = { kit: 'greybox', seed: 1, ...DEFAULT_GEN_PARAMS, use: true, colliders: true, report: '(press Generate)' };
/** The largest seed Random seed picks. */
const LAB_MAX_SEED = 999_999;

/**
 * Player vs AI: you are red (Fighter 0, the Local Controller fed by mouse and
 * keys), the AI (or a test opponent: Dummy, Wall) is blue. Live: nothing is precomputed, playing extends the run.
 */
function playerVsAiMatch(tuning: TuningData, local: LocalController): SandboxRun {
  local.releaseAll();
  local.setYaw(0); // Fighter 0 starts facing +z
  const recorder = recordingSandbox(matchSandbox(tuning));
  const options = { opponent: playerMatch.ai, bestOf: playerMatch.bestOf, seed: playerMatch.seed, weapons: pickedWeapons() };
  const session = playerVsAiSession(tuning, local, options, recorder);
  return {
    session,
    ticks: PLAYER_MATCH_MAX_TICKS,
    intents: () => recorder.intentsOf(session.history),
    duel: (t) => session.history[t]!.duel,
    match: (t) => session.history[t]!,
    local,
  };
}

const SCRIPTS: Record<string, (tuning: TuningData, local: LocalController) => SandboxRun> = {
  Exchange: scriptedDuel,
  Movement: movementDuel,
  'AI vs AI Match': aiVsAiMatch,
  [PLAYER_VS_AI]: playerVsAiMatch,
};
type ScriptName = keyof typeof SCRIPTS;

function describeMatch(m: MatchState, live: boolean): string {
  const score = `score ${m.score.join('–')}`;
  const red = live ? 'you (red)' : 'red';
  if (m.status.status === 'Over') return `Match over: ${m.status.winner === 0 ? red : 'blue'} wins · ${score}`;
  return `Duel ${m.duelNumber} of best of ${m.config.bestOf} · ${score}`;
}

const TRAIL_TICKS = 45;
const ZONE_COLOURS: Record<HitZone, number> = { head: 0xffd60a, torso: 0x30d158, limbs: 0x64d2ff };

/** Is the Blade Sweep from Tick t-1 to Tick t live? (Release, entering or leaving it.) */
function sweepLive(run: SandboxRun, fighter: number, t: number): boolean {
  const prev = t > 0 ? run.duel(t - 1).fighters[fighter]?.action : undefined;
  const curr = run.duel(t).fighters[fighter]?.action;
  if (!prev || curr?.kind !== 'Attack') return false;
  return curr.phase === 'Release' || (prev.kind === 'Attack' && prev.phase === 'Release');
}

/** Translucent capsules for the Hit Zones of one Fighter. */
class HitZoneOverlay {
  readonly root = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly materials = Object.fromEntries(
    (Object.keys(ZONE_COLOURS) as HitZone[]).map((z) => [
      z,
      new THREE.MeshBasicMaterial({ color: ZONE_COLOURS[z], transparent: true, opacity: 0.22, depthWrite: false }),
    ]),
  ) as Record<HitZone, THREE.MeshBasicMaterial>;

  update(capsules: readonly HitCapsule[]): void {
    let n = 0;
    const next = (geom: THREE.BufferGeometry, zone: HitZone) => {
      let m = this.meshes[n];
      if (!m) {
        m = new THREE.Mesh(geom, this.materials[zone]);
        this.meshes[n] = m;
        this.root.add(m);
      }
      m.geometry = geom;
      m.material = this.materials[zone];
      m.visible = true;
      n++;
      return m;
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of capsules) {
      const a = new THREE.Vector3(c.a.x, c.a.y, c.a.z);
      const b = new THREE.Vector3(c.b.x, c.b.y, c.b.z);
      const len = a.distanceTo(b);
      for (const p of len > 1e-6 ? [a, b] : [a]) {
        const s = next(this.sphere, c.zone);
        s.position.copy(p);
        s.scale.setScalar(c.radius);
        s.quaternion.identity();
      }
      if (len > 1e-6) {
        const cyl = next(this.cylinder, c.zone);
        cyl.position.copy(a).add(b).multiplyScalar(0.5);
        cyl.scale.set(c.radius, len, c.radius);
        cyl.quaternion.setFromUnitVectors(up, b.clone().sub(a).divideScalar(len));
      }
    }
    for (let i = n; i < this.meshes.length; i++) this.meshes[i]!.visible = false;
  }
}

export function startSandbox(container: HTMLElement, loaded: TuningData): void {
  /** Live Tuning Data: the tuning panels edit it through the session, and every edit re-runs the script. */
  const session = new EditorSession(loaded);
  let tuning = session.tuning;
  weaponPicks.red ||= session.weaponNames()[0]!;
  weaponPicks.blue ||= session.weaponNames()[0]!;
  const stage = new Stage(container, tuning);
  stage.camera.position.set(3.6, 2.2, 0);
  const controls = new OrbitControls(stage.camera, stage.canvas);
  controls.target.set(0, 1.1, 0);
  controls.update();

  /** The Arena Lab's Generated Arena, if one has been generated. */
  let generated: LabArena | null = null;
  /** The generated Arena's Tuning Data copy, made again once the live Tuning Data is edited (it is cached: the navmesh is built per copy). */
  let labTuning: { base: TuningData; tuning: TuningData } | null = null;
  const fightingGenerated = () => lab.use && generated !== null;
  /** Point `tuning` (and the Stage) at the generated Arena when it is in use, otherwise at the live Tuning Data's own. */
  const applyArena = () => {
    if (fightingGenerated()) {
      if (labTuning?.base !== session.tuning) labTuning = { base: session.tuning, tuning: withArena(session.tuning, generated!.arena) };
      tuning = labTuning.tuning;
    } else tuning = session.tuning;
    // The Layout too, so the Stage draws the Arena from its Kit's model.
    stage.setArena(tuning.arena.editor, tuning, fightingGenerated() ? generated!.layout : undefined);
  };
  /** The orbit camera over the generated Arena's whole footprint, or close in on the circle's middle. */
  const frameOrbit = () => {
    if (fightingGenerated()) {
      const { target, position } = frameArena(generated!.arena, stage.camera.fov);
      stage.camera.position.set(position.x, position.y, position.z);
      controls.target.set(target.x, target.y, target.z);
    } else {
      stage.camera.position.set(3.6, 2.2, 0);
      controls.target.set(0, 1.1, 0);
    }
  };

  /** Player vs AI: the human's Controller, fed by mouse/keys on the canvas only while a live run is shown. */
  const local = new LocalController();
  const input = bindLocalInput(local, stage.canvas);

  const script: { name: ScriptName } = { name: 'Exchange' };
  let run: SandboxRun = SCRIPTS[script.name]!(tuning, local);
  const lastTick = () => run.ticks;
  /** The scrub slider's upper end: the whole run, or for a live run the frontier rounded up (the slider grows as you play). */
  const scrubMax = () => (run.local ? liveScrubMax(run.session.frontier) : run.ticks);
  /** Live run: point the aim (camera) along the local Fighter's facing at Tick t, e.g. after a scrub or at a Duel start. */
  const aimAt = (t: number) => {
    const f = run.duel(t).fighters[0];
    if (run.local && f) run.local.setYaw(f.facing);
  };

  const views = [0, 1].map((i) => new FighterView(FIGHTER_COLOURS[i]!, tuning));
  const trails = [0, 1].map(() => new BladeSweepTrail());
  const zones = [0, 1].map(() => new HitZoneOverlay());
  const hitMarker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
  stage.scene.add(...views.map((v) => v.root), ...trails.map((t) => t.root), ...zones.map((z) => z.root), hitMarker);
  const labels = new ActionLabels(stage.camera, stage.canvas);

  const ui = {
    playing: true,
    speed: 0.5,
    tick: 0,
    hitZones: true,
    bladeSweep: true,
    actionPhase: true,
    fighter0: '',
    fighter1: '',
    match: '',
    determinism: '',
    events: '',
  };
  const pane = new Pane({ title: 'Duel sandbox' });
  const paneBox = pane.element.parentElement!;
  paneBox.style.width = '360px';
  paneBox.style.maxHeight = 'calc(100vh - 16px)';
  paneBox.style.overflowY = 'auto';
  pane.addButton({ title: '← Motion Editor' }).on('click', () => (location.hash = '#/editor'));
  /** Move the session's cursor to the Tick shown in the UI (after a scrub). */
  const syncCursor = () => {
    const t = Math.max(0, Math.min(ui.tick, run.session.frontier));
    if (t !== run.session.cursor) {
      run.session.seek(t);
      aimAt(t);
    }
    ui.tick = t;
  };
  /**
   * Play one Tick from the cursor: re-simulated through the session (Controllers restored after a scrub).
   * In a live run the Local Controller is sampled here, so playing on from a scrubbed-back Tick retakes it.
   */
  const advance = (): boolean => {
    syncCursor();
    if (run.session.over || run.session.cursor >= lastTick()) return false;
    run.session.advance();
    ui.tick = run.session.cursor;
    if (run.match?.(ui.tick).events.some((e) => e.type === 'DuelStart')) aimAt(ui.tick);
    hear(ui.tick);
    return true;
  };
  pane.addBinding(ui, 'playing');
  // Sounds and impact effects play for Ticks reached by playing or stepping; scrubbing and restarting are silent.
  const audio = createBrowserAudio();
  const impacts = new ImpactEffects(stage.scene, tuning);
  let heard = ui.tick;
  const hear = (t: number) => {
    audio.onTick(t, run.duel(t).events, run.duel(t));
    impacts.onTick(t, run.duel(t));
    heard = t;
  };
  pane.addBinding(audio, 'muted', { label: 'mute sound' });
  pane.addBinding(ui, 'speed', { min: 0.05, max: 2, step: 0.05, label: 'speed (slow-mo)' });
  /** The scrub slider's range is fixed at creation, so it is rebuilt in place when the script length changes. */
  let scrubBuiltMax = scrubMax();
  const addScrub = (index?: number) => {
    scrubBuiltMax = scrubMax();
    const b = pane.addBinding(ui, 'tick', { min: 0, max: scrubBuiltMax, step: 1, label: 'Tick (scrub)', index });
    b.on('change', () => {
      accumulator = 0;
      syncCursor();
    });
    return b;
  };
  let scrub = addScrub();
  pane.addButton({ title: 'Step one Tick' }).on('click', () => {
    ui.playing = false;
    advance();
    accumulator = 0;
    pane.refresh();
  });
  pane.addButton({ title: 'Step back one Tick' }).on('click', () => {
    ui.playing = false;
    syncCursor();
    run.session.stepBack();
    ui.tick = run.session.cursor;
    aimAt(ui.tick);
    accumulator = 0;
    pane.refresh();
  });
  pane.addButton({ title: 'Restart' }).on('click', () => {
    ui.tick = 0;
    syncCursor();
    accumulator = 0;
    pane.refresh();
  });
  let switchingScript = false;
  const rebuildScrub = () => {
    const index = pane.children.indexOf(scrub);
    scrub.dispose();
    scrub = addScrub(index);
  };
  const rerun = () => {
    const wasLive = !!run.local;
    applyArena();
    run = SCRIPTS[script.name]!(tuning, local);
    ui.tick = 0;
    accumulator = 0;
    rebuildScrub();
    if (!!run.local !== wasLive) {
      // Playing yourself defaults to real time; watching defaults to slow motion and the orbit camera.
      ui.speed = run.local ? 1 : 0.5;
      if (!run.local) {
        if (document.pointerLockElement) document.exitPointerLock();
        frameOrbit();
      }
    }
  };
  pane
    .addBinding(script, 'name', { label: 'script', options: Object.fromEntries(Object.keys(SCRIPTS).map((k) => [k, k])) })
    .on('change', () => {
      if (!switchingScript) rerun();
    });
  pane.addButton({ title: 'Re-run script (live Tuning Data)' }).on('click', rerun);
  const weapons = pane.addFolder({ title: 'Weapons', expanded: true });
  const weaponOptions = Object.fromEntries(session.weaponNames().map((n) => [n, n]));
  weapons.addBinding(weaponPicks, 'red', { label: 'red', options: weaponOptions }).on('change', rerun);
  weapons.addBinding(weaponPicks, 'blue', { label: 'blue', options: weaponOptions }).on('change', rerun);
  const ai = pane.addFolder({ title: 'AI vs AI', expanded: true });
  const difficulties = Object.fromEntries(Object.keys(tuning.ai.difficulties).map((k) => [k, k]));
  /** Changing an AI setting switches to (and re-runs) the AI vs AI Match. */
  const switchTo = (name: ScriptName) => {
    script.name = name;
    switchingScript = true; // refresh() may fire the script binding's 'change'; re-run once, below
    pane.refresh();
    switchingScript = false;
    rerun();
  };
  const rerunAi = () => switchTo('AI vs AI Match');
  ai.addBinding(aiMatch, 'red', { label: 'red AI', options: difficulties }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'blue', { label: 'blue AI', options: difficulties }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'seed', { min: 1, max: 9999, step: 1 }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'bestOf', { label: 'best of', options: { 1: 1, 3: 3, 5: 5 } }).on('change', rerunAi);
  /** Changing a Player vs AI setting starts a new Player vs AI Match. */
  const vs = pane.addFolder({ title: 'Player vs AI', expanded: false });
  const rerunPlayer = () => switchTo(PLAYER_VS_AI);
  const opponents = { ...difficulties, ...Object.fromEntries(TEST_OPPONENTS.map((k) => [`${k} (test)`, k])) };
  vs.addBinding(playerMatch, 'ai', { label: 'AI', options: opponents }).on('change', rerunPlayer);
  vs.addBinding(playerMatch, 'seed', { min: 1, max: 9999, step: 1 }).on('change', rerunPlayer);
  vs.addBinding(playerMatch, 'bestOf', { label: 'best of', options: { 1: 1, 3: 3, 5: 5 } }).on('change', rerunPlayer);
  vs.addButton({ title: 'Play (new Match)' }).on('click', () => {
    rerunPlayer();
    ui.playing = true;
  });
  const help = {
    text: 'You are red. Click the view to lock the mouse, Esc frees it.\nLeft/right mouse: attack/block. Mouse: aim + Direction.\nWASD walk · Q Feint · E throw a dagger · Space pause/play (try the Runner (test) opponent).',
  };
  vs.addBinding(help, 'text', { readonly: true, label: 'controls', multiline: true, rows: 3 });

  /** The Arena Lab: generate an Arena from a seed, look it over with its jump Links, and fight or watch Hard AIs on it. */
  function addArenaLab(): void {
    const folder = pane.addFolder({ title: 'Generated Arena', expanded: true });
    const generate = () => {
      const { seed, cols, rows, levels, voidDensity, coverDensity, minOpenFloor } = lab;
      generated = labArena(seed, { cols, rows, levels, voidDensity, coverDensity, minOpenFloor }, session.tuning, lab.kit);
      labTuning = { base: session.tuning, tuning: generated.tuning };
      lab.report = describeReport(generated);
      lab.use = true;
      lab.colliders = true;
      stage.setColliders(true);
      rerun();
      if (!run.local) frameOrbit();
      pane.refresh();
    };
    folder.addBinding(lab, 'kit', { label: 'Kit', options: Object.fromEntries(Object.keys(session.tuning.kits).map((k) => [k, k])) }).on('change', generate);
    folder.addBinding(lab, 'seed', { min: 1, max: LAB_MAX_SEED, step: 1 });
    folder.addBinding(lab, 'cols', { min: 3, max: 12, step: 1 });
    folder.addBinding(lab, 'rows', { min: 3, max: 12, step: 1 });
    folder.addBinding(lab, 'levels', { min: 1, max: 3, step: 1 });
    folder.addBinding(lab, 'voidDensity', { label: 'void density', min: 0, max: 0.5, step: 0.01 });
    folder.addBinding(lab, 'coverDensity', { label: 'cover density', min: 0, max: 0.5, step: 0.01 });
    folder.addBinding(lab, 'minOpenFloor', { label: 'min open floor', min: 0, max: 1, step: 0.05 });
    folder.addButton({ title: 'Generate' }).on('click', generate);
    folder.addButton({ title: 'Reroll (seed + 1)' }).on('click', () => {
      lab.seed = Math.min(LAB_MAX_SEED, lab.seed + 1);
      generate();
    });
    folder.addButton({ title: 'Random seed' }).on('click', () => {
      // The one place outside the Simulation Math.random is allowed: picking a seed. The Arena still comes from the seed alone.
      lab.seed = 1 + Math.floor(Math.random() * LAB_MAX_SEED);
      generate();
    });
    folder.addBinding(lab, 'use', { label: 'use generated Arena' }).on('change', () => {
      rerun();
      if (!run.local) frameOrbit();
    });
    folder.addBinding(lab, 'colliders', { label: 'colliders + jump Links' }).on('change', () => stage.setColliders(lab.colliders));
    folder.addBinding(lab, 'report', { readonly: true, label: 'report', multiline: true, rows: 6 });
    /** Fight on the generated Arena (generating it first if there is none yet). */
    const onGenerated = (start: () => void) => {
      if (!generated) generate();
      lab.use = true;
      start();
      ui.playing = true;
      pane.refresh();
    };
    folder.addButton({ title: 'Play vs Hard' }).on('click', () =>
      onGenerated(() => {
        playerMatch.ai = 'Hard';
        switchTo(PLAYER_VS_AI);
      }),
    );
    folder.addButton({ title: 'Watch Hard vs Hard' }).on('click', () =>
      onGenerated(() => {
        aiMatch.red = aiMatch.blue = 'Hard';
        switchTo('AI vs AI Match');
        frameOrbit();
      }),
    );
    folder.addButton({ title: 'Save Arena JSON' }).on('click', () => {
      if (!generated) return;
      const { arena } = generated;
      // Named after the seed it was generated from (gen:greybox:<seed>), which the seed box may have moved on from.
      const file = `gen-${arena.name.split(':').pop()}.json`;
      void saveJsonFile(file, `${JSON.stringify(arena, null, 2)}
`).then(
        (result) => (lab.report = `${describeReport(generated!)}
saved ${file} (${result})`),
        (e: unknown) => console.error('Saving the Arena failed', e),
      );
    });
  }
  if (import.meta.env.DEV || devMode()) addArenaLab();
  // Re-running applies the generated Arena (if in use) to the edited Tuning Data, so an edit keeps you where you are.
  addTuningPanels(pane, session, () => {
    const tick = ui.tick;
    rerun();
    ui.tick = Math.min(tick, lastTick());
    syncCursor();
  });
  addReplayPanel(pane, {
    record: () => recordReplay(tuning, run.session.history as readonly (SimState | MatchState)[], run.intents()),
    tuning: () => tuning,
  });
  const overlays = pane.addFolder({ title: 'Overlays' });
  overlays.addBinding(ui, 'hitZones', { label: 'Hit Zones' });
  overlays.addBinding(ui, 'bladeSweep', { label: 'Blade Sweep' });
  overlays.addBinding(ui, 'actionPhase', { label: 'Action/phase' });
  const status = pane.addFolder({ title: 'State' });
  status.addBinding(ui, 'fighter0', { readonly: true, label: 'red', multiline: true, rows: 2 });
  status.addBinding(ui, 'fighter1', { readonly: true, label: 'blue', multiline: true, rows: 2 });
  status.addBinding(ui, 'match', { readonly: true, label: 'match' });
  status.addBinding(ui, 'determinism', { readonly: true, label: 'determinism' });
  status.addBinding(ui, 'events', { readonly: true, label: 'events', multiline: true, rows: 6 });

  // Space pauses/resumes (with the mouse locked to the view, the pane can't be clicked).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button'))) return;
    e.preventDefault();
    ui.playing = !ui.playing;
    accumulator = 0;
  });

  let accumulator = 0;
  let last = performance.now();
  let drawn = last;
  function frame(now: number): void {
    if (ui.playing) accumulator += Math.min((now - last) / 1000, 0.25) * ui.speed;
    audio.setSpeed(ui.speed);
    last = now;
    while (accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      if (!advance()) {
        ui.playing = false;
        accumulator = 0;
      }
    }
    if (ui.tick !== heard) {
      audio.seek(ui.tick);
      impacts.seek(ui.tick);
      heard = ui.tick;
    }
    const t = ui.tick;
    const curr = run.duel(t);
    // Interpolate toward the next Tick only when it is already computed and in the same Duel.
    const ahead = t < run.session.frontier ? run.duel(t + 1) : curr;
    let from = curr;
    let to = ahead.tick === curr.tick + 1 ? ahead : curr;
    const alpha = ui.playing ? accumulator / TICK_SECONDS : 0;
    if (run.local && to === curr && ui.playing && t > 0) {
      // Playing live at the frontier: the next Tick does not exist yet, so draw one Tick behind (like the game loop).
      const prev = run.duel(t - 1);
      if (curr.tick === prev.tick + 1) from = prev;
      to = curr;
    }

    // A live run is seen through the game's third-person camera on your Fighter; scripted runs use the orbit camera.
    input.enabled = !!run.local;
    controls.enabled = !run.local;
    if (run.local) {
      const f = to.fighters[0]!;
      const g = from.fighters[0]!;
      const l = (u: number, v: number) => u + (v - u) * alpha;
      const at = { x: l(g.position.x, f.position.x), y: l(g.y, f.y), z: l(g.position.z, f.position.z) };
      placeThirdPersonCamera(stage.camera, session.tuning.camera, at, run.local.yaw, run.local.pitch, stage.collider);
    } else controls.update();

    curr.fighters.forEach((f, i) => {
      views[i]!.update(drawnPose(from, to, i, alpha, tuning), weaponByName(tuning, f.weapon));
      // A fallen Fighter has no Hit Zones left to show: its body is the Death Ragdoll.
      zones[i]!.root.visible = ui.hitZones && !f.death;
      if (ui.hitZones && !f.death) zones[i]!.update(hitZoneCapsules(fighterPose(f, tuning), tuning));
      trails[i]!.root.visible = ui.bladeSweep;
      if (ui.bladeSweep) {
        // The trail stays within the current Duel (a new Duel restarts its Tick at 0).
        const first = Math.max(0, t - TRAIL_TICKS, t - curr.tick);
        const blades: BladeTransform[] = [];
        for (let k = first; k <= t; k++) blades.push(run.duel(k).fighters[i]!.blade);
        trails[i]!.set(blades, (k) => first + k > t - curr.tick && sweepLive(run, i, first + k));
      }
    });

    const hp = (i: number) => curr.fighters[i]!.hp.toFixed(1);
    labels.update(curr, ui.actionPhase);
    const d = run.session.divergence;
    ui.determinism = d === null ? 'ok (resume re-simulates and matches)' : `DIVERGED at Tick ${d}`;
    const m = run.match?.(t);
    ui.match = m ? describeMatch(m, !!run.local) : '(scripted Duel)';
    if (run.local) ui.match += ` · recorded to Tick ${run.session.frontier}`;
    ui.fighter0 = `HP ${hp(0)}\n${describeAction(curr.fighters[0]!.action)}`;
    ui.fighter1 = `HP ${hp(1)}\n${describeAction(curr.fighters[1]!.action)}`;
    const recent = run.session.recentEvents(t, 6);
    ui.events = recent
      .map((e) => {
        if (e.type === 'Hit') return `${e.tick} Hit ${e.attacker}→${e.defender} ${e.zone} ${e.bladeSpeed.toFixed(1)} m/s −${e.damage.toFixed(1)}`;
        if (e.type === 'AttackPhase') return `${e.tick} F${e.fighter} ${e.phase}`;
        if (e.type === 'KickPhase') return `${e.tick} F${e.fighter} Kick ${e.phase}`;
        if (e.type === 'KnockdownPhase') return `${e.tick} F${e.fighter} Knockdown ${e.phase}`;
        if (e.type === 'Death') return `${e.tick} F${e.fighter} falls (${e.cause})`;
        if (e.type === 'KickLanded') return `${e.tick} Kick ${e.attacker}→${e.defender} ${e.outcome} ${e.zone} −${e.damage.toFixed(1)}`;
        if (e.type === 'Block') return `${e.tick} Block ${e.defender} stops ${e.attacker} (${e.direction})`;
        if (e.type === 'WallStrike') return `${e.tick} F${e.attacker}'s ${e.direction} strikes a wall`;
        if (e.type === 'Stagger') return `${e.tick} F${e.fighter} Stagger (${e.cause})`;
        if (e.type === 'Chamber') return `${e.tick} Chamber: F${e.chamberer} cancels F${e.attacker} (${e.direction})`;
        if (e.type === 'Feint') return `${e.tick} F${e.fighter} Feint ${e.from} → ${e.into.kind} ${e.into.direction}`;
        if (e.type === 'Jump') return `${e.tick} F${e.fighter} Jump`;
        if (e.type === 'DaggerThrown') return `${e.tick} F${e.thrower} throws a dagger`;
        if (e.type === 'DaggerStuck') return `${e.tick} dagger sticks at (${e.point.x.toFixed(1)}, ${e.point.y.toFixed(1)}, ${e.point.z.toFixed(1)})`;
        if (e.type === 'DaggerHit') return `${e.tick} dagger ${e.thrower}→${e.defender} ${e.zone} −${e.damage.toFixed(1)}`;
        if (e.type === 'DaggerBlocked') return `${e.tick} Block ${e.defender} stops F${e.thrower}'s dagger`;
        if (e.type === 'Land') return `${e.tick} F${e.fighter} Land ${e.height.toFixed(2)} m${e.damage > 0 ? ` −${e.damage.toFixed(1)}` : ''}`;
        if (e.type === 'Sheathed') return `${e.tick} F${e.fighter} Sheathed`;
        if (e.type === 'Drawn') return `${e.tick} F${e.fighter} Drawn`;
        return `${e.tick} Duel over: ${e.winner === null ? 'draw' : `F${e.winner} wins`}`;
      })
      .join('\n');
    let lastHit: HitEvent | undefined;
    for (let k = t; k >= 0 && k > t - 40 && !lastHit; k--) lastHit = run.duel(k).events.find((e): e is HitEvent => e.type === 'Hit');
    hitMarker.visible = !!lastHit;
    if (lastHit) hitMarker.position.set(lastHit.point.x, lastHit.point.y, lastHit.point.z);

    if (scrubMax() !== scrubBuiltMax) rebuildScrub(); // a live run outgrew (or a branch shrank) the slider
    pane.refresh();
    impacts.update(ui.playing ? ((now - drawn) / 1000) * ui.speed : 0);
    drawn = now;
    stage.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
