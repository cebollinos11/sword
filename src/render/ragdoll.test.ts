import { describe, expect, it } from 'vitest';
import { BONES, duelPlacements, fighterPose, createInitialState, type Death, type SkeletonPose, type Vec3 } from '../sim';
import { loadTuningData, parseArena, weaponByName } from '../tuning';
import { pieceOf, severing } from './dismember';
import { ragdollPose, type RagdollPose } from './ragdoll';
import { sheathedBlade } from './sheathed';

const tuning = loadTuningData();
const fighter = createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!; // at +z, facing -z
const pose = fighterPose(fighter, tuning);
const weapon = weaponByName(tuning, fighter.weapon);
/** An Overhead from the opponent, standing at -z. */
const death: Death = { tick: 10, cause: 'Hit', blow: { point: pose.joints.chest, bladeSpeed: 10, direction: 'Overhead', from: { x: 0, z: -1 } } };

const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lowest = (p: SkeletonPose) => Math.min(...Object.values(p.joints).map((j) => j.y), p.blade.tip.y, p.blade.hilt.y);

describe('Death Ragdoll', () => {
  it('starts from the pose the Fighter fell in', () => {
    expect(ragdollPose(pose, death, 0, weapon, tuning)).toEqual(pose);
  });

  it('is deterministic', () => {
    expect(ragdollPose(pose, death, 1.3, weapon, tuning)).toEqual(ragdollPose(pose, death, 1.3, weapon, tuning));
  });

  it('draws the same fall frame by frame as in one go, and when scrubbed back', () => {
    const fresh = ragdollPose(pose, death, 1.3, { ...weapon }, tuning);
    for (let t = 0; t <= 1.3; t += 1 / 60) ragdollPose(pose, death, t, weapon, tuning);
    expect(ragdollPose(pose, death, 1.3, weapon, tuning)).toEqual(fresh);
    ragdollPose(pose, death, 2.5, weapon, tuning);
    expect(ragdollPose(pose, death, 1.3, weapon, tuning)).toEqual(fresh);
  });

  it('collapses onto the floor, knocked away from the attacker, and lies still', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(lying.joints.head.y).toBeLessThan(0.3);
    expect(lying.joints.chest.y).toBeLessThan(0.3);
    expect(lowest(lying)).toBeGreaterThan(0);
    expect(lying.joints.head.z).toBeGreaterThan(pose.joints.head.z);
    expect(ragdollPose(pose, death, 10, weapon, tuning)).toEqual(ragdollPose(pose, death, 20, weapon, tuning));
  });

  it('keeps the bones whole', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    for (const [a, b] of [
      ['pelvis', 'chest'],
      ['leftHip', 'leftKnee'],
      ['rightElbow', 'rightHand'],
    ] as const)
      expect(d(lying.joints[a], lying.joints[b])).toBeCloseTo(d(pose.joints[a], pose.joints[b]), 1);
  });

  it('never bends a knee backwards, whichever way the body is knocked', () => {
    const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    for (const direction of ['Left', 'Right', 'Overhead'] as const)
      for (const from of [{ x: 0, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 0.5 }])
        for (const t of [0.4, 1, 3]) {
          const { joints: j } = ragdollPose(pose, { ...death, blow: { ...death.blow!, direction, from } }, t, weapon, tuning);
          const left = sub(j.rightHip, j.leftHip);
          for (const side of ['left', 'right'] as const) {
            // The knee turns about the hips' left-right axis the same way as standing: shin swinging back under the thigh.
            const knee = cross(sub(j[`${side}Hip`], j[`${side}Knee`]), sub(j[`${side}Knee`], j[`${side}Ankle`]));
            expect(dot(knee, left), `${side} knee, ${direction} from ${from.x},${from.z} at ${t}s`).toBeGreaterThan(0);
          }
        }
  });

  it('stays down once it has fallen, never bouncing back up or floating off the floor', () => {
    const height = (p: SkeletonPose) => Object.values(p.joints).reduce((s, j) => s + j.y, 0) / Object.values(p.joints).length;
    // Falls that once had a knee or elbow fight the floor and lift the body up to 2 m off it.
    for (const [direction, from, bladeSpeed, sheathed] of [
      ['Overhead', { x: -1, z: 0.5 }, 20, false],
      ['Overhead', { x: 0, z: -1 }, 10, false],
      ['Left', { x: -1, z: 0.5 }, 10, false],
      ['Left', { x: 1, z: 1 }, 10, false],
      ['Right', { x: 1, z: 0 }, 20, false],
    ] as const) {
      const blow: Death = { ...death, blow: { ...death.blow!, direction, from, bladeSpeed } };
      for (let t = 1.2; t <= 3; t += 1 / 30) expect(height(ragdollPose(pose, blow, t, weapon, tuning, undefined, sheathed)), `${direction} from ${from.x},${from.z} at ${t.toFixed(2)}s`).toBeLessThan(0.35);
    }
  });

  it('lets go of the Weapon, which keeps its length and falls on its own', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(d(lying.blade.hilt, lying.blade.tip)).toBeCloseTo(d(pose.blade.hilt, pose.blade.tip), 1);
    expect(d(lying.blade.hilt, lying.joints.rightHand)).toBeGreaterThan(0.15);
    expect(Math.max(lying.blade.hilt.y, lying.blade.tip.y)).toBeLessThan(0.2);
  });

  it.each(['Arming Sword', 'Longsword', 'Halberd'])('keeps a Sheathed %s in its slot on the body as it falls', (name) => {
    const w = weaponByName(tuning, name);
    const worn = sheathedBlade(pose, w);
    const start = ragdollPose(pose, death, 0, w, tuning, undefined, true);
    expect(start.blade).toEqual(worn);
    // Where it sits on the torso (from the chest, against the spine) stays put through the fall.
    const fromChest = (p: SkeletonPose) => [d(p.blade.hilt, p.joints.chest), d(p.blade.tip, p.joints.chest), d(p.blade.hilt, p.joints.pelvis), d(p.blade.tip, p.joints.pelvis)];
    for (const t of [0.5, 1.5, 3]) {
      const lying = ragdollPose(pose, death, t, w, tuning, undefined, true);
      fromChest(lying).forEach((v, k) => expect(v).toBeCloseTo(fromChest(start)[k]!, 1));
      expect(lowest(lying)).toBeGreaterThan(0);
    }
    // A drawn one still leaves the hand.
    expect(ragdollPose(pose, death, 3, w, tuning, undefined, false).blade).not.toEqual(ragdollPose(pose, death, 3, w, tuning, undefined, true).blade);
  });
});

describe('Death Ragdoll in a multilevel Arena', () => {
  /** A 2 m ledge whose edge (z = 1.3) is just behind a Fighter standing on it at z = 1, over a floor at 0. */
  const arena = parseArena(
    {
      name: 'ledge',
      walk: [
        { id: 'floor', points: [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]] },
        { id: 'ledge', points: [[-5, 2, -5], [5, 2, -5], [5, 2, 1.3], [-5, 2, 1.3]] },
      ],
    },
    'ledge',
  );
  const high = { ...tuning, arenas: { ...tuning.arenas, ledge: arena } };
  const onLedge = createInitialState(high, 1, [{ position: { x: 0, z: -1 }, facing: 0 }, { position: { x: 0, z: 1 }, facing: Math.PI, y: 2 }], [], [], 'ledge').fighters[1]!;
  const ledgePose = fighterPose(onLedge, high);
  const blow: Death = { ...death, blow: { ...death.blow!, point: ledgePose.joints.chest } };

  it('lies on the ledge it fell on when it stays on it, and drops to the floor below when knocked off', () => {
    expect(onLedge.y).toBe(2);
    const lying = ragdollPose(ledgePose, blow, 4, weapon, high, arena);
    // Knocked towards +z, over the edge: down on the floor, not floating at the ledge's height.
    expect(lying.joints.pelvis.z).toBeGreaterThan(1.3);
    expect(lying.joints.pelvis.y).toBeLessThan(0.5);
    expect(lowest(lying)).toBeGreaterThan(0);
    // Without the Arena it would stop at y 0 all the same, but standing on the ledge it never sinks below it.
    const slump: Death = { tick: 10, cause: 'Fall', blow: null };
    const safe = createInitialState(high, 1, [{ position: { x: 0, z: -2 }, facing: Math.PI, y: 2 }], [], [], 'ledge').fighters[0]!;
    const still = ragdollPose(fighterPose(safe, high), slump, 4, weapon, high, arena);
    expect(lowest(still)).toBeGreaterThan(2);
  });
});

describe('Death Ragdoll in pieces (Dismemberment)', () => {
  const { speed } = tuning.fighter.dismember;
  /** A level swing at height `y` going toward +x from `x`, struck by an attacker at -z. */
  const swing = (y: number, x: number, bladeSpeed = speed): Death => ({
    tick: 10,
    cause: 'Hit',
    blow: { point: { x, y, z: pose.joints.pelvis.z + 0.05 }, bladeSpeed, direction: 'Right', from: { x: 0, z: -1 }, cut: { hilt: { x, y, z: 0.3 }, tip: { x, y, z: 1.15 }, travel: { x: 1, y: 0, z: 0 } } },
  });
  const cuts: [name: string, death: Death, bones: string[]][] = [
    ['neck', swing(1.5, -0.15), ['chest>head']],
    ['waist', swing(1.2, -0.36), ['leftShoulder>leftElbow', 'pelvis>chest']],
    ['thigh', swing(0.72, -0.25, speed * 2), ['leftHip>leftKnee', 'rightHip>rightKnee']],
    ['shin', swing(0.3, -0.25, speed * 2), ['leftKnee>leftAnkle', 'rightKnee>rightAnkle']],
    // Down across the right forearm, from the side.
    ['forearm', { tick: 10, cause: 'Hit', blow: { point: { x: 0.24, y: 1.3, z: 0.82 }, bladeSpeed: speed, direction: 'Overhead', from: { x: 1, z: 0.8 }, cut: { hilt: { x: 0.6, y: 1.3, z: 0.82 }, tip: { x: 0, y: 1.3, z: 0.82 }, travel: { x: 0, y: -1, z: 0 } } } }, ['rightElbow>rightHand']],
  ];
  const fall = (death: Death, t: number, w = weapon, sheathed = false) => ragdollPose(pose, death, t, w, tuning, undefined, sheathed, severing(pose, death.blow, tuning));
  const all = (p: RagdollPose): Vec3[] => [...Object.values(p.joints), ...(p.stumps ?? []).flatMap((s) => s.ends)];

  it.each(cuts)('severs what the test expects: %s', (_, death, bones) => {
    expect(severing(pose, death.blow, tuning).map((s) => s.bone.join('>'))).toEqual(bones);
  });

  it('falls exactly as a whole body when nothing is severed, and has no stumps', () => {
    const { cut: _, ...uncut } = cuts[1]![1].blow!;
    for (const t of [0, 0.7, 3]) {
      const whole = ragdollPose(pose, { ...cuts[1]![1], blow: uncut }, t, weapon, tuning);
      expect(whole).not.toHaveProperty('stumps');
      // The cut itself changes nothing: only the bones it severs do.
      expect(ragdollPose(pose, cuts[1]![1], t, weapon, tuning, undefined, false, [])).toEqual(whole);
    }
  });

  it.each(cuts)('starts from the pose it fell in, both ends of each cut where the bone is cut: %s', (_, death) => {
    const severed = severing(pose, death.blow, tuning);
    const p = fall(death, 0);
    expect(p.joints).toEqual(pose.joints);
    expect(p.stumps).toEqual(severed.map((s) => ({ bone: s.bone, ends: [s.at, s.at] })));
    expect(fall(death, 1).stumps!.map((s) => s.bone)).toEqual(severed.map((s) => s.bone));
  });

  it.each(cuts)('is still whole before the Death: %s', (_, death) => {
    const p = fall(death, -0.5 / 60);
    expect(p).not.toHaveProperty('stumps');
    expect(p.joints).toEqual(pose.joints);
  });

  it.each(cuts)('is the same fall every time, frame by frame as in one go, and when scrubbed back: %s', (_, death) => {
    const fresh = ragdollPose(pose, death, 1.3, { ...weapon }, tuning, undefined, false, severing(pose, death.blow, tuning));
    for (let t = 0; t <= 1.3; t += 1 / 60) fall(death, t);
    expect(fall(death, 1.3)).toEqual(fresh);
    fall(death, 2.5);
    expect(fall(death, 1.3)).toEqual(fresh);
  });

  it.each(cuts)('comes apart at the cut, each side keeping its part of the bone: %s', (_, death) => {
    const severed = severing(pose, death.blow, tuning);
    const lying = fall(death, 3);
    lying.stumps!.forEach((stump, k) => {
      expect(d(stump.ends[0], stump.ends[1]), stump.bone.join('>')).toBeGreaterThan(0.1);
      stump.bone.forEach((joint, side) => expect(d(lying.joints[joint], stump.ends[side]!)).toBeCloseTo(d(pose.joints[joint], severed[k]!.at), 2));
    });
  });

  it.each(cuts)('keeps every other bone whole: %s', (_, death) => {
    const cutBones = severing(pose, death.blow, tuning).map((s) => s.bone.join('>'));
    const lying = fall(death, 3);
    for (const [a, b] of BONES) if (!cutBones.includes(`${a}>${b}`)) expect(d(lying.joints[a], lying.joints[b]), `${a}>${b}`).toBeCloseTo(d(pose.joints[a], pose.joints[b]), 1);
  });

  it.each(cuts)('settles every piece on the floor, the body near where it fell and the severed parts not far off, and lies still: %s', (_, death) => {
    const lying = fall(death, 3);
    const piece = pieceOf(lying.stumps!);
    for (const [n, p] of Object.entries(lying.joints)) {
      expect(Math.hypot(p.x - pose.joints.pelvis.x, p.z - pose.joints.pelvis.z), n).toBeLessThan(piece[n as keyof typeof piece] === 0 ? 3 : 6);
    }
    // Flat on the floor, but for a knee or elbow propped up as on a whole body.
    expect(all(lying).reduce((sum, p) => sum + p.y, 0) / all(lying).length).toBeLessThan(0.2);
    for (const p of all(lying)) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(0.5);
    }
    expect(fall(death, 10)).toEqual(fall(death, 20));
    // It has come to rest by itself, not only been stopped: nothing is still sliding or turning.
    const before = all(fall(death, 2.8));
    all(lying).forEach((p, i) => expect(d(p, before[i]!)).toBeLessThan(0.03));
  });

  it.each(cuts)('gains no height from nowhere: nothing but a severed part tossed off goes up, bounces back or floats off the floor: %s', (_, death) => {
    const top = Math.max(...all(fall(death, 0)).map((p) => p.y));
    let last = Infinity;
    for (let t = 1 / 30; t <= 3; t += 1 / 30) {
      const ys = all(fall(death, t)).map((p) => p.y);
      // A severed head or limb is tossed up as it flies off (src/render/ragdoll.ts SEVER_POP), no higher.
      expect(Math.max(...ys), `at ${t.toFixed(2)}s`).toBeLessThan(top + 0.4);
      const height = ys.reduce((s, y) => s + y, 0) / ys.length;
      // Once down it stays down.
      if (t > 1.5) expect(height, `at ${t.toFixed(2)}s`).toBeLessThan(Math.min(0.35, last + 0.01));
      last = height;
    }
  });

  it('settles whatever a level or a falling blade severs, at any height and from either side', () => {
    let severedSomething = 0;
    for (let y = 0.15; y < 1.7; y += 0.11)
      for (const [x, travel] of [[-0.45, { x: 1, y: 0, z: 0 }], [0.45, { x: -1, y: 0, z: 0 }], [-0.3, { x: 0.6, y: -0.8, z: 0 }], [0.3, { x: -0.6, y: -0.8, z: 0 }]] as const) {
        const base = swing(y, x, speed * 2);
        const death: Death = { ...base, blow: { ...base.blow!, direction: travel.y ? 'Overhead' : travel.x > 0 ? 'Right' : 'Left', cut: { ...base.blow!.cut!, travel } } };
        const severed = severing(pose, death.blow, tuning);
        if (severed.length === 0) continue;
        severedSomething++;
        const at = `${severed.map((s) => s.bone.join('>'))} at height ${y.toFixed(2)} from ${x}`;
        for (const t of [2, 3]) {
          const ys = all(fall(death, t)).map((p) => p.y);
          expect(Math.min(...ys), at).toBeGreaterThan(0);
          expect(Math.max(...ys), at).toBeLessThan(0.6);
          expect(ys.reduce((sum, v) => sum + v, 0) / ys.length, at).toBeLessThan(0.25);
        }
      }
    expect(severedSomething).toBeGreaterThan(30);
  });

  it('drives the severed piece on along the blade and leaves the rest behind', () => {
    const death = cuts[0]![1];
    const whole = ragdollPose(pose, death, 0.3, weapon, tuning);
    const cut = fall(death, 0.3);
    // The head goes the way the blade went (+x) faster than it would on the shoulders, tossed up as it goes.
    expect(cut.joints.head.x).toBeGreaterThan(whole.joints.head.x + 0.1);
    expect(cut.joints.head.y).toBeGreaterThan(pose.joints.head.y);
    // And it lands well clear of the body, where it is easy to see.
    const lying = fall(death, 3);
    expect(Math.hypot(lying.joints.head.x - lying.joints.pelvis.x, lying.joints.head.z - lying.joints.pelvis.z)).toBeGreaterThan(1.5);
  });

  it('flies a severed limb off level even when the blade came down through it', () => {
    const death = cuts[4]![1];
    const whole = ragdollPose(pose, death, 3, weapon, tuning);
    const lying = fall(death, 3);
    expect(d(lying.joints.rightHand, lying.joints.rightElbow)).toBeGreaterThan(d(whole.joints.rightHand, whole.joints.rightElbow) + 0.5);
  });

  it('never bends a knee backwards on the half that keeps its legs', () => {
    const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    for (const t of [0.4, 1, 3]) {
      const { joints: j } = fall(cuts[1]![1], t);
      const left = sub(j.rightHip, j.leftHip);
      for (const side of ['left', 'right'] as const) {
        const knee = cross(sub(j[`${side}Hip`], j[`${side}Knee`]), sub(j[`${side}Knee`], j[`${side}Ankle`]));
        expect(dot(knee, left), `${side} knee at ${t}s`).toBeGreaterThan(0);
      }
    }
  });

  it('still lets go of the Weapon when the sword hand is cut off', () => {
    const lying = fall(cuts[4]![1], 3);
    expect(d(lying.blade.hilt, lying.blade.tip)).toBeCloseTo(d(pose.blade.hilt, pose.blade.tip), 1);
    expect(d(lying.blade.hilt, lying.joints.rightHand)).toBeGreaterThan(0.15);
    expect(Math.max(lying.blade.hilt.y, lying.blade.tip.y)).toBeLessThan(0.2);
  });

  it.each(['Arming Sword', 'Longsword', 'Halberd'])('keeps a Sheathed %s on the half of a body cut in two that it rides on', (name) => {
    const w = weaponByName(tuning, name);
    const death = cuts[1]![1];
    const start = fall(death, 0, w, true);
    expect(start.blade).toEqual(sheathedBlade(pose, w));
    const on = w.sheathe.slot === 'hip' ? (['pelvis', 'leftHip', 'rightHip'] as const) : (['chest', 'leftShoulder', 'rightShoulder'] as const);
    const from = (p: SkeletonPose) => on.flatMap((n) => [d(p.blade.hilt, p.joints[n]), d(p.blade.tip, p.joints[n])]);
    for (const t of [0.5, 1.5, 3]) {
      const lying = fall(death, t, w, true);
      from(lying).forEach((v, k) => expect(v).toBeCloseTo(from(start)[k]!, 1));
      expect(lowest(lying)).toBeGreaterThan(0);
    }
  });
});
