# Gauntlet mode: brainstorm

> Status: brainstorm only. Nothing here is agreed design yet. Settle the open questions (below) before turning this into a staged plan.

## Idea
You, alone or in co-op with other humans online, enter a fight against a group of enemies. Beat them and you move on to the next one, then the next, until you die or you beat a final boss.

## Naming
**Room** already means the online connection (CONTEXT.md), so a level needs another name:
- **Floor**: one Duel of the gauntlet against a set of enemies.
- **Run**: the whole gauntlet, from Floor 1 until your Team is wiped out or the boss falls.

Once these are settled, add them to `CONTEXT.md`.

## Core loop
- **Team 0** is the Players (1 human, or 2–3 humans co-op, or humans plus AI allies). **Team 1** is the Floor's enemies.
- A Floor ends the way a Duel ends today. Instead of scoring a point and resetting, the Match builds the next Floor.
- **The Run ends** when Team 0 is wiped out (a loss) or the boss Floor is cleared (a win). There's no best-of-N and no Rematch, just a results screen showing floors cleared and time.
- **HP carries over** between Floors, with a small heal between them (for example +30% of max HP). Without carry-over it is just a series of separate Duels with no tension.
- **Co-op:** a fallen teammate sits out the rest of the Floor and comes back on the next one at reduced HP. If the whole Team falls on the same Floor, the Run is over.

## How it fits the existing code
1. **The next Floor is a pure function of `(floor number, Run seed, carried HP)`.** Every peer computes it the same way, so nothing new goes over the wire (as ADR 0005 already does for AIs). The Floor transition happens inside the simulation, as `nextDuelTick` in `src/sim/match.ts` does today, so Rollback keeps working (ADR 0001).
2. **A gauntlet version of `freshDuel`** that accepts carried HP (and maybe carried Throwing Dagger counts) instead of resetting everything, and takes the Floor's Lineup for Team 1.
3. **Floors in Tuning Data, `data/gauntlet.json`.** Each Floor lists its enemies (difficulty, Weapon, Body), maybe an HP multiplier and later an Arena. Start with a hand-written list, not random generation.
4. **A Gauntlet mode in the Lobby and Skirmish.** Players can only sit on Team 0, and Team 1's Seats are hidden because the Floors decide who's there.
5. **The AI already copes with crowds.** It fights the nearest enemy and defends against the nearest Attack that can reach it, so 2 vs 3 works as is. `MAX_TEAM_SIZE = 3` caps a Floor at 3 enemies at once. For bigger fights, enemies arrive in **waves** within a Floor (a new one spawns when one falls) instead of raising the cap.

## Open questions
### Does the Arena change between Floors?
- **One Arena per Run.** This is simplest: no mid-Match loading, and the existing spawns work.
- **A different Arena each Floor**, for example library → ship → train → summit → chamber for the boss. It feels much more like a dungeon, but every Arena has to be loaded up front and the simulation has to swap Arenas mid-Match.
- Leaning: start with one Arena per Run, and keep the Arena in the Floor data so switching between Floors can be added later.

### What is the final boss?
From cheapest to most work:
- A Hard AI with the Sledge Hammer and 3× HP, wearing the wraith Body. This needs almost no new code.
- A duo: a Hard Halberd paired with a Normal AI throwing daggers.
- Phases: at half HP it switches to a more aggressive profile or calls in adds.
- A larger boss skeleton. This is a big job, because Hit Zones, reach and the AI's spacing all assume today's proportions.

### Others
- How much HP carries over, and how much is healed between Floors?
- Do Throwing Daggers refill each Floor or carry over?
- Revive rules in co-op: what HP does a fallen teammate come back with, and does that cost anything?
- How many Floors is a Run?

## Later ideas (not v1)
- **Boons between Floors**: pick one of three, such as a heal, +1 dagger, more damage, or a Weapon swap. Online that choice is an input, so it has to travel as an Intent during the pause between Floors. That is real protocol work, so it belongs in v2.
- **Elite enemies**: modifiers such as more HP, faster Wind-up or always Chambering.
- **Seeded random Floors**, so each Run is different and friends can share a seed.

## Suggested order
1. Offline Gauntlet: a fixed list of Floors in one Arena, HP carrying over, and a simple boss.
2. Online co-op. The Lineup and netcode already support 2 Players on one Team, so this is mostly Lobby work.
3. Arena changes between Floors, waves, boons and random Floors.
