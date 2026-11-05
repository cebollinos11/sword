/**
 * The pure parts of the results screen's builds and the HUD's dagger pips (docs/plans/dungeon.md, Stage 3). Render only: they read the
 * Match, never change it.
 */
import { modsOf, runPlayers, wieldedWeapon, type FighterState, type MatchState } from '../sim';
import type { Lineup } from '../controllers';
import type { TuningData } from '../tuning';

/** One Player's build at a Run's end: its Fighter, the Weapon wielded, the Relics equipped and the Relics carried (names, in slot order). */
export interface RunBuild {
  readonly fighter: number;
  /** Its Player's name (`playerName`). */
  readonly name: string;
  readonly weapon: string;
  readonly equipped: readonly string[];
  readonly carried: readonly string[];
}

/** Each Player's build in a Run, in Fighter order; empty outside a Run. AI allies and Fighters without an inventory are left out. */
export function runBuilds(match: MatchState, nameOf: (fighter: number) => string = (f) => `Player ${f + 1}`): RunBuild[] {
  if (!match.run) return [];
  return [...runPlayers(match.config)]
    .sort((a, b) => a - b)
    .flatMap((fighter) => {
      const inv = match.duel.fighters[fighter]?.inventory;
      if (!inv) return [];
      return [{ fighter, name: nameOf(fighter), weapon: wieldedWeapon(inv), equipped: inv.equipped.map((s) => inv.relics[s]!), carried: inv.relics.filter((_, s) => !inv.equipped.includes(s)) }];
    });
}

/** How many Throwing Daggers the Fighter starts a Duel with: the Tuning Data's count and its `mods.daggers` (Bandolier). The HUD shows this many pips. */
export const daggerCapacity = (tuning: Pick<TuningData, 'dagger'>, f: Pick<FighterState, 'mods'> | undefined): number => tuning.dagger.count + (f ? modsOf(f).daggers : 0);

/** The name of Fighter `fighter`'s Player: the Lobby's name for it (index = Player number), else "Player N". The same on every peer. */
export function playerName(lineup: Lineup | null, names: readonly string[] | null | undefined, fighter: number): string {
  const pilot = lineup?.[fighter]?.pilot;
  const player = pilot?.kind === 'Player' ? pilot.player : fighter;
  return names?.[player] ?? `Player ${player + 1}`;
}
