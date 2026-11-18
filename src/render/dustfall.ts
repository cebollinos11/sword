import * as THREE from 'three';

/**
 * How the stale air of an underground look moves and shows: how many motes, in how big a box round the camera (m), how they wander and
 * settle, how big they are, their colour, and the embers rising off each lit flame.
 */
export interface DustLook {
  readonly count: number;
  readonly box: readonly [number, number, number];
  /** How far (m) each mote wanders to and fro, in all three axes, round its slow drift. */
  readonly wander: number;
  /** Steady drift (m/s) along x and z, and how fast (m/s) the motes sink. */
  readonly drift: readonly [number, number];
  readonly settle: number;
  /** A mote's size across (m). */
  readonly size: number;
  readonly color: number;
  readonly opacity: number;
  /** How much of a mote shows with no flame near (0 to 1): a little, so the air between the torch pools is barely there. */
  readonly ambient: number;
  /** How strongly a flame's light lights the motes round it (per candela over the distance squared). */
  readonly gain: number;
  /** How many embers rise off each lit flame at once (none if 0), how high (m) they climb before they go out, and their size across (m). */
  readonly embers: number;
  readonly emberRise: number;
  readonly emberSize: number;
}

/** The most flames the motes are lit by, and embers rise off, at once (a Delver Floor's `TorchLights` pool, a Map Editor map's torches). */
export const DUST_LIGHTS = 8;

const vertexShader = /* glsl */ `
  #define LIGHTS ${DUST_LIGHTS}
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uBox;
  uniform float uWander;
  uniform vec2 uDrift;
  uniform float uSettle;
  uniform float uSize;
  uniform float uEmberSize;
  uniform float uEmberRise;
  uniform vec3 uColor;
  uniform float uAmbient;
  uniform float uGain;
  uniform float uOpacity;
  // Each flame: where it burns (world, m) and its brightness (candela); its colour and its light's reach (m, 0 for no flame).
  uniform vec4 uLights[LIGHTS];
  uniform vec4 uLightColors[LIGHTS];
  uniform float fogNear;
  uniform float fogFar;
  // Three random numbers in [0, 1), and the ember's flame (-1 for a mote).
  attribute vec4 aRand;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float t = uTime;
    vec3 p;
    float size;
    if (aRand.w < 0.0) {
      // A mote: placed once, drifting and sinking slowly, wandering round that on three slow waves, out of step mote to mote.
      p = position;
      p.x += t * uDrift.x + uWander * sin(t * (0.21 + 0.17 * aRand.x) + aRand.y * 6.2832);
      p.y += -t * uSettle * (0.5 + aRand.z) + uWander * 0.6 * sin(t * (0.17 + 0.13 * aRand.y) + aRand.z * 6.2832);
      p.z += t * uDrift.y + uWander * cos(t * (0.19 + 0.15 * aRand.z) + aRand.x * 6.2832);
      // Wrapped into the box round the camera, so the same motes hang wherever it goes.
      p = mod(p - uCamera + 0.5 * uBox, uBox) - 0.5 * uBox + uCamera;
      // Lit by each flame by the distance squared, out to half its light's reach: bright in a torch's pool, gone in the dark between.
      vec3 light = vec3(0.0);
      for (int k = 0; k < LIGHTS; k++) {
        float reach = 0.5 * uLightColors[k].w;
        if (reach <= 0.0) continue;
        float d = distance(p, uLights[k].xyz);
        float window = clamp(1.0 - pow(d / reach, 4.0), 0.0, 1.0);
        light += uLightColors[k].rgb * (uLights[k].w / max(d * d, 0.25)) * window * window;
      }
      vec3 lit = 1.0 - exp(-uGain * light);
      vColor = uColor * (uAmbient + lit);
      vAlpha = uOpacity * clamp(uAmbient + max(lit.r, max(lit.g, lit.b)), 0.0, 1.0);
      size = uSize * (0.6 + 0.8 * aRand.y);
    } else {
      // An ember: up from its flame and out as it climbs, over a second or two, then again; as bright as its flame's light.
      vec4 flame = uLights[int(aRand.w)];
      vec4 colour = uLightColors[int(aRand.w)];
      float life = 1.3 + aRand.x;
      float age = fract(t / life + aRand.y);
      float turn = aRand.z * 6.2832;
      float spread = 0.04 + 0.12 * age;
      p = flame.xyz + vec3(spread * sin(turn + age * 5.0), age * uEmberRise * (0.6 + 0.4 * aRand.x), spread * cos(turn + age * 4.0));
      float strength = colour.w > 0.0 ? clamp(flame.w * 0.25, 0.0, 1.0) : 0.0;
      vColor = mix(colour.rgb, vec3(1.0, 0.78, 0.42), 0.6) * 1.4;
      vAlpha = strength * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.5);
      size = uEmberSize * (1.0 - 0.5 * age);
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float depth = -mvPosition.z;
    gl_PointSize = max(1.0, size / depth);
    // Fogged by hand (the motes add light, so they fade out into the haze rather than taking its colour), and faded in from the lens.
    vAlpha *= (1.0 - smoothstep(fogNear, fogFar, depth)) * smoothstep(0.6, 1.8, depth);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5)) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/**
 * Dust hanging in the air round the camera, and embers rising off the nearest flames, drawn in one call: every mote is placed once, and the
 * GPU moves it (a slow wander, drift and settle from the time), wraps it into a box that follows the camera, and lights it by its distance
 * to the flames in `lights` (at most `DUST_LIGHTS`, read each frame), so the dust glows in the torch pools and is all but gone between them.
 * Each ember belongs to one of those flames and rises off it. Nothing is touched per mote on the CPU. Render-only.
 */
export class Dustfall extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  /**
   * The flames' lights, the same one in the same place frame to frame while it burns (an ember keeps to its flame's slot). A light with
   * no intensity, or a slot with none, lights nothing.
   */
  lights: readonly THREE.PointLight[] = [];

  constructor(look: DustLook) {
    const [bx, by, bz] = look.box;
    const embers = look.embers * DUST_LIGHTS;
    const count = look.count + embers;
    const positions = new Float32Array(count * 3);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * bx;
      positions[i * 3 + 1] = Math.random() * by;
      positions[i * 3 + 2] = Math.random() * bz;
      rand[i * 4] = Math.random();
      rand[i * 4 + 1] = Math.random();
      rand[i * 4 + 2] = Math.random();
      rand[i * 4 + 3] = i < look.count ? -1 : (i - look.count) % DUST_LIGHTS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));

    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uCamera: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(bx, by, bz) },
      uWander: { value: look.wander },
      uDrift: { value: new THREE.Vector2(look.drift[0], look.drift[1]) },
      uSettle: { value: look.settle },
      uSize: { value: 1 },
      uEmberSize: { value: 1 },
      uEmberRise: { value: look.emberRise },
      uColor: { value: new THREE.Color(look.color) },
      uAmbient: { value: look.ambient },
      uGain: { value: look.gain },
      uOpacity: { value: look.opacity },
      uLights: { value: Array.from({ length: DUST_LIGHTS }, () => new THREE.Vector4()) },
      uLightColors: { value: Array.from({ length: DUST_LIGHTS }, () => new THREE.Vector4()) },
    };
    // The motes add light (dust caught in a torch's beam), so they never darken what is behind them.
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending });
    super(geometry, material);
    this.name = 'dustfall';
    // It is always round the camera: never culled, drawn after the Arena.
    this.frustumCulled = false;
    this.renderOrder = 1;

    const buffer = new THREE.Vector2();
    this.onBeforeRender = (renderer, _scene, camera) => {
      // Wrapped to keep float precision in the shader: the motes jump once an hour.
      uniforms.uTime.value = (performance.now() / 1000) % 3600;
      uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld);
      // Something `size` metres across, at depth d, covers size * (pixels per metre at depth 1) / d pixels.
      if (camera instanceof THREE.PerspectiveCamera) {
        renderer.getDrawingBufferSize(buffer);
        const perMetre = buffer.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
        uniforms.uSize.value = look.size * perMetre;
        uniforms.uEmberSize.value = look.emberSize * perMetre;
      }
      for (let k = 0; k < DUST_LIGHTS; k++) {
        const light = this.lights[k];
        const at = uniforms.uLights.value[k]!;
        const tint = uniforms.uLightColors.value[k]!;
        if (!light || light.intensity <= 0) {
          tint.w = 0;
          continue;
        }
        // Its world matrix is this frame's: the scene's are all brought up to date before anything is drawn.
        at.set(light.matrixWorld.elements[12]!, light.matrixWorld.elements[13]!, light.matrixWorld.elements[14]!, light.intensity);
        tint.set(light.color.r, light.color.g, light.color.b, light.distance > 0 ? light.distance : 12);
      }
    };
  }
}
