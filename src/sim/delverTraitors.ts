/**
 * A Delver Run's traitors (docs/plans/delver.md, Stage 8a): Players on Team 1 who play as the Floors' Warband Soldiers. A traitor has no Fighter
 * of its own, only a Pool slot of its own right after the party's (`traitorSlot`), which the Bubbles never hand out while it plays. Watching, it
 * waits its delay (`respawnTicks`), then takes over a living Warband Soldier no party Fighter sees and at least `delver.traitor.minDistance` from
 * every one of them by walking (`traitorPick`, seeded): the Soldier leaves its Warband and is the traitor's Fighter, in its Troop's Body, Weapon,
 * Mods and HP and the traitor's own Size, until it falls. Then it dies at once, back in its Warband (whose wipe counts it), and the traitor
 * watches again for longer. A traitor has no Bubble, takes no pickup, fire or Stairs (those are the party Players'), and never takes the Boss.
 * Its records are plain Run state (`RunState.traitors`), hashed and rolled back. Pure.
 */
import type { TuningData } from '../tuning';
import { promotedFighter } from './bubble';
import { killerOf } from './battle';
import { groundOf, soldierHeight } from './battlefield';
import { secondsToTicks } from './constants';
import { walkDistance, walkField, type CrowdState } from './crowd';
import { battleMapOf, inSight } from './destinations';
import { runPick } from './dungeon';
import { inDuel } from './duel';
import type { MatchConfig } from './match';
import type { SimEvent } from './events';
import type { FighterState, SimState } from './state';
import { BOSS } from './warband';

/** One traitor's record (`RunState.traitors`, mirrored on `SimDelver.traitors`). */
export interface TraitorState {
  /** The Soldier (Crowd index) its Fighter is, or was while it lies fallen; -1 with none yet on this Floor. */
  readonly soldier: number;
  /** That Soldier's Warband (Squad) before it left it; -1 with none. */
  readonly warband: number;
  /** Its deaths over the whole Run. */
  readonly deaths: number;
  /** Its takeovers over the whole Run (the pick's salt). */
  readonly taken: number;
  /** The Duel Tick (`SimState.tick`) from which it takes over its next Soldier, while it watches. */
  readonly next: number;
  /** Party Fighters felled by its Fighter's blow. */
  readonly kills: number;
  /** Set once an AI Takeover took it (it left): it takes over no more Soldiers. */
  readonly away?: true;
}

/** The Pool slot of traitor `j`: right after the party's. */
export const traitorSlot = (config: Pick<MatchConfig, 'teams'>, j: number): number => config.teams.length + j;

/** The traitor (index into `config.traitors`) whose slot is Fighter `k`, or -1. */
export function traitorOf(config: Pick<MatchConfig, 'teams' | 'traitors'>, k: number): number {
  const j = k - config.teams.length;
  return j >= 0 && j < (config.traitors?.length ?? 0) ? j : -1;
}

/** The salt of a traitor's pick, plus its takeover count, so each takeover draws apart. */
const PICK_SALT = 0x7a17;
/** `runPick`'s slot of traitor j: past any Fighter's. */
const PICK_SLOT = 16;
/** Seconds a traitor that found no Soldier to take waits before it looks again. */
const RETRY_SECONDS = 1;

/** The wait (Ticks) before a takeover, `n` the deaths before the wait began (not the fall that began it): `respawnSeconds + respawnStep × n`, at most `respawnMax`. */
export function respawnTicks(tuning: TuningData, n: number): number {
  const { respawnSeconds, respawnStep, respawnMax } = tuning.delver.traitor;
  return secondsToTicks(Math.min(respawnMax, respawnSeconds + respawnStep * n));
}

/** The traitors' records at the Run's start: one per `config.traitors`, watching its first delay; undefined with none. */
export function freshTraitors(tuning: TuningData, config: Pick<MatchConfig, 'traitors'>): readonly TraitorState[] | undefined {
  const n = config.traitors?.length ?? 0;
  if (n === 0) return undefined;
  return Array.from({ length: n }, () => ({ soldier: -1, warband: -1, deaths: 0, taken: 0, next: respawnTicks(tuning, 0), kills: 0 }));
}

/** The records on entering a new Floor: the Soldiers went with the old Floor; each watches its current delay from Tick 0. */
export function traitorsOnFloor(tuning: TuningData, records: readonly TraitorState[]): readonly TraitorState[] {
  return records.map((r) => ({ ...r, soldier: -1, warband: -1, next: respawnTicks(tuning, r.deaths) }));
}

/** The slots of the traitors still playing (not away), which the Bubbles never hand out. */
export function reservedSlots(config: Pick<MatchConfig, 'teams'>, records: readonly TraitorState[] | undefined): number[] {
  return (records ?? []).flatMap((r, j) => (r.away ? [] : [traitorSlot(config, j)]));
}

/** The Soldier a traitor holds alive in its Fighter, as the Warband it left: Soldier index to Warband. For the Warbands' wipe. */
export function heldSoldiers(records: readonly TraitorState[] | undefined, crowd: Pick<CrowdState, 'alive'>): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of records ?? []) if (r.soldier >= 0 && r.warband >= 0 && crowd.alive[r.soldier] === 1) out.set(r.soldier, r.warband);
  return out;
}

/** The Boss Soldier of the Floor's Crowd: the lowest index of the Warband of rank BOSS; -1 with none. */
function bossSoldier(crowd: CrowdState): number {
  const q = crowd.warbands?.rank.indexOf(BOSS) ?? -1;
  return q < 0 ? -1 : crowd.squad.indexOf(q);
}

/**
 * The Soldiers a traitor may take over on `duel` (in Crowd order): alive, in the Crowd, in a Warband, not the Boss, unseen by every party Fighter
 * (Team 0's first `party` slots, in the Duel and not fallen; a line of sight with no range) and at least `minDistance` from each by walking.
 */
export function traitorCandidates(tuning: TuningData, duel: SimState, party: number): number[] {
  const crowd = duel.crowd!;
  const battle = tuning.battle;
  const map = battleMapOf(battle, duel.arena);
  const watchers = duel.fighters.slice(0, party).filter((f) => f.team === 0 && inDuel(f) && f.death === undefined);
  const walks = watchers.map((f) => walkField(battle, map, f.position.x, f.position.z, f.y));
  const boss = bossSoldier(crowd);
  const { minDistance } = tuning.delver.traitor;
  const out: number[] = [];
  for (let s = 0; s < crowd.x.length; s++) {
    if (crowd.alive[s] !== 1 || crowd.slot[s] !== -1 || crowd.squad[s]! < 0 || s === boss) continue;
    const x = crowd.x[s]!;
    const z = crowd.z[s]!;
    const on = crowd.surface[s]!;
    const y = soldierHeight(map.field, on, x, z);
    let ok = true;
    for (let w = 0; w < watchers.length && ok; w++) {
      const f = watchers[w]!;
      if (walkDistance(walks[w]!, x, z, on) < minDistance) ok = false;
      else if (inSight(map.fields, f.position.x, f.position.z, x, z, 0, f.y, y)) ok = false;
    }
    if (ok) out.push(s);
  }
  return out;
}

/** The Soldier traitor `j` takes over now (`traitorCandidates`, picked by (Run seed, Floor, traitor, takeover count)), or -1 with none. */
export function traitorPick(tuning: TuningData, duel: SimState, party: number, seed: number, floor: number, j: number, taken: number): number {
  const candidates = traitorCandidates(tuning, duel, party);
  return candidates.length === 0 ? -1 : candidates[runPick(seed, floor, PICK_SLOT + j, PICK_SALT + taken, candidates.length)]!;
}

/** A mutable copy of the Crowd's arrays a traitor's step writes. */
function editable(crowd: CrowdState) {
  return { ...crowd, x: crowd.x.slice(), z: crowd.z.slice(), surface: crowd.surface.slice(), heading: crowd.heading.slice(), hp: crowd.hp.slice(), alive: crowd.alive.slice(), slot: crowd.slot.slice(), squad: crowd.squad.slice(), vx: crowd.vx.slice(), vz: crowd.vz.slice(), target: crowd.target.slice(), engage: crowd.engage.slice() };
}

/**
 * The traitors' step for the Tick about to be stepped (`duel.tick + 1`), before the Bubbles: a traitor's Fighter that fell kills its Soldier
 * (where it fell, back in its Warband) and starts its wait; a watching traitor whose wait is over takes over the Soldier `traitorPick` gives (or
 * looks again a second later). `duel` and `records` themselves when nothing changes.
 */
export function stepTraitors(duel: SimState, records: readonly TraitorState[], config: Pick<MatchConfig, 'teams' | 'traitors' | 'arena'>, tuning: TuningData, seed: number, floor: number): { duel: SimState; records: readonly TraitorState[] } {
  const tick = duel.tick + 1;
  const party = config.teams.length;
  let fighters: FighterState[] | null = null;
  let crowd: ReturnType<typeof editable> | null = null;
  let out: TraitorState[] | null = null;
  const edit = () => {
    fighters ??= duel.fighters.slice();
    crowd ??= editable(duel.crowd!);
    return { fighters, crowd };
  };
  const field = battleMapOf(tuning.battle, duel.arena).field;
  records.forEach((r, j) => {
    if (r.away) return;
    const k = traitorSlot(config, j);
    const f = (fighters ?? duel.fighters)[k]!;
    const c = crowd ?? duel.crowd!;
    let next = r;
    if (r.soldier >= 0 && f.death !== undefined && c.alive[r.soldier] === 1) {
      // Its fall: the Soldier dies where its Fighter fell, back in its Warband (`slot` stays the traitor's: its Fighter's ragdoll is its body).
      const e = edit();
      const s = r.soldier;
      e.crowd.x[s] = f.position.x;
      e.crowd.z[s] = f.position.z;
      const on = groundOf(tuning.battle, field, f.position.x, f.position.z, f.y);
      if (on >= 0) e.crowd.surface[s] = on;
      e.crowd.heading[s] = f.facing;
      e.crowd.hp[s] = 0;
      e.crowd.alive[s] = 0;
      e.crowd.vx[s] = 0;
      e.crowd.vz[s] = 0;
      e.crowd.target[s] = -1;
      e.crowd.engage[s] = 0;
      if (r.warband >= 0) e.crowd.squad[s] = r.warband;
      next = { ...r, deaths: r.deaths + 1, next: f.death.tick + respawnTicks(tuning, r.deaths) };
    } else if ((!inDuel(f) || f.death !== undefined) && tick >= r.next) {
      // Watching, its wait over: a takeover, out of the party's sight and reach.
      const view = fighters || crowd ? { ...duel, fighters: fighters ?? duel.fighters, crowd: crowd ?? duel.crowd! } : duel;
      const s = traitorPick(tuning, view, party, seed, floor, j, r.taken);
      if (s < 0) next = { ...r, next: tick + secondsToTicks(RETRY_SECONDS) };
      else {
        const e = edit();
        const size = config.traitors?.[j]?.size ?? null;
        e.fighters[k] = promotedFighter(tuning, duel.arena, e.crowd, s, size);
        if (r.soldier >= 0 && e.crowd.slot[r.soldier] === k) e.crowd.slot[r.soldier] = -1;
        const warband = e.crowd.squad[s]!;
        e.crowd.slot[s] = k;
        e.crowd.squad[s] = -1;
        next = { ...r, soldier: s, warband, taken: r.taken + 1 };
      }
    }
    if (next !== r) {
      out ??= records.slice();
      out[j] = next;
    }
  });
  const stepped = fighters || crowd ? { ...duel, fighters: fighters ?? duel.fighters, crowd: crowd ?? duel.crowd! } : duel;
  return { duel: stepped, records: out ?? records };
}

/** The records with this Tick's kills counted: each party Fighter (Team 0, the first `party` slots) that fell to a present traitor's Fighter's blow. */
export function countTraitorKills(records: readonly TraitorState[], events: readonly SimEvent[], config: Pick<MatchConfig, 'teams'>): readonly TraitorState[] {
  let out: TraitorState[] | null = null;
  const party = config.teams.length;
  for (const e of events) {
    if (e.type !== 'Death' || e.fighter >= party) continue;
    const j = killerOf(events, e.fighter) - party;
    if (j < 0 || j >= records.length || records[j]!.away) continue;
    out ??= records.slice();
    out[j] = { ...out[j]!, kills: out[j]!.kills + 1 };
  }
  return out ?? records;
}

/**
 * A traitor who left (an AI Takeover): its record marked away, and a Soldier it holds back in its Warband as an ordinary promoted enemy (its
 * Fighter bound to it, `Attack`, since the next Tick), which the Bubbles demote or free by their usual rules. Idempotent.
 */
export function traitorLeaves(duel: SimState, records: readonly TraitorState[], config: Pick<MatchConfig, 'teams'>, j: number): { duel: SimState; records: readonly TraitorState[] } {
  const r = records[j];
  if (!r || r.away) return { duel, records };
  const k = traitorSlot(config, j);
  const out = records.slice();
  out[j] = { ...r, soldier: -1, warband: -1, away: true };
  const crowd = duel.crowd;
  if (r.soldier < 0 || !crowd || crowd.slot[r.soldier] !== k) return { duel, records: out };
  const f = duel.fighters[k]!;
  const fighters = duel.fighters.slice();
  fighters[k] = { ...f, soldier: { index: r.soldier, since: duel.tick + 1, role: 'Attack' } };
  const squad = crowd.squad.slice();
  if (r.warband >= 0) squad[r.soldier] = r.warband;
  return { duel: { ...duel, fighters, crowd: { ...crowd, squad } }, records: out };
}
