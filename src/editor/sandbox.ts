/**
 * The Editor's Duel sandbox (/sword/#/editor/sandbox): a scripted two-Fighter
 * Duel run through the real Simulation, with play/pause, step-one-Tick,
 * scrubbing, slow motion and overlays (Hit Zones, Blade Sweep, Action/phase).
 * A dropdown picks the script (`SCRIPTS`): the Exchange (attacks, Blocks, Trade),
 * Movement, or an AI vs AI Match (two AI Controllers, difficulty per Fighter
 * and seed in the "AI vs AI" folder).
 *
 * The run is stepped through a `SandboxSession` (sandboxSession.ts), which
 * keeps every Tick as a snapshot plus the Controllers' memory. Scripts are
 * computed up front so the scrub slider has a fixed range; scrubbing picks a
 * stored Tick, and resuming from there re-simulates (Controllers restored) and
 * checks each Tick against the stored one, shown as "determinism" in State.
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
  wait,
  walk,
  type Direction,
  type BladeTransform,
  type HitCapsule,
  type HitEvent,
  type MatchState,
  type SimState,
  type Track,
} from '../sim';
import type { HitZone, TuningData } from '../tuning';
import { FIGHTER_COLOURS, FighterView, lerpPose } from '../render/fighterView';
import { Stage } from '../render/stage';
import { BladeSweepTrail } from './trail';
import { createBrowserAudio } from '../audio';
import { createAiController, scriptedController, type Controller } from '../controllers';
import { createSandboxSession, duelSandbox, matchSandbox, type Sandbox, type SandboxSession } from './sandboxSession';
import { ActionLabels, describeAction } from './actionLabels';

/** What the sandbox plays: a session to scrub through, the Duel at each Tick, plus the Match around it for an AI vs AI run. */
interface SandboxRun {
  readonly session: SandboxSession<unknown>;
  /** Playback stops at this Tick (the precomputed length). */
  readonly ticks: number;
  readonly duel: (tick: number) => SimState;
  readonly match?: (tick: number) => MatchState;
}

/**
 * Step a run up front (until `ticks` or its end) and rewind it to Tick 0.
 * A Player vs AI run (#16) would skip the precompute and let playback extend the frontier.
 */
function precompute<S>(sandbox: Sandbox<S>, initial: S, controllers: readonly Controller[], ticks: number): SandboxRun {
  const session = createSandboxSession(sandbox, initial, controllers);
  while (!session.over && session.frontier < ticks) session.advance();
  session.seek(0);
  return { session, ticks: session.frontier, duel: (t) => sandbox.duel(session.history[t]!) };
}

/** Two scripted Tracks facing each other `distance` apart (like `runDuel`, but through a session). */
function scripted(tuning: TuningData, distance: number, a: Track, b: Track, ticks: number): SandboxRun {
  const initial = createInitialState(tuning, 1, duelPlacements(distance));
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
  const start = createMatch(tuning, { bestOf: aiMatch.bestOf, seed: aiMatch.seed });
  const run = precompute(matchSandbox(tuning), start, controllers, AI_MATCH_MAX_TICKS);
  return { ...run, match: (t) => run.session.history[t] as MatchState };
}

const SCRIPTS: Record<string, (tuning: TuningData) => SandboxRun> = {
  Exchange: scriptedDuel,
  Movement: movementDuel,
  'AI vs AI Match': aiVsAiMatch,
};
type ScriptName = keyof typeof SCRIPTS;

function describeMatch(m: MatchState): string {
  const score = `score ${m.score.join('–')}`;
  if (m.status.status === 'Over') return `Match over: ${m.status.winner === 0 ? 'red' : 'blue'} wins · ${score}`;
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

export function startSandbox(container: HTMLElement, tuning: TuningData): void {
  const stage = new Stage(container, tuning);
  stage.camera.position.set(3.6, 2.2, 0);
  const controls = new OrbitControls(stage.camera, stage.canvas);
  controls.target.set(0, 1.1, 0);
  controls.update();

  const script: { name: ScriptName } = { name: 'Exchange' };
  let run: SandboxRun = SCRIPTS[script.name]!(tuning);
  const lastTick = () => run.ticks;

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
  pane.element.parentElement!.style.width = '360px';
  pane.addButton({ title: '← Motion Editor' }).on('click', () => (location.hash = '#/editor'));
  /** Move the session's cursor to the Tick shown in the UI (after a scrub). */
  const syncCursor = () => {
    const t = Math.max(0, Math.min(ui.tick, run.session.frontier));
    if (t !== run.session.cursor) run.session.seek(t);
    ui.tick = t;
  };
  /** Play one Tick from the cursor: re-simulated through the session (Controllers restored after a scrub). */
  const advance = (): boolean => {
    syncCursor();
    if (run.session.over || run.session.cursor >= lastTick()) return false;
    run.session.advance();
    ui.tick = run.session.cursor;
    hear(ui.tick);
    return true;
  };
  pane.addBinding(ui, 'playing');
  // Sounds play for Ticks reached by playing or stepping; scrubbing and restarting are silent.
  const audio = createBrowserAudio();
  let heard = ui.tick;
  const hear = (t: number) => {
    audio.onTick(t, run.duel(t).events);
    heard = t;
  };
  pane.addBinding(audio, 'muted', { label: 'mute sound' });
  pane.addBinding(ui, 'speed', { min: 0.05, max: 2, step: 0.05, label: 'speed (slow-mo)' });
  /** The scrub slider's range is fixed at creation, so it is rebuilt in place when the script length changes. */
  const addScrub = (index?: number) => {
    const b = pane.addBinding(ui, 'tick', { min: 0, max: lastTick(), step: 1, label: 'Tick (scrub)', index });
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
  const rerun = () => {
    run = SCRIPTS[script.name]!(tuning);
    ui.tick = 0;
    accumulator = 0;
    const index = pane.children.indexOf(scrub);
    scrub.dispose();
    scrub = addScrub(index);
  };
  pane
    .addBinding(script, 'name', { label: 'script', options: Object.fromEntries(Object.keys(SCRIPTS).map((k) => [k, k])) })
    .on('change', () => {
      if (!switchingScript) rerun();
    });
  pane.addButton({ title: 'Re-run script (live Tuning Data)' }).on('click', rerun);
  const ai = pane.addFolder({ title: 'AI vs AI', expanded: true });
  const difficulties = Object.fromEntries(Object.keys(tuning.ai.difficulties).map((k) => [k, k]));
  /** Changing an AI setting switches to (and re-runs) the AI vs AI Match. */
  const rerunAi = () => {
    script.name = 'AI vs AI Match';
    switchingScript = true; // refresh() may fire the script binding's 'change'; re-run once, below
    pane.refresh();
    switchingScript = false;
    rerun();
  };
  ai.addBinding(aiMatch, 'red', { label: 'red AI', options: difficulties }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'blue', { label: 'blue AI', options: difficulties }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'seed', { min: 1, max: 9999, step: 1 }).on('change', rerunAi);
  ai.addBinding(aiMatch, 'bestOf', { label: 'best of', options: { 1: 1, 3: 3, 5: 5 } }).on('change', rerunAi);
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

  let accumulator = 0;
  let last = performance.now();
  function frame(now: number): void {
    if (ui.playing) accumulator += Math.min((now - last) / 1000, 0.25) * ui.speed;
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
      heard = ui.tick;
    }
    const t = ui.tick;
    const curr = run.duel(t);
    // Interpolate toward the next Tick only when it is already computed and in the same Duel.
    const ahead = t < run.session.frontier ? run.duel(t + 1) : curr;
    const next = ahead.tick === curr.tick + 1 ? ahead : curr;
    const alpha = ui.playing ? accumulator / TICK_SECONDS : 0;

    curr.fighters.forEach((f, i) => {
      views[i]!.update(lerpPose(fighterPose(f, tuning), fighterPose(next.fighters[i]!, tuning), alpha));
      zones[i]!.root.visible = ui.hitZones;
      if (ui.hitZones) zones[i]!.update(hitZoneCapsules(fighterPose(f, tuning), tuning));
      trails[i]!.root.visible = ui.bladeSweep;
      if (ui.bladeSweep) {
        // The trail stays within the current Duel (a new Duel restarts its Tick at 0).
        const from = Math.max(0, t - TRAIL_TICKS, t - curr.tick);
        const blades: BladeTransform[] = [];
        for (let k = from; k <= t; k++) blades.push(run.duel(k).fighters[i]!.blade);
        trails[i]!.set(blades, (k) => from + k > t - curr.tick && sweepLive(run, i, from + k));
      }
    });

    const hp = (i: number) => curr.fighters[i]!.hp.toFixed(1);
    labels.update(curr, ui.actionPhase);
    const d = run.session.divergence;
    ui.determinism = d === null ? 'ok (resume re-simulates and matches)' : `DIVERGED at Tick ${d}`;
    const m = run.match?.(t);
    ui.match = m ? describeMatch(m) : '(scripted Duel)';
    ui.fighter0 = `HP ${hp(0)}\n${describeAction(curr.fighters[0]!.action)}`;
    ui.fighter1 = `HP ${hp(1)}\n${describeAction(curr.fighters[1]!.action)}`;
    const recent = run.session.recentEvents(t, 6);
    ui.events = recent
      .map((e) => {
        if (e.type === 'Hit') return `${e.tick} Hit ${e.attacker}→${e.defender} ${e.zone} ${e.bladeSpeed.toFixed(1)} m/s −${e.damage.toFixed(1)}`;
        if (e.type === 'AttackPhase') return `${e.tick} F${e.fighter} ${e.phase}`;
        if (e.type === 'Block') return `${e.tick} Block ${e.defender} stops ${e.attacker} (${e.direction})`;
        if (e.type === 'Stagger') return `${e.tick} F${e.fighter} Stagger (${e.cause})`;
        if (e.type === 'Chamber') return `${e.tick} Chamber: F${e.chamberer} cancels F${e.attacker} (${e.direction})`;
        if (e.type === 'Feint') return `${e.tick} F${e.fighter} Feint ${e.from} → ${e.into.kind} ${e.into.direction}`;
        return `${e.tick} Duel over: ${e.winner === null ? 'draw' : `F${e.winner} wins`}`;
      })
      .join('\n');
    let lastHit: HitEvent | undefined;
    for (let k = t; k >= 0 && k > t - 40 && !lastHit; k--) lastHit = run.duel(k).events.find((e): e is HitEvent => e.type === 'Hit');
    hitMarker.visible = !!lastHit;
    if (lastHit) hitMarker.position.set(lastHit.point.x, lastHit.point.y, lastHit.point.z);

    pane.refresh();
    controls.update();
    stage.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
