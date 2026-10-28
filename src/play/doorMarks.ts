import { arenaOf, doorCounters, hallBehind, hallOf, inExitZone, runHall, type MatchState, type SimHall } from '../sim';
import type { HallKind, TuningData } from '../tuning';

/** What lies behind one exit Door: its Hall's kind, and on a Boss's Door the Floor it leads to. */
export interface DoorExit {
  /** The exit's number (0-based, as `Hall.exits`; Arena Door `exit + 1`): the exits listed may skip some. */
  readonly exit: number;
  readonly kind: HallKind;
  /** The next Floor, when the Door leads to one; absent within a Floor. */
  readonly floor?: number;
}

/** Who stands at the exit Doors: per exit (indexed by exit number) how many of those who count are in its zone, and how many count. */
export interface DoorPlayers {
  readonly gathered: readonly number[];
  readonly party: number;
}

/** One exit Door's mark: its icon, whether its gate is drawn closed, and its texts. */
export interface DoorMarkView {
  /** The exit (0-based, as `Hall.exits`; Arena Door `exit + 1`). The entrance (Door 0) has no mark. */
  readonly exit: number;
  /** The Hall kind behind the Door (its icon is `hallIcon(icon)`). */
  readonly icon: HallKind;
  /** "Floor N+1" over a Boss's Door, else empty. */
  readonly label: string;
  /** "2 / 3" while the party gathers in the Door's zone, else empty. */
  readonly count: string;
  /** Closed while the Hall is fought, open once it is Cleared (or Leaving). Render only: the Door's geometry never changes. */
  readonly gate: 'closed' | 'open';
}

/** The marks of a Run's current Hall's exit Doors, one per exit; none outside a Run. */
export function doorMarkView(hall: SimHall | undefined, exits: readonly DoorExit[], players: DoorPlayers): DoorMarkView[] {
  if (!hall) return [];
  const gate = hall.phase === 'Fighting' ? 'closed' : 'open';
  return exits.map((to) => {
    const gathered = players.gathered[to.exit] ?? 0;
    return {
      exit: to.exit,
      icon: to.kind,
      label: to.floor === undefined ? '' : `Floor ${to.floor}`,
      count: gathered > 0 ? `${gathered} / ${players.party}` : '',
      gate,
    };
  });
}

/**
 * The Fighters the Door count is out of: the Run's Players still in the Duel, the same on every peer (it reads the Match, never who is
 * local). The one place the presentation says who counts: when the Simulation names them per Tick (a taken-over Fighter drops out, #66),
 * this is the line to switch.
 */
export const doorParty = (match: MatchState): number[] => doorCounters(match.config, match.duel.fighters);

/** What `doorMarkView` needs, read off a Match: none in Duels and once the Match is over. */
export function doorRun(match: MatchState, tuning: TuningData): { exits: DoorExit[]; players: DoorPlayers } | null {
  const run = match.run;
  if (!run || match.status.status === 'Over') return null;
  const arena = arenaOf(tuning, match.duel.arena);
  const fighters = match.duel.fighters;
  const counting = run.phase !== 'Fighting' ? doorParty(match) : [];
  const exits: DoorExit[] = [];
  const gathered: number[] = [];
  hallOf(tuning, match.config.arena, runHall(run)).exits.forEach((_, exit) => {
    const to = hallBehind(tuning, match.config, run, exit);
    if (!to) return;
    exits.push({ exit, kind: hallOf(tuning, match.config.arena, to).kind, ...(to.floor > run.floor ? { floor: to.floor } : {}) });
    gathered[exit] = counting.filter((i) => inExitZone(arena, exit, fighters[i]!)).length;
  });
  return { exits, players: { gathered, party: counting.length } };
}
