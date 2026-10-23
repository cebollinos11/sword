# 0004 — The Weapon yields to the off hand's reach, in the simulation

## Status

Accepted

## Context

Two-handed Weapons (the Longsword, the Halberd) are held with the off hand on the Off-hand Grip, a set spot on the grip or shaft behind the sword hand. Motions are authored with Pose Keys for the sword hand, and the default Motions were authored for a one-handed sword. With a long grip, or a Halberd whose hands sit 0.6 m apart, the Off-hand Grip often lands outside the off arm's reach.

Two fixes are tempting: let the off hand fall short and draw a floating hand, or keep the hands together only in the renderer. But the Skeleton is solved inside the Tick (ADR 0001), the off arm's bones are limb Hit Zones, and the Blade Sweep and the Block capsule are built from the solved Weapon (ADR 0002). A visual-only fix would draw the Weapon and the off arm where the simulation does not have them, so Hits and Blocks would land on things that are not there.

## Decision

The off hand always holds the Off-hand Grip, and when it cannot reach, the Weapon moves instead. `solveSkeleton` builds the Weapon's frame from the sword hand's Pose Key target, places the Off-hand Grip spot in it and, if that spot is beyond the off arm's reach, translates the whole Weapon (both hand targets, same orientation) straight toward the off shoulder by exactly the distance it is out of reach. That is the smallest such move, computed analytically, so it is deterministic. Both arms are then solved to the moved targets, and the blade hilt is the solved sword hand. If the sword hand then falls short of its own target, the Off-hand Grip is placed from where it got to, and only then may the off hand fall short.

This runs in the simulation, so the pulled-in Weapon is the one that sweeps, Blocks and is drawn.

## Consequences

- Two-handed Weapons look held: the hands never come apart, and the off arm's Hit Zones are where the arm is drawn.
- A Motion authored for one hand plays with a two-handed Weapon, but the Weapon may be pulled in, shortening its reach. Weapon-specific Motion overrides are how a Weapon gets Motions suited to it.
- The pull changes Blade Sweeps, so it is covered by the Tuning Data hash (Weapons and Motion overrides) and state checksums like everything else in the Skeleton solve.
- One-handed Weapons are unaffected: the off hand follows its Pose Keys as before.
- With both hands on a grip in front of the body, the elbows bend down and out (`TWO_HANDED_POLE`) rather than down and back as for a one-handed Weapon, so the forearms reach round the body to the grip instead of through it. Like the pull, this is part of the Skeleton solve, so it moves the arms' Hit Zones with what is drawn.
