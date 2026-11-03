/**
 * The Battle debug view (/sword/#/editor/battle, dev server only): docs/plans/big-battle.md Stage 1. An AI-vs-AI war
 * (no Fighters) stepped through `stepMatch` in real time, drawn plainly: the Battlefield's heightfield as a shaded mesh,
 * each Soldier a box in its Team's colour (a fallen one lies flat and grey), a free orbit camera. A panel shows the
 * Tick, each army's strength, the Rout and the winner, with a seed box, a restart and the speed. `#/editor/battle/<seed>`
 * starts on that seed; `#/editor/battle/<map>/<seed>` on a hand-built Battle map (`battle.maps`, its walls and towers drawn as grey
 * boxes, docs/plans/battle-objectives.md Stage 3a) at its standard army size. Render only: nothing here feeds the Simulation, and the
 * Editor only imports it in dev.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ATTACK, battlefieldHeight, battleMapOf, battleNameFor, COLUMN, createMatch, crowdAlive, DEFEND, descend, formationSpot, LINE, LOOSE, orderSpot, owned, routTicks, squadNarrows, squadsPerTeam, stepMatch, TICK_SECONDS, type BattleMap, type Heightfield, type MatchState } from '../sim';
import { applyBattleKnobs, type TuningData } from '../tuning';

const TEAM_COLOURS = [0x3d7bd9, 0xd94a3d];
const FALLEN_COLOUR = 0x555555;
/** A Squad's anchor by Formation (column, line, loose), and while it falls back. */
const SHAPE_COLOURS = [0x66cc66, 0xffaa33, 0xcc66ff] as const;
const FALLING_COLOUR = 0xff3366;
/** Orders: attack (red), defend (blue-green), respawn (yellow). An Objective's ring by its Owner, its pole by its progress. */
const ORDER_COLOURS = [0xff5544, 0x33ddaa, 0xffee44] as const;
const OWNER_COLOURS = [0x3d7bd9, 0xd94a3d] as const;
const UNOWNED_COLOUR = 0xcccccc;
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

export function startBattleView(container: HTMLElement, base: TuningData): void {
  // A hand-built map named in the hash, folded in as the Lobby would (its standard army size).
  const parts = location.hash.split('/');
  const mapName = parts[3] !== undefined && Object.hasOwn(base.battle.maps, parts[3]) ? parts[3] : undefined;
  const tuning: TuningData = mapName ? { ...base, battle: applyBattleKnobs(base.battle, { map: mapName }) } : base;
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
  const walls = new THREE.Group();
  scene.add(walls);
  // Squads (docs/plans/battle-objectives.md, Stage 1): each anchor a cone along its heading, each Soldier's place a dot.
  const squadCount = 2 * squadsPerTeam(tuning.battle);
  const cone = new THREE.ConeGeometry(0.9, 3, 8);
  cone.rotateX(Math.PI / 2);
  const anchors = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial(), squadCount);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 6, 4), new THREE.MeshBasicMaterial(), n);
  scene.add(anchors, dots);

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;padding:8px 10px;background:rgba(15,15,20,.85);color:#eee;font:12px/1.5 ui-monospace,monospace;border-radius:6px;z-index:10';
  const controls = document.createElement('div');
  const seedBox = document.createElement('input');
  seedBox.type = 'number';
  seedBox.style.width = '7em';
  const restart = document.createElement('button');
  restart.textContent = 'Restart';
  const speedButton = document.createElement('button');
  const squadsBox = document.createElement('input');
  squadsBox.type = 'checkbox';
  squadsBox.checked = true;
  const ordersBox = document.createElement('input');
  ordersBox.type = 'checkbox';
  ordersBox.checked = true;
  const fieldPick = document.createElement('select');
  const status = document.createElement('pre');
  status.style.margin = '6px 0 0';
  controls.append('seed ', seedBox, ' ', restart, ' ', speedButton, ' ', squadsBox, ' squads ', ordersBox, ' orders field ', fieldPick);
  panel.append(controls, status);
  container.appendChild(panel);

  // Objectives (docs/plans/battle-objectives.md, Stage 2a): a ring by Owner and a pole by progress each, a line from each Squad's anchor to its
  // Order's place, and (picked from the list) one destination field drawn as an arrow in each cell.
  const objectiveGroup = new THREE.Group();
  const orderLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
  orderLines.frustumCulled = false;
  const fieldLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
  fieldLines.frustumCulled = false;
  scene.add(objectiveGroup, orderLines, fieldLines);
  let rings: THREE.LineLoop[] = [];
  let poles: THREE.Mesh[] = [];
  let map: BattleMap;
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

  const buildObjectives = () => {
    objectiveGroup.clear();
    rings = [];
    poles = [];
    for (const site of map.field.objectives) {
      const circle = Array.from({ length: 48 }, (_, k) => new THREE.Vector3(Math.sin((k / 48) * 2 * Math.PI) * site.radius, 0.3, Math.cos((k / 48) * 2 * Math.PI) * site.radius));
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle), new THREE.LineBasicMaterial({ color: UNOWNED_COLOUR }));
      ring.position.set(site.x, battlefieldHeight(map.field.heights, site.x, site.z), site.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 8).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: UNOWNED_COLOUR }));
      pole.position.copy(ring.position);
      objectiveGroup.add(ring, pole);
      rings.push(ring);
      poles.push(pole);
    }
  };
  /** The picked destination field as an arrow in each cell: the way down the field (the lowest neighbour). */
  const drawField = () => {
    const d = Number(fieldPick.value);
    fieldLines.visible = d >= 0;
    if (d < 0) return;
    const f = map.fields;
    const points: THREE.Vector3[] = [];
    for (let r = 0; r < f.side; r++)
      for (let c = 0; c < f.side; c++) {
        const x = (c - (f.side - 1) / 2) * f.cell;
        const z = (r - (f.side - 1) / 2) * f.cell;
        const way = descend(f, d, x, z);
        if (way === null) continue;
        const y = battlefieldHeight(hf, x, z) + 0.6;
        points.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x + Math.sin(way) * f.cell * 0.45, y, z + Math.cos(way) * f.cell * 0.45));
      }
    fieldLines.geometry.setFromPoints(points);
  };
  fieldPick.onchange = drawField;

  const start = (seed: number) => {
    match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, arena: battleNameFor(mapName, seed) });
    map = battleMapOf(tuning.battle, match.arena);
    hf = map.field.heights;
    buildObjectives();
    fieldPick.replaceChildren(new Option('off', '-1'), ...[...map.field.objectives.map((o) => o.id), 'Base 0', 'Base 1'].map((id, d) => new Option(id, String(d))));
    fieldPick.value = '-1';
    drawField();
    if (terrain) scene.remove(terrain);
    terrain = terrainMesh(hf);
    scene.add(terrain);
    walls.clear();
    for (const b of map.field.blocks) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.top, b.maxZ - b.minZ), new THREE.MeshLambertMaterial({ color: 0x8a8580 }));
      wall.position.set((b.minX + b.maxX) / 2, b.top / 2, (b.minZ + b.maxZ) / 2);
      walls.add(wall);
    }
    seedBox.value = String(seed);
    carry = 0;
    // Not `location.hash =`: a hash change reloads the page (main.ts).
    history.replaceState(null, '', `#/editor/battle/${mapName ? `${mapName}/` : ''}${seed}`);
  };
  restart.onclick = () => start(Math.max(0, Math.floor(Number(seedBox.value) || 0)));
  const fromHash = Number(parts[mapName ? 4 : 3]);
  start(Number.isInteger(fromHash) && fromHash >= 0 ? fromHash : 1);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const place: [number, number] = [0, 0];
  /** The Squads' anchors (cones: green column, orange line, purple loose, pink falling back) and places (dots, in the Team's colour). */
  const drawSquads = (c: NonNullable<MatchState['duel']['crowd']>) => {
    anchors.visible = dots.visible = squadsBox.checked;
    if (!squadsBox.checked) return;
    const sq = c.squads;
    // Places as the Soldiers steer to them: narrowed through a pass, and moved in out of a wall (Stage 3b).
    const narrow = squadNarrows(tuning.battle, map, sq);
    for (let k = 0; k < squadCount; k++) {
      if (sq.living[k] === 0) anchors.setMatrixAt(k, hidden);
      else anchors.setMatrixAt(k, m4.compose(p.set(sq.x[k]!, battlefieldHeight(hf, sq.x[k]!, sq.z[k]!) + 3, sq.z[k]!), q.setFromAxisAngle(up, sq.heading[k]!), one));
      anchors.setColorAt(k, colour.setHex(sq.fall[k] ? FALLING_COLOUR : SHAPE_COLOURS[sq.shape[k] as 0 | 1 | 2]));
    }
    for (let i = 0; i < n; i++) {
      const k = c.squad[i]!;
      if (!c.alive[i] || k < 0 || c.slot[i]! >= 0) {
        dots.setMatrixAt(i, hidden);
        continue;
      }
      formationSpot(tuning.battle, map, sq, k, c.place[i]!, narrow[k]!, place);
      const [x, z] = place;
      dots.setMatrixAt(i, m4.compose(p.set(x, battlefieldHeight(hf, x, z) + 0.15, z), q.identity(), one));
      dots.setColorAt(i, colour.setHex(TEAM_COLOURS[c.team[i]!]!));
    }
    anchors.instanceMatrix.needsUpdate = dots.instanceMatrix.needsUpdate = true;
    if (anchors.instanceColor) anchors.instanceColor.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
  };

  const spot: [number, number] = [0, 0];
  /** The Objectives' rings and poles, and the Orders' lines from each Squad's anchor to where it is going. */
  const drawObjectives = (c: NonNullable<MatchState['duel']['crowd']>) => {
    map.field.objectives.forEach((_, k) => {
      const owner = c.objectives.owner[k]!;
      const progress = c.objectives.progress[k]!;
      (rings[k]!.material as THREE.LineBasicMaterial).color.setHex(owner < 0 ? UNOWNED_COLOUR : OWNER_COLOURS[owner]!);
      poles[k]!.scale.set(1, Math.max(0.05, Math.abs(progress)) * 12, 1);
      (poles[k]!.material as THREE.MeshBasicMaterial).color.setHex(progress === 0 ? UNOWNED_COLOUR : OWNER_COLOURS[progress > 0 ? 0 : 1]!);
    });
    orderLines.visible = ordersBox.checked;
    if (!ordersBox.checked) return;
    const sq = c.squads;
    const per = sq.team.length / 2;
    const points: THREE.Vector3[] = [];
    const colours: number[] = [];
    for (let k = 0; k < sq.team.length; k++) {
      if (sq.living[k] === 0) continue;
      orderSpot(map, sq.target[k]!, k, per, tuning.battle, spot);
      const colour = new THREE.Color(sq.fall[k] ? FALLING_COLOUR : ORDER_COLOURS[sq.order[k]!]);
      points.push(new THREE.Vector3(sq.x[k]!, battlefieldHeight(hf, sq.x[k]!, sq.z[k]!) + 3, sq.z[k]!), new THREE.Vector3(spot[0], battlefieldHeight(hf, spot[0], spot[1]) + 3, spot[1]));
      colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
    }
    orderLines.geometry.setFromPoints(points);
    orderLines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  };

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
    drawSquads(c);
    drawObjectives(c);
    soldiers.instanceMatrix.needsUpdate = true;
    if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;
    const [a, b] = crowdAlive(c);
    const rout = c.rout ? `Team ${c.rout.team} routed at Tick ${c.rout.tick} (ends ${c.rout.tick + routTicks(tuning)})` : 'no Rout yet';
    const over = match.status.status === 'Over' ? `\nOVER: Team ${match.status.winner} wins at Tick ${match.status.tick}` : '';
    const engaged = c.target.filter((t) => t >= 0).length;
    const formations = [COLUMN, LINE, LOOSE].map((f) => c.squads.shape.filter((s, k) => s === f && c.squads.living[k]! > 0).length);
    const kinds = [ATTACK, DEFEND].map((o) => c.squads.order.filter((v, k) => v === o && c.squads.living[k]! > 0 && !c.squads.fall[k]).length);
    const objectivesLine = map.field.objectives.map((o, k) => `${o.id} ${c.objectives.owner[k] === -1 ? '-' : c.objectives.owner[k]} ${c.objectives.progress[k]!.toFixed(2)}`).join('  ');
    const ticketsLine = `Tickets ${c.tickets.map((t) => t.toFixed(0)).join(' / ')}  Objectives ${owned(c.objectives, 0)} v ${owned(c.objectives, 1)}  Orders: attack ${kinds[0]} defend ${kinds[1]}, empty ${c.squads.living.filter((l) => l === 0).length}`;
    const narrowed = squadNarrows(tuning.battle, map, c.squads).filter((w, k) => w > 0 && c.squads.living[k]! > 0).length;
    const squadsLine = `${ticketsLine}\n${objectivesLine}\nSquads column ${formations[0]} line ${formations[1]} loose ${formations[2]}, narrowed ${narrowed}, falling ${c.squads.fall.reduce((a, b) => a + b, 0)}, empty ${c.squads.living.filter((l) => l === 0).length}`;
    status.textContent = `${match.arena}  Tick ${match.tick} (${(match.tick * TICK_SECONDS).toFixed(1)} s)\nTeam 0 (blue) ${a} / ${tuning.battle.armySize}\nTeam 1 (red)  ${b} / ${tuning.battle.armySize}\nengaged ${engaged}\n${squadsLine}\n${rout}${over}`;
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
