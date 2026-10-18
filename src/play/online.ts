/**
 * Player vs Player: a MatchDriver over the Rollback session. The session
 * already steps the Match (with Rollback, AI Fighters included) and knows the
 * local Fighter (from the Lineup, once connected), and drives the other
 * Players' Fighters with its Remote Controller (`session.remote`); this adds
 * what the game loop needs on top:
 *
 * - Clicks made while the session is stalled (Intent dropped) are carried to
 *   the next Tick that does advance, so a quick tap isn't lost.
 * - Refusals and disconnects become a readable `failure` message. Online
 *   Matches restart on their own (`rematchTicks`), so losing the host always
 *   ends a guest's play, Match over or not.
 * - Another Player leaving does not end the Match (the AI takes their Fighter
 *   over): it becomes a notice for the HUD.
 */
import type { Intent } from '../sim';
import type { Controller } from '../controllers';
import type { RefuseReason, RollbackSession, SessionEvent } from '../net';
import type { MatchDriver } from './driver';

export interface PlayerVsPlayerDriver extends MatchDriver {
  /** The Remote Controller driving the other Players' Fighters (allies or enemies). */
  readonly remote: Controller;
  readonly failure: string | null;
  readonly waiting: string | null;
  readonly ping: number | null;
  /** The oldest notice not yet shown (e.g. a Player left), or null. */
  takeNotice(): string | null;
  close(): void;
}

function refusalMessage(reason: RefuseReason, localHash: string, remoteHash: string): string {
  if (reason === 'TuningDataMismatch') {
    return `Your Tuning Data differs from the host's (yours ${localHash}, theirs ${remoteHash}). Every player needs the same game version.`;
  }
  return "Your game version differs from the host's. Every player needs to reload the latest version.";
}

function disconnectMessage(reason: 'Closed' | 'Timeout' | 'Dropped'): string {
  switch (reason) {
    case 'Closed':
      return 'The host left the Match (disconnected).';
    case 'Timeout':
      return 'Lost the connection to the host.';
    case 'Dropped':
      return 'The host lost track of you and handed your Fighter to the AI (connection too slow).';
  }
}

/** Carry presses from a dropped Intent into the next one: attack/block stay pressed, everything else is the latest. */
function carryPresses(dropped: Intent | null, next: Intent): Intent {
  if (!dropped) return next;
  return { ...next, attack: next.attack || dropped.attack, block: next.block || dropped.block };
}

/** `names`: each Player's name (index = Player number), for notices. */
export function playerVsPlayer(session: RollbackSession, names: readonly string[] = []): PlayerVsPlayerDriver {
  let failure: string | null = null;
  let dropped: Intent | null = null;
  const notices: string[] = [];
  session.onEvent((e: SessionEvent) => {
    if (failure) return;
    if (e.type === 'Refused') failure = refusalMessage(e.reason, e.localHash, e.remoteHash);
    else if (e.type === 'Disconnected' && session.role === 'guest') failure = disconnectMessage(e.reason);
    else if (e.type === 'PlayerLeft') notices.push(`${names[e.player] ?? `Player ${e.player + 1}`} left: the AI takes over`);
  });

  return {
    get localFighter() {
      return session.localFighter;
    },
    get lineup() {
      return session.lineup;
    },
    remote: session.remote,
    get state() {
      return session.state;
    },
    get failure() {
      return failure;
    },
    get ping() {
      return session.ping;
    },
    get waiting() {
      if (session.status !== 'Connecting') return null;
      return session.role === 'host' ? 'Waiting for the other players…' : 'Waiting for the host…';
    },
    takeNotice() {
      return notices.shift() ?? null;
    },
    tick(localIntent) {
      const running = session.status === 'Running';
      const intent = carryPresses(running ? dropped : null, localIntent);
      const { advanced } = session.tick(intent);
      dropped = !advanced && session.status === 'Running' ? intent : null;
      return { advanced };
    },
    close() {
      session.close();
    },
  };
}
