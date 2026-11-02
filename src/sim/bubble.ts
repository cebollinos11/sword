/**
 * The Bubble and the Fighter Pool (docs/plans/big-battle.md, Stage 3; ADR 0020): in a Battle, `SimState.fighters` is a
 * fixed Pool of `battle.bubble.poolSize` slots. The Players' Fighters hold the first (`players` of them); every other slot
 * is unbound (Benched: out of play, not dead) or bound to a Soldier (`FighterState.soldier`, and the Soldier's `crowd.slot`).
 *
 * `stepBubbles` runs at the start of each Battle Tick, before the Fighters step, and decides everything from Simulation
 * positions only, so every peer promotes alike and a Rollback re-simulates it like any other step (ADR 0019's "choices by
 * walking"). In order:
 *  - a promoted Fighter that fell kills its Soldier (where it fell, facing its way, 0 HP), and `corpseSeconds` after its
 *    fall its slot frees, the Soldier lying in the Crowd;
 *  - Demotion: a promoted Fighter further than `demote` from every Player's Fighter in play, Idle on the ground, at least
 *    `minPromotedSeconds` after its Promotion, writes its position, heading and HP back to its Soldier and frees its slot;
 *  - Promotion: each living Soldier of a Team that has not routed, within `promote` of an enemy Player's Fighter in play,
 *    takes a free slot, nearest first (ties by index) while slots are free. The Fighter starts at guard where the Soldier stands,
 *    facing its heading, with its Team and HP, the generic soldier's Weapon (`battle.soldier`), and a Soldier's max HP.
 * Attack Slots and allies are Stage 4: for now a Bubble promotes its Player's enemies only, nearest first. Pure.
 */
import type { TuningData } from '../tuning';
import { arenaOf } from './arena';
import { battlefieldHeight, battlefieldOf } from './battlefield';
import { secondsToTicks } from './constants';
import type { CrowdState } from './crowd';
import { inDuel } from './duel';
import type { FighterState, SimState } from './state';
import { standingFighter } from './step';

/** Whether a Pool slot is bound to a Soldier. */
export const isBound = (f: FighterState): boolean => f.soldier !== undefined;

/** An unbound Pool slot: Benched (0 HP, out of play) at the field's centre, wielding the generic soldier's Weapon. */
export function unboundSlot(tuning: TuningData, arena: string): FighterState {
  const geometry = arenaOf(tuning, arena);
  const y = battlefieldOf(tuning.battle, arena)?.heights;
  return { ...standingFighter(tuning, geometry, { position: { x: 0, z: 0 }, y: y ? battlefieldHeight(y, 0, 0) : 0, facing: 0 }, tuning.battle.soldier.weapon, 1), hp: 0, benched: true };
}

/** Where each Bubble stands, and its Player's Team: each Player's Fighter (the first `players` slots) still in the fight. */
function bubbleCentres(fighters: readonly FighterState[], players: number): { x: number; z: number; team: number }[] {
  return fighters.slice(0, players).flatMap((f) => (inDuel(f) ? [{ x: f.position.x, z: f.position.z, team: f.team }] : []));
}

/** Whether a promoted Fighter's Action lets it demote: Idle (standing or walking) on the ground. */
const demotable = (f: FighterState): boolean => f.action.kind === 'Idle' && !f.air;

/**
 * The Bubbles' step for the Tick `tick` (the one about to be stepped: `duel.tick + 1`), with the first `players` slots the
 * Players' Fighters. A state without a Crowd is returned as it is.
 */
export function stepBubbles(duel: SimState, players: number, tick: number, tuning: TuningData): SimState {
  const before = duel.crowd;
  if (!before) return duel;
  const { bubble } = tuning.battle;
  const centres = bubbleCentres(duel.fighters, players);
  const farFromAll = (f: FighterState) => centres.every((c) => Math.hypot(f.position.x - c.x, f.position.z - c.z) > bubble.demote);
  const minTicks = secondsToTicks(bubble.minPromotedSeconds);
  const corpseTicks = secondsToTicks(bubble.corpseSeconds);

  let fighters: FighterState[] | null = null;
  let crowd: { -readonly [K in keyof CrowdState]: CrowdState[K] extends readonly number[] ? number[] : CrowdState[K] } | null = null;
  const edit = () => {
    fighters ??= duel.fighters.slice();
    crowd ??= {
      ...before,
      x: before.x.slice(),
      z: before.z.slice(),
      vx: before.vx.slice(),
      vz: before.vz.slice(),
      heading: before.heading.slice(),
      hp: before.hp.slice(),
      team: before.team as number[],
      target: before.target.slice(),
      engage: before.engage.slice(),
      alive: before.alive.slice(),
      slot: before.slot.slice(),
    };
    return { fighters, crowd };
  };
  /** Soldier `s` takes Fighter `f`'s place, heading and HP, standing, engaged with no one. */
  const writeBack = (c: NonNullable<typeof crowd>, s: number, f: FighterState) => {
    c.x[s] = f.position.x;
    c.z[s] = f.position.z;
    c.heading[s] = f.facing;
    c.hp[s] = f.hp;
    c.vx[s] = 0;
    c.vz[s] = 0;
    c.target[s] = -1;
    c.engage[s] = 0;
  };

  let unbound: FighterState | null = null;
  const free = () => (unbound ??= unboundSlot(tuning, duel.arena));
  for (let k = players; k < duel.fighters.length; k++) {
    const f = duel.fighters[k]!;
    const s = f.soldier?.index;
    if (s === undefined) continue;
    if (f.death) {
      if (before.alive[s]) {
        const e = edit();
        writeBack(e.crowd, s, f);
        e.crowd.hp[s] = 0;
        e.crowd.alive[s] = 0;
      }
      if (tick - f.death.tick >= corpseTicks) {
        const e = edit();
        e.crowd.slot[s] = -1;
        e.fighters[k] = free();
      }
    } else if (tick - f.soldier!.since >= minTicks && demotable(f) && farFromAll(f)) {
      const e = edit();
      writeBack(e.crowd, s, f);
      e.crowd.slot[s] = -1;
      e.fighters[k] = free();
    }
  }

  const slots = fighters ?? duel.fighters;
  const open: number[] = [];
  for (let k = players; k < slots.length; k++) if (!isBound(slots[k]!)) open.push(k);
  if (open.length > 0 && centres.length > 0) {
    const c0 = crowd ?? before;
    const reach = bubble.promote;
    const near: { s: number; d: number }[] = [];
    for (let s = 0; s < c0.x.length; s++) {
      if (!c0.alive[s] || c0.slot[s]! >= 0 || c0.rout?.team === c0.team[s]) continue;
      let d = Infinity;
      for (const c of centres) if (c.team !== c0.team[s]) d = Math.min(d, Math.hypot(c0.x[s]! - c.x, c0.z[s]! - c.z));
      if (d <= reach) near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d || a.s - b.s);
    const geometry = arenaOf(tuning, duel.arena);
    const hf = battlefieldOf(tuning.battle, duel.arena)!.heights;
    const { soldier } = tuning.battle;
    for (let n = 0; n < Math.min(open.length, near.length); n++) {
      const { s } = near[n]!;
      const k = open[n]!;
      const e = edit();
      const promoted = standingFighter(tuning, geometry, { position: { x: e.crowd.x[s]!, z: e.crowd.z[s]! }, y: battlefieldHeight(hf, e.crowd.x[s]!, e.crowd.z[s]!), facing: e.crowd.heading[s]! }, soldier.weapon, e.crowd.team[s]!);
      e.fighters[k] = { ...promoted, hp: e.crowd.hp[s]!, maxHp: tuning.battle.crowd.hp, soldier: { index: s, since: tick } };
      e.crowd.slot[s] = k;
    }
  }

  if (!fighters) return duel;
  return { ...duel, fighters, crowd: crowd! };
}
