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
 * It prints a line for every Pose Key whose hands are near or out of the arms' reach, where the Weapon would be pulled.
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

/** Each Weapon by name: its file stem (the name of its override folder) and the distance between its hands. */
const WEAPONS = Object.fromEntries(
  readdirSync(data('weapons')).map((file) => {
    const w = JSON.parse(readFileSync(data(`weapons/${file}`), 'utf8'));
    return [w.name, { folder: file.replace(/\.json$/, ''), along: w.offHandGrip?.along }];
  }),
);

for (const [weapon, spec] of Object.entries(CHOREO)) {
  const { folder, along } = WEAPONS[weapon] ?? {};
  if (along === undefined) throw new Error(`${weapon} is not a two-handed Weapon in data/weapons/`);
  mkdirSync(data(`motions/${folder}`), { recursive: true });
  const guardRot = {};
  let torso = [0, 0], hip = [0, 0.92, 0];
  for (const motion of spec.motions) {
    let prev = motion.name === 'Idle' ? undefined : guardRot.value;
    const poseKeys = motion.keys.map((k) => {
      const out = { time: k.t, ease: k.ease ?? 'easeInOut' };
      if (k.path) out.path = k.path;
      if (k.idle) {
        for (const c of k.idle) out[c] = 'idle';
      }
      if (k.c) {
        const d = norm(V(k.d));
        const c = V(k.c);
        const rot = toEuler(d, V(k.e ?? [0, -1, 0]), prev, k.near);
        prev = rot;
        const right = add(c, sc(d, along / 2));
        const left = add(c, sc(d, -along / 2));
        out.rightHand = { position: { x: r3(right.x), y: r3(right.y), z: r3(right.z) }, rotation: rot };
        out.leftHand = { position: { x: r3(left.x), y: r3(left.y), z: r3(left.z) } };
      }
      if (k.torso) torso = k.torso;
      if (k.hip) hip = k.hip;
      if (k.c) {
        const sp = (v) => ry(rx(v, torso[1]), torso[0]);
        const chest = add(V(hip), sp({ x: 0, y: 0.5, z: 0 }));
        const rs = add(chest, sp({ x: 0.2, y: 0, z: 0 })), ls = add(chest, sp({ x: -0.2, y: 0, z: 0 }));
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const rd = dist(V([out.rightHand.position.x, out.rightHand.position.y, out.rightHand.position.z]), rs);
        const ld = dist(V([out.leftHand.position.x, out.leftHand.position.y, out.leftHand.position.z]), ls);
        if (rd > 0.57 || ld > 0.57 || rd < 0.2 || ld < 0.2) console.log(`${weapon}/${motion.name} t=${k.t} reach R ${rd.toFixed(2)} L ${ld.toFixed(2)}`);
      }
      if (k.torso) out.torso = { twist: k.torso[0], lean: k.torso[1] };
      if (k.hip) out.hip = { x: k.hip[0], y: k.hip[1], z: k.hip[2] };
      if (k.lf) out.leftFoot = { x: k.lf[0], z: k.lf[1] };
      if (k.rf) out.rightFoot = { x: k.rf[0], z: k.rf[1] };
      return out;
    });
    if (motion.name === 'Idle') guardRot.value = poseKeys[0].rightHand.rotation;
    const file = { name: motion.name, duration: motion.duration, ...(motion.loop ? { loop: true } : { loop: false }), ...(motion.markers ? { markers: motion.markers } : {}), poseKeys };
    writeFileSync(data(`motions/${folder}/${motion.name.toLowerCase()}.json`), JSON.stringify(file, null, 2) + '\n');
  }
  for (const patch of spec.patches ?? []) {
    // A default Motion with only its hands replaced: both hands on the Weapon, the rest (hips, feet, Kick foot) as authored.
    const base = JSON.parse(readFileSync(data(`motions/${patch.name.toLowerCase()}.json`), 'utf8'));
    let prev = guardRot.value;
    for (const k of base.poseKeys) {
      if (typeof k.rightHand !== 'object') continue;
      const h = patch.hands[k.time];
      if (!h) throw new Error(`${weapon}/${patch.name}: no hands for t=${k.time}`);
      const d = norm(V(h.d));
      const rot = toEuler(d, V(h.e ?? [0, -1, 0]), prev, h.near);
      prev = rot;
      const right = add(V(h.c), sc(d, along / 2));
      const left = add(V(h.c), sc(d, -along / 2));
      k.rightHand = { position: { x: r3(right.x), y: r3(right.y), z: r3(right.z) }, rotation: rot };
      k.leftHand = { position: { x: r3(left.x), y: r3(left.y), z: r3(left.z) } };
    }
    writeFileSync(data(`motions/${folder}/${patch.name.toLowerCase()}.json`), JSON.stringify(base, null, 2) + '\n');
  }
}
console.log(`Wrote the Motion overrides for ${Object.keys(CHOREO).join(', ')}.`);
