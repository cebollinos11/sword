import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, MAX_TEAM_SIZE, modsOf, type MatchState } from '../sim';
import { daggerCapacity, runBuilds } from './runBuilds';

const tuning = loadTuningData();
const start = (humans = 2): MatchState => createMatch(tuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, humans, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
/** `match` with Fighter `i` holding `inventory`. */
const holding = (m: MatchState, i: number, inventory: NonNullable<MatchState['duel']['fighters'][number]['inventory']>): MatchState => ({
  ...m,
  duel: { ...m.duel, fighters: m.duel.fighters.map((f, j) => (j === i ? { ...f, inventory } : f)) },
});

describe('runBuilds', () => {
  it('gives each Player the Weapon wielded and the Relics equipped and carried, and no one else', () => {
    const [a, b] = [tuning.relics[0]!.name, tuning.relics[1]!.name];
    let m = start();
    const w = m.duel.fighters[0]!.inventory!.weapons[0]!;
    m = holding(m, 0, { weapons: [w, 'Spear'], relics: [a, b], weapon: 1, equipped: [0] });
    expect(runBuilds(m)).toEqual([
      { fighter: 0, weapon: 'Spear', equipped: [a], carried: [b] },
      { fighter: 1, weapon: m.duel.fighters[1]!.inventory!.weapons[0], equipped: [], carried: [] },
    ]);
  });

  it('is empty with no Run', () => {
    expect(runBuilds(createMatch(tuning, { format: 'Duels', arena: 'gen:greybox:12', bestOf: 1, humans: 1, teams: [0, 1] }))).toEqual([]);
  });
});

describe('daggerCapacity', () => {
  it('follows the Fighter’s mods.daggers, not the Tuning Data’s count alone', () => {
    const f = start().duel.fighters[0]!;
    expect(daggerCapacity(tuning, f)).toBe(tuning.dagger.count);
    const bandolier = tuning.relics.find((r) => r.effects.daggers)!;
    expect(daggerCapacity(tuning, { mods: { ...modsOf(f), daggers: bandolier.effects.daggers! } })).toBe(tuning.dagger.count + bandolier.effects.daggers!);
  });
});
