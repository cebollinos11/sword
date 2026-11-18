import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { flatFloors } from './delver/flat.testdata';
import { arenaTuning } from './delver/world';
import { countTraitorKills, freshTraitors, traitorFallback, reservedSlots, respawnTicks, traitorCandidates, traitorSlot, type TraitorState } from './delverTraitors';
import { inDuel } from './duel';
import { IDLE_INTENT } from './intent';
import { createMatch, stepMatch, takeOverFighter, type MatchOptions, type MatchState } from './match';
import type { SimEvent } from './events';
import { BOSS } from './warband';
import { promotedFighter } from './bubble';
import { soldierSize } from './crowd';
import { traitorWatchLine } from '../play/hud';

const base = flatFloors(loadTuningData());
/** One tier of two short flat Floors; a traitor waits 1 s, then 1.5 s, at most 2 s. */
const tuning: TuningData = {
  ...base,
  delver: { ...base.delver, tiers: 1, floorsPerTier: 2, tierRooms: [7], traitor: { minDistance: 20, respawnSeconds: 1, respawnStep: 0.5, respawnMax: 2 } },
};
const ARENA = 'gen:greybox:4242';

const delver = (options: Partial<MatchOptions> = {}): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0], humans: 2, players: [0, 1], traitors: [{}], ...options });
const tick = (m: MatchState): MatchState => stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), tuning);
/** Steps `m` until `done` holds (at most `limit` Ticks), checking `each` on every state on the way. */
function until(m: MatchState, done: (m: MatchState) => boolean, limit = 2000, each?: (before: MatchState, after: MatchState) => void): MatchState {
  for (let k = 0; k < limit && !done(m); k++) {
    const next = tick(m);
    each?.(m, next);
    m = next;
  }
  return m;
}
const rec = (m: MatchState, j = 0): TraitorState => m.delver!.traitors![j]!;
const holding = (m: MatchState) => rec(m).soldier >= 0 && inDuel(m.duel.fighters[traitorSlot(m.config, 0)]!) && !m.duel.fighters[traitorSlot(m.config, 0)]!.death;

describe("a Delver Run's traitors", { timeout: 120_000 }, () => {
  it('wait respawnSeconds, plus respawnStep per earlier death, at most respawnMax', () => {
    const real = loadTuningData();
    expect(real.delver.traitor).toEqual({ minDistance: 20, respawnSeconds: 8, respawnStep: 4, respawnMax: 30 });
    expect(respawnTicks(real, 0)).toBe(secondsToTicks(8));
    expect(respawnTicks(real, 1)).toBe(secondsToTicks(12));
    expect(respawnTicks(real, 10)).toBe(secondsToTicks(30));
  });

  it('are configured only on a Delver Run, and let the party be all AI', () => {
    const m = delver();
    expect(m.config.traitors).toEqual([{}]);
    expect(m.delver!.traitors).toEqual([{ soldier: -1, warband: -1, deaths: 0, floorDeaths: 0, taken: 0, next: respawnTicks(tuning, 0), kills: 0 }]);
    expect(m.duel.delver!.traitors).toBe(m.delver!.traitors);
    expect(delver({ traitors: [{ size: { height: 1.2, thick: 1 } }] }).config.traitors).toEqual([{ size: { height: 1.2, thick: 1 } }]);
    expect(delver({ humans: 0, players: [], traitors: [{}, {}] }).config.humans).toBe(0);
    expect(() => delver({ humans: 0, players: [], traitors: undefined })).toThrow();
    expect(() => delver({ traitors: [{}, {}, {}] })).toThrow();
    expect(() => createMatch(tuning, { bestOf: 1, arena: 'library', teams: [0, 1], traitors: [{}] })).toThrow();
    // No traitors: no record at all, so a Run without them hashes as it always did.
    const plain = delver({ traitors: undefined });
    expect(plain.config.traitors).toBeUndefined();
    expect(plain.delver!.traitors).toBeUndefined();
    expect(plain.duel.delver!.traitors).toBeUndefined();
    expect(freshTraitors(tuning, {})).toBeUndefined();
  });

  it('take over an unseen, far Warband Soldier after the delay: its Body, Weapon, HP and Size (not the traitor\'s), out of its Warband', () => {
    const size = { height: 1.2, thick: 0.9 };
    let m = delver({ traitors: [{ size }] });
    const k = traitorSlot(m.config, 0);
    expect(k).toBe(2);
    let before: MatchState | null = null;
    m = until(m, (x) => rec(x).soldier >= 0, 400, (b) => (before = b));
    const s = rec(m).soldier;
    expect(s).toBeGreaterThanOrEqual(0);
    // On the Tick its wait ran out, not before.
    expect(m.duel.tick).toBe(respawnTicks(tuning, 0));
    // It was a candidate: alive in the Crowd, in a Warband, unseen and far.
    expect(traitorCandidates(arenaTuning(tuning, m.arena), before!.duel, 2)).toContain(s);
    const c = m.duel.crowd!;
    expect(rec(m)).toMatchObject({ soldier: s, warband: before!.duel.crowd!.squad[s], taken: 1, deaths: 0 });
    expect(rec(m).warband).toBeGreaterThanOrEqual(0);
    expect(c.slot[s]).toBe(k);
    expect(c.squad[s]).toBe(-1);
    const f = m.duel.fighters[k]!;
    expect(f.team).toBe(1);
    expect(f.soldier).toBeUndefined();
    expect(f.benched).toBeUndefined();
    expect(f.size).toEqual(soldierSize(before!.duel.crowd!, s));
    expect(f.size).not.toEqual(size);
    expect(f.maxHp).toBe(c.maxHp![s]);
    expect(f.hp).toBe(c.hp[s]);
    expect(f.mods).toBeDefined();
    // The Boss is never a candidate.
    const q = c.warbands!.rank.indexOf(BOSS);
    if (q >= 0) expect(traitorCandidates(arenaTuning(tuning, m.arena), m.duel, 2)).not.toContain(c.squad.indexOf(q));
  });

  it('with no Soldier out of sight and reach, take any living non-Boss Warband Soldier, on time', () => {
    // Every Soldier too near the party: no candidate, so the fallback.
    const near: TuningData = { ...tuning, delver: { ...tuning.delver, traitor: { ...tuning.delver.traitor, minDistance: 1e6 } } };
    let m = delver();
    const next = rec(m).next;
    while (rec(m).soldier < 0 && m.duel.tick < next + 5) m = stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), near);
    expect(m.duel.tick).toBe(next);
    expect(traitorCandidates(arenaTuning(near, m.arena), m.duel, 2)).toEqual([]);
    const s = rec(m).soldier;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(rec(m).warband).toBeGreaterThanOrEqual(0);
    const q = m.duel.crowd!.warbands!.rank.indexOf(BOSS);
    if (q >= 0) expect(s).not.toBe(m.duel.crowd!.squad.indexOf(q));
    expect(holding(m)).toBe(true);
  });

  it('take a Soldier already fighting the party when it is the only one, freeing its Pool slot', () => {
    let m = delver();
    const c = m.duel.crowd!;
    // Every Warband Soldier dead but one, promoted into Pool slot 4 by hand.
    const s = c.squad.findIndex((q, i) => q >= 0 && i !== c.squad.indexOf(c.warbands!.rank.indexOf(BOSS)));
    const alive = c.alive.map((v, i) => (i === s || c.squad[i]! < 0 ? v : 0));
    const slot = c.slot.map((v, i) => (i === s ? 4 : v));
    const promoted = { ...promotedFighter(arenaTuning(tuning, m.arena), m.arena, c, s), soldier: { index: s, since: 0, role: 'Attack' as const } };
    m = { ...m, duel: { ...m.duel, crowd: { ...c, alive, slot }, fighters: m.duel.fighters.map((f, i) => (i === 4 ? promoted : f)) } };
    expect(traitorFallback(m.duel)).toEqual([s]);
    m = until(m, (x) => rec(x).soldier >= 0, 400);
    expect(rec(m)).toMatchObject({ soldier: s, taken: 1 });
    expect(m.duel.crowd!.slot[s]).toBe(traitorSlot(m.config, 0));
    expect(m.duel.fighters[4]!.soldier?.index).not.toBe(s);
  });

  it('with no Warband Soldier left at all, keep their takeover Tick and keep looking, not a countdown stuck at 1 s', () => {
    let m = delver();
    const c = m.duel.crowd!;
    m = { ...m, duel: { ...m.duel, crowd: { ...c, alive: c.alive.map((v, i) => (c.squad[i]! >= 0 ? 0 : v)) } } };
    const next = rec(m).next;
    m = until(m, (x) => x.duel.tick >= next + secondsToTicks(2) + 5, 400);
    expect(rec(m)).toMatchObject({ soldier: -1, taken: 0, next });
    expect(traitorWatchLine(m, traitorSlot(m.config, 0))).toBe('Looking for a Soldier out of sight…');
  });

  it('never has its slot handed to a Promotion, dies at once when it falls and waits longer each time', () => {
    let m = delver();
    const k = traitorSlot(m.config, 0);
    expect(reservedSlots(m.config, m.delver!.traitors)).toEqual([k]);
    const check = (_: MatchState, x: MatchState) => expect(x.duel.fighters[k]!.soldier).toBeUndefined();
    m = until(m, holding, 400, check);
    const fell = (x: MatchState): MatchState => ({
      ...x,
      duel: { ...x.duel, fighters: x.duel.fighters.map((f, i) => (i === k ? { ...f, hp: 0, death: { tick: x.duel.tick, cause: 'Fall' as const, blow: null } } : f)) },
    });
    const first = rec(m);
    m = fell(m);
    const deathTick = m.duel.tick;
    m = tick(m);
    const c = m.duel.crowd!;
    expect(c.alive[first.soldier]).toBe(0);
    expect(c.hp[first.soldier]).toBe(0);
    expect(c.squad[first.soldier]).toBe(first.warband);
    expect(rec(m)).toMatchObject({ deaths: 1, floorDeaths: 1, next: deathTick + respawnTicks(tuning, 0) });
    m = until(m, holding, 400, check);
    expect(rec(m).soldier).not.toBe(first.soldier);
    expect(m.duel.crowd!.slot[first.soldier]).toBe(-1);
    expect(rec(m).taken).toBe(2);
    m = fell(m);
    const second = m.duel.tick;
    m = tick(m);
    expect(rec(m)).toMatchObject({ deaths: 2, floorDeaths: 2, next: second + respawnTicks(tuning, 1) });
    expect(respawnTicks(tuning, 1)).toBeGreaterThan(respawnTicks(tuning, 0));
  });

  it("keep a Warband from being wiped while one of it lives as a traitor, and its wipe follows the traitor's fall", () => {
    let m = until(delver(), holding, 400);
    const { soldier, warband } = rec(m);
    const c = m.duel.crowd!;
    const dead = (a: readonly number[]) => a.map((v, s) => (c.squad[s] === warband ? 0 : v));
    m = { ...m, duel: { ...m.duel, crowd: { ...c, alive: dead(c.alive), hp: dead(c.hp) } } };
    m = tick(tick(m));
    expect(m.delver!.wiped).not.toContain(warband);
    const k = traitorSlot(m.config, 0);
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === k ? { ...f, hp: 0, death: { tick: m.duel.tick, cause: 'Fall' as const, blow: null } } : f)) } };
    const next = tick(m);
    expect(next.delver!.wiped).toContain(warband);
    expect(next.duel.crowd!.alive[soldier]).toBe(0);
    expect(next.events.some((e) => e.type === 'WarbandWiped' && e.warband === warband)).toBe(true);
  });

  it('count a party Fighter felled by its blow as a kill', () => {
    const records: TraitorState[] = [{ soldier: 5, warband: 0, deaths: 0, floorDeaths: 0, taken: 1, next: 0, kills: 0 }, { soldier: -1, warband: -1, deaths: 0, floorDeaths: 0, taken: 0, next: 0, kills: 0 }];
    const hit = { type: 'Hit', attacker: 2, defender: 0 } as unknown as SimEvent;
    const death = { type: 'Death', fighter: 0 } as unknown as SimEvent;
    const out = countTraitorKills(records, [hit, death], { teams: [0, 0] });
    expect(out.map((r) => r.kills)).toEqual([1, 0]);
    // A Warband Soldier's kill is nobody's; a traitor who left counts none.
    expect(countTraitorKills(records, [{ ...hit, attacker: 6 } as SimEvent, death], { teams: [0, 0] })).toBe(records);
    expect(countTraitorKills([{ ...records[0]!, away: true }], [hit, death], { teams: [0, 0] })[0]!.kills).toBe(0);
  });

  it('who leaves has its Soldier made an ordinary promoted enemy, back in its Warband, and takes over no more', () => {
    let m = until(delver(), holding, 400);
    const k = traitorSlot(m.config, 0);
    const { soldier, warband } = rec(m);
    m = takeOverFighter(m, k);
    expect(rec(m)).toMatchObject({ soldier: -1, warband: -1, away: true });
    expect(m.duel.delver!.traitors).toBe(m.delver!.traitors);
    expect(m.duel.fighters[k]!.soldier).toEqual({ index: soldier, since: m.duel.tick + 1, role: 'Attack' });
    expect(m.duel.crowd!.squad[soldier]).toBe(warband);
    expect(reservedSlots(m.config, m.delver!.traitors)).toEqual([]);
    expect(takeOverFighter(m, k)).toBe(m);
    m = until(m, () => false, secondsToTicks(4));
    expect(rec(m).taken).toBe(1);
  });

  it('take nothing with them down the Stairs: on the next Floor each watches its first delay again, its wait reset', () => {
    let m = until(delver(), holding, 400);
    // Down the Stairs: the fade's end starts Floor 2.
    m = { ...m, nextDuelTick: m.tick + 1, delver: { ...m.delver!, phase: 'Descending', traitors: m.delver!.traitors!.map((r) => ({ ...r, deaths: 3, floorDeaths: 3 })) } };
    m = tick(m);
    expect(m.delver!.floor).toBe(2);
    expect(rec(m)).toMatchObject({ soldier: -1, warband: -1, deaths: 3, floorDeaths: 0, taken: 1, next: respawnTicks(tuning, 0) });
    expect(m.duel.fighters[traitorSlot(m.config, 0)]!.benched).toBe(true);
  });
});
