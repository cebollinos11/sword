# 0007 — A Kick lands physically; the defender's movement decides what it does

## Status

Accepted

## Context

A Kick gives a Fighter a way to punish an opponent who is moving, without the blade. Like an Attack it has to be a fair, readable contact that lives inside the deterministic Tick (ADR 0001, 0003), and the question is both how it connects and what it does.

## Decision

The contact is physical, as the Blade Sweep is (ADR 0002): during Release the kicking leg (right knee to toe) is swept from last Tick's position to this Tick's against the defender's Hit Zones. A Kick lands at most once and ignores Blocks and Weapon capsules, so it is the answer to a Block, and a Block does not decide its outcome.

The outcome is not geometric but ruled by the defender's movement Intent on the contact Tick: any movement input (strafing included) is a Knockdown (more damage, a long Slide, the victim falls and is interrupted); none (Idle, Attacking, Blocking) is a Shove (little damage, a short Slide, the victim's Action untouched). A Fighter already in Knockdown is only Shoved. So a Kick punishes walking into or away from the kicker, and its risk is the kicker's own commitment and the long Recovery of a miss.

The pose supports this with two Pose Key channels: `kickFoot` (the Motion owns the right ankle, so the Gait leaves that foot alone) and `body` (a whole-body tilt and drop, for lying down).

## Consequences

- Rollback needs the Tick's Intents at contact resolution, and each Fighter's kicking leg recorded in its state, as the blade is.
- Slides are simulated (decelerating, colliding with bodies and edges), so a Kick can push a Fighter off a ledge (ADR 0006).
- Tuning the Kick's Motion changes its reach and timing, never the Knockdown/Shove rule.
