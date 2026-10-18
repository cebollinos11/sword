import * as THREE from 'three';

/** How an Arena's snow falls: how many flakes, in how big a box round the camera (m), how fast, how big, and the wind. */
export interface SnowfallLook {
  readonly count: number;
  readonly box: readonly [number, number, number];
  /** Fall speed (m/s); each flake varies around it. */
  readonly fall: number;
  /** A flake's size across (m). */
  readonly size: number;
  /** Steady drift (m/s) along x and z. */
  readonly wind: readonly [number, number];
  readonly color: number;
  readonly opacity: number;
}

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uBox;
  uniform float uFall;
  uniform vec2 uWind;
  uniform float uSize;
  attribute vec2 aRand;
  varying float vFade;
  void main() {
    vec3 p = position;
    float t = uTime;
    p.y -= t * uFall * (0.7 + 0.6 * aRand.x);
    p.x += t * uWind.x + 0.35 * sin(t * 0.9 + aRand.y * 6.2832);
    p.z += t * uWind.y + 0.35 * cos(t * 0.7 + aRand.x * 6.2832);
    // Wrap into the box round the camera, so the same flakes fall wherever it goes.
    p = mod(p - uCamera + 0.5 * uBox, uBox) - 0.5 * uBox + uCamera;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float depth = -mvPosition.z;
    gl_PointSize = max(1.0, uSize * (0.6 + 0.8 * aRand.y) / depth);
    // Flakes right at the lens would be big blots: fade them in from half a metre out.
    vFade = smoothstep(0.5, 2.0, depth);
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5)) * uOpacity * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

/**
 * Falling snow round the camera, drawn in one call: every flake is placed once,
 * and the GPU moves it (fall, sway and wind from the time) and wraps it into a
 * box that follows the camera. Nothing is touched per flake on the CPU. Render-only.
 */
export function snowfall(look: SnowfallLook): THREE.Points {
  const [bx, by, bz] = look.box;
  const positions = new Float32Array(look.count * 3);
  const rand = new Float32Array(look.count * 2);
  for (let i = 0; i < look.count; i++) {
    positions[i * 3] = Math.random() * bx;
    positions[i * 3 + 1] = Math.random() * by;
    positions[i * 3 + 2] = Math.random() * bz;
    rand[i * 2] = Math.random();
    rand[i * 2 + 1] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 2));

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uCamera: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(bx, by, bz) },
    uFall: { value: look.fall },
    uWind: { value: new THREE.Vector2(look.wind[0], look.wind[1]) },
    uSize: { value: 1 },
    uColor: { value: new THREE.Color(look.color) },
    uOpacity: { value: look.opacity },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true });
  const points = new THREE.Points(geometry, material);
  // It is always round the camera: never culled, drawn after the Arena.
  points.frustumCulled = false;
  points.renderOrder = 1;

  const buffer = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    // Wrapped to keep float precision in the shader: the flakes jump once an hour.
    uniforms.uTime.value = (performance.now() / 1000) % 3600;
    uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld);
    // A flake `size` metres across, at depth d, covers size * (pixels per metre at depth 1) / d pixels.
    if (camera instanceof THREE.PerspectiveCamera) {
      renderer.getDrawingBufferSize(buffer);
      uniforms.uSize.value = (look.size * buffer.y) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
  };
  return points;
}
