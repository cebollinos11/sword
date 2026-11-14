import { describe, expect, it } from 'vitest';
import { defaultWeaponName, loadTuningData } from '../tuning';
import { arenaOf } from '../sim/arena';
import { groundOf, soldierHeight } from '../sim/battlefield';
import { stepBubbles, unboundSlot } from '../sim/bubble';
import { arenaTuning, deployWarbands, floorArenaName, floorOf } from '../sim/delver';
import { battleMapOf } from '../sim/destinations';
import type { CrowdState } from '../sim/crowd';
import type { SimState } from '../sim/state';
import { standingFighter } from '../sim/step';
import { BOSS, ELITE } from '../sim/warband';
import { createPoolAi } from './poolAi';
import { flatFloors } from '../sim/delver/flat.testdata';

const tuning = flatFloors(loadTuningData());
const TIMEOUT = 120_000;

/** Floor `floor` of Run `seed`, its Crowd deployed, and a Duel in which Warband rank `rank`'s first Soldier is promoted beside the Player. */
function promotedFirstOf(rank: number, seed: number, floor: number) {
  const name = floorArenaName(seed, floor);
  const built = floorOf(tuning, name)!;
  const t = arenaTuning(tuning, name);
  const map = battleMapOf(t.battle, name);
  const crowd = deployWarbands(t, built.plan, built.field, seed, floor, 1);
  const q = crowd.warbands!.rank.indexOf(rank);
  const first = crowd.squad.indexOf(q);
  const at = { x: crowd.x[first]! + 3, z: crowd.z[first]! };
  const fallen: CrowdState = { ...crowd, alive: crowd.alive.map((a, i) => (i === first ? a : 0)) };
  const y = soldierHeight(map.field, groundOf(t.battle, map.field, at.x, at.z, 0), at.x, at.z);
  const player = standingFighter(t, arenaOf(t, name), { position: at, y, facing: 0 }, defaultWeaponName(t), 0);
  const duel: SimState = {
    tick: 0,
    arena: name,
    rng: crowd.rng,
    fighters: [player, ...Array.from({ length: t.battle.bubble.poolSize - 1 }, () => unboundSlot(t, name))],
    daggers: [],
    duel: { status: 'Fighting' },
    crowd: fallen,
    events: [],
  };
  const state = stepBubbles(duel, 1, 1, t);
  const k = state.fighters.findIndex((f) => f.soldier?.index === first);
  return { t, state, k, first };
}

describe("the Pool AI on a Floor", { timeout: TIMEOUT }, () => {
  it("plays a promoted Boss in its Troop's Style, and the Battle's own Style for an elite", () => {
    const boss = promotedFirstOf(BOSS, 1, 3);
    const elite = promotedFirstOf(ELITE, 1, 1);
    expect(boss.k).toBeGreaterThan(0);
    expect(elite.k).toBeGreaterThan(0);
    const bossTroop = boss.t.battle.troops[boss.state.crowd!.troop[boss.first]!]!;
    expect(bossTroop.style).toBe('Aggressive');

    const bossAi = createPoolAi(tuning);
    bossAi.intent(boss.state, boss.k);
    const bossMemory = bossAi.save!() as { difficulty: string; style: string };
    expect(bossMemory.style).toBe(bossTroop.style);
    expect(bossMemory.difficulty).toBe(bossTroop.difficulty);

    const eliteAi = createPoolAi(tuning);
    eliteAi.intent(elite.state, elite.k);
    const eliteMemory = eliteAi.save!() as { style: string };
    expect(elite.t.battle.troops[elite.state.crowd!.troop[elite.first]!]!.style).toBeUndefined();
    expect(eliteMemory.style).toBe('');
  });

  it('saves and loads its memory with the Style, so a loaded Pool AI plays the same Intents', () => {
    const boss = promotedFirstOf(BOSS, 1, 3);
    const a = createPoolAi(tuning);
    for (let i = 0; i < 5; i++) a.intent(boss.state, boss.k);
    const saved = JSON.parse(JSON.stringify(a.save!()));
    expect(saved.style).toBe('Aggressive');
    const b = createPoolAi(tuning);
    b.load!(saved);
    expect(b.save!()).toEqual(a.save!());
    expect(b.intent(boss.state, boss.k)).toEqual(a.intent(boss.state, boss.k));
  });

  it('drops its binding and memory when its slot is unbound', () => {
    const boss = promotedFirstOf(BOSS, 1, 3);
    const ai = createPoolAi(tuning);
    ai.intent(boss.state, boss.k);
    // An unbound slot asks for nothing and drops the binding.
    const unbound = { ...boss.state, fighters: boss.state.fighters.map((f, k) => (k === boss.k ? unboundSlot(boss.t, boss.state.arena) : f)) };
    ai.intent(unbound, boss.k);
    expect(ai.save!()).toBeNull();
  });
});
