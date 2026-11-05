/**
 * docs/plans/battle-objectives.md, Stage 1: Squads and Formations on the open field. Deployment in Squads, the column on the march
 * and the line in contact, wheeling at a limited rate, the front rank closing while the rear holds, the rear stepping up into gaps,
 * a Squad that breaks falling back and merging, Promotion and Demotion keeping Squad membership, and the state's determinism:
 * the same seed gives the same hash every Tick, a snapshot continues identically, a Rollback across a fall and a merge lands on the
 * same state.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, squadSizes, type TuningData } from '../tuning';
import {
  COLUMN,
  createCrowd,
  createMatch,
  hashValue,
  IDLE_INTENT,
  LINE,
  LOOSE,
  placeOffset,
  restore,
  snapshot,
  stepCrowd,
  stepMatch,
  TICK_SECONDS,
  type CrowdState,
  type Intent,
  type MatchState,
  type SquadState,
} from '.';
import { arenaOf, battlefieldHeight, battlefieldOf, battleMapOf, orderSpot, standingFighter } from '.';

const tuning = loadTuningData();
/** Three Squads a side (13, 13 and 14 Soldiers), close together: a Battle is quick, and the Squads stand next to each other. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
const army = small.battle.armySize;
const { squad: sq } = small.battle;

const battle = (t: TuningData = small, seed = 1) => createMatch(t, { format: 'Battle', bestOf: 1, seed, teams: [0] });
const walk = (x: number, z: number): Intent => ({ ...IDLE_INTENT, move: { x, z }, face: Math.atan2(x, z) });

/** `match` with the Crowd and its Squads changed by `edit` (on copies of the arrays it touches). */
function withCrowd(match: MatchState, edit: (c: { [K in 'x' | 'z' | 'hp' | 'alive' | 'slot' | 'squad' | 'place']: number[] }, s: { [K in keyof SquadState]: number[] }) => void): MatchState {
  const c = match.duel.crowd!;
  const arrays = { x: c.x.slice(), z: c.z.slice(), hp: c.hp.slice(), alive: c.alive.slice(), slot: c.slot.slice(), squad: c.squad.slice(), place: c.place.slice() };
  const sa = Object.fromEntries(Object.entries(c.squads).map(([k, v]) => [k, v.slice()])) as { [K in keyof SquadState]: number[] };
  edit(arrays, sa);
  const crowd: CrowdState = { ...c, ...arrays, squads: sa };
  return { ...match, duel: { ...match.duel, crowd } };
}

/** The living Soldiers of Squad `q`, by index. */
const members = (c: CrowdState, q: number): number[] => c.squad.flatMap((s, i) => (s === q && c.alive[i] ? [i] : []));

/** Where Soldier `i` should stand: its place round its Squad's anchor. */
function placeOf(t: TuningData, c: CrowdState, i: number): [number, number] {
  const q = c.squad[i]!;
  const out: [number, number] = [0, 0];
  placeOffset(t.battle, c.squads.shape[q]!, c.place[i]!, c.squads.heading[q]!, out);
  return [c.squads.x[q]! + out[0], c.squads.z[q]! + out[1]];
}

const advance = (m: MatchState, ticks: number, t: TuningData = small, intents: readonly Intent[] = []): MatchState => {
  for (let k = 0; k < ticks; k++) m = stepMatch(m, intents, t);
  return m;
};

describe('deployment in Squads', () => {
  it('fields 16 Squads a side at 200 v 200 (12 Soldiers, the remainder 8 folded one each into the last 8), each in column round its anchor', () => {
    const m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1 });
    const c = m.duel.crowd!;
    expect(c.squads.team).toHaveLength(32);
    expect(c.squads.team.filter((t) => t === 0)).toHaveLength(16);
    const sizes = squadSizes(200, 12);
    for (let q = 0; q < 32; q++) {
      const mine = members(c, q);
      expect(mine, `Squad ${q}`).toHaveLength(sizes[q % 16]!);
      expect(c.squads.living[q]).toBe(sizes[q % 16]);
      expect(new Set(mine.map((i) => c.place[i])).size).toBe(mine.length);
      expect(Math.max(...mine.map((i) => c.place[i]!))).toBe(mine.length - 1);
      for (const i of mine) {
        expect(c.team[i]).toBe(c.squads.team[q]);
        const [px, pz] = placeOf(tuning, c, i);
        expect(c.x[i]).toBeCloseTo(px, 9);
        expect(c.z[i]).toBeCloseTo(pz, 9);
      }
      expect(c.squads.shape[q]).toBe(COLUMN);
    }
    // The armies are mirrors of each other through the centre, Team 0 facing +z.
    for (let q = 0; q < 16; q++) {
      expect(c.squads.x[q + 16]).toBeCloseTo(-c.squads.x[q]!, 9);
      expect(c.squads.z[q + 16]).toBeCloseTo(-c.squads.z[q]!, 9);
      expect(c.squads.heading[q]).toBe(0);
      expect(c.squads.heading[q + 16]).toBe(Math.PI);
    }
    // The front row of the front rank stands at `deploy.front`.
    expect(Math.max(...c.x.map((_, i) => (c.team[i] === 0 ? c.z[i]! : -Infinity)))).toBeCloseTo(-tuning.battle.deploy.front, 9);
  });

  it("deploys the Fighters' spawns behind the last rank", () => {
    const m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0] });
    const c = m.duel.crowd!;
    const back = Math.min(...c.z.filter((_, i) => c.team[i] === 0));
    expect(m.duel.fighters[0]!.position.z).toBeLessThan(back);
    expect(m.duel.fighters[0]!.position.z).toBeGreaterThan(back - 4);
  });
});

describe('Formations by the situation', () => {
  it('marches in column, its Soldiers in their places, then forms line on contact, wheeling no faster than the turn rate', () => {
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 });
    let firstLine = -1;
    const turn = tuning.battle.squad.turnRate * TICK_SECONDS;
    let prev = m.duel.crowd!.squads;
    for (let k = 0; k < 1900; k++) {
      m = stepMatch(m, [], tuning);
      const s = m.duel.crowd!.squads;
      for (let q = 0; q < s.team.length; q++) {
        const d = s.heading[q]! - prev.heading[q]!;
        expect(Math.abs(d - Math.PI * 2 * Math.round(d / (Math.PI * 2))), `Squad ${q} on Tick ${m.tick}`).toBeLessThanOrEqual(turn + 1e-9);
        if (s.shape[q] === LINE && firstLine < 0) firstLine = m.tick;
      }
      prev = s;
      if (m.tick === 600) {
        const c = m.duel.crowd!;
        // On the march: every Squad in column, advanced toward its Objective (the Squads with a long way to go 15 m or more; the Order
        // given at deployment holds for 15 s), its Soldiers in their places.
        expect(c.squads.shape.every((v) => v === COLUMN)).toBe(true);
        const first = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 }).duel.crowd!.squads;
        const map = battleMapOf(tuning.battle, 'battle:2');
        const spot: [number, number] = [0, 0];
        let marched = 0;
        for (let q = 0; q < 32; q++) {
          orderSpot(map, first.target[q]!, q, 16, tuning.battle, spot);
          const far = Math.hypot(spot[0] - first.x[q]!, spot[1] - first.z[q]!);
          if (far < 40) continue;
          marched++;
          expect(Math.hypot(c.squads.x[q]! - first.x[q]!, c.squads.z[q]! - first.z[q]!), `Squad ${q}`).toBeGreaterThan(15);
        }
        expect(marched).toBeGreaterThan(8);
        let near = 0;
        for (let i = 0; i < c.x.length; i++) {
          const [px, pz] = placeOf(tuning, c, i);
          if (Math.hypot(c.x[i]! - px, c.z[i]! - pz) <= 1.5 * tuning.battle.squad.spacing) near++;
        }
        expect(near / c.x.length).toBeGreaterThan(0.9);
      }
    }
    // The line forms on contact, not before (the armies are 80 m apart and close at about 4 m/s).
    expect(firstLine).toBeGreaterThan(900);
    expect(firstLine).toBeLessThan(1900);
    // Every Squad in line has an enemy Soldier within its engage distance (a brain step old at most) of its Soldiers.
    const c = m.duel.crowd!;
    for (let q = 0; q < 32; q++) {
      if (c.squads.shape[q] !== LINE) continue;
      const mine = members(c, q);
      const reach = tuning.battle.squad.engage + 2 * tuning.battle.crowd.walkSpeed * tuning.battle.squad.brainSeconds;
      expect(mine.some((i) => c.x.some((_, j) => c.alive[j] && c.team[j] !== c.team[i] && Math.hypot(c.x[i]! - c.x[j]!, c.z[i]! - c.z[j]!) <= reach)), `Squad ${q}`).toBe(true);
    }
  }, 60_000);

  it('closes the front rank of a line with an enemy in sight while the rear rank holds its places', () => {
    // Tick 6 is due for Soldiers 0 (place 0, the front rank) and 6 (place 6, the rear) of Squad 0.
    const start = withCrowd(battle(), (c, s) => {
      s.shape[0] = LINE;
      // Enemy Soldier `army` (Team 1's first) 8 m ahead of Soldier 0, in sight and out of reach.
      c.x[army] = c.x[0]!;
      c.z[army] = c.z[0]! + 8;
    });
    const before = start.duel.crowd!;
    const next = stepCrowd(before, 6, small.battle);
    const velocity = (i: number) => {
      const v = Math.hypot(next.x[i]! - before.x[i]!, next.z[i]! - before.z[i]!);
      return [(next.x[i]! - before.x[i]!) / v, (next.z[i]! - before.z[i]!) / v, v] as const;
    };
    expect(sq.line.wide).toBe(6);
    // Soldier 0 walks straight at the enemy: +z.
    const [fx, fz, fv] = velocity(0);
    expect(fv).toBeGreaterThan(0.1);
    expect(fx).toBeCloseTo(0, 1);
    expect(fz).toBeGreaterThan(0.99);
    // Soldier 6 walks to its place in the line, not at the enemy.
    const [px, pz] = placeOf(small, { ...before, squads: { ...before.squads, shape: [LINE, ...before.squads.shape.slice(1)] } }, 6);
    const [rx, rz, rv] = velocity(6);
    const want = Math.hypot(px - before.x[6]!, pz - before.z[6]!);
    expect(rv).toBeGreaterThan(0.1);
    expect((rx * (px - before.x[6]!) + rz * (pz - before.z[6]!)) / want).toBeGreaterThan(0.99);
  });

  it('keeps a column marching past an enemy in sight but out of reach', () => {
    const start = withCrowd(battle(), (c) => {
      c.x[army] = c.x[0]!;
      c.z[army] = c.z[0]! + 8;
    });
    const before = start.duel.crowd!;
    const next = stepCrowd(before, 6, small.battle);
    const [px, pz] = placeOf(small, before, 0);
    // Soldier 0 is in its place: it stays put, it does not leave the column for the enemy ahead.
    expect(Math.hypot(px - before.x[0]!, pz - before.z[0]!)).toBeLessThan(1e-9);
    expect(Math.hypot(next.x[0]! - before.x[0]!, next.z[0]! - before.z[0]!)).toBeLessThan(0.05);
  });

  it('walks a Soldier out of place at up to 20% above its walk speed to catch up', () => {
    // Soldier 5 (Squad 0, Tick 5 is its due Tick) 10 m behind its place, in the open.
    const start = withCrowd(battle(), (c) => {
      c.z[5] = c.z[5]! - 10;
    });
    const before = start.duel.crowd!;
    const next = stepCrowd(before, 5, small.battle);
    const dt = small.battle.crowd.stagger * TICK_SECONDS;
    const speed = Math.hypot(next.x[5]! - before.x[5]!, next.z[5]! - before.z[5]!) / dt;
    expect(speed).toBeCloseTo(small.battle.crowd.walkSpeed * sq.catchUp, 2);
    expect(next.vz[5]!).toBeGreaterThan(0);
  });

  it('goes loose when the Squad is down to half its strength', () => {
    let m = withCrowd(battle(), (c) => {
      for (let i = 5; i < 13; i++) c.alive[i] = c.hp[i] = 0;
    });
    m = advance(m, 31);
    expect(m.duel.crowd!.squads.living[0]).toBe(5);
    expect(m.duel.crowd!.squads.fall[0]).toBe(0);
    expect(m.duel.crowd!.squads.shape[0]).toBe(LOOSE);
    expect(m.duel.crowd!.squads.shape[1]).toBe(COLUMN);
  });
});

describe('a Squad closing its ranks', () => {
  it('steps the rear rank up into the gaps the front rank leaves', () => {
    let m = withCrowd(battle(), (c) => {
      for (const i of [0, 1, 2]) c.alive[i] = c.hp[i] = 0;
    });
    m = advance(m, 31);
    const c = m.duel.crowd!;
    const mine = members(c, 0);
    expect(mine).toHaveLength(10);
    // Living Soldiers hold the first ten places, once each: the three at the back (places 10 to 12) took the front row's.
    expect([...mine.map((i) => c.place[i]!)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(mine.filter((i) => i >= 10)).toEqual([10, 11, 12]);
    expect(mine.filter((i) => i >= 10).map((i) => c.place[i])).toEqual([0, 1, 2]);
    // The Soldiers that held their places kept them.
    for (const i of [3, 4, 5, 6, 7, 8, 9]) expect(c.place[i]).toBe(i);
  });
});

/**
 * Squad 0 down to its Soldiers in `spare` (2 of 13: under 30%), the rest dead where they stood. `atBase`: Squads 0 and 1 (and their Soldiers)
 * stand at Team 0's Base, 3 m apart, and Squad 2 40 m off.
 */
const broken = (t: TuningData = small, spare = [0, 1], atBase = false): MatchState =>
  withCrowd(battle(t), (c, s) => {
    for (let i = 0; i < 13; i++) if (!spare.includes(i)) c.alive[i] = c.hp[i] = 0;
    if (!atBase) return;
    [s.x[0], s.z[0], s.x[1], s.z[1], s.x[2], s.z[2]] = [0, -84, 3, -84, 40, -84];
    for (let i = 0; i < 26; i++) {
      const q = c.squad[i]!;
      c.x[i] = s.x[q]! + ((c.place[i]! % 3) - 1) * sq.spacing;
      c.z[i] = s.z[q]! - Math.floor(c.place[i]! / 3) * sq.spacing;
    }
  });


describe('a Squad that breaks', () => {
  it('falls back toward its Base, loose, keeping its Soldiers, and does not merge on the way', () => {
    // Squad 1's anchor is 4.5 m off, with room, but this is not Team 0's Base.
    let m = advance(broken(), 31);
    let c = m.duel.crowd!;
    expect(c.squads.fall[0]).toBe(1);
    expect(c.squads.shape[0]).toBe(LOOSE);
    expect(c.squads.living[0]).toBe(2);
    const z0 = c.squads.z[0]!;
    m = advance(m, 300);
    c = m.duel.crowd!;
    // Heading for Team 0's Base, behind its deployment at -z, at the Soldiers' pace.
    expect(c.squads.z[0]!).toBeLessThan(z0 - 5);
    expect(c.squads.fall[0]).toBe(1);
    expect(members(c, 0)).toEqual([0, 1]);
    // Its Soldiers follow the anchor: both within a few metres of it.
    for (const i of [0, 1]) expect(Math.hypot(c.x[i]! - c.squads.x[0]!, c.z[i]! - c.squads.z[0]!)).toBeLessThan(6);
  });

  it("rallies at the nearest spawn its Team owns with no enemy on it (its Home), and at its Base when it has none", () => {
    // Squad 0 down to two Soldiers, standing 45 m behind the centre: Team 0's Home (z = -30) is 15 m off, its Base (z = -85) 40.
    const out = (m: MatchState): MatchState =>
      withCrowd(m, (c, s) => {
        [s.x[0], s.z[0]] = [0, -45];
        for (const i of [0, 1]) [c.x[i], c.z[i]] = [(i - 0.5) * 2, -45];
      });
    const home = advance(out(broken()), 600).duel.crowd!;
    // Merged into a Squad that stood there, or standing at the Home: never walking on to the Base.
    expect(home.squads.living[0] === 0 || Math.hypot(home.squads.x[0]!, home.squads.z[0]! + 30) < 6).toBe(true);
    expect(home.squads.z[0]!).toBeGreaterThan(-46);
    // The enemy holds that Home (its progress at the enemy's end, so a Team 0 Soldier standing there does not take it back): it heads for the Base.
    const lost = out(broken());
    const taken: MatchState = { ...lost, duel: { ...lost.duel, crowd: { ...lost.duel.crowd!, objectives: { progress: lost.duel.crowd!.objectives.progress.map((v, k) => (k === 0 ? -1 : v)), owner: lost.duel.crowd!.objectives.owner.map((o, k) => (k === 0 ? 1 : o)) } } } };
    const base = advance(taken, 600).duel.crowd!;
    expect(base.squads.z[0]!).toBeLessThan(-60);
    expect(base.squads.fall[0]).toBe(1);
  });

  it('breaks off its fights: a Soldier of a Squad falling back does not stand and trade blows', () => {
    // Soldier 0's due Tick is 6; an enemy Soldier (Team 1's first) stands 1 m from it, in reach.
    const near = (fall: number) =>
      withCrowd(battle(), (c, s) => {
        s.fall[0] = fall;
        c.x[army] = c.x[0]!;
        c.z[army] = c.z[0]! + 1;
      });
    expect(stepCrowd(near(0).duel.crowd!, 6, small.battle).target[0]).toBe(army);
    expect(stepCrowd(near(1).duel.crowd!, 6, small.battle).target[0]).toBe(-1);
  });

  it('at its Base merges into the nearest Squad of its Team that is close and has room, taking free places', () => {
    const m = advance(broken(small, [0, 1], true), 31);
    const c = m.duel.crowd!;
    // Squad 1 (13 Soldiers, its anchor 3 m off) took the two Soldiers: 15 of at most mergeMax.
    expect(c.squads.living[0]).toBe(0);
    expect(c.squads.fall[0]).toBe(0);
    expect(c.squads.living[1]).toBe(15);
    expect(c.squad[0]).toBe(1);
    expect(c.squad[1]).toBe(1);
    const mine = members(c, 1);
    expect(mine).toHaveLength(15);
    expect(new Set(mine.map((i) => c.place[i])).size).toBe(15);
    expect(sq.mergeMax).toBeGreaterThanOrEqual(15);
    // The empty Squad stands still, and its Soldiers (now Squad 1's) walk to their new places.
    expect(c.squads.speed[0]).toBe(0);
    const next = advance(m, 120).duel.crowd!;
    expect(members(next, 1)).toHaveLength(15);
    for (const i of [0, 1]) {
      const [px, pz] = placeOf(small, next, i);
      expect(Math.hypot(next.x[i]! - px, next.z[i]! - pz)).toBeLessThan(2 * sq.spacing);
    }
  });

  it('rallies once back at half strength (as merged remnants are), and keeps falling back below it', () => {
    // Squad 1 (thinks on Tick 1) falling back with 6 Soldiers left, and with 5.
    const falling = (left: number) =>
      advance(
        withCrowd(battle(), (c, s) => {
          for (let i = 13 + left; i < 26; i++) c.alive[i] = c.hp[i] = 0;
          s.fall[1] = 1;
        }),
        2,
      ).duel.crowd!.squads;
    expect(falling(6).fall[1]).toBe(0);
    expect(falling(6).shape[1]).toBe(COLUMN);
    expect(falling(5).fall[1]).toBe(1);
    expect(falling(5).shape[1]).toBe(LOOSE);
  });

  it('never merges past mergeMax', () => {
    // At the Base, Squad 0 down to 3 beside Squad 1 whole (13): 16 would pass a mergeMax of 15, and Squad 2 is 40 m off.
    const tight: TuningData = { ...small, battle: { ...small.battle, squad: { ...small.battle.squad, mergeMax: 15 } } };
    const m = advance(broken(tight, [0, 1, 2], true), 100, tight);
    const s = m.duel.crowd!.squads;
    expect(s.living.slice(0, 3)).toEqual([3, 13, 14]);
    expect(s.fall[0]).toBe(1);
  });
});

describe('Promotion, Demotion and the takeover', () => {
  const LONE = army;
  function lone(): MatchState {
    const m = battle();
    const f = m.duel.fighters[0]!;
    const y = battlefieldHeight(battlefieldOf(small.battle, m.arena)!.heights, 60, 0);
    const player = standingFighter(small, arenaOf(small, m.arena), { position: { x: 60, z: 0 }, y, facing: 0 }, f.weapon, f.team);
    return withCrowd({ ...m, duel: { ...m.duel, fighters: [player, ...m.duel.fighters.slice(1)] } }, (c) => {
      c.x[LONE] = 60;
      c.z[LONE] = 5;
    });
  }

  it('keeps a promoted Soldier in its Squad and place, and walks it back to its place once demoted', () => {
    const start = lone();
    const squad = start.duel.crowd!.squad[LONE]!;
    const place = start.duel.crowd!.place[LONE]!;
    let m = stepMatch(start, [IDLE_INTENT], small);
    expect(m.duel.crowd!.slot[LONE]).toBe(1);
    expect(m.duel.crowd!.squad[LONE]).toBe(squad);
    expect(m.duel.crowd!.place[LONE]).toBe(place);
    // The Player walks away; the promoted Fighter (no Controller here) stands, and demotes beyond 16 m.
    for (let k = 0; k < 600 && m.duel.crowd!.slot[LONE]! >= 0; k++) m = stepMatch(m, [walk(0, -1)], small);
    expect(m.duel.crowd!.slot[LONE]).toBe(-1);
    expect(m.duel.crowd!.squad[LONE]).toBe(squad);
    expect(m.duel.crowd!.place[LONE]).toBe(place);
    const away = (x: MatchState) => {
      const c = x.duel.crowd!;
      const [px, pz] = placeOf(small, c, LONE);
      return Math.hypot(c.x[LONE]! - px, c.z[LONE]! - pz);
    };
    const before = away(m);
    expect(before).toBeGreaterThan(30);
    m = advance(m, 300, small, [walk(0, -1)]);
    // Back in the Crowd it walks to its place, 3 m/s or less: well over 10 m nearer after 5 s.
    expect(away(m)).toBeLessThan(before - 10);
  });

  it('is counted in its Squad while promoted, and its Squad does not wait for it', () => {
    let m = stepMatch(lone(), [IDLE_INTENT], small);
    m = advance(m, 31, small, [IDLE_INTENT]);
    const c = m.duel.crowd!;
    const q = c.squad[LONE]!;
    // The brain counts it living, and thinks without it.
    expect(c.squads.living[q]).toBe(members(c, q).length);
    expect(members(c, q)).toContain(LONE);
  });
});

describe('determinism', () => {
  it('gives the same hash every Tick for the same seed, and a snapshot continues identically', () => {
    let a = battle(small, 3);
    let b = battle(small, 3);
    let snap = snapshot(a);
    for (let k = 0; k < 1100; k++) {
      a = stepMatch(a, [IDLE_INTENT], small);
      b = stepMatch(b, [IDLE_INTENT], small);
      expect(hashValue(a), `Tick ${a.tick}`).toBe(hashValue(b));
      if (k === 400) snap = snapshot(a);
    }
    let c = restore(snap);
    for (let k = 0; k < 1100 - 401; k++) c = stepMatch(c, [IDLE_INTENT], small);
    expect(hashValue(c)).toBe(hashValue(a));
  }, 60_000);

  it('rolls back across a Squad falling back and merging to the same state, every Tick', () => {
    // Squad 0 breaks (a fall on Tick 30) at the Base beside Squad 1 and merges into it on the same Tick; roll back from before to after both.
    const start = broken(small, [0, 1], true);
    const states = new Map<number, ReturnType<typeof snapshot<MatchState>>>();
    const hashes = new Map<number, string>();
    let m = start;
    for (let k = 0; k < 70; k++) {
      m = stepMatch(m, [IDLE_INTENT], small);
      states.set(m.tick, snapshot(m));
      hashes.set(m.tick, hashValue(m));
    }
    const merged = m.duel.crowd!.squad[0];
    expect(merged).toBe(1);
    // A Rollback to Tick 20, re-simulated across Tick 30's brain and past it: every Tick lands on the hash it had.
    let r = restore(states.get(20)!);
    for (let t = 21; t <= 70; t++) {
      r = stepMatch(r, [IDLE_INTENT], small);
      expect(hashValue(r), `Tick ${t}`).toBe(hashes.get(t));
    }
    expect(r.duel.crowd!.squad).toEqual(m.duel.crowd!.squad);
    expect(r.duel.crowd!.place).toEqual(m.duel.crowd!.place);
  });

  it('puts the Squads in the hash', () => {
    const m = battle();
    const moved = withCrowd(m, (_, s) => (s.x[0] = s.x[0]! + 1));
    expect(hashValue(moved)).not.toBe(hashValue(m));
    const placed = withCrowd(m, (c) => (c.place[0] = 7));
    expect(hashValue(placed)).not.toBe(hashValue(m));
  });

  it('createCrowd is pure data: the same Tuning Data and seed give the same Crowd, JSON round-tripped too', () => {
    const a = createCrowd(small.battle, 1);
    expect(createCrowd(small.battle, 1)).toEqual(a);
    expect(JSON.stringify(JSON.parse(JSON.stringify(a)))).toBe(JSON.stringify(a));
  });
});
