# 0009 — The Room link outlives Matches; the Lobby is synced as whole state

## Status

Accepted

## Context

Online, the Players should be able to change the settings (Map, Weapons, teams, AIs) from the in-game menu and restart, or go back to a Lobby, without losing the Room. Rooms should also grow to four Players later. Until now a Room existed only to connect two peers: the host's hello carried the Match options and Lineup, the Rollback session owned the connection for its whole life, and a Match ended only when someone left.

The Room's data channel is unreliable and unordered (`reliable: false`), chosen so Intents never wait on retransmits (ADR 0001).

- **A fresh connection per Match**: simplest for the session, but every restart re-runs the broker handshake and WebRTC negotiation, and anyone behind a fussy network may fail to reconnect.
- **A second, reliable data channel for the Lobby**: ordered messages, but a second negotiation, and PeerJS ties options to the connection.
- **One connection split into channels, with the Lobby as repeated whole state**: no reconnects and no reliability needed. The host sends the whole Lobby on every change and as a heartbeat; guests send their own wishes in full, with a sequence number the host acknowledges. A lost copy is covered by the next.

## Decision

Each guest's connection is the Room link, split into channels (`splitTransport`): the Room channel carries the Lobby, and each Match has its own channel numbered by its generation. Starting or restarting a Match bumps the Lobby's generation. Every peer seated in it attaches a Rollback session to that generation's channel, and drops the old one by detaching its channel, not by closing the link. Messages for an older generation are dropped, and those for a newer one are held briefly, until this side attaches. The Rollback session itself is unchanged: its hello still carries the host's Match options and Lineup, now read off the Lobby's Seats.

The host stays registered on the broker for as long as the Room lives, so guests can join or rejoin between Matches. The Lobby is laid out for `MAX_PLAYERS` (4), but only `SUPPORTED_PLAYERS` (2) Seats may be Open or held by Players. A guest beyond that is turned away (RoomFull), until the Rollback session supports more peers.

## Consequences

- A restart costs one hello round trip, not a reconnect. A guest who joins mid-Match waits in the Lobby and plays from the next generation.
- `PROTOCOL_VERSION` 12: every message on the link is wrapped in its channel.
- The Lobby must stay small, since it is resent every heartbeat. Lobby messages are shape-checked, like the session's (`parseLobbyMessage`).
- Going to four Players means a session per guest (or a relay through the host), not a change to the Lobby or the channels.
