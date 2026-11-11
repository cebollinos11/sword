/**
 * Body blood: a Fighter that is Hit is bloodied where it was struck, and stays so for the rest of the Duel. Render-only,
 * like the other impact effects (ADR 0001): it listens to the Simulation's Hit events and never feeds back.
 *
 * A mark is kept in the frame of the bone it landed on (`boneFrames`: x along the bone, in the standard body's metres), so it
 * moves with the body through every Motion, a Knockdown and the Death Ragdoll alike, whatever the Fighter's Size. How it is
 * drawn is `FighterView`'s business: the body's own shader reddens the surface round each mark (`bodyBloodShader`), so the
 * blood lies on the Body as it is drawn (the bare Skeleton or any model) rather than floating over it.
 */
import * as THREE from 'three';
import { fighterPose, type JointName, type SimState, type Vec3 } from '../sim';
import type { Size, TuningData } from '../tuning';
import { BONE_JOINTS } from './bodyCut';
import { BODY_BONES, boneFrames, boneScale, restJoints, type BodyBone, type BoneFrame } from './bodyRig';
import { patchShader } from './shaderPatch';

/** Blood left on a body by one Hit (or several close together, merged). */
export interface BodyMark {
  /** The Tick of the Hit that laid it (the latest, once merged): a rewind to before it washes it off. */
  tick: number;
  /** The bone it is on. */
  readonly bone: BodyBone;
  /** Where the Hit landed, in the bone's frame. */
  readonly at: Vec3;
  /** How far along the bone (its frame's x) the point of it nearest the Hit is: the blood lies out from there. */
  readonly along: number;
  /** 0..1: how much blood (a Heavy Blow's Hit is 1); a mark hit again gets bloodier. */
  strength: number;
  /** 0..1, fixed when laid: how its splatter is shaped, so marks do not all look alike. */
  readonly look: number;
}

/** Blood laid on Fighter `fighter`'s body by one Hit this Tick. */
export interface BodySplash {
  readonly fighter: number;
  readonly bone: BodyBone;
  readonly at: Vec3;
  readonly along: number;
  readonly strength: number;
}

/** A Hit of this much damage bloodies at full strength (as for the spray: a head Hit with repo Tuning Data). */
const FULL_DAMAGE = 15;
/** Most marks on one body (the shader's limit); a Hit past that bloodies the nearest mark further instead. */
export const MAX_WOUNDS = 8;
/** A Hit this close (m) to a mark on the same bone bloodies that mark further rather than laying a new one. */
const MERGE = 0.06;
/**
 * How far out of the body (m) past where the Hit landed, and how far in towards the bone, a mark reaches: the contact is on
 * a Hit Zone, which may lie a little under or over the model's surface.
 */
const OUT = 0.12;
const IN = 0.1;

/**
 * What a mark can land on: each bone of the body that runs along a bone of the Skeleton, the joints it runs between and
 * about how thick the body is round it (m), so a point on the trunk is the trunk's rather than a nearby limb's. The trunk
 * is also the collar (chest to each shoulder, on the spine) and the hips.
 */
const WOUND_BONES: readonly { bone: BodyBone; a: JointName; b: JointName; girth: number }[] = [
  ...BODY_BONES.flatMap((bone) => {
    const [a, b] = BONE_JOINTS[bone];
    return b ? [{ bone, a, b, girth: bone === 'spine' ? 0.12 : bone === 'head' ? 0.09 : 0.05 }] : [];
  }),
  { bone: 'spine', a: 'chest', b: 'leftShoulder', girth: 0.07 },
  { bone: 'spine', a: 'chest', b: 'rightShoulder', girth: 0.07 },
  { bone: 'hips', a: 'pelvis', b: 'leftHip', girth: 0.1 },
  { bone: 'hips', a: 'pelvis', b: 'rightHip', girth: 0.1 },
];

const STANDARD: Size = { height: 1, thick: 1 };
const scale = new THREE.Vector3();
const v = new THREE.Vector3();
const q = new THREE.Quaternion();

/** How far `p` is from the segment `a` to `b`. */
function distanceToBone(p: Vec3, a: Vec3, b: Vec3): number {
  const [dx, dy, dz] = [b.x - a.x, b.y - a.y, b.z - a.z];
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t, p.z - a.z - dz * t);
}

/**
 * The bone of a body posed with `joints` (of `size`) that the world point `point` is on, that point in the bone's frame, and
 * how far along the bone the point of it nearest to that is.
 */
export function boneAt(joints: Readonly<Record<JointName, Vec3>>, point: Vec3, size: Size = STANDARD): { bone: BodyBone; at: Vec3; along: number } {
  let near = WOUND_BONES[0]!;
  let best = Infinity;
  for (const w of WOUND_BONES) {
    const d = distanceToBone(point, joints[w.a], joints[w.b]) - w.girth * size.thick;
    if (d < best) [near, best] = [w, d];
  }
  const f = boneFrames(joints)[near.bone];
  boneScale(near.bone, size.height, size.thick, scale);
  v.set(point.x, point.y, point.z).sub(f.origin).applyQuaternion(q.copy(f.rotation).invert()).divide(scale);
  // The bone itself runs along its frame's x from its first joint to its second (the hips: no way at all).
  const [a, b] = BONE_JOINTS[near.bone];
  const length = b ? Math.hypot(joints[b].x - joints[a].x, joints[b].y - joints[a].y, joints[b].z - joints[a].z) / scale.x : 0;
  return { bone: near.bone, at: { x: v.x, y: v.y, z: v.z }, along: Math.min(length, Math.max(0, v.x)) };
}

/**
 * The blood one Tick's events lay on bodies, in event order: a Hit or a Dagger Hit that does damage bloodies the defender
 * where it landed.
 */
export function bodySplashes(duel: Pick<SimState, 'events' | 'fighters'>, tuning: TuningData): BodySplash[] {
  const out: BodySplash[] = [];
  for (const e of duel.events) {
    if ((e.type !== 'Hit' && e.type !== 'DaggerHit') || e.damage <= 0) continue;
    const f = duel.fighters[e.defender];
    if (!f) continue;
    const strength = e.type === 'Hit' && e.heavy ? 1 : Math.min(1, Math.max(0.3, e.damage / FULL_DAMAGE));
    out.push({ fighter: e.defender, ...boneAt(fighterPose(f, tuning).joints, e.point, f.size), strength });
  }
  return out;
}

/** Each Fighter's body blood through a Duel. */
export class BodyBlood {
  private readonly marks: BodyMark[][] = [];
  private lastDuelTick = -Infinity;
  /** A seek just happened: the next Tick's Duel time may be earlier without it being a new Duel. */
  private seeked = true;

  constructor(private readonly tuning: TuningData) {}

  /** The blood on Fighter `i`'s body now (none: an empty list). Read-only to the caller. */
  marksOf(i: number): readonly BodyMark[] {
    return this.marks[i] ?? NONE;
  }

  /** Take in Tick `tick`'s Duel: a fresh Duel washes every body, then its Hits bloody theirs. */
  onTick(tick: number, duel: Pick<SimState, 'events' | 'fighters' | 'tick'>, tuning: TuningData = this.tuning): void {
    if (duel.tick < this.lastDuelTick && !this.seeked) this.marks.length = 0;
    this.lastDuelTick = duel.tick;
    this.seeked = false;
    // A benched Fighter's slot is another's when it is next fielded.
    duel.fighters.forEach((f, i) => {
      if (f.benched && this.marks[i]?.length) this.marks[i] = [];
    });
    for (const s of bodySplashes(duel, tuning)) this.splash(tick, s);
  }

  /** The loop jumped to Tick `tick`: a mark laid after it is washed off (a replay lays it again). */
  seek(tick: number): void {
    this.seeked = true;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m?.some((k) => k.tick > tick)) this.marks[i] = m.filter((k) => k.tick <= tick);
    }
  }

  clear(): void {
    this.marks.length = 0;
  }

  private splash(tick: number, s: BodySplash): void {
    const marks = (this.marks[s.fighter] ??= []);
    const apart = (m: BodyMark): number => (m.bone === s.bone ? Math.hypot(m.at.x - s.at.x, m.at.y - s.at.y, m.at.z - s.at.z) : Infinity);
    let near: BodyMark | undefined;
    for (const m of marks) if (!near || apart(m) < apart(near)) near = m;
    if (near && (apart(near) < MERGE || marks.length >= MAX_WOUNDS)) {
      // A full body: the mark least bloody takes it when none is on the same bone.
      if (apart(near) === Infinity) near = marks.reduce((a, b) => (b.strength < a.strength ? b : a));
      near.strength = Math.min(1, near.strength + s.strength * 0.5);
      near.tick = Math.max(near.tick, tick);
      return;
    }
    marks.push({ tick, bone: s.bone, at: s.at, along: s.along, strength: s.strength, look: Math.random() });
  }
}

const NONE: readonly BodyMark[] = [];

/** How far round it (m, on the standard body) a mark reddens the surface: further the bloodier, and varied by its look. */
export const woundRadius = (m: Pick<BodyMark, 'strength' | 'look'>): number => (0.04 + 0.05 * m.strength) * (0.85 + 0.3 * m.look);

/** What the body's shader reads: how many marks, and each one's line through the surface (`a`, `b`: xyz, then its radius and its look). */
export interface BodyBloodUniforms {
  readonly uBloodCount: { value: number };
  readonly uBloodA: { readonly value: THREE.Vector4[] };
  readonly uBloodB: { readonly value: THREE.Vector4[] };
}

export function bodyBloodUniforms(): BodyBloodUniforms {
  const list = (): THREE.Vector4[] => Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4());
  return { uBloodCount: { value: 0 }, uBloodA: { value: list() }, uBloodB: { value: list() } };
}

/**
 * Lay `marks` out for the shader, on a body whose bones stand at `frames` (of `size`): each is a short line out from its
 * bone through where the Hit landed, and the surface within its radius of that line is bloodied. `frames` are
 * of whatever pose the shader sees the body's vertices in: the rest pose for a skinned model (it is bloodied before its
 * bones move it, so the blood moves with the skin), the drawn pose for the bare Skeleton.
 */
export function setBodyBlood(uniforms: BodyBloodUniforms, marks: readonly BodyMark[], frames: Readonly<Record<BodyBone, BoneFrame>>, size: Size = STANDARD): void {
  const n = Math.min(marks.length, MAX_WOUNDS);
  uniforms.uBloodCount.value = n;
  for (let k = 0; k < n; k++) {
    const m = marks[k]!;
    const f = frames[m.bone];
    boneScale(m.bone, size.height, size.thick, scale);
    // Out from the bone's nearest point through the Hit.
    const [ox, oy, oz] = [m.at.x - m.along, m.at.y, m.at.z];
    const out = Math.hypot(ox, oy, oz);
    const [ux, uy, uz] = out < 1e-6 ? [0, 0, 1] : [ox / out, oy / out, oz / out];
    const place = (reach: number, into: THREE.Vector4, w: number): void => {
      v.set(m.at.x + ux * reach, m.at.y + uy * reach, m.at.z + uz * reach).multiply(scale).applyQuaternion(f.rotation).add(f.origin);
      into.set(v.x, v.y, v.z, w);
    };
    place(-Math.min(out, IN), uniforms.uBloodA.value[k]!, woundRadius(m) * Math.min(size.height, size.thick));
    place(OUT, uniforms.uBloodB.value[k]!, m.look);
  }
}

const VERTEX_PARS = /* glsl */ `
  varying vec3 vBloodPos;
  varying vec3 vBloodGrain;
`;

// A skinned vertex is bloodied where it stands before its bones move it; a primitive's, where it stands in the world.
const VERTEX = /* glsl */ `
  #ifdef USE_SKINNING
    vBloodPos = (bindMatrix * vec4(position, 1.0)).xyz;
    vBloodGrain = vBloodPos;
  #else
    vBloodPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vBloodGrain = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  #endif
`;

const FRAGMENT_PARS = /* glsl */ `
  uniform int uBloodCount;
  uniform vec4 uBloodA[${MAX_WOUNDS}];
  uniform vec4 uBloodB[${MAX_WOUNDS}];
  varying vec3 vBloodPos;
  varying vec3 vBloodGrain;

  float bloodHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float bloodNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(bloodHash(i), bloodHash(i + vec3(1, 0, 0)), f.x), mix(bloodHash(i + vec3(0, 1, 0)), bloodHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(bloodHash(i + vec3(0, 0, 1)), bloodHash(i + vec3(1, 0, 1)), f.x), mix(bloodHash(i + vec3(0, 1, 1)), bloodHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  // How bloody this spot of the body is, 0..1: a ragged blot round each mark, running a little way down, and flecks beyond it.
  float bodyBlood() {
    float blood = 0.0;
    for (int i = 0; i < ${MAX_WOUNDS}; i++) {
      if (i >= uBloodCount) break;
      vec3 a = uBloodA[i].xyz;
      vec3 ab = uBloodB[i].xyz - a;
      vec3 ap = vBloodPos - a;
      vec3 off = ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      if (off.y < 0.0) off.y *= 0.55;
      float d = length(off) / uBloodA[i].w;
      if (d > 1.7) continue;
      vec3 grain = vBloodGrain + uBloodB[i].w * 7.0;
      float ragged = bloodNoise(grain * 34.0) * 0.65 + bloodNoise(grain * 90.0) * 0.35;
      blood = max(blood, 1.0 - smoothstep(0.0, 0.06, d - mix(0.3, 1.05, ragged)));
      blood = max(blood, step(0.8, bloodNoise(grain * 150.0)) * step(d, 1.2 + 0.5 * ragged));
    }
    return blood;
  }
`;

/** The colour of blood on a body (lit like the body it is on). */
const BLOOD = new THREE.Color(0xa30d12);

/**
 * Make `material` (a body's: Lambert, skinned or not) draw the blood `uniforms` describes. Compiled once per kind of
 * material, whoever wears it: a clean body runs the same shader with no marks.
 */
export function bodyBloodShader(material: THREE.Material, uniforms: BodyBloodUniforms): void {
  patchShader(material, 'bodyBlood', (shader) => {
    Object.assign(shader.uniforms, uniforms, { uBloodColour: { value: BLOOD } });
    shader.vertexShader = `${VERTEX_PARS}\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX}`);
    shader.fragmentShader = `uniform vec3 uBloodColour;\n${FRAGMENT_PARS}\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', '#include <map_fragment>\n  float bodyBloodHere = bodyBlood();\n  diffuseColor.rgb = mix(diffuseColor.rgb, uBloodColour, bodyBloodHere * 0.94);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uBloodColour * (0.18 * bodyBloodHere);');
  });
}

/** The frames of the pose every model is built in (and bloodied in), for the Skeleton `skeleton`. */
export function restFrames(skeleton: TuningData['skeleton']): Record<BodyBone, BoneFrame> {
  return boneFrames(restJoints(skeleton));
}
