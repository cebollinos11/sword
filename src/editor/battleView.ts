/**
 * The Battle debug view (/sword/#/editor/battle, dev server only): docs/plans/big-battle.md Stage 1. An AI-vs-AI war
 * (no Fighters) stepped through `stepMatch` in real time, drawn plainly: the Battlefield's heightfield as a shaded mesh,
 * each Soldier a box in its Team's colour (a fallen one lies flat and grey), a free orbit camera. A panel shows the
 * Tick, each army's strength, the Rout and the winner, with a seed box, a restart and the speed. `#/editor/battle/<seed>`
 * starts on that seed. Render only: nothing here feeds the Simulation, and the Editor only imports it in dev.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { battlefieldHeight, battlefieldOf, createMatch, crowdAlive, routTicks, stepMatch, TICK_SECONDS, type Heightfield, type MatchState } from '../sim';
import type { TuningData } from '../tuning';

const TEAM_COLOURS = [0x3d7bd9, 0xd94a3d];
const FALLEN_COLOUR = 0x555555;
const SPEEDS = [0, 1, 2, 4, 8];
/** Ticks stepped at most per frame, so a slow frame never spirals. */
const MAX_TICKS_PER_FRAME = 60;

function terrainMesh(hf: Heightfield): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(hf.size, hf.size, hf.side - 1, hf.side - 1);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position!;
  for (let k = 0; k < pos.count; k++) pos.setY(k, battlefieldHeight(hf, pos.getX(k), pos.getZ(k)));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x6f8f4e, wireframe: false }));
  const grid = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x4f6b38, transparent: true, opacity: 0.35 }));
  grid.position.y = 0.02;
  mesh.add(grid);
  return mesh;
}

export function startBattleView(container: HTMLElement, tuning: TuningData): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  container.style.position = 'relative';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9c4dc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(60, 100, 30);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
  camera.position.set(-70, 60, -90);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0, 0);
  orbit.update();

  const n = 2 * tuning.battle.armySize;
  const box = new THREE.BoxGeometry(0.6, 1.7, 0.4);
  box.translate(0, 0.85, 0);
  const soldiers = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), n);
  soldiers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(soldiers);
  let terrain: THREE.Mesh | null = null;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;padding:8px 10px;background:rgba(15,15,20,.85);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10';
  const controls = document.createElement('div');
  const seedBox = document.createElement('input');
  seedBox.type = 'number';
  seedBox.style.width = '7em';
  const restart = document.createElement('button');
  restart.textContent = 'Restart';
  const speedButton = document.createElement('button');
  const status = document.createElement('pre');
  status.style.margin = '6px 0 0';
  controls.append('seed ', seedBox, ' ', restart, ' ', speedButton);
  panel.append(controls, status);
  container.appendChild(panel);

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

  const start = (seed: number) => {
    match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed });
    hf = battlefieldOf(tuning.battle, match.arena)!.heights;
    if (terrain) scene.remove(terrain);
    terrain = terrainMesh(hf);
    scene.add(terrain);
    seedBox.value = String(seed);
    carry = 0;
    // Not `location.hash =`: a hash change reloads the page (main.ts).
    history.replaceState(null, '', `#/editor/battle/${seed}`);
  };
  restart.onclick = () => start(Math.max(0, Math.floor(Number(seedBox.value) || 0)));
  const fromHash = Number(location.hash.split('/')[3]);
  start(Number.isInteger(fromHash) && fromHash >= 0 ? fromHash : 1);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  const draw = () => {
    const c = match.duel.crowd!;
    for (let i = 0; i < n; i++) {
      const x = c.x[i]!;
      const z = c.z[i]!;
      p.set(x, battlefieldHeight(hf, x, z), z);
      q.setFromAxisAngle(up, c.heading[i]!);
      if (!c.alive[i]) q.multiply(flat);
      soldiers.setMatrixAt(i, m4.compose(p, q, one));
      soldiers.setColorAt(i, colour.setHex(c.alive[i] ? TEAM_COLOURS[c.team[i]!]! : FALLEN_COLOUR));
    }
    soldiers.instanceMatrix.needsUpdate = true;
    if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;
    const [a, b] = crowdAlive(c);
    const rout = c.rout ? `Team ${c.rout.team} routed at Tick ${c.rout.tick} (ends ${c.rout.tick + routTicks(tuning)})` : 'no Rout yet';
    const over = match.status.status === 'Over' ? `\nOVER: Team ${match.status.winner} wins at Tick ${match.status.tick}` : '';
    const engaged = c.target.filter((t) => t >= 0).length;
    status.textContent = `${match.arena}  Tick ${match.tick} (${(match.tick * TICK_SECONDS).toFixed(1)} s)\nTeam 0 (blue) ${a} / ${tuning.battle.armySize}\nTeam 1 (red)  ${b} / ${tuning.battle.armySize}\nengaged ${engaged}\n${rout}${over}`;
  };

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    carry += dt * SPEEDS[speed]!;
    let steps = 0;
    while (carry >= TICK_SECONDS && steps < MAX_TICKS_PER_FRAME && match.status.status === 'InProgress') {
      match = stepMatch(match, [], tuning);
      carry -= TICK_SECONDS;
      steps++;
    }
    if (match.status.status === 'Over') carry = 0;
    draw();
    orbit.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
