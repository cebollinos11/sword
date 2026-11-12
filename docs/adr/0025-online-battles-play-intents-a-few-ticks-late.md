# 0025 — Online Battles play Intents a few Ticks late (Input Delay)

## Status

Accepted.

## Context

A Rollback session applies the local Player's Intent on the very next Tick and predicts everyone else's (ADR 0001). Each Tick a real Intent arrives late and differs from its prediction is simulated again. At a 23 ms ping that is two to four Ticks a frame, on most frames: a human turning the camera changes `face` every Tick, so the prediction (their last Intent again) is nearly always wrong.

In a Duel that is cheap. In a Battle it is not: a Tick steps the Crowd and up to a whole Fighter Pool, each slot with its AI. With three Players (three Bubbles, about a dozen slots bound), a Tick costs about 2 ms where a Duel's costs a fraction of that, and the Rollbacks multiply it: measured over the memory transport (three Players, City, about 12 slots bound, 24 ms there and back), a peer's frame simulated 6.3 ms on average and 15 ms at the 99th percentile, before drawing anything. That is the whole frame on a modest machine.

And it has a cliff. A peer whose frame runs over falls behind; the others then hold its Intents later, so their Rollbacks deepen, so their frames run over too. Every peer ends up re-simulating the full Rollback window (15 Ticks) every frame and cannot climb back. Three Players reported exactly that: a Battle that played well until the Soldiers around them were promoted, then every peer's ping (measured on the main thread, so it shows a stalled frame) went from 23 ms to 300 ms and stayed there. Duels of 4 v 4 and a Gauntlet, whose Ticks are cheap, were fine.

What could be done:

- **Make the Tick cheaper.** Worth doing, and done before (the pose cache), but the Tick is spread thin over many parts; no single change halves it, and Rollbacks still multiply whatever is left.
- **Fewer Fighters** (a smaller Pool online). It changes the Battle the Players came for.
- **Input Delay**: play each Intent a few Ticks after it is made. It is sent at once, so it has those Ticks to arrive before any peer needs it, and an Intent that arrives in time is not predicted, so there is nothing to roll back. The cost is that a Player's own Fighter answers that much later.

## Decision

A Rollback session takes an `inputDelay` in Ticks (default 0, at most 8). The Intent given on the call that simulates Tick t is stored, and sent, as the Intent of Tick t + `inputDelay`; the first `inputDelay` Ticks play idle. Nothing else about the session changes: later Intents are still predicted and corrected by Rollback, the window, checksums, resyncs and AI Takeovers work on Ticks as before.

Online Battles use `BATTLE_INPUT_DELAY` = 3 Ticks (50 ms). Duels and Runs keep 0.

- It is each peer's own business. Streams carry Tick numbers, so peers need not agree on a delay, and nothing in the protocol changed.
- Time sync reads how far ahead a peer runs from what the other holds of its Intents. A peer now holds its own Intents `inputDelay` Ticks ahead of its Tick, so that much is taken off before the lead is measured; otherwise both ends would think they led and wait on each other.
- An AI Takeover still starts on the Tick after the last Intent the host holds of the guest who left, which may now be a few Ticks in the future.
- The camera follows the mouse at once, as before; only the Fighter (its facing, its swing) is 50 ms behind.

## Consequences

- With peers 24 ms apart, the same three-Player Battle rolls back on almost no Tick (0 to 40 in a thousand, from 500 to 850), and a frame simulates 3.5 ms on average and 9 ms at the 99th percentile. At 80 ms there and back, Rollbacks are three Ticks shallower.
- The cliff is further away, not gone: a peer that cannot step one Tick and draw a frame in time still falls behind, and Rollbacks return once it is more than three Ticks late.
- A Player's own Attack, Block and turn start 50 ms after the press in an online Battle. A Wheel Attack holds its Wind-up three Ticks longer (it lets go when it sees its Wind-up, which it now sees three Ticks late).
- Tests that replay what a peer sent must file each Intent under the Tick that played it (`session.currentTick + inputDelay`).
- If Duels or Runs ever need it (more Fighters, slower machines), they can take a delay of their own the same way.
