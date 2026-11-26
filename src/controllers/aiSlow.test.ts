/**
 * The Slow Quirk and the AI (docs/plans/enemy-behaviours.md, Stage 5). Slow is a `body` Quirk (Mods, not AI settings), so what the AI does about
 * it is read: an AI sees a Slow enemy's Wind-up last longer (`Sighting.windUp`) and times its Blocks and Chambers by it, and a Slow AI times
 * its own Attacks by its own Wind-up. A plain AI Seat and a Duel Troop with Slow both walk and wind up slowly.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attack, attackTimings, createInitialState, createMatch, duelPlacements, fighterTuning, IDLE_INTENT, NO_MODS, stepMatch, storedMods, wait, type Intent, type MatchState, type SimState } from '../sim';
import { quirkMods, resolveTroop } from '../sim/delver';
import { isAiMemory } from '../net/messages';
import { aiDifficulty, createAiController, lineupMatch, runControllers, scriptedController, type Lineup } from './index';

const repo = loadTuningData();
const SLOW = storedMods(quirkMods(repo, ['Slow']));
const withMods = (s: SimState, i: number, mods = SLOW): SimState => ({ ...s, fighters: s.fighters.map((f, k) => (k === i ? { ...f, mods } : f)) });

/** A scripted Fighter 0 (Slow or not) Attacking Overhead at an Expert AI Fighter 1 that always Chambers: the run, and the Ticks that matter. */
function chamberOf(slow: boolean, aiSlow = false, seed = 1) {
  // An Expert's eyes and hands (its Reaction Time and mistake rate), with no offence of its own and every defence a Chamber.
  const ai = createAiController(repo, { ...aiDifficulty(repo, 'Expert'), chamberRate: 1, aggression: 0, kickRate: 0, throwRate: 0, preempt: 0, pressure: 0, punish: 0, chainRate: 0, footwork: 0 });
  let initial = createInitialState(repo, seed, duelPlacements(1.3));
  if (slow) initial = withMods(initial, 0);
  if (aiSlow) initial = withMods(initial, 1);
  const run = runControllers(repo, initial, [scriptedController([...wait(30), ...attack('Overhead')]), ai], 150);
  const firstOf = (i: number, phase: string) => run.states.findIndex((s) => s.fighters[i]!.action.kind === 'Attack' && (s.fighters[i]!.action as { phase: string }).phase === phase);
  const release = firstOf(0, 'Release');
  const press = firstOf(1, 'Wind-up');
  const chamber = run.events.find((e) => e.type === 'Chamber');
  return { run, release, press, chamber, memory: ai.save() };
}

describe('an AI reads a Slow enemy\'s Wind-up', () => {
  it('an Expert Chambers a Slow enemy\'s Overhead, pressing at the same Tick of its Release as against a normal one', () => {
    const plain = chamberOf(false);
    const slow = chamberOf(true);
    const shift = attackTimings(fighterTuning(repo, slow.run.states[0]!.fighters[0]!), slow.run.states[0]!.fighters[0]!.weapon, 'Overhead').windUpEnd - attackTimings(repo, plain.run.states[0]!.fighters[0]!.weapon, 'Overhead').windUpEnd;
    expect(shift).toBeGreaterThan(0);
    // The Release comes `shift` Ticks later, and so does the Chamber: the same Tick of the Release.
    expect(slow.release - plain.release).toBe(shift);
    expect(slow.chamber).toMatchObject({ type: 'Chamber', chamberer: 1, attacker: 0 });
    expect(plain.chamber).toMatchObject({ type: 'Chamber', chamberer: 1, attacker: 0 });
    expect(slow.press - slow.release).toBe(plain.press - plain.release);
    expect(slow.chamber!.tick - slow.release).toBe(plain.chamber!.tick - plain.release);
    expect(slow.run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
  });

  it('a Slow Expert Chambers a normal enemy too: its own Chamber is its own Attack, timed by its own Wind-up', () => {
    const plain = chamberOf(false);
    const slowAi = chamberOf(false, true);
    expect(slowAi.chamber).toMatchObject({ type: 'Chamber', chamberer: 1, attacker: 0 });
    expect(slowAi.run.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(false);
    // The Chamber lands on the same Tick of the enemy's Release.
    expect(slowAi.chamber!.tick - slowAi.release).toBe(plain.chamber!.tick - plain.release);
  });

  it("keeps the Slow enemy's windUp in what it saw (its memory), which the resync validator accepts; a normal one's has no windUp", () => {
    const { memory } = chamberOf(true);
    const seen = (memory as { seen: { fighters: { windUp?: number }[] }[] }).seen.at(-1)!.fighters;
    expect(seen[0]!.windUp).toBe(1.35);
    expect('windUp' in seen[1]!).toBe(false);
    expect(isAiMemory(memory)).toBe(true);
    const bad = (windUp: unknown) => ({ ...(memory as object), seen: (memory as { seen: { fighters: object[] }[] }).seen.map((o) => ({ ...o, fighters: o.fighters.map((f, i) => (i === 0 ? { ...f, windUp } : f)) })) });
    expect(isAiMemory(bad(1.35))).toBe(true);
    for (const v of [1, 0, -1, '1.35', null]) expect(isAiMemory(bad(v)), JSON.stringify(v)).toBe(false);
  });

});

describe('Slow on a Duel Seat: a plain AI Seat and a Duel Troop both walk and wind up slowly', () => {
  /** A Duel from `lineup`, stepped until it is Fighting; then Fighter 1 walks sideways for 30 Ticks and Attacks Overhead. */
  function play(tuning: TuningData, lineup: Lineup) {
    let m: MatchState = createMatch(tuning, lineupMatch(tuning, lineup, ['Longsword'], { bestOf: 1, distance: 6, seed: 3 }));
    for (let k = 0; k < 2000 && m.duel.duel.status !== 'Fighting'; k++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    const walked: number[] = [];
    let windUp = 0;
    for (let k = 0; k < 120; k++) {
      const before = m.duel.fighters[1]!.position;
      const intent: Intent = k < 30 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : k === 30 ? { ...IDLE_INTENT, attack: true, direction: 'Overhead' } : IDLE_INTENT;
      m = stepMatch(m, [IDLE_INTENT, intent], tuning);
      const f = m.duel.fighters[1]!;
      if (k >= 1 && k < 30) walked.push(Math.hypot(f.position.x - before.x, f.position.z - before.z));
      if (f.action.kind === 'Attack' && f.action.phase === 'Wind-up') windUp++;
    }
    return { m, walked, windUp, mods: m.duel.fighters[1]!.mods };
  }
  const seat = (quirks?: string[]): Lineup => [
    { team: 0, pilot: { kind: 'Player', player: 0 } },
    { team: 1, pilot: { kind: 'AI', difficulty: 'Expert', ...(quirks ? { quirks } : {}) }, weapon: 'Longsword' },
  ];

  it('a plain AI Seat with Slow: config.fighterMods carries its Mods, its Fighter walks 0.7× and winds up 1.35×', () => {
    const plain = play(repo, seat());
    const slow = play(repo, seat(['Slow']));
    expect('fighterMods' in plain.m.config).toBe(false);
    expect(plain.mods).toBeUndefined();
    expect(slow.m.config.fighterMods).toEqual([null, SLOW]);
    expect(slow.mods).toEqual(SLOW);
    slow.walked.forEach((d, k) => expect(d / plain.walked[k]!).toBeCloseTo(0.7, 12));
    const w = attackTimings(repo, 'Longsword', 'Overhead').windUpEnd;
    expect(plain.windUp).toBe(w + 1);
    expect(slow.windUp).toBe(Math.round(w * 1.35) + 1);
    // Quirks with no body part give no Mods: the config is as it was.
    expect('fighterMods' in play(repo, seat(['Dumb', 'Hopper'])).m.config).toBe(false);
  });

  it('a Duel Troop with Slow (its Variant\'s Quirks) carries it in its Troop Mods, with its own (damage 0.6), and walks and winds up slowly', () => {
    // The bundled Uruk is Slow (the roster pass, Stage 6); the same Uruk with no Quirks is the baseline.
    const quirky: TuningData = repo;
    const quiet: TuningData = { ...repo, delver: { ...repo.delver, troops: repo.delver.troops.map((p) => (p.name !== 'Uruk' ? p : { ...p, quirks: [], variants: p.variants.map(({ quirks: _q, ...v }) => v) })) } };
    const uruk = { prefab: 'Uruk', variant: 'Uruk (Beginner)' };
    const troopSeat: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Expert' }, troop: uruk },
    ];
    const plain = play(quiet, troopSeat);
    const slow = play(quirky, troopSeat);
    expect(resolveTroop(quirky, uruk).mods).toMatchObject({ damage: 0.6, walkSpeed: 0.7, windUp: 1.35 });
    expect(slow.mods).toMatchObject({ damage: 0.6, walkSpeed: 0.7, windUp: 1.35 });
    expect(plain.mods).toEqual(storedMods({ ...NO_MODS, damage: 0.6 }));
    expect('fighterMods' in slow.m.config).toBe(false);
    slow.walked.forEach((d, k) => expect(d / plain.walked[k]!).toBeCloseTo(0.7, 12));
    const weapon = slow.m.duel.fighters[1]!.weapon;
    const w = attackTimings(repo, weapon, 'Overhead').windUpEnd;
    expect(plain.windUp).toBe(w + 1);
    expect(slow.windUp).toBe(Math.round(w * 1.35) + 1);
  });
});
