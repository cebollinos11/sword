/**
 * The roster pass (docs/plans/enemy-behaviours.md, Stage 6): each changed Delver Prefab fought as a Duel Troop (Stage 0's `?dev=1`
 * Troop select, headless: `lineupMatch` → `createMatch`), counting its signature move against the same Troop with its old Style and
 * no Quirks. Its opponent is a plain Balanced AI of its Variant's tier. Nobody dies (each Fighter's HP is set very high after
 * `lineupMatch`, so a Troop keeps the Size its own HP gives), so every Duel runs its whole length, on the Editor's flat Arena. Counts over a few seeds, not sequences.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, TICK_RATE, type Action, type MatchState, type SimEvent } from '../sim';
import { lineupAis, lineupMatch, stepMatchWith, type Controller, type Lineup } from './index';

const repo = loadTuningData();
/** The plain opponents never die. */
const endless: TuningData = { ...repo, fighter: { ...repo.fighter, maxHp: 1e9 } };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const TICKS = TICK_RATE * 60;

/** Each changed Prefab's Style before the roster pass (its Variants had no Quirks then). */
const OLD_STYLE: Readonly<Record<string, string>> = { Lorekeeper: 'Counter', Cutthroat: 'Tricky', Bruiser: 'Aggressive', Uruk: 'Aggressive', Revenant: 'Aggressive', Squire: 'Defensive' };

/** `endless` with every changed Prefab's plain Variants back on their old Style and no Quirks (its Boss Variants are as shipped). */
const old: TuningData = {
  ...endless,
  delver: {
    ...endless.delver,
    troops: endless.delver.troops.map((p) => {
      const style = OLD_STYLE[p.name];
      if (!style) return p;
      return { ...p, style, quirks: [], variants: p.variants.map((v) => (v.boss ? v : (({ quirks: _q, ...rest }) => ({ ...rest, style }))(v))) };
    }),
  },
};

/** `endless` with the Uruk's plain Variants Reckless but not Slow: to tell the Style's part from the Quirk's. */
const recklessUruk: TuningData = {
  ...endless,
  delver: { ...endless.delver, troops: endless.delver.troops.map((p) => (p.name !== 'Uruk' ? p : { ...p, quirks: [], variants: p.variants.map((v) => (v.boss ? v : (({ quirks: _q, ...rest }) => rest)(v))) })) },
};

interface Counts {
  chambers: number;
  /** Chambers it planned (one per enemy Attack it chose to Chamber), and the enemy Attacks it saw start. */
  planned: number;
  foeAttacks: number;
  /** Ticks Fighter 0 stood within 2 m of Fighter `packs` (its first foe), of `fought` Ticks. */
  near: number;
  fought: number;
  /** Daggers thrown in each Duel's first 10 s. */
  early: number;
  throws: number;
  chains: number;
  recoveries: number;
  leaps: number;
  hops: number;
  blocks: number;
  windUps: number[];
  /** Ticks on which every Troop (team 0) was focused on the same enemy, and Ticks counted. */
  together: number;
  ticks: number;
}

const chaining = (a: Action): boolean => a.kind === 'Attack' && (a.chain !== undefined || a.whiffChain !== undefined);

/**
 * `packs` Fighters of the Troop `variant` (of Prefab `prefab`) on team 0 against `foes` plain Balanced AIs of `tier` (Arming Sword) on team 1,
 * under `tuning`; Fighter 0's counts (and the team's focus) over every seed.
 */
function fight(tuning: TuningData, prefab: string, variant: string, tier: string, packs = 1, foes = 1): Counts {
  const c: Counts = { chambers: 0, planned: 0, foeAttacks: 0, early: 0, near: 0, fought: 0, throws: 0, chains: 0, recoveries: 0, leaps: 0, hops: 0, blocks: 0, windUps: [], together: 0, ticks: 0 };
  const lineup: Lineup = [
    ...Array.from({ length: packs }, () => ({ team: 0 as const, pilot: { kind: 'AI' as const, difficulty: tier }, troop: { prefab, variant } })),
    ...Array.from({ length: foes }, () => ({ team: 1 as const, pilot: { kind: 'AI' as const, difficulty: tier, style: 'Balanced' }, weapon: 'Arming Sword' })),
  ];
  for (const seed of SEEDS) {
    const options = lineupMatch(tuning, lineup, [], { bestOf: 1, distance: 3, seed, arena: tuning.arena.editor });
    let m: MatchState = createMatch(tuning, { ...options, troops: options.troops!.map((t) => (t ? { ...t, maxHp: 1e9 } : t)) });
    // Every slot is an AI here, so none is null.
    const ais = lineupAis(tuning, lineup, 'Duels', { seed }) as Controller[];
    let up = false;
    let swung = false;
    let windUpAt = -1;
    const plans = new Set<string>();
    for (let t = 0; t < TICKS; t++) {
      const before = m.duel.fighters[0]!;
      m = stepMatchWith(m, ais, tuning);
      if (m.duel.duel.status !== 'Fighting') continue;
      const f = m.duel.fighters[0]!;
      const foe = m.duel.fighters[packs]!;
      c.fought++;
      if (Math.hypot(f.position.x - foe.position.x, f.position.z - foe.position.z) < 2) c.near++;
      const events: readonly SimEvent[] = m.duel.events;
      for (const e of events) {
        if (e.type === 'Chamber' && e.chamberer === 0) c.chambers++;
        if (e.type === 'DaggerThrown' && e.thrower === 0) {
          c.throws++;
          if (t < TICK_RATE * 10) c.early++;
        }
        if (e.type === 'AttackPhase' && e.phase === 'Wind-up' && e.fighter >= packs) c.foeAttacks++;
        if (e.type === 'Block' && e.defender === 0 && !e.whirlwind) c.blocks++;
        if (e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Wind-up') windUpAt = m.duel.tick;
        if (e.type === 'AttackPhase' && e.fighter === 0 && e.phase === 'Release' && windUpAt >= 0) {
          c.windUps.push(m.duel.tick - windUpAt);
          windUpAt = -1;
        }
      }
      const plan = (ais[0]!.save?.() as { defencePlan?: { kind: string; attacker: number; attackStart: number } | null }).defencePlan;
      if (plan?.kind === 'Chamber') plans.add(`${plan.attacker}:${plan.attackStart}`);
      if (chaining(f.action) && !chaining(before.action)) c.chains++;
      if (f.action.kind === 'Attack' && f.action.phase === 'Recovery' && !(before.action.kind === 'Attack' && before.action.phase === 'Recovery')) c.recoveries++;
      if (f.air?.jumped && !before.air) [up, swung] = [true, false];
      if (up && f.action.kind === 'Attack') swung = true;
      if (up && !f.air) {
        up = false;
        if (swung) c.leaps++;
        else c.hops++;
      }
      if (packs > 1) {
        const foci = ais.slice(0, packs).map((a) => (a.save?.() as { focus: { fighter: number } | null }).focus?.fighter ?? -1);
        c.ticks++;
        if (foci[0]! >= 0 && foci.every((x) => x === foci[0])) c.together++;
      }
    }
    c.planned += plans.size;
  }
  return c;
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const TIERS = ['Beginner', 'Skilled', 'Expert'] as const;
/** A Prefab's plain Variant name at a tier. */
const v = (prefab: string, tier: string) => `${prefab} (${tier})`;
/** [old, new] counts of `prefab` at every tier (and a third column under `also`, when given). */
const both = (prefab: string, packs = 1, foes = 1, also?: TuningData) =>
  Object.fromEntries(
    TIERS.map((t) => [t, [fight(old, prefab, v(prefab, t), t, packs, foes), fight(endless, prefab, v(prefab, t), t, packs, foes), ...(also ? [fight(also, prefab, v(prefab, t), t, packs, foes)] : [])] as unknown as readonly [Counts, Counts, Counts?]]),
  );
const log = (what: string, rows: Record<string, readonly [Counts, Counts, Counts?]>, pick: (c: Counts) => number | string) =>
  console.log(`${what} [old, new]`, JSON.stringify(Object.fromEntries(Object.entries(rows).map(([t, [a, b, c]]) => [t, [pick(a), pick(b), ...(c ? [pick(c)] : [])]]))));

describe('the roster pass: each changed Prefab against itself in its old Style, as a Duel Troop', { timeout: 300_000 }, () => {
  // Counter already doubles chamberRate; Chambermaster triples it (Skilled 0.16 → 0.24, Expert 0.5 → 0.75). But only about 1 enemy Attack in 20 can be
  // Chambered at all (the timing, `planDefence`), so the counts barely move: recorded in the plan's Stage 6 Result, not asserted as a rise.
  it('Lorekeeper (Counter → Chambermaster) plans Chambers at Skilled and Expert, and none at Beginner (by Reaction Time)', () => {
    const r = both('Lorekeeper');
    log('Lorekeeper Chambers planned / foe Attacks', r, (c) => `${c.planned}/${c.foeAttacks}`);
    log('Lorekeeper Chambers landed', r, (c) => c.chambers);
    for (const t of ['Skilled', 'Expert'] as const) expect(r[t]![1].planned, t).toBeGreaterThan(0);
    expect(r.Beginner![1].planned).toBe(0);
  });

  it('Cutthroat (Tricky → Skirmisher) throws its daggers sooner at every tier (3 a Duel at most, so the totals cap)', () => {
    const r = both('Cutthroat');
    log('Cutthroat throws in the first 10 s / in all', r, (c) => `${c.early}/${c.throws}`);
    for (const t of TIERS) expect(r[t]![1].early, t).toBeGreaterThan(r[t]![0].early);
  });

  // Reckless and Aggressive both lean hard on offence (chainRate ×1.8 against ×1.6; both stay within 2 m of their foe about 95% of the time), so at
  // Skilled and Expert the Chains barely move: recorded in the plan's Stage 6 Result. The Beginner's Dumb is the visible change.
  it('Bruiser (Aggressive → Reckless, Beginner Dumb): a Beginner Blocks nothing and Chains more', () => {
    const r = both('Bruiser');
    log('Bruiser Chains / Recoveries', r, (c) => `${c.chains}/${c.recoveries}`);
    log('Bruiser Blocks', r, (c) => c.blocks);
    log('Bruiser near', r, (c) => (c.near / c.fought).toFixed(2));
    const share = (c: Counts) => c.chains / Math.max(1, c.recoveries);
    expect(share(r.Beginner![1])).toBeGreaterThan(share(r.Beginner![0]));
    expect(r.Beginner![1].blocks).toBe(0);
    expect(r.Beginner![0].blocks).toBeGreaterThan(0);
  });

  // Its Chains are recorded, not asserted: Reckless barely changes them (see the Bruiser), and Slow, with fewer and later swings, takes fewer.
  it('Uruk (Aggressive → Reckless + Slow) winds its Sledge Hammer up 34 Ticks, not 25; without Slow, 25', () => {
    // Counted from the Wind-up event's Tick to the Release's: one more than the Wind-up's Ticks (25 → 26, 34 → 35).
    // Third column: Reckless without Slow, to tell the Style's part from the Quirk's.
    const r = both('Uruk', 1, 1, recklessUruk);
    log('Uruk Chains / Recoveries', r, (c) => `${c.chains}/${c.recoveries}`);
    log('Uruk median Wind-up Ticks', r, (c) => median(c.windUps));
    log('Uruk near', r, (c) => (c.near / c.fought).toFixed(2));
    for (const t of TIERS) {
      expect(median(r[t]![0].windUps), t).toBe(26);
      expect(median(r[t]![1].windUps), t).toBe(35);
      expect(median(r[t]![2]!.windUps), t).toBe(26);
    }
  });

  it('Revenant (Aggressive → Pack Hunter): two of them against two foes fight one together far more often', () => {
    const r = both('Revenant', 2, 2);
    log('Revenant both on one foe (share of Ticks)', r, (c) => (c.together / c.ticks).toFixed(2));
    for (const t of TIERS) expect(r[t]![1].together / r[t]![1].ticks, t).toBeGreaterThan(r[t]![0].together / r[t]![0].ticks + 0.2);
  });

  it('Squire (Defensive, + Hopper at Skilled and Expert), caught 1 v 2: jumps more there, and its Beginner is unchanged', () => {
    // A hop needs a pincer or a blocked walk (Stage 4), so it fights two.
    const r = both('Squire', 1, 2);
    log('Squire leaps + hops', r, (c) => `${c.leaps}+${c.hops}`);
    for (const t of ['Skilled', 'Expert'] as const) expect(r[t]![1].leaps + r[t]![1].hops, t).toBeGreaterThan(r[t]![0].leaps + r[t]![0].hops);
    expect(r.Beginner![1]).toEqual(r.Beginner![0]);
  });
});
