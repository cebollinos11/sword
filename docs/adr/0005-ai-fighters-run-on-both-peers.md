# 0005 — AI Fighters in an online Match run on both peers

## Status

Accepted

## Context

A Player vs Player Match may now field AI Fighters beside the two human Players (team battles up to 3 v 3: the Players on one team or on opposite teams, AIs filling the rest). Someone has to decide each AI Fighter's Intents, under Rollback (ADR 0001).

- **Host runs the AIs and sends their Intents**: one source of truth, but every AI Intent reaches the guest late, so the guest predicts and rolls back AI Fighters as it does the other Player's, and the AIs react to the guest only after a round trip. It also puts gameplay data other than the Players' own Intents on the wire.
- **Both peers run the AIs**: the AI Controller is already deterministic (its randomness is derived from the seeded generator in Simulation state, ADR 0001), so both peers compute the same AI Intents from the same states, with no extra traffic and no AI prediction. But the AI Controller has memory (what it saw over its Reaction Time, its Block and Feint plans), and a Rollback must rewind that memory with the state, or the re-simulated AI would decide differently from the first time and from the other peer.

## Decision

Both peers run every AI Fighter's Controller. The Rollback session snapshots each AI Controller's memory (`save()`) after every simulated Tick, alongside the Match state, and restores it (`load()`) with the state on a Rollback. On a resync the host sends its AI Controllers' memory at the resync Tick with its Match state; the guest validates it like any other incoming message and adopts both.

The host sends the Lineup (who fights, on which team, each AI's difficulty and Weapon) in its hello, with the Match options; each peer builds the AI Controllers from it.

## Consequences

- Only the Players' Intents cross the wire during play, as before; the Addendum to ADR 0001 gains two items: the Lineup in the host's hello, and the AI memory in a resync.
- AI Fighters never need predicting: a Rollback only ever corrects the other Player's Intents, and the AIs re-decide from the corrected states.
- AI memory is part of what must match between peers. It is not hashed in the checksum (it only ever comes from states, which are), but a resync must carry it, or the guest's AIs would act on what they remembered of the diverged states.
- The AI Controller's memory must stay plain data that `save()` copies cheaply, since it is saved every Tick.
