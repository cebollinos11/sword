import { describe, expect, it } from 'vitest';
import { troopOf } from './crowd';
import { loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, poolControllers, type Controller } from '../controllers';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  createMatch,
  FRESH_PLAYER,
  hashValue,
  IDLE_INTENT,
  inDuel,
  restore,
  snapshot,
  standingFighter,
  stepBubbles,
  stepMatch,
  takeoverSpawns,
  takeoverTarget,
  TICK_SECONDS,
  type CrowdState,
  type FighterState,
  type Intent,
  type MatchEvent,
  type MatchState,
} from '.';

const tuning = loadTuningData();
/** Two small armies close together, so a whole Battle is quick (half a Ticket a Soldier, so a Team stops respawning early and the Battle ends in a Rout). */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 }, tickets: { ...tuning.battle.tickets, perSoldier: 0.5 } } };
const army = small.battle.armySize;
const takeoverTicks = Math.round(small.battle.takeover.seconds / TICK_SECONDS);
const pickTicks = Math.round(small.battle.takeover.pickSeconds / TICK_SECONDS);

const battle = (seed = 1) => createMatch(small, { format: 'Battle', bestOf: 1, seed, teams: [0], weapons: ['Longsword'] });

function placed(match: MatchState, x: number, z: number, weapon: string, team: number): FighterState {
  const y = battlefieldHeight(battlefieldOf(small.battle, match.arena)!.heights, x, z);
  return standingFighter(small, arenaOf(small, match.arena), { position: { x, z }, y, facing: 0 }, weapon, team);
}

/** `match` with the Player's Fighter standing at (x, z). */
function playerAt(match: MatchState, x: number, z: number): MatchState {
  const f = match.duel.fighters[0]!;
  return { ...match, duel: { ...match.duel, fighters: [{ ...placed(match, x, z, f.weapon, f.team), maxHp: f.maxHp }, ...match.duel.fighters.slice(1)] } };
}

/** `match` with the Crowd changed by `edit` (on copies of its arrays). */
function withCrowd(match: MatchState, edit: (c: { x: number[]; z: number[]; hp: number[]; alive: number[]; slot: number[] }) => void): MatchState {
  const c = match.duel.crowd!;
  const copy = { x: c.x.slice(), z: c.z.slice(), hp: c.hp.slice(), alive: c.alive.slice(), slot: c.slot.slice() };
  edit(copy);
  const crowd: CrowdState = { ...c, ...copy };
  return { ...match, duel: { ...match.duel, crowd } };
}

/** `match` with Pool slot `k`'s Fighter replaced by `edit`'s. */
function withSlot(match: MatchState, k: number, edit: (f: FighterState) => FighterState): MatchState {
  return { ...match, duel: { ...match.duel, fighters: match.duel.fighters.map((f, i) => (i === k ? edit(f) : f)) } };
}

/** `match` with the Player's Fighter fallen on its current Tick. */
const fell = (match: MatchState): MatchState => withSlot(match, 0, (f) => ({ ...f, hp: 0, death: { tick: match.duel.tick, cause: 'Hit', blow: null } }));

/**
 * The Player fallen at (60, 0), far out on the flank, with all their army fallen but two: Soldier 0 lies dead 2 m from them,
 * Soldier 1 stands 4 m off with 37 HP, and Soldier 2 6 m off. The enemy army is about 50 m away, at its deploy.
 */
function flank(): MatchState {
  const m = withCrowd(playerAt(battle(), 60, 0), (c) => {
    for (let s = 3; s < army; s++) [c.alive[s], c.hp[s]] = [0, 0];
    [c.x[0], c.z[0], c.alive[0], c.hp[0]] = [62, 0, 0, 0];
    [c.x[1], c.z[1], c.hp[1]] = [64, 0, 37];
    [c.x[2], c.z[2]] = [66, 0];
  });
  return fell(m);
}

describe('Taking over an ally', () => {
  it('names the Soldier a fallen Player will take over before the takeover (for the view), the one it then takes', () => {
    const start = flank();
    // Soldier 0 lies dead; of Soldiers 1 and 2, 1 is the nearer the spawns.
    expect(takeoverTarget(start.duel, 0, small)).toBe(1);
    const next = stepBubbles(start.duel, 1, start.duel.fighters[0]!.death!.tick + takeoverTicks, small);
    expect(next.crowd!.players[0]!.soldier).toBe(1);
    // A Player still standing has no one to take over.
    expect(takeoverTarget(battle().duel, 0, small)).toBe(-1);
  });

  it("takes over the ally nearest its Team's spawn, not the one nearest where it fell", () => {
    const start = flank();
    const base = takeoverSpawns(start.duel.crowd!, battlefieldOf(small.battle, start.arena)!, 0).at(-1)!;
    // Soldier 5 stands 3 m from the Base, far from the fall; Soldiers 1 and 2 stand right by it.
    const m = withCrowd(start, (c) => {
      [c.x[5], c.z[5], c.alive[5], c.hp[5]] = [base.x + 3, base.z, 1, 40];
    });
    expect(takeoverTarget(m.duel, 0, small)).toBe(5);
    const next = stepBubbles(m.duel, 1, m.duel.fighters[0]!.death!.tick + takeoverTicks, small);
    expect(next.crowd!.players[0]!.soldier).toBe(5);
    expect(next.fighters[0]!.position).toEqual({ x: base.x + 3, z: base.z });
  });

  it('chooses the Soldier `pickSeconds` after the fall and takes that one, even if another comes nearer the spawn meanwhile', () => {
    const start = flank();
    const fall = start.duel.fighters[0]!.death!.tick;
    const base = takeoverSpawns(start.duel.crowd!, battlefieldOf(small.battle, start.arena)!, 0).at(-1)!;
    // Before the pick, nothing is chosen.
    expect(stepBubbles(start.duel, 1, fall + pickTicks - 1, small).crowd!.players[0]).toEqual(FRESH_PLAYER);
    const picked = stepBubbles(start.duel, 1, fall + pickTicks, small);
    expect(picked.crowd!.players[0]).toEqual({ ...FRESH_PLAYER, next: 1 });
    expect(picked.fighters[0]).toBe(start.duel.fighters[0]);
    // Soldier 2 walks up to the Base: Soldier 1 is still the one.
    const moved = withCrowd({ ...start, duel: picked }, (c) => {
      [c.x[2], c.z[2]] = [base.x, base.z];
    });
    expect(takeoverTarget(moved.duel, 0, small)).toBe(1);
    const next = stepBubbles(moved.duel, 1, fall + takeoverTicks, small);
    expect(next.crowd!.players[0]!.soldier).toBe(1);
    expect(next.crowd!.players[0]!.next).toBeUndefined();
    // Had Soldier 1 fallen before the takeover, the one nearest the spawn then is taken.
    const gone = withCrowd(moved, (c) => {
      [c.alive[1], c.hp[1]] = [0, 0];
    });
    expect(takeoverTarget(gone.duel, 0, small)).toBe(2);
    expect(stepBubbles(gone.duel, 1, fall + takeoverTicks, small).crowd!.players[0]!.soldier).toBe(2);
  });

  it('takes over the nearest living ally Soldier, at `takeover.hp` HP and with its Troop, once its fall has played', () => {
    const start = flank();
    const dead = start.duel.fighters[0]!;
    const fallTick = dead.death!.tick;
    // Not before `takeover.seconds`.
    const early = stepBubbles(start.duel, 1, fallTick + takeoverTicks - 1, small);
    expect(early.fighters[0]).toBe(dead);
    expect(early.crowd!.players[0]).toEqual({ ...FRESH_PLAYER, next: 1 });

    const next = stepBubbles(start.duel, 1, fallTick + takeoverTicks, small);
    const me = next.fighters[0]!;
    expect(inDuel(me)).toBe(true);
    expect(me.position).toEqual({ x: 64, z: 0 });
    // Fresh at `takeover.hp` (100), not the Soldier's 37 nor its Troop's max.
    expect(me.hp).toBe(small.battle.takeover.hp);
    expect(me.hp).toBe(100);
    expect(me.maxHp).toBe(small.battle.takeover.hp);
    // The Soldier's Troop's Weapon.
    const taken = next.crowd!.players[0]!.soldier;
    expect(me.weapon).toBe(troopOf(small.battle, next.crowd!, taken).weapon);
    expect(me.team).toBe(0);
    // A Player's Fighter: no binding, and none of a soldier's Mods.
    expect(me.soldier).toBeUndefined();
    expect(me.mods).toBeUndefined();
    expect(next.crowd!.slot[1]).toBe(0);
    // It leaves its Squad (a free agent, as Players are); the others keep theirs.
    expect(next.crowd!.squad[1]).toBe(-1);
    expect(next.crowd!.squad[2]).toBe(start.duel.crowd!.squad[2]);
    // The Player's own Fighter lies on in a free Pool slot.
    const corpse = next.crowd!.players[0]!.corpse;
    expect(corpse).toBeGreaterThan(0);
    expect(next.fighters[corpse]).toBe(dead);
    expect(next.crowd!.players[0]).toEqual({ soldier: 1, taken: 1, kills: 0, corpse });
    // No other slot changed, and the corpse slot is never handed out again.
    expect(next.fighters.filter((f) => !f.benched)).toHaveLength(2);
  });

  it('takes over a promoted ally Fighter as it stands when it is the nearest, freeing its slot', () => {
    const start = flank();
    const ally = { ...placed(start, 61, 1, small.battle.soldier.weapon, 0), hp: 22, maxHp: small.battle.crowd.hp, mods: { ...tuningMods() }, soldier: { index: 5, since: 0, role: 'Ally' as const } };
    const m = withCrowd(withSlot(start, 3, () => ally), (c) => {
      [c.slot[5], c.alive[5], c.hp[5]] = [3, 1, 22];
    });
    const next = stepBubbles(m.duel, 1, start.duel.fighters[0]!.death!.tick + takeoverTicks, small);
    const { soldier: _s, mods: _m, ...own } = ally;
    expect(next.fighters[0]).toEqual({ ...own, hp: small.battle.takeover.hp, maxHp: small.battle.takeover.hp });
    expect(next.fighters[3]!.benched).toBe(true);
    expect(next.crowd!.slot[5]).toBe(0);
    expect(next.crowd!.players[0]!.soldier).toBe(5);
  });

  it('kills a taken-over Soldier that falls, and takes over the next one; the first corpse stays put', () => {
    const first = stepBubbles(flank().duel, 1, flank().duel.fighters[0]!.death!.tick + takeoverTicks, small);
    const corpse = first.crowd!.players[0]!.corpse;
    const at = { ...first, tick: first.tick + 100 };
    const down = { ...at, fighters: at.fighters.map((f, k) => (k === 0 ? { ...f, hp: 0, death: { tick: at.tick, cause: 'Hit' as const, blow: null } } : f)) };
    const killed = stepBubbles(down, 1, at.tick + 1, small);
    // Its Soldier dies in the Crowd at once (so the Rout counts it), still the Player's until the next takeover.
    expect(killed.crowd!.alive[1]).toBe(0);
    expect(killed.crowd!.hp[1]).toBe(0);
    expect(killed.fighters[0]).toBe(down.fighters[0]);
    const again = stepBubbles(killed, 1, at.tick + takeoverTicks, small);
    expect(again.fighters[0]!.position).toEqual({ x: 66, z: 0 });
    expect(again.crowd!.slot[2]).toBe(0);
    // The fallen Soldier lies in the Crowd, where it fell.
    expect(again.crowd!.slot[1]).toBe(-1);
    expect([again.crowd!.x[1], again.crowd!.z[1]]).toEqual([64, 0]);
    expect(again.crowd!.players[0]).toEqual({ soldier: 2, taken: 2, kills: 0, corpse });
    expect(again.fighters[corpse]).toBe(first.fighters[corpse]);
  });

  it('never takes over an enemy, and with no ally Soldier left the Player is out: their Fighter just lies there', () => {
    const none = withCrowd(flank(), (c) => {
      for (let s = 0; s < army; s++) [c.alive[s], c.hp[s]] = [0, 0];
    });
    const later = stepBubbles(none.duel, 1, none.duel.fighters[0]!.death!.tick + takeoverTicks + 600, small);
    expect(later.fighters[0]).toBe(none.duel.fighters[0]);
    expect(later.crowd!.players[0]).toEqual(FRESH_PLAYER);
    expect(later.crowd!.slot.every((k) => k !== 0)).toBe(true);
  });
});

function tuningMods() {
  return { damage: 0.5, heavyDamage: 1, damageTaken: 1, blockImpactTaken: 1, daggerDamage: 1, kickDamage: 1, maxHp: 0, daggers: 0, healOnKill: 0, healOnClear: 0 };
}

/**
 * A whole small Battle with the Player on a Battle autopilot and a Pool AI in every other slot. The Player's Fighter falls
 * on Tick `fallAt` (a lethal blow, written into the state), and again `fallAt2` if given. Records every Tick's state, events
 * and every Controller's memory.
 */
function run(seed: number, fallAt: number, maxTicks = 9000) {
  const controllers = poolControllers(small, [createBattlePilot(small, 'Hard')]);
  let m = battle(seed);
  const states: MatchState[] = [m];
  const memories: unknown[][] = [controllers.map((c) => c.save?.() ?? null)];
  const intents: Intent[][] = [];
  while (m.status.status === 'InProgress' && m.tick < maxTicks) {
    if (m.tick === fallAt) m = fell(m);
    const at = m;
    const tick = controllers.map((c: Controller, i) => c.intent(at.duel, i));
    intents.push(tick);
    m = stepMatch(at, tick, small);
    states.push(m);
    memories.push(controllers.map((c) => c.save?.() ?? null));
  }
  return { states, memories, intents };
}

describe('A whole Battle with takeovers', () => {
  const FALL = 500;
  let ref: ReturnType<typeof run> | null = null;
  const reference = () => (ref ??= run(3, FALL));

  it('takes over an ally after the Player falls, and the Battle ends exactly once', () => {
    const { states } = reference();
    const last = states[states.length - 1]!;
    expect(last.status.status).toBe('Over');
    const took = states.findIndex((s) => s.duel.crowd!.players[0]!.taken > 0);
    expect(took).toBe(FALL + takeoverTicks);
    const events = states.flatMap((s) => s.events);
    expect(events.filter((e: MatchEvent) => e.type === 'BattleEnd')).toHaveLength(1);
    expect(events.filter((e: MatchEvent) => e.type === 'Rout')).toHaveLength(1);
    // Stepping on after the end changes nothing and ends nothing again.
    let after = last;
    for (let k = 0; k < 300; k++) {
      after = stepMatch(after, new Array(after.duel.fighters.length).fill(IDLE_INTENT), small);
      expect(after.events.some((e) => e.type === 'BattleEnd' || e.type === 'Rout')).toBe(false);
    }
    expect(after.status).toEqual(last.status);
    expect(after.score).toEqual(last.score);
    // The Player's kills are enemy Fighters only, never more than fell.
    const deaths = states.flatMap((s) => s.duel.events.filter((e) => e.type === 'Death' && s.duel.fighters[e.fighter]!.team === 1)).length;
    expect(last.duel.crowd!.players[0]!.kills).toBeLessThanOrEqual(deaths);
  }, 120_000);

  it('gives the same hash every Tick for the same seed and Intents', () => {
    const { states, intents } = reference();
    let m = battle(3);
    for (let k = 0; k < intents.length; k++) {
      if (m.tick === FALL) m = fell(m);
      m = stepMatch(m, intents[k]!, small);
      if (k % 10 === 0 || k === intents.length - 1) expect(hashValue(m), `Tick ${k + 1}`).toBe(hashValue(states[k + 1]!));
    }
  }, 120_000);

  it('re-simulates a Rollback across a takeover to the same hash, AI memory included', () => {
    const { states, memories, intents } = reference();
    const took = FALL + takeoverTicks;
    const from = took - 10;
    const controllers = poolControllers(small, [createBattlePilot(small, 'Hard')]);
    controllers.forEach((c, i) => c.load?.(memories[from]![i]));
    let s = restore(snapshot(states[from]!));
    for (let k = from; k < took + 30; k++) {
      const at = s;
      const tick = controllers.map((c: Controller, i) => c.intent(at.duel, i));
      expect(JSON.stringify(tick), `Intents of Tick ${k + 1}`).toBe(JSON.stringify(intents[k]));
      s = stepMatch(at, tick, small);
      expect(hashValue(s), `Tick ${k + 1}`).toBe(hashValue(states[k + 1]!));
    }
    expect(JSON.stringify(controllers.map((c) => c.save?.() ?? null))).toBe(JSON.stringify(memories[took + 30]));
  }, 120_000);
});
