/**
 * The roster pass on a Floor (docs/plans/enemy-behaviours.md, Stage 6): a promoted Soldier of each changed Prefab plays its confirmed
 * Style and Quirks (its Pool AI is keyed by them) and wears its Mods, a Slow one's pace Mods on top of its own; and a Slow Soldier in the
 * Crowd walks at the Crowd's speed, as every other one does.
 */
import { describe, expect, it } from 'vitest';
import { defaultWeaponName, loadTuningData, type TuningData } from '../tuning';
import type { WarbandTemplate } from '../tuning/delver';
import { createPoolAi } from '../controllers/poolAi';
import { arenaOf } from './arena';
import { groundOf, soldierHeight } from './battlefield';
import { stepCrowd, type CrowdState } from './crowd';
import { arenaTuning, deployWarbands, floorArenaName, floorOf, warbandHomes } from './delver';
import { floorPrefabs, troopMods } from './delver/troops';
import { battleMapOf, fieldDistance, fieldToward, oneField } from './destinations';
import { stepBubbles, unboundSlot } from './bubble';
import { NO_MODS, storedMods } from './mods';
import { warbandBrain } from './warband';
import { hashValue } from './hash';
import { standingFighter } from './step';
import type { FighterState, SimState } from './state';
import { flatFloors } from './delver/flat.testdata';

/**
 * Without Troop Rarities (no `rarityMix`, no row naming one): every Prefab may fill any row, so a plain Soldier of each Variant turns up. Under
 * the bundled rarities a rare Prefab only leads elites, and an uncommon one's Beginners are seldom met.
 */
function withoutRarity(t: TuningData): TuningData {
  const { rarityMix: _mix, ...delver } = t.delver;
  const strip = (ts: readonly WarbandTemplate[]) => ts.map((tp) => ({ ...tp, troops: tp.troops.map(({ rarity: _r, ...row }) => row) }));
  const warbands = delver.warbands.map((w) => ({
    ...w, guard: strip(w.guard), patrol: strip(w.patrol), elite: strip(w.elite ?? []), ...(w.boss ? { boss: { ...w.boss, guard: strip(w.boss.guard) } } : {}),
  }));
  return { ...t, delver: { ...delver, warbands } };
}

const tuning = withoutRarity(flatFloors(loadTuningData()));
const TIMEOUT = 120_000;

/** The confirmed roster (the user's answers, 2026-11-26): each changed Prefab's plain Variants' Style and Quirks, by tier. */
const ROSTER: Readonly<Record<string, { style: string; quirks: Readonly<Record<string, readonly string[]>> }>> = {
  Lorekeeper: { style: 'Chambermaster', quirks: { Beginner: [], Skilled: [], Expert: [] } },
  Cutthroat: { style: 'Skirmisher', quirks: { Beginner: [], Skilled: [], Expert: [] } },
  Bruiser: { style: 'Reckless', quirks: { Beginner: ['Dumb'], Skilled: [], Expert: [] } },
  Uruk: { style: 'Reckless', quirks: { Beginner: ['Slow'], Skilled: ['Slow'], Expert: ['Slow'] } },
  Revenant: { style: 'Pack Hunter', quirks: { Beginner: [], Skilled: [], Expert: [] } },
  Squire: { style: 'Defensive', quirks: { Beginner: [], Skilled: ['Hopper'], Expert: ['Hopper'] } },
};
const SLOW = { walkSpeed: 0.7, windUp: 1.35 };

/** Floor `floor` of Run `seed`, its Crowd deployed. */
function scene(seed: number, floor: number) {
  const name = floorArenaName(seed, floor);
  const built = floorOf(tuning, name)!;
  const t = arenaTuning(tuning, name);
  const map = battleMapOf(t.battle, name);
  const crowd = deployWarbands(t, built.plan, built.field, seed, floor, 1);
  const homes = warbandHomes(built.plan);
  return { name, plan: built.plan, t, battle: t.battle, map, field: map.field, crowd, brain: warbandBrain(homes, t.delver) };
}
type Scene = ReturnType<typeof scene>;

/** A Duel on `s` with one party Fighter at (x, z) and the Pool's other slots unbound. */
function duel(s: Scene, x: number, z: number, crowd: CrowdState): SimState {
  const f: FighterState = standingFighter(s.t, arenaOf(s.t, s.name), { position: { x, z }, y: soldierHeight(s.field, groundOf(s.battle, s.field, x, z, 0), x, z), facing: 0 }, defaultWeaponName(s.t), 0);
  return { tick: 0, arena: s.name, rng: crowd.rng, fighters: [f, ...Array.from({ length: s.t.battle.bubble.poolSize - 1 }, () => unboundSlot(s.t, s.name))], daggers: [], duel: { status: 'Fighting' }, crowd, events: [] };
}

/** A spot 2 m from Soldier `i` on its own floor, joined to it by a short walk, for the party Fighter. */
function beside(s: Scene, i: number): { x: number; z: number } | null {
  const x0 = s.crowd.x[i]!;
  const z0 = s.crowd.z[i]!;
  const on = s.crowd.surface[i]!;
  const from = oneField(s.map.fields, fieldToward(s.map.fields, x0, z0, on));
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
    const x = x0 + dx;
    const z = z0 + dz;
    const at = groundOf(s.battle, s.field, x, z, 0);
    if (at === on && fieldDistance(from, 0, x, z, at) >= 0 && fieldDistance(from, 0, x, z, at) < 3) return { x, z };
  }
  return null;
}

/** The first (seed, Floor) whose Crowd holds a plain (not elite) Soldier of Variant `variant`, with that Soldier's index. */
const scenes = new Map<string, Scene>();
function soldierOf(variant: string, prefab: number): { s: Scene; i: number } {
  for (let seed = 1; seed <= 40; seed++)
    for (let floor = 1; floor <= tuning.delver.tiers * tuning.delver.floorsPerTier; floor++) {
      if (!floorPrefabs(tuning.delver, seed, floor).includes(prefab)) continue;
      const key = `${seed}:${floor}`;
      let s = scenes.get(key);
      if (!s) scenes.set(key, (s = scene(seed, floor)));
      for (let i = 0; i < s.crowd.troop.length; i++) if (s.battle.troops[s.crowd.troop[i]!]!.name === variant && beside(s, i)) return { s, i };
    }
  throw new Error(`no Floor fields ${variant}`);
}

describe('the roster pass on a Floor', { timeout: TIMEOUT }, () => {
  for (const [prefab, { style, quirks }] of Object.entries(ROSTER))
    for (const [tier, qs] of Object.entries(quirks))
      it(`a promoted ${prefab} (${tier}) plays ${style}${qs.length ? ` + ${qs.join(' + ')}` : ''}, with its Mods`, () => {
        const p = tuning.delver.troops.findIndex((x) => x.name === prefab);
        const variant = `${prefab} (${tier})`;
        const { s, i } = soldierOf(variant, p);
        const troop = s.battle.troops[s.crowd.troop[i]!]!;
        expect(troop.style).toBe(style);
        expect(troop.quirks ?? []).toEqual(qs);
        // Only that Soldier stands; the party Fighter 2 m from it promotes it.
        const crowd: CrowdState = { ...s.crowd, alive: s.crowd.alive.map((a, k) => (k === i ? a : 0)) };
        const at = beside(s, i)!;
        const next = stepBubbles(duel(s, at.x, at.z, crowd), 1, 1, s.t);
        const slot = next.fighters.findIndex((f) => f.soldier?.index === i);
        expect(slot).toBeGreaterThan(0);
        const f = next.fighters[slot]!;
        // Its Mods: its Variant's (Bruiser's and Uruk's damage 0.6) and its Relics', then a Slow one's walk and Wind-up.
        const mods = troopMods(s.t, troop);
        expect(f.mods ?? {}).toEqual(mods === NO_MODS || Object.keys(storedMods(mods)).length === 0 ? {} : storedMods(mods));
        if (qs.includes('Slow')) expect(f.mods).toMatchObject({ damage: 0.6, ...SLOW });
        else {
          expect(f.mods?.walkSpeed).toBeUndefined();
          expect(f.mods?.windUp).toBeUndefined();
        }
        // Its Pool AI is keyed by (difficulty, Style, Quirks).
        const ai = createPoolAi(tuning);
        ai.intent(next, slot);
        const saved = ai.save!() as { difficulty: string; style: string; quirks?: readonly string[] };
        expect(saved.difficulty).toBe(tier);
        expect(saved.style).toBe(style);
        expect(saved.quirks ?? []).toEqual(qs);
      });

  it('a Boss Variant keeps its own Style and no Quirks (the Warden is Aggressive, not Slow)', () => {
    const troops = tuning.delver.troops;
    const boss = (name: string) => troops.flatMap((p) => p.variants).find((v) => v.name === name)!;
    expect(boss('Warden').style).toBe('Aggressive');
    expect(boss('Warden').quirks).toBeUndefined();
    expect(boss('Wraith Lord').style).toBe('Aggressive');
    expect(boss('Wraith Lord').quirks).toBeUndefined();
    expect(boss('Duelist').style).toBe('Counter');
  });

  it('a Slow Uruk in the Crowd walks at the Crowd\'s speed: the Crowd steps the same with Slow taken off every Troop', () => {
    const p = tuning.delver.troops.findIndex((x) => x.name === 'Uruk');
    const { s, i } = soldierOf('Uruk (Beginner)', p);
    const party = beside(s, i)!;
    const fighters = [{ x: party.x + 6, z: party.z, y: soldierHeight(s.field, groundOf(s.battle, s.field, party.x, party.z, 0), party.x, party.z), team: 0, slot: 0 }];
    const notSlow = { ...s.battle, troops: s.battle.troops.map((t) => (t.quirks ? { ...t, quirks: t.quirks.filter((q) => q !== 'Slow') } : t)) };
    const walk = (battle: TuningData['battle']) => {
      let c = s.crowd;
      for (let tick = 1; tick <= 120; tick++) c = stepCrowd(c, tick, battle, fighters, s.map, s.brain);
      return c;
    };
    const slow = walk(s.battle);
    expect(hashValue(slow)).toBe(hashValue(walk(notSlow)));
    // And it did walk (toward the party Fighter, or with its Warband).
    expect(Math.hypot(slow.x[i]! - s.crowd.x[i]!, slow.z[i]! - s.crowd.z[i]!)).toBeGreaterThan(0);
  });
});
