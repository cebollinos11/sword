# Big Battle: 200 v 200 on an open field, with the duel's combat where the Players are

> Status: scoped (2026-11-02), not started. Decisions below came from an interview, one question at a time. Milestone 1 is offline with one Player; online with up to four is Milestone 2. Open tensions are listed at the end and should be settled before Stage 2.

## Context
Every Match today is a Duel: at most four Fighters a Team (`MAX_TEAM_SIZE`), each a full Fighter with a Skeleton, Pose-Key IK, a Blade Sweep and an AI Controller run on every peer, all in a 60 Hz deterministic Simulation that rolls back up to 15 Ticks (ADR 0001, 0005, 0010). We want a Mount & Blade–style battle: 200 soldiers a side, up to four human Players, the rest AI. The Players get the full combat against whoever is near them, while the rest of the battle is a cheap simulation drawn as impostor sprites. A Player can fight some soldiers, break away, move and engage others, and soldiers convert between low and high detail as they come near or move away.

400 full Fighters cannot fit: a 15-Tick Rollback would be about 6,000 Fighter-Ticks of IK and AI in one frame. So the design has **two Simulation tiers** (the Crowd and full Fighters) and a deterministic rule for crossing between them.

## Decisions
- **The Crowd is simulated, not cosmetic.** Every soldier that is not a full Fighter is a **Soldier** in `SimState`: plain data (position, heading, HP, Team, target, a few timers), stepped by the Simulation, hashed, snapshotted and rolled back like everything else. Every peer sees the same battle, and its outcome counts. Only the Players' Intents cross the wire, as before (ADR 0001).
- **The Crowd steps at a low rate, staggered.** A Soldier updates every 6th Tick (10 Hz), with 1/6 of them on each Tick, so the cost per Tick is even. The renderer interpolates between a Soldier's updates. Steering uses a per-Team flow field over the open field plus separation from neighbours (spatial hash grid). No navmesh A* for the Crowd.
- **Soldiers fight Soldiers abstractly.** Two adjacent enemy Soldiers engage, and each Crowd step rolls damage from the Simulation's seeded generator, in the same HP units as a Fighter. The fights are slow and noisy, so equal armies are roughly a coin flip without Players.
- **Only full Fighters can hit full Fighters.** A Soldier never damages a Player's Fighter, and a full Fighter never fights a Soldier. Anything that fights a Player has a Skeleton, a Blade Sweep and Blocks. The duel's combat stays physical and blockable, everywhere it touches a human.
- **The Bubble: Soldiers near a Player become full Fighters.** Each human Player's Fighter has a **Bubble**, decided from Simulation positions, never from the camera, so every peer promotes alike. A Soldier inside it may be **promoted**: it takes a free slot of the **Fighter Pool**, a fixed-size array of full Fighters in `SimState`, starting at guard with the Soldier's position, heading, Team and HP. A full Fighter is **demoted** back to a Soldier (writing its position and HP back) when it leaves the Bubble. Distances have hysteresis: promote at ~10 m, demote beyond ~16 m. A Fighter is demoted only when its Action allows it (Idle or walking, never mid-Attack, Stagger, Knockdown or Fall), and not within ~1 s of its promotion.
- **The Fighter Pool is fixed-size.** The Players' Fighters hold permanent slots. The other slots are bound to Soldiers as they promote, so the snapshot's shape never changes. Size is set by profiling (Stage 0), with a starting guess of about 24.
- **Attack slots cap the pressure on a Player.** Each Bubble promotes at most ~4 enemies (the **Attack Slots**) and ~3 allies. Enemy Soldiers in the Bubble beyond the slots stay Soldiers and hold back in a ring outside sword reach, waiting. When a slot frees (a death, a demotion), the nearest waiting enemy promotes. The AI's existing teamwork (flanking, taking turns, spreading out) works within the slots.
- **Allies in the Bubble promote too**, from the budget's ally share, choosing the allies nearest the slot-holding enemies. Promoted allies fight promoted enemies with real combat and pull enemies off the Player. A full enemy whose target is a Soldier ally either waits, or that ally is promoted if the budget allows.
- **No free disengage.** A promoted enemy keeps chasing, and the Bubble moves with the Player. A Player breaks away with Kicks, Knockdowns, kills and allies who take the enemy's attention, not by walking away. (See the body-blocking tension below.)
- **Promoted soldiers are Beginner AI.** Elites (marked Skilled/Expert captains) were wanted but are deferred past Milestone 1.
- **All 400 on the field at once.** There is no field cap and there are no reinforcement waves.
- **A Team routs below ~20% strength** (Tuning Data), and the other Team wins. No hunt for the last stragglers. The losing side's Soldiers turn and flee toward their edge for a few seconds before the result screen.
- **A Player who dies takes over an ally Soldier.** It becomes that soldier: the generic soldier's Body and Weapon, and the Soldier's current HP. The Soldier promotes into the Player's permanent slot. The nearest living ally is chosen. A Player is out when its Team has no Soldiers left. This is the Controller model (the Local Controller now drives another Fighter) and is close to an AI Takeover in reverse.
- **No orders in Milestone 1.** The armies charge, and the Crowd picks targets. The Crowd's goal is one field per Team (later per squad), so Charge, Hold, Follow me and Form line can be added later without rework.
- **The battlefield is an open field with gentle terrain**, about 200 × 200 m. It is a deterministic heightfield (a function of the Match seed, ADR 0006), with no walls or ledges. Jump Links, falls and the Abyss stay out of this mode. Ground height is a cheap lookup for Soldiers and full Fighters alike.
- **One generic soldier per Team**, a fixed Body and Weapon with a team colour. The Players keep their chosen Body and Weapon until they die.
- **Two render tiers: the full model and an impostor.** Full Fighters are drawn as today. Soldiers are drawn as impostors: one instanced billboard draw per Team from a sprite atlas (8 directions × idle, walk, swing, hit, die). The atlas is baked in-engine from the generic soldier's own Body and Motions, so it matches what the soldier does when promoted. The swap happens at the promotion distance (~10 m), hidden by a short dithered crossfade and a dust puff.
- **The performance target is 60 fps on a mid-range laptop** (recent integrated GPU). Budgets: the Crowd step about 1 ms per Tick, the Fighter Pool as profiled, and about 2 draws per Team for the Crowd. This also leaves headroom for Rollback when online.
- **A minimap is in Milestone 1**: a top-down view of both armies and the Player, render only, so a Player can choose where to engage.
- **Players tip a fair fight.** The armies are equal, and a good Player's kills and rescues decide close battles.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Battle**: the Format of this mode, a Match of two armies of Soldiers on an open Battlefield, ending in a Rout. _Avoid_: war, siege, skirmish (the Lobby's offline mode).
- **Soldier**: a member of an army that is not a full Fighter right now: plain data in the Crowd, fighting other Soldiers by rule and drawn as an impostor. _Avoid_: unit, NPC, Fighter (for a Soldier).
- **Crowd**: all of a Battle's Soldiers and the low-rate step that moves and fights them. _Avoid_: horde, mob.
- **Bubble**: the region around a Player's Fighter where Soldiers promote to full Fighters. _Avoid_: LOD zone, radius.
- **Promotion / Demotion**: a Soldier becoming a full Fighter in a Fighter Pool slot, and back. A Simulation step, rolled back like any other. _Avoid_: spawn, despawn, LOD switch.
- **Fighter Pool**: the fixed set of full Fighter slots in a Battle's `SimState`. _Avoid_: active list.
- **Attack Slot**: one of the few places in a Bubble an enemy may fill to fight its Player. The others wait as Soldiers. _Avoid_: token, ticket.
- **Rout**: a Team breaking when its strength falls below the threshold, which ends the Battle.

## How it fits the existing code
- **`SimState` gains a Crowd**: Soldiers in flat arrays (struct-of-arrays) so a snapshot is a few typed-array copies (400 × ~12 numbers). It must stay plain, hashable data.
- **`fighters[]` becomes the Fighter Pool for a Battle.** `MAX_TEAM_SIZE` (4) and the Lineup assume a Duel's sizes, so a Battle needs its own Pool size, and every system that iterates `fighters` must tolerate unbound slots (a slot with no Soldier is out of play, not dead).
- **Promotion and Demotion are Simulation steps** at the start of a Tick. They are decided from positions, which follow from Intents, so they roll back and resync without new messages (the Dungeon's "choices by walking" rule, ADR 0019).
- **AI Controllers attach to a slot, not a Soldier.** A promoted slot gets a fresh Beginner AI memory, loaded at its Promotion Tick (as an AI Takeover is), so every peer's AI decides alike. A demoted slot drops its memory.
- **The AI must ignore Soldiers.** It sees, targets and blocks only full Fighters. Two new AI behaviours: hold back at the ring while waiting for an Attack Slot, and chase without giving up.
- **The Battlefield is a new Arena kind** beside the Generated Arenas (ADR 0014): a heightfield and no Kit, with `groundBelow` reading the heightfield. Full Fighters keep their collision against each other.
- **The renderer gains two systems**: an instanced impostor layer (atlas, team tint, crossfade with `fighterView` on Promotion), and the minimap.

## Stage 0: profile, then fix the budgets
A stress scene in the Editor's sandbox measures three things on the target laptop. First, Simulation cost per Tick for N full AI Fighters (8, 16, 24, 32, 40) in melee. Second, the cost of a 400-Soldier Crowd step. Third, render cost for 400 impostors plus N skinned models. The result sets the Pool size, the Attack Slot and ally counts, and the Crowd rate. Nothing else is built until the numbers are in.

## Stage 1: the Battlefield and the Crowd, no Players
Heightfield Battlefield, Soldiers, flow-field steering, abstract fights, Rout, impostor rendering, the baked atlas. Watch an AI-vs-AI war from a free camera. Tests: determinism (same seed and Intents give the same hash, across a replay), Crowd step budget, Rout fires, and outcomes are about 50/50 over many seeds.

## Stage 2: the Bubble
The Fighter Pool, Promotion and Demotion with hysteresis, Attack Slots and the waiting ring, ally promotion, the crossfade swap, and the AI ignoring Soldiers. A Player fights in a Battle. Tests: Promotion and Demotion round-trip a Soldier's state, slot limits hold, a Rollback across a Promotion re-decides alike, and no Soldier ever damages a Fighter.

## Stage 3: a full Battle offline
Death and taking over an ally Soldier, the minimap, the HUD (army strengths), Battle as a Lobby Format, and a tuning pass (Bubble distances, Crowd damage, Rout threshold, Beginner AI in groups). End of Milestone 1.

## Milestone 2: online, up to four Players
Four Bubbles, overlapping Bubbles sharing the Pool, Rollback cost with the Pool full (15 Ticks × ~28 Fighters, against about 15 × 8 today), and resync carrying the Crowd and the Pool's AI memories. A visible marker for each Player, since a Player who took over a Soldier looks like every other soldier. A new `PROTOCOL_VERSION`.

## Later
Elites (captains with Relic-style `mods`); Soldiers solid to full Fighters; orders (Charge, Hold, Follow me, Form line); more troop types and Bodies; ranged soldiers (Throwing Daggers, then bows); obstacles and fortifications (Crowd pathfinding beyond a flow field); a third render tier (render-only full models for nearby Soldiers, posed from Motions, which moves the swap further out without a bigger Pool); adjustable army sizes in the Lobby; reinforcement waves for bigger battles.

## Open tensions (settle before Stage 2)
1. **No free disengage, but Soldiers are not solid.** Body-blocking was left out of Milestone 1, so once a Bubble's slots are full, the waiting Soldiers can be walked through, which gives an easy escape the design said shouldn't exist. Options: the waiting ring closes in front of a Player who walks into it (steering only, no collision), or move body-blocking into Milestone 1. Recommended: the steering fix.
2. **A close swap is visible.** With the third-person camera a few metres behind the Player, 10 m is mid-screen, so the sprite-to-model swap will be seen in every fight. The crossfade hides some of it. The third render tier (Later) is the cheap fix with no new art if it bothers playtesters.
3. **Beginner AI was tuned for Duels.** Four of them taking turns may feel either too passive or too deadly in a crowd. Stage 3 tuning should judge it against "a Player can hold off four soldiers but not a dozen".
4. **The Pool size online.** Four Bubbles × (4 + 3) = 28 slots plus the Players. If Stage 0 says the laptop can't Roll back that many, per-Bubble budgets shrink when Bubbles are many, and Milestone 2 needs a rule for it.
