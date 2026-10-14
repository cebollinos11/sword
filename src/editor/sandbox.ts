/**
 * The Editor's Duel sandbox (/sword/#/editor/sandbox): a scripted two-Fighter
 * Duel run through the real Simulation, with play/pause, step-one-Tick,
 * scrubbing, slow motion and overlays (Hit Zones, Blade Sweep, Action/phase).
 * A dropdown picks the script (`SCRIPTS`): the Exchange (attacks, Blocks, Trade),
 * Movement, or an AI vs AI Match (two AI Controllers, difficulty per Fighter
 * and seed in the "AI vs AI" folder).
 *
 * The whole run is simulated up front (it is deterministic), so scrubbing is
 * just picking a stored state.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import {
  attack,
  createMatch,
  fighterPose,
  hitZoneCapsules,
  hold,
  runDuel,
  TICK_SECONDS,
  wait,
  walk,
  type Action,
  type Direction,
  type BladeTransform,
  type HitCapsule,
  type MatchState,
  type ScriptRun,
  type SimState,
  type Track,
} from '../sim';
import type { HitZone, TuningData } from '../tuning';
import { FIGHTER_COLOURS, FighterView, lerpPose } from '../render/fighterView';
import { Stage } from '../render/stage';
import { BladeSweepTrail } from './trail';
import { createAiController, runMatch } from '../controllers';

/** What the sandbox plays: Duel states to scrub through, plus the Match around them for an AI vs AI run. */
type SandboxRun = ScriptRun & { readonly matches?: readonly MatchState[] };

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
function scriptedDuel(tuning: TuningData): ScriptRun {
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
  return runDuel(tuning, { distance: 1.3, a, b, ticks: 660 });
}

/**
 * Movement and collision: both Fighters walk in and collide, Fighter 0 shoves Fighter 1 back,
 * backs off, both strafe, Fighter 0 steps into an Overhead (more Blade Speed than standing),
 * then Fighter 1 retreats to the Arena edge and Fighter 0 pins it there.
 */
function movementDuel(tuning: TuningData): ScriptRun {
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
  return runDuel(tuning, { distance: 3, a, b, ticks: 600 });
}

/**
 * AI vs AI: a best-of-N Match between two AI Controllers. The Duel states of
 * every Match Tick are laid end to end (each new Duel restarts its own Tick), and
 * events are tagged with the Match Tick, which is also the scrub index.
 */
function aiVsAiMatch(tuning: TuningData): SandboxRun {
  const controllers = [createAiController(tuning, aiMatch.red), createAiController(tuning, aiMatch.blue)];
  const { matches } = runMatch(tuning, createMatch(tuning, { bestOf: aiMatch.bestOf, seed: aiMatch.seed }), controllers, AI_MATCH_MAX_TICKS);
  const states = matches.map((m) => m.duel);
  const events = matches.flatMap((m) => m.duel.events.map((e) => ({ ...e, tick: m.tick })));
  return { states, final: states[states.length - 1]!, events, matches };
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

function describeAction(a: Action): string {
  switch (a.kind) {
    case 'Attack':
      return `Attack ${a.direction} · ${a.phase}`;
    case 'Block':
      return `Block ${a.direction}`;
    case 'Stagger':
      return `Stagger (${a.cause})`;
    case 'Idle':
      return a.kind;
  }
}

/** Is the Blade Sweep from Tick t-1 to Tick t live? (Release, entering or leaving it.) */
function sweepLive(states: readonly SimState[], fighter: number, t: number): boolean {
  const prev = states[t - 1]?.fighters[fighter]?.action;
  const curr = states[t]?.fighters[fighter]?.action;
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
  const lastTick = () => run.states.length - 1;

  const views = [0, 1].map((i) => new FighterView(FIGHTER_COLOURS[i]!, tuning));
  const trails = [0, 1].map(() => new BladeSweepTrail());
  const zones = [0, 1].map(() => new HitZoneOverlay());
  const hitMarker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
  stage.scene.add(...views.map((v) => v.root), ...trails.map((t) => t.root), ...zones.map((z) => z.root), hitMarker);

  const ui = {
    playing: true,
    speed: 0.5,
    tick: 0,
    hitZones: true,
    bladeSweep: true,
    fighter0: '',
    fighter1: '',
    match: '',
    events: '',
  };
  const pane = new Pane({ title: 'Duel sandbox' });
  pane.element.parentElement!.style.width = '360px';
  pane.addButton({ title: '← Motion Editor' }).on('click', () => (location.hash = '#/editor'));
  pane.addBinding(ui, 'playing');
  pane.addBinding(ui, 'speed', { min: 0.05, max: 2, step: 0.05, label: 'speed (slow-mo)' });
  /** The scrub slider's range is fixed at creation, so it is rebuilt in place when the script length changes. */
  const addScrub = (index?: number) => {
    const b = pane.addBinding(ui, 'tick', { min: 0, max: lastTick(), step: 1, label: 'Tick (scrub)', index });
    b.on('change', () => (accumulator = 0));
    return b;
  };
  let scrub = addScrub();
  pane.addButton({ title: 'Step one Tick' }).on('click', () => {
    ui.playing = false;
    ui.tick = Math.min(lastTick(), ui.tick + 1);
    accumulator = 0;
    pane.refresh();
  });
  pane.addButton({ title: 'Restart' }).on('click', () => {
    ui.tick = 0;
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
  const status = pane.addFolder({ title: 'State' });
  status.addBinding(ui, 'fighter0', { readonly: true, label: 'red', multiline: true, rows: 2 });
  status.addBinding(ui, 'fighter1', { readonly: true, label: 'blue', multiline: true, rows: 2 });
  status.addBinding(ui, 'match', { readonly: true, label: 'match' });
  status.addBinding(ui, 'events', { readonly: true, label: 'events', multiline: true, rows: 6 });

  let accumulator = 0;
  let last = performance.now();
  function frame(now: number): void {
    if (ui.playing) accumulator += Math.min((now - last) / 1000, 0.25) * ui.speed;
    last = now;
    while (accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      if (ui.tick < lastTick()) ui.tick++;
      else ui.playing = false;
    }
    const t = ui.tick;
    const curr = run.states[t]!;
    const next = run.states[Math.min(t + 1, lastTick())]!;
    const alpha = ui.playing ? accumulator / TICK_SECONDS : 0;

    curr.fighters.forEach((f, i) => {
      views[i]!.update(lerpPose(fighterPose(f, tuning), fighterPose(next.fighters[i]!, tuning), alpha));
      zones[i]!.root.visible = ui.hitZones;
      if (ui.hitZones) zones[i]!.update(hitZoneCapsules(fighterPose(f, tuning), tuning));
      trails[i]!.root.visible = ui.bladeSweep;
      if (ui.bladeSweep) {
        const from = Math.max(0, t - TRAIL_TICKS);
        const blades: BladeTransform[] = run.states.slice(from, t + 1).map((s) => s.fighters[i]!.blade);
        trails[i]!.set(blades, (k) => sweepLive(run.states, i, from + k));
      }
    });

    const hp = (i: number) => curr.fighters[i]!.hp.toFixed(1);
    const m = run.matches?.[t];
    ui.match = m ? describeMatch(m) : '(scripted Duel)';
    ui.fighter0 = `HP ${hp(0)}\n${describeAction(curr.fighters[0]!.action)}`;
    ui.fighter1 = `HP ${hp(1)}\n${describeAction(curr.fighters[1]!.action)}`;
    const recent = run.events.filter((e) => e.tick <= t).slice(-6);
    ui.events = recent
      .map((e) => {
        if (e.type === 'Hit') return `${e.tick} Hit ${e.attacker}→${e.defender} ${e.zone} ${e.bladeSpeed.toFixed(1)} m/s −${e.damage.toFixed(1)}`;
        if (e.type === 'AttackPhase') return `${e.tick} F${e.fighter} ${e.phase}`;
        if (e.type === 'Block') return `${e.tick} Block ${e.defender} stops ${e.attacker} (${e.direction})`;
        if (e.type === 'Stagger') return `${e.tick} F${e.fighter} Stagger (${e.cause})`;
        return `${e.tick} Duel over: ${e.winner === null ? 'draw' : `F${e.winner} wins`}`;
      })
      .join('\n');
    const lastHit = [...run.events].reverse().find((e) => e.type === 'Hit' && e.tick <= t);
    hitMarker.visible = !!lastHit && t - lastHit.tick < 40;
    if (lastHit && lastHit.type === 'Hit') hitMarker.position.set(lastHit.point.x, lastHit.point.y, lastHit.point.z);

    pane.refresh();
    controls.update();
    stage.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
