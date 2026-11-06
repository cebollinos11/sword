import * as THREE from 'three';

/** How a sky dome looks: the nebula's three colours (deep, glow, highlight) and the colour it fades to at the horizon (the fog's, so fogged ground melts into it). */
export interface SkyLook {
  readonly deep: number;
  readonly glow: number;
  readonly highlight: number;
  readonly horizon: number;
}

/** The dome's radius (m): well inside the camera's far plane. It follows the camera, so it is never reached. */
const RADIUS = 100;

/** The dome's: the direction is the vertex's own (the dome is centred on the camera). */
const domeVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A window pane's: the direction is from the camera through the pane, so the sky stays put beyond it as the camera moves. */
const paneVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** The hash both the bake's noise and the stars use. */
const HASH_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
`;

/**
 * The nebula, baked into a cube map (`bakeSkies`): its colour sunk into the mist toward the horizon (rgb), and how thick it is (a), which
 * dims the stars. Its twenty octaves of noise a pixel are far too dear to shade over the whole screen every frame (it was most of a
 * Battle's GPU time), and its clouds drift so slowly that baking a face again now and then keeps up with them.
 */
const bakeFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  uniform vec3 uHighlight;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  ${HASH_GLSL}

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // Domain-warped clouds, drifting slowly.
    vec3 q = dir * 2.2 + vec3(0.0, 0.0, uTime * 0.004);
    vec3 warp = vec3(fbm(q), fbm(q + 5.2), fbm(q + 9.7));
    float cloud = fbm(q + 1.8 * warp);
    float wisps = fbm(dir * 6.0 + 2.5 * warp);
    vec3 color = uDeep * 0.5;
    color = mix(color, uDeep, smoothstep(0.3, 0.6, cloud));
    color = mix(color, uGlow, smoothstep(0.45, 0.75, cloud) * 0.9);
    color += uHighlight * pow(smoothstep(0.45, 0.85, wisps * cloud * 1.6), 2.0) * 0.7;
    // The mist rises from the horizon and fills everything below it.
    float mist = smoothstep(0.22, -0.08, dir.y);
    gl_FragColor = vec4(mix(color, uHorizon, mist), smoothstep(0.45, 0.8, cloud));
  }
`;

/** What is drawn each frame: the baked nebula, and the stars twinkling over it (a few hashes a pixel, none in the mist). */
const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform samplerCube uSky;
  uniform vec3 uTint;
  uniform float uTintAmount;
  varying vec3 vDir;
  ${HASH_GLSL}

  /** A sparse field of twinkling stars: one in a few hundred cells of a grid \`scale\` cells per unit of direction. */
  float stars(vec3 dir, float scale, float threshold) {
    vec3 p = dir * scale;
    vec3 c = floor(p);
    float h = hash(c);
    if (h < threshold) return 0.0;
    vec3 at = vec3(hash(c + 1.3), hash(c + 2.7), hash(c + 5.1)) * 0.6 + 0.2;
    float d = length(fract(p) - at);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + 3.0 * h) + h * 40.0);
    return smoothstep(0.14, 0.0, d) * twinkle;
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec4 nebula = textureCube(uSky, dir);
    vec3 color = nebula.rgb;
    // Stars, dimmed where the nebula is thick, and sunk into the mist with it.
    float clear = 1.0 - smoothstep(0.22, -0.08, dir.y);
    if (clear > 0.0) {
      float s = stars(dir, 140.0, 0.985) + 0.6 * stars(dir, 320.0, 0.992);
      color += vec3(0.9, 0.92, 1.0) * s * (1.0 - 0.6 * nebula.a) * clear;
    }
    color = mix(color, uTint, uTintAmount);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A cube face of the nebula is baked this many pixels square; one face is baked again every this many seconds while its sky is drawn. */
const BAKE_SIZE = 512;
const REBAKE_SECONDS = 0.5;
/** A sky not drawn for this long (s) is not baked again until it is. */
const IDLE_SECONDS = 1;

/** One sky's nebula as one renderer baked it. */
interface Bake {
  readonly target: THREE.WebGLCubeRenderTarget;
  readonly cameras: THREE.CubeCamera;
  readonly scene: THREE.Scene;
  readonly time: { value: number };
  /** The next face to bake again, and when (performance.now() ms) it is due. */
  face: number;
  due: number;
}

/** Every sky look made so far (a handful), each renderer's bakes of them, and when (performance.now() ms) each look was last drawn. */
const looks = new Set<SkyLook>();
const bakes = new WeakMap<THREE.WebGLRenderer, Map<SkyLook, Bake>>();
const drawn = new Map<SkyLook, number>();

/** The shaders' time (s), wrapped to keep float precision. */
const skyTime = (ms: number): number => (ms / 1000) % 3600;

function newBake(renderer: THREE.WebGLRenderer, look: SkyLook): Bake {
  const target = new THREE.WebGLCubeRenderTarget(BAKE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
  const time = { value: skyTime(performance.now()) };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uDeep: { value: new THREE.Color(look.deep) },
      uGlow: { value: new THREE.Color(look.glow) },
      uHighlight: { value: new THREE.Color(look.highlight) },
      uHorizon: { value: new THREE.Color(look.horizon) },
    },
    vertexShader: domeVertexShader,
    fragmentShader: bakeFragmentShader,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  ball.frustumCulled = false;
  scene.add(ball);
  const cameras = new THREE.CubeCamera(0.1, 10, target);
  scene.add(cameras);
  // Every face at once the first time.
  cameras.update(renderer, scene);
  return { target, cameras, scene, time, face: 0, due: performance.now() + REBAKE_SECONDS * 1000 };
}

/**
 * Bake, for `renderer`, every sky's nebula it has not baked yet, and bake one face again of each sky drawn lately whose turn it is
 * (so its clouds keep drifting). Call before each frame `renderer` draws that may hold a sky; until a sky is baked its nebula draws black.
 */
export function bakeSkies(renderer: THREE.WebGLRenderer): void {
  let mine = bakes.get(renderer);
  if (!mine) bakes.set(renderer, (mine = new Map()));
  const now = performance.now();
  for (const look of looks) {
    const bake = mine.get(look);
    if (!bake) {
      mine.set(look, newBake(renderer, look));
      continue;
    }
    if (now < bake.due || now - (drawn.get(look) ?? -Infinity) > IDLE_SECONDS * 1000) continue;
    bake.due = now + REBAKE_SECONDS * 1000;
    bake.time.value = skyTime(now);
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(bake.target, bake.face);
    renderer.render(bake.scene, bake.cameras.children[bake.face] as THREE.Camera);
    renderer.setRenderTarget(target, face, level);
    bake.face = (bake.face + 1) % 6;
  }
}

/**
 * A space sky round the camera: a drifting nebula over a field of twinkling stars, sinking into
 * the horizon colour (the fog's) towards and below the horizon. Drawn first, behind everything, and
 * never fogged. Render-only; its nebula is baked by `bakeSkies`.
 */
export function sky(look: SkyLook): THREE.Mesh {
  const material = skyMaterial(look, domeVertexShader, { side: THREE.BackSide, depthWrite: false, depthTest: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), material);
  dome.name = 'sky';
  // It is always round the camera: never culled, drawn before the Arena.
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  dome.matrixAutoUpdate = false;
  const at = new THREE.Vector3();
  dome.onBeforeRender = (_renderer, _scene, camera) => {
    // Centred on the camera: the parent (an Arena's root) sits at the origin, unmoved.
    dome.matrixWorld.makeTranslation(at.setFromMatrixPosition(camera.matrixWorld));
  };
  return dome;
}

/**
 * Window glass that looks out on the sky: each pane drawn as the sky seen through it, faintly tinted
 * by the glass (`tint`, `amount` from 0 to 1). For a closed room, where a dome would never be seen. Render-only; its nebula is baked by `bakeSkies`.
 */
export function skyPane(look: SkyLook, tint: number, amount: number): THREE.ShaderMaterial {
  const material = skyMaterial(look, paneVertexShader, { side: THREE.DoubleSide });
  material.uniforms.uTint!.value.set(tint);
  material.uniforms.uTintAmount!.value = amount;
  return material;
}

function skyMaterial(look: SkyLook, vertexShader: string, params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  looks.add(look);
  const uniforms = {
    uTime: { value: 0 },
    uSky: { value: null as THREE.Texture | null },
    uTint: { value: new THREE.Color() },
    uTintAmount: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ ...params, uniforms, vertexShader, fragmentShader, fog: false });
  material.onBeforeRender = (renderer) => {
    const now = performance.now();
    drawn.set(look, now);
    uniforms.uSky.value = bakes.get(renderer)?.get(look)?.target.texture ?? null;
    uniforms.uTime.value = skyTime(now);
  };
  return material;
}
