/**
 * The Crowd drawn (docs/plans/big-battle.md, Stage 2): every Soldier an impostor, one instanced billboard draw per Team
 * from the soldier's baked atlas (`bakeImpostorAtlas`), tinted in the shader with its Team's colour, and a blob shadow
 * under each (one more draw for both). Each frame a Soldier's billboard turns about the vertical to face the camera
 * (in the shader), shows the atlas cell of the direction the camera sees it from (`directionCell`) and of the clip and
 * frame its state shows (`soldierFrame`), and glides between its Crowd steps (`soldierAt`).
 *
 * It only reads the Crowd. What the Crowd does not hold (when a Soldier was struck or fell) the view notes itself, as it
 * sees each Soldier's HP drop or its life end; a view that starts mid-battle shows the already fallen at rest. A promoted
 * Soldier (Stage 3) is drawn as its full Fighter instead: its impostor fades out, dithered (`dither.ts`), as the model fades
 * in (`BubbleSwap`), and what happens to it meanwhile is the model's to show, so it lies at rest if it comes back fallen.
 */
import * as THREE from 'three';
import { battlefieldHeight, TICK_SECONDS, type CrowdState, type Heightfield } from '../sim';
import type { BattleTuning } from '../tuning';
import { atlasCell, directionCell, soldierAt, soldierFrame, yawTo, type AtlasLayout, type ClipSeconds } from './impostor';
import { CELL_METRES, FEET_METRES, type ImpostorAtlas } from './impostorAtlas';
import { BAYER_GLSL } from './dither';

/** A Soldier's shadow: its radius (m), how dark (0 to 1), and how far above the ground it lies (m). */
const SHADOW_RADIUS = 0.42;
const SHADOW_OPACITY = 0.45;
const SHADOW_LIFT = 0.03;

const vertexShader = /* glsl */ `
  attribute vec3 aFeet;
  attribute vec2 aCell;
  attribute float aFade;
  uniform vec2 uCellSize;
  varying vec2 vUv;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    // Turned about the vertical to face the camera.
    vec2 toCamera = cameraPosition.xz - aFeet.xz;
    float d = length(toCamera);
    vec2 f = d > 1e-4 ? toCamera / d : vec2(0.0, 1.0);
    vec3 world = aFeet + vec3(f.y, 0.0, -f.x) * position.x + vec3(0.0, position.y, 0.0);
    vUv = aCell + uv * uCellSize;
    vFade = aFade;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform sampler2D uMask;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vFade;
  ${BAYER_GLSL}
  #include <fog_pars_fragment>
  void main() {
    // Dithered out while its full model is drawn instead (the pixels the model keeps, the impostor drops).
    if (vFade < 1.0 && bayer4(gl_FragCoord.xy) < 1.0 - vFade) discard;
    vec4 colour = texture2D(uAtlas, vUv);
    if (colour.a < 0.5) discard;
    float team = texture2D(uMask, vUv).r;
    gl_FragColor = vec4(colour.rgb * mix(vec3(1.0), uTint, team), 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** One Team's impostors: a billboard per Soldier of its army, its feet and atlas cell set per frame. */
class TeamImpostors {
  readonly mesh: THREE.Mesh;
  readonly feet: THREE.InstancedBufferAttribute;
  readonly cell: THREE.InstancedBufferAttribute;
  readonly fade: THREE.InstancedBufferAttribute;

  constructor(atlas: ImpostorAtlas, count: number, tint: number) {
    const quad = new THREE.PlaneGeometry(CELL_METRES, CELL_METRES).translate(0, CELL_METRES / 2 - FEET_METRES, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.feet = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFeet', this.feet);
    geometry.setAttribute('aCell', this.cell);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFade', this.fade);
    geometry.instanceCount = count;
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uCellSize: { value: new THREE.Vector2() },
        uTint: { value: new THREE.Color() },
      },
    ]);
    // Textures set after the merge, which would clone them.
    uniforms.uAtlas = { value: atlas.colour };
    uniforms.uMask = { value: atlas.mask };
    (uniforms.uCellSize!.value as THREE.Vector2).set(atlas.layout.cell / atlas.layout.width, atlas.layout.cell / atlas.layout.height);
    (uniforms.uTint!.value as THREE.Color).setHex(tint);
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    // Its Soldiers are all over the field: the vertices are placed in the shader, so the bounds would be wrong anyway.
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Scratch for one frame. */
const at: [number, number] = [0, 0];
const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const tilt = new THREE.Quaternion();
const normal = new THREE.Vector3();
const size = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CrowdView {
  readonly root = new THREE.Group();
  private readonly teams: TeamImpostors[];
  private readonly shadows: THREE.InstancedMesh;
  private readonly layout: AtlasLayout;
  private readonly seconds: ClipSeconds;
  /** What the view last saw of each Soldier, and when (Battle seconds) it saw it struck or fall: NaN for never. */
  private seenHp = new Float64Array(0);
  private seenAlive = new Uint8Array(0);
  private hitAt = new Float64Array(0);
  private diedAt = new Float64Array(0);
  private lastTick = -1;

  constructor(
    atlas: ImpostorAtlas,
    private readonly battle: BattleTuning,
    blob: THREE.Texture,
  ) {
    this.layout = atlas.layout;
    this.seconds = atlas.seconds;
    this.teams = [0, 1].map((team) => new TeamImpostors(atlas, battle.armySize, battle.soldier.colours[team]!));
    for (const t of this.teams) this.root.add(t.mesh);
    const disc = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const shade = new THREE.MeshBasicMaterial({
      map: blob,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.shadows = new THREE.InstancedMesh(disc, shade, 2 * battle.armySize);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.root.add(this.shadows);
  }

  /**
   * Draw `crowd` (the Crowd of Tick `tick`) a share `alpha` of the way to the next Tick, on the ground `hf`, as `camera`
   * sees it, each Soldier's impostor showing its share of `fades` (0 to 1, from `BubbleSwap`; by default all of it unless
   * it is promoted). A Tick earlier than the last one drawn (a restart) forgets what the view had seen.
   */
  update(crowd: CrowdState, tick: number, alpha: number, hf: Heightfield, camera: THREE.Camera, fades?: Float32Array): void {
    const n = crowd.x.length;
    const { stagger } = this.battle.crowd;
    const army = this.battle.armySize;
    const now = tick * TICK_SECONDS;
    const time = (tick + alpha) * TICK_SECONDS;
    this.observe(crowd, tick, now);
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < n; i++) {
      const team = this.teams[crowd.team[i]!]!;
      const k = i % army;
      const fade = fades ? fades[i]! : crowd.slot[i]! >= 0 ? 0 : 1;
      team.fade.setX(k, fade);
      soldierAt(crowd, i, tick, tick + alpha, stagger, army, at);
      const [x, z] = at;
      const y = battlefieldHeight(hf, x, z);
      team.feet.setXYZ(k, x, y, z);
      const alive = crowd.alive[i] === 1;
      const { clip, frame } = soldierFrame(
        {
          alive,
          engaged: crowd.target[i]! >= 0,
          speed: Math.hypot(crowd.vx[i]!, crowd.vz[i]!),
          sinceHit: Number.isNaN(this.hitAt[i]!) ? null : time - this.hitAt[i]!,
          sinceDeath: Number.isNaN(this.diedAt[i]!) ? null : time - this.diedAt[i]!,
        },
        time,
        i,
        this.seconds,
        this.layout.frames,
      );
      const { column, row } = atlasCell(this.layout, clip, frame, directionCell(crowd.heading[i]!, yawTo(x, z, cx, cz), this.layout.directions));
      team.cell.setXY(k, (column * this.layout.cell) / this.layout.width, (row * this.layout.cell) / this.layout.height);

      // The shadow, lying on the ground's slope under it.
      const e = 0.5;
      normal.set(battlefieldHeight(hf, x - e, z) - battlefieldHeight(hf, x + e, z), 2 * e, battlefieldHeight(hf, x, z - e) - battlefieldHeight(hf, x, z + e)).normalize();
      tilt.setFromUnitVectors(UP, normal);
      place.set(x, y, z).addScaledVector(normal, SHADOW_LIFT);
      // A full model draws its own shadow: the impostor's goes with it.
      size.setScalar(2 * SHADOW_RADIUS * (alive ? 1 : 1.3) * (fade > 0.5 ? 1 : 0));
      this.shadows.setMatrixAt(i, matrix.compose(place, tilt, size));
    }
    for (const t of this.teams) {
      t.feet.needsUpdate = true;
      t.cell.needsUpdate = true;
      t.fade.needsUpdate = true;
    }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Note each Soldier struck (its HP dropped) or fallen since the last Tick seen, at Battle time `now`. */
  private observe(crowd: CrowdState, tick: number, now: number): void {
    const n = crowd.x.length;
    if (this.seenHp.length !== n || tick < this.lastTick) {
      this.seenHp = Float64Array.from(crowd.hp);
      this.seenAlive = Uint8Array.from(crowd.alive);
      this.hitAt = new Float64Array(n).fill(Number.NaN);
      this.diedAt = new Float64Array(n).fill(Number.NaN);
    } else if (tick !== this.lastTick) {
      for (let i = 0; i < n; i++) {
        // A promoted Soldier's blows and fall are its full model's to show.
        const promoted = crowd.slot[i]! >= 0;
        if (crowd.hp[i]! < this.seenHp[i]! && !promoted) this.hitAt[i] = now;
        if (!crowd.alive[i] && this.seenAlive[i] && !promoted) this.diedAt[i] = now;
        this.seenHp[i] = crowd.hp[i]!;
        this.seenAlive[i] = crowd.alive[i]!;
      }
    }
    this.lastTick = tick;
  }

  dispose(): void {
    for (const t of this.teams) t.dispose();
    this.shadows.geometry.dispose();
    (this.shadows.material as THREE.Material).dispose();
  }
}
