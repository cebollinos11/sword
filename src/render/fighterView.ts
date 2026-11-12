import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { arenaOf, BONES, fighterPose, JOINT_NAMES, TICK_SECONDS, type BladeTransform, type JointName, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import { sizedTuning, weaponByName, type Size, type SkeletonTuning, type TuningData, type WeaponTuning } from '../tuning';
import { BodyCut } from './bodyCut';
import { defaultBody, loadBodyModel, type Body, type BodyModel } from './bodyModel';
import { piecesOfFall, severing, type Pieces } from './dismember';
import { ragdollPose } from './ragdoll';
import { sheathedBlade } from './sheathed';
import { chainLinks, FLAIL_LINKS, flailBallRadius, flailChainOf, linkSpacing, reachOf, rigidBall, sheathedFlail, shaftEnd, shaftLength, type FlailChain } from './flailChain';
import { bladeSteel } from './steel';
import { MAX_MARKS, type BladeMark } from './bladeBlood';
import { bodyBloodShader, bodyBloodUniforms, restFrames, setBodyBlood, type BodyMark } from './bodyBlood';
import { boneFrames, type BodyBone, type BoneFrame } from './bodyRig';
import { setDitherFade } from './dither';

export const FIGHTER_COLOURS = [0xf1c40f, 0x2e86c1];

/** Each team's colours: yellow for team 0, blue for team 1, a different shade for each teammate (the first is FIGHTER_COLOURS'). */
export const TEAM_COLOURS: readonly (readonly number[])[] = [
  [0xf1c40f, 0xf9e07a, 0xb7950b, 0xf39c12],
  [0x2e86c1, 0x76c3ee, 0x1b4f72, 0x16a085],
];

/** The colour of a team's `k`-th Fighter (in Fighter order). */
export function teamColour(team: number, k: number): number {
  const shades = TEAM_COLOURS[team] ?? FIGHTER_COLOURS;
  return shades[k % shades.length]!;
}

/** Every Fighter's colour: its team's, shaded by its place among its teammates. */
export function fighterColours(teams: readonly number[]): number[] {
  return teams.map((team, i) => teamColour(team, teams.slice(0, i).filter((t) => t === team).length));
}

const UP = new THREE.Vector3(0, 1, 0);
const STANDARD: Size = { height: 1, thick: 1 };
/** Radius (m) of a joint's sphere on the bare Skeleton. */
const JOINT_RADIUS = 0.055;

/** Bone thickness (radius, metres) by bone; anything unlisted is a limb. */
function boneRadius(a: JointName, b: JointName): number {
  if (a === 'pelvis' && b === 'chest') return 0.13;
  if (a === 'chest' && b === 'head') return 0.045;
  if (b === 'leftToe' || b === 'rightToe') return 0.04;
  return 0.05;
}

/**
 * A Fighter drawn as its Body: the bare Skeleton from primitives (one
 * flat-shaded colour, a cylinder per bone, a sphere per joint), or a skinned
 * model whose bones follow the Skeleton, shown in place of the primitives once
 * it has loaded. Its Weapon is drawn to the Weapon's dimensions (a sword:
 * blade, crossguard, grip and pommel; a polearm: shaft, axe blade, spike and
 * back hook over the Head; a hammer: shaft and a rectangular head across the tip; a flail: shaft, chain and a spiked
 * ball, the ball's centre on the Head's). It only reads poses.
 */
export class FighterView {
  readonly root = new THREE.Group();
  private readonly skeleton = new THREE.Group();
  private model: BodyModel | undefined;
  /** The model in pieces (Dismemberment), kept for as long as it is asked for the same cut: scrubbing over a Death cuts it once. */
  private cut: { readonly body: BodyCut; readonly of: Pieces; readonly size: Size } | undefined;
  /** Whether the body is drawn at all (`bodyVisible`), and whether the model was last drawn in pieces. */
  private bodyOn = true;
  private inPieces = false;
  private readonly built: SkeletonTuning;
  private readonly bones: { mesh: THREE.Mesh; a: JointName; b: JointName }[] = [];
  /** A severed bone's far half on the bare Skeleton (its stump to its second joint), one per severed bone, made as needed. */
  private readonly stubs: THREE.Mesh[] = [];
  /** The flesh on each cut end of the bare Skeleton, two per severed bone, made as needed, sharing `fleshMaterial`. */
  private readonly caps: THREE.Mesh[] = [];
  private flesh: THREE.MeshLambertMaterial | undefined;
  private readonly primitive: { readonly material: THREE.Material; readonly cylinder: THREE.BufferGeometry };
  private readonly joints = new Map<JointName, THREE.Mesh>();
  private readonly head: THREE.Mesh;
  private readonly headRadius: number;
  private readonly sword: SwordMeshes;
  private readonly polearm: PolearmMeshes;
  private readonly hammer: HammerMeshes;
  private readonly staff: StaffMeshes;
  private readonly dagger: DaggerMeshes;
  private readonly flail: FlailMeshes;
  /** Blood on the Weapon (`setBlood`): one mesh per mark, made as needed, sharing `bloodMaterial`. */
  private readonly bloodMeshes: THREE.Mesh[] = [];
  /** Made with the first mark (so a view that never bloodies draws no smear texture). */
  private bloodMaterial: THREE.MeshLambertMaterial | undefined;
  private readonly shapes: { readonly box: THREE.BufferGeometry; readonly point: THREE.BufferGeometry; readonly cone: THREE.BufferGeometry };
  private blood: readonly BladeMark[] = [];
  /** Blood on the body (`setWounds`), drawn by the body's own materials, which all read `woundUniforms`. */
  private wounds: readonly BodyMark[] = [];
  private readonly woundUniforms = bodyBloodUniforms();
  /** The frames of the pose the model is built in: where its shader sees its vertices. */
  private readonly rest: Record<BodyBone, BoneFrame>;
  /** The geometries and materials the primitives share (made in the constructor). */
  private readonly owned: { dispose(): void }[] = [];
  private disposed = false;
  /** Resolves once its Body is drawn as it will stay: its model in (or failed to load), or at once for the bare Skeleton. */
  readonly ready: Promise<void>;

  constructor(colour: number, tuning: TuningData, wears: Body = defaultBody()) {
    const body = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
    const steel = bladeSteel();
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true });
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 8);
    // A four-sided pyramid whose base is the unit box's end face, so a sword's point meets its blade flush.
    const point = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, false, Math.PI / 4);
    this.shapes = { box, point, cone };
    this.primitive = { material: body, cylinder };
    this.owned.push(body, steel, dark, wood, cylinder, sphere, box, cone, point);
    bodyBloodShader(body, this.woundUniforms);
    this.rest = restFrames(tuning.skeleton);

    for (const [a, b] of BONES) {
      const mesh = new THREE.Mesh(cylinder, body);
      mesh.userData.radius = boneRadius(a, b);
      this.bones.push({ mesh, a, b });
      this.skeleton.add(mesh);
    }
    for (const name of JOINT_NAMES) {
      if (name === 'head' || name === 'chest' || name === 'pelvis') continue;
      const mesh = new THREE.Mesh(sphere, body);
      mesh.scale.setScalar(JOINT_RADIUS);
      this.joints.set(name, mesh);
      this.skeleton.add(mesh);
    }
    this.head = new THREE.Mesh(sphere, body);
    this.headRadius = tuning.skeleton.headRadius;
    this.built = tuning.skeleton;
    this.head.scale.setScalar(this.headRadius);
    this.skeleton.add(this.head);
    this.root.add(this.skeleton);
    this.ready = Promise.resolve();
    if (wears !== 'skeleton') {
      // Until it loads (or if it cannot), the Fighter is drawn as its Skeleton.
      this.ready = loadBodyModel(wears, colour, tuning.skeleton).then(
        (model) => {
          if (this.disposed) return;
          this.model = model;
          model.root.traverse((o) => {
            if (o instanceof THREE.SkinnedMesh) bodyBloodShader(o.material as THREE.Material, this.woundUniforms);
          });
          model.root.visible = this.bodyOn;
          this.skeleton.visible = false;
          this.root.add(model.root);
        },
        (e: unknown) => console.error(`Could not load the ${wears} Body model`, e),
      );
    }

    this.sword = {
      group: new THREE.Group(),
      blade: new THREE.Mesh(box, steel),
      point: new THREE.Mesh(point, steel),
      crossguard: new THREE.Mesh(box, dark),
      grip: new THREE.Mesh(cylinder, dark),
      pommel: new THREE.Mesh(sphere, steel),
    };
    this.sword.group.add(this.sword.blade, this.sword.point, this.sword.crossguard, this.sword.grip, this.sword.pommel);
    this.polearm = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      axe: new THREE.Mesh(box, steel),
      hook: new THREE.Mesh(box, steel),
      spike: new THREE.Mesh(cone, steel),
    };
    this.polearm.group.add(this.polearm.shaft, this.polearm.axe, this.polearm.hook, this.polearm.spike);
    this.hammer = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      head: new THREE.Mesh(box, steel),
      collar: new THREE.Mesh(cylinder, dark),
    };
    this.hammer.group.add(this.hammer.shaft, this.hammer.head, this.hammer.collar);
    this.staff = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      buttCap: new THREE.Mesh(cylinder, dark),
      tipCap: new THREE.Mesh(cylinder, dark),
    };
    this.staff.group.add(this.staff.shaft, this.staff.buttCap, this.staff.tipCap);
    this.dagger = {
      group: new THREE.Group(),
      blade: Array.from({ length: DAGGER_SEGMENTS }, (_, i) => new THREE.Mesh(i === DAGGER_SEGMENTS - 1 ? point : box, steel)),
      guard: new THREE.Mesh(box, dark),
      grip: new THREE.Mesh(cylinder, dark),
      pommel: new THREE.Mesh(sphere, steel),
    };
    this.dagger.group.add(...this.dagger.blade, this.dagger.guard, this.dagger.grip, this.dagger.pommel);
    // Drawn at 240 lines the links are a few pixels each and the ball a dozen across: the chain is one instanced draw and the ball
    // and its spikes one merged mesh, so a flail is four draws (shaft, cap, chain, ball), not two dozen.
    const link = new THREE.TorusGeometry(1, 0.28, 4, 6);
    const spikedBall = spikedBallGeometry();
    this.owned.push(link, spikedBall);
    const links = new THREE.InstancedMesh(link, dark, FLAIL_LINKS);
    // Its bounding sphere is worked out once from where the links first were; they move every frame, so it is never culled.
    links.frustumCulled = false;
    this.flail = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      cap: new THREE.Mesh(cylinder, dark),
      links,
      ball: new THREE.Mesh(spikedBall, steel),
    };
    this.flail.group.add(this.flail.shaft, this.flail.cap, this.flail.links, this.flail.ball);
    this.root.add(this.sword.group, this.polearm.group, this.hammer.group, this.staff.group, this.dagger.group, this.flail.group);
  }

  /** Free what this view made: the primitives' geometries and materials, a loaded model's own materials (its geometry and textures are the shared template's), and its pieces. */
  dispose(): void {
    this.disposed = true;
    for (const o of this.owned) o.dispose();
    this.cut?.body.dispose();
    this.model?.root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) (o.material as THREE.Material).dispose();
    });
  }

  /** The blood on its Weapon (`BladeBlood`), drawn from the next `update` on: none, a clean Weapon. */
  setBlood(marks: readonly BladeMark[]): void {
    this.blood = marks;
  }

  /** The blood on its body (`BodyBlood`), drawn from the next `update` on: none, a clean body. */
  setWounds(marks: readonly BodyMark[]): void {
    this.wounds = marks;
  }

  /** Draw the body (Skeleton or model) at all; off leaves only the Weapon, e.g. for a picture of it. */
  set bodyVisible(on: boolean) {
    this.bodyOn = on;
    this.skeleton.visible = on && !this.model;
    if (this.model) this.model.root.visible = on && !this.inPieces;
    if (this.cut) this.cut.body.root.visible = on && this.inPieces;
  }

  /** How much of it shows, 0 (none) to 1 (all): between them it is dithered (`dither.ts`), crossfading with a Soldier's impostor. */
  setFade(fade: number): void {
    if (fade >= 1 && this.root.userData.fade === undefined) return;
    setDitherFade(this.root, fade);
  }

  /**
   * Draw a solved pose, holding `weapon` (the Fighter's Weapon from Tuning Data, at the Fighter's Size when it has one), in a body
   * `size` tall and thick (default: the standard body): limbs, joints and the head are drawn that much thicker.
   * `pieces`: its Death Ragdoll is in pieces (Dismemberment, `drawnPose`). On the bare Skeleton each severed bone is drawn
   * as its two halves, joint to cut end, with flesh on each cut end; a model's mesh is cut where the bones are (`BodyCut`),
   * once per Death, and each piece follows its own pose.
   */
  update(pose: SkeletonPose, weapon: WeaponTuning, size: Size = STANDARD, pieces?: Pieces): void {
    const p = pose.joints;
    let cut = 0;
    for (const { mesh, a, b } of this.bones) {
      const radius = (mesh.userData.radius as number) * size.thick;
      const stump = pieces?.stumps.find((s) => s.bone[0] === a && s.bone[1] === b);
      if (!stump) {
        placeCylinder(mesh, p[a], p[b], radius);
        continue;
      }
      placeCylinder(mesh, p[a], stump.ends[0], radius);
      placeCylinder(this.stub(cut), stump.ends[1], p[b], radius);
      placeCap(this.cap(2 * cut), p[a], stump.ends[0], radius);
      placeCap(this.cap(2 * cut + 1), p[b], stump.ends[1], radius);
      cut++;
    }
    for (let k = 0; k < this.stubs.length; k++) this.stubs[k]!.visible = k < cut;
    for (let k = 0; k < this.caps.length; k++) this.caps[k]!.visible = k < 2 * cut;
    for (const [name, mesh] of this.joints) {
      mesh.position.set(p[name].x, p[name].y, p[name].z);
      // No wider than the body is tall, so a short wide Fighter's ankles stay above the floor.
      mesh.scale.setScalar(JOINT_RADIUS * Math.min(size.thick, size.height));
    }
    this.head.position.set(p.head.x, p.head.y, p.head.z);
    this.head.scale.setScalar(this.headRadius * size.height);
    if (this.model) {
      const cut = pieces && pieces.severed.length > 0 ? this.cutBody(this.model, pieces, size) : undefined;
      this.inPieces = cut !== undefined;
      if (this.cut) this.cut.body.root.visible = this.bodyOn && this.inPieces;
      this.model.root.visible = this.bodyOn && !this.inPieces;
      if (cut) cut.pose(pieces!, pose.blade, size);
      else this.model.rig.pose(p, pose.blade, size);
    }
    this.sword.group.visible = weapon.look === 'sword';
    this.polearm.group.visible = weapon.look === 'polearm';
    this.hammer.group.visible = weapon.look === 'hammer';
    this.staff.group.visible = weapon.look === 'staff';
    this.dagger.group.visible = weapon.look === 'dagger';
    this.flail.group.visible = weapon.look === 'flail';
    if (weapon.look === 'polearm') placePolearm(this.polearm, pose.blade, weapon);
    else if (weapon.look === 'hammer') placeHammer(this.hammer, pose.blade, weapon);
    else if (weapon.look === 'staff') placeStaff(this.staff, pose.blade, weapon);
    else if (weapon.look === 'dagger') placeDagger(this.dagger, pose.blade, weapon);
    else if (weapon.look === 'flail') placeFlail(this.flail, pose.blade, weapon, (pose as DrawnPose).flail);
    else placeSword(this.sword, pose.blade, weapon);
    this.placeBlood(pose.blade, weapon, (pose as DrawnPose).flail);
    // The shader bloodies a model's skin where it stands before its bones move it (the rest pose; in pieces, the pose it was
    // cut in), and the bare Skeleton's primitives where they are drawn.
    if (this.wounds.length === 0) this.woundUniforms.uBloodCount.value = 0;
    else if (!this.model) setBodyBlood(this.woundUniforms, this.wounds, boneFrames(p), size);
    else if (this.inPieces) setBodyBlood(this.woundUniforms, this.wounds, boneFrames(pieces!.fellIn.joints), size);
    else setBodyBlood(this.woundUniforms, this.wounds, this.rest);
  }

  /** The model cut into `pieces`: the one already made, if it is of the same cut (the same bones, cut at the same places of the same pose). */
  private cutBody(model: BodyModel, pieces: Pieces, size: Size): BodyCut {
    if (this.cut && this.cut.size.height === size.height && this.cut.size.thick === size.thick && sameCut(this.cut.of, pieces)) return this.cut.body;
    if (this.cut) {
      this.root.remove(this.cut.body.root);
      this.cut.body.dispose();
    }
    const body = new BodyCut(model, this.built, pieces, size, this.fleshOf());
    this.cut = { body, of: pieces, size };
    this.root.add(body.root);
    // Faded with the rest of the view, if it is fading.
    if (this.root.userData.fade !== undefined) setDitherFade(this.root, (this.root.userData.fade as { value: number }).value);
    return body;
  }

  /** The view's flesh material, made the first time something is cut. */
  private fleshOf(): THREE.MeshLambertMaterial {
    if (!this.flesh) {
      this.flesh = fleshMaterial();
      this.owned.push(this.flesh);
    }
    return this.flesh;
  }

  /** The `k`-th severed bone's far half on the bare Skeleton, made the first time it is needed. */
  private stub(k: number): THREE.Mesh {
    while (this.stubs.length <= k) {
      const mesh = new THREE.Mesh(this.primitive.cylinder, this.primitive.material);
      this.stubs.push(mesh);
      this.skeleton.add(mesh);
    }
    return this.stubs[k]!;
  }

  /** The `k`-th cut end's flesh on the bare Skeleton, made the first time it is needed. */
  private cap(k: number): THREE.Mesh {
    if (this.caps.length > k) return this.caps[k]!;
    while (this.caps.length <= k) {
      const mesh = new THREE.Mesh(this.primitive.cylinder, this.fleshOf());
      this.caps.push(mesh);
      this.skeleton.add(mesh);
    }
    // Faded with the rest of the view, if it is fading.
    if (this.root.userData.fade !== undefined) setDitherFade(this.root, (this.root.userData.fade as { value: number }).value);
    return this.caps[k]!;
  }

  /** Lay each blood mark on the striking part nearest where it struck. */
  private placeBlood(b: BladeTransform, w: WeaponTuning, chain?: FlailChain): void {
    const marks = this.blood;
    const n = Math.min(marks.length, MAX_MARKS);
    if (n > 0 && !this.bloodMaterial) {
      this.bloodMaterial = bladeBloodMaterial();
      this.owned.push(this.bloodMaterial);
      // Faded with the rest of the view, if it is fading.
      if (this.root.userData.fade !== undefined) setDitherFade(this.root, (this.root.userData.fade as { value: number }).value);
    }
    while (this.bloodMeshes.length < n) {
      const mesh = new THREE.Mesh(this.shapes.box, this.bloodMaterial);
      this.bloodMeshes.push(mesh);
      this.root.add(mesh);
    }
    for (let k = 0; k < this.bloodMeshes.length; k++) this.bloodMeshes[k]!.visible = k < n;
    if (n === 0) return;
    const len = weaponFrame(b);
    for (let k = 0; k < n; k++) {
      const m = marks[k]!;
      const mesh = this.bloodMeshes[k]!;
      // Each a hair proud of the last, so overlapping marks do not fight.
      const proud = 1.06 + k * 0.012;
      const at = m.t * len;
      // Mirrored by its look, so the one smear does not repeat.
      const flipX = m.look < 0.5 ? -1 : 1;
      const flipY = (m.look * 4) % 1 < 0.5 ? -1 : 1;
      if (w.look === 'flail') {
        const r = flailBallRadius(w);
        const end = shaftLength(w, len);
        mesh.geometry = this.shapes.box;
        if (at < end) {
          // A shaft contact: a smear round the shaft where it struck.
          const l = Math.min(end, markLength(m));
          placeInFrame(mesh, clampCentre(at, 0, end, l), 0, [0.022 * proud * flipX, l * flipY, 0.022 * proud]);
        } else {
          // On the ball: a patch on its leading face, moved round it by its look; it rides the ball where it is drawn.
          const l = r * (0.5 + 0.6 * m.strength);
          placeInFrame(mesh, len - w.head / 2 + (m.look - 0.5) * r, r * 0.92 * proud, [l * flipX, l * flipY, r * 0.25]);
          if (chain) {
            // Carried from the rigid ball to the drawn one and turned with it, as `placeFlail` turns the ball and its spikes.
            const rigid = rigidBall(b, w);
            const last = chain.links[chain.links.length - 1] ?? shaftEnd(b, w);
            chainDir.set(chain.ball.x - last.x, chain.ball.y - last.y, chain.ball.z - last.z);
            if (chainDir.lengthSq() < 1e-12) chainDir.copy(yAxis);
            ballTurn.setFromUnitVectors(yAxis, chainDir.normalize());
            mesh.position.sub(tmpA.set(rigid.x, rigid.y, rigid.z)).applyQuaternion(ballTurn).add(tmpB.set(chain.ball.x, chain.ball.y, chain.ball.z));
            mesh.quaternion.premultiply(ballTurn);
          }
        }
      } else if (w.look === 'staff') {
        // A smear round the shaft where it struck.
        const l = Math.min(len + w.gripLength, markLength(m));
        mesh.geometry = this.shapes.box;
        placeInFrame(mesh, clampCentre(at, -w.gripLength, len, l), 0, [0.026 * proud * flipX, l * flipY, 0.026 * proud]);
      } else if (w.look === 'dagger') {
        // On the curved blade: a smear at `at`, bent out with it and tilted along it.
        const reach = Math.max(len - DAGGER_GUARD, 0.01);
        const l = Math.min(reach * 0.5, markLength(m));
        const centre = clampCentre(at, DAGGER_GUARD, len, l);
        mesh.geometry = this.shapes.box;
        placeInFrame(mesh, centre, daggerBend(len, centre), [0.012 * proud * flipX, l * flipY, daggerWidth(len, centre) * 1.02]);
        mesh.quaternion.multiply(daggerTilt.setFromAxisAngle(tiltAxis, daggerSlope(len, centre)));
      } else if (w.look === 'hammer') {
        const head = Math.max(w.head, 0.05);
        const l = head * (0.45 + 0.55 * m.strength);
        mesh.geometry = this.shapes.box;
        placeInFrame(mesh, clampCentre(at, len - head, len, l), 0, [head * 0.85 * proud * flipX, l * flipY, head * 2.4 * 1.02]);
      } else if (w.look === 'polearm') {
        const spike = Math.min(0.18, w.head * 0.5);
        const axe = Math.max(w.head - spike, 0.05) * 0.8;
        if (at > len - spike) {
          mesh.geometry = this.shapes.cone;
          placeInFrame(mesh, len - spike / 2, 0, [0.02 * proud * flipX, spike * 1.02, 0.02 * proud]);
        } else {
          const l = Math.min(axe, markLength(m));
          const axeStart = len - spike - axe;
          mesh.geometry = this.shapes.box;
          placeInFrame(mesh, clampCentre(at, axeStart, axeStart + axe, l), 0.09, [0.01 * proud * flipX, l * flipY, 0.16 * 1.02]);
        }
      } else {
        const reach = Math.max(len - GUARD, 0.01);
        const point = Math.min(SWORD_POINT, reach * 0.5);
        const blade = reach - point;
        if (at > GUARD + blade + point * 0.4) {
          mesh.geometry = this.shapes.point;
          placeInFrame(mesh, GUARD + blade + point / 2, 0, [0.012 * proud * flipX, point * 1.01, 0.045 * 1.02]);
        } else {
          const l = Math.min(blade, markLength(m));
          mesh.geometry = this.shapes.box;
          placeInFrame(mesh, clampCentre(at, GUARD, GUARD + blade, l), 0, [0.012 * proud * flipX, l * flipY, 0.045 * 1.02]);
        }
      }
    }
  }
}

/** How long a blood mark runs along a blade (m): longer the bloodier, and varied by its look. */
const markLength = (m: BladeMark): number => (0.08 + 0.14 * m.strength) * (0.75 + 0.5 * m.look);

/** The centre nearest `at` for a mark `length` long that stays within [from, to] (centred on it if it is longer). */
function clampCentre(at: number, from: number, to: number, length: number): number {
  if (length >= to - from) return (from + to) / 2;
  return Math.min(to - length / 2, Math.max(from + length / 2, at));
}

/** The smear drawn on a bloody Weapon: made once, shared by every view's blood material. */
let smear: THREE.Texture | undefined;

/**
 * A blade's blood smear, greyscale with ragged alpha (the material tints it): a smeared patch across the whole width (it is
 * mapped across the blade's face, so nothing pokes past the edges), runs streaking from it towards one end, and flecks.
 */
function smearTexture(): THREE.Texture {
  if (smear) return smear;
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // A fixed seed: every smear is the same picture (mirrored per mark).
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const shade = (): string => `rgb(${Math.round(195 + 60 * rand())},${Math.round(195 + 60 * rand())},${Math.round(195 + 60 * rand())})`;
  const blob = (x: number, y: number, r: number): void => {
    g.fillStyle = shade();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  for (let k = 0; k < 70; k++) blob(rand() * W, 70 + rand() * 120, 6 + rand() * 14);
  for (let k = 0; k < 7; k++) {
    // A run, thinning as it goes.
    const x = 4 + rand() * (W - 8);
    const from = 120 + rand() * 60;
    const to = Math.min(H - 4, from + 40 + rand() * 80);
    const width = 2 + rand() * 4;
    for (let y = from; y < to; y += 2) blob(x + Math.sin(y * 0.05) * 1.5, y, (width * (to - y)) / (to - from) + 0.8);
  }
  for (let k = 0; k < 40; k++) blob(rand() * W, 20 + rand() * (H - 40), 1 + rand() * 2.5);
  smear = new THREE.CanvasTexture(c);
  smear.colorSpace = THREE.SRGBColorSpace;
  smear.anisotropy = 4;
  return smear;
}

/** A view's blood material (its own, so its Fighter's dither fade reaches it; the texture is shared). */
function bladeBloodMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: 0xc8141a,
    emissive: 0x4a0000,
    map: smearTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * The flesh of a cut (Dismemberment): dark red, a little emissive so it reads in shadow, like the blood on a blade
 * (`bladeBloodMaterial`) but darker and without its smear. A view's own, so its Fighter's dither fade reaches it.
 */
export function fleshMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: 0x8e0e14, emissive: 0x3a0000, flatShading: true });
}

interface SwordMeshes {
  readonly group: THREE.Group;
  readonly blade: THREE.Mesh;
  readonly point: THREE.Mesh;
  readonly crossguard: THREE.Mesh;
  readonly grip: THREE.Mesh;
  readonly pommel: THREE.Mesh;
}

interface DaggerMeshes {
  readonly group: THREE.Group;
  /** The curved blade's segments, guard to point; the last is the tapered point. */
  readonly blade: THREE.Mesh[];
  readonly guard: THREE.Mesh;
  readonly grip: THREE.Mesh;
  readonly pommel: THREE.Mesh;
}

interface PolearmMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  readonly axe: THREE.Mesh;
  readonly hook: THREE.Mesh;
  readonly spike: THREE.Mesh;
}

interface StaffMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  /** The iron caps on the butt and on the tip. */
  readonly buttCap: THREE.Mesh;
  readonly tipCap: THREE.Mesh;
}

interface HammerMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly collar: THREE.Mesh;
}

interface FlailMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  /** The iron cap on the shaft's end, which the chain hangs from. */
  readonly cap: THREE.Mesh;
  /** One instance per link. */
  readonly links: THREE.InstancedMesh;
  /** The ball with its spikes, one mesh (`spikedBallGeometry`). */
  readonly ball: THREE.Mesh;
}

/** A flail ball's spikes, as directions in the ball's frame: the six faces and the eight corners. */
const FLAIL_SPIKES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const))),
];
/** The ball's radius, and the bottom of a spike (buried a little in it), as shares of the Head's half (`flailBallRadius`). */
const BALL_SHARE = 0.6;
const SPIKE_ROOT = 0.53;
/** A spike's base radius, as a share of the ball's radius. */
const SPIKE_WIDTH = 0.32;

/**
 * The ball and its spikes as one geometry, the Head's half across (scale it by `head / 2`): a low sphere and four-sided spikes, all
 * that shows of either at 240 lines (the ball a dozen pixels across at most, a spike two to four).
 */
function spikedBallGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(BALL_SHARE, 8, 6)];
  const along = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  for (const [x, y, z] of FLAIL_SPIKES) {
    along.set(x, y, z).normalize();
    const spike = new THREE.ConeGeometry(BALL_SHARE * SPIKE_WIDTH, 1 - SPIKE_ROOT, 4);
    turn.setFromUnitVectors(UP, along);
    spike.applyQuaternion(turn).translate(along.x * ((1 + SPIKE_ROOT) / 2), along.y * ((1 + SPIKE_ROOT) / 2), along.z * ((1 + SPIKE_ROOT) / 2));
    parts.push(spike);
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('Could not merge the flail ball');
  return merged;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function placeCylinder(mesh: THREE.Mesh, a: Vec3, b: Vec3, radius: number): void {
  tmpA.set(a.x, a.y, a.z);
  tmpB.set(b.x, b.y, b.z);
  const len = tmpA.distanceTo(tmpB);
  mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  mesh.scale.set(radius, Math.max(len, 1e-4), radius);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).divideScalar(len));
}

/** How thick (m) the flesh on a cut end of the bare Skeleton is, and how much wider than its bone. */
const CAP_THICKNESS = 0.012;
const CAP_WIDEN = 1.08;

/** A cut end's flesh: a disc square to the bone from `joint` to the cut end `end`, flush with that end. */
function placeCap(mesh: THREE.Mesh, joint: Vec3, end: Vec3, radius: number): void {
  tmpA.set(end.x - joint.x, end.y - joint.y, end.z - joint.z);
  const len = tmpA.length();
  if (len > 1e-6) tmpA.divideScalar(len);
  else tmpA.copy(UP);
  mesh.quaternion.setFromUnitVectors(UP, tmpA);
  mesh.position.set(end.x, end.y, end.z).addScaledVector(tmpA, -CAP_THICKNESS / 2 + 0.002);
  mesh.scale.set(radius * CAP_WIDEN, CAP_THICKNESS, radius * CAP_WIDEN);
}

const basis = new THREE.Matrix4();
const orientation = new THREE.Quaternion();
const hilt = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();

/** The Weapon's frame (y: hand → tip, z: the edge, which leads), into `hilt`, the axes and `orientation`; returns its length. */
function weaponFrame(b: BladeTransform): number {
  hilt.set(b.hilt.x, b.hilt.y, b.hilt.z);
  yAxis.set(b.tip.x - b.hilt.x, b.tip.y - b.hilt.y, b.tip.z - b.hilt.z);
  const len = yAxis.length();
  yAxis.divideScalar(len || 1);
  zAxis.set(b.edge.x, b.edge.y, b.edge.z);
  xAxis.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  orientation.setFromRotationMatrix(basis);
  return len;
}

/** Place a mesh in the Weapon's frame: centred `along` the axis from the hand and `out` along the edge, scaled `size` (frame x, y, z). */
function placeInFrame(mesh: THREE.Mesh, along: number, out: number, size: readonly [number, number, number]): void {
  mesh.quaternion.copy(orientation);
  mesh.position.copy(hilt).addScaledVector(yAxis, along).addScaledVector(zAxis, out);
  mesh.scale.set(size[0], size[1], size[2]);
}

/** Where the crossguard sits, in front of the sword hand (m). */
const GUARD = 0.07;
/** How long a sword's tapered point is (m). */
const SWORD_POINT = 0.1;

function placeSword(m: SwordMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  // The blade runs from the guard and tapers to a point at the tip.
  const reach = Math.max(len - GUARD, 0.01);
  const point = Math.min(SWORD_POINT, reach * 0.5);
  const blade = reach - point;
  placeInFrame(m.blade, GUARD + blade / 2, 0, [0.012, blade, 0.045]);
  placeInFrame(m.point, GUARD + blade + point / 2, 0, [0.012, point, 0.045]);
  placeInFrame(m.crossguard, GUARD, 0, [0.03, 0.025, 0.18]);
  const grip = w.gripLength + GUARD;
  placeInFrame(m.grip, GUARD - grip / 2, 0, [0.016, grip, 0.016]);
  placeInFrame(m.pommel, -w.gripLength, 0, [0.028, 0.028, 0.028]);
}

/** Where the dagger's guard sits, in front of the sword hand (m). */
const DAGGER_GUARD = 0.04;
/** How many boxes make up the curved blade. */
const DAGGER_SEGMENTS = 5;
/** How far (m) the blade has bent toward the edge side by its tip: a few cm, so the drawing stays close to the Blade Sweep. */
const DAGGER_CURVE = 0.03;
const daggerTilt = new THREE.Quaternion();
const tiltAxis = new THREE.Vector3(1, 0, 0);

/** The blade's sideways offset (m) at `along` the Weapon: nothing at the guard, `DAGGER_CURVE` at the tip `len`, bending more toward the point. */
function daggerBend(len: number, along: number): number {
  const t = Math.min(1, Math.max(0, (along - DAGGER_GUARD) / Math.max(len - DAGGER_GUARD, 0.01)));
  return DAGGER_CURVE * t * t;
}

/** The angle (radians) the blade has turned toward the edge side at `along`: the slope of `daggerBend`. */
function daggerSlope(len: number, along: number): number {
  const reach = Math.max(len - DAGGER_GUARD, 0.01);
  const t = Math.min(1, Math.max(0, (along - DAGGER_GUARD) / reach));
  return Math.atan((2 * DAGGER_CURVE * t) / reach);
}

/** The blade's width (m) at `along`: broad at the guard, tapering to the point. */
function daggerWidth(len: number, along: number): number {
  const t = Math.min(1, Math.max(0, (along - DAGGER_GUARD) / Math.max(len - DAGGER_GUARD, 0.01)));
  return 0.036 * (1 - 0.85 * t);
}

/** A dagger: a short blade that curves toward the edge side as it tapers to the tip (`len`), a small guard, a grip and a pommel. */
function placeDagger(m: DaggerMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  const reach = Math.max(len - DAGGER_GUARD, 0.01);
  const seg = reach / DAGGER_SEGMENTS;
  m.blade.forEach((mesh, i) => {
    const centre = DAGGER_GUARD + seg * (i + 0.5);
    const last = i === m.blade.length - 1;
    // Each segment is as wide as the blade at its start; the last one is the point, closing on the tip.
    placeInFrame(mesh, centre, daggerBend(len, centre), [0.011, seg * 1.12, daggerWidth(len, last ? centre - seg / 2 : centre)]);
    mesh.quaternion.multiply(daggerTilt.setFromAxisAngle(tiltAxis, daggerSlope(len, centre)));
  });
  placeInFrame(m.guard, DAGGER_GUARD, 0, [0.026, 0.02, 0.1]);
  const grip = w.gripLength + DAGGER_GUARD;
  placeInFrame(m.grip, DAGGER_GUARD - grip / 2, 0, [0.016, grip, 0.016]);
  placeInFrame(m.pommel, -w.gripLength, 0, [0.026, 0.026, 0.026]);
}

function placePolearm(m: PolearmMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  const spike = Math.min(0.18, w.head * 0.5);
  const shaft = w.gripLength + len - spike;
  placeInFrame(m.shaft, -w.gripLength + shaft / 2, 0, [0.018, shaft, 0.018]);
  placeInFrame(m.spike, len - spike / 2, 0, [0.02, spike, 0.02]);
  // The axe blade leads on the edge side, below the spike; the hook juts out behind it.
  const axe = Math.max(w.head - spike, 0.05) * 0.8;
  const at = len - spike - axe / 2;
  placeInFrame(m.axe, at, 0.09, [0.01, axe, 0.16]);
  placeInFrame(m.hook, at, -0.06, [0.01, 0.04, 0.12]);
}

/** A quarterstaff: one wooden shaft from the butt to the tip, a little thicker than the polearm's, with an iron cap on each end. */
function placeStaff(m: StaffMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  const cap = 0.06;
  placeInFrame(m.shaft, (len - w.gripLength) / 2, 0, [0.022, len + w.gripLength, 0.022]);
  placeInFrame(m.buttCap, -w.gripLength + cap / 2, 0, [0.027, cap, 0.027]);
  placeInFrame(m.tipCap, len - cap / 2, 0, [0.027, cap, 0.027]);
}

function placeHammer(m: HammerMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  // The head is a steel block across the tip, its long side along the edge (the faces strike); the shaft runs into it.
  const head = Math.max(w.head, 0.05);
  placeInFrame(m.shaft, (len - w.gripLength) / 2, 0, [0.02, len + w.gripLength, 0.02]);
  placeInFrame(m.head, len - head / 2, 0, [head * 0.85, head, head * 2.4]);
  placeInFrame(m.collar, len - head - 0.04, 0, [0.026, 0.08, 0.026]);
}

const linkTurn = new THREE.Quaternion();
const linkOrientation = new THREE.Quaternion();
const linkPosition = new THREE.Vector3();
const linkScale = new THREE.Vector3();
const linkMatrix = new THREE.Matrix4();
const chainDir = new THREE.Vector3();
const ballTurn = new THREE.Quaternion();

/**
 * A flail: the shaft from the butt to `length - chain - head` along the Weapon, an iron cap on its end, and the chain and ball from there
 * where `chain` has them (`flailChainOf`, docs/plans/flail.md Stage 3: whirling, on the simulated ball in Release, hanging otherwise).
 * Without one (the Motion Editor, a thumbnail) the chain runs straight on along the Weapon, the ball's centre where the Head's is, as
 * the Simulation has it.
 */
function placeFlail(m: FlailMeshes, b: BladeTransform, w: WeaponTuning, chain?: FlailChain): void {
  const len = weaponFrame(b);
  const end = shaftLength(w, len);
  const r = flailBallRadius(w);
  placeInFrame(m.shaft, (end - w.gripLength) / 2, 0, [0.02, end + w.gripLength, 0.02]);
  placeInFrame(m.cap, end - 0.02, 0, [0.026, 0.06, 0.026]);
  const from = shaftEnd(b, w);
  const reach = reachOf(b, w);
  const drawn = chain ?? { ball: rigidBall(b, w), links: chainLinks(from, rigidBall(b, w), w, reach) };
  // The links from the cap to the ball, each along the chain where it is and turned a quarter from the last, so they read as interlocked.
  const size = Math.max(linkSpacing(reach, w).size, 0.005);
  linkScale.set(size * 0.45, size, size * 0.45);
  for (let k = 0; k < FLAIL_LINKS; k++) {
    const at = drawn.links[k]!;
    const before = k === 0 ? from : drawn.links[k - 1]!;
    const after = k === drawn.links.length - 1 ? drawn.ball : drawn.links[k + 1]!;
    chainDir.set(after.x - before.x, after.y - before.y, after.z - before.z);
    if (chainDir.lengthSq() < 1e-12) chainDir.copy(yAxis);
    chainDir.normalize();
    // A torus lies in its own xy plane: stand it along the chain, then a quarter turn every other link.
    linkOrientation.setFromUnitVectors(yAxis, chainDir).multiply(orientation);
    linkTurn.setFromAxisAngle(chainDir, k % 2 === 0 ? 0 : Math.PI / 2);
    linkOrientation.premultiply(linkTurn);
    linkPosition.set(at.x, at.y, at.z);
    m.links.setMatrixAt(k, linkMatrix.compose(linkPosition, linkOrientation, linkScale));
  }
  m.links.instanceMatrix.needsUpdate = true;
  // The ball and its spikes, turned with the chain's last stretch (so they and its blood ride round with it).
  const last = drawn.links[drawn.links.length - 1] ?? from;
  chainDir.set(drawn.ball.x - last.x, drawn.ball.y - last.y, drawn.ball.z - last.z);
  if (chainDir.lengthSq() < 1e-12) chainDir.copy(yAxis);
  chainDir.normalize();
  ballTurn.setFromUnitVectors(yAxis, chainDir);
  m.ball.quaternion.copy(ballTurn).multiply(orientation);
  m.ball.position.set(drawn.ball.x, drawn.ball.y, drawn.ball.z);
  m.ball.scale.setScalar(r / BALL_SHARE);
}

/** Interpolate two solved poses (render-only smoothing between Ticks). */
export function lerpPose(a: SkeletonPose, b: SkeletonPose, t: number): SkeletonPose {
  const l = (u: Vec3, v: Vec3): Vec3 => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, z: u.z + (v.z - u.z) * t });
  const joints = {} as Record<JointName, Vec3>;
  for (const n of JOINT_NAMES) joints[n] = l(a.joints[n], b.joints[n]);
  return { joints, blade: { hilt: l(a.blade.hilt, b.blade.hilt), tip: l(a.blade.tip, b.blade.tip), edge: l(a.blade.edge, b.blade.edge) } };
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/** Whether two bodies in pieces are of one cut: the same bones severed at the same places, of the same pose. */
function sameCut(a: Pieces, b: Pieces): boolean {
  if (a === b) return true;
  if (a.severed.length !== b.severed.length) return false;
  for (let k = 0; k < a.severed.length; k++) {
    const [s, t] = [a.severed[k]!, b.severed[k]!];
    if (s.bone[0] !== t.bone[0] || s.bone[1] !== t.bone[1] || s.girth !== t.girth || !sameVec(s.at, t.at) || !sameVec(s.normal, t.normal)) return false;
  }
  return JOINT_NAMES.every((n) => sameVec(a.fellIn.joints[n], b.fellIn.joints[n]));
}

/** A pose as `drawnPose` draws it: a Death Ragdoll in pieces (Dismemberment) has its `pieces`, and how long ago it fell. */
export interface DrawnPose extends SkeletonPose {
  readonly pieces?: Pieces;
  /** With `pieces`: seconds of Duel time since the Death (its stumps bleed for a while, `stumpDrops`). */
  readonly since?: number;
  /** A Weapon drawn as a flail: its loose chain and ball where they are drawn (`flailChainOf`; absent: rigid, as the Simulation has it). */
  readonly flail?: FlailChain;
}

/** Each Death Ragdoll pose's pieces, so a body lying still is not taken apart again every frame. */
const piecesCache = new WeakMap<SkeletonPose, Pieces>();

/**
 * The pose to draw for Fighter `i` a share `alpha` of the way from Tick `from` to Tick `to` (the same Duel):
 * its solved Skeletons interpolated, or once it has fallen, its Death Ragdoll at that moment. While it is Sheathed (as of `to`),
 * the Weapon is in its slot on the body, not in the hand (ADR 0017: only drawing moves it there).
 * `dismember`: a Death whose cut severs bones falls in pieces, and the pose has its `pieces` (pass them on to
 * `FighterView.update`); off (a thumbnail, a Soldier's impostor clip), every Death falls whole.
 */
export function drawnPose(from: SimState, to: SimState, i: number, alpha: number, tuning: TuningData, dismember = false): DrawnPose {
  const f = to.fighters[i]!;
  const sized = sizedTuning(tuning, f.size);
  const weapon = weaponByName(sized, f.weapon);
  if (f.death) {
    const ticks = from.tick + (to.tick - from.tick) * alpha - f.death.tick;
    const fellIn = fighterPose(f, tuning);
    const severed = dismember ? severing(fellIn, f.death.blow, sized) : [];
    const fall = ragdollPose(fellIn, f.death, ticks * TICK_SECONDS, weapon, sized, arenaOf(tuning, to.arena), f.sheathed, severed);
    // A flail's ball hangs from the falling Weapon onto the floor, or stays on the back with it.
    const flail = weapon.look !== 'flail' ? undefined : f.sheathed ? sheathedFlail(fall.blade, weapon, fall.joints.chest) : flailChainOf(from, to, i, alpha, tuning, fall);
    // Whole, or still whole before the Death's own Tick.
    if (!fall.stumps) return flail ? { ...fall, flail } : fall;
    let pieces = piecesCache.get(fall);
    if (!pieces) {
      pieces = piecesOfFall(f.sheathed ? { ...fellIn, blade: sheathedBlade(fellIn, weapon) } : fellIn, fall, severed, sized);
      piecesCache.set(fall, pieces);
    }
    return { ...fall, pieces, since: ticks * TICK_SECONDS, ...(flail ? { flail } : {}) };
  }
  const pose = lerpPose(fighterPose(from.fighters[i] ?? f, tuning), fighterPose(f, tuning), alpha);
  if (f.sheathed) {
    const blade = sheathedBlade(pose, weapon);
    return weapon.look === 'flail' ? { ...pose, blade, flail: sheathedFlail(blade, weapon, pose.joints.chest) } : { ...pose, blade };
  }
  if (weapon.look !== 'flail') return pose;
  const flail = flailChainOf(from, to, i, alpha, tuning, pose);
  return flail ? { ...pose, flail } : pose;
}
