import { describe, expect, it } from 'vitest';
import { isSize, loadTuningData, sizedTuning, type TuningData } from '../tuning';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  createCrowd,
  createMatch,
  fighterPose,
  hashValue,
  IDLE_INTENT,
  soldierSize,
  soldierSizes,
  soldierTroops,
  standingFighter,
  stepBubbles,
  stepMatch,
  TICK_SECONDS,
  type CrowdState,
  type FighterState,
  type MatchState,
} from '.';

const tuning = loadTuningData();
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
const army = small.battle.armySize;
const takeoverTicks = Math.round(small.battle.takeover.seconds / TICK_SECONDS);

const battle = (sizes?: { height: number; thick: number }[]) => createMatch(small, { format: 'Battle', bestOf: 1, seed: 7, teams: [0], ...(sizes ? { sizes } : {}) });

const ground = (m: MatchState, x: number, z: number) => battlefieldHeight(battlefieldOf(small.battle, m.arena)!.heights, x, z);

function playerAt(m: MatchState, x: number, z: number): MatchState {
  const f = m.duel.fighters[0]!;
  const moved = standingFighter(small, arenaOf(small, m.arena), { position: { x, z }, y: ground(m, x, z), facing: 0 }, f.weapon, f.team, f.size);
  return { ...m, duel: { ...m.duel, fighters: [moved, ...m.duel.fighters.slice(1)] } };
}

/** `m` with the Crowd's arrays changed by `edit` (on copies). */
function withCrowd(m: MatchState, edit: (c: { x: number[]; z: number[]; hp: number[]; alive: number[]; slot: number[]; sizeHeight: number[]; sizeThick: number[] }) => void): MatchState {
  const c = m.duel.crowd!;
  const copy = { x: c.x.slice(), z: c.z.slice(), hp: c.hp.slice(), alive: c.alive.slice(), slot: c.slot.slice(), sizeHeight: c.sizeHeight.slice(), sizeThick: c.sizeThick.slice() };
  edit(copy);
  const crowd: CrowdState = { ...c, ...copy };
  return { ...m, duel: { ...m.duel, crowd } };
}

describe("Soldiers' Sizes", () => {
  // The bell curve is each Soldier's own draw; a Troop's `height` and `width` ranges then cut it (tested below), so here no Troop has one.
  const unranged = tuning.battle.troops.map(({ height: _h, width: _w, ...troop }) => troop);
  const big = { ...tuning.battle, armySize: 2000, troops: unranged };
  const { height, thick } = soldierSizes(big, 3, 2 * big.armySize);

  it('are every one a valid Size, on a narrow bell curve round the standard body', () => {
    for (let i = 0; i < height.length; i++) expect(isSize({ height: height[i], thick: thick[i] })).toBe(true);
    for (const part of [height, thick]) {
      const mean = part.reduce((a, b) => a + b, 0) / part.length;
      const sd = Math.sqrt(part.reduce((a, b) => a + (b - mean) ** 2, 0) / part.length);
      expect(mean).toBeCloseTo(1, 1);
      // The spread Tuning Data names (snapping to the 0.05 step adds a little).
      expect(sd).toBeGreaterThan(big.soldier.sizeSpread * 0.85);
      expect(sd).toBeLessThan(big.soldier.sizeSpread * 1.2);
      // Most near the standard body, outliers rare: a tall, narrow bell, not a flat spread.
      const near = part.filter((v) => Math.abs(v - 1) <= 0.1 + 1e-9).length / part.length;
      const far = part.filter((v) => Math.abs(v - 1) >= 0.25 - 1e-9).length / part.length;
      expect(near).toBeGreaterThan(0.75);
      expect(far).toBeLessThan(0.01);
      expect(Math.min(...part)).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...part)).toBeLessThanOrEqual(1.4);
    }
  });

  it('draw height and thickness apart, and give both armies the same bodies place for place', () => {
    expect(height).not.toEqual(thick);
    for (let k = 0; k < big.armySize; k++) {
      expect(height[k + big.armySize]).toBe(height[k]);
      expect(thick[k + big.armySize]).toBe(thick[k]);
    }
  });

  it('come from the seed alone, so every peer draws the same, and a spread of 0 is all standard bodies', () => {
    expect(soldierSizes(big, 3, 2 * big.armySize)).toEqual({ height, thick });
    expect(soldierSizes(big, 4, 2 * big.armySize).height).not.toEqual(height);
    const flat = soldierSizes({ ...big, soldier: { ...big.soldier, sizeSpread: 0 } }, 3, 10);
    expect(flat.height.every((v) => v === 1) && flat.thick.every((v) => v === 1)).toBe(true);
    const crowd = createCrowd(small.battle, 7);
    expect(crowd.sizeHeight).toEqual(soldierSizes(small.battle, 7, crowd.x.length).height);
    expect(hashValue(createCrowd(small.battle, 7))).toBe(hashValue(crowd));
  });
});

describe("A Troop's height and width ranges", () => {
  const ranged = { ...tuning.battle, armySize: 2000 };
  const n = 2 * ranged.armySize;
  const { troop } = soldierTroops(ranged, 3, n);

  it('cut the Size of every Soldier of the Troop, whatever the spread', () => {
    const rangedTroops = ranged.troops.filter((t) => t.height || t.width);
    expect(rangedTroops.length, 'the Tuning Data names some ranges').toBeGreaterThan(0);
    for (const sizeSpread of [ranged.soldier.sizeSpread, 0]) {
      const { height, thick } = soldierSizes({ ...ranged, soldier: { ...ranged.soldier, sizeSpread } }, 3, n);
      // Sizes snap to a step, so a bound may be passed by half of it.
      const slack = 0.05;
      for (let i = 0; i < n; i++) {
        const t = ranged.troops[troop[i]!]!;
        if (t.height) expect(height[i]!, `Soldier ${i} (${t.name}) height, spread ${sizeSpread}`).toBeGreaterThanOrEqual(t.height[0] - slack);
        if (t.height) expect(height[i]!, `Soldier ${i} (${t.name}) height, spread ${sizeSpread}`).toBeLessThanOrEqual(t.height[1] + slack);
        if (t.width) expect(thick[i]!, `Soldier ${i} (${t.name}) width, spread ${sizeSpread}`).toBeGreaterThanOrEqual(t.width[0] - slack);
        if (t.width) expect(thick[i]!, `Soldier ${i} (${t.name}) width, spread ${sizeSpread}`).toBeLessThanOrEqual(t.width[1] + slack);
      }
    }
  });

  it('with none in the Tuning Data, a spread of 0 is all standard bodies', () => {
    const none = { ...ranged, soldier: { ...ranged.soldier, sizeSpread: 0 }, troops: ranged.troops.map(({ height: _h, width: _w, ...x }) => x) };
    const flat = soldierSizes(none, 3, n);
    expect(flat.height.every((v) => v === 1) && flat.thick.every((v) => v === 1)).toBe(true);
  });
});

describe('A promoted Soldier', () => {
  /** The Player alone far out on the flank with enemy Soldier `s` 5 m in front, in a body of `size`. */
  const lone = (s: number, size: { height: number; thick: number }) =>
    withCrowd(playerAt(battle(), 60, 0), (c) => {
      for (let i = 0; i < c.x.length; i++) if (i !== s && c.alive[i]) [c.x[i], c.z[i]] = [c.x[i]! < 0 ? c.x[i]! - 200 : c.x[i]! - 100, c.z[i]!];
      [c.x[s], c.z[s]] = [60, 5];
      [c.sizeHeight[s], c.sizeThick[s]] = [size.height, size.thick];
    });

  it('becomes a full Fighter of its own Size, standing on the ground, and back in the Crowd keeps it', () => {
    const s = army + 3;
    let m = stepMatch(lone(s, { height: 1.3, thick: 0.75 }), [IDLE_INTENT], small);
    const k = m.duel.fighters.findIndex((f) => f.soldier?.index === s);
    expect(k).toBeGreaterThan(0);
    const f = m.duel.fighters[k]!;
    expect(f.size).toEqual({ height: 1.3, thick: 0.75 });
    // Its feet on the ground, its head as high as its height says.
    const pose = fighterPose(f, small);
    const floor = ground(m, 60, 5);
    expect(f.y).toBeCloseTo(floor, 6);
    const standard = fighterPose({ ...f, size: undefined }, small);
    expect((pose.joints.head.y - floor) / (standard.joints.head.y - floor)).toBeCloseTo(1.3, 1);
    expect(Math.min(pose.joints.leftAnkle.y, pose.joints.rightAnkle.y) - floor).toBeCloseTo(sizedTuning(small, f.size).skeleton.ankleHeight, 2);
    // Walks away: it demotes, and its Size stays the Soldier's.
    m = playerAt(m, 60, -40);
    for (let t = 0; t < 120 && m.duel.fighters[k]!.soldier; t++) m = stepMatch(m, [IDLE_INTENT], small);
    expect(m.duel.fighters[k]!.soldier).toBeUndefined();
    expect(soldierSize(m.duel.crowd!, s)).toEqual({ height: 1.3, thick: 0.75 });
  });

  it('of the standard body has no Size', () => {
    const m = stepMatch(lone(army + 3, { height: 1, thick: 1 }), [IDLE_INTENT], small);
    expect(m.duel.fighters.find((f) => f.soldier?.index === army + 3)!.size).toBeUndefined();
  });
});

describe('A Player taking over a Soldier', () => {
  const mine = { height: 1.2, thick: 0.9 };
  /** The Player (in `size`) fallen at (60, 0); ally Soldier 1, of another Size, 4 m off; the rest far away. */
  const fallen = (size?: { height: number; thick: number }) => {
    const m = withCrowd(playerAt(battle(size && [size]), 60, 0), (c) => {
      for (let i = 0; i < c.x.length; i++) if (i !== 1) [c.alive[i], c.hp[i]] = [0, 0];
      [c.x[1], c.z[1], c.sizeHeight[1], c.sizeThick[1]] = [64, 0, 0.7, 1.35];
    });
    const f = m.duel.fighters[0]!;
    return { ...m, duel: { ...m.duel, fighters: [{ ...f, hp: 0, death: { tick: m.duel.tick, cause: 'Hit' as const, blow: null } }, ...m.duel.fighters.slice(1)] } };
  };

  it("keeps the Player's own Size, not the Soldier's, and its impostor follows the Player's", () => {
    const start = fallen(mine);
    expect(start.duel.fighters[0]!.size).toEqual(mine);
    const next = stepBubbles(start.duel, 1, start.duel.tick + takeoverTicks, small);
    const me = next.fighters[0]!;
    expect(next.crowd!.slot[1]).toBe(0);
    expect(me.size).toEqual(mine);
    expect(me.y).toBeCloseTo(ground(start, 64, 0), 6);
    expect(soldierSize(next.crowd!, 1)).toEqual(mine);
  });

  it('of the standard body stays the standard body', () => {
    const start = fallen();
    const next = stepBubbles(start.duel, 1, start.duel.tick + takeoverTicks, small);
    expect(next.fighters[0]!.size).toBeUndefined();
    expect(soldierSize(next.crowd!, 1)).toBeUndefined();
  });

  it("re-makes a promoted ally of another Size in the Player's, where it stands, at `takeover.hp`", () => {
    const start = fallen(mine);
    const ally: FighterState = {
      ...standingFighter(small, arenaOf(small, start.arena), { position: { x: 61, z: 1 }, y: ground(start, 61, 1), facing: 1 }, small.battle.soldier.weapon, 0, { height: 0.7, thick: 1.35 }),
      hp: 22,
      maxHp: small.battle.crowd.hp,
      soldier: { index: 1, since: 0, role: 'Ally' },
    };
    const m = withCrowd({ ...start, duel: { ...start.duel, fighters: start.duel.fighters.map((f, i) => (i === 3 ? ally : f)) } }, (c) => {
      c.slot[1] = 3;
    });
    const next = stepBubbles(m.duel, 1, m.duel.tick + takeoverTicks, small);
    const me = next.fighters[0]!;
    expect(me.size).toEqual(mine);
    expect(me.position).toEqual(ally.position);
    expect(me.facing).toBe(1);
    expect(me.hp).toBe(100);
    expect(me.soldier).toBeUndefined();
    expect(next.fighters[3]!.benched).toBe(true);
  });
});
