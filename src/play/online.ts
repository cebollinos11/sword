/**
 * Player vs Player: a MatchDriver over the Rollback session. The session
 * already steps the Match (with Rollback) and knows the local Fighter (host 0,
 * guest 1), and drives the peer's Fighter with its Remote Controller
 * (`session.remote`); this adds what the game loop needs on top:
 *
 * - Clicks made while the session is stalled (Intent dropped) are carried to
 *   the next Tick that does advance, so a quick tap isn't lost.
 * - Refusals and disconnects become a readable `failure` message; once the
 *   Match is over, the peer leaving is expected and not a failure.
 */
import type { Intent } from '../sim';
import type { RefuseReason, RollbackSession, SessionEvent } from '../net';
import type { MatchDriver } from './driver';

export interface PlayerVsPlayerDriver extends MatchDriver {
  readonly failure: string | null;
  readonly waiting: string | null;
  close(): void;
}

const WAITING = 'Waiting for your opponent…';

function refusalMessage(reason: RefuseReason, localHash: string, remoteHash: string): string {
  if (reason === 'TuningDataMismatch') {
    return `Your Tuning Data differs from your opponent's (yours ${localHash}, theirs ${remoteHash}). Both players need the same game version.`;
  }
  return "Your game version differs from your opponent's. Both players need to reload the latest version.";
}

/** Carry presses from a dropped Intent into the next one: attack/block stay pressed, everything else is the latest. */
function carryPresses(dropped: Intent | null, next: Intent): Intent {
  if (!dropped) return next;
  return { ...next, attack: next.attack || dropped.attack, block: next.block || dropped.block };
}

export function playerVsPlayer(session: RollbackSession): PlayerVsPlayerDriver {
  let failure: string | null = null;
  let dropped: Intent | null = null;
  const matchOver = () => session.state?.status.status === 'Over';

  session.onEvent((e: SessionEvent) => {
    if (failure) return;
    if (e.type === 'Refused') failure = refusalMessage(e.reason, e.localHash, e.remoteHash);
    else if (e.type === 'Disconnected' && !matchOver()) {
      failure = e.reason === 'Timeout' ? 'Lost the connection to your opponent.' : 'Your opponent left the Match (disconnected).';
    }
  });

  return {
    localFighter: session.localFighter,
    opponent: session.remote,
    get state() {
      return session.state;
    },
    get failure() {
      return failure;
    },
    get waiting() {
      return session.status === 'Connecting' ? WAITING : null;
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
