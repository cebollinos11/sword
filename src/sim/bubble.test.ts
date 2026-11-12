import { describe, expect, it } from 'vitest';
import { troopOf } from './crowd';
import { loadTuningData, type TuningData } from '../tuning';
import { poolControllers, type Controller } from '../controllers';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  createMatch,
  crowdDue,
  hashValue,
  IDLE_INTENT,
  inDuel,
  restore,
  snapshot,
  standingFighter,
  stepBubbles,
  stepMatch,
  TICK_SECONDS,
  type Action,
  type CrowdState,
  type FighterState,
  type Intent,
  type MatchState,
  type SimEvent,
} from '.';

const tuning = loadTuningData();
/** Two small armies close together: a Player's Bubble reaches them within a few seconds. Half a Ticket a Soldier, so a Team stops respawning early and a Battle ends in a Rout within seconds, as it did before Tickets. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 }, tickets: { ...tuning.battle.tickets, perSoldier: 0.5 } } };
const { bubble } = small.battle;
const army = small.battle.armySize;

const battle = (seed = 1, t = small) => createMatch(t, { format: 'Battle', bestOf: 1, seed, teams: [0] });

/** `match` with the Player's Fighter standing at (x, z), facing `facing`. */
function playerAt(match: MatchState, x: number, z: number, facing = 0): MatchState {
  const f = match.duel.fighters[0]!;
  const y = battlefieldHeight(battlefieldOf(small.battle, match.arena)!.heights, x, z);
  const moved = standingFighter(small, arenaOf(small, match.arena), { position: { x, z }, y, facing }, f.weapon, f.team);
  return { ...match, duel: { ...match.duel, fighters: [moved, ...match.duel.fighters.slice(1)] } };
}

/** `match` with Soldier `s` at (x, z), its heading and HP set. */
function soldierAt(match: MatchState, s: number, x: number, z: number, heading: number, hp: number): MatchState {
  const c = match.duel.crowd!;
  const set = (a: readonly number[], v: number) => a.map((u, i) => (i === s ? v : u));
  const crowd: CrowdState = { ...c, x: set(c.x, x), z: set(c.z, z), heading: set(c.heading, heading), hp: set(c.hp, hp), vx: set(c.vx, 0), vz: set(c.vz, 0) };
  return { ...match, duel: { ...match.duel, crowd } };
}

/** `match` with Pool slot `k`'s Fighter changed by `edit`. */
function withSlot(match: MatchState, k: number, edit: (f: FighterState) => FighterState): MatchState {
  return { ...match, duel: { ...match.duel, fighters: match.duel.fighters.map((f, i) => (i === k ? edit(f) : f)) } };
}

const walk = (x: number, z: number): Intent => ({ ...IDLE_INTENT, move: { x, z }, face: Math.atan2(x, z) });

/** The Player far out on the field's flank (the armies fight near x = 0), one Team 1 Soldier 5 m in front of them. */
const LONE = army; // Team 1's first Soldier
function lonePromotion(): MatchState {
  return soldierAt(playerAt(battle(), 60, 0), LONE, 60, 5, 2.345, 63.5);
}

describe('the Fighter Pool and the Bubble', () => {
  it('promotes a Soldier into a free slot as a Fighter at guard with its place, heading, Team and HP, and it leaves the Crowd step', () => {
    const start = lonePromotion();
    let m = stepMatch(start, [IDLE_INTENT], small);
    const f = m.duel.fighters[1]!;
    expect(f.soldier).toEqual({ index: LONE, since: 1, role: 'Attack' });
    expect(f.benched).toBeUndefined();
    expect(f.position).toEqual({ x: 60, z: 5 });
    // Standing on the hillside, wherever the ground is.
    const ground = battlefieldHeight(battlefieldOf(small.battle, m.arena)!.heights, 60, 5);
    expect(Math.abs(ground)).toBeGreaterThan(0.05);
    expect(f.y).toBeCloseTo(ground, 6);
    expect(f.facing).toBe(2.345);
    expect(f.hp).toBe(63.5);
    // Its Troop's HP and Weapon.
    expect(f.maxHp).toBe(troopOf(small.battle, m.duel.crowd!, LONE).hp);
    expect(f.team).toBe(1);
    expect(f.weapon).toBe(troopOf(small.battle, m.duel.crowd!, LONE).weapon);
    expect(f.action.kind).toBe('Idle');
    expect(m.duel.crowd!.slot[LONE]).toBe(1);
    // No other slot is bound: nothing else stands within 10 m of the Player.
    expect(m.duel.fighters.filter((g) => g.soldier)).toHaveLength(1);
    // Promoted, the Soldier is not stepped, whatever its due Ticks.
    for (let k = 0; k < 20; k++) m = stepMatch(m, [IDLE_INTENT], small);
    expect([m.duel.crowd!.x[LONE], m.duel.crowd!.z[LONE]]).toEqual([60, 5]);
  });

  it('round-trips a Soldier’s position, heading and HP exactly through Promotion and Demotion when nothing happened in between', () => {
    let m = stepMatch(lonePromotion(), [IDLE_INTENT], small);
    expect(m.duel.fighters[1]!.soldier).toBeDefined();
    // The Player walks away (the promoted Fighter has no Controller here, so it stands): it demotes once beyond 16 m.
    let demotedAt = -1;
    for (let k = 0; k < 600 && demotedAt < 0; k++) {
      const next = stepBubbles(m.duel, 1, m.duel.tick + 1, small);
      if (!next.fighters[1]!.soldier) {
        demotedAt = m.duel.tick + 1;
        const c = next.crowd!;
        expect([c.x[LONE], c.z[LONE], c.heading[LONE], c.hp[LONE]]).toEqual([60, 5, 2.345, 63.5]);
        expect(c.slot[LONE]).toBe(-1);
        expect(next.fighters[1]!.benched).toBe(true);
        const p = next.fighters[0]!.position;
        expect(Math.hypot(p.x - 60, p.z - 5)).toBeGreaterThan(bubble.demote);
      }
      m = stepMatch(m, [walk(0, -1)], small);
    }
    expect(demotedAt).toBeGreaterThan(0);
    // stepMatch did the same on that Tick.
    expect(m.duel.fighters[1]!.soldier).toBeUndefined();
  });

  it('has hysteresis: between the promote and demote distances nothing promotes or demotes', () => {
    // A Soldier 12 m away does not promote, Tick after Tick.
    const far = soldierAt(playerAt(battle(), 60, 0), LONE, 60, 12, 0, 100);
    for (let t = 1; t < 200; t++) expect(stepBubbles(far.duel, 1, t, small)).toBe(far.duel);
    // A promoted Fighter the Player walks away from to 15 m and back to 11 m, again and again, keeps its slot.
    let m = stepMatch(lonePromotion(), [IDLE_INTENT], small);
    const since = m.duel.fighters[1]!.soldier;
    let away = true;
    for (let k = 0; k < 1500; k++) {
      const p = m.duel.fighters[0]!.position;
      const d = Math.hypot(p.x - 60, p.z - 5);
      if (d > 15) away = false;
      if (d < 11) away = true;
      m = stepMatch(m, [away ? walk(0, -1) : walk(0, 1)], small);
      expect(m.duel.fighters[1]!.soldier).toEqual(since);
      expect(m.duel.fighters.filter((f) => f.soldier)).toHaveLength(1);
    }
  });

  it('never demotes mid-Attack, Stagger, Knockdown or Fall, nor in the air, nor within a second of the Promotion', () => {
    const promoted = stepMatch(lonePromotion(), [IDLE_INTENT], small);
    // Far from the Player, well past the minimum.
    const far = playerAt(promoted, 60, -30);
    const tick = far.duel.tick + 120;
    expect(stepBubbles(far.duel, 1, tick, small).fighters[1]!.soldier).toBeUndefined();
    const busy: Action[] = [
      { kind: 'Attack', direction: 'Overhead', phase: 'Wind-up', landed: false },
      { kind: 'Stagger', cause: 'Hit' },
      { kind: 'Knockdown', phase: 'Down', ticks: 3, guard: null },
      { kind: 'Fall' },
      { kind: 'Block', direction: 'Left', age: 4 },
    ];
    for (const action of busy) expect(stepBubbles(withSlot(far, 1, (f) => ({ ...f, action })).duel, 1, tick, small).fighters[1]!.soldier, action.kind).toBeDefined();
    const airborne = withSlot(far, 1, (f) => ({ ...f, air: { vx: 0, vy: 1, vz: 0, peakY: f.y, ticks: 2, jumped: true } }));
    expect(stepBubbles(airborne.duel, 1, tick, small).fighters[1]!.soldier).toBeDefined();
    // Too soon: one Tick short of `minPromotedSeconds`.
    const since = far.duel.fighters[1]!.soldier!.since;
    const minTicks = Math.round(bubble.minPromotedSeconds / TICK_SECONDS);
    expect(stepBubbles(far.duel, 1, since + minTicks - 1, small).fighters[1]!.soldier).toBeDefined();
    expect(stepBubbles(far.duel, 1, since + minTicks, small).fighters[1]!.soldier).toBeUndefined();
  });

  it('kills the Soldier of a promoted Fighter that falls, and frees its slot after the corpse time, the Soldier lying where it fell', () => {
    const promoted = stepMatch(lonePromotion(), [IDLE_INTENT], small);
    const dead = withSlot(promoted, 1, (f) => ({ ...f, hp: 0, position: { x: 61, z: 6 }, death: { tick: promoted.duel.tick, cause: 'Hit', blow: null } }));
    const next = stepBubbles(dead.duel, 1, dead.duel.tick + 1, small);
    expect(next.crowd!.alive[LONE]).toBe(0);
    expect(next.crowd!.hp[LONE]).toBe(0);
    expect([next.crowd!.x[LONE], next.crowd!.z[LONE]]).toEqual([61, 6]);
    expect(next.fighters[1]!.soldier).toBeDefined();
    const corpseTicks = Math.round(bubble.corpseSeconds / TICK_SECONDS);
    const later = stepBubbles(next, 1, promoted.duel.tick + corpseTicks, small);
    expect(later.fighters[1]!.benched).toBe(true);
    expect(later.crowd!.slot[LONE]).toBe(-1);
    expect(later.crowd!.alive[LONE]).toBe(0);
  });

  it('fills the free slots nearest first, and never binds more than the Pool', () => {
    // The Player amid the enemy army: far more than 15 Soldiers within 10 m. Attack Slots past the Pool's size (Stage 4 caps them at 4).
    const open: TuningData = { ...small, battle: { ...small.battle, slots: { ...small.battle.slots, enemies: 20, allies: 0 } } };
    let m = playerAt(battle(), 0, 12);
    m = stepMatch(m, [IDLE_INTENT], open);
    const bound = m.duel.fighters.flatMap((f) => (f.soldier ? [f.soldier.index] : []));
    expect(bound).toHaveLength(bubble.poolSize - 1);
    const c = m.duel.crowd!;
    const dist = (s: number) => Math.hypot(c.x[s]! - 0, c.z[s]! - 12);
    const furthestBound = Math.max(...bound.map(dist));
    for (let s = army; s < 2 * army; s++) if (!bound.includes(s) && c.alive[s] && dist(s) <= bubble.promote) expect(dist(s)).toBeGreaterThanOrEqual(furthestBound);
    // Only enemies of the Player promote here: no ally stands within 10 m.
    expect(bound.every((s) => c.team[s] === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------- a Player in a Battle, with the Pool's AIs

/** The Player walks up into the enemy army and fights there, swinging now and then. */
function chargeIntent(m: MatchState): Intent {
  const f = m.duel.fighters[0]!;
  const t = m.tick;
  if (f.position.z < 4) return walk(Math.sin(t / 50) * 0.3, 1);
  const directions = ['Left', 'Right', 'Overhead', 'Thrust'] as const;
  return { ...IDLE_INTENT, face: 0, move: { x: Math.sin(t / 37), z: 0 }, attack: t % 70 < 25, direction: directions[Math.floor(t / 70) % 4]!, block: t % 70 > 45 };
}

function playerIntents(m: MatchState, pool: readonly Controller[]): Intent[] {
  return pool.map((c, i) => (i === 0 ? chargeIntent(m) : c.intent(m.duel, i)));
}

/** A Battle with the Player charging, every slot's Controller a Pool AI: each Tick's state, and each Tick's Controllers' memory before it steps. */
function charge(ticks: number, seed = 2): { states: MatchState[]; memories: unknown[][] } {
  const pool = poolControllers(small, [{ intent: () => IDLE_INTENT }]);
  let m = battle(seed);
  const states = [m];
  const memories: unknown[][] = [];
  for (let k = 0; k < ticks; k++) {
    memories.push(pool.map((c) => c.save?.() ?? null));
    m = stepMatch(m, playerIntents(m, pool), small);
    states.push(m);
  }
  return { states, memories };
}

const HURTS = new Set<SimEvent['type']>(['Hit', 'KickLanded', 'ChainKnockdown', 'DaggerHit', 'Land']);

describe('a Player fighting in a Battle', () => {
  const ticks = 1500;
  const { states, memories } = charge(ticks);

  it('promotes Soldiers as the Player reaches the army, and demotes some again', () => {
    const promotions = states.slice(1).filter((m, k) => m.duel.fighters.some((f, i) => f.soldier && f.soldier.since === m.duel.tick && !states[k]!.duel.fighters[i]!.soldier));
    expect(promotions.length).toBeGreaterThan(0);
    // Fighters fought: the Player and the promoted hit each other.
    const hits = states.flatMap((m) => m.duel.events.filter((e) => e.type === 'Hit'));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('no Soldier ever changes a full Fighter’s HP: every drop is a blow or a fall the Fighters’ own step reports', () => {
    for (let k = 1; k < states.length; k++) {
      const before = states[k - 1]!.duel;
      const after = states[k]!.duel;
      after.fighters.forEach((f, i) => {
        const was = before.fighters[i]!;
        // The same Fighter on both Ticks (not a slot rebound in between).
        if (f.soldier?.since !== was.soldier?.since || f.soldier?.index !== was.soldier?.index || f.benched || was.benched) return;
        // A fallen Player comes back by taking a Soldier over, at `takeover.hp`: a new body, not a heal.
        if (was.death) return;
        if (f.hp < was.hp) expect(after.events.some((e) => HURTS.has(e.type) && ('defender' in e ? e.defender === i : 'fighter' in e && e.fighter === i)), `Tick ${after.tick}, slot ${i}`).toBe(true);
        else expect(f.hp, `Tick ${after.tick}, slot ${i}`).toBe(was.hp);
      });
    }
  });

  it('never lets an unbound slot hit or be hit, and its Controller asks for nothing', () => {
    for (let k = 1; k < states.length; k++) {
      const before = states[k - 1]!.duel;
      for (const e of states[k]!.duel.events) {
        const involved = [('attacker' in e ? e.attacker : undefined), ('defender' in e ? e.defender : undefined), ('thrower' in e ? e.thrower : undefined)].filter((v): v is number => typeof v === 'number');
        for (const i of involved) expect(before.fighters[i]!.benched, `Tick ${states[k]!.duel.tick}: ${e.type} by/on slot ${i}`).toBeUndefined();
      }
    }
    const pool = poolControllers(small, []);
    const m = battle();
    for (let i = 1; i < pool.length; i++) expect(pool[i]!.intent(m.duel, i)).toBe(IDLE_INTENT);
  });

  it('keeps every Soldier that steps outside sword reach of the enemy Fighters', () => {
    let checked = 0;
    for (const m of states.slice(1)) {
      const c = m.duel.crowd!;
      const enemies = m.duel.fighters.filter(inDuel);
      for (let s = 0; s < c.x.length; s++) {
        if (!c.alive[s] || c.slot[s]! >= 0 || !crowdDue(s, m.duel.tick, small.battle.crowd.stagger, army)) continue;
        for (const f of enemies) {
          if (f.team === c.team[s]) continue;
          checked++;
          expect(Math.hypot(c.x[s]! - f.position.x, c.z[s]! - f.position.z), `Tick ${m.duel.tick}, Soldier ${s}`).toBeGreaterThan(bubble.hold / 2);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives the same hash every Tick for the same seed and Intents, with promotions happening', () => {
    const again = charge(ticks);
    for (let k = 0; k < states.length; k++) expect(hashValue(again.states[k]), `Tick ${k}`).toBe(hashValue(states[k]));
  });

  it('re-simulates a Rollback across a Promotion and across a Demotion to the same hash, AI memory included', () => {
    const changed = (k: number, kind: 'promote' | 'demote') =>
      states[k]!.duel.fighters.some((f, i) => {
        const was = states[k - 1]!.duel.fighters[i]!;
        return kind === 'promote' ? f.soldier !== undefined && f.soldier.since === states[k]!.duel.tick : was.soldier !== undefined && f.soldier === undefined;
      });
    const promotedAt = states.findIndex((_, k) => k > 15 && changed(k, 'promote'));
    // Teleport the Player away once the fight is on: the promoted chase, and demote while walking beyond 16 m.
    const at = Math.min(promotedAt + 240, ticks - 300);
    const pool = poolControllers(small, [{ intent: () => IDLE_INTENT }]);
    pool.forEach((c, i) => c.load?.(memories[at]![i]));
    let m = playerAt(states[at]!, -60, -60, Math.PI);
    const away: { states: MatchState[]; memories: unknown[][] } = { states: [m], memories: [] };
    for (let k = 0; k < 300; k++) {
      away.memories.push(pool.map((c) => c.save?.() ?? null));
      m = stepMatch(m, pool.map((c, i) => (i === 0 ? walk(-1, -1) : c.intent(m.duel, i))), small);
      away.states.push(m);
    }
    const demotedAt = away.states.findIndex((s, k) => k > 0 && s.duel.fighters.some((f, i) => !f.soldier && away.states[k - 1]!.duel.fighters[i]!.soldier));
    expect(promotedAt).toBeGreaterThan(0);
    expect(demotedAt).toBeGreaterThan(0);

    // Roll back to 10 Ticks before the change (or the start of the run), restore the state and every Controller's memory, re-simulate 20 Ticks past it.
    const rollback = (run: { states: MatchState[]; memories: unknown[][] }, changeAt: number, intentOf: (m: MatchState) => Intent) => {
      const from = Math.max(0, changeAt - 10);
      const ais = poolControllers(small, [{ intent: () => IDLE_INTENT }]);
      ais.forEach((c, i) => c.load?.(run.memories[from]![i]));
      let s = restore(snapshot(run.states[from]!));
      for (let k = from; k < changeAt + 20; k++) s = stepMatch(s, ais.map((c, i) => (i === 0 ? intentOf(s) : c.intent(s.duel, i))), small);
      expect(hashValue(s)).toBe(hashValue(run.states[changeAt + 20]));
      expect(JSON.stringify(ais.map((c) => c.save?.() ?? null))).toBe(JSON.stringify(run.memories[changeAt + 20]));
    };
    rollback({ states, memories }, promotedAt, chargeIntent);
    rollback(away, demotedAt, () => walk(-1, -1));
  });
});
