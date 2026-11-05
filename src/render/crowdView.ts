/**
 * The Crowd drawn (docs/plans/big-battle.md, Stage 2): every Soldier an impostor, one instanced billboard draw per Team and look
 * (a Troop's Body and Weapon, each from its own baked atlas, `bakeImpostorAtlases`), tinted in the shader with its Team's colour
 * in a shade of its own (`soldierShade`, so an army is not one flat colour), and a blob shadow under each (one more draw for all).
 * Each look's draw holds a billboard for every place of its army; a Soldier of another look is drawn there at no size (no pixels). Each frame a Soldier's billboard turns about the vertical to face the camera
 * (in the shader), shows the atlas cell of the direction the camera sees it from (`directionCell`) and of the clip and
 * frame its state shows (`soldierFrame`), and glides between its Crowd steps (`soldierAt`).
 *
 * It only reads the Crowd. What the Crowd does not hold (when a Soldier was struck or fell) the view notes itself, as it
 * sees each Soldier's HP drop or its life end; a view that starts mid-battle shows the already fallen at rest. A promoted
 * Soldier (Stage 3) is drawn as its full Fighter instead: its impostor fades out, dithered (`dither.ts`), as the model fades
 * in (`BubbleSwap`), and what happens to it meanwhile is the model's to show, so it lies at rest if it comes back fallen.
 */
import * as THREE from 'three';
import { groundHeight, TICK_SECONDS, type CrowdState, type Heightfield } from '../sim';
import { troopBodies, type BattleTuning } from '../tuning';
import { atlasCell, directionCell, impostorStretch, soldierAt, soldierFrame, yawTo, type AtlasLayout } from './impostor';
import { CELL_METRES, FEET_METRES, type ImpostorAtlas, type ImpostorAtlases } from './impostorAtlas';
import { BAYER_GLSL } from './dither';

/** A Soldier's shadow: its radius (m), how dark (0 to 1), and how far above the ground it lies (m). */
const SHADOW_RADIUS = 0.42;
const SHADOW_OPACITY = 0.45;
const SHADOW_LIFT = 0.03;

const vertexShader = /* glsl */ `
  attribute vec3 aFeet;
  attribute vec2 aCell;
  attribute float aFade;
  attribute vec2 aSize;
  attribute vec2 aShade;
  uniform vec2 uCellSize;
  varying vec2 vUv;
  varying float vFade;
  varying vec2 vShade;
  #include <fog_pars_vertex>
  void main() {
    // Turned about the vertical to face the camera.
    vec2 toCamera = cameraPosition.xz - aFeet.xz;
    float d = length(toCamera);
    vec2 f = d > 1e-4 ? toCamera / d : vec2(0.0, 1.0);
    // Stretched to its Size about its feet (the quad's origin), so its feet stay on the ground: aSize is (across, up).
    vec3 world = aFeet + vec3(f.y, 0.0, -f.x) * (position.x * aSize.x) + vec3(0.0, position.y * aSize.y, 0.0);
    vUv = aCell + uv * uCellSize;
    vFade = aFade;
    vShade = aShade;
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
  varying vec2 vShade;
  ${BAYER_GLSL}
  #include <fog_pars_fragment>
  void main() {
    // Dithered out while its full model is drawn instead (the pixels the model keeps, the impostor drops).
    if (vFade < 1.0 && bayer4(gl_FragCoord.xy) < 1.0 - vFade) discard;
    vec4 colour = texture2D(uAtlas, vUv);
    if (colour.a < 0.5) discard;
    // The colour is baked white on the team part and filtered, so an edge pixel is white where the mask has only partly risen:
    // taking the mask's partial values as full keeps that white from showing as a fringe.
    float team = smoothstep(0.0, 0.35, texture2D(uMask, vUv).r);
    // Its own shade: of its Team's colour on the team-coloured part (x), and a little lighter or darker all over (y).
    gl_FragColor = vec4(colour.rgb * vShade.y * mix(vec3(1.0), uTint * vShade.x, team), 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

/** How far a Soldier's shade of its Team's colour (x) and its brightness all over (y) vary either side of 1. */
const SHADE_SPREAD: readonly [number, number] = [0.16, 0.07];

/**
 * Soldier `i`'s shade (render-only, the same every frame and on every peer): a multiplier on its Team's colour and one on its
 * whole impostor, each within SHADE_SPREAD of 1, from a hash of `i`.
 */
export function soldierShade(i: number): [number, number] {
  let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  const a = (h & 0xffff) / 0xffff;
  const b = (h >>> 16) / 0xffff;
  return [1 + SHADE_SPREAD[0] * (2 * a - 1), 1 + SHADE_SPREAD[1] * (2 * b - 1)];
}

/** One Team's impostors of one look: a billboard per place of its army, its feet and atlas cell set per frame (no size for a Soldier of another look). */
class TeamImpostors {
  readonly mesh: THREE.Mesh;
  readonly feet: THREE.InstancedBufferAttribute;
  readonly cell: THREE.InstancedBufferAttribute;
  readonly fade: THREE.InstancedBufferAttribute;
  readonly size: THREE.InstancedBufferAttribute;
  readonly shade: THREE.InstancedBufferAttribute;

  constructor(
    readonly atlas: ImpostorAtlas,
    count: number,
    tint: number,
    team: number,
  ) {
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
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(count * 2).fill(1), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSize', this.size);
    const shades = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) shades.set(soldierShade(team * count + k), 2 * k);
    this.shade = new THREE.InstancedBufferAttribute(shades, 2);
    geometry.setAttribute('aShade', this.shade);
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
  /** Each Team's draws, one per look: `teams[team][look]`. */
  private readonly teams: TeamImpostors[][];
  private readonly shadows: THREE.InstancedMesh;
  private readonly layout: AtlasLayout;
  /** Which look (atlas) Troop `t`'s look `l` is drawn from. */
  private readonly lookIndex: readonly (readonly (readonly number[])[])[];
  /** What the view last saw of each Soldier, and when (Battle seconds) it saw it struck or fall: NaN for never. */
  private seenHp = new Float64Array(0);
  private seenAlive = new Uint8Array(0);
  private hitAt = new Float64Array(0);
  private diedAt = new Float64Array(0);
  private lastTick = -1;

  /** `atlases`: one atlas (every Soldier the same look), or a Battle's atlases, one per look (`bakeImpostorAtlases`). */
  constructor(
    atlases: ImpostorAtlas | ImpostorAtlases,
    private readonly battle: BattleTuning,
    blob: THREE.Texture,
  ) {
    const all = 'atlases' in atlases ? atlases.atlases : [atlases];
    this.lookIndex = 'atlases' in atlases ? atlases.index : [0, 1].map((team) => battle.troops.map((t) => troopBodies(t, team).map(() => 0)));
    this.layout = all[0]!.layout;
    this.teams = [0, 1].map((team) => all.map((atlas) => new TeamImpostors(atlas, battle.armySize, battle.soldier.colours[team]!, team)));
    for (const t of this.teams.flat()) this.root.add(t.mesh);
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
      const draws = this.teams[crowd.team[i]!]!;
      const team = draws[this.lookOf(crowd, i)] ?? draws[0]!;
      const k = i % army;
      // Its place in every other look's draw is empty.
      for (const other of draws) if (other !== team) other.size.setXY(k, 0, 0);
      const fade = fades ? fades[i]! : crowd.slot[i]! >= 0 ? 0 : 1;
      team.fade.setX(k, fade);
      soldierAt(crowd, i, tick, tick + alpha, stagger, army, at);
      const [x, z] = at;
      // On its own Walk Surface (a map of several levels: in the tunnel, not on the bridge over it).
      const s = crowd.surface[i]!;
      const y = groundHeight(hf, s, x, z);
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
        team.atlas.seconds,
        this.layout.frames,
      );
      const viewYaw = yawTo(x, z, cx, cz);
      const { column, row } = atlasCell(this.layout, clip, frame, directionCell(crowd.heading[i]!, viewYaw, this.layout.directions));
      const height = crowd.sizeHeight[i] ?? 1;
      const thick = crowd.sizeThick[i] ?? 1;
      const [across, up] = impostorStretch(height, thick, crowd.heading[i]!, viewYaw);
      team.size.setXY(k, across, up);
      team.cell.setXY(k, (column * this.layout.cell) / this.layout.width, (row * this.layout.cell) / this.layout.height);

      // The shadow, lying on the ground's slope under it.
      const e = 0.5;
      normal.set(groundHeight(hf, s, x - e, z) - groundHeight(hf, s, x + e, z), 2 * e, groundHeight(hf, s, x, z - e) - groundHeight(hf, s, x, z + e)).normalize();
      tilt.setFromUnitVectors(UP, normal);
      place.set(x, y, z).addScaledVector(normal, SHADOW_LIFT);
      // A full model draws its own shadow: the impostor's goes with it.
      size.setScalar(2 * SHADOW_RADIUS * (alive ? thick : 1.3 * height) * (fade > 0.5 ? 1 : 0));
      this.shadows.setMatrixAt(i, matrix.compose(place, tilt, size));
    }
    for (const t of this.teams.flat()) {
      t.feet.needsUpdate = true;
      t.cell.needsUpdate = true;
      t.fade.needsUpdate = true;
      t.size.needsUpdate = true;
    }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Which look's draw Soldier `i` is in (its Troop's look). */
  private lookOf(crowd: CrowdState, i: number): number {
    const looks = this.lookIndex[crowd.team[i] === 1 ? 1 : 0]?.[crowd.troop[i] ?? 0];
    return looks?.[(crowd.look[i] ?? 0) % (looks.length || 1)] ?? 0;
  }

  /** The draw Soldier `i` of `crowd` is in (its Team's, of its look); its billboard there is instance `i % armySize`. */
  meshOf(crowd: CrowdState, i: number): THREE.Mesh {
    const draws = this.teams[crowd.team[i]!]!;
    return (draws[this.lookOf(crowd, i)] ?? draws[0]!).mesh;
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
    for (const t of this.teams.flat()) t.dispose();
    this.shadows.geometry.dispose();
    (this.shadows.material as THREE.Material).dispose();
  }
}
