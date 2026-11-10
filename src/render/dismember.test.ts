import { describe, expect, it } from 'vitest';
import { attack, BONES, createInitialState, duelPlacements, fighterPose, JOINT_NAMES, runDuel, type Death, type DeathBlow, type Vec3 } from '../sim';
import { loadTuningData, sizedTuning, weaponByName, withWeapon } from '../tuning';
import { pieceOf, piecePoses, severing } from './dismember';
import { ragdollPose } from './ragdoll';

const tuning = loadTuningData();
/** Standing at +z, facing -z: its left side is at -x. */
const pose = fighterPose(createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!, tuning);
const { carry, speed } = tuning.fighter.dismember;
const weapon = weaponByName(tuning, createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!.weapon);

/** A blow whose blade lay from `hilt` to `tip` and was going along `travel` (made unit), struck at `point` (default: the middle of the blade). */
function blow(hilt: Vec3, tip: Vec3, travel: Vec3, bladeSpeed = speed, point?: Vec3): DeathBlow {
  const l = Math.hypot(travel.x, travel.y, travel.z);
  const mid = { x: (hilt.x + tip.x) / 2, y: (hilt.y + tip.y) / 2, z: (hilt.z + tip.z) / 2 };
  return { point: point ?? mid, bladeSpeed, direction: 'Right', from: { x: 0, z: -1 }, cut: { hilt, tip, travel: { x: travel.x / l, y: travel.y / l, z: travel.z / l } } };
}
/** A level swing at height `y` from the attacker at -z, the blade starting at `x` and going toward +x. */
const level = (y: number, x: number, bladeSpeed = speed) => blow({ x, y, z: 0.3 }, { x, y, z: 1.15 }, { x: 1, y: 0, z: 0 }, bladeSpeed, { x, y, z: 1.05 });
const bones = (b: DeathBlow | null, t = tuning) => severing(pose, b, t).map((s) => s.bone.join('>'));

describe('severing', () => {
  it('severs nothing without a cut', () => {
    expect(severing(pose, null, tuning)).toEqual([]);
    const { cut: _, ...thrust } = level(1.2, -0.36);
    expect(severing(pose, thrust, tuning)).toEqual([]);
  });

  it('takes an arm off where the blade passes through it only', () => {
    // Down across the right forearm, from the side.
    const down = blow({ x: 0.6, y: 1.3, z: 0.82 }, { x: 0, y: 1.3, z: 0.82 }, { x: 0, y: -1, z: 0 });
    const [arm, ...rest] = severing(pose, down, tuning);
    expect(rest).toEqual([]);
    expect(arm!.bone).toEqual(['rightElbow', 'rightHand']);
    // On the bone, in the plane the blade was moving in.
    expect(arm!.at.z).toBeCloseTo(0.82, 6);
    expect(Math.abs(arm!.normal.z)).toBeCloseTo(1, 6);
    const { rightElbow: e, rightHand: h } = pose.joints;
    const t = (arm!.at.z - e.z) / (h.z - e.z);
    expect(arm!.at.x).toBeCloseTo(e.x + (h.x - e.x) * t, 6);
    expect(arm!.at.y).toBeCloseTo(e.y + (h.y - e.y) * t, 6);
  });

  it('takes the head off at the neck', () => {
    expect(bones(level(1.5, -0.15))).toEqual(['chest>head']);
    const [neck] = severing(pose, level(1.5, -0.15), tuning);
    expect(neck!.at.y).toBeCloseTo(1.5, 2);
    // A cut through the head itself still parts it at the neck, below the head.
    const [face] = severing(pose, level(pose.joints.head.y - 0.02, -0.15), tuning);
    expect(face!.bone).toEqual(['chest', 'head']);
    expect(face!.at.y).toBeCloseTo(pose.joints.chest.y + tuning.skeleton.neck, 2);
    // So does one through the top half of the head, above its joint; one over the head misses.
    const [brow] = severing(pose, level(pose.joints.head.y + 0.06, -0.15), tuning);
    expect(brow!.bone).toEqual(['chest', 'head']);
    expect(brow!.at.y).toBeCloseTo(face!.at.y, 9);
    expect(bones(level(pose.joints.head.y + tuning.skeleton.headRadius + 0.02, -0.15))).toEqual([]);
  });

  it('cuts the body in two at the waist, with the arm in the way, nearest to the contact first', () => {
    expect(bones(level(1.2, -0.36))).toEqual(['leftShoulder>leftElbow', 'pelvis>chest']);
  });

  it('severs less with a shallow reach and more with a deep one', () => {
    expect(bones(level(1.2, -0.36, speed * 0.35))).toEqual(['leftShoulder>leftElbow']);
    expect(bones(level(1.2, -0.36, speed * 3))).toEqual(['leftShoulder>leftElbow', 'pelvis>chest', 'rightShoulder>rightElbow']);
    // A blade whose tip stops short of the spine only takes the arm.
    const short = blow({ x: -0.36, y: 1.2, z: 0.3 }, { x: -0.36, y: 1.2, z: 0.8 }, { x: 1, y: 0, z: 0 });
    expect(bones(short)).toEqual([]);
    // And one that never reaches the body severs nothing.
    expect(bones(level(1.2, -0.36 - carry - 0.2))).toEqual([]);
  });

  it('severs at most maxCuts bones', () => {
    const one = { ...tuning, fighter: { ...tuning.fighter, dismember: { ...tuning.fighter.dismember, maxCuts: 1 } } };
    expect(bones(level(1.2, -0.36, speed * 3), one)).toEqual(['leftShoulder>leftElbow']);
  });

  it('does not sever a bone the blade runs along', () => {
    // Straight down through the middle of the body: the plane holds the spine and the neck.
    const cleave = (lean: number) => blow({ x: -0.07, y: 1.5, z: 0.3 }, { x: -0.07, y: 1.5, z: 1.15 }, { x: lean, y: -1, z: 0 });
    expect(bones(cleave(0))).toEqual([]);
    // Leaning a little, the plane crosses the spine within reach, but nearly along it.
    expect(bones(cleave(0.25))).toEqual([]);
    expect(bones(cleave(0.6))).toEqual(['pelvis>chest']);
  });

  it('keeps every cut off the joints', () => {
    for (let y = 0.1; y < 1.7; y += 0.01)
      for (const s of severing(pose, level(y, -0.4, speed * 4), tuning)) {
        const [a, b] = [pose.joints[s.bone[0]], pose.joints[s.bone[1]]];
        const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const t = Math.hypot(s.at.x - a.x, s.at.y - a.y, s.at.z - a.z) / l;
        expect(t, `${s.bone.join('>')} at height ${y.toFixed(2)}`).toBeGreaterThan(0.1 - 1e-9);
        expect(t).toBeLessThan(0.9 + 1e-9);
      }
  });

  it('reaches further into a thicker Fighter', () => {
    // The blade stops a little short of the standard spine; a thick body's is within reach.
    const b = level(1.2, -0.36, speed * 0.75);
    expect(bones(b)).not.toContain('pelvis>chest');
    const thick = sizedTuning(tuning, { height: 1, thick: 1.4 });
    expect(severing(pose, b, thick).map((s) => s.bone.join('>'))).toContain('pelvis>chest');
  });

  it('severs something for a real Left or Right kill with a sword, the same every time', () => {
    const deadly = Object.keys(tuning.weapons).reduce((t, name) => withWeapon(t, { damage: 10_000 }, name), tuning);
    for (const weapon of ['Arming Sword', 'Longsword'])
      for (const direction of ['Left', 'Right'] as const) {
        const run = runDuel(deadly, { placements: duelPlacements(1.3), weapons: [weapon, 'Arming Sword'], a: attack(direction), b: [] });
        const fallen = run.states.find((s) => s.fighters[1]!.death)!.fighters[1]!;
        const fell = fighterPose(fallen, deadly);
        const cut = severing(fell, fallen.death!.blow, deadly);
        expect(cut.length, `${weapon} ${direction}`).toBeGreaterThan(0);
        expect(cut.length).toBeLessThanOrEqual(deadly.fighter.dismember.maxCuts);
        expect(severing(fell, fallen.death!.blow, deadly)).toEqual(cut);
      }
  });
});

describe('pieceOf', () => {
  const at = { x: 0, y: 0, z: 0 };
  const cut = (...b: [string, string][]) => pieceOf(b.map((bone) => ({ bone, at, normal: at })) as never);

  it('is one piece with nothing severed', () => {
    expect(new Set(Object.values(pieceOf([])))).toEqual(new Set([0]));
    expect(Object.keys(pieceOf([])).sort()).toEqual([...JOINT_NAMES].sort());
  });

  it('parts the body at each severed bone, the pelvis in piece 0', () => {
    const arm = cut(['rightElbow', 'rightHand']);
    expect(arm.rightHand).toBe(1);
    expect(Object.entries(arm).filter(([, q]) => q !== 0)).toEqual([['rightHand', 1]]);

    const waist = cut(['pelvis', 'chest']);
    for (const n of ['pelvis', 'leftHip', 'rightHip', 'leftKnee', 'leftToe', 'rightAnkle'] as const) expect(waist[n]).toBe(0);
    for (const n of ['chest', 'head', 'leftShoulder', 'rightShoulder', 'leftHand', 'rightElbow'] as const) expect(waist[n]).toBe(1);

    const three = cut(['chest', 'head'], ['leftHip', 'leftKnee']);
    expect(three.head).toBe(1);
    expect([three.leftKnee, three.leftAnkle, three.leftToe]).toEqual([2, 2, 2]);
    expect([three.chest, three.leftHip, three.rightToe]).toEqual([0, 0, 0]);

    // Two cuts on one arm leave the elbow a piece of its own.
    const twice = cut(['leftShoulder', 'leftElbow'], ['leftElbow', 'leftHand']);
    expect(new Set([twice.leftShoulder, twice.leftElbow, twice.leftHand]).size).toBe(3);
  });
});

describe('piecePoses', () => {
  const death = (b: DeathBlow): Death => ({ tick: 10, cause: 'Hit', blow: b });
  const down = blow({ x: 0.6, y: 1.3, z: 0.82 }, { x: 0, y: 1.3, z: 0.82 }, { x: 0, y: -1, z: 0 });
  const kills: [name: string, blow: DeathBlow][] = [
    ['neck', level(1.5, -0.15)],
    ['waist', level(1.2, -0.36)],
    ['thighs', level(0.72, -0.25, speed * 2)],
    ['forearm', down],
  ];
  const fallOf = (b: DeathBlow, t: number) => ragdollPose(pose, death(b), t, weapon, tuning, undefined, false, severing(pose, b, tuning));
  const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const LINKS = [...BONES, ['chest', 'leftShoulder'], ['chest', 'rightShoulder'], ['pelvis', 'leftHip'], ['pelvis', 'rightHip']] as const;

  it('is the whole pose, one piece, when nothing is severed', () => {
    const whole = ragdollPose(pose, death(level(1.2, -0.36)), 1, weapon, tuning);
    expect(piecePoses(pose, whole)).toEqual([whole]);
  });

  it.each(kills)('has one pose per piece, each piece’s own joints where they lie: %s', (_, b) => {
    for (const t of [0, 0.6, 3]) {
      const fall = fallOf(b, t);
      const piece = pieceOf(fall.stumps!);
      const poses = piecePoses(pose, fall);
      expect(poses).toHaveLength(Math.max(...Object.values(piece)) + 1);
      poses.forEach((p, k) => {
        expect(p.blade).toEqual(fall.blade);
        for (const n of JOINT_NAMES) if (piece[n] === k) expect(p.joints[n]).toEqual(fall.joints[n]);
      });
    }
  });

  it.each(kills)('rebuilds a severed bone’s missing end along its stump, at its length: %s', (_, b) => {
    const fall = fallOf(b, 3);
    const piece = pieceOf(fall.stumps!);
    for (const { bone, ends } of fall.stumps!) {
      bone.forEach((own, side) => {
        const other = bone[1 - side]!;
        const p = piecePoses(pose, fall)[piece[own]]!;
        const len = d(pose.joints[own], pose.joints[other]);
        expect(d(p.joints[own], p.joints[other])).toBeCloseTo(len, 6);
        // On the line from the joint through its cut end, beyond it.
        const stub = d(p.joints[own], ends[side]!);
        expect(stub + d(ends[side]!, p.joints[other])).toBeCloseTo(len, 6);
      });
    }
  });

  it.each(kills)('carries the other pieces along rigidly, so every bone keeps its length: %s', (_, b) => {
    const fall = fallOf(b, 3);
    for (const p of piecePoses(pose, fall))
      for (const [a, c] of LINKS) expect(d(p.joints[a], p.joints[c]), `${a}>${c}`).toBeCloseTo(d(pose.joints[a], pose.joints[c]), 1);
  });

  it('is the pose it fell in, for every piece, on the Tick of the Death', () => {
    const fall = fallOf(level(1.2, -0.36), 0);
    for (const p of piecePoses(pose, fall)) for (const n of JOINT_NAMES) for (const c of ['x', 'y', 'z'] as const) expect(p.joints[n][c]).toBeCloseTo(pose.joints[n][c], 9);
  });

  it('is the same every time', () => {
    expect(piecePoses(pose, fallOf(down, 1.1))).toEqual(piecePoses(pose, fallOf(down, 1.1)));
  });
});

describe('piecePoses, a piece that rolls', () => {
  it('rolls the joints that ride along about the severed bone as the piece itself rolled', () => {
    // The hips' half of a body cut at the waist, turned a quarter round the spine (which is upright): what rides along turns with it.
    const severed = severing(pose, level(1.2, -0.36), tuning).filter((s) => s.bone[0] === 'pelvis');
    expect(severed).toHaveLength(1);
    const { pelvis } = pose.joints;
    const quarter = (p: Vec3): Vec3 => ({ x: pelvis.x + (p.z - pelvis.z), y: p.y, z: pelvis.z - (p.x - pelvis.x) });
    const piece = pieceOf(severed);
    const joints = Object.fromEntries(JOINT_NAMES.map((n) => [n, piece[n] === 0 ? quarter(pose.joints[n]) : pose.joints[n]])) as typeof pose.joints;
    const fall = { joints, blade: pose.blade, stumps: [{ bone: severed[0]!.bone, ends: [quarter(severed[0]!.at), severed[0]!.at] as const }] };
    const [hips] = piecePoses(pose, fall);
    for (const n of JOINT_NAMES) {
      const want = quarter(pose.joints[n]);
      expect(Math.hypot(hips!.joints[n].x - want.x, hips!.joints[n].y - want.y, hips!.joints[n].z - want.z)).toBeLessThan(1e-9);
    }
  });
});
