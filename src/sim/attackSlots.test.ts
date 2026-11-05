import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createPoolAi, poolControllers, type Controller } from '../controllers';
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
  ringSpots,
  snapshot,
  standingFighter,
  step,
  stepBubbles,
  stepMatch,
  TICK_SECONDS,
  type CrowdState,
  type FighterState,
  type Intent,
  type MatchState,
  type SimState,
  type SoldierRole,
} from '.';

const tuning = loadTuningData();
/** Two small armies close together: a Player's Bubble reaches them within a few seconds. Half a Ticket a Soldier, so a Team stops respawning early and a Battle ends in a Rout within seconds, as it did before Tickets. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 }, tickets: { ...tuning.battle.tickets, perSoldier: 0.5 } } };
const { bubble, slots, ring } = small.battle;
const army = small.battle.armySize;
const minTicks = Math.round(bubble.minPromotedSeconds / TICK_SECONDS);

const battle = (seed = 1, t = small) => createMatch(t, { format: 'Battle', bestOf: 1, seed, teams: [0] });

/** `match` with the Player's Fighter standing at (x, z), facing `facing`. */
function playerAt(match: MatchState, x: number, z: number, facing = 0): MatchState {
  const f = match.duel.fighters[0]!;
  const y = battlefieldHeight(battlefieldOf(small.battle, match.arena)!.heights, x, z);
  const moved = standingFighter(small, arenaOf(small, match.arena), { position: { x, z }, y, facing }, f.weapon, f.team);
  return { ...match, duel: { ...match.duel, fighters: [moved, ...match.duel.fighters.slice(1)] } };
}

/** `match` with each Soldier in `at` moved there (x, z), standing, facing +z. */
function soldiersAt(match: MatchState, at: ReadonlyMap<number, readonly [number, number]>): MatchState {
  const c = match.duel.crowd!;
  const set = (a: readonly number[], v: (s: number, u: number) => number) => a.map((u, s) => (at.has(s) ? v(s, u) : u));
  const crowd: CrowdState = { ...c, x: set(c.x, (s) => at.get(s)![0]), z: set(c.z, (s) => at.get(s)![1]), heading: set(c.heading, () => 0), vx: set(c.vx, () => 0), vz: set(c.vz, () => 0) };
  return { ...match, duel: { ...match.duel, crowd } };
}

/** `match` with Pool slot `k`'s Fighter changed by `edit`. */
function withSlot(match: MatchState, k: number, edit: (f: FighterState) => FighterState): MatchState {
  return { ...match, duel: { ...match.duel, fighters: match.duel.fighters.map((f, i) => (i === k ? edit(f) : f)) } };
}

const walk = (x: number, z: number): Intent => ({ ...IDLE_INTENT, move: { x, z }, face: Math.atan2(x, z) });
const roles = (fighters: readonly FighterState[], role: SoldierRole) => fighters.filter((f) => inDuel(f) && f.soldier?.role === role);
const slotOf = (fighters: readonly FighterState[], s: number) => fighters.findIndex((f) => f.soldier?.index === s);

/**
 * The Player alone far out on the field's flank at (60, 0), with six Team 1 Soldiers round them at 3.5, 4, 5, 6, 7 and 8 m
 * (Soldiers army to army + 5, each on its own bearing), and Team 0's Soldier 0 just beyond the one at 6 m.
 */
const ENEMY = [army, army + 1, army + 2, army + 3, army + 4, army + 5];
const DIST = [3.5, 4, 5, 6, 7, 8];
const BEARING = [0, 1, 2, 3, 4, 5].map((j) => (j * 2 * Math.PI) / 6);
function flank(withAlly = false): MatchState {
  const at = new Map<number, readonly [number, number]>(ENEMY.map((s, j) => [s, [60 + DIST[j]! * Math.sin(BEARING[j]!), DIST[j]! * Math.cos(BEARING[j]!)]]));
  if (withAlly) at.set(0, [60 + 9 * Math.sin(BEARING[3]!), 9 * Math.cos(BEARING[3]!)]);
  return soldiersAt(playerAt(battle(), 60, 0), at);
}

describe('Attack Slots and allies', () => {
  it('promotes at most the Attack Slots of enemies, nearest first; the others wait as Soldiers', () => {
    const next = stepBubbles(flank().duel, 1, 1, small);
    expect(roles(next.fighters, 'Attack').map((f) => f.soldier!.index)).toEqual(ENEMY.slice(0, slots.enemies));
    expect(next.fighters.filter((f) => f.soldier)).toHaveLength(slots.enemies);
    for (const s of ENEMY.slice(slots.enemies)) expect(next.crowd!.slot[s]).toBe(-1);
  });

  it('fills a slot freed by a death with the nearest waiting enemy, though the corpse keeps its Pool slot', () => {
    const m = flank();
    const first = { ...m, duel: stepBubbles(m.duel, 1, 1, small) };
    const k = slotOf(first.duel.fighters, ENEMY[1]!);
    const dead = withSlot(first, k, (f) => ({ ...f, hp: 0, death: { tick: 1, cause: 'Hit', blow: null } }));
    const next = stepBubbles(dead.duel, 1, 2, small);
    expect(next.fighters[k]!.soldier?.index).toBe(ENEMY[1]);
    expect(roles(next.fighters, 'Attack').map((f) => f.soldier!.index).sort()).toEqual([ENEMY[0], ENEMY[2], ENEMY[3], ENEMY[4]].sort());
    expect(next.crowd!.slot[ENEMY[5]!]).toBe(-1);
  });

  it('fills a slot freed by a Demotion with the nearest waiting enemy', () => {
    // A slot-holder carried beyond 16 m (the Player stays, the slot-holder moved), past the minimum: it demotes, and the next promotes.
    const first = { ...flank(), duel: stepBubbles(flank().duel, 1, 1, small) };
    const k = slotOf(first.duel.fighters, ENEMY[2]!);
    const away = withSlot(first, k, (f) => ({ ...f, position: { x: 60, z: -20 } }));
    const next = stepBubbles(away.duel, 1, 1 + minTicks, small);
    expect(next.crowd!.slot[ENEMY[2]!]).toBe(-1);
    expect(roles(next.fighters, 'Attack').map((f) => f.soldier!.index).sort()).toEqual([ENEMY[0], ENEMY[1], ENEMY[3], ENEMY[4]].sort());
  });

  it('promotes allies, up to the ally slots, only while an enemy holds an Attack Slot, nearest the slot-holders first', () => {
    // Team 0's Soldiers 0 to 4 round the flank's Player: 1 to 5 m beyond the slot-holder at 6 m.
    const holder = [60 + 6 * Math.sin(BEARING[3]!), 6 * Math.cos(BEARING[3]!)] as const;
    const at = new Map<number, readonly [number, number]>([0, 1, 2, 3, 4].map((s) => [s, [holder[0] + 0.2 * s, holder[1] + 1 + s]]));
    const lonely = soldiersAt(playerAt(battle(), 60, 0), at);
    // No enemy near: no ally promotes.
    expect(stepBubbles(lonely.duel, 1, 1, small)).toBe(lonely.duel);
    const m = soldiersAt(flank(), at);
    const next = stepBubbles(m.duel, 1, 1, small);
    expect(roles(next.fighters, 'Ally').map((f) => f.soldier!.index)).toEqual([0, 1, 2].slice(0, slots.allies));
    expect(roles(next.fighters, 'Attack')).toHaveLength(slots.enemies);
  });

  it('lets the next enemy in when a promoted ally engages a slot-holder, and the engaged one fights on without a slot', () => {
    const first = { ...flank(true), duel: stepBubbles(flank(true).duel, 1, 1, small) };
    const ally = slotOf(first.duel.fighters, 0);
    expect(first.duel.fighters[ally]!.soldier!.role).toBe('Ally');
    // The ally steps up to the slot-holder at 6 m, on its far side from the Player.
    const holder = slotOf(first.duel.fighters, ENEMY[3]!);
    const h = first.duel.fighters[holder]!.position;
    const engaged = withSlot(first, ally, (f) => ({ ...f, position: { x: 60 + (h.x - 60) * 1.25, z: h.z * 1.25 } }));
    const next = stepBubbles(engaged.duel, 1, 2, small);
    expect(next.fighters[holder]!.soldier!.role).toBe('Waiting');
    expect(roles(next.fighters, 'Attack').map((f) => f.soldier!.index).sort()).toEqual([ENEMY[0], ENEMY[1], ENEMY[2], ENEMY[4]].sort());
    // While the ally stays on it, it keeps its Pool slot, slotless.
    const later = stepBubbles({ ...next }, 1, 2 + minTicks, small);
    expect(later.fighters[holder]!.soldier!.role).toBe('Waiting');
    // The ally gone, it has no slot to take back (all four are held): it goes back to the Crowd as soon as it may.
    const left = { ...next, fighters: next.fighters.map((f, i) => (i === ally ? { ...f, position: { x: 60, z: -12 } } : f)) };
    expect(stepBubbles(left, 1, 2 + minTicks, small).fighters[holder]!.soldier).toBeUndefined();
  });

  it('takes one enemy off the Player per ally: an ally between two slot-holders engages only one of them', () => {
    const first = { ...flank(true), duel: stepBubbles(flank(true).duel, 1, 1, small) };
    const ally = slotOf(first.duel.fighters, 0);
    // Halfway between the slot-holders at 4 m (60°) and 5 m (120°): within reach of both, nearer each than the Player is.
    const [a, b] = [ENEMY[1]!, ENEMY[2]!].map((s) => first.duel.fighters[slotOf(first.duel.fighters, s)]!.position);
    const between = withSlot(first, ally, (f) => ({ ...f, position: { x: (a!.x + b!.x) / 2, z: (a!.z + b!.z) / 2 } }));
    const next = stepBubbles(between.duel, 1, 2, small);
    expect(roles(next.fighters, 'Waiting')).toHaveLength(1);
    expect(roles(next.fighters, 'Attack')).toHaveLength(slots.enemies);
    expect(next.crowd!.slot[ENEMY[4]!]).toBeGreaterThan(0);
  });

  it('gives a slot back to a Waiting Fighter no ally engages, ahead of a farther Soldier', () => {
    const first = { ...flank(true), duel: stepBubbles(flank(true).duel, 1, 1, small) };
    const holder = slotOf(first.duel.fighters, ENEMY[3]!);
    const waiting = withSlot(first, holder, (f) => ({ ...f, soldier: { ...f.soldier!, role: 'Waiting' } }));
    const next = stepBubbles(waiting.duel, 1, 2, small);
    expect(next.fighters[holder]!.soldier!.role).toBe('Attack');
    expect(next.crowd!.slot[ENEMY[4]!]).toBe(-1);
  });

  it('demotes an ally whose Bubble has no enemy Fighter left', () => {
    const first = { ...flank(true), duel: stepBubbles(flank(true).duel, 1, 1, small) };
    const ally = slotOf(first.duel.fighters, 0);
    const alone = { ...first.duel, fighters: first.duel.fighters.map((f, i) => (f.soldier && i !== ally ? { ...f, hp: 0, death: { tick: 1, cause: 'Hit' as const, blow: null } } : f)) };
    // Fallen enemies hold no Attack Slot; the Soldiers at 7 and 8 m are its Bubble's next, so move them off.
    const c = alone.crowd!;
    const off = { ...alone, crowd: { ...c, x: c.x.map((v, s) => (s === ENEMY[4] || s === ENEMY[5] ? -80 : v)) } };
    expect(stepBubbles(off, 1, 1 + minTicks - 1, small).fighters[ally]!.soldier).toBeDefined();
    expect(stepBubbles(off, 1, 1 + minTicks, small).fighters[ally]!.soldier).toBeUndefined();
  });
});

describe('the waiting ring', () => {
  it('lays its spots out straight ahead first, then to either side, spaced apart, outside sword reach, then the next ring out', () => {
    const spots = ringSpots(small.battle, 10, -5, 0, 40);
    const at = (j: number) => ({ x: spots[2 * j]! - 10, z: spots[2 * j + 1]! + 5 });
    expect(at(0).x).toBeCloseTo(0, 9);
    expect(at(0).z).toBeCloseTo(ring.radius, 9);
    expect(at(1).x).toBeGreaterThan(0);
    expect(at(2).x).toBeLessThan(0);
    expect(at(1).z).toBeCloseTo(at(2).z, 9);
    const r = (j: number) => Math.hypot(at(j).x, at(j).z);
    for (let j = 0; j < 40; j++) {
      expect(r(j)).toBeGreaterThanOrEqual(ring.radius - 1e-9);
      expect(r(j)).toBeGreaterThan(bubble.hold);
      if (j > 0) expect(r(j)).toBeGreaterThanOrEqual(r(j - 1) - 1e-9);
      for (let i = 0; i < j; i++) expect(Math.hypot(at(i).x - at(j).x, at(i).z - at(j).z)).toBeGreaterThan(ring.spacing * 0.99);
    }
    expect(r(39)).toBeGreaterThan(ring.radius + ring.spacing / 2);
    // Turned with `ahead`.
    const turned = ringSpots(small.battle, 0, 0, Math.PI / 2, 1);
    expect(turned[0]).toBeCloseTo(ring.radius, 9);
    expect(turned[1]).toBeCloseTo(0, 9);
  });

  /** No Attack Slots: every enemy in the Bubble waits as a Soldier. */
  const waitOnly: TuningData = { ...small, battle: { ...small.battle, slots: { ...slots, enemies: 0, allies: 0 } } };

  it('brings waiting enemies round in front of a standing Player, facing them, outside sword reach', () => {
    // Five Team 1 Soldiers behind the Player (who faces +z), 5 to 8 m off.
    const at = new Map<number, readonly [number, number]>([0, 1, 2, 3, 4].map((j) => [army + j, [60 + (j - 2) * 1.5, -5 - (j % 2) * 3]]));
    let m = soldiersAt(playerAt(battle(1, waitOnly), 60, 0, 0), at);
    for (let k = 0; k < 6 * 60; k++) m = stepMatch(m, [IDLE_INTENT], waitOnly);
    const c = m.duel.crowd!;
    for (let j = 0; j < 5; j++) {
      const s = army + j;
      const ox = c.x[s]! - 60;
      const oz = c.z[s]! - 0;
      // In front (+z side), on the first ring, facing the Player.
      expect(oz, `Soldier ${s}`).toBeGreaterThan(0);
      expect(Math.hypot(ox, oz)).toBeCloseTo(ring.radius, 0);
      expect(Math.cos(c.heading[s]! - Math.atan2(-ox, -oz))).toBeGreaterThan(0.95);
    }
  });

  it('puts a waiting enemy in the way of a Player walking into a crowd of them, within two seconds, and keeps one there', () => {
    // Team 1's army in a block 12 to 16 m ahead of the Player, on the flank (Team 0 far off at x = 0).
    const at = new Map<number, readonly [number, number]>(Array.from({ length: army }, (_, j) => [army + j, [60 + ((j % 8) - 3.5) * 1.2, 12 + Math.floor(j / 8) * 1.2]] as const));
    let m = soldiersAt(playerAt(battle(1, waitOnly), 60, 0, 0), at);
    let first = -1;
    let blocked = 0;
    const span = 2 * 60;
    for (let k = 0; k < 6 * 60 && (first < 0 || k < first + span); k++) {
      m = stepMatch(m, [walk(0, 1)], waitOnly);
      const p = m.duel.fighters[0]!.position;
      const c = m.duel.crowd!;
      let inWay = false;
      for (let s = army; s < 2 * army; s++) {
        const ahead = c.z[s]! - p.z;
        if (c.alive[s] && ahead > 0 && ahead < ring.radius + 1 && Math.abs(c.x[s]! - p.x) < ring.pathWidth) inWay = true;
      }
      if (inWay && first < 0) first = k;
      if (first >= 0 && inWay) blocked++;
    }
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first * TICK_SECONDS).toBeLessThan(2 + (12 - bubble.promote) / small.fighter.walkSpeed);
    // Once found, one stands in the way nearly all the time as the Player keeps walking.
    expect(blocked / span).toBeGreaterThan(0.9);
  });

  it('steps Soldiers out of the path of a Team-mate Fighter walking through them', () => {
    // Team 0's own army: the Player walks through it from behind.
    const at = new Map<number, readonly [number, number]>(Array.from({ length: 20 }, (_, j) => [j, [60 + ((j % 5) - 2) * 1.2, 4 + Math.floor(j / 5) * 1.2]] as const));
    // Free agents (a Squad's Soldiers would walk back toward their places): this is the path rule alone.
    let m = soldiersAt(playerAt(battle(1, waitOnly), 60, 0, 0), at);
    m = { ...m, duel: { ...m.duel, crowd: { ...m.duel.crowd!, squad: m.duel.crowd!.squad.map((q, s) => (s < 20 ? -1 : q)) } } };
    let worst = Infinity;
    for (let k = 0; k < 4 * 60; k++) {
      m = stepMatch(m, [walk(0, 1)], waitOnly);
      const p = m.duel.fighters[0]!.position;
      const c = m.duel.crowd!;
      for (let s = 0; s < 20; s++) if (crowdDue(s, m.duel.tick, small.battle.crowd.stagger, army) && c.z[s]! > p.z && c.z[s]! - p.z < ring.pathAhead / 2) worst = Math.min(worst, Math.abs(c.x[s]! - p.x));
    }
    // Never left standing on its line just ahead of it.
    expect(worst).toBeGreaterThan(ring.pathWidth / 2);
  });
});

describe('the Pool AI in a Battle', () => {
  /** A Battle's Duel with the Player at (60, 0) and one promoted Team 1 Fighter 6 m in front of them holding `role`, stepped (no Bubbles) with a Pool AI on it. */
  function facing(role: SoldierRole, ticks: number): { states: (readonly FighterState[])[]; intents: Intent[] } {
    const m = playerAt(battle(), 60, 0, 0);
    const y = battlefieldHeight(battlefieldOf(small.battle, m.arena)!.heights, 60, 6);
    const enemy = standingFighter(small, arenaOf(small, m.arena), { position: { x: 60, z: 6 }, y, facing: Math.PI }, small.battle.soldier.weapon, 1);
    let duel: SimState = { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 1 ? { ...enemy, maxHp: 100, soldier: { index: army, since: 0, role } } : f)) };
    const ai = createPoolAi(small);
    const states: (readonly FighterState[])[] = [];
    const intents: Intent[] = [];
    for (let k = 0; k < ticks; k++) {
      const intent = ai.intent(duel, 1);
      intents.push(intent);
      duel = step(duel, duel.fighters.map((_, i) => (i === 1 ? intent : IDLE_INTENT)), small);
      states.push(duel.fighters);
    }
    return { states, intents };
  }

  it('holds a Waiting Fighter at its ring spot, facing the Player, never swinging at them', () => {
    const { states, intents } = facing('Waiting', 300);
    expect(intents.some((i) => i.attack || i.kick || i.throw)).toBe(false);
    const f = states.at(-1)![1]!;
    expect(Math.hypot(f.position.x - 60, f.position.z)).toBeCloseTo(ring.radius, 0);
    expect(Math.cos(f.facing - Math.PI)).toBeGreaterThan(0.95);
    expect(states.every((s) => s[0]!.hp === s[0]!.maxHp)).toBe(true);
  });

  it('sends a slot-holder after the Player: it closes in and swings', () => {
    const { states, intents } = facing('Attack', 300);
    expect(intents.some((i) => i.attack)).toBe(true);
    expect(Math.min(...states.map((s) => Math.hypot(s[1]!.position.x - 60, s[1]!.position.z)))).toBeLessThan(2);
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

/** A Battle with the Player charging beside their army, every slot's Controller a Pool AI: each Tick's state, and the Controllers' memory before it steps. */
function charge(ticks: number, seed = 2): { states: MatchState[]; memories: unknown[][] } {
  const pool = poolControllers(small, [{ intent: () => IDLE_INTENT }]);
  let m = battle(seed);
  const states = [m];
  const memories: unknown[][] = [];
  for (let k = 0; k < ticks; k++) {
    memories.push(pool.map((c) => c.save?.() ?? null));
    m = stepMatch(m, pool.map((c, i) => (i === 0 ? chargeIntent(m) : c.intent(m.duel, i))), small);
    states.push(m);
  }
  return { states, memories };
}

describe('a Player fighting beside allies in a Battle', () => {
  const ticks = 1500;
  const { states, memories } = charge(ticks);

  it('never has more slot-holding enemies than the Attack Slots, nor allies than the ally slots, and allies fight the enemy', () => {
    let allies = 0;
    let waiting = 0;
    for (const m of states) {
      const f = m.duel.fighters;
      expect(roles(f, 'Attack').length, `Tick ${m.duel.tick}`).toBeLessThanOrEqual(slots.enemies);
      expect(roles(f, 'Ally').length, `Tick ${m.duel.tick}`).toBeLessThanOrEqual(slots.allies);
      expect(f.filter((g) => g.soldier).length).toBeLessThanOrEqual(bubble.poolSize - 1);
      allies = Math.max(allies, roles(f, 'Ally').length);
      waiting = Math.max(waiting, roles(f, 'Waiting').length);
    }
    expect(allies).toBeGreaterThan(0);
    // Allies and enemies Fighters struck each other: real combat beside the Player.
    const allyHits = states.flatMap((m, k) =>
      m.duel.events.filter((e) => e.type === 'Hit' && k > 0 && [e.attacker, e.defender].some((i) => states[k - 1]!.duel.fighters[i]!.soldier?.role === 'Ally')),
    );
    expect(allyHits.length).toBeGreaterThan(0);
    expect(waiting).toBeGreaterThan(0);
  });

  it('keeps every waiting Soldier outside sword reach of the Player', () => {
    let checked = 0;
    for (const m of states.slice(1)) {
      const c = m.duel.crowd!;
      const p = m.duel.fighters[0]!.position;
      for (let s = army; s < 2 * army; s++) {
        if (!c.alive[s] || c.slot[s]! >= 0 || !crowdDue(s, m.duel.tick, small.battle.crowd.stagger, army)) continue;
        const d = Math.hypot(c.x[s]! - p.x, c.z[s]! - p.z);
        if (d > bubble.promote) continue;
        checked++;
        expect(d, `Tick ${m.duel.tick}, Soldier ${s}`).toBeGreaterThan(small.ai.attackRange);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('never lets a slot-holder Disengage', () => {
    // A binding that has held an Attack Slot every Tick since its Promotion: its AI's tactic after each Tick is never Disengage.
    const lost = new Set<string>();
    let held = 0;
    for (let k = 0; k + 1 < memories.length; k++) {
      states[k]!.duel.fighters.forEach((f, i) => {
        const b = f.soldier;
        if (!b) return;
        const key = `${b.index}/${b.since}`;
        if (b.role !== 'Attack') lost.add(key);
        if (lost.has(key)) return;
        const mem = memories[k + 1]![i] as { memory: { tactic: { mode: string } } } | null;
        if (!mem) return;
        held++;
        expect(mem.memory.tactic.mode, `Tick ${k}, slot ${i}`).not.toBe('Disengage');
      });
    }
    expect(held).toBeGreaterThan(0);
  });

  it('gives the same hash every Tick for the same seed and Intents', () => {
    const again = charge(ticks);
    for (let k = 0; k < states.length; k++) expect(hashValue(again.states[k]), `Tick ${k}`).toBe(hashValue(states[k]));
  });

  it('re-simulates a Rollback across an Attack Slot changing hands to the same hash, AI memory included', () => {
    // A slot-holder an ally engaged lets its slot go (its role changes on the same binding), or a Waiting one takes one back.
    const changeAt = states.findIndex((m, k) =>
      k > 10 && m.duel.fighters.some((f, i) => {
        const was = states[k - 1]!.duel.fighters[i]!.soldier;
        return f.soldier && was && was.index === f.soldier.index && was.since === f.soldier.since && was.role !== f.soldier.role;
      }),
    );
    expect(changeAt).toBeGreaterThan(0);
    expect(changeAt + 20).toBeLessThan(states.length);
    const from = changeAt - 10;
    const ais = poolControllers(small, [{ intent: () => IDLE_INTENT }]);
    ais.forEach((c, i) => c.load?.(memories[from]![i]));
    let s = restore(snapshot(states[from]!));
    for (let k = from; k < changeAt + 20; k++) {
      const m = s;
      s = stepMatch(m, ais.map((c: Controller, i) => (i === 0 ? chargeIntent(m) : c.intent(m.duel, i))), small);
    }
    expect(hashValue(s)).toBe(hashValue(states[changeAt + 20]));
    expect(JSON.stringify(ais.map((c) => c.save?.() ?? null))).toBe(JSON.stringify(memories[changeAt + 20]));
  });
});
