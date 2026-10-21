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

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  uniform vec3 uHighlight;
  uniform vec3 uHorizon;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

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
    // Domain-warped clouds, drifting slowly.
    vec3 q = dir * 2.2 + vec3(0.0, 0.0, uTime * 0.004);
    vec3 warp = vec3(fbm(q), fbm(q + 5.2), fbm(q + 9.7));
    float cloud = fbm(q + 1.8 * warp);
    float wisps = fbm(dir * 6.0 + 2.5 * warp);
    vec3 color = uDeep * 0.5;
    color = mix(color, uDeep, smoothstep(0.3, 0.6, cloud));
    color = mix(color, uGlow, smoothstep(0.45, 0.75, cloud) * 0.9);
    color += uHighlight * pow(smoothstep(0.45, 0.85, wisps * cloud * 1.6), 2.0) * 0.7;
    // Stars, dimmed where the nebula is thick.
    float s = stars(dir, 140.0, 0.985) + 0.6 * stars(dir, 320.0, 0.992);
    color += vec3(0.9, 0.92, 1.0) * s * (1.0 - 0.6 * smoothstep(0.45, 0.8, cloud));
    // The mist rises from the horizon and fills everything below it.
    float mist = smoothstep(0.22, -0.08, dir.y);
    color = mix(color, uHorizon, mist);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * A space sky round the camera: a drifting nebula over a field of twinkling stars, sinking into
 * the horizon colour (the fog's) towards and below the horizon. Drawn first, behind everything, and
 * never fogged. Render-only.
 */
export function sky(look: SkyLook): THREE.Mesh {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(look.deep) },
    uGlow: { value: new THREE.Color(look.glow) },
    uHighlight: { value: new THREE.Color(look.highlight) },
    uHorizon: { value: new THREE.Color(look.horizon) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), material);
  dome.name = 'sky';
  // It is always round the camera: never culled, drawn before the Arena.
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  dome.matrixAutoUpdate = false;
  const at = new THREE.Vector3();
  dome.onBeforeRender = (_renderer, _scene, camera) => {
    // Wrapped to keep float precision in the shader.
    uniforms.uTime.value = (performance.now() / 1000) % 3600;
    // Centred on the camera: the parent (an Arena's root) sits at the origin, unmoved.
    dome.matrixWorld.makeTranslation(at.setFromMatrixPosition(camera.matrixWorld));
  };
  return dome;
}
