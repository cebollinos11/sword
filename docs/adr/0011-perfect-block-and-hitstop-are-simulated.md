# 0011 — The Perfect Block and Hitstop are simulated

## Status

Accepted

## Context

Blocks needed more weight and a reward for timing. Two things give that: a Hitstop (both Fighters freezing for a moment as the blades meet) and a Perfect Block (a late, well-timed Block that punishes the attacker more). Either could be faked in the presentation, but a freeze drawn only on screen would show a moment the Simulation has already left behind, and a reward has to change outcomes.

## Decision

Both live in the Tick (ADR 0001), tuned in `data/block.json`:

- A Block is Perfect when the defender's Block Action is younger than `block.perfectWindow` on the contact Tick. Its attacker Staggers with cause Parried: the Recoil Motion, its last pose held `block.perfectRecoil` longer, with no walking. The Block rule itself (ADR 0002) is unchanged: Perfect only changes what follows.
- A Block puts both Fighters in Hitstop (`FighterState.hitstop`, Ticks left) for `block.hitstop` (`block.perfectHitstop` when Perfect). A Fighter in Hitstop is held as it was, its Intent ignored, except that its Block Impact rings on. Other Fighters keep fighting; a frozen Fighter can still be hit.
- The Block event carries `perfect`, so audio, sparks and the camera can mark it.

## Consequences

- Both peers freeze the same Ticks, and Rollback re-simulates them like any other state; `hitstop` is part of the hashed state and of the snapshot.
- Hitstop freezes attacker and defender alike, so it delays a Block's outcome without moving the frame advantage; the Parried recoil is what moves it.
- A press and release of a button entirely inside a Hitstop is not seen (the Intent is held state, read again after it).
- Tapping block late is now worth more than holding it; `block.perfectWindow` is the knob if that gets spammy.
