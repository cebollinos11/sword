# 0010 — Four Players: a star through the host, and an AI takes over a guest who leaves

## Status

Accepted

## Context

Rooms hold up to four Players (ADR 0009); the Rollback session was two-peer. Every peer must hear every Player's Intents (ADR 0001), and a Match of four is long enough that someone dropping out is ordinary, not exceptional.

How Intents travel between guests:

- **Full mesh**: every Player links to every other (up to six WebRTC connections). Guest-to-guest Intents arrive a hop sooner, but each extra link is another NAT traversal that can fail, joining has to negotiate with everyone, and the Room (one broker registration, the host's) would have to introduce guests to each other.
- **Star through the host**: guests keep their one link to the host, the Room link they already have; the host forwards each guest's Intents to the others. One connection per guest, nothing new to negotiate; the cost is a second hop between guests, which Rollback absorbs like any other latency (the host's own Intents still travel one hop).

What happens when a guest leaves mid-Match:

- **End the Match for everyone** (the two-Player rule): with four, one flaky connection would keep throwing three people back to the Lobby.
- **Freeze its Fighter**: the Match goes on, but a Fighter standing idle is a free kill and unbalances the teams.
- **AI Takeover**: an AI Controller drives the Fighter from an agreed Tick on, on every peer. It needs a Tick every peer agrees on and an AI that starts from the same memory everywhere.

## Decision

The peers form a star. The host's Rollback session holds one link per guest (the guest's Match channel on its Room link); a guest's holds one, to the host. Intents messages carry streams, one per Player: a guest sends its own; the host sends its own and every other guest's, each from where that guest's ack for that Player leaves off. Each peer acks every Player's stream it holds. Time sync runs per link: a guest against the host, the host against its slowest guest.

The host starts once every guest's hello (its Weapon pick) has arrived, then sends each guest the Match options, the Lineup, all the picks and its Player number. So the host starts about a one-way trip before the guests; time sync evens that out.

When a guest's link closes, it goes silent for the timeout, or it refuses the host, the host fixes the AI Takeover Tick at one past the last Tick of that guest's Intents it holds. No peer can have confirmed past that Tick, since guests only get that guest's Intents through the host. Each peer, the host included, rolls back to the Takeover Tick if it has simulated beyond it. From that Tick on an AI Controller of difficulty Normal drives the Fighter, loaded on that Tick with a fresh Controller's memory, so every peer's AI decides alike. The host lists the Players who left in every Intents message it sends. A guest that finds itself on the list (the host timed it out) ends its Match. A guest gone before the Match starts is taken over from Tick 1, with the default Weapon.

The host leaving still ends the Match, and the Room, for everyone: the host is the Room, and there is no host migration.

## Consequences

- `PROTOCOL_VERSION` 13: Intents messages carry streams, per-Player acks and the dropped list; a resync carries streams; the host's hello carries `weapons` and `player`.
- AI memory in a resync may be null for a Player's Fighter (before its Takeover Tick) or not (after it); the guest checks it against the Takeovers it knows, and a resync that names a Takeover it hasn't heard of yet is retried at the next checksum.
- A dropped Player's Intents count as settled once a peer holds them up to the Tick before the Takeover, so nobody stalls waiting for Intents that will never come.
- Guest-to-guest Intents are a hop later, so there is more Rollback between guests than between a guest and the host. If that shows in practice, a mesh for Intents alone, with the Room still a star, is the next step.
- The host's upload grows with the number of guests (each guest is sent every other Player's stream); at four Players and small JSON Intents this is a few kB/s.
