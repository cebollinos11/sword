# 0012 — A Jump lands unhurt; a Hit in the air knocks the jumper down

## Status

Accepted

## Context

A held Jump now reaches about 4 m (`docs/jump-reach.md`). Fall damage counted from a Jump's arc made high Jumps a gamble against the Arena rather than against the opponent, and made leaping down off a ledge at an enemy a self-inflicted wound. But jumping should not become a free escape: a Fighter in the air is committed to its arc.

## Decision

- A Landing after a Jump deals no fall damage and never Staggers, however deep the drop. A Fighter that walked, slid or was pushed off a ledge takes fall damage as before (from the top of its arc, by the metre beyond `fall.safeHeight`) and Staggers on a hard Landing.
- Any Hit that deals damage to a Fighter in the air (a blade, a Throwing Dagger, or a Kick, Shove or not) knocks it down (unless it already is) and pushes it as a Kick's Knockdown does: the Slide's mean speed added to its flight, away from the attacker or along the dagger's flight. Any Jump boost left is lost. A teammate's Hit deals no damage, so it Staggers as on the ground.
- A Fighter in Knockdown lies in the air while airborne; its time down only counts on the ground, so it lies the whole `kick.knockdownTicks` after it lands and never gets up mid-air.
- A Fighter in Knockdown when it lands takes `fall.knockdownDamageFactor` (2) times the fall damage, measured from the real top of its arc: being knocked out of a Jump forfeits the Jump's protection.
- Drops that must kill whatever the Jump (the summit's valley, the ground under the train) are marked as an Abyss Walk Surface, deadly like Lava or Water, a Death by Fall.

## Consequences

- The AI's Jump check (`jumpIsSafe`) and jump Links (ADR 0011) only rule out deadly ground for Jumps now; walk-off drop Links still weigh fall damage.
- Hitting a jumper is the counter to jumping: anti-air Attacks, Kicks and thrown daggers send it down hard, at double fall damage over a ledge.
- Arenas whose drops were deadly only through fall damage need an Abyss surface, or a jumper survives them.
