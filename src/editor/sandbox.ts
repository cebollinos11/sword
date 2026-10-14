/**
 * The Editor's Duel sandbox (/sword/#/editor/sandbox): a scripted two-Fighter
 * Duel run through the real Simulation, with play/pause, step-one-Tick,
 * scrubbing, slow motion and overlays (Hit Zones, Blade Sweep, Action/phase).
 *
 * The whole Duel is simulated up front (it is deterministic), so scrubbing is
 * just picking a stored state. Later tickets can swap the script for AI
 * Controllers.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import {
  attack,
  fighterPose,
  hitZoneCapsules,
  hold,
  runDuel,
  TICK_SECONDS,
  wait,
  type Action,
  type Direction,
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

  let run = scriptedDuel(tuning);
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
  const scrub = pane.addBinding(ui, 'tick', { min: 0, max: lastTick(), step: 1, label: 'Tick (scrub)' });
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
  pane.addButton({ title: 'Re-run script (live Tuning Data)' }).on('click', () => {
    run = scriptedDuel(tuning);
    ui.tick = 0;
  });
  const overlays = pane.addFolder({ title: 'Overlays' });
  overlays.addBinding(ui, 'hitZones', { label: 'Hit Zones' });
  overlays.addBinding(ui, 'bladeSweep', { label: 'Blade Sweep' });
  const status = pane.addFolder({ title: 'State' });
  status.addBinding(ui, 'fighter0', { readonly: true, label: 'red', multiline: true, rows: 2 });
  status.addBinding(ui, 'fighter1', { readonly: true, label: 'blue', multiline: true, rows: 2 });
  status.addBinding(ui, 'events', { readonly: true, label: 'events', multiline: true, rows: 6 });
  scrub.on('change', () => (accumulator = 0));

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
