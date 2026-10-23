/**
 * Generates the two-handed Weapons' Motion overrides (data/motions/<Weapon file>/) from the choreography in choreo.mjs.
 *
 *   npm run motions:two-handed
 *
 * A two-handed Weapon's off hand always holds its Off-hand Grip (ADR 0004), so its Motions are easier to author as
 * where the grip is and where the Weapon points than as a sword-hand position and Euler angles. Each choreographed
 * Pose Key gives the grip centre (midway between the hands), the Weapon's direction (hands to tip) and where its edge
 * should face; this script places both hands `offHandGrip.along` apart along the Weapon (read from data/weapons/), works
 * out the sword hand's Euler rotation, and picks, among the equivalent Euler triples, the one nearest the previous
 * Pose Key's, since Pose Keys interpolate rotations component by component. A key can steer that choice with `near`.
 *
 * It overwrites the generated files: edit choreo.mjs and re-run rather than editing them by hand (or in the Editor).
 * It keeps the Weapon and arms out of the body. It builds the Skeleton as the game solves it (spine, arms by two-bone IK
 * with the two-handed elbows, thighs) wrapped in capsules about as thick as the Body models, then:
 *   - each Pose Key: if the Weapon (butt to tip) or a forearm is inside the body, or a hand is out of reach (where the
 *     game would pull the Weapon in, ADR 0004), it finds the nearest grip and Weapon direction that is clear, moving the
 *     same way as the Pose Key before it so a swing stays coherent;
 *   - between Pose Keys: it plays the Motion Tick by Tick as the game does, and where a Tick still goes into the body it
 *     adds a Pose Key there, nudged a few centimetres off the path, then draws each added Pose Key back toward a straight
 *     blend of its neighbours as far as the Ticks stay clear, so the swing does not kink.
 * It prints every grip it moved or added, and what it could not clear: past a few centimetres, change the choreography.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHOREO } from './choreo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const data = (path) => resolve(ROOT, 'data', path);

const DEG = Math.PI / 180;
const rx = (v, d) => { const c = Math.cos(d * DEG), s = Math.sin(d * DEG); return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }; };
const ry = (v, d) => { const c = Math.cos(d * DEG), s = Math.sin(d * DEG); return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }; };
const rz = (v, d) => { const c = Math.cos(d * DEG), s = Math.sin(d * DEG); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }; };
const euler = (v, e) => ry(rx(rz(v, e.z), e.x), e.y);
const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sc = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const norm = (a) => sc(a, 1 / Math.hypot(a.x, a.y, a.z));
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const lerp = (a, b, t) => add(a, sc(sub(b, a), t));
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;

/** Euler (deg) pointing the blade along `dir` with its edge as near `edgeHint` as it can be, nearest `prev` among equivalents. */
function toEuler(dir, edgeHint, prev, near = {}) {
  const d = norm(dir);
  const x = -Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG;
  const y = Math.atan2(d.x, d.z) / DEG;
  const e1 = euler({ x: 0, y: -1, z: 0 }, { x, y, z: 0 });
  const e2 = euler({ x: 1, y: 0, z: 0 }, { x, y, z: 0 });
  const h = norm(edgeHint);
  const z = Math.atan2(dot(h, e2), dot(h, e1)) / DEG;
  const cands = [];
  for (const base of [{ x, y, z }, { x: 180 - x, y: y + 180, z: z + 180 }])
    for (const kx of [-360, 0, 360]) for (const ky of [-360, 0, 360]) for (const kz of [-360, 0, 360]) cands.push({ x: base.x + kx, y: base.y + ky, z: base.z + kz });
  const ref = { ...(prev ?? { x: 0, y: 0, z: 0 }), ...near };
  const cost = (c) => Math.abs(c.x - ref.x) + Math.abs(c.y - ref.y) + Math.abs(c.z - ref.z);
  cands.sort((a, b) => cost(a) - cost(b));
  const best = cands[0];
  // Sanity: same blade and edge.
  const bd = euler({ x: 0, y: 0, z: 1 }, best);
  if (dot(bd, d) < 0.999) throw new Error('euler mismatch');
  return { x: r1(best.x), y: r1(best.y), z: r1(best.z) };
}

// --- The body, roughly as solveSkeleton builds it (src/sim/skeleton.ts) ---------------------------------------
const SK = JSON.parse(readFileSync(data('skeleton.json'), 'utf8'));
const REACH = SK.upperArm + SK.forearm;
/** How thick each part is drawn, about (m): a little more than the Body models, so nothing shows through. */
const THICK = { torso: 0.11, shoulders: 0.09, head: 0.12, thigh: 0.08, arm: 0.045, shaft: 0.025 };
/** The torso is wider than it is deep: two capsules side by side, this far either side of the spine. */
const TORSO_HALF_WIDTH = 0.06;
const CLEAR = 0.01;
/** How deep (m) a Tick between Pose Keys may go into the body before a Pose Key is added there. */
const PATH_DEPTH = 0.03;
/** How far a Pose Key added between two others may stray from the path between them, so it nudges the swing rather than kinks it. */
const NUDGE = { MAX: 0.06, TURN: 10 };
/** Which way the sword arm's elbow bends with a two-handed Weapon: TWO_HANDED_POLE in src/sim/skeleton.ts (the off arm's is its mirror). */
const POLE = { x: 1, y: -0.5, z: 0.3 };

/** Two-bone IK as the Skeleton does it: the middle joint, bent toward `pole`. */
function ikMid(root, target, l1, l2, pole) {
  const to = sub(target, root);
  const dir = norm(len(to) < 1e-9 ? { x: 0, y: -1, z: 0 } : to);
  const d = Math.min(Math.max(len(to), Math.abs(l1 - l2) + 1e-6), l1 + l2);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  let bend = sub(pole, sc(dir, dot(pole, dir)));
  bend = len(bend) < 1e-9 ? { x: 0, y: 1, z: 0 } : norm(bend);
  return add(root, add(sc(dir, l1 * cosA), sc(bend, l1 * Math.sqrt(1 - cosA * cosA))));
}

/** The body's capsules [name, a, b, radius] for a torso [twist, lean], hip and feet (and a Kick's raised right ankle, `kick`). */
function bodyCapsules(torso, hip, feet) {
  const sp = (v) => ry(rx(v, torso[1]), torso[0]);
  const pelvis = V(hip);
  const chest = add(pelvis, sp({ x: 0, y: SK.spine, z: 0 }));
  const head = add(chest, sp({ x: 0, y: SK.neck + SK.headRadius, z: 0 }));
  const rs = add(chest, sp({ x: SK.shoulderWidth / 2, y: 0, z: 0 }));
  const ls = add(chest, sp({ x: -SK.shoulderWidth / 2, y: 0, z: 0 }));
  const leg = (side, foot, raised) => {
    const hipJoint = add(pelvis, { x: (side * SK.hipWidth) / 2, y: 0, z: 0 });
    const ankle = raised ?? { x: foot[0], y: SK.ankleHeight, z: foot[1] };
    return [hipJoint, ikMid(hipJoint, ankle, SK.thigh, SK.shin, { x: 0, y: 0, z: 1 })];
  };
  return {
    rs, ls, sp,
    capsules: [
      ...[-1, 1].map((side) => {
        const off = sp({ x: side * TORSO_HALF_WIDTH, y: 0, z: 0 });
        return ['torso', add(pelvis, off), add(chest, off), THICK.torso];
      }),
      ['shoulders', ls, rs, THICK.shoulders],
      ['head', head, head, THICK.head],
      ['left thigh', ...leg(-1, feet.lf), THICK.thigh],
      ['right thigh', ...leg(1, feet.rf, feet.kick), THICK.thigh],
    ],
  };
}

/** Closest points between segments p0→p1 and q0→q1: [point on p, point on q]. */
function closest(p0, p1, q0, q1) {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) return [p0, q0];
  if (a < 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return [add(p0, sc(d1, s)), add(q0, sc(d2, t))];
}

/** The rotation taking +z to `d`, applied to `v`, then turned `yaw` and `pitch` degrees about the body's axes. */
const turn = (d, yaw, pitch) => norm(ry(rx(d, -pitch), yaw));

/** Everything that can go wrong with a grip at `c` along `d`: how deep the Weapon and forearms are in the body (m), what is deepest, and how far each hand is past its reach. */
function trouble(c, d, weapon, body) {
  const right = add(c, sc(d, weapon.along / 2)), left = add(c, sc(d, -weapon.along / 2));
  const parts = [
    ['Weapon', add(right, sc(d, -weapon.gripLength)), add(right, sc(d, weapon.length)), THICK.shaft],
    ['left forearm', ikMid(body.ls, left, SK.upperArm, SK.forearm, body.sp({ ...POLE, x: -POLE.x })), left, THICK.arm],
    ['right forearm', ikMid(body.rs, right, SK.upperArm, SK.forearm, body.sp(POLE)), right, THICK.arm],
  ];
  let depth = 0, worst = 0, what = null;
  for (const [part, a, b, r] of parts) {
    for (const [name, q0, q1, br] of body.capsules) {
      const [p, q] = closest(a, b, q0, q1);
      const dd = r + br + CLEAR - len(sub(p, q));
      if (dd <= 0) continue;
      depth += dd;
      if (dd > worst) [worst, what] = [dd, `${part} in ${name}`];
    }
  }
  const over = Math.max(0, len(sub(right, body.rs)) - REACH + 0.02) + Math.max(0, len(sub(left, body.ls)) - REACH + 0.02);
  return { depth, what, over };
}

/**
 * The grip nearest the choreographed one (`c` along `d`) with the Weapon and forearms clear of the body and both hands in
 * reach (so the game never has to pull the Weapon in, ADR 0004): a search over grips up to 25 cm away and Weapon directions up to 20° off, preferring the smallest change.
 */
function clearBody(c, d, weapon, body, bias = { x: 0, y: 0, z: 0 }, { MAX = 0.15, TURN = 20 } = {}) {
  const score = (cc, dd, change) => {
    const t = trouble(cc, dd, weapon, body);
    return { s: 100 * t.depth + 50 * t.over + change, t };
  };
  const start = score(c, d, 0);
  if (start.t.depth === 0 && start.t.over === 0) return { c, d, moved: 0, offset: { x: 0, y: 0, z: 0 }, turned: 0, what: null, left: start.t };
  let best = { ...start, c, d, moved: 0, turned: 0 };
  const STEP = 0.025;
  const turns = [-20, -10, 0, 10, 20].filter((a) => Math.abs(a) <= TURN);
  for (const yaw of turns) for (const pitch of turns) {
    const dd = yaw || pitch ? turn(d, yaw, pitch) : d;
    const turned = Math.hypot(yaw, pitch);
    for (let x = -MAX; x <= MAX + 1e-9; x += STEP) for (let y = -MAX; y <= MAX + 1e-9; y += STEP) for (let z = -MAX; z <= MAX + 1e-9; z += STEP) {
      const moved = Math.hypot(x, y, z);
      if (moved > MAX) continue;
      // A centimetre of grip costs as much as a degree of Weapon; half of it is measured from the last Pose Key's move,
      // so neighbouring Pose Keys move the same way rather than round opposite sides of the body.
      const change = 0.5 * moved + 0.5 * Math.hypot(x - bias.x, y - bias.y, z - bias.z) + turned * 0.01;
      if (change >= best.s) continue;
      const cc = add(c, { x, y, z });
      const r = score(cc, dd, change);
      if (r.s < best.s) best = { ...r, c: cc, d: dd, moved, turned };
    }
  }
  return { c: best.c, d: best.d, moved: best.moved, offset: sub(best.c, c), turned: best.turned, what: start.t.what, left: best.t };
}

/** Each Weapon by name: its file stem (the name of its override folder) and the distance between its hands. */
const WEAPONS = Object.fromEntries(
  readdirSync(data('weapons')).map((file) => {
    const w = JSON.parse(readFileSync(data(`weapons/${file}`), 'utf8'));
    return [w.name, { folder: file.replace(/\.json$/, ''), along: w.offHandGrip?.along, length: w.length, gripLength: w.gripLength }];
  }),
);

const vec = (p) => ({ x: r3(p.x), y: r3(p.y), z: r3(p.z) });

// --- Between the Pose Keys, as src/sim/motion.ts plays them -------------------------------------------------------
const TICK = 1 / 60;
const EASE = { linear: (u) => u, easeIn: (u) => u * u, easeOut: (u) => 1 - (1 - u) * (1 - u), easeInOut: (u) => u * u * (3 - 2 * u), step: (u) => (u < 1 ? 0 : 1) };
/** How an ease splits in two at a Pose Key added inside it: roughly the same speed on either side. */
const SPLIT = { linear: ['linear', 'linear'], easeIn: ['easeIn', 'linear'], easeOut: ['linear', 'easeOut'], easeInOut: ['easeIn', 'easeOut'], step: ['step', 'step'] };
const CHEST = { x: 0, y: SK.pelvisHeight + SK.spine, z: 0 };
const lerpAny = (a, b, t) => (typeof a === 'number' ? a + (b - a) * t : Object.fromEntries(Object.keys(a).map((k) => [k, lerpAny(a[k], b[k], t)])));
function arcLerp(a, b, pivot, t) {
  const da = sub(a, pivot), db = sub(b, pivot), la = len(da), lb = len(db);
  if (la < 1e-9 || lb < 1e-9) return lerp(a, b, t);
  const angle = Math.acos(Math.min(Math.max(dot(da, db) / (la * lb), -1), 1)), sin = Math.sin(angle);
  if (sin < 1e-6) return lerp(a, b, t);
  return add(pivot, sc(add(sc(da, Math.sin((1 - t) * angle) / sin / la), sc(db, Math.sin(t * angle) / sin / lb)), la + (lb - la) * t));
}

/** A channel's value at `time`, and the Pose Keys that set it either side (prev, next), like sampleChannel. */
function sample(keys, ch, time, guard) {
  const val = (k) => (k[ch] === 'idle' ? guard[ch] : k[ch]);
  let prev, prevTime = 0;
  for (const k of keys) {
    const v = val(k);
    if (v === undefined) continue;
    if (k.time >= time) {
      if (prev === undefined || k.time === prevTime) return { v, prev: k, next: k };
      const t = EASE[k.ease]((time - prevTime) / (k.time - prevTime));
      let out = lerpAny(prev.v, v, t);
      if (k.path === 'arc' && ch === 'rightHand') out = { ...out, position: arcLerp(prev.v.position, v.position, CHEST, t) };
      return { v: out, prev: prev.k, next: k };
    }
    prev = { v, k };
    prevTime = k.time;
  }
  return { v: prev?.v, prev: prev?.k, next: prev?.k };
}

/** The pose (torso, hip, feet, raised ankle) and the Weapon's grip and direction at `time`. */
function poseAt(keys, time, guard) {
  const torso = sample(keys, 'torso', time, guard).v, hip = sample(keys, 'hip', time, guard).v;
  const lf = sample(keys, 'leftFoot', time, guard).v, rf = sample(keys, 'rightFoot', time, guard).v, kick = sample(keys, 'kickFoot', time, guard).v;
  const hand = sample(keys, 'rightHand', time, guard);
  return {
    pose: { torso: [torso.twist, torso.lean], hip: [hip.x, hip.y, hip.z], lf: [lf.x, lf.z], rf: [rf.x, rf.z], kick },
    hand,
  };
}


for (const [weapon, spec] of Object.entries(CHOREO)) {
  const w = WEAPONS[weapon];
  if (w?.along === undefined) throw new Error(`${weapon} is not a two-handed Weapon in data/weapons/`);
  mkdirSync(data(`motions/${w.folder}`), { recursive: true });
  const idle = spec.motions.find((m) => m.name === 'Idle').keys[0];
  const guard = { torso: idle.torso, hip: idle.hip, lf: idle.lf, rf: idle.rf, rot: undefined };

  /**
   * Both hands for a grip at `c` pointing along `d` (edge toward `e`), the body at `pose` ({ torso, hip, lf, rf }):
   * the grip moved clear of the body (the way `bias` was, if it can), the sword hand's rotation nearest `prev`.
   */
  const hands = (at, { c, rear, d, e, near }, pose, prev, bias, limits) => {
    const dir = norm(V(d));
    const body = bodyCapsules(pose.torso, pose.hip, pose);
    // A grip given by its rear (off) hand: the centre is half the hands' spacing up the Weapon from it.
    const centre = rear ? add(V(rear), sc(dir, w.along / 2)) : V(c);
    const clear = clearBody(centre, dir, w, body, bias, limits);
    lastOffset = clear.offset;
    if (clear.what || clear.moved > 0) {
      const still = clear.left.depth > 0 ? `; still ${clear.left.what}, ${(clear.left.depth * 100).toFixed(0)} cm` : '';
      console.log(`${at}: ${clear.what ?? 'out of reach'}: grip moved ${(clear.moved * 100).toFixed(0)} cm, Weapon turned ${clear.turned.toFixed(0)}°${still}`);
    }
    const right = add(clear.c, sc(clear.d, w.along / 2)), left = add(clear.c, sc(clear.d, -w.along / 2));
    const rd = len(sub(right, body.rs)), ld = len(sub(left, body.ls));
    if (rd > REACH - 0.01 || ld > REACH - 0.01) console.log(`${at}: hands at the end of their reach (right ${rd.toFixed(2)} m, left ${ld.toFixed(2)} m)`);
    const rotation = toEuler(clear.d, V(e ?? [0, -1, 0]), prev, near);
    return { rightHand: { position: vec(right), rotation }, leftHand: { position: vec(left) } };
  };

  /**
   * Every Tick of a Motion as the game plays it: where the Weapon or a forearm passes well into the body between Pose Keys,
   * add a Pose Key there with the grip cleared, splitting the ease. At most a few, so a Motion stays a handful of Pose Keys:
   * past that, the choreography itself wants changing.
   */
  let lastOffset = { x: 0, y: 0, z: 0 }, guardOffset = lastOffset;
  const clearPath = (label, file, guardKey) => {
    /** The deepest the Weapon or a forearm goes into the body on the Ticks strictly between `from` and `to` (s). */
    const worstBetween = (from = 0, to = file.duration) => {
      let worst = null;
      for (let time = TICK; time < file.duration; time += TICK) {
        if (time <= from + 0.002 || time >= to - 0.002) continue;
        const { pose, hand } = poseAt(file.poseKeys, time, guardKey);
        if (hand.prev === hand.next) continue;
        if (time - hand.prev.time < 0.002 || hand.next.time - time < 0.002) continue;
        const d = norm(euler({ x: 0, y: 0, z: 1 }, hand.v.rotation));
        const c = add(hand.v.position, sc(d, -w.along / 2));
        const body = bodyCapsules(pose.torso, pose.hip, pose);
        const t = trouble(c, d, w, body);
        if (t.depth > PATH_DEPTH && (!worst || t.depth > worst.depth)) worst = { time, depth: t.depth, what: t.what, hand, d, c, pose };
      }
      return worst;
    };
    const added = [];
    for (; added.length < 6; ) {
      const worst = worstBetween();
      if (!worst) break;
      const time = Math.round(worst.time * 60) / 60;
      const { hand, d, c, pose } = worst;
      const e = euler({ x: 0, y: -1, z: 0 }, hand.v.rotation);
      const key = { time: r3(time), ease: SPLIT[hand.next.ease][0], ...(hand.next.path ? { path: hand.next.path } : {}) };
      Object.assign(key, hands(`${label} t=${key.time} (between keys: ${worst.what})`, { c: [c.x, c.y, c.z], d: [d.x, d.y, d.z], e: [e.x, e.y, e.z], near: hand.v.rotation }, pose, hand.v.rotation, undefined, NUDGE));
      hand.next.ease = SPLIT[hand.next.ease][1];
      const at = file.poseKeys.findIndex((k) => k.time > key.time);
      file.poseKeys.splice(at < 0 ? file.poseKeys.length : at, 0, key);
      added.push(key);
    }
    // Each added Pose Key was cleared on its own, which kinks the swing: draw each back toward the straight blend of its
    // neighbours as far as the Ticks either side stay clear.
    for (let pass = 0; pass < 3; pass++) {
      for (const key of added) {
        const i = file.poseKeys.indexOf(key);
        const before = file.poseKeys.slice(0, i).reverse().find((k) => k.rightHand !== undefined);
        const after = file.poseKeys.slice(i + 1).find((k) => k.rightHand !== undefined);
        const val = (k) => (k.rightHand === 'idle' ? { rightHand: guardKey.rightHand, leftHand: guardKey.leftHand } : k);
        const [a, b] = [val(before), val(after)];
        const u = (key.time - before.time) / (after.time - before.time);
        const own = { right: key.rightHand, left: key.leftHand };
        for (const f of [1, 0.75, 0.5, 0.25]) {
          const blend = (p, q) => lerpAny(p, lerpAny(q.a, q.b, u), f);
          key.rightHand = {
            position: vec(blend(own.right.position, { a: a.rightHand.position, b: b.rightHand.position })),
            rotation: lerpAny(own.right.rotation, lerpAny(a.rightHand.rotation, b.rightHand.rotation, u), f),
          };
          // The off hand stays on the grip: where it sits on the Weapon held at the blended sword hand.
          const d = norm(euler({ x: 0, y: 0, z: 1 }, key.rightHand.rotation));
          key.leftHand = { position: vec(add(key.rightHand.position, sc(d, -w.along))) };
          if (!worstBetween(before.time, after.time)) break;
          [key.rightHand, key.leftHand] = [own.right, own.left];
        }
      }
    }
    for (const key of added) key.rightHand.rotation = { x: r1(key.rightHand.rotation.x), y: r1(key.rightHand.rotation.y), z: r1(key.rightHand.rotation.z) };
  };

  for (const motion of spec.motions) {
    let prev = motion.name === 'Idle' ? undefined : guard.rot;
    lastOffset = motion.name === 'Idle' ? { x: 0, y: 0, z: 0 } : guard.offset;
    const pose = { ...guard };
    const poseKeys = motion.keys.map((k) => {
      const out = { time: k.t, ease: k.ease ?? 'easeInOut' };
      if (k.path) out.path = k.path;
      for (const c of k.idle ?? []) out[c] = 'idle';
      for (const [ch, from] of [['torso', 'torso'], ['hip', 'hip'], ['lf', 'leftFoot'], ['rf', 'rightFoot']]) {
        if (k[ch]) pose[ch] = k[ch];
        else if (k.idle?.includes(from)) pose[ch] = guard[ch];
      }
      if (k.c || k.rear) {
        Object.assign(out, hands(`${weapon}/${motion.name} t=${k.t}`, k, pose, prev, lastOffset));
        if (motion.name === 'Idle' && k.t === 0) guardOffset = lastOffset;
        prev = out.rightHand.rotation;
      }
      if (k.torso) out.torso = { twist: k.torso[0], lean: k.torso[1] };
      if (k.hip) out.hip = { x: k.hip[0], y: k.hip[1], z: k.hip[2] };
      if (k.lf) out.leftFoot = { x: k.lf[0], z: k.lf[1] };
      if (k.rf) out.rightFoot = { x: k.rf[0], z: k.rf[1] };
      return out;
    });
    if (motion.name === 'Idle') [guard.rot, guard.key, guard.offset] = [poseKeys[0].rightHand.rotation, poseKeys[0], guardOffset];
    const file = { name: motion.name, duration: motion.duration, loop: !!motion.loop, ...(motion.markers ? { markers: motion.markers } : {}), poseKeys };
    if (!motion.loop) clearPath(`${weapon}/${motion.name}`, file, guard.key);
    writeFileSync(data(`motions/${w.folder}/${motion.name.toLowerCase()}.json`), JSON.stringify(file, null, 2) + '\n');
  }

  for (const patch of spec.patches ?? []) {
    // A default Motion with only its hands replaced: both hands on the Weapon, the rest (hips, feet, Kick foot) as authored.
    const base = JSON.parse(readFileSync(data(`motions/${patch.name.toLowerCase()}.json`), 'utf8'));
    let prev = guard.rot;
    lastOffset = guard.offset;
    const pose = { ...guard };
    for (const k of base.poseKeys) {
      const take = (ch, from, read) => {
        if (k[from] === 'idle') pose[ch] = guard[ch];
        else if (k[from]) pose[ch] = read(k[from]);
      };
      take('torso', 'torso', (t) => [t.twist, t.lean]);
      take('hip', 'hip', (h) => [h.x, h.y, h.z]);
      take('lf', 'leftFoot', (f) => [f.x, f.z]);
      take('rf', 'rightFoot', (f) => [f.x, f.z]);
      if (typeof k.kickFoot === 'object') pose.kick = k.kickFoot;
      if (typeof k.rightHand !== 'object') continue;
      const h = patch.hands[k.time];
      if (!h) throw new Error(`${weapon}/${patch.name}: no hands for t=${k.time}`);
      Object.assign(k, hands(`${weapon}/${patch.name} t=${k.time}`, h, pose, prev, lastOffset));
      prev = k.rightHand.rotation;
    }
    clearPath(`${weapon}/${patch.name}`, base, guard.key);
    writeFileSync(data(`motions/${w.folder}/${patch.name.toLowerCase()}.json`), JSON.stringify(base, null, 2) + '\n');
  }
}
console.log(`Wrote the Motion overrides for ${Object.keys(CHOREO).join(', ')}.`);
