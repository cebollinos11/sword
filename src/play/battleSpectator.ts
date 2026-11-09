/**
 * Watching a Battle (docs/plans/big-battle.md, Stage 2): an AI-vs-AI war (no Fighters) stepped through `stepMatch` in
 * real time and drawn as it will be played: the Battlefield's terrain under the sky, every Soldier an impostor
 * (`CrowdView`). A spectator camera orbits the fighting: it follows the battle's centre (`battleFocus`) and circles it
 * slowly, until the mouse takes it (drag to orbit, right-drag to pan, wheel to zoom; Follow hands it back). A panel shows
 * each army's strength, the Rout and the winner, the speed, and the frame's cost. Dev only for now (`#/battle/<seed>?dev=1`,
 * from the title screen with `?dev=1`); Stage 5 puts the Battle in the Skirmish Lobby. Render only: nothing here feeds the Simulation.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { battlefieldHeight, battlefieldOf, createMatch, crowdAlive, stepMatch, TICK_SECONDS, type CrowdState, type Heightfield, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { blobTexture } from '../render/blobShadow';
import { CrowdView } from '../render/crowdView';
import { bakeImpostorAtlases } from '../render/impostorAtlas';
import { Stage } from '../render/stage';

const SPEEDS = [0, 1, 2, 4];
/** Ticks stepped at most per frame, so a slow frame never spirals. */
const MAX_TICKS_PER_FRAME = 30;
/** How fast (per second) the camera's aim eases toward the battle's centre while following. */
const FOLLOW_RATE = 1.5;
/** The camera keeps at least this far (m) above the ground under it. */
const CAMERA_CLEARANCE = 2;
/** Frames before the frame cost is measured (the atlas bake and first draws are over), and how many it is averaged over on the panel. */
const WARMUP_FRAMES = 120;
const PANEL_FRAMES = 60;

/**
 * Where the spectator camera looks: the middle of the fighting (the engaged living Soldiers), or of every living
 * Soldier while none is engaged, on the ground. Null once none is left.
 */
export function battleFocus(crowd: CrowdState, out: { x: number; z: number }): { x: number; z: number } | null {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const engagedOnly of [true, false]) {
    for (let i = 0; i < crowd.x.length; i++) {
      if (!crowd.alive[i] || (engagedOnly && crowd.target[i]! < 0)) continue;
      x += crowd.x[i]!;
      z += crowd.z[i]!;
      n++;
    }
    if (n > 0) break;
  }
  if (n === 0) return null;
  out.x = x / n;
  out.z = z / n;
  return out;
}

/** Mean and 99th percentile of a list of ms. */
function stats(ms: readonly number[]): { mean: number; p99: number } {
  if (ms.length === 0) return { mean: 0, p99: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return { mean: ms.reduce((s, v) => s + v, 0) / ms.length, p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! };
}

export async function startBattleSpectator(container: HTMLElement, tuning: TuningData): Promise<void> {
  container.style.position = 'relative';
  const stage = new Stage(container, tuning);
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;padding:8px 10px;background:rgba(15,15,20,.8);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10';
  const controls = document.createElement('div');
  const seedBox = document.createElement('input');
  seedBox.type = 'number';
  seedBox.style.width = '6em';
  const button = (label: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.marginLeft = '4px';
    return b;
  };
  const restart = button('Restart');
  const speedButton = button('');
  const follow = button('Follow');
  const quit = button('Quit');
  const status = document.createElement('pre');
  status.style.margin = '6px 0 0';
  controls.append('seed ', seedBox, restart, speedButton, follow, quit);
  panel.append(controls, status);
  container.appendChild(panel);
  status.textContent = 'baking the soldier…';

  const baking = performance.now();
  const atlas = await bakeImpostorAtlases(stage.renderer, tuning);
  const first = atlas.atlases[0]!;
  console.info(`Impostor atlases: ${atlas.atlases.length} of ${first.layout.width}×${first.layout.height} px, baked in ${(performance.now() - baking).toFixed(0)} ms (with their Body models' load)`);
  const view = new CrowdView(atlas, tuning.battle, blobTexture());
  stage.scene.add(view.root);

  const orbit = new OrbitControls(stage.camera, stage.canvas);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.47;
  orbit.minDistance = 6;
  orbit.maxDistance = 220;
  orbit.autoRotateSpeed = 0.4;
  let following = true;
  orbit.addEventListener('start', () => {
    following = false;
    orbit.autoRotate = false;
  });
  follow.onclick = () => {
    following = true;
    orbit.autoRotate = true;
  };
  orbit.autoRotate = true;

  let match: MatchState;
  let hf: Heightfield;
  let speed = 1;
  let carry = 0;
  const showSpeed = () => (speedButton.textContent = SPEEDS[speed] === 0 ? 'paused' : `${SPEEDS[speed]}×`);
  speedButton.onclick = () => {
    speed = (speed + 1) % SPEEDS.length;
    showSpeed();
  };
  showSpeed();
  quit.onclick = () => {
    // Back to the title screen (a hash change reloads the page, main.ts).
    location.hash = '';
  };

  const start = (seed: number) => {
    match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed });
    hf = battlefieldOf(tuning.battle, match.arena)!.heights;
    stage.setArena(match.arena);
    seedBox.value = String(seed);
    carry = 0;
    // From behind Team 0's army, looking across at Team 1's.
    orbit.target.set(0, battlefieldHeight(hf, 0, 0), 0);
    stage.camera.position.set(-35, 30, -90);
    orbit.update();
    history.replaceState(null, '', `#/battle/${seed}${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`);
  };
  restart.onclick = () => start(Math.max(0, Math.floor(Number(seedBox.value) || 0)));
  const fromHash = Number(location.hash.split(/[/?]/)[2]);
  start(Number.isInteger(fromHash) && fromHash >= 0 ? fromHash : 1);

  const focus = { x: 0, z: 0 };
  const cpu: number[] = [];
  const sim: number[] = [];
  const intervals: number[] = [];
  let frames = 0;
  let last = performance.now();
  let calls = 0;
  const report = () => {
    const recent = (list: number[]) => stats(list.slice(-PANEL_FRAMES));
    return { cpu: stats(cpu), sim: stats(sim), interval: stats(intervals), recentCpu: recent(cpu), recentInterval: recent(intervals), frames: cpu.length, calls };
  };
  // For reading the measurements from the console (dev only).
  (window as unknown as { battleStats: () => ReturnType<typeof report> }).battleStats = report;
  // For checking a moment of the war without waiting for it (dev only): step on to `seconds` of Battle time at once.
  // Returns the Tick reached and where the fighting is.
  (window as unknown as { battleSeek: (seconds: number) => unknown }).battleSeek = (seconds) => {
    while (match.duel.tick * TICK_SECONDS < seconds && match.status.status === 'InProgress') match = stepMatch(match, [], tuning);
    const crowd = match.duel.crowd!;
    const meanZ = [0, 1].map((t) => {
      const zs = crowd.z.filter((_, i) => crowd.alive[i] && crowd.team[i] === t);
      return zs.reduce((s, z) => s + z, 0) / (zs.length || 1);
    });
    return { tick: match.duel.tick, focus: battleFocus(crowd, { x: 0, z: 0 }), meanZ };
  };
  // Likewise, for measuring where frames are not being drawn (a hidden page): `frames` frames one after another, each a
  // Tick on, the impostors updated and the scene drawn: the CPU's ms, and the ms until the GPU has finished drawing too.
  (window as unknown as { battleBench: (frames: number) => unknown }).battleBench = (count) => {
    const gl = stage.renderer.getContext();
    const cpuMs: number[] = [];
    const doneMs: number[] = [];
    const updateMs: number[] = [];
    for (let k = 0; k < count && match.status.status === 'InProgress'; k++) {
      match = stepMatch(match, [], tuning);
      const t0 = performance.now();
      view.update(match.duel.crowd!, match.duel.tick, 0.5, hf, stage.camera);
      updateMs.push(performance.now() - t0);
      stage.draw();
      const t1 = performance.now();
      gl.finish();
      cpuMs.push(t1 - t0);
      doneMs.push(performance.now() - t0);
    }
    return { cpu: stats(cpuMs), update: stats(updateMs), finished: stats(doneMs), frames: cpuMs.length, calls: stage.renderer.info.render.calls, canvas: [stage.canvas.width, stage.canvas.height] };
  };
  // Likewise: look at (x, z) from `distance` m away along `yaw`, `height` m up, and draw that at once (stops following).
  (window as unknown as { battleLook: (x: number, z: number, distance: number, yaw: number, height: number) => void }).battleLook = (x, z, distance, yaw, height) => {
    following = false;
    orbit.autoRotate = false;
    const y = battlefieldHeight(hf, x, z);
    orbit.target.set(x, y + 1, z);
    stage.camera.position.set(x + Math.sin(yaw) * distance, y + height, z + Math.cos(yaw) * distance);
    orbit.update();
    view.update(match.duel.crowd!, match.duel.tick, 0, hf, stage.camera);
    stage.draw();
  };

  const frame = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    if (frames > WARMUP_FRAMES) intervals.push(now - last);
    last = now;
    const s0 = performance.now();
    carry += dt * SPEEDS[speed]!;
    let steps = 0;
    while (carry >= TICK_SECONDS && steps < MAX_TICKS_PER_FRAME && match.status.status === 'InProgress') {
      match = stepMatch(match, [], tuning);
      carry -= TICK_SECONDS;
      steps++;
    }
    if (match.status.status === 'Over' || steps === MAX_TICKS_PER_FRAME) carry = Math.min(carry, TICK_SECONDS);
    const crowd = match.duel.crowd!;

    const t0 = performance.now();
    if (following && battleFocus(crowd, focus)) {
      const k = 1 - Math.exp(-FOLLOW_RATE * dt);
      const shift = new THREE.Vector3(focus.x, battlefieldHeight(hf, focus.x, focus.z), focus.z).sub(orbit.target).multiplyScalar(k);
      orbit.target.add(shift);
      stage.camera.position.add(shift);
    }
    orbit.update();
    const ground = battlefieldHeight(hf, stage.camera.position.x, stage.camera.position.z) + CAMERA_CLEARANCE;
    if (stage.camera.position.y < ground) stage.camera.position.y = ground;
    view.update(crowd, match.duel.tick, match.status.status === 'Over' ? 0 : Math.min(1, carry / TICK_SECONDS), hf, stage.camera);
    stage.draw();
    calls = stage.renderer.info.render.calls;
    const t1 = performance.now();
    if (++frames > WARMUP_FRAMES) {
      cpu.push(t1 - t0);
      sim.push(t0 - s0);
    }

    const [a, b] = crowdAlive(crowd);
    const r = report();
    const rout = crowd.rout ? `Team ${crowd.rout.team} routed at ${(crowd.rout.tick * TICK_SECONDS).toFixed(1)} s` : '';
    const over = match.status.status === 'Over' ? `\nTeam ${match.status.winner} wins` : '';
    status.textContent =
      `${match.arena}  ${(match.duel.tick * TICK_SECONDS).toFixed(1)} s\n` +
      `Team 0 (yellow)  ${a} / ${tuning.battle.armySize}\nTeam 1 (blue) ${b} / ${tuning.battle.armySize}\n${rout}${over}\n` +
      `render ${r.recentCpu.mean.toFixed(2)} ms (p99 ${r.recentCpu.p99.toFixed(1)}), frame ${r.recentInterval.mean.toFixed(1)} ms, ${calls} draws`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
