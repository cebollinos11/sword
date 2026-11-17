/**
 * Shader warm-up. three.js compiles a material's shader the first frame that material is drawn, and on a real GPU driver a
 * handful of compiles holds that frame for a visible hitch. A Delver Run's first frames hide behind its loading bar, but much
 * of what it draws is first drawn later: the Soldiers' impostors as the bar lifts, a promoted Soldier's Body dithering in
 * (`dither.ts`), the first Hit's blood on a blade and the floor. `ShaderWarmUp` compiles all of it up front, against the
 * scene's own lights and fog (which a shader is compiled for), and uploads the textures it reads.
 *
 * It keeps a stand-in of each kind of material alive for as long as it lives: three.js deletes a shader once no material
 * uses it, so without them the last view of a Body dropped (a Pool slot rebound to a Soldier wearing another) would compile
 * its shader again the next time that Body is promoted. Render only.
 */
import * as THREE from 'three';
import type { TuningData } from '../tuning';
import { BODY_MODELS, type Body } from './bodyModel';
import { setDitherFade } from './dither';
import { bladeBloodMaterial, fleshMaterial, FighterView } from './fighterView';
import { ribbonMaterial } from './swingTrail';

/** The share of a model a warm-up stand-in is faded to: anything below 1 compiles the dithered shader. */
const FADED = 0.5;

export class ShaderWarmUp {
  /** Every stand-in, never drawn: only compiled. */
  private readonly root = new THREE.Group();
  private readonly views: FighterView[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private built: Promise<void> | null = null;

  constructor(private readonly tuning: TuningData) {}

  /**
   * Compile, for `scene` as it is now (its lights and fog), every shader it draws and every one a Fighter or an effect may
   * come to draw in it, and upload their textures. Resolves once the shaders are ready (sooner where the browser cannot
   * compile in parallel: then it is all done before this returns).
   */
  async compile(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    await this.build();
    await Promise.all([gl.compileAsync(this.root, camera, scene), gl.compileAsync(scene, camera)]);
    uploadTextures(gl, this.root);
    uploadTextures(gl, scene);
  }

  /** Let go of the stand-ins (their shaders are then freed with the last material using them). */
  dispose(): void {
    for (const v of this.views) v.dispose();
    for (const o of this.owned) o.dispose();
    this.views.length = 0;
    this.owned.length = 0;
    this.root.clear();
    this.built = null;
  }

  private build(): Promise<void> {
    return (this.built ??= this.make());
  }

  private async make(): Promise<void> {
    // Every Body, whole (a party member, a Fighter in full view) and fading (a Soldier being promoted or demoted).
    const bodies: Body[] = ['skeleton', ...BODY_MODELS];
    const pairs = bodies.map((body) => [new FighterView(0xffffff, this.tuning, body), new FighterView(0xffffff, this.tuning, body)] as const);
    for (const v of pairs.flat()) {
      this.views.push(v);
      this.root.add(v.root);
    }
    await Promise.all(this.views.map((v) => v.ready));
    for (const [, faded] of pairs) faded.setFade(FADED);

    // What a view makes only when it is first needed: the blood on its Weapon and the flesh of a cut, whole and fading.
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.owned.push(box);
    const lazy = (): THREE.Group => {
      const group = new THREE.Group();
      const blood = bladeBloodMaterial();
      const flesh = fleshMaterial();
      this.owned.push(blood, flesh);
      group.add(new THREE.Mesh(box, blood), new THREE.Mesh(box, flesh), skinnedStandIn(box, flesh, this.owned));
      return group;
    };
    const whole = lazy();
    const fading = lazy();
    setDitherFade(fading, FADED);

    // The impact particles (sparks, flashes, dust: one material each, made as they burst) and a swing's ribbon.
    const spark = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const ribbon = ribbonMaterial();
    this.owned.push(spark, ribbon);
    this.root.add(whole, fading, new THREE.Mesh(box, spark), new THREE.Mesh(box, ribbon));
  }
}

/** A skinned mesh of `material` (a cut's flesh is skinned to the body's bones), bound to a one-bone skeleton: compiled only, never drawn. */
function skinnedStandIn(geometry: THREE.BufferGeometry, material: THREE.Material, owned: { dispose(): void }[]): THREE.SkinnedMesh {
  const skinned = geometry.clone();
  const n = skinned.getAttribute('position').count;
  skinned.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  skinned.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  owned.push(skinned);
  const mesh = new THREE.SkinnedMesh(skinned, material);
  const bone = new THREE.Bone();
  mesh.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  owned.push(skeleton);
  mesh.bind(skeleton);
  return mesh;
}

/** Upload every texture the materials under `root` read, so none is first sent to the GPU in the middle of play. */
function uploadTextures(gl: THREE.WebGLRenderer, root: THREE.Object3D): void {
  const seen = new Set<THREE.Texture>();
  const take = (value: unknown) => {
    if (value instanceof THREE.Texture && !seen.has(value) && !(value as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) seen.add(value);
  };
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) take(value);
      if (m instanceof THREE.ShaderMaterial) for (const u of Object.values(m.uniforms)) take(u.value);
    }
  });
  // A texture still loading has nothing to send yet; it is uploaded when first drawn.
  for (const t of seen) if (t.image) gl.initTexture(t);
}
