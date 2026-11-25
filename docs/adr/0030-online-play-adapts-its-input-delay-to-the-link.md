# 0030 — Online play adapts its Input Delay to the link

## Status

Accepted.

## Context

An online Duel played with no Input Delay (ADR 0025 kept Duels at 0, their Tick being cheap). Every other Player's Intent is then predicted, and the prediction is nearly always wrong: a human turning the camera changes `face` every Tick. So each Tick of one-way latency is a Tick every peer re-simulates, every frame, on both ends of the link. On a good link that is invisible. Two Players reported a Duel with a friend on a poor connection as unplayable: both peers rolled back constantly, and their Fighters snapped about.

What could be done:

- **Another network model.** Host-authoritative makes the guest feel the whole round trip on every Attack and Block. Lockstep freezes everyone on every spike. Rollback stays (ADR 0001).
- **A fixed Input Delay for Duels**, as Battles have. It costs a good link responsiveness it does not need to give up, and a bad link may need more.
- **An Input Delay that follows the link**, as GGPO-style fighting games pick theirs: about the one-way latency, in Ticks, capped. A late Intent then arrives in time and is never predicted, so nothing is rolled back. The cost is that much lag on the Player's own Fighter, and only when the link needs it.

## Decision

A Rollback session takes a `maxInputDelay`. Above `inputDelay`, the delay adapts between the two. Every online mode adapts:

- Duels go from 0 up to `DUEL_MAX_INPUT_DELAY` = 4 Ticks (67 ms).
- Battles and Runs go from their `BATTLE_INPUT_DELAY` of 3 (ADR 0025), which stays the floor for the cost of their Ticks, up to `BATTLE_MAX_INPUT_DELAY` = 6 (100 ms). Their Ticks are dear and a deep Rollback can cost more than a frame holds (ADR 0025's cliff), so a bad link is worth more delay there.

- **Target.** On every pong (about one a second), each peer takes the worst live link's smoothed round trip and its jitter (the smoothed difference between each round trip and the mean before it). It asks for `ceil((rtt / 2 + jitter) / tick − 0.25)` Ticks (`targetInputDelay`), clamped to the range. The quarter-Tick dead zone keeps a LAN at none.
- **Hysteresis.** A higher target is taken at once. A lower one only after three pongs in a row call for less, so a flaky link does not saw the delay up and down.
- **Steps.** The delay moves one Tick per Tick, and only when this peer simulates a Tick. To grow from d to d + 1, the Tick that opens up is filled with the last Intent stored, held on with its presses (Jump, Kick, Throw, Sheathe, `equip`, `drop`, `use`, `troop`) let go. To shrink, this Tick's Intent is left out (the Intent stored last call already plays on the Tick it would have). That happens only while it loses nothing: no press in it, and every held button (Attack, Block, `jumpHeld`, crouch, Whirlwind, `throwHeld`) as before. Otherwise it waits for such a Tick. So a press is never lost or repeated. Only a Tick of aim or walking is.
- **Each peer's own.** Streams carry Tick numbers, so peers need not agree, and nothing in the protocol changed. Time sync and AI Takeovers read the delay as it is now, as before.
- The HUD's corner counter shows the delay beside the ping (`… ms (net … · cpu …) · delay 2`).

## Consequences

- Measured over the memory transport (a Duel, both peers on busy Intents for 20 s), the peers re-simulate about a tenth of the Ticks they did with no delay on a middling link (30 ms + up to 15 ms jitter each way: 288 against 2889). On a bad one (45 ms + up to 25 ms) it is about a sixth (660 against 3769), with the delay at its cap and Rollback covering the rest.
- On a bad link a Player's own Attack, Block and turn start up to 67 ms after the press in a Duel and 100 ms in a Battle or a Run. A Wheel Attack's Wind-up is held that much longer (ADR 0025).
- The delay comes down a Tick about every three seconds once the link improves, so a short spike costs a few seconds of a little more delay.
- If the caps prove too little for the links Players have, `DUEL_MAX_INPUT_DELAY` and `BATTLE_MAX_INPUT_DELAY` are the knobs.
- The Battle and Run test harnesses (`battleHarness`, `coopHarness`) replay each Intent under one fixed delay, so they still play fixed. The adaptive path is tested in the session's own tests, with both ranges.
