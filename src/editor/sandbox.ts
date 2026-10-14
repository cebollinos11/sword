/**
 * The Editor's Duel sandbox (/sword/#/editor/sandbox): a scripted two-Fighter
 * Duel run through the real Simulation, with play/pause, step-one-Tick,
 * scrubbing, slow motion and overlays (Hit Zones, Blade Sweep, Action/phase).
 * A dropdown picks the script (`SCRIPTS`): the attack Exchange or Movement.
 *
 * The whole Duel is simulated up front (it is deterministic), so scrubbing is
 * just picking a stored state. Later tickets can swap the script for AI
 * Controllers and add Blocks to the overlays.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import {
  attack,
  fighterPose,
  hitZoneCapsules,
  runDuel,
  TICK_SECONDS,
  wait,
  walk,
  type Action,
  type BladeTransform,
  type HitCapsule,
  type ScriptRun,
  type SimState,
  type Track,
} from '../sim';
import type { HitZone, TuningData } from '../tuning';
import { FIGHTER_COLOURS, FighterView, lerpPose } from '../render/fighterView';
import { Stage } from '../render/stage';
import { BladeSweepTrail } from './trail';

/**
 * The scripted Duel: Fighter 0 attacks in every Direction (Right, a held Overhead, Thrust, Left),
 * Fighter 1 steps in and swings back for a same-Tick Trade at Tick 164; Fighter 0 wins at
 * Tick 337 with today's Tuning Data. Held Wind-up poses: Right ~41, Overhead 122-150,
 * Thrust ~252, Left ~328.
 */
function scriptedDuel(tuning: TuningData): ScriptRun {
  const a: Track = [
    ...wait(20),
    ...attack('Right'),
    ...wait(80),
    ...attack('Overhead', 50),
    ...wait(80),
    ...(['Thrust', 'Left', 'Right', 'Overhead', 'Thrust', 'Left'] as const).flatMap((d) => [...attack(d), ...wait(75)]),
  ];
  const b: Track = [...wait(60), ...walk(10, { x: 0, z: -1 }), ...wait(60), ...attack('Overhead'), ...wait(200)];
  return runDuel(tuning, { distance: 1.5, a, b, ticks: 480 });
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

const SCRIPTS = { Exchange: scriptedDuel, Movement: movementDuel } as const;
type ScriptName = keyof typeof SCRIPTS;

const TRAIL_TICKS = 45;
const ZONE_COLOURS: Record<HitZone, number> = { head: 0xffd60a, torso: 0x30d158, limbs: 0x64d2ff };

const describeAction = (a: Action): string => (a.kind === 'Attack' ? `Attack ${a.direction} · ${a.phase}` : a.kind);

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
  let run = SCRIPTS[script.name](tuning);
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
    events: '',
  };
  const pane = new Pane({ title: 'Duel sandbox (scripted)' });
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
  const rerun = () => {
    run = SCRIPTS[script.name](tuning);
    ui.tick = 0;
    accumulator = 0;
    const index = pane.children.indexOf(scrub);
    scrub.dispose();
    scrub = addScrub(index);
  };
  pane
    .addBinding(script, 'name', { label: 'script', options: Object.fromEntries(Object.keys(SCRIPTS).map((k) => [k, k])) })
    .on('change', rerun);
  pane.addButton({ title: 'Re-run script (live Tuning Data)' }).on('click', rerun);
  const overlays = pane.addFolder({ title: 'Overlays' });
  overlays.addBinding(ui, 'hitZones', { label: 'Hit Zones' });
  overlays.addBinding(ui, 'bladeSweep', { label: 'Blade Sweep' });
  const status = pane.addFolder({ title: 'State' });
  status.addBinding(ui, 'fighter0', { readonly: true, label: 'red', multiline: true, rows: 2 });
  status.addBinding(ui, 'fighter1', { readonly: true, label: 'blue', multiline: true, rows: 2 });
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
    ui.fighter0 = `HP ${hp(0)}\n${describeAction(curr.fighters[0]!.action)}`;
    ui.fighter1 = `HP ${hp(1)}\n${describeAction(curr.fighters[1]!.action)}`;
    const recent = run.events.filter((e) => e.tick <= t).slice(-6);
    ui.events = recent
      .map((e) => {
        if (e.type === 'Hit') return `${e.tick} Hit ${e.attacker}→${e.defender} ${e.zone} ${e.bladeSpeed.toFixed(1)} m/s −${e.damage.toFixed(1)}`;
        if (e.type === 'AttackPhase') return `${e.tick} F${e.fighter} ${e.phase}`;
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
